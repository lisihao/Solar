/**
 * Team Message Service
 *
 * 负责消息和日志处理，从 TeamMissionService 中提取
 * - createLog: 创建 Mission 日志
 * - sendMessageToTopic: 发送消息到 Topic
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { MissionLogType, MessageContentType, Prisma } from "@prisma/client";
import { TopicEventEmitterService } from "../../events";

@Injectable()
export class TeamMessageService {
  private readonly logger = new Logger(TeamMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly topicEventEmitter: TopicEventEmitterService,
  ) {}

  /**
   * 创建 Mission 日志
   */
  async createLog(
    missionId: string,
    data: {
      type: MissionLogType;
      agentId?: string;
      agentName?: string;
      taskId?: string;
      taskTitle?: string;
      content: string;
      messageId?: string;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    return this.prisma.missionLog.create({
      data: {
        missionId,
        ...data,
      },
    });
  }

  /**
   * 发送消息到 Topic
   */
  async sendMessageToTopic(
    topicId: string,
    aiMemberId: string | null,
    content: string,
    contentType: MessageContentType,
  ) {
    try {
      const message = await this.prisma.topicMessage.create({
        data: {
          topicId,
          aiMemberId,
          content,
          contentType,
        },
        include: {
          aiMember: {
            select: {
              id: true,
              displayName: true,
              agentName: true,
              avatar: true,
              aiModel: true,
            },
          },
        },
      });

      // 广播新消息
      void this.topicEventEmitter.emitToTopic(topicId, "message:new", message);

      return message;
    } catch (error) {
      this.logger.error(`Failed to send message: ${error}`);
      return null;
    }
  }
}
