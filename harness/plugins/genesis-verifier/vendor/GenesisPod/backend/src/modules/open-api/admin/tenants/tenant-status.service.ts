import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";

export type TenantActivityStatus = "attention" | "running" | "active" | "idle";

export interface TenantStatusRow {
  userId: string;
  email: string;
  username: string | null;
  fullName: string | null;
  role: string;
  isActive: boolean;
  subscriptionTier: string;
  status: TenantActivityStatus;
  lastActiveAt: string | null;
  runningProcesses: number;
  failedProcesses: number;
  llmCalls: number;
  llmFailures: number;
  tokens: number;
  creditsBalance: number;
  creditsSpentToday: number;
  errors: number;
}

export interface TenantStatusResponseDto {
  timestamp: string;
  windowHours: number;
  total: number;
  /** 聚合范围被 MAX_TENANTS 截断时为 true（按注册时间最早的 N 个） */
  capped: boolean;
  summary: {
    totalTenants: number;
    activeTenants: number;
    runningProcesses: number;
    llmCalls: number;
    llmFailures: number;
    errors: number;
  };
  tenants: TenantStatusRow[];
}

/** 单次聚合的租户上限——超过后只聚合前 N 个并标记 capped */
const MAX_TENANTS = 1000;

const STATUS_PRIORITY: Record<TenantActivityStatus, number> = {
  attention: 0,
  running: 1,
  active: 2,
  idle: 3,
};

/**
 * Tenant Status Service
 * 管理员视角的"所有租户状态"聚合。当前平台租户 = 用户（无 Organization 模型，
 * Workspace 为单用户私有）；接口按 tenant 语义命名，未来引入组织时只需替换聚合维度。
 */
@Injectable()
export class TenantStatusService {
  private readonly logger = new Logger(TenantStatusService.name);

  constructor(private prisma: PrismaService) {}

  async getTenantStatus(opts: {
    hours: number;
    limit: number;
    offset: number;
    search?: string;
  }): Promise<TenantStatusResponseDto> {
    const { hours, limit, offset, search } = opts;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" as const } },
            { username: { contains: search, mode: "insensitive" as const } },
            { fullName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          username: true,
          fullName: true,
          role: true,
          isActive: true,
          subscriptionTier: true,
        },
        orderBy: { createdAt: "asc" },
        take: MAX_TENANTS,
      }),
    ]);

    const ids = users.map((u) => u.id);

    const [
      runningGroups,
      failedGroups,
      metricGroups,
      failureGroups,
      errorGroups,
      creditAccounts,
      loginGroups,
    ] = await Promise.all([
      this.safeQuery(
        () =>
          this.prisma.agentProcess.groupBy({
            by: ["userId"],
            where: { userId: { in: ids }, state: "RUNNING" },
            _count: { _all: true },
          }),
        [],
      ),
      this.safeQuery(
        () =>
          this.prisma.agentProcess.groupBy({
            by: ["userId"],
            where: {
              userId: { in: ids },
              state: "FAILED",
              updatedAt: { gte: since },
            },
            _count: { _all: true },
          }),
        [],
      ),
      this.safeQuery(
        () =>
          this.prisma.aIEngineMetric.groupBy({
            by: ["userId"],
            where: { userId: { in: ids }, createdAt: { gte: since } },
            _count: { _all: true },
            _sum: { totalTokens: true },
            _max: { createdAt: true },
          }),
        [],
      ),
      this.safeQuery(
        () =>
          this.prisma.aIEngineMetric.groupBy({
            by: ["userId"],
            where: {
              userId: { in: ids },
              createdAt: { gte: since },
              success: false,
            },
            _count: { _all: true },
          }),
        [],
      ),
      this.safeQuery(
        () =>
          this.prisma.systemErrorLog.groupBy({
            by: ["userId"],
            where: { userId: { in: ids }, createdAt: { gte: since } },
            _count: { _all: true },
          }),
        [],
      ),
      this.safeQuery(
        () =>
          this.prisma.creditAccount.findMany({
            where: { userId: { in: ids } },
            select: {
              userId: true,
              balance: true,
              todaySpent: true,
              todayDate: true,
            },
          }),
        [],
      ),
      this.safeQuery(
        () =>
          this.prisma.loginHistory.groupBy({
            by: ["userId"],
            where: { userId: { in: ids } },
            _max: { loginAt: true },
          }),
        [],
      ),
    ]);

    const runningMap = this.toCountMap(runningGroups);
    const failedMap = this.toCountMap(failedGroups);
    const failureMap = this.toCountMap(failureGroups);
    const errorMap = this.toCountMap(errorGroups);

    const metricMap = new Map<
      string,
      { calls: number; tokens: number; lastAt: Date | null }
    >();
    for (const g of metricGroups) {
      if (!g.userId) continue;
      metricMap.set(g.userId, {
        calls: g._count._all,
        tokens: g._sum.totalTokens ?? 0,
        lastAt: g._max.createdAt,
      });
    }

    const creditMap = new Map(creditAccounts.map((a) => [a.userId, a]));
    const loginMap = new Map(
      loginGroups.map((g) => [g.userId, g._max.loginAt]),
    );

    const todayKey = new Date().toISOString().slice(0, 10);

    const rows: TenantStatusRow[] = users.map((u) => {
      const runningProcesses = runningMap.get(u.id) ?? 0;
      const failedProcesses = failedMap.get(u.id) ?? 0;
      const metric = metricMap.get(u.id);
      const llmFailures = failureMap.get(u.id) ?? 0;
      const errors = errorMap.get(u.id) ?? 0;
      const credit = creditMap.get(u.id);
      const lastLoginAt = loginMap.get(u.id) ?? null;

      const lastActiveAt = this.maxDate(lastLoginAt, metric?.lastAt ?? null);
      // todaySpent 只在 todayDate 是今天时有效（后端按天滚动重置）
      const creditsSpentToday =
        credit?.todayDate &&
        credit.todayDate.toISOString().slice(0, 10) === todayKey
          ? credit.todaySpent
          : 0;

      let status: TenantActivityStatus = "idle";
      if (llmFailures > 0 || errors > 0 || failedProcesses > 0) {
        status = "attention";
      } else if (runningProcesses > 0) {
        status = "running";
      } else if (
        (metric?.calls ?? 0) > 0 ||
        (lastLoginAt && lastLoginAt >= since)
      ) {
        status = "active";
      }

      return {
        userId: u.id,
        email: u.email,
        username: u.username,
        fullName: u.fullName,
        role: u.role,
        isActive: u.isActive,
        subscriptionTier: u.subscriptionTier,
        status,
        lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null,
        runningProcesses,
        failedProcesses,
        llmCalls: metric?.calls ?? 0,
        llmFailures,
        tokens: metric?.tokens ?? 0,
        creditsBalance: credit?.balance ?? 0,
        creditsSpentToday,
        errors,
      };
    });

    rows.sort((a, b) => {
      const p = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
      if (p !== 0) return p;
      const ta = a.lastActiveAt ? Date.parse(a.lastActiveAt) : 0;
      const tb = b.lastActiveAt ? Date.parse(b.lastActiveAt) : 0;
      return tb - ta;
    });

    const summary = {
      totalTenants: total,
      activeTenants: rows.filter((r) => r.status !== "idle").length,
      runningProcesses: rows.reduce((acc, r) => acc + r.runningProcesses, 0),
      llmCalls: rows.reduce((acc, r) => acc + r.llmCalls, 0),
      llmFailures: rows.reduce((acc, r) => acc + r.llmFailures, 0),
      errors: rows.reduce((acc, r) => acc + r.errors, 0),
    };

    return {
      timestamp: new Date().toISOString(),
      windowHours: hours,
      total,
      capped: total > MAX_TENANTS,
      summary,
      tenants: rows.slice(offset, offset + limit),
    };
  }

  private toCountMap(
    groups: Array<{ userId: string | null; _count: { _all: number } }>,
  ): Map<string, number> {
    const map = new Map<string, number>();
    for (const g of groups) {
      if (g.userId) map.set(g.userId, g._count._all);
    }
    return map;
  }

  private maxDate(a: Date | null, b: Date | null): Date | null {
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }

  /** 表不存在等异常时回退默认值，保证状态接口永不 500 */
  private async safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      this.logger.debug(`tenant-status query failed: ${e}`);
      return fallback;
    }
  }
}
