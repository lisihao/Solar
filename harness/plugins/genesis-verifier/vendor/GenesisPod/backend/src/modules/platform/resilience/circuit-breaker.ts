/**
 * CircuitBreaker — 通用熔断器抽象
 *
 * 背景（2026-05-05 第三轮审计）：散点散落 4 处 circuit breaker 实现：
 *   - EmbeddingService 401 + 429 (各自独立)
 *   - SemanticScholarSearchTool 429
 *   - OpenAlexSearchTool 429
 *   - PolicyDataService host-level 429 cooldown
 * 每处都重写 windowFailures / threshold / cooldownMs / isOpen / record 逻辑，
 * 接口不一致（has/get/check/markFail）→ 维护成本翻 4 倍 + 测试无统一。
 *
 * 抽象：
 *   const breaker = new CircuitBreaker({
 *     name: "embedding-401",
 *     thresholdCount: 1,        // 几次失败触发熔断
 *     cooldownMs: 5 * 60_000,   // 熔断持续时间
 *     windowMs: 60_000,         // 失败计数窗口（达到 threshold 才熔断）
 *   });
 *
 *   if (breaker.isOpen()) throw new Error(`circuit-open until ${breaker.openUntil}`);
 *   try {
 *     await api.call();
 *     breaker.recordSuccess();  // 可选：成功不主动 reset，仅清旧窗口
 *   } catch (err) {
 *     if (isAuthError(err)) breaker.recordFailure();
 *     throw err;
 *   }
 *
 * 设计：
 *   - thresholdCount=1 → 单次失败立即熔断（如 401 不可重试）
 *   - thresholdCount=N → 滑动窗口 N 次失败熔断（如 429 重试 N 次后熔断）
 *   - 主动 reset() 让 admin 改 key / cleared 后立刻生效
 */

export interface CircuitBreakerOptions {
  /** 标识名（log / metric 用） */
  readonly name: string;
  /** 失败次数阈值（windowMs 内累计达此触发熔断） */
  readonly thresholdCount: number;
  /** 熔断持续时间（ms） */
  readonly cooldownMs: number;
  /** 失败计数滑动窗口（ms） */
  readonly windowMs: number;
}

export class CircuitBreaker {
  private readonly opts: CircuitBreakerOptions;
  private failures: number[] = []; // timestamp 数组
  private openUntilMs = 0;

  constructor(opts: CircuitBreakerOptions) {
    this.opts = opts;
  }

  /**
   * 当前是否处于熔断状态。
   * true → caller 应直接 throw / 走 fallback，不再发请求。
   */
  isOpen(): boolean {
    if (Date.now() < this.openUntilMs) return true;
    // 清理 window 外的失败时间戳（lazy GC）
    const cutoff = Date.now() - this.opts.windowMs;
    this.failures = this.failures.filter((ts) => ts > cutoff);
    return false;
  }

  /**
   * 记录一次失败。累计达 threshold 触发熔断。
   */
  recordFailure(): void {
    const now = Date.now();
    this.failures.push(now);
    const cutoff = now - this.opts.windowMs;
    this.failures = this.failures.filter((ts) => ts > cutoff);
    if (this.failures.length >= this.opts.thresholdCount) {
      this.openUntilMs = now + this.opts.cooldownMs;
      this.failures = []; // 熔断后清空，避免反复触发
    }
  }

  /**
   * 主动 reset（如 admin 修复 key 后调用）。
   */
  reset(): void {
    this.failures = [];
    this.openUntilMs = 0;
  }

  /**
   * 当前熔断截止时间戳（ms）；未熔断则为 0。
   */
  get openUntil(): number {
    return this.openUntilMs;
  }

  get name(): string {
    return this.opts.name;
  }

  /** 当前窗口内失败计数（监控用） */
  get currentFailures(): number {
    const cutoff = Date.now() - this.opts.windowMs;
    return this.failures.filter((ts) => ts > cutoff).length;
  }
}

/**
 * Cooldown 失败降级工具：决定一个 error 应该走 ERROR 还是 WARN log。
 *
 * 用法（替代散点 isCooldownFail / 手写 if-else）：
 *   if (isCooldownFailure(err)) logger.warn(...);
 *   else logger.error(...);
 */
export function isCooldownFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /circuit[- ]open|in (?:429|cooldown)|cooldown until/i.test(msg);
}
