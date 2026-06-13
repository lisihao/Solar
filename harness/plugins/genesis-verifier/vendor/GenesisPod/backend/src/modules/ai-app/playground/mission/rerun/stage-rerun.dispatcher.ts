/**
 * StageRerunDispatcher — playground 业务子类(继承
 * BusinessTeamStageRerunDispatcherFramework + 老路径 legacy dispatch 保留)
 *
 * 上游：docs/architecture/ai-harness/runner/per-task-rerun-with-cascade.md v1.2 §3.3
 *
 * 2026-05-24 P5 (Wave 1)：cascade 调度骨架（顺序执行 / emit lifecycle / best-effort
 * partial / mutable ctx 共享 / markStageProgress）已上提到 ai-harness/teams/business-team/
 * rerun/business-team-stage-rerun-dispatcher.framework。本类只剩 playground hook：
 *   - handlers Map：10 个 stage handler（8 个 real + s9b/s11 自定义）
 *   - computeChain: PLAYGROUND_PIPELINE.steps → computeCascadeChain
 *   - assertRerunable: 黑名单（s1-budget）+ dag.rerunable
 *   - buildStubs: 注入 store / reportEvaluation / runtimeBuilder / bindings / session
 *   - withCascadeScope: MissionContextStore.run(missionId, userId)
 *   - markStageProgress: store.markIntermediateState(lastCompletedStage)
 *   - eventTypes: playground.rerun:* 命名
 *
 *   保留：legacy dispatch(args) 老路径（v1.0 scope-based，仅 system:s9b 真实工作）
 */

import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { MissionContext as MissionContextStore } from "@/common/context/mission-context";
import {
  MissionStore,
  type PlaygroundTerminalExtra,
} from "../lifecycle/mission-store.service";
import {
  BusinessTeamStageRerunDispatcherFramework,
  MissionLifecycleManager,
  ReportEvaluationService,
  computeCascadeChain,
  type CascadeRunHooks,
  type StageRerunHandler,
} from "@/modules/ai-harness/facade";
import { normalizeMarkdownSlug } from "@/modules/ai-engine/facade";
import type { ChapterInput } from "@/modules/ai-harness/facade";
import type { LocalRerunInput } from "./local-rerun.service";
import type { HydratedMissionContext } from "./ctx-hydrator.service";
import type { EmitFn } from "../context/mission-deps";
import { PLAYGROUND_PIPELINE } from "../../runtime/playground.config";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import type { ReportArtifact } from "@/modules/ai-harness/facade";
import { LEADER_VERDICT_AUTO_RERUN_RECOVERED } from "../types/leader-verdict.types";
import {
  RerunMissionRuntimeBuilder,
  type RerunRuntimeSession,
} from "./rerun-runtime-builder.service";
import { MissionStageBindingsService } from "../pipeline/mission-stage-bindings.service";
import type { MissionContext } from "../context/mission-context";
import type { MissionDeps } from "../context/mission-deps";
import { runLeaderPlanStage } from "../pipeline/stages/s2-leader-plan-mission.stage";
import { runResearcherDispatchStage } from "../pipeline/stages/s3-researcher-collect-findings.stage";
import { runLeaderAssessResearchStage } from "../pipeline/stages/s4-leader-assess-research.stage";
import { runReconcilerStage } from "../pipeline/stages/s5-reconciler-cross-dim-fact-check.stage";
import { runAnalystStage } from "../pipeline/stages/s6-analyst-synthesize-insights.stage";
import { runWriterOutlineStage } from "../pipeline/stages/s7-writer-plan-outline.stage";
import { runWriterStage } from "../pipeline/stages/s8-writer-draft-report.stage";
import { runSectionQualityEnhancementStage } from "../pipeline/stages/s8b-section-quality-enhancement.stage";
import { runCriticStage } from "../pipeline/stages/s9-reviewer-critic-l4.stage";
import { runLeaderForewordAndSignoffStage } from "../pipeline/stages/s10-leader-foreword-and-signoff.stage";

export { LEADER_VERDICT_AUTO_RERUN_RECOVERED };

/** v1.2 §3.4: 黑名单 — 只拦"语义上不应重跑"的 stage（其它按 dag.rerunable 判断）。 */
const STAGE_RERUN_BLACKLIST = new Set<string>(["s1-budget"]);

export interface DispatchArgs {
  ctx: HydratedMissionContext;
  input: LocalRerunInput;
  emit: EmitFn;
}

export interface StageRerunStubs {
  readonly store: MissionStore;
  readonly reportEvaluation: ReportEvaluationService;
  readonly log: Logger;
  readonly runtimeBuilder?: RerunMissionRuntimeBuilder;
  readonly bindings?: MissionStageBindingsService;
  readonly session?: RerunRuntimeSession;
  readonly lifecycleManager: MissionLifecycleManager;
}

export type PlaygroundStageRerunHandler = StageRerunHandler<
  HydratedMissionContext,
  StageRerunStubs,
  EmitFn
>;

export interface RunFromStageArgs {
  ctx: HydratedMissionContext;
  fromStepId: string;
  emit: EmitFn;
}

export interface RunFromStageResult {
  readonly completed: string[];
  readonly abortedAt?: string;
  readonly errorMessage?: string;
  readonly remaining?: string[];
}

@Injectable()
export class StageRerunDispatcher extends BusinessTeamStageRerunDispatcherFramework<
  HydratedMissionContext,
  StageRerunStubs,
  EmitFn
> {
  private readonly playgroundHandlers = new Map<
    string,
    PlaygroundStageRerunHandler
  >();

  constructor(
    private readonly store: MissionStore,
    private readonly reportEvaluation: ReportEvaluationService,
    private readonly prisma: PrismaService,
    private readonly runtimeBuilder: RerunMissionRuntimeBuilder,
    private readonly bindings: MissionStageBindingsService,
    private readonly lifecycleManager: MissionLifecycleManager,
  ) {
    const handlers = new Map<string, PlaygroundStageRerunHandler>();
    const dispatcherLog = new Logger("playground-stage-rerun-dispatcher");
    // Hooks 构造在 super 之前需要：先建出空 Map，super 后再填，handlers 引用同对象。
    const hooks: CascadeRunHooks<
      HydratedMissionContext,
      StageRerunStubs,
      EmitFn
    > = {
      handlers,
      computeChain: (fromStepId) =>
        computeCascadeChain(PLAYGROUND_PIPELINE.steps, fromStepId),
      assertRerunable: (stepId) => {
        if (STAGE_RERUN_BLACKLIST.has(stepId)) {
          return { rerunable: false, reason: `${stepId} 不可重跑（黑名单）` };
        }
        const step = PLAYGROUND_PIPELINE.steps.find((s) => s.id === stepId);
        if (!step) {
          return { rerunable: false, reason: `unknown step: ${stepId}` };
        }
        if (!step.dag?.rerunable) {
          return {
            rerunable: false,
            reason: `stage ${stepId} 不可重跑${step.dag?.rerunableReason ? `：${step.dag.rerunableReason}` : ""}`,
          };
        }
        return { rerunable: true };
      },
      buildStubs: (ctx) => ({
        store: this.store,
        reportEvaluation: this.reportEvaluation,
        log: dispatcherLog,
        runtimeBuilder: this.runtimeBuilder,
        bindings: this.bindings,
        session: this.runtimeBuilder.startSession(ctx),
        lifecycleManager: this.lifecycleManager,
      }),
      cleanupStubs: (stubs) => {
        // ★ try/finally 保证 abortRegistry 不泄露（与原 dispatcher 一致）
        if (stubs.session) {
          try {
            stubs.session.cleanup();
          } catch (err) {
            dispatcherLog.warn(
              `[cascade] session.cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      },
      eventTypes: {
        stageStarted: "playground.rerun:stage-started",
        cascadeAborted: "playground.rerun:cascade-aborted",
      },
      forwardEmit: async (rawEmit, ctx, event) => {
        // playground EmitFn 必带 missionId/userId；从 ctx 取出包装
        await rawEmit({
          type: event.type,
          missionId: ctx.missionId,
          userId: ctx.userId,
          payload: event.payload as Record<string, unknown>,
        });
      },
      markStageProgress: async (ctx, stepId, _completed) => {
        await this.store.markIntermediateState(
          ctx.missionId,
          { lastCompletedStage: this.stepIndexOf(stepId) },
          ctx.userId,
        );
      },
      log: dispatcherLog,
      withCascadeScope: <T>(
        ctx: HydratedMissionContext,
        fn: () => Promise<T>,
      ): Promise<T> =>
        MissionContextStore.run(
          {
            missionId: ctx.missionId,
            userId: ctx.userId,
          },
          fn,
        ),
    };
    super(hooks);
    this.playgroundHandlers = handlers;

    // ── 构造期注册 handlers（与原 dispatcher 一致）──
    this.playgroundHandlers.set(
      "s9b-objective-eval",
      this.handleS9bObjectiveEval,
    );
    this.playgroundHandlers.set("s11-persist", this.handleS11Persist);
    this.playgroundHandlers.set(
      "s2-leader-plan",
      this.makeStageHandler(runLeaderPlanStage),
    );
    this.playgroundHandlers.set(
      "s3-researcher-collect",
      this.makeStageHandler(runResearcherDispatchStage),
    );
    this.playgroundHandlers.set(
      "s4-leader-assess",
      this.makeStageHandler(runLeaderAssessResearchStage),
    );
    this.playgroundHandlers.set(
      "s5-reconciler",
      this.makeStageHandler(runReconcilerStage),
    );
    this.playgroundHandlers.set("s6-analyst", this.makeS6Handler());
    this.playgroundHandlers.set(
      "s7-writer-outline",
      this.makeStageHandler(runWriterOutlineStage),
    );
    this.playgroundHandlers.set("s8-writer", this.makeS8Handler());
    this.playgroundHandlers.set(
      "s8b-quality-enhancement",
      this.makeStageHandler(runSectionQualityEnhancementStage),
    );
    this.playgroundHandlers.set(
      "s9-critic",
      this.makeStageHandler(runCriticStage),
    );
    this.playgroundHandlers.set(
      "s10-leader-foreword-signoff",
      this.makeStageHandler(runLeaderForewordAndSignoffStage),
    );
    // 构造期 invariant：dag.rerunable=true 的 stage 必须有 handler 注册
    for (const step of PLAYGROUND_PIPELINE.steps) {
      if (step.dag?.rerunable && !this.playgroundHandlers.has(step.id)) {
        throw new Error(
          `[StageRerunDispatcher boot] step ${step.id} dag.rerunable=true 但未注册 handler — ` +
            `请在 dispatcher constructor 加 handlers.set("${step.id}", ...)`,
        );
      }
    }
  }

  /** v1.0 legacy 路径：按 input.scope / todoId 路由（保留兼容） */
  async dispatch(args: DispatchArgs): Promise<void> {
    const { input, ctx, emit } = args;
    const { scope, todoId } = input;
    if (scope === "system" && todoId.endsWith("s9b-objective-evaluation")) {
      const stubs: StageRerunStubs = {
        store: this.store,
        reportEvaluation: this.reportEvaluation,
        log: new Logger("playground-stage-rerun-dispatcher"),
        lifecycleManager: this.lifecycleManager,
      };
      const handler = this.playgroundHandlers.get("s9b-objective-eval");
      if (!handler) {
        throw new BadRequestException(
          "s9b-objective-eval handler 未注册（构造期 bug）",
        );
      }
      await handler(ctx, emit, stubs);
      return;
    }
    throw new BadRequestException(
      `局部重跑暂未实现该 scope: ${scope} (todoId=${todoId})。` +
        `当前 v1 仅支持 "10 维客观评审"局部重跑（system:s9b）。` +
        `其它任务请用"开新研究对比"按钮（创建新 mission 跑全流程，原 mission 保留）。`,
    );
  }

  /** v1.2 PR-R5 新路径：按 stepId 直接路由 + cascade（透传 framework） */
  async runFromStageWithCascade(
    args: RunFromStageArgs,
  ): Promise<RunFromStageResult> {
    // framework 提供 cascade 调度骨架（带 withCascadeScope 自动包 MissionContextStore）
    return super["runFromStageWithCascade"](args);
  }

  // ────────────────────────── helpers ──────────────────────────

  private stepIndexOf(stepId: string): number {
    const idx = PLAYGROUND_PIPELINE.steps.findIndex((s) => s.id === stepId);
    if (idx === -1) {
      throw new Error(`step ${stepId} not in PLAYGROUND_PIPELINE`);
    }
    return idx;
  }

  // ────────────────────────── handlers ──────────────────────────

  private makeStageHandler(
    runStage: (ctx: MissionContext, deps: MissionDeps) => Promise<void>,
  ): PlaygroundStageRerunHandler {
    return async (ctx, _emit, stubs): Promise<HydratedMissionContext> => {
      if (!stubs.runtimeBuilder || !stubs.bindings || !stubs.session) {
        throw new BadRequestException(
          "[PR-R5b-FULL] stage handler 缺 runtimeBuilder/bindings/session — " +
            "本路径需经 runFromStageWithCascade 调用，不能走 legacy dispatch()",
        );
      }
      const composed = stubs.runtimeBuilder.composeMissionContext(
        ctx,
        stubs.session,
      );
      const deps = stubs.bindings.buildDeps();
      await runStage(composed, deps);
      return stubs.runtimeBuilder.writeBackToHydrated(composed, ctx);
    };
  }

  private makeS6Handler(): PlaygroundStageRerunHandler {
    return async (ctx, _emit, stubs): Promise<HydratedMissionContext> => {
      if (!stubs.runtimeBuilder || !stubs.bindings || !stubs.session) {
        throw new BadRequestException(
          "[PR-R5b-FULL] s6 handler 缺 runtimeBuilder/bindings/session",
        );
      }
      const composed = stubs.runtimeBuilder.composeMissionContext(
        ctx,
        stubs.session,
      );
      const deps = stubs.bindings.buildDeps();
      const out = await runAnalystStage(composed, deps);
      composed.analystOutput = out;
      return stubs.runtimeBuilder.writeBackToHydrated(composed, ctx);
    };
  }

  private makeS8Handler(): PlaygroundStageRerunHandler {
    return async (ctx, _emit, stubs): Promise<HydratedMissionContext> => {
      if (!stubs.runtimeBuilder || !stubs.bindings || !stubs.session) {
        throw new BadRequestException(
          "[PR-R5b-FULL] s8 handler 缺 runtimeBuilder/bindings/session",
        );
      }
      const composed = stubs.runtimeBuilder.composeMissionContext(
        ctx,
        stubs.session,
      );
      const deps = stubs.bindings.buildDeps();
      const analystRaw = composed.analystOutput as
        | {
            insights?: unknown[];
            themeSummary?: string;
            contradictions?: unknown[];
            foresight?: unknown;
          }
        | undefined;
      const analyst = analystRaw ?? {
        insights: [],
        themeSummary: composed.plan?.themeSummary ?? "",
      };
      await runWriterStage(
        composed,
        deps,
        {
          insights: analyst.insights ?? [],
          themeSummary: analyst.themeSummary ?? "",
          contradictions: analyst.contradictions,
          // ★ Foresight L1：透传到 Outlook 章节 + 未来推演卡片
          foresight: (analyst as { foresight?: unknown }).foresight,
        },
        undefined,
      );
      return stubs.runtimeBuilder.writeBackToHydrated(composed, ctx);
    };
  }

  /** S9B — 10 维客观评审局部重跑（v1 真实实现，业务专属保留） */
  private handleS9bObjectiveEval: PlaygroundStageRerunHandler = async (
    ctx,
    emit,
    stubs,
  ) => {
    if (!ctx.reportArtifact) {
      throw new BadRequestException(
        "原 mission 缺 reportArtifact (v2)，无法跑 10 维评审局部重跑",
      );
    }
    const reportArtifact = ctx.reportArtifact;
    if (reportArtifact.sections.length === 0) {
      throw new BadRequestException("reportArtifact 无 section，跳过");
    }

    await emit({
      type: "playground.agent:narrative",
      missionId: ctx.missionId,
      userId: ctx.userId,
      payload: {
        stage: "rerun-s9b",
        role: "critic",
        tag: "judging",
        text: `局部重跑 10 维客观评审：${reportArtifact.sections.length} 个章节`,
        agentId: "critic",
      },
    }).catch((err: unknown) => {
      stubs.log.warn(
        `[s9b-rerun ${ctx.missionId}] emit agent:narrative (judging) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    const language = ctx.input.language?.startsWith("en") ? "en" : "zh";
    const topicType =
      typeof (ctx.input as { topicType?: string }).topicType === "string"
        ? (ctx.input as { topicType?: string }).topicType!
        : "GENERIC";

    const fullMarkdown = reportArtifact.content.fullMarkdown;
    const chapters: ChapterInput[] = reportArtifact.sections
      .map((s) => {
        const body = fullMarkdown.slice(s.startOffset, s.endOffset);
        return { section: s, body };
      })
      .filter(({ body }) => body && body.length >= 200)
      .map(({ section, body }) => ({
        chapterId: section.id,
        chapterTitle: section.title,
        writerModel: reportArtifact.metadata.modelTrail?.[0] ?? "unknown",
        content: body,
        sourcesUsed: section.citations?.length ?? 0,
      }));

    if (chapters.length === 0) {
      throw new BadRequestException(
        "所有 section body 都过短（< 200 字），无可评审章节",
      );
    }

    const result = await stubs.reportEvaluation.evaluateReport({
      reportTitle: reportArtifact.metadata.topic ?? ctx.input.topic,
      topicType,
      chapters,
      language,
    });

    reportArtifact.metadata.pipelineEvaluation = result;
    const warningIdx = reportArtifact.quality.warnings.findIndex(
      (w) => w.dimension === "objective_evaluation",
    );
    const warning = {
      dimension: "objective_evaluation" as const,
      message: `10 维客观评分（已重跑）：${result.overallScore}/100 (${result.grade})；${result.feedback}`,
    };
    if (warningIdx >= 0) {
      reportArtifact.quality.warnings[warningIdx] = warning;
    } else {
      reportArtifact.quality.warnings.push(warning);
    }

    await stubs.store.markRerunPatch(
      ctx.missionId,
      {
        reportFull: reportArtifact as unknown as Record<string, unknown>,
        reportArtifactVersion: 2,
      },
      ctx.userId,
    );

    await emit({
      type: "playground.agent:narrative",
      missionId: ctx.missionId,
      userId: ctx.userId,
      payload: {
        stage: "rerun-s9b",
        role: "critic",
        tag: "success",
        text: `局部重跑完成：${result.overallScore}/100 (${result.grade})`,
        agentId: "critic",
      },
    }).catch((err: unknown) => {
      stubs.log.warn(
        `[s9b-rerun ${ctx.missionId}] emit agent:narrative (success) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    stubs.log.log(
      `[s9b-rerun ${ctx.missionId}] new score=${result.overallScore} grade=${result.grade}`,
    );
  };

  /** S11 — Persist 局部重跑（c195035f 类 fallback） */
  private handleS11Persist: PlaygroundStageRerunHandler = async (
    ctx,
    emit,
    stubs,
  ) => {
    await emit({
      type: "playground.agent:narrative",
      missionId: ctx.missionId,
      userId: ctx.userId,
      payload: {
        stage: "rerun-s11",
        role: "system",
        tag: "persisting",
        text: "S11 持久化重跑：将已有产物写入 mission 行（rerun 模式 bypass content guard）",
        agentId: "system",
      },
    }).catch((err: unknown) => {
      stubs.log.warn(
        `[s11-rerun ${ctx.missionId}] emit agent:narrative (persisting) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    let reportArtifact: ReportArtifact | undefined = ctx.reportArtifact;
    let recovered = false;
    if (!reportArtifact) {
      reportArtifact = await this.rebuildArtifactFromDrafts(ctx);
      recovered = true;
    }
    if (!reportArtifact) {
      throw new BadRequestException(
        `无法重跑 S11 持久化 [missionId=${ctx.missionId}, userId=${ctx.userId}]：` +
          "mission 既无 reportArtifact（v2 装配产物）又无 chapter_drafts 表数据。" +
          "建议用'开新研究对比'按钮重跑全流程。",
      );
    }

    const detail = await stubs.store.getById(ctx.missionId, ctx.userId);
    if (!detail) {
      throw new BadRequestException(
        `mission ${ctx.missionId} 不存在或非 owner [userId=${ctx.userId}]`,
      );
    }

    const reportPayload = {
      ...(reportArtifact as unknown as Record<string, unknown>),
      title: reportArtifact.metadata?.topic ?? ctx.input.topic,
      summary:
        reportArtifact.quickView?.executiveSummary?.markdown ??
        `局部重跑入库恢复（${recovered ? "从 chapter_drafts 重建" : "用 ctx 已有产物"}）`,
    };

    const leaderVerdict =
      typeof detail.leaderVerdict === "string" &&
      detail.leaderVerdict.length > 0
        ? detail.leaderVerdict
        : LEADER_VERDICT_AUTO_RERUN_RECOVERED;

    const rerunWallTimeMs = Math.max(0, Date.now() - (ctx.t0 ?? Date.now()));
    await stubs.lifecycleManager.finalize<PlaygroundTerminalExtra>({
      missionId: ctx.missionId,
      intent: {
        status: "completed",
        extra: {
          kind: "completed",
          detail: {
            report: reportPayload as unknown as {
              title?: string;
              summary?: string;
            },
            reportArtifactVersion: 2,
            finalScore: reportArtifact.quality?.overall ?? 70,
            elapsedWallTimeMs: rerunWallTimeMs,
            themeSummary:
              typeof detail.themeSummary === "string"
                ? detail.themeSummary
                : undefined,
            dimensions: detail.dimensions as never,
            verdicts: detail.verdicts as never,
            reconciliationReport: detail.reconciliationReport as never,
            leaderJournal: detail.leaderJournal as never,
            leaderOverallScore:
              typeof detail.leaderOverallScore === "number"
                ? detail.leaderOverallScore
                : undefined,
            leaderSigned:
              typeof detail.leaderSigned === "boolean"
                ? detail.leaderSigned
                : undefined,
            leaderVerdict,
            tokensUsed:
              typeof detail.tokensUsed === "number" ? detail.tokensUsed : 0,
            costUsd: typeof detail.costUsd === "number" ? detail.costUsd : 0,
          },
          userId: ctx.userId,
        },
      },
      arbiter: stubs.store,
    });

    await stubs.store
      .saveReportVersion({
        missionId: ctx.missionId,
        triggerType: "todo-rerun",
        report: reportPayload as { title?: string; summary?: string },
        finalScore: reportArtifact.quality?.overall ?? 70,
        leaderSigned:
          typeof detail.leaderSigned === "boolean"
            ? detail.leaderSigned
            : undefined,
      })
      .catch((err: unknown) => {
        stubs.log.warn(
          `[s11-rerun ${ctx.missionId}] saveReportVersion failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    await emit({
      type: "playground.mission:completed",
      missionId: ctx.missionId,
      userId: ctx.userId,
      payload: {
        reviewScore: reportArtifact.quality?.overall ?? 70,
        leaderSigned: detail.leaderSigned,
        leaderOverallScore: detail.leaderOverallScore,
        rerunRecovered: recovered,
        rerunSource: recovered ? "chapter_drafts" : "ctx_artifact",
        // 通用通知 adapter 所需业务细节（emit 侧注入）
        missionTitle: reportPayload?.title,
        appBasePath: "/agent-playground",
        relatedType: "playground-mission",
      },
    }).catch((err: unknown) => {
      stubs.log.warn(
        `[s11-rerun ${ctx.missionId}] emit mission:completed failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    stubs.log.log(
      `[s11-rerun ${ctx.missionId}] finalize(completed) ok (recovered=${recovered}, sections=${reportArtifact.sections?.length ?? 0})`,
    );
  };

  /** 从 chapter_drafts 表重建 reportArtifact —— c195035f 类 fallback 路径 */
  private async rebuildArtifactFromDrafts(
    ctx: HydratedMissionContext,
  ): Promise<ReportArtifact | undefined> {
    const drafts = await this.prisma.agentPlaygroundChapterDraft.findMany({
      where: {
        missionId: ctx.missionId,
        status: { in: ["passed", "done", "failed-finalized"] },
      },
      orderBy: [{ dimension: "asc" }, { chapterIndex: "asc" }],
    });
    if (drafts.length === 0) return undefined;

    const parts: string[] = [`# ${ctx.input.topic}\n\n`];
    const sections: ReportArtifact["sections"] = [];
    let offset = parts[0].length;
    let i = 0;
    for (const d of drafts) {
      const heading = `## ${d.heading}\n\n`;
      const body = `${d.content}\n\n`;
      const startOffset = offset;
      const endOffset = offset + heading.length + body.length;
      sections.push({
        id: `s${i++}`,
        type: "dimension" as const,
        level: 2,
        title: d.heading,
        anchor: normalizeMarkdownSlug(d.heading).slice(0, 80),
        startOffset,
        endOffset,
        wordCount: d.wordCount ?? Math.floor(d.content.length / 5),
        readingTimeMinutes: Math.ceil(
          (d.wordCount ?? d.content.length / 5) / 200,
        ),
        citations: [],
        figureIds: [],
        factIds: [],
        sourceDimensionId: d.dimension,
      });
      parts.push(heading, body);
      offset = endOffset;
    }
    const fullMarkdown = parts.join("");

    return {
      sections,
      content: {
        fullMarkdown,
        fullReportSize: Buffer.byteLength(fullMarkdown, "utf8"),
      },
      citations: [],
      figures: [],
      quality: {
        overall: 65,
        dimensions: {} as never,
        hardGateViolations: [],
        warnings: [
          {
            dimension: "rerun_recovered",
            message:
              "本报告通过 chapter_drafts 表重建（原 reportArtifact 未落库）。装配级元数据（quickView / citations / figures）缺失。",
          },
        ],
        qualityTrace: [],
        finalVerdict: "acceptable",
        recoveryDegraded: true,
      },
      metadata: {
        topic: ctx.input.topic,
        generatedAt: new Date().toISOString(),
        generationTimeMs: 0,
        recoveryMode: "chapter_drafts_rebuild",
        version: 2,
        isIncremental: true,
        dimensionCount: new Set(drafts.map((d) => d.dimension)).size,
        sourceCount: 0,
        factCount: 0,
        figureCount: 0,
        wordCount: drafts.reduce(
          (s, d) => s + (d.wordCount ?? Math.floor(d.content.length / 5)),
          0,
        ),
        readingTimeMinutes: 0,
        styleProfile: ctx.input.styleProfile ?? "executive",
        lengthProfile: ctx.input.lengthProfile ?? "standard",
        audienceProfile: ctx.input.audienceProfile ?? "domain-expert",
        language: ctx.input.language ?? "zh-CN",
        searchTimeRange: ctx.input.searchTimeRange ?? "365d",
        totalTokens: { prompt: 0, completion: 0, total: 0 },
        costCents: 0,
        modelTrail: [],
      },
      quickView: {
        executiveSummary: {
          markdown: `（局部重跑入库恢复模式：${drafts.length} 章节从 chapter_drafts 表重建）`,
          wordCount: 30,
        },
        topHighlights: [],
        topTrends: [],
        keyRisks: [],
        topRecommendations: [],
        keyCitations: [],
        keyFigures: [],
        estimatedReadingTime: 0,
        whatYouWillLearn: [],
      },
      factTable: [],
    } as unknown as ReportArtifact;
  }
}

// Legacy type alias（spec / 调用方 import 兼容）
export type StageRerunHandler_Playground = PlaygroundStageRerunHandler;
