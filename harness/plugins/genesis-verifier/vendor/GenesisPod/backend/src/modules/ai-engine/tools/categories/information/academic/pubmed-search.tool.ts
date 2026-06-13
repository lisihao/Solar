/**
 * PubMed Search Tool
 * PubMed 生物医学文献搜索工具 - 搜索医学、生命科学等领域的同行评审论文
 *
 * API 文档: https://www.ncbi.nlm.nih.gov/books/NBK25500/
 * 无需 API Key（免费：3 req/s，有 Key：10 req/s）
 * Key 参数: &api_key=YOUR_KEY
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
  formatDateYmdSlash,
  resolveEffectiveTimeRange,
  resolveSearchTimeRangeSince,
  SEARCH_TIME_RANGE_VALUES,
  type SearchTimeRange,
} from "@/common/search/search-time-range";

// ============================================================================
// Types
// ============================================================================

/**
 * 输入参数
 */
export interface PubMedSearchInput {
  /** 搜索查询 */
  query: string;
  /** 最大结果数，默认 10，最大 100 */
  maxResults?: number;
  /** 排序方式：relevance=相关性，date=日期 */
  sortBy?: "relevance" | "date";
  /** 开始日期（YYYY/MM/DD 格式） */
  minDate?: string;
  /** 结束日期（YYYY/MM/DD 格式） */
  maxDate?: string;
  /** 搜索时间范围 */
  timeRange?: SearchTimeRange;
}

/**
 * PubMed 论文
 */
export interface PubMedArticle {
  /** PubMed ID */
  pmid: string;
  /** 标题 */
  title: string;
  /** 作者列表 */
  authors: string[];
  /** 期刊名称 */
  journal: string;
  /** 发布日期 */
  publishedDate: string;
  /** 摘要 */
  abstract: string;
  /** DOI */
  doi?: string;
  /** PubMed 页面链接 */
  pubmedUrl: string;
}

/**
 * 输出结果
 */
export interface PubMedSearchOutput {
  /** 论文列表 */
  articles: PubMedArticle[];
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

interface ESearchResult {
  esearchresult: {
    idlist: string[];
    count: string;
  };
}

interface ESummaryAuthor {
  name: string;
}

interface ESummaryArticle {
  uid: string;
  title: string;
  authors: ESummaryAuthor[];
  source: string;
  pubdate: string;
  abstract?: string;
  elocationid?: string;
}

interface ESummaryResult {
  result: Record<string, ESummaryArticle> & { uids: string[] };
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class PubMedSearchTool extends BaseTool<
  PubMedSearchInput,
  PubMedSearchOutput
> {
  private readonly logger = new Logger(PubMedSearchTool.name);
  private static lastRequestTime = 0;
  private static readonly MIN_REQUEST_INTERVAL = 500; // conservative for 3 req/s free tier
  private static activeRequests = 0;
  private static readonly MAX_CONCURRENT = 1; // serialize all PubMed requests
  private static readonly requestQueue: Array<() => void> = [];
  /** Global 429 cooldown — all requests wait until this timestamp */
  private static cooldownUntil = 0;

  readonly id = "pubmed";
  readonly sideEffect = "none" as const;
  readonly name = "PubMed Search";
  readonly description =
    "搜索 PubMed 生物医学文献库：医学、生命科学、生物技术等领域的同行评审论文。数据来源：NCBI PubMed，无需 API Key（可选提升限速）。";
  readonly category: ToolCategory = "information";
  readonly tags = ["academic", "medical", "biomedical", "pubmed", "research"];
  readonly defaultTimeout = 30000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "搜索查询，支持关键词、MeSH 术语等。示例：'cancer immunotherapy', 'COVID-19 vaccine'",
      },
      maxResults: {
        type: "number",
        description: "最大结果数量，默认 10，最大 100",
        default: 10,
      },
      sortBy: {
        type: "string",
        enum: ["relevance", "date"],
        description: "排序方式：relevance=相关性，date=发布日期",
        default: "relevance",
      },
      minDate: {
        type: "string",
        description: "最早发布日期（YYYY/MM/DD 格式），如 '2020/01/01'",
      },
      maxDate: {
        type: "string",
        description: "最晚发布日期（YYYY/MM/DD 格式），如 '2024/12/31'",
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
      articles: {
        type: "array",
        items: {
          type: "object",
          properties: {
            pmid: { type: "string" },
            title: { type: "string" },
            authors: { type: "array", items: { type: "string" } },
            journal: { type: "string" },
            publishedDate: { type: "string" },
            abstract: { type: "string" },
            doi: { type: "string" },
            pubmedUrl: { type: "string" },
          },
        },
      },
      totalResults: { type: "number" },
      query: { type: "string" },
      error: { type: "string" },
    },
  };

  constructor(private readonly policyDataService: PolicyDataService) {
    super();
  }

  protected async doExecute(
    input: PubMedSearchInput,
    context: ToolContext,
  ): Promise<PubMedSearchOutput> {
    const {
      query,
      maxResults = 10,
      sortBy = "relevance",
      minDate,
      maxDate,
    } = input;
    // 2026-05-13: LLM 漏传 timeRange 时退回 mission 默认 / 365d，而非 "all"
    const timeRange = resolveEffectiveTimeRange(
      input.timeRange,
      context.metadata,
    );

    this.logger.log(
      `[doExecute] Searching PubMed: query="${query}", maxResults=${maxResults}, sortBy=${sortBy}`,
    );

    // 获取可选 API key (hoisted for catch block access)
    const apiKey = await this.policyDataService.getApiKey("pubmed");

    try {
      // Step 1: esearch — 获取匹配查询的 PMIDs
      const since = resolveSearchTimeRangeSince(timeRange);
      const effectiveMinDate =
        minDate ?? (since ? formatDateYmdSlash(since) : undefined);
      const esearchBase =
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
      const esearchParams: Record<string, string | number> = {
        db: "pubmed",
        term: query,
        retmax: Math.min(maxResults, 100),
        retmode: "json",
        sort: sortBy === "date" ? "pub+date" : "relevance",
      };
      if (effectiveMinDate) esearchParams["mindate"] = effectiveMinDate;
      if (maxDate) esearchParams["maxdate"] = maxDate;
      if (effectiveMinDate || maxDate) esearchParams["datetype"] = "pdat";
      if (apiKey) esearchParams["api_key"] = apiKey;

      this.logger.debug(
        `[doExecute] esearch params: ${JSON.stringify(esearchParams)}`,
      );

      const maxRetries = 3;
      let esearchData: ESearchResult | undefined;
      let lastEsearchError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        await this.acquireSlot();
        try {
          esearchData = await this.policyDataService.httpGet<ESearchResult>(
            esearchBase,
            esearchParams,
          );
          this.releaseSlot();
          break;
        } catch (err) {
          this.releaseSlot();
          lastEsearchError =
            err instanceof Error ? err : new Error(String(err));
          const is429 = lastEsearchError.message.includes("429");
          if (is429 && attempt < maxRetries) {
            const backoff = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
            PubMedSearchTool.cooldownUntil = Date.now() + backoff;
            this.logger.warn(
              `[doExecute] PubMed 429 rate limited (esearch), retry ${attempt + 1}/${maxRetries} after ${backoff}ms (global cooldown set)`,
            );
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }
          if (is429) {
            PubMedSearchTool.cooldownUntil = Date.now() + 30_000;
            this.logger.warn(
              `[doExecute] PubMed 429 exhausted all retries (esearch), setting 30s global cooldown`,
            );
          }
          throw err;
        }
      }

      if (!esearchData) {
        return {
          success: false,
          articles: [],
          totalResults: 0,
          query,
          error: `PubMed 搜索失败 (esearch): ${lastEsearchError?.message || "重试 3 次后仍未拿到响应"}`,
        };
      }

      const totalResults = parseInt(esearchData.esearchresult.count || "0", 10);
      const pmids = esearchData.esearchresult.idlist || [];

      this.logger.log(
        `[doExecute] esearch returned ${pmids.length} PMIDs (total: ${totalResults})`,
      );

      if (pmids.length === 0) {
        return {
          success: true,
          articles: [],
          totalResults,
          query,
        };
      }

      // Step 2: esummary — 获取 PMIDs 对应的文章详情
      const esummaryBase =
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";
      const esummaryParams: Record<string, string | number> = {
        db: "pubmed",
        id: pmids.join(","),
        retmode: "json",
      };
      if (apiKey) esummaryParams["api_key"] = apiKey;

      this.logger.debug(`[doExecute] esummary params: id=${pmids.join(",")}`);

      let esummaryData: ESummaryResult | undefined;
      let lastEsummaryError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        await this.acquireSlot();
        try {
          esummaryData = await this.policyDataService.httpGet<ESummaryResult>(
            esummaryBase,
            esummaryParams,
          );
          this.releaseSlot();
          break;
        } catch (err) {
          this.releaseSlot();
          lastEsummaryError =
            err instanceof Error ? err : new Error(String(err));
          const is429 = lastEsummaryError.message.includes("429");
          if (is429 && attempt < maxRetries) {
            const backoff = Math.pow(2, attempt + 1) * 1000;
            PubMedSearchTool.cooldownUntil = Date.now() + backoff;
            this.logger.warn(
              `[doExecute] PubMed 429 rate limited (esummary), retry ${attempt + 1}/${maxRetries} after ${backoff}ms (global cooldown set)`,
            );
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }
          if (is429) {
            PubMedSearchTool.cooldownUntil = Date.now() + 30_000;
            this.logger.warn(
              `[doExecute] PubMed 429 exhausted all retries (esummary), setting 30s global cooldown`,
            );
          }
          throw err;
        }
      }

      if (!esummaryData) {
        return {
          success: false,
          articles: [],
          totalResults,
          query,
          error: `PubMed 获取文章详情失败 (esummary, ${pmids.length} PMIDs): ${lastEsummaryError?.message || "重试 3 次后仍未拿到响应"}`,
        };
      }

      // 解析 esummary 结果（跳过 uids 键）
      const articles: PubMedArticle[] = pmids
        .filter((pmid) => pmid in esummaryData.result)
        .map((pmid) => this.parseArticle(esummaryData.result[pmid]));

      this.logger.log(
        `[doExecute] Parsed ${articles.length} articles from PubMed`,
      );

      // Mark key as healthy on success
      if (apiKey) {
        this.policyDataService.clearKeyFailure("pubmed", apiKey);
      }

      return {
        success: true,
        articles,
        totalResults,
        query,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`[doExecute] PubMed API error: ${error}`);

      // Track key failure for multi-key rotation
      if (apiKey) {
        const statusMatch = errorMessage.match(/\b(4\d{2}|5\d{2})\b/);
        const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 500;
        this.policyDataService.markKeyFailed("pubmed", apiKey, statusCode);
      }

      return {
        success: false,
        articles: [],
        totalResults: 0,
        query,
        error: `PubMed 搜索失败: ${errorMessage}`,
      };
    }
  }

  /**
   * 解析单篇文章摘要条目
   */
  private parseArticle(article: ESummaryArticle): PubMedArticle {
    const pmid = article.uid;
    const title = (article.title || "").replace(/\s+/g, " ").trim();
    const authors = (article.authors || []).map((a) => a.name).filter(Boolean);
    const journal = article.source || "";
    const publishedDate = article.pubdate || "";
    const abstract = (article.abstract || "").replace(/\s+/g, " ").trim();

    // 从 elocationid 字段提取 DOI（格式：'doi: 10.xxxx/yyyy'）
    let doi: string | undefined;
    if (article.elocationid) {
      const doiMatch = article.elocationid.match(/doi:\s*(\S+)/i);
      if (doiMatch) {
        doi = doiMatch[1];
      }
    }

    const pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

    return {
      pmid,
      title,
      authors,
      journal,
      publishedDate,
      abstract,
      ...(doi ? { doi } : {}),
      pubmedUrl,
    };
  }

  /**
   * 获取并发槽位，等待全局冷却 + 最小请求间隔
   */
  private async acquireSlot(): Promise<void> {
    // 等待并发槽位
    while (PubMedSearchTool.activeRequests >= PubMedSearchTool.MAX_CONCURRENT) {
      await new Promise<void>((resolve) => {
        PubMedSearchTool.requestQueue.push(resolve);
      });
    }
    PubMedSearchTool.activeRequests++;

    // 等待全局 429 冷却结束
    const cooldownRemaining = PubMedSearchTool.cooldownUntil - Date.now();
    if (cooldownRemaining > 0) {
      this.logger.debug(
        `[acquireSlot] Waiting ${cooldownRemaining}ms for global 429 cooldown`,
      );
      await new Promise((resolve) => setTimeout(resolve, cooldownRemaining));
    }

    // 强制最小请求间隔
    const now = Date.now();
    const timeSinceLastRequest = now - PubMedSearchTool.lastRequestTime;
    if (timeSinceLastRequest < PubMedSearchTool.MIN_REQUEST_INTERVAL) {
      const waitTime =
        PubMedSearchTool.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
      this.logger.debug(`[acquireSlot] Waiting ${waitTime}ms for rate limit`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    PubMedSearchTool.lastRequestTime = Date.now();
  }

  /**
   * 释放并发槽位，并唤醒队列中下一个等待者
   */
  private releaseSlot(): void {
    PubMedSearchTool.activeRequests--;
    const next = PubMedSearchTool.requestQueue.shift();
    if (next) next();
  }

  validateInput(input: PubMedSearchInput): boolean {
    return !!input.query && input.query.trim().length > 0;
  }
}
