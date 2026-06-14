/**
 * 频率限制服务
 *
 * 防止发布过于频繁导致封号
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { SocialPlatformType } from "../mission/types";
import {
  RateLimitResult,
  RateLimitConfig,
} from "../mission/types/platform.types";
import { RATE_LIMIT_CONFIGS } from "../runtime/platforms.config";

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 检查是否允许发布
   */
  async canPublish(
    userId: string,
    platformType: SocialPlatformType,
  ): Promise<RateLimitResult> {
    const config = RATE_LIMIT_CONFIGS[platformType];
    if (!config) {
      return { allowed: true };
    }

    // 1. 检查今日发布数量
    const todayCount = await this.getTodayPublishCount(userId, platformType);
    if (todayCount >= config.maxPerDay) {
      return {
        allowed: false,
        reason: `今日发布已达上限 (${config.maxPerDay}篇)`,
        nextAvailableAt: this.getNextDayStart(),
        remainingToday: 0,
      };
    }

    // 2. 检查本小时发布数量
    const hourCount = await this.getHourPublishCount(userId, platformType);
    if (hourCount >= config.maxPerHour) {
      return {
        allowed: false,
        reason: `本小时发布已达上限 (${config.maxPerHour}篇)`,
        nextAvailableAt: this.getNextHourStart(),
        remainingThisHour: 0,
      };
    }

    // 3. 检查发布间隔
    if (config.minIntervalMinutes > 0) {
      const lastPublishTime = await this.getLastPublishTime(
        userId,
        platformType,
      );
      if (lastPublishTime) {
        const minutesSinceLast =
          (Date.now() - lastPublishTime.getTime()) / 60000;
        if (minutesSinceLast < config.minIntervalMinutes) {
          const waitMinutes = config.minIntervalMinutes - minutesSinceLast;
          return {
            allowed: false,
            reason: `发布间隔不足，需等待 ${Math.ceil(waitMinutes)} 分钟`,
            nextAvailableAt: new Date(
              lastPublishTime.getTime() + config.minIntervalMinutes * 60000,
            ),
            remainingToday: config.maxPerDay - todayCount,
          };
        }
      }
    }

    // 4. 检查失败冷却
    if (config.cooldownAfterFailure) {
      const lastFailTime = await this.getLastFailTime(userId, platformType);
      if (lastFailTime) {
        const minutesSinceFail = (Date.now() - lastFailTime.getTime()) / 60000;
        if (minutesSinceFail < config.cooldownAfterFailure) {
          const waitMinutes = config.cooldownAfterFailure - minutesSinceFail;
          return {
            allowed: false,
            reason: `上次发布失败，冷却中，需等待 ${Math.ceil(waitMinutes)} 分钟`,
            nextAvailableAt: new Date(
              lastFailTime.getTime() + config.cooldownAfterFailure * 60000,
            ),
          };
        }
      }
    }

    return {
      allowed: true,
      remainingToday: config.maxPerDay - todayCount,
      remainingThisHour: config.maxPerHour - hourCount,
    };
  }

  /**
   * 记录发布（成功或失败）
   */
  async recordPublish(
    userId: string,
    platformType: SocialPlatformType,
    success: boolean,
  ): Promise<void> {
    // ★ 2026-04-30 fix: raw SQL 必须用 DB 实际表/列名（@@map / @map 后的 snake_case），
    // 不能用 Prisma model 名（PascalCase），否则 relation/column does not exist。
    await this.prisma.$executeRaw`
      UPDATE social_platform_connections
      SET
        last_publish_at = NOW(),
        today_publish_count = CASE
          WHEN DATE(last_publish_at) = CURRENT_DATE THEN today_publish_count + 1
          ELSE 1
        END,
        total_publish_count = total_publish_count + 1,
        updated_at = NOW()
      WHERE user_id = ${userId} AND platform_type = ${platformType}
    `;

    this.logger.log(
      `Recorded publish for ${userId} on ${platformType}: ${success ? "success" : "failed"}`,
    );
  }

  /**
   * 获取今日发布数量
   */
  private async getTodayPublishCount(
    userId: string,
    platformType: SocialPlatformType,
  ): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await this.prisma.socialPublishLog.count({
      where: {
        content: {
          userId,
          contentType:
            platformType === SocialPlatformType.WECHAT_MP
              ? "WECHAT_ARTICLE"
              : "XIAOHONGSHU_NOTE",
        },
        status: "SUCCESS",
        createdAt: {
          gte: today,
        },
      },
    });

    return result;
  }

  /**
   * 获取本小时发布数量
   */
  private async getHourPublishCount(
    userId: string,
    platformType: SocialPlatformType,
  ): Promise<number> {
    const hourAgo = new Date(Date.now() - 3600000);

    const result = await this.prisma.socialPublishLog.count({
      where: {
        content: {
          userId,
          contentType:
            platformType === SocialPlatformType.WECHAT_MP
              ? "WECHAT_ARTICLE"
              : "XIAOHONGSHU_NOTE",
        },
        status: "SUCCESS",
        createdAt: {
          gte: hourAgo,
        },
      },
    });

    return result;
  }

  /**
   * 获取最后成功发布时间
   */
  private async getLastPublishTime(
    userId: string,
    platformType: SocialPlatformType,
  ): Promise<Date | null> {
    const result = await this.prisma.socialPublishLog.findFirst({
      where: {
        content: {
          userId,
          contentType:
            platformType === SocialPlatformType.WECHAT_MP
              ? "WECHAT_ARTICLE"
              : "XIAOHONGSHU_NOTE",
        },
        status: "SUCCESS",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        createdAt: true,
      },
    });

    return result?.createdAt || null;
  }

  /**
   * 获取最后失败时间
   */
  private async getLastFailTime(
    userId: string,
    platformType: SocialPlatformType,
  ): Promise<Date | null> {
    const result = await this.prisma.socialPublishLog.findFirst({
      where: {
        content: {
          userId,
          contentType:
            platformType === SocialPlatformType.WECHAT_MP
              ? "WECHAT_ARTICLE"
              : "XIAOHONGSHU_NOTE",
        },
        status: "FAILED",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        createdAt: true,
      },
    });

    return result?.createdAt || null;
  }

  /**
   * 获取次日开始时间
   */
  private getNextDayStart(): Date {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
  }

  /**
   * 获取下一小时开始时间
   */
  private getNextHourStart(): Date {
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    return nextHour;
  }

  /**
   * 获取平台限制配置
   */
  getConfig(platformType: SocialPlatformType): RateLimitConfig {
    return RATE_LIMIT_CONFIGS[platformType];
  }

  /**
   * 获取限制状态摘要
   */
  async getStatus(
    userId: string,
    platformType: SocialPlatformType,
  ): Promise<{
    config: RateLimitConfig;
    todayCount: number;
    hourCount: number;
    lastPublishAt: Date | null;
    canPublish: RateLimitResult;
  }> {
    const config = this.getConfig(platformType);
    const todayCount = await this.getTodayPublishCount(userId, platformType);
    const hourCount = await this.getHourPublishCount(userId, platformType);
    const lastPublishAt = await this.getLastPublishTime(userId, platformType);
    const canPublish = await this.canPublish(userId, platformType);

    return {
      config,
      todayCount,
      hourCount,
      lastPublishAt,
      canPublish,
    };
  }
}
