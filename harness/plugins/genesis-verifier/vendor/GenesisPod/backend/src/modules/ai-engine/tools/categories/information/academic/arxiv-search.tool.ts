/**
 * ArXiv Search Tool
 * ArXiv 学术搜索工具 - 搜索计算机科学、物理学等领域的学术论文预印本
 *
 * ★ 2026-05-01 治本：从直连 export.arxiv.org 改为通过 OpenAlex API
 *   filter=primary_location.source.id:S4306400194 拉 ArXiv 索引论文。
 *   背景：本地 + Railway 出站 IP 段被 ArXiv 长期 429 ban（curl 30s/90s 实测均
 *   "Rate exceeded"，加 mailto polite-pool 也无效）。OpenAlex 已索引 ArXiv
 *   全量 109K+ 论文（含 ViT/Attention 等经典），返回 0.5s HTTP 200，
 *   reliability 远高于直连。
 *
 *   本 Tool 接口（input/output schema）与之前完全一致 —— researcher 端零变更。
 *   仅底层数据通道从 ArXiv API 切到 OpenAlex API。
 *
 *   保留 circuit breaker：连续 3 次 OpenAlex 失败时内存禁用 30 分钟，让快速失败
 *   而不是僵 30s。
 *
 * 原 ArXiv API 文档（仅供参考）: https://info.arxiv.org/help/api/index.html
 * OpenAlex API 文档: https://docs.openalex.org/api-entities/works
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
// Types — 与之前 ArXiv tool 完全一致，researcher 接口零变更
// ============================================================================

export type ArxivSortBy = "relevance" | "lastUpdatedDate" | "submittedDate";

export interface ArxivSearchInput {
  query: string;
  maxResults?: number;
  category?: string;
  sortBy?: ArxivSortBy;
  timeRange?: SearchTimeRange;
}

export interface ArxivPaper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  publishedDate: string;
  updatedDate: string;
  pdfUrl: string;
  arxivUrl: string;
}

export interface ArxivSearchOutput {
  papers: ArxivPaper[];
  totalResults: number;
  query: string;
  success: boolean;
  error?: string;
}

// ============================================================================
// OpenAlex API Response Types（仅本 tool 内部用，外部不暴露）
// ============================================================================

interface OpenAlexSourceMeta {
  id?: string;
  display_name?: string;
  type?: string;
}
interface OpenAlexAuthorEntry {
  author?: { display_name?: string };
}
interface OpenAlexLocation {
  source?: OpenAlexSourceMeta;
  landing_page_url?: string;
  pdf_url?: string;
}
interface OpenAlexWork {
  id: string;
  title?: string;
  display_name?: string;
  authorships?: OpenAlexAuthorEntry[];
  abstract_inverted_index?: Record<string, number[]>;
  publication_year?: number;
  publication_date?: string;
  doi?: string;
  primary_location?: OpenAlexLocation;
  open_access?: { oa_url?: string };
  ids?: { openalex?: string; doi?: string };
  topics?: { display_name?: string; subfield?: { display_name?: string } }[];
  updated_date?: string;
  created_date?: string;
}
interface OpenAlexResponse {
  results?: OpenAlexWork[];
  meta?: { count?: number };
}

// ============================================================================
// Tool Implementation
// ============================================================================

const ARXIV_OPENALEX_SOURCE_ID = "S4306400194"; // OpenAlex Source ID for arXiv
const OPENALEX_BASE_URL = "https://api.openalex.org/works";

@Injectable()
export class ArxivSearchTool extends BaseTool<
  ArxivSearchInput,
  ArxivSearchOutput
> {
  private readonly logger = new Logger(ArxivSearchTool.name);

  // ── Circuit Breaker ──────────────────────────────────────────────────────
  /** 连续失败计数 */
  private static consecutiveFailures = 0;
  /** 内存禁用截止时间戳（0 = 未禁用） */
  private static circuitOpenUntil = 0;
  private static readonly FAILURE_THRESHOLD = 3;
  private static readonly CIRCUIT_OPEN_DURATION_MS = 30 * 60 * 1000; // 30 min

  readonly id = "arxiv-search";
  readonly sideEffect = "none" as const;
  readonly name = "ArXiv Search";
  readonly description =
    "搜索 ArXiv 学术论文预印本库：计算机科学、物理学、数学等领域的最新研究论文。底层通过 OpenAlex API 拉 ArXiv 索引论文（覆盖 ArXiv 全量 109K+ 论文），无需 API Key。适合深度研究、文献调研、前沿技术追踪。";
  readonly category: ToolCategory = "information";
  readonly tags = ["academic", "research", "paper", "arxiv", "science"];
  readonly defaultTimeout = 30000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "搜索查询，支持关键词、作者、标题等。示例：'machine learning', 'attention mechanism', 'transformer architecture'",
      },
      maxResults: {
        type: "number",
        description: "最大结果数量，默认 10，最大 100",
        default: 10,
      },
      category: {
        type: "string",
        description:
          "arXiv 分类提示（如 cs.AI / cs.LG / cs.CV）。底层走 OpenAlex topic 字段做软匹配，非严格过滤。",
      },
      sortBy: {
        type: "string",
        enum: ["relevance", "lastUpdatedDate", "submittedDate"],
        description:
          "排序方式：relevance=相关性，lastUpdatedDate=按 OpenAlex updated 排序，submittedDate=按 publication_date 排序",
        default: "relevance",
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
            categories: { type: "array", items: { type: "string" } },
            publishedDate: { type: "string" },
            updatedDate: { type: "string" },
            pdfUrl: { type: "string" },
            arxivUrl: { type: "string" },
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
    input: ArxivSearchInput,
    context: ToolContext,
  ): Promise<ArxivSearchOutput> {
    const { query, maxResults = 10, category, sortBy = "relevance" } = input;
    // 2026-05-13: LLM 漏传 timeRange 时退回 mission 默认 / 365d，而非 "all"
    const timeRange = resolveEffectiveTimeRange(
      input.timeRange,
      context.metadata,
    );

    this.logger.log(
      `[doExecute] Searching ArXiv (via OpenAlex): query="${query}", maxResults=${maxResults}, category=${category}`,
    );

    // ── Circuit Breaker check ─────────────────────────────────────────────
    const now = Date.now();
    if (ArxivSearchTool.circuitOpenUntil > now) {
      const remainingMin = Math.ceil(
        (ArxivSearchTool.circuitOpenUntil - now) / 60000,
      );
      return {
        success: false,
        papers: [],
        totalResults: 0,
        query,
        error: `ArXiv 检索路径暂时熔断中（连续失败 ${ArxivSearchTool.FAILURE_THRESHOLD} 次），${remainingMin} 分钟后恢复。建议改用 openalex-search / semantic-scholar。`,
      };
    }

    try {
      // ── 构建 OpenAlex 请求 ────────────────────────────────────────────────
      // ★ 2026-05-14 关键修复：与 openalex-search.tool 对齐，detect API key vs email
      // 复用 admin 在 SecretKey "openalex-search" 的配置。值含 @ → mailto；否则 → api_key。
      // 之前不分通道一律 mailto，admin 配的 API key 被 OpenAlex 忽略 → user budget 不计。
      const credential =
        await this.policyDataService.getApiKey("openalex-search");

      const since = resolveSearchTimeRangeSince(timeRange);
      const filters = [
        `primary_location.source.id:${ARXIV_OPENALEX_SOURCE_ID}`,
      ];
      if (since) {
        filters.push(`from_publication_date:${formatDateYmd(since)}`);
      }
      const params: Record<string, string | number> = {
        search: query,
        filter: filters.join(","),
        per_page: Math.min(maxResults, 100),
        select:
          "id,title,display_name,authorships,abstract_inverted_index,publication_year,publication_date,doi,primary_location,open_access,ids,topics,updated_date,created_date",
      };
      if (sortBy === "submittedDate") {
        params["sort"] = "publication_date:desc";
      } else if (sortBy === "lastUpdatedDate") {
        params["sort"] = "updated_date:desc";
      }
      if (credential) {
        if (credential.includes("@")) {
          params["mailto"] = credential;
        } else {
          params["api_key"] = credential;
        }
      }

      const data = await this.policyDataService.httpGet<OpenAlexResponse>(
        OPENALEX_BASE_URL,
        params,
      );

      const works = data.results ?? [];
      const papers: ArxivPaper[] = works
        .map((w) => this.mapOpenAlexToArxiv(w, category))
        .filter((p): p is ArxivPaper => p !== null);

      this.logger.log(
        `[doExecute] Found ${papers.length} ArXiv papers via OpenAlex (total indexed: ${data.meta?.count ?? "?"})`,
      );

      // 重置失败计数
      ArxivSearchTool.consecutiveFailures = 0;

      return {
        success: true,
        papers,
        totalResults: data.meta?.count ?? papers.length,
        query,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `[doExecute] ArXiv-via-OpenAlex error: ${errorMessage}`,
      );

      // 累计失败 + 触发 circuit
      ArxivSearchTool.consecutiveFailures++;
      if (
        ArxivSearchTool.consecutiveFailures >= ArxivSearchTool.FAILURE_THRESHOLD
      ) {
        ArxivSearchTool.circuitOpenUntil =
          Date.now() + ArxivSearchTool.CIRCUIT_OPEN_DURATION_MS;
        this.logger.warn(
          `[doExecute] ArXiv tool circuit OPEN: ${ArxivSearchTool.consecutiveFailures} consecutive failures, disabling for 30min`,
        );
      }

      return {
        success: false,
        papers: [],
        totalResults: 0,
        query,
        error: `ArXiv 搜索失败: ${errorMessage}`,
      };
    }
  }

  /** OpenAlex Work → 原 ArxivPaper 形态映射 */
  private mapOpenAlexToArxiv(
    w: OpenAlexWork,
    categoryFilter?: string,
  ): ArxivPaper | null {
    // 提取 ArXiv ID（从 landing_page_url 或 doi 解析）
    const landing =
      w.primary_location?.landing_page_url ?? w.open_access?.oa_url ?? "";
    const arxivIdMatch =
      landing.match(/arxiv\.org\/(?:abs|pdf)\/([0-9.v]+)/i) ??
      (w.doi ?? "").match(/arxiv\.([0-9.]+)/i);
    const arxivId = arxivIdMatch?.[1] ?? "";
    if (!arxivId) {
      // 不是 ArXiv 来源 → 跳过
      return null;
    }

    // 反向构造 abstract：abstract_inverted_index 是 {word: [positions]}，需重排
    const abstract = w.abstract_inverted_index
      ? this.reconstructAbstract(w.abstract_inverted_index)
      : "";

    // 提取 categories（从 topics + subfield）
    const topicCategories: string[] = [];
    for (const t of w.topics ?? []) {
      if (t.subfield?.display_name)
        topicCategories.push(t.subfield.display_name);
      if (t.display_name) topicCategories.push(t.display_name);
    }
    const categories = Array.from(new Set(topicCategories));

    // category 过滤（软匹配 — OpenAlex topic 名 vs ArXiv 分类码不一一对应）
    if (categoryFilter) {
      const filterLower = categoryFilter.toLowerCase();
      const hits = categories.some((c) =>
        c.toLowerCase().includes(filterLower),
      );
      // 没匹配上不丢弃 — 因为 ArXiv cs.AI 和 OpenAlex 分类体系完全不同，
      // 严格过滤会把所有结果踢光。仅作软提示。
      if (!hits) {
        // 仍返回，category 字段含 OpenAlex topics 让 LLM 自己判断
      }
    }

    const authors = (w.authorships ?? [])
      .map((a) => a.author?.display_name ?? "")
      .filter((s) => s.length > 0);

    const pdfUrl =
      w.primary_location?.pdf_url ??
      w.open_access?.oa_url ??
      `https://arxiv.org/pdf/${arxivId}`;
    const arxivUrl = `https://arxiv.org/abs/${arxivId}`;

    return {
      id: arxivId,
      title: w.title ?? w.display_name ?? "",
      authors,
      abstract,
      categories,
      publishedDate:
        w.publication_date ??
        (w.publication_year ? `${w.publication_year}-01-01` : ""),
      updatedDate: w.updated_date ?? w.publication_date ?? "",
      pdfUrl,
      arxivUrl,
    };
  }

  /**
   * OpenAlex 返回的 abstract_inverted_index 是反向索引格式：
   *   { "word": [pos1, pos2], ... }
   * 重建成正常文本。
   */
  private reconstructAbstract(invertedIndex: Record<string, number[]>): string {
    const positions: { pos: number; word: string }[] = [];
    for (const [word, posArr] of Object.entries(invertedIndex)) {
      for (const pos of posArr) positions.push({ pos, word });
    }
    positions.sort((a, b) => a.pos - b.pos);
    return positions.map((p) => p.word).join(" ");
  }

  validateInput(input: ArxivSearchInput): boolean {
    return !!input.query && input.query.trim().length > 0;
  }

  /** 测试 helper：重置 circuit breaker 状态 */
  static resetCircuitForTesting(): void {
    ArxivSearchTool.consecutiveFailures = 0;
    ArxivSearchTool.circuitOpenUntil = 0;
  }
}
