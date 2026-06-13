/**
 * Google Image Search Tool
 * Google 图片搜索工具 - Custom Search JSON API
 *
 * 免费额度: 100 次/天
 * 超额费用: $5/1000 次
 * 接入难度: 中（需要创建 Custom Search Engine + API Key）
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
export class GoogleImageSearchTool extends BaseTool<
  ImageSearchInput,
  ImageSearchOutput
> {
  private readonly logger = new Logger(GoogleImageSearchTool.name);

  readonly id = "google-image-search";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "information";
  readonly name = "Google 图片搜索";
  readonly description =
    "使用 Google Custom Search API 搜索互联网图片。需要配置 API Key 和 Search Engine ID。";
  readonly tags = ["image", "search", "google"];
  readonly defaultTimeout = 15000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "图片搜索查询词",
      },
      numResults: {
        type: "number",
        description: "返回结果数量，默认 10，最大 10（API 限制）",
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
      "google-image-search",
    );
    const searchEngineId = await this.policyDataService.getApiKey(
      "google-cse-engine-id",
    );

    if (!apiKey) {
      throw new Error(
        "Google CSE API key not configured. Configure it in Admin → Secrets.",
      );
    }
    if (!searchEngineId) {
      throw new Error(
        "Google CSE Search Engine ID not configured. Configure it in Admin → Secrets.",
      );
    }

    const {
      query,
      numResults = 10,
      size = "large",
      safeSearch = "moderate",
      language = "auto",
      imageType = "any",
    } = input;

    // Google CSE API max 10 results per request
    const count = Math.min(numResults, 10);

    const params = new URLSearchParams({
      key: apiKey,
      cx: searchEngineId,
      q: query,
      searchType: "image",
      num: String(count),
      safe:
        safeSearch === "strict"
          ? "active"
          : safeSearch === "off"
            ? "off"
            : "medium",
    });

    if (size && size !== "any") {
      params.set(
        "imgSize",
        size === "small" ? "small" : size === "medium" ? "medium" : "large",
      );
    }

    if (imageType === "photo") {
      params.set("imgType", "photo");
    }

    if (language === "zh-CN") {
      params.set("lr", "lang_zh-CN");
    } else if (language === "en-US") {
      params.set("lr", "lang_en");
    }

    const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      this.logger.error(
        `Google CSE API error: ${response.status} ${response.statusText} — ${errorBody}`,
      );
      this.policyDataService.markKeyFailed(
        "google-image-search",
        apiKey,
        response.status,
      );
      throw new Error(`Google CSE API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      items?: Record<string, unknown>[];
    };

    const results: ImageSearchResult[] = (data.items ?? []).map((item) => {
      const image = (item.image ?? {}) as Record<string, unknown>;
      return {
        imageUrl: item.link as string,
        thumbnailUrl: (image.thumbnailLink as string) || undefined,
        title: (item.title as string) || "",
        description: (item.snippet as string) || undefined,
        sourceUrl: (image.contextLink as string) || "",
        sourceDomain: this.extractDomain(image.contextLink as string),
        width: (image.width as number) || undefined,
        height: (image.height as number) || undefined,
        fileSize: (image.byteSize as number) || undefined,
        format: (item.fileFormat as string) || undefined,
      };
    });

    this.policyDataService.clearKeyFailure("google-image-search", apiKey);

    this.logger.log(
      `Google Image Search: "${query}" → ${results.length} results`,
    );

    return {
      results,
      success: true,
      totalResults: results.length,
      provider: "google-cse",
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
