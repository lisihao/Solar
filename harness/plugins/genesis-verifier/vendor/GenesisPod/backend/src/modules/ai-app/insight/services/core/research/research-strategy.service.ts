/**
 * Research Strategy Service
 *
 * 智能研究策略服务 (Phase 3.1)
 *
 * 核心职责：
 * 1. 检测主题是否有过研究
 * 2. 评估各维度的新鲜度
 * 3. 智能决定研究策略（全新 vs 增量 vs 定向更新）
 * 4. 提供研究建议
 *
 * 设计思路：
 * - 没有研究过 → 全新研究 (NEW)
 * - 有研究但已过期 → 增量更新 (INCREMENTAL)
 * - 有研究且较新 → 可选更新 (OPTIONAL)
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { DimensionStatus } from "@prisma/client";
import {
  ResearchStrategyType,
  DimensionFreshnessLevel,
  type DimensionFreshnessInfo,
  type ResearchStrategyRecommendation,
} from "../../../types/strategy.types";

/**
 * 新鲜度配置
 */
export interface FreshnessConfig {
  /** 新鲜阈值（小时）- 默认24小时 */
  freshThresholdHours: number;
  /** 较新阈值（天）- 默认7天 */
  recentThresholdDays: number;
  /** 过时阈值（天）- 默认30天 */
  staleThresholdDays: number;
}

const DEFAULT_FRESHNESS_CONFIG: FreshnessConfig = {
  freshThresholdHours: 24,
  recentThresholdDays: 7,
  staleThresholdDays: 30,
};

@Injectable()
export class ResearchStrategyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 分析主题并推荐研究策略
   *
   * 这是核心方法，用于决定应该执行什么类型的研究
   */
  async analyzeAndRecommend(
    topicId: string,
    config: Partial<FreshnessConfig> = {},
  ): Promise<ResearchStrategyRecommendation> {
    const freshnessConfig = { ...DEFAULT_FRESHNESS_CONFIG, ...config };

    // 1. 获取主题信息
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      include: {
        dimensions: {
          where: { isEnabled: true },
          orderBy: { sortOrder: "asc" },
        },
        reports: {
          orderBy: { generatedAt: "desc" },
          take: 1,
          select: { id: true, generatedAt: true },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException(`Topic not found: ${topicId}`);
    }

    // 2. 分析主题研究状态
    const topicStatus = {
      hasExistingResearch: topic.totalReports > 0,
      totalReports: topic.totalReports,
      lastResearchAt: topic.lastRefreshAt,
      daysSinceLastResearch: topic.lastRefreshAt
        ? this.daysSince(topic.lastRefreshAt)
        : null,
    };

    // 3. 分析各维度的新鲜度
    const dimensions: DimensionFreshnessInfo[] = topic.dimensions.map((dim) =>
      this.analyzeDimensionFreshness(dim, freshnessConfig),
    );

    // 4. 计算统计数据
    const stats = {
      totalDimensions: dimensions.length,
      freshDimensions: dimensions.filter(
        (d: DimensionFreshnessInfo) =>
          d.freshnessLevel === DimensionFreshnessLevel.FRESH,
      ).length,
      staleDimensions: dimensions.filter(
        (d: DimensionFreshnessInfo) =>
          d.freshnessLevel === DimensionFreshnessLevel.STALE ||
          d.freshnessLevel === DimensionFreshnessLevel.NEVER_RESEARCHED,
      ).length,
      neverResearchedDimensions: dimensions.filter(
        (d: DimensionFreshnessInfo) =>
          d.freshnessLevel === DimensionFreshnessLevel.NEVER_RESEARCHED,
      ).length,
      dimensionsNeedingUpdate: dimensions.filter(
        (d: DimensionFreshnessInfo) => d.needsUpdate,
      ).length,
    };

    // 5. 决定研究策略
    const { strategy, description, requiresConfirmation, suggestedAction } =
      this.determineStrategy(topicStatus, stats, dimensions);

    // 6. 估算更新范围
    const estimatedScope = {
      dimensionsToResearch: stats.dimensionsNeedingUpdate,
      estimatedTimeMinutes: this.estimateResearchTime(
        stats.dimensionsNeedingUpdate,
      ),
      isFullResearch: strategy === ResearchStrategyType.NEW,
    };

    return {
      strategy,
      description,
      requiresConfirmation,
      suggestedAction,
      topicStatus,
      dimensions,
      stats,
      estimatedScope,
    };
  }

  /**
   * 快速检查：是否需要研究（用于前端按钮状态）
   */
  async quickCheck(topicId: string): Promise<{
    needsResearch: boolean;
    isNewResearch: boolean;
    dimensionsNeedingUpdate: number;
    suggestedButtonText: string;
  }> {
    const recommendation = await this.analyzeAndRecommend(topicId);

    const needsResearch =
      recommendation.strategy !== ResearchStrategyType.UP_TO_DATE;
    const isNewResearch = recommendation.strategy === ResearchStrategyType.NEW;

    // 根据策略决定按钮文本
    let suggestedButtonText: string;
    switch (recommendation.strategy) {
      case ResearchStrategyType.NEW:
        suggestedButtonText = "开始研究";
        break;
      case ResearchStrategyType.INCREMENTAL:
        suggestedButtonText = `更新研究 (${recommendation.stats.dimensionsNeedingUpdate}个维度)`;
        break;
      case ResearchStrategyType.FULL_REFRESH:
        suggestedButtonText = "全量刷新";
        break;
      case ResearchStrategyType.OPTIONAL:
        suggestedButtonText = "可选更新";
        break;
      case ResearchStrategyType.UP_TO_DATE:
        suggestedButtonText = "研究已是最新";
        break;
    }

    return {
      needsResearch,
      isNewResearch,
      dimensionsNeedingUpdate: recommendation.stats.dimensionsNeedingUpdate,
      suggestedButtonText,
    };
  }

  /**
   * 智能开始研究：根据分析结果自动选择策略
   *
   * 这是用户点击"开始研究"按钮时调用的方法
   */
  async getSmartRefreshOptions(topicId: string): Promise<{
    forceRefresh: boolean;
    incremental: boolean;
    dimensionIds?: string[];
    strategy: ResearchStrategyType;
    message: string;
  }> {
    const recommendation = await this.analyzeAndRecommend(topicId);

    switch (recommendation.strategy) {
      case ResearchStrategyType.NEW:
        return {
          forceRefresh: true,
          incremental: false,
          strategy: ResearchStrategyType.NEW,
          message: `首次研究「${recommendation.stats.totalDimensions}」个维度`,
        };

      case ResearchStrategyType.INCREMENTAL:
        // 只更新需要更新的维度
        const dimensionsToUpdate = recommendation.dimensions
          .filter((d) => d.needsUpdate)
          .map((d) => d.dimensionId);

        return {
          forceRefresh: false,
          incremental: true,
          dimensionIds: dimensionsToUpdate,
          strategy: ResearchStrategyType.INCREMENTAL,
          message: `增量更新「${dimensionsToUpdate.length}」个维度`,
        };

      case ResearchStrategyType.FULL_REFRESH:
        return {
          forceRefresh: true,
          incremental: false,
          strategy: ResearchStrategyType.FULL_REFRESH,
          message: `全量刷新「${recommendation.stats.totalDimensions}」个维度`,
        };

      case ResearchStrategyType.OPTIONAL:
        // 可选更新时，只更新过时的维度
        const optionalDimensions = recommendation.dimensions
          .filter((d) => d.updatePriority !== "none")
          .map((d) => d.dimensionId);

        return {
          forceRefresh: false,
          incremental: true,
          dimensionIds:
            optionalDimensions.length > 0 ? optionalDimensions : undefined,
          strategy: ResearchStrategyType.OPTIONAL,
          message:
            optionalDimensions.length > 0
              ? `可选更新「${optionalDimensions.length}」个维度`
              : "研究内容较新，无需更新",
        };

      case ResearchStrategyType.UP_TO_DATE:
      default:
        return {
          forceRefresh: false,
          incremental: true,
          strategy: ResearchStrategyType.UP_TO_DATE,
          message: "所有维度都是最新的，无需更新",
        };
    }
  }

  /**
   * 分析单个维度的新鲜度
   */
  private analyzeDimensionFreshness(
    dimension: {
      id: string;
      name: string;
      status: DimensionStatus;
      lastResearchedAt: Date | null;
    },
    config: FreshnessConfig,
  ): DimensionFreshnessInfo {
    const now = new Date();

    // 从未研究过
    if (!dimension.lastResearchedAt) {
      return {
        dimensionId: dimension.id,
        dimensionName: dimension.name,
        freshnessLevel: DimensionFreshnessLevel.NEVER_RESEARCHED,
        lastResearchedAt: null,
        daysSinceResearch: null,
        status: dimension.status,
        needsUpdate: true,
        updatePriority: "high",
      };
    }

    const hoursSince =
      (now.getTime() - dimension.lastResearchedAt.getTime()) / (1000 * 60 * 60);
    const daysSince = hoursSince / 24;

    // 判断新鲜度级别
    let freshnessLevel: DimensionFreshnessLevel;
    let needsUpdate: boolean;
    let updatePriority: "high" | "medium" | "low" | "none";

    if (hoursSince <= config.freshThresholdHours) {
      freshnessLevel = DimensionFreshnessLevel.FRESH;
      needsUpdate = false;
      updatePriority = "none";
    } else if (daysSince <= config.recentThresholdDays) {
      freshnessLevel = DimensionFreshnessLevel.RECENT;
      needsUpdate = false;
      updatePriority = "low";
    } else {
      freshnessLevel = DimensionFreshnessLevel.STALE;
      needsUpdate = true;
      updatePriority =
        daysSince > config.staleThresholdDays ? "high" : "medium";
    }

    // 如果状态不是 COMPLETED，也需要更新
    if (dimension.status !== DimensionStatus.COMPLETED) {
      needsUpdate = true;
      updatePriority = "high";
    }

    return {
      dimensionId: dimension.id,
      dimensionName: dimension.name,
      freshnessLevel,
      lastResearchedAt: dimension.lastResearchedAt,
      daysSinceResearch: Math.round(daysSince),
      status: dimension.status,
      needsUpdate,
      updatePriority,
    };
  }

  /**
   * 决定研究策略
   */
  private determineStrategy(
    topicStatus: {
      hasExistingResearch: boolean;
      daysSinceLastResearch: number | null;
    },
    stats: {
      totalDimensions: number;
      neverResearchedDimensions: number;
      dimensionsNeedingUpdate: number;
      freshDimensions: number;
    },
    _dimensions: DimensionFreshnessInfo[],
  ): {
    strategy: ResearchStrategyType;
    description: string;
    requiresConfirmation: boolean;
    suggestedAction: string;
  } {
    // 场景1：从未研究过 → 全新研究
    if (!topicStatus.hasExistingResearch) {
      return {
        strategy: ResearchStrategyType.NEW,
        description: "此主题尚未进行过研究",
        requiresConfirmation: false,
        suggestedAction: "点击开始研究，AI 团队将为您生成完整的研究报告",
      };
    }

    // 场景2：所有维度都是最新的 → 无需更新
    if (stats.dimensionsNeedingUpdate === 0) {
      return {
        strategy: ResearchStrategyType.UP_TO_DATE,
        description: "所有维度的研究都是最新的",
        requiresConfirmation: false,
        suggestedAction: "您的研究已是最新，如需强制刷新请选择全量刷新",
      };
    }

    // 场景3：大部分需要更新 → 全量刷新
    if (
      stats.dimensionsNeedingUpdate / stats.totalDimensions > 0.7 ||
      stats.neverResearchedDimensions > 0
    ) {
      return {
        strategy: ResearchStrategyType.FULL_REFRESH,
        description: `大部分维度需要更新（${stats.dimensionsNeedingUpdate}/${stats.totalDimensions}）`,
        requiresConfirmation: false,
        suggestedAction: "建议进行全量刷新以获得最新研究结果",
      };
    }

    // 场景4：部分需要更新 → 增量更新
    if (stats.dimensionsNeedingUpdate > 0) {
      return {
        strategy: ResearchStrategyType.INCREMENTAL,
        description: `${stats.dimensionsNeedingUpdate} 个维度需要更新`,
        requiresConfirmation: false,
        suggestedAction: `将智能更新 ${stats.dimensionsNeedingUpdate} 个过时的维度`,
      };
    }

    // 场景5：有较新的内容但可以更新 → 可选更新
    return {
      strategy: ResearchStrategyType.OPTIONAL,
      description: "研究内容较新，但可以选择更新",
      requiresConfirmation: true,
      suggestedAction: "研究内容较新，如需更新请点击更新按钮",
    };
  }

  /**
   * 估算研究时间（分钟）
   */
  private estimateResearchTime(dimensionCount: number): number {
    // 假设每个维度大约需要 2-3 分钟
    return Math.max(2, dimensionCount * 2.5);
  }

  /**
   * 计算距今天数
   */
  private daysSince(date: Date): number {
    const now = new Date();
    return Math.round((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  }
}
