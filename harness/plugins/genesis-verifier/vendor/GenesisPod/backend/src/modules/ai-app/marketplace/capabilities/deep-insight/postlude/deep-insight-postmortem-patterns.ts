/**
 * deep-insight 能力专属 postmortem patterns
 *
 * 注入到 harness PostmortemClassifierService（PostmortemPatterns caller-inject 设计）。
 * 含 deep-insight 业务概念：能力内核的 stage 事件类型 substring，与 playground 私有
 * PLAYGROUND_POSTMORTEM_PATTERNS 完全独立。
 *
 * 铁律（R1）：本文件零 app import，只依赖 harness facade 类型。
 *
 * ★ Fix C6（2026-06-09）：pattern substrings 已对齐 bufferedEvents 里实际出现的
 * type 值（AgentEventType union + mission/stage 事件）。
 *
 * 实际出现的 agent event type（AgentEventType union）：
 *   thinking | action_planned | action_executed | reflection | validation_failed |
 *   tools_recalled | iteration_progress | output | error | budget_warning | terminated
 * 实际出现的 mission/stage event type（deep-insight.runner.ts bridgeMissionEvent）：
 *   mission:started | mission:completed | mission:failed | mission:aborted |
 *   stage:started | stage:completed | stage:failed | stage:degraded | stage:stalled
 *
 * 已删除的无效 pattern（无可能匹配的 type）：
 *   - "tool:truncated"：实际无此 type（action_executed 是 tool 完成事件）
 *   - "llm:timeout" / "timeout"：无此 type，超时体现为 terminated 或 mission:aborted
 *   - "validation:failed"（冒号）：实际是 validation_failed（下划线）
 *   - "revision:stuck" / "researcher:retry"：无此 type（属 playground 私有事件）
 */
import type { PostmortemPatterns } from "@/modules/ai-harness/facade";

export const DEEP_INSIGHT_POSTMORTEM_PATTERNS: PostmortemPatterns = {
  // mission:aborted 对应用户取消（AbortSignal 触发）。
  userCancel: ["mission:aborted"],
  // validation_failed（下划线）是 AgentEventType 联合中的实际值；
  // 旧 "validation:failed"（冒号）从未出现在 bufferedEvents → 已替换。
  schemaReject: {
    substrings: ["validation_failed"],
    threshold: 3,
  },
  // budget_warning + terminated 均是 AgentEventType 实际值，预算/token 耗尽模式；
  // 旧 "llm:timeout" / "timeout" 从未出现 → 复用 llmTimeout key 承载预算/终止信号。
  llmTimeout: {
    substrings: ["budget_warning", "terminated"],
    threshold: 2,
  },
  // stage:stalled / stage:degraded 是 bridgeMissionEvent 实际 push 的 type；
  // 旧 "tool:truncated" 从未出现（action_executed 是 tool 完成的实际事件名）→ 替换。
  toolTruncation: {
    substrings: ["stage:stalled", "stage:degraded"],
    threshold: 2,
  },
  // error 是 AgentEventType 实际值；旧 "revision:stuck"/"researcher:retry" 是
  // playground 私有事件（非 bufferedEvents 中的 type）→ 用 error 替换。
  reviewerLoop: {
    substrings: ["error"],
    threshold: 3,
  },
};
