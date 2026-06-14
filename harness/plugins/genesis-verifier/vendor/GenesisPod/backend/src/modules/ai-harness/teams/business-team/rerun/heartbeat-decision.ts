/**
 * BusinessAgentTeam — Mission heartbeat 9-cell decision matrix（pure function 框架）
 *
 * 上提自 ai-app/playground/services/mission/rerun/rerun-guard.service.ts @migrated-from
 * （2026-05-08 PR-E3）。RerunGuard 的核心算法是"heartbeat 三态 × business event
 * 三态"决策矩阵 — 与业务无关、与表/事件类型无关，是纯运算。其它 BusinessAgentTeam
 * 实例（research / writing / TI）反向迁移时可以直接复用。
 *
 * 业务侧仍持有：
 *   - 业务事件 prefix 列表（业务 namespace 决定）
 *   - eventTableName（业务表 schema）
 *   - markFailed / clearHeartbeat / emit zombie-cleanup 的执行
 *
 * 业务侧只需调 decideMissionInFlight + 自己的 latest-business-event-ts 查询，
 * 即得 inFlight / zombieDetected 判定结果。
 *
 * 参考决策（4 路 R1+R2 共识，rerun-overhaul-design-v1.md §3.1.1）：
 *   1. status !== running → 永远不 inFlight（短路）
 *   2. heartbeat fresh + business fresh → inFlight=true（真在跑）
 *   3. heartbeat fresh + business stale → zombieDetected=true（pod 还活但业务停了）
 *   4. heartbeat stale 或 null → inFlight=false（design §3.5.2 RV-7 不变量）
 */

/** heartbeat fresh 阈值：< 60s 视为 pod 心跳新鲜 */
export const HEARTBEAT_FRESH_THRESHOLD_MS_DEFAULT = 60_000;

/** business event fresh 阈值：< 5min 视为业务真活迹（最长 stage 间正常空隙） */
export const BUSINESS_EVENT_FRESH_THRESHOLD_MS_DEFAULT = 5 * 60_000;

export interface HeartbeatDecisionInput {
  /** mission 当前 status（业务 enum 字符串） */
  readonly status: string;
  /** heartbeat 距今 ms（null = heartbeat_at IS NULL） */
  readonly heartbeatAgeMs: number | null;
  /** 最近 BUSINESS 事件距今 ms（null = 0 业务事件，刚创建/刚 reopen） */
  readonly latestBusinessEventAgeMs: number | null;
  /** 可选：覆盖 heartbeat fresh 阈值（默认 60s） */
  readonly heartbeatFreshThresholdMs?: number;
  /** 可选：覆盖 business event fresh 阈值（默认 5min） */
  readonly businessEventFreshThresholdMs?: number;
  /** 可选：覆盖"running"判定字符串集合（默认 ["running"]） */
  readonly runningStatuses?: readonly string[];
}

export interface HeartbeatDecision {
  /** mission 当前是否真在跑（语义：拒重跑） */
  readonly inFlight: boolean;
  /** 检测到 zombie（heartbeat 新但 business 事件 STALE） */
  readonly zombieDetected: boolean;
  /** 给前端展示的 reason（仅 inFlight=true 时填） */
  readonly reason?: string;
}

/**
 * 纯函数：9-cell 决策矩阵（heartbeat 三态 × event 三态 × status）。
 *
 * 不读 DB、不 emit 事件、不 throw —— 纯运算。Caller 自己读 status / heartbeatAt /
 * latestBusinessEventTs，本函数返回判定结果。
 *
 * RV-6 不变量：纯读、无副作用。
 * RV-7 不变量：heartbeat stale 或 null → 永远不 inFlight=true。
 */
export function decideMissionInFlight(
  input: HeartbeatDecisionInput,
): HeartbeatDecision {
  const heartbeatThreshold =
    input.heartbeatFreshThresholdMs ?? HEARTBEAT_FRESH_THRESHOLD_MS_DEFAULT;
  const eventThreshold =
    input.businessEventFreshThresholdMs ??
    BUSINESS_EVENT_FRESH_THRESHOLD_MS_DEFAULT;
  const runningStatuses = input.runningStatuses ?? ["running"];

  // status 短路：终态直接放过（与 heartbeat / event 无关）
  if (!runningStatuses.includes(input.status)) {
    return { inFlight: false, zombieDetected: false };
  }

  const heartbeatFresh =
    input.heartbeatAgeMs != null && input.heartbeatAgeMs < heartbeatThreshold;
  const businessFresh =
    input.latestBusinessEventAgeMs != null &&
    input.latestBusinessEventAgeMs < eventThreshold;

  // cell 1: heartbeat fresh + business fresh = 真在跑
  if (heartbeatFresh && businessFresh) {
    return {
      inFlight: true,
      zombieDetected: false,
      reason: `heartbeat ${Math.round((input.heartbeatAgeMs ?? 0) / 1000)}s ago + business event ${Math.round((input.latestBusinessEventAgeMs ?? 0) / 1000)}s ago`,
    };
  }

  // cell 2: heartbeat fresh + business stale/null = zombie pod
  if (heartbeatFresh && !businessFresh) {
    return { inFlight: false, zombieDetected: true };
  }

  // cell 3-9: heartbeat stale/null → 永不 inFlight=true（RV-7）
  return { inFlight: false, zombieDetected: false };
}
