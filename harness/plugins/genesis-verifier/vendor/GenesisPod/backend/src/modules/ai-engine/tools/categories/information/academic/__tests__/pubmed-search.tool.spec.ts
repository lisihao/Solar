/**
 * PubMedSearchTool Unit Tests
 *
 * Tests the pubmed-search tool in isolation by mocking PolicyDataService.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  PubMedSearchTool,
  PubMedSearchInput,
  PubMedSearchOutput,
} from "../pubmed-search.tool";
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
    executionId: "exec-pubmed-001",
    toolId: "pubmed",
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock API responses
// ---------------------------------------------------------------------------

const MOCK_ESEARCH_RESPONSE = {
  esearchresult: {
    count: "42",
    idlist: ["12345678", "87654321"],
  },
};

const MOCK_ESUMMARY_RESPONSE = {
  result: {
    uids: ["12345678", "87654321"],
    "12345678": {
      uid: "12345678",
      title: "CRISPR Gene Editing Advances",
      authors: [{ name: "Smith J" }, { name: "Doe A" }],
      fulljournalname: "Nature Medicine",
      source: "Nat Med",
      pubdate: "2024/01/15 00:00",
      sortpubdate: "2024/01/15 00:00",
      elocationid: "doi: 10.1038/nm.12345",
    },
    "87654321": {
      uid: "87654321",
      title: "mRNA Vaccine Development",
      authors: [{ name: "Brown K" }],
      fulljournalname: "Science",
      source: "Science",
      pubdate: "2024/02/01 00:00",
      sortpubdate: "2024/02/01 00:00",
      elocationid: "pii: S0140-6736(24)00123-4",
    },
  },
};

const ESEARCH_URL =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const ESUMMARY_URL =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

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

describe("PubMedSearchTool", () => {
  let tool: PubMedSearchTool;
  let mockPolicyDataService: jest.Mocked<PolicyDataServiceMock>;

  beforeEach(async () => {
    // Reset static rate-limiter state between tests to avoid interference
    (PubMedSearchTool as unknown as Record<string, unknown>)[
      "lastRequestTime"
    ] = 0;
    (PubMedSearchTool as unknown as Record<string, unknown>)["activeRequests"] =
      0;
    (PubMedSearchTool as unknown as Record<string, unknown>)["cooldownUntil"] =
      0;
    const queue = (PubMedSearchTool as unknown as Record<string, unknown>)[
      "requestQueue"
    ] as unknown[];
    queue.length = 0;

    mockPolicyDataService = createMockPolicyDataService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PubMedSearchTool,
        { provide: PolicyDataService, useValue: mockPolicyDataService },
      ],
    }).compile();

    tool = module.get<PubMedSearchTool>(PubMedSearchTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'pubmed'", () => {
      expect(tool.id).toBe("pubmed");
    });

    it("should belong to the 'information' category", () => {
      expect(tool.category).toBe("information");
    });

    it("should have pubmed-related tags", () => {
      expect(tool.tags).toContain("academic");
      expect(tool.tags).toContain("pubmed");
      expect(tool.tags).toContain("medical");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true for a valid non-empty query", () => {
      expect(tool.validateInput({ query: "cancer immunotherapy" })).toBe(true);
    });

    it("should return false for an empty query string", () => {
      expect(tool.validateInput({ query: "" })).toBe(false);
    });

    it("should return false for a whitespace-only query", () => {
      expect(tool.validateInput({ query: "   " })).toBe(false);
    });

    it("should return true with optional params provided", () => {
      expect(
        tool.validateInput({
          query: "COVID-19 vaccine",
          maxResults: 20,
          sortBy: "date",
          minDate: "2020/01/01",
          maxDate: "2024/12/31",
        }),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    it("should search articles successfully", async () => {
      mockPolicyDataService.httpGet.mockImplementation((url: string) => {
        if (url === ESEARCH_URL) {
          return Promise.resolve(MOCK_ESEARCH_RESPONSE);
        }
        return Promise.resolve(MOCK_ESUMMARY_RESPONSE);
      });

      const input: PubMedSearchInput = { query: "cancer immunotherapy" };
      const result: ToolResult<PubMedSearchOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.articles).toHaveLength(2);
      expect(result.data?.totalResults).toBe(42);
      expect(result.data?.query).toBe("cancer immunotherapy");
    });

    it("should populate article fields correctly from esummary response", async () => {
      mockPolicyDataService.httpGet.mockImplementation((url: string) => {
        if (url === ESEARCH_URL) {
          return Promise.resolve(MOCK_ESEARCH_RESPONSE);
        }
        return Promise.resolve(MOCK_ESUMMARY_RESPONSE);
      });

      const result = await tool.execute({ query: "CRISPR" }, makeContext());

      const article = result.data?.articles[0];
      expect(article).toBeDefined();
      expect(article?.pmid).toBe("12345678");
      expect(article?.title).toBe("CRISPR Gene Editing Advances");
      expect(article?.authors).toContain("Smith J");
      expect(article?.authors).toContain("Doe A");
      expect(article?.journal).toBe("Nat Med");
      expect(article?.publishedDate).toBe("2024/01/15 00:00");
      expect(article?.pubmedUrl).toBe(
        "https://pubmed.ncbi.nlm.nih.gov/12345678/",
      );
    });

    it("should return empty results when esearch idlist is empty", async () => {
      mockPolicyDataService.httpGet.mockImplementation((url: string) => {
        if (url === ESEARCH_URL) {
          return Promise.resolve({
            esearchresult: {
              count: "0",
              idlist: [],
            },
          });
        }
        return Promise.resolve(MOCK_ESUMMARY_RESPONSE);
      });

      const result = await tool.execute({ query: "xyzzy12345" }, makeContext());

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.articles).toHaveLength(0);
      expect(result.data?.totalResults).toBe(0);
      // esummary should NOT be called when there are no PMIDs
      expect(mockPolicyDataService.httpGet).toHaveBeenCalledTimes(1);
    });

    it("should call both esearch and esummary endpoints in order", async () => {
      const callOrder: string[] = [];

      mockPolicyDataService.httpGet.mockImplementation((url: string) => {
        callOrder.push(url);
        if (url === ESEARCH_URL) {
          return Promise.resolve(MOCK_ESEARCH_RESPONSE);
        }
        return Promise.resolve(MOCK_ESUMMARY_RESPONSE);
      });

      await tool.execute({ query: "mRNA vaccine" }, makeContext());

      expect(callOrder[0]).toBe(ESEARCH_URL);
      expect(callOrder[1]).toBe(ESUMMARY_URL);
    });

    it("should pass API key as query param when available", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("test-api-key-123");
      mockPolicyDataService.httpGet.mockImplementation((url: string) => {
        if (url === ESEARCH_URL) {
          return Promise.resolve(MOCK_ESEARCH_RESPONSE);
        }
        return Promise.resolve(MOCK_ESUMMARY_RESPONSE);
      });

      await tool.execute({ query: "gene therapy" }, makeContext());

      // API key should be in both esearch and esummary calls
      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        ESEARCH_URL,
        expect.objectContaining({ api_key: "test-api-key-123" }),
      );
      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        ESUMMARY_URL,
        expect.objectContaining({ api_key: "test-api-key-123" }),
      );
    });

    it("should work without API key", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
      mockPolicyDataService.httpGet.mockImplementation((url: string) => {
        if (url === ESEARCH_URL) {
          return Promise.resolve(MOCK_ESEARCH_RESPONSE);
        }
        return Promise.resolve(MOCK_ESUMMARY_RESPONSE);
      });

      const result = await tool.execute({ query: "COVID-19" }, makeContext());

      expect(result.data?.success).toBe(true);
      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        ESEARCH_URL,
        expect.not.objectContaining({ api_key: expect.anything() }),
      );
    });

    it("should parse DOI from elocationid field", async () => {
      mockPolicyDataService.httpGet.mockImplementation((url: string) => {
        if (url === ESEARCH_URL) {
          return Promise.resolve(MOCK_ESEARCH_RESPONSE);
        }
        return Promise.resolve(MOCK_ESUMMARY_RESPONSE);
      });

      const result = await tool.execute({ query: "CRISPR" }, makeContext());

      // Article 12345678 has a valid doi: prefix
      const articleWithDoi = result.data?.articles.find(
        (a) => a.pmid === "12345678",
      );
      expect(articleWithDoi?.doi).toBe("10.1038/nm.12345");

      // Article 87654321 has pii: prefix — no DOI should be extracted
      const articleWithPii = result.data?.articles.find(
        (a) => a.pmid === "87654321",
      );
      expect(articleWithPii?.doi).toBeUndefined();
    });

    it("should pass sort parameter correctly for date sort", async () => {
      mockPolicyDataService.httpGet.mockImplementation((url: string) => {
        if (url === ESEARCH_URL) {
          return Promise.resolve({
            esearchresult: { count: "0", idlist: [] },
          });
        }
        return Promise.resolve(MOCK_ESUMMARY_RESPONSE);
      });

      await tool.execute({ query: "MRSA", sortBy: "date" }, makeContext());

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        ESEARCH_URL,
        expect.objectContaining({ sort: "pub+date" }),
      );
    });

    it("should pass sort parameter correctly for relevance sort", async () => {
      mockPolicyDataService.httpGet.mockImplementation((url: string) => {
        if (url === ESEARCH_URL) {
          return Promise.resolve({
            esearchresult: { count: "0", idlist: [] },
          });
        }
        return Promise.resolve(MOCK_ESUMMARY_RESPONSE);
      });

      await tool.execute({ query: "MRSA", sortBy: "relevance" }, makeContext());

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        ESEARCH_URL,
        expect.objectContaining({ sort: "relevance" }),
      );
    });

    it("should include date params when minDate and maxDate are provided", async () => {
      mockPolicyDataService.httpGet.mockImplementation((url: string) => {
        if (url === ESEARCH_URL) {
          return Promise.resolve({
            esearchresult: { count: "0", idlist: [] },
          });
        }
        return Promise.resolve(MOCK_ESUMMARY_RESPONSE);
      });

      await tool.execute(
        {
          query: "Alzheimer",
          minDate: "2020/01/01",
          maxDate: "2024/12/31",
        },
        makeContext(),
      );

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        ESEARCH_URL,
        expect.objectContaining({
          mindate: "2020/01/01",
          maxdate: "2024/12/31",
          datetype: "pdat",
        }),
      );
    });

    it("should cap maxResults at 100", async () => {
      mockPolicyDataService.httpGet.mockImplementation((url: string) => {
        if (url === ESEARCH_URL) {
          return Promise.resolve({
            esearchresult: { count: "0", idlist: [] },
          });
        }
        return Promise.resolve(MOCK_ESUMMARY_RESPONSE);
      });

      await tool.execute({ query: "cancer", maxResults: 999 }, makeContext());

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        ESEARCH_URL,
        expect.objectContaining({ retmax: 100 }),
      );
    });

    it("should construct correct pubmedUrl for each article", async () => {
      mockPolicyDataService.httpGet.mockImplementation((url: string) => {
        if (url === ESEARCH_URL) {
          return Promise.resolve(MOCK_ESEARCH_RESPONSE);
        }
        return Promise.resolve(MOCK_ESUMMARY_RESPONSE);
      });

      const result = await tool.execute({ query: "test" }, makeContext());

      result.data?.articles.forEach((article) => {
        expect(article.pubmedUrl).toBe(
          `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`,
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe("execute() - error path", () => {
    it("should handle API error on esearch gracefully", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Network connection failed"),
      );

      const result = await tool.execute({ query: "test" }, makeContext());

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("PubMed 搜索失败");
      expect(result.data?.error).toContain("Network connection failed");
      expect(result.data?.articles).toHaveLength(0);
      expect(result.data?.totalResults).toBe(0);
    });

    it("should handle API error on esummary gracefully", async () => {
      mockPolicyDataService.httpGet.mockImplementation((url: string) => {
        if (url === ESEARCH_URL) {
          return Promise.resolve(MOCK_ESEARCH_RESPONSE);
        }
        return Promise.reject(new Error("esummary service unavailable"));
      });

      const result = await tool.execute({ query: "test" }, makeContext());

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("PubMed 搜索失败");
      expect(result.data?.error).toContain("esummary service unavailable");
      expect(result.data?.articles).toHaveLength(0);
    });

    it("should preserve the query in error response", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(new Error("timeout"));

      const result = await tool.execute(
        { query: "Parkinson disease" },
        makeContext(),
      );

      expect(result.data?.query).toBe("Parkinson disease");
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
      mockPolicyDataService.httpGet.mockImplementation((url: string) => {
        if (url === ESEARCH_URL) {
          return Promise.resolve(MOCK_ESEARCH_RESPONSE);
        }
        return Promise.resolve(MOCK_ESUMMARY_RESPONSE);
      });

      const result = await tool.execute({ query: "stem cells" }, makeContext());

      expect(result.metadata?.executionId).toBe("exec-pubmed-001");
      expect(result.metadata?.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
