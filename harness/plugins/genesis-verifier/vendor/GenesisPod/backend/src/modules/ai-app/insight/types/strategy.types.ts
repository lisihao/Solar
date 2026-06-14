/**
 * Research Strategy Types
 *
 * Type definitions for research strategy service
 */

import type { DimensionStatus } from "@prisma/client";

/**
 * 研究策略类型
 */
export enum ResearchStrategyType {
  /** 全新研究：主题从未研究过 */
  NEW = "NEW",
  /** 增量更新：部分维度需要更新 */
  INCREMENTAL = "INCREMENTAL",
  /** 全量刷新：所有维度都需要更新 */
  FULL_REFRESH = "FULL_REFRESH",
  /** 可选更新：研究较新，可以选择是否更新 */
  OPTIONAL = "OPTIONAL",
  /** 无需更新：所有内容都是最新的 */
  UP_TO_DATE = "UP_TO_DATE",
}

/**
 * 维度新鲜度状态
 */
export enum DimensionFreshnessLevel {
  /** 新鲜：24小时内更新 */
  FRESH = "FRESH",
  /** 较新：7天内更新 */
  RECENT = "RECENT",
  /** 过时：超过7天未更新 */
  STALE = "STALE",
  /** 从未研究 */
  NEVER_RESEARCHED = "NEVER_RESEARCHED",
}

/**
 * 维度新鲜度详情
 */
export interface DimensionFreshnessInfo {
  dimensionId: string;
  dimensionName: string;
  freshnessLevel: DimensionFreshnessLevel;
  lastResearchedAt: Date | null;
  daysSinceResearch: number | null;
  status: DimensionStatus;
  needsUpdate: boolean;
  updatePriority: "high" | "medium" | "low" | "none";
}

/**
 * 研究策略建议
 */
export interface ResearchStrategyRecommendation {
  /** 推荐的策略类型 */
  strategy: ResearchStrategyType;
  /** 策略说明 */
  description: string;
  /** 是否需要用户确认 */
  requiresConfirmation: boolean;
  /** 建议的行动 */
  suggestedAction: string;

  /** 主题研究状态 */
  topicStatus: {
    hasExistingResearch: boolean;
    totalReports: number;
    lastResearchAt: Date | null;
    daysSinceLastResearch: number | null;
  };

  /** 维度新鲜度详情 */
  dimensions: DimensionFreshnessInfo[];

  /** 统计数据 */
  stats: {
    totalDimensions: number;
    freshDimensions: number;
    staleDimensions: number;
    neverResearchedDimensions: number;
    dimensionsNeedingUpdate: number;
  };

  /** 预估更新范围 */
  estimatedScope: {
    dimensionsToResearch: number;
    estimatedTimeMinutes: number;
    isFullResearch: boolean;
  };
}
