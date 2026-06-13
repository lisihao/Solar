/**
 * SerpAPI Image Search Tool
 * SerpAPI 图片搜索工具 - Google Images via SerpAPI
 *
 * 免费额度: 100 次/月
 * 超额费用: $50/月起
 * 接入难度: 低
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import { PolicyDataService } from "../policy/policy-data.service";
import type {
  ImageSearchInput,
  ImageSearchOutput,
  ImageSearchResult,
} from "./image-search.types";

@Injectable()
export class SerpAPIImageSearchTool extends BaseTool<
  ImageSearchInput,
  ImageSearchOutput
> {
  private readonly logger = new Logger(SerpAPIImageSearchTool.name);

  readonly id = "serpapi-image-search";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "information";
  readonly name = "SerpAPI 图片搜索";
  readonly description =
    "使用 SerpAPI 搜索 Google Images。封装了 Google 图片搜索，接入简单，结果丰富。";
  readonly tags = ["image", "search", "serpapi", "google"];
  readonly defaultTimeout = 20000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "图片搜索查询词",
      },
      numResults: {
        type: "number",
        description: "返回结果数量，默认 10，最大 20",
        default: 10,
      },
      size: {
        type: "string",
        description: "图片尺寸过滤",
        enum: ["small", "medium", "large", "any"],
        default: "large",
      },
      imageType: {
        type: "string",
        description: "图片类型",
        enum: ["photo", "chart", "diagram", "any"],
        default: "any",
      },
      language: {
        type: "string",
        description: "搜索语言",
        enum: ["zh-CN", "en-US", "auto"],
        default: "auto",
      },
      safeSearch: {
        type: "string",
        description: "安全搜索级别",
        enum: ["strict", "moderate", "off"],
        default: "moderate",
      },
    },
    required: ["query"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            imageUrl: { type: "string" },
            thumbnailUrl: { type: "string" },
            title: { type: "string" },
            sourceUrl: { type: "string" },
            sourceDomain: { type: "string" },
            width: { type: "number" },
            height: { type: "number" },
          },
        },
      },
      success: { type: "boolean" },
      totalResults: { type: "number" },
      provider: { type: "string" },
    },
  };

  constructor(private readonly policyDataService: PolicyDataService) {
    super();
  }

  validateInput(input: ImageSearchInput): boolean {
    return (
      typeof input.query === "string" &&
      input.query.trim().length > 0 &&
      input.query.length <= 500
    );
  }

  protected async doExecute(
    input: ImageSearchInput,
    _context: ToolContext,
  ): Promise<ImageSearchOutput> {
    const apiKey = await this.policyDataService.getApiKey(
      "serpapi-image-search",
    );
    if (!apiKey) {
      throw new Error(
        "SerpAPI API key not configured. Configure it in Admin → Secrets.",
      );
    }

    const {
      query,
      numResults = 10,
      size = "large",
      safeSearch = "moderate",
      language = "auto",
    } = input;

    const count = Math.min(numResults, 20);

    const params = new URLSearchParams({
      api_key: apiKey,
      engine: "google_images",
      q: query,
      num: String(count),
      safe: safeSearch === "off" ? "off" : "active",
    });

    // SerpAPI uses tbs param for size filtering
    if (size === "large") {
      params.set("tbs", "isz:l");
    } else if (size === "medium") {
      params.set("tbs", "isz:m");
    }

    if (language === "zh-CN") {
      params.set("hl", "zh-CN");
      params.set("gl", "cn");
    } else if (language === "en-US") {
      params.set("hl", "en");
      params.set("gl", "us");
    }

    const url = `https://serpapi.com/search.json?${params.toString()}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      this.logger.error(
        `SerpAPI error: ${response.status} ${response.statusText} — ${errorBody}`,
      );
      this.policyDataService.markKeyFailed(
        "serpapi-image-search",
        apiKey,
        response.status,
      );
      throw new Error(`SerpAPI error: ${response.status}`);
    }

    const data = (await response.json()) as {
      images_results?: Record<string, unknown>[];
    };

    const results: ImageSearchResult[] = (data.images_results ?? [])
      .slice(0, count)
      .map((item) => ({
        imageUrl: item.original as string,
        thumbnailUrl: (item.thumbnail as string) || undefined,
        title: (item.title as string) || "",
        description: (item.snippet as string) || undefined,
        sourceUrl: (item.link as string) || (item.source as string) || "",
        sourceDomain:
          (item.source as string) || this.extractDomain(item.link as string),
        width: (item.original_width as number) || undefined,
        height: (item.original_height as number) || undefined,
        format: undefined,
      }));

    this.policyDataService.clearKeyFailure("serpapi-image-search", apiKey);

    this.logger.log(
      `SerpAPI Image Search: "${query}" → ${results.length} results`,
    );

    return {
      results,
      success: true,
      totalResults: results.length,
      provider: "serpapi",
    };
  }

  private extractDomain(url: string | undefined): string {
    if (!url) return "";
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }
}
