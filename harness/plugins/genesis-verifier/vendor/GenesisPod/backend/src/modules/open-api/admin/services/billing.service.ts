import { Injectable, BadRequestException } from "@nestjs/common";
import { CreditTransactionType } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";

const SPEND_TYPES: CreditTransactionType[] = [
  CreditTransactionType.AI_ASK,
  CreditTransactionType.AI_TEAMS,
  CreditTransactionType.AI_OFFICE,
  CreditTransactionType.AI_SIMULATION,
  CreditTransactionType.AI_WRITING,
  CreditTransactionType.AI_IMAGE,
  CreditTransactionType.AI_SOCIAL,
  CreditTransactionType.AI_RESEARCH,
  CreditTransactionType.AI_INSIGHTS,
  CreditTransactionType.NOTEBOOK_RESEARCH,
  CreditTransactionType.AI_PLANNING,
  CreditTransactionType.LIBRARY,
  CreditTransactionType.NOTES,
  CreditTransactionType.COLLECTIONS,
];

@Injectable()
export class BillingService {
  constructor(private prisma: PrismaService) {}

  async getBillingOverview() {
    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const spendWhere = { type: { in: SPEND_TYPES } };

    const [
      totalSpentResult,
      todaySpentResult,
      monthSpentResult,
      activeSpenders,
    ] = await Promise.all([
      this.prisma.creditTransaction.aggregate({
        where: spendWhere,
        _sum: { amount: true },
      }),
      this.prisma.creditTransaction.aggregate({
        where: { ...spendWhere, createdAt: { gte: todayStart } },
        _sum: { amount: true },
      }),
      this.prisma.creditTransaction.aggregate({
        where: { ...spendWhere, createdAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.creditTransaction.groupBy({
        by: ["accountId"],
        where: { ...spendWhere, createdAt: { gte: monthStart } },
      }),
    ]);

    // amount is negative for spending, so we negate
    const totalSpent = Math.abs(totalSpentResult._sum.amount ?? 0);
    const todaySpent = Math.abs(todaySpentResult._sum.amount ?? 0);
    const monthSpent = Math.abs(monthSpentResult._sum.amount ?? 0);

    // By module
    const byModuleRaw = await this.prisma.creditTransaction.groupBy({
      by: ["moduleType"],
      where: { ...spendWhere, moduleType: { not: null } },
      _sum: { amount: true },
      _count: true,
    });
    const byModule = byModuleRaw.map((r) => ({
      module: r.moduleType,
      spent: Math.abs(r._sum.amount ?? 0),
      count: r._count,
    }));

    // By model
    const byModelRaw = await this.prisma.creditTransaction.groupBy({
      by: ["modelName"],
      where: { ...spendWhere, modelName: { not: null } },
      _sum: { amount: true, tokenCount: true },
      _count: true,
    });
    const byModel = byModelRaw.map((r) => ({
      model: r.modelName,
      spent: Math.abs(r._sum.amount ?? 0),
      tokens: r._sum.tokenCount ?? 0,
      count: r._count,
    }));

    // Daily trend (last 30 days)
    const dailyTransactions = await this.prisma.creditTransaction.findMany({
      where: { ...spendWhere, createdAt: { gte: thirtyDaysAgo } },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const dailyMap = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - (29 - i));
      const key = d.toISOString().split("T")[0];
      dailyMap.set(key, 0);
    }
    for (const tx of dailyTransactions) {
      const key = tx.createdAt.toISOString().split("T")[0];
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + Math.abs(tx.amount));
    }
    const dailyTrend = Array.from(dailyMap.entries()).map(([date, spent]) => ({
      date,
      spent,
    }));

    return {
      totalSpent,
      todaySpent,
      monthSpent,
      activeSpenders: activeSpenders.length,
      byModule,
      byModel,
      dailyTrend,
    };
  }

  async getDailyDetail(dateStr: string) {
    // Validate date format YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new BadRequestException("Invalid date format. Use YYYY-MM-DD");
    }

    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    if (isNaN(dayStart.getTime())) {
      throw new BadRequestException("Invalid date");
    }

    const spendWhere = {
      type: { in: SPEND_TYPES },
      createdAt: { gte: dayStart, lte: dayEnd },
    };

    const [transactions, byModule, byModel] = await Promise.all([
      this.prisma.creditTransaction.findMany({
        where: spendWhere,
        select: {
          id: true,
          amount: true,
          moduleType: true,
          modelName: true,
          description: true,
          createdAt: true,
          account: {
            select: {
              user: {
                select: { email: true, username: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      this.prisma.creditTransaction.groupBy({
        by: ["moduleType"],
        where: { ...spendWhere, moduleType: { not: null } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.creditTransaction.groupBy({
        by: ["modelName"],
        where: { ...spendWhere, modelName: { not: null } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      date: dateStr,
      totalSpent: transactions.reduce(
        (sum, tx) => sum + Math.abs(tx.amount),
        0,
      ),
      transactionCount: transactions.length,
      transactions: transactions.map((tx) => ({
        id: tx.id,
        amount: Math.abs(tx.amount),
        module: tx.moduleType,
        model: tx.modelName,
        description: tx.description,
        userEmail: tx.account?.user?.email ?? "-",
        userName: tx.account?.user?.username ?? null,
        createdAt: tx.createdAt,
      })),
      byModule: byModule.map((r) => ({
        module: r.moduleType,
        spent: Math.abs(r._sum.amount ?? 0),
        count: r._count,
      })),
      byModel: byModel.map((r) => ({
        model: r.modelName,
        spent: Math.abs(r._sum.amount ?? 0),
        count: r._count,
      })),
    };
  }
}
