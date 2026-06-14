/**
 * OpenAlexSearchTool Unit Tests
 *
 * Tests the openalex-search tool in isolation by mocking PolicyDataService.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  OpenAlexSearchTool,
  OpenAlexSearchInput,
  OpenAlexSearchOutput,
} from "../openalex-search.tool";
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
    executionId: "exec-oa-001",
    toolId: "openalex-search",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeMockApiResponse(
  overrides: Partial<{
    results: unknown[];
    meta: { count: number; per_page: number };
  }> = {},
) {
  return {
    results: [
      {
        id: "https://openalex.org/W12345",
        title: "Attention Is All You Need",
        authorships: [
          { author: { id: "A1", display_name: "Ashish Vaswani" } },
          { author: { id: "A2", display_name: "Noam Shazeer" } },
        ],
        abstract_inverted_index: {
          The: [0],
          dominant: [1],
          sequence: [2],
          transduction: [3],
          models: [4],
        },
        publication_year: 2017,
        cited_by_count: 95000,
        doi: "https://doi.org/10.48550/arXiv.1706.03762",
        primary_location: {
          source: { display_name: "NeurIPS" },
          landing_page_url: "https://papers.nips.cc/paper/7181",
        },
        open_access: {
          oa_url: "https://arxiv.org/pdf/1706.03762",
          is_oa: true,
        },
        type: "article",
      },
    ],
    meta: { count: 500, per_page: 10 },
    ...overrides,
  };
}

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
    getApiKey: jest.fn().mockResolvedValue(null),
    clearKeyFailure: jest.fn(),
    markKeyFailed: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("OpenAlexSearchTool", () => {
  let tool: OpenAlexSearchTool;
  let mockPolicyDataService: jest.Mocked<PolicyDataServiceMock>;

  beforeEach(async () => {
    // Reset static rate limiter state (only cooldownUntil remains after
    // acquireSlot/releaseSlot and related concurrency fields were removed)
    (OpenAlexSearchTool as unknown as Record<string, unknown>)[
      "cooldownUntil"
    ] = 0;

    mockPolicyDataService = createMockPolicyDataService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenAlexSearchTool,
        { provide: PolicyDataService, useValue: mockPolicyDataService },
      ],
    }).compile();

    tool = module.get<OpenAlexSearchTool>(OpenAlexSearchTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'openalex-search'", () => {
      expect(tool.id).toBe("openalex-search");
    });

    it("should belong to the 'information' category", () => {
      expect(tool.category).toBe("information");
    });

    it("should have academic-related tags", () => {
      expect(tool.tags).toContain("academic");
      expect(tool.tags).toContain("openalex");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true for a valid non-empty query", () => {
      expect(tool.validateInput({ query: "large language models" })).toBe(true);
    });

    it("should return false for an empty query string", () => {
      expect(tool.validateInput({ query: "" })).toBe(false);
    });

    it("should return false for a whitespace-only query", () => {
      expect(tool.validateInput({ query: "   " })).toBe(false);
    });

    it("should return true with all optional params provided", () => {
      expect(
        tool.validateInput({
          query: "transformer",
          maxResults: 5,
          year: "2020-2024",
          sortByCitations: true,
        }),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    it("should search papers successfully", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      const input: OpenAlexSearchInput = {
        query: "attention mechanism",
      };
      const result: ToolResult<OpenAlexSearchOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.papers).toHaveLength(1);
      expect(result.data?.totalResults).toBe(500);
      expect(result.data?.query).toBe("attention mechanism");

      const paper = result.data?.papers[0];
      expect(paper?.id).toBe("W12345");
      expect(paper?.title).toBe("Attention Is All You Need");
      expect(paper?.authors).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
      expect(paper?.abstract).toBe("The dominant sequence transduction models");
      expect(paper?.year).toBe(2017);
      expect(paper?.citationCount).toBe(95000);
      expect(paper?.doi).toBe("10.48550/arXiv.1706.03762");
      expect(paper?.url).toBe("https://openalex.org/W12345");
      expect(paper?.openAccessUrl).toBe("https://arxiv.org/pdf/1706.03762");
      expect(paper?.source).toBe("NeurIPS");
      expect(paper?.type).toBe("article");
    });

    it("should include mailto in API request for polite pool when configured", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(
        "researcher@university.edu",
      );
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      await tool.execute({ query: "AI" }, makeContext());

      expect(mockPolicyDataService.getApiKey).toHaveBeenCalledWith(
        "openalex-search",
      );
      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.openalex.org/works",
        expect.objectContaining({ mailto: "researcher@university.edu" }),
      );
    });

    it("should omit mailto when no key is configured", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      await tool.execute({ query: "AI" }, makeContext());

      const callParams = mockPolicyDataService.httpGet.mock
        .calls[0]?.[1] as Record<string, unknown>;
      expect(callParams).not.toHaveProperty("mailto");
    });

    it("should return empty results gracefully when API returns no data", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue({
        results: [],
        meta: { count: 0, per_page: 10 },
      });

      const result = await tool.execute(
        { query: "xyzzy-nonexistent" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.papers).toHaveLength(0);
      expect(result.data?.totalResults).toBe(0);
    });

    it("should respect maxResults parameter and cap it at 200", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      await tool.execute(
        { query: "machine learning", maxResults: 50 },
        makeContext(),
      );

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.openalex.org/works",
        expect.objectContaining({ per_page: 50 }),
      );
    });

    it("should cap maxResults at 200 when value exceeds maximum", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      await tool.execute(
        { query: "neural networks", maxResults: 500 },
        makeContext(),
      );

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.openalex.org/works",
        expect.objectContaining({ per_page: 200 }),
      );
    });

    it("should filter by single year when year is provided", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      await tool.execute(
        { query: "reinforcement learning", year: "2024" },
        makeContext(),
      );

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.openalex.org/works",
        expect.objectContaining({ filter: "publication_year:2024" }),
      );
    });

    it("should filter by year range when year range is provided", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      await tool.execute(
        { query: "climate change", year: "2020-2024" },
        makeContext(),
      );

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.openalex.org/works",
        expect.objectContaining({ filter: "publication_year:2020-2024" }),
      );
    });

    it("should not include filter param when year is not provided", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      // 2026-05-13: timeRange="all" 保留无 filter 契约。
      // resolveEffectiveTimeRange 兜底 365d 时会注入 publication_year 过滤。
      await tool.execute(
        { query: "quantum computing", timeRange: "all" },
        makeContext(),
      );

      const callParams = mockPolicyDataService.httpGet.mock
        .calls[0][1] as Record<string, unknown>;
      expect(callParams).not.toHaveProperty("filter");
    });

    it("should sort by citations when sortByCitations is true", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      await tool.execute(
        { query: "deep learning", sortByCitations: true },
        makeContext(),
      );

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.openalex.org/works",
        expect.objectContaining({ sort: "cited_by_count:desc" }),
      );
    });

    it("should not include sort param when sortByCitations is false", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      await tool.execute(
        { query: "deep learning", sortByCitations: false },
        makeContext(),
      );

      const callParams = mockPolicyDataService.httpGet.mock
        .calls[0][1] as Record<string, unknown>;
      expect(callParams).not.toHaveProperty("sort");
    });

    it("should handle missing optional fields in API response gracefully", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue({
        results: [
          {
            id: "https://openalex.org/W99999",
            title: "Minimal Paper",
            // authorships, abstract_inverted_index, year, citations all missing
          },
        ],
        meta: { count: 1, per_page: 10 },
      });

      const result = await tool.execute(
        { query: "partial data" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.papers).toHaveLength(1);

      const paper = result.data?.papers[0];
      expect(paper?.id).toBe("W99999");
      expect(paper?.title).toBe("Minimal Paper");
      expect(paper?.authors).toEqual([]);
      expect(paper?.abstract).toBe("");
      expect(paper?.year).toBe(0);
      expect(paper?.citationCount).toBe(0);
      expect(paper?.doi).toBeUndefined();
      expect(paper?.openAccessUrl).toBeUndefined();
      expect(paper?.source).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Abstract reconstruction
  // -------------------------------------------------------------------------

  describe("reconstructAbstract()", () => {
    it("should reconstruct abstract from inverted index", () => {
      const invertedIndex = {
        We: [0],
        propose: [1],
        a: [2],
        new: [3],
        method: [4],
      };

      const result = tool.reconstructAbstract(invertedIndex);
      expect(result).toBe("We propose a new method");
    });

    it("should handle words appearing at multiple positions", () => {
      const invertedIndex = {
        the: [0, 4],
        model: [1],
        outperforms: [2],
        all: [3],
        baselines: [5],
      };

      const result = tool.reconstructAbstract(invertedIndex);
      expect(result).toBe("the model outperforms all the baselines");
    });

    it("should return empty string for empty inverted index", () => {
      const result = tool.reconstructAbstract({});
      expect(result).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe("execute() - error path", () => {
    it("should handle API error and return success:false in data", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Network error"),
      );

      const result = await tool.execute(
        { query: "quantum computing" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("OpenAlex 搜索失败");
      expect(result.data?.papers).toHaveLength(0);
      expect(result.data?.totalResults).toBe(0);
    });

    it("should include the original error message in the error field", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Connection refused"),
      );

      const result = await tool.execute({ query: "AI ethics" }, makeContext());

      expect(result.data?.error).toContain("Connection refused");
    });

    it("should preserve the original query in error response", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(new Error("Timeout"));

      const result = await tool.execute(
        { query: "protein folding" },
        makeContext(),
      );

      expect(result.data?.query).toBe("protein folding");
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
        { query: "any" },
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
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      const result = await tool.execute(
        { query: "graph neural networks" },
        makeContext(),
      );

      expect(result.metadata?.executionId).toBe("exec-oa-001");
      expect(result.metadata?.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
