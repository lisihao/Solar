export {
  LlmExecutor,
  SchemaRetryExhaustedError,
  StubNotConfiguredError,
  isStubModeEnabled,
  extractJsonFromLlmContent,
} from "./llm-executor";
export type { LlmExecutorInput, LlmExecutorResult } from "./llm-executor";

// TokenBudgetService 属 engine 自有，ai-app 应从 @/modules/ai-engine/facade 导入；
// 此处不再 re-export 避免跨层间接路径
export { QueryLoopService } from "./query-loop.service";
export { TokenTrackerService } from "./token-tracker.service";
export { ExecutionCheckpointService } from "./execution-checkpoint.service";
export { SessionMemorySidecarService } from "./session-memory-sidecar.service";
export { FunctionCallingExecutor } from "./function-calling-executor";
export { AgentExecutorService } from "./agent-executor.service";

export type {
  QueryLoopConfig,
  QueryLoopResult,
  QueryLoopStopReason,
} from "./query-loop.service";
export type {
  TokenUsageSnapshot,
  TokenUsageEntry,
} from "./token-tracker.service";
// ContextCompactionPipelineService 属 engine 自有 — 已从此处移除 re-export，
// ai-app 应从 @/modules/ai-engine/facade 导入
export type { ExecutionCheckpoint } from "./execution-checkpoint.service";
export type {
  SidecarCategory,
  SidecarEntry,
  SidecarConfig,
} from "./session-memory-sidecar.service";
