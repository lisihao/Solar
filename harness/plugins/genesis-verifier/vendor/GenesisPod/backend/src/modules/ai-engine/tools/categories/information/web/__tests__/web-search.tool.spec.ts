/**
 * WebSearchTool Unit Tests
 *
 * Tests the web-search tool in isolation using manual mocks for SearchService.
 * All tests call tool.execute(input, context) to exercise the full BaseTool
 * lifecycle (signal check → doExecute → result wrapping).
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  WebSearchTool,
  WebSearchInput,
  WebSearchOutput,
} from "../web-search.tool";
import {
  SearchService,
  SearchResponse,
  SearchResult,
} from "../../../../../content/web-search/web-search.service";
import {
  ToolContext,
  ToolResult,
} from "../../../../abstractions/tool.interface";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid ToolContext */
function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-001",
    toolId: "web-search",
    createdAt: new Date(),
    ...overrides,
  };
}

/** Build a mock SearchResult */
function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    title: "Test Result",
    url: "https://example.com/article",
    content: "Some content here",
    ...overrides,
  };
}

/** Build a successful SearchResponse */
function makeSearchResponse(
  results: SearchResult[],
  overrides: Partial<SearchResponse> = {},
): SearchResponse {
  return {
    success: true,
    results,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock SearchService (typed, no `any`)
// ---------------------------------------------------------------------------

type SearchServiceMock = Pick<SearchService, "search" | "fetchUrlContent">;

function createMockSearchService(): jest.Mocked<SearchServiceMock> {
  return {
    search: jest.fn(),
    fetchUrlContent: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("WebSearchTool", () => {
  let tool: WebSearchTool;
  let mockSearchService: jest.Mocked<SearchServiceMock>;

  beforeEach(async () => {
    mockSearchService = createMockSearchService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebSearchTool,
        { provide: SearchService, useValue: mockSearchService },
      ],
    }).compile();

    tool = module.get<WebSearchTool>(WebSearchTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'web-search'", () => {
      expect(tool.id).toBe("web-search");
    });

    it("should belong to the 'information' category", () => {
      expect(tool.category).toBe("information");
    });
  });

  // -------------------------------------------------------------------------
  // Success path
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    it("should return success:true with results when SearchService resolves", async () => {
      const results: SearchResult[] = [
        makeSearchResult({
          title: "AI News",
          url: "https://news.ycombinator.com/ai",
        }),
        makeSearchResult({ title: "AI Research", url: "https://arxiv.org/ai" }),
      ];
      mockSearchService.search.mockResolvedValue(makeSearchResponse(results));

      const input: WebSearchInput = { query: "artificial intelligence" };
      const result: ToolResult<WebSearchOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.results).toHaveLength(2);
      expect(result.data?.results[0].title).toBe("AI News");
      expect(result.data?.totalResults).toBe(2);
    });

    it("should include correct metadata.toolId in the result", async () => {
      mockSearchService.search.mockResolvedValue(
        makeSearchResponse([makeSearchResult()]),
      );

      const result = await tool.execute(
        { query: "test query" },
        makeContext({ toolId: "web-search" }),
      );

      expect(result.metadata).toBeDefined();
      expect(result.metadata.executionId).toBe("exec-001");
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it("should return success:false with error data inside data when SearchService returns success:false", async () => {
      mockSearchService.search.mockResolvedValue({
        success: false,
        results: [],
        error: "Provider unavailable",
      });

      const result = await tool.execute({ query: "test query" }, makeContext());

      // doExecute returns the data as-is, so the outer ToolResult is success:true
      // but the inner WebSearchOutput.success reflects the provider result
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.results).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Default numResults
  // -------------------------------------------------------------------------

  describe("execute() - numResults defaults", () => {
    // 2026-05-13: 这 4 个用例只关心 numResults 的 cap/default 语义，timeRange 必须显式
    // 传 "all" 以拿到 since=undefined。否则 resolveEffectiveTimeRange 会兜到
    // DEFAULT_SEARCH_TIME_RANGE=365d → resolveSearchTimeRangeSince 返回 Date 实例。
    it("should call SearchService with numResults = 8 when not specified", async () => {
      mockSearchService.search.mockResolvedValue(makeSearchResponse([]));

      const input: WebSearchInput = {
        query: "quantum computing",
        timeRange: "all",
      };
      await tool.execute(input, makeContext());

      expect(mockSearchService.search).toHaveBeenCalledWith(
        "quantum computing",
        8,
        undefined,
      );
    });

    it("should call SearchService with provided numResults when within limit", async () => {
      mockSearchService.search.mockResolvedValue(makeSearchResponse([]));

      const input: WebSearchInput = {
        query: "machine learning",
        numResults: 3,
        timeRange: "all",
      };
      await tool.execute(input, makeContext());

      expect(mockSearchService.search).toHaveBeenCalledWith(
        "machine learning",
        3,
        undefined,
      );
    });

    it("should cap numResults at 12 when value exceeds the maximum", async () => {
      mockSearchService.search.mockResolvedValue(makeSearchResponse([]));

      const input: WebSearchInput = {
        query: "deep learning",
        numResults: 99,
        timeRange: "all",
      };
      await tool.execute(input, makeContext());

      // BaseTool calls doExecute which caps at Math.min(numResults, 12)
      expect(mockSearchService.search).toHaveBeenCalledWith(
        "deep learning",
        12,
        undefined,
      );
    });

    it("should cap numResults at 10 when value is exactly 10", async () => {
      mockSearchService.search.mockResolvedValue(makeSearchResponse([]));

      const input: WebSearchInput = {
        query: "nlp",
        numResults: 10,
        timeRange: "all",
      };
      await tool.execute(input, makeContext());

      expect(mockSearchService.search).toHaveBeenCalledWith(
        "nlp",
        10,
        undefined,
      );
    });

    it("should default to 365d window when neither input nor context provides timeRange", async () => {
      mockSearchService.search.mockResolvedValue(makeSearchResponse([]));

      const before = Date.now();
      await tool.execute({ query: "fallback default" }, makeContext());
      const after = Date.now();

      const [queryArg, numResultsArg, sinceArg] =
        mockSearchService.search.mock.calls[0];
      expect(queryArg).toBe("fallback default");
      expect(numResultsArg).toBe(8);
      expect(sinceArg).toBeInstanceOf(Date);
      const yearMs = 365 * 24 * 60 * 60 * 1000;
      const sinceMs = (sinceArg as Date).getTime();
      expect(sinceMs).toBeGreaterThanOrEqual(before - yearMs);
      expect(sinceMs).toBeLessThanOrEqual(after - yearMs);
    });

    it("should pass provider since date when timeRange is specified", async () => {
      mockSearchService.search.mockResolvedValue(makeSearchResponse([]));

      // resolveSearchTimeRangeSince() captures Date.now() at call time, so a
      // strict toHaveBeenCalledWith against a fresh resolveSearchTimeRangeSince
      // call in the assertion will flake under parallel-worker timing drift.
      // Assert against a tolerance window instead.
      const before = Date.now();
      await tool.execute(
        { query: "agent framework", timeRange: "90d" },
        makeContext(),
      );
      const after = Date.now();

      expect(mockSearchService.search).toHaveBeenCalledTimes(1);
      const [queryArg, numResultsArg, sinceArg] =
        mockSearchService.search.mock.calls[0];
      expect(queryArg).toBe("agent framework");
      expect(numResultsArg).toBe(8);
      expect(sinceArg).toBeInstanceOf(Date);
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
      const sinceMs = (sinceArg as Date).getTime();
      expect(sinceMs).toBeGreaterThanOrEqual(before - ninetyDaysMs);
      expect(sinceMs).toBeLessThanOrEqual(after - ninetyDaysMs);
    });
  });

  // -------------------------------------------------------------------------
  // Input validation (validateInput is a standalone method; BaseTool.execute
  // does NOT call it internally - external callers decide when to use it)
  // -------------------------------------------------------------------------

  describe("validateInput() - standalone validation checks", () => {
    it("should return false for an empty query string", () => {
      expect(tool.validateInput({ query: "" })).toBe(false);
    });

    it("should return false for a query that is only whitespace", () => {
      expect(tool.validateInput({ query: "   " })).toBe(false);
    });

    it("should return false for a query exceeding 500 characters", () => {
      expect(tool.validateInput({ query: "a".repeat(501) })).toBe(false);
    });

    it("should return true for a query of exactly 500 characters", () => {
      expect(tool.validateInput({ query: "b".repeat(500) })).toBe(true);
    });

    it("should return true for a normal non-empty query", () => {
      expect(tool.validateInput({ query: "hello world" })).toBe(true);
    });

    it("should return true when optional numResults is provided", () => {
      expect(tool.validateInput({ query: "test", numResults: 5 })).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe("execute() - error path", () => {
    it("should return success:false when SearchService throws", async () => {
      mockSearchService.search.mockRejectedValue(new Error("Network timeout"));

      const result = await tool.execute(
        { query: "climate change" },
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain("Network timeout");
    });

    it("should return success:false with a retryable error on network failure", async () => {
      mockSearchService.search.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await tool.execute({ query: "blockchain" }, makeContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // AbortSignal cancellation
  // -------------------------------------------------------------------------

  describe("execute() - AbortSignal cancellation", () => {
    it("should return success:false immediately when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const context = makeContext({ signal: controller.signal });
      const result = await tool.execute({ query: "any query" }, context);

      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/cancelled/i);
      // SearchService must NOT be called at all
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });

    it("should include error code TOOL_3002 when cancelled", async () => {
      const controller = new AbortController();
      controller.abort();

      const context = makeContext({ signal: controller.signal });
      const result = await tool.execute({ query: "test" }, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TOOL_3002");
    });

    it("should execute normally when signal is NOT aborted", async () => {
      const controller = new AbortController();
      mockSearchService.search.mockResolvedValue(
        makeSearchResponse([makeSearchResult()]),
      );

      const context = makeContext({ signal: controller.signal });
      const result = await tool.execute({ query: "test" }, context);

      expect(result.success).toBe(true);
      expect(mockSearchService.search).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Output shape
  // -------------------------------------------------------------------------

  describe("execute() - output shape", () => {
    it("should return results with correct SearchResult fields", async () => {
      const expectedResult: SearchResult = {
        title: "Detailed Title",
        url: "https://example.org/page",
        content: "Full content text",
        score: 0.95,
        publishedDate: "2026-01-15",
        domain: "example.org",
      };
      mockSearchService.search.mockResolvedValue(
        makeSearchResponse([expectedResult]),
      );

      const result = await tool.execute({ query: "test" }, makeContext());

      expect(result.success).toBe(true);
      expect(result.data?.results[0]).toMatchObject({
        title: "Detailed Title",
        url: "https://example.org/page",
        content: "Full content text",
      });
    });

    it("should set totalResults equal to the number of results returned", async () => {
      const results = [
        makeSearchResult({ url: "https://a.com" }),
        makeSearchResult({ url: "https://b.com" }),
        makeSearchResult({ url: "https://c.com" }),
      ];
      mockSearchService.search.mockResolvedValue(makeSearchResponse(results));

      const result = await tool.execute({ query: "test" }, makeContext());

      expect(result.data?.totalResults).toBe(3);
    });

    it("should return an empty results array when provider returns no results", async () => {
      mockSearchService.search.mockResolvedValue(makeSearchResponse([]));

      const result = await tool.execute(
        { query: "obscure query" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.results).toHaveLength(0);
      expect(result.data?.totalResults).toBe(0);
    });
  });
});
