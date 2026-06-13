/**
 * FinanceApiTool Unit Tests
 *
 * Tests the finance-api tool in isolation by mocking PolicyDataService.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  FinanceApiTool,
  FinanceApiInput,
  FinanceApiOutput,
} from "../finance-api.tool";
import { PolicyDataService } from "../../policy/policy-data.service";
import {
  ToolContext,
  ToolResult,
} from "../../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-finance-001",
    toolId: "finance-api",
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock response fixtures
// ---------------------------------------------------------------------------

const MOCK_STOCK_QUOTE_RESPONSE = {
  "Global Quote": {
    "01. symbol": "AAPL",
    "02. open": "150.00",
    "03. high": "152.00",
    "04. low": "149.00",
    "05. price": "151.50",
    "06. volume": "50000000",
    "07. latest trading day": "2024-01-15",
    "08. previous close": "149.80",
  },
};

const MOCK_TIME_SERIES_DAILY_RESPONSE = {
  "Meta Data": { "1. Information": "Daily Prices" },
  "Time Series (Daily)": {
    "2024-01-15": {
      "1. open": "150.00",
      "2. high": "152.00",
      "3. low": "149.00",
      "4. close": "151.50",
      "5. volume": "50000000",
    },
    "2024-01-14": {
      "1. open": "149.00",
      "2. high": "150.50",
      "3. low": "148.00",
      "4. close": "150.00",
      "5. volume": "45000000",
    },
  },
};

const MOCK_CURRENCY_EXCHANGE_RATE_RESPONSE = {
  "Realtime Currency Exchange Rate": {
    "1. From_Currency Code": "USD",
    "3. To_Currency Code": "CNY",
    "5. Exchange Rate": "7.2345",
    "6. Last Refreshed": "2024-01-15 12:00:00",
  },
};

const MOCK_ECONOMIC_INDICATOR_RESPONSE = {
  name: "Real Gross Domestic Product",
  data: [
    { date: "2024-01-01", value: "23456.7" },
    { date: "2023-10-01", value: "23100.2" },
  ],
};

// ---------------------------------------------------------------------------
// Mock PolicyDataService
// ---------------------------------------------------------------------------

type PolicyDataServiceMock = Pick<
  PolicyDataService,
  "httpGet" | "getApiKey" | "clearKeyFailure" | "markKeyFailed"
>;

function createMockPolicyDataService(): jest.Mocked<PolicyDataServiceMock> {
  return {
    httpGet: jest.fn(),
    getApiKey: jest.fn().mockResolvedValue("test-api-key-123"),
    clearKeyFailure: jest.fn(),
    markKeyFailed: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("FinanceApiTool", () => {
  let tool: FinanceApiTool;
  let mockPolicyDataService: jest.Mocked<PolicyDataServiceMock>;

  beforeEach(async () => {
    // Reset static rate limiter state between tests to avoid cross-test interference
    (FinanceApiTool as any).lastRequestTime = 0;
    (FinanceApiTool as any).activeRequests = 0;
    (FinanceApiTool as any).cooldownUntil = 0;
    (FinanceApiTool as any).requestQueue.length = 0;

    mockPolicyDataService = createMockPolicyDataService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceApiTool,
        { provide: PolicyDataService, useValue: mockPolicyDataService },
      ],
    }).compile();

    tool = module.get<FinanceApiTool>(FinanceApiTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'finance-api'", () => {
      expect(tool.id).toBe("finance-api");
    });

    it("should belong to the 'information' category", () => {
      expect(tool.category).toBe("information");
    });

    it("should have finance-related tags", () => {
      expect(tool.tags).toContain("finance");
      expect(tool.tags).toContain("stock");
    });
  });

  // -------------------------------------------------------------------------
  // No API key
  // -------------------------------------------------------------------------

  describe("execute() - no API key", () => {
    it("should return error when no API key is configured", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);

      const input: FinanceApiInput = {
        queryType: "stock_quote",
        symbol: "AAPL",
      };
      const result: ToolResult<FinanceApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Finance API requires an API key");
      expect(mockPolicyDataService.httpGet).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Stock quote
  // -------------------------------------------------------------------------

  describe("execute() - stock_quote", () => {
    it("should fetch stock quote successfully", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        MOCK_STOCK_QUOTE_RESPONSE,
      );

      const input: FinanceApiInput = {
        queryType: "stock_quote",
        symbol: "AAPL",
      };
      const result: ToolResult<FinanceApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.queryType).toBe("stock_quote");
      expect(result.data?.data).toHaveLength(1);

      const point = result.data?.data[0];
      expect(point?.value).toBe("151.50");
      expect(point?.date).toBe("2024-01-15");
      expect(point?.open).toBe("150.00");
      expect(point?.high).toBe("152.00");
      expect(point?.low).toBe("149.00");
      expect(point?.volume).toBe("50000000");
    });

    it("should call Alpha Vantage with GLOBAL_QUOTE function and uppercased symbol", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        MOCK_STOCK_QUOTE_RESPONSE,
      );

      await tool.execute(
        { queryType: "stock_quote", symbol: "aapl" },
        makeContext(),
      );

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://www.alphavantage.co/query",
        expect.objectContaining({
          function: "GLOBAL_QUOTE",
          symbol: "AAPL",
        }),
      );
    });

    it("should return error for missing symbol on stock_quote", async () => {
      const input: FinanceApiInput = { queryType: "stock_quote" };
      const result: ToolResult<FinanceApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("symbol");
      expect(mockPolicyDataService.httpGet).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Stock daily
  // -------------------------------------------------------------------------

  describe("execute() - stock_daily", () => {
    it("should fetch stock daily data and return sorted entries", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        MOCK_TIME_SERIES_DAILY_RESPONSE,
      );

      const input: FinanceApiInput = {
        queryType: "stock_daily",
        symbol: "AAPL",
      };
      const result: ToolResult<FinanceApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.queryType).toBe("stock_daily");
      expect(result.data?.data).toHaveLength(2);

      // Newest first
      const first = result.data?.data[0];
      expect(first?.date).toBe("2024-01-15");
      expect(first?.value).toBe("151.50");
      expect(first?.open).toBe("150.00");
      expect(first?.volume).toBe("50000000");
    });

    it("should call Alpha Vantage with TIME_SERIES_DAILY function", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        MOCK_TIME_SERIES_DAILY_RESPONSE,
      );

      await tool.execute(
        { queryType: "stock_daily", symbol: "MSFT" },
        makeContext(),
      );

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://www.alphavantage.co/query",
        expect.objectContaining({
          function: "TIME_SERIES_DAILY",
          symbol: "MSFT",
          outputsize: "compact",
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Forex
  // -------------------------------------------------------------------------

  describe("execute() - forex", () => {
    it("should fetch forex exchange rate successfully", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        MOCK_CURRENCY_EXCHANGE_RATE_RESPONSE,
      );

      const input: FinanceApiInput = {
        queryType: "forex",
        fromCurrency: "USD",
        toCurrency: "CNY",
      };
      const result: ToolResult<FinanceApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.queryType).toBe("forex");
      expect(result.data?.data).toHaveLength(1);

      const point = result.data?.data[0];
      expect(point?.value).toBe("7.2345");
      expect(point?.date).toBe("2024-01-15");
      expect(point?.label).toContain("USD");
      expect(point?.label).toContain("CNY");
    });

    it("should call Alpha Vantage with CURRENCY_EXCHANGE_RATE function", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        MOCK_CURRENCY_EXCHANGE_RATE_RESPONSE,
      );

      await tool.execute(
        { queryType: "forex", fromCurrency: "eur", toCurrency: "jpy" },
        makeContext(),
      );

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://www.alphavantage.co/query",
        expect.objectContaining({
          function: "CURRENCY_EXCHANGE_RATE",
          from_currency: "EUR",
          to_currency: "JPY",
        }),
      );
    });

    it("should return error for missing currencies on forex", async () => {
      const input: FinanceApiInput = {
        queryType: "forex",
        fromCurrency: "USD",
        // toCurrency missing
      };
      const result: ToolResult<FinanceApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("fromCurrency");
      expect(mockPolicyDataService.httpGet).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Crypto
  // -------------------------------------------------------------------------

  describe("execute() - crypto", () => {
    it("should fetch crypto price using CURRENCY_EXCHANGE_RATE endpoint", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        MOCK_CURRENCY_EXCHANGE_RATE_RESPONSE,
      );

      const input: FinanceApiInput = {
        queryType: "crypto",
        fromCurrency: "BTC",
        toCurrency: "USD",
      };
      const result: ToolResult<FinanceApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.queryType).toBe("crypto");
      expect(result.data?.data).toHaveLength(1);
      expect(result.data?.data[0].value).toBe("7.2345");
    });

    it("should accept symbol as fallback for fromCurrency on crypto", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        MOCK_CURRENCY_EXCHANGE_RATE_RESPONSE,
      );

      await tool.execute({ queryType: "crypto", symbol: "ETH" }, makeContext());

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://www.alphavantage.co/query",
        expect.objectContaining({
          function: "CURRENCY_EXCHANGE_RATE",
          from_currency: "ETH",
          to_currency: "USD",
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Economic indicator
  // -------------------------------------------------------------------------

  describe("execute() - economic_indicator", () => {
    it("should fetch economic indicator data successfully", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        MOCK_ECONOMIC_INDICATOR_RESPONSE,
      );

      const input: FinanceApiInput = {
        queryType: "economic_indicator",
        indicator: "REAL_GDP",
      };
      const result: ToolResult<FinanceApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.queryType).toBe("economic_indicator");
      expect(result.data?.data).toHaveLength(2);

      const first = result.data?.data[0];
      expect(first?.date).toBe("2024-01-01");
      expect(first?.value).toBe("23456.7");
      expect(first?.label).toBe("Real Gross Domestic Product");
    });

    it("should call Alpha Vantage with uppercased indicator as function name", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        MOCK_ECONOMIC_INDICATOR_RESPONSE,
      );

      await tool.execute(
        { queryType: "economic_indicator", indicator: "real_gdp" },
        makeContext(),
      );

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://www.alphavantage.co/query",
        expect.objectContaining({
          function: "REAL_GDP",
        }),
      );
    });

    it("should return error for missing indicator on economic_indicator", async () => {
      const input: FinanceApiInput = { queryType: "economic_indicator" };
      const result: ToolResult<FinanceApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("indicator");
      expect(mockPolicyDataService.httpGet).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("execute() - error handling", () => {
    it("should handle API error gracefully when httpGet throws", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Network timeout"),
      );

      const input: FinanceApiInput = {
        queryType: "stock_quote",
        symbol: "AAPL",
      };
      const result: ToolResult<FinanceApiOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Finance API 查询失败");
      expect(result.data?.error).toContain("Network timeout");
      expect(result.data?.data).toHaveLength(0);
    });

    it("should return error when Global Quote response is empty", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue({ "Global Quote": {} });

      const result = await tool.execute(
        { queryType: "stock_quote", symbol: "INVALID" },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("symbol");
    });

    it("should return error when Time Series Daily is missing from response", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue({
        "Meta Data": { "1. Information": "Daily Prices" },
        // "Time Series (Daily)" key absent
      });

      const result = await tool.execute(
        { queryType: "stock_daily", symbol: "INVALID" },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("日线数据");
    });

    it("should return error when Currency Exchange Rate is missing from response", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue({});

      const result = await tool.execute(
        { queryType: "forex", fromCurrency: "USD", toCurrency: "CNY" },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("汇率数据");
    });

    it("should return error when economic indicator data array is empty", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue({
        name: "Real GDP",
        data: [],
      });

      const result = await tool.execute(
        { queryType: "economic_indicator", indicator: "REAL_GDP" },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("经济指标数据");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true for stock_quote with symbol", () => {
      expect(
        tool.validateInput({ queryType: "stock_quote", symbol: "AAPL" }),
      ).toBe(true);
    });

    it("should return false for stock_quote without symbol", () => {
      expect(tool.validateInput({ queryType: "stock_quote" })).toBe(false);
    });

    it("should return false for stock_quote with whitespace-only symbol", () => {
      expect(
        tool.validateInput({ queryType: "stock_quote", symbol: "   " }),
      ).toBe(false);
    });

    it("should return true for stock_daily with symbol", () => {
      expect(
        tool.validateInput({ queryType: "stock_daily", symbol: "MSFT" }),
      ).toBe(true);
    });

    it("should return false for stock_daily without symbol", () => {
      expect(tool.validateInput({ queryType: "stock_daily" })).toBe(false);
    });

    it("should return true for forex with both currencies", () => {
      expect(
        tool.validateInput({
          queryType: "forex",
          fromCurrency: "USD",
          toCurrency: "CNY",
        }),
      ).toBe(true);
    });

    it("should return false for forex with only fromCurrency", () => {
      expect(
        tool.validateInput({ queryType: "forex", fromCurrency: "USD" }),
      ).toBe(false);
    });

    it("should return false for forex with only toCurrency", () => {
      expect(
        tool.validateInput({ queryType: "forex", toCurrency: "CNY" }),
      ).toBe(false);
    });

    it("should return true for crypto with fromCurrency", () => {
      expect(
        tool.validateInput({ queryType: "crypto", fromCurrency: "BTC" }),
      ).toBe(true);
    });

    it("should return true for crypto with symbol as fallback", () => {
      expect(tool.validateInput({ queryType: "crypto", symbol: "ETH" })).toBe(
        true,
      );
    });

    it("should return false for crypto without fromCurrency or symbol", () => {
      expect(tool.validateInput({ queryType: "crypto" })).toBe(false);
    });

    it("should return true for economic_indicator with indicator", () => {
      expect(
        tool.validateInput({
          queryType: "economic_indicator",
          indicator: "REAL_GDP",
        }),
      ).toBe(true);
    });

    it("should return false for economic_indicator without indicator", () => {
      expect(tool.validateInput({ queryType: "economic_indicator" })).toBe(
        false,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  describe("execute() - cancellation", () => {
    it("should return success:false immediately when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute(
        { queryType: "stock_quote", symbol: "AAPL" },
        makeContext({ signal: controller.signal }),
      );

      expect(result.success).toBe(false);
      expect(mockPolicyDataService.httpGet).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Result metadata
  // -------------------------------------------------------------------------

  describe("execute() - result metadata", () => {
    it("should include executionId in result metadata", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        MOCK_STOCK_QUOTE_RESPONSE,
      );

      const result = await tool.execute(
        { queryType: "stock_quote", symbol: "AAPL" },
        makeContext(),
      );

      expect(result.metadata?.executionId).toBe("exec-finance-001");
      expect(result.metadata?.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
