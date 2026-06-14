/**
 * MissionHealthCheckService - 任务健康检查服务
 *
 * 职责:
 * - 定期检测卡住的任务（有待执行任务但无任务在运行）
 * - 自动触发恢复机制
 * - 记录健康状态日志
 *
 * 检测场景:
 * 1. Mission 状态为 IN_PROGRESS
 * 2. 有 PENDING 或 REVISION_NEEDED 状态的任务
 * 3. 没有 IN_PROGRESS 状态的任务（无任务正在执行）
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { MissionStatus, AgentTaskStatus } from "@prisma/client";
import { TASK_TIMEOUT_CONFIG } from "../config";

/**
 * 健康检查配置
 */
const HEALTH_CHECK_CONFIG = {
  /** 检查间隔（5 分钟） */
  checkIntervalMs: 5 * 60 * 1000,
  /** 任务卡住阈值（5 分钟无活动） */
  stuckThresholdMs: TASK_TIMEOUT_CONFIG.taskStuckTimeoutMs,
  /** 最大自动恢复次数（防止无限重试） */
  maxAutoRecoveryAttempts: 3,
} as const;

/**
 * 卡住任务的统计信息
 */
interface StuckMissionInfo {
  missionId: string;
  title: string;
  pendingTasks: number;
  revisionNeededTasks: number;
  lastActivityAt: Date | null;
  recoveryAttempts: number;
}

@Injectable()
export class MissionHealthCheckService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MissionHealthCheckService.name);
  private checkInterval: NodeJS.Timeout | null = null;

  /** 记录每个 mission 的自动恢复尝试次数 */
  private recoveryAttempts = new Map<string, number>();

  /** 回调函数：触发继续执行（由 TeamMissionService 注入） */
  private executeNextTasksFn: ((missionId: string) => Promise<void>) | null =
    null;

  /** 回调函数：恢复卡住的修订任务（由 TeamMissionService 注入） */
  private recoverRevisionTasksFn:
    | ((missionId: string) => Promise<void>)
    | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ==================== 生命周期 ====================

  onModuleInit(): void {
    this.logger.log(
      `[MissionHealthCheck] Starting with interval=${HEALTH_CHECK_CONFIG.checkIntervalMs}ms, threshold=${HEALTH_CHECK_CONFIG.stuckThresholdMs}ms`,
    );
    this.startHealthCheckScheduler();
  }

  onModuleDestroy(): void {
    this.stopHealthCheckScheduler();
  }

  /**
   * 注册执行回调（由 TeamMissionService 调用）
   */
  registerExecuteCallback(
    callback: (missionId: string) => Promise<void>,
  ): void {
    this.executeNextTasksFn = callback;
    this.logger.log(`[MissionHealthCheck] Execute callback registered`);
  }

  /**
   * 注册修订恢复回调（由 TeamMissionService 调用）
   */
  registerRevisionCallback(
    callback: (missionId: string) => Promise<void>,
  ): void {
    this.recoverRevisionTasksFn = callback;
    this.logger.log(`[MissionHealthCheck] Revision callback registered`);
  }

  // ==================== 健康检查调度 ====================

  private startHealthCheckScheduler(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(() => {
      this.performHealthCheck().catch((err) => {
        this.logger.error(`[MissionHealthCheck] Health check failed: ${err}`);
      });
    }, HEALTH_CHECK_CONFIG.checkIntervalMs).unref();

    this.logger.log(
      `[MissionHealthCheck] Scheduler started (every ${HEALTH_CHECK_CONFIG.checkIntervalMs / 1000}s)`,
    );

    // 启动后立即执行一次检查
    setTimeout(() => {
      this.performHealthCheck().catch((err) => {
        this.logger.error(
          `[MissionHealthCheck] Initial health check failed: ${err}`,
        );
      });
    }, 10000).unref(); // 10 秒后执行首次检查，给服务初始化时间
  }

  private stopHealthCheckScheduler(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      this.logger.log(`[MissionHealthCheck] Scheduler stopped`);
    }
  }

  // ==================== 健康检查逻辑 ====================

  /**
   * 执行健康检查
   */
  async performHealthCheck(): Promise<void> {
    const startTime = Date.now();
    this.logger.debug(`[MissionHealthCheck] Starting health check...`);

    try {
      // 查找卡住的 Mission
      const stuckMissions = await this.findStuckMissions();

      if (stuckMissions.length === 0) {
        this.logger.debug(
          `[MissionHealthCheck] No stuck missions found (took ${Date.now() - startTime}ms)`,
        );
        return;
      }

      this.logger.warn(
        `[MissionHealthCheck] Found ${stuckMissions.length} stuck mission(s)`,
      );

      // 尝试恢复卡住的 Mission
      for (const info of stuckMissions) {
        await this.attemptRecovery(info);
      }

      this.logger.log(
        `[MissionHealthCheck] Health check completed (took ${Date.now() - startTime}ms)`,
      );
    } catch (error) {
      this.logger.error(
        `[MissionHealthCheck] Error during health check: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * 查找卡住的 Mission
   *
   * 条件:
   * - Mission 状态为 IN_PROGRESS
   * - 有 PENDING 或 REVISION_NEEDED 状态的任务
   * - 没有 IN_PROGRESS 状态的任务
   * - 最后活动时间超过阈值
   */
  private async findStuckMissions(): Promise<StuckMissionInfo[]> {
    const stuckThreshold = new Date(
      Date.now() - HEALTH_CHECK_CONFIG.stuckThresholdMs,
    );

    // 查询 IN_PROGRESS 状态的 Mission 及其任务
    const missions = await this.prisma.teamMission.findMany({
      where: {
        status: MissionStatus.IN_PROGRESS,
      },
      include: {
        tasks: {
          select: {
            id: true,
            status: true,
            updatedAt: true,
          },
        },
      },
    });

    const stuckMissions: StuckMissionInfo[] = [];

    for (const mission of missions) {
      const tasks = mission.tasks;

      // 统计各状态任务数
      const inProgressCount = tasks.filter(
        (t) => t.status === AgentTaskStatus.IN_PROGRESS,
      ).length;
      const pendingCount = tasks.filter(
        (t) => t.status === AgentTaskStatus.PENDING,
      ).length;
      const revisionNeededCount = tasks.filter(
        (t) => t.status === AgentTaskStatus.REVISION_NEEDED,
      ).length;

      // 检查是否卡住：有待执行任务但无任务在运行
      const hasWorkToDo = pendingCount > 0 || revisionNeededCount > 0;
      const noTasksRunning = inProgressCount === 0;

      if (hasWorkToDo && noTasksRunning) {
        // 计算最后活动时间（从任务的最后更新时间计算，mission 没有 updatedAt）
        const lastActivity =
          tasks.length > 0
            ? tasks.reduce((latest, t) => {
                return t.updatedAt > latest ? t.updatedAt : latest;
              }, tasks[0].updatedAt)
            : mission.createdAt;

        // 检查是否超过阈值
        if (lastActivity < stuckThreshold) {
          const recoveryAttempts = this.recoveryAttempts.get(mission.id) || 0;

          stuckMissions.push({
            missionId: mission.id,
            title: mission.title,
            pendingTasks: pendingCount,
            revisionNeededTasks: revisionNeededCount,
            lastActivityAt: lastActivity,
            recoveryAttempts,
          });
        }
      }
    }

    return stuckMissions;
  }

  /**
   * 尝试恢复卡住的 Mission
   */
  private async attemptRecovery(info: StuckMissionInfo): Promise<void> {
    const {
      missionId,
      title,
      pendingTasks,
      revisionNeededTasks,
      recoveryAttempts,
    } = info;

    // 检查是否超过最大恢复次数
    if (recoveryAttempts >= HEALTH_CHECK_CONFIG.maxAutoRecoveryAttempts) {
      this.logger.error(
        `[MissionHealthCheck] Mission "${title}" (${missionId}) exceeded max recovery attempts (${recoveryAttempts}). Manual intervention required.`,
      );
      return;
    }

    // 增加恢复计数
    this.recoveryAttempts.set(missionId, recoveryAttempts + 1);

    // ════════════════════════════════════════════════════════════════════════
    // ★ 2026-05-25 默认关闭自动 re-run。
    //   auto-recovery 会重新触发 Agent LLM 调用（BYOK 烧真金白银）。
    //   只有 ENABLE_TEAM_MISSION_AUTORECOVERY=true 时才执行；
    //   "发现 stuck" 本身的日志记录保留，方便运维排查。
    // ════════════════════════════════════════════════════════════════════════
    if (process.env.ENABLE_TEAM_MISSION_AUTORECOVERY !== "true") {
      this.logger.warn(
        `[MissionHealthCheck] Mission "${title}" (${missionId}) is stuck — auto-recovery DISABLED (default). ` +
          `Set ENABLE_TEAM_MISSION_AUTORECOVERY=true to opt in.`,
      );
      return;
    }

    this.logger.warn(
      `[MissionHealthCheck] Attempting recovery for mission "${title}" (${missionId}): ` +
        `pending=${pendingTasks}, revision_needed=${revisionNeededTasks}, attempt=${recoveryAttempts + 1}`,
    );

    // 优先处理需要修订的任务（因为它们已经有反馈，需要继续执行）
    if (revisionNeededTasks > 0 && this.recoverRevisionTasksFn) {
      try {
        await this.recoverRevisionTasksFn(missionId);
        this.logger.log(
          `[MissionHealthCheck] Revision recovery triggered for mission "${title}" (${missionId}): ${revisionNeededTasks} tasks`,
        );
      } catch (error) {
        this.logger.error(
          `[MissionHealthCheck] Revision recovery failed for mission "${title}" (${missionId}): ${error}`,
        );
      }
    }

    // 触发继续执行（处理 PENDING 任务）
    if (pendingTasks > 0 && this.executeNextTasksFn) {
      try {
        await this.executeNextTasksFn(missionId);
        this.logger.log(
          `[MissionHealthCheck] Recovery triggered for mission "${title}" (${missionId}): ${pendingTasks} tasks`,
        );
      } catch (error) {
        this.logger.error(
          `[MissionHealthCheck] Recovery failed for mission "${title}" (${missionId}): ${error}`,
        );
      }
    }

    // 如果两个回调都没有注册，记录警告
    if (!this.executeNextTasksFn && !this.recoverRevisionTasksFn) {
      this.logger.warn(
        `[MissionHealthCheck] Cannot recover mission "${title}" (${missionId}): no callbacks registered`,
      );
    }
  }

  /**
   * 重置 Mission 的恢复计数（任务成功完成时调用）
   */
  resetRecoveryAttempts(missionId: string): void {
    if (this.recoveryAttempts.has(missionId)) {
      this.recoveryAttempts.delete(missionId);
      this.logger.debug(
        `[MissionHealthCheck] Reset recovery attempts for mission ${missionId}`,
      );
    }
  }

  /**
   * 清理已完成 Mission 的恢复计数
   */
  cleanupCompletedMission(missionId: string): void {
    this.recoveryAttempts.delete(missionId);
  }

  // ==================== 状态查询 ====================

  /**
   * 获取当前健康状态
   */
  getHealthStatus(): {
    isRunning: boolean;
    checkIntervalMs: number;
    stuckThresholdMs: number;
    trackedMissions: number;
  } {
    return {
      isRunning: this.checkInterval !== null,
      checkIntervalMs: HEALTH_CHECK_CONFIG.checkIntervalMs,
      stuckThresholdMs: HEALTH_CHECK_CONFIG.stuckThresholdMs,
      trackedMissions: this.recoveryAttempts.size,
    };
  }

  /**
   * 手动触发健康检查（用于调试）
   */
  async manualHealthCheck(): Promise<StuckMissionInfo[]> {
    const stuckMissions = await this.findStuckMissions();
    this.logger.log(
      `[MissionHealthCheck] Manual check found ${stuckMissions.length} stuck mission(s)`,
    );
    return stuckMissions;
  }
}
