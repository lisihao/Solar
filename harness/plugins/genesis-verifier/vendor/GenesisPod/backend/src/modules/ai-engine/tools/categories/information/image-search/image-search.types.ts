/**
 * Image Search Tools - Shared Types
 * 图片搜索工具集 - 统一类型定义
 */

/** 图片搜索输入 */
export interface ImageSearchInput {
  /** 搜索查询词 */
  query: string;
  /** 返回结果数量，默认 10 */
  numResults?: number;
  /** 图片尺寸过滤 */
  size?: "small" | "medium" | "large" | "any";
  /** 图片类型过滤 */
  imageType?: "photo" | "chart" | "diagram" | "any";
  /** 搜索语言 */
  language?: "zh-CN" | "en-US" | "auto";
  /** 安全搜索级别 */
  safeSearch?: "strict" | "moderate" | "off";
}

/** 单张图片搜索结果 */
export interface ImageSearchResult {
  /** 图片 URL */
  imageUrl: string;
  /** 缩略图 URL */
  thumbnailUrl?: string;
  /** 图片标题/alt text */
  title: string;
  /** 图片描述 */
  description?: string;
  /** 来源页面 URL */
  sourceUrl: string;
  /** 来源域名 */
  sourceDomain: string;
  /** 图片宽度 */
  width?: number;
  /** 图片高度 */
  height?: number;
  /** 文件大小（字节） */
  fileSize?: number;
  /** 图片格式 */
  format?: string;
}

/** 图片搜索输出 */
export interface ImageSearchOutput {
  /** 搜索结果列表 */
  results: ImageSearchResult[];
  /** 搜索是否成功 */
  success: boolean;
  /** 返回的结果数量 */
  totalResults: number;
  /** 使用的搜索提供商 */
  provider: "bing" | "google-cse" | "serpapi";
}
