/**
 * MissionDeps —— stage 函数所需的依赖包（按 phase 拆类型）
 *
 * 由 trunk team.mission.ts 在 runMission 入口装配一次，然后传给每个 stage 函数。
 *
 * 类型分组（PR-7a 2026-05-04 standardize playground）:
 *   • CommonDeps        ← 所有 stage 都用（invoker / store / abort / runner / eventBus / log / emit / lifecycle / runtimeEnv / credits / missionState）
 *   • PlanDeps          ← s1/s2 用（leader + steward）
 *   • ResearchDeps      ← s3/s4 用（leader + writer + reviewer + figureExtractor + figureRelevance）
 *   • SynthesisDeps     ← s5/s6 用（reconciler + analyst）
 *   • WriterDeps        ← s7/s8/s8b 用（writer + reviewer + verifier + judge + indexer + reportAssembler + sectionSelfEval + sectionRemediation）
 *   • QualityDeps       ← s9/s9b 用（reportEvaluation + qualityTraceCompute）
 *   • SignoffDeps       ← s10 用（leader + reviewer）
 *   • PersistDeps       ← s11/s12 用（failureLearner + postmortemClassifier）
 *
 * MissionDeps 仍为单一合成 type，stage 当前签名收完整 deps；后续 PR-7b 逐 stage
 * 改窄签名（如 runResearcherDispatchStage 改收 ResearchDeps），让 reader 看签名
 * 就知道 stage 调用了哪些下层服务。
 */

import type { Logger } from "@nestjs/common";
import type {
  AgentInvoker,
  LeaderService,
  ReconcilerService,
  AnalystService,
  WriterService,
  ReviewerService,
  VerifierService,
  StewardService,
} from "../roles";
import type { MissionStore } from "../lifecycle/mission-store.service";
import type { HandoffCompactorService } from "@/modules/ai-harness/facade";
import type { MissionAbortRegistry } from "@/modules/ai-harness/facade";
import type {
  ReportArtifactAssembler,
  FailureLearnerService,
} from "@/modules/ai-harness/facade";
import type {
  AgentRunner,
  JudgeService,
  MemoryAutoIndexer,
  EventBus,
  FigureRelevanceService,
  SectionSelfEvalService,
  SectionRemediationService,
  ReportEvaluationService,
  QualityTraceComputeService,
} from "@/modules/ai-harness/facade";
import type { FigureExtractorService } from "@/modules/ai-engine/facade";
import type { CreditsService } from "../../../../platform/credits/credits.service";
import type { RuntimeEnvironmentService } from "@/modules/ai-harness/facade";
import type { PostmortemClassifierService } from "@/modules/ai-harness/facade";
import type { MissionLifecycleManager } from "@/modules/ai-harness/facade";

/** 通用 emit / lifecycle 签名 — 上提到 ai-harness/protocols/ipc/stage-emit.utils */
import type { EmitFn, LifecycleFn } from "@/modules/ai-harness/facade";
export type { EmitFn, LifecycleFn };

// ─── Phase 0: CommonDeps（每个 stage 都注入）─────────────────────────
export interface CommonDeps {
  readonly invoker: AgentInvoker;
  readonly store: MissionStore;
  // ★ C0/G1：终态写唯一入口。stage（如 s11-persist）经 finalize 提交终态意图，
  //   由 arbiter=store 单点条件写仲裁，不直调 store 终态写。
  readonly lifecycleManager: MissionLifecycleManager;
  readonly missionState: HandoffCompactorService;
  readonly abortRegistry: MissionAbortRegistry;
  readonly runner: AgentRunner;
  readonly eventBus: EventBus;
  readonly credits: CreditsService;
  readonly runtimeEnv: RuntimeEnvironmentService;
  readonly log: Logger;
  readonly emit: EmitFn;
  readonly lifecycle: LifecycleFn;
  /**
   * ★ 2026-05-06 (A-6): stage 软失败上报 API。stage 内部 catch 不阻断 mission 时
   * 必须调用此函数让 orchestrator + 前端看到。禁止 log.warn 后静默 swallow（这是
   * "软失败盲区"的主要源头：mission 跑完但报告质量已 degraded，用户看不到）。
   *
   * 用法（stage 文件需显式传 stepId，与 PLAYGROUND_PIPELINE.steps[i].id 一致）：
   *   try { await reviewer.criticL4(...); }
   *   catch (err) {
   *     await deps.markStageDegraded(missionId, userId, "s9-critic",
   *       "L4 critic 失败但不阻断 mission：" + err.message);
   *   }
   */
  readonly markStageDegraded: (
    missionId: string,
    userId: string,
    stepId: string,
    reason: string,
  ) => Promise<void>;
  /**
   * ★ #37 (2026-05-23): S3 迭代级 checkpoint 钩子。
   * 每个维度完成后由 S3 调用，将该维度结果持久化进 crossState + checkpoint。
   * fire-and-forget：保存失败不阻塞 mission（best-effort 幂等性）。
   * 由 dispatcher 注入，在 MissionDeps 为 optional 以保持向后兼容（spec/test 无需提供）。
   */
  readonly checkpointDimension?: (
    missionId: string,
    dimId: string,
    dimResult: unknown,
  ) => Promise<void>;
}

// ─── Phase 1: Plan（s1/s2）──────────────────────────────────────────
export interface PlanDeps extends CommonDeps {
  readonly leader: LeaderService;
  readonly steward: StewardService;
}

// ─── Phase 2: Research（s3/s4）──────────────────────────────────────
//   per-dim-pipeline 调 writer.planDimensionOutline + reviewer.judgeDimension
export interface ResearchDeps extends CommonDeps {
  readonly leader: LeaderService;
  readonly writer: WriterService;
  readonly reviewer: ReviewerService;
  readonly figureExtractor: FigureExtractorService;
  readonly figureRelevance: FigureRelevanceService;
}

// ─── Phase 3: Synthesis（s5/s6）─────────────────────────────────────
export interface SynthesisDeps extends CommonDeps {
  readonly reconciler: ReconcilerService;
  readonly analyst: AnalystService;
}

// ─── Phase 4: Writer（s7/s8/s8b）────────────────────────────────────
export interface WriterDeps extends CommonDeps {
  readonly writer: WriterService;
  readonly reviewer: ReviewerService;
  readonly verifier: VerifierService;
  readonly judge: JudgeService;
  readonly indexer: MemoryAutoIndexer;
  readonly reportAssembler: ReportArtifactAssembler;
  readonly sectionSelfEval: SectionSelfEvalService;
  readonly sectionRemediation: SectionRemediationService;
}

// ─── Phase 5: Quality（s9/s9b）──────────────────────────────────────
export interface QualityDeps extends CommonDeps {
  readonly reviewer: ReviewerService;
  readonly reportEvaluation: ReportEvaluationService;
  readonly qualityTraceCompute: QualityTraceComputeService;
}

// ─── Phase 6: Signoff（s10）─────────────────────────────────────────
export interface SignoffDeps extends CommonDeps {
  readonly leader: LeaderService;
  readonly reviewer: ReviewerService;
}

// ─── Phase 7: Persist（s11/s12）─────────────────────────────────────
export interface PersistDeps extends CommonDeps {
  readonly failureLearner: FailureLearnerService;
  readonly postmortemClassifier: PostmortemClassifierService;
}

/**
 * MissionDeps —— 完整合成类型（trunk + buildStageDeps + 所有 stage 函数当前签名都用这个）。
 *
 * PR-7b（W22 主线波次）将逐 stage 改成更窄签名（如 runResearcherDispatchStage(ctx, deps: ResearchDeps)），
 * 让 reader 看签名就知道 stage 调用了哪些下层服务。
 */
export interface MissionDeps
  extends
    CommonDeps,
    PlanDeps,
    ResearchDeps,
    SynthesisDeps,
    WriterDeps,
    QualityDeps,
    SignoffDeps,
    PersistDeps {}
