/**
 * YouTube / Video Search Tool
 * 视频搜索工具 - 在 YouTube / Vimeo / Bilibili 等公开视频平台检索内容。
 *
 * 实现策略：通过 web-search 工具加 site: 域名前缀检索。
 *
 * 未来扩展：当 tool_configs 配置了 youtube-data-api-key 时，可走 YouTube Data API
 * v3（free tier 10K units/day）拿真正的元数据（views / duration / channel）。
 * 当前版本走 site: 兜底足够 LLM 拿标题 / 摘要 / URL。
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

export interface YouTubeSearchInput {
  /** 搜索关键词 */
  query: string;
  /** 最大结果数，默认 10 */
  maxResults?: number;
  /** 平台子集（不传 = 全平台）。可选：youtube / vimeo / bilibili */
  platforms?: string[];
  /** 搜索时间范围 */
  timeRange?: SearchTimeRange;
}

export interface VideoItem {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  /** 平台名（YouTube / Vimeo / Bilibili） */
  platform: string;
  domain: string;
}

export interface YouTubeSearchOutput {
  items: VideoItem[];
  platformsQueried: string[];
  success: boolean;
  error?: string;
}

interface VideoPlatformConfig {
  key: string;
  name: string;
  domain: string;
}

const ALL_VIDEO_PLATFORMS: VideoPlatformConfig[] = [
  { key: "youtube", name: "YouTube", domain: "youtube.com" },
  { key: "vimeo", name: "Vimeo", domain: "vimeo.com" },
  { key: "bilibili", name: "Bilibili", domain: "bilibili.com" },
];

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class YouTubeSearchTool extends BaseTool<
  YouTubeSearchInput,
  YouTubeSearchOutput
> {
  private readonly logger = new Logger(YouTubeSearchTool.name);

  readonly id = "youtube-search";
  readonly sideEffect = "none" as const;
  readonly name = "YouTube / Video Search";
  readonly description =
    "在 YouTube / Vimeo / Bilibili 等公开视频平台检索视频内容（标题/简介/URL）。底层通过 web-search 加 site: 域名过滤实现，无需 YouTube API key。适合产品评测、教学课程、会议演讲、KOL 视频内容采集类维度。";
  readonly category: ToolCategory = "information";
  readonly tags = ["video", "youtube", "vimeo", "media", "multimedia"];
  readonly defaultTimeout = 20000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "搜索关键词。示例：'GPT-5 demo'、'transformer architecture explained'、'Anthropic Claude 4 review'。",
      },
      maxResults: {
        type: "number",
        description: "最大结果数，默认 10",
        default: 10,
      },
      platforms: {
        type: "array",
        items: { type: "string" },
        description:
          "平台子集（不传 = 全平台）。可选：youtube / vimeo / bilibili",
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
            platform: { type: "string" },
            domain: { type: "string" },
          },
        },
      },
      platformsQueried: { type: "array", items: { type: "string" } },
      error: { type: "string" },
    },
  };

  constructor(private readonly toolRegistry: ToolRegistry) {
    super();
  }

  protected async doExecute(
    input: YouTubeSearchInput,
    context: ToolContext,
  ): Promise<YouTubeSearchOutput> {
    const { query, maxResults = 10, platforms } = input;
    const timeRange = resolveEffectiveTimeRange(
      input.timeRange,
      context.metadata,
    );

    try {
      const selected =
        platforms && platforms.length > 0
          ? ALL_VIDEO_PLATFORMS.filter((p) =>
              platforms.map((s) => s.toLowerCase()).includes(p.key),
            )
          : ALL_VIDEO_PLATFORMS;
      if (selected.length === 0) {
        return {
          success: false,
          items: [],
          platformsQueried: [],
          error: `Unknown platforms (valid: ${ALL_VIDEO_PLATFORMS.map((p) => p.key).join(",")})`,
        };
      }

      const webSearchTool = this.toolRegistry.tryGet("web-search");
      if (!webSearchTool) {
        return {
          success: false,
          items: [],
          platformsQueried: selected.map((p) => p.key),
          error: "web-search tool not registered (required by youtube-search).",
        };
      }

      const siteFilter = selected.map((p) => `site:${p.domain}`).join(" OR ");
      const siteQuery = `(${siteFilter}) ${query}`;

      const result = await webSearchTool.execute(
        { query: siteQuery, numResults: maxResults, timeRange },
        context,
      );

      if (!result.success || !result.data) {
        return {
          success: false,
          items: [],
          platformsQueried: selected.map((p) => p.key),
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

      const items: VideoItem[] = rawResults.map((r) => {
        let domain = "";
        let platform = "Unknown";
        try {
          domain = new URL(r.url).hostname.replace(/^www\./, "");
          for (const p of ALL_VIDEO_PLATFORMS) {
            if (domain.includes(p.domain)) {
              platform = p.name;
              break;
            }
          }
        } catch {
          // ignore
        }
        return {
          title: r.title ?? "",
          url: r.url,
          snippet: r.content ?? "",
          publishedDate: r.publishedDate,
          platform,
          domain,
        };
      });

      this.logger.log(
        `[doExecute] youtube-search: ${items.length} videos across ${selected.length} platforms`,
      );

      return {
        success: true,
        items,
        platformsQueried: selected.map((p) => p.key),
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[doExecute] youtube-search failed: ${errMsg}`);
      return {
        success: false,
        items: [],
        platformsQueried: [],
        error: `视频搜索失败: ${errMsg}`,
      };
    }
  }
}
