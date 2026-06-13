import { Injectable, Logger } from "@nestjs/common";
import { KeyAssignmentStatus, KeyRequestStatus } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * 管理员 BYOK 仪表盘服务（指标聚合 + 分配维护）。
 * standards/24 薄网关整改（Wave C）：原逻辑在 open-api/admin/byok/admin-byok-dashboard
 * controller 内直接操作 Prisma；下沉到 platform/credentials（BYOK 唯一领域家）。
 */
@Injectable()
export class ByokDashboardService {
  private readonly logger = new Logger(ByokDashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getMetrics() {
    const [
      totalModels,
      enabledModels,
      activeAssignments,
      pendingRequests,
      userSpendAggregate,
    ] = await Promise.all([
      this.prisma.aIModel.count(),
      this.prisma.aIModel.count({ where: { isEnabled: true } }),
      this.prisma.keyAssignment.count({
        where: { status: KeyAssignmentStatus.ACTIVE },
      }),
      this.prisma.keyRequest.count({
        where: { status: KeyRequestStatus.PENDING },
      }),
      this.prisma.keyAssignment.aggregate({
        where: { status: KeyAssignmentStatus.ACTIVE },
        _sum: { userSpendCents: true, userQuotaCents: true },
      }),
    ]);

    const totalSpendCents = userSpendAggregate._sum.userSpendCents ?? 0;
    const totalQuotaCents = userSpendAggregate._sum.userQuotaCents ?? null;

    return {
      totalModels,
      enabledModels,
      activeAssignments,
      pendingRequests,
      totalSpendCents,
      totalQuotaCents,
      utilizationPercent:
        totalQuotaCents && totalQuotaCents > 0
          ? Math.round((totalSpendCents / totalQuotaCents) * 100)
          : null,
    };
  }

  async expireAssignments() {
    const result = await this.prisma.keyAssignment.updateMany({
      where: {
        status: KeyAssignmentStatus.ACTIVE,
        validityType: "ONE_TIME",
        expiresAt: { lt: new Date() },
      },
      data: { status: KeyAssignmentStatus.EXPIRED },
    });
    this.logger.log(
      `[expire-assignments] Marked ${result.count} ONE_TIME assignments as EXPIRED`,
    );
    return { expiredCount: result.count };
  }

  async expiringSoon() {
    const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const items = await this.prisma.keyAssignment.findMany({
      where: {
        status: KeyAssignmentStatus.ACTIVE,
        expiresAt: { gt: new Date(), lt: sevenDaysLater },
      },
      select: {
        id: true,
        userId: true,
        provider: true,
        modelId: true,
        expiresAt: true,
        userQuotaCents: true,
        userSpendCents: true,
      },
      orderBy: { expiresAt: "asc" },
      take: 100,
    });
    return { items };
  }
}
