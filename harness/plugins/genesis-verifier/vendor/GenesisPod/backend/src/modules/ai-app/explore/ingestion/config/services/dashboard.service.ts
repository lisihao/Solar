import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ImportTaskStatus } from "@prisma/client";

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardSummary() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalResources = await this.prisma.resource.count();

    const newToday = await this.prisma.resource.count({
      where: {
        createdAt: {
          gte: today,
        },
      },
    });

    const taskCounts = await this.prisma.importTask.groupBy({
      by: ["status"],
      _count: {
        status: true,
      },
    });

    const completedTasks =
      taskCounts.find((t) => t.status === ImportTaskStatus.SUCCESS)?._count
        .status || 0;
    const failedTasks =
      taskCounts.find((t) => t.status === ImportTaskStatus.FAILED)?._count
        .status || 0;
    const pendingTasks =
      taskCounts.find((t) => t.status === ImportTaskStatus.PENDING)?._count
        .status || 0;

    const totalTasks = completedTasks + failedTasks + pendingTasks;
    const successRate =
      totalTasks > 0
        ? (completedTasks / (completedTasks + failedTasks)) * 100
        : 100;

    return {
      totalResources,
      newToday,
      successRate: parseFloat(successRate.toFixed(1)),
      errorTasks: failedTasks,
      pendingTasks,
    };
  }

  async getRecentTasks() {
    return this.prisma.importTask.findMany({
      take: 15,
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        sourceUrl: true,
        status: true,
        createdAt: true,
        errorMessage: true,
      },
    });
  }
}
