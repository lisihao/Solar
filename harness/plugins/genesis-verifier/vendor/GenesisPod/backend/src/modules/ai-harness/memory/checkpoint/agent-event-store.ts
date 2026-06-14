/**
 * AgentEventStore — 事件溯源（Event Sourcing）持久层
 *
 * 写入 IAgentEvent 流到 harness_agent_events 表，按 (agentId, seq) 严格有序。
 *
 * 用途：
 *   1. Replay：从某 seq 开始重放整个 agent 的执行历史（调试 / 审计）
 *   2. Resume + Replay：checkpoint 给 envelope 状态，event store 给"快照后的事件"
 *   3. UI 时间轴：前端拉取一个 agent 的全部事件渲染瀑布图
 *
 * 设计：
 *   - seq 由本服务自增维护（按 agentId 分区）—— 比让 caller 自己算可靠
 *   - 写入失败抛错（caller 决定吞还是抛；HarnessedAgent 已用 fire-and-forget 包裹）
 *   - 不强校验 type / payload 形状 —— 保持 forward-compat，新增事件类型零迁移
 */

import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import type { IAgentEvent } from "../../agents/abstractions";

export interface AgentEventRecord {
  readonly id: string;
  readonly agentId: string;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly emittedAt: Date;
}

@Injectable()
export class AgentEventStore {
  private readonly log = new Logger(AgentEventStore.name);
  /**
   * 2026-05-15 PR-E.P2 评估：seqByAgent / seqLock 保留 in-process（不迁 Redis）。理由：
   *   - seqByAgent 是 SELECT MAX(seq) 的进程内 cache，miss 时 fall back 到 DB，正确性
   *     不依赖 cache；多 pod 时各 pod 各自维护 cache 无问题
   *   - seqLock 是 NodeJS microtask 内的 sequential lock（同 pod 内 append 并发抢 seq），
   *     多 pod 间跨 pod 并发由 DB `unique(agentId, seq)` 约束兜底——seq 冲突时 INSERT
   *     抛 unique violation，调用方 catch + 重试 nextSeq
   *   - 改为 Redis 分布式锁会让每次 append 增加 RTT，性能反优化
   */
  private readonly seqByAgent = new Map<string, number>();
  private readonly seqLock = new Map<string, Promise<unknown>>();

  constructor(private readonly prisma: PrismaService) {}

  private async withSeqLock<T>(
    agentId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.seqLock.get(agentId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => {
      release = r;
    });
    this.seqLock.set(agentId, next);
    try {
      await prev;
      return await fn();
    } finally {
      release();
      // 清理 idle agent 的 lock 记录，避免内存增长
      if (this.seqLock.get(agentId) === next) this.seqLock.delete(agentId);
    }
  }

  /**
   * 持久化一条 event。
   *
   * traceId/spanId 可选 —— 由 caller 从当前 active span 取后传入；不传则不关联。
   *
   * PR-I 修复 #2 提示：高频写入场景请用 appendBatch（避免 N+1 round-trip）。
   * HarnessedAgent 已默认走 batched buffer。
   */
  async append(
    event: IAgentEvent,
    options?: { traceId?: string; spanId?: string },
  ): Promise<AgentEventRecord> {
    return this.withSeqLock(event.agentId, () =>
      this.appendInternal(event, options),
    );
  }

  private async appendInternal(
    event: IAgentEvent,
    options?: { traceId?: string; spanId?: string },
  ): Promise<AgentEventRecord> {
    const seq = await this.nextSeq(event.agentId);
    const plain = this.toPlain(event.payload);
    const created = await this.prisma.harnessAgentEvent.create({
      data: {
        agentId: event.agentId,
        seq,
        type: event.type,
        payload:
          plain === null ? Prisma.JsonNull : (plain as Prisma.InputJsonValue),
        traceId: options?.traceId,
        spanId: options?.spanId,
        emittedAt: new Date(event.timestamp),
      },
    });
    return {
      id: created.id,
      agentId: created.agentId,
      seq: created.seq,
      type: created.type,
      payload: created.payload as unknown,
      traceId: created.traceId ?? undefined,
      spanId: created.spanId ?? undefined,
      emittedAt: created.emittedAt,
    };
  }

  /**
   * 批量 append —— PR-I 修复 N+1 写入。
   *
   * 单 transaction 内为整批分配连续 seq；失败整批回滚。
   * HarnessedAgent 在 loop 内 buffer 事件，每批 flush 时调用本方法。
   */
  async appendBatch(
    events: readonly IAgentEvent[],
    options?: { traceId?: string; spanId?: string },
  ): Promise<readonly AgentEventRecord[]> {
    if (events.length === 0) return [];
    // 同一批内的事件按 agentId 分组
    const byAgent = new Map<string, IAgentEvent[]>();
    for (const e of events) {
      const list = byAgent.get(e.agentId) ?? [];
      list.push(e);
      byAgent.set(e.agentId, list);
    }
    const all: AgentEventRecord[] = [];
    // 必修 #1: 每个 agent 一把锁，串行化分配 seq
    for (const [agentId, list] of byAgent.entries()) {
      const recs = await this.withSeqLock(agentId, () =>
        this.appendBatchForAgent(agentId, list, options),
      );
      all.push(...recs);
    }
    return all;
  }

  private async appendBatchForAgent(
    agentId: string,
    list: IAgentEvent[],
    options?: { traceId?: string; spanId?: string },
  ): Promise<AgentEventRecord[]> {
    const baseSeq = await this.nextSeq(agentId);
    // baseSeq 已经 +1；同 batch 后续条目继续递增
    const data: Prisma.HarnessAgentEventCreateManyInput[] = list.map(
      (ev, i) => {
        const plain = this.toPlain(ev.payload);
        return {
          agentId,
          seq: i === 0 ? baseSeq : baseSeq + i,
          type: ev.type,
          payload:
            plain === null ? Prisma.JsonNull : (plain as Prisma.InputJsonValue),
          traceId: options?.traceId,
          spanId: options?.spanId,
          emittedAt: new Date(ev.timestamp),
        };
      },
    );
    // 同步 cache 到本 batch 末尾
    this.seqByAgent.set(agentId, baseSeq + list.length - 1);
    // 必修 #2: 干净的类型，不再 as never[]
    await this.prisma.harnessAgentEvent.createMany({ data });
    // 建议修：批量回查真 id（一次 SELECT 拿整批 UUID）
    const seqs = data.map((d) => d.seq);
    const rows = await this.prisma.harnessAgentEvent.findMany({
      where: { agentId, seq: { in: seqs } },
      select: { id: true, seq: true },
    });
    const idBySeq = new Map(rows.map((r) => [r.seq, r.id]));
    return data.map((d) => ({
      id: idBySeq.get(d.seq) ?? `pending-${agentId}-${d.seq}`,
      agentId: d.agentId,
      seq: d.seq,
      type: d.type,
      payload: d.payload as unknown,
      traceId: d.traceId ?? undefined,
      spanId: d.spanId ?? undefined,
      emittedAt: d.emittedAt instanceof Date ? d.emittedAt : new Date(),
    }));
  }

  /**
   * 批量读 agent 的事件流，可选 fromSeq（resume 时用）。
   */
  async readStream(
    agentId: string,
    options: { fromSeq?: number; limit?: number } = {},
  ): Promise<readonly AgentEventRecord[]> {
    const rows = await this.prisma.harnessAgentEvent.findMany({
      where: {
        agentId,
        ...(options.fromSeq != null ? { seq: { gte: options.fromSeq } } : {}),
      },
      orderBy: { seq: "asc" },
      take: options.limit,
    });
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      seq: r.seq,
      type: r.type,
      payload: r.payload as unknown,
      traceId: r.traceId ?? undefined,
      spanId: r.spanId ?? undefined,
      emittedAt: r.emittedAt,
    }));
  }

  /**
   * 删除 agent 的全部事件（测试 / GDPR）。
   */
  async clearAgent(agentId: string): Promise<number> {
    const res = await this.prisma.harnessAgentEvent.deleteMany({
      where: { agentId },
    });
    this.seqByAgent.delete(agentId);
    return res.count;
  }

  // ── helpers ─────────────────────────────────────────────────────

  /**
   * 取下一个 seq（按 agentId 自增）。
   * 注意：appendBatch 调用本方法后会再覆盖 cache，避免 batch 中间被 append 抢号。
   */
  private async nextSeq(agentId: string): Promise<number> {
    const cached = this.seqByAgent.get(agentId);
    if (cached != null) {
      const next = cached + 1;
      this.seqByAgent.set(agentId, next);
      return next;
    }
    // first time — read MAX from DB
    const last = await this.prisma.harnessAgentEvent.findFirst({
      where: { agentId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const next = (last?.seq ?? 0) + 1;
    this.seqByAgent.set(agentId, next);
    return next;
  }

  private toPlain(payload: unknown): object | string | number | boolean | null {
    if (payload == null) return null;
    if (typeof payload === "string") return payload;
    if (typeof payload === "number") return payload;
    if (typeof payload === "boolean") return payload;
    // best-effort plain conversion; skip BigInt / Symbol etc
    try {
      return JSON.parse(JSON.stringify(payload)) as object;
    } catch (err) {
      this.log.warn(
        `payload not JSON-serializable, dropping: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { _dropped: true } as object;
    }
  }
}
