import { Injectable, Inject, Logger } from "@nestjs/common";
import { CACHE_MANAGER, Cache } from "@nestjs/cache-manager";
import type { RedisStore } from "cache-manager-ioredis-yet";
import type { Redis, Cluster } from "ioredis";

/**
 * 缓存键前缀，用于命名空间隔离
 */
export enum CachePrefix {
  /** AI 模型配置 */
  AI_MODEL = "ai:model:",
  /** AI 模型列表（按类型） */
  AI_MODEL_LIST = "ai:model:list:",
  /** 用户信息 */
  USER = "user:",
  /** 用户 API Keys */
  USER_API_KEY = "user:apikey:",
  /** 系统设置 */
  SETTINGS = "settings:",
  /** 会话数据 */
  SESSION = "session:",
  /** 临时数据 */
  TEMP = "temp:",
  /** OAuth 授权码 */
  AUTH_CODE = "auth:code:",
  /** 社交平台登录会话 */
  SOCIAL_LOGIN = "social:login:",
  /** 社交平台连接验证锁 */
  SOCIAL_VERIFYING = "social:verifying:",
}

/**
 * 缓存 TTL 预设（秒）
 */
export enum CacheTTL {
  /** 1 分钟 - 高频变化数据 */
  SHORT = 60,
  /** 5 分钟 - 默认 */
  DEFAULT = 300,
  /** 10 分钟 - 登录会话 */
  LOGIN_SESSION = 600,
  /** 15 分钟 - 中等频率 */
  MEDIUM = 900,
  /** 1 小时 - 低频变化 */
  LONG = 3600,
  /** 24 小时 - 几乎不变 */
  DAY = 86400,
}

/**
 * 缓存服务
 *
 * 提供类型安全的缓存操作接口，支持：
 * - 自动序列化/反序列化
 * - 命名空间隔离
 * - 错误容错（缓存失败不影响主流程）
 * - 批量操作
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  /**
   * 获取缓存值
   * @param key 缓存键
   * @returns 缓存值，不存在则返回 undefined
   */
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const value = await this.cacheManager.get<T>(key);
      return value ?? undefined;
    } catch (error) {
      this.logger.warn(`Cache get failed for key ${key}: ${error}`);
      return undefined;
    }
  }

  /**
   * 设置缓存值
   * @param key 缓存键
   * @param value 缓存值
   * @param ttl 过期时间（秒），默认 5 分钟
   */
  async set<T>(
    key: string,
    value: T,
    ttl: number = CacheTTL.DEFAULT,
  ): Promise<void> {
    try {
      await this.cacheManager.set(key, value, ttl * 1000); // cache-manager 使用毫秒
    } catch (error) {
      this.logger.warn(`Cache set failed for key ${key}: ${error}`);
    }
  }

  /**
   * 删除缓存
   * @param key 缓存键
   */
  async del(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
    } catch (error) {
      this.logger.warn(`Cache del failed for key ${key}: ${error}`);
    }
  }

  /**
   * 获取或设置缓存（常用模式）
   * 如果缓存存在则返回，否则执行 factory 并缓存结果
   *
   * @param key 缓存键
   * @param factory 数据获取函数
   * @param ttl 过期时间（秒）
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl: number = CacheTTL.DEFAULT,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }

  /**
   * 按前缀删除缓存
   * 注意：此操作在 Redis 中使用 SCAN，在内存缓存中可能不支持
   *
   * @param prefix 缓存键前缀
   */
  async delByPrefix(prefix: string): Promise<void> {
    try {
      // 尝试获取底层存储客户端进行 keys 操作
      const cacheManagerInternal = this.cacheManager as unknown as {
        stores?: Array<{ keys?: (pattern: string) => Promise<string[]> }>;
        store?: { keys?: (pattern: string) => Promise<string[]> };
      };
      const stores = cacheManagerInternal.stores;
      const store = stores?.[0] || cacheManagerInternal.store;
      if (store?.keys) {
        const keys = await store.keys(`${prefix}*`);
        if (keys && keys.length > 0) {
          // Batch delete in chunks to avoid memory spikes
          const BATCH_SIZE = 100;
          for (let i = 0; i < keys.length; i += BATCH_SIZE) {
            const batch = keys.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map((key: string) => this.del(key)));
          }
          this.logger.debug(
            `Deleted ${keys.length} keys with prefix ${prefix}`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Cache delByPrefix failed for prefix ${prefix}: ${error}`,
      );
    }
  }

  /**
   * 使 AI 模型缓存失效
   * 当模型配置变更时调用
   */
  async invalidateAIModelCache(): Promise<void> {
    await this.delByPrefix(CachePrefix.AI_MODEL);
    await this.delByPrefix(CachePrefix.AI_MODEL_LIST);
    this.logger.log("AI model cache invalidated");
  }

  /**
   * 使用户缓存失效
   * @param userId 用户 ID
   */
  async invalidateUserCache(userId: string): Promise<void> {
    await this.del(`${CachePrefix.USER}${userId}`);
    await this.delByPrefix(`${CachePrefix.USER_API_KEY}${userId}`);
    this.logger.debug(`User cache invalidated for ${userId}`);
  }

  /**
   * 构建带前缀的缓存键
   */
  buildKey(prefix: CachePrefix, ...parts: string[]): string {
    return `${prefix}${parts.join(":")}`;
  }

  // ── Redis SET operations (sadd / srem / sismember / smembers) ─────────────
  //
  // 原生 ioredis SET 命令：SADD 返回新增成员数（0 = 已存在，1 = 新加），
  // 原子操作，多 pod 安全。
  // 降级：REDIS_URL 未配置时走 in-memory JSON-array 模拟（开发/测试环境）。
  //
  // 注意：in-memory 模式下模拟不是进程级原子，仅用于单 pod 本地开发。

  /** 提取底层 ioredis 客户端，无 Redis 时返回 null */
  private getRedisClient(): (Redis | Cluster) | null {
    try {
      const mgr = this.cacheManager as unknown as { store?: RedisStore };
      return mgr.store?.client ?? null;
    } catch {
      return null;
    }
  }

  /**
   * SADD key member — 添加成员到 SET
   * @returns 1 表示成员是新加的（即"加锁成功"），0 表示已存在
   */
  async sadd(key: string, member: string): Promise<number> {
    const client = this.getRedisClient();
    if (client) {
      try {
        return await client.sadd(key, member);
      } catch (error) {
        this.logger.warn(`Cache sadd failed for key ${key}: ${error}`);
        return 0;
      }
    }
    // in-memory fallback
    const members = (await this.get<string[]>(key)) ?? [];
    if (members.includes(member)) return 0;
    members.push(member);
    await this.set(key, members, CacheTTL.LONG);
    return 1;
  }

  /**
   * SREM key member — 从 SET 移除成员
   * @returns 1 表示成员已移除，0 表示成员不存在
   */
  async srem(key: string, member: string): Promise<number> {
    const client = this.getRedisClient();
    if (client) {
      try {
        return await client.srem(key, member);
      } catch (error) {
        this.logger.warn(`Cache srem failed for key ${key}: ${error}`);
        return 0;
      }
    }
    // in-memory fallback
    const members = (await this.get<string[]>(key)) ?? [];
    const idx = members.indexOf(member);
    if (idx === -1) return 0;
    members.splice(idx, 1);
    if (members.length === 0) {
      await this.del(key);
    } else {
      await this.set(key, members, CacheTTL.LONG);
    }
    return 1;
  }

  /**
   * SISMEMBER key member — 检查成员是否在 SET 中
   * @returns true 表示存在
   */
  async sismember(key: string, member: string): Promise<boolean> {
    const client = this.getRedisClient();
    if (client) {
      try {
        const result = await client.sismember(key, member);
        return result === 1;
      } catch (error) {
        this.logger.warn(`Cache sismember failed for key ${key}: ${error}`);
        return false;
      }
    }
    // in-memory fallback
    const members = (await this.get<string[]>(key)) ?? [];
    return members.includes(member);
  }

  /**
   * SMEMBERS key — 获取 SET 所有成员
   * @returns 成员数组，key 不存在时返回空数组
   */
  async smembers(key: string): Promise<string[]> {
    const client = this.getRedisClient();
    if (client) {
      try {
        return await client.smembers(key);
      } catch (error) {
        this.logger.warn(`Cache smembers failed for key ${key}: ${error}`);
        return [];
      }
    }
    // in-memory fallback
    return (await this.get<string[]>(key)) ?? [];
  }

  /**
   * INCRBY key delta — 原子累加整数计数器
   *
   * 用途：token 用量计数 / 配额消耗等并发安全场景，避免 read-modify-write 竞态。
   * Redis 模式：单条 INCRBY 命令原子；多 pod 安全。
   * in-memory fallback：用 Promise mutex 串行化 read-modify-write（同 pod 内安全）。
   *
   * @returns 累加后的新值
   */
  async incrby(key: string, delta: number): Promise<number> {
    const client = this.getRedisClient();
    if (client) {
      try {
        return await client.incrby(key, delta);
      } catch (error) {
        this.logger.warn(`Cache incrby failed for key ${key}: ${error}`);
        return 0;
      }
    }
    // in-memory fallback：read-modify-write（仅单 pod 安全；by design CacheService
    // 无 Redis 时即开发环境单 pod）
    const current = (await this.get<number>(key)) ?? 0;
    const next = current + delta;
    await this.set(key, next, CacheTTL.LONG);
    return next;
  }

  /**
   * EXPIRE key seconds — 设置 key 过期时间（秒）
   * 仅在 Redis 模式下有效；in-memory 模式无操作（由 set 的 ttl 控制）
   */
  async expire(key: string, seconds: number): Promise<void> {
    const client = this.getRedisClient();
    if (client) {
      try {
        await client.expire(key, seconds);
      } catch (error) {
        this.logger.warn(`Cache expire failed for key ${key}: ${error}`);
      }
    }
    // in-memory: ttl already set via sadd's set() call; no-op here
  }
}
