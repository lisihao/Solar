import { Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import type {
  TraceData,
  SpanData,
  TraceSummary,
  CreateTraceInput,
  CreateSpanInput,
  EndSpanInput,
  EndTraceInput,
  ListTracesOptions,
  ExecutionStatus,
} from "./trace.interface";
import { LruMap } from "@/common/utils/lru-map";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * Trace Collector Service
 *
 * 提供执行级别的 trace 和 span 收集，用于 AI 执行链路可视化。
 * - 内存存储（Map），支持 FIFO 淘汰
 * - 支持嵌套 span（通过 parentSpanId）
 * - 自动计算执行时长
 * - 全局可注入，可在任何模块中使用
 */
@Injectable()
export class TraceCollectorService {
  private readonly logger = new Logger(TraceCollectorService.name);

  /** 最大存储的 Trace 数量 */
  private readonly MAX_TRACES = 1000;

  /** Trace 存储（按时间顺序） - 使用 LRU 替代手动淘汰 */
  private readonly traces = new LruMap<string, TraceData>(1000);

  /** Span 存储（用于快速查找） */
  private readonly spans = new LruMap<string, SpanData>(5000);

  /** Trace 按时间排序的 ID 列表（用于 FIFO 淘汰） */
  private traceIdsByTime: string[] = [];

  /** 已持久化到 DB 的 Trace ID（避免 span FK 违约） */
  private persistedTraceIds = new Set<string>();

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /**
   * 开始一个新的 Trace
   * @param input Trace 创建参数
   * @returns Trace ID
   */
  startTrace(input: CreateTraceInput): string {
    const traceId = randomUUID();
    const now = new Date();

    const trace: TraceData = {
      id: traceId,
      name: input.name,
      type: input.type,
      status: "running",
      startTime: now,
      metadata: input.metadata || {},
      spans: [],
    };

    this.traces.set(traceId, trace);
    this.traceIdsByTime.push(traceId);

    // FIFO 淘汰：size 达到 MAX_TRACES 时主动淘汰已完成的 trace，
    // 确保在 LruMap 自身淘汰（按 LRU 顺序）之前先按业务规则淘汰（跳过 running）
    if (this.traces.size >= this.MAX_TRACES) {
      this.evictOldestTrace();
    }

    // DB 持久化（fire-and-forget）
    this.persistTrace(trace).catch((e) =>
      this.logger.debug(`[Trace] persistTrace failed on startTrace: ${e}`),
    );

    this.logger.debug(
      `[Trace] Started: ${input.name} (${input.type}) [${traceId}]`,
    );

    return traceId;
  }

  /**
   * 添加一个 Span 到现有 Trace
   * @param traceId Trace ID
   * @param input Span 创建参数
   * @returns Span ID
   */
  addSpan(traceId: string, input: CreateSpanInput): string {
    const trace = this.traces.get(traceId);
    if (!trace) {
      this.logger.warn(`[Trace] Trace not found: ${traceId}`);
      return "";
    }

    const spanId = randomUUID();
    const now = new Date();

    const span: SpanData = {
      id: spanId,
      traceId,
      name: input.name,
      type: input.type,
      status: "running",
      startTime: now,
      metadata: input.metadata || {},
    };

    this.spans.set(spanId, span);
    trace.spans.push(span);

    // DB 持久化（fire-and-forget）
    this.persistSpan(span).catch((e) =>
      this.logger.debug(`[Trace] persistSpan failed on addSpan: ${e}`),
    );

    this.logger.debug(
      `[Trace] Span added: ${input.name} (${input.type}) [${spanId}] -> Trace [${traceId}]`,
    );

    return spanId;
  }

  /**
   * 结束一个 Span
   * @param spanId Span ID
   * @param result 执行结果
   */
  endSpan(spanId: string, result: EndSpanInput): void {
    const span = this.spans.get(spanId);
    if (!span) {
      this.logger.warn(`[Trace] Span not found: ${spanId}`);
      return;
    }

    const now = new Date();
    span.endTime = now;
    span.status = result.status;
    span.duration = result.duration ?? now.getTime() - span.startTime.getTime();
    span.output = result.output;
    span.error = result.error;

    // DB 持久化（fire-and-forget）
    this.persistSpan(span).catch((e) =>
      this.logger.debug(`[Trace] persistSpan failed on endSpan: ${e}`),
    );

    this.logger.debug(
      `[Trace] Span ended: ${span.name} [${spanId}] - ${result.status} (${span.duration}ms)`,
    );
  }

  /**
   * 结束一个 Trace
   * @param traceId Trace ID
   * @param result 执行结果
   */
  endTrace(traceId: string, result: EndTraceInput): void {
    const trace = this.traces.get(traceId);
    if (!trace) {
      this.logger.warn(`[Trace] Trace not found: ${traceId}`);
      return;
    }

    const now = new Date();
    trace.endTime = now;
    trace.status = result.status;
    trace.duration =
      result.totalDuration ?? now.getTime() - trace.startTime.getTime();

    // DB 持久化（fire-and-forget）
    this.persistTrace(trace).catch((e) =>
      this.logger.debug(`[Trace] persistTrace failed on endTrace: ${e}`),
    );

    this.logger.log(
      `[Trace] Ended: ${trace.name} [${traceId}] - ${result.status} (${trace.duration}ms, ${trace.spans.length} spans)`,
    );
  }

  /**
   * 获取 Trace 详情（用于可视化）
   * @param traceId Trace ID
   * @returns Trace 数据，不存在返回 null
   */
  getTrace(traceId: string): TraceData | null {
    const trace = this.traces.get(traceId);
    if (!trace) {
      return null;
    }

    // 返回深拷贝，避免外部修改
    return JSON.parse(JSON.stringify(trace));
  }

  /**
   * 列出最近的 Trace
   * @param options 筛选选项
   * @returns Trace 摘要列表
   *
   * 策略：优先读内存 LruMap；内存为空时（重启场景）回退到 DB 查询。
   */
  async listTraces(options: ListTracesOptions = {}): Promise<TraceSummary[]> {
    const limit = options.limit ?? 50;
    const traces = Array.from(this.traces.values());

    // 内存有数据：直接返回，不查 DB
    if (traces.length > 0) {
      let filtered = traces;
      if (options.type) {
        filtered = traces.filter((t) => t.type === options.type);
      }
      filtered.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
      return filtered.slice(0, limit).map((trace) => ({
        id: trace.id,
        name: trace.name,
        type: trace.type,
        status: trace.status,
        startTime: trace.startTime,
        duration: trace.duration,
        spanCount: trace.spans.length,
      }));
    }

    // 内存为空，尝试 DB fallback（重启恢复场景）
    if (!this.prisma) {
      return [];
    }

    try {
      this.logger.debug(
        "[Trace] Memory empty, falling back to DB for listTraces",
      );
      const rows = await this.prisma.agentTrace.findMany({
        where: options.type ? { type: options.type } : {},
        orderBy: { startTime: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          startTime: true,
          duration: true,
          _count: { select: { spans: true } },
        },
      });

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type as TraceSummary["type"],
        status: row.status as TraceSummary["status"],
        startTime: row.startTime,
        duration: row.duration ?? undefined,
        spanCount: row._count.spans,
      }));
    } catch (error) {
      this.logger.warn(`[Trace] DB fallback for listTraces failed: ${error}`);
      return [];
    }
  }

  /**
   * 获取 Trace 统计信息
   */
  getStats(): {
    totalTraces: number;
    runningTraces: number;
    totalSpans: number;
    byType: Record<string, number>;
    byStatus: Record<ExecutionStatus, number>;
  } {
    const traces = Array.from(this.traces.values());

    const byType: Record<string, number> = {};
    const byStatus: Record<ExecutionStatus, number> = {
      running: 0,
      success: 0,
      error: 0,
    };

    for (const trace of traces) {
      byType[trace.type] = (byType[trace.type] || 0) + 1;
      byStatus[trace.status] = (byStatus[trace.status] || 0) + 1;
    }

    return {
      totalTraces: traces.length,
      runningTraces: byStatus.running,
      totalSpans: this.spans.size,
      byType,
      byStatus,
    };
  }

  /**
   * 清除所有 Trace（仅用于测试）
   */
  clearAll(): void {
    this.traces.clear();
    this.spans.clear();
    this.traceIdsByTime = [];
    this.logger.log("[Trace] All traces cleared");
  }

  // ==================== Private Methods ====================

  /**
   * 持久化 Trace 到 DB（upsert，write-through）
   */
  private async persistTrace(trace: TraceData): Promise<void> {
    if (!this.prisma) return;
    try {
      await this.prisma.agentTrace.upsert({
        where: { id: trace.id },
        create: {
          id: trace.id,
          name: trace.name,
          type: trace.type,
          status: trace.status,
          startTime: trace.startTime,
          endTime: trace.endTime ?? null,
          duration: trace.duration ?? null,
          metadata: trace.metadata as Prisma.InputJsonValue,
        },
        update: {
          status: trace.status,
          endTime: trace.endTime ?? null,
          duration: trace.duration ?? null,
        },
      });
      this.persistedTraceIds.add(trace.id);
    } catch (error) {
      this.logger.debug(
        `[Trace] DB persist failed for trace ${trace.id}: ${error}`,
      );
    }
  }

  /**
   * 持久化 Span 到 DB（upsert，write-through）
   */
  private async persistSpan(span: SpanData): Promise<void> {
    if (!this.prisma) return;
    // 确保 trace 已入库（避免 FK 违约）
    if (!this.persistedTraceIds.has(span.traceId)) {
      const trace = this.traces.get(span.traceId);
      if (trace) {
        await this.persistTrace(trace);
      }
    }
    try {
      await this.prisma.agentSpan.upsert({
        where: { id: span.id },
        create: {
          id: span.id,
          traceId: span.traceId,
          parentSpanId: span.parentSpanId ?? null,
          name: span.name,
          type: span.type,
          status: span.status,
          startTime: span.startTime,
          endTime: span.endTime ?? null,
          duration: span.duration ?? null,
          metadata: span.metadata as Prisma.InputJsonValue,
          output: span.output
            ? (span.output as Prisma.InputJsonValue)
            : Prisma.DbNull,
          error: span.error ?? null,
        },
        update: {
          status: span.status,
          endTime: span.endTime ?? null,
          duration: span.duration ?? null,
          output: span.output
            ? (span.output as Prisma.InputJsonValue)
            : Prisma.DbNull,
          error: span.error ?? null,
        },
      });
    } catch (error) {
      this.logger.debug(
        `[Trace] DB persist failed for span ${span.id}: ${error}`,
      );
    }
  }

  /**
   * FIFO 淘汰最旧的 Trace
   * 跳过 ACTIVE 状态的 trace（只淘汰已完成的）
   */
  private evictOldestTrace(): void {
    // 查找第一个非 ACTIVE 状态的 trace
    let evictedIndex = -1;
    for (let i = 0; i < this.traceIdsByTime.length; i++) {
      const traceId = this.traceIdsByTime[i];
      const trace = this.traces.get(traceId);
      // trace 为 undefined 说明 LruMap 已自动淘汰，也需要从 traceIdsByTime 清除（防内存泄漏）
      if (!trace || trace.status !== "running") {
        evictedIndex = i;
        break;
      }
    }

    if (evictedIndex === -1) {
      // 所有 trace 都是 ACTIVE，不淘汰
      this.logger.warn(`[Trace] All traces are active, cannot evict`);
      return;
    }

    const oldestTraceId = this.traceIdsByTime.splice(evictedIndex, 1)[0];
    const trace = this.traces.get(oldestTraceId);
    if (trace) {
      // 清除相关 Span
      for (const span of trace.spans) {
        this.spans.delete(span.id);
      }
      this.traces.delete(oldestTraceId);
      this.persistedTraceIds.delete(oldestTraceId);
      this.logger.debug(`[Trace] Evicted oldest trace: ${oldestTraceId}`);
    }
  }
}
