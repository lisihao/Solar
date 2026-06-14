import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { TopicRole } from "@prisma/client";
import { NotificationPresetsService } from "../../../../platform/facade";
import { randomBytes } from "crypto";

// Type definitions for invitation (until Prisma client is regenerated)
type InvitationStatusType =
  | "PENDING"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED"
  | "CANCELLED";

interface InvitationRecord {
  id: string;
  topic_id: string;
  inviter_id: string;
  invitee_id: string | null;
  invitee_email: string | null;
  invite_code: string | null;
  role: string;
  message: string | null;
  status: string;
  expires_at: Date;
  responded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * 处理团队邀请
 * 支持创建邀请、接受、拒绝、过期处理
 */
@Injectable()
export class TopicInvitationService {
  private readonly logger = new Logger(TopicInvitationService.name);

  constructor(
    private prisma: PrismaService,
    private notificationPresetsService: NotificationPresetsService,
  ) {}

  /**
   * 创建邀请（通过用户ID）
   */
  async createInvitation(
    topicId: string,
    inviterId: string,
    params: {
      inviteeId?: string;
      inviteeEmail?: string;
      role?: TopicRole;
      message?: string;
      expiresInDays?: number;
    },
  ) {
    const {
      inviteeId,
      inviteeEmail,
      role = TopicRole.MEMBER,
      message,
      expiresInDays = 7,
    } = params;

    // 验证权限
    await this.checkAdminPermission(topicId, inviterId);

    // 获取 Topic 信息
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true, name: true },
    });

    if (!topic) {
      throw new NotFoundException("Topic not found");
    }

    // 获取邀请人信息
    const inviter = await this.prisma.user.findUnique({
      where: { id: inviterId },
      select: { id: true, username: true, fullName: true },
    });

    // 确定被邀请人
    let targetUserId = inviteeId;
    const targetEmail = inviteeEmail;

    if (inviteeEmail && !inviteeId) {
      // 通过邮箱查找用户
      const user = await this.prisma.user.findUnique({
        where: { email: inviteeEmail.toLowerCase() },
        select: { id: true },
      });
      if (user) {
        targetUserId = user.id;
      }
    }

    // 检查是否已经是成员
    if (targetUserId) {
      const existingMembership = await this.prisma.topicMember.findUnique({
        where: {
          topicId_userId: { topicId, userId: targetUserId },
        },
      });

      if (existingMembership) {
        throw new BadRequestException("User is already a member of this topic");
      }
    }

    // 生成邀请码
    const inviteCode = randomBytes(16).toString("hex");

    // 计算过期时间
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    let invitationId: string;

    try {
      // 直接尝试创建，依赖数据库唯一约束防止重复
      // 如果存在重复，数据库会抛出 P2002 错误
      const result = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO "topic_invitations" (
          "id", "topic_id", "inviter_id", "invitee_id", "invitee_email",
          "invite_code", "role", "message", "status", "expires_at",
          "created_at", "updated_at"
        ) VALUES (
          gen_random_uuid(),
          ${topicId}::uuid,
          ${inviterId}::uuid,
          ${targetUserId || null}::uuid,
          ${targetEmail?.toLowerCase() || null},
          ${inviteCode},
          ${role}::"TopicRole",
          ${message || null},
          'PENDING'::"InvitationStatus",
          ${expiresAt},
          NOW(),
          NOW()
        )
        RETURNING id
      `;

      invitationId = result[0]?.id;
    } catch (error) {
      // 处理唯一约束冲突（并发创建重复邀请）
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new BadRequestException("User already has a pending invitation");
      }
      throw error;
    }
    this.logger.log(`Invitation created: ${invitationId} for topic ${topicId}`);

    // 如果被邀请人是已注册用户，发送通知
    if (targetUserId) {
      const inviterName = inviter?.fullName || inviter?.username || "Someone";
      await this.notificationPresetsService.notifyInvitation({
        userId: targetUserId,
        topicId,
        topicName: topic.name,
        inviterName,
        inviteCode,
      });
    }

    return {
      invitationId,
      inviteCode,
      inviteLink: `/invitations/${inviteCode}`,
    };
  }

  /**
   * 通过邀请码获取邀请详情
   */
  async getInvitationByCode(inviteCode: string) {
    const result = await this.prisma.$queryRaw<InvitationRecord[]>`
      SELECT * FROM "topic_invitations"
      WHERE "invite_code" = ${inviteCode}
    `;

    if (result.length === 0) {
      throw new NotFoundException("Invitation not found");
    }

    const invitation = result[0];

    // 检查是否过期
    if (new Date(invitation.expires_at) < new Date()) {
      if (invitation.status === "PENDING") {
        // 更新状态为过期
        await this.prisma.$queryRaw`
          UPDATE "topic_invitations"
          SET "status" = 'EXPIRED'::"InvitationStatus", "updated_at" = NOW()
          WHERE "id" = ${invitation.id}::uuid
        `;
      }
      throw new BadRequestException("Invitation has expired");
    }

    if (invitation.status !== "PENDING") {
      throw new BadRequestException(
        `Invitation is ${invitation.status.toLowerCase()}`,
      );
    }

    // 获取关联信息
    const topic = await this.prisma.topic.findUnique({
      where: { id: invitation.topic_id },
      select: { id: true, name: true, avatar: true, description: true },
    });

    const inviter = await this.prisma.user.findUnique({
      where: { id: invitation.inviter_id },
      select: { id: true, username: true, fullName: true, avatarUrl: true },
    });

    return {
      ...this.mapInvitation(invitation),
      topic,
      inviter,
    };
  }

  /**
   * 接受邀请
   */
  async acceptInvitation(inviteCode: string, userId: string) {
    const invitationData = await this.getInvitationByCode(inviteCode);

    // 验证邀请是否针对当前用户
    if (invitationData.inviteeId && invitationData.inviteeId !== userId) {
      // 检查邮箱是否匹配
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (
        invitationData.inviteeEmail?.toLowerCase() !==
        user?.email?.toLowerCase()
      ) {
        throw new ForbiddenException("This invitation is not for you");
      }
    }

    // 检查是否已经是成员
    const existingMembership = await this.prisma.topicMember.findUnique({
      where: {
        topicId_userId: { topicId: invitationData.topicId, userId },
      },
    });

    if (existingMembership) {
      throw new BadRequestException("You are already a member of this topic");
    }

    // 事务：更新邀请状态并添加成员
    const result = await this.prisma.$transaction(async (tx) => {
      // 更新邀请状态
      await tx.$queryRaw`
        UPDATE "topic_invitations"
        SET "status" = 'ACCEPTED'::"InvitationStatus",
            "invitee_id" = ${userId}::uuid,
            "responded_at" = NOW(),
            "updated_at" = NOW()
        WHERE "invite_code" = ${inviteCode}
      `;

      // 添加为成员
      const membership = await tx.topicMember.create({
        data: {
          topicId: invitationData.topicId,
          userId,
          role: invitationData.role as TopicRole,
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
          topic: {
            select: { id: true, name: true },
          },
        },
      });

      return { membership };
    });

    this.logger.log(`Invitation ${inviteCode} accepted by ${userId}`);

    return result;
  }

  /**
   * 拒绝邀请
   */
  async declineInvitation(inviteCode: string, userId: string) {
    const invitationData = await this.getInvitationByCode(inviteCode);

    // 验证邀请是否针对当前用户
    if (invitationData.inviteeId && invitationData.inviteeId !== userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (
        invitationData.inviteeEmail?.toLowerCase() !==
        user?.email?.toLowerCase()
      ) {
        throw new ForbiddenException("This invitation is not for you");
      }
    }

    await this.prisma.$queryRaw`
      UPDATE "topic_invitations"
      SET "status" = 'DECLINED'::"InvitationStatus",
          "responded_at" = NOW(),
          "updated_at" = NOW()
      WHERE "invite_code" = ${inviteCode}
    `;

    this.logger.log(`Invitation ${inviteCode} declined by ${userId}`);

    return { success: true };
  }

  /**
   * 取消邀请（管理员）
   */
  async cancelInvitation(
    topicId: string,
    invitationId: string,
    userId: string,
  ) {
    // 验证权限
    await this.checkAdminPermission(topicId, userId);

    const result = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "topic_invitations"
      SET "status" = 'CANCELLED'::"InvitationStatus", "updated_at" = NOW()
      WHERE "id" = ${invitationId}::uuid
      AND "topic_id" = ${topicId}::uuid
      AND "status" = 'PENDING'::"InvitationStatus"
      RETURNING id
    `;

    if (result.length === 0) {
      throw new NotFoundException("Invitation not found or already processed");
    }

    return { success: true };
  }

  /**
   * 清理过期邀请
   */
  async cleanupExpiredInvitations(): Promise<number> {
    const result = await this.prisma.$queryRaw<{ count: bigint }[]>`
      WITH updated AS (
        UPDATE "topic_invitations"
        SET "status" = 'EXPIRED'::"InvitationStatus", "updated_at" = NOW()
        WHERE "status" = 'PENDING'::"InvitationStatus"
        AND "expires_at" < NOW()
        RETURNING 1
      )
      SELECT COUNT(*) as count FROM updated
    `;

    const count = Number(result[0]?.count || 0);
    if (count > 0) {
      this.logger.log(`Marked ${count} invitations as expired`);
    }

    return count;
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
        "You do not have permission to manage invitations",
      );
    }

    return membership;
  }

  private mapInvitation(record: InvitationRecord) {
    return {
      id: record.id,
      topicId: record.topic_id,
      inviterId: record.inviter_id,
      inviteeId: record.invitee_id,
      inviteeEmail: record.invitee_email,
      inviteCode: record.invite_code,
      role: record.role,
      message: record.message,
      status: record.status as InvitationStatusType,
      expiresAt: record.expires_at,
      respondedAt: record.responded_at,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    };
  }
}
