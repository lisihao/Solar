import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { TopicRole, JoinRequestStatus } from "@prisma/client";
import { NotificationPresetsService } from "../../../../platform/facade";

/**
 * 处理团队加入申请
 * 支持申请、审批、拒绝流程
 */
@Injectable()
export class TopicJoinRequestService {
  private readonly logger = new Logger(TopicJoinRequestService.name);

  constructor(
    private prisma: PrismaService,
    private notificationPresetsService: NotificationPresetsService,
  ) {}

  /**
   * 创建加入申请
   * 使用事务和唯一约束防止竞态条件
   */
  async createJoinRequest(topicId: string, userId: string, message?: string) {
    // 检查 Topic 是否存在
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      include: {
        members: {
          where: { role: { in: [TopicRole.OWNER, TopicRole.ADMIN] } },
          select: { userId: true },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException("Topic not found");
    }

    // 检查是否已经是成员
    const existingMembership = await this.prisma.topicMember.findUnique({
      where: {
        topicId_userId: { topicId, userId },
      },
    });

    if (existingMembership) {
      throw new BadRequestException("You are already a member of this topic");
    }

    try {
      // 直接尝试创建，依赖数据库唯一约束防止重复
      // 如果存在重复，数据库会抛出 P2002 错误
      const joinRequest = await this.prisma.topicJoinRequest.create({
        data: {
          topicId,
          userId,
          requestMessage: message,
          status: JoinRequestStatus.PENDING,
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
          topic: {
            select: { id: true, name: true },
          },
        },
      });

      this.logger.log(
        `Join request created: ${joinRequest.id} for topic ${topicId}`,
      );

      // 通知管理员
      const adminUserIds = topic.members.map((m) => m.userId);
      if (adminUserIds.length > 0) {
        const applicantName =
          joinRequest.user.fullName ||
          joinRequest.user.username ||
          joinRequest.user.email;
        await this.notificationPresetsService.notifyJoinRequest({
          topicId,
          topicName: topic.name,
          applicantId: userId,
          applicantName: applicantName || "Unknown",
          adminUserIds,
        });
      }

      return joinRequest;
    } catch (error) {
      // 处理唯一约束冲突（并发创建重复申请）
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new BadRequestException(
          "You already have a pending join request",
        );
      }
      throw error;
    }
  }

  /**
   * 获取 Topic 的所有加入申请（管理员）
   */
  async getJoinRequests(
    topicId: string,
    userId: string,
    options?: {
      status?: JoinRequestStatus;
      page?: number;
      limit?: number;
    },
  ) {
    // 验证权限
    await this.checkAdminPermission(topicId, userId);

    const { status, page = 1, limit = 20 } = options || {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { topicId };
    if (status) {
      where.status = status;
    }

    const [requests, total] = await Promise.all([
      this.prisma.topicJoinRequest.findMany({
        where,
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
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.topicJoinRequest.count({ where }),
    ]);

    return {
      requests,
      total,
      page,
      limit,
    };
  }

  /**
   * 获取用户自己的申请记录
   */
  async getMyJoinRequests(
    userId: string,
    options?: {
      page?: number;
      limit?: number;
    },
  ) {
    const { page = 1, limit = 20 } = options || {};
    const skip = (page - 1) * limit;

    const [requests, total] = await Promise.all([
      this.prisma.topicJoinRequest.findMany({
        where: { userId },
        include: {
          topic: {
            select: { id: true, name: true, avatar: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.topicJoinRequest.count({ where: { userId } }),
    ]);

    return {
      requests,
      total,
      page,
      limit,
    };
  }

  /**
   * 批准加入申请
   */
  async approveJoinRequest(
    topicId: string,
    requestId: string,
    reviewerId: string,
    role: TopicRole = TopicRole.MEMBER,
  ) {
    // 验证权限
    await this.checkAdminPermission(topicId, reviewerId);

    const request = await this.prisma.topicJoinRequest.findFirst({
      where: { id: requestId, topicId, status: JoinRequestStatus.PENDING },
      include: {
        topic: { select: { name: true } },
        user: { select: { id: true } },
      },
    });

    if (!request) {
      throw new NotFoundException(
        "Join request not found or already processed",
      );
    }

    // 事务：更新申请状态并添加成员
    const result = await this.prisma.$transaction(async (tx) => {
      // 更新申请状态
      const updatedRequest = await tx.topicJoinRequest.update({
        where: { id: requestId },
        data: {
          status: JoinRequestStatus.APPROVED,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
        },
      });

      // 添加为成员
      const membership = await tx.topicMember.create({
        data: {
          topicId,
          userId: request.userId,
          role,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        },
      });

      return { request: updatedRequest, membership };
    });

    this.logger.log(`Join request ${requestId} approved by ${reviewerId}`);

    // 通知申请者
    await this.notificationPresetsService.notifyJoinRequestResult({
      userId: request.userId,
      topicId,
      topicName: request.topic.name,
      approved: true,
    });

    return result;
  }

  /**
   * 拒绝加入申请
   */
  async rejectJoinRequest(
    topicId: string,
    requestId: string,
    reviewerId: string,
    reason?: string,
  ) {
    // 验证权限
    await this.checkAdminPermission(topicId, reviewerId);

    const request = await this.prisma.topicJoinRequest.findFirst({
      where: { id: requestId, topicId, status: JoinRequestStatus.PENDING },
      include: {
        topic: { select: { name: true } },
      },
    });

    if (!request) {
      throw new NotFoundException(
        "Join request not found or already processed",
      );
    }

    const updatedRequest = await this.prisma.topicJoinRequest.update({
      where: { id: requestId },
      data: {
        status: JoinRequestStatus.REJECTED,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        responseNote: reason,
      },
    });

    this.logger.log(`Join request ${requestId} rejected by ${reviewerId}`);

    // 通知申请者
    await this.notificationPresetsService.notifyJoinRequestResult({
      userId: request.userId,
      topicId,
      topicName: request.topic.name,
      approved: false,
      reason,
    });

    return updatedRequest;
  }

  /**
   * 取消自己的申请
   */
  async cancelJoinRequest(requestId: string, userId: string) {
    const request = await this.prisma.topicJoinRequest.findFirst({
      where: { id: requestId, userId, status: JoinRequestStatus.PENDING },
    });

    if (!request) {
      throw new NotFoundException(
        "Join request not found or already processed",
      );
    }

    return this.prisma.topicJoinRequest.update({
      where: { id: requestId },
      data: {
        status: JoinRequestStatus.CANCELLED,
      },
    });
  }

  // ==================== Helper Methods ====================

  private async checkAdminPermission(topicId: string, userId: string) {
    const membership = await this.prisma.topicMember.findUnique({
      where: {
        topicId_userId: { topicId, userId },
      },
    });

    if (!membership) {
      throw new ForbiddenException("You are not a member of this topic");
    }

    if (
      membership.role !== TopicRole.OWNER &&
      membership.role !== TopicRole.ADMIN
    ) {
      throw new ForbiddenException(
        "You do not have permission to manage join requests",
      );
    }

    return membership;
  }
}
