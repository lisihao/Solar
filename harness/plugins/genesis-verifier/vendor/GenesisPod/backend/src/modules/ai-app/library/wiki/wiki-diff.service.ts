import * as crypto from "crypto";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  WikiDiff,
  WikiDiffStatus,
  WikiOp,
  WikiOpPageRole,
  WikiPage,
  WikiPageEditedBy,
} from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { KnowledgeBaseService } from "../rag/services/knowledge-base.service";
import { WikiPageService } from "./wiki-page.service";
import {
  WikiDiffItems,
  WikiDiffItemsSchema,
  WikiDiffCreateItem,
  WikiDiffUpdateItem,
} from "./dto/wiki-diff-items.schema";
import { sanitizeMarkdownBody } from "../../../ai-engine/facade";

/**
 * WikiDiffService — atomic diff apply / dismiss with v1.5.3 §5.1 / §11
 * security guarantees:
 *
 *  - WikiDiffItemsSchema zod parse BEFORE entering transaction (security R3 P2)
 *  - affectedKeys recomputed from items (NOT read from DB column) at apply
 *    time, including deletes (security R2 P1 + R3 P1). Each entry is
 *    `${slug}:${locale}` so cross-locale concurrent applies do not falsely
 *    collide / falsely lock the wrong rows (BLOCKER C2 from the 2026-05-12
 *    multi-pass-and-locale consensus). The slug-only `deletes` array is
 *    mapped to `${slug}:zh` per the DEFAULT_WIKI_LOCALE invariant — when a
 *    multi-locale-aware deletes shape lands, this is the single place to
 *    update.
 *  - other PENDING diffs' affectedKeys also recomputed live for collision
 *    detection — never trust DB-stored values (security R3 P2)
 *  - Serializable isolation level + `SELECT ... FOR UPDATE` row-locks every
 *    page whose `(slug, locale)` pair is affected (security R2 P2 + R3 P1).
 *    Row-value `(slug, locale) IN (VALUES ...)` keeps the lock scope at the
 *    exact (slug, locale) granularity instead of pure slug.
 *  - baselineHash recomputed AFTER row-lock; mismatch → CONFLICTED + 409
 *  - Prisma P2034 (serialization_failure) → retry once; second failure → 409
 *  - cross-KB diff IDOR → 404 (NOT 403) per v1.5.3 §6 unified IDOR semantics
 *  - revision snapshot on every updated/deleted page; opId backfilled after
 *    op log row creation
 *  - upsert page → delete+insert WikiPageLink → upsert WikiPageEmbedding
 *    deferred to P2 (when EmbeddingService writes are wired)
 */
const DEFAULT_WIKI_LOCALE = "zh";

/** Build a stable `slug:locale` collision/lock key. */
function makeAffectedKey(slug: string, locale: string): string {
  return `${slug}:${locale}`;
}

/** Parse a `slug:locale` key back into its two components. */
function parseAffectedKey(key: string): { slug: string; locale: string } {
  const idx = key.indexOf(":");
  if (idx < 0) {
    // Defensive — should never happen because every value goes through
    // makeAffectedKey, but if a malformed row sneaks in we treat it as
    // the DEFAULT locale rather than throwing.
    return { slug: key, locale: DEFAULT_WIKI_LOCALE };
  }
  return { slug: key.slice(0, idx), locale: key.slice(idx + 1) };
}

@Injectable()
export class WikiDiffService {
  private readonly logger = new Logger(WikiDiffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kbService: KnowledgeBaseService,
    private readonly pageService: WikiPageService,
  ) {}

  /** Get diff details. Cross-KB returns 404 (not 403). */
  async getDiff(
    userId: string,
    knowledgeBaseId: string,
    diffId: string,
  ): Promise<WikiDiff> {
    await this.assertViewerAccess(userId, knowledgeBaseId);
    const diff = await this.prisma.wikiDiff.findUnique({
      where: { id: diffId },
    });
    // v1.5.3 §6 IDOR unified 404
    if (!diff || diff.knowledgeBaseId !== knowledgeBaseId) {
      throw new NotFoundException("Diff not found");
    }
    return diff;
  }

  /**
   * Dismiss a PENDING diff without applying.
   *
   * Cross-KB → 404 (IDOR semantics).
   * Already-applied / dismissed / conflicted → 409.
   */
  async dismissDiff(
    userId: string,
    knowledgeBaseId: string,
    diffId: string,
  ): Promise<WikiDiff> {
    await this.assertEditorAccessAndWikiEnabled(userId, knowledgeBaseId);
    const diff = await this.prisma.wikiDiff.findUnique({
      where: { id: diffId },
    });
    if (!diff || diff.knowledgeBaseId !== knowledgeBaseId) {
      throw new NotFoundException("Diff not found");
    }
    if (diff.status !== WikiDiffStatus.PENDING) {
      throw new ConflictException(
        `Diff is already ${diff.status}; cannot dismiss`,
      );
    }
    return this.prisma.wikiDiff.update({
      where: { id: diff.id },
      data: { status: WikiDiffStatus.DISMISSED, dismissedAt: new Date() },
    });
  }

  /**
   * Apply a PENDING diff atomically. May retry once on Prisma P2034
   * (serialization_failure); second failure → 409 CONFLICTED.
   *
   * Steps (numbered to match v1.5.3 §5.1):
   *   A) zod parse diff.items
   *   B) recompute affectedKeys (`slug:locale`) from items
   *      (creates ∪ updates ∪ deletes)
   *   C) collision check vs other PENDING diffs (live recompute their keys)
   *   D) SELECT ... FOR UPDATE on all pages with affected (slug, locale) pairs
   *   E) recompute baselineHash; mismatch → CONFLICTED + 409
   *   F) snapshot WikiPageRevision for every updated/deleted page
   *   G) upsert pages × creates+updates
   *   G2) delete pages × deletes
   *   H) recompute outbound links per page
   *   I) WikiPageEmbedding upsert deferred to P2
   *   J) insert WikiOperationLog
   *   K) backfill WikiPageRevision.opId
   *   L) insert WikiOperationLogPage entries
   *   M) update WikiDiff status APPLIED
   */
  async applyDiff(
    userId: string,
    knowledgeBaseId: string,
    diffId: string,
    selectedItemSlugs?: string[],
    options: { supersedeConflictingDiffs?: boolean } = {},
  ): Promise<WikiDiff> {
    await this.assertEditorAccessAndWikiEnabled(userId, knowledgeBaseId);

    const diffRow = await this.prisma.wikiDiff.findUnique({
      where: { id: diffId },
    });
    // v1.5.3 §6 IDOR unified 404
    if (!diffRow || diffRow.knowledgeBaseId !== knowledgeBaseId) {
      throw new NotFoundException("Diff not found");
    }
    if (diffRow.status !== WikiDiffStatus.PENDING) {
      throw new ConflictException(
        `Diff is already ${diffRow.status}; cannot apply`,
      );
    }

    // Step A: zod parse items (defense against malicious / buggy ingest writing
    // illegal fields into DB; v1.2.1 security R3 P2)
    const parsed = WikiDiffItemsSchema.safeParse(diffRow.items);
    if (!parsed.success) {
      throw new ForbiddenException(
        `Diff items failed schema validation: ${parsed.error.message.slice(0, 500)}`,
      );
    }
    const items = this.filterSelectedItems(parsed.data, selectedItemSlugs);

    // Step B: recompute affectedKeys from items (NEVER read DB column).
    // BLOCKER C2 (2026-05-12 consensus §C2): keys are `slug:locale` so two
    // diffs touching the SAME slug but DIFFERENT locales do NOT collide
    // (they target disjoint WikiPage rows under the locale-aware unique
    // constraint). The slug-only `deletes` array uses the DEFAULT locale —
    // when a multi-locale `{slug, locale}` deletes shape lands this is the
    // single source of truth to update.
    const myAffected = new Set<string>([
      ...items.creates.map((c) => makeAffectedKey(c.slug, c.locale)),
      ...items.updates.map((u) => makeAffectedKey(u.slug, u.locale)),
      ...items.deletes.map((s) => makeAffectedKey(s, DEFAULT_WIKI_LOCALE)),
    ]);
    if (myAffected.size === 0) {
      // No-op apply; just mark APPLIED so users see closure.
      return this.prisma.wikiDiff.update({
        where: { id: diffRow.id },
        data: { status: WikiDiffStatus.APPLIED, appliedAt: new Date() },
      });
    }

    // Step C: collision detection vs OTHER PENDING diffs in same KB.
    // Live-recompute each other diff's affectedKeys from items (security R3
    // P2 — never trust the DB column we ourselves wrote).
    const otherPending = await this.prisma.wikiDiff.findMany({
      where: {
        knowledgeBaseId,
        status: WikiDiffStatus.PENDING,
        id: { not: diffRow.id },
      },
      // itemsUri 必须同 select：hydrate guard 警告 + 终态归档后透明回填
      // (PENDING 永远不会被 off-load，但 hydrate guard 不区分 status)
      select: { id: true, items: true, itemsUri: true },
    });
    // ★ 2026-05-12: 冲突 PENDING 收集到 supersedeIds——若 caller 显式要求
    //   newer-wins (用户在 409 弹窗点"覆盖应用")，在 apply 事务里 DISMISS
    //   它们；否则维持原 409 行为（让 caller 选择如何处理）。
    const supersedeIds: string[] = [];
    for (const other of otherPending) {
      const otherParsed = WikiDiffItemsSchema.safeParse(other.items);
      if (!otherParsed.success) continue; // ignore malformed; can't conflict with us
      const otherKeys = new Set<string>([
        ...otherParsed.data.creates.map((c) =>
          makeAffectedKey(c.slug, c.locale),
        ),
        ...otherParsed.data.updates.map((u) =>
          makeAffectedKey(u.slug, u.locale),
        ),
        ...otherParsed.data.deletes.map((s) =>
          makeAffectedKey(s, DEFAULT_WIKI_LOCALE),
        ),
      ]);
      const intersection = [...myAffected].filter((k) => otherKeys.has(k));
      if (intersection.length > 0) {
        if (options.supersedeConflictingDiffs) {
          supersedeIds.push(other.id);
        } else {
          throw new ConflictException(
            `Diff conflicts with PENDING diff ${other.id} on (slug:locale): ${intersection.join(", ")}`,
          );
        }
      }
    }

    // Steps D–M: atomic transaction with retry on P2034.
    return this.executeApplyTransaction(
      userId,
      knowledgeBaseId,
      diffRow,
      items,
      [...myAffected],
      supersedeIds,
    );
  }

  // ─── Internal ───

  private filterSelectedItems(
    items: WikiDiffItems,
    selectedSlugs: string[] | undefined,
  ): WikiDiffItems {
    if (!selectedSlugs || selectedSlugs.length === 0) return items;
    const allowed = new Set(selectedSlugs);
    return {
      creates: items.creates.filter((c) => allowed.has(c.slug)),
      updates: items.updates.filter((u) => allowed.has(u.slug)),
      deletes: items.deletes.filter((s) => allowed.has(s)),
    };
  }

  private async executeApplyTransaction(
    userId: string,
    knowledgeBaseId: string,
    diff: WikiDiff,
    items: WikiDiffItems,
    affectedKeys: string[],
    supersedeConflictingDiffIds: string[] = [],
  ): Promise<WikiDiff> {
    const attempt = async (): Promise<WikiDiff> => {
      return this.prisma.$transaction(
        async (tx) => {
          // ★ 2026-05-12: newer-wins 语义——把冲突 PENDING 在本事务里
          //   DISMISS，让 collision check 之后的 baselineHash 重算仍基于
          //   wiki_pages 真态（DISMISS 不动 pages，只动 diff status）
          if (supersedeConflictingDiffIds.length > 0) {
            await tx.wikiDiff.updateMany({
              where: {
                id: { in: supersedeConflictingDiffIds },
                status: WikiDiffStatus.PENDING,
              },
              data: {
                status: WikiDiffStatus.DISMISSED,
                dismissedAt: new Date(),
              },
            });
          }

          // Step D: SELECT ... FOR UPDATE on every affected (slug, locale)
          // pair. Prisma client doesn't expose `FOR UPDATE` directly → use a
          // raw query to acquire the lock; subsequent reads through `tx` see
          // the locked rows.
          //
          // BLOCKER C2: row-value `(slug, locale) IN (VALUES ...)` keeps the
          // lock at the (slug, locale) row granularity — locking by slug
          // alone would over-block other locales of the same slug under the
          // locale-aware unique constraint (false-positive lock).
          if (affectedKeys.length > 0) {
            const pairs = affectedKeys.map(parseAffectedKey);
            await tx.$queryRaw`
              SELECT id FROM "wiki_pages"
              WHERE "knowledge_base_id" = ${knowledgeBaseId}
                AND ("slug", "locale") IN (${Prisma.join(
                  pairs.map((p) => Prisma.sql`(${p.slug}, ${p.locale})`),
                  ", ",
                )})
              FOR UPDATE
            `;
          }

          // Step E: recompute baselineHash AFTER lock and compare.
          const currentBaseline = await this.computeBaselineHash(
            tx,
            knowledgeBaseId,
          );
          if (currentBaseline !== diff.baselineHash) {
            // Mark CONFLICTED inside the same transaction so callers always
            // see the final state (caller will catch and translate to 409).
            await tx.wikiDiff.update({
              where: { id: diff.id },
              data: { status: WikiDiffStatus.CONFLICTED },
            });
            throw new ConflictException(
              `Wiki state changed since diff was prepared (baseline hash mismatch)`,
            );
          }

          // Load pages affected by updates/deletes for revision snapshots.
          // 2026-05-13 (Screenshot_80 duplicate-entry fix): pagesBySlug 现按
          //   (slug, locale) 复合键索引 —— 单 KB 同 slug 多 locale 共存时
          //   旧版仅按 slug 索引会"后写覆盖前写"，updates 走错 locale 分支。
          const affectedExistingPages = await tx.wikiPage.findMany({
            where: {
              knowledgeBaseId,
              slug: {
                in: [...items.updates.map((u) => u.slug), ...items.deletes],
              },
            },
          });
          const makePageKey = (slug: string, locale: string): string =>
            `${slug}:${locale}`;
          const pagesByKey = new Map(
            affectedExistingPages.map((p) => [
              makePageKey(p.slug, p.locale),
              p,
            ]),
          );
          // 保留 slug-only fallback Map 供 deletes（zod 没强约束 deletes 带 locale）
          const pagesBySlug = new Map(
            affectedExistingPages.map((p) => [p.slug, p]),
          );

          // Step F: snapshot WikiPageRevision before mutating (opId backfilled
          // in Step K).
          const revisionIdsBySlug = new Map<string, string>();
          for (const update of items.updates) {
            // 用 (slug, locale) 复合键查，避免单 KB 多 locale 同 slug 错位
            const current = pagesByKey.get(
              makePageKey(update.slug, update.locale),
            );
            if (!current) continue; // update of non-existent slug — handled by upsert as create
            const rev = await tx.wikiPageRevision.create({
              data: {
                pageId: current.id,
                body: current.body,
                contentHash: current.contentHash,
              },
            });
            revisionIdsBySlug.set(update.slug, rev.id);
          }
          for (const delSlug of items.deletes) {
            const current = pagesBySlug.get(delSlug);
            if (!current) continue;
            const rev = await tx.wikiPageRevision.create({
              data: {
                pageId: current.id,
                body: current.body,
                contentHash: current.contentHash,
              },
            });
            revisionIdsBySlug.set(delSlug, rev.id);
          }

          // Steps G + G2: upsert creates + updates, delete deletes.
          const upsertedPages: Array<{
            slug: string;
            page: WikiPage;
            role: WikiOpPageRole;
          }> = [];

          // 2026-05-13 (Screenshot_80): LLM 偶发对同一 (slug, locale) emit 多次
          //   creates，或同 (slug, locale) 同时在 creates + updates 列表，apply
          //   时上一 upsert 已写入 → 后一 create/update 命中 unique violation。
          //   修复：apply 前去重 —— creates 按 (slug, locale) 保留最后一项；
          //   updates 与 creates (slug, locale) 重合的丢弃（create 语义覆盖
          //   update，LLM 视角下两者本质都是写入）。
          const createsByKey = new Map<
            string,
            (typeof items.creates)[number]
          >();
          for (const c of items.creates) {
            createsByKey.set(makePageKey(c.slug, c.locale), c);
          }
          const dedupedCreates = Array.from(createsByKey.values());
          const dedupedUpdates = items.updates.filter(
            (u) => !createsByKey.has(makePageKey(u.slug, u.locale)),
          );
          if (
            dedupedCreates.length !== items.creates.length ||
            dedupedUpdates.length !== items.updates.length
          ) {
            this.logger.warn(
              `[applyDiff] dedup: creates ${items.creates.length}→${dedupedCreates.length}, updates ${items.updates.length}→${dedupedUpdates.length} (kb=${knowledgeBaseId})`,
            );
          }

          for (const create of dedupedCreates) {
            const sanitizedBody = sanitizeMarkdownBody(create.body).body;
            const contentHash = this.pageService.hashBody(sanitizedBody);
            // P3 (2026-05-12): unique key now includes locale. zod schema
            // .default('zh') guarantees create.locale is always populated,
            // even on legacy PENDING diffs persisted before the column
            // existed (BLOCKER C6 / consensus #8).
            // gap #1 (2026-05-12): bilingual KBs pass translationGroupId
            // through to wiki_pages so the two locale pages can be paired
            // by `findFirst({ translationGroupId, locale: 'en' })`.
            const page = await tx.wikiPage.upsert({
              where: {
                knowledgeBaseId_slug_locale: {
                  knowledgeBaseId,
                  slug: create.slug,
                  locale: create.locale,
                },
              },
              create: {
                knowledgeBaseId,
                slug: create.slug,
                locale: create.locale,
                title: create.title,
                category: create.category,
                body: sanitizedBody,
                oneLiner: create.oneLiner,
                contentHash,
                lastEditedBy: WikiPageEditedBy.LLM,
                ...(create.translationGroupId
                  ? { translationGroupId: create.translationGroupId }
                  : {}),
              },
              update: {
                title: create.title,
                category: create.category,
                body: sanitizedBody,
                oneLiner: create.oneLiner,
                contentHash,
                lastEditedBy: WikiPageEditedBy.LLM,
                // Only overwrite translationGroupId when caller explicitly
                // provides one — preserves prior groupId on re-ingest where
                // LLM forgets to repeat it.
                ...(create.translationGroupId
                  ? { translationGroupId: create.translationGroupId }
                  : {}),
              },
            });
            await this.pageService.replaceOutboundLinks(
              tx,
              page.id,
              sanitizedBody,
              page.locale,
            );
            await this.replaceSourcesForPage(tx, page.id, create);
            upsertedPages.push({
              slug: create.slug,
              page,
              role: WikiOpPageRole.CREATED,
            });
          }

          for (const update of dedupedUpdates) {
            const sanitizedBody = sanitizeMarkdownBody(update.newBody).body;
            const contentHash = this.pageService.hashBody(sanitizedBody);
            const existing = pagesByKey.get(
              makePageKey(update.slug, update.locale),
            );
            if (!existing) {
              // 2026-05-13: 之前 tx.wikiPage.create() 不传 locale → 用 schema
              //   default("zh") → 与 dedupedCreates 同 locale 的"已 upsert 行"
              //   碰撞 (unique violation)。改用 upsert + 显式 locale，幂等。
              //   Title/category default fallbacks: keep slug as title, CONCEPT.
              const created = await tx.wikiPage.upsert({
                where: {
                  knowledgeBaseId_slug_locale: {
                    knowledgeBaseId,
                    slug: update.slug,
                    locale: update.locale,
                  },
                },
                create: {
                  knowledgeBaseId,
                  slug: update.slug,
                  locale: update.locale,
                  title: update.slug,
                  category: "CONCEPT",
                  body: sanitizedBody,
                  oneLiner: update.newOneLiner ?? update.slug,
                  contentHash,
                  lastEditedBy: WikiPageEditedBy.LLM,
                },
                update: {
                  body: sanitizedBody,
                  contentHash,
                  lastEditedBy: WikiPageEditedBy.LLM,
                  ...(update.newOneLiner !== undefined
                    ? { oneLiner: update.newOneLiner }
                    : {}),
                },
              });
              await this.pageService.replaceOutboundLinks(
                tx,
                created.id,
                sanitizedBody,
                created.locale,
              );
              if (update.sources) {
                await this.replaceSourcesForPage(tx, created.id, {
                  sources: update.sources,
                });
              }
              upsertedPages.push({
                slug: update.slug,
                page: created,
                role: WikiOpPageRole.CREATED,
              });
              continue;
            }
            const updated = await tx.wikiPage.update({
              where: { id: existing.id },
              data: {
                body: sanitizedBody,
                ...(update.newOneLiner !== undefined
                  ? { oneLiner: update.newOneLiner }
                  : {}),
                contentHash,
                lastEditedBy: WikiPageEditedBy.LLM,
              },
            });
            await this.pageService.replaceOutboundLinks(
              tx,
              updated.id,
              sanitizedBody,
              updated.locale,
            );
            if (update.sources) {
              await this.replaceSourcesForPage(tx, updated.id, {
                sources: update.sources,
              });
            }
            upsertedPages.push({
              slug: update.slug,
              page: updated,
              role: WikiOpPageRole.UPDATED,
            });
          }

          // Step G2: deletes (Cascade clears revisions/links/sources/embeddings).
          // We capture the page id before delete so the op log can reference it
          // (though SetNull on opLogPage means it can also be null after).
          const deletedPageIds: Array<{ slug: string; id: string }> = [];
          for (const delSlug of items.deletes) {
            const existing = pagesBySlug.get(delSlug);
            if (!existing) continue;
            await tx.wikiPage.delete({ where: { id: existing.id } });
            deletedPageIds.push({ slug: delSlug, id: existing.id });
          }

          // Step J: insert WikiOperationLog and capture opId.
          const opLog = await tx.wikiOperationLog.create({
            data: {
              knowledgeBaseId,
              op: WikiOp.INGEST,
              title: `Apply diff ${diff.id.slice(0, 8)}`,
              meta: {
                diffId: diff.id,
                createdItems: dedupedCreates.length,
                updatedItems: dedupedUpdates.length,
                deletedItems: items.deletes.length,
              } as Prisma.InputJsonValue,
              actorUserId: userId,
            },
          });

          // Step K: backfill opId on revisions written in Step F.
          if (revisionIdsBySlug.size > 0) {
            await tx.wikiPageRevision.updateMany({
              where: { id: { in: [...revisionIdsBySlug.values()] } },
              data: { opId: opLog.id },
            });
          }

          // Step L: WikiOperationLogPage entries (deletes use SetNull pageId
          // since the page is gone, but we still want a row to record what
          // happened — we use null pageId).
          const opPagesData: Array<{
            opId: string;
            pageId: string | null;
            role: WikiOpPageRole;
          }> = [
            ...upsertedPages.map((u) => ({
              opId: opLog.id,
              pageId: u.page.id,
              role: u.role,
            })),
            ...deletedPageIds.map(() => ({
              opId: opLog.id,
              pageId: null,
              role: WikiOpPageRole.DELETED,
            })),
          ];
          if (opPagesData.length > 0) {
            await tx.wikiOperationLogPage.createMany({ data: opPagesData });
          }

          // Step M: mark diff APPLIED.
          const appliedDiff = await tx.wikiDiff.update({
            where: { id: diff.id },
            data: { status: WikiDiffStatus.APPLIED, appliedAt: new Date() },
          });

          await this.refreshDocumentCoverage(
            tx,
            knowledgeBaseId,
            appliedDiff.id,
          );

          return appliedDiff;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    };

    // P2034 retry: serialization_failure under Serializable isolation is
    // common under concurrent applies; one retry then surface as 409.
    let result: WikiDiff;
    try {
      result = await attempt();
    } catch (e) {
      if (this.isSerializationFailure(e)) {
        this.logger.warn(
          `[applyDiff] P2034 serialization_failure on diff=${diff.id}; retrying once`,
        );
        try {
          result = await attempt();
        } catch (e2) {
          if (this.isSerializationFailure(e2)) {
            await this.prisma.wikiDiff.update({
              where: { id: diff.id },
              data: { status: WikiDiffStatus.CONFLICTED },
            });
            throw new ConflictException(
              "Diff apply could not be serialized after retry; please re-run ingest",
            );
          }
          throw e2;
        }
      } else {
        throw e;
      }
    }

    // W5 v2.0 rebuild (2026-05-12): regenerate the `__index__` system page
    // post-commit (fire-and-forget so an index failure does not roll back
    // the just-applied diff). Karpathy "compounding tracker" — index always
    // reflects current KB state right after an ingest lands.
    void this.pageService
      .regenerateIndexPage(knowledgeBaseId)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[applyDiff] index page regen failed kb=${knowledgeBaseId}: ${message}`,
        );
      });

    return result;
  }

  private async replaceSourcesForPage(
    tx: Prisma.TransactionClient,
    pageId: string,
    item: {
      sources?: WikiDiffCreateItem["sources"] | WikiDiffUpdateItem["sources"];
    },
  ): Promise<void> {
    if (!item.sources || item.sources.length === 0) return;
    await tx.wikiPageSource.deleteMany({ where: { pageId } });
    await tx.wikiPageSource.createMany({
      data: item.sources.map((s) => ({
        pageId,
        documentId: s.documentId,
        spanStart: s.spanStart,
        spanEnd: s.spanEnd,
        quote: s.quote,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Refresh document coverage from the CURRENT wiki state, not from diff
   * proposal time. Auto-ingest correctness depends on knowing which source
   * documents are actually represented by applied wiki pages.
   */
  private async refreshDocumentCoverage(
    tx: Prisma.TransactionClient,
    knowledgeBaseId: string,
    appliedDiffId: string,
  ): Promise<void> {
    const coverageRows = await tx.$queryRaw<
      Array<{
        documentId: string;
        lastCoveredDocumentUpdatedAt: Date;
      }>
    >`
      SELECT DISTINCT
        s.document_id AS "documentId",
        d.updated_at AS "lastCoveredDocumentUpdatedAt"
      FROM wiki_page_sources s
      JOIN wiki_pages p ON p.id = s.page_id
      JOIN knowledge_base_documents d ON d.id = s.document_id
      WHERE p.knowledge_base_id = ${knowledgeBaseId}::text
    `;

    const now = new Date();
    if (coverageRows.length === 0) {
      await tx.$executeRaw`
        DELETE FROM wiki_document_coverages
        WHERE knowledge_base_id = ${knowledgeBaseId}::text
      `;
      return;
    }

    for (const row of coverageRows) {
      await tx.$executeRaw`
        INSERT INTO wiki_document_coverages (
          knowledge_base_id,
          document_id,
          last_covered_document_updated_at,
          last_applied_diff_id,
          last_applied_at,
          updated_at
        )
        VALUES (
          ${knowledgeBaseId}::text,
          ${row.documentId}::text,
          ${row.lastCoveredDocumentUpdatedAt},
          ${appliedDiffId}::text,
          ${now},
          ${now}
        )
        ON CONFLICT (knowledge_base_id, document_id)
        DO UPDATE SET
          last_covered_document_updated_at =
            EXCLUDED.last_covered_document_updated_at,
          last_applied_diff_id = EXCLUDED.last_applied_diff_id,
          last_applied_at = EXCLUDED.last_applied_at,
          updated_at = EXCLUDED.updated_at
      `;
    }

    const activeDocumentIds = coverageRows.map((row) => row.documentId);
    await tx.$executeRaw`
      DELETE FROM wiki_document_coverages
      WHERE knowledge_base_id = ${knowledgeBaseId}::text
        AND NOT (document_id = ANY(${activeDocumentIds}::text[]))
    `;
  }

  /**
   * Compute a deterministic hash of the KB's wiki index state at this moment.
   * Must be byte-stable across calls for the same DB state — we sort by slug
   * to remove any ordering instability from the underlying query plan.
   */
  private async computeBaselineHash(
    tx: Prisma.TransactionClient,
    knowledgeBaseId: string,
  ): Promise<string> {
    const rows = await tx.wikiPage.findMany({
      where: { knowledgeBaseId },
      select: {
        slug: true,
        oneLiner: true,
        category: true,
        contentHash: true,
      },
      orderBy: { slug: "asc" },
    });
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(rows), "utf8")
      .digest("hex");
  }

  private isSerializationFailure(e: unknown): boolean {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      return e.code === "P2034";
    }
    return false;
  }

  // ─── Access helpers (mirror WikiPageService) ───

  private async assertViewerAccess(
    userId: string,
    knowledgeBaseId: string,
  ): Promise<void> {
    const ok = await this.kbService.hasAccess(
      knowledgeBaseId,
      userId,
      "VIEWER",
    );
    if (!ok) throw new ForbiddenException("Access denied");
  }

  private async assertEditorAccessAndWikiEnabled(
    userId: string,
    knowledgeBaseId: string,
  ): Promise<void> {
    const ok = await this.kbService.hasAccess(
      knowledgeBaseId,
      userId,
      "EDITOR",
    );
    if (!ok) throw new ForbiddenException("Editor access required");
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { wikiEnabled: true },
    });
    if (!kb) throw new NotFoundException("Knowledge base not found");
    if (!kb.wikiEnabled) {
      throw new ForbiddenException("Wiki is not enabled for this KB");
    }
  }

  /** Public so WikiIngestService can compute baseline before persisting diff. */
  async computeKbBaselineHash(knowledgeBaseId: string): Promise<string> {
    return this.computeBaselineHash(this.prisma, knowledgeBaseId);
  }
}
