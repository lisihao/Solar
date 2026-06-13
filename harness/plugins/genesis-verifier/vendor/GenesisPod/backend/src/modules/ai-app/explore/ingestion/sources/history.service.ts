import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { CollectionTaskStatus, Prisma } from "@prisma/client";

export interface HistoryRecord {
  id: string;
  taskName: string;
  sourceName: string;
  status: CollectionTaskStatus;
  totalItems: number;
  successItems: number;
  failedItems: number;
  duplicateItems: number;
  skippedItems: number;
  duration: number; // 秒
  startedAt: Date | null;
  completedAt: Date | null;
}

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 获取历史记录
   */
  async getHistory(filters?: {
    status?: CollectionTaskStatus;
    sourceId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ records: HistoryRecord[]; total: number }> {
    const where: Prisma.CollectionTaskWhereInput = {
      completedAt: {
        not: null,
      },
    };

    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.sourceId) {
      where.sourceId = filters.sourceId;
    }
    if (filters?.startDate || filters?.endDate) {
      where.completedAt = {
        ...(filters.startDate && { gte: filters.startDate }),
        ...(filters.endDate && { lte: filters.endDate }),
      };
    }

    const [tasks, total] = await Promise.all([
      this.prisma.collectionTask.findMany({
        where,
        include: {
          source: true,
        },
        orderBy: { completedAt: "desc" },
        take: filters?.limit || 50,
        skip: filters?.offset || 0,
      }),
      this.prisma.collectionTask.count({ where }),
    ]);

    const records: HistoryRecord[] = tasks.map((task) => {
      const duration =
        task.startedAt && task.completedAt
          ? Math.floor(
              (task.completedAt.getTime() - task.startedAt.getTime()) / 1000,
            )
          : 0;

      return {
        id: task.id,
        taskName: task.name,
        sourceName: task.source.name,
        status: task.status,
        totalItems: task.totalItems,
        successItems: task.successItems,
        failedItems: task.failedItems,
        duplicateItems: task.duplicateItems,
        skippedItems: task.skippedItems,
        duration,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
      };
    });

    return { records, total };
  }

  /**
   * 获取历史统计
   */
  async getStats(period: "day" | "week" | "month" = "week"): Promise<{
    period: string;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalCollected: number;
    totalDuplicates: number;
    totalFailed: number;
    successRate: number;
    avgDuration: number;
  }> {
    const now = new Date();
    const startDate = new Date();

    switch (period) {
      case "day":
        startDate.setDate(startDate.getDate() - 1);
        break;
      case "week":
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "month":
        startDate.setMonth(startDate.getMonth() - 1);
        break;
    }

    const tasks = await this.prisma.collectionTask.findMany({
      where: {
        completedAt: {
          gte: startDate,
          lte: now,
        },
      },
    });

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.status === "COMPLETED").length;
    const failedTasks = tasks.filter((t) => t.status === "FAILED").length;
    const totalCollected = tasks.reduce((sum, t) => sum + t.successItems, 0);
    const totalDuplicates = tasks.reduce((sum, t) => sum + t.duplicateItems, 0);
    const totalFailed = tasks.reduce((sum, t) => sum + t.failedItems, 0);

    const successRate =
      totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    const avgDuration =
      tasks.length > 0
        ? tasks.reduce((sum, t) => {
            if (!t.startedAt || !t.completedAt) return sum;
            return (
              sum + (t.completedAt.getTime() - t.startedAt.getTime()) / 1000
            );
          }, 0) / tasks.length
        : 0;

    return {
      period,
      totalTasks,
      completedTasks,
      failedTasks,
      totalCollected,
      totalDuplicates,
      totalFailed,
      successRate,
      avgDuration,
    };
  }

  /**
   * 获取任务详细历史
   */
  async getTaskHistory(
    taskId: string,
  ): Promise<Record<string, unknown> | null> {
    const task = await this.prisma.collectionTask.findUnique({
      where: { id: taskId },
      include: {
        source: true,
        resources: {
          take: 50,
          orderBy: { createdAt: "desc" },
        },
        deduplicationRecords: {
          take: 50,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return task;
  }

  /**
   * 删除历史记录
   */
  async deleteHistory(taskId: string): Promise<void> {
    await this.prisma.collectionTask.delete({
      where: { id: taskId },
    });
  }

  /**
   * 清理旧历史记录
   */
  async cleanOldHistory(days: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.prisma.collectionTask.deleteMany({
      where: {
        completedAt: {
          lt: cutoffDate,
        },
        status: {
          in: ["COMPLETED", "FAILED", "CANCELLED"],
        },
      },
    });

    this.logger.log(`Cleaned ${result.count} old history records`);
    return result.count;
  }
}
