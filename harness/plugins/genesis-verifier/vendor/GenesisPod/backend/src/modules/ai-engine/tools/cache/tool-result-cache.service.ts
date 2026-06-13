/**
 * AI Engine - Tool Result Cache Service
 * 工具结果 Redis 缓存，避免同一 mission 内重复调用同一 URL
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { CacheService } from "@/common/cache/cache.service";
import * as crypto from "crypto";

@Injectable()
export class ToolResultCacheService {
  private readonly logger = new Logger(ToolResultCacheService.name);

  /**
   * 只缓存无副作用的工具（纯查询，重跑无影响）
   */
  private readonly CACHEABLE_SIDE_EFFECTS = new Set<string>(["none"]);

  /**
   * 默认 TTL 30 分钟，覆盖典型 mission 生命周期
   */
  private readonly DEFAULT_TTL_SECONDS = 30 * 60;

  // ★ 全覆盖审计修 (2026-05-06): 连续写失败计数器 + streak 阈值
  //   连续 N 次 cache 写失败说明 Redis 可能已不可用，emit monitoring event 让运维可见
  private cacheWriteFailStreak = 0;
  private static readonly CACHE_FAIL_STREAK_THRESHOLD = 5;

  constructor(
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * 判断工具是否可缓存
   * sideEffect 未定义时默认为 'none'（ITool 接口注释约定）
   */
  isCacheable(toolSideEffect?: string): boolean {
    const effect = toolSideEffect ?? "none";
    return this.CACHEABLE_SIDE_EFFECTS.has(effect);
  }

  /**
   * 构造缓存 key
   * 格式：tool:result:{scope}:{toolId}:{inputHash16}
   * scope = missionId（同 mission 内共享）或 "global"（跨 mission 共享）
   */
  buildKey(
    missionId: string | undefined,
    toolId: string,
    input: unknown,
  ): string {
    const inputHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(input ?? {}))
      .digest("hex")
      .slice(0, 16);
    const scope = missionId ?? "global";
    return `tool:result:${scope}:${toolId}:${inputHash}`;
  }

  /**
   * 尝试从缓存获取结果
   * CacheService 未注入时安静返回 null（降级透传）
   */
  async tryGet<T>(key: string): Promise<T | null> {
    if (!this.cache) return null;
    try {
      const value = await this.cache.get<T>(key);
      return value ?? null;
    } catch (e) {
      this.logger.warn(`cache get failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * 写入缓存
   * CacheService 未注入时为 noop
   *
   * ★ 全覆盖审计修 (2026-05-06):
   *   - 写失败改 error（Railway stderr 可见）
   *   - 连续 N 次失败 emit 'cache:write-fail-streak' 让运维感知 Redis 健康异常
   *   - 写成功后重置 streak 计数器
   */
  async set<T>(
    key: string,
    value: T,
    ttlSeconds: number = this.DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.set(key, value, ttlSeconds);
      // 写成功后重置连续失败计数
      this.cacheWriteFailStreak = 0;
    } catch (e) {
      this.cacheWriteFailStreak++;
      this.logger.error(
        `[tool-cache] cache write failed (streak=${this.cacheWriteFailStreak}): ${(e as Error).message}`,
      );
      if (
        this.cacheWriteFailStreak >=
          ToolResultCacheService.CACHE_FAIL_STREAK_THRESHOLD &&
        this.eventEmitter
      ) {
        // emit monitoring event，让监控/通知系统感知 Redis 写失败风暴
        this.eventEmitter.emit("cache:write-fail-streak", {
          streak: this.cacheWriteFailStreak,
          lastError: (e as Error).message,
          service: ToolResultCacheService.name,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
}
