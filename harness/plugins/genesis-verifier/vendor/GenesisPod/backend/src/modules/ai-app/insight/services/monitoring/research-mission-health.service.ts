/**
 * Research Mission Health Service
 *
 * 健康检测服务 - 检测卡死的研究任务并进行恢复
 * ★ Phase 5: 增加服务重启后自动恢复功能
 *
 * 参考 AI Writing 模块的 WritingMissionHealthCheckService 实现
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "@/common/prisma/prisma.service";
import { mapWithConcurrencySettled } from "@/common/utils/concurrency.utils";
import { HealthCheckRunner } from "@/modules/ai-harness/facade";
import {
  ResearchMissionStatus,
  ResearchTaskStatus,
  ResearchTodoStatus,
} from "@prisma/client";
import {
  ResearchEventEmitterService,
  RESEARCH_INTERNAL_EVENTS,
} from "../core/research/research-event-emitter.service";
import type {
  HealthCheckResult,
  MissionHealthDetail,
  MissionHealthStatus,
  RecoveryResult,
} from "../../types/monitoring.types";
import { HEALTH_MONITORING } from "../../config/health-monitoring.config";

// ==================== Configuration ====================

/**
 * Health check configuration — sourced from centralized config
 */
const HEALTH_CHECK_CONFIG = {
  /** Check interval: 5 minutes (same as AI Writing) */
  checkIntervalMs: HEALTH_MONITORING.CHECK_INTERVAL_MS,

  /** Stuck threshold: 30 minutes without progress (same as AI Writing) */
  stuckThresholdMs: HEALTH_MONITORING.INTERRUPTED_THRESHOLD_MS,

  /** Maximum execution time: 6 hours (safety net for very long research tasks) */
  maxExecutionTimeMs: HEALTH_MONITORING.MAX_MISSION_DURATION_MS,

  /** Per-task stuck threshold: 20 minutes — force-fail individual tasks stuck longer */
  taskStuckThresholdMs: 20 * 60 * 1000,

  /** Max retries before giving up */
  maxRetries: HEALTH_MONITORING.MAX_CONSECUTIVE_FAILURES,
} as const;

/**
 * ★ Phase 5: 服务启动时的自动恢复配置
 */
const RECOVERY_CONFIG = {
  /** 服务启动后多久开始恢复（等待其他服务就绪） */
  recoveryDelayMs: 10 * 1000,

  /** 任务被认为是"中断"的阈值（LLM 任务可能运行 10-30 分钟，5 分钟太短会误判） */
  interruptedThresholdMs: HEALTH_MONITORING.INTERRUPTED_THRESHOLD_MS,

  /** 最大并发恢复任务数 */
  maxConcurrentRecovery: 3,
} as const;

// ==================== Types ====================

/**
 * ★ Phase 5: Mission with tasks type for recovery
 */
interface MissionWithTasks {
  id: string;
  topicId: string;
  status: ResearchMissionStatus;
  progressPercent: number;
  updatedAt: Date;
  createdAt: Date;
  startedAt: Date | null;
  userContext: unknown;
  tasks: Array<{
    id: string;
    status: ResearchTaskStatus;
    updatedAt: Date;
    startedAt: Date | null;
  }>;
  topic?: {
    id: string;
    name: string;
    userId: string;
  };
}

/**
 * Mission type for health check (with tasks array)
 */
interface MissionForHealthCheck {
  id: string;
  topicId: string;
  status: ResearchMissionStatus;
  progressPercent: number;
  updatedAt: Date;
  createdAt: Date;
  startedAt: Date | null;
  tasks: Array<{
    id: string;
    status: ResearchTaskStatus;
    updatedAt: Date;
    startedAt: Date | null;
  }>;
}

// ==================== Service ====================

@Injectable()
export class ResearchMissionHealthService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ResearchMissionHealthService.name);
  private readonly healthCheckRunner = new HealthCheckRunner({
    name: "ResearchMissionHealth",
    intervalMs: HEALTH_CHECK_CONFIG.checkIntervalMs,
    runImmediately: true,
  });
  private isRecovering = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly researchEventEmitter: ResearchEventEmitterService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Module initialization - start health check loop
   * ★ Phase 5: 增加服务启动后自动恢复中断任务
   */
  onModuleInit(): void {
    // 健康检查循环保留:它只把 stuck mission 标记为 FAILED(降低消耗),不跑 LLM。
    this.healthCheckRunner.start(() => this.runHealthCheck().then(() => {}));
    this.logger.log(
      `Health check service started with ${HEALTH_CHECK_CONFIG.checkIntervalMs / 1000}s interval`,
    );

    // ════════════════════════════════════════════════════════════════════════
    // ★ 2026-05-25 默认关闭「启动自动恢复」。
    //   recoverInterruptedMissions({isStartup:true}) 会把所有 EXECUTING 的研究
    //   mission 在重启后自动重新拉起、跑全量 LLM(BYOK 烧真金白银)——这正是「重启
    //   后烧钱依然停不下来」的根因。静默后台重跑必须显式 opt-in,绝不默认开。
    //   仅 boot 自动触发被关;显式/手动恢复(用户主动点)仍可用。
    // ════════════════════════════════════════════════════════════════════════
    if (process.env.ENABLE_RESEARCH_MISSION_AUTORECOVERY !== "true") {
      this.logger.warn(
        "[ResearchMissionHealth] startup auto-recovery DISABLED (default) — " +
          "interrupted EXECUTING missions will NOT be auto-resumed on boot. " +
          "Set ENABLE_RESEARCH_MISSION_AUTORECOVERY=true to opt in. " +
          "（健康检查仍会把 stuck mission 标记为 FAILED）",
      );
      return;
    }

    // opt-in：延迟启动自动恢复（等待其他服务就绪）
    setTimeout(() => {
      void this.recoverInterruptedMissions({ isStartup: true }).catch((err) => {
        this.logger.error(`Auto-recovery failed: ${err.message}`);
      });
    }, RECOVERY_CONFIG.recoveryDelayMs).unref();

    this.logger.log(
      `Auto-recovery scheduled in ${RECOVERY_CONFIG.recoveryDelayMs / 1000}s (opt-in ENABLED)`,
    );
  }

  /**
   * Module destruction - stop health check loop
   * ★ Phase 5: 增加优雅关机时保存检查点
   */
  async onModuleDestroy(): Promise<void> {
    this.healthCheckRunner.stop();

    // ★ Phase 5: 保存执行中任务的检查点
    await this.saveCheckpointsBeforeShutdown();

    this.logger.log("Health check service stopped, checkpoints saved");
  }

  /**
   * Run a health check on all active missions
   */
  async runHealthCheck(): Promise<HealthCheckResult> {
    this.logger.log("Starting health check...");

    {
      const result: HealthCheckResult = {
        checkedAt: new Date(),
        totalMissions: 0,
        stuckMissions: 0,
        recoveredMissions: 0,
        failedMissions: 0,
        details: [],
      };

      // Find all active missions (PLANNING, EXECUTING, REVIEWING)
      // ★ 同时获取更多信息用于智能判断
      const activeMissions = await this.prisma.researchMission.findMany({
        where: {
          status: {
            in: [
              ResearchMissionStatus.PLANNING,
              ResearchMissionStatus.EXECUTING,
              ResearchMissionStatus.REVIEWING,
            ],
          },
        },
        take: 100,
        include: {
          tasks: {
            where: {
              status: {
                in: [ResearchTaskStatus.EXECUTING, ResearchTaskStatus.PENDING],
              },
            },
            orderBy: { updatedAt: "desc" },
          },
        },
      });

      result.totalMissions = activeMissions.length;

      if (activeMissions.length === 0) {
        this.logger.log("Health check: No active missions found");
        return result;
      }

      const now = new Date();

      for (const mission of activeMissions) {
        const detail = await this.checkMissionHealth(mission, now);
        result.details.push(detail);

        if (detail.action === "marked_failed") {
          result.stuckMissions++;
          result.failedMissions++;
        } else if (detail.action === "recovery_attempted") {
          result.stuckMissions++;
          result.recoveredMissions++;
        }
      }

      if (result.stuckMissions > 0) {
        this.logger.warn(
          `Health check completed: ${result.stuckMissions} stuck missions found, ` +
            `${result.recoveredMissions} recovered, ${result.failedMissions} marked as failed`,
        );
      } else {
        this.logger.log(
          `Health check completed: ${result.totalMissions} active missions, all healthy`,
        );
      }

      return result;
    }
  }

  /**
   * Check health of a single mission
   *
   * ★ 智能检测逻辑：
   * 1. 超过最大执行时间（2小时）→ 标记失败
   * 2. 超过卡死阈值（30分钟）但有正在执行的任务 → 只警告，不标记失败
   * 3. 超过卡死阈值且没有正在执行的任务 → 标记失败
   */
  private async checkMissionHealth(
    mission: MissionForHealthCheck,
    now: Date,
  ): Promise<MissionHealthDetail> {
    const detail: MissionHealthDetail = {
      missionId: mission.id,
      topicId: mission.topicId,
      status: mission.status,
      startedAt: mission.startedAt,
      lastActivityAt: this.getLastActivityTime(mission),
      stuckDurationMs: 0,
      action: "none",
    };

    // Calculate stuck duration
    const lastActivity = detail.lastActivityAt || mission.createdAt;
    detail.stuckDurationMs = now.getTime() - new Date(lastActivity).getTime();

    // Check if mission has exceeded max execution time (2 hours)
    const executionTime = mission.startedAt
      ? now.getTime() - new Date(mission.startedAt).getTime()
      : detail.stuckDurationMs;

    if (executionTime > HEALTH_CHECK_CONFIG.maxExecutionTimeMs) {
      await this.markMissionFailed(
        mission,
        `研究任务执行超时（超过 ${Math.round(HEALTH_CHECK_CONFIG.maxExecutionTimeMs / 1000 / 60)} 分钟）`,
      );
      detail.action = "marked_failed";
      detail.reason = "Execution timeout exceeded";
      return detail;
    }

    // ★ 智能卡死检测：检查是否有正在执行的任务
    if (detail.stuckDurationMs > HEALTH_CHECK_CONFIG.stuckThresholdMs) {
      // 检查是否有 EXECUTING 状态的任务
      const hasExecutingTasks = mission.tasks?.some(
        (task) => task.status === ResearchTaskStatus.EXECUTING,
      );

      if (hasExecutingTasks) {
        // ★ 检查个别任务是否卡死（超过 taskStuckThresholdMs）
        const stuckTasks = (mission.tasks || []).filter((task) => {
          if (task.status !== ResearchTaskStatus.EXECUTING) return false;
          const taskStart = task.startedAt || task.updatedAt;
          const taskDuration = now.getTime() - new Date(taskStart).getTime();
          return taskDuration > HEALTH_CHECK_CONFIG.taskStuckThresholdMs;
        });

        if (stuckTasks.length > 0) {
          // 强制失败卡死的个别任务，但不影响整个 mission
          for (const stuckTask of stuckTasks) {
            const taskDurationMin = Math.round(
              (now.getTime() -
                new Date(
                  stuckTask.startedAt || stuckTask.updatedAt,
                ).getTime()) /
                1000 /
                60,
            );
            this.logger.warn(
              `Force-failing stuck task ${stuckTask.id} in mission ${mission.id} (stuck ${taskDurationMin} min)`,
            );
            await this.prisma.researchTask.update({
              where: { id: stuckTask.id },
              data: {
                status: ResearchTaskStatus.FAILED,
                resultSummary: `任务执行超时（${taskDurationMin} 分钟无响应），已被健康检测服务强制终止`,
                completedAt: now,
              },
            });
          }
          detail.reason = `Force-failed ${stuckTasks.length} stuck task(s), mission continues`;
        } else {
          // 有任务正在执行且未超时，只记录警告
          this.logger.warn(
            `Mission ${mission.id} has been inactive for ${Math.round(detail.stuckDurationMs / 1000 / 60)} minutes, ` +
              `but has executing tasks - not marking as failed`,
          );
          detail.reason = "Has executing tasks - monitoring only";
        }
        // 不标记整个 mission 失败，让其继续执行
      } else {
        // 没有正在执行的任务，真的卡住了
        await this.markMissionFailed(
          mission,
          `研究任务卡死（${Math.round(detail.stuckDurationMs / 1000 / 60)} 分钟无进展且无执行中任务）`,
        );
        detail.action = "marked_failed";
        detail.reason = "No progress and no executing tasks";
      }
      return detail;
    }

    return detail;
  }

  /**
   * Get the last activity time from mission or tasks
   */
  private getLastActivityTime(mission: {
    updatedAt: Date;
    tasks?: Array<{ updatedAt: Date }>;
  }): Date | null {
    const times: Date[] = [];

    if (mission.updatedAt) times.push(new Date(mission.updatedAt));

    if (mission.tasks && mission.tasks.length > 0) {
      const sorted = [...mission.tasks].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      times.push(new Date(sorted[0].updatedAt));
    }

    if (times.length === 0) return null;

    return new Date(Math.max(...times.map((t) => t.getTime())));
  }

  /**
   * Mark a mission as failed
   */
  private async markMissionFailed(
    mission: { id: string; topicId: string },
    reason: string,
  ): Promise<void> {
    this.logger.warn(`Marking mission ${mission.id} as failed: ${reason}`);

    // Update mission status
    await this.prisma.researchMission.update({
      where: { id: mission.id },
      data: {
        status: ResearchMissionStatus.FAILED,
        completedAt: new Date(),
      },
    });

    // Update all non-completed tasks to failed
    await this.prisma.researchTask.updateMany({
      where: {
        missionId: mission.id,
        status: {
          notIn: [ResearchTaskStatus.COMPLETED, ResearchTaskStatus.FAILED],
        },
      },
      data: {
        status: ResearchTaskStatus.FAILED,
        resultSummary: reason,
        completedAt: new Date(),
      },
    });

    // Update all non-completed todos to failed
    await this.prisma.researchTodo.updateMany({
      where: {
        missionId: mission.id,
        status: {
          notIn: [
            ResearchTodoStatus.COMPLETED,
            ResearchTodoStatus.CANCELLED,
            ResearchTodoStatus.FAILED,
          ],
        },
      },
      data: {
        status: ResearchTodoStatus.FAILED,
        statusMessage: reason,
        completedAt: new Date(),
      },
    });

    // Emit failure event
    await this.researchEventEmitter.emitMissionFailed(
      mission.topicId,
      mission.id,
      reason,
    );
  }

  /**
   * Get health status for a specific mission
   * ★ Phase 5: 返回 null 而不是抛错，方便调用方处理
   */
  async getMissionHealthStatus(
    missionId: string,
  ): Promise<MissionHealthStatus | null> {
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      include: {
        tasks: {
          select: { status: true, startedAt: true, updatedAt: true },
        },
      },
    });

    if (!mission) {
      return null;
    }

    const now = new Date();
    const lastActivity = this.getLastActivityTime(mission) || mission.createdAt;
    const stuckDurationMs = now.getTime() - new Date(lastActivity).getTime();

    const issues: string[] = [];

    // Check various health conditions
    const isStuck = stuckDurationMs > HEALTH_CHECK_CONFIG.stuckThresholdMs;
    if (isStuck) {
      issues.push(
        `任务卡死 ${Math.round(stuckDurationMs / 1000 / 60)} 分钟无进展`,
      );
    }

    const executionTime = mission.startedAt
      ? now.getTime() - new Date(mission.startedAt).getTime()
      : stuckDurationMs;

    if (executionTime > HEALTH_CHECK_CONFIG.maxExecutionTimeMs) {
      issues.push(
        `执行时间超过 ${Math.round(HEALTH_CHECK_CONFIG.maxExecutionTimeMs / 1000 / 60)} 分钟`,
      );
    }

    // Check if any tasks are stuck
    const stuckTasks = mission.tasks.filter((task) => {
      if (task.status !== ResearchTaskStatus.EXECUTING) return false;
      if (!task.startedAt) return false;
      const taskDuration = now.getTime() - new Date(task.startedAt).getTime();
      return taskDuration > HEALTH_CHECK_CONFIG.stuckThresholdMs;
    });

    if (stuckTasks.length > 0) {
      issues.push(`${stuckTasks.length} 个任务执行时间过长`);
    }

    const isHealthy =
      mission.status !== ResearchMissionStatus.FAILED &&
      mission.status !== ResearchMissionStatus.CANCELLED &&
      issues.length === 0;

    // Determine if recovery is possible
    const completedTasks = mission.tasks.filter(
      (t) => t.status === ResearchTaskStatus.COMPLETED,
    );
    const estimatedRecoveryPossible =
      completedTasks.length > 0 ||
      mission.status === ResearchMissionStatus.PLANNING;

    return {
      missionId: mission.id,
      isHealthy,
      status: mission.status,
      progress: mission.progressPercent,
      startedAt: mission.startedAt,
      lastActivityAt: lastActivity,
      stuckDurationMs,
      estimatedRecoveryPossible,
      issues,
    };
  }

  /**
   * Check if a mission can be resumed
   */
  async canResume(missionId: string): Promise<boolean> {
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      include: { tasks: true },
    });

    if (!mission) return false;

    // Can only resume failed or cancelled missions
    if (
      mission.status !== ResearchMissionStatus.FAILED &&
      mission.status !== ResearchMissionStatus.CANCELLED
    ) {
      return false;
    }

    // Check if there are any completed tasks (partial progress)
    const completedTasks = mission.tasks.filter(
      (t) => t.status === ResearchTaskStatus.COMPLETED,
    );

    return completedTasks.length > 0;
  }

  /**
   * Get configuration for external use
   */
  getConfig(): typeof HEALTH_CHECK_CONFIG {
    return { ...HEALTH_CHECK_CONFIG };
  }

  /**
   * Force a health check (for testing or manual trigger)
   */
  async forceHealthCheck(): Promise<HealthCheckResult> {
    return this.runHealthCheck();
  }

  // ==================== Phase 5: Auto Recovery ====================

  /**
   * ★ Phase 5: 服务启动时恢复中断的任务
   *
   * 场景：服务重启（部署/崩溃）后，EXECUTING 状态的任务需要继续执行
   *
   * @param options.isStartup 启动恢复模式：跳过阈值过滤，恢复所有 EXECUTING mission。
   *   进程刚启动时内存中没有任何 running task，所有 EXECUTING 状态都是遗留的。
   *   运行时由 health check 调用时传 false，使用阈值区分正常长任务和真正 stuck。
   */
  async recoverInterruptedMissions(
    options: { isStartup?: boolean } = {},
  ): Promise<RecoveryResult> {
    if (this.isRecovering) {
      this.logger.debug("Recovery already in progress, skipping");
      return {
        checkedAt: new Date(),
        interruptedMissions: 0,
        recoveredMissions: 0,
        failedRecoveries: 0,
        details: [],
      };
    }

    this.isRecovering = true;
    const mode = options.isStartup ? "startup" : "runtime";
    this.logger.log(
      `Starting auto-recovery of interrupted missions (mode=${mode})...`,
    );

    const result: RecoveryResult = {
      checkedAt: new Date(),
      interruptedMissions: 0,
      recoveredMissions: 0,
      failedRecoveries: 0,
      details: [],
    };

    try {
      // 1. 查找所有 EXECUTING 状态的 Mission
      const executingMissions = await this.prisma.researchMission.findMany({
        where: {
          status: ResearchMissionStatus.EXECUTING,
        },
        take: 50,
        include: {
          tasks: true,
          topic: { select: { id: true, name: true, userId: true } },
        },
        orderBy: { updatedAt: "desc" },
      });

      if (executingMissions.length === 0) {
        this.logger.log("No interrupted missions found");
        return result;
      }

      const now = Date.now();
      const threshold = RECOVERY_CONFIG.interruptedThresholdMs;
      const { isStartup = false } = options;

      // 2. 筛选需要恢复的任务
      // ★ isStartup=true: 进程刚启动，所有 EXECUTING mission 都是遗留的，无需阈值过滤
      // ★ isStartup=false: 运行时 health check 调用，用阈值区分正常长任务和真正 stuck
      const interruptedMissions = isStartup
        ? executingMissions
        : executingMissions.filter((mission) => {
            const lastUpdate = new Date(mission.updatedAt).getTime();
            const isStale = now - lastUpdate > threshold;

            // 检查是否有正在执行但可能中断的任务
            const hasStaleExecutingTask = mission.tasks.some((task) => {
              if (task.status !== ResearchTaskStatus.EXECUTING) return false;
              const taskLastUpdate = new Date(task.updatedAt).getTime();
              return now - taskLastUpdate > threshold;
            });

            return isStale || hasStaleExecutingTask;
          });

      result.interruptedMissions = interruptedMissions.length;

      if (interruptedMissions.length === 0) {
        this.logger.log(
          isStartup
            ? "No executing missions found on startup, no recovery needed"
            : "All executing missions are active, no recovery needed",
        );
        return result;
      }

      this.logger.warn(
        `Found ${interruptedMissions.length} interrupted missions, starting recovery...`,
      );

      // 3. 并发恢复（限制并发数）
      const batchResults = await mapWithConcurrencySettled(
        interruptedMissions,
        (mission) => this.recoverSingleMission(mission as MissionWithTasks),
        RECOVERY_CONFIG.maxConcurrentRecovery,
      );

      for (let j = 0; j < batchResults.length; j++) {
        const batchResult = batchResults[j];
        const mission = interruptedMissions[j];

        if (batchResult.status === "fulfilled" && batchResult.value.success) {
          result.recoveredMissions++;
          result.details.push({
            missionId: mission.id,
            topicId: mission.topicId,
            action: "recovered",
            reason: batchResult.value.reason,
          });
        } else {
          result.failedRecoveries++;
          result.details.push({
            missionId: mission.id,
            topicId: mission.topicId,
            action: "failed",
            reason:
              batchResult.status === "rejected"
                ? batchResult.reason?.message || "Unknown error"
                : batchResult.value.reason,
          });
        }
      }

      this.logger.log(
        `Auto-recovery completed: ${result.recoveredMissions} recovered, ` +
          `${result.failedRecoveries} failed`,
      );

      return result;
    } finally {
      this.isRecovering = false;
    }
  }

  /**
   * ★ Phase 5: 恢复单个中断的 Mission
   * 使用事件驱动方案，避免循环依赖
   */
  private async recoverSingleMission(
    mission: MissionWithTasks,
  ): Promise<{ success: boolean; reason: string }> {
    const { id: missionId, topicId } = mission;

    this.logger.log(`Recovering mission ${missionId}...`);

    try {
      // 1. 发出恢复开始事件
      const completedCount = mission.tasks.filter(
        (t) => t.status === ResearchTaskStatus.COMPLETED,
      ).length;
      const totalCount = mission.tasks.length;

      await this.researchEventEmitter.emitMissionProgress(topicId, {
        missionId,
        progress: mission.progressPercent || 0,
        phase: "recovering",
        message: "系统正在恢复中断的研究任务...",
        completedTasks: completedCount,
        totalTasks: totalCount,
      });

      // 2. 重置所有 EXECUTING 状态的任务为 PENDING
      const resetTaskResult = await this.prisma.researchTask.updateMany({
        where: {
          missionId,
          status: ResearchTaskStatus.EXECUTING,
        },
        data: {
          status: ResearchTaskStatus.PENDING,
          startedAt: null,
        },
      });

      // 3. 重置所有 IN_PROGRESS 状态的 TODO 为 PENDING
      await this.prisma.researchTodo.updateMany({
        where: {
          missionId,
          status: ResearchTodoStatus.IN_PROGRESS,
        },
        data: {
          status: ResearchTodoStatus.PENDING,
          startedAt: null,
        },
      });

      // 4. 更新 Mission 的 updatedAt 以标记恢复
      await this.prisma.researchMission.update({
        where: { id: missionId },
        data: {
          updatedAt: new Date(),
        },
      });

      // 5. 发出恢复事件，让 MissionService 处理继续执行
      // ★ 使用事件驱动避免循环依赖
      this.eventEmitter.emit(RESEARCH_INTERNAL_EVENTS.RECOVERY_NEEDED, {
        missionId,
        topicId,
        resetTaskCount: resetTaskResult.count,
      });

      this.logger.log(
        `Mission ${missionId} recovered successfully, ` +
          `${resetTaskResult.count} tasks reset to PENDING`,
      );

      return {
        success: true,
        reason: `Recovered with ${resetTaskResult.count} tasks reset`,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to recover mission ${missionId}: ${errorMessage}`,
      );

      // 恢复失败不标记为 FAILED，让健康检查来处理
      return {
        success: false,
        reason: errorMessage,
      };
    }
  }

  /**
   * ★ Phase 5: 优雅关机前保存检查点
   */
  private async saveCheckpointsBeforeShutdown(): Promise<void> {
    this.logger.log("Saving checkpoints before shutdown...");

    try {
      const executingMissions = await this.prisma.researchMission.findMany({
        where: {
          status: ResearchMissionStatus.EXECUTING,
        },
        include: {
          tasks: true,
        },
      });

      if (executingMissions.length === 0) {
        this.logger.log("No executing missions to checkpoint");
        return;
      }

      for (const mission of executingMissions) {
        try {
          // 保存当前进度到 userContext
          const checkpoint = {
            savedAt: new Date().toISOString(),
            reason: "graceful_shutdown",
            completedTasks: mission.tasks
              .filter((t) => t.status === ResearchTaskStatus.COMPLETED)
              .map((t) => t.id),
            executingTasks: mission.tasks
              .filter((t) => t.status === ResearchTaskStatus.EXECUTING)
              .map((t) => t.id),
            progressPercent: mission.progressPercent,
          };

          const existingContext =
            (mission.userContext as Record<string, unknown>) || {};

          await this.prisma.researchMission.update({
            where: { id: mission.id },
            data: {
              userContext: {
                ...existingContext,
                shutdownCheckpoint: checkpoint,
              },
            },
          });

          this.logger.debug(`Checkpoint saved for mission ${mission.id}`);
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to save checkpoint for ${mission.id}: ${errorMessage}`,
          );
        }
      }

      this.logger.log(
        `Saved checkpoints for ${executingMissions.length} missions`,
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to save checkpoints: ${errorMessage}`);
    }
  }
}
