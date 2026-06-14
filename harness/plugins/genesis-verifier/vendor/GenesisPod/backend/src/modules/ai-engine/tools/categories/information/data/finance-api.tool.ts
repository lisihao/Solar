/**
 * Finance API Tool
 * 金融市场数据工具 - 获取股票报价、汇率、加密货币价格、经济指标
 *
 * API 文档: https://www.alphavantage.co/documentation/
 * 需要 API Key（免费套餐：25 次/天，5 次/分钟）
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import { PolicyDataService } from "../policy/policy-data.service";

// ============================================================================
// Types
// ============================================================================

/**
 * 查询类型
 */
export type FinanceQueryType =
  | "stock_quote"
  | "stock_daily"
  | "forex"
  | "crypto"
  | "economic_indicator";

/**
 * 输入参数
 */
export interface FinanceApiInput {
  /** 查询类型 */
  queryType: FinanceQueryType;
  /** 股票/资产代码 (e.g. AAPL, MSFT, BTC) */
  symbol?: string;
  /** 源货币 (forex: e.g. USD) */
  fromCurrency?: string;
  /** 目标货币 (forex: e.g. CNY) */
  toCurrency?: string;
  /** 经济指标名称 (e.g. "REAL_GDP", "CPI", "INFLATION", "UNEMPLOYMENT") */
  indicator?: string;
}

/**
 * 金融数据点
 */
export interface FinanceDataPoint {
  date: string;
  value: string;
  label?: string;
  // For stock quotes
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
}

/**
 * 输出结果
 */
export interface FinanceApiOutput {
  success: boolean;
  queryType: string;
  data: FinanceDataPoint[];
  metadata?: Record<string, string>;
  error?: string;
}

// ============================================================================
// Alpha Vantage API Response Types
// ============================================================================

interface GlobalQuoteResponse {
  "Global Quote": Record<string, string>;
}

interface TimeSeriesDailyResponse {
  "Meta Data"?: Record<string, string>;
  "Time Series (Daily)"?: Record<string, Record<string, string>>;
}

interface CurrencyExchangeRateResponse {
  "Realtime Currency Exchange Rate"?: Record<string, string>;
}

interface EconomicIndicatorResponse {
  name?: string;
  data?: Array<{ date: string; value: string }>;
}

type AlphaVantageResponse =
  | GlobalQuoteResponse
  | TimeSeriesDailyResponse
  | CurrencyExchangeRateResponse
  | EconomicIndicatorResponse
  | Record<string, unknown>;

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class FinanceApiTool extends BaseTool<
  FinanceApiInput,
  FinanceApiOutput
> {
  private readonly logger = new Logger(FinanceApiTool.name);

  /** Global rate limiter state — static to be shared across all instances */
  private static lastRequestTime = 0;
  private static readonly MIN_REQUEST_INTERVAL = 15000; // 15s — conservative for 5 req/min free tier
  private static activeRequests = 0;
  private static readonly MAX_CONCURRENT = 1;
  private static readonly requestQueue: Array<() => void> = [];
  /** Global 429 cooldown — all requests wait until this timestamp */
  private static cooldownUntil = 0;

  readonly id = "finance-api";
  readonly sideEffect = "none" as const;
  readonly name = "Finance Data API";
  readonly description =
    "获取金融市场数据：股票报价、汇率、加密货币价格、经济指标。数据来源：Alpha Vantage API（需 API Key）。适合金融研究、市场分析。";
  readonly category: ToolCategory = "information";
  readonly tags = ["finance", "stock", "market", "crypto", "economic"];
  readonly defaultTimeout = 30000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      queryType: {
        type: "string",
        enum: [
          "stock_quote",
          "stock_daily",
          "forex",
          "crypto",
          "economic_indicator",
        ],
        description:
          "查询类型：stock_quote=股票实时报价，stock_daily=股票日线数据，forex=外汇汇率，crypto=加密货币价格，economic_indicator=经济指标",
      },
      symbol: {
        type: "string",
        description:
          "股票/资产代码。stock_quote/stock_daily 用股票代码如 AAPL、MSFT；crypto 用加密货币代码如 BTC、ETH",
      },
      fromCurrency: {
        type: "string",
        description: "源货币代码，forex/crypto 查询时使用。示例：USD、EUR、BTC",
      },
      toCurrency: {
        type: "string",
        description:
          "目标货币代码，forex/crypto 查询时使用。示例：CNY、USD、EUR",
      },
      indicator: {
        type: "string",
        description:
          "经济指标名称，economic_indicator 查询时使用。支持：REAL_GDP、CPI、INFLATION、UNEMPLOYMENT、FEDERAL_FUNDS_RATE、TREASURY_YIELD",
      },
    },
    required: ["queryType"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean" },
      queryType: { type: "string" },
      data: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string" },
            value: { type: "string" },
            label: { type: "string" },
            open: { type: "string" },
            high: { type: "string" },
            low: { type: "string" },
            close: { type: "string" },
            volume: { type: "string" },
          },
        },
      },
      metadata: {
        type: "object",
        additionalProperties: { type: "string" },
      },
      error: { type: "string" },
    },
  };

  constructor(private readonly policyDataService: PolicyDataService) {
    super();
  }

  protected async doExecute(
    input: FinanceApiInput,
    _context: ToolContext,
  ): Promise<FinanceApiOutput> {
    const { queryType } = input;

    this.logger.log(
      `[doExecute] Finance API query: type="${queryType}", symbol="${input.symbol}", indicator="${input.indicator}"`,
    );

    // Check for API key first — required for Alpha Vantage
    const apiKey = await this.policyDataService.getApiKey("finance-api");
    if (!apiKey) {
      this.logger.warn(
        `[doExecute] No API key found for finance-api, returning early`,
      );
      return {
        success: false,
        queryType,
        data: [],
        error:
          "Finance API requires an API key. Configure it in Admin → Secrets.",
      };
    }

    try {
      const params = this.buildQueryParams(input, apiKey);
      if (!params) {
        return {
          success: false,
          queryType,
          data: [],
          error: this.getMissingParamsError(input),
        };
      }

      this.logger.debug(
        `[doExecute] Alpha Vantage params: ${JSON.stringify({ ...params, apikey: "***" })}`,
      );

      const baseUrl = "https://www.alphavantage.co/query";

      // Rate-limited request with retry on 429
      const maxRetries = 3;
      let responseData: AlphaVantageResponse | undefined;
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        await this.acquireSlot();
        try {
          responseData =
            await this.policyDataService.httpGet<AlphaVantageResponse>(
              baseUrl,
              params,
            );
          this.releaseSlot();
          break; // success
        } catch (err) {
          this.releaseSlot();
          lastError = err instanceof Error ? err : new Error(String(err));
          const is429 = lastError.message.includes("429");
          if (is429 && attempt < maxRetries) {
            const backoff = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
            FinanceApiTool.cooldownUntil = Date.now() + backoff;
            this.logger.warn(
              `[doExecute] Alpha Vantage 429 rate limited, retry ${attempt + 1}/${maxRetries} after ${backoff}ms (global cooldown set)`,
            );
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }
          if (is429) {
            FinanceApiTool.cooldownUntil = Date.now() + 60_000;
            this.logger.warn(
              `[doExecute] Alpha Vantage 429 exhausted all retries, setting 60s global cooldown`,
            );
          }
          throw err;
        }
      }

      if (!responseData) {
        return {
          success: false,
          queryType,
          data: [],
          error: `Finance API (Alpha Vantage) 请求失败: ${lastError?.message || "重试 3 次后仍未拿到响应（可能配额耗尽 / 网络超时）"}`,
        };
      }

      // Mark key as healthy on success
      this.policyDataService.clearKeyFailure("finance-api", apiKey);

      return this.parseResponse(queryType, responseData);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`[doExecute] Finance API error: ${error}`);

      // Track key failure for multi-key rotation
      const statusMatch = errorMessage.match(/\b(4\d{2}|5\d{2})\b/);
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 500;
      this.policyDataService.markKeyFailed("finance-api", apiKey, statusCode);

      return {
        success: false,
        queryType,
        data: [],
        error: `Finance API 查询失败: ${errorMessage}`,
      };
    }
  }

  /**
   * Build Alpha Vantage query params based on queryType
   */
  private buildQueryParams(
    input: FinanceApiInput,
    apiKey: string,
  ): Record<string, string> | null {
    const base = { apikey: apiKey };

    switch (input.queryType) {
      case "stock_quote": {
        if (!input.symbol) return null;
        return {
          ...base,
          function: "GLOBAL_QUOTE",
          symbol: input.symbol.toUpperCase(),
        };
      }
      case "stock_daily": {
        if (!input.symbol) return null;
        return {
          ...base,
          function: "TIME_SERIES_DAILY",
          symbol: input.symbol.toUpperCase(),
          outputsize: "compact", // last 100 data points
        };
      }
      case "forex": {
        if (!input.fromCurrency || !input.toCurrency) return null;
        return {
          ...base,
          function: "CURRENCY_EXCHANGE_RATE",
          from_currency: input.fromCurrency.toUpperCase(),
          to_currency: input.toCurrency.toUpperCase(),
        };
      }
      case "crypto": {
        const from = input.fromCurrency ?? input.symbol;
        const to = input.toCurrency ?? "USD";
        if (!from) return null;
        return {
          ...base,
          function: "CURRENCY_EXCHANGE_RATE",
          from_currency: from.toUpperCase(),
          to_currency: to.toUpperCase(),
        };
      }
      case "economic_indicator": {
        if (!input.indicator) return null;
        return {
          ...base,
          function: input.indicator.toUpperCase(),
        };
      }
      default:
        return null;
    }
  }

  /**
   * Return a descriptive error for missing required params
   */
  private getMissingParamsError(input: FinanceApiInput): string {
    switch (input.queryType) {
      case "stock_quote":
      case "stock_daily":
        return "stock_quote/stock_daily 查询需要提供 symbol 参数（如 AAPL）";
      case "forex":
        return "forex 查询需要提供 fromCurrency 和 toCurrency 参数（如 USD、CNY）";
      case "crypto":
        return "crypto 查询需要提供 fromCurrency（或 symbol）参数（如 BTC）";
      case "economic_indicator":
        return "economic_indicator 查询需要提供 indicator 参数（如 REAL_GDP、CPI）";
      default:
        return "缺少必要参数";
    }
  }

  /**
   * Alpha Vantage 配额限速 / API key 失效时不返 4xx，而是 200 + JSON 里
   * 带 "Note" / "Information" / "Error Message" 字段。提取这些让 LLM
   * 看到真实失败原因（quota / invalid key / rate limit）而不是 generic
   * "未找到 symbol 数据".
   */
  private extractAlphaVantageDiagnostic(
    raw: Record<string, unknown> | undefined,
  ): string | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw;
    const note = r.Note ?? r.note;
    const info = r.Information ?? r.information;
    const errMsg = r["Error Message"] ?? r.errorMessage;
    if (typeof note === "string" && note.trim())
      return `Alpha Vantage Note: ${note.slice(0, 280)}`;
    if (typeof info === "string" && info.trim())
      return `Alpha Vantage Information: ${info.slice(0, 280)}`;
    if (typeof errMsg === "string" && errMsg.trim())
      return `Alpha Vantage Error Message: ${errMsg.slice(0, 280)}`;
    return null;
  }

  /**
   * Parse Alpha Vantage response into FinanceApiOutput
   */
  private parseResponse(
    queryType: FinanceQueryType,
    raw: AlphaVantageResponse,
  ): FinanceApiOutput {
    switch (queryType) {
      case "stock_quote":
        return this.parseGlobalQuote(queryType, raw as GlobalQuoteResponse);
      case "stock_daily":
        return this.parseTimeSeriesDaily(
          queryType,
          raw as TimeSeriesDailyResponse,
        );
      case "forex":
      case "crypto":
        return this.parseCurrencyExchangeRate(
          queryType,
          raw as CurrencyExchangeRateResponse,
        );
      case "economic_indicator":
        return this.parseEconomicIndicator(
          queryType,
          raw as EconomicIndicatorResponse,
        );
      default:
        return {
          success: false,
          queryType,
          data: [],
          error: `不支持的查询类型 (queryType="${queryType}", 允许值: stock_quote/stock_daily/forex/crypto/economic_indicator)`,
        };
    }
  }

  /**
   * Parse GLOBAL_QUOTE response
   * Example: { "Global Quote": { "01. symbol": "AAPL", "05. price": "150.25", ... } }
   */
  private parseGlobalQuote(
    queryType: string,
    raw: GlobalQuoteResponse,
  ): FinanceApiOutput {
    const quote = raw["Global Quote"];
    if (!quote || Object.keys(quote).length === 0) {
      const diag = this.extractAlphaVantageDiagnostic(
        raw as unknown as Record<string, unknown>,
      );
      return {
        success: false,
        queryType,
        data: [],
        error: diag
          ? `未找到股票数据 (Global Quote 为空)。${diag}`
          : "未找到股票数据，请检查 symbol 是否正确（Alpha Vantage 返回 Global Quote 字段为空）",
      };
    }

    const dataPoint: FinanceDataPoint = {
      date:
        quote["07. latest trading day"] ??
        new Date().toISOString().split("T")[0],
      value: quote["05. price"] ?? "",
      label: `${quote["01. symbol"] ?? ""} 最新报价`,
      open: quote["02. open"],
      high: quote["03. high"],
      low: quote["04. low"],
      close: quote["08. previous close"],
      volume: quote["06. volume"],
    };

    const metadata: Record<string, string> = {};
    for (const [key, val] of Object.entries(quote)) {
      metadata[key] = val;
    }

    return { success: true, queryType, data: [dataPoint], metadata };
  }

  /**
   * Parse TIME_SERIES_DAILY response
   * Example: { "Time Series (Daily)": { "2024-01-15": { "1. open": "149.50", ... } } }
   */
  private parseTimeSeriesDaily(
    queryType: string,
    raw: TimeSeriesDailyResponse,
  ): FinanceApiOutput {
    const timeSeries = raw["Time Series (Daily)"];
    if (!timeSeries) {
      const diag = this.extractAlphaVantageDiagnostic(
        raw as unknown as Record<string, unknown>,
      );
      return {
        success: false,
        queryType,
        data: [],
        error: diag
          ? `未找到日线数据 ("Time Series (Daily)" 字段缺失)。${diag}`
          : "未找到日线数据，请检查 symbol 是否正确（Alpha Vantage 返回缺少 Time Series (Daily) 字段）",
      };
    }

    const data: FinanceDataPoint[] = Object.entries(timeSeries)
      .sort(([a], [b]) => b.localeCompare(a)) // newest first
      .map(([date, values]) => ({
        date,
        value: values["4. close"] ?? "",
        open: values["1. open"],
        high: values["2. high"],
        low: values["3. low"],
        close: values["4. close"],
        volume: values["5. volume"],
      }));

    const metaRaw = raw["Meta Data"] ?? {};
    const metadata: Record<string, string> = {};
    for (const [key, val] of Object.entries(metaRaw)) {
      metadata[key] = val;
    }

    return { success: true, queryType, data, metadata };
  }

  /**
   * Parse CURRENCY_EXCHANGE_RATE response (used for both forex and crypto)
   * Example: { "Realtime Currency Exchange Rate": { "1. From_Currency Code": "USD", "5. Exchange Rate": "7.2345", ... } }
   */
  private parseCurrencyExchangeRate(
    queryType: string,
    raw: CurrencyExchangeRateResponse,
  ): FinanceApiOutput {
    const rate = raw["Realtime Currency Exchange Rate"];
    if (!rate) {
      const diag = this.extractAlphaVantageDiagnostic(
        raw as unknown as Record<string, unknown>,
      );
      return {
        success: false,
        queryType,
        data: [],
        error: diag
          ? `未找到汇率数据 ("Realtime Currency Exchange Rate" 字段缺失)。${diag}`
          : "未找到汇率数据，请检查货币代码是否正确（Alpha Vantage 返回缺少 Realtime Currency Exchange Rate 字段）",
      };
    }

    const fromCode = rate["1. From_Currency Code"] ?? "";
    const toCode = rate["3. To_Currency Code"] ?? "";
    const exchangeRate = rate["5. Exchange Rate"] ?? "";
    const lastRefreshed = rate["6. Last Refreshed"] ?? new Date().toISOString();

    const dataPoint: FinanceDataPoint = {
      date: lastRefreshed.split(" ")[0],
      value: exchangeRate,
      label: `${fromCode}/${toCode} 汇率`,
    };

    const metadata: Record<string, string> = {};
    for (const [key, val] of Object.entries(rate)) {
      metadata[key] = val;
    }

    return { success: true, queryType, data: [dataPoint], metadata };
  }

  /**
   * Parse economic indicator response
   * Example: { "name": "Real GDP", "data": [{ "date": "2024-01-01", "value": "23456.7" }] }
   */
  private parseEconomicIndicator(
    queryType: string,
    raw: EconomicIndicatorResponse,
  ): FinanceApiOutput {
    const rawData = raw.data;
    if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
      const diag = this.extractAlphaVantageDiagnostic(
        raw as unknown as Record<string, unknown>,
      );
      return {
        success: false,
        queryType,
        data: [],
        error: diag
          ? `未找到经济指标数据 (data 数组为空)。${diag}`
          : "未找到经济指标数据，请检查 indicator 名称是否正确（Alpha Vantage 返回 data 数组为空）",
      };
    }

    const indicatorName = raw.name ?? "";
    const data: FinanceDataPoint[] = rawData.map((item) => ({
      date: item.date,
      value: item.value,
      label: indicatorName,
    }));

    return {
      success: true,
      queryType,
      data,
      metadata: indicatorName ? { name: indicatorName } : undefined,
    };
  }

  /**
   * Acquire concurrency slot, waiting for global cooldown + min request interval.
   * Queued requests wait rather than drop — ensuring no request is silently lost.
   */
  private async acquireSlot(): Promise<void> {
    // Wait for concurrency slot
    while (FinanceApiTool.activeRequests >= FinanceApiTool.MAX_CONCURRENT) {
      await new Promise<void>((resolve) => {
        FinanceApiTool.requestQueue.push(resolve);
      });
    }
    FinanceApiTool.activeRequests++;

    // Wait for global 429 cooldown
    const cooldownRemaining = FinanceApiTool.cooldownUntil - Date.now();
    if (cooldownRemaining > 0) {
      this.logger.debug(
        `[acquireSlot] Waiting ${cooldownRemaining}ms for global 429 cooldown`,
      );
      await new Promise((resolve) => setTimeout(resolve, cooldownRemaining));
    }

    // Enforce minimum request interval (15s for Alpha Vantage free tier)
    const now = Date.now();
    const timeSinceLastRequest = now - FinanceApiTool.lastRequestTime;
    if (timeSinceLastRequest < FinanceApiTool.MIN_REQUEST_INTERVAL) {
      const waitTime =
        FinanceApiTool.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
      this.logger.debug(
        `[acquireSlot] Waiting ${waitTime}ms for rate limit (Alpha Vantage free tier: 5 req/min)`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    FinanceApiTool.lastRequestTime = Date.now();
  }

  /**
   * Release concurrency slot and wake the next queued waiter.
   */
  private releaseSlot(): void {
    FinanceApiTool.activeRequests--;
    const next = FinanceApiTool.requestQueue.shift();
    if (next) next();
  }

  validateInput(input: FinanceApiInput): boolean {
    if (!input.queryType) return false;
    switch (input.queryType) {
      case "stock_quote":
      case "stock_daily":
        return !!input.symbol?.trim();
      case "forex":
        return !!input.fromCurrency?.trim() && !!input.toCurrency?.trim();
      case "crypto":
        return !!(input.fromCurrency?.trim() ?? input.symbol?.trim());
      case "economic_indicator":
        return !!input.indicator?.trim();
      default:
        return false;
    }
  }
}
