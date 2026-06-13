/**
 * Redis client 抽象接口（v5.1 R0.5 PR-8）
 *
 * 与具体 Redis SDK（ioredis/node-redis）解耦，spec 用 in-memory mock。
 * 生产环境注入 NamespacedRedisClient（v5.1 MED-1：屏蔽 KEYS/SCAN/FLUSHDB）。
 */
export interface IRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
}

/** 测试 / dev 用 in-memory 实现 */
export class InMemoryRedisClient implements IRedisClient {
  private readonly store = new Map<
    string,
    { value: string; expireAt?: number }
  >();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expireAt && entry.expireAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    this.store.set(key, {
      value,
      expireAt: ttlSec ? Date.now() + ttlSec * 1000 : undefined,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** 测试用：dump 当前所有 key */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  clear(): void {
    this.store.clear();
  }
}
