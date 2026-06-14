/**
 * Data Source Mapping Configuration
 *
 * 集中管理数据源类型与工具 ID 的映射关系
 * 避免在多个服务中重复定义
 */
import { DataSourceType } from "../types/data-source.types";

// ============================================================================
// DataSource → Tool ID 映射
// ============================================================================

/**
 * 数据源类型到工具 ID 的映射
 */
export const DATA_SOURCE_TO_TOOL_ID: Partial<Record<DataSourceType, string>> = {
  [DataSourceType.WEB]: "web-search",
  [DataSourceType.ACADEMIC]: "arxiv-search",
  [DataSourceType.GITHUB]: "github-search",
  [DataSourceType.HACKERNEWS]: "hackernews-search",
  [DataSourceType.FEDERAL_REGISTER]: "federal-register",
  [DataSourceType.CONGRESS]: "congress-gov",
  [DataSourceType.WHITEHOUSE]: "whitehouse-news",
  [DataSourceType.SOCIAL_X]: "social-x",
  // ★ P0: 新增实时数据源连接器
  [DataSourceType.SEMANTIC_SCHOLAR]: "semantic-scholar",
  [DataSourceType.PUBMED]: "pubmed",
  [DataSourceType.OPENALEX]: "openalex-search",
  [DataSourceType.FINANCE_API]: "finance-api",
  [DataSourceType.WEATHER_API]: "weather-api",
  [DataSourceType.INDUSTRY_REPORT]: "industry-report",
  // RSS, LOCAL 暂未映射工具
};

// ============================================================================
// Tool ID → DataSource 映射（含别名）
// ============================================================================

/**
 * 工具 ID 到数据源类型的映射
 * 包含多个别名以支持灵活输入
 */
export const TOOL_ID_TO_DATA_SOURCE: Record<string, DataSourceType> = {
  // 标准工具 ID
  "web-search": DataSourceType.WEB,
  "arxiv-search": DataSourceType.ACADEMIC,
  "academic-search": DataSourceType.ACADEMIC,
  "github-search": DataSourceType.GITHUB,
  "hackernews-search": DataSourceType.HACKERNEWS,
  "federal-register": DataSourceType.FEDERAL_REGISTER,
  "congress-gov": DataSourceType.CONGRESS,
  "whitehouse-news": DataSourceType.WHITEHOUSE,
  "social-x": DataSourceType.SOCIAL_X,
  // 别名
  "social-media": DataSourceType.SOCIAL_X,
  "x-twitter": DataSourceType.SOCIAL_X,
  twitter: DataSourceType.SOCIAL_X,
  // ★ P0: 新增实时数据源连接器别名
  "semantic-scholar": DataSourceType.SEMANTIC_SCHOLAR,
  semanticscholar: DataSourceType.SEMANTIC_SCHOLAR,
  pubmed: DataSourceType.PUBMED,
  "openalex-search": DataSourceType.OPENALEX,
  openalex: DataSourceType.OPENALEX,
  "finance-api": DataSourceType.FINANCE_API,
  finance: DataSourceType.FINANCE_API,
  "weather-api": DataSourceType.WEATHER_API,
  weather: DataSourceType.WEATHER_API,
  "industry-report": DataSourceType.INDUSTRY_REPORT,
  "industry-reports": DataSourceType.INDUSTRY_REPORT,
  industryreport: DataSourceType.INDUSTRY_REPORT,
  web: DataSourceType.WEB,
  academic: DataSourceType.ACADEMIC,
  github: DataSourceType.GITHUB,
  hackernews: DataSourceType.HACKERNEWS,
  hn: DataSourceType.HACKERNEWS,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 将数据源类型转换为工具 ID
 */
export function dataSourceToToolId(source: DataSourceType): string | null {
  return DATA_SOURCE_TO_TOOL_ID[source] || null;
}

/**
 * 将工具 ID 转换为数据源类型
 */
export function toolIdToDataSource(toolId: string): DataSourceType | null {
  if (!toolId) return null;
  return TOOL_ID_TO_DATA_SOURCE[toolId.toLowerCase()] || null;
}

/**
 * 将工具 ID 列表转换为数据源类型列表
 */
export function convertToolsToDataSources(tools: string[]): DataSourceType[] {
  const sources: DataSourceType[] = [];
  for (const tool of tools) {
    const source = toolIdToDataSource(tool);
    if (source && !sources.includes(source)) {
      sources.push(source);
    }
  }
  return sources;
}
