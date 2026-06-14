/**
 * MissionRetryService - 任务重试和恢复服务
 *
 * 职责:
 * - retryMission: 重试失败/取消/卡住的任务
 * - handleLeaderMentionCommand: 处理 @Leader 消息触发的任务控制
 * - isMissionStuck: 检测任务是否卡住
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { TopicEventEmitterService } from "../../events";
import {
  MissionStatus,
  AgentTaskStatus,
  MissionLogType,
  MessageContentType,
} from "@prisma/client";
import { TASK_TIMEOUT_CONFIG } from "../config";
import {
  CreateLogFn,
  SendMessageToTopicFn,
  ExecuteNextTasksFn,
  StartMissionFn,
  HandleLeaderMentionCommandFn,
} from "../interfaces/mission-types";

interface MissionWithTasks {
  id: string;
  topicId: string;
  title: string;
  status: MissionStatus;
  tasks: Array<{
    id: string;
    status: AgentTaskStatus;
    startedAt?: Date | null;
    updatedAt?: Date;
    result?: string | null;
    leaderFeedback?: string | null;
    dependsOnIds?: string[];
    assignedTo?: {
      id: string;
      displayName: string;
      agentName: string | null;
    };
  }>;
  leader: {
    id: string;
    displayName: string;
    agentName: string | null;
  };
}

@Injectable()
export class MissionRetryService {
  private readonly logger = new Logger(MissionRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly topicEventEmitter: TopicEventEmitterService,
  ) {}

  /**
   * 检测任务是否卡住
   * 如果任务超过指定时间未更新，则视为卡住
   */
  isMissionStuck(
    mission: {
      tasks?: Array<{
        status: string;
        startedAt?: Date | null;
        updatedAt?: Date;
      }>;
      updatedAt?: Date;
    },
    thresholdMs = TASK_TIMEOUT_CONFIG.missionStuckTimeoutMs,
  ): boolean {
    const now = Date.now();

    // 检查是否有任务卡在 IN_PROGRESS 状态
    const hasStuckTasks = (mission.tasks || []).some((t) => {
      if (t.status !== "IN_PROGRESS") return false;
      const startTime = t.startedAt
        ? new Date(t.startedAt).getTime()
        : t.updatedAt
          ? new Date(t.updatedAt).getTime()
          : 0;
      return startTime > 0 && now - startTime > thresholdMs;
    });

    return hasStuckTasks;
  }

  /**
   * 重试失败或已取消的任务
   * 支持两种模式：
   * 1. 完全重试：重新规划并执行所有任务
   * 2. 继续执行：仅继续执行未完成的任务
   *
   * 扩展支持：PAUSED 状态和卡住的 IN_PROGRESS 状态
   */
  async retryMission(
    missionId: string,
    userId: string,
    options: { mode?: "full" | "continue"; reason?: string } | undefined,
    sendMessageToTopic: SendMessageToTopicFn,
    createLog: CreateLogFn,
    startMission: StartMissionFn,
    handleLeaderMentionCommand: HandleLeaderMentionCommandFn,
    executeNextTasks: ExecuteNextTasksFn,
  ) {
    const mode = options?.mode || "continue";

    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
      include: {
        leader: true,
        tasks: {
          include: { assignedTo: true },
        },
        topic: true,
      },
    });

    if (!mission) {
      throw new NotFoundException("任务不存在");
    }

    // 扩展支持的状态：FAILED, CANCELLED, PAUSED, 以及卡住的 IN_PROGRESS
    const allowedStatuses: MissionStatus[] = [
      MissionStatus.FAILED,
      MissionStatus.CANCELLED,
      MissionStatus.PAUSED,
    ];

    // 检查是否是卡住的 IN_PROGRESS 任务
    const isStuckInProgress =
      mission.status === MissionStatus.IN_PROGRESS &&
      this.isMissionStuck(mission);

    if (!allowedStatuses.includes(mission.status) && !isStuckInProgress) {
      throw new BadRequestException(
        "只有失败、已取消、已暂停或卡住的任务可以重试",
      );
    }

    // 如果是卡住的任务，记录日志
    if (isStuckInProgress) {
      this.logger.warn(
        `[retryMission] Mission ${missionId} detected as stuck, allowing retry`,
      );
    }

    const previousStatus = mission.status;

    if (mode === "full") {
      // 完全重试：删除所有任务，重新规划
      await this.prisma.agentTask.deleteMany({
        where: { missionId },
      });

      // 重置任务状态
      await this.prisma.teamMission.update({
        where: { id: missionId },
        data: {
          status: MissionStatus.PENDING,
          completedTasks: 0,
          totalTasks: 0,
          finalResult: null,
          summary: null,
        },
      });

      await createLog(missionId, {
        type: MissionLogType.MISSION_CREATED,
        agentId: mission.leader.id,
        agentName: mission.leader.agentName || mission.leader.displayName,
        content: `任务重试（完全重新规划）${options?.reason ? `，原因：${options.reason}` : ""}`,
      });

      await sendMessageToTopic(
        mission.topicId,
        null,
        `🔄 **任务重试**\n\n任务「${mission.title}」将重新规划并执行...${options?.reason ? `\n\n> 重试原因：${options.reason}` : ""}`,
        MessageContentType.SYSTEM,
      );

      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:retried",
        {
          missionId,
          mode: "full",
          previousStatus,
        },
      );

      // 重新启动任务
      startMission(missionId, userId).catch((err) => {
        this.logger.error(`Failed to restart mission ${missionId}: ${err}`);
      });
    } else {
      // 继续执行：将失败/取消/卡住的任务标记为 PENDING，继续执行
      const stuckThreshold = TASK_TIMEOUT_CONFIG.missionStuckTimeoutMs;
      const now = Date.now();

      // 扩展：同时检测失败、取消、阻塞和卡住的任务
      const tasksToReset = mission.tasks.filter((t) => {
        // 失败或取消的任务
        if (
          t.status === AgentTaskStatus.CANCELLED ||
          t.status === AgentTaskStatus.BLOCKED
        ) {
          return true;
        }
        // 卡住的 IN_PROGRESS 任务（超过 10 分钟未更新）
        if (t.status === AgentTaskStatus.IN_PROGRESS && t.startedAt) {
          const startTime = new Date(t.startedAt).getTime();
          if (now - startTime > stuckThreshold) {
            this.logger.warn(
              `[retryMission] Task ${t.id} is stuck (started ${Math.round((now - startTime) / 60000)} min ago)`,
            );
            return true;
          }
        }
        return false;
      });

      if (tasksToReset.length === 0) {
        // 没有需要重置的任务，检查是否有等待执行的任务
        const pendingTasks = mission.tasks.filter(
          (t) => t.status === AgentTaskStatus.PENDING,
        );

        if (pendingTasks.length === 0) {
          throw new BadRequestException("没有可以继续执行的任务");
        }
      }

      // 将需要重置的任务设为 PENDING
      for (const task of tasksToReset) {
        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: {
            status: AgentTaskStatus.PENDING,
            result: null,
            startedAt: null,
            completedAt: null,
          },
        });
      }

      // 更新任务状态为 IN_PROGRESS
      await this.prisma.teamMission.update({
        where: { id: missionId },
        data: {
          status: MissionStatus.IN_PROGRESS,
          summary: null,
        },
      });

      // 生成更详细的日志消息
      const stuckCount = tasksToReset.filter(
        (t) => t.status === AgentTaskStatus.IN_PROGRESS,
      ).length;
      const failedCount = tasksToReset.length - stuckCount;
      const logMsg =
        stuckCount > 0 && failedCount > 0
          ? `${failedCount} 个失败任务和 ${stuckCount} 个卡住任务将重新执行`
          : stuckCount > 0
            ? `${stuckCount} 个卡住的任务将重新执行`
            : `${failedCount} 个任务将重新执行`;

      await createLog(missionId, {
        type: MissionLogType.TASK_STARTED,
        agentId: mission.leader.id,
        agentName: mission.leader.agentName || mission.leader.displayName,
        content: `任务继续执行，${logMsg}${options?.reason ? `，原因：${options.reason}` : ""}`,
      });

      // 关键修复：发送 @Leader 消息，触发 Leader 重新编排任务
      const leaderName = mission.leader.agentName || mission.leader.displayName;
      const mentionMessage = `@${leaderName} 继续当前任务`;

      // 发送用户消息 @mention Leader
      await sendMessageToTopic(
        mission.topicId,
        null,
        mentionMessage,
        MessageContentType.TEXT,
      );

      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:retried",
        {
          missionId,
          mode: "continue",
          previousStatus,
          retriedTaskCount: tasksToReset.length,
          stuckTaskCount: stuckCount,
        },
      );

      // 调用 handleLeaderMentionCommand 触发 Leader 重新编排
      handleLeaderMentionCommand(mission.topicId, userId, mentionMessage).catch(
        (err) => {
          this.logger.error(
            `Failed to trigger leader command for mission ${missionId}: ${err}`,
          );
          // 如果 Leader 命令失败，回退到直接执行
          executeNextTasks(missionId).catch((execErr) => {
            this.logger.error(
              `Fallback executeNextTasks also failed for ${missionId}: ${execErr}`,
            );
          });
        },
      );
    }

    return {
      success: true,
      message: mode === "full" ? "任务重新开始" : "任务继续执行",
      mode,
      previousStatus,
    };
  }

  /**
   * 处理 IN_PROGRESS 状态的 Mission
   * 注：handleLeaderMentionCommand 的完整逻辑仍在 TeamMissionService 中
   * 此方法仅作为辅助方法供内部使用
   */
  async handleInProgressMission(
    mission: MissionWithTasks,
    topicId: string,
    callbacks: {
      sendMessageToTopic: SendMessageToTopicFn;
      leaderReviewTask: (
        mission: MissionWithTasks,
        task: MissionWithTasks["tasks"][0],
        result: string,
      ) => Promise<unknown>;
      executeTaskRevision: (
        mission: MissionWithTasks,
        task: MissionWithTasks["tasks"][0],
        feedback: string,
      ) => Promise<unknown>;
      executeNextTasks: ExecuteNextTasksFn;
      completeMission: (missionId: string) => Promise<unknown>;
    },
  ): Promise<{ handled: boolean; action?: string; missionId?: string }> {
    this.logger.log(
      `[Leader Command] Continuing in-progress mission ${mission.id}`,
    );

    const stuckThreshold = TASK_TIMEOUT_CONFIG.taskStuckTimeoutMs;
    const now = Date.now();

    // 检查卡住的任务并重置
    const stuckInProgressTasks = mission.tasks.filter(
      (t) =>
        t.status === AgentTaskStatus.IN_PROGRESS &&
        t.startedAt &&
        now - new Date(t.startedAt).getTime() > stuckThreshold,
    );

    if (stuckInProgressTasks.length > 0) {
      this.logger.warn(
        `[Leader Command] Found ${stuckInProgressTasks.length} stuck IN_PROGRESS tasks, resetting to PENDING`,
      );
      for (const task of stuckInProgressTasks) {
        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: {
            status: AgentTaskStatus.PENDING,
            startedAt: null,
          },
        });
      }
    }

    // 重新获取任务状态
    const updatedMission = await this.prisma.teamMission.findUnique({
      where: { id: mission.id },
      include: {
        leader: true,
        tasks: {
          include: { assignedTo: true },
        },
      },
    });

    if (!updatedMission) {
      return { handled: false };
    }

    // 检查待执行任务
    const pendingTasks = updatedMission.tasks.filter(
      (t) => t.status === AgentTaskStatus.PENDING,
    );

    if (pendingTasks.length > 0) {
      // 计算哪些任务可以真正开始
      const tasksCanStart = pendingTasks.filter((task) => {
        const dependsOnIds = task.dependsOnIds || [];
        return dependsOnIds.every((depId: string) => {
          const depTask = updatedMission.tasks.find((t) => t.id === depId);
          return depTask?.status === AgentTaskStatus.COMPLETED;
        });
      });

      if (tasksCanStart.length > 0) {
        callbacks.executeNextTasks(mission.id).catch((error) => {
          this.logger.error(
            `Failed to continue mission execution: ${error instanceof Error ? error.message : error}`,
          );
        });

        await callbacks.sendMessageToTopic(
          topicId,
          updatedMission.leader?.id || null,
          `✅ 收到，继续执行任务...`,
          MessageContentType.TEXT,
        );

        return {
          handled: true,
          action: "continue_organizing",
          missionId: mission.id,
        };
      }
    }

    // 检查完成率
    const completedTasks = updatedMission.tasks.filter(
      (t) => t.status === AgentTaskStatus.COMPLETED,
    );
    const completionRate = completedTasks.length / updatedMission.tasks.length;
    const FORCE_COMPLETE_THRESHOLD = TASK_TIMEOUT_CONFIG.forceCompleteThreshold;

    const allCompleted = updatedMission.tasks.every(
      (t) => t.status === AgentTaskStatus.COMPLETED,
    );

    if (allCompleted && updatedMission.tasks.length > 0) {
      callbacks.completeMission(mission.id).catch((error) => {
        this.logger.error(
          `Failed to complete mission: ${error instanceof Error ? error.message : error}`,
        );
      });

      return {
        handled: true,
        action: "completing_mission",
        missionId: mission.id,
      };
    }

    if (completionRate >= FORCE_COMPLETE_THRESHOLD) {
      const remainingTasks = updatedMission.tasks.filter(
        (t) => t.status !== AgentTaskStatus.COMPLETED,
      );

      this.logger.warn(
        `[Leader Command] Completion rate ${(completionRate * 100).toFixed(1)}% >= 85%, force completing ${remainingTasks.length} remaining tasks`,
      );

      await callbacks.sendMessageToTopic(
        topicId,
        updatedMission.leader?.id || null,
        `📊 检测到任务完成率已达 ${(completionRate * 100).toFixed(1)}%，正在强制完成剩余 ${remainingTasks.length} 个任务...`,
        MessageContentType.TEXT,
      );

      for (const task of remainingTasks) {
        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: {
            status: AgentTaskStatus.COMPLETED,
            completedAt: new Date(),
            result:
              task.result ||
              `[自动完成] 任务在高完成率下被系统自动标记为完成（完成率: ${(completionRate * 100).toFixed(1)}%）`,
          },
        });
      }

      callbacks.completeMission(mission.id).catch((error) => {
        this.logger.error(
          `Failed to complete mission after force completing tasks: ${error instanceof Error ? error.message : error}`,
        );
      });

      return {
        handled: true,
        action: "force_completing_mission",
        missionId: mission.id,
      };
    }

    // 尝试触发 executeNextTasks
    this.logger.warn(
      `[Leader Command] No truly active tasks, completion rate ${(completionRate * 100).toFixed(1)}%, triggering executeNextTasks`,
    );

    await callbacks.sendMessageToTopic(
      topicId,
      updatedMission.leader?.id || null,
      `🔄 检测到任务可能卡住，正在尝试恢复执行...`,
      MessageContentType.TEXT,
    );

    callbacks.executeNextTasks(mission.id).catch((error) => {
      this.logger.error(
        `Failed to execute next tasks: ${error instanceof Error ? error.message : error}`,
      );
    });

    return {
      handled: true,
      action: "retry_execution",
      missionId: mission.id,
    };
  }
}
