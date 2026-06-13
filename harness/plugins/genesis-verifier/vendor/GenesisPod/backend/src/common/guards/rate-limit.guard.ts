/**
 * RateLimitGuard - 内存版速率限制守卫
 *
 * 使用滑动窗口算法实现请求速率限制：
 * - 基于用户 ID 或 IP 进行限制
 * - 支持自定义窗口大小和最大请求数
 * - 内存存储，适合单实例部署
 *
 * 设计原则：
 * - 无外部依赖（不需要 Redis）
 * - 滑动窗口算法，比固定窗口更平滑
 * - 支持自动清理过期数据
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";

// ============================================================================
// Constants & Types
// ============================================================================

/**
 * 速率限制元数据 Key
 */
export const RATE_LIMIT_KEY = "rate_limit";

/**
 * 速率限制配置
 */
export interface RateLimitConfig {
  /** 时间窗口（秒） */
  windowSeconds: number;
  /** 窗口内最大请求数 */
  maxRequests: number;
  /** 限制键类型 */
  keyType?: "user" | "ip" | "custom";
  /** 自定义键提取函数 */
  keyExtractor?: (request: Request) => string;
  /** 是否跳过匿名用户 */
  skipAnonymous?: boolean;
  /** 自定义错误消息 */
  message?: string;
}

/**
 * 请求记录
 */
interface RequestRecord {
  timestamps: number[];
  lastCleanup: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: RateLimitConfig = {
  windowSeconds: 60,
  maxRequests: 60,
  keyType: "user",
  skipAnonymous: false,
};

// ============================================================================
// Decorator
// ============================================================================

/**
 * @RateLimit 装饰器
 *
 * @example
 * ```typescript
 * @Post(':topicId/messages')
 * @RateLimit({ maxRequests: 60, windowSeconds: 60 })
 * async sendMessage() {}
 *
 * @Post(':topicId/ai/generate')
 * @RateLimit({ maxRequests: 10, windowSeconds: 60, message: 'AI 请求过于频繁' })
 * async generateAIResponse() {}
 * ```
 */
export const RateLimit = (config: Partial<RateLimitConfig>) =>
  SetMetadata(RATE_LIMIT_KEY, { ...DEFAULT_CONFIG, ...config });

// ============================================================================
// Guard Implementation
// ============================================================================

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  /**
   * 请求记录存储
   * key: 限制键（如 userId 或 IP）
   * value: 请求时间戳数组
   */
  private readonly records = new Map<string, RequestRecord>();

  /**
   * 清理间隔（毫秒）
   */
  private readonly cleanupInterval = 5 * 60 * 1000; // 5分钟

  /**
   * 上次全局清理时间（用于调试）
   */
  private _lastGlobalCleanup = Date.now();

  constructor(private readonly reflector: Reflector) {
    // 定期清理过期记录（unref 防止测试/进程退出时被阻塞）
    setInterval(() => this.globalCleanup(), this.cleanupInterval).unref();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 获取速率限制配置
    const config = this.reflector.get<RateLimitConfig>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    // 如果没有配置，跳过限制
    if (!config) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const key = this.extractKey(request, config);

    // 如果无法提取 key（如匿名用户且配置跳过），允许请求
    if (!key) {
      return true;
    }

    const now = Date.now();
    const windowMs = config.windowSeconds * 1000;

    // 获取或创建请求记录
    let record = this.records.get(key);
    if (!record) {
      record = { timestamps: [], lastCleanup: now };
      this.records.set(key, record);
    }

    // 清理过期的时间戳
    const cutoff = now - windowMs;
    record.timestamps = record.timestamps.filter((ts) => ts > cutoff);
    record.lastCleanup = now;

    // 检查是否超过限制
    if (record.timestamps.length >= config.maxRequests) {
      this.logger.warn(
        `[RateLimit] Key "${key}" exceeded limit: ${record.timestamps.length}/${config.maxRequests} in ${config.windowSeconds}s`,
      );

      // 计算重试时间
      const oldestTimestamp = record.timestamps[0];
      const retryAfter = Math.ceil((oldestTimestamp + windowMs - now) / 1000);

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
    record.timestamps.push(now);

    // 设置响应头
    const response = context.switchToHttp().getResponse();
    response.setHeader("X-RateLimit-Limit", config.maxRequests);
    response.setHeader(
      "X-RateLimit-Remaining",
      config.maxRequests - record.timestamps.length,
    );
    response.setHeader("X-RateLimit-Reset", Math.ceil((now + windowMs) / 1000));

    return true;
  }

  /**
   * 提取限制键
   */
  private extractKey(request: Request, config: RateLimitConfig): string | null {
    // 自定义提取器
    if (config.keyExtractor) {
      return config.keyExtractor(request);
    }

    switch (config.keyType) {
      case "user": {
        // 尝试从请求中获取用户 ID
        const user = (request as Request & { user?: { id?: string } }).user;
        if (user?.id) {
          return `user:${user.id}`;
        }
        // 如果配置跳过匿名用户
        if (config.skipAnonymous) {
          return null;
        }
        // 回退到 IP
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
    // 检查代理头
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
   * 全局清理过期记录
   */
  private globalCleanup(): void {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10分钟没有活动的记录将被删除

    let cleaned = 0;
    for (const [key, record] of this.records) {
      if (now - record.lastCleanup > maxAge) {
        this.records.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`[RateLimit] Cleaned ${cleaned} stale records`);
    }

    this._lastGlobalCleanup = now;
  }

  /**
   * 获取当前记录数（用于监控）
   */
  getRecordCount(): number {
    return this.records.size;
  }

  /**
   * 获取上次全局清理时间（用于监控）
   */
  getLastGlobalCleanup(): number {
    return this._lastGlobalCleanup;
  }

  /**
   * 手动清理所有记录（用于测试）
   */
  clearAllRecords(): void {
    this.records.clear();
  }

  /**
   * 获取指定 key 的剩余请求数
   */
  getRemainingRequests(
    key: string,
    windowSeconds: number,
    maxRequests: number,
  ): number {
    const record = this.records.get(key);
    if (!record) {
      return maxRequests;
    }

    const now = Date.now();
    const cutoff = now - windowSeconds * 1000;
    const validTimestamps = record.timestamps.filter((ts) => ts > cutoff);

    return Math.max(0, maxRequests - validTimestamps.length);
  }
}
