/**
 * WritingEvents — writing.* 事件类型注册清单
 *
 * EventBus 校验：未注册的 type 一律 drop+warn，不会广播。
 * 所有 writing.* 事件必须在此声明，然后在 ai-writing.module.ts onModuleInit
 * 调用 registry.registerAll(WRITING_EVENTS)。
 *
 * S(suffix, schema) 工厂强制 "writing." 前缀，EventBus.emit() 会
 * 自动 safeParse(payload)，失败 dev/staging throw，生产 log.warn 静默 drop。
 *
 * 事件分类：
 *   stage:*    — orchestrator + dispatcher 桥接的 stage 生命周期信号
 *   mission:*  — mission 整体状态变更
 *   agent:*    — AgentInvoker + EventRelayFramework 中继的 agent 内部事件
 *   cost:*     — token 消耗计量（EventRelayFramework.tickCost）
 *   budget:*   — 预算告警（EventRelayFramework.tickCost）
 *   tools:*    — tool recall trace（EventRelayFramework.relayAgentEvents）
 *   iteration: — ReAct 循环进度（EventRelayFramework.relayAgentEvents）
 */

import type { DomainEventTypeSpec } from "@/modules/ai-harness/facade";
import type { z } from "zod";
import {
  // stage lifecycle
  StagLifecycleSchema,
  StageStalledSchema,
  StageDegradedSchema,
  // mission lifecycle
  MissionStartedSchema,
  MissionCompletedSchema,
  MissionCancelledSchema,
  MissionFailedSchema,
  MissionAbortedSchema,
  // agent events
  AgentLifecycleSchema,
  AgentNarrativeSchema,
  AgentThoughtSchema,
  AgentActionSchema,
  AgentObservationSchema,
  AgentReflectionSchema,
  AgentErrorSchema,
  AgentValidationRejectedSchema,
  // cost / budget
  CostTickSchema,
  BudgetWarningSoftSchema,
  BudgetExhaustedSchema,
  // tool trace / iteration
  ToolsRecalledSchema,
  IterationProgressSchema,
  // chapter lifecycle
  ChapterStartedSchema,
  ChapterContentSchema,
  ChapterCompletedSchema,
  // consistency check
  ConsistencyCheckStartedSchema,
  ConsistencyIssuesFoundSchema,
  ConsistencyFixCompletedSchema,
  // world building
  WorldBuildingStartedSchema,
  WorldBuildingCompletedSchema,
  // keeper context
  KeeperContextReadySchema,
} from "./writing.event-schemas";

/**
 * S(suffix, schema) — 注册带 zod payload schema 的事件。
 * type 强制拼接 "writing." 前缀，与 playground 的 S 工厂同构。
 */
const S = <TPayload>(
  suffix: string,
  schema: z.ZodType<TPayload>,
): DomainEventTypeSpec<TPayload> => ({
  type: `writing.${suffix}`,
  schema,
});

export const WRITING_EVENTS: readonly DomainEventTypeSpec[] = [
  // ── stage lifecycle ──────────────────────────────────────────────────────
  // orchestrator stage:started / stage:completed / stage:failed 经 dispatcher bridge 转发
  S("stage:lifecycle", StagLifecycleSchema),
  // orchestrator watchdog 检测 stage stall（started 后超阈值未完成）
  S("stage:stalled", StageStalledSchema),
  // ★ UNION：framework bridge（3字段）OR AgentInvoker.onDegrade（7字段）
  // 两个发射路径 payload shape 不同，必须用 union schema 否则其一被静默 drop
  S("stage:degraded", StageDegradedSchema),

  // ── mission lifecycle ────────────────────────────────────────────────────
  // s1-mission-budget-eval.stage.ts emit
  S("mission:started", MissionStartedSchema),
  // dispatcher.runMission onWon（lifecycleManager.finalize completed）
  S("mission:completed", MissionCompletedSchema),
  // dispatcher.runMission isGenuineCancel onWon
  S("mission:cancelled", MissionCancelledSchema),
  // dispatcher.handleMissionFailure onWon + catch block（runtime crashed）
  S("mission:failed", MissionFailedSchema),
  // dispatcher.bridgeOrchestratorEvent（orchestrator 内置 mission:aborted）
  S("mission:aborted", MissionAbortedSchema),

  // ── agent events（EventRelayFramework.relayAgentEvents via AgentInvoker）──
  // AgentInvoker.onAgentStart / onAgentEnd → relay.emitLifecycle
  S("agent:lifecycle", AgentLifecycleSchema),
  // narrate.ts factory via narrative.util.ts（NarrativeEvent shape）
  S("agent:narrative", AgentNarrativeSchema),
  // IAgentEvent "thinking" → relay
  S("agent:thought", AgentThoughtSchema),
  // IAgentEvent "action_planned" → relay
  S("agent:action", AgentActionSchema),
  // IAgentEvent "action_executed" → relay（parallel_tool_call 扇出为 N 个 observation）
  S("agent:observation", AgentObservationSchema),
  // IAgentEvent "reflection" → relay
  S("agent:reflection", AgentReflectionSchema),
  // IAgentEvent "error" → relay
  S("agent:error", AgentErrorSchema),
  // IAgentEvent "validation_failed" → relay
  S("agent:validation-rejected", AgentValidationRejectedSchema),

  // ── cost / budget（EventRelayFramework.tickCost）────────────────────────
  // 每次 stage token 消耗 → pool.recordSpend + emit
  S("cost:tick", CostTickSchema),
  // pool 使用量跨过 90% 软阈值（每 mission 仅发一次）
  S("budget:warning-soft", BudgetWarningSoftSchema),
  // pool.isExhausted()（每 mission 仅发一次，同时触发 abort）
  S("budget:exhausted", BudgetExhaustedSchema),

  // ── tool trace / iteration（EventRelayFramework.relayAgentEvents）────────
  // IAgentEvent "tools_recalled"
  S("tools:recalled", ToolsRecalledSchema),
  // IAgentEvent "iteration_progress"（ReAct 循环进度，P1 死循环防护）
  S("iteration:progress", IterationProgressSchema),

  // ── chapter lifecycle ────────────────────────────────────────────────────
  S("chapter:started", ChapterStartedSchema),
  S("chapter:content", ChapterContentSchema),
  S("chapter:completed", ChapterCompletedSchema),

  // ── consistency check ────────────────────────────────────────────────────
  S("consistency:check_started", ConsistencyCheckStartedSchema),
  S("consistency:issues_found", ConsistencyIssuesFoundSchema),
  S("consistency:fix_completed", ConsistencyFixCompletedSchema),

  // ── world building ───────────────────────────────────────────────────────
  S("world:building_started", WorldBuildingStartedSchema),
  S("world:building_completed", WorldBuildingCompletedSchema),

  // ── keeper context ───────────────────────────────────────────────────────
  S("keeper:context_ready", KeeperContextReadySchema),
];
