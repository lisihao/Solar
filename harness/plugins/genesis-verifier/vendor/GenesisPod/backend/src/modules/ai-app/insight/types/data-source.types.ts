/**
 * Data Source Types for Topic Research
 *
 * 数据源类型定义,用于路由和聚合多个数据源的搜索结果
 */

/**
 * 数据源类型枚举
 */
export enum DataSourceType {
  WEB = "web", // Web搜索 (Tavily/Serper)
  ACADEMIC = "academic", // 学术搜索 (ArXiv)
  GITHUB = "github", // GitHub仓库搜索
  HACKERNEWS = "hackernews", // HackerNews
  RSS = "rss", // RSS订阅
  LOCAL = "local", // 本地资源库
  // ★ 政策研究数据源
  FEDERAL_REGISTER = "federal-register", // 联邦公报 (行政命令、法规)
  CONGRESS = "congress-gov", // 国会立法 (法案、决议)
  WHITEHOUSE = "whitehouse-news", // 白宫新闻 (声明、政策)
  // ★ 社媒数据源
  SOCIAL_X = "social-x", // X/Twitter 社媒热点 (via Grok Live Search)
  // ★ P0: 实时数据源接入
  SEMANTIC_SCHOLAR = "semantic-scholar", // Semantic Scholar 学术论文 API
  PUBMED = "pubmed", // PubMed 生物医学文献
  OPENALEX = "openalex", // OpenAlex 开放学术数据库 (2.5亿+作品)
  FINANCE_API = "finance-api", // 金融数据 API (Alpha Vantage)
  WEATHER_API = "weather-api", // 天气数据 API (Open-Meteo)
  // ★ 行业报告数据源
  INDUSTRY_REPORT = "industry-report", // 行业报告 (SemiAnalysis, McKinsey, a16z 等)
}

/**
 * ★ 社媒热点数据项
 */
export interface SocialTrendItem {
  title: string;
  url: string;
  author: string;
  authorFollowers?: string;
  content: string;
  engagement: {
    likes: number;
    retweets: number;
    replies: number;
  };
  sentiment: "positive" | "negative" | "neutral";
  publishedAt: string;
}

/**
 * ★ 社媒搜索响应
 */
export interface SocialSearchResponse {
  trends: SocialTrendItem[];
  summary: string;
  dominantSentiment: string;
}

/**
 * 单个数据源的搜索结果
 */
export interface DataSourceResult {
  sourceType: DataSourceType;
  title: string;
  url: string;
  snippet: string;
  publishedAt?: Date;
  domain?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 聚合的搜索结果
 */
export interface AggregatedSearchResult {
  items: DataSourceResult[];
  totalCount: number;
  sources: DataSourceType[];
  metadata?: {
    searchQuery: string;
    executionTimeMs: number;
    sourceResults: Record<DataSourceType, number>;
  };
  /** Scored items with relevance and credibility scores (from ResultFusionService) */
  scoredItems?: Array<{
    item: DataSourceResult;
    score: number;
    relevanceScore: number;
    credibilityScore: number;
  }>;
}

/**
 * 数据源搜索选项
 */
export interface SearchOptions {
  maxResults?: number;
  since?: Date;
  timeout?: number;
}

/**
 * 数据源配置
 */
export interface DimensionSourceConfig {
  primarySources: DataSourceType[];
  secondarySources: DataSourceType[];
  minSourceCount: number;
  maxResultsPerSource: number;
  freshnessRequirement: "recent" | "standard" | "archival";
}

/**
 * 搜索查询构建器接口
 */
export interface SearchQueryBuilder {
  buildQuery(
    topicName: string,
    dimensionName: string,
    additionalQueries?: string[],
  ): string;
}

// ============================================================================
// ★ AI 数据源规划相关类型
// ============================================================================

/**
 * 数据源规划输入
 */
export interface DataSourcePlanInput {
  /** 研究主题名称 */
  topicName: string;
  /** 主题类型 (MACRO_INSIGHT, TECHNOLOGY_INSIGHT, COMPANY_INSIGHT) */
  topicType: string;
  /** 维度名称 */
  dimensionName: string;
  /** 维度描述 */
  dimensionDescription: string;
  /** 预设的搜索查询（可选） */
  searchQueries?: string[];
  /** 可用的数据源列表 */
  availableDataSources: DataSourceType[];
}

/**
 * 数据源规划结果
 */
export interface DataSourcePlan {
  /** AI 推荐的主要数据源 */
  recommendedSources: DataSourceType[];
  /** 每个数据源的推荐理由 */
  sourceRationales: Record<string, string>;
  /** 整体规划说明 */
  overallRationale: string;
  /** 备选数据源（当主要数据源失败时使用） */
  fallbackSources: DataSourceType[];
  /** 推荐的搜索策略 */
  searchStrategy: {
    /** 推荐的结果数量 */
    suggestedMaxResults: number;
    /** 是否需要时间过滤 */
    needsTimeFilter: boolean;
    /** 建议的时间范围（天数） */
    suggestedTimeRangeDays?: number;
    /** 是否需要内容增强 */
    needsEnrichment: boolean;
  };
  /** AI 置信度 (0-100) */
  confidence: number;
}

/**
 * 数据源能力描述（用于 AI 规划）
 */
export interface DataSourceCapability {
  /** 数据源类型 */
  type: DataSourceType;
  /** 人类可读名称 */
  displayName: string;
  /** 能力描述 */
  description: string;
  /** 适用场景 */
  useCases: string[];
  /** 数据特点 */
  characteristics: string[];
  /** 是否需要 API 密钥 */
  requiresApiKey: boolean;
  /** 是否当前可用 */
  isAvailable: boolean;
  /** 吞吐能力等级: high=无限制/高吞吐, medium=适中, low=严格限速 */
  throughput?: "high" | "medium" | "low";
}
