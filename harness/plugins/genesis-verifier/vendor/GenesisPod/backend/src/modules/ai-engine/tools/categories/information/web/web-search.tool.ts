/**
 * Web Search Tool
 * 网络搜索工具 - 复用 SearchService
 */

import { Injectable } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";

import {
  SearchService,
  WebSearchResult,
} from "../../../../content/web-search/web-search.service";
import {
  resolveSearchTimeRangeSince,
  resolveEffectiveTimeRange,
  SEARCH_TIME_RANGE_VALUES,
  type SearchTimeRange,
} from "@/common/search/search-time-range";

// ============================================================================
// Types
// ============================================================================

export interface FoldedDomainSummary {
  /** 被折叠的域名（已去除 www. 前缀）*/
  domain: string;
  /** 该域名被折叠（省略）的结果数量 */
  folded: number;
}

export interface WebSearchInput {
  /**
   * 搜索查询词
   */
  query: string;

  /**
   * 返回结果数量，默认 5
   */
  numResults?: number;

  /**
   * 搜索语言
   */
  language?: "zh-CN" | "en-US" | "auto";

  /**
   * 是否按域名分组去重，默认 true。
   * 同一域名最多保留 perDomainLimit 条，超出部分记入 foldedSummary。
   */
  groupByDomain?: boolean;

  /**
   * 每个域名最多保留的结果数，默认 3（groupByDomain=true 时生效）
   */
  perDomainLimit?: number;

  /**
   * 搜索资料的时间范围。
   * 30d=最近1个月，90d=最近3个月，180d=最近6个月，365d=最近12个月，730d=最近24个月，all=不限
   */
  timeRange?: SearchTimeRange;
}

export interface WebSearchOutput {
  /**
   * 搜索结果列表（已按域名分组去重，若 groupByDomain=true）
   */
  results: WebSearchResult[];

  /**
   * 搜索是否成功
   */
  success: boolean;

  /**
   * provider 返回的原始结果总数（含被折叠的条目）
   */
  totalResults: number;

  /**
   * 失败时的具体错误信息（success=false 时存在）
   * ★ P0-LIVE-SEARCH-EMPTY (2026-04-30): 之前丢掉了 SearchService 返回的 error，
   *   导致 LLM / trace 只看到 "success: false, totalResults: 0" 不知道根因。
   */
  error?: string;

  /**
   * 实际使用的搜索 provider（tavily / serper / duckduckgo）
   * 让 LLM/调用方知道 fallback chain 走到了哪一步
   */
  provider?: string;

  /**
   * 因同源结果过多而被折叠的统计（groupByDomain=true 且有折叠时存在）
   */
  foldedSummary?: FoldedDomainSummary[];
}

// ============================================================================
// Domain Grouping Helper
// ============================================================================

/**
 * 按域名分组，每个域名最多保留 perDomainLimit 条。
 * 无 URL 或 URL 解析失败的条目直接保留（不参与分组计数）。
 *
 * 返回：
 *   items         — 最终保留的结果（无 URL 的在前，有 URL 的按原域名遍历顺序）
 *   foldedSummary — 被折叠的统计（只有当某域名超出限制时才有条目）
 */
export function groupResultsByDomain<T extends { url?: string }>(
  results: T[],
  perDomainLimit = 3,
): { items: T[]; foldedSummary: FoldedDomainSummary[] } {
  const byDomain = new Map<string, T[]>();
  const noUrl: T[] = [];

  for (const r of results) {
    if (!r.url) {
      noUrl.push(r);
      continue;
    }
    let domain: string;
    try {
      domain = new URL(r.url).hostname.replace(/^www\./, "");
    } catch {
      noUrl.push(r);
      continue;
    }
    const arr = byDomain.get(domain) ?? [];
    arr.push(r);
    byDomain.set(domain, arr);
  }

  const items: T[] = [...noUrl];
  const foldedSummary: FoldedDomainSummary[] = [];

  for (const [domain, arr] of byDomain.entries()) {
    items.push(...arr.slice(0, perDomainLimit));
    if (arr.length > perDomainLimit) {
      foldedSummary.push({ domain, folded: arr.length - perDomainLimit });
    }
  }

  return { items, foldedSummary };
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class WebSearchTool extends BaseTool<WebSearchInput, WebSearchOutput> {
  readonly id = "web-search";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "information";
  readonly tags = ["web", "search", "general"];
  readonly name = "网络搜索";
  readonly description =
    "搜索互联网获取最新信息。适用于需要实时数据、新闻、或需要验证的信息。返回搜索结果列表，包含标题、URL和摘要。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索查询词，应该简洁明确",
      },
      numResults: {
        type: "number",
        description: "返回结果数量，默认 8，最大 12",
        default: 8,
      },
      language: {
        type: "string",
        description: "搜索语言偏好",
        enum: ["zh-CN", "en-US", "auto"],
        default: "auto",
      },
      groupByDomain: {
        type: "boolean",
        description:
          "是否按域名分组去重，同一域名最多保留 perDomainLimit 条，默认 true",
        default: true,
      },
      perDomainLimit: {
        type: "number",
        description:
          "每个域名最多保留的结果数，默认 3（groupByDomain=true 时生效）",
        default: 3,
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
      results: {
        type: "array",
        description: "搜索结果列表",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "结果标题" },
            url: { type: "string", description: "结果链接" },
            content: { type: "string", description: "摘要内容" },
            publishedDate: { type: "string", description: "发布日期" },
          },
        },
      },
      success: {
        type: "boolean",
        description: "搜索是否成功",
      },
      totalResults: {
        type: "number",
        description: "返回的结果数量",
      },
      error: {
        type: "string",
        description: "失败时的错误信息（success=false 时）",
      },
      provider: {
        type: "string",
        description: "实际命中的搜索提供商（tavily/serper/duckduckgo）",
      },
      foldedSummary: {
        type: "array",
        description:
          "因同源结果过多被折叠的统计（groupByDomain=true 且有折叠时存在）",
        items: {
          type: "object",
          properties: {
            domain: { type: "string", description: "被折叠的域名" },
            folded: { type: "number", description: "该域名被折叠的结果数量" },
          },
        },
      },
    },
  };

  constructor(private readonly searchService: SearchService) {
    super();
    // defaultTimeout set in class property // 15 秒超时
  }

  validateInput(input: WebSearchInput) {
    return (
      typeof input.query === "string" &&
      input.query.trim().length > 0 &&
      input.query.length <= 500
    );
  }

  protected async doExecute(
    input: WebSearchInput,
    context: ToolContext,
  ): Promise<WebSearchOutput> {
    const { query, numResults = 8 } = input;
    // 2026-05-13: LLM 漏传 timeRange 时不再退回 "all"，而是看 mission context
    // 注入的 searchTimeRange，否则用 DEFAULT_SEARCH_TIME_RANGE (365d) 兜底。
    const timeRange = resolveEffectiveTimeRange(
      input.timeRange,
      context.metadata,
    );

    // 限制最大结果数
    const maxResults = Math.min(numResults, 12);
    const since = resolveSearchTimeRangeSince(timeRange);

    // 调用搜索服务
    const response = await this.searchService.search(query, maxResults, since);

    return {
      results: response.results,
      success: response.success,
      totalResults: response.results.length,
      error: response.error, // ★ 把真实错误透传给 LLM / trace
      provider: response.provider,
    };
  }
}
