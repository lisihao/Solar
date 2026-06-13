/**
 * ToolCircuitBreaker — PR-I 修复 #6
 *
 * 当一个 tool 在窗口内连续失败 N 次，自动 trip（短路），后续调用直接 fail
 * 不再真正触发 tool。窗口冷却后自动 half-open，允许 1 次试探。
 *
 * 状态：
 *   closed   · 正常工作
 *   open     · 短路；所有调用直接 fail
 *   half-open · 冷却结束后允许 1 次试探调用
 *
 * 默认参数（可注入）：
 *   failureThreshold = 3
 *   recoveryWindowMs = 60_000
 *
 * 与 LLM retry 的区别：
 *   - retry 是单次请求重试（处理瞬时网络抖动）
 *   - circuit breaker 是跨请求保护（处理 tool 持续坏掉，如 API 配额耗尽）
 */

import { Injectable } from "@nestjs/common";

type State = "closed" | "open" | "half-open";

interface ToolStat {
  consecutiveFailures: number;
  state: State;
  openedAt?: number;
  /** 最后一次被访问/记录的时间，用于 TTL 惰性淘汰，防 toolId 永不清理的内存泄漏。 */
  lastSeen: number;
}

@Injectable()
export class ToolCircuitBreaker {
  private readonly stats = new Map<string, ToolStat>();
  private failureThreshold = 3;
  private recoveryWindowMs = 60_000;
  /**
   * 条目存活上限：超过该时长未被访问的 toolId 在下次任意访问时被惰性清理。
   * 默认 = 10 × recoveryWindow，确保正常 open→half-open→closed 周期内不会误删；
   * configure() 改 recoveryWindowMs 时随之联动（除非显式覆盖 entryTtlMs）。
   */
  private entryTtlMs = 600_000;

  /**
   * NestJS DI 不支持注入纯 plain-object，因此 constructor 不接收任何参数；
   * 用 configure() 在 OnModuleInit 等位置覆盖默认值（默认 failure=3 / recovery=60s）。
   */
  constructor() {}

  configure(opts: {
    failureThreshold?: number;
    recoveryWindowMs?: number;
    /** 覆盖 TTL 淘汰阈值（毫秒）；不传则随 recoveryWindowMs × 10 联动。 */
    entryTtlMs?: number;
  }): void {
    if (opts.failureThreshold != null)
      this.failureThreshold = opts.failureThreshold;
    if (opts.recoveryWindowMs != null) {
      this.recoveryWindowMs = opts.recoveryWindowMs;
      this.entryTtlMs = opts.recoveryWindowMs * 10;
    }
    if (opts.entryTtlMs != null) this.entryTtlMs = opts.entryTtlMs;
  }

  /**
   * 惰性淘汰：删除 lastSeen 早于 (now - entryTtlMs) 的条目。
   * 每次访问/记录时调一次——O(n) 但 n = 活跃 toolId 数（极小），无需定时器/新依赖。
   * 跳过仍处 open/half-open 的条目（短路状态仍有意义，不能因闲置被清掉）。
   */
  private evictStale(now: number): void {
    const cutoff = now - this.entryTtlMs;
    for (const [toolId, s] of this.stats) {
      if (s.state === "closed" && s.lastSeen < cutoff) {
        this.stats.delete(toolId);
      }
    }
  }

  /** Returns true if the tool call should be allowed. */
  allow(toolId: string): boolean {
    const now = Date.now();
    this.evictStale(now);
    const s = this.stats.get(toolId);
    if (!s || s.state === "closed") return true;
    s.lastSeen = now;
    if (s.state === "half-open") return true;
    // open: check whether cool-down expired → half-open
    if (s.openedAt && now - s.openedAt >= this.recoveryWindowMs) {
      s.state = "half-open";
      return true;
    }
    return false;
  }

  recordSuccess(toolId: string): void {
    const s = this.stats.get(toolId);
    if (!s) return;
    s.consecutiveFailures = 0;
    s.state = "closed";
    s.openedAt = undefined;
    s.lastSeen = Date.now();
  }

  recordFailure(toolId: string): void {
    const now = Date.now();
    this.evictStale(now);
    const s = this.stats.get(toolId) ?? {
      consecutiveFailures: 0,
      state: "closed" as State,
      lastSeen: now,
    };
    s.consecutiveFailures += 1;
    s.lastSeen = now;
    if (s.consecutiveFailures >= this.failureThreshold) {
      s.state = "open";
      s.openedAt = now;
    }
    this.stats.set(toolId, s);
  }

  /** Test introspection */
  getState(toolId: string): State {
    return this.stats.get(toolId)?.state ?? "closed";
  }

  reset(toolId?: string): void {
    if (toolId) this.stats.delete(toolId);
    else this.stats.clear();
  }
}
