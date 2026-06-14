/**
 * Global Source Throttle Service
 *
 * NestJS singleton 提供 per-source 三层保护：
 *   1. Cooldown：429 后全局停摆 N 秒，期间所有请求 fast-fail（不再压外部 API）
 *   2. Rate limit (req/s)：token bucket，限"每秒发起数"，挡住 burst
 *   3. Concurrency：p-limit，限"同时在飞数"，避免资源耗尽
 *
 * 三层叠加的必要性（2026-05-13 OpenAlex 429 事故复盘）：
 *   - 只有 concurrency: 5 并发"瞬时同时发起"仍是 5 req/秒的 burst，外部 API 直接 429
 *   - 没有 cooldown 联动：第 1 个请求 429 设了 cooldown，但已 in-flight 的 4 个并发各自再踩墙
 *   → 必须 token bucket 限速 + cooldown 让排队请求 fast-fail
 *
 * Uses p-limit + token bucket，零外部依赖。
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  createConcurrencyLimiter,
  createRateLimiter,
} from "@/common/utils/concurrency.utils";
import type { ThrottleStats } from "./search.types";

/** Per-source 限速配置 */
export interface SourceThrottleConfig {
  /** 并发上限（同时在飞数） */
  concurrency: number;
  /** 速率上限（每秒最多发起数）；不设则不限速，只用 concurrency */
  reqPerSec?: number;
}

/**
 * Default per-source throttle config.
 *
 * 限速选型原则：
 *   - reqPerSec ≤ 外部 polite/free pool 实际上限的 80%（留 buffer 避 burst 429）
 *   - concurrency ≤ reqPerSec × 平均响应秒数（避免堆积无效排队）
 *
 * 2026-05-13 OpenAlex/ArXiv 429 事故后参数收紧：
 *   - openalex: 5 并发 → 2 并发 + 8 req/s（polite pool 10/s 留 20% buffer）
 *   - arxiv: 1 并发 → 加 2 req/s（外部限 3/s）
 *   - 其他保持原值，按需要再加 reqPerSec
 */
const DEFAULT_CONFIG: Record<string, SourceThrottleConfig> = {
  "arxiv-search": { concurrency: 1, reqPerSec: 2 },
  "semantic-scholar": { concurrency: 2, reqPerSec: 1 }, // unauthenticated 1 req/s
  pubmed: { concurrency: 3, reqPerSec: 3 },
  // OpenAlex polite pool 限 10 req/s + $1/day budget（freemium 2026-05）
  // 不再写"100k/month, generous" —— 已过时
  "openalex-search": { concurrency: 2, reqPerSec: 8 },
  "web-search": { concurrency: 8 }, // Tavily/Serper 自身已收费限速
  "github-search": { concurrency: 2, reqPerSec: 1 }, // 30/min with token
  "hackernews-search": { concurrency: 3 },
  "social-x": { concurrency: 2 },
  policy: { concurrency: 3 },
  "finance-api": { concurrency: 1 },
  "weather-api": { concurrency: 1 },
  "local-search": { concurrency: 3 },
};

/** Fallback concurrency for unregistered sources */
const DEFAULT_CONCURRENCY_LIMIT = 3;

/** 429 默认 cooldown（毫秒） */
const DEFAULT_COOLDOWN_MS = 30_000;

interface LimiterEntry {
  limiter: <T>(fn: () => Promise<T>) => Promise<T>;
  rateLimiter?: { acquire(signal?: AbortSignal): Promise<void> };
  concurrency: number;
  reqPerSec?: number;
  activeCount: number;
  pendingCount: number;
  cooldownUntil: number;
}

/** 检测错误是否为 429 限速 */
function isRateLimitError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  return /\b429\b|rate.?limit|too many requests/i.test(msg);
}

@Injectable()
export class GlobalSourceThrottleService {
  private readonly logger = new Logger(GlobalSourceThrottleService.name);
  private readonly limiters = new Map<string, LimiterEntry>();

  constructor() {
    // Pre-register all known sources
    for (const [sourceId, cfg] of Object.entries(DEFAULT_CONFIG)) {
      this.registerSource(sourceId, cfg);
    }
    this.logger.log(`Initialized with ${this.limiters.size} source throttles`);
  }

  /**
   * Register a source with concurrency (+ optional req/s rate limit).
   *
   * 接受两种形态保持向后兼容：
   *   - registerSource("x", 5)
   *   - registerSource("x", { concurrency: 5, reqPerSec: 10 })
   */
  registerSource(
    sourceId: string,
    config: number | SourceThrottleConfig,
  ): void {
    if (this.limiters.has(sourceId)) return;
    const cfg: SourceThrottleConfig =
      typeof config === "number" ? { concurrency: config } : config;
    this.limiters.set(sourceId, {
      limiter: createConcurrencyLimiter(cfg.concurrency),
      rateLimiter: cfg.reqPerSec ? createRateLimiter(cfg.reqPerSec) : undefined,
      concurrency: cfg.concurrency,
      reqPerSec: cfg.reqPerSec,
      activeCount: 0,
      pendingCount: 0,
      cooldownUntil: 0,
    });
  }

  /**
   * 手动设置 source cooldown（让排队中的请求 fast-fail）。
   *
   * 典型场景：catch 到 429 后，让接下来 N 秒所有该 source 的请求立即失败，
   * 而不是堆在 throttle 队列里挨个挨打。
   */
  setCooldown(
    sourceId: string,
    durationMs: number = DEFAULT_COOLDOWN_MS,
  ): void {
    let entry = this.limiters.get(sourceId);
    if (!entry) {
      this.registerSource(sourceId, DEFAULT_CONCURRENCY_LIMIT);
      entry = this.limiters.get(sourceId)!;
    }
    const until = Date.now() + durationMs;
    if (until > entry.cooldownUntil) {
      entry.cooldownUntil = until;
      this.logger.warn(
        `[${sourceId}] Cooldown set for ${durationMs}ms (until ${new Date(until).toISOString()})`,
      );
    }
  }

  /** 返回该 source 剩余 cooldown 毫秒；0 = 不在 cooldown */
  getCooldownRemaining(sourceId: string): number {
    const entry = this.limiters.get(sourceId);
    if (!entry) return 0;
    return Math.max(0, entry.cooldownUntil - Date.now());
  }

  /**
   * Execute a function through cooldown → rate limit → concurrency.
   *
   * Throws immediately if:
   *   - signal already aborted
   *   - source is in cooldown (fast-fail)
   * Otherwise queues if rate/concurrency slot unavailable.
   *
   * 429 错误会自动设 cooldown，避免后续请求继续撞墙。
   */
  async execute<T>(
    sourceId: string,
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let entry = this.limiters.get(sourceId);
    if (!entry) {
      this.registerSource(sourceId, DEFAULT_CONCURRENCY_LIMIT);
      entry = this.limiters.get(sourceId)!;
    }

    if (signal?.aborted) {
      throw new Error(`Search cancelled for ${sourceId}`);
    }

    // ── Layer 1: cooldown fast-fail ────────────────────────────────────────
    const cooldownRemaining = entry.cooldownUntil - Date.now();
    if (cooldownRemaining > 0) {
      throw new Error(
        `Search throttled for ${sourceId}: in cooldown for ${cooldownRemaining}ms (likely 429)`,
      );
    }

    entry.pendingCount++;
    const queueStartTime = Date.now();
    let movedToActive = false;

    try {
      const result = await entry.limiter(async () => {
        entry.pendingCount--;
        entry.activeCount++;
        movedToActive = true;

        // Re-check abort + cooldown after queue wait
        if (signal?.aborted) {
          throw new Error(`Search cancelled for ${sourceId} after queuing`);
        }
        const recheck = entry.cooldownUntil - Date.now();
        if (recheck > 0) {
          throw new Error(
            `Search throttled for ${sourceId}: cooldown activated while queued (${recheck}ms remaining)`,
          );
        }

        // ── Layer 2: rate limit (req/s token bucket) ──────────────────────
        if (entry.rateLimiter) {
          await entry.rateLimiter.acquire(signal);
          if (signal?.aborted) {
            throw new Error(
              `Search cancelled for ${sourceId} after rate-limit wait`,
            );
          }
        }

        const waitMs = Date.now() - queueStartTime;
        if (waitMs > 1000) {
          this.logger.debug(
            `[${sourceId}] Waited ${waitMs}ms in throttle queue`,
          );
        }

        try {
          return await fn();
        } catch (err) {
          // 429 → auto-cooldown，避免排队中的兄弟也撞墙
          if (isRateLimitError(err)) {
            this.setCooldown(sourceId);
          }
          throw err;
        } finally {
          entry.activeCount--;
        }
      });
      return result;
    } catch (error) {
      if (!movedToActive && entry.pendingCount > 0) entry.pendingCount--;
      throw error;
    }
  }

  /**
   * Get throttle stats for all registered sources (for monitoring).
   */
  getStats(): ThrottleStats[] {
    const stats: ThrottleStats[] = [];
    const now = Date.now();
    for (const [sourceId, entry] of this.limiters) {
      stats.push({
        sourceId,
        concurrency: entry.concurrency,
        activeCount: entry.activeCount,
        pendingCount: entry.pendingCount,
        reqPerSec: entry.reqPerSec,
        cooldownRemainingMs: Math.max(0, entry.cooldownUntil - now),
      });
    }
    return stats;
  }

  /**
   * Get queue size for a specific source.
   */
  getQueueSize(sourceId: string): number {
    return this.limiters.get(sourceId)?.pendingCount ?? 0;
  }
}
