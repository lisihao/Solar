/**
 * Bing Image Search Tool
 * 必应图片搜索工具 - Bing Image Search API v7
 *
 * 免费额度: 1000 次/月
 * 超额费用: $7/1000 次
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
export class BingImageSearchTool extends BaseTool<
  ImageSearchInput,
  ImageSearchOutput
> {
  private readonly logger = new Logger(BingImageSearchTool.name);

  readonly id = "bing-image-search";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "information";
  readonly name = "必应图片搜索";
  readonly description =
    "使用 Bing Image Search API 搜索互联网图片。支持按尺寸、类型过滤，适用于研究报告配图。";
  readonly tags = ["image", "search", "bing"];
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
        description: "返回结果数量，默认 10，最大 30",
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
            description: { type: "string" },
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
    const apiKey = await this.policyDataService.getApiKey("bing-image-search");
    if (!apiKey) {
      throw new Error(
        "Bing Image Search API key not configured. Configure it in Admin → Secrets.",
      );
    }

    const {
      query,
      numResults = 10,
      size = "large",
      safeSearch = "moderate",
      language = "auto",
    } = input;

    const count = Math.min(numResults, 30);

    const params = new URLSearchParams({
      q: query,
      count: String(count),
      safeSearch:
        safeSearch === "strict"
          ? "Strict"
          : safeSearch === "off"
            ? "Off"
            : "Moderate",
      minWidth: "400",
      minHeight: "300",
    });

    if (size && size !== "any") {
      params.set(
        "size",
        size === "small" ? "Small" : size === "medium" ? "Medium" : "Large",
      );
    }

    if (language === "zh-CN") {
      params.set("mkt", "zh-CN");
    } else if (language === "en-US") {
      params.set("mkt", "en-US");
    }

    const url = `https://api.bing.microsoft.com/v7.0/images/search?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      this.logger.error(
        `Bing Image Search API error: ${response.status} ${response.statusText} — ${errorBody}`,
      );
      this.policyDataService.markKeyFailed(
        "bing-image-search",
        apiKey,
        response.status,
      );
      throw new Error(`Bing Image Search API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      value?: Record<string, unknown>[];
    };

    const results: ImageSearchResult[] = (data.value ?? []).map((item) => ({
      imageUrl: item.contentUrl as string,
      thumbnailUrl: (item.thumbnailUrl as string) || undefined,
      title: (item.name as string) || "",
      description: (item.datePublished as string) || undefined,
      sourceUrl: (item.hostPageUrl as string) || "",
      sourceDomain: this.extractDomain(item.hostPageUrl as string),
      width: (item.width as number) || undefined,
      height: (item.height as number) || undefined,
      fileSize: item.contentSize
        ? parseInt(String(item.contentSize), 10)
        : undefined,
      format: (item.encodingFormat as string) || undefined,
    }));

    this.policyDataService.clearKeyFailure("bing-image-search", apiKey);

    this.logger.log(
      `Bing Image Search: "${query}" → ${results.length} results`,
    );

    return {
      results,
      success: true,
      totalResults: results.length,
      provider: "bing",
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
