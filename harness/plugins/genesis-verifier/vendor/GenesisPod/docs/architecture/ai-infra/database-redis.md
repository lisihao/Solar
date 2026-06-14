# Redis 缓存策略

## 概述

GenesisPod 使用 Redis 7 作为缓存和会话存储，支持 AOF 持久化。

## 核心数据结构

### 1. 字符串 (String)

最简单的数据类型，适合缓存单个值：

```typescript
// 基础操作
await redis.set("user:123:name", "John Doe");
const name = await redis.get("user:123:name");

// 带过期时间
await redis.setex("session:abc", 3600, JSON.stringify(sessionData));

// 原子操作
await redis.incr("page:views:123");
await redis.incrby("user:123:credits", 100);

// 条件设置
await redis.setnx("lock:resource:123", "1"); // 只在键不存在时设置
```

### 2. 哈希 (Hash)

适合存储对象：

```typescript
// 存储用户对象
await redis.hset("user:123", {
  name: "John Doe",
  email: "john@example.com",
  role: "admin",
});

// 获取单个字段
const name = await redis.hget("user:123", "name");

// 获取所有字段
const user = await redis.hgetall("user:123");

// 增加数值字段
await redis.hincrby("user:123", "loginCount", 1);

// 检查字段存在
const exists = await redis.hexists("user:123", "email");
```

### 3. 列表 (List)

双向链表，适合队列和最新数据：

```typescript
// 消息队列
await redis.lpush("queue:tasks", JSON.stringify(task));
const task = await redis.rpop("queue:tasks");

// 阻塞式弹出（用于任务处理）
const task = await redis.brpop("queue:tasks", 30); // 30秒超时

// 最新通知
await redis.lpush("notifications:user:123", notification);
await redis.ltrim("notifications:user:123", 0, 99); // 只保留100条

// 获取范围
const recent = await redis.lrange("notifications:user:123", 0, 9);
```

### 4. 集合 (Set)

无序唯一元素集合：

```typescript
// 用户标签
await redis.sadd("user:123:tags", "javascript", "react", "nodejs");

// 检查成员
const isMember = await redis.sismember("user:123:tags", "javascript");

// 集合运算
const commonTags = await redis.sinter("user:123:tags", "user:456:tags");
const allTags = await redis.sunion("user:123:tags", "user:456:tags");

// 随机获取
const randomTag = await redis.srandmember("user:123:tags");

// 获取所有成员
const tags = await redis.smembers("user:123:tags");
```

### 5. 有序集合 (Sorted Set)

带分数的有序集合：

```typescript
// 排行榜
await redis.zadd("leaderboard", 100, "user:123");
await redis.zincrby("leaderboard", 10, "user:123");

// 获取排名
const rank = await redis.zrevrank("leaderboard", "user:123");
const score = await redis.zscore("leaderboard", "user:123");

// 获取排行
const top10 = await redis.zrevrange("leaderboard", 0, 9, "WITHSCORES");

// 时间线（按时间戳排序）
await redis.zadd("timeline:user:123", Date.now(), postId);
const recentPosts = await redis.zrevrangebyscore(
  "timeline:user:123",
  "+inf",
  Date.now() - 86400000, // 24小时内
  "LIMIT",
  0,
  20,
);
```

## 缓存模式

### 1. Cache-Aside (旁路缓存)

应用程序管理缓存和数据库：

```typescript
class ResourceCache {
  constructor(
    private redis: Redis,
    private prisma: PrismaService,
  ) {}

  async getResource(id: string): Promise<Resource> {
    const cacheKey = `resource:${id}`;

    // 1. 尝试从缓存获取
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // 2. 缓存未命中，从数据库获取
    const resource = await this.prisma.resource.findUnique({
      where: { id },
    });

    if (!resource) {
      throw new NotFoundException();
    }

    // 3. 写入缓存
    await this.redis.setex(cacheKey, 3600, JSON.stringify(resource));

    return resource;
  }

  async updateResource(id: string, data: UpdateResourceDto): Promise<Resource> {
    // 1. 更新数据库
    const resource = await this.prisma.resource.update({
      where: { id },
      data,
    });

    // 2. 使缓存失效
    await this.redis.del(`resource:${id}`);

    return resource;
  }
}
```

### 2. Write-Through (直写缓存)

写操作同时更新缓存和数据库：

```typescript
async createResource(data: CreateResourceDto): Promise<Resource> {
  // 1. 写入数据库
  const resource = await this.prisma.resource.create({ data });

  // 2. 同步写入缓存
  await this.redis.setex(
    `resource:${resource.id}`,
    3600,
    JSON.stringify(resource)
  );

  return resource;
}
```

### 3. 缓存预热

```typescript
@Injectable()
export class CacheWarmupService implements OnModuleInit {
  async onModuleInit() {
    // 应用启动时预热热门数据
    const popularResources = await this.prisma.resource.findMany({
      orderBy: { viewCount: "desc" },
      take: 100,
    });

    const pipeline = this.redis.pipeline();

    for (const resource of popularResources) {
      pipeline.setex(`resource:${resource.id}`, 3600, JSON.stringify(resource));
    }

    await pipeline.exec();
  }
}
```

## 会话存储

### 1. JWT + Redis 会话

```typescript
@Injectable()
export class SessionService {
  private readonly SESSION_TTL = 7 * 24 * 60 * 60; // 7天

  async createSession(userId: string, deviceInfo: DeviceInfo): Promise<string> {
    const sessionId = crypto.randomUUID();

    await this.redis.hset(`session:${sessionId}`, {
      userId,
      device: deviceInfo.userAgent,
      ip: deviceInfo.ip,
      createdAt: Date.now().toString(),
    });

    await this.redis.expire(`session:${sessionId}`, this.SESSION_TTL);

    // 添加到用户会话列表
    await this.redis.sadd(`user:${userId}:sessions`, sessionId);

    return sessionId;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    const session = await this.redis.hgetall(`session:${sessionId}`);

    if (!session.userId) {
      return null;
    }

    // 刷新过期时间
    await this.redis.expire(`session:${sessionId}`, this.SESSION_TTL);

    return session as SessionData;
  }

  async invalidateSession(sessionId: string): Promise<void> {
    const session = await this.redis.hgetall(`session:${sessionId}`);

    if (session.userId) {
      await this.redis.srem(`user:${session.userId}:sessions`, sessionId);
    }

    await this.redis.del(`session:${sessionId}`);
  }

  async invalidateAllUserSessions(userId: string): Promise<void> {
    const sessions = await this.redis.smembers(`user:${userId}:sessions`);

    if (sessions.length > 0) {
      await this.redis.del(
        ...sessions.map((s) => `session:${s}`),
        `user:${userId}:sessions`,
      );
    }
  }
}
```

## 分布式锁

```typescript
@Injectable()
export class LockService {
  private readonly LOCK_TTL = 30000; // 30秒

  async acquireLock(resource: string, timeout: number = 10000): Promise<string | null> {
    const lockKey = `lock:${resource}`;
    const lockValue = crypto.randomUUID();
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // 尝试获取锁
      const acquired = await this.redis.set(
        lockKey,
        lockValue,
        'PX', this.LOCK_TTL,
        'NX'
      );

      if (acquired) {
        return lockValue;
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return null; // 超时未获取到锁
  }

  async releaseLock(resource: string, lockValue: string): Promise<boolean> {
    const lockKey = `lock:${resource}`;

    // Lua 脚本确保原子性
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    const result = await this.redis.eval(script, 1, lockKey, lockValue);
    return result === 1;
  }

  async withLock<T>(
    resource: string,
    fn: () => Promise<T>,
    timeout: number = 10000
  ): Promise<T> {
    const lockValue = await this.acquireLock(resource, timeout);

    if (!lockValue) {
      throw new Error(`Failed to acquire lock for ${resource}`);
    }

    try {
      return await fn();
    } finally {
      await this.releaseLock(resource, lockValue);
    }
  }
}

// 使用示例
async processResource(id: string) {
  return this.lockService.withLock(`resource:${id}`, async () => {
    // 临界区代码
    const resource = await this.prisma.resource.findUnique({ where: { id } });
    await this.prisma.resource.update({
      where: { id },
      data: { processedAt: new Date() },
    });
    return resource;
  });
}
```

## 发布/订阅

```typescript
@Injectable()
export class PubSubService {
  private subscriber: Redis;

  constructor(private redis: Redis) {
    this.subscriber = redis.duplicate();
  }

  async publish(channel: string, message: any): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(message));
  }

  async subscribe(
    channel: string,
    handler: (message: any) => void,
  ): Promise<void> {
    await this.subscriber.subscribe(channel);

    this.subscriber.on("message", (ch, msg) => {
      if (ch === channel) {
        handler(JSON.parse(msg));
      }
    });
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.subscriber.unsubscribe(channel);
  }
}

// 使用示例
// 发布资源更新事件
await pubSubService.publish("resource:updated", { id: resourceId, userId });

// 订阅资源更新
await pubSubService.subscribe("resource:updated", (message) => {
  console.log("Resource updated:", message);
  // 清理相关缓存等
});
```

## 限流

```typescript
@Injectable()
export class RateLimiter {
  async isRateLimited(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const redisKey = `ratelimit:${key}`;

    // 使用有序集合实现滑动窗口
    const pipeline = this.redis.pipeline();

    // 移除窗口外的记录
    pipeline.zremrangebyscore(redisKey, 0, windowStart);

    // 获取窗口内的请求数
    pipeline.zcard(redisKey);

    // 添加当前请求
    pipeline.zadd(redisKey, now, `${now}:${Math.random()}`);

    // 设置过期时间
    pipeline.pexpire(redisKey, windowMs);

    const results = await pipeline.exec();
    const count = results[1][1] as number;

    return count >= limit;
  }
}

// NestJS Throttler 集成
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  async increment(key: string, ttl: number): Promise<ThrottlerStorageRecord> {
    const totalHits = await this.redis.incr(key);

    if (totalHits === 1) {
      await this.redis.expire(key, ttl);
    }

    const ttlRemaining = await this.redis.ttl(key);

    return {
      totalHits,
      timeToExpire: ttlRemaining * 1000,
    };
  }
}
```

## 配置和最佳实践

### 1. 连接配置

```typescript
// redis.module.ts
import { Module, Global } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Global()
@Module({
  providers: [
    {
      provide: "REDIS",
      useFactory: (configService: ConfigService) => {
        return new Redis({
          host: configService.get("REDIS_HOST"),
          port: configService.get("REDIS_PORT"),
          password: configService.get("REDIS_PASSWORD"),
          db: configService.get("REDIS_DB", 0),
          retryStrategy: (times) => {
            if (times > 3) {
              return null; // 停止重试
            }
            return Math.min(times * 100, 3000);
          },
          maxRetriesPerRequest: 3,
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: ["REDIS"],
})
export class RedisModule {}
```

### 2. 键命名规范

```
格式: {entity}:{id}:{field}

示例:
- user:123                    # 用户对象
- user:123:sessions           # 用户会话列表
- resource:456                # 资源对象
- cache:resources:list:page1  # 资源列表缓存
- lock:resource:456           # 资源锁
- ratelimit:api:user:123      # 用户 API 限流
```

### 3. 内存管理

```conf
# redis.conf
maxmemory 256mb
maxmemory-policy allkeys-lru

# AOF 持久化
appendonly yes
appendfsync everysec
```

## 参考资源

- [Redis 官方文档](https://redis.io/docs/)
- [ioredis 文档](https://github.com/redis/ioredis)
- [Redis 最佳实践](https://redis.io/docs/management/optimization/)
