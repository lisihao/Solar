/**
 * Review Workflow Service
 *
 * 协作审核工作流服务 (Phase 3.3)
 *
 * 核心职责：
 * 1. 创建和管理审核任务 (ReviewTask)
 * 2. 分配任务给协作者
 * 3. 跟踪审核状态和进度
 * 4. 处理审核意见和反馈
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ReviewTaskStatus } from "@prisma/client";
import type {
  CreateReviewTaskInput,
  AssignTaskInput,
  CompleteTaskInput,
  ReviewTaskStats,
} from "../../types/collaboration.types";

@Injectable()
export class ReviewWorkflowService {
  private readonly logger = new Logger(ReviewWorkflowService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 为报告创建审核任务
   * 基于报告章节自动生成任务
   */
  async createReviewTasksForReport(
    reportId: string,
    creatorId: string,
  ): Promise<{
    created: number;
    tasks: Array<{ id: string; sectionName: string }>;
  }> {
    this.logger.log(`Creating review tasks for report: ${reportId}`);

    // 获取报告及其维度分析
    const report = await this.prisma.topicReport.findUnique({
      where: { id: reportId },
      include: {
        dimensionAnalyses: {
          include: { dimension: true },
          orderBy: { dimension: { sortOrder: "asc" } },
        },
      },
    });

    if (!report) {
      throw new NotFoundException(`Report not found: ${reportId}`);
    }

    // 创建任务列表
    const tasksToCreate: CreateReviewTaskInput[] = [];

    // 为执行摘要创建任务
    tasksToCreate.push({
      reportId,
      sectionName: "执行摘要",
      sectionOrder: 0,
    });

    // 为每个维度创建任务
    for (const analysis of report.dimensionAnalyses) {
      tasksToCreate.push({
        reportId,
        sectionId: analysis.dimensionId,
        sectionName: analysis.dimension.name,
        sectionOrder: analysis.dimension.sortOrder,
      });
    }

    // 批量创建任务
    const createdTasks = await Promise.all(
      tasksToCreate.map((task) =>
        this.prisma.reviewTask.create({
          data: {
            reportId: task.reportId,
            sectionId: task.sectionId,
            sectionName: task.sectionName,
            sectionOrder: task.sectionOrder || 0,
            assignedById: creatorId,
            status: ReviewTaskStatus.PENDING,
          },
          select: { id: true, sectionName: true },
        }),
      ),
    );

    this.logger.log(`Created ${createdTasks.length} review tasks`);

    return {
      created: createdTasks.length,
      tasks: createdTasks,
    };
  }

  /**
   * 获取报告的所有审核任务
   */
  async getReviewTasks(reportId: string) {
    return this.prisma.reviewTask.findMany({
      where: { reportId },
      orderBy: { sectionOrder: "asc" },
      include: {
        assignee: {
          select: { id: true, fullName: true, email: true, avatarUrl: true },
        },
      },
    });
  }

  /**
   * 分配审核任务
   */
  async assignTask(input: AssignTaskInput, assignerId: string) {
    this.logger.log(`Assigning task ${input.taskId} to ${input.assigneeName}`);

    return this.prisma.reviewTask.update({
      where: { id: input.taskId },
      data: {
        assigneeId: input.assigneeId,
        assigneeName: input.assigneeName,
        assignedAt: new Date(),
        assignedById: assignerId,
        dueAt: input.dueAt,
        status: ReviewTaskStatus.IN_PROGRESS,
      },
    });
  }

  /**
   * 批量分配任务
   */
  async assignTasksBatch(
    assignments: Array<{
      taskId: string;
      assigneeId: string;
      assigneeName: string;
    }>,
    assignerId: string,
  ) {
    const results = await Promise.all(
      assignments.map((assignment) =>
        this.assignTask(
          {
            taskId: assignment.taskId,
            assigneeId: assignment.assigneeId,
            assigneeName: assignment.assigneeName,
          },
          assignerId,
        ),
      ),
    );

    return { assigned: results.length };
  }

  /**
   * 开始审核任务
   */
  async startTask(taskId: string, userId: string) {
    const task = await this.prisma.reviewTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundException(`Task not found: ${taskId}`);
    }

    // 如果未分配，自动分配给当前用户
    if (!task.assigneeId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true },
      });

      return this.prisma.reviewTask.update({
        where: { id: taskId },
        data: {
          assigneeId: userId,
          assigneeName: user?.fullName || "Unknown",
          assignedAt: new Date(),
          status: ReviewTaskStatus.IN_PROGRESS,
        },
      });
    }

    return this.prisma.reviewTask.update({
      where: { id: taskId },
      data: {
        status: ReviewTaskStatus.IN_PROGRESS,
      },
    });
  }

  /**
   * 完成审核任务
   */
  async completeTask(input: CompleteTaskInput, _userId: string) {
    this.logger.log(
      `Completing task ${input.taskId}, approved: ${input.approved}`,
    );

    const task = await this.prisma.reviewTask.findUnique({
      where: { id: input.taskId },
    });

    if (!task) {
      throw new NotFoundException(`Task not found: ${input.taskId}`);
    }

    return this.prisma.reviewTask.update({
      where: { id: input.taskId },
      data: {
        status: ReviewTaskStatus.COMPLETED,
        completedAt: new Date(),
        approved: input.approved,
        score: input.score,
        comments: input.comments,
      },
    });
  }

  /**
   * 跳过审核任务
   */
  async skipTask(taskId: string, reason?: string) {
    return this.prisma.reviewTask.update({
      where: { id: taskId },
      data: {
        status: ReviewTaskStatus.SKIPPED,
        comments: reason,
      },
    });
  }

  /**
   * 获取审核任务统计
   */
  async getTaskStats(reportId: string): Promise<ReviewTaskStats> {
    const tasks = await this.prisma.reviewTask.findMany({
      where: { reportId },
      select: {
        status: true,
        approved: true,
        score: true,
      },
    });

    const total = tasks.length;
    const pending = tasks.filter(
      (t) => t.status === ReviewTaskStatus.PENDING,
    ).length;
    const inProgress = tasks.filter(
      (t) => t.status === ReviewTaskStatus.IN_PROGRESS,
    ).length;
    const completed = tasks.filter(
      (t) => t.status === ReviewTaskStatus.COMPLETED,
    ).length;
    const approved = tasks.filter((t) => t.approved === true).length;
    const rejected = tasks.filter((t) => t.approved === false).length;

    const scores = tasks
      .filter((t) => t.score !== null)
      .map((t) => t.score as number);
    const averageScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;

    return {
      total,
      pending,
      inProgress,
      completed,
      approved,
      rejected,
      averageScore,
    };
  }

  /**
   * 获取用户的待审核任务
   */
  async getUserPendingTasks(userId: string, limit?: number) {
    return this.prisma.reviewTask.findMany({
      where: {
        assigneeId: userId,
        status: {
          in: [ReviewTaskStatus.PENDING, ReviewTaskStatus.IN_PROGRESS],
        },
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: limit || 20,
      include: {
        report: {
          select: {
            id: true,
            version: true,
            topic: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });
  }

  /**
   * 检查报告是否可以发布
   * 所有任务都已完成且通过审核
   */
  async canPublishReport(reportId: string): Promise<{
    canPublish: boolean;
    reason?: string;
    pendingTasks: number;
    rejectedTasks: number;
  }> {
    const stats = await this.getTaskStats(reportId);

    if (stats.pending > 0 || stats.inProgress > 0) {
      return {
        canPublish: false,
        reason: `还有 ${stats.pending + stats.inProgress} 个章节待审核`,
        pendingTasks: stats.pending + stats.inProgress,
        rejectedTasks: stats.rejected,
      };
    }

    if (stats.rejected > 0) {
      return {
        canPublish: false,
        reason: `有 ${stats.rejected} 个章节未通过审核`,
        pendingTasks: 0,
        rejectedTasks: stats.rejected,
      };
    }

    return {
      canPublish: true,
      pendingTasks: 0,
      rejectedTasks: 0,
    };
  }

  /**
   * 重置审核流程
   * 将所有任务重置为待审核状态
   */
  async resetReviewProcess(reportId: string) {
    await this.prisma.reviewTask.updateMany({
      where: { reportId },
      data: {
        status: ReviewTaskStatus.PENDING,
        assigneeId: null,
        assigneeName: null,
        assignedAt: null,
        completedAt: null,
        approved: null,
        score: null,
        comments: null,
      },
    });

    return { reset: true };
  }
}
