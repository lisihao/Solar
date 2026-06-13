import { Injectable, Logger, Optional } from "@nestjs/common";
import { withTimeout, withTimeoutFallback } from "@/common/utils/timeout.utils";
// ★ 架构重构：移除 SearchService 直接导入，通过 ToolRegistry 调用
// TODO: 后续添加其他数据源服务导入
// import { ArxivService } from '../../../ingestion/crawlers/arxiv.service';
// import { GithubService } from '../../../ingestion/crawlers/github.service';
// import { HackernewsService } from '../../../ingestion/crawlers/hackernews.service';

// ★ P0: 数据源连接器注册中心
import { DataSourceConnectorRegistry } from "./connectors/data-source-connector.registry";

// ★ 政策研究工具导入
// ★ 架构重构：通过 ToolRegistry 调用工具
import {
  ToolRegistry,
  FederalRegisterTool,
  CongressGovTool,
  WhiteHouseNewsTool,
  type ToolContext,
} from "@/modules/ai-harness/facade";
import { ChatFacade, RAGFacade, ToolFacade } from "@/modules/ai-harness/facade";

import {
  EntityHealthRegistry,
  TaskCompletionType,
  CapabilityGuardService,
} from "@/modules/ai-harness/facade";
import {
  DataSourceType,
  DataSourceResult,
  AggregatedSearchResult,
  SearchOptions,
  DataSourcePlan,
} from "../../types/data-source.types";
import { AIModelType, ResearchTopic, TopicDimension } from "@prisma/client";
import { DataSourcePlannerService } from "./data-source-planner.service";
import {
  dataSourceToToolId,
  convertToolsToDataSources,
} from "../../config/data-source-mapping.config";
import { LruMap } from "@/common/utils/lru-map";
import { RAGFusionService } from "./rag-fusion.service";
import type { RAGFusionConfig } from "../../types/rag-fusion.types";
import { IndustryReportSearchAdapter } from "../search/adapters/industry-report-search.adapter";

/**
 * 数据获取选项
 */
export interface FetchDataOptions {
  /** 是否使用 AI 规划数据源（默认 false，使用维度配置） */
  useAIPlanning?: boolean;
  /** 覆盖默认的 maxResults */
  maxResults?: number;
  /** 覆盖默认的时间范围 */
  since?: Date;
  /** Leader 分配的工具（可用于过滤数据源） */
  assignedTools?: string[];
  /** Leader 分配的技能（可用于定制搜索策略） */
  assignedSkills?: string[];
  /** Kernel 进程 ID（用于能力检查） */
  processId?: string;
  /** ★ RAG-Fusion 配置（启用时使用多查询融合检索） */
  ragFusionConfig?: Partial<RAGFusionConfig> & { enabled?: boolean };
}

/**
 * Data Source Router Service
 *
 * 根据维度配置路由到不同的数据源,并聚合搜索结果
 *
 * 核心功能:
 * 1. 根据 dimension.searchSources 确定使用哪些数据源
 * 2. 并行调用多个数据源
 * 3. 聚合和去重搜索结果
 * 4. 按可信度评分排序
 */
@Injectable()
export class DataSourceRouterService {
  private readonly logger = new Logger(DataSourceRouterService.name);

  constructor(
    // ★ 架构重构：通过 ToolRegistry 调用工具，不再直接依赖 SearchService
    private readonly toolRegistry: ToolRegistry,
    // TODO: 后续添加其他数据源服务
    // private readonly arxivService: ArxivService,          // Ingestion Crawlers (Academic) - TODO: implement searchOnly mode
    // private readonly githubService: GithubService,        // Ingestion Crawlers (GitHub) - TODO: implement searchOnly mode
    // private readonly hackernewsService: HackernewsService, // Ingestion Crawlers (HackerNews) - TODO: implement search API
    // private readonly rssService: RssService,
    // private readonly ragService: RagService,

    // ★ 政策研究工具（通过 AI Engine 模块注入）
    private readonly federalRegisterTool: FederalRegisterTool,
    private readonly congressGovTool: CongressGovTool,
    private readonly whiteHouseNewsTool: WhiteHouseNewsTool,
    // ★ AI 数据源规划器
    private readonly dataSourcePlanner: DataSourcePlannerService,
    // ★ Domain Facades - 用于 Social X 搜索（Grok Live Search）、RAG 搜索、能力解析
    private readonly chatFacade: ChatFacade,
    private readonly ragFacade: RAGFacade,
    private readonly toolFacade: ToolFacade,
    // ★ P0: 数据源连接器注册中心（可选，向后兼容）
    @Optional()
    private readonly connectorRegistry?: DataSourceConnectorRegistry,
    // ★ CircuitBreaker: 数据源容错（可选，Kernel 不可用时降级）
    @Optional()
    private readonly circuitBreaker?: EntityHealthRegistry,
    // ★ Batch 2: 数据源访问能力检查
    @Optional()
    private readonly capabilityGuard?: CapabilityGuardService,
    // ★ RAG-Fusion: 多查询融合检索（可选，standard/thorough 深度启用）
    @Optional()
    private readonly ragFusionService?: RAGFusionService,
    // ★ Industry Report: 行业报告聚合搜索
    @Optional()
    private readonly industryReportAdapter?: IndustryReportSearchAdapter,
  ) {}

  /**
   * ★ AI 规划缓存（LruMap 自动淘汰，防止内存泄漏）
   */
  private readonly planCache = new LruMap<string, DataSourcePlan>(100);

  /**
   * 为指定维度获取数据
   *
   * @param dimension 研究维度
   * @param topic 研究主题
   * @param options 可选配置（AI 规划、maxResults 等）
   * @returns 聚合的搜索结果
   */
  async fetchDataForDimension(
    dimension: TopicDimension,
    topic: ResearchTopic,
    options?: FetchDataOptions,
  ): Promise<AggregatedSearchResult> {
    const startTime = Date.now();
    const useAIPlanning = options?.useAIPlanning ?? false;

    // ★ 提取 Leader 分配的工具
    const assignedTools = options?.assignedTools || [];

    this.logger.log(
      `Fetching data for dimension: ${dimension.name} (topic: ${topic.name}, AI planning: ${useAIPlanning}, assignedTools: [${assignedTools.join(", ")}])`,
    );

    // 1. 确定要使用的数据源
    let sources: DataSourceType[];
    let aiPlan: DataSourcePlan | undefined;

    // ★ 优先使用 Leader 分配的工具
    if (assignedTools.length > 0) {
      sources = this.convertToolsToDataSources(assignedTools);
      this.logger.log(
        `[Assigned Tools] Using Leader-assigned tools: [${assignedTools.join(", ")}] → DataSources: [${sources.join(", ")}]`,
      );
      // 如果转换后没有有效的数据源，回退到其他方式
      if (sources.length === 0) {
        this.logger.warn(
          `[Assigned Tools] No valid data sources from assigned tools, falling back to dimension config`,
        );
        sources = this.getDataSourcesForDimension(dimension);
      }
    } else if (useAIPlanning) {
      // ★ 使用 AI 规划数据源
      aiPlan = await this.getAIPlanForDimension(dimension, topic);
      sources = aiPlan.recommendedSources;
      this.logger.log(
        `[AI Planning] Recommended sources: ${sources.join(", ")} (confidence: ${aiPlan.confidence}%)`,
      );
    } else {
      // 使用维度配置的数据源
      sources = this.getDataSourcesForDimension(dimension);
    }

    if (sources.length === 0) {
      this.logger.warn(
        `No data sources configured for dimension: ${dimension.name}`,
      );
      return {
        items: [],
        totalCount: 0,
        sources: [],
        metadata: {
          searchQuery: "",
          executionTimeMs: Date.now() - startTime,
          sourceResults: {
            [DataSourceType.WEB]: 0,
            [DataSourceType.ACADEMIC]: 0,
            [DataSourceType.GITHUB]: 0,
            [DataSourceType.HACKERNEWS]: 0,
            [DataSourceType.RSS]: 0,
            [DataSourceType.LOCAL]: 0,
            [DataSourceType.FEDERAL_REGISTER]: 0,
            [DataSourceType.CONGRESS]: 0,
            [DataSourceType.WHITEHOUSE]: 0,
            [DataSourceType.SOCIAL_X]: 0,
            [DataSourceType.SEMANTIC_SCHOLAR]: 0,
            [DataSourceType.PUBMED]: 0,
            [DataSourceType.OPENALEX]: 0,
            [DataSourceType.FINANCE_API]: 0,
            [DataSourceType.WEATHER_API]: 0,
            [DataSourceType.INDUSTRY_REPORT]: 0,
          },
        },
      };
    }

    // 2. 构建搜索查询
    const searchQueries = await this.buildSearchQueries(topic, dimension);
    const searchQuery = searchQueries[0]; // primary query for metadata

    this.logger.debug(
      `Search queries: ${searchQueries.map((q) => `"${q}"`).join(", ")}`,
    );

    // ★ 从 topicConfig 中获取时间范围，默认最近 6 个月
    const userConfiguredSince = this.getSearchTimeRange(topic);
    // 如果用户没有配置时间范围，默认使用最近 6 个月
    const defaultSince = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const since = userConfiguredSince || defaultSince;

    this.logger.debug(
      `Using time range filter: since ${since.toISOString()}${!userConfiguredSince ? " (default 6 months)" : ""}`,
    );

    // ★ Batch 2: Capability check — 过滤无权限的数据源
    if (this.capabilityGuard && options?.processId) {
      try {
        const allowedSources: DataSourceType[] = [];
        for (const source of sources) {
          const check = await this.capabilityGuard.checkDataAccess(
            options.processId,
            "data_source",
            source,
          );
          if (check.allowed) {
            allowedSources.push(source);
          } else {
            this.logger.debug(
              `[CapabilityGuard] Data source '${source}' denied for process ${options.processId}`,
            );
          }
        }
        if (allowedSources.length > 0) {
          sources = allowedSources;
        } else {
          this.logger.warn(
            `[CapabilityGuard] All sources denied, using original sources as fallback`,
          );
        }
      } catch (err) {
        this.logger.debug(
          `[CapabilityGuard] Check failed (non-blocking): ${err instanceof Error ? err.message : err}`,
        );
      }
    } else if (!this.capabilityGuard && options?.processId) {
      // Guard is @Optional but processId is provided — reject rather than silently skip
      // to prevent cross-workspace data source access.
      throw new Error(
        `CapabilityGuardService is required when processId is supplied (processId=${options.processId}). Ensure CapabilityGuardService is registered in the module.`,
      );
    }

    // 3. 并行调用所有数据源
    // ★ RAG-Fusion: 如果启用，使用多查询融合检索提升召回率
    const ragFusionEnabled =
      this.ragFusionService &&
      options?.ragFusionConfig?.enabled &&
      searchQueries.length > 0;

    let aggregated: AggregatedSearchResult;

    if (ragFusionEnabled) {
      this.logger.log(
        `[RAG-Fusion] Enabled for dimension: ${dimension.name}, primary query: "${searchQuery}"`,
      );
      try {
        const fusedResult = await this.ragFusionService.fusionSearch(
          {
            originalQuery: searchQuery,
            context: {
              topicName: topic.name,
              dimensionName: dimension.name,
            },
            config: options?.ragFusionConfig,
          },
          async (variantQuery: string) => {
            // 对每个变体查询执行所有数据源搜索
            const variantPromises: Promise<DataSourceResult[]>[] = [];
            for (const source of sources) {
              variantPromises.push(
                this.searchSource(
                  source,
                  variantQuery,
                  { maxResults: 5, since },
                  topic,
                ),
              );
            }
            const variantResults = await Promise.allSettled(variantPromises);
            return variantResults.flatMap((r) =>
              r.status === "fulfilled" ? r.value : [],
            );
          },
          options?.ragFusionConfig,
        );

        const fusedItems =
          this.ragFusionService.convertToDataSourceResults(fusedResult);
        aggregated = {
          items: fusedItems,
          totalCount: fusedItems.length,
          sources,
        };

        this.logger.log(
          `[RAG-Fusion] Fused ${fusedResult.metadata.totalUniqueResults} unique results ` +
            `from ${fusedResult.metadata.successfulVariants}/${fusedResult.metadata.totalVariants} variants ` +
            `in ${fusedResult.metadata.executionTimeMs}ms`,
        );
      } catch (fusionError) {
        this.logger.warn(
          `[RAG-Fusion] Failed, falling back to standard search: ${fusionError instanceof Error ? fusionError.message : fusionError}`,
        );
        // 降级到标准搜索
        aggregated = await this.standardSearch(
          sources,
          searchQueries,
          since,
          topic,
          dimension,
        );
      }
    } else {
      aggregated = await this.standardSearch(
        sources,
        searchQueries,
        since,
        topic,
        dimension,
      );
    }

    // ★ H4: 所有数据源都失败或无结果时，兜底使用 WEB 源
    if (aggregated.totalCount === 0 && !sources.includes(DataSourceType.WEB)) {
      this.logger.warn(
        `[fetchDataForDimension] All ${sources.length} sources returned 0 results, falling back to WEB`,
      );
      try {
        const webResult = await this.searchSource(
          DataSourceType.WEB,
          searchQuery,
          { maxResults: 25, since },
        );
        if (webResult.length > 0) {
          aggregated = {
            items: webResult,
            totalCount: webResult.length,
            sources: [DataSourceType.WEB],
          };
        }
      } catch (webErr) {
        this.logger.error(
          `[fetchDataForDimension] WEB fallback also failed: ${(webErr as Error).message}`,
        );
      }
    }

    const executionTime = Date.now() - startTime;

    this.logger.log(
      `Fetched ${aggregated.totalCount} results from ${sources.length} sources in ${executionTime}ms`,
    );

    // Build sourceResults from aggregated items
    const sourceResults = {} as Record<string, number>;
    for (const item of aggregated.items) {
      const src = item.sourceType ?? "unknown";
      sourceResults[src] = (sourceResults[src] || 0) + 1;
    }

    return {
      ...aggregated,
      metadata: {
        searchQuery,
        executionTimeMs: executionTime,
        sourceResults: sourceResults as Record<DataSourceType, number>,
      },
    };
  }

  /**
   * 标准搜索流程（非 RAG-Fusion 路径）
   * 对每个查询 × 每个数据源执行搜索并聚合结果
   */
  private async standardSearch(
    sources: DataSourceType[],
    searchQueries: string[],
    since: Date,
    topic?: ResearchTopic,
    dimension?: TopicDimension,
  ): Promise<AggregatedSearchResult> {
    const maxResultsPerQuery = Math.max(
      5,
      Math.ceil(25 / searchQueries.length),
    );

    // ★ Rate-limit fix: run queries per-source sequentially, sources in parallel.
    // Previously all source×query combinations fired at once via Promise.allSettled,
    // causing rate-limited APIs (ArXiv: 3 req/s) to queue 16-24 requests simultaneously
    // across 4-8 concurrent dimensions. By serialising queries within each source,
    // each dimension only occupies one slot at a time per source.
    const sourcePromises: Promise<{
      results: PromiseSettledResult<DataSourceResult[]>[];
      source: DataSourceType;
    }>[] = [];

    for (const source of sources) {
      // Each source runs its queries sequentially, but all sources run in parallel
      sourcePromises.push(
        (async () => {
          const results: PromiseSettledResult<DataSourceResult[]>[] = [];
          for (const query of searchQueries) {
            // ★ 早停：已拿到足够结果则跳过后续查询
            const existingCount = results
              .filter((r) => r.status === "fulfilled")
              .reduce((sum, r) => sum + r.value.length, 0);
            if (existingCount >= maxResultsPerQuery) break;

            // ★ WEB 源加时间后缀提高时效性；其他源（ACADEMIC 等）不加
            const finalQuery =
              source === DataSourceType.WEB && dimension
                ? this.enhanceQueryWithTimestamp(query, dimension)
                : query;

            try {
              const data = await this.searchSource(
                source,
                finalQuery,
                { maxResults: maxResultsPerQuery, since },
                topic,
              );
              results.push({ status: "fulfilled", value: data });
            } catch (error) {
              results.push({
                status: "rejected",
                reason: error,
              });
            }
          }
          return { results, source };
        })(),
      );
    }

    const sourceResults = await Promise.allSettled(sourcePromises);

    // Flatten back to the format aggregateResults expects
    const allResults: PromiseSettledResult<DataSourceResult[]>[] = [];
    const searchSources: DataSourceType[] = [];

    for (const sr of sourceResults) {
      if (sr.status === "fulfilled") {
        for (const r of sr.value.results) {
          allResults.push(r);
          searchSources.push(sr.value.source);
        }
      } else {
        // Source-level failure: treat all queries for this source as rejected
        for (const _query of searchQueries) {
          allResults.push({ status: "rejected", reason: sr.reason });
          // We don't know which source failed at this level, but it won't matter
          // because aggregateResults only uses fulfilled results
          searchSources.push(sources[0]);
        }
      }
    }

    return this.aggregateResults(allResults, searchSources);
  }

  /**
   * V5 L2: 文献基线扫描
   * 构造学术导向查询，复用现有搜索基础设施
   * 仅 standard/thorough 模式启用
   */
  async scanLiteratureBaseline(
    topic: ResearchTopic,
    dimension: TopicDimension,
  ): Promise<DataSourceResult[]> {
    this.logger.log(
      `[scanLiteratureBaseline] Scanning literature baseline for dimension: ${dimension.name}`,
    );

    // Construct academic-oriented queries
    const academicQueries = this.buildAcademicQueries(
      topic.name,
      dimension.name,
      dimension.description || "",
    );

    const allResults: DataSourceResult[] = [];

    for (const query of academicQueries) {
      try {
        const results = await this.executeSearch(DataSourceType.WEB, query, 5);
        allResults.push(...results);
      } catch (error) {
        this.logger.warn(
          `[scanLiteratureBaseline] Query failed: "${query.substring(0, 50)}...": ${error}`,
        );
      }
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    const deduped = allResults.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    this.logger.log(
      `[scanLiteratureBaseline] Found ${deduped.length} unique academic sources`,
    );

    return deduped;
  }

  /**
   * V5: 构造学术导向搜索查询
   * ★ 增强：中文关键词自动提取英文术语用于英文学术站搜索
   */
  private buildAcademicQueries(
    topicName: string,
    dimensionName: string,
    dimensionDescription: string,
  ): string[] {
    const keywords = `${topicName} ${dimensionName}`.trim();

    const sanitizedDescription = dimensionDescription
      .replace(/[^\w\s\u4e00-\u9fff-]/g, " ")
      .slice(0, 200)
      .trim();

    // 从 description 中提取英文术语用于英文学术站
    const englishTerms =
      sanitizedDescription.match(/[a-zA-Z][\w-]*(?:\s+[a-zA-Z][\w-]*)*/g) || [];
    const bestEnglishTerm = englishTerms
      .filter((t) => t.length >= 3)
      .sort((a, b) => b.length - a.length)[0];

    // 英文学术站用英文术语搜索（如果有），否则用原始关键词
    const academicKeywords = bestEnglishTerm || keywords;

    return [
      `${academicKeywords} research report 2024 2025 site:mckinsey.com OR site:bcg.com OR site:hbr.org`,
      `${academicKeywords} analysis whitepaper site:gartner.com OR site:forrester.com OR site:deloitte.com`,
      `${keywords} ${sanitizedDescription.split(/\s+/).slice(0, 5).join(" ")} academic paper`,
    ];
  }

  /**
   * V5: 基于假设生成正反方向搜索查询并执行搜索
   * 用于假设驱动的知识构建
   */
  async searchForHypothesis(hypothesisStatement: string): Promise<{
    supportResults: DataSourceResult[];
    counterResults: DataSourceResult[];
  }> {
    this.logger.log(
      `[searchForHypothesis] Generating queries for hypothesis: ${hypothesisStatement.substring(0, 80)}...`,
    );

    // Generate support and counter queries from hypothesis
    const keywords = hypothesisStatement
      .replace(/["""'']/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 6)
      .join(" ");

    const supportQueries = [
      `${keywords} evidence support`,
      `${keywords} research findings`,
    ];
    const counterQueries = [
      `${keywords} criticism challenges limitations`,
      `${keywords} counter evidence against`,
    ];

    const executeQueries = async (
      queries: string[],
    ): Promise<DataSourceResult[]> => {
      const results: DataSourceResult[] = [];
      for (const query of queries) {
        try {
          const r = await this.executeSearch(DataSourceType.WEB, query, 3);
          results.push(...r);
        } catch (error) {
          this.logger.warn(`[searchForHypothesis] Query failed: ${error}`);
        }
      }
      return results;
    };

    const [supportResults, counterResults] = await Promise.all([
      executeQueries(supportQueries),
      executeQueries(counterQueries),
    ]);

    this.logger.log(
      `[searchForHypothesis] Found ${supportResults.length} support, ${counterResults.length} counter results`,
    );

    return { supportResults, counterResults };
  }

  /**
   * 从维度配置中提取数据源列表
   */
  private getDataSourcesForDimension(
    dimension: TopicDimension,
  ): DataSourceType[] {
    // 从 dimension.searchSources 解析数据源
    // searchSources 是 JSON 数组,例如: ["web", "academic", "github"]
    const searchSources = dimension.searchSources as string[] | null;

    if (!searchSources || !Array.isArray(searchSources)) {
      this.logger.warn(
        `Invalid searchSources for dimension ${dimension.name}, using default: [web]`,
      );
      return [DataSourceType.WEB];
    }

    // 转换为 DataSourceType 枚举
    const validSources = searchSources
      .filter((source: string) =>
        Object.values(DataSourceType).includes(source as DataSourceType),
      )
      .map((source: string) => source as DataSourceType);

    if (validSources.length === 0) {
      this.logger.warn(
        `No valid sources in searchSources for dimension ${dimension.name}, using default: [web]`,
      );
      return [DataSourceType.WEB];
    }

    return validSources;
  }

  /**
   * 从 topic 配置中获取时间范围
   * @param topic 研究主题
   * @returns 时间范围的起始日期，如果没有限制则返回 undefined
   */
  private getSearchTimeRange(topic: ResearchTopic): Date | undefined {
    const config = topic.topicConfig as Record<string, unknown> | null;
    if (!config?.searchTimeRange || config.searchTimeRange === "all") {
      return undefined;
    }

    const now = new Date();
    const timeRange = config.searchTimeRange as string;

    switch (timeRange) {
      case "6months":
        return new Date(now.getTime() - 6 * 30 * 24 * 60 * 60 * 1000);
      case "1year":
        return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      case "2years":
        return new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000);
      case "3years":
        return new Date(now.getTime() - 3 * 365 * 24 * 60 * 60 * 1000);
      case "5years":
        return new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);
      default:
        this.logger.warn(`Unknown time range: ${timeRange}, ignoring`);
        return undefined;
    }
  }

  /**
   * 检测文本是否包含中文字符
   */
  private containsChinese(text: string): boolean {
    return /[\u4e00-\u9fff]/.test(text);
  }

  /**
   * 构建搜索查询列表
   * ★ 全英文策略：所有查询统一翻译为英文关键词
   *   - 英文关键词在 web/academic/github 等所有数据源上效果最佳
   *   - 中文查询在英文数据库（OpenAlex、Semantic Scholar、ArXiv、PubMed）上无结果
   *   - 搜索引擎（Google/Bing）对英文关键词的覆盖范围更广
   */
  private async buildSearchQueries(
    topic: ResearchTopic,
    dimension: TopicDimension,
  ): Promise<string[]> {
    const topicName = topic.name;
    const dimensionName = dimension.name;

    const searchQueries = dimension.searchQueries as string[] | null;

    const rawQueries: string[] = [];
    if (
      searchQueries &&
      Array.isArray(searchQueries) &&
      searchQueries.length > 0
    ) {
      // 使用所有预定义查询（最多 3 个）
      rawQueries.push(...searchQueries.slice(0, 3));
    }

    // 始终添加默认查询作为兜底
    const defaultQuery = `${topicName} ${dimensionName}`;
    if (!rawQueries.some((q) => q === defaultQuery)) {
      rawQueries.push(defaultQuery);
    }

    // ★ 全英文策略：将所有中文查询批量翻译为英文
    const englishQueries: string[] = [];
    const chineseQueries = rawQueries.filter((q) => this.containsChinese(q));
    const existingEnglish = rawQueries.filter((q) => !this.containsChinese(q));

    if (chineseQueries.length > 0) {
      // 批量翻译（最多 3 条，控制 LLM 调用次数）
      const translationPromises = chineseQueries
        .slice(0, 3)
        .map((q) => this.translateToEnglish(q));
      const translations = await Promise.all(translationPromises);
      for (const t of translations) {
        if (t) englishQueries.push(t);
      }
    }

    // 合并：翻译后的英文 + 原有英文，去重，最多 5 个
    const allQueries = [...englishQueries, ...existingEnglish]
      .filter((q, i, arr) => arr.indexOf(q) === i)
      .slice(0, 5);

    // 如果翻译全部失败，回退到原始查询（总比没有好）
    if (allQueries.length === 0) {
      allQueries.push(...rawQueries.slice(0, 3));
    }

    this.logger.log(
      `[buildSearchQueries] Generated ${allQueries.length} English queries: ${allQueries.map((q) => `"${q}"`).join(", ")}`,
    );

    return allQueries;
  }

  /**
   * 中文查询 → 英文搜索关键词（LLM 翻译，覆盖所有数据源）
   */
  private async translateToEnglish(query: string): Promise<string | null> {
    try {
      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content:
              "You are a translator. Convert the Chinese search query to English search keywords. Output ONLY the English keywords, nothing else. Keep it concise (max 10 words).",
          },
          { role: "user", content: query },
        ],
        operationName: "证据提取",
        modelType: AIModelType.CHAT,
        skipGuardrails: true, // 内部系统调用，翻译搜索查询
        taskProfile: { creativity: "deterministic", outputLength: "minimal" },
      });

      if (response?.isError) return null;
      const result = response?.content?.trim();
      if (!result || result.length < 3) return null;
      this.logger.log(`[translateToEnglish] "${query}" → "${result}"`);
      return result;
    } catch (error) {
      this.logger.warn(
        `[translateToEnglish] Failed: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /**
   * 增强搜索查询，添加时间戳关键词
   * ★ 确保搜索结果的时效性
   */
  private enhanceQueryWithTimestamp(
    query: string,
    dimension: TopicDimension,
  ): string {
    const currentYear = new Date().getFullYear();

    // 检查查询是否已包含年份或时效性关键词
    const hasTimestampKeyword =
      /20\d{2}|latest|recent|最新|最近|current|今年|本年/i.test(query);

    if (hasTimestampKeyword) {
      return query;
    }

    // 根据维度类型选择合适的时效性关键词
    const freshnessKeywords = this.getFreshnessKeywords(dimension);

    return `${query} ${currentYear} ${freshnessKeywords}`.trim();
  }

  /**
   * 根据维度类型获取时效性关键词
   */
  private getFreshnessKeywords(dimension: TopicDimension): string {
    if (!dimension?.name) return "";
    const dimensionLower = dimension.name.toLowerCase();

    // 政策法规类
    if (
      dimensionLower.includes("政策") ||
      dimensionLower.includes("法规") ||
      dimensionLower.includes("regulation") ||
      dimensionLower.includes("policy")
    ) {
      return "latest policy regulation";
    }

    // 市场投资类
    if (
      dimensionLower.includes("市场") ||
      dimensionLower.includes("投资") ||
      dimensionLower.includes("market") ||
      dimensionLower.includes("investment")
    ) {
      return "market report forecast";
    }

    // 技术趋势类
    if (
      dimensionLower.includes("技术") ||
      dimensionLower.includes("趋势") ||
      dimensionLower.includes("technology") ||
      dimensionLower.includes("trend")
    ) {
      return "emerging breakthrough latest";
    }

    // 竞争格局类
    if (
      dimensionLower.includes("竞争") ||
      dimensionLower.includes("玩家") ||
      dimensionLower.includes("competitor") ||
      dimensionLower.includes("player")
    ) {
      return "landscape analysis";
    }

    // 默认：通用时效性关键词
    return "latest recent";
  }

  /**
   * 搜索指定数据源
   * ★ Critical Fix: topic 作为参数传递，避免实例变量的并发竞态
   */
  private async searchSource(
    source: DataSourceType,
    query: string,
    options: SearchOptions,
    topic?: ResearchTopic,
  ): Promise<DataSourceResult[]> {
    const timeout = options.timeout || 30000;
    const maxResults = options.maxResults || 10;
    const entityId = `datasource:${source}`;

    this.logger.debug(`Searching ${source} with query: "${query}"`);

    // ★ CircuitBreaker: 检查数据源熔断状态
    if (this.circuitBreaker && !this.circuitBreaker.canExecute(entityId)) {
      this.logger.warn(
        `[searchSource] Circuit breaker OPEN for ${entityId}, skipping`,
      );
      return [];
    }

    const startTime = Date.now();

    try {
      // 超时控制
      const results = await withTimeout(
        this.executeSearch(source, query, maxResults, options.since, topic),
        timeout,
        `Search timeout: ${source}`,
      );

      // ★ CircuitBreaker: 记录成功
      if (this.circuitBreaker) {
        this.circuitBreaker.recordSuccess(entityId, Date.now() - startTime);
      }

      this.logger.debug(`${source} returned ${results.length} results`);

      return results;
    } catch (error) {
      // ★ CircuitBreaker: 记录失败
      if (this.circuitBreaker) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorType = errorMsg.includes("timeout")
          ? TaskCompletionType.TIMEOUT
          : TaskCompletionType.API_ERROR;
        this.circuitBreaker.recordFailure(entityId, errorType, errorMsg);
      }

      this.logger.error(
        `Failed to search ${source}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 执行具体的搜索操作
   * ★ 增强：在调用工具前检查 Admin 是否启用该工具
   * ★ Critical Fix: topic 作为参数传递，避免实例变量的并发竞态
   */
  private async executeSearch(
    source: DataSourceType,
    query: string,
    maxResults: number,
    since?: Date,
    topic?: ResearchTopic,
  ): Promise<DataSourceResult[]> {
    // ★ Industry Report: 使用 SearchAdapter 而非 ToolRegistry，跳过 isToolEnabled 检查
    // adapter 内部通过 ToolConfig.enabled 自行管理启用状态
    if (source === DataSourceType.INDUSTRY_REPORT) {
      if (this.industryReportAdapter) {
        const adapterResult = await this.industryReportAdapter.search({
          query,
          maxResults,
          timeoutMs: 20000,
          metadata: { topicType: topic?.type },
        });
        return adapterResult.items;
      }
      return [];
    }

    // ★ 检查特殊工具是否被 Admin 启用
    const toolId = this.dataSourceToToolId(source);
    if (toolId) {
      const isEnabled = await this.isToolEnabled(toolId);
      if (!isEnabled) {
        this.logger.warn(
          `[executeSearch] Tool ${toolId} for data source ${source} is disabled by Admin, skipping`,
        );
        return [];
      }
    }

    switch (source) {
      case DataSourceType.WEB:
        return this.searchWeb(query, maxResults, since);

      case DataSourceType.ACADEMIC:
        return this.searchAcademic(query, maxResults, since);

      case DataSourceType.GITHUB:
        return this.searchGithub(query, maxResults);

      case DataSourceType.HACKERNEWS:
        return this.searchHackerNews(query, maxResults);

      case DataSourceType.RSS:
        // TODO: 实现 RSS 搜索
        this.logger.warn("RSS search not implemented yet");
        return [];

      case DataSourceType.LOCAL:
        return this.searchLocal(query, maxResults, topic);

      // ★ 政策研究数据源
      case DataSourceType.FEDERAL_REGISTER:
        return this.searchFederalRegister(query, maxResults);

      case DataSourceType.CONGRESS:
        return this.searchCongress(query, maxResults);

      case DataSourceType.WHITEHOUSE:
        return this.searchWhiteHouse(query, maxResults);

      // ★ 社媒数据源
      case DataSourceType.SOCIAL_X:
        return this.searchSocialX(query, maxResults);

      // ★ 学术/专业数据源（通过 ToolRegistry 直接调用）
      case DataSourceType.SEMANTIC_SCHOLAR:
        return this.searchViaTool(
          "semantic-scholar",
          source,
          query,
          maxResults,
        );
      case DataSourceType.PUBMED:
        return this.searchViaTool("pubmed", source, query, maxResults);
      case DataSourceType.OPENALEX:
        return this.searchViaTool("openalex-search", source, query, maxResults);
      case DataSourceType.FINANCE_API:
        return this.searchViaTool("finance-api", source, query, maxResults);
      case DataSourceType.WEATHER_API:
        return this.searchViaTool("weather-api", source, query, maxResults);

      default:
        // 尝试通过 ConnectorRegistry fallback（未来扩展的自定义连接器）
        return this.searchViaConnector(source, query, maxResults);
    }
  }

  /**
   * 通过 ConnectorRegistry 执行搜索（fallback 路径）
   * 用于未来扩展的自定义数据源连接器
   */
  private async searchViaConnector(
    source: DataSourceType,
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    if (!this.connectorRegistry) {
      this.logger.warn(
        `[searchViaConnector] No handler for data source: ${source}`,
      );
      return [];
    }

    return this.connectorRegistry.searchViaConnector(source, query, maxResults);
  }

  /**
   * 通过 ToolRegistry 直接调用工具执行搜索
   * 通用路由：将工具返回的 data 转为 DataSourceResult[]
   */
  private async searchViaTool(
    toolId: string,
    sourceType: DataSourceType,
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      const tool = this.toolRegistry.tryGet(toolId);
      if (!tool) {
        this.logger.warn(
          `[searchViaTool] ${toolId} tool not registered in ToolRegistry`,
        );
        return [];
      }

      this.logger.log(
        `[searchViaTool] Calling ${toolId}: "${query}", maxResults=${maxResults}`,
      );

      const result = await tool.execute(
        { query, maxResults },
        this.createToolContext(toolId),
      );

      if (!result.success || !result.data) {
        this.logger.warn(
          `[searchViaTool] ${toolId} failed: ${result.error?.message || "no data"}`,
        );
        return [];
      }

      // 将工具结果统一转为 DataSourceResult
      return this.convertToolResultToDataSource(
        toolId,
        sourceType,
        result.data,
      );
    } catch (error) {
      this.logger.error(
        `[searchViaTool] ${toolId} error: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }

  /**
   * 将各种工具的输出格式统一转换为 DataSourceResult[]
   */
  private convertToolResultToDataSource(
    toolId: string,
    sourceType: DataSourceType,
    data: unknown,
  ): DataSourceResult[] {
    const record = data as Record<string, unknown>;

    switch (toolId) {
      case "openalex-search": {
        const papers = (record.papers || []) as Array<{
          title: string;
          url: string;
          abstract?: string;
          authors?: string[];
          year?: number;
          citationCount?: number;
          doi?: string;
          openAccessUrl?: string;
          source?: string;
        }>;
        return papers.map((p) => ({
          sourceType,
          title: p.title,
          url: p.openAccessUrl || p.url,
          snippet: p.abstract || "",
          domain: "openalex.org",
          metadata: {
            authors: p.authors,
            year: p.year,
            citationCount: p.citationCount,
            doi: p.doi,
            source: p.source,
          },
        }));
      }

      case "semantic-scholar": {
        const papers = (record.papers || []) as Array<{
          title: string;
          url: string;
          abstract?: string;
          authors?: string[];
          year?: number;
          citationCount?: number;
          paperId?: string;
          doi?: string;
        }>;
        return papers.map((p) => ({
          sourceType,
          title: p.title,
          url: p.url || `https://www.semanticscholar.org/paper/${p.paperId}`,
          snippet: p.abstract || "",
          domain: "semanticscholar.org",
          metadata: {
            authors: p.authors,
            year: p.year,
            citationCount: p.citationCount,
            doi: p.doi,
          },
        }));
      }

      case "pubmed": {
        const articles = (record.articles || []) as Array<{
          title: string;
          pubmedUrl: string;
          abstract?: string;
          authors?: string[];
          journal?: string;
          publishedDate?: string;
          doi?: string;
        }>;
        return articles.map((a) => ({
          sourceType,
          title: a.title,
          url: a.pubmedUrl,
          snippet: a.abstract || "",
          publishedAt: a.publishedDate ? new Date(a.publishedDate) : undefined,
          domain: "pubmed.ncbi.nlm.nih.gov",
          metadata: {
            authors: a.authors,
            journal: a.journal,
            doi: a.doi,
          },
        }));
      }

      case "finance-api": {
        const dataPoints = (record.data || []) as Array<{
          date: string;
          value: string;
          label?: string;
        }>;
        const metadata = record.metadata as Record<string, string> | undefined;
        if (dataPoints.length === 0) return [];
        // 返回一个汇总结果
        return [
          {
            sourceType,
            title: metadata?.symbol
              ? `Financial data: ${metadata.symbol}`
              : `Financial data: ${record.queryType}`,
            url: "",
            snippet: dataPoints
              .slice(0, 5)
              .map(
                (d) => `${d.date}: ${d.value}${d.label ? ` (${d.label})` : ""}`,
              )
              .join("; "),
            domain: "alphavantage.co",
            metadata: { ...metadata, pointCount: dataPoints.length },
          },
        ];
      }

      case "weather-api": {
        const location = record.location as
          | {
              name?: string;
              country?: string;
            }
          | undefined;
        const current = record.current as
          | {
              temp?: number;
              description?: string;
              humidity?: number;
            }
          | undefined;
        const locationName = location?.name || "Unknown";
        if (!current && !record.forecast) return [];
        return [
          {
            sourceType,
            title: `Weather: ${locationName}, ${location?.country || ""}`,
            url: "",
            snippet: current
              ? `${current.description}, ${current.temp}°C, humidity ${current.humidity}%`
              : "Forecast data available",
            domain: "openweathermap.org",
            metadata: { location, current },
          },
        ];
      }

      default:
        this.logger.warn(
          `[convertToolResultToDataSource] Unknown tool: ${toolId}`,
        );
        return [];
    }
  }

  /**
   * Web 搜索
   * ★ 架构重构：通过 ToolRegistry 调用 web-search 工具，不再直接调用 SearchService
   */
  private async searchWeb(
    query: string,
    maxResults: number,
    since?: Date,
  ): Promise<DataSourceResult[]> {
    this.logger.log(
      `[searchWeb] Calling web-search tool via ToolRegistry with query="${query}", maxResults=${maxResults}, since=${since?.toISOString() || "none"}`,
    );

    // ★ 通过 ToolRegistry 获取 web-search 工具
    const webSearchTool = this.toolRegistry.tryGet("web-search");
    if (!webSearchTool) {
      this.logger.error(
        "[searchWeb] web-search tool not registered in ToolRegistry",
      );
      return [];
    }

    try {
      // ★ 通过工具系统执行搜索
      const toolResult = await webSearchTool.execute(
        {
          query,
          numResults: maxResults,
          // since 参数由工具内部处理（如果支持的话）
        },
        this.createToolContext("web-search"),
      );

      if (!toolResult.success || !toolResult.data) {
        this.logger.warn(
          `[searchWeb] Search failed or no results: ${toolResult.error?.message || "unknown error"}`,
        );
        return [];
      }

      const searchData = toolResult.data as {
        results: Array<{
          title: string;
          url: string;
          content: string;
          publishedDate?: string;
          domain?: string;
          score?: number;
          rawScore?: number;
        }>;
        success: boolean;
        provider?: string;
      };

      this.logger.log(
        `[searchWeb] Tool response: success=${searchData.success}, provider=${searchData.provider || "unknown"}, results=${searchData.results?.length || 0}`,
      );

      if (!searchData.success || !searchData.results) {
        this.logger.warn("[searchWeb] Tool returned unsuccessful result");
        return [];
      }

      return searchData.results.map((result) => ({
        sourceType: DataSourceType.WEB,
        title: result.title,
        url: result.url,
        snippet: result.content,
        domain: result.domain,
        publishedAt: result.publishedDate
          ? new Date(result.publishedDate)
          : undefined,
        metadata: {
          score: result.score,
          rawScore: result.rawScore,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchWeb] Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 学术搜索（并行可靠源 + 共享预算）
   *
   * 架构：
   *   阶段1: OpenAlex + PubMed 并行（两个最可靠、无限流问题的源）
   *   阶段2: 仅在阶段1结果不足且有预算时，尝试 SS / ArXiv
   *   共享预算: 整个方法 20s 上限，避免阻塞维度数据收集
   */
  private async searchAcademic(
    query: string,
    maxResults: number,
    _since?: Date,
  ): Promise<DataSourceResult[]> {
    const BUDGET_MS = 20000;
    const deadline = Date.now() + BUDGET_MS;
    const remainingMs = () => Math.max(0, deadline - Date.now());

    this.logger.log(
      `[searchAcademic] Starting parallel search: "${query.substring(0, 60)}...", budget=${BUDGET_MS}ms`,
    );

    // ★ 阶段1: 可靠源并行（OpenAlex + PubMed）
    const [oaResults, pmResults] = await Promise.all([
      this.searchViaToolWithTimeout(
        "openalex-search",
        DataSourceType.OPENALEX,
        query,
        maxResults,
        Math.min(10000, remainingMs()),
      ),
      this.searchViaToolWithTimeout(
        "pubmed",
        DataSourceType.PUBMED,
        query,
        maxResults,
        Math.min(10000, remainingMs()),
      ),
    ]);

    const merged = this.deduplicateResults([...oaResults, ...pmResults]);

    this.logger.log(
      `[searchAcademic] Phase 1 (OpenAlex+PubMed): ${oaResults.length}+${pmResults.length} → ${merged.length} unique, ${remainingMs()}ms remaining`,
    );

    if (merged.length >= maxResults || remainingMs() <= 0) {
      return merged.slice(0, maxResults);
    }

    // ★ 阶段2: 备选源（仅在有预算且需要更多结果时）
    // Semantic Scholar
    if (remainingMs() > 2000) {
      const ssResults = await this.searchViaToolWithTimeout(
        "semantic-scholar",
        DataSourceType.SEMANTIC_SCHOLAR,
        query,
        maxResults,
        Math.min(8000, remainingMs()),
      );
      if (ssResults.length > 0) {
        merged.push(...ssResults);
        this.logger.log(
          `[searchAcademic] Phase 2 SS: +${ssResults.length} results`,
        );
      }
    }

    if (merged.length >= maxResults || remainingMs() <= 2000) {
      return this.deduplicateResults(merged).slice(0, maxResults);
    }

    // ArXiv（带超时包装，防止重试阻塞）
    try {
      const arxivTimeout = Math.min(8000, remainingMs());
      const arxivResults = await withTimeoutFallback(
        this.searchArxiv(query, maxResults),
        arxivTimeout,
        [] as DataSourceResult[],
      );
      if (arxivResults.length > 0) {
        merged.push(...arxivResults);
        this.logger.log(
          `[searchAcademic] Phase 2 ArXiv: +${arxivResults.length} results`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[searchAcademic] ArXiv search failed (non-critical): ${(err as Error).message}`,
      );
    }

    const final = this.deduplicateResults(merged);
    this.logger.log(
      `[searchAcademic] Final: ${final.length} unique results in ${BUDGET_MS - remainingMs()}ms`,
    );
    return final.slice(0, maxResults);
  }

  /**
   * 学术搜索结果去重（按 URL）
   */
  private deduplicateResults(results: DataSourceResult[]): DataSourceResult[] {
    const seen = new Set<string>();
    return results.filter((r) => {
      const key = r.url || r.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 带超时的工具搜索（防止单个子源拖垮整个 searchAcademic）
   */
  private async searchViaToolWithTimeout(
    toolId: string,
    sourceType: DataSourceType,
    query: string,
    maxResults: number,
    timeoutMs: number,
  ): Promise<DataSourceResult[]> {
    try {
      return await withTimeout(
        this.searchViaTool(toolId, sourceType, query, maxResults),
        timeoutMs,
        `${toolId} timeout`,
      );
    } catch (error) {
      this.logger.warn(
        `[searchViaToolWithTimeout] ${toolId} failed: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }

  /**
   * ArXiv 搜索（内部方法，被 searchAcademic 调用）
   */
  private async searchArxiv(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      this.logger.log(`[searchArxiv] Searching arXiv: "${query}"`);

      const arxivTool = this.toolRegistry.tryGet("arxiv-search");
      if (!arxivTool) {
        this.logger.error(
          "[searchArxiv] arxiv-search tool not registered in ToolRegistry",
        );
        return [];
      }

      const result = await arxivTool.execute(
        {
          query,
          maxResults,
          sortBy: "relevance",
        },
        this.createToolContext("arxiv-search"),
      );

      if (!result.success || !result.data) {
        this.logger.warn(
          `[searchArxiv] No results or error: ${result.error?.message}`,
        );
        return [];
      }

      const arxivData = result.data as {
        success: boolean;
        papers: Array<{
          id: string;
          title: string;
          summary: string;
          authors: string[];
          published: string;
          updated: string;
          categories: string[];
          pdfUrl: string;
          absUrl: string;
        }>;
        totalResults: number;
        query: string;
      };

      if (!arxivData.papers || arxivData.papers.length === 0) {
        this.logger.warn("[searchArxiv] No papers in response");
        return [];
      }

      return arxivData.papers.map((paper) => ({
        sourceType: DataSourceType.ACADEMIC,
        title: paper.title,
        url: paper.absUrl,
        snippet: paper.summary?.slice(0, 500) || "",
        publishedAt: paper.published ? new Date(paper.published) : undefined,
        domain: "arxiv.org",
        metadata: {
          arxivId: paper.id,
          authors: paper.authors,
          categories: paper.categories,
          pdfUrl: paper.pdfUrl,
          updated: paper.updated,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchArxiv] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * GitHub 搜索 (使用 GithubSearchTool)
   * 搜索 GitHub 上的开源仓库
   */
  private async searchGithub(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      this.logger.log(`[searchGithub] Searching GitHub: "${query}"`);

      // 通过 ToolRegistry 获取 github-search 工具
      const githubTool = this.toolRegistry.tryGet("github-search");
      if (!githubTool) {
        this.logger.error(
          "[searchGithub] github-search tool not registered in ToolRegistry",
        );
        return [];
      }

      const result = await githubTool.execute(
        {
          query,
          maxResults,
          sort: "stars", // 按星标数排序，获取高质量仓库
        },
        this.createToolContext("github-search"),
      );

      if (!result.success || !result.data) {
        this.logger.warn(
          `[searchGithub] No results or error: ${result.error?.message}`,
        );
        return [];
      }

      const githubData = result.data as {
        success: boolean;
        repositories: Array<{
          fullName: string;
          description: string | null;
          htmlUrl: string;
          language: string | null;
          stargazersCount: number;
          forksCount: number;
          openIssuesCount: number;
          topics: string[];
          createdAt: string;
          updatedAt: string;
          pushedAt: string;
          owner: {
            login: string;
            avatarUrl: string;
            type: string;
          };
        }>;
        totalCount: number;
        query: string;
      };

      if (!githubData.repositories || githubData.repositories.length === 0) {
        this.logger.warn("[searchGithub] No repositories in response");
        return [];
      }

      return githubData.repositories.map((repo) => ({
        sourceType: DataSourceType.GITHUB,
        title: repo.fullName,
        url: repo.htmlUrl,
        snippet:
          repo.description ||
          `${repo.language || "Unknown language"} repository with ${repo.stargazersCount} stars`,
        publishedAt: repo.createdAt ? new Date(repo.createdAt) : undefined,
        domain: "github.com",
        metadata: {
          language: repo.language,
          stars: repo.stargazersCount,
          forks: repo.forksCount,
          openIssues: repo.openIssuesCount,
          topics: repo.topics,
          owner: repo.owner.login,
          ownerType: repo.owner.type,
          updatedAt: repo.updatedAt,
          pushedAt: repo.pushedAt,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchGithub] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * HackerNews 搜索
   * 使用 Algolia HN Search API 搜索技术社区讨论和新闻
   */
  private async searchHackerNews(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      this.logger.log(`[searchHackerNews] Searching: "${query}"`);

      // 通过 ToolRegistry 获取 hackernews-search 工具
      const hackerNewsTool = this.toolRegistry.tryGet("hackernews-search");
      if (!hackerNewsTool) {
        this.logger.error(
          "[searchHackerNews] hackernews-search tool not registered in ToolRegistry",
        );
        return [];
      }

      const result = await hackerNewsTool.execute(
        {
          query,
          maxResults,
          tags: "story", // 只搜索 story 类型，排除评论
        },
        this.createToolContext("hackernews-search"),
      );

      if (!result.success || !result.data) {
        this.logger.warn(
          `[searchHackerNews] No results or error: ${result.error?.message}`,
        );
        return [];
      }

      const hnData = result.data as {
        success: boolean;
        hits: Array<{
          title: string;
          url: string | null;
          hnUrl: string;
          author: string;
          points: number;
          numComments: number;
          createdAt: string;
          storyText: string | null;
        }>;
        totalHits: number;
        query: string;
      };

      if (!hnData.hits || hnData.hits.length === 0) {
        this.logger.warn("[searchHackerNews] No hits in response");
        return [];
      }

      return hnData.hits.map((hit) => ({
        sourceType: DataSourceType.HACKERNEWS,
        title: hit.title,
        // 优先使用原始 URL，如果是文本帖则使用 HN 讨论链接
        url: hit.url || hit.hnUrl,
        snippet:
          hit.storyText ||
          `${hit.points} points | ${hit.numComments} comments by ${hit.author}`,
        publishedAt: hit.createdAt ? new Date(hit.createdAt) : undefined,
        domain: "news.ycombinator.com",
        metadata: {
          author: hit.author,
          points: hit.points,
          comments: hit.numComments,
          hnUrl: hit.hnUrl,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchHackerNews] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // ============================================================================
  // ★ 本地知识库（RAG）搜索方法
  // ============================================================================

  /**
   * 本地知识库搜索 (使用 RAG 向量检索)
   * 搜索用户配置的知识库中的相关内容
   *
   * ★ Critical Fix: topic 作为参数传递，避免实例变量的并发竞态
   *
   * @param query 搜索查询
   * @param maxResults 最大结果数
   * @param topic 研究主题（用于获取 knowledgeBaseIds）
   * @returns 数据源结果数组
   */
  private async searchLocal(
    query: string,
    maxResults: number,
    topic?: ResearchTopic,
  ): Promise<DataSourceResult[]> {
    try {
      // 1. 从 topic 配置获取知识库 ID 列表
      const topicConfig = topic?.topicConfig as Record<string, unknown> | null;
      const knowledgeBaseIds = topicConfig?.knowledgeBaseIds as
        | string[]
        | undefined;

      if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) {
        this.logger.debug(
          "[searchLocal] No knowledge bases configured for this topic",
        );
        return [];
      }

      this.logger.log(
        `[searchLocal] Searching ${knowledgeBaseIds.length} knowledge bases: "${query}"`,
      );

      // 2. 生成查询嵌入向量
      const queryEmbedding = await this.ragFacade.embeddingGenerate(query);

      if (!queryEmbedding) {
        this.logger.warn("[searchLocal] Failed to generate query embedding");
        return [];
      }

      // 3. 在指定知识库中进行相似度搜索
      const searchResults = await this.ragFacade.vectorSimilaritySearch(
        queryEmbedding.embedding,
        {
          limit: maxResults,
          threshold: 0.3, // 最小相似度阈值
          knowledgeBaseIds,
        },
      );

      this.logger.log(
        `[searchLocal] Found ${searchResults.length} results from knowledge bases`,
      );

      // ★ 记录知识库匹配日志（用于溯源）
      if (searchResults.length > 0) {
        this.logger.log(
          `[searchLocal] ★ Knowledge base matched! Topic: ${topic?.name}, ` +
            `Query: "${query}", Results: ${searchResults.length}, ` +
            `KBs: [${knowledgeBaseIds.join(", ")}]`,
        );
      }

      // 4. 转换为统一的 DataSourceResult 格式
      return searchResults.map((result) => ({
        sourceType: DataSourceType.LOCAL,
        title: this.extractTitle(result.parentContent || result.content),
        url: `kb://${result.documentId}#${result.childChunkId}`, // 内部链接格式
        snippet: result.content?.slice(0, 500) || "", // 截取前 500 字符
        domain: "knowledge-base",
        metadata: {
          similarity: result.similarity,
          documentId: result.documentId,
          chunkId: result.childChunkId,
          parentChunkId: result.parentChunkId,
          // ★ 标记知识库来源，用于前端展示和溯源
          knowledgeBaseSource: true,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchLocal] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 从内容中提取标题
   * 尝试从 Markdown 标题或首行提取
   */
  private extractTitle(content: string): string {
    if (!content) return "Knowledge Base Entry";

    // 尝试匹配 Markdown 标题
    const markdownTitleMatch = content.match(/^#+\s+(.+)$/m);
    if (markdownTitleMatch) {
      return markdownTitleMatch[1].slice(0, 100);
    }

    // 使用首行作为标题（截取前 100 字符）
    const firstLine = content.split("\n")[0].trim();
    return firstLine.slice(0, 100) || "Knowledge Base Entry";
  }

  // ============================================================================
  // ★ 政策研究数据源搜索方法
  // ============================================================================

  /**
   * 创建工具执行上下文
   */
  private createToolContext(toolId: string): ToolContext {
    return {
      executionId: `${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolId,
      createdAt: new Date(),
      callerType: "orchestrator",
    };
  }

  /**
   * 联邦公报搜索 (Federal Register)
   * 搜索行政命令、法规、拟议规则、机构通知
   */
  private async searchFederalRegister(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      this.logger.log(`[searchFederalRegister] Searching: "${query}"`);

      const result = await this.federalRegisterTool.execute(
        {
          query,
          maxResults,
        },
        this.createToolContext("federal-register"),
      );

      if (!result.success || !result.data?.documents) {
        this.logger.warn(
          `[searchFederalRegister] No results or error: ${result.error?.message}`,
        );
        return [];
      }

      return result.data.documents.map((doc) => ({
        sourceType: DataSourceType.FEDERAL_REGISTER,
        title: doc.title,
        url: doc.htmlUrl,
        snippet: doc.abstract || doc.title,
        publishedAt: doc.publicationDate
          ? new Date(doc.publicationDate)
          : undefined,
        domain: "federalregister.gov",
        metadata: {
          documentType: doc.type,
          agencies: doc.agencies,
          documentNumber: doc.documentNumber,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchFederalRegister] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 国会立法搜索 (Congress.gov)
   * 搜索法案、决议、投票记录
   */
  private async searchCongress(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      this.logger.log(`[searchCongress] Searching: "${query}"`);

      const result = await this.congressGovTool.execute(
        {
          query,
          limit: maxResults,
          congress: this.getCurrentCongress(),
        },
        this.createToolContext("congress-gov"),
      );

      if (!result.success || !result.data?.bills) {
        this.logger.warn(
          `[searchCongress] No results or error: ${result.error?.message}`,
        );
        return [];
      }

      return result.data.bills.map((bill) => ({
        sourceType: DataSourceType.CONGRESS,
        title: bill.shortTitle || bill.title,
        url: bill.url,
        snippet: `${bill.number} - ${bill.title}${bill.latestAction ? ` | Latest: ${bill.latestAction.text}` : ""}`,
        publishedAt: bill.introducedDate
          ? new Date(bill.introducedDate)
          : undefined,
        domain: "congress.gov",
        metadata: {
          billNumber: bill.number,
          billType: bill.type,
          congress: bill.congress,
          sponsors: bill.sponsors,
          policyArea: bill.policyArea,
          latestAction: bill.latestAction,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchCongress] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 白宫新闻搜索 (White House)
   * 搜索声明、新闻发布、行政命令
   */
  private async searchWhiteHouse(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    try {
      this.logger.log(`[searchWhiteHouse] Searching: "${query}"`);

      const result = await this.whiteHouseNewsTool.execute(
        {
          query,
          limit: maxResults,
        },
        this.createToolContext("whitehouse-news"),
      );

      if (!result.success || !result.data?.items) {
        this.logger.warn(
          `[searchWhiteHouse] No results or error: ${result.error?.message}`,
        );
        return [];
      }

      return result.data.items.map((item) => ({
        sourceType: DataSourceType.WHITEHOUSE,
        title: item.title,
        url: item.url,
        snippet: item.summary || item.title,
        publishedAt: item.date ? new Date(item.date) : undefined,
        domain: "whitehouse.gov",
        metadata: {
          contentType: item.type,
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchWhiteHouse] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // ==================== Social Media Data Source ====================

  /**
   * ★ X/Twitter 社媒搜索
   * 主方案：使用 Grok Live Search 获取实时社媒热点
   * 降级方案：使用 Web Search + site:x.com
   */
  private async searchSocialX(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    this.logger.log(`[searchSocialX] Searching: "${query}"`);

    // 主方案：Grok Live Search
    try {
      const results = await this.searchSocialXViaGrok(query, maxResults);
      if (results.length > 0) {
        this.logger.log(
          `[searchSocialX] Grok Live Search returned ${results.length} results`,
        );
        return results;
      }
    } catch (error) {
      this.logger.warn(
        `[searchSocialX] Grok Live Search failed, falling back to web search: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // 降级方案：Web Search + site:x.com
    return this.searchSocialXViaWebSearch(query, maxResults);
  }

  /**
   * 通过 Grok Live Search 获取 X/Twitter 内容
   */
  private async searchSocialXViaGrok(
    query: string,
    maxResults: number,
    retries = 2,
  ): Promise<DataSourceResult[]> {
    // 检查是否有可用的 Grok 模型
    const aiModels = await this.chatFacade.getAvailableModels();
    const grokModel = aiModels.find(
      (m: { id: string; provider: string }) => m.provider === "xai",
    );

    if (!grokModel) {
      this.logger.warn(
        "[searchSocialXViaGrok] No xAI/Grok model available, skipping",
      );
      return [];
    }

    const systemPrompt = `You are a social media analyst. Search X/Twitter for recent discussions about the given topic.
Return results in JSON format:
{
  "trends": [
    {
      "title": "Brief title describing the discussion point",
      "url": "https://x.com/username/status/xxx",
      "author": "@username",
      "content": "Key quote or summary of the post",
      "engagement": { "likes": 0, "retweets": 0, "replies": 0 },
      "sentiment": "positive|negative|neutral",
      "publishedAt": "2026-01-26"
    }
  ],
  "summary": "Brief overview of the social media discourse",
  "dominantSentiment": "positive|negative|neutral|mixed"
}
Focus on high-engagement posts from credible accounts. Provide ${maxResults} most relevant posts.`;

    const userPrompt = `Search X/Twitter for recent discussions about: "${query}"

Return the ${maxResults} most relevant and high-engagement posts in the specified JSON format.`;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.chatFacade.chat({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          operationName: "数据源分析",
          model: grokModel.id,
          skipGuardrails: true, // 内部系统调用，社交搜索
          taskProfile: { creativity: "low", outputLength: "long" },
        });

        const results = this.parseSocialSearchResponse(response.content, query);
        if (results.length > 0) {
          return results;
        }

        this.logger.warn(
          `[searchSocialXViaGrok] Attempt ${attempt + 1}: No results parsed`,
        );
      } catch (error) {
        this.logger.warn(
          `[searchSocialXViaGrok] Attempt ${attempt + 1} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        if (attempt === retries) throw error;
      }
    }
    return [];
  }

  /**
   * 解析 Grok 社媒搜索响应
   */
  private parseSocialSearchResponse(
    content: string,
    originalQuery: string,
  ): DataSourceResult[] {
    // 尝试多种 JSON 提取模式
    const extractJson = (text: string): string | null => {
      // 模式1：```json ... ```
      const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonBlockMatch) return jsonBlockMatch[1];

      // 模式2：``` ... ```（无 json 标记）
      const codeBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) return codeBlockMatch[1];

      // 模式3：直接 JSON 对象
      const jsonObjectMatch = text.match(/\{[\s\S]*"trends"[\s\S]*\}/);
      if (jsonObjectMatch) return jsonObjectMatch[0];

      return null;
    };

    try {
      const jsonStr = extractJson(content);
      if (!jsonStr) {
        this.logger.warn(
          "[parseSocialSearchResponse] No JSON found in response",
        );
        return this.extractFallbackSocialResults(content, originalQuery);
      }

      const parsed = JSON.parse(jsonStr) as {
        trends?: Array<{
          title?: string;
          url?: string;
          author?: string;
          content?: string;
          engagement?: { likes?: number; retweets?: number; replies?: number };
          sentiment?: string;
          publishedAt?: string;
        }>;
      };

      if (!parsed.trends || !Array.isArray(parsed.trends)) {
        this.logger.warn(
          "[parseSocialSearchResponse] Invalid trends structure",
        );
        return this.extractFallbackSocialResults(content, originalQuery);
      }

      return parsed.trends.map((trend) => ({
        sourceType: DataSourceType.SOCIAL_X,
        title: trend.title || `X 讨论: ${originalQuery}`,
        url: trend.url || "https://x.com",
        snippet: trend.content || "",
        publishedAt: trend.publishedAt
          ? new Date(trend.publishedAt)
          : undefined,
        domain: "x.com",
        metadata: {
          author: trend.author,
          engagement: trend.engagement,
          sentiment: trend.sentiment,
          fetchedVia: "grok-live-search",
        },
      }));
    } catch (error) {
      this.logger.error(
        `[parseSocialSearchResponse] Parse failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.extractFallbackSocialResults(content, originalQuery);
    }
  }

  /**
   * JSON 解析失败时的降级提取
   */
  private extractFallbackSocialResults(
    content: string,
    originalQuery: string,
  ): DataSourceResult[] {
    // 尝试从纯文本中提取 URL
    const urlMatches =
      content.match(/https?:\/\/(?:x\.com|twitter\.com)\/\S+/g) || [];

    return urlMatches.slice(0, 5).map((url, index) => ({
      sourceType: DataSourceType.SOCIAL_X,
      title: `X/Twitter 讨论 #${index + 1}`,
      url,
      snippet: `关于「${originalQuery}」的社媒讨论`,
      domain: "x.com",
      metadata: {
        fetchedVia: "grok-live-search-fallback",
        parseMethod: "url-extraction",
      },
    }));
  }

  /**
   * 降级方案：通过 Web Search 获取 X 内容
   */
  private async searchSocialXViaWebSearch(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    this.logger.log(
      `[searchSocialXViaWebSearch] Fallback searching: "${query}"`,
    );

    try {
      // 使用 web search 工具搜索 X/Twitter 内容
      const socialQuery = `${query} site:x.com OR site:twitter.com`;
      const webResults = await this.searchWeb(socialQuery, maxResults);

      // 转换为 SOCIAL_X 类型
      return webResults.map((result) => ({
        ...result,
        sourceType: DataSourceType.SOCIAL_X,
        domain: "x.com",
        metadata: {
          ...result.metadata,
          fetchedVia: "web-search-fallback",
          sentiment: null, // 降级方案无情感分析
        },
      }));
    } catch (error) {
      this.logger.error(
        `[searchSocialXViaWebSearch] Failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  /**
   * 聚合搜索结果
   */
  private aggregateResults(
    results: PromiseSettledResult<DataSourceResult[]>[],
    sources: DataSourceType[],
  ): AggregatedSearchResult {
    const allResults: DataSourceResult[] = [];
    const seenUrls = new Set<string>();
    const seenTitles = new Map<string, number>();

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const item of result.value) {
          // 跳过没有 URL 的结果
          if (!item.url) continue;

          // URL 去重
          const normalizedUrl = this.normalizeUrl(item.url);
          if (seenUrls.has(normalizedUrl)) {
            continue;
          }

          // 标题相似度去重
          if (this.isTitleSimilar(item.title, seenTitles)) {
            continue;
          }

          seenUrls.add(normalizedUrl);
          if (item.title) {
            seenTitles.set(item.title.toLowerCase(), 0.9);
          }
          allResults.push(item);
        }
      }
    }

    // 按可信度评分排序
    const sortedResults = allResults.sort(
      (a, b) =>
        this.calculateCredibilityScore(b) - this.calculateCredibilityScore(a),
    );

    // ★ 域名多样性强制：任何单一域名不超过阈值（默认 30%，学术/官方类话题放宽到 50%）
    const diverseResults = this.enforceDomainDiversity(sortedResults);

    return {
      items: diverseResults,
      totalCount: diverseResults.length,
      sources: sources,
    };
  }

  /**
   * ★ 域名多样性强制
   *
   * 确保搜索结果不被单一域名主导。
   * 如果某域名占比超过阈值，截断多余结果，保留其他域名的结果在前面。
   *
   * @param results 已排序的搜索结果
   * @param maxRatio 单一域名最大占比（默认 0.3 = 30%）
   * @returns 经过多样性调整的结果
   */
  private enforceDomainDiversity(
    results: DataSourceResult[],
    maxRatio: number = 0.3,
  ): DataSourceResult[] {
    if (results.length <= 3) return results;

    // 如果结果主要来自权威来源（.gov, .edu, arxiv, 官方文档），放宽阈值
    const authoritativeDomains = [
      ".gov",
      ".edu",
      "arxiv.org",
      "nature.com",
      "science.org",
      "ieee.org",
      "acm.org",
    ];
    const authoritativeCount = results.filter((r) => {
      const domain = this.extractDomain(r.url);
      return domain && authoritativeDomains.some((ad) => domain.endsWith(ad));
    }).length;
    if (authoritativeCount > results.length * 0.4) {
      maxRatio = Math.max(maxRatio, 0.5);
    }

    // 统计域名分布
    const domainCounts = new Map<string, number>();
    for (const item of results) {
      const domain = this.extractDomain(item.url);
      if (domain) {
        domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
      }
    }

    const maxPerDomain = Math.max(
      2, // 至少保留 2 条
      Math.ceil(results.length * maxRatio),
    );

    // 检查是否有域名超标
    const overRepresented = Array.from(domainCounts.entries()).filter(
      ([, count]) => count > maxPerDomain,
    );

    if (overRepresented.length === 0) return results;

    // 记录超标域名
    for (const [domain, count] of overRepresented) {
      this.logger.warn(
        `[enforceDomainDiversity] Domain "${domain}" has ${count}/${results.length} results (${Math.round((count / results.length) * 100)}%), capping at ${maxPerDomain}`,
      );
    }

    // 按域名计数过滤
    const domainSeen = new Map<string, number>();
    return results.filter((item) => {
      const domain = this.extractDomain(item.url);
      if (!domain) return true;
      const seen = domainSeen.get(domain) || 0;
      if (seen >= maxPerDomain) return false;
      domainSeen.set(domain, seen + 1);
      return true;
    });
  }

  /**
   * 从 URL 提取域名
   */
  private extractDomain(url: string): string | null {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace(/^www\./, "");
      // 排除 localhost 和 IP 地址，不参与域名多样性计算
      if (hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        return null;
      }
      return hostname;
    } catch (error) {
      this.logger.debug(`[extractDomain] Invalid URL: ${error}`);
      return null;
    }
  }

  /**
   * URL 标准化
   */
  private normalizeUrl(url: string): string {
    if (!url) return "";
    try {
      const parsed = new URL(url);
      // 移除 tracking 参数
      parsed.searchParams.delete("utm_source");
      parsed.searchParams.delete("utm_medium");
      parsed.searchParams.delete("utm_campaign");
      parsed.searchParams.delete("ref");
      // 标准化协议和移除尾部斜杠
      return parsed.toString().replace(/\/$/, "").toLowerCase();
    } catch (error) {
      this.logger.debug(`[normalizeUrl] Failed to normalize URL: ${error}`);
      return url.toLowerCase();
    }
  }

  /**
   * 检查标题是否与已有标题相似
   */
  private isTitleSimilar(
    title: string,
    seenTitles: Map<string, number>,
  ): boolean {
    if (!title) return false;
    const titleLower = title.toLowerCase();

    for (const [seenTitle, threshold] of seenTitles.entries()) {
      const similarity = this.calculateTitleSimilarity(titleLower, seenTitle);
      if (similarity >= threshold) {
        return true;
      }
    }

    return false;
  }

  /**
   * 计算标题相似度 (简单的 Jaccard 相似度)
   */
  private calculateTitleSimilarity(title1: string, title2: string): number {
    if (!title1 || !title2) return 0;
    const words1 = new Set(title1.toLowerCase().split(/\s+/));
    const words2 = new Set(title2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * 计算可信度评分
   *
   * 基于:
   * - 数据源类型 (学术 > 官方 > 新闻 > 博客)
   * - 域名权威性
   * - 发布时间新鲜度
   * - 元数据质量
   */
  private calculateCredibilityScore(item: DataSourceResult): number {
    let score = 0;

    // 1. 数据源类型评分 (40%)
    score += this.getSourceTypeScore(item.sourceType) * 0.4;

    // 2. 域名权威性评分 (30%)
    score += this.getDomainAuthorityScore(item.domain) * 0.3;

    // 3. 发布时间新鲜度评分 (20%)
    score += this.getRecencyScore(item.publishedAt) * 0.2;

    // 4. 内容深度评分 (10%)
    score += this.getContentDepthScore(item.snippet?.length || 0) * 0.1;

    return score;
  }

  /**
   * 数据源类型评分
   */
  private getSourceTypeScore(sourceType: DataSourceType): number {
    const scores: Record<DataSourceType, number> = {
      [DataSourceType.ACADEMIC]: 100,
      [DataSourceType.GITHUB]: 85,
      [DataSourceType.WEB]: 70,
      [DataSourceType.HACKERNEWS]: 75,
      [DataSourceType.RSS]: 65,
      [DataSourceType.LOCAL]: 80,
      [DataSourceType.FEDERAL_REGISTER]: 95,
      [DataSourceType.CONGRESS]: 95,
      [DataSourceType.WHITEHOUSE]: 90,
      [DataSourceType.SOCIAL_X]: 60,
      [DataSourceType.SEMANTIC_SCHOLAR]: 100,
      [DataSourceType.PUBMED]: 95,
      [DataSourceType.OPENALEX]: 100,
      [DataSourceType.FINANCE_API]: 85,
      [DataSourceType.WEATHER_API]: 75,
      [DataSourceType.INDUSTRY_REPORT]: 88,
    };

    return scores[sourceType] || 50;
  }

  /**
   * 域名权威性评分
   */
  private getDomainAuthorityScore(domain?: string): number {
    if (!domain) return 50;

    // 高权威域名
    const highAuthority = [
      "arxiv.org",
      "nature.com",
      "science.org",
      "ieee.org",
      "github.com",
      "stackoverflow.com",
      "nytimes.com",
      "wsj.com",
      "bloomberg.com",
      "reuters.com",
    ];

    // 中等权威域名
    const mediumAuthority = [
      "medium.com",
      "dev.to",
      "wikipedia.org",
      "techcrunch.com",
      "wired.com",
      "arstechnica.com",
    ];

    if (highAuthority.some((d) => domain.includes(d))) {
      return 100;
    }

    if (mediumAuthority.some((d) => domain.includes(d))) {
      return 70;
    }

    // .edu, .gov 域名加权
    if (domain.endsWith(".edu") || domain.endsWith(".gov")) {
      return 90;
    }

    return 50;
  }

  /**
   * 发布时间新鲜度评分
   */
  private getRecencyScore(publishedAt?: Date): number {
    if (!publishedAt) return 50;

    const daysSincePublished =
      (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSincePublished <= 7) return 100; // 一周内
    if (daysSincePublished <= 30) return 85; // 一个月内
    if (daysSincePublished <= 90) return 70; // 三个月内
    if (daysSincePublished <= 180) return 55; // 半年内
    if (daysSincePublished <= 365) return 40; // 一年内

    return 25; // 一年以上
  }

  /**
   * 内容深度评分
   */
  private getContentDepthScore(contentLength: number): number {
    if (contentLength >= 500) return 100;
    if (contentLength >= 300) return 80;
    if (contentLength >= 200) return 60;
    if (contentLength >= 100) return 40;

    return 20;
  }

  // ==================== Tool Capability Integration ====================

  /**
   * 将 DataSourceType 映射到 Tool ID（委托到集中配置）
   */
  private dataSourceToToolId(source: DataSourceType): string | null {
    return dataSourceToToolId(source);
  }

  /**
   * 将 Leader 分配的工具列表转换为数据源类型列表（委托到集中配置）
   */
  private convertToolsToDataSources(tools: string[]): DataSourceType[] {
    return convertToolsToDataSources(tools);
  }

  /**
   * 检查工具是否被启用
   *
   * P0 fix (2026-05-05): 之前用 toolFacade.capabilityResolveTools({}) 空 context
   * 解析，PR-X14 facade 重构后空 context 路径走 optional chain `?? []` fallback
   * → web-search / arxiv-search 全 disabled by Admin → 调研返 0 结果（除
   * industry-report 因 86bcd4112 已 bypass）。
   *
   * 改为直接查 ToolRegistry — 代码侧 source of truth。tool 注册即视为可用，
   * admin 通过 DB tool_configs.enabled 关闭由 ToolRegistry 自己同步处理
   * （tool.enabled flag 从 DB sync）。
   */
  private async isToolEnabled(toolId: string): Promise<boolean> {
    try {
      const enabledTools = this.toolRegistry.getEnabled();
      const found = enabledTools.some((t) => t.id === toolId);
      if (found) return true;

      // 二级检查：toolFacade 走 capability 解析（含 MCP / 动态注册）
      // 若 facade 也找不到，才视为不可用
      const fromFacade = await this.toolFacade
        .capabilityResolveTools({})
        .catch(() => [] as string[]);
      if (fromFacade.includes(toolId)) return true;

      this.logger.debug(
        `[isToolEnabled] Tool "${toolId}" not in registry.getEnabled() nor facade.capabilityResolveTools({})`,
      );
      return false;
    } catch (error) {
      this.logger.error(
        `[isToolEnabled] Failed to check tool ${toolId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // 安全优先：error 时默认禁用，避免误用未授权工具
      return false;
    }
  }

  // ==================== AI Planning Integration ====================

  /**
   * 获取维度的 AI 数据源规划
   * ★ Major Fix: 使用 LRU-style 缓存避免重复规划，防止内存泄漏
   */
  private async getAIPlanForDimension(
    dimension: TopicDimension,
    topic: ResearchTopic,
  ): Promise<DataSourcePlan> {
    const cacheKey = `${topic.id}:${dimension.id}`;

    // 检查缓存
    const cached = this.planCache.get(cacheKey);
    if (cached) {
      this.logger.debug(
        `[getAIPlanForDimension] Using cached plan for ${cacheKey}`,
      );
      return cached;
    }

    // 获取可用的数据源类型
    const availableDataSources = Object.values(DataSourceType);

    // 调用 AI 规划器
    const plan = await this.dataSourcePlanner.planDataSources({
      topicName: topic.name,
      topicType: topic.type,
      dimensionName: dimension.name,
      dimensionDescription: dimension.description || dimension.name,
      searchQueries: dimension.searchQueries as string[] | undefined,
      availableDataSources,
    });

    // 缓存结果（LruMap 自动淘汰最早条目）
    this.planCache.set(cacheKey, plan);

    return plan;
  }

  /**
   * 清除 AI 规划缓存
   * 在研究任务完成或取消时调用
   */
  clearPlanCache(topicId?: string): void {
    if (topicId) {
      // 清除指定主题的缓存
      for (const key of this.planCache.keys()) {
        if (key.startsWith(`${topicId}:`)) {
          this.planCache.delete(key);
        }
      }
    } else {
      // 清除所有缓存
      this.planCache.clear();
    }
  }

  /**
   * 计算当前国会届次
   */
  private getCurrentCongress(): number {
    const year = new Date().getFullYear();
    return Math.floor((year - 1789) / 2) + 1;
  }

  /**
   * 获取 AI 规划的数据源能力描述
   * 用于前端展示
   */
  getDataSourceCapabilities() {
    return this.dataSourcePlanner.getDataSourceCapabilities();
  }
}
