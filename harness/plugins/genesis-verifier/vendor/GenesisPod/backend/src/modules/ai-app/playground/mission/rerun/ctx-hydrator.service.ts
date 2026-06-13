/**
 * CtxHydratorService —— playground 业务子类(继承 BusinessTeamCtxHydratorFramework)
 *
 * 上游：docs/architecture/ai-harness/runner/per-task-rerun-with-cascade.md v1.2 §3.2
 *
 * 2026-05-24 P5 (Wave 1)：fetch detail / NotFound / size guard / snapshot 校验骨架
 * 已上提到 ai-harness/teams/business-team/rerun/business-team-ctx-hydrator.framework。
 * 本类只剩业务 hook：
 *   - 主行 schema (PlaygroundMissionDetail)
 *   - 业务子表 join (agent_playground_research_results / agentPlaygroundChapterDraft)
 *   - report payload zod parse (parseReportArtifact)
 *   - businessInput rebuild (configSnapshot → RunMissionInput)
 *
 * 限制：
 *   - 装配阶段的 leader / billing / pool / abortRegistry / budgetMultiplier 不能从 DB 重建
 *   - 调用方需要自己 supply 这些 ctx 字段（通常是 minimal stub 或 mission 子集）
 */

import { Injectable } from "@nestjs/common";
import type { MissionContext } from "../context/mission-context";
import { MissionStore } from "../lifecycle/mission-store.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import type {
  RunMissionInput,
  ResearchReport,
} from "../../api/dto/run-mission.dto";
import type { PlaygroundConfigSnapshot } from "../../runtime/playground.input-rebuilder";
import {
  BusinessTeamCtxHydratorFramework,
  parseReportArtifact,
  type CtxHydratorDetailMinimal,
  type CtxHydratorSchemaProvider,
  type ReportArtifact,
} from "@/modules/ai-harness/facade";

/**
 * Hydrated ctx 提供给 stage 函数 —— 缺装配期纯 runtime 字段（leader/billing/pool 等），
 * 那些由调用方按需补 stub。stage 函数若实际访问这些字段会运行时 throw（提示设计错误）。
 */
export type HydratedMissionContext = Omit<
  MissionContext,
  "billing" | "pool" | "leader" | "budgetMultiplier" | "t0"
> & {
  /** 重跑场景下 t0 重置为 rerun 启动时间 */
  readonly t0: number;
  /** 标识此 ctx 来自 hydrate 而非装配 —— 调用方决策时可读 */
  readonly __hydrated: true;
};

/** playground detail 投影满足 framework 主行约束（含 reportFull / configSnapshot） */
type PlaygroundHydratorDetail = NonNullable<
  Awaited<ReturnType<MissionStore["getById"]>>
> &
  CtxHydratorDetailMinimal;

@Injectable()
export class CtxHydratorService extends BusinessTeamCtxHydratorFramework<
  PlaygroundHydratorDetail,
  HydratedMissionContext
> {
  constructor(
    store: MissionStore,
    private readonly prisma: PrismaService,
  ) {
    const schemaProvider: CtxHydratorSchemaProvider<
      PlaygroundHydratorDetail,
      HydratedMissionContext
    > = {
      fetchDetail: async (missionId, userId) => {
        const detail = await store.getById(missionId, userId);
        return (detail as PlaygroundHydratorDetail | null) ?? null;
      },
      assertSnapshotSupported: (detail) => {
        const snap = detail.configSnapshot as PlaygroundConfigSnapshot | null;
        if (snap?.schemaVersion == null) {
          return {
            ok: false,
            reason:
              "早于 config snapshot 上线(legacy),不支持重跑。请重新发起新任务。",
          };
        }
        return { ok: true };
      },
      buildHydrated: async ({ detail, missionId, userId }) =>
        this.buildHydrated(detail, missionId, userId),
      // 默认 2MB（与 v1.2 类别 E5 一致）
    };
    super(schemaProvider, "playground");
  }

  private async buildHydrated(
    detail: PlaygroundHydratorDetail,
    missionId: string,
    userId: string,
  ): Promise<HydratedMissionContext> {
    // 业务输入重建（C5/G7 S3：仅 typed snapshot 单一真源）
    const snap = detail.configSnapshot as PlaygroundConfigSnapshot;
    const b = snap.businessInput;
    const input: RunMissionInput = {
      topic: snap.topic,
      description: b.description,
      depth: b.depth,
      language: snap.language as RunMissionInput["language"],
      budgetProfile: b.budgetProfile,
      styleProfile: b.styleProfile,
      lengthProfile: b.lengthProfile,
      audienceProfile: b.audienceProfile,
      withFigures: b.withFigures,
      auditLayers: b.auditLayers,
      concurrency: b.concurrency,
      viewMode: b.viewMode,
      searchTimeRange: b.searchTimeRange,
      knowledgeBaseIds: b.knowledgeBaseIds,
      inheritFromMissionId: b.inheritFromMissionId,
      maxCredits: snap.budget.maxCredits,
      budgetMultiplierOverride: snap.budget.budgetMultiplier,
      wallTimeCapMs: snap.runtimeLimits.wallTimeCapMs,
    };

    // reportArtifact 反序列化（zod 校验已由 parseReportArtifact 内部做）
    let reportArtifact: ReportArtifact | undefined;
    let report: ResearchReport | undefined;
    if (detail.reportFull) {
      if (detail.reportArtifactVersion === 2) {
        const parsed = parseReportArtifact(detail.reportFull);
        if (!parsed.ok) {
          // ★ E49 (2026-05-25): checkpoint 报告损坏不再裸抛 BadRequest（导致 rerun
          //   整体折返、用户卡死）。降级为"无既有报告"→ writer stage 会重新生成，
          //   其余 dimensions/input/themeSummary 仍复用。损坏 snapshot 自动回退到
          //   重跑报告，而非硬失败。
          this.log.warn(
            `[rerun] mission ${missionId} report_full 校验失败，降级重生成报告：${parsed.errorMessage}`,
          );
          reportArtifact = undefined;
        } else {
          reportArtifact = parsed.data as unknown as ReportArtifact;
        }
      } else {
        report = detail.reportFull as unknown as ResearchReport;
      }
    }

    const dimensions =
      (detail.dimensions as
        | NonNullable<MissionContext["plan"]>["dimensions"]
        | null) ?? [];
    const themeSummary = detail.themeSummary ?? "";

    // ★ 2026-05-30 单维度/中途重跑修复：leaderJournal.plan 是 plan() 阶段整份写盘的
    //   完整 LeaderPlanOutput（含 goals/initialRisks/qualityBar），而 mission 主行
    //   只有 themeSummary + dimensions（无 goals/initialRisks）。优先用 journal.plan
    //   还原完整 plan，让 buildSession 能回灌 leader.context.plan（解决 cascade 从 s3
    //   起 s2 不重跑 → leader.plan() 永不调用 → assessResearchers 撞 "must call plan()"）。
    //   legacy mission（journal 缺失）回落主行字段，goals/initialRisks 仍为 undefined。
    const journalPlan = (
      detail.leaderJournal as {
        plan?: {
          themeSummary?: string;
          dimensions?: NonNullable<MissionContext["plan"]>["dimensions"];
          goals?: NonNullable<MissionContext["plan"]>["goals"];
          initialRisks?: NonNullable<MissionContext["plan"]>["initialRisks"];
        };
      } | null
    )?.plan;

    type LeaderVerdict = "excellent" | "good" | "acceptable" | "failed";
    const leaderVerdict =
      (detail.leaderVerdict as LeaderVerdict | null) ?? null;

    const researcherResults = await this.hydrateResearcherResults(missionId);

    return {
      __hydrated: true,
      missionId,
      userId,
      input,
      t0: Date.now(),
      plan: {
        themeSummary: journalPlan?.themeSummary ?? themeSummary,
        dimensions: journalPlan?.dimensions ?? dimensions,
        goals: journalPlan?.goals as NonNullable<
          MissionContext["plan"]
        >["goals"],
        initialRisks: journalPlan?.initialRisks ?? [],
      },
      researcherResults,
      reconciliationReport:
        detail.reconciliationReport as MissionContext["reconciliationReport"],
      outlinePlan: detail.outlinePlan as MissionContext["outlinePlan"],
      analystOutput: detail.analystOutput,
      report,
      reportArtifact,
      reviewScore:
        typeof detail.finalScore === "number" ? detail.finalScore : undefined,
      verifierVerdicts: (detail.verdicts as unknown[] | null) ?? undefined,
      leaderSignOff:
        detail.leaderSigned !== null && leaderVerdict !== null
          ? {
              phase: "signoff",
              signed: detail.leaderSigned ?? false,
              leaderOverallScore: detail.leaderOverallScore ?? 0,
              leaderVerdict,
              accountabilityNote: "",
            }
          : undefined,
      trajectoryStored: detail.trajectoryStored ?? undefined,
    };
  }

  /** v1.2 类别 D1+D2：从子表重建 researcherResults */
  private async hydrateResearcherResults(
    missionId: string,
  ): Promise<MissionContext["researcherResults"]> {
    interface ResearchRow {
      dimension: string;
      findings: unknown;
      summary: string | null;
    }
    const rrRows = await this.prisma.$queryRawUnsafe<ResearchRow[]>(
      `SELECT DISTINCT ON (dimension) dimension, findings, summary
       FROM agent_playground_research_results
       WHERE mission_id = $1
       ORDER BY dimension, created_at DESC`,
      missionId,
    );
    if (rrRows.length === 0) return undefined;

    const cdRows = await this.prisma.agentPlaygroundChapterDraft.findMany({
      where: { missionId },
      orderBy: [{ dimension: "asc" }, { chapterIndex: "asc" }],
    });
    const cdByDim = new Map<string, typeof cdRows>();
    for (const cd of cdRows) {
      if (!cdByDim.has(cd.dimension)) cdByDim.set(cd.dimension, []);
      cdByDim.get(cd.dimension)!.push(cd);
    }

    return rrRows.map((rr) => {
      const findings = (rr.findings ?? []) as Array<{
        claim: string;
        evidence: string;
        source: string;
      }>;
      const chapters = cdByDim.get(rr.dimension) ?? [];
      const fullMarkdown =
        chapters.length > 0
          ? chapters.map((c) => `### ${c.heading}\n\n${c.content}`).join("\n\n")
          : undefined;
      return {
        dimension: rr.dimension,
        findings,
        summary: rr.summary ?? "",
        ...(fullMarkdown ? { fullMarkdown } : {}),
        ...(chapters.length > 0
          ? {
              chapters: chapters.map((c) => ({
                index: c.chapterIndex,
                heading: c.heading,
                body: c.content,
                wordCount: c.wordCount ?? 0,
              })),
            }
          : {}),
      };
    }) as MissionContext["researcherResults"];
  }
}
