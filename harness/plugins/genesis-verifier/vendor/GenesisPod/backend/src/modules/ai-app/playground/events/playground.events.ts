/**
 * AgentPlaygroundEvents — 事件类型注册清单
 *
 * EventBus 校验：未注册的 type 一律 drop+warn，不会广播。
 * 所有 demo 事件必须在此声明。
 */

import type { DomainEventTypeSpec } from "@/modules/ai-harness/facade";
import type { z } from "zod";
import {
  // mission lifecycle
  MissionStartedSchema,
  MissionCompletedSchema,
  MissionFailedSchema,
  MissionRejectedSchema,
  MissionWarningSchema,
  MissionDegradedSchema,
  MissionCancelledSchema,
  MissionManualRerunFromTodoSchema,
  MissionRerunStartedSchema,
  MissionRerunCompletedSchema,
  MissionRerunFailedSchema,
  MissionReopenedSchema,
  MissionAutoRecoveredSchema,
  MissionZombieCleanupSchema,
  MissionPostludeStartedSchema,
  MissionPostludeCompletedSchema,
  MissionPostludeFailedSchema,
  MissionExecutionAbortedSchema,
  MissionEvolvedSchema,
  MissionPersistFailedSchema,
  MissionBudgetWarningSoftSchema,
  MissionBudgetWarningHardSchema,
  MissionPreflightWarningSchema,
  // stage lifecycle
  StageStartedSchema,
  StageCompletedSchema,
  StageLifecycleSchema,
  StageFailedSchema,
  StageStalledSchema,
  StageDegradedSchema,
  StageMetricsSchema,
  // agent lifecycle
  AgentLifecycleSchema,
  AgentThoughtSchema,
  AgentActionSchema,
  AgentObservationSchema,
  AgentReflectionSchema,
  AgentErrorSchema,
  AgentNarrativeSchema,
  AgentValidationRejectedSchema,
  // researcher / verifier / critic
  ResearcherCompletedSchema,
  VerifierVerdictSchema,
  CriticVerdictSchema,
  RedTeamVerdictSchema,
  // cost / budget
  CostTickSchema,
  BudgetExhaustedSchema,
  BudgetWarningSoftSchema,
  BudgetWarningHardSchema,
  // report
  ReportDraftSchema,
  DraftCompletedSchema,
  ReportAssembledSchema,
  // memory / evolution
  MemoryIndexedSchema,
  IterationProgressSchema,
  // dimension research lifecycle
  DimensionResearchStartedSchema,
  DimensionResearchCompletedSchema,
  DimensionOutlinePlannedSchema,
  DimensionIntegratingStartedSchema,
  DimensionIntegratingCompletedSchema,
  DimensionIntegratingFailedSchema,
  DimensionGradedSchema,
  DimensionDegradedSchema,
  DimensionRetryingSchema,
  DimensionRetryFailedSchema,
  DimensionRetryPhaseStartedSchema,
  DimensionRetryPhaseCompletedSchema,
  DimensionsAppendedSchema,
  // chapter lifecycle
  ChapterWritingStartedSchema,
  ChapterWritingCompletedSchema,
  ChapterReviewStartedSchema,
  ChapterReviewCompletedSchema,
  ChapterRevisionSchema,
  ChapterDoneSchema,
  ChapterRewrittenSchema,
  // tools / reconciliation
  ToolsRecalledSchema,
  ReconciliationCompletedSchema,
  ReconciliationSkippedSchema,
  ReconciliationWarningsOrphanedSchema,
  // infrastructure events
  EventOversizedSchema,
  EventDroppedSchema,
  SectionRemediationSummarySchema,
  FailurePatternPreAppliedSchema,
  // leader
  LeaderGoalsSetSchema,
  LeaderDecisionSchema,
  LeaderForewordSchema,
  LeaderSignedSchema,
  LeaderRejectedRevisionRecommendedSchema,
  // PR-R5 cascade rerun
  RerunStageStartedSchema,
  RerunCascadeAbortedSchema,
} from "./playground.event-schemas";

/**
 * S(suffix, schema) — 注册带 zod payload schema 的事件，EventBus.emit() 会
 * 自动 safeParse。schema 失败默认 log.warn 静默 drop（不阻断业务），但开发期可由
 * 业务层 broadcast 失败 throw（让 backend 自己炸而不是污染前端）。
 */
const S = <TPayload>(
  suffix: string,
  schema: z.ZodType<TPayload>,
): DomainEventTypeSpec<TPayload> => ({
  type: `playground.${suffix}`,
  schema,
});

export const AGENT_PLAYGROUND_EVENTS: readonly DomainEventTypeSpec[] = [
  S("mission:started", MissionStartedSchema),
  S("mission:completed", MissionCompletedSchema),
  S("mission:failed", MissionFailedSchema),
  S("mission:rejected", MissionRejectedSchema),
  S("mission:warning", MissionWarningSchema),
  S("mission:preflight-warning", MissionPreflightWarningSchema), // #63 leader signoff 预警
  S("mission:degraded", MissionDegradedSchema),
  S("mission:cancelled", MissionCancelledSchema), // controller.ts manual cancel
  S("mission:manual-rerun-from-todo", MissionManualRerunFromTodoSchema), // controller.ts 手动 rerun
  // ── 2026-04-30: 单 stage 局部重跑（B 路线）──
  S("mission:rerun-started", MissionRerunStartedSchema), // 局部重跑开始（payload: scope, todoId, sourceStage）
  S("mission:rerun-completed", MissionRerunCompletedSchema), // 局部重跑成功，patch 已落库（payload: scope, todoId, durationMs）
  S("mission:rerun-failed", MissionRerunFailedSchema), // 局部重跑失败，原产物保留（payload: scope, todoId, errorMessage）
  // PR-R3 (2026-05-07): markReopened 审计事件（failed/quality-failed → running）
  S("mission:reopened", MissionReopenedSchema),
  // 2026-06-12: liveness 停滞击杀后的自动恢复审计 + 终生 1 次上限计数源
  S("mission:auto-recovered", MissionAutoRecoveredSchema),
  // rerun-overhaul v1.1 (2026-05-07): RerunGuard 主动清 zombie heartbeat 审计事件
  S("mission:zombie-cleanup", MissionZombieCleanupSchema),
  S("stage:started", StageStartedSchema),
  S("stage:completed", StageCompletedSchema),
  // ★ 2026-05-06 (A 架构优化): orchestrator-driven lifecycle 信号，与 stage:started/completed
  //   并存。stage:lifecycle 由 dispatcher onEvent 桥接 orchestrator 内部事件，stage 字段
  //   是 step.id 映射后的前端 SystemStageId；stage:started/completed 仍由 stage 文件 emit
  //   作 metrics（携带 dimensions/results 等 custom payload）。
  //   后续 PR：删 stage:started/completed，全靠 stage:lifecycle + 单独 stage:metrics 事件。
  S("stage:lifecycle", StageLifecycleSchema),
  S("stage:failed", StageFailedSchema),
  // ★ 2026-05-06 (A-9): orchestrator watchdog 检测 stage stall（started 后超阈值未完成）
  S("stage:stalled", StageStalledSchema),
  // ★ 2026-05-06 (A-6): stage 内部软失败 markDegraded API → orchestrator 透传
  S("stage:degraded", StageDegradedSchema),
  // ★ 2026-05-06 (A-2): stage 业务 metrics（取代 stage:completed payload，stepId 索引）
  S("stage:metrics", StageMetricsSchema),
  // ★ 2026-05-06 (A-7): S12 fire-and-forget postlude 独立事件流，不与 stage:lifecycle 混
  S("mission:postlude:started", MissionPostludeStartedSchema),
  S("mission:postlude:completed", MissionPostludeCompletedSchema),
  S("mission:postlude:failed", MissionPostludeFailedSchema),
  // ★ 2026-05-06 (A-8): dispatcher finally 兜底信号 — runtime 失联（非 stage:failed）
  S("mission:execution-aborted", MissionExecutionAbortedSchema),
  S("agent:lifecycle", AgentLifecycleSchema),
  S("agent:thought", AgentThoughtSchema),
  S("agent:action", AgentActionSchema),
  S("agent:observation", AgentObservationSchema),
  S("agent:reflection", AgentReflectionSchema),
  S("agent:error", AgentErrorSchema),
  S("researcher:completed", ResearcherCompletedSchema),
  S("verifier:verdict", VerifierVerdictSchema),
  S("cost:tick", CostTickSchema),
  S("budget:exhausted", BudgetExhaustedSchema),
  S("report:draft", ReportDraftSchema),
  S("draft:completed", DraftCompletedSchema), // S8 写作环节完成
  S("report:assembled", ReportAssembledSchema), // S8 reportArtifact v2 装配完成
  S("memory:indexed", MemoryIndexedSchema),
  // ── per-dim research lifecycle ──
  S("dimension:research:started", DimensionResearchStartedSchema),
  S("dimension:research:completed", DimensionResearchCompletedSchema),
  // ── TI-style per-dimension 子流程事件 ──
  S("dimension:outline:planned", DimensionOutlinePlannedSchema),
  S("chapter:writing:started", ChapterWritingStartedSchema),
  S("chapter:writing:completed", ChapterWritingCompletedSchema), // ★ schema 化
  S("chapter:review:started", ChapterReviewStartedSchema),
  S("chapter:review:completed", ChapterReviewCompletedSchema),
  S("chapter:revision", ChapterRevisionSchema),
  S("chapter:done", ChapterDoneSchema), // ★ schema 化
  S("dimension:integrating:started", DimensionIntegratingStartedSchema),
  S("dimension:integrating:completed", DimensionIntegratingCompletedSchema),
  S("dimension:integrating:failed", DimensionIntegratingFailedSchema), // P1-R4-B
  S("dimension:graded", DimensionGradedSchema),
  // ── Leader chat 触发的动态追加 ──
  S("dimensions:appended", DimensionsAppendedSchema), // ★ schema 化
  // ── 全链路诊断 / 跨 mission 失败模式记忆 ──
  S("dimension:degraded", DimensionDegradedSchema),
  S("failure-pattern:pre-applied", FailurePatternPreAppliedSchema),
  // ── Phase P0-4: Reconciler [3.5] 节点 ──
  S("reconciliation:completed", ReconciliationCompletedSchema), // ★ schema 化
  // ── Phase P0-9: Writer 局部回写 (D11) ──
  S("chapter:rewritten", ChapterRewrittenSchema),
  // ── Phase P0-2 / P3-1: Tool Recall trace ──
  S("tools:recalled", ToolsRecalledSchema),
  S("agent:validation-rejected", AgentValidationRejectedSchema),
  // ── Phase P21-2: Critic L4 verdict 事件 ──
  S("critic:verdict", CriticVerdictSchema), // ★ schema 化
  S("red-team:verdict", RedTeamVerdictSchema), // ★ Foresight L2 forecast 红队
  // ── Phase P0-10: 预算两档闸 ──
  S("mission:budget-warning-soft", MissionBudgetWarningSoftSchema),
  S("mission:budget-warning-hard", MissionBudgetWarningHardSchema),
  // ── Phase Lead-1+: Leader-Replanner-Lite ──
  S("leader:goals-set", LeaderGoalsSetSchema), // ★ schema 化（initialRisks 形状漂移过）
  S("leader:decision", LeaderDecisionSchema), // ★ schema 化
  S("leader:foreword", LeaderForewordSchema), // M6 Leader 写完 meta-level Foreword
  S("leader:signed", LeaderSignedSchema), // M7 Leader 签字（含 score/verdict/signed/refusalReason）
  S("dimension:retrying", DimensionRetryingSchema), // ★ schema 化
  S("dimension:retry-failed", DimensionRetryFailedSchema),
  // ── 人话叙事事件（agent-narrative.md）──
  S("agent:narrative", AgentNarrativeSchema),
  // ── S12 self-evolution（mission 复盘）──
  S("mission:evolved", MissionEvolvedSchema),
  // ── Phase P1 fix (2026-04-29 mission 8c7b4358) — ReAct 死循环防护 ──
  S("iteration:progress", IterationProgressSchema),
  S("dimension:retry-phase:started", DimensionRetryPhaseStartedSchema),
  S("dimension:retry-phase:completed", DimensionRetryPhaseCompletedSchema),
  // ── 第二轮深度排查补漏 ──
  S("reconciliation:skipped", ReconciliationSkippedSchema),
  S("reconciliation:warnings-orphaned", ReconciliationWarningsOrphanedSchema),
  S("mission:persist-failed", MissionPersistFailedSchema),
  // ── 第三轮补漏 ──
  S("event:oversized", EventOversizedSchema),
  S("event:dropped", EventDroppedSchema),
  // ── Phase 2 (TI RemediationTrace): S8B 补救成效汇总 ──
  S("section:remediation:summary", SectionRemediationSummarySchema),
  // ── Phase 6: leader 拒签 revision 引导事件 ──
  S(
    "leader:rejected-revision-recommended",
    LeaderRejectedRevisionRecommendedSchema,
  ),
  // ── budget 独立告警（区别于 mission:budget-warning-*）──
  S("budget:warning-soft", BudgetWarningSoftSchema),
  S("budget:warning-hard", BudgetWarningHardSchema),
  // ── PR-R5 (2026-05-07): cascade rerun 链路事件 ──
  S("rerun:stage-started", RerunStageStartedSchema),
  S("rerun:cascade-aborted", RerunCascadeAbortedSchema),
];
