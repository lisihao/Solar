/**
 * Writing event payload Zod schemas — single source of truth.
 *
 * EventBus 校验：EventBus.emit() 在 emit 时调用 spec.schema.safeParse(payload)；
 * 失败则 dev/staging 直接 throw，生产降级 log.warn 静默 drop。
 *
 * 字段来源逐一对照实际 emit 点（2026-05-31）：
 *   stage:lifecycle    — business-team-mission-dispatcher.framework.ts bridgeOrchestratorStageEvent
 *   stage:stalled      — business-team-mission-dispatcher.framework.ts bridgeOrchestratorStageEvent
 *   stage:degraded     — 双源 union（见下方详细注释）
 *   mission:started    — s1-mission-budget-eval.stage.ts (payload: { input, startedAt })
 *   mission:completed  — writing-pipeline-dispatcher.service.ts onWon (payload: { wallTimeMs })
 *   mission:cancelled  — writing-pipeline-dispatcher.service.ts onWon (payload: { reason })
 *   mission:failed     — writing-pipeline-dispatcher.service.ts handleMissionFailure + catch
 *   mission:aborted    — writing-pipeline-dispatcher.service.ts bridgeOrchestratorEvent
 *   agent:lifecycle    — event-relay.framework.ts emitLifecycle
 *   agent:narrative    — narrate.ts + narrative.util.ts (NarrativeEvent shape)
 *   agent:thought/action/observation/reflection/error/validation-rejected
 *                      — event-relay.framework.ts relayAgentEvents
 *   cost:tick          — event-relay.framework.ts tickCost
 *   budget:warning-soft— event-relay.framework.ts tickCost (pool snapshot spread + ratios)
 *   budget:exhausted   — event-relay.framework.ts tickCost (pool snapshot spread)
 *   tools:recalled     — event-relay.framework.ts relayAgentEvents
 *   iteration:progress — event-relay.framework.ts relayAgentEvents
 */

import { z } from "zod";

// ─────────────────────── common sub-schemas ───────────────────────────────

/** MissionBudgetPool.snapshot() shape — used by budget:warning-soft + budget:exhausted */
const BudgetPoolSnapshotSchema = z
  .object({
    poolTokensUsed: z.number().optional(),
    poolCostUsd: z.number().optional(),
    poolTokensRemaining: z.number().optional(),
    poolCostRemaining: z.number().optional(),
  })
  .passthrough();

// ─────────────────────── stage lifecycle ──────────────────────────────────

/**
 * writing.stage:lifecycle
 * Source: bridgeOrchestratorStageEvent (stage:started / stage:completed / stage:failed)
 * Payload: { stage, stepId, primitive?, status, output?, error? }
 */
export const StagLifecycleSchema = z
  .object({
    stage: z.string(),
    stepId: z.string(),
    primitive: z.string().optional(),
    status: z.enum(["started", "completed", "failed"]),
    output: z.record(z.unknown()).optional(),
    error: z.string().optional(),
  })
  .passthrough();
export type StagLifecyclePayload = z.infer<typeof StagLifecycleSchema>;

/**
 * writing.stage:stalled
 * Source: bridgeOrchestratorStageEvent (stage:stalled from MissionPipelineOrchestrator watchdog)
 * Payload: { stage, stepId, elapsedMs?, reason? }
 */
export const StageStalledSchema = z
  .object({
    stage: z.string(),
    stepId: z.string(),
    elapsedMs: z.number().optional(),
    reason: z.string().optional(),
  })
  .passthrough();
export type StageStalledPayload = z.infer<typeof StageStalledSchema>;

/**
 * writing.stage:degraded — ★ UNION SCHEMA (two emit sources, different field sets)
 *
 * Source A — framework bridge (business-team-mission-dispatcher.framework.ts:176)
 *   AND WritingMissionStoreService.markStageDegraded (3-field shape):
 *     { stage, stepId, reason }
 *   Note: markStageDegraded also emits stepId into stage field — same 3-field shape.
 *
 * Source B — AgentInvoker.onDegrade (agent-invoker.service.ts:151, 7-field shape):
 *     { stage, reason, role, agentId, attempts, error, transient }
 *   Note: this source does NOT include stepId.
 *
 * Using z.discriminatedUnion is not possible because both branches share "stage"
 * and neither has an exclusive discriminator key. We use z.union instead.
 * The EventBus will accept payload matching either branch.
 */
const StageDegradedFrameworkSchema = z
  .object({
    /** stage name / stepId (string identifier) */
    stage: z.string(),
    /** stepId from orchestrator (present on framework + store paths) */
    stepId: z.string(),
    reason: z.string(),
  })
  .passthrough();

const StageDegradedInvokerSchema = z
  .object({
    /** role name used as stage in invoker path */
    stage: z.string(),
    reason: z.string(),
    role: z.string(),
    agentId: z.string(),
    attempts: z.number(),
    error: z.string(),
    transient: z.boolean(),
  })
  .passthrough();

export const StageDegradedSchema = z.union([
  StageDegradedFrameworkSchema,
  StageDegradedInvokerSchema,
]);
export type StageDegradedPayload = z.infer<typeof StageDegradedSchema>;

// ─────────────────────── mission lifecycle ────────────────────────────────

/**
 * writing.mission:started
 * Source: s1-mission-budget-eval.stage.ts (deps.emit)
 * Payload: { input, startedAt }
 */
export const MissionStartedSchema = z
  .object({
    input: z.record(z.unknown()).optional(),
    startedAt: z.number().optional(),
  })
  .passthrough();
export type MissionStartedPayload = z.infer<typeof MissionStartedSchema>;

/**
 * writing.mission:completed
 * Source: writing-pipeline-dispatcher.service.ts onWon (lifecycleManager.finalize)
 * Payload: { wallTimeMs }
 */
export const MissionCompletedSchema = z
  .object({
    wallTimeMs: z.number().optional(),
  })
  .passthrough();
export type MissionCompletedPayload = z.infer<typeof MissionCompletedSchema>;

/**
 * writing.mission:cancelled
 * Source: writing-pipeline-dispatcher.service.ts isGenuineCancel onWon
 * Payload: { reason }
 */
export const MissionCancelledSchema = z
  .object({
    reason: z.string().optional(),
  })
  .passthrough();
export type MissionCancelledPayload = z.infer<typeof MissionCancelledSchema>;

/**
 * writing.mission:failed
 * Source: writing-pipeline-dispatcher.service.ts handleMissionFailure (onWon)
 *   AND catch block (runtime crashed path)
 * Payload: { message, failureCode, wallTimeMs, errorName? }
 *   The catch-block path also emits errorName. All optional for robustness.
 */
export const MissionFailedSchema = z
  .object({
    message: z.string().optional(),
    failureCode: z.string().optional(),
    wallTimeMs: z.number().optional(),
    errorName: z.string().optional(),
  })
  .passthrough();
export type MissionFailedPayload = z.infer<typeof MissionFailedSchema>;

/**
 * writing.mission:aborted
 * Source: writing-pipeline-dispatcher.service.ts bridgeOrchestratorEvent (mission:aborted)
 * Payload: { reason?, wallTimeMs }
 */
export const MissionAbortedSchema = z
  .object({
    reason: z.string().optional(),
    wallTimeMs: z.number().optional(),
  })
  .passthrough();
export type MissionAbortedPayload = z.infer<typeof MissionAbortedSchema>;

// ─────────────────────── agent events ────────────────────────────────────

/**
 * writing.agent:lifecycle
 * Source: EventRelayFramework.emitLifecycle → { agentId, role, phase, ...detail }
 * detail fields from AgentInvoker.onAgentEnd: { wallTimeMs, iterations?, error? }
 */
export const AgentLifecycleSchema = z
  .object({
    agentId: z.string(),
    role: z.string(),
    phase: z.enum(["started", "completed", "failed"]),
    wallTimeMs: z.number().optional(),
    iterations: z.number().optional(),
    error: z.string().optional(),
  })
  .passthrough();
export type AgentLifecyclePayload = z.infer<typeof AgentLifecycleSchema>;

/**
 * writing.agent:narrative
 * Source: narrate.ts via narrative.util.ts NarrativeEvent shape
 * Payload: { stage, role, tag, text, dimension?, chapterIndex?, agentId? }
 */
export const AgentNarrativeSchema = z
  .object({
    stage: z.string(),
    role: z.string(),
    tag: z.enum([
      "thinking",
      "planning",
      "searching",
      "scraping",
      "analyzing",
      "writing",
      "reviewing",
      "judging",
      "publishing",
      "verifying",
      "signing",
      "warning",
      "success",
      "info",
    ]),
    text: z.string(),
    dimension: z.string().optional(),
    chapterIndex: z.number().optional(),
    agentId: z.string().optional(),
  })
  .passthrough();
export type AgentNarrativePayload = z.infer<typeof AgentNarrativeSchema>;

/**
 * writing.agent:thought
 * Source: EventRelayFramework.relayAgentEvents (ev.type === "thinking")
 */
export const AgentThoughtSchema = z
  .object({
    agentId: z.string(),
    role: z.string(),
    text: z.string(),
    tokenCount: z.number().optional(),
    modelId: z.string().optional(),
    originalTs: z.number().optional(),
  })
  .passthrough();
export type AgentThoughtPayload = z.infer<typeof AgentThoughtSchema>;

/**
 * writing.agent:action
 * Source: EventRelayFramework.relayAgentEvents (ev.type === "action_planned")
 */
export const AgentActionSchema = z
  .object({
    agentId: z.string(),
    role: z.string(),
    kind: z.string(),
    toolId: z.string().optional(),
    skillId: z.string().optional(),
    subagentName: z.string().optional(),
    input: z.unknown().optional(),
    calls: z.array(z.unknown()).optional(),
    originalTs: z.number().optional(),
  })
  .passthrough();
export type AgentActionPayload = z.infer<typeof AgentActionSchema>;

/**
 * writing.agent:observation
 * Source: EventRelayFramework.relayAgentEvents (ev.type === "action_executed")
 * Note: parallel_tool_call is fanned out into N separate observation events.
 */
export const AgentObservationSchema = z
  .object({
    agentId: z.string(),
    role: z.string(),
    kind: z.string().optional(),
    toolId: z.string().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    latencyMs: z.number().optional(),
    tokensUsed: z.number().optional(),
    originalTs: z.number().optional(),
  })
  .passthrough();
export type AgentObservationPayload = z.infer<typeof AgentObservationSchema>;

/**
 * writing.agent:reflection
 * Source: EventRelayFramework.relayAgentEvents (ev.type === "reflection")
 */
export const AgentReflectionSchema = z
  .object({
    agentId: z.string(),
    role: z.string(),
    revision: z.number().optional(),
    score: z.number().optional(),
    verdicts: z
      .array(
        z.object({
          judgeId: z.string(),
          score: z.number(),
          critique: z.string(),
        }),
      )
      .optional(),
    text: z.string().optional(),
    verdict: z.string().optional(),
    originalTs: z.number().optional(),
  })
  .passthrough();
export type AgentReflectionPayload = z.infer<typeof AgentReflectionSchema>;

/**
 * writing.agent:error
 * Source: EventRelayFramework.relayAgentEvents (ev.type === "error")
 */
export const AgentErrorSchema = z
  .object({
    agentId: z.string(),
    role: z.string(),
    message: z.string(),
    originalTs: z.number().optional(),
  })
  .passthrough();
export type AgentErrorPayload = z.infer<typeof AgentErrorSchema>;

/**
 * writing.agent:validation-rejected
 * Source: EventRelayFramework.relayAgentEvents (ev.type === "validation_failed")
 */
export const AgentValidationRejectedSchema = z
  .object({
    agentId: z.string(),
    role: z.string(),
    rejectCount: z.number(),
    maxRejects: z.number(),
    issues: z.string(),
    originalTs: z.number().optional(),
  })
  .passthrough();
export type AgentValidationRejectedPayload = z.infer<
  typeof AgentValidationRejectedSchema
>;

// ─────────────────────── cost / budget ────────────────────────────────────

/**
 * writing.cost:tick
 * Source: EventRelayFramework.tickCost
 * Payload: { stage, deltaTokens, deltaCostUsd, tokensUsed, costUsd }
 */
export const CostTickSchema = z
  .object({
    stage: z.string(),
    deltaTokens: z.number(),
    deltaCostUsd: z.number(),
    tokensUsed: z.number(),
    costUsd: z.number(),
  })
  .passthrough();
export type CostTickPayload = z.infer<typeof CostTickSchema>;

/**
 * writing.budget:warning-soft
 * Source: EventRelayFramework.tickCost (90% threshold crossed)
 * Payload: pool snapshot spread + { ratio, tokenRatio, costRatio, threshold }
 */
export const BudgetWarningSoftSchema = BudgetPoolSnapshotSchema.extend({
  ratio: z.number(),
  tokenRatio: z.number(),
  costRatio: z.number(),
  threshold: z.number(),
}).passthrough();
export type BudgetWarningSoftPayload = z.infer<typeof BudgetWarningSoftSchema>;

/**
 * writing.budget:exhausted
 * Source: EventRelayFramework.tickCost (pool.isExhausted())
 * Payload: pool snapshot spread
 */
export const BudgetExhaustedSchema = BudgetPoolSnapshotSchema;
export type BudgetExhaustedPayload = z.infer<typeof BudgetExhaustedSchema>;

// ─────────────────────── chapter lifecycle ───────────────────────────────

/**
 * writing.chapter:started
 * Payload: { chapterNumber, title }
 */
export const ChapterStartedSchema = z
  .object({
    chapterNumber: z.number(),
    title: z.string(),
  })
  .passthrough();
export type ChapterStartedPayload = z.infer<typeof ChapterStartedSchema>;

/**
 * writing.chapter:content
 * Payload: { chapterNumber, title, content, wordCount, volumeIndex }
 */
export const ChapterContentSchema = z
  .object({
    chapterNumber: z.number(),
    title: z.string(),
    content: z.string(),
    wordCount: z.number(),
    volumeIndex: z.number(),
  })
  .passthrough();
export type ChapterContentPayload = z.infer<typeof ChapterContentSchema>;

/**
 * writing.chapter:completed
 * Payload: { chapterNumber, wordCount }
 */
export const ChapterCompletedSchema = z
  .object({
    chapterNumber: z.number(),
    wordCount: z.number(),
  })
  .passthrough();
export type ChapterCompletedPayload = z.infer<typeof ChapterCompletedSchema>;

// ─────────────────────── consistency check ────────────────────────────────

/**
 * writing.consistency:check_started
 * Payload: { chapterNumber? }
 */
export const ConsistencyCheckStartedSchema = z
  .object({
    chapterNumber: z.number().optional(),
  })
  .passthrough();
export type ConsistencyCheckStartedPayload = z.infer<
  typeof ConsistencyCheckStartedSchema
>;

/**
 * writing.consistency:issues_found
 * Payload: { chapterNumber, issues }
 */
export const ConsistencyIssuesFoundSchema = z
  .object({
    chapterNumber: z.number(),
    issues: z.array(
      z.object({
        type: z.string(),
        severity: z.string(),
        description: z.string(),
        suggestion: z.string().optional(),
      }),
    ),
  })
  .passthrough();
export type ConsistencyIssuesFoundPayload = z.infer<
  typeof ConsistencyIssuesFoundSchema
>;

/**
 * writing.consistency:fix_completed
 * Payload: { chapterNumber, fixedIssues }
 */
export const ConsistencyFixCompletedSchema = z
  .object({
    chapterNumber: z.number(),
    fixedIssues: z.number(),
  })
  .passthrough();
export type ConsistencyFixCompletedPayload = z.infer<
  typeof ConsistencyFixCompletedSchema
>;

// ─────────────────────── world building ──────────────────────────────────

/**
 * writing.world:building_started
 * Payload: {}
 */
export const WorldBuildingStartedSchema = z.object({}).passthrough();
export type WorldBuildingStartedPayload = z.infer<
  typeof WorldBuildingStartedSchema
>;

/**
 * writing.world:building_completed
 * Payload: { settings? }
 */
export const WorldBuildingCompletedSchema = z
  .object({
    settings: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type WorldBuildingCompletedPayload = z.infer<
  typeof WorldBuildingCompletedSchema
>;

// ─────────────────────── keeper context ──────────────────────────────────

/**
 * writing.keeper:context_ready
 * Payload: { chapterNumber, context? }
 */
export const KeeperContextReadySchema = z
  .object({
    chapterNumber: z.number(),
    context: z
      .object({
        relevantCharacters: z.array(z.string()).optional(),
        relevantLocations: z.array(z.string()).optional(),
        previousEvents: z.array(z.string()).optional(),
        warnings: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .passthrough();
export type KeeperContextReadyPayload = z.infer<
  typeof KeeperContextReadySchema
>;

// ─────────────────────── tool trace ───────────────────────────────────────

/**
 * writing.tools:recalled
 * Source: EventRelayFramework.relayAgentEvents (ev.type === "tools_recalled")
 */
export const ToolsRecalledSchema = z
  .object({
    agentId: z.string(),
    role: z.string(),
    recalledIds: z.array(z.string()),
    categories: z.array(z.string()),
    source: z.string(),
    preferIds: z.array(z.string()),
    originalTs: z.number().optional(),
  })
  .passthrough();
export type ToolsRecalledPayload = z.infer<typeof ToolsRecalledSchema>;

/**
 * writing.iteration:progress
 * Source: EventRelayFramework.relayAgentEvents (ev.type === "iteration_progress")
 */
export const IterationProgressSchema = z
  .object({
    agentId: z.string(),
    role: z.string(),
    iteration: z.number(),
    maxIterations: z.number(),
    progress: z.number(),
    approachingLimit: z.boolean(),
    lastActionKind: z.string().optional(),
    originalTs: z.number().optional(),
  })
  .passthrough();
export type IterationProgressPayload = z.infer<typeof IterationProgressSchema>;
