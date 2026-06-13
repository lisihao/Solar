import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { TopicRole, AgentWorkStyle } from "@prisma/client";
import {
  AddMemberDto,
  AddMembersDto,
  UpdateMemberDto,
  AddAIMemberDto,
  UpdateAIMemberDto,
} from "../../dto";

/**
 * Service responsible for managing topic members (both human and AI)
 * Extracted from AiTeamsService to reduce file size and improve maintainability
 */
@Injectable()
export class TopicMembershipService {
  private readonly logger = new Logger(TopicMembershipService.name);

  constructor(private prisma: PrismaService) {}

  // ==================== Human Member Management ====================

  async addMember(topicId: string, userId: string, dto: AddMemberDto) {
    await this.checkTopicPermission(topicId, userId, [
      TopicRole.OWNER,
      TopicRole.ADMIN,
    ]);

    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const existing = await this.prisma.topicMember.findUnique({
      where: {
        topicId_userId: { topicId, userId: dto.userId },
      },
    });
    if (existing) {
      throw new BadRequestException("User is already a member");
    }

    return this.prisma.topicMember.create({
      data: {
        topicId,
        userId: dto.userId,
        role: dto.role || TopicRole.MEMBER,
        nickname: dto.nickname,
      },
      include: {
        user: {
          select: { id: true, username: true, fullName: true, avatarUrl: true },
        },
      },
    });
  }

  async addMemberByEmail(
    topicId: string,
    userId: string,
    email: string,
    role?: TopicRole,
  ) {
    await this.checkTopicPermission(topicId, userId, [
      TopicRole.OWNER,
      TopicRole.ADMIN,
    ]);

    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) {
      throw new NotFoundException(`User with email "${email}" not found`);
    }

    const existing = await this.prisma.topicMember.findUnique({
      where: {
        topicId_userId: { topicId, userId: user.id },
      },
    });
    if (existing) {
      throw new BadRequestException("User is already a member");
    }

    return this.prisma.topicMember.create({
      data: {
        topicId,
        userId: user.id,
        role: role || TopicRole.MEMBER,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
            email: true,
          },
        },
      },
    });
  }

  async addMembers(topicId: string, userId: string, dto: AddMembersDto) {
    await this.checkTopicPermission(topicId, userId, [
      TopicRole.OWNER,
      TopicRole.ADMIN,
    ]);

    const results = await this.prisma.topicMember.createMany({
      data: dto.userIds.map((id) => ({
        topicId,
        userId: id,
        role: dto.role || TopicRole.MEMBER,
      })),
      skipDuplicates: true,
    });

    return { added: results.count };
  }

  async updateMember(
    topicId: string,
    userId: string,
    memberId: string,
    dto: UpdateMemberDto,
  ) {
    const currentMembership = await this.checkTopicPermission(topicId, userId, [
      TopicRole.OWNER,
      TopicRole.ADMIN,
    ]);

    const targetMember = await this.prisma.topicMember.findFirst({
      where: { topicId, userId: memberId },
    });

    if (!targetMember) {
      throw new NotFoundException("Member not found");
    }

    // 不能修改Owner的角色（除非自己是Owner）
    if (
      targetMember.role === TopicRole.OWNER &&
      currentMembership.role !== TopicRole.OWNER
    ) {
      throw new ForbiddenException("Cannot modify owner");
    }

    // Admin不能将其他人设为Owner
    if (
      dto.role === TopicRole.OWNER &&
      currentMembership.role !== TopicRole.OWNER
    ) {
      throw new ForbiddenException("Only owner can transfer ownership");
    }

    return this.prisma.topicMember.update({
      where: { id: targetMember.id },
      data: dto,
      include: {
        user: {
          select: { id: true, username: true, fullName: true, avatarUrl: true },
        },
      },
    });
  }

  async removeMember(topicId: string, userId: string, memberId: string) {
    await this.checkTopicPermission(topicId, userId, [
      TopicRole.OWNER,
      TopicRole.ADMIN,
    ]);

    const targetMember = await this.prisma.topicMember.findFirst({
      where: { topicId, userId: memberId },
    });

    if (!targetMember) {
      throw new NotFoundException("Member not found");
    }

    // 不能移除Owner
    if (targetMember.role === TopicRole.OWNER) {
      throw new ForbiddenException("Cannot remove owner");
    }

    return this.prisma.topicMember.delete({
      where: { id: targetMember.id },
    });
  }

  async leaveTopic(topicId: string, userId: string) {
    const membership = await this.prisma.topicMember.findUnique({
      where: {
        topicId_userId: { topicId, userId },
      },
    });

    if (!membership) {
      throw new NotFoundException("You are not a member of this topic");
    }

    // Owner不能直接离开，需要先转让所有权
    if (membership.role === TopicRole.OWNER) {
      const otherMembers = await this.prisma.topicMember.count({
        where: { topicId, userId: { not: userId } },
      });
      if (otherMembers > 0) {
        throw new BadRequestException(
          "Owner must transfer ownership before leaving",
        );
      }
      // 如果只有Owner一个人，删除整个Topic
      return this.prisma.topic.delete({ where: { id: topicId } });
    }

    return this.prisma.topicMember.delete({
      where: { id: membership.id },
    });
  }

  // ==================== AI Member Management ====================

  async addAIMember(topicId: string, userId: string, dto: AddAIMemberDto) {
    await this.checkTopicPermission(topicId, userId, [
      TopicRole.OWNER,
      TopicRole.ADMIN,
    ]);

    const existing = await this.prisma.topicAIMember.findUnique({
      where: {
        topicId_aiModel_displayName: {
          topicId,
          aiModel: dto.aiModel,
          displayName: dto.displayName,
        },
      },
    });
    if (existing) {
      throw new BadRequestException("AI member with this name already exists");
    }

    return this.prisma.topicAIMember.create({
      data: {
        topicId,
        addedById: userId,
        ...dto,
      },
    });
  }

  async updateAIMember(
    topicId: string,
    userId: string,
    aiMemberId: string,
    dto: UpdateAIMemberDto,
  ) {
    await this.checkTopicPermission(topicId, userId, [
      TopicRole.OWNER,
      TopicRole.ADMIN,
    ]);

    const aiMember = await this.prisma.topicAIMember.findFirst({
      where: { id: aiMemberId, topicId },
    });

    if (!aiMember) {
      throw new NotFoundException("AI member not found");
    }

    return this.prisma.topicAIMember.update({
      where: { id: aiMemberId },
      data: dto,
    });
  }

  async removeAIMember(topicId: string, userId: string, aiMemberId: string) {
    await this.checkTopicPermission(topicId, userId, [
      TopicRole.OWNER,
      TopicRole.ADMIN,
    ]);

    const aiMember = await this.prisma.topicAIMember.findFirst({
      where: { id: aiMemberId, topicId },
    });

    if (!aiMember) {
      throw new NotFoundException("AI member not found");
    }

    // Use transaction to safely delete AI member and related records
    return this.prisma.$transaction(async (tx) => {
      // Delete all tasks assigned to this AI
      await tx.agentTask.deleteMany({
        where: { assignedToId: aiMemberId },
      });

      // Delete all missions led by this AI
      await tx.teamMission.deleteMany({
        where: { leaderId: aiMemberId },
      });

      // Delete the AI member
      return tx.topicAIMember.delete({
        where: { id: aiMemberId },
      });
    });
  }

  async updateAIMemberTeamRole(
    topicId: string,
    userId: string,
    aiMemberId: string,
    dto: {
      agentName?: string;
      agentIdentity?: string;
      isLeader?: boolean;
      expertiseAreas?: string[];
      workStyle?: string;
    },
  ) {
    await this.checkTopicPermission(topicId, userId, [
      TopicRole.OWNER,
      TopicRole.ADMIN,
    ]);

    const aiMember = await this.prisma.topicAIMember.findFirst({
      where: { id: aiMemberId, topicId },
    });

    if (!aiMember) {
      throw new NotFoundException("AI member not found");
    }

    // 如果设置为 Leader，先取消其他 Leader
    if (dto.isLeader === true) {
      await this.prisma.topicAIMember.updateMany({
        where: { topicId, isLeader: true, id: { not: aiMemberId } },
        data: { isLeader: false },
      });
    }

    return this.prisma.topicAIMember.update({
      where: { id: aiMemberId },
      data: {
        agentName: dto.agentName,
        agentIdentity: dto.agentIdentity,
        isLeader: dto.isLeader,
        expertiseAreas: dto.expertiseAreas,
        workStyle: dto.workStyle as AgentWorkStyle | undefined,
      },
    });
  }

  /**
   * 红蓝思辨快捷设置
   * 一键创建两个 AI 成员进行辩论
   */
  async setupDebateAIs(
    topicId: string,
    userId: string,
    redAiModel: string,
    blueAiModel: string,
    debateTopic?: string,
  ) {
    await this.checkTopicPermission(topicId, userId, [
      TopicRole.OWNER,
      TopicRole.ADMIN,
    ]);

    const topicDescription = debateTopic
      ? `\n当前辩论主题：${debateTopic}`
      : "";

    // 红方 prompt
    const redPrompt = `你是【红方】辩手，负责正方立场。

## 辩论规则
1. 积极提出观点和论据，主动进攻
2. **必须使用具体数据、研究报告、权威来源作为佐证**
3. 引用时注明来源（如：根据XX研究、XX报告显示...）
4. 每次发言后必须 @蓝方 等待对方回应
5. 保持理性，专注论点而非人身攻击
6. 第3轮后进行总结陈词${topicDescription}

## 论证要求
- 使用你的知识库中的真实数据和案例
- 引用可查证的研究、报告、统计数据
- 提供具体的例子和数字支撑论点
- 如有可能，提供相关链接或来源

## 发言格式
**我方观点**：[核心论点]
**数据佐证**：[具体数据、研究、案例，注明来源]
**逻辑推理**：[论证过程]
**向对方提问**：[针对性问题]

@蓝方 请回应`;

    // 蓝方 prompt
    const bluePrompt = `你是【蓝方】辩手，负责反方立场。

## 辩论规则
1. 质疑对方观点，寻找逻辑漏洞和数据问题
2. **必须使用具体数据、研究报告、权威来源反驳**
3. 引用时注明来源（如：根据XX研究、XX报告显示...）
4. 每次发言后必须 @红方 继续辩论
5. 保持理性，专注论点而非人身攻击
6. 第3轮后进行总结陈词${topicDescription}

## 论证要求
- 检验对方数据的准确性和来源可靠性
- 提出相反的数据和研究作为反驳
- 使用你的知识库中的真实信息
- 如有可能，提供相关链接或来源

## 发言格式
**对方观点分析**：[分析对方论点的问题]
**反驳证据**：[具体数据、研究、案例，注明来源]
**逻辑漏洞**：[指出对方论证的问题]
**质疑点**：[向对方提出的问题]

@红方 请继续`;

    // 创建红方 AI
    const redAI = await this.prisma.topicAIMember.create({
      data: {
        topicId,
        addedById: userId,
        aiModel: redAiModel,
        displayName: "红方",
        roleDescription: "正方辩手，主动进攻",
        systemPrompt: redPrompt,
        canMentionOtherAI: true,
        collaborationStyle: "debate",
        contextWindow: 20,
      },
    });

    // 创建蓝方 AI
    const blueAI = await this.prisma.topicAIMember.create({
      data: {
        topicId,
        addedById: userId,
        aiModel: blueAiModel,
        displayName: "蓝方",
        roleDescription: "反方辩手，质疑反驳",
        systemPrompt: bluePrompt,
        canMentionOtherAI: true,
        collaborationStyle: "debate",
        contextWindow: 20,
      },
    });

    this.logger.log(
      `[Debate Setup] Created debate AIs for topic ${topicId}: red=${redAI.id}, blue=${blueAI.id}`,
    );

    return {
      message: "红蓝思辨 AI 设置成功",
      redAI: {
        id: redAI.id,
        displayName: redAI.displayName,
        aiModel: redAI.aiModel,
      },
      blueAI: {
        id: blueAI.id,
        displayName: blueAI.displayName,
        aiModel: blueAI.aiModel,
      },
      usage: "发送 '@红方 [你的辩题]' 开始辩论",
    };
  }

  // ==================== Helper Methods ====================

  private async checkTopicPermission(
    topicId: string,
    userId: string,
    allowedRoles: TopicRole[],
  ) {
    const membership = await this.prisma.topicMember.findUnique({
      where: {
        topicId_userId: { topicId, userId },
      },
    });

    if (!membership) {
      throw new ForbiddenException("You are not a member of this topic");
    }

    if (!allowedRoles.includes(membership.role)) {
      throw new ForbiddenException(
        "You do not have permission to perform this action",
      );
    }

    return membership;
  }
}
