/**
 * MissionReportHelper — 报告版本化与 trajectory 持久化
 *
 * ★ 2026-05-24 P6 Wave 1：report version 部分 framework 化下沉到
 *   `ai-harness/teams/business-team/lifecycle/business-team-report-helper.framework.ts`。
 *   research-result / chapter-draft 留 playground 专属（业务表 + schema）。
 */

import { Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  BusinessTeamReportHelperFramework,
  type ReportHelperHooks,
  type ReportVersionListItem,
} from "@/modules/ai-harness/facade";

export interface PlaygroundReportVersionRow extends ReportVersionListItem {
  readonly finalScore: number | null;
  readonly leaderSigned: boolean | null;
}

export interface PlaygroundReportVersionDetail extends PlaygroundReportVersionRow {
  readonly reportFull: unknown;
  readonly changesFromPrev: unknown;
}

export class MissionReportHelper extends BusinessTeamReportHelperFramework<PlaygroundReportVersionRow> {
  private readonly playgroundLog = new Logger(MissionReportHelper.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly isMissionRowMissing: (err: unknown) => boolean,
    private readonly emergencyAbortOnMissingRow: (
      missionId: string,
      reason: string,
    ) => void,
  ) {
    const hooks: ReportHelperHooks<PlaygroundReportVersionRow> = {
      loggerNamespace: "MissionReportHelper",
      runSerializable: async (fn) =>
        prisma.$transaction(async (tx) => fn(tx), {
          isolationLevel: "Serializable",
        }),
      aggregateMaxVersion: async (missionId, tx) => {
        const agg = await (
          tx as Prisma.TransactionClient
        ).missionReportVersion.aggregate({
          where: { missionId },
          _max: { version: true },
        });
        return agg._max.version ?? 0;
      },
      createVersion: async (args, tx) => {
        await (tx as Prisma.TransactionClient).missionReportVersion.create({
          data: {
            missionId: args.missionId,
            version: args.version,
            versionLabel: args.versionLabel,
            reportFull: (args.reportFull ?? null) as Prisma.InputJsonValue,
            reportTitle: args.reportTitle,
            reportSummary: args.reportSummary,
            triggerType: args.triggerType,
            finalScore: (args.extra?.finalScore as number | undefined) ?? null,
            leaderSigned:
              (args.extra?.leaderSigned as boolean | undefined) ?? null,
          },
        });
      },
      listVersions: async (missionId) => {
        const rows = await prisma.missionReportVersion.findMany({
          where: { missionId },
          orderBy: { generatedAt: "desc" },
          select: {
            id: true,
            version: true,
            versionLabel: true,
            reportTitle: true,
            reportSummary: true,
            finalScore: true,
            leaderSigned: true,
            triggerType: true,
            generatedAt: true,
          },
        });
        return rows;
      },
      findVersion: async (missionId, version) => {
        const row = await prisma.missionReportVersion.findUnique({
          where: { missionId_version: { missionId, version } },
        });
        if (!row) return null;
        return {
          id: row.id,
          version: row.version,
          versionLabel: row.versionLabel,
          reportTitle: row.reportTitle,
          reportSummary: row.reportSummary,
          finalScore: row.finalScore,
          leaderSigned: row.leaderSigned,
          triggerType: row.triggerType,
          generatedAt: row.generatedAt,
        };
      },
    };
    super(hooks);
  }

  /**
   * 写新 report version。Back-compat shim 包 framework saveReportVersion，
   * 让 caller 继续传 finalScore / leaderSigned 顶层字段。
   */
  async saveReportVersion(args: {
    missionId: string;
    triggerType: string;
    report?: { title?: string; summary?: string; [k: string]: unknown };
    finalScore?: number;
    leaderSigned?: boolean;
    versionLabel?: string;
  }): Promise<number> {
    return super.saveReportVersion({
      missionId: args.missionId,
      triggerType: args.triggerType,
      report: args.report,
      versionLabel: args.versionLabel,
      extra: {
        finalScore: args.finalScore ?? null,
        leaderSigned: args.leaderSigned ?? null,
      },
    });
  }

  /** Find 单 version 含 reportFull / changesFromPrev（framework 投影没带）。 */
  async getReportVersion(
    missionId: string,
    version: number,
  ): Promise<PlaygroundReportVersionDetail | null> {
    const row = await this.prisma.missionReportVersion
      .findUnique({
        where: { missionId_version: { missionId, version } },
      })
      .catch((err: unknown) => {
        this.playgroundLog.warn(
          `[getReportVersion ${missionId} v${version}] failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });
    if (!row) return null;
    return {
      id: row.id,
      version: row.version,
      versionLabel: row.versionLabel,
      reportFull: row.reportFull,
      reportTitle: row.reportTitle,
      reportSummary: row.reportSummary,
      finalScore: row.finalScore,
      leaderSigned: row.leaderSigned,
      triggerType: row.triggerType,
      changesFromPrev: row.changesFromPrev,
      generatedAt: row.generatedAt,
    };
  }

  async saveResearchResult(args: {
    missionId: string;
    dimension: string;
    retryLabel?: string;
    findings: { claim: string; evidence: string; source: string }[];
    summary: string;
    state: "completed" | "degraded" | "failed";
    iterations?: number;
    wallTimeMs?: number;
  }): Promise<void> {
    await this.prisma.agentPlaygroundResearchResult
      .upsert({
        where: {
          missionId_dimension_retryLabel: {
            missionId: args.missionId,
            dimension: args.dimension.slice(0, 200),
            retryLabel: args.retryLabel ?? "",
          },
        },
        create: {
          missionId: args.missionId,
          dimension: args.dimension.slice(0, 200),
          retryLabel: args.retryLabel ?? "",
          findings: args.findings as unknown as object,
          summary: args.summary.slice(0, 50_000),
          state: args.state,
          iterations: args.iterations,
          wallTimeMs: args.wallTimeMs,
        },
        update: {
          findings: args.findings as unknown as object,
          summary: args.summary.slice(0, 50_000),
          state: args.state,
          iterations: args.iterations,
          wallTimeMs: args.wallTimeMs,
        },
      })
      .catch((err: unknown) => {
        if (this.isMissionRowMissing(err)) {
          this.emergencyAbortOnMissingRow(
            args.missionId,
            `saveResearchResult FK violation dim=${args.dimension}`,
          );
          return;
        }
        this.playgroundLog.warn(
          `[saveResearchResult] mission=${args.missionId} dim=${args.dimension} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  async loadBaselineResearchResults(missionId: string): Promise<
    Array<{
      dimension: string;
      findings: { claim: string; evidence: string; source: string }[];
      summary: string;
    }>
  > {
    const rows = await this.prisma.agentPlaygroundResearchResult
      .findMany({ where: { missionId, retryLabel: "" } })
      .catch((err: unknown) => {
        this.playgroundLog.warn(
          `[mission-report] loadResearchResults for ${missionId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
      });
    return rows
      .filter((r) => r.state === "completed" || r.state === "degraded")
      .map((r) => ({
        dimension: r.dimension,
        findings: r.findings as unknown as {
          claim: string;
          evidence: string;
          source: string;
        }[],
        summary: r.summary,
      }));
  }

  async saveChapterDraft(args: {
    missionId: string;
    dimension: string;
    chapterIndex: number;
    heading: string;
    thesis?: string;
    content: string;
    status:
      | "writing"
      | "reviewing"
      | "passed"
      | "done"
      | "failed-finalized"
      | "failed";
    score?: number;
    critique?: string;
    attempts?: number;
    wordCount?: number;
  }): Promise<void> {
    await this.prisma.agentPlaygroundChapterDraft
      .upsert({
        where: {
          missionId_dimension_chapterIndex: {
            missionId: args.missionId,
            dimension: args.dimension.slice(0, 200),
            chapterIndex: args.chapterIndex,
          },
        },
        create: {
          missionId: args.missionId,
          dimension: args.dimension.slice(0, 200),
          chapterIndex: args.chapterIndex,
          heading: args.heading.slice(0, 500),
          thesis: args.thesis,
          content: args.content,
          status: args.status,
          score: args.score,
          critique: args.critique,
          attempts: args.attempts ?? 1,
          wordCount: args.wordCount,
        },
        update: {
          heading: args.heading.slice(0, 500),
          thesis: args.thesis,
          content: args.content,
          status: args.status,
          score: args.score,
          critique: args.critique,
          attempts: args.attempts ?? 1,
          wordCount: args.wordCount,
        },
      })
      .catch((err: unknown) => {
        if (this.isMissionRowMissing(err)) {
          this.emergencyAbortOnMissingRow(
            args.missionId,
            `saveChapterDraft FK violation dim=${args.dimension} ch=${args.chapterIndex}`,
          );
          return;
        }
        this.playgroundLog.warn(
          `[saveChapterDraft] mission=${args.missionId} dim=${args.dimension} ch=${args.chapterIndex} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  async loadQualifiedChapterDrafts(missionId: string): Promise<
    Array<{
      dimension: string;
      chapterIndex: number;
      heading: string;
      thesis?: string;
      content: string;
      score?: number;
      attempts: number;
      wordCount?: number;
    }>
  > {
    const rows = await this.prisma.agentPlaygroundChapterDraft
      .findMany({
        where: { missionId, status: { in: ["passed", "done"] } },
        orderBy: [{ dimension: "asc" }, { chapterIndex: "asc" }],
      })
      .catch((err: unknown) => {
        this.playgroundLog.warn(
          `[mission-report] loadQualifiedChapterDrafts for ${missionId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
      });
    return rows.map((r) => ({
      dimension: r.dimension,
      chapterIndex: r.chapterIndex,
      heading: r.heading,
      thesis: r.thesis ?? undefined,
      content: r.content,
      score: r.score ?? undefined,
      attempts: r.attempts,
      wordCount: r.wordCount ?? undefined,
    }));
  }
}
