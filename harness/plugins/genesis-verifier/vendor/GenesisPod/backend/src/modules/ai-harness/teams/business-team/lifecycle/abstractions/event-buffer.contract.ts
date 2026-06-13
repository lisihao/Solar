/**
 * BusinessAgentTeam — Mission Event Buffer contract (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/mission-event-buffer.service.ts
 *
 * 抽出 in-memory FIFO + DB write-through 兜底通用机制。
 */

/** Framework 默认参数。 */
export const DEFAULT_MAX_PER_MISSION = 5000;
export const DEFAULT_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_GC_INTERVAL_MS = 60_000;

/** Buffered event payload shape（framework 持有的内存形状）。 */
export interface BufferedEvent {
  readonly type: string;
  readonly payload: unknown;
  readonly agentId?: string;
  readonly traceId?: string;
  readonly timestamp: number;
}

/**
 * 业务方提供的 event buffer hooks。
 *
 * 机制：内存 FIFO + TTL GC + structuredClone 防外部 mutate + GC interval。
 * 业务字段：accepts 过滤器（namespace 前缀）、DB persist（业务表名）、DB read（业务表名）。
 */
export interface EventBufferHooks {
  /** Framework 实例 id（用于 IBroadcastAdapter.id）。 */
  readonly adapterId: string;
  /** 业务方决定哪些事件该缓冲（通常按 type 前缀过滤）。 */
  readonly acceptsEvent: (eventType: string) => boolean;
  /** 业务方负责落库 fire-and-forget INSERT（含表名 / 列名）。 */
  readonly persistEvent: (event: {
    readonly missionId: string;
    readonly type: string;
    readonly payload: unknown;
    readonly agentId?: string;
    readonly traceId?: string;
    readonly timestamp: number;
  }) => Promise<void>;
  /** 业务方负责 DB 读取 sinceTs+limit 的事件（含表名）。 */
  readonly fetchPersisted: (
    missionId: string,
    sinceTs: number | undefined,
    limit: number,
  ) => Promise<readonly BufferedEvent[]>;
  /** 可选参数覆盖。 */
  readonly maxPerMission?: number;
  readonly ttlMs?: number;
  readonly gcIntervalMs?: number;
}
