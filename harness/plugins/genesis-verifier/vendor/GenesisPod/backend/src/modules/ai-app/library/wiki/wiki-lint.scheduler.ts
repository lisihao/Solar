import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { WikiLintService } from "./wiki-lint.service";

/**
 * WikiLintScheduler — daily cron that finally wires the long-orphaned
 * `WikiKnowledgeBaseConfig.cronLintEnabled` + `cronLintDailyBudgetCalls`
 * fields to an actual runner. Before this scheduler existed the config
 * fields had no consumer; the lint pipeline was user-trigger-only.
 *
 * Schedule: 03:00 UTC every day — well outside business hours for both
 * APAC and Americas, low LLM contention.
 *
 * Per-KB gates (all checked before LLM spend):
 *  - KB.wikiEnabled = true
 *  - WikiKnowledgeBaseConfig.cronLintEnabled = true (default true when row exists)
 *  - No WikiLintFinding created in the last 23 hours
 *    (rolling-window dedup — manual lint within 23h pre-empts the cron)
 *
 * Per-KB LLM budget is honored by WikiLintService.runFullLintAsCron via the
 * existing `cronLintDailyBudgetCalls` field.
 */
@Injectable()
export class WikiLintScheduler {
  private readonly logger = new Logger(WikiLintScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lintService: WikiLintService,
  ) {}

  @Cron("0 3 * * *", { name: "wiki.lint-daily", timeZone: "UTC" })
  async runDailyLint(): Promise<void> {
    if (process.env.ENABLE_WIKI_LINT_CRON !== "true") {
      this.logger.debug(
        "[cron:wiki.lint] DISABLED (default) — set ENABLE_WIKI_LINT_CRON=true to opt in",
      );
      return;
    }
    try {
      const candidates = await this.prisma.knowledgeBase.findMany({
        where: { wikiEnabled: true },
        select: {
          id: true,
          wikiConfig: { select: { cronLintEnabled: true } },
        },
      });

      const eligible = candidates.filter(
        (kb) => kb.wikiConfig?.cronLintEnabled !== false,
      );

      if (eligible.length === 0) {
        this.logger.log("[cron:wiki.lint] no eligible KBs, skipping");
        return;
      }

      this.logger.log(
        `[cron:wiki.lint] scanning ${eligible.length} wiki-enabled KBs`,
      );

      let ran = 0;
      let skipped = 0;
      let failed = 0;
      const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000);

      for (const kb of eligible) {
        try {
          // Dedup: skip if any lint finding was created in the last 23h
          // (manual run within window pre-empts the cron for this KB).
          const recent = await this.prisma.wikiLintFinding.findFirst({
            where: {
              knowledgeBaseId: kb.id,
              createdAt: { gte: twentyThreeHoursAgo },
            },
            select: { id: true },
          });
          if (recent) {
            skipped += 1;
            continue;
          }

          const result = await this.lintService.runFullLintAsCron(kb.id);
          this.logger.log(
            `[cron:wiki.lint] kb=${kb.id} counts=${JSON.stringify(result.counts)} budget=${result.budgetExceeded}`,
          );
          ran += 1;
        } catch (error) {
          failed += 1;
          this.logger.warn(
            `[cron:wiki.lint] kb=${kb.id} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      this.logger.log(
        `[cron:wiki.lint] done — ran=${ran} skipped=${skipped} failed=${failed}`,
      );
    } catch (error) {
      // Top-level catch so a transient failure does not crash the Nest
      // process — same defensive pattern as ByokMaintenanceScheduler.
      this.logger.error(
        `[cron:wiki.lint] catastrophic failure: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
