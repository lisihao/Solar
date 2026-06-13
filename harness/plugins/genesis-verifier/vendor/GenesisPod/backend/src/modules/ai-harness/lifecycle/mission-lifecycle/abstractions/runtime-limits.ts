/**
 * ResolvedRuntimeLimits / MissionLifecycleMetrics —— C4 / G5（2026-05-22）：
 * 把二义字段 `wallTimeMs` 在**类型层面**拆成两个语义清晰的概念（single source of truth）。
 *
 * 病根：`wallTimeMs` 同时表示「配置上限」(部分 app 在 createMissionRow 写) 与「实测耗时」
 * (部分 app 在 markCompleted 写)，跨 app 同名异义 → 误读。
 *
 * 拆分：
 *   - ResolvedRuntimeLimits.wallTimeCapMs —— 配置上限（mission 最多能跑多久）。
 *   - MissionLifecycleMetrics.elapsedWallTimeMs —— 实测耗时（mission 实际跑了多久）。
 * 二者是不同字段、不同来源、不同读者；全栈禁用裸 `wallTimeMs`（L1 类型 + L3 看护）。
 */

/** mission 运行时上限（cap）—— 配置态，启动时确定。 */
export interface ResolvedRuntimeLimits {
  /** wall-time 上限（ms）。0 = 不限。 */
  readonly wallTimeCapMs: number;
  readonly maxIterations?: number;
  readonly maxConcurrentAgents?: number;
}

/** mission 生命周期度量（metrics）—— 实测态，终态时填充。 */
export interface MissionLifecycleMetrics {
  /** 实测耗时（ms）= 终态时刻 − 起始时刻。 */
  readonly elapsedWallTimeMs: number;
  readonly iterations?: number;
}

/** 便捷构造：从起止时刻算 elapsedWallTimeMs。 */
export function buildLifecycleMetrics(
  startedAtMs: number,
  endedAtMs: number = Date.now(),
  extra?: { iterations?: number },
): MissionLifecycleMetrics {
  return {
    elapsedWallTimeMs: Math.max(0, endedAtMs - startedAtMs),
    iterations: extra?.iterations,
  };
}
