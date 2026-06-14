/**
 * Social X (Twitter) Search Tool
 * X / Twitter 社媒搜索工具 - 获取话题趋势、舆情、关键观点。
 *
 * 实现策略：通过 web-search 工具加 `site:x.com OR site:twitter.com` 域名前缀
 * 检索。这是 TI SocialSearchAdapter 的 fallback 路径——稳定、不依赖 LLM。
 *
 * 注：原 TI 适配器还有 Grok Live Search 主路径，但那需要 ai-harness 的
 * ChatFacade（违反 ai-engine → ai-harness 单向依赖）。如需 Grok 实时检索，
 * 应单独在 ai-harness 层注册 'x-realtime-search' 工具。
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import { ToolRegistry } from "../../../registry/tool.registry";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import {
  resolveEffectiveTimeRange,
  SEARCH_TIME_RANGE_VALUES,
  type SearchTimeRange,
} from "@/common/search/search-time-range";

// ============================================================================
// Types
// ============================================================================

export interface SocialXSearchInput {
  /** 搜索查询（关键词 / 话题） */
  query: string;
  /** 最大结果数，默认 10 */
  maxResults?: number;
  /** 搜索时间范围 */
  timeRange?: SearchTimeRange;
}

export interface SocialXItem {
  /** 标题（推文标题或用户名） */
  title: string;
  /** 推文 URL */
  url: string;
  /** 摘要内容 */
  snippet: string;
  /** 发布日期 */
  publishedDate?: string;
  /** 域名（x.com / twitter.com） */
  domain: string;
}

export interface SocialXSearchOutput {
  /** 命中条目 */
  items: SocialXItem[];
  /** 是否成功 */
  success: boolean;
  /** 失败原因 */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class SocialXSearchTool extends BaseTool<
  SocialXSearchInput,
  SocialXSearchOutput
> {
  private readonly logger = new Logger(SocialXSearchTool.name);

  readonly id = "social-x-search";
  readonly sideEffect = "none" as const;
  readonly name = "X / Twitter Social Search";
  readonly description =
    "在 X (Twitter) 上检索话题讨论、舆情、关键观点。底层通过 web-search 加 site:x.com OR site:twitter.com 域名过滤实现，无需 X API Key。适合社媒情绪分析、产品发布舆情、KOL 观点采集类维度。";
  readonly category: ToolCategory = "information";
  readonly tags = ["social", "x", "twitter", "trending", "social-media"];
  readonly defaultTimeout = 20000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "搜索关键词。示例：'Anthropic Claude 4', 'GPT-5 launch', 'AI agent benchmark'。",
      },
      maxResults: {
        type: "number",
        description: "最大结果数，默认 10",
        default: 10,
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
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            url: { type: "string" },
            snippet: { type: "string" },
            publishedDate: { type: "string" },
            domain: { type: "string" },
          },
        },
      },
      error: { type: "string" },
    },
  };

  constructor(private readonly toolRegistry: ToolRegistry) {
    super();
  }

  protected async doExecute(
    input: SocialXSearchInput,
    context: ToolContext,
  ): Promise<SocialXSearchOutput> {
    const { query, maxResults = 10 } = input;
    const timeRange = resolveEffectiveTimeRange(
      input.timeRange,
      context.metadata,
    );

    try {
      const webSearchTool = this.toolRegistry.tryGet("web-search");
      if (!webSearchTool) {
        return {
          success: false,
          items: [],
          error:
            "web-search tool not registered (required by social-x-search).",
        };
      }

      const siteQuery = `(site:x.com OR site:twitter.com) ${query}`;
      const result = await webSearchTool.execute(
        { query: siteQuery, numResults: maxResults, timeRange },
        context,
      );

      if (!result.success || !result.data) {
        return {
          success: false,
          items: [],
          error: result.error?.message ?? "web-search returned no data",
        };
      }

      const data = result.data as {
        results?: Array<{
          title: string;
          url: string;
          content?: string;
          publishedDate?: string;
        }>;
      };
      const rawResults = data.results ?? [];

      const items: SocialXItem[] = rawResults.map((r) => {
        let domain = "x.com";
        try {
          domain = new URL(r.url).hostname.replace(/^www\./, "");
        } catch {
          // ignore
        }
        return {
          title: r.title ?? "",
          url: r.url,
          snippet: r.content ?? "",
          publishedDate: r.publishedDate,
          domain,
        };
      });

      this.logger.log(
        `[doExecute] social-x-search: ${items.length} items from x/twitter`,
      );

      return { success: true, items };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[doExecute] social-x-search failed: ${errMsg}`);
      return {
        success: false,
        items: [],
        error: `Social X 搜索失败: ${errMsg}`,
      };
    }
  }
}
