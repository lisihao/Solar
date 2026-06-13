/**
 * Data Source Connector Types
 *
 * P0: 实时数据源接入框架
 * 定义通用数据源连接器接口，支持可插拔的数据源适配器
 */

import {
  DataSourceType,
  DataSourceResult,
  SearchOptions,
} from "./data-source.types";

/**
 * 数据源连接器接口
 * 所有数据源适配器必须实现此接口
 */
export interface IDataSourceConnector {
  /** 数据源类型 */
  readonly sourceType: DataSourceType;
  /** 连接器显示名称 */
  readonly displayName: string;
  /** 是否需要 API Key */
  readonly requiresApiKey: boolean;

  /**
   * 执行搜索
   */
  search(
    query: string,
    maxResults: number,
    options?: ConnectorSearchOptions,
  ): Promise<DataSourceResult[]>;

  /**
   * 检查连接器是否可用（API Key 是否配置等）
   */
  isAvailable(): Promise<boolean>;

  /**
   * 健康检查
   */
  healthCheck(): Promise<ConnectorHealthStatus>;
}

/**
 * 连接器搜索选项
 */
export interface ConnectorSearchOptions extends SearchOptions {
  /** 语言过滤 */
  language?: string;
  /** 排序方式 */
  sortBy?: "relevance" | "date" | "citations";
  /** 结果过滤器 */
  filters?: Record<string, string | number | boolean>;
}

/**
 * 连接器健康状态
 */
export interface ConnectorHealthStatus {
  available: boolean;
  latencyMs?: number;
  lastChecked: Date;
  error?: string;
  quotaRemaining?: number;
}

/**
 * 连接器注册信息
 */
export interface ConnectorRegistration {
  connector: IDataSourceConnector;
  registeredAt: Date;
  lastHealthCheck?: ConnectorHealthStatus;
}

/**
 * Semantic Scholar 论文结果
 */
export interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract?: string;
  url: string;
  year?: number;
  citationCount: number;
  authors: Array<{ name: string; authorId?: string }>;
  venue?: string;
  fieldsOfStudy?: string[];
  isOpenAccess: boolean;
  publicationDate?: string;
}

/**
 * PubMed 文章结果
 */
export interface PubMedArticle {
  pmid: string;
  title: string;
  abstract?: string;
  url: string;
  authors: string[];
  journal?: string;
  publicationDate?: string;
  doi?: string;
  meshTerms?: string[];
}

/**
 * 金融数据结果
 */
export interface FinanceDataPoint {
  symbol: string;
  name: string;
  price?: number;
  change?: number;
  changePercent?: number;
  marketCap?: number;
  volume?: number;
  description?: string;
  sector?: string;
  industry?: string;
  timestamp: string;
}

/**
 * 天气数据结果
 */
export interface WeatherDataPoint {
  location: string;
  temperature: number;
  humidity: number;
  description: string;
  windSpeed: number;
  forecast?: Array<{
    date: string;
    high: number;
    low: number;
    condition: string;
  }>;
  timestamp: string;
}
