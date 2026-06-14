/**
 * Mission lifecycle hook payloads（v5.1 §11.4 CORE_HOOKS / standards/19）
 *
 * 命名规则：
 *   "harness.mission.start" → MissionStartPayload
 *   "harness.mission.end"   → MissionEndPayload
 */
import type { HookMeta } from "./hook-meta";

export interface MissionStartPayload {
  readonly __version: 1;
  readonly missionId: string;
  /** ai-harness MissionContext 业务类型不透明引用 */
  readonly missionContext: unknown;
  readonly startedAt: number;
  readonly meta: HookMeta;
}

export interface MissionEndPayload {
  readonly __version: 1;
  readonly missionId: string;
  readonly status: "completed" | "failed" | "cancelled";
  readonly completedAt: number;
  /** mission 结果业务类型不透明引用 */
  readonly result?: unknown;
  /** mission 失败原因业务类型不透明引用 */
  readonly error?: unknown;
  readonly meta: HookMeta;
}
