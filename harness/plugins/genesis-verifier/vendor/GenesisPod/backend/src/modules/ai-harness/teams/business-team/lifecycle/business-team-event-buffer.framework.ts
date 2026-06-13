/**
 * BusinessAgentTeam — Mission Event Buffer Framework (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/mission-event-buffer.service.ts
 *
 * 抽出 in-memory FIFO + DB write-through 兜底通用机制。实现 IBroadcastAdapter。
 *
 * 机制：
 *   - FIFO 上限 (MAX_PER_MISSION, 默认 5000)
 *   - TTL slot GC (默认 1h)
 *   - structuredClone 防外部 mutate
 *   - fire-and-forget DB persist；read miss 时调用方走 readPersisted() 兜底
 *
 * 业务（hooks）：
 *   - accepts 过滤（namespace 前缀）
 *   - 业务 DB persist / fetchPersisted（业务表名 / 列名）
 *   - 业务 adapterId
 */

import { Logger } from "@nestjs/common";
import type { DomainEvent } from "@/common/events/domain-event.types";
import type { IBroadcastAdapter } from "@/common/events/broadcast-adapter";
import {
  DEFAULT_GC_INTERVAL_MS,
  DEFAULT_MAX_PER_MISSION,
  DEFAULT_TTL_MS,
  type BufferedEvent,
  type EventBufferHooks,
} from "./abstractions/event-buffer.contract";

interface BufferSlot {
  events: BufferedEvent[];
  lastWriteAt: number;
}

export abstract class BusinessTeamEventBufferFramework implements IBroadcastAdapter {
  readonly id: string;
  protected readonly log: Logger;
  private readonly byMission = new Map<string, BufferSlot>();
  private readonly maxPerMission: number;
  private readonly ttlMs: number;
  private readonly gcIntervalMs: number;
  private lastGcAt = 0;

  constructor(
    protected readonly hooks: EventBufferHooks,
    loggerNamespace: string,
  ) {
    this.id = hooks.adapterId;
    this.log = new Logger(loggerNamespace);
    this.maxPerMission = hooks.maxPerMission ?? DEFAULT_MAX_PER_MISSION;
    this.ttlMs = hooks.ttlMs ?? DEFAULT_TTL_MS;
    this.gcIntervalMs = hooks.gcIntervalMs ?? DEFAULT_GC_INTERVAL_MS;
  }

  accepts(event: DomainEvent): boolean {
    return this.hooks.acceptsEvent(event.type);
  }

  async broadcast(event: DomainEvent): Promise<void> {
    const missionId = event.scope.missionId;
    if (!missionId) return;
    const slot = this.byMission.get(missionId) ?? {
      events: [],
      lastWriteAt: 0,
    };
    slot.events.push({
      type: event.type,
      payload: event.payload,
      agentId: event.agentId,
      traceId: event.traceId,
      timestamp: event.timestamp,
    });
    if (slot.events.length > this.maxPerMission) {
      slot.events.splice(0, slot.events.length - this.maxPerMission);
    }
    slot.lastWriteAt = Date.now();
    this.byMission.set(missionId, slot);
    this.gcIfNeeded();

    void this.hooks
      .persistEvent({
        missionId,
        type: event.type,
        payload: event.payload,
        agentId: event.agentId,
        traceId: event.traceId,
        timestamp: event.timestamp,
      })
      .catch((err: unknown) => {
        this.log.warn(
          `[persist ${missionId}] failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  read(missionId: string, sinceTs?: number): BufferedEvent[] {
    const slot = this.byMission.get(missionId);
    if (!slot) return [];
    const source =
      sinceTs == null
        ? slot.events
        : slot.events.filter((e) => e.timestamp >= sinceTs);
    // 浅克隆：top-level spread 隔离内部状态。
    // BufferedEvent.payload 标 readonly，调用方不得 mutate（事件总线契约）。
    // 原 structuredClone(5000 events) 在 Windows + jest worker 默认堆内存下
    // 触发 OOM（见 social-event-buffer commit a238185f3）。
    return source.map((e) => ({ ...e }));
  }

  /** GC / clear cache helper（social-event-buffer parity）。 */
  clear(missionId: string): void {
    this.byMission.delete(missionId);
  }

  async readPersisted(
    missionId: string,
    sinceTs?: number,
  ): Promise<BufferedEvent[]> {
    const rows = await this.hooks
      .fetchPersisted(missionId, sinceTs, this.maxPerMission)
      .catch((err: unknown) => {
        this.log.warn(
          `[readPersisted ${missionId}] failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return [] as readonly BufferedEvent[];
      });
    return [...rows];
  }

  private gcIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastGcAt < this.gcIntervalMs) return;
    this.lastGcAt = now;
    for (const [k, v] of this.byMission) {
      if (now - v.lastWriteAt > this.ttlMs) this.byMission.delete(k);
    }
    this.log.debug(
      `[gc] kept ${this.byMission.size} mission buffers (TTL=${this.ttlMs / 60_000}min)`,
    );
  }
}
