import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuthRequestStatus } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  ApproveAuthorizationDto,
  CreateAuthorizationRequestDto,
  RejectAuthorizationDto,
} from "../../../../open-api/user/byok/dto/authorization.dto";

/**
 * 2026-05-27 BYOK：用户向系统申请授权（工具/技能）+ admin 审批。
 * 批准时生成 AuthorizationGrant（ToolKeyResolverService 据此让用户走系统资源）。
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 用户侧 ----------

  async createRequest(userId: string, dto: CreateAuthorizationRequestDto) {
    // 同一 target 已有 PENDING 申请则不重复建
    const existing = await this.prisma.authorizationRequest.findFirst({
      where: {
        userId,
        type: dto.type,
        targetId: dto.targetId,
        status: AuthRequestStatus.PENDING,
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException("该项已有待审批的申请，请勿重复提交");
    }
    return this.prisma.authorizationRequest.create({
      data: {
        userId,
        type: dto.type,
        targetId: dto.targetId,
        category: dto.category ?? null,
        reason: dto.reason ?? null,
      },
    });
  }

  async listMyRequests(userId: string) {
    return this.prisma.authorizationRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async listMyGrants(userId: string) {
    return this.prisma.authorizationGrant.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
  }

  /** 用户撤回自己的待审批申请（owner 校验）。 */
  async cancelRequest(userId: string, id: string) {
    const req = await this.prisma.authorizationRequest.findFirst({
      where: { id, userId },
    });
    if (!req) throw new NotFoundException("申请不存在或无权限");
    if (req.status !== AuthRequestStatus.PENDING) {
      throw new BadRequestException("仅可撤回待审批的申请");
    }
    await this.prisma.authorizationRequest.delete({ where: { id } });
    return { success: true };
  }

  // ---------- 管理员侧 ----------

  async listPending() {
    return this.prisma.authorizationRequest.findMany({
      where: { status: AuthRequestStatus.PENDING },
      orderBy: { createdAt: "asc" },
    });
  }

  /** 批准：标记 APPROVED + 生成 Grant。 */
  async approve(
    adminId: string,
    requestId: string,
    dto: ApproveAuthorizationDto,
  ) {
    const req = await this.prisma.authorizationRequest.findUnique({
      where: { id: requestId },
    });
    if (!req) throw new NotFoundException("申请不存在");
    if (req.status !== AuthRequestStatus.PENDING) {
      throw new BadRequestException("该申请已处理");
    }
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;

    const [, grant] = await this.prisma.$transaction([
      this.prisma.authorizationRequest.update({
        where: { id: requestId },
        data: {
          status: AuthRequestStatus.APPROVED,
          approverId: adminId,
          approverNote: dto.note ?? null,
          expiresAt,
          decidedAt: new Date(),
        },
      }),
      this.prisma.authorizationGrant.create({
        data: {
          userId: req.userId,
          type: req.type,
          targetId: req.targetId,
          requestId: req.id,
          grantedBy: adminId,
          expiresAt,
        },
      }),
    ]);
    return grant;
  }

  async reject(
    adminId: string,
    requestId: string,
    dto: RejectAuthorizationDto,
  ) {
    const req = await this.prisma.authorizationRequest.findUnique({
      where: { id: requestId },
    });
    if (!req) throw new NotFoundException("申请不存在");
    if (req.status !== AuthRequestStatus.PENDING) {
      throw new BadRequestException("该申请已处理");
    }
    return this.prisma.authorizationRequest.update({
      where: { id: requestId },
      data: {
        status: AuthRequestStatus.REJECTED,
        approverId: adminId,
        approverNote: dto.note ?? null,
        decidedAt: new Date(),
      },
    });
  }

  /** 撤销已生效授权（幂等防御：已撤销的不重复覆盖 revokedAt，保护审计时间）。 */
  async revokeGrant(grantId: string, adminId?: string) {
    const grant = await this.prisma.authorizationGrant.findUnique({
      where: { id: grantId },
    });
    if (!grant) throw new NotFoundException("授权不存在");
    if (grant.revokedAt) {
      throw new BadRequestException("该授权已撤销");
    }
    await this.prisma.authorizationGrant.update({
      where: { id: grantId },
      data: { revokedAt: new Date(), revokedBy: adminId ?? null },
    });
    return { success: true };
  }
}
