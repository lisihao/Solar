/**
 * runner-state.util — AgentRunner result state normalizer
 *
 * AgentRunner can return "degraded" (reflexion verifier 评分 < passThreshold
 * 但 outputSchema 合法的次优产物 — 仍可用). 老 role services 用 ternary 折成
 * "failed"，导致 degraded 被误判 → mission 整体失败。
 *
 * 沉淀历史：多 ai-app 双源 copy（feedback_no_dual_sources），第 2 处使用即
 * 上提到 harness facade（2026-05-16）；后续 ai-app role services 直接
 * `import { normalizeRunnerState } from "@/modules/ai-harness/facade"`。
 */

export type NormalizedRunnerState =
  | "completed"
  | "degraded"
  | "failed"
  | "cancelled";

export function normalizeRunnerState(s: unknown): NormalizedRunnerState {
  if (s === "completed" || s === "degraded" || s === "cancelled") return s;
  return "failed";
}
