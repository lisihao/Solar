/**
 * WritingMissionHealthCheckService - AI Writing 任务健康检查服务
 *
 * 职责:
 * - 定期检测卡住的写作任务
 * - 自动标记超时任务为 FAILED
 * - 清理僵尸任务（防止阻塞新任务）
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

/**
 * 健康检查配置
 */
const HEALTH_CHECK_CONFIG = {
  /** 检查间隔（5 分钟） */
  checkIntervalMs: 5 * 60 * 1000,
  /** 任务超时阈值（30 分钟无活动视为卡住） */
  stuckThresholdMs: 30 * 60 * 1000,
  /** 任务最大执行时间（2 小时强制结束） */
  maxExecutionTimeMs: 2 * 60 * 60 * 1000,
} as const;

/**
 * 卡住任务的统计信息
 */
interface StuckMissionInfo {
  missionId: string;
  projectId: string;
  missionType: string;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
  lastUpdateAt: Date;
  stuckDurationMs: number;
}

@Injectable()
export class WritingMissionHealthCheckService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WritingMissionHealthCheckService.name);
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ==================== 生命周期 ====================

  onModuleInit(): void {
    this.logger.log(
      `[WritingHealthCheck] Starting with interval=${HEALTH_CHECK_CONFIG.checkIntervalMs}ms, ` +
        `stuckThreshold=${HEALTH_CHECK_CONFIG.stuckThresholdMs}ms, ` +
        `maxExecutionTime=${HEALTH_CHECK_CONFIG.maxExecutionTimeMs}ms`,
    );
    this.startHealthCheckScheduler();
  }

  onModuleDestroy(): void {
    this.stopHealthCheckScheduler();
  }

  // ==================== 健康检查调度 ====================

  private startHealthCheckScheduler(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(() => {
      this.performHealthCheck().catch((err) => {
        this.logger.error(`[WritingHealthCheck] Health check failed: ${err}`);
      });
    }, HEALTH_CHECK_CONFIG.checkIntervalMs).unref();

    this.logger.log(
      `[WritingHealthCheck] Scheduler started (every ${HEALTH_CHECK_CONFIG.checkIntervalMs / 1000}s)`,
    );

    // 启动后立即执行一次检查
    setTimeout(() => {
      this.performHealthCheck().catch((err) => {
        this.logger.error(
          `[WritingHealthCheck] Initial health check failed: ${err}`,
        );
      });
    }, 15000); // 15 秒后执行首次检查
  }

  private stopHealthCheckScheduler(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      this.logger.log(`[WritingHealthCheck] Scheduler stopped`);
    }
  }

  // ==================== 健康检查逻辑 ====================

  /**
   * 执行健康检查
   */
  async performHealthCheck(): Promise<void> {
    const startTime = Date.now();
    this.logger.debug(`[WritingHealthCheck] Starting health check...`);

    try {
      // 查找卡住的 Mission
      const stuckMissions = await this.findStuckMissions();

      if (stuckMissions.length === 0) {
        this.logger.debug(
          `[WritingHealthCheck] No stuck missions found (took ${Date.now() - startTime}ms)`,
        );
        return;
      }

      this.logger.warn(
        `[WritingHealthCheck] Found ${stuckMissions.length} stuck mission(s)`,
      );

      // 标记卡住的任务为 FAILED
      for (const info of stuckMissions) {
        await this.markMissionAsFailed(info);
      }

      this.logger.log(
        `[WritingHealthCheck] Health check completed, marked ${stuckMissions.length} missions as failed (took ${Date.now() - startTime}ms)`,
      );
    } catch (error) {
      this.logger.error(
        `[WritingHealthCheck] Error during health check: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * 查找卡住的 Mission
   *
   * 条件:
   * - Mission 状态为 IN_PROGRESS
   * - 创建时间或启动时间超过阈值
   */
  private async findStuckMissions(): Promise<StuckMissionInfo[]> {
    const now = new Date();
    const stuckThreshold = new Date(
      now.getTime() - HEALTH_CHECK_CONFIG.stuckThresholdMs,
    );
    const maxExecutionThreshold = new Date(
      now.getTime() - HEALTH_CHECK_CONFIG.maxExecutionTimeMs,
    );

    // 查询 IN_PROGRESS 状态的 Mission
    const missions = await this.prisma.writingMission.findMany({
      where: {
        status: "IN_PROGRESS",
      },
      select: {
        id: true,
        projectId: true,
        missionType: true,
        status: true,
        createdAt: true,
        startedAt: true,
        updatedAt: true, // ★ 使用 updatedAt 检测最后活动时间
      },
    });

    const stuckMissions: StuckMissionInfo[] = [];

    for (const mission of missions) {
      // ★ 优先使用 updatedAt（任务每次更新都会刷新），其次是 startedAt
      const lastUpdateAt =
        mission.updatedAt || mission.startedAt || mission.createdAt;

      // 检查是否超过最大执行时间
      const isOverMaxTime = mission.createdAt < maxExecutionThreshold;

      // 检查是否卡住（超过阈值无活动）
      const isStuck = lastUpdateAt < stuckThreshold;

      if (isOverMaxTime || isStuck) {
        const stuckDurationMs = now.getTime() - lastUpdateAt.getTime();

        stuckMissions.push({
          missionId: mission.id,
          projectId: mission.projectId,
          missionType: mission.missionType,
          status: mission.status,
          createdAt: mission.createdAt,
          startedAt: mission.startedAt,
          lastUpdateAt,
          stuckDurationMs,
        });
      }
    }

    return stuckMissions;
  }

  /**
   * 标记任务为失败
   */
  private async markMissionAsFailed(info: StuckMissionInfo): Promise<void> {
    const { missionId, projectId, missionType, stuckDurationMs } = info;
    const stuckMinutes = Math.round(stuckDurationMs / 60000);

    this.logger.warn(
      `[WritingHealthCheck] Marking mission ${missionId} as FAILED: ` +
        `project=${projectId}, type=${missionType}, stuck for ${stuckMinutes} minutes`,
    );

    try {
      await this.prisma.writingMission.update({
        where: { id: missionId },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          result: {
            success: false,
            error: `任务超时（无响应超过 ${stuckMinutes} 分钟），已被系统自动终止。请重新开始任务。`,
            autoTerminated: true,
            stuckDurationMs,
          },
        },
      });

      // 更新项目状态
      const project = await this.prisma.writingProject.findUnique({
        where: { id: projectId },
        select: { currentWords: true },
      });

      if (project) {
        const newStatus = project.currentWords > 0 ? "REVISING" : "PLANNING";
        await this.prisma.writingProject.update({
          where: { id: projectId },
          data: { status: newStatus },
        });
        this.logger.log(
          `[WritingHealthCheck] Updated project ${projectId} status to ${newStatus}`,
        );
      }

      this.logger.log(
        `[WritingHealthCheck] Mission ${missionId} marked as FAILED successfully`,
      );
    } catch (error) {
      this.logger.error(
        `[WritingHealthCheck] Failed to mark mission ${missionId} as FAILED: ${error}`,
      );
    }
  }

  // ==================== 手动操作 ====================

  /**
   * 手动触发健康检查（用于调试）
   */
  async manualHealthCheck(): Promise<StuckMissionInfo[]> {
    const stuckMissions = await this.findStuckMissions();
    this.logger.log(
      `[WritingHealthCheck] Manual check found ${stuckMissions.length} stuck mission(s)`,
    );
    return stuckMissions;
  }

  /**
   * 获取当前健康状态
   */
  getHealthStatus(): {
    isRunning: boolean;
    checkIntervalMs: number;
    stuckThresholdMs: number;
    maxExecutionTimeMs: number;
  } {
    return {
      isRunning: this.checkInterval !== null,
      checkIntervalMs: HEALTH_CHECK_CONFIG.checkIntervalMs,
      stuckThresholdMs: HEALTH_CHECK_CONFIG.stuckThresholdMs,
      maxExecutionTimeMs: HEALTH_CHECK_CONFIG.maxExecutionTimeMs,
    };
  }
}
