/**
 * AgentPlayground 事件 payload Zod schemas
 *
 * 单一来源（前后端共用）。每个事件 emit 时由 EventBus.emit() 调用
 * spec.schema.safeParse(payload) 校验；失败在 dev/staging 直接 throw（让 backend
 * 自己炸而不是污染前端 ErrorBoundary），生产降级到 log.warn 不阻断业务。
 *
 * 接入：playground.events.ts 用 S(suffix, schema) 把 schema 写进
 * DomainEventTypeSpec.schema 字段。
 *
 * 前端：通过 z.infer<typeof Schema> 推 TS type，不再 (p.X as Y[])。
 *
 * 覆盖全量（2026-05-06）：80 个事件 100% 有 schema。
 * prod payload 通过 Railway PostgreSQL 实测样本对齐。
 */

import { z } from "zod";

// ─────────── 通用子 schema ───────────
export const DimensionSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  rationale: z.string().optional(),
});
export type DimensionSpec = z.infer<typeof DimensionSpecSchema>;

export const RiskItemSchema = z.object({
  type: z.string(),
  severity: z.string().optional(),
  mitigation: z.string().optional(),
});
export type RiskItem = z.infer<typeof RiskItemSchema>;

// ─────────── mission:started ───────────
// prod: { input: { depth, topic, language, viewMode, maxCredits, ... } }
export const MissionStartedSchema = z
  .object({
    input: z.record(z.unknown()).optional(),
    missionId: z.string().optional(),
    startedAt: z.number().optional(),
  })
  .passthrough();
export type MissionStartedPayload = z.infer<typeof MissionStartedSchema>;

// ─────────── mission:completed ───────────
// prod: { costUsd, tokensUsed, wallTimeMs, reviewScore, leaderSigned, trajectoryStored, verifierVerdicts }
export const VerifierVerdictItemSchema = z
  .object({
    score: z.number().optional(),
    judgeId: z.string().optional(),
    critique: z.string().optional(),
  })
  .passthrough();

export const MissionCompletedSchema = z
  .object({
    costUsd: z.number().optional(),
    tokensUsed: z.number().optional(),
    wallTimeMs: z.number().optional(),
    reviewScore: z.number().optional(),
    leaderSigned: z.boolean().optional(),
    trajectoryStored: z.number().optional(),
    verifierVerdicts: z.array(VerifierVerdictItemSchema).optional(),
  })
  .passthrough();
export type MissionCompletedPayload = z.infer<typeof MissionCompletedSchema>;

// ─────────── mission:failed ───────────
// prod: { source, message, failureCode }
export const MissionFailedSchema = z
  .object({
    source: z.string().optional(),
    message: z.string().optional(),
    failureCode: z.string().optional(),
  })
  .passthrough();
export type MissionFailedPayload = z.infer<typeof MissionFailedSchema>;

// ─────────── mission:rejected ───────────
// no prod sample; allow any shape
export const MissionRejectedSchema = z.object({}).passthrough();
export type MissionRejectedPayload = z.infer<typeof MissionRejectedSchema>;

// ─────────── mission:warning ───────────
// prod: { ageMs, source, message, eventAgeMs, heartbeatAgeMs }
export const MissionWarningSchema = z
  .object({
    source: z.string().optional(),
    message: z.string().optional(),
    ageMs: z.number().optional(),
    eventAgeMs: z.number().optional(),
    heartbeatAgeMs: z.number().optional(),
  })
  .passthrough();
export type MissionWarningPayload = z.infer<typeof MissionWarningSchema>;

// ─────────── mission:degraded ───────────
// prod: { reason, failedCount, retriedCount, patchFailures: [{error, reason, occurredAt, retryLabel, dimensionId, dimensionName}] }
export const MissionDegradedSchema = z
  .object({
    reason: z.string().optional(),
    failedCount: z.number().optional(),
    retriedCount: z.number().optional(),
    patchFailures: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();
export type MissionDegradedPayload = z.infer<typeof MissionDegradedSchema>;

// ─────────── mission:auto-recovered ───────────
// 2026-06-12: liveness 停滞击杀后的自动恢复审计（同时是"终生 1 次"上限的计数来源）
export const MissionAutoRecoveredSchema = z
  .object({
    trigger: z.string().optional(),
    attempt: z.number().optional(),
  })
  .passthrough();
export type MissionAutoRecoveredPayload = z.infer<
  typeof MissionAutoRecoveredSchema
>;

// ─────────── mission:cancelled ───────────
// prod: { reason: "user_cancelled", message }
export const MissionCancelledSchema = z
  .object({
    reason: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();
export type MissionCancelledPayload = z.infer<typeof MissionCancelledSchema>;

// ─────────── mission:manual-rerun-from-todo ───────────
// prod: { scope, origin, todoTitle, sourceTodoId, sourceMissionId }
export const MissionManualRerunFromTodoSchema = z
  .object({
    scope: z.string().optional(),
    origin: z.string().optional(),
    todoTitle: z.string().optional(),
    sourceTodoId: z.string().optional(),
    sourceMissionId: z.string().optional(),
  })
  .passthrough();
export type MissionManualRerunFromTodoPayload = z.infer<
  typeof MissionManualRerunFromTodoSchema
>;

// ─────────── mission:rerun-started / completed / failed ───────────
// no prod sample; allow any shape
export const MissionRerunStartedSchema = z
  .object({
    scope: z.string().optional(),
    todoId: z.string().optional(),
    sourceStage: z.string().optional(),
  })
  .passthrough();
export type MissionRerunStartedPayload = z.infer<
  typeof MissionRerunStartedSchema
>;

export const MissionRerunCompletedSchema = z
  .object({
    scope: z.string().optional(),
    todoId: z.string().optional(),
    durationMs: z.number().optional(),
  })
  .passthrough();
export type MissionRerunCompletedPayload = z.infer<
  typeof MissionRerunCompletedSchema
>;

export const MissionRerunFailedSchema = z
  .object({
    scope: z.string().optional(),
    todoId: z.string().optional(),
    errorMessage: z.string().optional(),
  })
  .passthrough();
export type MissionRerunFailedPayload = z.infer<
  typeof MissionRerunFailedSchema
>;

// PR-R3 (2026-05-07 per-task rerun + cascade): mission failed/quality-failed → running 反向状态机审计
export const MissionReopenedSchema = z
  .object({
    triggeredBy: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();
export type MissionReopenedPayload = z.infer<typeof MissionReopenedSchema>;

// rerun-overhaul v1.1 (2026-05-07): RerunGuard 主动清 zombie heartbeat 审计事件
// （heartbeat 新但 BUSINESS 事件 stale ≥ 5min → 主动 markFailed + clearHeartbeat）
export const MissionZombieCleanupSchema = z
  .object({
    triggeredBy: z.string().optional(),
    ts: z.number().optional(),
    reason: z.string().optional(),
  })
  .passthrough();
export type MissionZombieCleanupPayload = z.infer<
  typeof MissionZombieCleanupSchema
>;

// PR-R5 (2026-05-07 cascade rerun): cascade 链每步开跑前 emit
export const RerunStageStartedSchema = z
  .object({
    stepId: z.string(),
    fromStepId: z.string(),
    cascadeChain: z.array(z.string()),
    completedSoFar: z.array(z.string()),
  })
  .passthrough();
export type RerunStageStartedPayload = z.infer<typeof RerunStageStartedSchema>;

// PR-R5 (2026-05-07 cascade rerun): best-effort partial 中止时 emit 三元组
export const RerunCascadeAbortedSchema = z
  .object({
    abortedAt: z.string(),
    completed: z.array(z.string()),
    remaining: z.array(z.string()),
    errorMessage: z.string(),
    partialModeNote: z.string().optional(),
  })
  .passthrough();
export type RerunCascadeAbortedPayload = z.infer<
  typeof RerunCascadeAbortedSchema
>;

// ─────────── stage:started ───────────
// prod: { count, stage, dimensions: string[] }
export const StageStartedSchema = z
  .object({
    stage: z.string().optional(),
    count: z.number().optional(),
    dimensions: z.array(z.string()).optional(),
  })
  .passthrough();
export type StageStartedPayload = z.infer<typeof StageStartedSchema>;

// ─────────── stage:completed ───────────
// prod: { stage, results: [{summary, dimension, findingsCount}] }
export const StageCompletedSchema = z
  .object({
    stage: z.string().optional(),
    results: z.array(z.record(z.unknown())).optional(),
    durationMs: z.number().optional(),
  })
  .passthrough();
export type StageCompletedPayload = z.infer<typeof StageCompletedSchema>;

// ─────────── stage:lifecycle ───────────
// prod: { stage, status: "started"|"completed"|"failed", stepId, primitive, error? }
export const StageLifecycleSchema = z
  .object({
    stage: z.string().optional(),
    status: z
      .enum(["started", "completed", "failed", "skipped", "stalled"])
      .optional(),
    stepId: z.string().optional(),
    primitive: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();
export type StageLifecyclePayload = z.infer<typeof StageLifecycleSchema>;

// ─────────── stage:failed ───────────
// no prod sample
export const StageFailedSchema = z
  .object({
    stage: z.string().optional(),
    error: z.string().optional(),
    stepId: z.string().optional(),
  })
  .passthrough();
export type StageFailedPayload = z.infer<typeof StageFailedSchema>;

// ─────────── stage:stalled ───────────
// no prod sample
export const StageStalledSchema = z
  .object({
    stage: z.string().optional(),
    stepId: z.string().optional(),
    stallDurationMs: z.number().optional(),
  })
  .passthrough();
export type StageStalledPayload = z.infer<typeof StageStalledSchema>;

// ─────────── stage:degraded ───────────
// no prod sample
export const StageDegradedSchema = z
  .object({
    stage: z.string().optional(),
    reason: z.string().optional(),
  })
  .passthrough();
export type StageDegradedPayload = z.infer<typeof StageDegradedSchema>;

// ─────────── stage:metrics ───────────
// prod: { stage, status, dimensions: [{id, name, toolHint, rationale}] }
export const StageMetricsSchema = z
  .object({
    stage: z.string().optional(),
    status: z.string().optional(),
    dimensions: z.array(z.record(z.unknown())).optional(),
    durationMs: z.number().optional(),
  })
  .passthrough();
export type StageMetricsPayload = z.infer<typeof StageMetricsSchema>;

// ─────────── mission:postlude:started / completed / failed ───────────
// prod started: { stage, startedAt }
// prod completed: { stage, wallTimeMs }
export const MissionPostludeStartedSchema = z
  .object({
    stage: z.string().optional(),
    startedAt: z.number().optional(),
  })
  .passthrough();
export type MissionPostludeStartedPayload = z.infer<
  typeof MissionPostludeStartedSchema
>;

export const MissionPostludeCompletedSchema = z
  .object({
    stage: z.string().optional(),
    wallTimeMs: z.number().optional(),
  })
  .passthrough();
export type MissionPostludeCompletedPayload = z.infer<
  typeof MissionPostludeCompletedSchema
>;

export const MissionPostludeFailedSchema = z
  .object({
    stage: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();
export type MissionPostludeFailedPayload = z.infer<
  typeof MissionPostludeFailedSchema
>;

// ─────────── mission:execution-aborted ───────────
// no prod sample
export const MissionExecutionAbortedSchema = z
  .object({
    reason: z.string().optional(),
    stage: z.string().optional(),
  })
  .passthrough();
export type MissionExecutionAbortedPayload = z.infer<
  typeof MissionExecutionAbortedSchema
>;

// ─────────── agent:lifecycle ───────────
// prod: { role, phase: "started"|"completed", agentId, dimension?, wallTimeMs? }
export const AgentLifecycleSchema = z
  .object({
    role: z.string().optional(),
    phase: z.string().optional(),
    agentId: z.string().optional(),
    dimension: z.string().optional(),
    wallTimeMs: z.number().optional(),
  })
  .passthrough();
export type AgentLifecyclePayload = z.infer<typeof AgentLifecycleSchema>;

// ─────────── agent:thought ───────────
// prod: { role, text, agentId, originalTs, tokenCount }
export const AgentThoughtSchema = z
  .object({
    role: z.string().optional(),
    text: z.string().optional(),
    agentId: z.string().optional(),
    originalTs: z.number().optional(),
    tokenCount: z.number().optional(),
  })
  .passthrough();
export type AgentThoughtPayload = z.infer<typeof AgentThoughtSchema>;

// ─────────── agent:action ───────────
// prod: { kind, role, agentId, originalTs }
export const AgentActionSchema = z
  .object({
    kind: z.string().optional(),
    role: z.string().optional(),
    agentId: z.string().optional(),
    originalTs: z.number().optional(),
    toolName: z.string().optional(),
    args: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type AgentActionPayload = z.infer<typeof AgentActionSchema>;

// ─────────── agent:observation ───────────
// prod: { kind, role, output: { body: string }, agentId, originalTs }
export const AgentObservationSchema = z
  .object({
    kind: z.string().optional(),
    role: z.string().optional(),
    output: z.unknown().optional(),
    agentId: z.string().optional(),
    originalTs: z.number().optional(),
  })
  .passthrough();
export type AgentObservationPayload = z.infer<typeof AgentObservationSchema>;

// ─────────── agent:reflection ───────────
// prod: { role, score, agentId, revision, verdicts: [{score, judgeId, critique}] }
// score 为 null = 所有 verifier abstain（unhealthy），表示"显式无分可评"——
// 不能用 undefined 因为下游 failure-extraction 用 typeof === "number" 守卫，
// null 携带的 abstain 语义比"字段缺失"更明确（来源：reflexion-loop.ts force-pass 分支）。
export const AgentReflectionSchema = z
  .object({
    role: z.string().optional(),
    score: z.number().nullish(),
    agentId: z.string().optional(),
    revision: z.number().optional(),
    verdicts: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();
export type AgentReflectionPayload = z.infer<typeof AgentReflectionSchema>;

// ─────────── agent:error ───────────
// prod: { role, agentId, message, originalTs }
export const AgentErrorSchema = z
  .object({
    role: z.string().optional(),
    agentId: z.string().optional(),
    message: z.string().optional(),
    originalTs: z.number().optional(),
    errorCode: z.string().optional(),
  })
  .passthrough();
export type AgentErrorPayload = z.infer<typeof AgentErrorSchema>;

// ─────────── agent:narrative ───────────
// prod: { tag, role, text, stage, agentId, dimension? }
export const AgentNarrativeSchema = z
  .object({
    tag: z.string().optional(),
    role: z.string().optional(),
    text: z.string().optional(),
    stage: z.string().optional(),
    agentId: z.string().optional(),
    dimension: z.string().optional(),
  })
  .passthrough();
export type AgentNarrativePayload = z.infer<typeof AgentNarrativeSchema>;

// ─────────── agent:validation-rejected ───────────
// prod: { role, issues, agentId, maxRejects, originalTs, rejectCount }
export const AgentValidationRejectedSchema = z
  .object({
    role: z.string().optional(),
    issues: z.string().optional(),
    agentId: z.string().optional(),
    maxRejects: z.number().optional(),
    originalTs: z.number().optional(),
    rejectCount: z.number().optional(),
  })
  .passthrough();
export type AgentValidationRejectedPayload = z.infer<
  typeof AgentValidationRejectedSchema
>;

// ─────────── researcher:completed ───────────
// prod: { state, summary, dimension, iterations, wallTimeMs, findingsCount }
export const ResearcherCompletedSchema = z
  .object({
    state: z.string().optional(),
    summary: z.string().optional(),
    dimension: z.string().optional(),
    iterations: z.number().optional(),
    wallTimeMs: z.number().optional(),
    findingsCount: z.number().optional(),
  })
  .passthrough();
export type ResearcherCompletedPayload = z.infer<
  typeof ResearcherCompletedSchema
>;

// ─────────── verifier:verdict ───────────
// prod: { score, attempt, critique, verifierId }
export const VerifierVerdictSchema = z
  .object({
    score: z.number().optional(),
    attempt: z.number().optional(),
    critique: z.string().optional(),
    verifierId: z.string().optional(),
    pass: z.boolean().optional(),
  })
  .passthrough();
export type VerifierVerdictPayload = z.infer<typeof VerifierVerdictSchema>;

// ─────────── cost:tick ───────────
// prod: { stage, costUsd, tokensUsed, deltaTokens, deltaCostUsd }
export const CostTickSchema = z
  .object({
    stage: z.string().optional(),
    costUsd: z.number().optional(),
    tokensUsed: z.number().optional(),
    deltaTokens: z.number().optional(),
    deltaCostUsd: z.number().optional(),
  })
  .passthrough();
export type CostTickPayload = z.infer<typeof CostTickSchema>;

// ─────────── budget:exhausted ───────────
// prod: { poolCostUsd, poolTokensUsed, poolCostRemaining, poolTokensRemaining }
export const BudgetExhaustedSchema = z
  .object({
    poolCostUsd: z.number().optional(),
    poolTokensUsed: z.number().optional(),
    poolCostRemaining: z.number().optional(),
    poolTokensRemaining: z.number().optional(),
  })
  .passthrough();
export type BudgetExhaustedPayload = z.infer<typeof BudgetExhaustedSchema>;

// ─────────── budget:warning-soft / hard ───────────
// no prod sample; modeled after mission:budget-warning-*
export const BudgetWarningSoftSchema = z
  .object({
    reason: z.string().optional(),
    costUsd: z.number().optional(),
    tokensUsed: z.number().optional(),
    thresholdPct: z.number().optional(),
  })
  .passthrough();
export type BudgetWarningSoftPayload = z.infer<typeof BudgetWarningSoftSchema>;

export const BudgetWarningHardSchema = z
  .object({
    reason: z.string().optional(),
    costUsd: z.number().optional(),
    tokensUsed: z.number().optional(),
    thresholdPct: z.number().optional(),
  })
  .passthrough();
export type BudgetWarningHardPayload = z.infer<typeof BudgetWarningHardSchema>;

// ─────────── report:draft ───────────
// prod: { report: { title, summary, sections: [...] } }
export const ReportDraftSchema = z
  .object({
    report: z
      .object({
        title: z.string().optional(),
        summary: z.string().optional(),
        sections: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ReportDraftPayload = z.infer<typeof ReportDraftSchema>;

// ─────────── draft:completed ───────────
// prod: { costUsd, tokensUsed, wallTimeMs, reviewScore, trajectoryStored, verifierVerdicts }
export const DraftCompletedSchema = z
  .object({
    costUsd: z.number().optional(),
    tokensUsed: z.number().optional(),
    wallTimeMs: z.number().optional(),
    reviewScore: z.number().optional(),
    trajectoryStored: z.number().optional(),
    verifierVerdicts: z.array(VerifierVerdictItemSchema).optional(),
  })
  .passthrough();
export type DraftCompletedPayload = z.infer<typeof DraftCompletedSchema>;

// ─────────── report:assembled ───────────
// prod: { version, figuresCount, sectionsCount, citationsCount, qualityOverall, fullMarkdownSize }
export const ReportAssembledSchema = z
  .object({
    version: z.number().optional(),
    figuresCount: z.number().optional(),
    sectionsCount: z.number().optional(),
    citationsCount: z.number().optional(),
    qualityOverall: z.number().optional(),
    fullMarkdownSize: z.number().optional(),
  })
  .passthrough();
export type ReportAssembledPayload = z.infer<typeof ReportAssembledSchema>;

// ─────────── mission:preflight-warning ───────────
// 2026-05-13 #63: S8 reportArtifact 装配后计算 leader signoff 阻断风险，
// 提前在 timeline 红段+tooltip 暴露，避免到 S10 才"突然"拒签。
// Severity: warn = 风险高但可能 leader 仍签；block = 必拒签。
export const MissionPreflightWarningSchema = z
  .object({
    severity: z.enum(["warn", "block"]),
    stageId: z.string().optional(),
    /** 影响哪一个高层 StageId 的 timeline 卡片显示红段 */
    affectsStageId: z
      .enum(["leader", "researchers", "analyst", "writer", "reviewer"])
      .optional(),
    /** 触发条件 + 当前值 + 阈值 */
    reasons: z.array(
      z.object({
        code: z.string(),
        message: z.string(),
        current: z.number().optional(),
        threshold: z.number().optional(),
      }),
    ),
  })
  .passthrough();
export type MissionPreflightWarningPayload = z.infer<
  typeof MissionPreflightWarningSchema
>;

// ─────────── memory:indexed ───────────
// prod: { tags, chunks, namespace }
export const MemoryIndexedSchema = z
  .object({
    tags: z.array(z.string()).optional(),
    chunks: z.number().optional(),
    namespace: z.string().optional(),
  })
  .passthrough();
export type MemoryIndexedPayload = z.infer<typeof MemoryIndexedSchema>;

// ─────────── mission:evolved ───────────
// prod: { retryTotal, totalTokens, leaderSigned, totalCostUsd, qualityHitRate, recommendations, stageDurationsMs, avgResearcherIterations }
export const MissionEvolvedSchema = z
  .object({
    retryTotal: z.number().optional(),
    totalTokens: z.number().optional(),
    leaderSigned: z.boolean().nullable().optional(),
    totalCostUsd: z.number().optional(),
    qualityHitRate: z.number().nullable().optional(),
    recommendations: z.array(z.string()).optional(),
    stageDurationsMs: z.record(z.number()).optional(),
    avgResearcherIterations: z.number().optional(),
  })
  .passthrough();
export type MissionEvolvedPayload = z.infer<typeof MissionEvolvedSchema>;

// ─────────── mission:persist-failed ───────────
// no prod sample
export const MissionPersistFailedSchema = z
  .object({
    error: z.string().optional(),
    stage: z.string().optional(),
  })
  .passthrough();
export type MissionPersistFailedPayload = z.infer<
  typeof MissionPersistFailedSchema
>;

// ─────────── mission:budget-warning-soft / hard ───────────
// prod hard: { reason: "wall_time_exceeded", wallTimeMs }
export const MissionBudgetWarningSoftSchema = z
  .object({
    reason: z.string().optional(),
    wallTimeMs: z.number().optional(),
    costUsd: z.number().optional(),
  })
  .passthrough();
export type MissionBudgetWarningSoftPayload = z.infer<
  typeof MissionBudgetWarningSoftSchema
>;

export const MissionBudgetWarningHardSchema = z
  .object({
    reason: z.string().optional(),
    wallTimeMs: z.number().optional(),
    costUsd: z.number().optional(),
  })
  .passthrough();
export type MissionBudgetWarningHardPayload = z.infer<
  typeof MissionBudgetWarningHardSchema
>;

// ─────────── dimension:research:started ───────────
// prod: { dimension, dimensionId, dimensionIdx }
export const DimensionResearchStartedSchema = z
  .object({
    dimension: z.string().optional(),
    dimensionId: z.string().optional(),
    dimensionIdx: z.number().optional(),
  })
  .passthrough();
export type DimensionResearchStartedPayload = z.infer<
  typeof DimensionResearchStartedSchema
>;

// ─────────── dimension:research:completed ───────────
// prod: { state, dimension, findingsCount }
export const DimensionResearchCompletedSchema = z
  .object({
    state: z.string().optional(),
    dimension: z.string().optional(),
    findingsCount: z.number().optional(),
  })
  .passthrough();
export type DimensionResearchCompletedPayload = z.infer<
  typeof DimensionResearchCompletedSchema
>;

// ─────────── dimension:outline:planned ───────────
// prod: { chapters: [{index, thesis, heading}] }
export const DimensionOutlinePlannedSchema = z
  .object({
    chapters: z
      .array(
        z
          .object({
            index: z.number().optional(),
            thesis: z.string().optional(),
            heading: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    dimension: z.string().optional(),
  })
  .passthrough();
export type DimensionOutlinePlannedPayload = z.infer<
  typeof DimensionOutlinePlannedSchema
>;

// ─────────── dimension:integrating:started ───────────
// prod: { dimension, chapterCount }
export const DimensionIntegratingStartedSchema = z
  .object({
    dimension: z.string().optional(),
    chapterCount: z.number().optional(),
  })
  .passthrough();
export type DimensionIntegratingStartedPayload = z.infer<
  typeof DimensionIntegratingStartedSchema
>;

// ─────────── dimension:integrating:completed ───────────
// prod: { degraded, dimension, chapterCount, totalWordCount }
export const DimensionIntegratingCompletedSchema = z
  .object({
    degraded: z.boolean().optional(),
    dimension: z.string().optional(),
    chapterCount: z.number().optional(),
    totalWordCount: z.number().optional(),
  })
  .passthrough();
export type DimensionIntegratingCompletedPayload = z.infer<
  typeof DimensionIntegratingCompletedSchema
>;

// ─────────── dimension:integrating:failed ───────────
// prod: { state, dimension, chapterCount }
export const DimensionIntegratingFailedSchema = z
  .object({
    state: z.string().optional(),
    dimension: z.string().optional(),
    chapterCount: z.number().optional(),
  })
  .passthrough();
export type DimensionIntegratingFailedPayload = z.infer<
  typeof DimensionIntegratingFailedSchema
>;

// ─────────── dimension:graded ───────────
// prod: { axes: { depth, breadth, evidence, coherence, freshness }, grade, overall, summary }
export const DimensionGradedSchema = z
  .object({
    axes: z.record(z.unknown()).optional(),
    grade: z.string().optional(),
    overall: z.number().optional(),
    summary: z.string().optional(),
    dimension: z.string().optional(),
  })
  .passthrough();
export type DimensionGradedPayload = z.infer<typeof DimensionGradedSchema>;

// ─────────── dimension:degraded ───────────
// prod: { state, dimension, diagnostic: { stage, specId, iterations, wallTimeMs, schemaError, ... } }
export const DimensionDegradedSchema = z
  .object({
    state: z.string().optional(),
    dimension: z.string().optional(),
    diagnostic: z.record(z.unknown()).optional(),
    innerFailureCode: z.string().optional(),
  })
  .passthrough();
export type DimensionDegradedPayload = z.infer<typeof DimensionDegradedSchema>;

// ─────────── dimension:retry-failed ───────────
// prod: { error, reason, dimension, retryLabel }
export const DimensionRetryFailedSchema = z
  .object({
    error: z.string().optional(),
    reason: z.string().optional(),
    dimension: z.string().optional(),
    retryLabel: z.string().optional(),
  })
  .passthrough();
export type DimensionRetryFailedPayload = z.infer<
  typeof DimensionRetryFailedSchema
>;

// ─────────── dimension:retry-phase:started ───────────
// prod: { startMs, dimsRetrying: [{idx, reason, dimension}], bumpedBudgetMultiplier }
export const DimensionRetryPhaseStartedSchema = z
  .object({
    startMs: z.number().optional(),
    dimsRetrying: z
      .array(
        z
          .object({
            idx: z.number().optional(),
            reason: z.string().optional(),
            dimension: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    bumpedBudgetMultiplier: z.number().optional(),
  })
  .passthrough();
export type DimensionRetryPhaseStartedPayload = z.infer<
  typeof DimensionRetryPhaseStartedSchema
>;

// ─────────── dimension:retry-phase:completed ───────────
// prod: { perDim: [{idx, success, dimension}], retried, skipped, wallTimeMs }
export const DimensionRetryPhaseCompletedSchema = z
  .object({
    perDim: z
      .array(
        z
          .object({
            idx: z.number().optional(),
            success: z.boolean().optional(),
            dimension: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    retried: z.number().optional(),
    skipped: z.number().optional(),
    wallTimeMs: z.number().optional(),
  })
  .passthrough();
export type DimensionRetryPhaseCompletedPayload = z.infer<
  typeof DimensionRetryPhaseCompletedSchema
>;

// ─────────── chapter:writing:started ───────────
// prod: { attempt, heading, dimension, chapterIndex }
export const ChapterWritingStartedSchema = z
  .object({
    attempt: z.number().optional(),
    heading: z.string().optional(),
    dimension: z.string().optional(),
    chapterIndex: z.number().optional(),
  })
  .passthrough();
export type ChapterWritingStartedPayload = z.infer<
  typeof ChapterWritingStartedSchema
>;

// ─────────── chapter:writing:completed (existing) ───────────
export const ChapterWritingCompletedSchema = z.object({
  dimension: z.string(),
  chapterIndex: z.number(),
  attempt: z.number().optional(),
  wordCount: z.number().optional(),
  targetWordCount: z.number().optional(),
  qualified: z.boolean().optional(),
  decision: z.string().optional(),
});
export type ChapterWritingCompletedPayload = z.infer<
  typeof ChapterWritingCompletedSchema
>;

// ─────────── chapter:review:started ───────────
// prod: { attempt, dimension, chapterIndex }
export const ChapterReviewStartedSchema = z
  .object({
    attempt: z.number().optional(),
    dimension: z.string().optional(),
    chapterIndex: z.number().optional(),
  })
  .passthrough();
export type ChapterReviewStartedPayload = z.infer<
  typeof ChapterReviewStartedSchema
>;

// ─────────── chapter:review:completed ───────────
// prod: { score, issues, attempt, summary, critique, decision, dimension, chapterIndex }
export const ChapterReviewCompletedSchema = z
  .object({
    score: z.number().optional(),
    issues: z.array(z.unknown()).optional(),
    attempt: z.number().optional(),
    summary: z.string().optional(),
    critique: z.string().optional(),
    decision: z.string().optional(),
    dimension: z.string().optional(),
    chapterIndex: z.number().optional(),
  })
  .passthrough();
export type ChapterReviewCompletedPayload = z.infer<
  typeof ChapterReviewCompletedSchema
>;

// ─────────── chapter:revision ───────────
// prod: { critique, dimension, nextAttempt, chapterIndex }
export const ChapterRevisionSchema = z
  .object({
    critique: z.string().optional(),
    dimension: z.string().optional(),
    nextAttempt: z.number().optional(),
    chapterIndex: z.number().optional(),
  })
  .passthrough();
export type ChapterRevisionPayload = z.infer<typeof ChapterRevisionSchema>;

// ─────────── chapter:done (existing) ───────────
export const ChapterDoneSchema = z.object({
  dimension: z.string(),
  chapterIndex: z.number(),
  finalAttempt: z.number().optional(),
  finalScore: z.number().optional(),
  finalized: z.boolean().optional(),
  qualified: z.boolean().optional(),
  decision: z.string().optional(),
  wordCount: z.number().optional(),
  targetWordCount: z.number().optional(),
});
export type ChapterDonePayload = z.infer<typeof ChapterDoneSchema>;

// ─────────── chapter:rewritten ───────────
// no prod sample
export const ChapterRewrittenSchema = z
  .object({
    dimension: z.string().optional(),
    chapterIndex: z.number().optional(),
    attempt: z.number().optional(),
  })
  .passthrough();
export type ChapterRewrittenPayload = z.infer<typeof ChapterRewrittenSchema>;

// ─────────── tools:recalled ───────────
// prod: { role, source, agentId, preferIds, categories, originalTs, recalledIds }
export const ToolsRecalledSchema = z
  .object({
    role: z.string().optional(),
    source: z.string().optional(),
    agentId: z.string().optional(),
    preferIds: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    originalTs: z.number().optional(),
    recalledIds: z.array(z.string()).optional(),
  })
  .passthrough();
export type ToolsRecalledPayload = z.infer<typeof ToolsRecalledSchema>;

// ─────────── reconciliation:completed (existing) ───────────
export const ReconciliationCompletedSchema = z.object({
  factCount: z.number().optional(),
  conflictCount: z.number().optional(),
  overlapCount: z.number().optional(),
  gapCount: z.number().optional(),
  figureCount: z.number().optional(),
  warnings: z.array(z.string()).optional(),
});
export type ReconciliationCompletedPayload = z.infer<
  typeof ReconciliationCompletedSchema
>;

// ─────────── reconciliation:skipped ───────────
// no prod sample
export const ReconciliationSkippedSchema = z
  .object({
    reason: z.string().optional(),
    dimension: z.string().optional(),
  })
  .passthrough();
export type ReconciliationSkippedPayload = z.infer<
  typeof ReconciliationSkippedSchema
>;

// ─────────── reconciliation:warnings-orphaned ───────────
// no prod sample
export const ReconciliationWarningsOrphanedSchema = z
  .object({
    warnings: z.array(z.string()).optional(),
    reason: z.string().optional(),
  })
  .passthrough();
export type ReconciliationWarningsOrphanedPayload = z.infer<
  typeof ReconciliationWarningsOrphanedSchema
>;

// ─────────── event:oversized ───────────
// no prod sample
export const EventOversizedSchema = z
  .object({
    type: z.string().optional(),
    sizeBytes: z.number().optional(),
    capBytes: z.number().optional(),
  })
  .passthrough();
export type EventOversizedPayload = z.infer<typeof EventOversizedSchema>;

// ─────────── event:dropped ───────────
// no prod sample
export const EventDroppedSchema = z
  .object({
    type: z.string().optional(),
    reason: z.string().optional(),
  })
  .passthrough();
export type EventDroppedPayload = z.infer<typeof EventDroppedSchema>;

// ─────────── section:remediation:summary ───────────
// prod: { avgScoreDelta, evaluatedCount, remediatedCount }
export const SectionRemediationSummarySchema = z
  .object({
    avgScoreDelta: z.number().optional(),
    evaluatedCount: z.number().optional(),
    remediatedCount: z.number().optional(),
  })
  .passthrough();
export type SectionRemediationSummaryPayload = z.infer<
  typeof SectionRemediationSummarySchema
>;

// ─────────── failure-pattern:pre-applied ───────────
// no prod sample
export const FailurePatternPreAppliedSchema = z
  .object({
    dimension: z.string().optional(),
    pattern: z.string().optional(),
    disabledModels: z.array(z.string()).optional(),
  })
  .passthrough();
export type FailurePatternPreAppliedPayload = z.infer<
  typeof FailurePatternPreAppliedSchema
>;

// ─────────── leader:goals-set (existing) ───────────
export const LeaderGoalsSetSchema = z.object({
  goals: z.object({
    successCriteria: z.array(z.string()).optional(),
    deliverables: z.array(z.string()).optional(),
    qualityBar: z
      .object({
        minSources: z.number().optional(),
        minCoverage: z.number().optional(),
        hardConstraints: z.array(z.string()).optional(),
      })
      .partial()
      .optional(),
  }),
  initialRisks: z.array(RiskItemSchema).optional(),
});
export type LeaderGoalsSetPayload = z.infer<typeof LeaderGoalsSetSchema>;

// ─────────── leader:decision (existing) ───────────
export const LeaderDecisionSchema = z.object({
  phase: z.string(),
  stats: z.record(z.number()).optional(),
  rationale: z.string().optional(),
  retried: z.array(z.string()).optional(),
  aborted: z.array(z.string()).optional(),
  appended: z.array(DimensionSpecSchema).optional(),
  skipped: z.array(z.string()).optional(),
});
export type LeaderDecisionPayload = z.infer<typeof LeaderDecisionSchema>;

// ─────────── leader:foreword ───────────
// prod: { phase, howToRead, generatedAt, whatWeAnswered: [{evidence, addressed, criterion}] }
export const LeaderForewordSchema = z
  .object({
    phase: z.string().optional(),
    howToRead: z.string().optional(),
    generatedAt: z.string().optional(),
    whatWeAnswered: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type LeaderForewordPayload = z.infer<typeof LeaderForewordSchema>;

// ─────────── leader:signed ───────────
// prod: { phase, signed, leaderVerdict, refusalReason, accountabilityNote }
export const LeaderSignedSchema = z
  .object({
    phase: z.string().optional(),
    signed: z.boolean().optional(),
    leaderVerdict: z.string().optional(),
    refusalReason: z.string().optional(),
    accountabilityNote: z.string().optional(),
    score: z.number().optional(),
  })
  .passthrough();
export type LeaderSignedPayload = z.infer<typeof LeaderSignedSchema>;

// ─────────── leader:rejected-revision-recommended ───────────
// prod: { hint, leaderVerdict, refusalReason, leaderOverallScore }
export const LeaderRejectedRevisionRecommendedSchema = z
  .object({
    hint: z.string().optional(),
    leaderVerdict: z.string().optional(),
    refusalReason: z.string().optional(),
    leaderOverallScore: z.number().optional(),
  })
  .passthrough();
export type LeaderRejectedRevisionRecommendedPayload = z.infer<
  typeof LeaderRejectedRevisionRecommendedSchema
>;

// ─────────── dimension:retrying (existing) ───────────
export const DimensionRetryingSchema = z.object({
  dimension: z.string(),
  attempt: z.number().optional(),
  reason: z.string().optional(),
  strategy: z.string().optional(),
  retryLabel: z.string().optional(),
});
export type DimensionRetryingPayload = z.infer<typeof DimensionRetryingSchema>;

// ─────────── dimensions:appended (existing) ───────────
export const DimensionsAppendedSchema = z.object({
  items: z.array(DimensionSpecSchema),
  source: z.enum(["leader-chat", "leader-decision", "auto"]).optional(),
});
export type DimensionsAppendedPayload = z.infer<
  typeof DimensionsAppendedSchema
>;

// ─────────── iteration:progress ───────────
// prod: { role, agentId, progress, iteration, originalTs, maxIterations, approachingLimit }
export const IterationProgressSchema = z
  .object({
    role: z.string().optional(),
    agentId: z.string().optional(),
    progress: z.number().optional(),
    iteration: z.number().optional(),
    originalTs: z.number().optional(),
    maxIterations: z.number().optional(),
    approachingLimit: z.boolean().optional(),
  })
  .passthrough();
export type IterationProgressPayload = z.infer<typeof IterationProgressSchema>;

// ─────────── critic:verdict (existing) ───────────
export const CriticVerdictSchema = z.object({
  agentId: z.string().optional(),
  layer: z.string().optional(),
  score: z.number().optional(),
  pass: z.boolean().optional(),
  // ★ 2026-06-11 fix: warnings 是结构化条目，不是字符串。生产方（s9-reviewer-critic-l4
  //   + deep-insight-stage-bindings）均 emit 对象 { kind, message, severity }，消费方
  //   todo-board.projector 也按 { id?, message?, severity? } 读。旧 schema
  //   z.array(z.string()) 与产出不符 → EventBus safeParse 失败 → 整个 critic:verdict
  //   事件被丢弃 → 前端 critic 盲点 todos 缺失。改为对象数组 + passthrough（前向兼容）。
  warnings: z
    .array(
      z
        .object({
          kind: z.string().optional(),
          message: z.string().optional(),
          severity: z.string().optional(),
          id: z.string().optional(),
        })
        .passthrough(),
    )
    .optional(),
  notes: z.string().optional(),
});
export type CriticVerdictPayload = z.infer<typeof CriticVerdictSchema>;

// ─────────── red-team:verdict (Foresight L2 forecast 红队) ───────────
export const RedTeamVerdictSchema = z.object({
  robustness: z.number().optional(),
  vulnerabilityCount: z.number().optional(),
  couldBeWrongIfCount: z.number().optional(),
  rationale: z.string().optional(),
});
export type RedTeamVerdictPayload = z.infer<typeof RedTeamVerdictSchema>;
