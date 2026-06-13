/**
 * DX entry — AI App 业务方的唯一进入点
 *
 * 业务方只需 `import { DefineAgent, AgentSpec, AgentRunner }` from
 * "@/modules/ai-harness/agents/dev-tools"，从此告别样板代码。
 */

export {
  DefineAgent,
  AgentSpec,
  readDefineAgentMeta,
  type DefineAgentOptions,
} from "./agent-spec.base";

export {
  AgentRunner,
  type RunResult,
  DefineAgentMissingError,
  InputValidationError,
} from "./agent-runner.service";

export { FixtureStore, type RecordedRun } from "./fixture-store";

// ★ 2026-05-22 契约单一源机制：CI 断言"生产方范围 ⊆ 消费方 agent schema"
export {
  assertNumberProducerWithinSchema,
  getNumberFieldBounds,
  type NumberFieldBounds,
  type ContractAssertResult,
} from "./contract-assertions";

// HarnessInspectorController moved to open-api/admin/harness-inspector.controller.ts (PR-X17)
