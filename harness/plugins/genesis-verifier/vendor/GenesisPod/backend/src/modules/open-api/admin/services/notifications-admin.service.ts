import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "../../../../common/prisma/prisma.service";

@Injectable()
export class NotificationsAdminService {
  private readonly logger = new Logger(NotificationsAdminService.name);

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  async getNotificationStats() {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [totalCount, todayCount, unreadCount, byTypeRaw] =
        await Promise.all([
          this.prisma.notification.count(),
          this.prisma.notification.count({
            where: { createdAt: { gte: todayStart } },
          }),
          this.prisma.notification.count({ where: { read: false } }),
          this.prisma.notification.groupBy({
            by: ["type"],
            _count: true,
          }),
        ]);

      const unreadRate =
        totalCount > 0 ? Math.round((unreadCount / totalCount) * 100) : 0;
      const byType: Record<string, number> = {};
      for (const row of byTypeRaw) {
        byType[row.type] = row._count;
      }

      return {
        totalCount,
        todayCount,
        unreadRate,
        typeCount: byTypeRaw.length,
        byType,
      };
    } catch (error) {
      this.logger.error(`Failed to get notification stats: ${error}`);
      return {
        totalCount: 0,
        todayCount: 0,
        unreadRate: 0,
        typeCount: 0,
        byType: {},
      };
    }
  }

  async getRecentNotifications(
    page: number,
    limit: number,
    type?: string,
    readStatus?: string,
  ) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));

    // Build filter
    const where: Record<string, unknown> = {};
    if (type) {
      where.type = type;
    }
    if (readStatus === "read") {
      where.read = true;
    } else if (readStatus === "unread") {
      where.read = false;
    }

    try {
      const [items, total] = await Promise.all([
        this.prisma.notification.findMany({
          where,
          skip: (safePage - 1) * safeLimit,
          take: safeLimit,
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: { email: true, username: true },
            },
          },
        }),
        this.prisma.notification.count({ where }),
      ]);

      return {
        items: items.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          userId: n.userId,
          userEmail: n.user.email,
          userName: n.user.username,
          read: n.read,
          createdAt: n.createdAt,
        })),
        total,
        page: safePage,
        totalPages: Math.ceil(total / safeLimit),
      };
    } catch (error) {
      this.logger.error(`Failed to get recent notifications: ${error}`);
      return { items: [], total: 0, page: safePage, totalPages: 0 };
    }
  }

  async markAsRead(notificationId: string) {
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
    return { success: true };
  }

  async markAllRead() {
    const result = await this.prisma.notification.updateMany({
      where: { read: false },
      data: { read: true },
    });
    return { updated: result.count };
  }

  async deleteNotification(notificationId: string) {
    await this.prisma.notification.delete({
      where: { id: notificationId },
    });
    return { success: true };
  }

  async broadcastNotification(title: string, message: string, type = "SYSTEM") {
    const trimmedTitle = title.trim().slice(0, 200);
    const trimmedMessage = message.trim().slice(0, 2000);
    const safeType = type.trim() || "SYSTEM";

    // Use raw SQL INSERT...SELECT to avoid loading all users into memory
    const sent: number = await this.prisma.$executeRaw`
      INSERT INTO notifications (id, user_id, type, title, message, read, created_at)
      SELECT
        gen_random_uuid(),
        id,
        ${safeType}::"NotificationType",
        ${trimmedTitle},
        ${trimmedMessage},
        false,
        NOW()
      FROM users
      WHERE is_active = true
    `;

    this.logger.log(
      `Broadcast notification to ${sent} users: "${trimmedTitle}" (${safeType})`,
    );

    // 触发 NotificationGateway 频道级实时推送（在线用户立即看到 toast / badge +1）。
    // 不走 N+1 fan-out emit "notification.created"，避免大用户量时 EventEmitter2 拥堵。
    this.eventEmitter.emit("notification.broadcast", {
      title: trimmedTitle,
      message: trimmedMessage,
      type: safeType,
      sentCount: Number(sent ?? 0),
    });

    return { sent };
  }
}
