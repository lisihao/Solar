import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import * as os from "os";

export interface TaskMonitor {
  id: string;
  name: string;
  sourceName: string;
  status: string;
  progress: number;
  currentStep: string;
  collected: number;
  duplicates: number;
  failed: number;
  startedAt: Date | null;
  elapsedTime: number; // 秒
  estimatedTimeLeft: number; // 秒
}

export interface SystemMetrics {
  cpu: {
    usage: number;
    cores: number;
    model: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  uptime: number;
  activeTasks: number;
  queuedTasks: number;
  collectionsPerMinute: number;
  errorRate: number;
}

@Injectable()
export class MonitorService {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取所有运行中的任务
   */
  async getRunningTasks(): Promise<TaskMonitor[]> {
    const tasks = await this.prisma.collectionTask.findMany({
      where: {
        status: "RUNNING",
      },
      include: {
        source: true,
      },
      orderBy: { startedAt: "desc" },
    });

    return tasks.map((task) => {
      const elapsedTime = task.startedAt
        ? Math.floor((Date.now() - task.startedAt.getTime()) / 1000)
        : 0;

      const estimatedTimeLeft =
        task.progress > 0
          ? Math.floor((elapsedTime / task.progress) * (100 - task.progress))
          : 0;

      return {
        id: task.id,
        name: task.name,
        sourceName: task.source.name,
        status: task.status,
        progress: task.progress,
        currentStep: task.currentStep || "Processing",
        collected: task.successItems,
        duplicates: task.duplicateItems,
        failed: task.failedItems,
        startedAt: task.startedAt,
        elapsedTime,
        estimatedTimeLeft,
      };
    });
  }

  /**
   * 获取系统指标 - 使用真实的系统数据
   */
  async getSystemMetrics(): Promise<SystemMetrics> {
    const tasks = await this.prisma.collectionTask.findMany();

    const activeTasks = tasks.filter((t) => t.status === "RUNNING").length;
    const queuedTasks = tasks.filter((t) => t.status === "PENDING").length;

    // 计算最近1分钟的采集速率
    const oneMinuteAgo = new Date(Date.now() - 60000);
    const recentTasks = tasks.filter(
      (t) => t.completedAt && t.completedAt >= oneMinuteAgo,
    );
    const collectionsPerMinute = recentTasks.reduce(
      (sum, t) => sum + t.successItems,
      0,
    );

    // 计算错误率
    const completedTasks = tasks.filter((t) => t.status === "COMPLETED");
    const failedTasks = tasks.filter((t) => t.status === "FAILED");
    const errorRate =
      completedTasks.length + failedTasks.length > 0
        ? (failedTasks.length / (completedTasks.length + failedTasks.length)) *
          100
        : 0;

    // 获取真实的 CPU 使用率
    const cpuUsage = await this.getCpuUsage();
    const cpus = os.cpus();

    // 获取真实的内存使用情况
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    return {
      cpu: {
        usage: cpuUsage,
        cores: cpus.length,
        model: cpus.length > 0 ? cpus[0].model : "Unknown",
      },
      memory: {
        total: totalMemory,
        used: usedMemory,
        free: freeMemory,
        percentage: (usedMemory / totalMemory) * 100,
      },
      uptime: os.uptime(),
      activeTasks,
      queuedTasks,
      collectionsPerMinute,
      errorRate,
    };
  }

  /**
   * 获取 CPU 使用率（采样方式）
   */
  private async getCpuUsage(): Promise<number> {
    const startMeasure = this.cpuAverage();

    // 等待 100ms 进行采样
    await new Promise((resolve) => setTimeout(resolve, 100));

    const endMeasure = this.cpuAverage();

    const idleDifference = endMeasure.idle - startMeasure.idle;
    const totalDifference = endMeasure.total - startMeasure.total;

    const cpuPercentage =
      totalDifference > 0
        ? ((totalDifference - idleDifference) / totalDifference) * 100
        : 0;

    return Math.round(cpuPercentage * 10) / 10;
  }

  /**
   * 计算 CPU 平均值
   */
  private cpuAverage(): { idle: number; total: number } {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach((cpu) => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });

    return {
      idle: totalIdle / cpus.length,
      total: totalTick / cpus.length,
    };
  }

  /**
   * 获取任务详细监控数据
   */
  async getTaskDetail(taskId: string): Promise<Record<string, unknown> | null> {
    const task = await this.prisma.collectionTask.findUnique({
      where: { id: taskId },
      include: {
        source: true,
        resources: {
          take: 20,
          orderBy: { createdAt: "desc" },
        },
        deduplicationRecords: {
          take: 20,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!task) {
      return null;
    }

    const elapsedTime = task.startedAt
      ? Math.floor((Date.now() - task.startedAt.getTime()) / 1000)
      : 0;

    return {
      ...task,
      elapsedTime,
      throughput: elapsedTime > 0 ? task.processedItems / elapsedTime : 0,
    };
  }

  /**
   * 获取实时日志（最近100条）
   */
  async getRecentLogs(
    taskId?: string,
  ): Promise<
    Array<{ timestamp: Date; level: string; taskId?: string; message: string }>
  > {
    // TODO: 实现真实的日志系统
    // 这里返回模拟数据
    const logs = [
      {
        timestamp: new Date(),
        level: "INFO",
        taskId: taskId || "all",
        message: "Task started successfully",
      },
      {
        timestamp: new Date(Date.now() - 5000),
        level: "INFO",
        message: "Fetching data from source",
      },
      {
        timestamp: new Date(Date.now() - 10000),
        level: "WARN",
        message: "Duplicate detected, skipping item",
      },
    ];

    return logs;
  }

  /**
   * 获取性能图表数据
   */
  async getPerformanceMetrics(hours: number = 1): Promise<
    Array<{
      timestamp: Date;
      collected: number;
      duplicates: number;
      errors: number;
      activeTasks: number;
    }>
  > {
    const startTime = new Date(Date.now() - hours * 3600000);

    const tasks = await this.prisma.collectionTask.findMany({
      where: {
        startedAt: {
          gte: startTime,
        },
      },
      orderBy: { startedAt: "asc" },
    });

    // 按5分钟间隔分组
    const interval = 5 * 60 * 1000; // 5分钟
    const metrics: Record<
      string,
      {
        timestamp: Date;
        collected: number;
        duplicates: number;
        errors: number;
        activeTasks: number;
      }
    > = {};

    tasks.forEach((task) => {
      if (!task.startedAt) return;

      const timeKey =
        Math.floor(task.startedAt.getTime() / interval) * interval;
      const timestamp = new Date(timeKey);

      if (!metrics[timeKey]) {
        metrics[timeKey] = {
          timestamp,
          collected: 0,
          duplicates: 0,
          errors: 0,
          activeTasks: 0,
        };
      }

      metrics[timeKey].collected += task.successItems;
      metrics[timeKey].duplicates += task.duplicateItems;
      metrics[timeKey].errors += task.failedItems;

      if (task.status === "RUNNING") {
        metrics[timeKey].activeTasks += 1;
      }
    });

    return Object.values(metrics).sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
  }
}
