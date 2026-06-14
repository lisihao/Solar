import { Injectable, Logger } from "@nestjs/common";
import {
  NotificationPreference,
  NotificationType,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { NotificationChannel } from "../abstractions/notification-channel";
import { QuietHoursUtil } from "./quiet-hours.util";

/**
 * NotificationPreferenceService
 *
 * 职责：dispatcher 读 / 写用户通知偏好（channelSubscriptions 矩阵 + 全局 quietHours）
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §8.6
 *
 * 与既有 NotificationService 的偏好读写区别：
 * - 既有 NotificationService.getPreferences/updatePreferences 走 REST，面向 UI
 * - 本 service 面向 dispatcher 内部（无 HTTP exception 包装，纯 DB 操作）
 */
@Injectable()
export class NotificationPreferenceService {
  private readonly log = new Logger(NotificationPreferenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查用户偏好；不存在时返回 null（dispatcher 走默认策略）
   * 错误一律 swallow + log，避免通知层因偏好查询失败而 swallow 用户事件
   */
  async get(userId: string): Promise<NotificationPreference | null> {
    try {
      return await this.prisma.notificationPreference.findUnique({
        where: { userId },
      });
    } catch (err) {
      this.log.warn(
        `Preference lookup failed for ${userId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 读单 type × channel 订阅开关
   *
   * 用户 channelSubscriptions[type][channel] 显式 boolean
   *   true → 走
   *   false → 不走
   * 未设置 → null（由 ChannelResolver 用 defaultForType 兜底）
   */
  async getChannelSubscription(
    userId: string,
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<boolean | null> {
    const pref = await this.get(userId);
    if (!pref) return null;
    const subs = (pref.channelSubscriptions ?? {}) as Record<
      string,
      Partial<Record<NotificationChannel, boolean>>
    >;
    const typeSubs = subs[type];
    if (!typeSubs || typeof typeSubs !== "object") return null;
    const value = typeSubs[channel];
    return typeof value === "boolean" ? value : null;
  }

  /**
   * 更新 channelSubscriptions（merge 模式：只覆盖传入的 type → channel，其他保留）
   */
  async updateChannelSubscriptions(
    userId: string,
    updates: Partial<
      Record<NotificationType, Partial<Record<NotificationChannel, boolean>>>
    >,
  ): Promise<void> {
    const existing = await this.get(userId);
    const current = (existing?.channelSubscriptions ?? {}) as Record<
      string,
      Partial<Record<NotificationChannel, boolean>>
    >;
    const next: Record<
      string,
      Partial<Record<NotificationChannel, boolean>>
    > = {
      ...current,
    };
    for (const [type, channels] of Object.entries(updates)) {
      next[type] = { ...(current[type] ?? {}), ...(channels ?? {}) };
    }

    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        channelSubscriptions: next as Prisma.InputJsonValue,
      },
      update: {
        channelSubscriptions: next as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * 是否在 quietHours 静默窗口内（复用共享工具 QuietHoursUtil — R1 reuse 整改）
   */
  async isInQuietHours(userId: string): Promise<boolean> {
    const pref = await this.get(userId);
    if (!pref?.quietHoursStart || !pref?.quietHoursEnd) return false;
    return QuietHoursUtil.timeInWindow(
      new Date(),
      pref.quietHoursStart,
      pref.quietHoursEnd,
    );
  }

  /**
   * 测试 / 老调用方兼容：再导出 QuietHoursUtil.timeInWindow
   * R1 reuse 整改后，本类不再维护实现，转给 QuietHoursUtil 单源
   */
  static timeInWindow = QuietHoursUtil.timeInWindow;
}
