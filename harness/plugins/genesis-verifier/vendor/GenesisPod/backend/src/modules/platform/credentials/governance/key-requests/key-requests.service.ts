import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  KeyAssignment,
  KeyRequest,
  KeyRequestStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { KeyAssignmentsService } from "../key-assignments/key-assignments.service";
import { NotificationPresetsService } from "@/modules/platform/notifications/presets/notification-presets.service";

export type EstimatedUsage = "LIGHT" | "MEDIUM" | "HEAVY";

export interface CreateKeyRequestInput {
  reason?: string;
  estimatedUsage?: EstimatedUsage;
  note?: string;
}

export interface ApproveKeyRequestInput {
  /** 2026-05-08 v5（drop_distributable_keys）：审批时选具体 AIModel.id，不再选密钥池 */
  modelDbId: string;
  userQuotaCents?: number | null;
  expiresAt?: Date | null;
  approvedBy: string;
  note?: string;
}

const ESTIMATED_USAGE_VALUES: readonly EstimatedUsage[] = [
  "LIGHT",
  "MEDIUM",
  "HEAVY",
];

@Injectable()
export class KeyRequestsService {
  private readonly logger = new Logger(KeyRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyAssignments: KeyAssignmentsService,
    /**
     * Optional：通知发送是 fire-and-forget，模块拼装失败时不应阻塞密钥申请主流程。
     * 测试 / 局部场景可以不注入，create/approve/reject 走 graceful no-op。
     */
    @Optional()
    private readonly notifyPresets?: NotificationPresetsService,
  ) {}

  /**
   * 抓所有 ADMIN role 用户的 id 列表。仅用于 fan-out 通知；
   * 失败时返回空数组（绝不抛错阻塞 KeyRequest 主流程）。
   */
  private async listAdminUserIds(): Promise<string[]> {
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: "ADMIN" },
        select: { id: true },
      });
      return admins.map((a) => a.id);
    } catch (err) {
      this.logger.warn(
        `[notify] listAdminUserIds failed: ${(err as Error).message}`,
      );
      return [];
    }
  }

  async create(
    userId: string,
    input: CreateKeyRequestInput,
  ): Promise<KeyRequest> {
    if (
      input.estimatedUsage &&
      !ESTIMATED_USAGE_VALUES.includes(input.estimatedUsage)
    ) {
      throw new BadRequestException("Invalid estimatedUsage value");
    }

    // 防重复：每用户最多 1 条 PENDING（不再按 provider 分桶）
    const existing = await this.prisma.keyRequest.findFirst({
      where: { userId, status: KeyRequestStatus.PENDING },
    });
    if (existing) {
      throw new ConflictException(
        "You already have a pending key request; please wait for admin to handle it",
      );
    }

    const created = await this.prisma.keyRequest.create({
      data: {
        userId,
        provider: null,
        reason: input.reason?.trim() || null,
        estimatedUsage: input.estimatedUsage ?? null,
        note: input.note?.trim() || null,
      },
    });

    // fire-and-forget: fan-out 给所有 admin
    void this.notifySubmitted(created).catch((err) =>
      this.logger.warn(
        `[notify] notifySubmitted failed for request ${created.id}: ${(err as Error).message}`,
      ),
    );

    return created;
  }

  private async notifySubmitted(request: KeyRequest): Promise<void> {
    if (!this.notifyPresets) return;
    const adminUserIds = await this.listAdminUserIds();
    if (adminUserIds.length === 0) return;
    const requester = await this.prisma.user.findUnique({
      where: { id: request.userId },
      select: { email: true },
    });
    await this.notifyPresets.notifyKeyRequestSubmitted({
      adminUserIds,
      requestId: request.id,
      requesterEmail: requester?.email ?? request.userId,
      estimatedUsage: request.estimatedUsage ?? null,
    });
  }

  async cancel(id: string, userId: string): Promise<KeyRequest> {
    const request = await this.prisma.keyRequest.findUnique({ where: { id } });
    if (!request || request.userId !== userId) {
      throw new NotFoundException("Request not found");
    }
    if (request.status !== KeyRequestStatus.PENDING) {
      throw new ConflictException("Only PENDING requests can be cancelled");
    }
    return this.prisma.keyRequest.update({
      where: { id },
      data: { status: KeyRequestStatus.CANCELLED },
    });
  }

  /**
   * 管理员批准：先校验 request 状态 → 再创建 Assignment → 再更新 Request。
   *
   * 2026-05-08 v5: 用 grantBatch 单 model 调用替代旧 assign（assign 已删）。
   * 失败时补偿 revoke 刚创建的 assignment 保持一致性。
   */
  async approve(
    requestId: string,
    input: ApproveKeyRequestInput,
  ): Promise<{ request: KeyRequest; assignment: KeyAssignment }> {
    const request = await this.prisma.keyRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException("Request not found");
    if (request.status !== KeyRequestStatus.PENDING) {
      throw new ConflictException("Request already handled");
    }

    // 用 grantBatch 单 model 创建（单 ONE_TIME 授权）
    // skipUserNotification=true：approve 路径下游会自己发 KEY_REQUEST_APPROVED，
    // 避免 grantBatch 再发一条 KEY_GRANTED 让用户收双份通知
    const result = await this.keyAssignments.grantBatch({
      userId: request.userId,
      models: [
        {
          modelDbId: input.modelDbId,
          userQuotaCents: input.userQuotaCents ?? null,
        },
      ],
      validityType: "ONE_TIME",
      expiresAt: input.expiresAt ?? null,
      assignedBy: input.approvedBy,
      note:
        input.note?.trim() || `Approved from request #${requestId.slice(0, 8)}`,
      skipUserNotification: true,
    });

    if (result.failed.length > 0 || result.succeeded.length === 0) {
      const reason =
        result.failed[0]?.reason ?? "Unknown error creating assignment";
      throw new BadRequestException(`Approval failed: ${reason}`);
    }
    const assignment = result.succeeded[0];

    try {
      const updated = await this.prisma.keyRequest.update({
        where: { id: requestId, status: KeyRequestStatus.PENDING },
        data: {
          status: KeyRequestStatus.APPROVED,
          handledBy: input.approvedBy,
          handledAt: new Date(),
          resultingAssignmentId: assignment.id,
        },
      });

      // fire-and-forget: 通知申请人。provider 取自 assignment（admin 实际给的），
      // 不取自 request.provider（用户提交时已不指定 provider）。
      if (this.notifyPresets) {
        void this.notifyPresets
          .notifyKeyRequestApproved({
            userId: updated.userId,
            requestId: updated.id,
            provider: assignment.provider,
            modelId: assignment.modelId,
          })
          .catch((err) =>
            this.logger.warn(
              `[notify] notifyKeyRequestApproved failed for ${updated.id}: ${(err as Error).message}`,
            ),
          );
      }

      return { request: updated, assignment };
    } catch (error) {
      this.logger.error(
        `[approve] Failed to mark request ${requestId} APPROVED after ` +
          `assignment ${assignment.id} was created. Compensating by ` +
          `revoking assignment. Original error: ${(error as Error).message}`,
      );
      await this.keyAssignments
        .revoke(
          assignment.id,
          input.approvedBy,
          "Auto-rollback: approve failed to update request status",
        )
        .catch((rollbackErr) =>
          this.logger.error(
            `[approve] Rollback failed for assignment ${assignment.id}: ` +
              `${(rollbackErr as Error).message}. Manual cleanup required.`,
          ),
        );
      throw error;
    }
  }

  async reject(
    requestId: string,
    rejectedBy: string,
    reason: string,
  ): Promise<KeyRequest> {
    if (!reason?.trim()) {
      throw new BadRequestException("Rejection reason is required");
    }
    const request = await this.prisma.keyRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException("Request not found");
    if (request.status !== KeyRequestStatus.PENDING) {
      throw new ConflictException("Request already handled");
    }
    const updated = await this.prisma.keyRequest.update({
      where: { id: requestId },
      data: {
        status: KeyRequestStatus.REJECTED,
        handledBy: rejectedBy,
        handledAt: new Date(),
        rejectionReason: reason.trim(),
      },
    });

    // fire-and-forget: 通知申请人。reject 路径无 assignment，provider 直接为空。
    if (this.notifyPresets) {
      void this.notifyPresets
        .notifyKeyRequestRejected({
          userId: updated.userId,
          requestId: updated.id,
          reason: reason.trim(),
        })
        .catch((err) =>
          this.logger.warn(
            `[notify] notifyKeyRequestRejected failed for ${updated.id}: ${(err as Error).message}`,
          ),
        );
    }

    return updated;
  }

  async listMine(userId: string): Promise<KeyRequest[]> {
    return this.prisma.keyRequest.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }],
      take: 50,
    });
  }

  async listPending(filters?: {
    take?: number;
    skip?: number;
  }): Promise<KeyRequest[]> {
    return this.prisma.keyRequest.findMany({
      where: { status: KeyRequestStatus.PENDING },
      orderBy: [{ createdAt: "asc" }],
      take: filters?.take ?? 50,
      skip: filters?.skip ?? 0,
    });
  }

  async listAll(filters?: {
    status?: KeyRequestStatus;
    userId?: string;
    provider?: string;
    take?: number;
    skip?: number;
  }): Promise<KeyRequest[]> {
    const where: Prisma.KeyRequestWhereInput = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.userId) where.userId = filters.userId;
    if (filters?.provider) where.provider = filters.provider.toLowerCase();
    return this.prisma.keyRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: filters?.take ?? 50,
      skip: filters?.skip ?? 0,
    });
  }

  async hasPendingForProvider(
    userId: string,
    provider: string,
  ): Promise<boolean> {
    const count = await this.prisma.keyRequest.count({
      where: {
        userId,
        provider: provider.toLowerCase(),
        status: KeyRequestStatus.PENDING,
      },
    });
    return count > 0;
  }
}
