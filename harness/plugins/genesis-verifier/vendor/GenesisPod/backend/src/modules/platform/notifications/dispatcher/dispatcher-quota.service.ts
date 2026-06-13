import { Injectable, Logger } from "@nestjs/common";
import { CacheService } from "../../../../common/cache/cache.service";
import { NotificationChannel } from "./abstractions/notification-channel";

/**
 * DispatcherQuotaService — R2 security P2-2 整改：dailyQuotaPerUser 真正 enforce
 *
 * 来源：docs/architecture/ai-app/radar/daily-briefing-redesign-2026-05-18.md
 *   §7.2 NotificationDispatcher dailyQuotaPerUser enforce
 *
 * 实现：Redis INCR + EXPIRE 24h 的 quota counter
 * - key 格式：`dispatcher:quota:{userId}:{channel}:{YYYY-MM-DD}` （UTC 日期，跨夜自然续）
 * - INCR 先记账再判断（用于监控，即使超额也计数）
 * - Redis 故障 fail-open：log warn + 允许通过，不阻塞业务通知
 *
 * 复用系统既有 CacheService（@Global CacheModule，incrby + expire 已实现）
 */
@Injectable()
export class DispatcherQuotaService {
  private readonly log = new Logger(DispatcherQuotaService.name);

  constructor(private readonly cache: CacheService) {}

  /**
   * 检查并记账配额
   *
   * @param userId 用户 ID
   * @param channel 通知 channel 类型
   * @param dailyQuota 该 channel 每用户每日上限（来自 ChannelCapabilities.dailyQuotaPerUser）
   * @returns { allowed: boolean; remaining: number }
   *   - allowed=true: 本次发送在配额内
   *   - allowed=false: 已超额，caller 应跳过该 channel
   *   - remaining: 超额时为 0，否则为 quota - count（本次 INCR 之后）
   */
  async check(
    userId: string,
    channel: NotificationChannel,
    dailyQuota: number,
  ): Promise<{ allowed: boolean; remaining: number }> {
    const key = this.buildKey(userId, channel);
    try {
      const count = await this.cache.incrby(key, 1);
      // 首次 INCR 后设置 24h TTL（跨夜自动过期，确保 quota 按 UTC 日重置）
      if (count === 1) {
        await this.cache.expire(key, 86400);
      }
      const allowed = count <= dailyQuota;
      const remaining = allowed ? dailyQuota - count : 0;
      if (!allowed) {
        this.log.warn(
          `quota exceeded: user=${userId} channel=${channel} count=${count} quota=${dailyQuota}`,
        );
      }
      return { allowed, remaining };
    } catch (err) {
      // fail-open：Redis 故障不阻塞业务通知
      this.log.warn(
        `quota check failed (fail-open): user=${userId} channel=${channel} err=${err instanceof Error ? err.message : String(err)}`,
      );
      return { allowed: true, remaining: dailyQuota };
    }
  }

  /** key 格式：`dispatcher:quota:{userId}:{channel}:{YYYY-MM-DD}` (UTC) */
  private buildKey(userId: string, channel: NotificationChannel): string {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `dispatcher:quota:${userId}:${channel}:${date}`;
  }
}
