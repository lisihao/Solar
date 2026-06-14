import { Inject, Injectable, Logger } from "@nestjs/common";
import { NotificationService } from "../../notification.service";
import { NotificationTypeDto } from "../../notification.types";
import {
  ChannelCapabilities,
  DispatchPayload,
  INotificationChannel,
  NotificationChannel,
} from "../abstractions/notification-channel";

/**
 * SiteChannel —— 站内通知 adapter
 *
 * 复用既有 NotificationService.createNotification()（M2 决策：包既有 service 不重写）
 * - dailyQuotaPerUser: 200（站内密度高，约束宽松）
 * - 总是 available（站内不需要绑定）
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §7.2.3 + §8.6
 */
@Injectable()
export class SiteChannel implements INotificationChannel {
  readonly type: NotificationChannel = "site";
  private readonly log = new Logger(SiteChannel.name);

  constructor(
    @Inject(NotificationService)
    private readonly notificationService: NotificationService,
  ) {}

  async send(userId: string, payload: DispatchPayload): Promise<void> {
    // payload.type 是 NotificationType prisma enum 字符串，与 NotificationTypeDto 同值
    const dtoType = payload.type as NotificationTypeDto;
    await this.notificationService.createNotification({
      userId,
      type: dtoType,
      title: payload.title,
      message: payload.message,
      actionUrl: payload.link,
      metadata: payload.metadata ?? {},
    });
    this.log.debug(
      `site-channel sent user=${userId} type=${payload.type} link=${payload.link ?? "-"}`,
    );
  }

  async isAvailable(_userId: string): Promise<boolean> {
    return true;
  }

  getCapabilities(): ChannelCapabilities {
    return {
      requiresUserBinding: false,
      requiresGlobalConfig: false,
      dailyQuotaPerUser: 200,
    };
  }
}
