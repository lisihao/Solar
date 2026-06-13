/**
 * AI Engine - Skill Analytics Service
 *
 * 聚合 AIUsageLog 数据，提供 Skill 执行指标、健康评分、成本分析。
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";

type TimeRange = "24h" | "7d" | "30d";

export interface DashboardMetrics {
  totalExecutions: number;
  successRate: number;
  avgDuration: number;
  totalTokens: number;
  timeline: Array<{
    date: string;
    count: number;
    successRate: number;
  }>;
}

export interface SkillHealth {
  skillId: string;
  name: string;
  score: number;
  status: "healthy" | "degraded" | "critical" | "unused";
  successRate: number;
  avgDuration: number;
  lastUsedAt: Date | null;
  totalCalls: number;
}

export interface TopSkillEntry {
  skillId: string;
  name: string;
  value: number;
}

export interface DomainBreakdown {
  domain: string;
  count: number;
  percentage: number;
}

export interface UnusedSkill {
  skillId: string;
  name: string;
  lastUsedAt: Date | null;
  usageCount: number;
}

@Injectable()
export class SkillAnalyticsService {
  private readonly logger = new Logger(SkillAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dashboard overview metrics
   */
  async getDashboardMetrics(range: TimeRange): Promise<DashboardMetrics> {
    const since = this.getRangeDate(range);
    const whereClause = {
      capabilityType: "skill" as const,
      createdAt: { gte: since },
    };

    // Aggregated summary (no full row scan)
    const [totals, successAgg] = await Promise.all([
      this.prisma.aIUsageLog.aggregate({
        where: whereClause,
        _count: true,
        _avg: { duration: true },
        _sum: { tokensUsed: true },
      }),
      this.prisma.aIUsageLog.aggregate({
        where: { ...whereClause, success: true },
        _count: true,
      }),
    ]);

    const totalExecutions = totals._count;
    const successRate =
      totalExecutions > 0 ? successAgg._count / totalExecutions : 0;
    const avgDuration = totals._avg.duration ?? 0;
    const totalTokens = totals._sum.tokensUsed ?? 0;

    // Timeline: fetch only date + success (limited to raw SQL grouping via application-level aggregation)
    // Use a bounded query: only fetch createdAt + success for timeline bucketing
    const timelineLogs = await this.prisma.aIUsageLog.findMany({
      where: whereClause,
      select: { createdAt: true, success: true },
      orderBy: { createdAt: "asc" },
    });

    const dateMap = new Map<string, { count: number; successCount: number }>();
    for (const log of timelineLogs) {
      const dateKey = log.createdAt.toISOString().split("T")[0];
      const entry = dateMap.get(dateKey) ?? { count: 0, successCount: 0 };
      entry.count++;
      if (log.success) entry.successCount++;
      dateMap.set(dateKey, entry);
    }

    const timeline = Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        count: data.count,
        successRate: data.count > 0 ? data.successCount / data.count : 0,
      }));

    this.logger.debug(
      `[SkillAnalytics] Dashboard metrics (${range}): ${totalExecutions} executions, ${(successRate * 100).toFixed(1)}% success`,
    );
    return { totalExecutions, successRate, avgDuration, totalTokens, timeline };
  }

  /**
   * Per-skill metrics
   */
  async getSkillMetrics(skillId: string, range: TimeRange) {
    const since = this.getRangeDate(range);

    const logs = await this.prisma.aIUsageLog.findMany({
      where: {
        capabilityType: "skill",
        capabilityId: skillId,
        createdAt: { gte: since },
      },
      select: {
        success: true,
        duration: true,
        tokensUsed: true,
        errorCode: true,
        createdAt: true,
      },
    });

    const totalCalls = logs.length;
    const successCount = logs.filter((l) => l.success).length;
    const successRate = totalCalls > 0 ? successCount / totalCalls : 0;
    const avgDuration =
      totalCalls > 0
        ? logs.reduce((sum, l) => sum + (l.duration ?? 0), 0) / totalCalls
        : 0;
    const totalTokens = logs.reduce((sum, l) => sum + (l.tokensUsed ?? 0), 0);

    // Error distribution
    const errorCounts: Record<string, number> = {};
    for (const log of logs) {
      if (!log.success && log.errorCode) {
        errorCounts[log.errorCode] = (errorCounts[log.errorCode] ?? 0) + 1;
      }
    }

    // Latency percentiles
    const durations = logs
      .map((l) => l.duration ?? 0)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);

    const p50 = this.percentile(durations, 50);
    const p95 = this.percentile(durations, 95);
    const p99 = this.percentile(durations, 99);

    return {
      totalCalls,
      successRate,
      avgDuration,
      totalTokens,
      errorDistribution: errorCounts,
      latencyPercentiles: { p50, p95, p99 },
    };
  }

  /**
   * Health scores for all skills
   */
  async getHealthScores(): Promise<SkillHealth[]> {
    const sevenDaysAgo = this.getRangeDate("7d");
    const thirtyDaysAgo = this.getRangeDate("30d");

    // Get all skill configs
    const configs = await this.prisma.skillConfig.findMany({
      where: { enabled: true },
      select: {
        skillId: true,
        displayName: true,
        lastUsedAt: true,
      },
    });

    // Get 7-day aggregation by skill
    const recentLogs = await this.prisma.aIUsageLog.groupBy({
      by: ["capabilityId"],
      where: {
        capabilityType: "skill",
        createdAt: { gte: sevenDaysAgo },
      },
      _count: true,
      _avg: { duration: true },
    });

    // Get success counts
    const successLogs = await this.prisma.aIUsageLog.groupBy({
      by: ["capabilityId"],
      where: {
        capabilityType: "skill",
        createdAt: { gte: sevenDaysAgo },
        success: true,
      },
      _count: true,
    });

    const recentMap = new Map(
      recentLogs.map((l) => [
        l.capabilityId,
        { count: l._count, avgDuration: l._avg.duration ?? 0 },
      ]),
    );
    const successMap = new Map(
      successLogs.map((l) => [l.capabilityId, l._count]),
    );

    return configs.map((config) => {
      const recent = recentMap.get(config.skillId);
      const successCount = successMap.get(config.skillId) ?? 0;
      const totalCalls = recent?.count ?? 0;
      const avgDuration = recent?.avgDuration ?? 0;
      const successRate = totalCalls > 0 ? successCount / totalCalls : 0;

      // Health score calculation
      let score: number;
      let status: SkillHealth["status"];

      if (totalCalls === 0) {
        // Check if unused for 30+ days
        const lastUsed = config.lastUsedAt;
        if (!lastUsed || lastUsed < thirtyDaysAgo) {
          score = 0;
          status = "unused";
        } else {
          score = 50;
          status = "degraded";
        }
      } else {
        // Weighted: successRate (60%) + latency (20%) + activity (20%)
        const successScore = successRate * 100;
        const latencyScore =
          avgDuration < 5000 ? 100 : avgDuration < 10000 ? 50 : 0;
        const activityScore = Math.min(totalCalls / 10, 1) * 100;
        score = successScore * 0.6 + latencyScore * 0.2 + activityScore * 0.2;

        if (score >= 80) status = "healthy";
        else if (score >= 50) status = "degraded";
        else status = "critical";
      }

      return {
        skillId: config.skillId,
        name: config.displayName ?? config.skillId,
        score: Math.round(score),
        status,
        successRate,
        avgDuration,
        lastUsedAt: config.lastUsedAt,
        totalCalls,
      };
    });
  }

  /**
   * Skills unused for N days
   */
  async getUnusedSkills(days = 30): Promise<UnusedSkill[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const configs = await this.prisma.skillConfig.findMany({
      where: {
        enabled: true,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: cutoff } }],
      },
      select: {
        skillId: true,
        displayName: true,
        lastUsedAt: true,
        usageCount: true,
      },
      orderBy: { lastUsedAt: "asc" },
    });

    return configs.map((c) => ({
      skillId: c.skillId,
      name: c.displayName ?? c.skillId,
      lastUsedAt: c.lastUsedAt,
      usageCount: c.usageCount,
    }));
  }

  /**
   * Top skills by metric
   */
  async getTopSkills(
    metric: "usage" | "success" | "failure" = "usage",
    limit = 10,
  ): Promise<TopSkillEntry[]> {
    const sevenDaysAgo = this.getRangeDate("7d");

    if (metric === "usage") {
      const results = await this.prisma.aIUsageLog.groupBy({
        by: ["capabilityId"],
        where: {
          capabilityType: "skill",
          createdAt: { gte: sevenDaysAgo },
        },
        _count: true,
        orderBy: { _count: { capabilityId: "desc" } },
        take: limit,
      });

      return this.enrichSkillEntries(
        results.map((r) => ({
          skillId: r.capabilityId,
          value: r._count,
        })),
      );
    }

    if (metric === "failure") {
      const results = await this.prisma.aIUsageLog.groupBy({
        by: ["capabilityId"],
        where: {
          capabilityType: "skill",
          createdAt: { gte: sevenDaysAgo },
          success: false,
        },
        _count: true,
        orderBy: { _count: { capabilityId: "desc" } },
        take: limit,
      });

      return this.enrichSkillEntries(
        results.map((r) => ({
          skillId: r.capabilityId,
          value: r._count,
        })),
      );
    }

    // success
    const results = await this.prisma.aIUsageLog.groupBy({
      by: ["capabilityId"],
      where: {
        capabilityType: "skill",
        createdAt: { gte: sevenDaysAgo },
        success: true,
      },
      _count: true,
      orderBy: { _count: { capabilityId: "desc" } },
      take: limit,
    });

    return this.enrichSkillEntries(
      results.map((r) => ({
        skillId: r.capabilityId,
        value: r._count,
      })),
    );
  }

  /**
   * Domain breakdown
   */
  async getDomainBreakdown(range: TimeRange): Promise<DomainBreakdown[]> {
    const since = this.getRangeDate(range);

    const results = await this.prisma.aIUsageLog.groupBy({
      by: ["domain"],
      where: {
        capabilityType: "skill",
        createdAt: { gte: since },
        domain: { not: null },
      },
      _count: true,
      orderBy: { _count: { domain: "desc" } },
    });

    const total = results.reduce((sum, r) => sum + r._count, 0);

    return results.map((r) => ({
      domain: r.domain ?? "unknown",
      count: r._count,
      percentage: total > 0 ? r._count / total : 0,
    }));
  }

  /**
   * Cost analysis
   */
  async getCostAnalysis(range: TimeRange) {
    const since = this.getRangeDate(range);

    const results = await this.prisma.aIUsageLog.groupBy({
      by: ["capabilityId"],
      where: {
        capabilityType: "skill",
        createdAt: { gte: since },
      },
      _sum: { tokensUsed: true, inputTokens: true, outputTokens: true },
      _count: true,
      orderBy: { _sum: { tokensUsed: "desc" } },
      take: 20,
    });

    return this.enrichSkillEntries(
      results.map((r) => ({
        skillId: r.capabilityId,
        value: r._sum.tokensUsed ?? 0,
        inputTokens: r._sum.inputTokens ?? 0,
        outputTokens: r._sum.outputTokens ?? 0,
        callCount: r._count,
      })),
    );
  }

  // ==================== Helpers ====================

  private getRangeDate(range: TimeRange): Date {
    const now = new Date();
    switch (range) {
      case "24h":
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case "7d":
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case "30d":
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private async enrichSkillEntries(
    entries: Array<{ skillId: string; value: number; [key: string]: unknown }>,
  ): Promise<TopSkillEntry[]> {
    if (entries.length === 0) return [];

    const skillIds = entries.map((e) => e.skillId);
    const configs = await this.prisma.skillConfig.findMany({
      where: { skillId: { in: skillIds } },
      select: { skillId: true, displayName: true },
    });
    const nameMap = new Map(
      configs.map((c) => [c.skillId, c.displayName ?? c.skillId]),
    );

    return entries.map((e) => ({
      skillId: e.skillId,
      name: nameMap.get(e.skillId) ?? e.skillId,
      value: e.value,
    }));
  }
}
