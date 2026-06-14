/**
 * White House News Tool
 * 白宫新闻搜索工具 - 获取白宫官方声明、新闻发布、行政命令
 *
 * 数据来源: https://www.whitehouse.gov/news/
 * 无需 API Key（使用网页抓取）
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import { SearchService } from "../../../../content/web-search/web-search.service";
import { PolicyDataService } from "./policy-data.service";

// ============================================================================
// Types
// ============================================================================

/**
 * 内容类型
 */
export type WhiteHouseContentType =
  | "statements" // 声明和备忘录
  | "press-briefings" // 新闻简报
  | "executive-orders" // 行政命令
  | "presidential-actions" // 总统行动
  | "all"; // 全部

/**
 * 输入参数
 */
export interface WhiteHouseNewsInput {
  /** 搜索关键词 */
  query?: string;
  /** 内容类型 */
  contentType?: WhiteHouseContentType;
  /** 最大结果数 */
  limit?: number;
}

/**
 * 白宫新闻条目
 */
export interface WhiteHouseNewsItem {
  /** 标题 */
  title: string;
  /** 摘要/描述 */
  summary: string;
  /** 发布日期 */
  date: string;
  /** 原始链接 */
  url: string;
  /** 内容类型 */
  type: string;
}

/**
 * 输出结果
 */
export interface WhiteHouseNewsOutput {
  /** 是否成功 */
  success: boolean;
  /** 新闻列表 */
  items: WhiteHouseNewsItem[];
  /** 结果总数 */
  totalCount: number;
  /** 错误信息 */
  error?: string;
  /** 数据来源说明 */
  source?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class WhiteHouseNewsTool extends BaseTool<
  WhiteHouseNewsInput,
  WhiteHouseNewsOutput
> {
  private readonly logger = new Logger(WhiteHouseNewsTool.name);

  readonly id = "whitehouse-news";
  readonly sideEffect = "none" as const;
  readonly name = "White House News";
  readonly description =
    "获取美国白宫官方新闻、声明、新闻简报、行政命令。数据来源：whitehouse.gov，无需 API Key。";
  readonly category: ToolCategory = "information";
  readonly tags = ["policy", "executive", "whitehouse", "president"];
  readonly defaultTimeout = 60000; // 网页抓取可能较慢

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词",
      },
      contentType: {
        type: "string",
        enum: [
          "statements",
          "press-briefings",
          "executive-orders",
          "presidential-actions",
          "all",
        ],
        description:
          "内容类型：statements=声明，press-briefings=新闻简报，executive-orders=行政命令，presidential-actions=总统行动，all=全部",
        default: "all",
      },
      limit: {
        type: "number",
        description: "最大结果数，默认 10",
        default: 10,
      },
    },
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
            summary: { type: "string" },
            date: { type: "string" },
            url: { type: "string" },
            type: { type: "string" },
          },
        },
      },
      totalCount: { type: "number" },
      error: { type: "string" },
      source: { type: "string" },
    },
  };

  constructor(
    private readonly searchService: SearchService,
    private readonly policyDataService: PolicyDataService,
  ) {
    super();
  }

  protected async doExecute(
    input: WhiteHouseNewsInput,
    _context: ToolContext,
  ): Promise<WhiteHouseNewsOutput> {
    const { query, contentType = "all", limit = 10 } = input;

    this.logger.log(
      `[doExecute] Fetching White House news: query="${query}", type=${contentType}`,
    );

    try {
      // 构建白宫新闻 URL
      const baseUrl = this.getWhiteHouseUrl(contentType);
      const searchUrl = query
        ? `https://www.whitehouse.gov/?s=${encodeURIComponent(query)}`
        : baseUrl;

      // 使用 SearchService 抓取页面内容
      const result = await this.searchService.fetchUrlContent(searchUrl);

      if (!result.success || !result.content) {
        // 尝试备用方法：使用 Federal Register 搜索总统文件
        if (
          contentType === "executive-orders" ||
          contentType === "presidential-actions"
        ) {
          return await this.fallbackToFederalRegister(query, limit);
        }

        return {
          success: false,
          items: [],
          totalCount: 0,
          error: `无法获取白宫新闻页面内容 (url=${searchUrl}): ${result.error || "fetchUrlContent 返回空内容"}`,
        };
      }

      // 解析页面内容提取新闻条目
      const items = this.parseWhiteHouseContent(
        result.content,
        contentType,
        limit,
      );

      this.logger.log(`[doExecute] Found ${items.length} news items`);

      return {
        success: true,
        items,
        totalCount: items.length,
        source: "whitehouse.gov",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`[doExecute] White House news fetch error: ${error}`);

      // 尝试备用数据源
      if (
        contentType === "executive-orders" ||
        contentType === "presidential-actions"
      ) {
        return await this.fallbackToFederalRegister(query, limit);
      }

      return {
        success: false,
        items: [],
        totalCount: 0,
        error: `白宫新闻获取失败: ${errorMessage}`,
      };
    }
  }

  /**
   * 获取白宫新闻页面 URL
   */
  private getWhiteHouseUrl(contentType: WhiteHouseContentType): string {
    const baseUrl = "https://www.whitehouse.gov";
    const urlMap: Record<WhiteHouseContentType, string> = {
      statements: `${baseUrl}/briefing-room/statements-releases/`,
      "press-briefings": `${baseUrl}/briefing-room/press-briefings/`,
      "executive-orders": `${baseUrl}/briefing-room/presidential-actions/`,
      "presidential-actions": `${baseUrl}/briefing-room/presidential-actions/`,
      all: `${baseUrl}/news/`,
    };
    return urlMap[contentType] || urlMap.all;
  }

  /**
   * 解析白宫页面内容
   * 从 Markdown/HTML 内容中提取新闻条目
   */
  private parseWhiteHouseContent(
    content: string,
    contentType: WhiteHouseContentType,
    limit: number,
  ): WhiteHouseNewsItem[] {
    const items: WhiteHouseNewsItem[] = [];

    // 尝试从内容中提取标题和链接
    // 白宫网站的结构可能变化，这里使用通用模式匹配

    // 匹配 Markdown 链接格式 [Title](URL)
    const linkPattern =
      /\[([^\]]+)\]\((https:\/\/www\.whitehouse\.gov[^)]+)\)/g;
    let match;

    while (
      (match = linkPattern.exec(content)) !== null &&
      items.length < limit
    ) {
      const [, title, url] = match;

      // 过滤掉导航链接等
      if (
        title &&
        url &&
        !title.toLowerCase().includes("menu") &&
        !title.toLowerCase().includes("skip") &&
        !url.includes("#") &&
        (url.includes("/briefing-room/") || url.includes("/news/"))
      ) {
        // 尝试从 URL 推断日期
        const dateMatch = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
        const date = dateMatch
          ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
          : "";

        // 推断类型
        let type = "news";
        if (url.includes("statements-releases")) {
          type = "Statement";
        } else if (url.includes("press-briefings")) {
          type = "Press Briefing";
        } else if (url.includes("presidential-actions")) {
          type = "Presidential Action";
        }

        items.push({
          title: title.trim(),
          summary: "", // 摘要需要进一步抓取详情页
          date,
          url,
          type,
        });
      }
    }

    // 如果没有找到链接，尝试从纯文本中提取
    if (items.length === 0) {
      // 按段落分割，查找可能的标题
      const paragraphs = content.split(/\n\n+/);
      for (const para of paragraphs.slice(0, limit)) {
        const trimmed = para.trim();
        if (
          trimmed.length > 20 &&
          trimmed.length < 200 &&
          !trimmed.startsWith("http")
        ) {
          items.push({
            title: trimmed,
            summary: "",
            date: this.policyDataService.formatDate(new Date()),
            url: this.getWhiteHouseUrl(contentType),
            type: contentType === "all" ? "News" : contentType,
          });
        }
        if (items.length >= limit) break;
      }
    }

    return items;
  }

  /**
   * 备用方法：使用 Federal Register API 获取总统文件
   */
  private async fallbackToFederalRegister(
    query: string | undefined,
    limit: number,
  ): Promise<WhiteHouseNewsOutput> {
    this.logger.log(
      `[fallbackToFederalRegister] Using Federal Register as fallback`,
    );

    try {
      const baseUrl = "https://www.federalregister.gov/api/v1/documents.json";
      // ★ 2026-05-25 修：fields 必须是数组参数（fields[]=a&fields[]=b），逗号 join
      //   会被 FR API 拒 HTTP 400。见 federal-register.tool.ts 同步修复。
      const params: Record<string, string | number | string[]> = {
        per_page: limit,
        order: "newest",
        "conditions[type][]": "PRESDOC",
        "fields[]": [
          "document_number",
          "title",
          "abstract",
          "publication_date",
          "html_url",
          "subtype",
          "executive_order_number",
        ],
      };

      if (query) {
        params["conditions[term]"] = query;
      }

      interface FRDocument {
        title: string;
        abstract?: string;
        publication_date: string;
        html_url: string;
        subtype?: string;
        executive_order_number?: string;
      }

      interface FRResponse {
        count: number;
        results: FRDocument[];
      }

      const response = await this.policyDataService.httpGet<FRResponse>(
        baseUrl,
        params,
      );

      const items: WhiteHouseNewsItem[] = (response.results || []).map(
        (doc) => ({
          title: doc.title,
          summary: doc.abstract || "",
          date: doc.publication_date,
          url: doc.html_url,
          type: doc.subtype || "Presidential Document",
        }),
      );

      return {
        success: true,
        items,
        totalCount: response.count,
        source: "Federal Register (Presidential Documents)",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        items: [],
        totalCount: 0,
        error: `备用数据源也失败: ${errorMessage}`,
      };
    }
  }

  validateInput(_input: WhiteHouseNewsInput): boolean {
    // 不需要必填参数，可以获取最新新闻
    return true;
  }
}
