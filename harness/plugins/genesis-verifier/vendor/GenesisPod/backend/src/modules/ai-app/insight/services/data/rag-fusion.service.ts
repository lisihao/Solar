/**
 * RAG-Fusion Service
 *
 * P0 优化：多查询融合检索服务
 * 参考：RAG-Fusion (Raudaschl, 2023)
 *
 * 功能：
 * 1. 自动生成多个查询变体
 * 2. 并行执行变体查询
 * 3. 使用 Reciprocal Rank Fusion 融合结果
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { mapWithConcurrency } from "@/common/utils/concurrency.utils";
import {
  QueryVariant,
  QueryVariantType,
  RAGFusionConfig,
  DEFAULT_RAG_FUSION_CONFIG,
  VariantSearchResult,
  FusedSearchResultItem,
  FusedSearchResult,
  QueryVariantGenerationRequest,
  QueryVariantGenerationResult,
} from "../../types/rag-fusion.types";
import { DataSourceResult } from "../../types/data-source.types";

/**
 * ★ Critical Fix: 并发控制常量
 * 限制同时执行的搜索请求数量，防止资源耗尽
 */
const CONCURRENT_SEARCH_LIMIT = 3;

interface QueryVariantResponse {
  variants: Array<{
    query: string;
    type: string;
    weight?: number;
    rationale?: string;
    targetAspect?: string;
  }>;
  overallRationale: string;
}

@Injectable()
export class RAGFusionService {
  private readonly logger = new Logger(RAGFusionService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 生成查询变体
   */
  async generateQueryVariants(
    request: QueryVariantGenerationRequest,
  ): Promise<QueryVariantGenerationResult> {
    const startTime = Date.now();
    const config = { ...DEFAULT_RAG_FUSION_CONFIG, ...request.config };

    this.logger.log(
      `[generateQueryVariants] Generating variants for: ${request.originalQuery.substring(0, 50)}...`,
    );

    // 构建提示词
    const prompt = `你是一个专业的信息检索专家。请为以下搜索查询生成多个变体，以提高检索的全面性和召回率。

## 原始查询
${request.originalQuery}

## 上下文
- 研究主题：${request.context.topicName}
- 研究维度：${request.context.dimensionName}
- 目标受众：${request.context.targetAudience || "通用"}
${request.context.researchFocus ? `- 研究重点：${request.context.researchFocus.join("、")}` : ""}

## 任务
生成 ${Math.min(config.maxVariants - 1, 5)} 个查询变体。

## 输出格式（JSON）
{
  "variants": [
    {
      "query": "变体查询文本",
      "type": "paraphrased|decomposed|expanded|contrastive|temporal|domain_specific|aspect_focused",
      "weight": 0.8,
      "rationale": "为什么这个变体有用",
      "targetAspect": "针对的特定方面（可选）"
    }
  ],
  "overallRationale": "整体变体策略说明"
}

## 要求
- 每个变体应该有明确不同的检索意图
- 权重范围 0.5-1.0，越重要的变体权重越高
- 对比查询（寻找反面证据）的权重适中（0.6-0.7）
- 确保变体覆盖不同的搜索角度

只输出 JSON。`;

    try {
      const response =
        await this.chatFacade.chatStructured<QueryVariantResponse>({
          messages: [{ role: "user", content: prompt }],
          operationName: "查询扩展",
          additionalSkills: ["rag-fusion-query"],
          skipGuardrails: true,
          taskProfile: { creativity: "medium", outputLength: "medium" },
          throwOnParseError: false,
          strictMode: false,
          schema: {
            type: "object",
            required: ["variants"],
            additionalProperties: false,
            properties: {
              variants: {
                type: "array",
                items: {
                  type: "object",
                  required: ["query", "type"],
                  additionalProperties: false,
                  properties: {
                    query: { type: "string" },
                    type: { type: "string" },
                    weight: { type: "number" },
                    rationale: { type: "string" },
                    targetAspect: { type: "string" },
                  },
                },
              },
              overallRationale: { type: "string" },
            },
          },
        });

      // 始终包含原始查询
      const variants: QueryVariant[] = [
        {
          id: "variant-original",
          query: request.originalQuery,
          type: QueryVariantType.ORIGINAL,
          weight: 1.0,
          rationale: "原始用户查询",
        },
      ];

      if (response.data?.variants) {
        for (let i = 0; i < response.data.variants.length; i++) {
          const v = response.data.variants[i];
          variants.push({
            id: `variant-${i + 1}`,
            query: v.query,
            type: this.parseVariantType(v.type),
            weight: Math.max(0.5, Math.min(1.0, v.weight || 0.8)),
            rationale: v.rationale,
            targetAspect: v.targetAspect,
          });
        }
      }

      this.logger.log(
        `[generateQueryVariants] Generated ${variants.length} variants in ${Date.now() - startTime}ms`,
      );

      return {
        variants,
        generationTimeMs: Date.now() - startTime,
        rationale: response.data?.overallRationale || "自动生成的查询变体",
      };
    } catch (error) {
      this.logger.error(`[generateQueryVariants] Error: ${error}`);

      // 回退：只返回原始查询
      return {
        variants: [
          {
            id: "variant-original",
            query: request.originalQuery,
            type: QueryVariantType.ORIGINAL,
            weight: 1.0,
            rationale: "原始用户查询",
          },
        ],
        generationTimeMs: Date.now() - startTime,
        rationale: "变体生成失败，使用原始查询",
      };
    }
  }

  /**
   * 解析变体类型
   */
  private parseVariantType(type: string): QueryVariantType {
    const mapping: Record<string, QueryVariantType> = {
      original: QueryVariantType.ORIGINAL,
      paraphrased: QueryVariantType.PARAPHRASED,
      decomposed: QueryVariantType.DECOMPOSED,
      expanded: QueryVariantType.EXPANDED,
      contrastive: QueryVariantType.CONTRASTIVE,
      temporal: QueryVariantType.TEMPORAL,
      domain_specific: QueryVariantType.DOMAIN_SPECIFIC,
      aspect_focused: QueryVariantType.ASPECT_FOCUSED,
    };
    return mapping[type?.toLowerCase()] || QueryVariantType.EXPANDED;
  }

  /**
   * Reciprocal Rank Fusion 算法
   *
   * 公式：RRF(d) = Σ weight(q) / (k + rank(d, q))
   * 其中 k 是平滑常数（默认 60）
   */
  fuseResults(
    variantResults: VariantSearchResult[],
    config: Partial<RAGFusionConfig> = {},
  ): FusedSearchResult {
    const startTime = Date.now();
    const mergedConfig = { ...DEFAULT_RAG_FUSION_CONFIG, ...config };
    const k = mergedConfig.rrfK;

    this.logger.log(
      `[fuseResults] Fusing results from ${variantResults.length} variants`,
    );

    // URL -> 融合结果的映射
    const fusionMap = new Map<string, FusedSearchResultItem>();

    // 统计每个变体的贡献
    const variantStats: FusedSearchResult["variantStats"] = [];

    for (const variantResult of variantResults) {
      if (!variantResult.success) continue;

      const variant = variantResult.variant;
      let uniqueContributions = 0;

      variantResult.results.forEach((item, rank) => {
        // 跳过没有 URL 的结果（无法作为唯一标识去重）
        if (!item.url) return;
        const url = this.normalizeUrl(item.url);

        if (!fusionMap.has(url)) {
          fusionMap.set(url, {
            item,
            fusionScore: 0,
            contributingVariants: [],
            coverageCount: 0,
            isContrastiveResult: false,
          });
          uniqueContributions++;
        }

        const fusedResult = fusionMap.get(url)!;

        // 计算分数
        let score: number;
        if (mergedConfig.fusionMethod === "reciprocal_rank") {
          score = variant.weight / (k + rank + 1);
        } else if (mergedConfig.fusionMethod === "weighted_sum") {
          score = variant.weight * (1 - rank / variantResult.results.length);
        } else {
          // ensemble: 简单计数
          score = variant.weight;
        }

        fusedResult.fusionScore += score;
        fusedResult.contributingVariants.push({
          variantId: variant.id,
          variantType: variant.type,
          rank: rank + 1,
          score,
        });
        fusedResult.coverageCount++;

        // 标记对比查询结果
        if (variant.type === QueryVariantType.CONTRASTIVE) {
          fusedResult.isContrastiveResult = true;
        }
      });

      variantStats.push({
        variantId: variant.id,
        variantType: variant.type,
        resultCount: variantResult.results.length,
        uniqueContributions,
      });
    }

    // 应用覆盖度加成
    for (const result of fusionMap.values()) {
      if (result.coverageCount >= 3) {
        result.fusionScore *= mergedConfig.coverageBonus.threshold3;
      } else if (result.coverageCount >= 2) {
        result.fusionScore *= mergedConfig.coverageBonus.threshold2;
      }
    }

    // 按融合分数排序
    const sortedResults = Array.from(fusionMap.values()).sort(
      (a, b) => b.fusionScore - a.fusionScore,
    );

    // 计算平均覆盖度
    const averageCoverage =
      sortedResults.length > 0
        ? sortedResults.reduce((sum, r) => sum + r.coverageCount, 0) /
          sortedResults.length
        : 0;

    const result: FusedSearchResult = {
      items: sortedResults,
      originalQuery: variantResults[0]?.variant.query || "",
      variants: variantResults.map((vr) => vr.variant),
      variantStats,
      metadata: {
        totalVariants: variantResults.length,
        successfulVariants: variantResults.filter((vr) => vr.success).length,
        totalUniqueResults: sortedResults.length,
        averageCoverage,
        fusionMethod: mergedConfig.fusionMethod,
        executionTimeMs: Date.now() - startTime,
      },
    };

    this.logger.log(
      `[fuseResults] Fused ${result.metadata.totalUniqueResults} unique results, ` +
        `avg coverage: ${averageCoverage.toFixed(2)}`,
    );

    return result;
  }

  /**
   * URL 规范化
   */
  private normalizeUrl(url: string): string {
    if (!url) return "";
    try {
      const parsed = new URL(url);
      // 移除 trailing slash 和 fragment
      return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`;
    } catch {
      return url.toLowerCase().replace(/\/$/, "");
    }
  }

  /**
   * 完整的 RAG-Fusion 搜索流程
   */
  async fusionSearch(
    request: QueryVariantGenerationRequest,
    searchFn: (query: string) => Promise<DataSourceResult[]>,
    config: Partial<RAGFusionConfig> = {},
  ): Promise<FusedSearchResult> {
    const mergedConfig = { ...DEFAULT_RAG_FUSION_CONFIG, ...config };
    const startTime = Date.now();

    this.logger.log(
      `[fusionSearch] Starting fusion search for: ${request.originalQuery.substring(0, 50)}...`,
    );

    // 1. 生成查询变体
    const { variants } = await this.generateQueryVariants({
      ...request,
      config: mergedConfig,
    });

    // 2. ★ Critical Fix: 批量执行变体查询，限制并发数量
    const executeVariant = async (
      variant: QueryVariant,
    ): Promise<VariantSearchResult> => {
      const variantStartTime = Date.now();
      try {
        const results = await searchFn(variant.query);
        return {
          variant,
          results,
          executionTimeMs: Date.now() - variantStartTime,
          success: true,
        };
      } catch (error) {
        this.logger.warn(
          `[fusionSearch] Variant "${variant.type}" failed: ${error}`,
        );
        return {
          variant,
          results: [],
          executionTimeMs: Date.now() - variantStartTime,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };

    // 使用并发控制执行变体查询
    const variantResults = await mapWithConcurrency(
      variants,
      executeVariant,
      CONCURRENT_SEARCH_LIMIT,
    );

    // 3. 融合结果
    const fusedResult = this.fuseResults(variantResults, mergedConfig);

    // 更新总执行时间
    fusedResult.metadata.executionTimeMs = Date.now() - startTime;

    this.logger.log(
      `[fusionSearch] Completed in ${fusedResult.metadata.executionTimeMs}ms: ` +
        `${fusedResult.metadata.totalUniqueResults} unique results from ${fusedResult.metadata.successfulVariants}/${fusedResult.metadata.totalVariants} variants`,
    );

    return fusedResult;
  }

  /**
   * 将融合结果转换为标准数据源结果格式
   */
  convertToDataSourceResults(
    fusedResult: FusedSearchResult,
  ): DataSourceResult[] {
    return fusedResult.items.map((item) => ({
      ...item.item,
      metadata: {
        ...item.item.metadata,
        fusionScore: item.fusionScore,
        coverageCount: item.coverageCount,
        isContrastiveResult: item.isContrastiveResult,
        contributingVariants: item.contributingVariants.map(
          (v) => v.variantType,
        ),
      },
    }));
  }
}
