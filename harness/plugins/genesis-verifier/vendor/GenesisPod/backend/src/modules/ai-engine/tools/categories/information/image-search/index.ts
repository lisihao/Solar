/**
 * Image Search Tools - 图片搜索工具集
 *
 * 提供 3 个搜索引擎 + 1 个聚合器：
 * - BingImageSearchTool: 必应图片搜索（推荐，免费额度最大）
 * - GoogleImageSearchTool: Google 图片搜索（需要 CSE 配置）
 * - SerpAPIImageSearchTool: SerpAPI 图片搜索（接入最简单）
 * - ImageSearchAggregatorTool: 智能聚合，自动选择可用引擎
 */

export { BingImageSearchTool } from "./bing-image-search.tool";
export { GoogleImageSearchTool } from "./google-image-search.tool";
export { SerpAPIImageSearchTool } from "./serpapi-image-search.tool";
export { ImageSearchAggregatorTool } from "./image-search-aggregator.tool";
export type {
  ImageSearchInput,
  ImageSearchOutput,
  ImageSearchResult,
} from "./image-search.types";
