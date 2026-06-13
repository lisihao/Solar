import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { TopicType, TopicRole, Prisma } from "@prisma/client";

/**
 * Service responsible for managing public topics and join requests
 * Extracted from AiTeamsService to reduce file size and improve maintainability
 */
@Injectable()
export class TopicPublicService {
  private readonly logger = new Logger(TopicPublicService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 获取所有公开团队列表（所有用户可见）
   */
  async getPublicTopics(options?: { search?: string; limit?: number }) {
    const where: Prisma.TopicWhereInput = {
      type: TopicType.PUBLIC,
      archivedAt: null,
    };

    if (options?.search) {
      where.OR = [
        { name: { contains: options.search, mode: "insensitive" } },
        { description: { contains: options.search, mode: "insensitive" } },
      ];
    }

    const topics = await this.prisma.topic.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, username: true, fullName: true, avatarUrl: true },
        },
        _count: {
          select: {
            members: true,
            aiMembers: true,
            messages: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: options?.limit || 50,
    });

    return topics.map((topic) => ({
      ...topic,
      memberCount: topic._count.members,
      aiMemberCount: topic._count.aiMembers,
      messageCount: topic._count.messages,
    }));
  }

  /**
   * 申请加入团队
   */
  async requestToJoinTopic(
    topicId: string,
    userId: string,
    requestMessage?: string,
  ) {
    // 检查团队是否存在且是公开的
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      include: {
        members: {
          where: { userId },
        },
        joinRequests: {
          where: {
            userId,
            status: "PENDING",
          },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException("Team not found");
    }

    if (topic.type !== TopicType.PUBLIC) {
      throw new ForbiddenException("This team is not public");
    }

    // 检查是否已经是成员
    if (topic.members.length > 0) {
      throw new BadRequestException("You are already a member of this team");
    }

    // 检查是否已有待处理的申请
    if (topic.joinRequests.length > 0) {
      throw new BadRequestException(
        "You already have a pending request to join this team",
      );
    }

    // 创建加入请求
    const joinRequest = await this.prisma.topicJoinRequest.create({
      data: {
        topicId,
        userId,
        requestMessage,
        status: "PENDING",
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        topic: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    this.logger.log(`User ${userId} requested to join team ${topicId}`);

    return joinRequest;
  }

  /**
   * 获取团队的加入请求列表（仅管理员可见）
   */
  async getJoinRequests(topicId: string, userId: string) {
    await this.checkTopicPermission(topicId, userId, [
      TopicRole.OWNER,
      TopicRole.ADMIN,
    ]);

    const requests = await this.prisma.topicJoinRequest.findMany({
      where: {
        topicId,
        status: "PENDING",
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return requests;
  }

  /**
   * 获取用户的加入请求列表
   */
  async getMyJoinRequests(userId: string) {
    const requests = await this.prisma.topicJoinRequest.findMany({
      where: { userId },
      include: {
        topic: {
          select: {
            id: true,
            name: true,
            description: true,
            avatar: true,
          },
        },
        reviewedBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return requests;
  }

  /**
   * 审核加入请求
   */
  async reviewJoinRequest(
    requestId: string,
    userId: string,
    approve: boolean,
    responseNote?: string,
  ) {
    // 获取请求详情
    const request = await this.prisma.topicJoinRequest.findUnique({
      where: { id: requestId },
      include: {
        topic: true,
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            fullName: true,
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException("Join request not found");
    }

    if (request.status !== "PENDING") {
      throw new BadRequestException("This request has already been processed");
    }

    // 检查审核者权限
    await this.checkTopicPermission(request.topicId, userId, [
      TopicRole.OWNER,
      TopicRole.ADMIN,
    ]);

    // 更新请求状态
    const updatedRequest = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.topicJoinRequest.update({
        where: { id: requestId },
        data: {
          status: approve ? "APPROVED" : "REJECTED",
          responseNote,
          reviewedById: userId,
          reviewedAt: new Date(),
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              fullName: true,
            },
          },
          topic: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // 如果批准，添加为成员
      if (approve) {
        await tx.topicMember.create({
          data: {
            topicId: request.topicId,
            userId: request.userId,
            role: TopicRole.MEMBER,
          },
        });
        this.logger.log(
          `User ${request.userId} approved to join team ${request.topicId}`,
        );
      } else {
        this.logger.log(
          `User ${request.userId} rejected from team ${request.topicId}`,
        );
      }

      return updated;
    });

    return updatedRequest;
  }

  /**
   * 取消加入请求
   */
  async cancelJoinRequest(requestId: string, userId: string) {
    const request = await this.prisma.topicJoinRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException("Join request not found");
    }

    if (request.userId !== userId) {
      throw new ForbiddenException("You can only cancel your own requests");
    }

    if (request.status !== "PENDING") {
      throw new BadRequestException("This request has already been processed");
    }

    return this.prisma.topicJoinRequest.update({
      where: { id: requestId },
      data: { status: "CANCELLED" },
    });
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
