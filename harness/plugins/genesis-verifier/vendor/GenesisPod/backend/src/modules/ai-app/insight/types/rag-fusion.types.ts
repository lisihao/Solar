/**
 * RAG-Fusion Types
 *
 * P0 优化：多查询融合检索类型定义
 * 参考：RAG-Fusion (Raudaschl, 2023)
 */

import { DataSourceResult } from "./data-source.types";

/**
 * 查询变体类型
 */
export enum QueryVariantType {
  ORIGINAL = "original", // 原始查询
  PARAPHRASED = "paraphrased", // 同义改写
  DECOMPOSED = "decomposed", // 子问题分解
  EXPANDED = "expanded", // 上下文扩展
  CONTRASTIVE = "contrastive", // 对比查询（寻找反面证据）
  TEMPORAL = "temporal", // 时间限定
  DOMAIN_SPECIFIC = "domain_specific", // 领域特定术语
  ASPECT_FOCUSED = "aspect_focused", // 特定方面聚焦
}

/**
 * 查询变体
 */
export interface QueryVariant {
  id: string;
  query: string;
  type: QueryVariantType;
  weight: number; // 融合时的权重 0.5-1.0
  rationale?: string; // 为什么生成这个变体
  targetAspect?: string; // 针对的特定方面
}

/**
 * RAG-Fusion 配置
 */
export interface RAGFusionConfig {
  // 是否启用 RAG-Fusion
  enabled: boolean;

  // 最大查询变体数
  maxVariants: number;

  // 启用的变体类型
  enabledVariantTypes: QueryVariantType[];

  // 是否启用对比查询（寻找反面证据）
  enableContrastive: boolean;

  // 是否启用时间限定
  enableTemporal: boolean;

  // 融合方法
  fusionMethod: "reciprocal_rank" | "weighted_sum" | "ensemble";

  // 每个变体的最小结果数
  minResultsPerVariant: number;

  // 覆盖度加成（被多个变体命中的结果获得加成）
  coverageBonus: {
    threshold2: number; // 被2个变体命中的加成
    threshold3: number; // 被3+个变体命中的加成
  };

  // RRF 平滑常数（仅用于 reciprocal_rank 方法）
  rrfK: number;
}

/**
 * 默认 RAG-Fusion 配置
 */
export const DEFAULT_RAG_FUSION_CONFIG: RAGFusionConfig = {
  enabled: true,
  maxVariants: 6,
  enabledVariantTypes: [
    QueryVariantType.ORIGINAL,
    QueryVariantType.PARAPHRASED,
    QueryVariantType.DECOMPOSED,
    QueryVariantType.EXPANDED,
    QueryVariantType.TEMPORAL,
  ],
  enableContrastive: true,
  enableTemporal: true,
  fusionMethod: "reciprocal_rank",
  minResultsPerVariant: 5,
  coverageBonus: {
    threshold2: 1.1, // 10% 加成
    threshold3: 1.2, // 20% 加成
  },
  rrfK: 60,
};

/**
 * 变体搜索结果
 */
export interface VariantSearchResult {
  variant: QueryVariant;
  results: DataSourceResult[];
  executionTimeMs: number;
  success: boolean;
  error?: string;
}

/**
 * 融合后的搜索结果项
 */
export interface FusedSearchResultItem {
  // 原始结果
  item: DataSourceResult;

  // 融合分数
  fusionScore: number;

  // 原始分数（如果有）
  originalScore?: number;

  // 来源追踪
  contributingVariants: Array<{
    variantId: string;
    variantType: QueryVariantType;
    rank: number; // 在该变体结果中的排名
    score: number; // 该变体贡献的分数
  }>;

  // 多查询覆盖度（被多少个变体命中）
  coverageCount: number;

  // 是否来自对比查询（可能是反面证据）
  isContrastiveResult: boolean;
}

/**
 * 融合搜索结果
 */
export interface FusedSearchResult {
  // 融合后的结果列表
  items: FusedSearchResultItem[];

  // 原始查询
  originalQuery: string;

  // 使用的变体
  variants: QueryVariant[];

  // 变体级别的结果统计
  variantStats: Array<{
    variantId: string;
    variantType: QueryVariantType;
    resultCount: number;
    uniqueContributions: number; // 只有该变体命中的结果数
  }>;

  // 元数据
  metadata: {
    totalVariants: number;
    successfulVariants: number;
    totalUniqueResults: number;
    averageCoverage: number;
    fusionMethod: string;
    executionTimeMs: number;
  };
}

/**
 * 查询变体生成请求
 */
export interface QueryVariantGenerationRequest {
  originalQuery: string;
  context: {
    topicName: string;
    dimensionName: string;
    targetAudience?: string;
    researchFocus?: string[];
  };
  config?: Partial<RAGFusionConfig>;
}

/**
 * 查询变体生成结果
 */
export interface QueryVariantGenerationResult {
  variants: QueryVariant[];
  generationTimeMs: number;
  rationale: string; // 整体生成策略的解释
}
