/**
 * leader-verdict.ts — 前端 mission.leaderVerdict 字面量 union（R2 共识 P0-NEW，2026-05-07）
 *
 * 上游：backend/src/modules/ai-app/agent-playground/types/leader-verdict.types.ts
 *
 * 本文件镜像后端 leader-verdict.types.ts 的字面量常量与 helper，
 * 让前端类型 union 与后端写入值保持单一源。
 *
 * **改本文件前必须先改后端**（contract 单向流向：backend → frontend）。
 *
 * 防漂移参考：CLAUDE.md feedback_unitrack_audit_must_check_consumer.md
 */

export const LEADER_VERDICT_AUTO_RERUN_RECOVERED =
  'auto-rerun-recovered' as const;
export const LEADER_VERDICT_SIGNED_PASS = 'signed-pass' as const;
export const LEADER_VERDICT_SIGNED_FAIL = 'signed-fail' as const;

/**
 * mission.leaderVerdict 完整字面量 union
 *
 * 历史值（向后兼容）: 'excellent' | 'good' | 'acceptable' | 'failed'
 * R5b 新值（2026-05-07）: 'auto-rerun-recovered' | 'signed-pass' | 'signed-fail'
 *
 * 前端消费方应用 `verdict === LEADER_VERDICT_AUTO_RERUN_RECOVERED` 判断恢复模式，
 * 不要 hard-code 字符串字面量。
 */
export type LeaderVerdict =
  | 'excellent'
  | 'good'
  | 'acceptable'
  | 'failed'
  | typeof LEADER_VERDICT_AUTO_RERUN_RECOVERED
  | typeof LEADER_VERDICT_SIGNED_PASS
  | typeof LEADER_VERDICT_SIGNED_FAIL;

/**
 * 是否是 rerun 重建恢复 — 前端 mission detail / leaderboard 应据此切换 UI
 * （展示"恢复模式"标识 + 统计排除）。
 */
export function isAutoRerunRecovered(
  verdict: string | null | undefined
): boolean {
  return verdict === LEADER_VERDICT_AUTO_RERUN_RECOVERED;
}
