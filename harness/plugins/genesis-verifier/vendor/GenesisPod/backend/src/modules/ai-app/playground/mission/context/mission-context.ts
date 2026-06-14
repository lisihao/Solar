/**
 * MissionContext —— 跨 stage 共享的可变状态包（按 phase 拆类型）
 *
 * runMission() 主剧本在装配阶段构造一个 MissionContext，每个 stage 函数读取
 * 之前 stage 的产物 + 写入自己的产物到 ctx，最后由 persist stage 落盘 + 返回。
 *
 * 设计决策 (Phase Lead-Stages):
 *   • ctx 是 mutable —— stage 通过 ctx.X = ... 写产物，不返回独立结构
 *   • readonly 字段在装配后不可变（mission lifetime 不变量）
 *   • 可变字段为 optional —— 表示"尚未到达该 stage"
 *   • 不放 mission 自身（leader/billing/pool/abortRegistry 等基础设施）—— 那些是 dep
 *
 * 类型分组（PR-7a 2026-05-04 standardize playground）:
 *   • MissionInvariants  ←  装配后不变（s1 之前确定）
 *   • PlanPhaseCtx       ←  s2 写入 plan
 *   • ResearchPhaseCtx   ←  s3/s4 写入 researcherResults + s4Patch*
 *   • SynthesisPhaseCtx  ←  s5/s6 写入 reconciliationReport + analystOutput
 *   • WriterPhaseCtx     ←  s7/s8/s8b 写入 outline + report + reportArtifact + reviewScore + verifierVerdicts
 *   • QualityPhaseCtx    ←  s9b 写入 reportEvaluation + qualityTraceCtx
 *   • SignoffPhaseCtx    ←  s10 写入 leaderForeword + leaderSignOff
 *   • PersistPhaseCtx    ←  s11 写入 trajectoryStored
 *
 * MissionContext 仍为单一合成 type，stage 当前签名读完整 ctx；后续 PR-7b 逐 stage
 * 改窄签名，让函数显式表达消费/生产哪个 phase。
 *
 * 用法（当前）:
 *   const ctx = stageBindings.buildCtx({...});
 *   await runLeaderPlanStage(ctx, deps);
 *   await runResearcherDispatchStage(ctx, deps);
 *   // ...
 *   return await runPersistStage(ctx, deps);
 */

import type { SupervisedMission } from "../roles";
import type {
  LeaderForewordOutput,
  LeaderPlanOutput,
  LeaderSignoffOutput,
} from "../agents/leader/leader.agent";
import type { MissionBudgetPool } from "@/modules/ai-harness/facade";
import type { ReportArtifact } from "@/modules/ai-harness/facade";
import type {
  RunMissionInput,
  ResearchReport,
} from "../../api/dto/run-mission.dto";
import type { BillingRuntimeEnvAdapter } from "@/modules/ai-harness/facade";
import type { QualityTraceContext } from "@/modules/ai-harness/facade";

// ─── Phase 0: Invariants（s1 装配后不变）────────────────────────────────
export interface MissionInvariants {
  readonly missionId: string;
  readonly userId: string;
  readonly input: RunMissionInput;
  readonly t0: number;

  // 基础设施 dep（mission 内长生命周期）
  readonly billing: BillingRuntimeEnvAdapter;
  readonly pool: MissionBudgetPool;
  readonly leader: SupervisedMission;
  readonly budgetMultiplier: number;
}

// ─── Phase 1: Plan（s2 leader-plan 产物）───────────────────────────────
export interface PlanPhaseCtx {
  /** s2-leader-plan-mission.stage.ts */
  plan?: {
    themeSummary: string;
    dimensions: {
      id: string;
      name: string;
      rationale: string;
      toolHint?: {
        categories: string[];
        preferIds?: string[];
      };
      dependsOn?: string[];
    }[];
    goals: LeaderPlanOutput["goals"];
    initialRisks: LeaderPlanOutput["initialRisks"];
  };
}

// ─── Phase 2: Research（s3 researcher dispatch + s4 leader assess）──
export interface ResearchPhaseCtx {
  /** s3-researcher-collect-findings.stage.ts */
  researcherResults?: {
    dimension: string;
    findings: { claim: string; evidence: string; source: string }[];
    summary: string;
    figureCandidates?: unknown[];
  }[];

  /**
   * ★ P0-5 (2026-04-29): S4 patch 轮次计数 —— 防止 stage 被反复重入导致 wall-time 爆炸。
   * 每进入一次 dispatchAssessActions（patch/redirect 决策）+1，第二轮起强制降级 retry 为 accept-degraded。
   */
  s4PatchRound?: number;

  /**
   * ★ P0-LIVE-PATCH-SILENT (2026-04-30): S4 dispatch 失败的 retry job 真因记录。
   * 之前 dispatchAssessActions 内 DAGExecutor catch 静默 swallow，patch 失败完全
   * 不上报 → mission 主流程不知道 Leader 觉得"必须 patch"的 dim 实际没补到。
   * 现在显式落到 ctx：S4 失败一次 push 一条；下游 S10 leader signoff 必须读这个
   * 字段，patchFailures.length > 0 时强制 mission 至少 quality-degraded。
   */
  s4PatchFailures?: {
    dimensionId: string;
    dimensionName: string;
    retryLabel: string;
    reason: string;
    error: string;
    occurredAt: number;
  }[];

  /**
   * ★ 2026-05-29 单维度 scope 局部重跑：local-rerun 带 dimensionRef 时设此字段（=维度名）。
   * s3 handler 据此只重跑该维度的 researcher、merge 进其余维度已有产物，再交下游 cascade。
   * 普通整跑 / 整段重跑时为 undefined。
   */
  focusDimension?: string;
}

// ─── Phase 3: Synthesis（s5 reconciler + s6 analyst）──────────────
export interface SynthesisPhaseCtx {
  /** s5-reconciler-cross-dim-fact-check.stage.ts */
  reconciliationReport?: {
    factTable: unknown[];
    conflicts: unknown[];
    overlaps: unknown[];
    gaps: unknown[];
    figureCandidates: unknown[];
    reconciliationReport: string;
    // ★ ACH (2026-05-29 L2)：竞争性假设，供 s6 Analyst foresight 消费（refuted 不进 baseCase）。
    //   类型显式声明，保证 reconciler Output → ctx → analyst Input 全程类型可达，不靠 unknown cast。
    alternativeHypotheses?: {
      id: string;
      statement: string;
      likelihood: "low" | "medium" | "high";
      status: "plausible" | "unlikely" | "refuted";
      refutingEvidence?: unknown[];
    }[];
  } | null;

  /** s6-analyst-synthesize-insights.stage.ts */
  analystOutput?: unknown;
}

// ─── Phase 4: Writer（s7 outline + s8 draft + s8b enhancement）─────
export interface WriterPhaseCtx {
  /**
   * ★ P1-E (2026-04-29): S7 outline 真消费
   * thorough+ 档位下 S7 产出的 mission-level chapter outline，由 S8 SingleShotWriter
   * 严格按 sectionId/heading/thesis/keyPoints/targetWords 起草，提升长文兑现率。
   */
  outlinePlan?: {
    chapterOutlines: {
      sectionId: string;
      heading: string;
      subheadings: string[];
      thesis: string;
      keyPointsToCover: string[];
    }[];
    targetWordsPerChapter: Record<string, number>;
    factAllocation: Record<string, string[]>;
  };

  /** s8-writer-draft-report.stage.ts —— ResearchReport v1 + ReportArtifact v2 */
  report?: ResearchReport;
  reportArtifact?: ReportArtifact;
  reviewScore?: number;
  verifierVerdicts?: unknown[];

  /**
   * ★ PR-A0 (2026-05-06 v1.4 NB-2): s8-pre 写入，s8-final / S8B 读取（拆 stage 后 ctx 共享键）。
   * 取代旧 v1 路径（writer LLM 一次产出 fullMarkdown）；s8-pre 从 analystOutput / reconciliationReport /
   * researcherResults / criticVerdict 等已就绪 stage 产物中采集，0 LLM call，emit report:preview 事件。
   * 类型从 ai-harness/facade 导出（StructuralReportAssembler 的 input 类型）。
   */
  reportSegments?: import("@/modules/ai-harness/facade").ReportSegments;
}

// ─── Phase 5: Quality（s8b section enhancement + s9b objective eval）
export interface QualityPhaseCtx {
  /** ★ 沉淀消费 v3 (2026-04-29): 全链路质量 trace 收集 */
  qualityTraceCtx?: QualityTraceContext;

  /** ★ 沉淀消费 v3 (2026-04-29): 10 维结构化报告评审结果 */
  reportEvaluation?: import("@/modules/ai-harness/facade").EvaluationResult;

  /**
   * ★ Forecast 红队 (2026-05-29 L2): s9 阶段对 foresight 的事前验尸完整结论（含 vulnerabilities）。
   * 注：用户可见的 robustness + couldBeWrongIf 已由 s9 直接回灌 reportArtifact.quickView.foresight
   * （那是持久化与前端渲染的真实路径）。本 ctx 字段保留完整 verdict 供同 mission 内下游只读（如未来 s10 foreword 引用）。
   */
  reportRedTeamVerdict?: {
    vulnerabilities: {
      statement: string;
      failureScenario: string;
      timeHorizon: "6m" | "12m" | "2y";
      likelihood: number;
      impactIfFails: "minor" | "moderate" | "critical";
    }[];
    couldBeWrongIf: string[];
    overallRobustness: number;
    rationale: string;
  };
}

// ─── Phase 6: Signoff（s10 leader foreword + signoff）──────────────
export interface SignoffPhaseCtx {
  /** s10-leader-foreword-and-signoff.stage.ts (M6) */
  leaderForeword?: LeaderForewordOutput & { generatedAt: string };

  /** s10-leader-foreword-and-signoff.stage.ts (M7) */
  leaderSignOff?: LeaderSignoffOutput;
}

// ─── Phase 7: Persist（s11 mission persist + s12 self-evolution）───
export interface PersistPhaseCtx {
  /** s11-mission-persist.stage.ts */
  trajectoryStored?: number;
}

/**
 * MissionContext —— 完整合成类型（trunk + 所有 stage 函数当前签名都用这个）。
 *
 * PR-7b（W22 主线波次）将逐 stage 改成更窄签名，例如：
 *   - runResearcherDispatchStage(ctx: MissionInvariants & PlanPhaseCtx, deps: ResearchDeps): Promise<ResearchPhaseCtx>
 *   - runWriterStage(ctx: MissionInvariants & PlanPhaseCtx & ResearchPhaseCtx & SynthesisPhaseCtx, deps: WriterDeps): Promise<WriterPhaseCtx>
 * 让 reader 看签名就能判断 stage 的上下游依赖。
 */
export type MissionContext = MissionInvariants &
  PlanPhaseCtx &
  ResearchPhaseCtx &
  SynthesisPhaseCtx &
  WriterPhaseCtx &
  QualityPhaseCtx &
  SignoffPhaseCtx &
  PersistPhaseCtx;
