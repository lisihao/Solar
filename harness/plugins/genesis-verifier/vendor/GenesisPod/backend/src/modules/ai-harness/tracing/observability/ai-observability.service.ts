import {
  Injectable,
  Logger,
  Optional,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "@/common/prisma/prisma.service";
import { Decimal } from "@prisma/client/runtime/library";
import { inferIsReasoning } from "@/modules/ai-engine/llm/types/model.utils";

/**
 * LLM 调用事件
 */
export interface LLMCallEvent {
  id: string;
  timestamp: Date;
  model: string;
  provider: string;
  modelType: string;
  module: string;
  operation: string;
  userId?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  /** Time To First Token (ms) — 仅流式调用 */
  ttftMs?: number;
  /** Time To Last Token (ms) — 仅流式调用 */
  ttltMs?: number;
  estimatedCost: number;
  success: boolean;
  error?: string;
  fallbackUsed: boolean;
  retryCount: number;
}

/**
 * 模型指标
 */
export interface ModelMetrics {
  calls: number;
  tokens: number;
  cost: number;
  avgLatencyMs: number;
  errorRate: number;
}

/**
 * 模块指标
 */
export interface ModuleMetrics {
  calls: number;
  tokens: number;
  cost: number;
  topModels: string[];
}

/**
 * 可观测性仪表盘
 */
export interface ObservabilityDashboard {
  period: { start: Date; end: Date };
  totalCalls: number;
  totalTokens: number;
  totalCost: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  fallbackRate: number;
  byModel: Record<string, ModelMetrics>;
  byModule: Record<string, ModuleMetrics>;
  byUser: Array<{
    userId: string;
    calls: number;
    tokens: number;
    cost: number;
  }>;
  recentErrors: Array<{ timestamp: Date; model: string; error: string }>;
}

/**
 * Kernel Metrics Service (formerly AiObservabilityService)
 *
 * 职责：
 * - 记录所有 LLM 调用的详细指标（模型、tokens、延迟、成本）
 * - 追踪成本归因（按用户、模块、模型）
 * - 计算延迟百分位数（p50/p95/p99）
 * - 提供质量信号（错误率、回退率、重试次数）
 * - 聚合数据用于仪表盘展示
 *
 * 实现特性：
 * - 环形缓冲区存储最近 10000 个事件
 * - 自动驱逐旧事件
 * - 原子操作保证数据一致性
 * - 高性能聚合计算
 */
@Injectable()
export class AiObservabilityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiObservabilityService.name);

  /**
   * 环形缓冲区，存储最近的 LLM 调用事件
   */
  private readonly events: LLMCallEvent[] = [];

  /**
   * 环形缓冲区最大容量
   */
  private readonly MAX_EVENTS = 10000;

  /**
   * 当前写入位置（环形缓冲区索引）
   */
  private writeIndex = 0;

  /**
   * 已记录的事件总数（包括已被驱逐的）
   */
  private totalEventsRecorded = 0;

  /**
   * 上次 flush 到 DB 的事件总数（用于计算增量）
   */
  private lastFlushedCount = 0;

  /**
   * 待持久化的事件缓冲区
   */
  private readonly pendingFlush: LLMCallEvent[] = [];

  /**
   * 待持久化缓冲区最大容量（防止 DB 不可用时 OOM）
   */
  private readonly MAX_PENDING_FLUSH = 50000;

  /**
   * Flush 定时器
   */
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * 当前正在执行的 flush Promise（防止并发 flush）
   */
  private flushInProgress: Promise<number> | null = null;

  /**
   * Flush 间隔（毫秒），默认 5 分钟
   */
  private readonly FLUSH_INTERVAL_MS = 5 * 60 * 1000;

  /**
   * 单次 flush 最大批量
   */
  private readonly FLUSH_BATCH_SIZE = 500;

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  onModuleInit() {
    if (this.prisma) {
      this.flushInterval = setInterval(
        () => this.flushToDB(),
        this.FLUSH_INTERVAL_MS,
      ).unref();
      this.logger.log(
        `DB persistence enabled, flush interval: ${this.FLUSH_INTERVAL_MS / 1000}s`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Wait for in-flight flush to complete
    if (this.flushInProgress) {
      try {
        await this.flushInProgress;
      } catch {
        // Already logged in flushToDB
      }
    }

    // Final flush on shutdown
    if (this.prisma && this.pendingFlush.length > 0) {
      try {
        const flushed = await this.flushToDB();
        this.logger.log(`Final shutdown flush: ${flushed} events`);
      } catch (err) {
        this.logger.error(`Final flush failed: ${err}`);
      }
    }
  }

  /**
   * 记录 LLM 调用事件
   *
   * 核心追踪方法，每次 LLM 调用后应调用此方法记录指标
   *
   * @param event - 调用事件（不含 id 和 timestamp，自动生成）
   */
  recordLLMCall(event: Omit<LLMCallEvent, "id" | "timestamp">): void {
    const fullEvent: LLMCallEvent = {
      id: randomUUID(),
      timestamp: new Date(),
      ...event,
      module: this.normalizeModuleName(event.module, event.operation),
    };

    // 环形缓冲区写入：未满时追加，满了后覆盖旧数据
    if (this.events.length < this.MAX_EVENTS) {
      this.events.push(fullEvent);
    } else {
      this.events[this.writeIndex] = fullEvent;
    }

    this.writeIndex = (this.writeIndex + 1) % this.MAX_EVENTS;
    this.totalEventsRecorded++;

    // 加入待持久化队列（有上限保护，防止 DB 不可用时 OOM）
    if (this.prisma) {
      if (this.pendingFlush.length >= this.MAX_PENDING_FLUSH) {
        this.pendingFlush.shift();
        this.logger.warn(
          `Pending flush buffer full (${this.MAX_PENDING_FLUSH}), dropping oldest event`,
        );
      }
      this.pendingFlush.push(fullEvent);
    }

    // 记录失败调用（警告级别）
    if (!fullEvent.success && fullEvent.error) {
      this.logger.warn(
        `LLM 调用失败: ${fullEvent.model} @ ${fullEvent.module}.${fullEvent.operation} - ${fullEvent.error}`,
      );
    }

    // 记录高成本调用（超过 $0.10）
    if (fullEvent.estimatedCost > 0.1) {
      this.logger.log(
        `高成本 LLM 调用: $${fullEvent.estimatedCost.toFixed(4)} - ${fullEvent.model} (${fullEvent.totalTokens} tokens)`,
      );
    }

    // ★ R-LIVE-5/7 (2026-04-30): 区分 chat vs reasoning 双阈值，避免 reasoning
    //   thinking 时间合理但报告 chat=5s 阈值的噪声告警。
    // ★ 2026-05-13 P2-#6: ① 用单源 inferIsReasoning（之前本地 regex 漏识别
    //   grok-4-1-fast-reasoning / claude-thinking 等 modelId 含 reasoning/thinking
    //   关键词的模型，被错当 chat 用 10s 阈值告警单次 105772ms 实属 reasoning 正常）
    //   ② reasoning 阈值 30s → 60s（实测 30-50s 是正常 CoT thinking 分布，30s 阈值
    //   告警频率太高；60s 才算"长 thinking"真异常需关注）。
    const isReasoning =
      inferIsReasoning(fullEvent.model) ||
      /reasoning/i.test(fullEvent.modelType ?? "");
    const latencyThreshold = isReasoning ? 60000 : 10000;
    if (fullEvent.latencyMs > latencyThreshold) {
      this.logger.warn(
        `高延迟 LLM 调用: ${fullEvent.latencyMs}ms - ${fullEvent.model} ` +
          `(${isReasoning ? "reasoning" : "chat"}, threshold=${latencyThreshold}ms) ` +
          `@ ${fullEvent.module}.${fullEvent.operation}`,
      );
    }
  }

  /**
   * 获取仪表盘聚合数据
   *
   * @param periodMinutes - 时间窗口（分钟），默认 60 分钟
   * @returns 包含完整指标的仪表盘数据
   */
  getDashboard(periodMinutes: number = 60): ObservabilityDashboard {
    const now = new Date();
    const startTime = new Date(now.getTime() - periodMinutes * 60 * 1000);

    // 过滤时间窗口内的事件
    const recentEvents = this.events.filter(
      (e) => e.timestamp >= startTime && e.timestamp <= now,
    );

    if (recentEvents.length === 0) {
      return this.getEmptyDashboard(startTime, now);
    }

    // 基础聚合
    const totalCalls = recentEvents.length;
    const successfulCalls = recentEvents.filter((e) => e.success).length;
    const fallbackCalls = recentEvents.filter((e) => e.fallbackUsed).length;
    const totalTokens = recentEvents.reduce((sum, e) => sum + e.totalTokens, 0);
    const totalCost = recentEvents.reduce((sum, e) => sum + e.estimatedCost, 0);
    const totalLatency = recentEvents.reduce((sum, e) => sum + e.latencyMs, 0);

    // 按维度聚合
    const byModel = this.aggregateByModel(recentEvents);
    const byModule = this.aggregateByModule(recentEvents);
    const byUser = this.aggregateByUser(recentEvents);

    // 延迟百分位数
    const latencies = recentEvents
      .map((e) => e.latencyMs)
      .sort((a, b) => a - b);
    const p95LatencyMs = this.percentile(latencies, 0.95);
    const p99LatencyMs = this.percentile(latencies, 0.99);

    // 最近错误（最多 10 条）
    const recentErrors = this.buildRecentErrorsFromEvents(recentEvents);

    return {
      period: { start: startTime, end: now },
      totalCalls,
      totalTokens,
      totalCost,
      successRate: totalCalls > 0 ? successfulCalls / totalCalls : 0,
      avgLatencyMs: totalCalls > 0 ? totalLatency / totalCalls : 0,
      p95LatencyMs,
      p99LatencyMs,
      fallbackRate: totalCalls > 0 ? fallbackCalls / totalCalls : 0,
      byModel,
      byModule,
      byUser,
      recentErrors,
    };
  }

  /**
   * 获取特定模型的指标
   *
   * @param model - 模型名称（如 "gpt-4o"）
   * @returns 模型指标，如果没有数据则返回 null
   */
  getModelMetrics(model: string): ModelMetrics | null {
    const modelEvents = this.events.filter((e) => e.model === model);

    if (modelEvents.length === 0) {
      return null;
    }

    const calls = modelEvents.length;
    const successfulCalls = modelEvents.filter((e) => e.success).length;
    const tokens = modelEvents.reduce((sum, e) => sum + e.totalTokens, 0);
    const cost = modelEvents.reduce((sum, e) => sum + e.estimatedCost, 0);
    const totalLatency = modelEvents.reduce((sum, e) => sum + e.latencyMs, 0);

    return {
      calls,
      tokens,
      cost,
      avgLatencyMs: totalLatency / calls,
      errorRate: 1 - successfulCalls / calls,
    };
  }

  /**
   * 获取用户成本归因
   *
   * 按用户追踪成本分布，支持模块和模型维度分解
   *
   * @param userId - 用户 ID
   * @returns 用户的总成本及按模块、模型的分解
   */
  getCostAttribution(userId: string): {
    total: number;
    byModule: Record<string, number>;
    byModel: Record<string, number>;
  } {
    const userEvents = this.events.filter((e) => e.userId === userId);

    const total = userEvents.reduce((sum, e) => sum + e.estimatedCost, 0);

    const byModule: Record<string, number> = {};
    const byModel: Record<string, number> = {};

    for (const event of userEvents) {
      byModule[event.module] =
        (byModule[event.module] || 0) + event.estimatedCost;
      byModel[event.model] = (byModel[event.model] || 0) + event.estimatedCost;
    }

    return { total, byModule, byModel };
  }

  /**
   * 获取延迟百分位数
   *
   * @param model - 可选，指定模型筛选
   * @returns p50/p95/p99 延迟（毫秒）
   */
  getLatencyPercentiles(model?: string): {
    p50: number;
    p95: number;
    p99: number;
  } {
    let relevantEvents = this.events;

    if (model) {
      relevantEvents = relevantEvents.filter((e) => e.model === model);
    }

    if (relevantEvents.length === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }

    const latencies = relevantEvents
      .map((e) => e.latencyMs)
      .sort((a, b) => a - b);

    return {
      p50: this.percentile(latencies, 0.5),
      p95: this.percentile(latencies, 0.95),
      p99: this.percentile(latencies, 0.99),
    };
  }

  /**
   * 获取最近的错误事件
   *
   * @param limit - 返回数量限制，默认 20
   * @returns 最近的失败调用事件（时间倒序）
   */
  getRecentErrors(limit: number = 20): LLMCallEvent[] {
    return this.events
      .filter((e) => !e.success)
      .slice(-limit)
      .reverse();
  }

  /**
   * 将待持久化事件批量写入数据库
   *
   * 使用 AIEngineMetric 模型存储，支持后续聚合查询
   */
  async flushToDB(): Promise<number> {
    if (!this.prisma || this.pendingFlush.length === 0) {
      return 0;
    }

    // Prevent concurrent flush operations
    if (this.flushInProgress) {
      return this.flushInProgress;
    }

    this.flushInProgress = this._doFlush();
    try {
      return await this.flushInProgress;
    } finally {
      this.flushInProgress = null;
    }
  }

  private async _doFlush(): Promise<number> {
    if (!this.prisma || this.pendingFlush.length === 0) {
      return 0;
    }

    const batch = this.pendingFlush.splice(0, this.FLUSH_BATCH_SIZE);
    const flushed = batch.length;

    try {
      await this.prisma.aIEngineMetric.createMany({
        data: batch.map((event) => ({
          id: event.id,
          metricType: "llm_call",
          operationId: event.operation,
          modelId: event.model,
          providerId: event.provider,
          userId: event.userId || null,
          duration: event.latencyMs,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          totalTokens: event.totalTokens,
          estimatedCost: new Decimal(event.estimatedCost.toFixed(6)),
          success: event.success,
          errorCode: event.error || null,
          metadata: {
            module: event.module,
            modelType: event.modelType,
            fallbackUsed: event.fallbackUsed,
            retryCount: event.retryCount,
          },
          createdAt: event.timestamp,
        })),
        skipDuplicates: true,
      });

      this.lastFlushedCount += flushed;
      this.logger.log(
        `Flushed ${flushed} events to DB (total: ${this.lastFlushedCount})`,
      );

      // 如果还有剩余，继续 flush
      if (this.pendingFlush.length > 0) {
        return flushed + (await this._doFlush());
      }

      return flushed;
    } catch (error) {
      // 失败时将事件放回队列头部（有上限保护）
      const spaceAvailable = this.MAX_PENDING_FLUSH - this.pendingFlush.length;
      const toRequeue = Math.min(batch.length, spaceAvailable);
      if (toRequeue > 0) {
        this.pendingFlush.unshift(...batch.slice(0, toRequeue));
      }
      const dropped = batch.length - toRequeue;
      this.logger.error(
        `Failed to flush ${flushed} events to DB: ${error instanceof Error ? error.message : error}` +
          (dropped > 0
            ? ` (dropped ${dropped} events due to buffer limit)`
            : ""),
      );
      return 0;
    }
  }

  /**
   * 获取待持久化事件数量
   */
  getPendingFlushCount(): number {
    return this.pendingFlush.length;
  }

  /**
   * 重置所有数据
   *
   * 清空环形缓冲区和计数器，主要用于测试
   */
  reset(): void {
    this.events.length = 0;
    this.writeIndex = 0;
    this.totalEventsRecorded = 0;
    this.pendingFlush.length = 0;
    this.lastFlushedCount = 0;
    this.logger.log("可观测性数据已重置");
  }

  /**
   * 按模型聚合事件
   */
  private aggregateByModel(
    events: LLMCallEvent[],
  ): Record<string, ModelMetrics> {
    const modelMap = new Map<string, LLMCallEvent[]>();

    for (const event of events) {
      if (!modelMap.has(event.model)) {
        modelMap.set(event.model, []);
      }
      modelMap.get(event.model)!.push(event);
    }

    const result: Record<string, ModelMetrics> = {};

    for (const [model, modelEvents] of modelMap.entries()) {
      const calls = modelEvents.length;
      const successfulCalls = modelEvents.filter((e) => e.success).length;
      const tokens = modelEvents.reduce((sum, e) => sum + e.totalTokens, 0);
      const cost = modelEvents.reduce((sum, e) => sum + e.estimatedCost, 0);
      const totalLatency = modelEvents.reduce((sum, e) => sum + e.latencyMs, 0);

      result[model] = {
        calls,
        tokens,
        cost,
        avgLatencyMs: totalLatency / calls,
        errorRate: 1 - successfulCalls / calls,
      };
    }

    return result;
  }

  /**
   * 按模块聚合事件
   */
  private aggregateByModule(
    events: LLMCallEvent[],
  ): Record<string, ModuleMetrics> {
    const moduleMap = new Map<string, LLMCallEvent[]>();

    for (const event of events) {
      const moduleName = this.normalizeModuleName(
        event.module,
        event.operation,
      );
      if (!moduleMap.has(moduleName)) {
        moduleMap.set(moduleName, []);
      }
      moduleMap.get(moduleName)!.push(event);
    }

    const result: Record<string, ModuleMetrics> = {};

    for (const [moduleName, moduleEvents] of moduleMap.entries()) {
      const calls = moduleEvents.length;
      const tokens = moduleEvents.reduce((sum, e) => sum + e.totalTokens, 0);
      const cost = moduleEvents.reduce((sum, e) => sum + e.estimatedCost, 0);

      // 统计该模块最常用的模型（Top 3）
      const modelCounts = new Map<string, number>();
      for (const event of moduleEvents) {
        modelCounts.set(event.model, (modelCounts.get(event.model) || 0) + 1);
      }

      const topModels = Array.from(modelCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([model]) => model);

      result[moduleName] = {
        calls,
        tokens,
        cost,
        topModels,
      };
    }

    return result;
  }

  /**
   * 按用户聚合事件
   */
  private aggregateByUser(
    events: LLMCallEvent[],
  ): Array<{ userId: string; calls: number; tokens: number; cost: number }> {
    const userMap = new Map<
      string,
      { calls: number; tokens: number; cost: number }
    >();

    for (const event of events) {
      if (!event.userId) continue;

      if (!userMap.has(event.userId)) {
        userMap.set(event.userId, { calls: 0, tokens: 0, cost: 0 });
      }

      const userStats = userMap.get(event.userId)!;
      userStats.calls++;
      userStats.tokens += event.totalTokens;
      userStats.cost += event.estimatedCost;
    }

    return Array.from(userMap.entries())
      .map(([userId, stats]) => ({ userId, ...stats }))
      .sort((a, b) => b.cost - a.cost) // 按成本降序
      .slice(0, 20); // 取 Top 20 用户
  }

  /**
   * 计算百分位数
   *
   * @param sortedArray - 已排序的数组
   * @param p - 百分位（0-1，如 0.95 表示 p95）
   * @returns 百分位数值
   */
  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;

    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, index)];
  }

  private normalizeModuleName(
    moduleName: string | null | undefined,
    operation?: string | null,
  ): string {
    const trimmed = typeof moduleName === "string" ? moduleName.trim() : "";
    if (trimmed && trimmed !== "unknown") return trimmed;

    const normalizedOperation = (operation ?? "").toLowerCase();
    if (normalizedOperation.includes("harness")) return "ai-harness";
    if (normalizedOperation.includes("kernel")) return "ai-kernel";
    if (normalizedOperation.includes("agent")) return "agents";

    return "ai-engine";
  }

  private buildRecentErrorsFromEvents(
    events: LLMCallEvent[],
  ): ObservabilityDashboard["recentErrors"] {
    const errors = events
      .filter((e) => !e.success && e.error)
      .map((e) => ({
        timestamp: e.timestamp,
        model: e.model,
        error: e.error!,
      }))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return this.dedupeRecentErrors(errors);
  }

  private dedupeRecentErrors(
    errors: ObservabilityDashboard["recentErrors"],
    limit = 10,
  ): ObservabilityDashboard["recentErrors"] {
    const detailedSlots = new Set(
      errors
        .filter((e) => !this.isGenericError(e.error))
        .map((e) => this.errorSlotKey(e)),
    );
    const seen = new Set<string>();
    const result: ObservabilityDashboard["recentErrors"] = [];

    for (const error of errors) {
      const slotKey = this.errorSlotKey(error);
      if (this.isGenericError(error.error) && detailedSlots.has(slotKey)) {
        continue;
      }

      const dedupeKey = `${slotKey}|${error.error}`;
      if (seen.has(dedupeKey)) continue;

      seen.add(dedupeKey);
      result.push(error);
      if (result.length >= limit) break;
    }

    return result;
  }

  private errorSlotKey(error: { timestamp: Date; model: string }): string {
    const minuteBucket = Math.floor(error.timestamp.getTime() / 60000);
    return `${error.model}|${minuteBucket}`;
  }

  private isGenericError(error: string): boolean {
    return /^[A-Z0-9_:-]+$/.test(error.trim());
  }

  /**
   * 获取仪表盘（带 DB 回退）
   *
   * 先读内存环形缓冲区，若为空则从 AIEngineMetric 表回退查询。
   * 适用于服务重启后内存清空但 DB 有持久化数据的场景。
   */
  async getDashboardWithFallback(
    periodMinutes: number = 60,
  ): Promise<ObservabilityDashboard> {
    const inMemory = this.getDashboard(periodMinutes);
    if (inMemory.totalCalls > 0) return inMemory;
    return this.getDashboardFromDB(periodMinutes);
  }

  /**
   * 从 DB 聚合仪表盘数据（AIEngineMetric 表）
   */
  private async getDashboardFromDB(
    periodMinutes: number = 60,
  ): Promise<ObservabilityDashboard> {
    const now = new Date();
    const startTime = new Date(now.getTime() - periodMinutes * 60 * 1000);

    if (!this.prisma) {
      return this.getEmptyDashboard(startTime, now);
    }

    try {
      const metrics = await this.prisma.aIEngineMetric.findMany({
        where: {
          metricType: "llm_call",
          createdAt: { gte: startTime, lte: now },
        },
        orderBy: { createdAt: "desc" },
        take: this.MAX_EVENTS,
      });

      if (metrics.length === 0) {
        return this.getEmptyDashboard(startTime, now);
      }

      const totalCalls = metrics.length;
      const successfulCalls = metrics.filter((m) => m.success).length;
      const totalTokens = metrics.reduce(
        (sum, m) => sum + (m.totalTokens ?? 0),
        0,
      );
      const totalCost = metrics.reduce(
        (sum, m) => sum + Number(m.estimatedCost ?? 0),
        0,
      );
      const totalLatency = metrics.reduce(
        (sum, m) => sum + (m.duration ?? 0),
        0,
      );
      const fallbackCount = metrics.filter((m) => {
        const meta = m.metadata as Record<string, unknown> | null;
        return meta?.fallbackUsed === true;
      }).length;

      // By model
      const byModel: Record<string, ModelMetrics> = {};
      const modelGroups = new Map<string, typeof metrics>();
      for (const m of metrics) {
        const model = m.modelId || "unknown";
        if (!modelGroups.has(model)) modelGroups.set(model, []);
        modelGroups.get(model)!.push(m);
      }
      for (const [model, events] of modelGroups) {
        const calls = events.length;
        const successes = events.filter((e) => e.success).length;
        const tokens = events.reduce((s, e) => s + (e.totalTokens ?? 0), 0);
        const cost = events.reduce(
          (s, e) => s + Number(e.estimatedCost ?? 0),
          0,
        );
        const latency = events.reduce((s, e) => s + (e.duration ?? 0), 0);
        byModel[model] = {
          calls,
          tokens,
          cost,
          avgLatencyMs: latency / calls,
          errorRate: 1 - successes / calls,
        };
      }

      // By module (from metadata)
      const byModule: Record<string, ModuleMetrics> = {};
      const moduleGroups = new Map<string, typeof metrics>();
      for (const m of metrics) {
        const meta = m.metadata as Record<string, unknown> | null;
        const mod = this.normalizeModuleName(
          meta?.module as string | undefined,
          m.operationId,
        );
        if (!moduleGroups.has(mod)) moduleGroups.set(mod, []);
        moduleGroups.get(mod)!.push(m);
      }
      for (const [mod, events] of moduleGroups) {
        const calls = events.length;
        const tokens = events.reduce((s, e) => s + (e.totalTokens ?? 0), 0);
        const cost = events.reduce(
          (s, e) => s + Number(e.estimatedCost ?? 0),
          0,
        );
        const modelCounts = new Map<string, number>();
        for (const e of events) {
          const mdl = e.modelId || "unknown";
          modelCounts.set(mdl, (modelCounts.get(mdl) || 0) + 1);
        }
        const topModels = Array.from(modelCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([name]) => name);
        byModule[mod] = { calls, tokens, cost, topModels };
      }

      // By user
      const userMap = new Map<
        string,
        { calls: number; tokens: number; cost: number }
      >();
      for (const m of metrics) {
        if (!m.userId) continue;
        if (!userMap.has(m.userId))
          userMap.set(m.userId, { calls: 0, tokens: 0, cost: 0 });
        const u = userMap.get(m.userId)!;
        u.calls++;
        u.tokens += m.totalTokens ?? 0;
        u.cost += Number(m.estimatedCost ?? 0);
      }
      const byUser = Array.from(userMap.entries())
        .map(([userId, stats]) => ({ userId, ...stats }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 20);

      // Latency percentiles
      const latencies = metrics
        .map((m) => m.duration ?? 0)
        .sort((a, b) => a - b);

      // Recent errors
      const recentErrors = this.dedupeRecentErrors(
        metrics
          .filter((m) => !m.success && (m.errorMsg || m.errorCode))
          .map((m) => ({
            timestamp: m.createdAt,
            model: m.modelId || "unknown",
            error: m.errorMsg || m.errorCode || "Unknown error",
          })),
      );

      return {
        period: { start: startTime, end: now },
        totalCalls,
        totalTokens,
        totalCost,
        successRate: totalCalls > 0 ? successfulCalls / totalCalls : 0,
        avgLatencyMs: totalCalls > 0 ? totalLatency / totalCalls : 0,
        p95LatencyMs: this.percentile(latencies, 0.95),
        p99LatencyMs: this.percentile(latencies, 0.99),
        fallbackRate: totalCalls > 0 ? fallbackCount / totalCalls : 0,
        byModel,
        byModule,
        byUser,
        recentErrors,
      };
    } catch (error) {
      this.logger.warn(`getDashboardFromDB failed: ${error}`);
      return this.getEmptyDashboard(startTime, now);
    }
  }

  /**
   * 获取空仪表盘（无数据时）
   */
  private getEmptyDashboard(start: Date, end: Date): ObservabilityDashboard {
    return {
      period: { start, end },
      totalCalls: 0,
      totalTokens: 0,
      totalCost: 0,
      successRate: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      fallbackRate: 0,
      byModel: {},
      byModule: {},
      byUser: [],
      recentErrors: [],
    };
  }
}
