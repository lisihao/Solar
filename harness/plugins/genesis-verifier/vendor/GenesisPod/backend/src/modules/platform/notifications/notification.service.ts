import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { NotificationType, Prisma } from "@prisma/client";
import {
  CreateNotificationDto,
  BatchCreateNotificationDto,
  UpdateNotificationPreferenceDto,
  NotificationTypeDto,
} from "./notification.types";
import { QuietHoursUtil } from "./dispatcher/preferences/quiet-hours.util";

// 用于验证类型的映射
const VALID_NOTIFICATION_TYPES: Record<NotificationTypeDto, NotificationType> =
  {
    [NotificationTypeDto.SYSTEM]: "SYSTEM",
    [NotificationTypeDto.UPDATE]: "UPDATE",
    [NotificationTypeDto.TIP]: "TIP",
    [NotificationTypeDto.JOIN_REQUEST]: "JOIN_REQUEST",
    [NotificationTypeDto.JOIN_APPROVED]: "JOIN_APPROVED",
    [NotificationTypeDto.JOIN_REJECTED]: "JOIN_REJECTED",
    [NotificationTypeDto.INVITATION]: "INVITATION",
    [NotificationTypeDto.INVITATION_EXPIRED]: "INVITATION_EXPIRED",
    [NotificationTypeDto.RESEARCH_COMPLETED]: "RESEARCH_COMPLETED",
    [NotificationTypeDto.MISSION_COMPLETED]: "MISSION_COMPLETED",
    [NotificationTypeDto.MISSION_FAILED]: "MISSION_FAILED",
    [NotificationTypeDto.WRITING_COMPLETED]: "WRITING_COMPLETED",
    [NotificationTypeDto.OFFICE_COMPLETED]: "OFFICE_COMPLETED",
    [NotificationTypeDto.TASK_ASSIGNED]: "TASK_ASSIGNED",
    [NotificationTypeDto.MENTION]: "MENTION",
    [NotificationTypeDto.CREDITS_LOW]: "CREDITS_LOW",
    [NotificationTypeDto.CREDITS_RECEIVED]: "CREDITS_RECEIVED",
    [NotificationTypeDto.FEEDBACK_RECEIVED]: "FEEDBACK_RECEIVED",
    [NotificationTypeDto.FEEDBACK_REPLIED]: "FEEDBACK_REPLIED",
    [NotificationTypeDto.FEEDBACK_STATUS_CHANGED]: "FEEDBACK_STATUS_CHANGED",
    [NotificationTypeDto.SESSION_EXPIRED]: "SESSION_EXPIRED",
    [NotificationTypeDto.KEY_REQUEST_SUBMITTED]: "KEY_REQUEST_SUBMITTED",
    [NotificationTypeDto.KEY_REQUEST_APPROVED]: "KEY_REQUEST_APPROVED",
    [NotificationTypeDto.KEY_REQUEST_REJECTED]: "KEY_REQUEST_REJECTED",
    [NotificationTypeDto.KEY_GRANTED]: "KEY_GRANTED",
    // PR-DR1a RADAR_* 同步（R3 arch P0 整改）
    [NotificationTypeDto.RADAR_DAILY]: "RADAR_DAILY",
    [NotificationTypeDto.RADAR_WEEKLY]: "RADAR_WEEKLY",
    [NotificationTypeDto.RADAR_TIER3_INSTANT]: "RADAR_TIER3_INSTANT",
    [NotificationTypeDto.RADAR_SOURCE_AUTO_DISABLED]:
      "RADAR_SOURCE_AUTO_DISABLED",
    [NotificationTypeDto.RADAR_MISSION_COMPLETE]: "RADAR_MISSION_COMPLETE",
  };

// 批量操作结果
interface BatchResult {
  count: number;
  succeeded: string[];
  failed: Array<{ userId: string; error: string }>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * 验证并转换通知类型
   */
  private validateNotificationType(
    type: NotificationTypeDto,
  ): NotificationType {
    const validType = VALID_NOTIFICATION_TYPES[type];
    if (!validType) {
      throw new BadRequestException(`Invalid notification type: ${type}`);
    }
    return validType;
  }

  /**
   * 创建单个通知
   *
   * Quiet hours：如果当前时间落在用户配置的免打扰窗口（quietHoursStart..End），
   * DB 仍会写入（用户上线就能看到），但 emit 的事件会带 silent=true 标记 ——
   * gateway 仍推送以更新 unread badge，但前端 toast 层应抑制弹窗。
   * 当前对比按 UTC 时间（NotificationPreference 表未存时区，留 W5 follow-up）。
   */
  async createNotification(
    dto: CreateNotificationDto,
  ): Promise<{ id: string }> {
    this.logger.log(
      `Creating notification for user ${dto.userId}: ${dto.type}`,
    );

    const notificationType = this.validateNotificationType(dto.type);

    const notification = await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        type: notificationType,
        title: dto.title,
        message: dto.message,
        iconUrl: dto.iconUrl,
        actionUrl: dto.actionUrl,
        actionLabel: dto.actionLabel,
        relatedType: dto.relatedType,
        relatedId: dto.relatedId,
        metadata: (dto.metadata || {}) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    this.logger.log(`Notification created: ${notification.id}`);

    // 发出通知事件（用于WebSocket推送）
    const silent = await this.isWithinQuietHours(dto.userId);
    this.eventEmitter.emit("notification.created", {
      notificationId: notification.id,
      userId: dto.userId,
      type: dto.type,
      title: dto.title,
      message: dto.message,
      silent,
    });

    return { id: notification.id };
  }

  /**
   * 判断 userId 当前时间是否落在 quiet hours 窗口内。
   * 任何错误（无 preference / DB 异常 / 解析失败）一律返回 false（不抑制），
   * 通知层不能因为查偏好失败而 swallow 用户事件。
   */
  private async isWithinQuietHours(userId: string): Promise<boolean> {
    try {
      const pref = await this.prisma.notificationPreference.findUnique({
        where: { userId },
        select: { quietHoursStart: true, quietHoursEnd: true },
      });
      if (!pref?.quietHoursStart || !pref?.quietHoursEnd) return false;
      return NotificationService.timeInWindow(
        new Date(),
        pref.quietHoursStart,
        pref.quietHoursEnd,
      );
    } catch (err) {
      this.logger.debug(
        `isWithinQuietHours lookup failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * "HH:mm" 时间窗口包含判断 — 转发到共享 QuietHoursUtil（R1 reuse 整改单源）
   * 保留静态导出避免破既有调用方 / 测试
   */
  static timeInWindow = QuietHoursUtil.timeInWindow;

  /**
   * 批量创建通知（发送给多个用户）
   * 使用 createMany 优化性能，避免 N+1 问题
   */
  async batchCreateNotifications(
    dto: BatchCreateNotificationDto,
  ): Promise<BatchResult> {
    this.logger.log(
      `Creating batch notifications for ${dto.userIds.length} users`,
    );

    const notificationType = this.validateNotificationType(dto.type);
    const succeeded: string[] = [];
    const failed: Array<{ userId: string; error: string }> = [];

    try {
      // 使用 createMany 批量插入，大幅提升性能
      const metadataJson = (dto.metadata || {}) as Prisma.InputJsonValue;
      const result = await this.prisma.notification.createMany({
        data: dto.userIds.map((userId) => ({
          userId,
          type: notificationType,
          title: dto.title,
          message: dto.message,
          actionUrl: dto.actionUrl,
          actionLabel: dto.actionLabel,
          metadata: metadataJson,
        })),
        skipDuplicates: true,
      });

      // 所有成功
      succeeded.push(...dto.userIds);

      // 批量发送事件
      dto.userIds.forEach((userId) => {
        this.eventEmitter.emit("notification.created", {
          userId,
          type: dto.type,
          title: dto.title,
          message: dto.message,
        });
      });

      this.logger.log(
        `Batch notifications created: ${result.count}/${dto.userIds.length}`,
      );
      return { count: result.count, succeeded, failed };
    } catch (error) {
      // 如果批量插入失败，降级为逐个插入以确保部分成功
      this.logger.warn(
        "Batch insert failed, falling back to individual inserts",
      );

      const fallbackMetadata = (dto.metadata || {}) as Prisma.InputJsonValue;
      for (const userId of dto.userIds) {
        try {
          await this.prisma.notification.create({
            data: {
              userId,
              type: notificationType,
              title: dto.title,
              message: dto.message,
              actionUrl: dto.actionUrl,
              actionLabel: dto.actionLabel,
              metadata: fallbackMetadata,
            },
          });
          succeeded.push(userId);

          this.eventEmitter.emit("notification.created", {
            userId,
            type: dto.type,
            title: dto.title,
            message: dto.message,
          });
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : "Unknown error";
          this.logger.error(
            `Failed to create notification for user ${userId}`,
            err,
          );
          failed.push({ userId, error: errorMessage });
        }
      }

      this.logger.log(
        `Batch notifications created: ${succeeded.length}/${dto.userIds.length}`,
      );
      return { count: succeeded.length, succeeded, failed };
    }
  }

  /**
   * 获取用户通知列表
   * 使用 Prisma ORM 避免 SQL 注入
   */
  async getNotifications(
    userId: string,
    options?: {
      page?: number;
      limit?: number;
      type?: NotificationTypeDto;
      read?: boolean;
    },
  ) {
    const { page = 1, limit = 20, type, read } = options || {};
    const skip = (page - 1) * limit;

    // 构建类型安全的查询条件
    const where: Prisma.NotificationWhereInput = {
      userId,
    };

    if (type) {
      where.type = this.validateNotificationType(type);
    }

    if (read !== undefined) {
      where.read = read;
    }

    // 并行查询通知列表和总数
    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      notifications: notifications.map((n) => ({
        id: n.id,
        userId: n.userId,
        type: n.type,
        title: n.title,
        message: n.message,
        iconUrl: n.iconUrl,
        actionUrl: n.actionUrl,
        actionLabel: n.actionLabel,
        relatedType: n.relatedType,
        relatedId: n.relatedId,
        read: n.read,
        readAt: n.readAt,
        metadata: n.metadata,
        expiresAt: n.expiresAt,
        createdAt: n.createdAt,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * 获取未读通知数量
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        userId,
        read: false,
      },
    });
  }

  /**
   * 标记单个通知为已读
   */
  async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    try {
      await this.prisma.notification.updateMany({
        where: {
          id: notificationId,
          userId, // 确保只能修改自己的通知
        },
        data: {
          read: true,
          readAt: new Date(),
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 标记所有通知为已读
   */
  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: {
        read: true,
        readAt: new Date(),
      },
    });
    return result.count;
  }

  /**
   * 删除单个通知
   */
  async deleteNotification(
    notificationId: string,
    userId: string,
  ): Promise<boolean> {
    try {
      await this.prisma.notification.deleteMany({
        where: {
          id: notificationId,
          userId, // 确保只能删除自己的通知
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 清理过期通知
   */
  async cleanupExpiredNotifications(): Promise<number> {
    const result = await this.prisma.notification.deleteMany({
      where: {
        expiresAt: {
          not: null,
          lt: new Date(),
        },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} expired notifications`);
    }
    return result.count;
  }

  // ========== 通知偏好设置 ==========

  /**
   * 获取用户通知偏好
   */
  async getPreferences(userId: string) {
    const preference = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });

    if (!preference) {
      // 返回默认偏好
      return {
        emailEnabled: true,
        pushEnabled: true,
        soundEnabled: true,
        typeSettings: {},
        quietHoursStart: null,
        quietHoursEnd: null,
        channelSubscriptions: {},
        instantPushForTier3: true,
      };
    }

    return {
      emailEnabled: preference.emailEnabled,
      pushEnabled: preference.pushEnabled,
      soundEnabled: preference.soundEnabled,
      typeSettings: preference.typeSettings as Record<string, boolean>,
      quietHoursStart: preference.quietHoursStart,
      quietHoursEnd: preference.quietHoursEnd,
      channelSubscriptions: preference.channelSubscriptions as Record<
        string,
        Partial<Record<string, boolean>>
      >,
      instantPushForTier3: preference.instantPushForTier3,
    };
  }

  /**
   * 更新用户通知偏好
   * 使用 upsert 避免竞态条件
   */
  async updatePreferences(
    userId: string,
    dto: UpdateNotificationPreferenceDto,
  ) {
    // 构建更新数据
    const updateData: Prisma.NotificationPreferenceUpdateInput = {};
    const createData: Prisma.NotificationPreferenceCreateInput = {
      user: { connect: { id: userId } },
      emailEnabled: dto.emailEnabled ?? true,
      pushEnabled: dto.pushEnabled ?? true,
      soundEnabled: dto.soundEnabled ?? true,
      typeSettings: dto.typeSettings || {},
      quietHoursStart: dto.quietHoursStart || null,
      quietHoursEnd: dto.quietHoursEnd || null,
    };

    if (dto.emailEnabled !== undefined)
      updateData.emailEnabled = dto.emailEnabled;
    if (dto.pushEnabled !== undefined) updateData.pushEnabled = dto.pushEnabled;
    if (dto.soundEnabled !== undefined)
      updateData.soundEnabled = dto.soundEnabled;
    if (dto.typeSettings !== undefined)
      updateData.typeSettings = dto.typeSettings;
    if (dto.quietHoursStart !== undefined)
      updateData.quietHoursStart = dto.quietHoursStart;
    if (dto.quietHoursEnd !== undefined)
      updateData.quietHoursEnd = dto.quietHoursEnd;
    // PR-DR1b 新增
    if (dto.channelSubscriptions !== undefined) {
      updateData.channelSubscriptions = dto.channelSubscriptions;
      createData.channelSubscriptions = dto.channelSubscriptions;
    }
    if (dto.instantPushForTier3 !== undefined) {
      updateData.instantPushForTier3 = dto.instantPushForTier3;
      createData.instantPushForTier3 = dto.instantPushForTier3;
    }

    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: createData,
      update: updateData,
    });

    return this.getPreferences(userId);
  }
}
