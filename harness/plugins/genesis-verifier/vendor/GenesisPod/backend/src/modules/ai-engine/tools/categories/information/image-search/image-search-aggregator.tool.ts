/**
 * Image Search Aggregator Tool
 * 图片搜索聚合工具 - 自动选择可用的搜索引擎
 *
 * 优先级：SerpAPI > Bing > Google CSE
 * 如果优先级最高的引擎失败或未配置，自动降级到下一个
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import { PolicyDataService } from "../policy/policy-data.service";
import { BingImageSearchTool } from "./bing-image-search.tool";
import { GoogleImageSearchTool } from "./google-image-search.tool";
import { SerpAPIImageSearchTool } from "./serpapi-image-search.tool";
import type { ImageSearchInput, ImageSearchOutput } from "./image-search.types";

@Injectable()
export class ImageSearchAggregatorTool extends BaseTool<
  ImageSearchInput,
  ImageSearchOutput
> {
  private readonly logger = new Logger(ImageSearchAggregatorTool.name);

  readonly id = "image-search";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "information";
  readonly name = "图片搜索";
  readonly description =
    "智能图片搜索，自动选择最佳可用搜索引擎（Bing/SerpAPI/Google）。用于为研究报告搜索配图。";
  readonly tags = ["image", "search", "aggregator"];
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
        description: "返回结果数量，默认 10",
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

  constructor(
    private readonly policyDataService: PolicyDataService,
    private readonly bingTool: BingImageSearchTool,
    private readonly googleTool: GoogleImageSearchTool,
    private readonly serpApiTool: SerpAPIImageSearchTool,
  ) {
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
    context: ToolContext,
  ): Promise<ImageSearchOutput> {
    // Try providers in priority order: SerpAPI → Bing → Google CSE
    const providerTools = [
      {
        id: "serpapi-image-search",
        tool: this.serpApiTool,
      },
      {
        id: "bing-image-search",
        tool: this.bingTool,
      },
      {
        id: "google-image-search",
        tool: this.googleTool,
      },
    ];

    const errors: string[] = [];

    for (const { id, tool } of providerTools) {
      // Check if provider is configured
      const hasKey = await this.policyDataService.getApiKey(id);
      if (!hasKey) {
        this.logger.debug(
          `[ImageSearch] Skipping ${id}: no API key configured`,
        );
        continue;
      }

      try {
        this.logger.log(`[ImageSearch] Trying provider: ${id}`);
        const result = await tool.execute(input, context);
        if (result.success && result.data) {
          this.logger.log(
            `[ImageSearch] Success with ${id}: ${result.data.totalResults} results`,
          );
          return result.data;
        }
        const errMsg = result.error?.message ?? "unknown error";
        errors.push(`${id}: ${errMsg}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[ImageSearch] Provider ${id} failed: ${msg}`);
        errors.push(`${id}: ${msg}`);
      }
    }

    // All providers failed
    this.logger.error(
      `[ImageSearch] All providers failed: ${errors.join("; ")}`,
    );
    throw new Error(
      `Image search failed — no provider available. Errors: ${errors.join("; ")}`,
    );
  }
}
