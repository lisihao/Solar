/**
 * Plugin Hook 命名常量（v5.1 §11.4 / standards/19 §五 规则 8）
 *
 * 命名规则：`{layer}.{aggregate}.{action}` 强制 lowercase + dot 分隔。
 *
 * 稳定性等级（SDK 发布对外承诺面）：
 *   - CORE_HOOKS：@stable，公开承诺，破坏性变更必须 major bump
 *   - EXTENDED_HOOKS：@experimental，接口可能改
 *
 * 与 payload 类型一一对应：见 ./hook-payloads/index.ts
 */

/**
 * @stable 首批 9 个核心 hook（R0.5 上线）
 */
export const CORE_HOOKS = {
  // engine 层（5 个，v5.1 P0-1 含 TOOL_WRAP）
  LLM_REQUEST: "engine.llm.request",
  LLM_RESPONSE: "engine.llm.response",
  TOOL_BEFORE: "engine.tool.before",
  TOOL_WRAP: "engine.tool.wrap",
  TOOL_AFTER: "engine.tool.after",
  // harness 层（4 个）
  MISSION_START: "harness.mission.start",
  MISSION_END: "harness.mission.end",
  MEMORY_WRITE: "harness.memory.write",
  MEMORY_READ: "harness.memory.read",
} as const;

/**
 * @experimental 二批扩展 hook（R0.5-E 全量迁移时新增）
 */
export const EXTENDED_HOOKS = {
  AGENT_STEP_BEFORE: "harness.agent.step.before",
  AGENT_STEP_AFTER: "harness.agent.step.after",
  TEAM_HANDOFF: "harness.team.handoff",
  CHECKPOINT_SAVE: "harness.checkpoint.save",
  CHECKPOINT_LOAD: "harness.checkpoint.load",
  EMBEDDING_REQUEST: "engine.embedding.request",
  VECTOR_QUERY: "engine.vector.query",
  SAFETY_INPUT: "engine.safety.input",
  SAFETY_OUTPUT: "engine.safety.output",
  CIRCUIT_OPEN: "engine.circuit.open",
  CIRCUIT_CLOSE: "engine.circuit.close",
} as const;

/** Hook id 是字符串开放集合：内核仅约定命名规则，不限制具体 id 列表 */
export type HookId = string;

export type CoreHookId = (typeof CORE_HOOKS)[keyof typeof CORE_HOOKS];
export type ExtendedHookId =
  (typeof EXTENDED_HOOKS)[keyof typeof EXTENDED_HOOKS];

/**
 * Hook abort 原因（v5.1 HIGH-3）
 * abort 必须携带 reason，let billing/audit plugin 在 abort 路径仍能记录配套事件
 */
export type HookAbortReason =
  | "cache-hit"
  | "rate-limited"
  | "permission-denied"
  | "validation-failed"
  | "timeout"
  | "circuit-open"
  | string;
