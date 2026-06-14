import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { Decimal } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client";

/**
 * AI 引擎指标类型
 */
export type MetricType =
  | "llm_call"
  | "tool_execution"
  | "agent_execution"
  | "mission_execution";

/**
 * AI 指标摘要
 */
export interface AIMetricsSummary {
  totalCalls: number;
  successRate: number;
  avgDuration: number;
  totalTokens: number;
  estimatedCost: number;
  byModel: Record<string, { calls: number; tokens: number; cost: number }>;
  byType: Record<
    string,
    { calls: number; successRate: number; avgDuration: number }
  >;
  trend: Array<{ date: string; calls: number; tokens: number; cost: number }>;
}

/**
 * 模型使用统计
 */
export interface ModelUsageStats {
  modelId: string;
  providerId: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalTokens: number;
  avgTokensPerCall: number;
  avgDuration: number;
  estimatedCost: number;
}

/**
 * AI 引擎指标服务
 * 收集和分析 LLM 调用、工具执行、Agent 执行等指标
 */
@Injectable()
export class AIMetricsService {
  private readonly logger = new Logger(AIMetricsService.name);

  // 模型成本估算的硬编码表已删除。价格走 ModelPricingRegistry 单一权威源
  // （ai-engine/llm/models/pricing/model-pricing.registry.ts，从 ai_models 表 hydrate）。
  // 调用方传 estimatedCost 给 recordMetric，platform 层不持有价格知识。

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记录 AI 指标
   */
  async recordMetric(params: {
    metricType: MetricType;
    operationId?: string;
    modelId?: string;
    providerId?: string;
    agentId?: string;
    missionId?: string;
    userId?: string;
    duration?: number;
    inputTokens?: number;
    outputTokens?: number;
    /**
     * 调用方算好的 estimatedCost（USD）。模型价格走 ModelPricingRegistry
     * 单一源（ai_models 表），platform 层不再持有任何硬编码价格表。
     * 未传则视为 0（"模型未在 admin 配价格"）。
     */
    estimatedCost?: number;
    success: boolean;
    errorCode?: string;
    errorMsg?: string;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const totalTokens = (params.inputTokens || 0) + (params.outputTokens || 0);
    const metadata = { ...(params.metadata || {}) };

    if (
      params.metricType === "llm_call" &&
      (!metadata.module || metadata.module === "unknown")
    ) {
      metadata.module = "ai-engine";
    }

    const estimatedCost = params.estimatedCost ?? 0;

    const record = await this.prisma.aIEngineMetric.create({
      data: {
        metricType: params.metricType,
        operationId: params.operationId,
        modelId: params.modelId,
        providerId: params.providerId,
        agentId: params.agentId,
        missionId: params.missionId,
        userId: params.userId,
        duration: params.duration,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        totalTokens,
        estimatedCost,
        success: params.success,
        errorCode: params.errorCode,
        errorMsg: params.errorMsg,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    if (!params.success) {
      this.logger.warn(
        `[AIMetrics] ${params.metricType} failed: ${params.errorCode || "unknown"} - ${params.errorMsg?.substring(0, 100) || "no message"}`,
      );
    }

    return record.id;
  }

  /**
   * 获取 AI 指标摘要
   */
  async getMetricsSummary(options?: {
    startDate?: Date;
    endDate?: Date;
    userId?: string;
  }): Promise<AIMetricsSummary> {
    const where: Record<string, unknown> = {};

    if (options?.startDate || options?.endDate) {
      where.createdAt = {};
      if (options?.startDate) {
        (where.createdAt as Record<string, unknown>).gte = options.startDate;
      }
      if (options?.endDate) {
        (where.createdAt as Record<string, unknown>).lte = options.endDate;
      }
    }

    if (options?.userId) {
      where.userId = options.userId;
    }

    // 基础统计
    const [aggregations, byModelStats, byTypeStats, trendData] =
      await Promise.all([
        this.prisma.aIEngineMetric.aggregate({
          where,
          _count: { id: true },
          _sum: {
            duration: true,
            totalTokens: true,
            estimatedCost: true,
          },
          _avg: { duration: true },
        }),
        this.getByModelStats(where),
        this.getByTypeStats(where),
        this.getTrendData(where),
      ]);

    // 成功率
    const successfulCount = await this.prisma.aIEngineMetric.count({
      where: { ...where, success: true },
    });

    const totalCalls = aggregations._count.id;
    const successRate =
      totalCalls > 0 ? (successfulCount / totalCalls) * 100 : 0;

    return {
      totalCalls,
      successRate: Math.round(successRate * 100) / 100,
      avgDuration: Math.round(aggregations._avg.duration || 0),
      totalTokens: aggregations._sum.totalTokens || 0,
      estimatedCost: this.decimalToNumber(aggregations._sum.estimatedCost),
      byModel: byModelStats,
      byType: byTypeStats,
      trend: trendData,
    };
  }

  /**
   * 获取模型使用统计
   */
  async getModelUsageStats(options?: {
    startDate?: Date;
    endDate?: Date;
  }): Promise<ModelUsageStats[]> {
    const where: Record<string, unknown> = {};

    if (options?.startDate || options?.endDate) {
      where.createdAt = {};
      if (options?.startDate) {
        (where.createdAt as Record<string, unknown>).gte = options.startDate;
      }
      if (options?.endDate) {
        (where.createdAt as Record<string, unknown>).lte = options.endDate;
      }
    }

    // 按模型分组统计
    const stats = await this.prisma.aIEngineMetric.groupBy({
      by: ["modelId", "providerId"],
      where: { ...where, modelId: { not: null } },
      _count: { id: true },
      _sum: { totalTokens: true, duration: true, estimatedCost: true },
      _avg: { totalTokens: true, duration: true },
    });

    // 获取成功/失败计数
    const results: ModelUsageStats[] = [];

    for (const stat of stats) {
      if (!stat.modelId) continue;

      const successCount = await this.prisma.aIEngineMetric.count({
        where: { ...where, modelId: stat.modelId, success: true },
      });

      results.push({
        modelId: stat.modelId,
        providerId: stat.providerId || "unknown",
        totalCalls: stat._count.id,
        successfulCalls: successCount,
        failedCalls: stat._count.id - successCount,
        totalTokens: stat._sum.totalTokens || 0,
        avgTokensPerCall: Math.round(stat._avg.totalTokens || 0),
        avgDuration: Math.round(stat._avg.duration || 0),
        estimatedCost: this.decimalToNumber(stat._sum.estimatedCost),
      });
    }

    return results.sort((a, b) => b.totalCalls - a.totalCalls);
  }

  /**
   * 获取实时指标（最近 1 小时）
   */
  async getRealtimeMetrics() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [totalCalls, successfulCalls, avgDuration, totalTokens, errorCounts] =
      await Promise.all([
        this.prisma.aIEngineMetric.count({
          where: { createdAt: { gte: oneHourAgo } },
        }),
        this.prisma.aIEngineMetric.count({
          where: { createdAt: { gte: oneHourAgo }, success: true },
        }),
        this.prisma.aIEngineMetric.aggregate({
          where: { createdAt: { gte: oneHourAgo } },
          _avg: { duration: true },
        }),
        this.prisma.aIEngineMetric.aggregate({
          where: { createdAt: { gte: oneHourAgo } },
          _sum: { totalTokens: true },
        }),
        this.prisma.aIEngineMetric.groupBy({
          by: ["errorCode"],
          where: {
            createdAt: { gte: oneHourAgo },
            success: false,
            errorCode: { not: null },
          },
          _count: { id: true },
        }),
      ]);

    // 按分钟统计调用量（最近 60 分钟）
    const callsPerMinute = await this.getCallsPerMinute(oneHourAgo);

    return {
      lastHour: {
        totalCalls,
        successfulCalls,
        failedCalls: totalCalls - successfulCalls,
        successRate:
          totalCalls > 0
            ? Math.round((successfulCalls / totalCalls) * 100 * 100) / 100
            : 0,
        avgDuration: Math.round(avgDuration._avg.duration || 0),
        totalTokens: totalTokens._sum.totalTokens || 0,
        errorCounts: errorCounts.reduce(
          (acc, e) => {
            if (e.errorCode) acc[e.errorCode] = e._count.id;
            return acc;
          },
          {} as Record<string, number>,
        ),
      },
      callsPerMinute,
    };
  }

  /**
   * 获取错误分析
   */
  async getErrorAnalysis(options?: { startDate?: Date; endDate?: Date }) {
    const where: Record<string, unknown> = { success: false };

    if (options?.startDate || options?.endDate) {
      where.createdAt = {};
      if (options?.startDate) {
        (where.createdAt as Record<string, unknown>).gte = options.startDate;
      }
      if (options?.endDate) {
        (where.createdAt as Record<string, unknown>).lte = options.endDate;
      }
    }

    const [byErrorCode, byModel, byType, recentErrors] = await Promise.all([
      this.prisma.aIEngineMetric.groupBy({
        by: ["errorCode"],
        where: { ...where, errorCode: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
      this.prisma.aIEngineMetric.groupBy({
        by: ["modelId"],
        where: { ...where, modelId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
      this.prisma.aIEngineMetric.groupBy({
        by: ["metricType"],
        where,
        _count: { id: true },
      }),
      this.prisma.aIEngineMetric.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          metricType: true,
          operationId: true,
          modelId: true,
          errorCode: true,
          errorMsg: true,
          duration: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      byErrorCode: byErrorCode.map((e) => ({
        errorCode: e.errorCode || "unknown",
        count: e._count.id,
      })),
      byModel: byModel.map((m) => ({
        modelId: m.modelId || "unknown",
        count: m._count.id,
      })),
      byType: byType.map((t) => ({
        metricType: t.metricType,
        count: t._count.id,
      })),
      recentErrors,
    };
  }

  // ==================== Private Methods ====================

  /**
   * 按模型统计
   */
  private async getByModelStats(
    where: Record<string, unknown>,
  ): Promise<Record<string, { calls: number; tokens: number; cost: number }>> {
    const stats = await this.prisma.aIEngineMetric.groupBy({
      by: ["modelId"],
      where: { ...where, modelId: { not: null } },
      _count: { id: true },
      _sum: { totalTokens: true, estimatedCost: true },
    });

    return stats.reduce(
      (acc, stat) => {
        if (stat.modelId) {
          acc[stat.modelId] = {
            calls: stat._count.id,
            tokens: stat._sum.totalTokens || 0,
            cost: this.decimalToNumber(stat._sum.estimatedCost),
          };
        }
        return acc;
      },
      {} as Record<string, { calls: number; tokens: number; cost: number }>,
    );
  }

  /**
   * 按类型统计
   */
  private async getByTypeStats(
    where: Record<string, unknown>,
  ): Promise<
    Record<string, { calls: number; successRate: number; avgDuration: number }>
  > {
    const stats = await this.prisma.aIEngineMetric.groupBy({
      by: ["metricType"],
      where,
      _count: { id: true },
      _avg: { duration: true },
    });

    const result: Record<
      string,
      { calls: number; successRate: number; avgDuration: number }
    > = {};

    for (const stat of stats) {
      const successCount = await this.prisma.aIEngineMetric.count({
        where: { ...where, metricType: stat.metricType, success: true },
      });

      result[stat.metricType] = {
        calls: stat._count.id,
        successRate:
          stat._count.id > 0
            ? Math.round((successCount / stat._count.id) * 100 * 100) / 100
            : 0,
        avgDuration: Math.round(stat._avg.duration || 0),
      };
    }

    return result;
  }

  /**
   * 获取趋势数据（过去 7 天）
   */
  private async getTrendData(
    baseWhere: Record<string, unknown>,
  ): Promise<
    Array<{ date: string; calls: number; tokens: number; cost: number }>
  > {
    const trend: Array<{
      date: string;
      calls: number;
      tokens: number;
      cost: number;
    }> = [];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const stats = await this.prisma.aIEngineMetric.aggregate({
        where: {
          ...baseWhere,
          createdAt: {
            gte: date,
            lt: nextDate,
          },
        },
        _count: { id: true },
        _sum: { totalTokens: true, estimatedCost: true },
      });

      trend.push({
        date: date.toISOString().split("T")[0],
        calls: stats._count.id,
        tokens: stats._sum.totalTokens || 0,
        cost: this.decimalToNumber(stats._sum.estimatedCost),
      });
    }

    return trend;
  }

  /**
   * 获取每分钟调用量
   */
  private async getCallsPerMinute(
    since: Date,
  ): Promise<Array<{ minute: string; calls: number }>> {
    const result: Array<{ minute: string; calls: number }> = [];
    const now = new Date();

    // 每 5 分钟一个数据点
    for (let i = 12; i >= 0; i--) {
      const start = new Date(now.getTime() - i * 5 * 60 * 1000);
      const end = new Date(start.getTime() + 5 * 60 * 1000);

      if (start < since) continue;

      const count = await this.prisma.aIEngineMetric.count({
        where: {
          createdAt: {
            gte: start,
            lt: end,
          },
        },
      });

      result.push({
        minute: start.toISOString().substring(11, 16),
        calls: count,
      });
    }

    return result;
  }

  /**
   * Decimal 转 number
   */
  private decimalToNumber(value: Decimal | null | undefined): number {
    if (!value) return 0;
    return Math.round(Number(value) * 1000000) / 1000000;
  }
}
