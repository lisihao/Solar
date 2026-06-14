import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

export interface DashboardStats {
  sourceStats: {
    total: number;
    active: number;
    paused: number;
    failed: number;
  };
  taskStats: {
    total: number;
    running: number;
    pending: number;
    completed: number;
    failed: number;
  };
  todayStats: {
    collected: number;
    success: number;
    failed: number;
    duplicates: number;
    successRate: number;
    avgQuality: number;
    // 对比数据
    collectedVsYesterday: number; // 与昨天相比的百分比变化
    qualityVsLastWeek: number; // 与上周相比的百分比变化
    yesterdayCollected: number;
    lastWeekAvgQuality: number;
  };
  qualityMetrics: {
    avgCompleteness: number;
    avgAccuracy: number;
    avgTimeliness: number;
    avgUsability: number;
  };
  recentTasks: Array<{
    id: string;
    name: string;
    sourceName: string;
    status: string;
    progress: number;
    successItems: number;
    duplicateItems: number;
    failedItems: number;
    startedAt: string | null;
    completedAt: string | null;
  }>;
  timeSeries: {
    date: string;
    collected: number;
    duplicates: number;
    failed: number;
  }[];
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取仪表盘统计数据
   */
  async getStats(): Promise<DashboardStats> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 数据源统计
    const sources = await this.prisma.dataSource.findMany();
    const sourceStats = {
      total: sources.length,
      active: sources.filter((s) => s.status === "ACTIVE").length,
      paused: sources.filter((s) => s.status === "PAUSED").length,
      failed: sources.filter((s) => s.status === "FAILED").length,
    };

    // 任务统计
    const tasks = await this.prisma.collectionTask.findMany();
    const taskStats = {
      total: tasks.length,
      running: tasks.filter((t) => t.status === "RUNNING").length,
      pending: tasks.filter((t) => t.status === "PENDING").length,
      completed: tasks.filter((t) => t.status === "COMPLETED").length,
      failed: tasks.filter((t) => t.status === "FAILED").length,
    };

    // 今日统计
    const todayTasks = tasks.filter(
      (t) => t.completedAt && t.completedAt >= today,
    );
    const todayCollected = todayTasks.reduce(
      (sum, t) => sum + t.successItems,
      0,
    );
    const todaySuccess = todayTasks.reduce((sum, t) => sum + t.successItems, 0);
    const todayFailed = todayTasks.reduce((sum, t) => sum + t.failedItems, 0);
    const todayDuplicates = todayTasks.reduce(
      (sum, t) => sum + t.duplicateItems,
      0,
    );
    const todayTotal = todaySuccess + todayFailed;

    const todayStats = {
      collected: todayCollected,
      success: todaySuccess,
      failed: todayFailed,
      duplicates: todayDuplicates,
      successRate: todayTotal > 0 ? (todaySuccess / todayTotal) * 100 : 0,
      avgQuality: 87.5, // 可以从实际数据计算
      // 对比数据 - 暂时使用占位值
      collectedVsYesterday: 0,
      qualityVsLastWeek: 0,
      yesterdayCollected: 0,
      lastWeekAvgQuality: 0,
    };

    // 质量统计
    const qualityMetrics = {
      avgCompleteness: 85.0,
      avgAccuracy: 90.0,
      avgTimeliness: 88.0,
      avgUsability: 87.5,
    };

    // 最近任务
    const recentTasks = await this.prisma.collectionTask.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: {
        source: true,
      },
    });

    return {
      sourceStats: sourceStats,
      taskStats: taskStats,
      todayStats: todayStats,
      qualityMetrics: qualityMetrics,
      recentTasks: recentTasks.map((task) => ({
        id: task.id,
        name: task.name,
        sourceName: task.source?.name || "Unknown",
        status: task.status,
        progress: task.progress,
        successItems: task.successItems,
        duplicateItems: task.duplicateItems,
        failedItems: task.failedItems,
        startedAt: task.startedAt ? task.startedAt.toISOString() : null,
        completedAt: task.completedAt ? task.completedAt.toISOString() : null,
      })),
      timeSeries: [],
    };
  }

  /**
   * 获取时间序列数据（用于图表）
   */
  async getTimeSeries(days: number = 7): Promise<
    Array<{
      date: string;
      collected: number;
      success: number;
      failed: number;
      duplicates: number;
    }>
  > {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const tasks = await this.prisma.collectionTask.findMany({
      where: {
        completedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { completedAt: "asc" },
    });

    // 按天分组统计
    const dailyStats: Record<
      string,
      { collected: number; success: number; failed: number; duplicates: number }
    > = {};

    tasks.forEach((task) => {
      if (!task.completedAt) return;

      const date = task.completedAt.toISOString().split("T")[0];
      if (!dailyStats[date]) {
        dailyStats[date] = {
          collected: 0,
          success: 0,
          failed: 0,
          duplicates: 0,
        };
      }

      dailyStats[date].collected += task.totalItems;
      dailyStats[date].success += task.successItems;
      dailyStats[date].failed += task.failedItems;
      dailyStats[date].duplicates += task.duplicateItems;
    });

    return Object.entries(dailyStats).map(([date, stats]) => ({
      date,
      ...stats,
    }));
  }
}
