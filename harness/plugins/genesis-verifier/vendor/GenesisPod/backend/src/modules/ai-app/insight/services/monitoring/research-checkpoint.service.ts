/**
 * Research Checkpoint Service
 *
 * 断点续传服务 - 保存和恢复研究任务的执行状态
 * 参考 AI Writing 模块的 WritingMissionCheckpointService 实现
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  ResearchMissionStatus,
  ResearchTaskStatus,
  ResearchTodoStatus,
  Prisma,
} from "@prisma/client";
import type {
  ResearchCheckpoint,
  ResumableMissionInfo,
} from "../../types/monitoring.types";

// ==================== Service ====================

@Injectable()
export class ResearchCheckpointService {
  private readonly logger = new Logger(ResearchCheckpointService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Save a checkpoint for a mission
   * Checkpoints are stored as mission metadata in the database
   */
  async saveCheckpoint(
    missionId: string,
    context?: Record<string, unknown>,
  ): Promise<ResearchCheckpoint> {
    this.logger.debug(`Saving checkpoint for mission ${missionId}`);

    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      include: {
        tasks: true,
      },
    });

    if (!mission) {
      throw new NotFoundException(`Mission ${missionId} not found`);
    }

    // Build checkpoint data
    const completedTasks = mission.tasks
      .filter((t) => t.status === ResearchTaskStatus.COMPLETED)
      .map((t) => t.id);

    const completedDimensions = mission.tasks
      .filter(
        (t) =>
          t.status === ResearchTaskStatus.COMPLETED &&
          t.taskType === "dimension_research" &&
          t.dimensionId,
      )
      .map((t) => t.dimensionId!)
      .filter((id, idx, arr) => arr.indexOf(id) === idx); // unique

    const executingTask = mission.tasks.find(
      (t) => t.status === ResearchTaskStatus.EXECUTING,
    );

    const checkpoint: ResearchCheckpoint = {
      missionId: mission.id,
      topicId: mission.topicId,
      completedTasks,
      completedDimensions,
      currentTask: executingTask?.id || null,
      currentDimensionId: executingTask?.dimensionId || null,
      context: context || {},
      savedAt: new Date(),
    };

    // Store checkpoint in mission's userContext field
    const existingContext =
      (mission.userContext as Record<string, unknown>) || {};
    const newContext = {
      ...existingContext,
      checkpoint: {
        ...checkpoint,
        savedAt: checkpoint.savedAt.toISOString(),
      },
    };
    await this.prisma.researchMission.update({
      where: { id: missionId },
      data: {
        userContext: newContext as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `Checkpoint saved for mission ${missionId}: ${completedTasks.length} tasks completed`,
    );

    return checkpoint;
  }

  /**
   * Load a checkpoint for a mission
   */
  async loadCheckpoint(missionId: string): Promise<ResearchCheckpoint | null> {
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      select: {
        id: true,
        topicId: true,
        userContext: true,
      },
    });

    if (!mission) {
      return null;
    }

    const userContext = mission.userContext as Record<string, unknown> | null;
    const checkpoint = userContext?.checkpoint as
      | ResearchCheckpoint
      | undefined;

    if (!checkpoint) {
      return null;
    }

    return checkpoint;
  }

  /**
   * Check if a mission can be resumed
   */
  async canResume(missionId: string): Promise<{
    canResume: boolean;
    reason: string;
  }> {
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      include: {
        tasks: true,
      },
    });

    if (!mission) {
      return { canResume: false, reason: "任务不存在" };
    }

    // Can only resume failed or cancelled missions
    if (
      mission.status !== ResearchMissionStatus.FAILED &&
      mission.status !== ResearchMissionStatus.CANCELLED
    ) {
      return {
        canResume: false,
        reason: `当前状态 ${mission.status} 不支持恢复`,
      };
    }

    // Check if there are completed tasks (partial progress)
    const completedTasks = mission.tasks.filter(
      (t) => t.status === ResearchTaskStatus.COMPLETED,
    );

    if (completedTasks.length === 0) {
      return {
        canResume: false,
        reason: "没有已完成的任务，建议重新开始",
      };
    }

    // Check if there are pending tasks to resume
    const pendingTasks = mission.tasks.filter(
      (t) =>
        t.status === ResearchTaskStatus.PENDING ||
        t.status === ResearchTaskStatus.FAILED,
    );

    if (pendingTasks.length === 0) {
      return {
        canResume: false,
        reason: "所有任务已完成",
      };
    }

    return {
      canResume: true,
      reason: `可恢复：${completedTasks.length} 个任务已完成，${pendingTasks.length} 个任务待执行`,
    };
  }

  /**
   * Get resumable info for a mission
   */
  async getResumableInfo(
    missionId: string,
  ): Promise<ResumableMissionInfo | null> {
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      include: {
        topic: {
          select: { name: true },
        },
        tasks: {
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!mission) {
      return null;
    }

    const { canResume, reason } = await this.canResume(missionId);

    const completedTasks = await this.prisma.researchTask.count({
      where: {
        missionId,
        status: ResearchTaskStatus.COMPLETED,
      },
    });

    return {
      missionId: mission.id,
      topicId: mission.topicId,
      topicName: mission.topic.name,
      status: mission.status,
      progress: mission.progressPercent,
      completedTasks,
      totalTasks: mission.totalTasks,
      lastActivityAt: mission.tasks[0]?.updatedAt || mission.updatedAt,
      canResume,
      resumeReason: reason,
    };
  }

  /**
   * Get all resumable missions for a user
   */
  async getResumableMissions(userId: string): Promise<ResumableMissionInfo[]> {
    const missions = await this.prisma.researchMission.findMany({
      where: {
        topic: {
          userId,
        },
        status: {
          in: [ResearchMissionStatus.FAILED, ResearchMissionStatus.CANCELLED],
        },
      },
      include: {
        topic: {
          select: { name: true },
        },
        tasks: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });

    const results: ResumableMissionInfo[] = [];

    for (const mission of missions) {
      const completedTasks = mission.tasks.filter(
        (t) => t.status === ResearchTaskStatus.COMPLETED,
      );

      // Only include missions with partial progress
      if (completedTasks.length === 0) continue;

      const { canResume, reason } = await this.canResume(mission.id);

      results.push({
        missionId: mission.id,
        topicId: mission.topicId,
        topicName: mission.topic.name,
        status: mission.status,
        progress: mission.progressPercent,
        completedTasks: completedTasks.length,
        totalTasks: mission.totalTasks,
        lastActivityAt: mission.updatedAt,
        canResume,
        resumeReason: reason,
      });
    }

    return results;
  }

  /**
   * Resume a failed/cancelled mission
   * Resets failed tasks to pending and restarts execution
   */
  async resumeMission(missionId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    const { canResume, reason } = await this.canResume(missionId);

    if (!canResume) {
      return { success: false, message: reason };
    }

    this.logger.log(`Resuming mission ${missionId}`);

    // Reset failed/cancelled tasks to pending
    await this.prisma.researchTask.updateMany({
      where: {
        missionId,
        status: {
          in: [ResearchTaskStatus.FAILED],
        },
      },
      data: {
        status: ResearchTaskStatus.PENDING,
        startedAt: null,
        completedAt: null,
        result: undefined,
        resultSummary: null,
      },
    });

    // Reset failed/cancelled todos to pending
    await this.prisma.researchTodo.updateMany({
      where: {
        missionId,
        status: {
          in: [ResearchTodoStatus.FAILED, ResearchTodoStatus.CANCELLED],
        },
      },
      data: {
        status: ResearchTodoStatus.PENDING,
        startedAt: null,
        completedAt: null,
        statusMessage: "任务已恢复",
        progress: 0,
      },
    });

    // Update mission status back to executing
    await this.prisma.researchMission.update({
      where: { id: missionId },
      data: {
        status: ResearchMissionStatus.EXECUTING,
        completedAt: null,
      },
    });

    this.logger.log(`Mission ${missionId} resumed successfully`);

    return {
      success: true,
      message: "任务已恢复，将继续执行未完成的任务",
    };
  }

  /**
   * Clear checkpoint data for a mission
   */
  async clearCheckpoint(missionId: string): Promise<void> {
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      select: { userContext: true },
    });

    if (!mission) return;

    const userContext = mission.userContext as Record<string, unknown> | null;
    if (userContext?.checkpoint) {
      delete userContext.checkpoint;
      await this.prisma.researchMission.update({
        where: { id: missionId },
        data: { userContext: userContext as Prisma.InputJsonValue },
      });
    }
  }
}
