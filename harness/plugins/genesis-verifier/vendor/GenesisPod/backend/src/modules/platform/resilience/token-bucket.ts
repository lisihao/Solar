/**
 * Token bucket 限流算法（L1 platform/resilience 通用韧性基元）
 *
 * 历史：原 plugins/resilience/rate-limit → 2026-05-04 回归 ai-engine/reliability
 * → 2026-06-03 W1-2 按 MECE 下沉 L1 platform/resilience（与 CircuitBreaker 同居，
 * 都是通用韧性基元；token-bucket 是标准算法、非 swappable backend、不该是 plugin）。
 * 引擎层 RateLimitService 改注入本层 ITokenBucketStore 端口（L2→L1 合法）。
 *
 * 设计：
 * - 每个 key 一个 bucket（capacity / refillPerSec）
 * - tryConsume(n=1) 成功返回 true；不够返回 false
 * - InMemoryTokenBucketStore：单 pod；带 idle 驱逐避免 key 无界增长
 * - RedisTokenBucketStore：多 pod 一致（经 CacheService 共享 bucket 状态）
 */
import { CacheService } from "@/common/cache/cache.service";

import type { ITokenBucketStore } from "./abstractions/token-bucket.port";

export type { ITokenBucketStore } from "./abstractions/token-bucket.port";

interface BucketState {
  tokens: number;
  lastRefill: number;
}

export class InMemoryTokenBucketStore implements ITokenBucketStore {
  private readonly buckets = new Map<string, BucketState>();
  // L5 fix：idle bucket 驱逐——一个 idle 超过 MAX_IDLE_MS 的 bucket 必然已满
  //   （token==capacity），等价于"全新 bucket"，删掉不丢任何信息。否则 per-(tenant)
  //   key 的 Map 会随租户基数单调增长，long-running pod 慢泄漏。
  private static readonly MAX_IDLE_MS = 5 * 60_000; // 5 min
  private static readonly SWEEP_EVERY = 500;
  private opCount = 0;

  async tryConsume(
    key: string,
    capacity: number,
    refillPerSec: number,
    n = 1,
  ): Promise<boolean> {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // 按经过时间补充 token
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    const refilled = Math.min(
      capacity,
      bucket.tokens + elapsedSec * refillPerSec,
    );
    bucket.tokens = refilled;
    bucket.lastRefill = now;

    if (++this.opCount % InMemoryTokenBucketStore.SWEEP_EVERY === 0) {
      this.sweepIdle(now);
    }

    if (bucket.tokens < n) return false;
    bucket.tokens -= n;
    return true;
  }

  private sweepIdle(now: number): void {
    for (const [k, b] of this.buckets) {
      if (now - b.lastRefill > InMemoryTokenBucketStore.MAX_IDLE_MS) {
        this.buckets.delete(k);
      }
    }
  }

  /** 测试用：手动设置 token */
  setForTest(key: string, tokens: number): void {
    this.buckets.set(key, { tokens, lastRefill: Date.now() });
  }

  /** 测试用：清空 */
  clearForTest(): void {
    this.buckets.clear();
  }
}

/**
 * Redis-backed token bucket（H1 fix：多 pod 一致）。
 *
 * bucket 状态 { tokens, lastRefill } 存 CacheService（Redis），所有 pod 共享，
 * 故 per-tenant / global 限额是**全集群**口径，而非每副本各算一份（旧
 * RateLimiter 用 CacheService 滑动窗口即此口径，本类恢复之）。
 *
 * 一致性说明：read-modify-write 非原子（与被替换的旧 RateLimiter 同模型）——
 * 多 pod 并发同 key 有小竞态窗口，可能轻微超发。要严格原子可后续上 Redis Lua /
 * INCR-with-expire；当前实现的核心价值是"跨 pod 共享 quota"，已消除按副本数翻倍。
 */
export class RedisTokenBucketStore implements ITokenBucketStore {
  constructor(private readonly cache: CacheService) {}

  // W1-2 注：cache key 前缀保留 "engine:" 以零中断迁移（不重置在途限流计数）。
  private bucketKey(key: string): string {
    return `engine:rate-limit:bucket:${key}`;
  }

  async tryConsume(
    key: string,
    capacity: number,
    refillPerSec: number,
    n = 1,
  ): Promise<boolean> {
    const rKey = this.bucketKey(key);
    const now = Date.now();
    const prev = await this.cache.get<BucketState>(rKey);
    const tokens0 = prev?.tokens ?? capacity;
    const lastRefill = prev?.lastRefill ?? now;

    const elapsedSec = (now - lastRefill) / 1000;
    let tokens = Math.min(capacity, tokens0 + elapsedSec * refillPerSec);

    // idle 超过补满时长后 key 自动过期清理（Redis TTL，避免无界 key）
    const ttlSec = Math.max(60, Math.ceil((capacity / refillPerSec) * 2));

    if (tokens < n) {
      // 写回补充进度（即便拒绝也要持久化 refill），让下次判断接续
      await this.cache.set(rKey, { tokens, lastRefill: now }, ttlSec);
      return false;
    }
    tokens -= n;
    await this.cache.set(rKey, { tokens, lastRefill: now }, ttlSec);
    return true;
  }
}
