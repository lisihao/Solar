import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { KeyResolverService } from "../../../ai-engine/facade";
import {
  AUTO_INGEST_SYSTEM_USER_ID,
  WikiIngestService,
} from "./wiki-ingest.service";

/**
 * WikiAutoIngestScheduler — PR-1, the "compounding" half of Karpathy's
 * LLM Wiki philosophy. Before this scheduler existed, wiki only updated
 * when a user clicked Ingest; KBs accumulated raw doc updates that wiki
 * never absorbed.
 *
 * Cadence: every 5 minutes. Each tick:
 *  1. Find KBs with `wikiEnabled=true` AND `wikiConfig.autoIngestEnabled
 *     != false` (default true when config row absent).
 *  2. For each KB, load the persisted document coverage watermark produced
 *     only by successful diff apply. Pending/dismissed diffs are proposals,
 *     not proof that raw doc updates were absorbed into the wiki.
 *  3. Find candidate docs that have real content (status != ERROR, not the
 *     `[Pending content fetch from X]` placeholder via metadata.pendingFetch
 *     flag, OR off-loaded) AND whose `updatedAt` is newer than the last
 *     applied coverage watermark for that document (or have no coverage row).
 *  4. Apply per-KB gates:
 *       a. debounce — skip if any WikiDiff from this scheduler created
 *          within `autoIngestDebounceSeconds`
 *       b. daily budget — skip if today's auto-ingest WikiDiff count for
 *          this KB ≥ `autoIngestDailyBudgetCalls`
 *  5. Call `WikiIngestService.ingestAsCron(kbId, docIds)` — produces a
 *     PENDING WikiDiff. Governance preserved (no auto-apply).
 *
 * Pull-based by design: zero changes to `KnowledgeBaseService.addDocument`
 * or update paths. Cursor + filter live entirely in this scheduler.
 */
@Injectable()
export class WikiAutoIngestScheduler {
  private readonly logger = new Logger(WikiAutoIngestScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestService: WikiIngestService,
    private readonly keyResolver: KeyResolverService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: "wiki.auto-ingest" })
  async tick(): Promise<void> {
    if (process.env.ENABLE_WIKI_AUTO_INGEST !== "true") {
      this.logger.debug(
        "[cron:wiki.auto-ingest] DISABLED (default) — set ENABLE_WIKI_AUTO_INGEST=true to opt in",
      );
      return;
    }
    try {
      // ★ 2026-05-11 BYOK consumer model：cron 跟 KB.userId（creator）完全
      //   解耦。creator 只是把 KB 创建出来，未必使用 wiki。"消费者 = 使用者"
      //   = 实际手动触发过 wiki ingest 的人（WikiDiff.createdByUserId 非
      //   AUTO_INGEST_SYSTEM_USER_ID 哨兵）。pickConsumerUserId 从历史挑最近一位。
      const candidates = await this.prisma.knowledgeBase.findMany({
        where: { wikiEnabled: true },
        select: {
          id: true,
          wikiConfig: {
            select: {
              autoIngestEnabled: true,
              autoIngestDailyBudgetCalls: true,
              autoIngestDebounceSeconds: true,
            },
          },
        },
      });

      const eligible = candidates.filter(
        (kb) => kb.wikiConfig?.autoIngestEnabled !== false,
      );

      if (eligible.length === 0) return;

      let triggered = 0;
      let skipped = 0;
      let skippedNoByok = 0;
      let failed = 0;

      for (const kb of eligible) {
        try {
          // ★ 2026-05-11 谁消费谁付钱：消费者 = 实际"使用" wiki 的人，从
          //   WikiDiff 历史里最近一次手动触发的 createdByUserId（非哨兵）取。
          //   - emma 创建 KB 但从未手动 ingest → emma 不是消费者
          //   - Junjie 是 EDITOR 成员 + 触发过 2 次手动 ingest → Junjie 是消费者
          //   - 新 KB 从未手动 ingest → 没消费者，cron 静默跳过等用户第一次
          //     手动 ingest 来建立消费关系（避免无主自动 ingest 偷偷烧别人 BYOK）
          const consumerUserId = await this.pickConsumerUserId(kb.id);
          if (!consumerUserId) {
            skippedNoByok += 1;
            continue;
          }

          const debounceSeconds =
            kb.wikiConfig?.autoIngestDebounceSeconds ?? 300;
          const dailyBudget = kb.wikiConfig?.autoIngestDailyBudgetCalls ?? 20;
          const eligibleDocIds = await this.findIngestableDocIds(
            kb.id,
            debounceSeconds,
            dailyBudget,
          );
          if (eligibleDocIds === null) {
            skipped += 1;
            continue;
          }
          if (eligibleDocIds.length === 0) {
            skipped += 1;
            continue;
          }
          const diff = await this.ingestService.ingestAsCron(
            kb.id,
            eligibleDocIds,
            consumerUserId,
          );
          this.logger.log(
            `[cron:wiki.auto-ingest] kb=${kb.id} diff=${diff.id} docs=${eligibleDocIds.length} consumer=${consumerUserId}`,
          );
          triggered += 1;
        } catch (error) {
          failed += 1;
          this.logger.warn(
            `[cron:wiki.auto-ingest] kb=${kb.id} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      if (triggered > 0 || failed > 0 || skippedNoByok > 0) {
        this.logger.log(
          `[cron:wiki.auto-ingest] tick — eligible=${eligible.length} triggered=${triggered} skipped=${skipped} skippedNoByok=${skippedNoByok} failed=${failed}`,
        );
      }
    } catch (error) {
      // Top-level catch keeps the Nest process alive on transient DB
      // failures — matches the ByokMaintenanceScheduler defensive pattern.
      this.logger.error(
        `[cron:wiki.auto-ingest] catastrophic failure: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 挑"消费者"作为 BYOK 上下文。原则：谁使用谁付费——KB.userId（creator）
   * 跟付费无关，消费者由 wiki 使用历史决定。
   *
   * 1. 找该 KB 最近一次非 AUTO_INGEST_SYSTEM_USER_ID 哨兵的 WikiDiff
   *    createdByUserId —— 这就是最近一位手动触发过 ingest 的用户，即消费者
   * 2. 验证该用户当前有可用 BYOK（PERSONAL key 或 ACTIVE assignment）
   * 3. 没有任何手动 ingest 记录 → null（cron 跳过）；用户先手动 ingest
   *    一次建立消费关系再说。
   * 4. 最近消费者 BYOK 失效（key revoke / 配额耗尽）→ null（cron 跳过），
   *    不偷偷切到上一位消费者，避免 BYOK 账单背锅。用户手动 ingest 一次
   *    即可"刷新"消费者。
   */
  private async pickConsumerUserId(
    knowledgeBaseId: string,
  ): Promise<string | null> {
    const lastManual = await this.prisma.wikiDiff.findFirst({
      where: {
        knowledgeBaseId,
        createdByUserId: { not: AUTO_INGEST_SYSTEM_USER_ID },
      },
      orderBy: { createdAt: "desc" },
      select: { createdByUserId: true },
    });
    if (!lastManual) return null;

    const providers = await this.keyResolver
      .getAvailableProviders(lastManual.createdByUserId)
      .catch(() => [] as string[]);
    if (providers.length === 0) return null;

    return lastManual.createdByUserId;
  }

  /**
   * Returns the doc IDs to ingest, or `null` if a per-KB gate (debounce /
   * daily budget) blocks this tick. Empty array means no doc has changed
   * since the cursor — different from `null` (which means "skip and try
   * again next tick").
   */
  private async findIngestableDocIds(
    knowledgeBaseId: string,
    debounceSeconds: number,
    dailyBudget: number,
  ): Promise<string[] | null> {
    // Debounce: any auto-ingest within the window pre-empts this tick.
    const debounceCutoff = new Date(Date.now() - debounceSeconds * 1000);
    const recentAuto = await this.prisma.wikiDiff.findFirst({
      where: {
        knowledgeBaseId,
        createdByUserId: AUTO_INGEST_SYSTEM_USER_ID,
        createdAt: { gte: debounceCutoff },
      },
      select: { id: true },
    });
    if (recentAuto) return null;

    // Daily budget: count today's auto-ingest diffs for this KB.
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const todayAutoCount = await this.prisma.wikiDiff.count({
      where: {
        knowledgeBaseId,
        createdByUserId: AUTO_INGEST_SYSTEM_USER_ID,
        createdAt: { gte: startOfDay },
      },
    });
    if (todayAutoCount >= dailyBudget) return null;

    // Candidate docs: content is real and the latest raw doc update has not
    // yet been covered by an APPLIED wiki diff. We deliberately do NOT
    // select rawContent — selecting it would trigger PrismaService's R2
    // hydrate hook for off-loaded docs (N round-trips).
    const docs = await this.prisma.knowledgeBaseDocument.findMany({
      where: {
        knowledgeBaseId,
        status: { not: "ERROR" },
      },
      select: {
        id: true,
        metadata: true,
        rawContentUri: true,
        updatedAt: true,
      },
    });

    const coverageRows = await this.prisma.wikiDocumentCoverage.findMany({
      where: { knowledgeBaseId },
      select: {
        documentId: true,
        lastCoveredDocumentUpdatedAt: true,
      },
    });
    const coverageByDocId = new Map(
      coverageRows.map((row) => [
        row.documentId,
        row.lastCoveredDocumentUpdatedAt,
      ]),
    );

    return docs
      .filter((d) => {
        if (!d.rawContentUri) {
          const meta = d.metadata as { pendingFetch?: boolean } | null;
          if (meta?.pendingFetch === true) return false;
        }

        const coveredAt = coverageByDocId.get(d.id);
        if (!coveredAt) return true;
        return d.updatedAt > coveredAt;
      })
      .map((d) => d.id);
  }
}
