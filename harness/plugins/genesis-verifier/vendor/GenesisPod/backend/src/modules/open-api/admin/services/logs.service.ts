import { Injectable } from "@nestjs/common";
import { CollectionTaskStatus } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";

const MAX_PAGE_LIMIT = 100;

@Injectable()
export class LogsService {
  constructor(private prisma: PrismaService) {}

  async getLogsStats() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totalLogins, todayLogins, totalTasks, failedTasks] =
      await Promise.all([
        this.prisma.loginHistory.count(),
        this.prisma.loginHistory.count({
          where: { loginAt: { gte: todayStart } },
        }),
        this.prisma.collectionTask.count(),
        this.prisma.collectionTask.count({
          where: { status: "FAILED" },
        }),
      ]);

    return { totalLogins, todayLogins, totalTasks, failedTasks };
  }

  async getLoginHistory(params: {
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where = params.search
      ? {
          user: {
            OR: [
              {
                email: {
                  contains: params.search,
                  mode: "insensitive" as const,
                },
              },
              {
                username: {
                  contains: params.search,
                  mode: "insensitive" as const,
                },
              },
            ],
          },
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.loginHistory.findMany({
        where,
        include: {
          user: { select: { email: true, username: true } },
        },
        orderBy: { loginAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.loginHistory.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        userEmail: item.user.email,
        userName: item.user.username,
        loginAt: item.loginAt,
        ipAddress: item.ipAddress,
        device: item.device,
        browser: item.browser,
        os: item.os,
        location: item.location,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getTaskHistory(params: {
    page?: number;
    limit?: number;
    status?: string;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const validStatuses = Object.values(CollectionTaskStatus);
    const where =
      params.status &&
      validStatuses.includes(params.status as CollectionTaskStatus)
        ? { status: params.status as CollectionTaskStatus }
        : {};

    const [items, total] = await Promise.all([
      this.prisma.collectionTask.findMany({
        where,
        include: {
          source: { select: { name: true, type: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.collectionTask.count({ where }),
    ]);

    return {
      items: items.map((task) => ({
        id: task.id,
        name: task.name,
        sourceName: task.source.name,
        sourceType: task.source.type,
        status: task.status,
        totalItems: task.totalItems,
        successItems: task.successItems,
        failedItems: task.failedItems,
        duplicateItems: task.duplicateItems,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        createdAt: task.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
