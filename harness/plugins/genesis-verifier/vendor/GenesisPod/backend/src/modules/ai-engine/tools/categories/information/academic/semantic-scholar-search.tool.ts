/**
 * Semantic Scholar Search Tool
 * Semantic Scholar 学术搜索工具 - 搜索跨领域学术论文，含引用计数、摘要等元数据
 *
 * API 文档: https://api.semanticscholar.org/api-docs/
 * 免费 tier: 无 API Key 时 1 req/s；有 API Key 时 100 req/s
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import { PolicyDataService } from "../policy/policy-data.service";
import {
  ToolKeyResolverService,
  NoToolKeyError,
} from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";
import { RequestContext } from "@/common/context/request-context";
import {
  resolveEffectiveTimeRange,
  resolveSearchTimeRangeYearWindow,
  SEARCH_TIME_RANGE_VALUES,
  type SearchTimeRange,
} from "@/common/search/search-time-range";

// ============================================================================
// Types
// ============================================================================

/**
 * 输入参数
 */
export interface SemanticScholarSearchInput {
  /** 搜索查询 */
  query: string;
  /** 最大结果数，默认 10，最大 100 */
  maxResults?: number;
  /** 返回字段，逗号分隔 */
  fields?: string;
  /** 年份范围过滤，如 "2023-2025" 或 "2020" */
  year?: string;
  /** 搜索时间范围 */
  timeRange?: SearchTimeRange;
}

/**
 * 单篇论文
 */
export interface SemanticScholarPaper {
  /** Semantic Scholar 论文 ID */
  paperId: string;
  /** 标题 */
  title: string;
  /** 作者列表 */
  authors: string[];
  /** 摘要 */
  abstract: string;
  /** 发表年份 */
  year: number;
  /** 引用数量 */
  citationCount: number;
  /** Semantic Scholar 页面链接 */
  url: string;
  /** ArXiv ID（如有） */
  arxivId?: string;
  /** DOI（如有） */
  doi?: string;
}

/**
 * 输出结果
 */
export interface SemanticScholarSearchOutput {
  /** 论文列表 */
  papers: SemanticScholarPaper[];
  /** 结果总数 */
  totalResults: number;
  /** 搜索查询 */
  query: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

interface SemanticScholarAuthor {
  authorId: string;
  name: string;
}

interface SemanticScholarExternalIds {
  ArXiv?: string;
  DOI?: string;
  [key: string]: string | undefined;
}

interface SemanticScholarApiPaper {
  paperId: string;
  title: string;
  authors?: SemanticScholarAuthor[];
  abstract?: string;
  year?: number;
  citationCount?: number;
  url?: string;
  externalIds?: SemanticScholarExternalIds;
}

interface SemanticScholarApiResponse {
  total: number;
  data: SemanticScholarApiPaper[];
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class SemanticScholarSearchTool extends BaseTool<
  SemanticScholarSearchInput,
  SemanticScholarSearchOutput
> {
  private readonly logger = new Logger(SemanticScholarSearchTool.name);

  /** 最大并发请求数（Semantic Scholar 比 ArXiv 宽松） */
  private static readonly MAX_CONCURRENT = 1;
  /** 无 API Key 时的最小请求间隔 (ms) */
  private static readonly MIN_REQUEST_INTERVAL_NO_KEY = 1000; // 1 req/s
  /** 有 API Key 时的最小请求间隔 (ms) */
  private static readonly MIN_REQUEST_INTERVAL_WITH_KEY = 100; // ~10 req/s conservative
  /** 全局 429 冷却截止时间戳 */
  private static cooldownUntil = 0;
  /** 当前活跃请求数 */
  private static activeRequests = 0;
  /** 上次请求时间戳 */
  private static lastRequestTime = 0;
  /** 等待槽位的回调队列 */
  private static readonly requestQueue: Array<() => void> = [];

  readonly id = "semantic-scholar";
  readonly sideEffect = "none" as const;
  readonly name = "Semantic Scholar Search";
  readonly description =
    "搜索 Semantic Scholar 学术论文数据库：覆盖计算机科学、生物医学、物理、经济等多学科，包含引用数量、摘要、DOI 等元数据。数据来源：semanticscholar.org。适合文献综述、引用影响力分析、跨学科研究。";
  readonly category: ToolCategory = "information";
  readonly tags = [
    "academic",
    "research",
    "paper",
    "semantic-scholar",
    "science",
  ];
  readonly defaultTimeout = 30000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "搜索查询关键词。示例：'transformer architecture', 'CRISPR gene editing', 'climate change mitigation'",
      },
      maxResults: {
        type: "number",
        description: "最大结果数量，默认 10，最大 100",
        default: 10,
      },
      fields: {
        type: "string",
        description:
          "返回字段，逗号分隔。默认：title,authors,abstract,year,citationCount,url,externalIds",
        default: "title,authors,abstract,year,citationCount,url,externalIds",
      },
      year: {
        type: "string",
        description:
          "年份范围过滤。格式：单年 '2024'，范围 '2020-2024'，起始 '2020-'，截止 '-2024'",
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
      papers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            paperId: { type: "string" },
            title: { type: "string" },
            authors: { type: "array", items: { type: "string" } },
            abstract: { type: "string" },
            year: { type: "number" },
            citationCount: { type: "number" },
            url: { type: "string" },
            arxivId: { type: "string" },
            doi: { type: "string" },
          },
        },
      },
      totalResults: { type: "number" },
      query: { type: "string" },
      error: { type: "string" },
    },
  };

  constructor(
    private readonly policyDataService: PolicyDataService,
    private readonly toolKeyResolver: ToolKeyResolverService,
  ) {
    super();
  }

  /**
   * Resolve API key for Semantic Scholar.
   *
   * 2026-05-28 BYOK: userId present → ToolKeyResolver (user key → grant →
   * strict/fallback). No userId → admin path via PolicyDataService.
   */
  private async resolveApiKey(): Promise<string | null> {
    const userId = RequestContext.getUserId();
    if (userId) {
      try {
        const resolved = await this.toolKeyResolver.resolveToolKey(
          "semantic-scholar",
          userId,
        );
        return resolved?.value ?? null;
      } catch (error) {
        if (error instanceof NoToolKeyError) return null;
        throw error;
      }
    }
    return this.policyDataService.getApiKey("semantic-scholar");
  }

  protected async doExecute(
    input: SemanticScholarSearchInput,
    context: ToolContext,
  ): Promise<SemanticScholarSearchOutput> {
    const {
      query,
      maxResults = 10,
      fields = "title,authors,abstract,year,citationCount,url,externalIds",
      year,
    } = input;
    const timeRange = resolveEffectiveTimeRange(
      input.timeRange,
      context.metadata,
    );

    this.logger.log(
      `[doExecute] Searching Semantic Scholar: query="${query}", maxResults=${maxResults}, year=${year ?? "any"}`,
    );

    // 获取 API Key（可选，hoisted for catch block access）
    const apiKey = await this.resolveApiKey();

    try {
      // 构建请求参数
      const baseUrl = "https://api.semanticscholar.org/graph/v1/paper/search";
      const params: Record<string, string | number> = {
        query,
        limit: Math.min(maxResults, 100),
        fields,
      };
      const effectiveYear = year ?? resolveSearchTimeRangeYearWindow(timeRange);
      if (effectiveYear) {
        params["year"] = effectiveYear;
      }

      // 构建请求头
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["x-api-key"] = apiKey;
        this.logger.debug("[doExecute] Using Semantic Scholar API key");
      }

      this.logger.debug(`[doExecute] API params: ${JSON.stringify(params)}`);

      // 带退避重试的请求，最多重试 3 次
      const maxRetries = 3;
      let responseData: SemanticScholarApiResponse | undefined;
      let lastError: Error | undefined;

      // ★ 2026-05-13: fast-fail——如果当前进程已知 SS 处于长冷却（>15s），
      //   立刻 throw "in 429 cooldown"，让 orchestrator 在毫秒级路由到
      //   arxiv / openalex，不要让 caller 阻塞等 60s 冷却结束。
      //   acquireSlot 自己会 sleep 到冷却结束，但那对上层来说是"看似在跑
      //   实际啥也没做"的卡 60s——失败更糟，因为重试链整体 ~3 分钟才返回。
      const cooldownRemainingMs =
        SemanticScholarSearchTool.cooldownUntil - Date.now();
      if (cooldownRemainingMs > 15_000) {
        const errMsg = `Semantic Scholar in 429 cooldown for ${Math.ceil(cooldownRemainingMs / 1000)}s; skip (router fallback to arxiv/openalex)`;
        this.logger.warn(`[doExecute] ${errMsg}`);
        throw new Error(errMsg);
      }

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        await this.acquireSlot(!!apiKey);
        try {
          responseData =
            await this.policyDataService.httpGet<SemanticScholarApiResponse>(
              baseUrl,
              params,
              headers,
            );
          this.releaseSlot();
          break; // 成功
        } catch (err) {
          this.releaseSlot();
          lastError = err instanceof Error ? err : new Error(String(err));
          const is429 = lastError.message.includes("429");
          if (is429 && attempt < maxRetries) {
            const backoff =
              Math.pow(2, attempt + 1) * 1000 + Math.random() * 3000;
            // 设置全局冷却：所有排队的请求也必须等到冷却结束
            SemanticScholarSearchTool.cooldownUntil = Date.now() + backoff;
            this.logger.warn(
              `[doExecute] Semantic Scholar 429 rate limited, retry ${attempt + 1}/${maxRetries} after ${backoff}ms (global cooldown set)`,
            );
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }
          if (is429) {
            // 3 次 retry 全部失败，设置 60s 长冷却让后续请求有恢复窗口
            SemanticScholarSearchTool.cooldownUntil = Date.now() + 60_000;
            this.logger.warn(
              `[doExecute] Semantic Scholar 429 exhausted all retries, setting 60s global cooldown for subsequent requests`,
            );
          }
          throw err;
        }
      }

      if (!responseData) {
        return {
          success: false,
          papers: [],
          totalResults: 0,
          query,
          error: `Semantic Scholar 搜索失败: ${lastError?.message || "重试 3 次后仍未拿到响应"}`,
        };
      }

      // 解析结果
      const papers: SemanticScholarPaper[] = (responseData.data ?? []).map(
        (item) => this.parsePaper(item),
      );

      this.logger.log(
        `[doExecute] Found ${papers.length} papers (total: ${responseData.total})`,
      );

      // Mark key as healthy on success
      if (apiKey) {
        this.policyDataService.clearKeyFailure("semantic-scholar", apiKey);
      }

      return {
        success: true,
        papers,
        totalResults: responseData.total ?? 0,
        query,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      // ★ 2026-05-05 P2 修复：cooldown 期内的 fail 是"已熔断"状态，不是新故障，
      //   降级为 WARN，避免与真正的 API 错误混在 ERROR 流里。
      const isCooldownFail = /in 429 cooldown for/i.test(errorMessage);
      if (isCooldownFail) {
        this.logger.warn(
          `[doExecute] Semantic Scholar in cooldown (skipped): ${errorMessage}`,
        );
      } else {
        this.logger.error(`[doExecute] Semantic Scholar API error: ${error}`);
      }

      // Track key failure for multi-key rotation
      if (apiKey) {
        const statusMatch = errorMessage.match(/\b(4\d{2}|5\d{2})\b/);
        const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 500;
        this.policyDataService.markKeyFailed(
          "semantic-scholar",
          apiKey,
          statusCode,
        );
      }

      return {
        success: false,
        papers: [],
        totalResults: 0,
        query,
        error: `Semantic Scholar 搜索失败: ${errorMessage}`,
      };
    }
  }

  /**
   * 解析单篇论文 API 响应
   */
  private parsePaper(item: SemanticScholarApiPaper): SemanticScholarPaper {
    return {
      paperId: item.paperId ?? "",
      title: item.title ?? "",
      authors: (item.authors ?? []).map((a) => a.name).filter(Boolean),
      abstract: item.abstract ?? "",
      year: item.year ?? 0,
      citationCount: item.citationCount ?? 0,
      url:
        item.url ??
        `https://www.semanticscholar.org/paper/${item.paperId ?? ""}`,
      arxivId: item.externalIds?.ArXiv,
      doi: item.externalIds?.DOI,
    };
  }

  /**
   * 获取并发槽位，等待全局冷却 + 最小请求间隔
   */
  private async acquireSlot(hasApiKey: boolean): Promise<void> {
    // 等待并发槽位
    while (
      SemanticScholarSearchTool.activeRequests >=
      SemanticScholarSearchTool.MAX_CONCURRENT
    ) {
      await new Promise<void>((resolve) => {
        SemanticScholarSearchTool.requestQueue.push(resolve);
      });
    }
    SemanticScholarSearchTool.activeRequests++;

    // 等待全局 429 冷却结束
    const cooldownRemaining =
      SemanticScholarSearchTool.cooldownUntil - Date.now();
    if (cooldownRemaining > 0) {
      this.logger.debug(
        `[acquireSlot] Waiting ${cooldownRemaining}ms for global 429 cooldown`,
      );
      await new Promise((resolve) => setTimeout(resolve, cooldownRemaining));
    }

    // 强制最小请求间隔（有 API Key 可更频繁）
    const minInterval = hasApiKey
      ? SemanticScholarSearchTool.MIN_REQUEST_INTERVAL_WITH_KEY
      : SemanticScholarSearchTool.MIN_REQUEST_INTERVAL_NO_KEY;

    const now = Date.now();
    const timeSinceLastRequest =
      now - SemanticScholarSearchTool.lastRequestTime;
    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      this.logger.debug(`[acquireSlot] Waiting ${waitTime}ms for rate limit`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    SemanticScholarSearchTool.lastRequestTime = Date.now();
  }

  /**
   * 释放并发槽位，并唤醒队列中下一个等待者
   */
  private releaseSlot(): void {
    SemanticScholarSearchTool.activeRequests--;
    const next = SemanticScholarSearchTool.requestQueue.shift();
    if (next) next();
  }

  validateInput(input: SemanticScholarSearchInput): boolean {
    return !!input.query && input.query.trim().length > 0;
  }
}
