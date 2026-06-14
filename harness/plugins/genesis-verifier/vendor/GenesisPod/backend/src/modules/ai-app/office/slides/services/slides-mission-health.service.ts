/**
 * Slides Mission Health Service
 *
 * Health check service for detecting stuck slides generation tasks and performing recovery.
 * Based on the ResearchMissionHealthService pattern.
 *
 * Features:
 * - Periodic health checks (every 5 minutes)
 * - Stuck task detection (30 minutes threshold)
 * - Maximum execution time enforcement (2 hours)
 * - Auto-recovery on service restart
 * - Graceful shutdown with checkpoint saving
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SlidesMissionStatus, SlidesTaskStatus } from "@prisma/client";
import { HealthCheckRunner } from "@/modules/ai-harness/facade";
import { mapWithConcurrencySettled } from "@/common/utils/concurrency.utils";

// Type alias for the actual status used in slides (IN_PROGRESS vs EXECUTING)
const TASK_EXECUTING_STATUS = SlidesTaskStatus.IN_PROGRESS;

// ==================== Configuration ====================

/**
 * Health check configuration
 */
const HEALTH_CHECK_CONFIG = {
  /** Check interval: 5 minutes */
  checkIntervalMs: 5 * 60 * 1000,

  /** Stuck threshold: 30 minutes without progress */
  stuckThresholdMs: 30 * 60 * 1000,

  /** Maximum execution time: 2 hours */
  maxExecutionTimeMs: 2 * 60 * 60 * 1000,

  /** Max retries before giving up */
  maxRetries: 3,
} as const;

/**
 * Service startup auto-recovery configuration
 */
const RECOVERY_CONFIG = {
  /** Delay before starting recovery (wait for other services) */
  recoveryDelayMs: 10 * 1000,

  /** Threshold for considering a task "interrupted" */
  interruptedThresholdMs: 5 * 60 * 1000,

  /** Max concurrent recovery tasks */
  maxConcurrentRecovery: 3,
} as const;

// ==================== Types ====================

export interface HealthCheckResult {
  checkedAt: Date;
  totalMissions: number;
  stuckMissions: number;
  recoveredMissions: number;
  failedMissions: number;
  details: MissionHealthDetail[];
}

export interface MissionHealthDetail {
  missionId: string;
  sessionId: string;
  status: SlidesMissionStatus;
  startedAt: Date | null;
  lastActivityAt: Date | null;
  stuckDurationMs: number;
  action: "none" | "marked_failed" | "recovery_attempted";
  reason?: string;
}

export interface MissionHealthStatus {
  missionId: string;
  isHealthy: boolean;
  status: SlidesMissionStatus;
  progress: number; // Calculated from totalTasks/completedTasks
  startedAt: Date | null;
  lastActivityAt: Date | null;
  stuckDurationMs: number;
  estimatedRecoveryPossible: boolean;
  issues: string[];
}

export interface RecoveryResult {
  checkedAt: Date;
  interruptedMissions: number;
  recoveredMissions: number;
  failedRecoveries: number;
  details: RecoveryDetail[];
}

export interface RecoveryDetail {
  missionId: string;
  sessionId: string;
  action: "recovered" | "failed" | "skipped";
  reason: string;
}

/**
 * Mission with tasks type for recovery
 */
interface MissionWithTasks {
  id: string;
  sessionId: string;
  status: SlidesMissionStatus;
  totalTasks: number;
  completedTasks: number;
  updatedAt: Date;
  createdAt: Date;
  startedAt: Date | null;
  metadata: unknown;
  tasks: Array<{
    id: string;
    status: SlidesTaskStatus;
    updatedAt: Date;
    startedAt: Date | null;
  }>;
}

/**
 * Calculate progress percentage from task counts
 */
function calculateProgress(totalTasks: number, completedTasks: number): number {
  if (totalTasks === 0) return 0;
  return Math.round((completedTasks / totalTasks) * 100);
}

// ==================== Service ====================

@Injectable()
export class SlidesMissionHealthService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SlidesMissionHealthService.name);
  private readonly healthCheckRunner = new HealthCheckRunner({
    name: "SlidesMissionHealth",
    intervalMs: HEALTH_CHECK_CONFIG.checkIntervalMs,
    runImmediately: true,
  });
  private isRecovering = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Module initialization - start health check loop
   */
  onModuleInit(): void {
    this.healthCheckRunner.start(() => this.runHealthCheck().then(() => {}));
    this.logger.log(
      `Health check service started with ${HEALTH_CHECK_CONFIG.checkIntervalMs / 1000}s interval`,
    );

    // ════════════════════════════════════════════════════════════════════════
    // ★ 2026-05-25 默认关闭「启动自动恢复」。
    //   recoverInterruptedMissions() 会把所有 EXECUTING slides mission 在重启后
    //   自动重新拉起、跑全量 LLM（BYOK 烧真金白银）。
    //   Set ENABLE_SLIDES_MISSION_AUTORECOVERY=true to opt in.
    // ════════════════════════════════════════════════════════════════════════
    if (process.env.ENABLE_SLIDES_MISSION_AUTORECOVERY !== "true") {
      this.logger.warn(
        "[SlidesMissionHealth] startup auto-recovery DISABLED (default) — " +
          "interrupted EXECUTING missions will NOT be auto-resumed on boot. " +
          "Set ENABLE_SLIDES_MISSION_AUTORECOVERY=true to opt in.",
      );
      return;
    }

    // opt-in: Delayed auto-recovery (wait for other services)
    setTimeout(() => {
      this.recoverInterruptedMissions().catch((err) => {
        this.logger.error(`Auto-recovery failed: ${err.message}`);
      });
    }, RECOVERY_CONFIG.recoveryDelayMs).unref();

    this.logger.log(
      `Auto-recovery scheduled in ${RECOVERY_CONFIG.recoveryDelayMs / 1000}s (opt-in ENABLED)`,
    );
  }

  /**
   * Module destruction - stop health check loop
   */
  async onModuleDestroy(): Promise<void> {
    this.healthCheckRunner.stop();

    // Save checkpoints before shutdown
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
      const activeMissions = await this.prisma.slidesMission.findMany({
        where: {
          status: {
            in: [
              SlidesMissionStatus.PLANNING,
              SlidesMissionStatus.EXECUTING,
              SlidesMissionStatus.REVIEWING,
            ],
          },
        },
        include: {
          tasks: {
            orderBy: { updatedAt: "desc" },
            take: 5, // Get last 5 tasks for activity detection
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
   * Detection logic:
   * 1. Exceeded max execution time (2 hours) → mark failed
   * 2. Exceeded stuck threshold (30 min) but has executing tasks → warn only
   * 3. Exceeded stuck threshold with no executing tasks → mark failed
   */
  private async checkMissionHealth(
    mission: MissionWithTasks,
    now: Date,
  ): Promise<MissionHealthDetail> {
    const detail: MissionHealthDetail = {
      missionId: mission.id,
      sessionId: mission.sessionId,
      status: mission.status,
      startedAt: mission.startedAt,
      lastActivityAt: this.getLastActivityTime(mission),
      stuckDurationMs: 0,
      action: "none",
    };

    // Calculate stuck duration
    const lastActivity = detail.lastActivityAt || mission.createdAt;
    detail.stuckDurationMs = now.getTime() - new Date(lastActivity).getTime();

    // Check if mission has exceeded max execution time
    const executionTime = mission.startedAt
      ? now.getTime() - new Date(mission.startedAt).getTime()
      : detail.stuckDurationMs;

    if (executionTime > HEALTH_CHECK_CONFIG.maxExecutionTimeMs) {
      await this.markMissionFailed(
        mission,
        `PPT 生成任务执行超时（超过 ${Math.round(HEALTH_CHECK_CONFIG.maxExecutionTimeMs / 1000 / 60)} 分钟）`,
      );
      detail.action = "marked_failed";
      detail.reason = "Execution timeout exceeded";
      return detail;
    }

    // Smart stuck detection: check for executing tasks
    if (detail.stuckDurationMs > HEALTH_CHECK_CONFIG.stuckThresholdMs) {
      // Check if there are EXECUTING status tasks
      const hasExecutingTasks = mission.tasks?.some(
        (task) => task.status === TASK_EXECUTING_STATUS,
      );

      if (hasExecutingTasks) {
        // Has executing tasks, may be long AI call - just warn
        this.logger.warn(
          `Mission ${mission.id} has been inactive for ${Math.round(detail.stuckDurationMs / 1000 / 60)} minutes, ` +
            `but has executing tasks - not marking as failed`,
        );
        detail.reason = "Has executing tasks - monitoring only";
        // Don't mark failed, let task continue
      } else {
        // No executing tasks, truly stuck
        await this.markMissionFailed(
          mission,
          `PPT 生成任务卡死（${Math.round(detail.stuckDurationMs / 1000 / 60)} 分钟无进展且无执行中任务）`,
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

    if (mission.tasks?.[0]?.updatedAt) {
      times.push(new Date(mission.tasks[0].updatedAt));
    }

    if (times.length === 0) return null;

    return new Date(Math.max(...times.map((t) => t.getTime())));
  }

  /**
   * Mark a mission as failed
   */
  private async markMissionFailed(
    mission: { id: string; sessionId: string },
    reason: string,
  ): Promise<void> {
    this.logger.warn(`Marking mission ${mission.id} as failed: ${reason}`);

    // Update mission status
    await this.prisma.slidesMission.update({
      where: { id: mission.id },
      data: {
        status: SlidesMissionStatus.FAILED,
        completedAt: new Date(),
        errorMessage: reason,
      },
    });

    // Update all non-completed tasks to failed
    await this.prisma.slidesTask.updateMany({
      where: {
        missionId: mission.id,
        status: {
          notIn: [SlidesTaskStatus.COMPLETED, SlidesTaskStatus.FAILED],
        },
      },
      data: {
        status: SlidesTaskStatus.FAILED,
        completedAt: new Date(),
      },
    });

    // Emit failure event
    this.eventEmitter.emit("slides.mission.failed", {
      missionId: mission.id,
      sessionId: mission.sessionId,
      reason,
    });
  }

  /**
   * Get health status for a specific mission
   */
  async getMissionHealthStatus(
    missionId: string,
  ): Promise<MissionHealthStatus | null> {
    const mission = await this.prisma.slidesMission.findUnique({
      where: { id: missionId },
      include: {
        tasks: true,
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
      if (task.status !== TASK_EXECUTING_STATUS) return false;
      if (!task.startedAt) return false;
      const taskDuration = now.getTime() - new Date(task.startedAt).getTime();
      return taskDuration > HEALTH_CHECK_CONFIG.stuckThresholdMs;
    });

    if (stuckTasks.length > 0) {
      issues.push(`${stuckTasks.length} 个任务执行时间过长`);
    }

    const isHealthy =
      mission.status !== SlidesMissionStatus.FAILED &&
      mission.status !== SlidesMissionStatus.CANCELLED &&
      issues.length === 0;

    // Determine if recovery is possible
    const completedTasks = mission.tasks.filter(
      (t) => t.status === SlidesTaskStatus.COMPLETED,
    );
    const estimatedRecoveryPossible =
      completedTasks.length > 0 ||
      mission.status === SlidesMissionStatus.PLANNING;

    return {
      missionId: mission.id,
      isHealthy,
      status: mission.status,
      progress: calculateProgress(mission.totalTasks, mission.completedTasks),
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
    const mission = await this.prisma.slidesMission.findUnique({
      where: { id: missionId },
      include: { tasks: true },
    });

    if (!mission) return false;

    // Can only resume failed or cancelled missions
    if (
      mission.status !== SlidesMissionStatus.FAILED &&
      mission.status !== SlidesMissionStatus.CANCELLED
    ) {
      return false;
    }

    // Check if there are any completed tasks (partial progress)
    const completedTasks = mission.tasks.filter(
      (t) => t.status === SlidesTaskStatus.COMPLETED,
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

  // ==================== Auto Recovery ====================

  /**
   * Recover interrupted missions on service restart
   */
  async recoverInterruptedMissions(): Promise<RecoveryResult> {
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
    this.logger.log("Starting auto-recovery of interrupted missions...");

    const result: RecoveryResult = {
      checkedAt: new Date(),
      interruptedMissions: 0,
      recoveredMissions: 0,
      failedRecoveries: 0,
      details: [],
    };

    try {
      // Find all EXECUTING status missions
      const executingMissions = await this.prisma.slidesMission.findMany({
        where: {
          status: SlidesMissionStatus.EXECUTING,
        },
        include: {
          tasks: true,
        },
        orderBy: { updatedAt: "desc" },
      });

      if (executingMissions.length === 0) {
        this.logger.log("No interrupted missions found");
        return result;
      }

      const now = Date.now();
      const threshold = RECOVERY_CONFIG.interruptedThresholdMs;

      // Filter missions that need recovery (no update past threshold)
      const interruptedMissions = executingMissions.filter((mission) => {
        const lastUpdate = new Date(mission.updatedAt).getTime();
        const isStale = now - lastUpdate > threshold;

        // Check for stale executing tasks
        const hasStaleExecutingTask = mission.tasks.some((task) => {
          if (task.status !== TASK_EXECUTING_STATUS) return false;
          const taskLastUpdate = new Date(task.updatedAt).getTime();
          return now - taskLastUpdate > threshold;
        });

        return isStale || hasStaleExecutingTask;
      });

      result.interruptedMissions = interruptedMissions.length;

      if (interruptedMissions.length === 0) {
        this.logger.log(
          "All executing missions are active, no recovery needed",
        );
        return result;
      }

      this.logger.warn(
        `Found ${interruptedMissions.length} interrupted missions, starting recovery...`,
      );

      // Concurrent recovery (limited)
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
            sessionId: mission.sessionId,
            action: "recovered",
            reason: batchResult.value.reason,
          });
        } else {
          result.failedRecoveries++;
          result.details.push({
            missionId: mission.id,
            sessionId: mission.sessionId,
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
   * Recover a single interrupted mission
   * Uses event-driven approach to avoid circular dependencies
   */
  private async recoverSingleMission(
    mission: MissionWithTasks,
  ): Promise<{ success: boolean; reason: string }> {
    const { id: missionId, sessionId } = mission;

    this.logger.log(`Recovering mission ${missionId}...`);

    try {
      // 1. Reset all EXECUTING tasks to PENDING
      const resetTaskResult = await this.prisma.slidesTask.updateMany({
        where: {
          missionId,
          status: TASK_EXECUTING_STATUS,
        },
        data: {
          status: SlidesTaskStatus.PENDING,
          startedAt: null,
        },
      });

      // 2. Update Mission's updatedAt to mark recovery
      await this.prisma.slidesMission.update({
        where: { id: missionId },
        data: {
          updatedAt: new Date(),
        },
      });

      // 3. Emit recovery event for MissionService to handle
      this.eventEmitter.emit("slides.mission.recovery_needed", {
        missionId,
        sessionId,
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

      // Don't mark as FAILED on recovery failure, let health check handle it
      return {
        success: false,
        reason: errorMessage,
      };
    }
  }

  /**
   * Save checkpoints before graceful shutdown
   */
  private async saveCheckpointsBeforeShutdown(): Promise<void> {
    this.logger.log("Saving checkpoints before shutdown...");

    try {
      const executingMissions = await this.prisma.slidesMission.findMany({
        where: {
          status: SlidesMissionStatus.EXECUTING,
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
          // Save current progress to metadata
          const checkpoint = {
            savedAt: new Date().toISOString(),
            reason: "graceful_shutdown",
            completedTasks: mission.tasks
              .filter((t) => t.status === SlidesTaskStatus.COMPLETED)
              .map((t) => t.id),
            executingTasks: mission.tasks
              .filter((t) => t.status === TASK_EXECUTING_STATUS)
              .map((t) => t.id),
            progressPercent: calculateProgress(
              mission.totalTasks,
              mission.completedTasks,
            ),
          };

          const existingMetadata =
            (mission.metadata as Record<string, unknown>) || {};

          await this.prisma.slidesMission.update({
            where: { id: mission.id },
            data: {
              metadata: {
                ...existingMetadata,
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
