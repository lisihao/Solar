/**
 * leader-failure-diagnostic —— Leader runFn 失败诊断（playground 业务专属）
 *
 * 拆自 leader.service.ts (PR-10c 2026-05-04 单文件 504 行违反 standards/16 §六)。
 *
 * 设计：
 *   • 把 leader.* runFn result 转为带诊断的失败摘要
 *   • 优先级：events 里的 failureCode > extractFailureMessage 文本 > generic state
 *   • LEADER_RECOVERABLE 列表给 self-heal 重试做判断
 *
 * 留 app：含 LeaderAgent 4 milestone 业务语义；自愈策略是 playground 产品决策。
 */

import {
  extractAgentFailureDiagnostic,
  extractFailureMessage,
} from "@/modules/ai-harness/facade";

/**
 * Recoverable failure codes —— Leader 自愈重试时识别这些码做一次重跑（+50% budget），
 * 因为它们都是 LLM 一次性偶发问题（schema 不达标 / 截断 / 空响应），重试通常能过。
 */
export const LEADER_RECOVERABLE_CODES = new Set([
  "RUNNER_OUTPUT_SCHEMA_MISMATCH",
  "RUNNER_WALL_TIME_EXCEEDED",
  // ★ 2026-05-23 fix：harness 从不 emit "RUNNER_LOOP_LIMIT"。真实码是
  //   LOOP_MAX_ITERATIONS / LOOP_BUDGET_EXHAUSTED，原来挂死码导致最常见退出不可自愈。
  "LOOP_MAX_ITERATIONS",
  "LOOP_BUDGET_EXHAUSTED",
  "LOOP_EMPTY_RESPONSE_IMMEDIATE",
  "LOOP_REASONING_COT_EXHAUSTION",
  "PARSE_MALFORMED_JSON",
  "PARSE_MISSING_ACTION",
  "PARSE_UNKNOWN_ACTION_KIND",
  "PARSE_EMPTY_ACTIONS_ARRAY",
  "BUSINESS_RULE_VIOLATION",
]);

/**
 * 把 leader.* runFn result 转为带诊断的失败摘要（用于 throw 时 UI 能看清楚到底挂在哪）。
 * 优先级：events 里的 failureCode > extractFailureMessage 文本 > generic state。
 */
export function describeLeaderFailure(
  phase: string,
  res: {
    state: "completed" | "degraded" | "failed" | "cancelled";
    output?: unknown;
    events?: readonly unknown[];
  },
): { code: string; message: string; recoverable: boolean } {
  const events = (res.events ?? []) as Parameters<
    typeof extractAgentFailureDiagnostic
  >[0];
  const diag = extractAgentFailureDiagnostic(events);
  const code = diag?.failureCode ?? "UNKNOWN";
  const friendly = extractFailureMessage(events, res.state, !!res.output);
  const message =
    friendly ??
    (res.state !== "completed"
      ? `agent state=${res.state}`
      : !res.output
        ? `agent 没有产出 output`
        : `agent 输出 phase 不是 ${phase}`);
  return {
    code,
    message,
    recoverable: LEADER_RECOVERABLE_CODES.has(code),
  };
}
