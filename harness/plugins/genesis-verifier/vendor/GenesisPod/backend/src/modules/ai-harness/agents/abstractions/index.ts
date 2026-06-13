/**
 * Harness Abstractions — 所有一等公民接口的统一入口
 *
 * 外部消费者只从这里引用类型，禁止穿透到单个 interface 文件。
 *
 * 双 Agent 体系说明（PR-X5）：
 *   - IAgent (agent.interface.ts) = 新一代 harness 运行时实例接口（推荐）
 *   - plan-based-agent.interface.ts = 旧 ReAct-mode 接口（BaseAgent/ReactiveAgent/PlanAgent），
 *     标记 @deprecated，但保留兼容性，供 ai-app/research 等旧式 Agent 使用
 */

export * from "./identity.interface";
export * from "./agent.types";
export * from "./agent.interface";
export * from "./agent-loop.interface";
export * from "./context-envelope.interface";
export * from "./skill.interface";
export * from "./subagent.interface";
export * from "./hook.interface";
export * from "./action.interface";
export * from "./agent-event.interface";
export * from "./harness.interface";
export * from "./runtime-env.interface";
export * from "./mission.types";
// Legacy ReAct-mode types — see plan-based-agent.interface.ts @deprecated notice
export type {
  AgentContext,
  AgentMemory,
  AgentMessage,
  AgentOutput,
  AgentArtifact,
  ToolCallRecord,
  SkillCallRecord,
  AgentResult,
  AgentResultError,
  AgentResultMetadata,
  ExecutionPlan,
  ReActPlanStep,
  AgentEventType,
  AgentCapability,
  AgentDefinition,
} from "./plan-based-agent.interface";
export type {
  AgentEvent as LegacyAgentEvent,
  IAgent as LegacyIAgent,
} from "./plan-based-agent.interface";
