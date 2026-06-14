/**
 * MissionLifecycleService - 任务生命周期管理
 *
 * 职责:
 * - cancelMission: 取消任务
 * - deleteMission: 删除任务
 * - updateMissionNotification: 更新通知配置
 * - pauseMission: 暂停任务
 * - resumeMission: 恢复任务
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
import {
  CreateLogFn,
  SendMessageToTopicFn,
  ExecuteNextTasksFn,
  StartMissionFn,
} from "../interfaces/mission-types";

@Injectable()
export class MissionLifecycleService {
  private readonly logger = new Logger(MissionLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly topicEventEmitter: TopicEventEmitterService,
  ) {}

  /**
   * 取消任务
   */
  async cancelMission(
    missionId: string,
    _userId: string,
    createLog: CreateLogFn,
  ) {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
    });

    if (!mission) {
      throw new NotFoundException("任务不存在");
    }

    if (
      mission.status === MissionStatus.COMPLETED ||
      mission.status === MissionStatus.CANCELLED
    ) {
      throw new BadRequestException("任务已完成或已取消");
    }

    await this.prisma.teamMission.update({
      where: { id: missionId },
      data: { status: MissionStatus.CANCELLED },
    });

    // 取消所有进行中的子任务
    await this.prisma.agentTask.updateMany({
      where: {
        missionId,
        status: { in: [AgentTaskStatus.PENDING, AgentTaskStatus.IN_PROGRESS] },
      },
      data: { status: AgentTaskStatus.CANCELLED },
    });

    await createLog(missionId, {
      type: MissionLogType.MISSION_FAILED,
      content: "任务已被用户取消",
    });

    void this.topicEventEmitter.emitToTopic(
      mission.topicId,
      "mission:cancelled",
      {
        missionId,
      },
    );

    return { success: true, message: "任务已取消" };
  }

  /**
   * 删除任务（仅限历史任务：已完成、失败或取消的任务）
   * 使用事务确保原子性删除
   */
  async deleteMission(missionId: string, _userId: string) {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
    });

    if (!mission) {
      throw new NotFoundException("任务不存在");
    }

    // 只有已完成、失败或取消的任务可以删除
    const deletableStatuses: MissionStatus[] = [
      MissionStatus.COMPLETED,
      MissionStatus.FAILED,
      MissionStatus.CANCELLED,
    ];

    if (!deletableStatuses.includes(mission.status)) {
      throw new BadRequestException(
        `当前状态(${mission.status})的任务无法删除，只有已完成、失败或取消的任务可以删除`,
      );
    }

    // 使用事务原子性删除所有关联数据
    await this.prisma.$transaction([
      // 先删除关联的日志
      this.prisma.missionLog.deleteMany({
        where: { missionId },
      }),
      // 删除关联的子任务
      this.prisma.agentTask.deleteMany({
        where: { missionId },
      }),
      // 删除任务本身
      this.prisma.teamMission.delete({
        where: { id: missionId },
      }),
    ]);

    this.logger.log(`[Mission ${missionId}] Deleted by user`);

    // 通知前端任务已删除
    void this.topicEventEmitter.emitToTopic(
      mission.topicId,
      "mission:deleted",
      {
        missionId,
      },
    );

    return { success: true, message: "任务已删除" };
  }

  /**
   * 更新任务通知配置
   * 支持在任务创建后修改通知邮箱
   */
  async updateMissionNotification(
    missionId: string,
    _userId: string,
    dto: { notificationEmail?: string | null },
    createLog: CreateLogFn,
  ) {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
    });

    if (!mission) {
      throw new NotFoundException("任务不存在");
    }

    const updated = await this.prisma.teamMission.update({
      where: { id: missionId },
      data: {
        notificationEmail: dto.notificationEmail ?? null,
      },
      select: {
        id: true,
        notificationEmail: true,
      },
    });

    await createLog(missionId, {
      type: MissionLogType.TASK_PROGRESS,
      content: dto.notificationEmail
        ? `通知邮箱已更新为: ${dto.notificationEmail}`
        : "通知邮箱已清除",
    });

    this.logger.log(
      `[Mission ${missionId}] Notification email updated: ${dto.notificationEmail || "(cleared)"}`,
    );

    return {
      success: true,
      message: dto.notificationEmail ? "通知配置已更新" : "通知配置已清除",
      notificationEmail: updated.notificationEmail,
    };
  }

  /**
   * 暂停任务（可恢复）
   */
  async pauseMission(
    missionId: string,
    _userId: string,
    sendMessageToTopic: SendMessageToTopicFn,
    createLog: CreateLogFn,
  ) {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
      include: { leader: true },
    });

    if (!mission) {
      throw new NotFoundException("任务不存在");
    }

    // 只有 IN_PROGRESS 或 PLANNING 状态的任务可以暂停
    if (
      mission.status !== MissionStatus.IN_PROGRESS &&
      mission.status !== MissionStatus.PLANNING
    ) {
      throw new BadRequestException(
        `当前状态(${mission.status})不支持暂停，只有进行中或规划中的任务可以暂停`,
      );
    }

    // 记录暂停前的状态，以便恢复
    const previousStatus = mission.status;

    await this.prisma.teamMission.update({
      where: { id: missionId },
      data: {
        status: MissionStatus.PAUSED,
        // 将暂停前的状态保存到 metadata 中
        taskBreakdown: {
          ...((mission.taskBreakdown as object) || {}),
          _pausedFromStatus: previousStatus,
        },
      },
    });

    await createLog(missionId, {
      type: MissionLogType.MISSION_FAILED, // 使用现有类型，记录暂停
      agentId: mission.leader.id,
      agentName: mission.leader.agentName || mission.leader.displayName,
      content: `任务已暂停（从状态: ${previousStatus}）`,
    });

    // 发送暂停消息
    await sendMessageToTopic(
      mission.topicId,
      null,
      `⏸️ **任务已暂停**\n\n任务「${mission.title}」已被用户暂停，可随时恢复继续执行。`,
      MessageContentType.SYSTEM,
    );

    void this.topicEventEmitter.emitToTopic(mission.topicId, "mission:paused", {
      missionId,
      previousStatus,
    });

    return { success: true, message: "任务已暂停", previousStatus };
  }

  /**
   * 恢复已暂停的任务
   */
  async resumeMission(
    missionId: string,
    userId: string,
    sendMessageToTopic: SendMessageToTopicFn,
    createLog: CreateLogFn,
    executeNextTasks: ExecuteNextTasksFn,
    startMission: StartMissionFn,
  ) {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
      include: {
        leader: true,
        tasks: {
          include: { assignedTo: true },
        },
      },
    });

    if (!mission) {
      throw new NotFoundException("任务不存在");
    }

    if (mission.status !== MissionStatus.PAUSED) {
      throw new BadRequestException("只有已暂停的任务可以恢复");
    }

    // 获取暂停前的状态
    const taskBreakdown =
      (mission.taskBreakdown as Record<string, unknown>) || {};
    const previousStatus =
      (taskBreakdown._pausedFromStatus as MissionStatus) ||
      MissionStatus.IN_PROGRESS;

    // 清除临时状态字段
    delete taskBreakdown._pausedFromStatus;

    await this.prisma.teamMission.update({
      where: { id: missionId },
      data: {
        status: previousStatus,
        taskBreakdown: taskBreakdown as object,
      },
    });

    await createLog(missionId, {
      type: MissionLogType.TASK_STARTED, // 使用现有类型，记录恢复
      agentId: mission.leader.id,
      agentName: mission.leader.agentName || mission.leader.displayName,
      content: `任务已恢复（恢复到状态: ${previousStatus}）`,
    });

    // 发送恢复消息
    await sendMessageToTopic(
      mission.topicId,
      null,
      `▶️ **任务已恢复**\n\n任务「${mission.title}」继续执行...`,
      MessageContentType.SYSTEM,
    );

    void this.topicEventEmitter.emitToTopic(
      mission.topicId,
      "mission:resumed",
      {
        missionId,
        status: previousStatus,
      },
    );

    // 如果是 IN_PROGRESS 状态，继续执行下一批任务
    if (previousStatus === MissionStatus.IN_PROGRESS) {
      // 异步继续执行，不阻塞返回
      executeNextTasks(missionId).catch((err) => {
        this.logger.error(`Failed to resume mission ${missionId}: ${err}`);
      });
    } else if (previousStatus === MissionStatus.PLANNING) {
      // 如果是规划中状态暂停的，重新启动规划
      startMission(missionId, userId).catch((err) => {
        this.logger.error(`Failed to restart planning ${missionId}: ${err}`);
      });
    }

    return { success: true, message: "任务已恢复", status: previousStatus };
  }
}
