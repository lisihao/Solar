/**
 * Job Search Tool
 * 职位 / 招聘搜索工具 - 在主流招聘平台检索岗位信息。
 *
 * 实现策略：通过 web-search 工具加 site: 域名前缀检索 LinkedIn Jobs / Indeed /
 * Glassdoor / Wellfound (AngelList) / HN "Who's Hiring" 等公开内容。
 *
 * 为什么不直接调 LinkedIn / Indeed API：
 *   - LinkedIn Talent Solutions 是 Partner-Only（仅给 Greenhouse 等招聘平台），
 *     People Search API 已于 2018 下线
 *   - Indeed Job Search Publisher API 已废止
 *   - 反爬强 + TOS 限制，直接抓不可行
 * 所以走 site: 兜底拿公开搜索引擎索引内容（合规、无成本）。
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import { ToolRegistry } from "../../../registry/tool.registry";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";

// ============================================================================
// Types
// ============================================================================

export interface JobSearchInput {
  /** 搜索关键词，如 "AI engineer remote", "senior backend engineer San Francisco" */
  query: string;
  /** 最大结果数，默认 10 */
  maxResults?: number;
  /** 偏好平台子集（不传 = 全平台），可选值：linkedin / indeed / glassdoor / wellfound / hackernews */
  preferredPlatforms?: string[];
}

export interface JobItem {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  /** 命中的招聘平台名（LinkedIn / Indeed 等） */
  platform: string;
  domain: string;
}

export interface JobSearchOutput {
  items: JobItem[];
  platformsQueried: string[];
  success: boolean;
  error?: string;
}

interface PlatformConfig {
  key: string;
  name: string;
  domain: string;
}

const ALL_PLATFORMS: PlatformConfig[] = [
  { key: "linkedin", name: "LinkedIn Jobs", domain: "linkedin.com/jobs" },
  { key: "indeed", name: "Indeed", domain: "indeed.com" },
  { key: "glassdoor", name: "Glassdoor", domain: "glassdoor.com" },
  { key: "wellfound", name: "Wellfound", domain: "wellfound.com" },
  {
    key: "hackernews",
    name: "HN Who's Hiring",
    domain: "news.ycombinator.com",
  },
];

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class JobSearchTool extends BaseTool<JobSearchInput, JobSearchOutput> {
  private readonly logger = new Logger(JobSearchTool.name);

  readonly id = "job-search";
  readonly sideEffect = "none" as const;
  readonly name = "Job & Recruiting Search";
  readonly description =
    "在主流招聘平台（LinkedIn Jobs / Indeed / Glassdoor / Wellfound / HN Who's Hiring）检索职位信息。底层通过 web-search 加 site: 域名过滤实现，无需平台 API key。适合人才市场分析、薪资行情、岗位需求趋势类维度。";
  readonly category: ToolCategory = "information";
  readonly tags = ["jobs", "recruiting", "career", "talent", "employment"];
  readonly defaultTimeout = 20000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "搜索关键词。示例：'AI engineer remote'、'senior backend San Francisco'、'product manager fintech'。",
      },
      maxResults: {
        type: "number",
        description: "最大结果数，默认 10",
        default: 10,
      },
      preferredPlatforms: {
        type: "array",
        items: { type: "string" },
        description:
          "偏好平台子集（不传 = 全平台）。可选值：linkedin / indeed / glassdoor / wellfound / hackernews",
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
    input: JobSearchInput,
    context: ToolContext,
  ): Promise<JobSearchOutput> {
    const { query, maxResults = 10, preferredPlatforms } = input;

    try {
      const platforms =
        preferredPlatforms && preferredPlatforms.length > 0
          ? ALL_PLATFORMS.filter((p) =>
              preferredPlatforms
                .map((s) => s.toLowerCase())
                .includes(p.key.toLowerCase()),
            )
          : ALL_PLATFORMS;
      if (platforms.length === 0) {
        return {
          success: false,
          items: [],
          platformsQueried: [],
          error: `Unknown preferredPlatforms (valid: ${ALL_PLATFORMS.map((p) => p.key).join(",")})`,
        };
      }

      const webSearchTool = this.toolRegistry.tryGet("web-search");
      if (!webSearchTool) {
        return {
          success: false,
          items: [],
          platformsQueried: platforms.map((p) => p.key),
          error: "web-search tool not registered (required by job-search).",
        };
      }

      const siteFilter = platforms.map((p) => `site:${p.domain}`).join(" OR ");
      const siteQuery = `(${siteFilter}) ${query}`;

      const result = await webSearchTool.execute(
        { query: siteQuery, numResults: maxResults },
        context,
      );

      if (!result.success || !result.data) {
        return {
          success: false,
          items: [],
          platformsQueried: platforms.map((p) => p.key),
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

      const items: JobItem[] = rawResults.map((r) => {
        let domain = "";
        let platform = "Unknown";
        try {
          domain = new URL(r.url).hostname.replace(/^www\./, "");
          for (const p of ALL_PLATFORMS) {
            const pHost = p.domain.split("/")[0];
            if (domain.includes(pHost)) {
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
        `[doExecute] job-search: ${items.length} jobs across ${platforms.length} platforms`,
      );

      return {
        success: true,
        items,
        platformsQueried: platforms.map((p) => p.key),
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[doExecute] job-search failed: ${errMsg}`);
      return {
        success: false,
        items: [],
        platformsQueried: [],
        error: `Job 搜索失败: ${errMsg}`,
      };
    }
  }
}

