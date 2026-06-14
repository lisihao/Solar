/**
 * AI Engine Harness — 一等公民 Agent 运行时脚手架
 *
 * 消费入口：
 *   - 类型：import type { IAgent, IAgentSpec, ... } from "@/modules/ai-harness/agents/abstractions"
 *   - 服务：import { HarnessFacade } from "@/modules/ai-harness"
 *   - Module：import { HarnessModule } from "@/modules/ai-harness"
 */

export * from "./agents/abstractions";
export { HarnessFacade } from "./facade";
export { HarnessModule } from "./harness.module";
export { AgentFactory } from "./agents/core/agent-factory";
export { SpecBasedAgent } from "./agents/core/spec-based-agent";
export { SpecAgentRegistry } from "./agents/core/spec-agent-registry";
export {
  LlmExecutor,
  SchemaRetryExhaustedError,
  StubNotConfiguredError,
} from "./runner/executor/llm-executor";
export type {
  LlmExecutorInput,
  LlmExecutorResult,
} from "./runner/executor/llm-executor";
