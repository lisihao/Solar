/**
 * SEC EDGAR Tool
 * 美国证监会 EDGAR 公司披露检索工具 —— 按公司名/股票代码/CIK 查上市公司的
 * 10-K（年报）/ 10-Q（季报）/ 8-K（临时公告）等披露文件。
 *
 * 用途：为「产业链分析」的参与者公司提供权威事实背书与可引用来源（accessionNumber + URL）。
 *
 * 数据通道（均为 SEC 公开、无需 API Key）：
 *   1. CIK 查找：https://www.sec.gov/files/company_tickers.json
 *      （ticker→{cik_str, ticker, title} 全量映射，内存缓存）
 *   2. 提交记录：https://data.sec.gov/submissions/CIK{补零10位}.json
 *      （filings.recent 含 form/accessionNumber/filingDate/primaryDocument 平铺数组）
 *
 * SEC Fair Access：≤10 req/s per IP，且 User-Agent 必须声明产品名 + 联系方式。
 *   - 本工具内置 ≥100ms 最小请求间隔（10 req/s）。
 *   - 复用 PolicyDataService.httpGet（内建 30s 超时 + host 级 429 冷却），
 *     仅覆盖 User-Agent 为 SEC 合规格式。
 *
 * SEC EDGAR API 文档：https://www.sec.gov/search-filings/edgar-application-programming-interfaces
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import { PolicyDataService } from "../policy/policy-data.service";
import { APP_CONFIG } from "@/common/config/app.config";

// ============================================================================
// Types
// ============================================================================

export type SecFormType = "10-K" | "10-Q" | "8-K" | "all";

export interface SecEdgarInput {
  /** 公司名称（模糊匹配 SEC title），与 ticker/cik 至少提供其一 */
  companyName?: string;
  /** 股票代码（精确匹配，优先级高于 companyName） */
  ticker?: string;
  /** SEC CIK（提供则跳过查找，最精确） */
  cik?: string;
  /** 报告类型，默认 10-K */
  formType?: SecFormType;
  /** 返回文件数量，默认 10，最大 50 */
  limit?: number;
}

export interface SecFiling {
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate: string;
  primaryDocument: string;
  description: string;
  /** 文件主文档的可访问 URL */
  url: string;
}

export interface SecEdgarOutput {
  success: boolean;
  /** 解析到的 CIK（补零 10 位） */
  cik?: string;
  /** 解析到的公司名 */
  companyName?: string;
  filings: SecFiling[];
  error?: string;
}

// ── SEC company_tickers.json 单条结构 ──────────────────────────────────────
interface SecTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

// ── SEC submissions JSON（仅取用到的字段）──────────────────────────────────
interface SecSubmissionsResponse {
  cik?: string;
  name?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      form?: string[];
      filingDate?: string[];
      reportDate?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_SUBMISSIONS_BASE = "https://data.sec.gov/submissions";

@Injectable()
export class SecEdgarTool extends BaseTool<SecEdgarInput, SecEdgarOutput> {
  private readonly logger = new Logger(SecEdgarTool.name);

  readonly id = "sec-edgar-search";
  readonly sideEffect = "none" as const;
  readonly name = "SEC EDGAR Search";
  readonly description =
    "检索美国证监会 EDGAR 数据库：按公司名/股票代码/CIK 查上市公司的 10-K 年报、10-Q 季报、8-K 临时公告等披露文件，返回可引用的 accessionNumber 与文件 URL。用于产业链参与者公司的权威事实背书。无需 API Key。";
  readonly category: ToolCategory = "information";
  readonly tags = ["finance", "sec", "edgar", "filing", "company"];
  readonly defaultTimeout = 30000;

  // ── SEC Fair Access：≥100ms 最小请求间隔（10 req/s）──────────────────────
  private static readonly MIN_REQUEST_INTERVAL_MS = 100;
  private static lastRequestAt = 0;

  // company_tickers.json 内存缓存（全量 ~13k 条，体积小，缓存 6h）
  private static tickerCache: SecTickerEntry[] | null = null;
  private static tickerCacheAt = 0;
  private static readonly TICKER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      companyName: {
        type: "string",
        description:
          "公司名称，模糊匹配（如 'NVIDIA'）。与 ticker/cik 至少给其一",
      },
      ticker: {
        type: "string",
        description: "股票代码，精确匹配（如 'NVDA'），优先级高于 companyName",
      },
      cik: {
        type: "string",
        description: "SEC CIK 号（如 '0001045810'），给定则最精确、跳过查找",
      },
      formType: {
        type: "string",
        enum: ["10-K", "10-Q", "8-K", "all"],
        description:
          "报告类型：10-K=年报，10-Q=季报，8-K=临时公告，all=全部。默认 10-K",
        default: "10-K",
      },
      limit: {
        type: "number",
        description: "返回文件数量，默认 10，最大 50",
        default: 10,
      },
    },
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean" },
      cik: { type: "string" },
      companyName: { type: "string" },
      filings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            accessionNumber: { type: "string" },
            form: { type: "string" },
            filingDate: { type: "string" },
            reportDate: { type: "string" },
            primaryDocument: { type: "string" },
            description: { type: "string" },
            url: { type: "string" },
          },
        },
      },
      error: { type: "string" },
    },
  };

  constructor(private readonly policyDataService: PolicyDataService) {
    super();
  }

  protected async doExecute(
    input: SecEdgarInput,
    _context: ToolContext,
  ): Promise<SecEdgarOutput> {
    const formType = input.formType ?? "10-K";
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);

    try {
      // ── Step 1: 解析 CIK ─────────────────────────────────────────────────
      const resolved = await this.resolveCik(input);
      if (!resolved) {
        return {
          success: false,
          filings: [],
          error:
            "无法解析 CIK：请提供有效的 cik，或可匹配 SEC 登记的 ticker / companyName（仅覆盖美国上市公司）",
        };
      }

      // ── Step 2: 取提交记录 ────────────────────────────────────────────────
      await this.throttle();
      const submissions =
        await this.policyDataService.httpGet<SecSubmissionsResponse>(
          `${SEC_SUBMISSIONS_BASE}/CIK${resolved.cik}.json`,
          undefined,
          { "User-Agent": this.secUserAgent() },
        );

      const recent = submissions.filings?.recent;
      if (!recent?.accessionNumber?.length) {
        return {
          success: true,
          cik: resolved.cik,
          companyName: submissions.name ?? resolved.title,
          filings: [],
        };
      }

      const cikNoPad = String(parseInt(resolved.cik, 10));
      const filings: SecFiling[] = [];
      const forms = recent.form ?? [];
      for (let i = 0; i < forms.length && filings.length < limit; i++) {
        const form = forms[i];
        if (formType !== "all" && form !== formType) continue;

        const accession = recent.accessionNumber?.[i] ?? "";
        const accessionNoDashes = accession.replace(/-/g, "");
        const primaryDocument = recent.primaryDocument?.[i] ?? "";
        const url =
          accessionNoDashes && primaryDocument
            ? `https://www.sec.gov/Archives/edgar/data/${cikNoPad}/${accessionNoDashes}/${primaryDocument}`
            : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${resolved.cik}&type=${form}`;

        filings.push({
          accessionNumber: accession,
          form,
          filingDate: recent.filingDate?.[i] ?? "",
          reportDate: recent.reportDate?.[i] ?? "",
          primaryDocument,
          description: recent.primaryDocDescription?.[i] ?? "",
          url,
        });
      }

      return {
        success: true,
        cik: resolved.cik,
        companyName: submissions.name ?? resolved.title,
        filings,
      };
    } catch (error) {
      // 安全（应修-1）：内部网络层错误（HTTP/ECONNREFUSED/ETIMEDOUT 等含主机端口）
      // 只记日志，不随响应外泄；对外只给业务层通用文案。
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`[doExecute] SEC EDGAR lookup failed: ${message}`);
      const isNetworkLevel =
        /^HTTP|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|socket|network/i.test(
          message,
        );
      const safe = isNetworkLevel ? "SEC 服务暂时不可用，请稍后重试" : message;
      return {
        success: false,
        filings: [],
        error: `SEC EDGAR 检索失败: ${safe}`,
      };
    }
  }

  /**
   * 解析 CIK（补零 10 位）+ 公司标题。
   * 优先级：显式 cik > ticker 精确 > companyName 模糊。
   */
  private async resolveCik(
    input: SecEdgarInput,
  ): Promise<{ cik: string; title: string } | null> {
    if (input.cik) {
      const digits = input.cik.replace(/\D/g, "");
      if (!digits) return null;
      return { cik: digits.padStart(10, "0"), title: "" };
    }

    const tickers = await this.loadTickers();
    if (!tickers.length) return null;

    // ticker 精确匹配（大小写不敏感）
    if (input.ticker) {
      const t = input.ticker.trim().toUpperCase();
      const hit = tickers.find((e) => e.ticker.toUpperCase() === t);
      if (hit) {
        return { cik: String(hit.cik_str).padStart(10, "0"), title: hit.title };
      }
    }

    // companyName 模糊匹配（优先完全相等，其次包含；取最短 title 减少歧义）
    if (input.companyName) {
      const q = input.companyName.trim().toLowerCase();
      const exact = tickers.filter((e) => e.title.toLowerCase() === q);
      const contains = tickers.filter((e) => e.title.toLowerCase().includes(q));
      const pool = exact.length ? exact : contains;
      if (pool.length) {
        const best = pool.reduce((a, b) =>
          a.title.length <= b.title.length ? a : b,
        );
        return {
          cik: String(best.cik_str).padStart(10, "0"),
          title: best.title,
        };
      }
    }

    return null;
  }

  /** 加载并缓存 SEC company_tickers.json（对象形态 {idx: entry}，转数组）。 */
  private async loadTickers(): Promise<SecTickerEntry[]> {
    const now = Date.now();
    if (
      SecEdgarTool.tickerCache &&
      now - SecEdgarTool.tickerCacheAt < SecEdgarTool.TICKER_CACHE_TTL_MS
    ) {
      return SecEdgarTool.tickerCache;
    }

    await this.throttle();
    const raw = await this.policyDataService.httpGet<
      Record<string, SecTickerEntry>
    >(SEC_TICKERS_URL, undefined, { "User-Agent": this.secUserAgent() });

    const list = Object.values(raw ?? {}).filter(
      (e): e is SecTickerEntry =>
        !!e && typeof e.cik_str === "number" && typeof e.ticker === "string",
    );
    SecEdgarTool.tickerCache = list;
    SecEdgarTool.tickerCacheAt = now;
    return list;
  }

  /** SEC Fair Access：≥100ms 最小请求间隔（进程内串行节流，10 req/s）。 */
  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait =
      SecEdgarTool.MIN_REQUEST_INTERVAL_MS - (now - SecEdgarTool.lastRequestAt);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    SecEdgarTool.lastRequestAt = Date.now();
  }

  /** SEC 要求 UA 声明产品名 + 联系方式。 */
  private secUserAgent(): string {
    const brand = APP_CONFIG.brand;
    return `${brand.name} ${brand.contactEmail}`;
  }

  validateInput(input: SecEdgarInput): boolean {
    return !!(input.cik || input.ticker || input.companyName);
  }

  /** 测试 helper：清缓存与节流状态。 */
  static resetForTesting(): void {
    SecEdgarTool.tickerCache = null;
    SecEdgarTool.tickerCacheAt = 0;
    SecEdgarTool.lastRequestAt = 0;
  }
}
