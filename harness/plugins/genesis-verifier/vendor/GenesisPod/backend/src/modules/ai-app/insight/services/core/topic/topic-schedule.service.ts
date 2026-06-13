import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { UpdateScheduleDto } from "../../../dto";
import { TopicRefreshScheduler } from "../../monitoring/topic-refresh.scheduler";

/**
 * TopicScheduleService
 *
 * 负责专题定时刷新计划的管理
 */
@Injectable()
export class TopicScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: TopicRefreshScheduler,
  ) {}

  /**
   * 获取刷新计划
   */
  async getSchedule(userId: string, topicId: string) {
    // 验证专题读取权限（支持公开专题访问）
    await this.verifyTopicReadAccess(userId, topicId);

    return this.scheduler.getSchedule(topicId);
  }

  /**
   * 更新刷新计划
   */
  async updateSchedule(
    userId: string,
    topicId: string,
    dto: UpdateScheduleDto,
  ) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    return this.scheduler.updateSchedule(topicId, dto.frequency, {
      dayOfWeek: dto.dayOfWeek,
      dayOfMonth: dto.dayOfMonth,
      hourOfDay: dto.hourOfDay,
    });
  }

  /**
   * 验证专题所有权（仅创建者可访问，用于写入操作）
   */
  private async verifyTopicOwnership(
    userId: string,
    topicId: string,
  ): Promise<void> {
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { userId: true },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    if (topic.userId !== userId) {
      throw new ForbiddenException(
        "You do not have permission to access this topic",
      );
    }
  }

  /**
   * 验证专题读取权限（支持公开专题访问，用于只读操作）
   */
  private async verifyTopicReadAccess(
    userId: string,
    topicId: string,
  ): Promise<void> {
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { userId: true },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    // 创建者始终有权限
    if (topic.userId === userId) {
      return;
    }

    // 检查 visibility 和协作者状态
    const hasAccess = await this.checkTopicAccess(
      userId,
      topicId,
      topic.userId,
    );
    if (!hasAccess) {
      throw new ForbiddenException(
        "You do not have permission to access this topic",
      );
    }
  }

  /**
   * 检查用户是否有权访问专题
   */
  private async checkTopicAccess(
    userId: string,
    topicId: string,
    ownerId: string,
  ): Promise<boolean> {
    // 1. 创建者始终有权限
    if (userId === ownerId) {
      return true;
    }

    // 2. 检查visibility和协作者状态
    const result = await this.prisma.$queryRaw<
      { visibility: string; is_collaborator: boolean }[]
    >`
      SELECT
        rt.visibility,
        EXISTS(
          SELECT 1 FROM research_topic_collaborators tc
          WHERE tc."topic_id" = rt.id
            AND tc."user_id" = ${userId}
            AND tc."is_active" = true
        ) as is_collaborator
      FROM research_topics rt
      WHERE rt.id = ${topicId}
    `;

    if (!result.length) {
      return false;
    }

    const { visibility, is_collaborator } = result[0];

    // PUBLIC: 所有登录用户可见
    if (visibility === "PUBLIC") {
      return true;
    }

    // SHARED: 协作者可见
    if (visibility === "SHARED" && is_collaborator) {
      return true;
    }

    // PRIVATE: 只有创建者可见（已在上面检查过）
    return false;
  }
}
