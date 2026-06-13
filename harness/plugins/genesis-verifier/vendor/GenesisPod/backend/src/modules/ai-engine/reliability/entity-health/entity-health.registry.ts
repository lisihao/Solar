/**
 * EntityHealthRegistry —— 实体健康/熔断（circuit-breaker 模式）
 *
 * 聚合对外名 = entity-health（reliability 子域）；内部类型沿用 circuit-breaker
 * 业界术语（CircuitState 等）描述熔断机制本身。按 entityId（model / provider /
 * service）维护熔断状态。原 AI Teams AgentCircuitBreakerService 下沉而来，
 * 提供通用的 entity 健康管理能力
 *
 * 功能：
 * - 故障检测与自动隔离（三态状态机：CLOSED/OPEN/HALF_OPEN）
 * - 健康评分与智能选择
 * - 响应时间追踪
 * - 负载均衡支持
 * - 自动清理过期数据
 * - Redis 持久化（写透策略，可选）
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import { CacheService } from "@/common/cache/cache.service";

/**
 * 任务完成类型 - 区分不同的失败模式
 */
export enum TaskCompletionType {
  SUCCESS = "SUCCESS", // 成功
  API_ERROR = "API_ERROR", // API 调用失败（网络、服务器错误）
  RATE_LIMITED = "RATE_LIMITED", // 限速
  TIMEOUT = "TIMEOUT", // 超时
  CONTENT_ERROR = "CONTENT_ERROR", // 内容质量问题
  CONTEXT_OVERFLOW = "CONTEXT_OVERFLOW", // 上下文溢出（不可重试）
  AUTH_ERROR = "AUTH_ERROR", // 认证/授权错误（不可重试）
}

/**
 * 熔断器状态
 */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * 熔断器配置
 */
export interface CircuitBreakerConfig {
  /** 触发熔断的连续失败次数（默认 3） */
  failureThreshold?: number;
  /** 默认冷却时间（毫秒，默认 3 分钟） */
  defaultCooldownMs?: number;
  /** 限速冷却时间（毫秒，默认 5 分钟） */
  rateLimitCooldownMs?: number;
  /** 半开状态成功阈值（默认 2） */
  halfOpenSuccessThreshold?: number;
  /** 不活跃 TTL（毫秒，默认 24 小时） */
  inactiveTtlMs?: number;
  /** 清理间隔（毫秒，默认 1 小时） */
  cleanupIntervalMs?: number;
  /** 响应时间采样数（默认 20） */
  maxResponseSamples?: number;
}

/**
 * 单个熔断器状态
 */
interface CircuitBreakerState {
  entityId: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  cooldownUntil: Date | null;
  rateLimitCount: number;
  lastRateLimitTime: Date | null;
  lastActivityTime: Date;
}

/**
 * 健康指标
 */
export interface HealthMetrics {
  entityId: string;
  successRate: number;
  avgResponseTime: number;
  rateLimitHits: number;
  currentLoad: number;
  isAvailable: boolean;
  cooldownRemaining: number;
  state: CircuitState;
}

/**
 * 熔断器服务
 * 实现 Circuit Breaker 模式，用于：
 * 1. 追踪 Agent/Service 健康状态和失败率
 * 2. 自动禁用故障实体（熔断打开）
 * 3. 实现冷却期管理
 * 4. 提供健康指标用于智能负载均衡
 */
@Injectable()
export class EntityHealthRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EntityHealthRegistry.name);

  // Redis key 前缀
  private static readonly REDIS_PREFIX = "circuit-breaker:";

  // 熔断器状态
  private readonly breakers = new Map<string, CircuitBreakerState>();

  // 响应时间追踪（滑动窗口）
  private readonly responseTimes = new Map<string, number[]>();

  // 当前负载
  private readonly currentLoad = new Map<string, number>();

  // 清理定时器
  private cleanupInterval: NodeJS.Timeout | null = null;

  // ==================== 配置 ====================

  private readonly config: Required<CircuitBreakerConfig>;

  constructor(
    @Optional() private readonly cacheService?: CacheService,
    /** B (2026-05-05): CIRCUIT_OPEN/CLOSE hook seam — plugin 收到熔断事件
     *  push 告警到 Slack/PagerDuty / 切换备用 provider 等。 */
    @Optional()
    private readonly hookBus?: import("@/plugins/core/hook-bus").HookBus,
  ) {
    // 默认配置
    this.config = {
      failureThreshold: 3,
      defaultCooldownMs: 3 * 60 * 1000, // 3 分钟
      rateLimitCooldownMs: 5 * 60 * 1000, // 5 分钟
      halfOpenSuccessThreshold: 2,
      inactiveTtlMs: 24 * 60 * 60 * 1000, // 24 小时
      cleanupIntervalMs: 60 * 60 * 1000, // 1 小时
      maxResponseSamples: 20,
    };
  }

  // ==================== 生命周期 ====================

  async onModuleInit(): Promise<void> {
    this.logger.log(
      `[CircuitBreaker] Initializing with TTL=${this.config.inactiveTtlMs}ms, cleanup interval=${this.config.cleanupIntervalMs}ms`,
    );
    this.startCleanupScheduler();
    await this.loadFromRedis();
  }

  onModuleDestroy(): void {
    this.logger.log(`[CircuitBreaker] Shutting down`);
    this.stopCleanupScheduler();
  }

  // ==================== 配置方法 ====================

  /**
   * 更新配置（可选，用于自定义场景）
   */
  configure(config: CircuitBreakerConfig): void {
    Object.assign(this.config, config);
    this.logger.log(`[CircuitBreaker] Configuration updated`);
  }

  // ==================== 核心方法 ====================

  /**
   * 检查实体是否可以执行
   */
  canExecute(entityId: string): boolean {
    const breaker = this.breakers.get(entityId);

    if (!breaker) {
      return true; // 新实体，允许执行
    }

    if (breaker.state === "CLOSED") {
      return true;
    }

    if (breaker.state === "OPEN") {
      // 检查冷却期是否过期
      if (
        breaker.cooldownUntil &&
        Date.now() > breaker.cooldownUntil.getTime()
      ) {
        // 转换到半开状态
        breaker.state = "HALF_OPEN";
        breaker.successCount = 0;
        this.logger.log(
          `[CircuitBreaker] Entity ${entityId} transitioning to HALF_OPEN state`,
        );
        this.saveToRedis(entityId, breaker);
        return true; // 允许一次测试请求
      }
      return false;
    }

    // HALF_OPEN 状态：允许有限请求
    return true;
  }

  /**
   * 检查实体是否可用（canExecute 的别名）
   */
  isAvailable(entityId: string): boolean {
    return this.canExecute(entityId);
  }

  /**
   * 获取剩余冷却时间（毫秒）
   */
  getCooldownRemaining(entityId: string): number {
    const breaker = this.breakers.get(entityId);
    if (!breaker?.cooldownUntil) {
      return 0;
    }
    return Math.max(0, breaker.cooldownUntil.getTime() - Date.now());
  }

  /**
   * 记录成功执行
   */
  recordSuccess(entityId: string, responseTimeMs?: number): void {
    const breaker = this.getOrCreate(entityId);

    breaker.failureCount = 0;
    breaker.successCount++;
    breaker.lastSuccessTime = new Date();

    // 记录响应时间
    if (responseTimeMs !== undefined) {
      this.recordResponseTime(entityId, responseTimeMs);
    }

    // 从 HALF_OPEN 转换到 CLOSED
    if (breaker.state === "HALF_OPEN") {
      if (breaker.successCount >= this.config.halfOpenSuccessThreshold) {
        const wasOpenSince = breaker.lastFailureTime?.getTime() ?? Date.now();
        breaker.state = "CLOSED";
        breaker.cooldownUntil = null;
        this.logger.log(
          `[CircuitBreaker] Entity ${entityId} circuit CLOSED after ${breaker.successCount} successful requests`,
        );
        this.fireCircuitClose(entityId, Date.now() - wasOpenSince);
      }
    }

    this.breakers.set(entityId, breaker);
    this.saveToRedis(entityId, breaker);
  }

  /**
   * 记录失败执行
   */
  recordFailure(
    entityId: string,
    errorType: TaskCompletionType,
    errorMsg?: string,
  ): void {
    const breaker = this.getOrCreate(entityId);

    breaker.failureCount++;
    breaker.lastFailureTime = new Date();

    // 限速：立即熔断，使用更长的冷却期
    if (errorType === TaskCompletionType.RATE_LIMITED) {
      breaker.rateLimitCount++;
      breaker.lastRateLimitTime = new Date();
      const wasOpen = breaker.state === "OPEN";
      breaker.state = "OPEN";
      breaker.cooldownUntil = new Date(
        Date.now() + this.config.rateLimitCooldownMs,
      );
      this.logger.warn(
        `[CircuitBreaker] Entity ${entityId} RATE LIMITED (${breaker.rateLimitCount} times), circuit OPEN for ${this.config.rateLimitCooldownMs / 1000}s. Error: ${errorMsg}`,
      );
      this.breakers.set(entityId, breaker);
      this.saveToRedis(entityId, breaker);
      if (!wasOpen) {
        this.fireCircuitOpen(
          entityId,
          breaker.failureCount,
          this.config.rateLimitCooldownMs,
          "rate-limit",
          errorMsg,
        );
      }
      return;
    }

    // 不可重试错误：立即熔断
    if (
      errorType === TaskCompletionType.CONTEXT_OVERFLOW ||
      errorType === TaskCompletionType.AUTH_ERROR
    ) {
      const wasOpen = breaker.state === "OPEN";
      breaker.state = "OPEN";
      breaker.cooldownUntil = new Date(
        Date.now() + this.config.defaultCooldownMs * 2,
      );
      this.logger.warn(
        `[CircuitBreaker] Entity ${entityId} non-retryable error (${errorType}), circuit OPEN. Error: ${errorMsg}`,
      );
      this.breakers.set(entityId, breaker);
      this.saveToRedis(entityId, breaker);
      if (!wasOpen) {
        const cat =
          errorType === TaskCompletionType.AUTH_ERROR ? "auth" : "unknown";
        this.fireCircuitOpen(
          entityId,
          breaker.failureCount,
          this.config.defaultCooldownMs * 2,
          cat,
          errorMsg,
        );
      }
      return;
    }

    // 其他错误：检查阈值
    if (breaker.failureCount >= this.config.failureThreshold) {
      const wasOpen = breaker.state === "OPEN";
      breaker.state = "OPEN";
      breaker.cooldownUntil = new Date(
        Date.now() + this.config.defaultCooldownMs,
      );
      this.logger.warn(
        `[CircuitBreaker] Entity ${entityId} failed ${breaker.failureCount} times, circuit OPEN for ${this.config.defaultCooldownMs / 1000}s. Error: ${errorMsg}`,
      );
      if (!wasOpen) {
        const cat =
          errorType === TaskCompletionType.TIMEOUT ? "timeout" : "unknown";
        this.fireCircuitOpen(
          entityId,
          breaker.failureCount,
          this.config.defaultCooldownMs,
          cat,
          errorMsg,
        );
      }
    }

    // HALF_OPEN 状态下任何失败都应重新打开熔断器
    if (breaker.state === "HALF_OPEN") {
      breaker.state = "OPEN";
      breaker.cooldownUntil = new Date(
        Date.now() + this.config.defaultCooldownMs,
      );
      this.logger.warn(
        `[CircuitBreaker] Entity ${entityId} failed in HALF_OPEN state, circuit re-OPENED`,
      );
    }

    this.breakers.set(entityId, breaker);
    this.saveToRedis(entityId, breaker);
  }

  /**
   * 记录执行结果（统一接口）
   */
  recordExecution(
    entityId: string,
    success: boolean,
    durationMs?: number,
    errorType?: TaskCompletionType,
    errorMsg?: string,
  ): void {
    if (success) {
      this.recordSuccess(entityId, durationMs);
    } else {
      this.recordFailure(
        entityId,
        errorType || TaskCompletionType.API_ERROR,
        errorMsg,
      );
    }
  }

  // ==================== 负载管理 ====================

  /**
   * 增加负载（任务开始时调用）
   */
  incrementLoad(entityId: string): void {
    const current = this.currentLoad.get(entityId) || 0;
    this.currentLoad.set(entityId, current + 1);
  }

  /**
   * 减少负载（任务完成时调用）
   */
  decrementLoad(entityId: string): void {
    const current = this.currentLoad.get(entityId) || 0;
    this.currentLoad.set(entityId, Math.max(0, current - 1));
  }

  // ==================== 健康指标 ====================

  /**
   * 获取实体的健康指标
   */
  getHealthMetrics(entityId: string): HealthMetrics {
    const breaker = this.breakers.get(entityId);
    const responseTimes = this.responseTimes.get(entityId) || [];
    const load = this.currentLoad.get(entityId) || 0;

    if (!breaker) {
      return {
        entityId,
        successRate: 1.0,
        avgResponseTime: 0,
        rateLimitHits: 0,
        currentLoad: load,
        isAvailable: true,
        cooldownRemaining: 0,
        state: "CLOSED",
      };
    }

    // 计算成功率
    const totalAttempts = breaker.failureCount + breaker.successCount;
    const successRate =
      totalAttempts > 0 ? breaker.successCount / totalAttempts : 1.0;

    // 计算平均响应时间
    const avgResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

    return {
      entityId,
      successRate,
      avgResponseTime,
      rateLimitHits: breaker.rateLimitCount,
      currentLoad: load,
      isAvailable: this.canExecute(entityId),
      cooldownRemaining: this.getCooldownRemaining(entityId),
      state: breaker.state,
    };
  }

  /**
   * 获取所有实体的健康指标
   */
  getAllHealthMetrics(): HealthMetrics[] {
    const metrics: HealthMetrics[] = [];
    for (const entityId of this.breakers.keys()) {
      metrics.push(this.getHealthMetrics(entityId));
    }
    return metrics;
  }

  /**
   * 从列表中选择最佳实体
   * 考虑：可用性、成功率、当前负载、响应时间
   */
  selectBest(entityIds: string[]): string | null {
    const availableEntities = entityIds.filter((id) => this.canExecute(id));

    if (availableEntities.length === 0) {
      this.logger.warn(
        `[CircuitBreaker] No available entities from ${entityIds.length} candidates`,
      );
      return null;
    }

    // 为每个实体评分（越高越好）
    const scored = availableEntities.map((entityId) => {
      const metrics = this.getHealthMetrics(entityId);
      // 评分 = 成功率 * 负载因子
      const loadFactor = Math.max(0.1, 1 - metrics.currentLoad / 10);
      const score = metrics.successRate * loadFactor;
      return { entityId, score, metrics };
    });

    // 按评分降序排列
    scored.sort((a, b) => b.score - a.score);

    this.logger.debug(
      `[CircuitBreaker] Selection scores: ${scored.map((s) => `${s.entityId}:${s.score.toFixed(2)}`).join(", ")}`,
    );

    return scored[0].entityId;
  }

  // ==================== 错误类型解析 ====================

  /**
   * 解析错误消息以确定 TaskCompletionType
   */
  parseErrorType(errorMsg: string): TaskCompletionType {
    if (!errorMsg) return TaskCompletionType.API_ERROR;

    const lowerMsg = errorMsg.toLowerCase();

    // 限速模式
    if (
      lowerMsg.includes("rate limit") ||
      lowerMsg.includes("rate_limit") ||
      lowerMsg.includes("too many requests") ||
      lowerMsg.includes("429") ||
      lowerMsg.includes("quota exceeded")
    ) {
      return TaskCompletionType.RATE_LIMITED;
    }

    // 超时模式
    if (
      lowerMsg.includes("timeout") ||
      lowerMsg.includes("timed out") ||
      lowerMsg.includes("etimedout")
    ) {
      return TaskCompletionType.TIMEOUT;
    }

    // 上下文溢出（不可重试）
    if (
      lowerMsg.includes("context") ||
      lowerMsg.includes("token limit") ||
      lowerMsg.includes("too large") ||
      lowerMsg.includes("maximum context")
    ) {
      return TaskCompletionType.CONTEXT_OVERFLOW;
    }

    // 认证错误（不可重试）
    if (
      lowerMsg.includes("authentication") ||
      lowerMsg.includes("authorization") ||
      lowerMsg.includes("invalid api key") ||
      lowerMsg.includes("401") ||
      lowerMsg.includes("403")
    ) {
      return TaskCompletionType.AUTH_ERROR;
    }

    return TaskCompletionType.API_ERROR;
  }

  // ==================== 管理方法 ====================

  /**
   * 重置单个实体的熔断器
   */
  reset(entityId: string): void {
    this.breakers.delete(entityId);
    this.responseTimes.delete(entityId);
    this.currentLoad.delete(entityId);
    this.deleteFromRedis(entityId);
    this.logger.log(`[CircuitBreaker] Reset circuit for entity ${entityId}`);
  }

  /**
   * 重置所有熔断器
   */
  resetAll(): void {
    this.breakers.clear();
    this.responseTimes.clear();
    this.currentLoad.clear();
    if (this.cacheService) {
      this.cacheService
        .del(`${EntityHealthRegistry.REDIS_PREFIX}_index`)
        .catch((err) =>
          this.logger.warn(`[CircuitBreaker] Redis resetAll failed: ${err}`),
        );
    }
    this.logger.log(`[CircuitBreaker] Reset all circuits`);
  }

  /**
   * 获取清理统计
   */
  getStats(): {
    totalBreakers: number;
    oldestBreakerAge: number | null;
    config: CircuitBreakerConfig;
  } {
    const now = Date.now();
    let oldestAge: number | null = null;

    for (const breaker of this.breakers.values()) {
      const age = now - breaker.lastActivityTime.getTime();
      if (oldestAge === null || age > oldestAge) {
        oldestAge = age;
      }
    }

    return {
      totalBreakers: this.breakers.size,
      oldestBreakerAge: oldestAge,
      config: { ...this.config },
    };
  }

  // ==================== 私有方法 ====================

  private getOrCreate(entityId: string): CircuitBreakerState {
    let breaker = this.breakers.get(entityId);
    if (!breaker) {
      breaker = {
        entityId,
        state: "CLOSED",
        failureCount: 0,
        successCount: 0,
        lastFailureTime: null,
        lastSuccessTime: null,
        cooldownUntil: null,
        rateLimitCount: 0,
        lastRateLimitTime: null,
        lastActivityTime: new Date(),
      };
      this.breakers.set(entityId, breaker);
      this.saveToRedis(entityId, breaker);
    }
    // 更新最后活动时间
    breaker.lastActivityTime = new Date();
    return breaker;
  }

  private recordResponseTime(entityId: string, timeMs: number): void {
    let times = this.responseTimes.get(entityId);
    if (!times) {
      times = [];
      this.responseTimes.set(entityId, times);
    }

    times.push(timeMs);

    // 只保留最近 N 个样本
    if (times.length > this.config.maxResponseSamples) {
      times.shift();
    }
  }

  private startCleanupScheduler(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveBreakers();
    }, this.config.cleanupIntervalMs).unref();

    this.logger.log(
      `[CircuitBreaker] Cleanup scheduler started (interval: ${this.config.cleanupIntervalMs}ms)`,
    );
  }

  private stopCleanupScheduler(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.logger.log(`[CircuitBreaker] Cleanup scheduler stopped`);
    }
  }

  private cleanupInactiveBreakers(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [entityId, breaker] of this.breakers) {
      const inactiveTime = now - breaker.lastActivityTime.getTime();
      if (inactiveTime > this.config.inactiveTtlMs) {
        this.breakers.delete(entityId);
        this.responseTimes.delete(entityId);
        this.currentLoad.delete(entityId);
        this.deleteFromRedis(entityId);
        cleanedCount++;
        this.logger.log(
          `[CircuitBreaker] Cleaned inactive breaker: ${entityId} (inactive for ${Math.round(inactiveTime / 1000 / 60 / 60)}h)`,
        );
      }
    }

    if (cleanedCount > 0) {
      this.logger.log(
        `[CircuitBreaker] Cleanup completed: removed ${cleanedCount} inactive breakers. Remaining: ${this.breakers.size}`,
      );
    }
  }

  // ==================== Redis 持久化 ====================

  private async loadFromRedis(): Promise<void> {
    if (!this.cacheService) return;
    try {
      const index = await this.cacheService.get<string[]>(
        `${EntityHealthRegistry.REDIS_PREFIX}_index`,
      );
      if (!index || index.length === 0) return;
      let loaded = 0;
      for (const entityId of index) {
        const state = await this.cacheService.get<CircuitBreakerState>(
          `${EntityHealthRegistry.REDIS_PREFIX}${entityId}`,
        );
        if (state) {
          // Restore Date objects (Redis serializes to strings)
          state.lastActivityTime = new Date(state.lastActivityTime);
          if (state.lastFailureTime)
            state.lastFailureTime = new Date(state.lastFailureTime);
          if (state.lastSuccessTime)
            state.lastSuccessTime = new Date(state.lastSuccessTime);
          if (state.cooldownUntil)
            state.cooldownUntil = new Date(state.cooldownUntil);
          if (state.lastRateLimitTime)
            state.lastRateLimitTime = new Date(state.lastRateLimitTime);
          this.breakers.set(entityId, state);
          loaded++;
        }
      }
      if (loaded > 0)
        this.logger.log(
          `[CircuitBreaker] Restored ${loaded} breaker states from Redis`,
        );
    } catch (error) {
      this.logger.warn(`[CircuitBreaker] Failed to load from Redis: ${error}`);
    }
  }

  private saveToRedis(entityId: string, state: CircuitBreakerState): void {
    if (!this.cacheService) return;
    const ttlSeconds = Math.ceil(this.config.inactiveTtlMs / 1000);
    Promise.all([
      this.cacheService.set(
        `${EntityHealthRegistry.REDIS_PREFIX}${entityId}`,
        state,
        ttlSeconds,
      ),
      this.updateRedisIndex(entityId, "add"),
    ]).catch((err) =>
      this.logger.warn(
        `[CircuitBreaker] Redis save failed for ${entityId}: ${err}`,
      ),
    );
  }

  private deleteFromRedis(entityId: string): void {
    if (!this.cacheService) return;
    Promise.all([
      this.cacheService.del(`${EntityHealthRegistry.REDIS_PREFIX}${entityId}`),
      this.updateRedisIndex(entityId, "remove"),
    ]).catch((err) =>
      this.logger.warn(
        `[CircuitBreaker] Redis delete failed for ${entityId}: ${err}`,
      ),
    );
  }

  private async updateRedisIndex(
    entityId: string,
    action: "add" | "remove",
  ): Promise<void> {
    if (!this.cacheService) return;
    const indexKey = `${EntityHealthRegistry.REDIS_PREFIX}_index`;
    const ttlSeconds = Math.ceil(this.config.inactiveTtlMs / 1000);
    const index = (await this.cacheService.get<string[]>(indexKey)) || [];
    if (action === "add") {
      if (!index.includes(entityId)) index.push(entityId);
    } else {
      const i = index.indexOf(entityId);
      if (i !== -1) index.splice(i, 1);
    }
    await this.cacheService.set(indexKey, index, ttlSeconds);
  }

  // ── B (2026-05-05): CIRCUIT_OPEN/CLOSE hook fire helpers（fire-and-forget）──
  private fireCircuitOpen(
    target: string,
    failureCount: number,
    cooldownMs: number,
    category: "rate-limit" | "timeout" | "5xx" | "auth" | "unknown",
    lastError?: string,
  ): void {
    if (!this.hookBus) return;
    // ★ 全覆盖审计修 (2026-05-06): hook 失败必须可见，改 warn 而非吞错
    void this.hookBus
      .fire(
        "engine.circuit.open",
        { target, failureCount, cooldownMs, category, lastError },
        async () => undefined,
      )
      .catch((err) =>
        this.logger.warn("[circuit-breaker] open hook error", err),
      );
  }

  private fireCircuitClose(target: string, durationMs: number): void {
    if (!this.hookBus) return;
    // ★ 全覆盖审计修 (2026-05-06): hook 失败必须可见，改 warn 而非吞错
    void this.hookBus
      .fire(
        "engine.circuit.close",
        { target, durationMs, manual: false },
        async () => undefined,
      )
      .catch((err) =>
        this.logger.warn("[circuit-breaker] close hook error", err),
      );
  }
}
