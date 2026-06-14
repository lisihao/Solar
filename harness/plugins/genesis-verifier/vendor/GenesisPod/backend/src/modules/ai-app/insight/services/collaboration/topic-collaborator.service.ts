import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  NotificationService,
  NotificationTypeDto,
} from "../../../../platform/facade";
import {
  TopicCollaboratorRole,
  CollaboratorStatus as PrismaCollaboratorStatus,
} from "@prisma/client";
import {
  CollaboratorRole,
  CollaboratorStatus,
  CollaboratorResponseDto,
  TopicCollaboratorsResponseDto,
  ApplicationStatusResponseDto,
} from "../../dto/collaborator.dto";

@Injectable()
export class TopicCollaboratorService {
  private readonly logger = new Logger(TopicCollaboratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * 获取专题的所有协作者（仅返回已通过的）
   */
  async getCollaborators(
    topicId: string,
    userId: string,
  ): Promise<TopicCollaboratorsResponseDto> {
    // 验证用户有权访问该专题
    const topic = await this.prisma.researchTopic.findFirst({
      where: {
        id: topicId,
        OR: [
          { userId },
          {
            collaborators: {
              some: { userId, isActive: true, status: "ACCEPTED" },
            },
          },
        ],
      },
      include: {
        user: {
          select: { id: true, email: true, username: true, avatarUrl: true },
        },
        collaborators: {
          where: { isActive: true, status: "ACCEPTED" },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
          orderBy: { invitedAt: "desc" },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException("专题不存在或无权访问");
    }

    const collaborators: CollaboratorResponseDto[] = topic.collaborators.map(
      (c) => this.mapToDto(c),
    );

    return {
      topicId: topic.id,
      owner: {
        id: topic.user.id,
        email: topic.user.email,
        username: topic.user.username || undefined,
        avatarUrl: topic.user.avatarUrl || undefined,
      },
      collaborators,
      totalCount: collaborators.length,
    };
  }

  /**
   * 将协作者记录映射为 DTO
   */
  private mapToDto(c: {
    id: string;
    userId: string;
    role: TopicCollaboratorRole;
    status: PrismaCollaboratorStatus;
    invitedAt: Date;
    requestedAt: Date | null;
    acceptedAt: Date | null;
    reviewedAt: Date | null;
    rejectReason: string | null;
    isActive: boolean;
    user: {
      id: string;
      email: string;
      username: string | null;
      avatarUrl: string | null;
    };
  }): CollaboratorResponseDto {
    return {
      id: c.id,
      userId: c.userId,
      email: c.user.email,
      username: c.user.username || undefined,
      avatarUrl: c.user.avatarUrl || undefined,
      role: c.role as CollaboratorRole,
      status: c.status as CollaboratorStatus,
      invitedAt: c.invitedAt,
      requestedAt: c.requestedAt || undefined,
      acceptedAt: c.acceptedAt || undefined,
      reviewedAt: c.reviewedAt || undefined,
      rejectReason: c.rejectReason || undefined,
      isActive: c.isActive,
    };
  }

  /**
   * 添加协作者（邀请流程，自动通过）
   */
  async addCollaborator(
    topicId: string,
    inviterId: string,
    email: string,
    role: CollaboratorRole = CollaboratorRole.VIEWER,
  ): Promise<CollaboratorResponseDto> {
    // 验证邀请者是所有者或管理员
    const topic = await this.prisma.researchTopic.findFirst({
      where: {
        id: topicId,
        OR: [
          { userId: inviterId },
          {
            collaborators: {
              some: {
                userId: inviterId,
                role: "ADMIN",
                isActive: true,
                status: "ACCEPTED",
              },
            },
          },
        ],
      },
    });

    if (!topic) {
      throw new ForbiddenException("无权添加协作者");
    }

    // 查找用户
    const userToAdd = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, username: true, avatarUrl: true },
    });

    if (!userToAdd) {
      throw new NotFoundException(`用户 ${email} 不存在`);
    }

    // 检查是否是所有者
    if (userToAdd.id === topic.userId) {
      throw new BadRequestException("不能将所有者添加为协作者");
    }

    // 检查是否已经是协作者
    const existing = await this.prisma.topicCollaborator.findUnique({
      where: {
        topicId_userId: { topicId, userId: userToAdd.id },
      },
    });

    const now = new Date();

    if (existing) {
      if (existing.isActive && existing.status === "ACCEPTED") {
        throw new BadRequestException("该用户已是协作者");
      }
      // 重新激活或覆盖申请
      const updated = await this.prisma.topicCollaborator.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          role: role as TopicCollaboratorRole,
          status: "ACCEPTED",
          invitedById: inviterId,
          invitedAt: now,
          acceptedAt: now,
          reviewedAt: now,
          reviewedById: inviterId,
          requestedAt: null,
          rejectReason: null,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              avatarUrl: true,
            },
          },
        },
      });

      return this.mapToDto(updated);
    }

    // 创建新协作者（邀请即自动通过）
    const collaborator = await this.prisma.topicCollaborator.create({
      data: {
        topicId,
        userId: userToAdd.id,
        role: role as TopicCollaboratorRole,
        status: "ACCEPTED",
        invitedById: inviterId,
        acceptedAt: now,
        reviewedAt: now,
        reviewedById: inviterId,
      },
      include: {
        user: {
          select: { id: true, email: true, username: true, avatarUrl: true },
        },
      },
    });

    this.logger.log(`用户 ${email} 已添加为专题 ${topicId} 的协作者 (${role})`);

    return this.mapToDto(collaborator);
  }

  /**
   * 更新协作者角色
   */
  async updateCollaboratorRole(
    topicId: string,
    collaboratorId: string,
    userId: string,
    newRole: CollaboratorRole,
  ): Promise<CollaboratorResponseDto> {
    // 验证操作者是所有者或管理员
    const topic = await this.prisma.researchTopic.findFirst({
      where: {
        id: topicId,
        OR: [
          { userId },
          {
            collaborators: {
              some: {
                userId,
                role: "ADMIN",
                isActive: true,
                status: "ACCEPTED",
              },
            },
          },
        ],
      },
    });

    if (!topic) {
      throw new ForbiddenException("无权修改协作者角色");
    }

    const collaborator = await this.prisma.topicCollaborator.findFirst({
      where: { id: collaboratorId, topicId, status: "ACCEPTED" },
      include: {
        user: {
          select: { id: true, email: true, username: true, avatarUrl: true },
        },
      },
    });

    if (!collaborator) {
      throw new NotFoundException("协作者不存在");
    }

    const updated = await this.prisma.topicCollaborator.update({
      where: { id: collaboratorId },
      data: { role: newRole as TopicCollaboratorRole },
      include: {
        user: {
          select: { id: true, email: true, username: true, avatarUrl: true },
        },
      },
    });

    return this.mapToDto(updated);
  }

  /**
   * 移除协作者
   */
  async removeCollaborator(
    topicId: string,
    collaboratorId: string,
    userId: string,
  ): Promise<void> {
    // 验证操作者是所有者或管理员
    const topic = await this.prisma.researchTopic.findFirst({
      where: {
        id: topicId,
        OR: [
          { userId },
          {
            collaborators: {
              some: {
                userId,
                role: "ADMIN",
                isActive: true,
                status: "ACCEPTED",
              },
            },
          },
        ],
      },
    });

    if (!topic) {
      throw new ForbiddenException("无权移除协作者");
    }

    const collaborator = await this.prisma.topicCollaborator.findFirst({
      where: { id: collaboratorId, topicId },
    });

    if (!collaborator) {
      throw new NotFoundException("协作者不存在");
    }

    // 软删除 - 设置为不活跃
    await this.prisma.topicCollaborator.update({
      where: { id: collaboratorId },
      data: { isActive: false },
    });

    this.logger.log(`协作者 ${collaboratorId} 已从专题 ${topicId} 移除`);
  }

  /**
   * 离开专题（协作者主动退出）
   */
  async leaveProject(topicId: string, userId: string): Promise<void> {
    const collaborator = await this.prisma.topicCollaborator.findUnique({
      where: {
        topicId_userId: { topicId, userId },
      },
    });

    if (!collaborator) {
      throw new NotFoundException("您不是该专题的协作者");
    }

    await this.prisma.topicCollaborator.update({
      where: { id: collaborator.id },
      data: { isActive: false },
    });

    this.logger.log(`用户 ${userId} 已退出专题 ${topicId}`);
  }

  /**
   * 检查用户是否有权访问专题
   *
   * 权限逻辑：
   * - PUBLIC 专题：任何登录用户都有完全访问权限
   * - SHARED 专题：所有者和协作者有访问权限
   * - PRIVATE 专题：仅所有者有访问权限
   */
  async hasAccess(
    topicId: string,
    userId: string,
    requiredRole?: CollaboratorRole,
  ): Promise<boolean> {
    const topic = await this.prisma.researchTopic.findFirst({
      where: { id: topicId },
      include: {
        collaborators: {
          where: { userId, isActive: true, status: "ACCEPTED" },
        },
      },
    });

    if (!topic) return false;

    // 所有者有全部权限
    if (topic.userId === userId) return true;

    // PUBLIC 专题：
    // - 读取操作（无 requiredRole 或 VIEWER）：所有登录用户可访问
    // - 写入操作（EDITOR/ADMIN）：仅所有者可操作（已在上面检查过）
    if (topic.visibility === "PUBLIC") {
      // 如果需要写入权限，只有所有者可以（已在上面返回了）
      if (requiredRole && requiredRole !== CollaboratorRole.VIEWER) {
        return false;
      }
      return true;
    }

    // PRIVATE 专题：只有所有者有权限（已在上面检查过）
    if (topic.visibility === "PRIVATE") return false;

    // SHARED 专题：检查协作者权限
    const collaborator = topic.collaborators[0];
    if (!collaborator) return false;

    if (!requiredRole) return true;

    // 检查角色层级
    const roleHierarchy: Record<CollaboratorRole, number> = {
      [CollaboratorRole.VIEWER]: 1,
      [CollaboratorRole.EDITOR]: 2,
      [CollaboratorRole.ADMIN]: 3,
    };

    return (
      roleHierarchy[collaborator.role as CollaboratorRole] >=
      roleHierarchy[requiredRole]
    );
  }

  // ==================== 申请审核机制 ====================

  /**
   * 用户申请加入 Topic
   */
  async requestToJoin(
    topicId: string,
    userId: string,
    _message?: string,
  ): Promise<CollaboratorResponseDto> {
    // 1. 检查 Topic 可见性（必须是 SHARED 或 PUBLIC）
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { userId: true, visibility: true, name: true },
    });

    if (!topic) {
      throw new NotFoundException("专题不存在");
    }
    if (topic.userId === userId) {
      throw new BadRequestException("不能申请加入自己的专题");
    }
    if (topic.visibility === "PRIVATE") {
      throw new ForbiddenException("该专题为私有，无法申请加入");
    }

    // 2. 检查是否已有申请/协作关系
    const existing = await this.prisma.topicCollaborator.findUnique({
      where: { topicId_userId: { topicId, userId } },
    });

    if (existing) {
      if (existing.isActive && existing.status === "ACCEPTED") {
        throw new BadRequestException("您已是该专题的协作者");
      }
      if (existing.isActive && existing.status === "PENDING") {
        throw new BadRequestException("您的申请正在审核中");
      }
      // 如果之前被拒绝或退出，可以重新申请
    }

    const now = new Date();

    // 3. 创建或更新申请记录
    const collaborator = await this.prisma.topicCollaborator.upsert({
      where: { topicId_userId: { topicId, userId } },
      create: {
        topicId,
        userId,
        invitedById: userId, // 自己申请
        status: "PENDING",
        requestedAt: now,
        role: "VIEWER", // 默认角色
      },
      update: {
        status: "PENDING",
        requestedAt: now,
        isActive: true,
        rejectReason: null,
        reviewedAt: null,
        reviewedById: null,
      },
      include: {
        user: {
          select: { id: true, email: true, username: true, avatarUrl: true },
        },
      },
    });

    this.logger.log(`用户 ${userId} 申请加入专题 ${topicId}`);

    // 4. 发送通知给 Topic 所有者
    const applicantName =
      collaborator.user.username || collaborator.user.email || "用户";
    try {
      await this.notificationService.createNotification({
        userId: topic.userId,
        type: NotificationTypeDto.JOIN_REQUEST,
        title: "新的加入申请",
        message: `${applicantName} 申请加入专题「${topic.name}」`,
        // 2026-05-12: 真实前端路由 /ai-insights/topic/[topicId]，旧 /ai-research/topics/{id}
        //  在 Next.js 不存在导致 notification 点击 404（用户截图 Screenshot 53）。
        actionUrl: `/ai-insights/topic/${topicId}?tab=team`,
        actionLabel: "查看申请",
        relatedType: "topic",
        relatedId: topicId,
        metadata: {
          topicId,
          applicantId: userId,
          applicantName,
        },
      });
    } catch (err) {
      // 通知发送失败不影响申请流程
      this.logger.warn(`发送申请通知失败: ${err}`);
    }

    return this.mapToDto(collaborator);
  }

  /**
   * 审核申请（通过/拒绝）
   */
  async reviewApplication(
    topicId: string,
    applicationId: string,
    reviewerId: string,
    decision: "ACCEPTED" | "REJECTED",
    rejectReason?: string,
  ): Promise<CollaboratorResponseDto> {
    // 1. 权限检查：只有所有者或管理员可审核
    const canReview = await this.canManageCollaborators(topicId, reviewerId);
    if (!canReview) {
      throw new ForbiddenException("无权审核申请");
    }

    // 2. 获取申请记录和专题信息
    const [collaborator, topic] = await Promise.all([
      this.prisma.topicCollaborator.findUnique({
        where: { id: applicationId },
      }),
      this.prisma.researchTopic.findUnique({
        where: { id: topicId },
        select: { name: true },
      }),
    ]);

    if (!collaborator || collaborator.topicId !== topicId) {
      throw new NotFoundException("申请不存在");
    }
    if (collaborator.status !== "PENDING") {
      throw new BadRequestException("该申请已被处理");
    }

    const now = new Date();

    // 3. 更新状态
    const updated = await this.prisma.topicCollaborator.update({
      where: { id: applicationId },
      data: {
        status: decision as PrismaCollaboratorStatus,
        reviewedAt: now,
        reviewedById: reviewerId,
        acceptedAt: decision === "ACCEPTED" ? now : null,
        rejectReason: decision === "REJECTED" ? rejectReason : null,
      },
      include: {
        user: {
          select: { id: true, email: true, username: true, avatarUrl: true },
        },
      },
    });

    this.logger.log(
      `申请 ${applicationId} 已被 ${reviewerId} ${decision === "ACCEPTED" ? "通过" : "拒绝"}`,
    );

    // 4. 发送通知给申请者
    const topicName = topic?.name || "专题";
    try {
      if (decision === "ACCEPTED") {
        await this.notificationService.createNotification({
          userId: collaborator.userId,
          type: NotificationTypeDto.JOIN_APPROVED,
          title: "加入申请已通过",
          message: `您申请加入专题「${topicName}」已被通过，现在可以参与协作`,
          // 2026-05-12: 同上，旧 /ai-research/topics/{id} 在 Next.js 不存在
          actionUrl: `/ai-insights/topic/${topicId}`,
          actionLabel: "查看专题",
          relatedType: "topic",
          relatedId: topicId,
          metadata: {
            topicId,
            topicName,
          },
        });
      } else {
        await this.notificationService.createNotification({
          userId: collaborator.userId,
          type: NotificationTypeDto.JOIN_REJECTED,
          title: "加入申请被拒绝",
          message: rejectReason
            ? `您申请加入专题「${topicName}」被拒绝：${rejectReason}`
            : `您申请加入专题「${topicName}」被拒绝`,
          relatedType: "topic",
          relatedId: topicId,
          metadata: {
            topicId,
            topicName,
            rejectReason,
          },
        });
      }
    } catch (err) {
      // 通知发送失败不影响审核流程
      this.logger.warn(`发送审核结果通知失败: ${err}`);
    }

    return this.mapToDto(updated);
  }

  /**
   * 获取待审核的申请列表
   */
  async getPendingApplications(
    topicId: string,
    userId: string,
  ): Promise<CollaboratorResponseDto[]> {
    // 权限检查
    const canView = await this.canManageCollaborators(topicId, userId);
    if (!canView) {
      throw new ForbiddenException("无权查看申请列表");
    }

    const applications = await this.prisma.topicCollaborator.findMany({
      where: {
        topicId,
        status: "PENDING",
        isActive: true,
      },
      include: {
        user: {
          select: { id: true, email: true, username: true, avatarUrl: true },
        },
      },
      orderBy: { requestedAt: "desc" },
    });

    return applications.map((a) => this.mapToDto(a));
  }

  /**
   * 获取当前用户的申请状态
   */
  async getMyApplicationStatus(
    topicId: string,
    userId: string,
  ): Promise<ApplicationStatusResponseDto> {
    const collaborator = await this.prisma.topicCollaborator.findUnique({
      where: { topicId_userId: { topicId, userId } },
      select: {
        status: true,
        isActive: true,
        requestedAt: true,
        rejectReason: true,
      },
    });

    if (!collaborator || !collaborator.isActive) {
      return { status: null };
    }

    return {
      status: collaborator.status as CollaboratorStatus,
      requestedAt: collaborator.requestedAt || undefined,
      rejectReason: collaborator.rejectReason || undefined,
    };
  }

  /**
   * 检查用户是否可以管理协作者（所有者或 ADMIN）
   */
  private async canManageCollaborators(
    topicId: string,
    userId: string,
  ): Promise<boolean> {
    const topic = await this.prisma.researchTopic.findFirst({
      where: {
        id: topicId,
        OR: [
          { userId },
          {
            collaborators: {
              some: {
                userId,
                role: "ADMIN",
                isActive: true,
                status: "ACCEPTED",
              },
            },
          },
        ],
      },
    });

    return !!topic;
  }
}
