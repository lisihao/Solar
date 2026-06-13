import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * WritingMissionCheckpointService - 断点续传服务 (P0-A05)
 *
 * 核心职责：
 * - 保存 Mission 执行进度
 * - 加载 Mission 检查点
 * - 支持断点恢复
 *
 * 实现策略：
 * - 使用 WritingMission.result JSON 字段存储检查点数据
 * - 检查点包含：已完成步骤、当前状态、上下文快照
 */

/**
 * Mission 检查点数据结构
 */
export interface MissionCheckpoint {
  missionId: string;
  projectId: string;
  completedSteps: string[]; // 已完成的步骤列表
  completedChapters: string[]; // 已完成的章节ID列表
  currentStep: string; // 当前步骤
  currentChapterId?: string; // 当前正在处理的章节ID
  context: Record<string, unknown>; // 上下文快照
  savedAt: Date; // 保存时间
}

/**
 * 可恢复信息
 */
export interface ResumableInfo {
  canResume: boolean;
  missionId: string;
  projectId: string;
  completedCount: number; // 已完成数量
  totalCount: number; // 总数量
  progress: number; // 进度百分比 (0-100)
  lastSavedAt: Date | null;
  currentStep: string | null;
  currentChapterId: string | null;
}

@Injectable()
export class WritingMissionCheckpointService {
  private readonly logger = new Logger(WritingMissionCheckpointService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 保存检查点
   *
   * @param missionId - Mission ID
   * @param checkpoint - 检查点数据（部分更新）
   */
  async saveCheckpoint(
    missionId: string,
    checkpoint: Partial<Omit<MissionCheckpoint, "missionId" | "savedAt">>,
  ): Promise<void> {
    try {
      // 1. 获取现有 Mission
      const mission = await this.prisma.writingMission.findUnique({
        where: { id: missionId },
        select: { id: true, projectId: true, result: true },
      });

      if (!mission) {
        throw new Error(`Mission not found: ${missionId}`);
      }

      // 2. 合并现有检查点数据
      const existingCheckpoint = this.extractCheckpoint(mission.result);
      const newCheckpoint: MissionCheckpoint = {
        missionId: mission.id,
        projectId: mission.projectId,
        completedSteps:
          checkpoint.completedSteps ?? existingCheckpoint?.completedSteps ?? [],
        completedChapters:
          checkpoint.completedChapters ??
          existingCheckpoint?.completedChapters ??
          [],
        currentStep:
          checkpoint.currentStep ?? existingCheckpoint?.currentStep ?? "",
        currentChapterId:
          checkpoint.currentChapterId ?? existingCheckpoint?.currentChapterId,
        context: {
          ...(existingCheckpoint?.context ?? {}),
          ...(checkpoint.context ?? {}),
        },
        savedAt: new Date(),
      };

      // 3. 保存到 result 字段（转换为 JSON 兼容对象）
      const resultData = {
        ...(typeof mission.result === "object" && mission.result !== null
          ? (mission.result as Record<string, unknown>)
          : {}),
        checkpoint: {
          missionId: newCheckpoint.missionId,
          projectId: newCheckpoint.projectId,
          completedSteps: newCheckpoint.completedSteps,
          completedChapters: newCheckpoint.completedChapters,
          currentStep: newCheckpoint.currentStep,
          currentChapterId: newCheckpoint.currentChapterId,
          context: newCheckpoint.context,
          savedAt: newCheckpoint.savedAt.toISOString(), // 转换 Date 为 ISO string
        },
      };

      await this.prisma.writingMission.update({
        where: { id: missionId },
        data: {
          result: resultData as unknown as Prisma.InputJsonValue, // Prisma Json 类型
        },
      });

      this.logger.log(
        `Checkpoint saved for mission ${missionId}: step=${newCheckpoint.currentStep}, completed=${newCheckpoint.completedSteps.length}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to save checkpoint for mission ${missionId}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      // Don't rethrow - checkpoint save failure should not stop the mission
    }
  }

  /**
   * 加载检查点
   *
   * @param missionId - Mission ID
   * @returns 检查点数据，如果不存在返回 null
   */
  async loadCheckpoint(missionId: string): Promise<MissionCheckpoint | null> {
    try {
      const mission = await this.prisma.writingMission.findUnique({
        where: { id: missionId },
        select: { result: true },
      });

      if (!mission) {
        this.logger.warn(
          `Mission not found when loading checkpoint: ${missionId}`,
        );
        return null;
      }

      const checkpoint = this.extractCheckpoint(mission.result);

      if (checkpoint) {
        this.logger.log(
          `Checkpoint loaded for mission ${missionId}: step=${checkpoint.currentStep}`,
        );
      } else {
        this.logger.log(`No checkpoint found for mission ${missionId}`);
      }

      return checkpoint;
    } catch (error) {
      this.logger.error(
        `Failed to load checkpoint for mission ${missionId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * 删除检查点
   *
   * @param missionId - Mission ID
   */
  async deleteCheckpoint(missionId: string): Promise<void> {
    try {
      const mission = await this.prisma.writingMission.findUnique({
        where: { id: missionId },
        select: { result: true },
      });

      if (!mission) {
        this.logger.warn(
          `Mission not found when deleting checkpoint: ${missionId}`,
        );
        return;
      }

      // 移除 checkpoint 字段，保留 result 中的其他数据
      const result =
        typeof mission.result === "object" && mission.result !== null
          ? { ...mission.result }
          : {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deleting dynamic JSON property from Prisma result
      delete (result as any).checkpoint;

      await this.prisma.writingMission.update({
        where: { id: missionId },
        data: { result },
      });

      this.logger.log(`Checkpoint deleted for mission ${missionId}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete checkpoint for mission ${missionId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * 检查 Mission 是否可以恢复
   *
   * @param missionId - Mission ID
   * @returns 是否可以恢复
   */
  async canResume(missionId: string): Promise<boolean> {
    const checkpoint = await this.loadCheckpoint(missionId);

    if (!checkpoint) {
      return false;
    }

    // 检查点有效条件：
    // 1. 有已完成的步骤或章节
    // 2. 有当前步骤
    const hasProgress =
      checkpoint.completedSteps.length > 0 ||
      checkpoint.completedChapters.length > 0;

    const hasCurrentStep = Boolean(
      checkpoint.currentStep && checkpoint.currentStep.trim().length > 0,
    );

    return hasProgress && hasCurrentStep;
  }

  /**
   * 获取可恢复的信息
   *
   * @param missionId - Mission ID
   * @returns 可恢复信息
   */
  async getResumableInfo(missionId: string): Promise<ResumableInfo> {
    const checkpoint = await this.loadCheckpoint(missionId);

    if (!checkpoint) {
      return {
        canResume: false,
        missionId,
        projectId: "",
        completedCount: 0,
        totalCount: 0,
        progress: 0,
        lastSavedAt: null,
        currentStep: null,
        currentChapterId: null,
      };
    }

    // 尝试从上下文中获取总数（如果存在）
    const totalCount =
      typeof checkpoint.context.totalCount === "number"
        ? checkpoint.context.totalCount
        : 0;

    // 计算已完成数量（步骤或章节，取较大值）
    const completedCount = Math.max(
      checkpoint.completedSteps.length,
      checkpoint.completedChapters.length,
    );

    // 计算进度百分比
    const progress =
      totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    // 判断是否可以恢复
    const canResume = await this.canResume(missionId);

    return {
      canResume,
      missionId: checkpoint.missionId,
      projectId: checkpoint.projectId,
      completedCount,
      totalCount,
      progress,
      lastSavedAt: checkpoint.savedAt,
      currentStep: checkpoint.currentStep,
      currentChapterId: checkpoint.currentChapterId ?? null,
    };
  }

  /**
   * 从 result JSON 中提取检查点
   *
   * @param result - Mission result JSON
   * @returns 检查点数据或 null
   */
  private extractCheckpoint(result: unknown): MissionCheckpoint | null {
    try {
      if (typeof result !== "object" || result === null) {
        return null;
      }

      const resultObj = result as Record<string, unknown>;

      if (!resultObj.checkpoint || typeof resultObj.checkpoint !== "object") {
        return null;
      }

      const checkpoint = resultObj.checkpoint as Record<string, unknown>;

      // 验证必需字段
      if (
        typeof checkpoint.missionId !== "string" ||
        typeof checkpoint.projectId !== "string" ||
        !Array.isArray(checkpoint.completedSteps) ||
        !Array.isArray(checkpoint.completedChapters) ||
        typeof checkpoint.currentStep !== "string"
      ) {
        this.logger.warn("Invalid checkpoint format, missing required fields");
        return null;
      }

      return {
        missionId: checkpoint.missionId,
        projectId: checkpoint.projectId,
        completedSteps: checkpoint.completedSteps,
        completedChapters: checkpoint.completedChapters,
        currentStep: checkpoint.currentStep,
        currentChapterId:
          typeof checkpoint.currentChapterId === "string"
            ? checkpoint.currentChapterId
            : undefined,
        context:
          typeof checkpoint.context === "object" && checkpoint.context !== null
            ? (checkpoint.context as Record<string, unknown>)
            : {},
        savedAt:
          checkpoint.savedAt instanceof Date
            ? checkpoint.savedAt
            : typeof checkpoint.savedAt === "string"
              ? new Date(checkpoint.savedAt)
              : new Date(),
      };
    } catch (error) {
      this.logger.warn(
        `Corrupted checkpoint data, returning null: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return null;
    }
  }

  /**
   * 清理过期检查点
   *
   * @param olderThanDays - 保留最近多少天的检查点（默认 30 天）
   * @returns 清理的检查点数量
   */
  async cleanupExpiredCheckpoints(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      // 查找所有已完成、失败或取消的 Missions（这些可能有检查点）
      const missions = await this.prisma.writingMission.findMany({
        where: {
          status: {
            in: ["COMPLETED", "FAILED", "CANCELLED"],
          },
        },
        select: {
          id: true,
          result: true,
          status: true,
        },
      });

      let cleanedCount = 0;

      for (const mission of missions) {
        const checkpoint = this.extractCheckpoint(mission.result);

        if (checkpoint && checkpoint.savedAt < cutoffDate) {
          // 只清理已完成或失败的 Mission 的检查点
          if (
            mission.status === "COMPLETED" ||
            mission.status === "FAILED" ||
            mission.status === "CANCELLED"
          ) {
            await this.deleteCheckpoint(mission.id);
            cleanedCount++;
          }
        }
      }

      this.logger.log(
        `Cleaned up ${cleanedCount} expired checkpoints (older than ${olderThanDays} days)`,
      );
      return cleanedCount;
    } catch (error) {
      this.logger.error("Failed to cleanup expired checkpoints:", error);
      throw error;
    }
  }

  /**
   * 批量保存检查点
   *
   * @param checkpoints - 检查点数组
   */
  async batchSaveCheckpoints(
    checkpoints: Array<{
      missionId: string;
      data: Partial<Omit<MissionCheckpoint, "missionId" | "savedAt">>;
    }>,
  ): Promise<void> {
    try {
      await Promise.all(
        checkpoints.map((item) =>
          this.saveCheckpoint(item.missionId, item.data),
        ),
      );

      this.logger.log(`Batch saved ${checkpoints.length} checkpoints`);
    } catch (error) {
      this.logger.error("Failed to batch save checkpoints:", error);
      throw error;
    }
  }
}
