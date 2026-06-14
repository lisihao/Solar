/**
 * Hook payload 类型桶（v5.1 R0.5 PR-0 / standards/19 §三 规则 5）
 *
 * 解决 hook payload 类型循环依赖问题：
 *   - plugin 实现 HookHandler<P> 必须 import P
 *   - P 不能放 ai-engine / ai-harness（破坏分层）
 *   - P 不能放 plugins/<domain>/（互相耦合）
 *   - 唯一安全位置：plugins/core/abstractions/hook-payloads/
 *
 * 业务类型（ChatRequest / ToolCall / MissionContext 等）用 `unknown` 不透明引用，
 * harness/engine 在 fire 调用点 cast；plugin 实现侧从 payload cast 回业务类型。
 */
export type { HookMeta } from "./hook-meta";
export type { LlmRequestPayload, LlmResponsePayload } from "./llm";
export type {
  ToolBeforePayload,
  ToolWrapPayload,
  ToolAfterPayload,
} from "./tool";
export type { MissionStartPayload, MissionEndPayload } from "./mission";
export type { MemoryWritePayload, MemoryReadPayload } from "./memory";

// EXTENDED_HOOKS payloads（R0.5-E）
export type {
  EmbeddingRequestPayload,
  EmbeddingResponsePayload,
} from "./embedding";
export type { VectorQueryPayload, VectorQueryResultPayload } from "./vector";
export type { CircuitOpenPayload, CircuitClosePayload } from "./circuit";
export type {
  AgentStepBeforePayload,
  AgentStepAfterPayload,
} from "./agent-step";
export type { TeamHandoffPayload } from "./team-handoff";
export type {
  CheckpointSavePayload,
  CheckpointLoadPayload,
  CheckpointLoadResultPayload,
} from "./checkpoint";
export type {
  SafetyInputPayload,
  SafetyOutputPayload,
  SafetyDecisionPayload,
} from "./safety";
