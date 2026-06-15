/**
 * SocialEvents — EventBus 事件类型注册清单
 *
 * 未注册的 type 会被 EventBus drop+warn 不广播。所有 social.* 事件必须
 * 在此声明。Mirror of playground/playground.events.ts。
 */

import type { DomainEventTypeSpec } from "@/modules/ai-harness/facade";
import type { z } from "zod";
import {
  MissionStartedSchema,
  MissionCompletedSchema,
  MissionFailedSchema,
  MissionAbortedSchema,
  MissionDegradedSchema,
  MissionWarningSchema,
  MissionGatedSchema,
  MissionPostludeStartedSchema,
  MissionPostludeCompletedSchema,
  MissionPostludeFailedSchema,
  StageStartedSchema,
  StageCompletedSchema,
  StageFailedSchema,
  StageDegradedSchema,
  StageStalledSchema,
  StageLifecycleSchema,
  AgentLifecycleSchema,
  AgentThoughtSchema,
  AgentActionSchema,
  AgentObservationSchema,
  AgentErrorSchema,
  AgentNarrativeSchema,
  CostTickSchema,
  BudgetExhaustedSchema,
  PublishExecuteSummarySchema,
  PublishVerifySummarySchema,
  ToolsRecalledSchema,
  IterationProgressSchema,
  AgentValidationRejectedSchema,
} from "./social-event-schemas";

const S = <TPayload>(
  suffix: string,
  schema: z.ZodType<TPayload>,
): DomainEventTypeSpec<TPayload> => ({
  type: `social.${suffix}`,
  schema,
});

export const SOCIAL_EVENTS: readonly DomainEventTypeSpec[] = [
  // mission lifecycle
  S("mission:started", MissionStartedSchema),
  S("mission:completed", MissionCompletedSchema),
  S("mission:failed", MissionFailedSchema),
  S("mission:aborted", MissionAbortedSchema),
  S("mission:degraded", MissionDegradedSchema),
  S("mission:warning", MissionWarningSchema),
  // 2026-05-19: s1-mission-budget-eval emit'd `mission:gated` but registry 漏注册 → 全部被 drop
  S("mission:gated", MissionGatedSchema),
  S("mission:postlude:started", MissionPostludeStartedSchema),
  S("mission:postlude:completed", MissionPostludeCompletedSchema),
  S("mission:postlude:failed", MissionPostludeFailedSchema),
  // stage lifecycle
  S("stage:started", StageStartedSchema),
  S("stage:completed", StageCompletedSchema),
  S("stage:failed", StageFailedSchema),
  S("stage:degraded", StageDegradedSchema),
  S("stage:stalled", StageStalledSchema),
  S("stage:lifecycle", StageLifecycleSchema),
  // agent lifecycle
  S("agent:lifecycle", AgentLifecycleSchema),
  S("agent:thought", AgentThoughtSchema),
  S("agent:action", AgentActionSchema),
  S("agent:observation", AgentObservationSchema),
  S("agent:error", AgentErrorSchema),
  S("agent:narrative", AgentNarrativeSchema),
  // cost / budget
  S("cost:tick", CostTickSchema),
  S("budget:exhausted", BudgetExhaustedSchema),
  // publish-specific
  S("publish:executed", PublishExecuteSummarySchema),
  S("publish:verified", PublishVerifySummarySchema),
  // 2026-05-19 agent runner 通用事件（agent invoker / tool selector / iteration loop 都会 emit）
  S("tools:recalled", ToolsRecalledSchema),
  S("iteration:progress", IterationProgressSchema),
  S("agent:validation-rejected", AgentValidationRejectedSchema),
];
