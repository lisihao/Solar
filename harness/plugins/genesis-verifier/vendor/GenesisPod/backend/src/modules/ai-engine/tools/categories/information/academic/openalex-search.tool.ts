/**
 * OpenAlex Search Tool
 * OpenAlex 学术搜索工具 - 搜索跨领域学术论文，含引用计数、开放获取状态等元数据
 *
 * API 文档: https://developers.openalex.org/
 *
 * ★ 认证双通道（2026-05-14 关键 bug 修复）：
 *   admin 在 SecretKey "openalex-search" 配的值可以是两种之一，代码自动分通道：
 *
 *   1) email (含 @)   → params.mailto=...
 *      旧 polite pool，仅享受请求优先级，
 *      **不计入 OpenAlex 用户 dashboard 的 $1/day budget**
 *
 *   2) API key (无 @) → params.api_key=...
 *      新认证模式，享受 $1/day free budget + 在 user account dashboard 可观测
 *      获取方式：openalex.org 注册后 dashboard 拿
 *
 *   之前代码无论 admin 配什么都塞进 mailto → admin 配了 API key 也被当 email 用 →
 *   用户 OpenAlex 后台 budget 永远 100% remaining（看着没被调用），polite pool
 *   仍能跑但失去 budget tracking + freemium 优惠。
 *
 * 限速：
 *   - 无认证   : 10 req/s
 *   - mailto   : polite pool，10 req/s 突发上限
 *   - api_key  : $1/day budget + polite pool 速率
 *
 * 三层限速防护：
 *   L1 (本 tool, static cooldown):  429 → 2/4/8s 指数退避，3 次后 30s 全局停摆
 *   L2 (GlobalSourceThrottleService): cooldown + token bucket (8 req/s) + concurrency (2)
 *   L3 (PolicyDataService):           markKeyFailed 用于多 key 轮换
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
  formatDateYmd,
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
export interface OpenAlexSearchInput {
  /** 搜索查询 */
  query: string;
  /** 最大结果数，默认 10，最大 200 */
  maxResults?: number;
  /** 年份范围过滤，如 "2023-2025" 或 "2024" */
  year?: string;
  /** 按引用数排序（默认按相关性） */
  sortByCitations?: boolean;
  /** 搜索时间范围 */
  timeRange?: SearchTimeRange;
}

/**
 * OpenAlex 论文
 */
export interface OpenAlexPaper {
  /** OpenAlex Work ID */
  id: string;
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
  /** DOI */
  doi?: string;
  /** OpenAlex 页面链接 */
  url: string;
  /** 开放获取 URL（如有） */
  openAccessUrl?: string;
  /** 来源（期刊/会议名称） */
  source?: string;
  /** 论文类型（article, review, etc.） */
  type?: string;
}

/**
 * 输出结果
 */
export interface OpenAlexSearchOutput {
  /** 论文列表 */
  papers: OpenAlexPaper[];
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

interface OpenAlexAuthorship {
  author: {
    id: string;
    display_name: string;
  };
}

interface OpenAlexApiWork {
  id: string;
  title?: string;
  authorships?: OpenAlexAuthorship[];
  abstract_inverted_index?: Record<string, number[]>;
  publication_year?: number;
  cited_by_count?: number;
  doi?: string;
  primary_location?: {
    source?: {
      display_name?: string;
    };
    landing_page_url?: string;
  };
  open_access?: {
    oa_url?: string;
    is_oa?: boolean;
  };
  type?: string;
}

interface OpenAlexApiResponse {
  results: OpenAlexApiWork[];
  meta: {
    count: number;
    per_page: number;
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class OpenAlexSearchTool extends BaseTool<
  OpenAlexSearchInput,
  OpenAlexSearchOutput
> {
  private readonly logger = new Logger(OpenAlexSearchTool.name);

  // ★ 限速分工：
  //   并发 + req/s + cooldown 协调由 L3 业务层的 GlobalSourceThrottleService 负责。
  //   本 tool 仅保留 process-wide static cooldown，覆盖不经过 throttle 的直调路径
  //   （L3 应用直接 ToolRegistry.execute 不会过 adapter throttle）。
  /** 全局 429 冷却截止时间戳（毫秒）；同进程内所有调用方共享 */
  private static cooldownUntil = 0;

  readonly id = "openalex-search";
  readonly sideEffect = "none" as const;
  readonly name = "OpenAlex Search";
  readonly description =
    "搜索 OpenAlex 学术论文数据库：覆盖 2.5 亿+学术作品，跨学科元数据，引用分析，开放获取状态。数据来源：openalex.org，免费无需 API Key。适合大规模文献调研、引用网络分析、开放获取论文检索。";
  readonly category: ToolCategory = "information";
  readonly tags = ["academic", "research", "paper", "openalex", "science"];
  readonly defaultTimeout = 30000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "搜索查询关键词。示例：'large language models', 'climate change', 'CRISPR gene editing'",
      },
      maxResults: {
        type: "number",
        description: "最大结果数量，默认 10，最大 200",
        default: 10,
      },
      year: {
        type: "string",
        description: "年份范围过滤。格式：单年 '2024'，范围 '2020-2024'",
      },
      sortByCitations: {
        type: "boolean",
        description: "是否按引用数降序排列，默认按相关性",
        default: false,
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
            id: { type: "string" },
            title: { type: "string" },
            authors: { type: "array", items: { type: "string" } },
            abstract: { type: "string" },
            year: { type: "number" },
            citationCount: { type: "number" },
            doi: { type: "string" },
            url: { type: "string" },
            openAccessUrl: { type: "string" },
            source: { type: "string" },
            type: { type: "string" },
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
    input: OpenAlexSearchInput,
    context: ToolContext,
  ): Promise<OpenAlexSearchOutput> {
    const { query, maxResults = 10, year, sortByCitations = false } = input;
    // 2026-05-13: LLM 漏传 timeRange 时退回 mission 默认 / 365d，而非 "all"
    const timeRange = resolveEffectiveTimeRange(
      input.timeRange,
      context.metadata,
    );

    this.logger.log(
      `[doExecute] Searching OpenAlex: query="${query}", maxResults=${maxResults}, year=${year ?? "any"}`,
    );

    // ★ 2026-05-14 关键修复：OpenAlex 改了认证模式，admin 在 SecretKey 配的可能是：
    //   - email (含 @) → params.mailto=...（旧 polite pool，不计 $1/day budget）
    //   - API key (无 @) → params.api_key=...（新模式，计 $1/day budget + 用户后台可观测）
    // 之前所有值都被塞 mailto，admin 配 API key 也被当 email 用，OpenAlex 后台永远 0 消耗。
    const configuredCredential =
      await this.policyDataService.getApiKey("openalex-search");

    try {
      // 构建请求参数
      const baseUrl = "https://api.openalex.org/works";
      const params: Record<string, string | number> = {
        search: query,
        per_page: Math.min(maxResults, 200),
        select:
          "id,title,authorships,abstract_inverted_index,publication_year,cited_by_count,doi,primary_location,open_access,type",
      };

      // ★ Format detect 自动分通道
      if (configuredCredential) {
        if (configuredCredential.includes("@")) {
          params["mailto"] = configuredCredential;
          this.logger.debug(
            "[doExecute] Using configured mailto for polite pool (no $1/day budget tracking)",
          );
        } else {
          params["api_key"] = configuredCredential;
          this.logger.debug(
            "[doExecute] Using configured api_key (counts toward $1/day OpenAlex budget)",
          );
        }
      }

      // 年份过滤
      const since = resolveSearchTimeRangeSince(timeRange);
      const filters: string[] = [];
      if (year) {
        if (year.includes("-")) {
          const [from, to] = year.split("-");
          filters.push(`publication_year:${from}-${to}`);
        } else {
          filters.push(`publication_year:${year}`);
        }
      } else if (since) {
        filters.push(`from_publication_date:${formatDateYmd(since)}`);
      }
      if (filters.length > 0) {
        params["filter"] = filters.join(",");
      }

      // 排序
      if (sortByCitations) {
        params["sort"] = "cited_by_count:desc";
      }

      this.logger.debug(`[doExecute] API params: ${JSON.stringify(params)}`);

      // 带退避重试的请求，最多重试 3 次
      const maxRetries = 3;
      let responseData: OpenAlexApiResponse | undefined;
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        // 等待 429 全局冷却
        const cooldownRemaining = OpenAlexSearchTool.cooldownUntil - Date.now();
        if (cooldownRemaining > 0) {
          this.logger.debug(
            `[doExecute] Waiting ${cooldownRemaining}ms for global 429 cooldown`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, cooldownRemaining),
          );
        }

        try {
          responseData =
            await this.policyDataService.httpGet<OpenAlexApiResponse>(
              baseUrl,
              params,
            );
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const is429 = lastError.message.includes("429");
          if (is429 && attempt < maxRetries) {
            const backoff = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
            OpenAlexSearchTool.cooldownUntil = Date.now() + backoff;
            this.logger.warn(
              `[doExecute] OpenAlex 429 rate limited, retry ${attempt + 1}/${maxRetries} after ${backoff}ms (global cooldown set)`,
            );
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }
          if (is429) {
            OpenAlexSearchTool.cooldownUntil = Date.now() + 30_000;
            this.logger.warn(
              `[doExecute] OpenAlex 429 exhausted all retries, setting 30s global cooldown for subsequent requests`,
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
          error: `OpenAlex 搜索失败: ${lastError?.message || "重试 3 次后仍未拿到响应"}`,
        };
      }

      // 解析结果
      const papers: OpenAlexPaper[] = (responseData.results ?? []).map((item) =>
        this.parsePaper(item),
      );

      this.logger.log(
        `[doExecute] Found ${papers.length} papers (total: ${responseData.meta?.count ?? 0})`,
      );

      // Mark key as healthy on success
      if (configuredCredential) {
        this.policyDataService.clearKeyFailure(
          "openalex-search",
          configuredCredential,
        );
      }

      return {
        success: true,
        papers,
        totalResults: responseData.meta?.count ?? 0,
        query,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`[doExecute] OpenAlex API error: ${error}`);

      // Track key failure for multi-key rotation
      if (configuredCredential) {
        const statusMatch = errorMessage.match(/\b(4\d{2}|5\d{2})\b/);
        const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 500;
        this.policyDataService.markKeyFailed(
          "openalex-search",
          configuredCredential,
          statusCode,
        );
      }

      return {
        success: false,
        papers: [],
        totalResults: 0,
        query,
        error: `OpenAlex 搜索失败: ${errorMessage}`,
      };
    }
  }

  /**
   * 解析单篇论文 API 响应
   */
  private parsePaper(item: OpenAlexApiWork): OpenAlexPaper {
    // 从 inverted index 重建摘要
    const abstract = item.abstract_inverted_index
      ? this.reconstructAbstract(item.abstract_inverted_index)
      : "";

    // 提取 OpenAlex ID（去除 URL 前缀）
    const rawId = item.id ?? "";
    const id = rawId.replace("https://openalex.org/", "");

    // 提取 DOI（去除 URL 前缀）
    const doi = item.doi ? item.doi.replace("https://doi.org/", "") : undefined;

    return {
      id,
      title: item.title ?? "",
      authors: (item.authorships ?? [])
        .map((a) => a.author?.display_name)
        .filter(Boolean),
      abstract,
      year: item.publication_year ?? 0,
      citationCount: item.cited_by_count ?? 0,
      doi,
      url: rawId || `https://openalex.org/${id}`,
      openAccessUrl: item.open_access?.oa_url ?? undefined,
      source: item.primary_location?.source?.display_name ?? undefined,
      type: item.type ?? undefined,
    };
  }

  /**
   * 从 OpenAlex inverted index 格式重建摘要文本
   *
   * OpenAlex 使用 inverted index 格式存储摘要：
   * { "word1": [0, 5], "word2": [1, 3] } → 每个词对应在摘要中的位置列表
   */
  reconstructAbstract(invertedIndex: Record<string, number[]>): string {
    const words: Array<[number, string]> = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
      for (const pos of positions) {
        words.push([pos, word]);
      }
    }
    words.sort((a, b) => a[0] - b[0]);
    return words.map(([, word]) => word).join(" ");
  }

  validateInput(input: OpenAlexSearchInput): boolean {
    return !!input.query && input.query.trim().length > 0;
  }
}
