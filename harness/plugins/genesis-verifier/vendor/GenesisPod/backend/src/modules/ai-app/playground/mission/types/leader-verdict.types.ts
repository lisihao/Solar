/**
 * leader-verdict.types.ts — PR-R5b R2 共识 P0 (architect, 2026-05-07)
 *
 * 上游：docs/architecture/ai-harness/runner/per-task-rerun-with-cascade.md v1.2
 *
 * 集中定义 mission.leaderVerdict 字符串字面量 union，让前端 / 后端共享单一源。
 * 防 contract drift（参考 feedback_unitrack_audit_must_check_consumer.md）：
 *   - 后端改字面量 → 前端类型立即不兼容（编译期捕获）
 *   - 不允许 dispatcher / store / agent 写裸字符串 'auto-rerun-recovered'
 *
 * **同步给前端**：
 *   - frontend/lib/types/playground.ts 必须 import 同名 union 或常量
 *   - 改这里前先确认前端消费方（grep `LeaderVerdict` 或 `leaderVerdict ===`）
 */

/**
 * Leader 签字结论字面量
 *
 * - `'signed-pass'` ：Leader 真签，质量达标
 * - `'signed-fail'` ：Leader 真签，但拒签为 quality-failed
 * - `'auto-rerun-recovered'` ：Leader 没真签，由 rerun 入库恢复（chapter_drafts 重建）
 *   - **重要语义**：前端展示要显式标记"恢复模式"，统计 leaderboard 应排除
 * - 其它字符串：Leader agent 自由文本（向后兼容遗留 mission）
 */
export const LEADER_VERDICT_AUTO_RERUN_RECOVERED =
  "auto-rerun-recovered" as const;

export const LEADER_VERDICT_SIGNED_PASS = "signed-pass" as const;
export const LEADER_VERDICT_SIGNED_FAIL = "signed-fail" as const;

export type StandardLeaderVerdict =
  | typeof LEADER_VERDICT_AUTO_RERUN_RECOVERED
  | typeof LEADER_VERDICT_SIGNED_PASS
  | typeof LEADER_VERDICT_SIGNED_FAIL;

/**
 * 是否是 rerun 重建恢复的 verdict（前端 / 统计 exclude 用）
 */
export function isAutoRerunRecovered(
  verdict: string | null | undefined,
): boolean {
  return verdict === LEADER_VERDICT_AUTO_RERUN_RECOVERED;
}
