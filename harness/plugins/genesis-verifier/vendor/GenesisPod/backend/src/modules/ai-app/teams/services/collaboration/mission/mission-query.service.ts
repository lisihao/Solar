import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { MissionStatus } from "@prisma/client";

/**
 * Mission Query Service
 * 负责任务相关的只读查询操作
 */
@Injectable()
export class MissionQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取 Topic 下的所有任务
   */
  async getMissions(topicId: string, options?: { status?: MissionStatus }) {
    return this.prisma.teamMission.findMany({
      where: {
        topicId,
        ...(options?.status && { status: options.status }),
      },
      include: {
        leader: {
          select: {
            id: true,
            displayName: true,
            agentName: true,
            avatar: true,
            aiModel: true,
          },
        },
        createdBy: {
          select: { id: true, username: true, fullName: true },
        },
        tasks: {
          include: {
            assignedTo: {
              select: {
                id: true,
                displayName: true,
                agentName: true,
                avatar: true,
                aiModel: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: { tasks: true, logs: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 根据 ID 获取任务详情
   */
  async getMissionById(missionId: string) {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
      include: {
        leader: true,
        createdBy: {
          select: { id: true, username: true, fullName: true },
        },
        tasks: {
          include: {
            assignedTo: {
              select: {
                id: true,
                displayName: true,
                agentName: true,
                avatar: true,
                aiModel: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        logs: {
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    });

    if (!mission) {
      throw new NotFoundException("任务不存在");
    }

    return mission;
  }

  /**
   * 获取任务日志
   */
  async getMissionLogs(
    missionId: string,
    options?: { limit?: number; cursor?: string },
  ) {
    const limit = options?.limit || 50;

    return this.prisma.missionLog.findMany({
      where: { missionId },
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(options?.cursor && {
        cursor: { id: options.cursor },
        skip: 1,
      }),
    });
  }

  /**
   * 检查任务是否存在
   */
  async missionExists(missionId: string): Promise<boolean> {
    const count = await this.prisma.teamMission.count({
      where: { id: missionId },
    });
    return count > 0;
  }

  /**
   * 获取任务的基本信息（轻量查询）
   */
  async getMissionBasic(missionId: string) {
    return this.prisma.teamMission.findUnique({
      where: { id: missionId },
      select: {
        id: true,
        title: true,
        status: true,
        topicId: true,
        leaderId: true,
        progressPercent: true,
        completedTasks: true,
        totalTasks: true,
        createdAt: true,
      },
    });
  }

  /**
   * 获取任务的子任务列表
   */
  async getMissionTasks(missionId: string) {
    return this.prisma.agentTask.findMany({
      where: { missionId },
      include: {
        assignedTo: {
          select: {
            id: true,
            displayName: true,
            agentName: true,
            avatar: true,
            aiModel: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * 获取任务统计信息
   */
  async getMissionStats(missionId: string) {
    const tasks = await this.prisma.agentTask.findMany({
      where: { missionId },
      select: { status: true, result: true },
    });

    const statusCounts = tasks.reduce(
      (acc, task) => {
        acc[task.status] = (acc[task.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const totalWords = tasks.reduce((sum, task) => {
      return sum + (task.result?.length || 0);
    }, 0);

    return {
      total: tasks.length,
      statusCounts,
      totalWords,
      completionRate:
        tasks.length > 0
          ? ((statusCounts["COMPLETED"] || 0) / tasks.length) * 100
          : 0,
    };
  }

  /**
   * 获取 Topic 下正在进行的任务
   */
  async getInProgressMission(topicId: string) {
    return this.prisma.teamMission.findFirst({
      where: {
        topicId,
        status: MissionStatus.IN_PROGRESS,
      },
      include: {
        leader: true,
        tasks: {
          include: { assignedTo: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 获取 Topic 下最近的任务
   */
  async getLatestMission(topicId: string) {
    return this.prisma.teamMission.findFirst({
      where: { topicId },
      include: {
        leader: true,
        tasks: {
          include: { assignedTo: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 获取任务的完整信息（包含所有关联数据）
   */
  async getMissionFull(missionId: string) {
    return this.prisma.teamMission.findUnique({
      where: { id: missionId },
      include: {
        leader: true,
        createdBy: true,
        topic: {
          select: {
            id: true,
            name: true,
          },
        },
        tasks: {
          include: {
            assignedTo: true,
          },
          orderBy: { createdAt: "asc" },
        },
        logs: {
          orderBy: { createdAt: "desc" },
          take: 100,
        },
      },
    });
  }
}
