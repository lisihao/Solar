/**
 * Academic Tools - Extended coverage tests
 *
 * Covers paths not hit by base specs:
 *  - PubMedSearchTool: DOI parsing from elocationid, API key usage, clearKeyFailure on success
 *  - OpenAlexSearchTool: doi field, abstract reconstruction, null primary_location, filter paths
 *  - SemanticScholarSearchTool: success with API key (clearKeyFailure), parsePaper optional fields
 */

import { Test, TestingModule } from "@nestjs/testing";
import { PubMedSearchTool } from "../pubmed-search.tool";
import { OpenAlexSearchTool } from "../openalex-search.tool";
import { SemanticScholarSearchTool } from "../semantic-scholar-search.tool";
import { PolicyDataService } from "../../policy/policy-data.service";
import { ToolKeyResolverService } from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";
import { ToolContext } from "../../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "ext-exec",
    toolId: "academic-tool",
    createdAt: new Date(),
    ...overrides,
  };
}

type PolicyServiceMock = jest.Mocked<
  Pick<
    PolicyDataService,
    "httpGet" | "getApiKey" | "clearKeyFailure" | "markKeyFailed"
  >
>;

function createMockPolicy(): PolicyServiceMock {
  return {
    httpGet: jest.fn(),
    getApiKey: jest.fn().mockResolvedValue(null),
    clearKeyFailure: jest.fn(),
    markKeyFailed: jest.fn(),
  };
}

function resetStaticState(ctor: Record<string, unknown>): void {
  ctor["lastRequestTime"] = 0;
  ctor["activeRequests"] = 0;
  ctor["cooldownUntil"] = 0;
  const q = ctor["requestQueue"] as unknown[];
  if (Array.isArray(q)) q.length = 0;
}

// ---------------------------------------------------------------------------
// PubMedSearchTool extended tests
// ---------------------------------------------------------------------------

describe("PubMedSearchTool (extended coverage)", () => {
  let tool: PubMedSearchTool;
  let mockPolicy: PolicyServiceMock;

  const ESEARCH_RESPONSE = {
    esearchresult: { count: "1", idlist: ["11111111"] },
  };

  beforeEach(async () => {
    resetStaticState(PubMedSearchTool as unknown as Record<string, unknown>);
    mockPolicy = createMockPolicy();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PubMedSearchTool,
        { provide: PolicyDataService, useValue: mockPolicy },
      ],
    }).compile();
    tool = module.get(PubMedSearchTool);
  });

  afterEach(() => jest.clearAllMocks());

  it("should extract DOI from elocationid field (doi: pattern)", async () => {
    mockPolicy.httpGet
      .mockResolvedValueOnce(ESEARCH_RESPONSE)
      .mockResolvedValueOnce({
        result: {
          uids: ["11111111"],
          "11111111": {
            uid: "11111111",
            title: "DOI Article",
            authors: [{ name: "Author A" }],
            source: "Nature",
            pubdate: "2024/03/01",
            elocationid: "doi: 10.1038/nature12345",
          },
        },
      });

    const result = await tool.execute({ query: "test" }, makeContext());

    expect(result.success).toBe(true);
    const article = result.data?.articles[0];
    expect(article?.doi).toBe("10.1038/nature12345");
  });

  it("should NOT extract DOI when elocationid lacks doi: pattern (pii format)", async () => {
    mockPolicy.httpGet
      .mockResolvedValueOnce(ESEARCH_RESPONSE)
      .mockResolvedValueOnce({
        result: {
          uids: ["11111111"],
          "11111111": {
            uid: "11111111",
            title: "PII Article",
            authors: [],
            source: "Lancet",
            pubdate: "2024/04/01",
            elocationid: "pii: S0140-6736(24)00001-X",
          },
        },
      });

    const result = await tool.execute({ query: "test" }, makeContext());

    expect(result.success).toBe(true);
    const article = result.data?.articles[0];
    expect(article?.doi).toBeUndefined();
  });

  it("should call clearKeyFailure on successful response with API key", async () => {
    mockPolicy.getApiKey.mockResolvedValue("test-pubmed-key");
    mockPolicy.httpGet
      .mockResolvedValueOnce(ESEARCH_RESPONSE)
      .mockResolvedValueOnce({
        result: {
          uids: ["11111111"],
          "11111111": {
            uid: "11111111",
            title: "Key Article",
            authors: [],
            source: "BMJ",
            pubdate: "2024/01/01",
          },
        },
      });

    await tool.execute({ query: "test" }, makeContext());

    expect(mockPolicy.clearKeyFailure).toHaveBeenCalledWith(
      "pubmed",
      "test-pubmed-key",
    );
  });

  it("should handle missing abstract gracefully (empty string)", async () => {
    mockPolicy.httpGet
      .mockResolvedValueOnce(ESEARCH_RESPONSE)
      .mockResolvedValueOnce({
        result: {
          uids: ["11111111"],
          "11111111": {
            uid: "11111111",
            title: "No Abstract Article",
            authors: [],
            source: "JAMA",
            pubdate: "2024/01/01",
            // abstract is absent
          },
        },
      });

    const result = await tool.execute({ query: "test" }, makeContext());

    expect(result.success).toBe(true);
    expect(result.data?.articles[0].abstract).toBe("");
  });

  it("should handle empty idlist (no results)", async () => {
    mockPolicy.httpGet.mockResolvedValueOnce({
      esearchresult: { count: "0", idlist: [] },
    });

    const result = await tool.execute(
      { query: "very obscure query" },
      makeContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data?.articles).toHaveLength(0);
    expect(result.data?.totalResults).toBe(0);
  });

  it("should pass maxResults as retmax param to httpGet", async () => {
    mockPolicy.httpGet.mockResolvedValueOnce({
      esearchresult: { count: "0", idlist: [] },
    });

    await tool.execute({ query: "test", maxResults: 3 }, makeContext());

    const firstCallParams = mockPolicy.httpGet.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(firstCallParams?.["retmax"]).toBe(3);
  });

  it("should return success:false when esearchData is null", async () => {
    // httpGet returns null to simulate empty response
    mockPolicy.httpGet.mockResolvedValueOnce(null);

    const result = await tool.execute({ query: "test" }, makeContext());

    expect(result.success).toBe(true);
    expect(result.data?.success).toBe(false);
    expect(result.data?.articles).toHaveLength(0);
  });

  it("should include apiKey in params when getApiKey returns a key", async () => {
    mockPolicy.getApiKey.mockResolvedValue("my-api-key");
    mockPolicy.httpGet.mockResolvedValueOnce({
      esearchresult: { count: "0", idlist: [] },
    });

    await tool.execute({ query: "test" }, makeContext());

    const firstCallParams = mockPolicy.httpGet.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(firstCallParams?.["api_key"]).toBe("my-api-key");
  });

  it("should return success:false when esummaryData is null (line 338)", async () => {
    // First httpGet (esearch) returns a result with pmids
    mockPolicy.httpGet
      .mockResolvedValueOnce(ESEARCH_RESPONSE)
      .mockResolvedValueOnce(null); // esummary returns null

    const result = await tool.execute({ query: "test" }, makeContext());

    expect(result.success).toBe(true);
    expect(result.data?.success).toBe(false);
    expect(result.data?.articles).toHaveLength(0);
  });

  it("should call markKeyFailed when API key is set and error occurs (lines 374-376)", async () => {
    mockPolicy.getApiKey.mockResolvedValue("my-pubmed-key");
    mockPolicy.httpGet.mockRejectedValue(new Error("500 Server Error"));

    await tool.execute({ query: "test" }, makeContext());

    expect(mockPolicy.markKeyFailed).toHaveBeenCalledWith(
      "pubmed",
      "my-pubmed-key",
      expect.any(Number),
    );
  });
});

// ---------------------------------------------------------------------------
// OpenAlexSearchTool extended tests
// ---------------------------------------------------------------------------

describe("OpenAlexSearchTool (extended coverage)", () => {
  let tool: OpenAlexSearchTool;
  let mockPolicy: PolicyServiceMock;

  function makeWork(overrides: Record<string, unknown> = {}) {
    return {
      id: "https://openalex.org/W123",
      title: "Default Title",
      publication_year: 2024,
      cited_by_count: 10,
      authorships: [{ author: { display_name: "Author One" } }],
      primary_location: {
        source: { display_name: "Nature" },
        landing_page_url: "https://nature.com/article",
      },
      open_access: { is_oa: true, oa_url: "https://open.access/article" },
      abstract_inverted_index: null,
      doi: "10.1234/test",
      ...overrides,
    };
  }

  beforeEach(async () => {
    resetStaticState(OpenAlexSearchTool as unknown as Record<string, unknown>);
    mockPolicy = createMockPolicy();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenAlexSearchTool,
        { provide: PolicyDataService, useValue: mockPolicy },
      ],
    }).compile();
    tool = module.get(OpenAlexSearchTool);
  });

  afterEach(() => jest.clearAllMocks());

  it("should handle works with doi field present", async () => {
    mockPolicy.httpGet.mockResolvedValue({
      results: [makeWork({ doi: "https://doi.org/10.9999/test-doi" })],
      meta: { count: 1 },
    });

    const result = await tool.execute(
      { query: "machine learning" },
      makeContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data?.papers[0].doi).toBe("10.9999/test-doi");
  });

  it("should reconstruct abstract from inverted index when present", async () => {
    // abstract_inverted_index is an inverted word→positions map
    const invertedIndex: Record<string, number[]> = {
      Machine: [0],
      learning: [1],
      is: [2],
      powerful: [3],
    };

    mockPolicy.httpGet.mockResolvedValue({
      results: [makeWork({ abstract_inverted_index: invertedIndex })],
      meta: { count: 1 },
    });

    const result = await tool.execute({ query: "test" }, makeContext());

    expect(result.success).toBe(true);
    const abstract = result.data?.papers[0].abstract;
    expect(abstract).toBeDefined();
    expect(abstract).toContain("Machine");
  });

  it("should handle works with no primary_location (null)", async () => {
    mockPolicy.httpGet.mockResolvedValue({
      results: [makeWork({ primary_location: null })],
      meta: { count: 1 },
    });

    const result = await tool.execute({ query: "test" }, makeContext());

    expect(result.success).toBe(true);
    const paper = result.data?.papers[0];
    // source should be undefined when no primary_location
    expect(paper?.source).toBeUndefined();
  });

  it("should pass maxResults as per_page param to httpGet", async () => {
    mockPolicy.httpGet.mockResolvedValue({
      results: [],
      meta: { count: 0 },
    });

    await tool.execute({ query: "test", maxResults: 7 }, makeContext());

    const params = mockPolicy.httpGet.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(params?.["per_page"]).toBe(7);
  });

  it("should apply year filter as single year", async () => {
    mockPolicy.httpGet.mockResolvedValue({ results: [], meta: { count: 0 } });

    await tool.execute({ query: "test", year: "2023" }, makeContext());

    const params = mockPolicy.httpGet.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(params?.["filter"]).toContain("2023");
  });

  it("should apply year filter as range", async () => {
    mockPolicy.httpGet.mockResolvedValue({ results: [], meta: { count: 0 } });

    await tool.execute({ query: "test", year: "2020-2024" }, makeContext());

    const params = mockPolicy.httpGet.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(params?.["filter"]).toContain("2020");
    expect(params?.["filter"]).toContain("2024");
  });

  it("should sort by citations when sortByCitations=true", async () => {
    mockPolicy.httpGet.mockResolvedValue({ results: [], meta: { count: 0 } });

    await tool.execute({ query: "test", sortByCitations: true }, makeContext());

    const params = mockPolicy.httpGet.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(params?.["sort"]).toContain("cited_by_count");
  });

  it("should handle error response and return success:false", async () => {
    mockPolicy.httpGet.mockRejectedValue(new Error("Network error"));

    const result = await tool.execute({ query: "test" }, makeContext());

    expect(result.success).toBe(true);
    expect(result.data?.success).toBe(false);
    expect(result.data?.papers).toHaveLength(0);
  });

  it("should return empty works when API returns null results", async () => {
    mockPolicy.httpGet.mockResolvedValue({ meta: { count: 0 } });

    const result = await tool.execute({ query: "obscure" }, makeContext());

    expect(result.success).toBe(true);
    expect(result.data?.papers).toHaveLength(0);
  });

  it("should call clearKeyFailure on success with API key (mailto)", async () => {
    mockPolicy.getApiKey.mockResolvedValue("user@example.com");
    mockPolicy.httpGet.mockResolvedValue({
      results: [makeWork()],
      meta: { count: 1 },
    });

    await tool.execute({ query: "test" }, makeContext());

    expect(mockPolicy.clearKeyFailure).toHaveBeenCalledWith(
      "openalex-search",
      "user@example.com",
    );
  });

  it("should mark key as failed when non-429 error occurs with API key (lines 335-337)", async () => {
    mockPolicy.getApiKey.mockResolvedValue("admin@example.com");
    mockPolicy.httpGet.mockRejectedValue(
      new Error("500 Internal Server Error"),
    );

    await tool.execute({ query: "test" }, makeContext());

    expect(mockPolicy.markKeyFailed).toHaveBeenCalledWith(
      "openalex-search",
      "admin@example.com",
      expect.any(Number),
    );
  });

  it("should use cooldownUntil to skip expired cooldown (static state reset)", async () => {
    // Ensure cooldown is in the past (already reset in beforeEach)
    mockPolicy.httpGet.mockResolvedValue({ results: [], meta: { count: 0 } });

    const result = await tool.execute({ query: "no cooldown" }, makeContext());

    expect(result.success).toBe(true);
    expect(result.data?.papers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SemanticScholarSearchTool extended tests
// ---------------------------------------------------------------------------

describe("SemanticScholarSearchTool (extended coverage)", () => {
  let tool: SemanticScholarSearchTool;
  let mockPolicy: PolicyServiceMock;

  function makeApiResponse(papers: unknown[] = []) {
    return {
      data: papers,
      total: papers.length,
    };
  }

  function makePaper(overrides: Record<string, unknown> = {}) {
    return {
      paperId: "abc123",
      title: "Test Paper",
      authors: [{ name: "Author X" }],
      abstract: "This is the abstract",
      year: 2023,
      citationCount: 42,
      url: "https://semanticscholar.org/paper/abc123",
      externalIds: { ArXiv: "2301.00001", DOI: "10.1234/test" },
      ...overrides,
    };
  }

  beforeEach(async () => {
    resetStaticState(
      SemanticScholarSearchTool as unknown as Record<string, unknown>,
    );
    mockPolicy = createMockPolicy();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SemanticScholarSearchTool,
        { provide: PolicyDataService, useValue: mockPolicy },
        {
          provide: ToolKeyResolverService,
          useValue: { resolveToolKey: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();
    tool = module.get(SemanticScholarSearchTool);
  });

  afterEach(() => jest.clearAllMocks());

  it("should return papers with arxivId and doi from externalIds", async () => {
    mockPolicy.httpGet.mockResolvedValue(makeApiResponse([makePaper()]));

    const result = await tool.execute({ query: "transformers" }, makeContext());

    expect(result.success).toBe(true);
    const paper = result.data?.papers[0];
    expect(paper?.arxivId).toBe("2301.00001");
    expect(paper?.doi).toBe("10.1234/test");
  });

  it("should handle paper with no externalIds (no arxivId/doi)", async () => {
    mockPolicy.httpGet.mockResolvedValue(
      makeApiResponse([makePaper({ externalIds: null })]),
    );

    const result = await tool.execute({ query: "test" }, makeContext());

    const paper = result.data?.papers[0];
    expect(paper?.arxivId).toBeUndefined();
    expect(paper?.doi).toBeUndefined();
  });

  it("should call clearKeyFailure on success with API key", async () => {
    mockPolicy.getApiKey.mockResolvedValue("ss-api-key");
    mockPolicy.httpGet.mockResolvedValue(makeApiResponse([makePaper()]));

    await tool.execute({ query: "test" }, makeContext());

    expect(mockPolicy.clearKeyFailure).toHaveBeenCalledWith(
      "semantic-scholar",
      "ss-api-key",
    );
  });

  it("should return success:false when responseData is null (retry exhausted)", async () => {
    // httpGet returns null to simulate empty response after retry
    mockPolicy.httpGet.mockResolvedValue(null);

    const result = await tool.execute({ query: "test" }, makeContext());

    expect(result.success).toBe(true);
    expect(result.data?.success).toBe(false);
    expect(result.data?.papers).toHaveLength(0);
  });

  it("should use x-api-key header when API key is provided", async () => {
    mockPolicy.getApiKey.mockResolvedValue("my-ss-key");
    mockPolicy.httpGet.mockResolvedValue(makeApiResponse([]));

    await tool.execute({ query: "test" }, makeContext());

    const headers = mockPolicy.httpGet.mock.calls[0][2] as Record<
      string,
      string
    >;
    expect(headers?.["x-api-key"]).toBe("my-ss-key");
  });

  it("should parse paper with no url (construct from paperId)", async () => {
    mockPolicy.httpGet.mockResolvedValue(
      makeApiResponse([makePaper({ url: undefined })]),
    );

    const result = await tool.execute({ query: "test" }, makeContext());

    const paper = result.data?.papers[0];
    expect(paper?.url).toContain("abc123");
  });

  it("should handle non-Error thrown from httpGet", async () => {
    mockPolicy.httpGet.mockRejectedValue("string error thrown");

    const result = await tool.execute({ query: "test" }, makeContext());

    expect(result.success).toBe(true);
    expect(result.data?.success).toBe(false);
    expect(result.data?.error).toContain("Unknown error");
  });

  it("should pass maxResults as limit param to httpGet", async () => {
    mockPolicy.httpGet.mockResolvedValue(makeApiResponse([]));

    await tool.execute({ query: "test", maxResults: 7 }, makeContext());

    const params = mockPolicy.httpGet.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(params?.["limit"]).toBe(7);
  });

  it("should mark key as failed on non-429 error when API key is set", async () => {
    mockPolicy.getApiKey.mockResolvedValue("fail-key");
    mockPolicy.httpGet.mockRejectedValue(new Error("Network error"));

    const result = await tool.execute({ query: "test" }, makeContext());

    expect(result.data?.success).toBe(false);
    expect(mockPolicy.markKeyFailed).toHaveBeenCalledWith(
      "semantic-scholar",
      "fail-key",
      expect.any(Number),
    );
  });

  it("should apply year filter in request params", async () => {
    mockPolicy.httpGet.mockResolvedValue(makeApiResponse([]));

    await tool.execute({ query: "test", year: "2022" }, makeContext());

    const params = mockPolicy.httpGet.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(params?.["year"]).toBe("2022");
  });
});
