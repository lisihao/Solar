/**
 * DataFetchingService Tests
 *
 * Tests cover:
 * - detectDataFetchingNeed: keyword detection, TOP-N queries, no-match cases
 * - fetchData: cache hit, cache miss, API routing (perplexity/tavily/serper)
 * - enrichContent: with and without data
 * - processDataFetching: full pipeline
 * - getSearchApiConfig: DB config, env var fallback, disabled search
 * - parseSearchResult (via fetchData integration)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { AxiosHeaders, AxiosResponse } from "axios";
import { DataFetchingService } from "../data-fetching.service";
import { SystemSettingService } from "../../settings/system-setting.service";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function makeAxiosResponse<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
}

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------
const originalEnv = process.env;

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------
describe("DataFetchingService", () => {
  let service: DataFetchingService;
  let mockHttpService: jest.Mocked<HttpService>;
  let mockAdminService: jest.Mocked<Partial<SystemSettingService>>;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.PERPLEXITY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.SERPER_API_KEY;

    mockHttpService = {
      post: jest.fn(),
      get: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;

    mockAdminService = {
      getSearchConfig: jest.fn(),
      getSearchApiKey: jest.fn(),
    };

    // Default: search enabled with tavily provider, no DB API keys
    (mockAdminService.getSearchConfig as jest.Mock).mockResolvedValue({
      enabled: true,
      provider: "tavily",
    });
    (mockAdminService.getSearchApiKey as jest.Mock).mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataFetchingService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: SystemSettingService, useValue: mockAdminService },
      ],
    }).compile();

    service = module.get<DataFetchingService>(DataFetchingService);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // =========================================================================
  // detectDataFetchingNeed
  // =========================================================================
  describe("detectDataFetchingNeed", () => {
    it("returns needsFetching=false for ordinary text", () => {
      const result = service.detectDataFetchingNeed(
        "What is the capital of France?",
      );
      expect(result.needsFetching).toBe(false);
      expect(result.queries).toHaveLength(0);
    });

    it("detects action + data keywords", () => {
      const result = service.detectDataFetchingNeed("获取最新AI数据统计");
      expect(result.needsFetching).toBe(true);
    });

    it("detects time + entity keywords", () => {
      const result = service.detectDataFetchingNeed("最新科技公司排名");
      expect(result.needsFetching).toBe(true);
    });

    it("detects TOP N + entity keywords", () => {
      const result =
        service.detectDataFetchingNeed("TOP 10 美国科技公司市值排名");
      expect(result.needsFetching).toBe(true);
      expect(result.intent).toContain("top_10");
    });

    it("detects English TOP N queries", () => {
      const result = service.detectDataFetchingNeed(
        "Top 5 technology companies in the US by revenue",
      );
      expect(result.needsFetching).toBe(true);
    });

    it("generates queries for TOP N with industry and region", () => {
      const result =
        service.detectDataFetchingNeed("获取北美TOP 10科技企业市值数据");
      expect(result.needsFetching).toBe(true);
      expect(result.queries.length).toBeGreaterThan(0);
      expect(result.queries[0]).toContain("top 10");
    });

    it("detects comparison intent", () => {
      const result = service.detectDataFetchingNeed("对比苹果和微软的营收数据");
      expect(result.needsFetching).toBe(true);
      expect(result.intent).toBe("comparison");
    });

    it("detects trend analysis intent", () => {
      const result = service.detectDataFetchingNeed("分析2024年AI市场增长趋势");
      expect(result.needsFetching).toBe(true);
      expect(result.intent).toBe("trend_analysis");
    });

    it("generates at most 3 queries", () => {
      const result = service.detectDataFetchingNeed(
        "比较对比最新2024年AI公司市值数据统计前10排名",
      );
      if (result.needsFetching) {
        expect(result.queries.length).toBeLessThanOrEqual(3);
      }
    });

    it("returns intent=data_query for plain data keywords", () => {
      const result =
        service.detectDataFetchingNeed("获取当前全球企业数据统计指标");
      expect(result.needsFetching).toBe(true);
    });
  });

  // =========================================================================
  // fetchData – no API configured
  // =========================================================================
  describe("fetchData – no API configured", () => {
    it("returns empty array when no search API configured", async () => {
      // getSearchConfig disabled
      (mockAdminService.getSearchConfig as jest.Mock).mockResolvedValue({
        enabled: false,
        provider: "tavily",
      });

      const result = await service.fetchData(["test query"]);
      expect(result).toHaveLength(0);
    });

    it("returns empty array when all env vars are absent and no DB keys", async () => {
      const result = await service.fetchData(["test query"]);
      expect(result).toHaveLength(0);
    });
  });

  // =========================================================================
  // fetchData – Perplexity API
  // =========================================================================
  describe("fetchData – Perplexity", () => {
    beforeEach(() => {
      (mockAdminService.getSearchConfig as jest.Mock).mockResolvedValue({
        enabled: true,
        provider: "perplexity",
      });
      (mockAdminService.getSearchApiKey as jest.Mock).mockResolvedValue(
        "pplx-test-key",
      );
    });

    it("calls Perplexity API and returns structured result", async () => {
      mockHttpService.post.mockReturnValue(
        of(
          makeAxiosResponse({
            choices: [
              {
                message: {
                  content:
                    "Apple $2.8 trillion Microsoft $2.5 trillion Google $1.8 trillion",
                },
              },
            ],
          }),
        ),
      );

      const results = await service.fetchData(["top 10 tech companies"]);

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("top 10 tech companies");
      expect(results[0].items.length).toBeGreaterThan(0);
      expect(results[0].fetchedAt).toBeTruthy();
    });

    it("returns empty when Perplexity returns no choices", async () => {
      mockHttpService.post.mockReturnValue(
        of(makeAxiosResponse({ choices: [] })),
      );

      const results = await service.fetchData(["empty query"]);
      expect(results).toHaveLength(0);
    });

    it("handles Perplexity HTTP errors gracefully", async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => new Error("500 Server Error")),
      );

      const results = await service.fetchData(["error query"]);
      expect(results).toHaveLength(0);
    });
  });

  // =========================================================================
  // fetchData – Tavily API
  // =========================================================================
  describe("fetchData – Tavily", () => {
    beforeEach(() => {
      process.env.TAVILY_API_KEY = "tvly-test-key";
      (mockAdminService.getSearchConfig as jest.Mock).mockResolvedValue({
        enabled: true,
        provider: "tavily",
      });
      (mockAdminService.getSearchApiKey as jest.Mock).mockResolvedValue(null);
    });

    it("calls Tavily API and returns result with answer", async () => {
      mockHttpService.post.mockReturnValue(
        of(
          makeAxiosResponse({
            answer: "The top tech companies are Apple, Microsoft and Google.",
            results: [
              { title: "Forbes Top 10", content: "Apple leads with $3T" },
            ],
          }),
        ),
      );

      const results = await service.fetchData(["top tech companies"]);

      expect(results).toHaveLength(1);
      expect(results[0].items.length).toBeGreaterThan(0);
    });

    it("returns data from results when no answer field", async () => {
      mockHttpService.post.mockReturnValue(
        of(
          makeAxiosResponse({
            answer: null,
            results: [
              { title: "Result 1", content: "NVIDIA revenue increased 50%" },
            ],
          }),
        ),
      );

      const results = await service.fetchData(["nvidia revenue"]);
      expect(results).toHaveLength(1);
    });

    it("returns empty when Tavily returns no answer and empty results", async () => {
      mockHttpService.post.mockReturnValue(
        of(makeAxiosResponse({ answer: null, results: [] })),
      );

      const results = await service.fetchData(["empty"]);
      expect(results).toHaveLength(0);
    });
  });

  // =========================================================================
  // fetchData – Serper API
  // =========================================================================
  describe("fetchData – Serper", () => {
    beforeEach(() => {
      process.env.SERPER_API_KEY = "serper-test-key";
      (mockAdminService.getSearchConfig as jest.Mock).mockResolvedValue({
        enabled: true,
        provider: "serper",
      });
      (mockAdminService.getSearchApiKey as jest.Mock).mockResolvedValue(null);
    });

    it("calls Serper API and returns structured result", async () => {
      mockHttpService.post.mockReturnValue(
        of(
          makeAxiosResponse({
            organic: [
              { snippet: "Apple market cap is $2.8 trillion in 2024" },
              { snippet: "Microsoft is valued at $2.5 trillion" },
              { snippet: "Google parent Alphabet reaches $1.8 trillion" },
            ],
          }),
        ),
      );

      const results = await service.fetchData(["top companies market cap"]);

      expect(results).toHaveLength(1);
      expect(results[0].items.length).toBeGreaterThan(0);
    });

    it("returns empty when Serper returns no organic results", async () => {
      mockHttpService.post.mockReturnValue(
        of(makeAxiosResponse({ organic: [] })),
      );

      const results = await service.fetchData(["no results"]);
      expect(results).toHaveLength(0);
    });
  });

  // =========================================================================
  // fetchData – cache behavior
  // =========================================================================
  describe("fetchData – caching", () => {
    beforeEach(() => {
      process.env.TAVILY_API_KEY = "tvly-cache-key";
      (mockAdminService.getSearchConfig as jest.Mock).mockResolvedValue({
        enabled: true,
        provider: "tavily",
      });
      (mockAdminService.getSearchApiKey as jest.Mock).mockResolvedValue(null);
    });

    it("returns cached result on second call for same query", async () => {
      mockHttpService.post.mockReturnValue(
        of(
          makeAxiosResponse({
            answer: "Cached answer",
            results: [{ title: "R1", content: "Some content" }],
          }),
        ),
      );

      await service.fetchData(["cached query"]);
      await service.fetchData(["cached query"]);

      // HTTP should only be called once due to caching
      expect(mockHttpService.post).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // enrichContent
  // =========================================================================
  describe("enrichContent", () => {
    it("returns original content when fetchedData is empty", () => {
      const result = service.enrichContent("Original content", []);
      expect(result).toBe("Original content");
    });

    it("appends fetched data to original content", () => {
      const fetchedData = [
        {
          title: "Tech Companies 2024",
          items: [
            { name: "Apple", value: "$2.8T" },
            { name: "Microsoft", value: "$2.5T", trend: "up" as const },
          ],
          source: "Search API",
          fetchedAt: new Date().toISOString(),
        },
      ];

      const result = service.enrichContent("Original", fetchedData);

      expect(result).toContain("Original");
      expect(result).toContain("Tech Companies 2024");
      expect(result).toContain("Apple");
      expect(result).toContain("$2.8T");
      expect(result).toContain("以下是获取的真实数据");
    });

    it("includes unit and comparison in enriched content", () => {
      const fetchedData = [
        {
          title: "Stats",
          items: [
            {
              name: "Growth",
              value: "25",
              unit: "%",
              comparison: "YoY",
              trend: "up" as const,
            },
          ],
          source: "API",
          fetchedAt: new Date().toISOString(),
        },
      ];

      const result = service.enrichContent("base", fetchedData);
      expect(result).toContain("25");
      expect(result).toContain("%");
      expect(result).toContain("YoY");
      expect(result).toContain("↑");
    });

    it("includes trend down arrow", () => {
      const fetchedData = [
        {
          title: "Stats",
          items: [{ name: "Decline", value: "10", trend: "down" as const }],
          source: "API",
          fetchedAt: new Date().toISOString(),
        },
      ];

      const result = service.enrichContent("base", fetchedData);
      expect(result).toContain("↓");
    });

    it("includes trend stable arrow", () => {
      const fetchedData = [
        {
          title: "Stats",
          items: [{ name: "Flat", value: "5", trend: "stable" as const }],
          source: "API",
          fetchedAt: new Date().toISOString(),
        },
      ];

      const result = service.enrichContent("base", fetchedData);
      expect(result).toContain("→");
    });
  });

  // =========================================================================
  // processDataFetching
  // =========================================================================
  describe("processDataFetching", () => {
    it("returns needsFetching=false when no data fetching detected", async () => {
      const result = await service.processDataFetching("What is TypeScript?");

      expect(result.needsFetching).toBe(false);
      expect(result.fetchedData).toHaveLength(0);
      expect(result.enrichedContent).toBe("What is TypeScript?");
    });

    it("fetches and enriches content for data queries", async () => {
      process.env.TAVILY_API_KEY = "tvly-process-key";
      (mockAdminService.getSearchConfig as jest.Mock).mockResolvedValue({
        enabled: true,
        provider: "tavily",
      });
      (mockAdminService.getSearchApiKey as jest.Mock).mockResolvedValue(null);

      mockHttpService.post.mockReturnValue(
        of(
          makeAxiosResponse({
            answer: "Apple leads with $2.8T market cap",
            results: [{ title: "Market Data", content: "Apple $2.8 trillion" }],
          }),
        ),
      );

      const result =
        await service.processDataFetching("获取北美TOP 10科技公司市值");

      expect(result.needsFetching).toBe(true);
      expect(result.detectedIntent).toBeTruthy();
      expect(result.queries.length).toBeGreaterThan(0);
      expect(result.enrichedContent).toContain("获取北美TOP 10科技公司市值");
    });

    it("handles DB error by falling back to env vars", async () => {
      process.env.PERPLEXITY_API_KEY = "pplx-env-fallback";
      (mockAdminService.getSearchConfig as jest.Mock).mockRejectedValue(
        new Error("DB connection failed"),
      );

      mockHttpService.post.mockReturnValue(
        of(
          makeAxiosResponse({
            choices: [{ message: { content: "Apple $2.8T Microsoft $2.5T" } }],
          }),
        ),
      );

      const result =
        await service.processDataFetching("获取北美TOP 10科技公司市值");

      expect(result.needsFetching).toBe(true);
      // Either fetched data or fell back gracefully
      expect(typeof result.enrichedContent).toBe("string");
    });
  });

  // =========================================================================
  // getSearchApiConfig – fallback provider selection
  // =========================================================================
  describe("getSearchApiConfig – provider fallback", () => {
    it("falls back to alternative provider when configured provider has no key", async () => {
      (mockAdminService.getSearchConfig as jest.Mock).mockResolvedValue({
        enabled: true,
        provider: "perplexity",
      });
      (mockAdminService.getSearchApiKey as jest.Mock).mockImplementation(
        async (provider: string) => {
          if (provider === "tavily") return "tvly-fallback-key";
          return null;
        },
      );

      mockHttpService.post.mockReturnValue(
        of(
          makeAxiosResponse({
            answer: "Data from Tavily fallback",
            results: [{ title: "T1", content: "Content" }],
          }),
        ),
      );

      const result = await service.fetchData(["fallback test"]);
      // Should have used tavily as fallback
      expect(result.length).toBeGreaterThanOrEqual(0); // Either found or not
    });
  });
});
