/**
 * HackerNews Search Tool
 * HackerNews 搜索工具 - 搜索技术社区讨论和新闻
 *
 * API 文档: https://hn.algolia.com/api
 * 无需 API Key（免费公开）
 * 建议限速: 1 req/s
 */

import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import { firstValueFrom } from "rxjs";
import { APP_CONFIG } from "@/common/config/app.config";
import {
  getUnixTimestampSeconds,
  resolveEffectiveTimeRange,
  resolveSearchTimeRangeSince,
  SEARCH_TIME_RANGE_VALUES,
  type SearchTimeRange,
} from "@/common/search/search-time-range";

// ============================================================================
// Types
// ============================================================================

/**
 * HackerNews 内容类型
 */
export type HackerNewsTagType =
  | "story"
  | "comment"
  | "poll"
  | "show_hn"
  | "ask_hn";

/**
 * 输入参数
 */
export interface HackerNewsSearchInput {
  /** 搜索查询 */
  query: string;
  /** 最大结果数，默认 20 */
  maxResults?: number;
  /** 内容类型标签 */
  tags?: HackerNewsTagType;
  /** 数值过滤器，如 'points>100' 或 'created_at_i>1577836800' */
  numericFilters?: string;
  /** 搜索时间范围 */
  timeRange?: SearchTimeRange;
}

/**
 * HackerNews 搜索结果项
 */
export interface HackerNewsSearchResult {
  /** HN 对象 ID */
  objectID: string;
  /** 标题 */
  title: string;
  /** 原始链接（如果是链接帖） */
  url: string | null;
  /** 作者 */
  author: string;
  /** 点赞数 */
  points: number;
  /** 评论数 */
  numComments: number;
  /** 创建时间 */
  createdAt: string;
  /** 帖子内容（如果是文本帖） */
  storyText: string | null;
  /** HN 讨论链接 */
  hnUrl: string;
}

/**
 * 输出结果
 */
export interface HackerNewsSearchOutput {
  /** 是否成功 */
  success: boolean;
  /** 搜索结果 */
  hits: HackerNewsSearchResult[];
  /** 结果总数 */
  totalHits: number;
  /** 查询关键词 */
  query: string;
  /** 错误信息 */
  error?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

interface HackerNewsApiHit {
  objectID: string;
  title: string;
  url: string | null;
  author: string;
  points: number;
  num_comments: number;
  created_at: string;
  story_text: string | null;
  _tags?: string[];
}

interface HackerNewsApiResponse {
  hits: HackerNewsApiHit[];
  nbHits: number;
  page: number;
  nbPages: number;
  hitsPerPage: number;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class HackerNewsSearchTool extends BaseTool<
  HackerNewsSearchInput,
  HackerNewsSearchOutput
> {
  private readonly logger = new Logger(HackerNewsSearchTool.name);

  readonly id = "hackernews-search";
  readonly sideEffect = "none" as const;
  readonly name = "HackerNews Search";
  readonly description =
    "搜索 HackerNews（技术社区新闻和讨论）：技术文章、Show HN 项目、Ask HN 问题、社区评论。数据来源：Algolia HN Search API，无需 API Key。";
  readonly category: ToolCategory = "information";
  readonly tags = ["tech", "community", "news", "discussion", "hackernews"];
  readonly defaultTimeout = 30000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词",
      },
      maxResults: {
        type: "number",
        description: "最大结果数量，默认 20，最大 100",
        default: 20,
      },
      tags: {
        type: "string",
        enum: ["story", "comment", "poll", "show_hn", "ask_hn"],
        description:
          "内容类型：story=普通文章，show_hn=展示项目，ask_hn=提问，comment=评论，poll=投票",
      },
      numericFilters: {
        type: "string",
        description:
          "数值过滤器，如 'points>100'（点赞数>100）或 'created_at_i>1577836800'（时间戳过滤）",
      },
      timeRange: {
        type: "string",
        description:
          "搜索时间范围：30d=最近1个月，90d=最近3个月，180d=最近6个月，365d=最近12个月，730d=最近24个月，all=不限",
        enum: [...SEARCH_TIME_RANGE_VALUES],
        default: "all",
      },
    },
    required: ["query"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean" },
      hits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            objectID: { type: "string" },
            title: { type: "string" },
            url: { type: ["string", "null"] },
            author: { type: "string" },
            points: { type: "number" },
            numComments: { type: "number" },
            createdAt: { type: "string" },
            storyText: { type: ["string", "null"] },
            hnUrl: { type: "string" },
          },
        },
      },
      totalHits: { type: "number" },
      query: { type: "string" },
      error: { type: "string" },
    },
  };

  constructor(private readonly httpService: HttpService) {
    super();
  }

  protected async doExecute(
    input: HackerNewsSearchInput,
    context: ToolContext,
  ): Promise<HackerNewsSearchOutput> {
    const { query, maxResults = 20, tags, numericFilters } = input;
    const timeRange = resolveEffectiveTimeRange(
      input.timeRange,
      context.metadata,
    );

    this.logger.log(
      `[doExecute] Searching HackerNews: query="${query}", tags=${tags}`,
    );

    try {
      // 构建 API URL 和参数
      const baseUrl = "https://hn.algolia.com/api/v1/search";
      const params: Record<string, string> = {
        query: query,
        hitsPerPage: Math.min(maxResults, 100).toString(),
      };

      // 添加标签过滤
      if (tags) {
        params.tags = tags;
      }

      // 添加数值过滤
      const since = resolveSearchTimeRangeSince(timeRange);
      const timeFilter = since
        ? `created_at_i>${getUnixTimestampSeconds(since)}`
        : undefined;
      const mergedNumericFilters = [numericFilters, timeFilter]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .join(",");
      if (mergedNumericFilters) {
        params.numericFilters = mergedNumericFilters;
      }

      // 发送请求
      const response = await firstValueFrom(
        this.httpService.get<HackerNewsApiResponse>(baseUrl, {
          params,
          headers: {
            "User-Agent": APP_CONFIG.brand.userAgent,
          },
          timeout: 30000,
        }),
      );

      const apiResponse = response.data;

      // 转换结果
      const hits: HackerNewsSearchResult[] = (apiResponse.hits ?? []).map(
        (hit) => ({
          objectID: hit.objectID,
          title: hit.title ?? "",
          url: hit.url ?? null,
          author: hit.author ?? "",
          points: hit.points ?? 0,
          numComments: hit.num_comments ?? 0,
          createdAt: hit.created_at ?? "",
          storyText: hit.story_text ?? null,
          hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        }),
      );

      this.logger.log(
        `[doExecute] Found ${hits.length} results (total: ${apiResponse.nbHits})`,
      );

      return {
        success: true,
        hits,
        totalHits: apiResponse.nbHits,
        query: query,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`[doExecute] HackerNews API error: ${errorMessage}`);

      return {
        success: false,
        hits: [],
        totalHits: 0,
        query: query,
        error: `HackerNews 搜索失败: ${errorMessage}`,
      };
    }
  }

  validateInput(input: HackerNewsSearchInput): boolean {
    // 查询关键词是必需的且不能为空
    return !!(input.query && input.query.trim().length > 0);
  }
}
