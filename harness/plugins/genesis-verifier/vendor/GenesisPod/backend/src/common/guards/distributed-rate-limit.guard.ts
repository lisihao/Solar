/**
 * DistributedRateLimitGuard - Redis 分布式速率限制守卫
 *
 * 使用 Redis 实现分布式速率限制：
 * - 支持多实例部署（水平扩展）
 * - 滑动窗口算法
 * - 自动降级到内存限流（Redis 不可用时）
 *
 * 使用方式：与 RateLimitGuard 相同，只需在模块中替换 Provider
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
  Optional,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { Request } from "express";
import { RATE_LIMIT_KEY, RateLimitConfig } from "./rate-limit.guard";

// 默认配置
const DEFAULT_CONFIG: RateLimitConfig = {
  windowSeconds: 60,
  maxRequests: 60,
  keyType: "user",
  skipAnonymous: false,
};

// Redis key 前缀
const REDIS_KEY_PREFIX = "ratelimit:";

@Injectable()
export class DistributedRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(DistributedRateLimitGuard.name);

  // 内存降级存储
  private readonly fallbackRecords = new Map<
    string,
    { timestamps: number[]; lastCleanup: number }
  >();

  // Redis 是否可用
  private redisAvailable = true;

  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(CACHE_MANAGER) private readonly cacheManager?: Cache,
  ) {
    // 定期清理内存记录（unref 防止测试/进程退出时被阻塞）
    setInterval(() => this.cleanupFallbackRecords(), 5 * 60 * 1000).unref();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.get<RateLimitConfig>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    if (!config) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const key = this.extractKey(request, config);

    if (!key) {
      return true;
    }

    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    // 尝试使用 Redis，失败则降级到内存
    if (this.cacheManager && this.redisAvailable) {
      try {
        return await this.checkRateLimitRedis(
          key,
          mergedConfig,
          context.switchToHttp().getResponse(),
        );
      } catch (error) {
        // ★ 修：命中限流抛的 429 HttpException 不是 Redis 故障，必须原样上抛，
        //   否则被当成"Redis error"吞掉 → 降级内存重判 → 限流被绕过。
        if (error instanceof HttpException) {
          throw error;
        }
        // ★ E34 (2026-05-25): Redis 真故障 → fail-open 降级内存，但不能静默。
        //   用 error 级 + 稳定告警码（日志告警规则可抓 REDIS_RATELIMIT_FAILOVER），
        //   避免"分布式限流静默失效、多 pod 被打爆却无人知"。
        this.logger.error(
          `[ALERT][REDIS_RATELIMIT_FAILOVER] Redis 不可用，限流降级为单 pod 内存（多 pod 保护已弱化）：${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
        this.redisAvailable = false;
        // 5 分钟后重试 Redis
        setTimeout(
          () => {
            this.redisAvailable = true;
            this.logger.warn(
              "[REDIS_RATELIMIT_FAILOVER] 冷却结束，下次请求重试 Redis 限流",
            );
          },
          5 * 60 * 1000,
        ).unref();
      }
    }

    // 内存降级
    return this.checkRateLimitMemory(
      key,
      mergedConfig,
      context.switchToHttp().getResponse(),
    );
  }

  /**
   * Redis 分布式限流检查
   */
  private async checkRateLimitRedis(
    key: string,
    config: RateLimitConfig,
    response: { setHeader: (name: string, value: string | number) => void },
  ): Promise<boolean> {
    const redisKey = `${REDIS_KEY_PREFIX}${key}`;
    const now = Date.now();
    const windowMs = config.windowSeconds * 1000;
    const cutoff = now - windowMs;

    // 获取当前窗口内的请求记录
    const rawData = await this.cacheManager!.get<string>(redisKey);
    let timestamps: number[] = [];

    if (rawData) {
      try {
        timestamps = JSON.parse(rawData);
      } catch {
        timestamps = [];
      }
    }

    // 过滤过期记录
    timestamps = timestamps.filter((ts) => ts > cutoff);

    // 检查是否超过限制
    if (timestamps.length >= config.maxRequests) {
      const oldestTimestamp = timestamps[0];
      const retryAfter = Math.ceil((oldestTimestamp + windowMs - now) / 1000);

      this.logger.warn(
        `[DistributedRateLimit] Key "${key}" exceeded limit: ${timestamps.length}/${config.maxRequests}`,
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: "Too Many Requests",
          message:
            config.message || `请求过于频繁，请在 ${retryAfter} 秒后重试`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 记录本次请求
    timestamps.push(now);

    // 保存到 Redis（TTL 设置为窗口大小的 2 倍，确保数据不会过早过期）
    await this.cacheManager!.set(
      redisKey,
      JSON.stringify(timestamps),
      config.windowSeconds * 2 * 1000,
    );

    // 设置响应头
    this.setRateLimitHeaders(response, config, timestamps.length);

    return true;
  }

  /**
   * 内存限流检查（降级方案）
   */
  private checkRateLimitMemory(
    key: string,
    config: RateLimitConfig,
    response: { setHeader: (name: string, value: string | number) => void },
  ): boolean {
    const now = Date.now();
    const windowMs = config.windowSeconds * 1000;

    let record = this.fallbackRecords.get(key);
    if (!record) {
      record = { timestamps: [], lastCleanup: now };
      this.fallbackRecords.set(key, record);
    }

    // 清理过期记录
    const cutoff = now - windowMs;
    record.timestamps = record.timestamps.filter((ts) => ts > cutoff);
    record.lastCleanup = now;

    // 检查限制
    if (record.timestamps.length >= config.maxRequests) {
      const oldestTimestamp = record.timestamps[0];
      const retryAfter = Math.ceil((oldestTimestamp + windowMs - now) / 1000);

      this.logger.warn(
        `[DistributedRateLimit:Fallback] Key "${key}" exceeded limit: ${record.timestamps.length}/${config.maxRequests}`,
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: "Too Many Requests",
          message:
            config.message || `请求过于频繁，请在 ${retryAfter} 秒后重试`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    record.timestamps.push(now);
    this.setRateLimitHeaders(response, config, record.timestamps.length);

    return true;
  }

  /**
   * 设置限流响应头
   */
  private setRateLimitHeaders(
    response: { setHeader: (name: string, value: string | number) => void },
    config: RateLimitConfig,
    currentCount: number,
  ): void {
    const now = Date.now();
    const windowMs = config.windowSeconds * 1000;

    response.setHeader("X-RateLimit-Limit", config.maxRequests);
    response.setHeader(
      "X-RateLimit-Remaining",
      Math.max(0, config.maxRequests - currentCount),
    );
    response.setHeader("X-RateLimit-Reset", Math.ceil((now + windowMs) / 1000));
  }

  /**
   * 提取限制键
   */
  private extractKey(request: Request, config: RateLimitConfig): string | null {
    if (config.keyExtractor) {
      return config.keyExtractor(request);
    }

    switch (config.keyType) {
      case "user": {
        const user = (request as Request & { user?: { id?: string } }).user;
        if (user?.id) {
          return `user:${user.id}`;
        }
        if (config.skipAnonymous) {
          return null;
        }
        return `ip:${this.extractIP(request)}`;
      }
      case "ip":
        return `ip:${this.extractIP(request)}`;
      default:
        return `ip:${this.extractIP(request)}`;
    }
  }

  /**
   * 提取客户端 IP
   */
  private extractIP(request: Request): string {
    const forwarded = request.headers["x-forwarded-for"];
    if (forwarded) {
      const ip = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded.split(",")[0];
      return ip.trim();
    }

    const realIp = request.headers["x-real-ip"];
    if (realIp) {
      return Array.isArray(realIp) ? realIp[0] : realIp;
    }

    return request.ip || request.socket.remoteAddress || "unknown";
  }

  /**
   * 清理内存降级记录
   */
  private cleanupFallbackRecords(): void {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000;

    let cleaned = 0;
    for (const [key, record] of this.fallbackRecords) {
      if (now - record.lastCleanup > maxAge) {
        this.fallbackRecords.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(
        `[DistributedRateLimit] Cleaned ${cleaned} stale fallback records`,
      );
    }
  }

  /**
   * 获取统计信息（用于监控）
   */
  getStats(): {
    redisAvailable: boolean;
    fallbackRecordCount: number;
  } {
    return {
      redisAvailable: this.redisAvailable,
      fallbackRecordCount: this.fallbackRecords.size,
    };
  }
}
