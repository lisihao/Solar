/**
 * HackerNewsSearchTool Unit Tests
 *
 * Tests the hackernews-search tool in isolation by mocking HttpService.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import {
  HackerNewsSearchTool,
  HackerNewsSearchOutput,
} from "../hackernews-search.tool";
import {
  ToolContext,
  ToolResult,
} from "../../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-hn-001",
    toolId: "hackernews-search",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeHnApiHit(overrides: Record<string, unknown> = {}) {
  return {
    objectID: "34567890",
    title: "Ask HN: Is TypeScript worth it?",
    url: "https://example.com/article",
    author: "tester",
    points: 250,
    num_comments: 87,
    created_at: "2024-01-10T12:00:00.000Z",
    story_text: null,
    _tags: ["story"],
    ...overrides,
  };
}

function makeHnApiResponse(hitCount = 1, nbHits = 100) {
  return {
    hits: Array.from({ length: hitCount }, (_, i) =>
      makeHnApiHit({
        objectID: `id-${i}`,
        title: `HN Story ${i}`,
        points: 100 + i * 10,
        num_comments: 20 + i,
      }),
    ),
    nbHits,
    page: 0,
    nbPages: 5,
    hitsPerPage: hitCount,
  };
}

// ---------------------------------------------------------------------------
// Mock HttpService
// ---------------------------------------------------------------------------

function createMockHttpService() {
  return {
    get: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("HackerNewsSearchTool", () => {
  let tool: HackerNewsSearchTool;
  let mockHttpService: ReturnType<typeof createMockHttpService>;

  beforeEach(async () => {
    mockHttpService = createMockHttpService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HackerNewsSearchTool,
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    tool = module.get<HackerNewsSearchTool>(HackerNewsSearchTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'hackernews-search'", () => {
      expect(tool.id).toBe("hackernews-search");
    });

    it("should belong to the 'information' category", () => {
      expect(tool.category).toBe("information");
    });

    it("should include hackernews-related tags", () => {
      expect(tool.tags).toContain("hackernews");
      expect(tool.tags).toContain("community");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true for a valid non-empty query", () => {
      expect(tool.validateInput({ query: "TypeScript" })).toBe(true);
    });

    it("should return false for an empty query", () => {
      expect(tool.validateInput({ query: "" })).toBe(false);
    });

    it("should return false for a whitespace-only query", () => {
      expect(tool.validateInput({ query: "   " })).toBe(false);
    });

    it("should return true with optional tags param", () => {
      expect(tool.validateInput({ query: "show hn", tags: "show_hn" })).toBe(
        true,
      );
    });

    it("should return true with numericFilters", () => {
      expect(
        tool.validateInput({ query: "rust", numericFilters: "points>100" }),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    it("should return success:true with hits array", async () => {
      mockHttpService.get.mockReturnValue(
        of({ data: makeHnApiResponse(3, 500) }),
      );

      const result: ToolResult<HackerNewsSearchOutput> = await tool.execute(
        { query: "machine learning" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.hits).toHaveLength(3);
      expect(result.data?.totalHits).toBe(500);
    });

    it("should map API fields to correct output shape", async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            hits: [makeHnApiHit()],
            nbHits: 1,
            page: 0,
            nbPages: 1,
            hitsPerPage: 1,
          },
        }),
      );

      const result = await tool.execute({ query: "TS" }, makeContext());

      const hit = result.data?.hits[0];
      expect(hit?.objectID).toBe("34567890");
      expect(hit?.title).toBe("Ask HN: Is TypeScript worth it?");
      expect(hit?.author).toBe("tester");
      expect(hit?.points).toBe(250);
      expect(hit?.numComments).toBe(87);
      expect(hit?.hnUrl).toContain("news.ycombinator.com/item?id=34567890");
    });

    it("should set null url for hits with no url", async () => {
      const hit = makeHnApiHit({ url: null });
      mockHttpService.get.mockReturnValue(
        of({
          data: { hits: [hit], nbHits: 1, page: 0, nbPages: 1, hitsPerPage: 1 },
        }),
      );

      const result = await tool.execute({ query: "ask hn" }, makeContext());

      expect(result.data?.hits[0].url).toBeNull();
    });

    it("should include tags in request params when provided", async () => {
      mockHttpService.get.mockReturnValue(
        of({ data: makeHnApiResponse(0, 0) }),
      );

      await tool.execute({ query: "show hn", tags: "show_hn" }, makeContext());

      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({ tags: "show_hn" }),
        }),
      );
    });

    it("should include numericFilters in request params when provided", async () => {
      mockHttpService.get.mockReturnValue(
        of({ data: makeHnApiResponse(0, 0) }),
      );

      // 2026-05-13: timeRange="all" 让 numericFilters 保持 raw 用户值，不被 mission 兜底 365d
      // 追加 created_at_i>... 时间过滤。
      await tool.execute(
        { query: "rust", numericFilters: "points>100", timeRange: "all" },
        makeContext(),
      );

      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({ numericFilters: "points>100" }),
        }),
      );
    });

    it("should use default maxResults = 20 and cap at 100", async () => {
      mockHttpService.get.mockReturnValue(
        of({ data: makeHnApiResponse(0, 0) }),
      );

      await tool.execute({ query: "AI" }, makeContext());

      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({ hitsPerPage: "20" }),
        }),
      );
    });

    it("should cap hitsPerPage at 100 when maxResults exceeds limit", async () => {
      mockHttpService.get.mockReturnValue(
        of({ data: makeHnApiResponse(0, 0) }),
      );

      await tool.execute({ query: "AI", maxResults: 999 }, makeContext());

      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({ hitsPerPage: "100" }),
        }),
      );
    });

    it("should return empty hits array when API returns no results", async () => {
      mockHttpService.get.mockReturnValue(
        of({ data: makeHnApiResponse(0, 0) }),
      );

      const result = await tool.execute(
        { query: "very obscure topic" },
        makeContext(),
      );

      expect(result.data?.hits).toHaveLength(0);
      expect(result.data?.totalHits).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe("execute() - error path", () => {
    it("should return data.success=false when HttpService throws", async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() => new Error("Network error")),
      );

      const result = await tool.execute({ query: "test" }, makeContext());

      // HackerNewsSearchTool catches errors internally and returns success:false
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("HackerNews 搜索失败");
    });

    it("should include original error message in data.error", async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() => new Error("ECONNRESET")),
      );

      const result = await tool.execute({ query: "ts" }, makeContext());

      expect(result.data?.error).toContain("ECONNRESET");
    });

    it("should return empty hits on error", async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() => new Error("Timeout")),
      );

      const result = await tool.execute({ query: "ts" }, makeContext());

      expect(result.data?.hits).toHaveLength(0);
      expect(result.data?.totalHits).toBe(0);
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
        { query: "test" },
        makeContext({ signal: controller.signal }),
      );

      expect(result.success).toBe(false);
      expect(mockHttpService.get).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Output shape
  // -------------------------------------------------------------------------

  describe("execute() - output shape", () => {
    it("should return query in the output", async () => {
      mockHttpService.get.mockReturnValue(
        of({ data: makeHnApiResponse(1, 1) }),
      );

      const result = await tool.execute(
        { query: "rust programming" },
        makeContext(),
      );

      expect(result.data?.query).toBe("rust programming");
    });

    it("should build correct hnUrl for each hit", async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: {
            hits: [makeHnApiHit({ objectID: "99887766" })],
            nbHits: 1,
            page: 0,
            nbPages: 1,
            hitsPerPage: 1,
          },
        }),
      );

      const result = await tool.execute({ query: "test" }, makeContext());

      expect(result.data?.hits[0].hnUrl).toBe(
        "https://news.ycombinator.com/item?id=99887766",
      );
    });
  });
});
