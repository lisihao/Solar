/**
 * SemanticScholarSearchTool Unit Tests
 *
 * Tests the semantic-scholar-search tool in isolation by mocking PolicyDataService.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  SemanticScholarSearchTool,
  SemanticScholarSearchInput,
  SemanticScholarSearchOutput,
} from "../semantic-scholar-search.tool";
import { PolicyDataService } from "../../policy/policy-data.service";
import { ToolKeyResolverService } from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";
import { RequestContext } from "@/common/context/request-context";
import {
  ToolContext,
  ToolResult,
} from "../../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-ss-001",
    toolId: "semantic-scholar",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeMockApiResponse(
  overrides: Partial<{ total: number; data: unknown[] }> = {},
) {
  return {
    total: 100,
    data: [
      {
        paperId: "abc123",
        title: "Deep Learning for NLP",
        authors: [{ name: "John Doe" }, { name: "Jane Smith" }],
        abstract: "This paper explores...",
        year: 2024,
        citationCount: 42,
        url: "https://www.semanticscholar.org/paper/abc123",
        externalIds: { ArXiv: "2401.12345", DOI: "10.1234/test" },
      },
    ],
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

const mockToolKeyResolverService = {
  resolveToolKey: jest.fn().mockResolvedValue(null),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SemanticScholarSearchTool", () => {
  let tool: SemanticScholarSearchTool;
  let mockPolicyDataService: jest.Mocked<PolicyDataServiceMock>;

  beforeEach(async () => {
    // Reset static rate limiter state so tests do not interfere with each other
    (SemanticScholarSearchTool as unknown as Record<string, unknown>)[
      "cooldownUntil"
    ] = 0;
    (SemanticScholarSearchTool as unknown as Record<string, unknown>)[
      "activeRequests"
    ] = 0;
    (SemanticScholarSearchTool as unknown as Record<string, unknown>)[
      "lastRequestTime"
    ] = 0;
    const queue = (
      SemanticScholarSearchTool as unknown as Record<string, unknown>
    )["requestQueue"] as unknown[];
    queue.length = 0;

    // Default: no userId (system path)
    jest.spyOn(RequestContext, "getUserId").mockReturnValue(undefined);
    mockToolKeyResolverService.resolveToolKey.mockResolvedValue(null);

    mockPolicyDataService = createMockPolicyDataService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SemanticScholarSearchTool,
        { provide: PolicyDataService, useValue: mockPolicyDataService },
        {
          provide: ToolKeyResolverService,
          useValue: mockToolKeyResolverService,
        },
      ],
    }).compile();

    tool = module.get<SemanticScholarSearchTool>(SemanticScholarSearchTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'semantic-scholar'", () => {
      expect(tool.id).toBe("semantic-scholar");
    });

    it("should belong to the 'information' category", () => {
      expect(tool.category).toBe("information");
    });

    it("should have academic-related tags", () => {
      expect(tool.tags).toContain("academic");
      expect(tool.tags).toContain("semantic-scholar");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true for a valid non-empty query", () => {
      expect(tool.validateInput({ query: "deep learning" })).toBe(true);
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
          fields: "title,authors",
          year: "2020-2024",
        }),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    it("should search papers successfully without API key", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      const input: SemanticScholarSearchInput = {
        query: "deep learning for NLP",
      };
      const result: ToolResult<SemanticScholarSearchOutput> =
        await tool.execute(input, makeContext());

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.papers).toHaveLength(1);
      expect(result.data?.totalResults).toBe(100);
      expect(result.data?.query).toBe("deep learning for NLP");

      const paper = result.data?.papers[0];
      expect(paper?.paperId).toBe("abc123");
      expect(paper?.title).toBe("Deep Learning for NLP");
      expect(paper?.authors).toEqual(["John Doe", "Jane Smith"]);
      expect(paper?.abstract).toBe("This paper explores...");
      expect(paper?.year).toBe(2024);
      expect(paper?.citationCount).toBe(42);
      expect(paper?.url).toBe("https://www.semanticscholar.org/paper/abc123");
      expect(paper?.arxivId).toBe("2401.12345");
      expect(paper?.doi).toBe("10.1234/test");
    });

    it("should search papers with API key and pass x-api-key header", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("my-ss-api-key");
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      const result = await tool.execute({ query: "CRISPR" }, makeContext());

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        expect.any(Object),
        expect.objectContaining({ "x-api-key": "my-ss-api-key" }),
      );
    });

    it("should return empty results gracefully when API returns no data", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
      mockPolicyDataService.httpGet.mockResolvedValue({ data: [], total: 0 });

      const result = await tool.execute(
        { query: "xyzzy-nonexistent-topic" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.papers).toHaveLength(0);
      expect(result.data?.totalResults).toBe(0);
    });

    it("should respect maxResults parameter and cap it at 100", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      await tool.execute(
        { query: "machine learning", maxResults: 25 },
        makeContext(),
      );

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        expect.objectContaining({ limit: 25 }),
        expect.any(Object),
      );
    });

    it("should cap maxResults at 100 when value exceeds maximum", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      await tool.execute(
        { query: "neural networks", maxResults: 500 },
        makeContext(),
      );

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        expect.objectContaining({ limit: 100 }),
        expect.any(Object),
      );
    });

    it("should filter by year range when year parameter is provided", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      await tool.execute(
        { query: "reinforcement learning", year: "2022-2024" },
        makeContext(),
      );

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        expect.objectContaining({ year: "2022-2024" }),
        expect.any(Object),
      );
    });

    it("should not include year param in request when year is not provided", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      // 2026-05-13: timeRange="all" 保留无 year 参数契约。
      // resolveEffectiveTimeRange 兜底 365d 时会注入 effectiveYear。
      await tool.execute(
        { query: "attention mechanism", timeRange: "all" },
        makeContext(),
      );

      const callParams = mockPolicyDataService.httpGet.mock
        .calls[0][1] as Record<string, unknown>;
      expect(callParams).not.toHaveProperty("year");
    });

    it("should handle missing optional fields in API response gracefully", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
      mockPolicyDataService.httpGet.mockResolvedValue({
        total: 1,
        data: [
          {
            paperId: "def456",
            title: "Minimal Paper",
            // authors, abstract, year, citationCount, url, externalIds all missing
          },
        ],
      });

      const result = await tool.execute(
        { query: "partial data" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.papers).toHaveLength(1);

      const paper = result.data?.papers[0];
      expect(paper?.paperId).toBe("def456");
      expect(paper?.title).toBe("Minimal Paper");
      expect(paper?.authors).toEqual([]);
      expect(paper?.abstract).toBe("");
      expect(paper?.year).toBe(0);
      expect(paper?.citationCount).toBe(0);
      // url falls back to constructed URL from paperId
      expect(paper?.url).toContain("def456");
      expect(paper?.arxivId).toBeUndefined();
      expect(paper?.doi).toBeUndefined();
    });

    it("should not add x-api-key header when no API key is available", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      await tool.execute({ query: "biomedical" }, makeContext());

      const callHeaders = mockPolicyDataService.httpGet.mock
        .calls[0][2] as Record<string, unknown>;
      expect(callHeaders).not.toHaveProperty("x-api-key");
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe("execute() - error path", () => {
    it("should handle API error and return success:false in data", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Network error"),
      );

      const result = await tool.execute(
        { query: "quantum computing" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Semantic Scholar 搜索失败");
      expect(result.data?.papers).toHaveLength(0);
      expect(result.data?.totalResults).toBe(0);
    });

    it("should include the original error message in the error field", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Connection refused"),
      );

      const result = await tool.execute({ query: "AI ethics" }, makeContext());

      expect(result.data?.error).toContain("Connection refused");
    });

    it("should preserve the original query in error response", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
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
  // BYOK path
  // -------------------------------------------------------------------------

  describe("execute() - BYOK resolveApiKey", () => {
    it("uses ToolKeyResolverService when userId is present", async () => {
      jest.spyOn(RequestContext, "getUserId").mockReturnValue("user-byok");
      mockToolKeyResolverService.resolveToolKey.mockResolvedValue({
        value: "byok-ss-key",
        source: "user",
        secretName: "semantic-scholar-api-key",
      });
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      const result = await tool.execute({ query: "byok test" }, makeContext());

      expect(mockToolKeyResolverService.resolveToolKey).toHaveBeenCalledWith(
        "semantic-scholar",
        "user-byok",
      );
      expect(mockPolicyDataService.getApiKey).not.toHaveBeenCalled();
      expect(result.data?.success).toBe(true);
    });

    it("falls back to PolicyDataService.getApiKey when no userId is present", async () => {
      jest.spyOn(RequestContext, "getUserId").mockReturnValue(undefined);
      mockPolicyDataService.getApiKey.mockResolvedValue("admin-ss-key");
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      await tool.execute({ query: "admin test" }, makeContext());

      expect(mockPolicyDataService.getApiKey).toHaveBeenCalledWith(
        "semantic-scholar",
      );
      expect(mockToolKeyResolverService.resolveToolKey).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Result metadata
  // -------------------------------------------------------------------------

  describe("execute() - result metadata", () => {
    it("should include executionId in result metadata", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      const result = await tool.execute(
        { query: "graph neural networks" },
        makeContext(),
      );

      expect(result.metadata?.executionId).toBe("exec-ss-001");
      expect(result.metadata?.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
