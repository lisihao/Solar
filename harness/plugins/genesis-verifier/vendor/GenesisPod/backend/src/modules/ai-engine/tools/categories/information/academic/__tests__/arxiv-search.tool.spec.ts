/**
 * ArxivSearchTool Unit Tests
 *
 * ★ 2026-05-01 改写：底层从直连 ArXiv API 切到 OpenAlex API
 * (filter=primary_location.source.id:S4306400194)。
 * 测试 mock OpenAlex JSON 响应而非 ArXiv XML。
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  ArxivSearchTool,
  ArxivSearchInput,
  ArxivSearchOutput,
} from "../arxiv-search.tool";
import { PolicyDataService } from "../../policy/policy-data.service";
import {
  ToolContext,
  ToolResult,
} from "../../../../abstractions/tool.interface";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-arxiv-001",
    toolId: "arxiv-search",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeOpenAlexWork(idx: number) {
  // 用 ViT 论文（2010.11929）作为基准，按 idx 改 ID
  const arxivId = `2401.0${idx + 1}000`;
  return {
    id: `https://openalex.org/W30945022${28 + idx}`,
    title: `Test Paper ${idx + 1}: Advances in Machine Learning`,
    display_name: `Test Paper ${idx + 1}`,
    authorships: [
      { author: { display_name: "John Doe" } },
      { author: { display_name: "Jane Smith" } },
    ],
    abstract_inverted_index: {
      Test: [0],
      paper: [1],
      abstract: [2],
      content: [3],
    },
    publication_year: 2024,
    publication_date: `2024-01-${String(idx + 1).padStart(2, "0")}`,
    doi: `https://doi.org/10.48550/arxiv.${arxivId}`,
    primary_location: {
      source: {
        id: "https://openalex.org/S4306400194",
        display_name: "arXiv (Cornell University)",
      },
      landing_page_url: `http://arxiv.org/abs/${arxivId}`,
      pdf_url: `https://arxiv.org/pdf/${arxivId}`,
    },
    open_access: {
      oa_url: `https://arxiv.org/pdf/${arxivId}`,
    },
    topics: [
      {
        display_name: "Computer Vision",
        subfield: { display_name: "cs.CV" },
      },
      {
        display_name: "Machine Learning",
        subfield: { display_name: "cs.LG" },
      },
    ],
    updated_date: `2024-02-${String(idx + 1).padStart(2, "0")}`,
    created_date: `2024-01-${String(idx + 1).padStart(2, "0")}`,
  };
}

function makeOpenAlexResponse(paperCount = 1) {
  return {
    meta: { count: 109_000, db_response_time_ms: 25, page: 1, per_page: 10 },
    results: Array.from({ length: paperCount }, (_, i) => makeOpenAlexWork(i)),
  };
}

type PolicyDataServiceMock = Pick<PolicyDataService, "httpGet" | "getApiKey">;

function createMockPolicyDataService(): jest.Mocked<PolicyDataServiceMock> {
  return {
    httpGet: jest.fn(),
    getApiKey: jest.fn().mockResolvedValue(null),
  };
}

describe("ArxivSearchTool (via OpenAlex)", () => {
  let tool: ArxivSearchTool;
  let mockPolicyDataService: jest.Mocked<PolicyDataServiceMock>;

  beforeEach(async () => {
    ArxivSearchTool.resetCircuitForTesting();
    mockPolicyDataService = createMockPolicyDataService();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ArxivSearchTool,
        { provide: PolicyDataService, useValue: mockPolicyDataService },
      ],
    }).compile();
    tool = moduleRef.get<ArxivSearchTool>(ArxivSearchTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
    ArxivSearchTool.resetCircuitForTesting();
  });

  describe("tool metadata", () => {
    it("has id 'arxiv-search'", () => {
      expect(tool.id).toBe("arxiv-search");
    });
    it("has 'information' category and arxiv tags", () => {
      expect(tool.category).toBe("information");
      expect(tool.tags).toContain("arxiv");
      expect(tool.tags).toContain("academic");
    });
  });

  describe("validateInput()", () => {
    it("accepts non-empty query", () => {
      expect(tool.validateInput({ query: "machine learning" })).toBe(true);
    });
    it("rejects empty / whitespace-only query", () => {
      expect(tool.validateInput({ query: "" })).toBe(false);
      expect(tool.validateInput({ query: "   " })).toBe(false);
    });
  });

  describe("execute() - success path (OpenAlex backend)", () => {
    it("returns papers from OpenAlex ArXiv-filtered results", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeOpenAlexResponse(2));
      const input: ArxivSearchInput = { query: "machine learning" };
      const result: ToolResult<ArxivSearchOutput> = await tool.execute(
        input,
        makeContext(),
      );
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.papers).toHaveLength(2);
      expect(result.data?.totalResults).toBe(109_000);
    });

    it("calls OpenAlex API with correct base URL + filter", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeOpenAlexResponse(0));
      // 2026-05-13: timeRange="all" 保留无 from_publication_date 的 filter 契约。
      // resolveEffectiveTimeRange 兜底 365d 时会注入日期过滤，与本用例无关。
      await tool.execute(
        { query: "transformer", timeRange: "all" },
        makeContext(),
      );
      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.openalex.org/works",
        expect.objectContaining({
          search: "transformer",
          filter: "primary_location.source.id:S4306400194",
        }),
      );
    });

    it("populates paper fields (id, title, authors, abstract, urls)", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeOpenAlexResponse(1));
      const result = await tool.execute({ query: "x" }, makeContext());
      const paper = result.data?.papers[0];
      expect(paper).toBeDefined();
      expect(paper?.id).toMatch(/^2401\.\d+/);
      expect(paper?.title).toContain("Test Paper");
      expect(paper?.authors).toContain("John Doe");
      expect(paper?.authors).toContain("Jane Smith");
      expect(paper?.abstract).toContain("Test"); // reconstructed from inverted index
      expect(paper?.pdfUrl).toMatch(/arxiv\.org\/pdf\//);
      expect(paper?.arxivUrl).toMatch(/^https:\/\/arxiv\.org\/abs\//);
    });

    it("reconstructs abstract from abstract_inverted_index in correct order", async () => {
      const w = makeOpenAlexWork(0);
      w.abstract_inverted_index = { hello: [0], world: [1], "!": [2] };
      mockPolicyDataService.httpGet.mockResolvedValue({
        meta: { count: 1 },
        results: [w],
      });
      const r = await tool.execute({ query: "x" }, makeContext());
      expect(r.data?.papers[0].abstract).toBe("hello world !");
    });

    it("respects maxResults (caps at 100)", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeOpenAlexResponse(0));
      await tool.execute({ query: "x", maxResults: 999 }, makeContext());
      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ per_page: 100 }),
      );
    });

    it("respects custom maxResults below cap", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeOpenAlexResponse(0));
      await tool.execute({ query: "x", maxResults: 7 }, makeContext());
      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ per_page: 7 }),
      );
    });

    it("translates sortBy=submittedDate to OpenAlex sort=publication_date:desc", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeOpenAlexResponse(0));
      await tool.execute(
        { query: "x", sortBy: "submittedDate" },
        makeContext(),
      );
      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ sort: "publication_date:desc" }),
      );
    });

    it("translates sortBy=lastUpdatedDate to OpenAlex sort=updated_date:desc", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeOpenAlexResponse(0));
      await tool.execute(
        { query: "x", sortBy: "lastUpdatedDate" },
        makeContext(),
      );
      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ sort: "updated_date:desc" }),
      );
    });

    it("includes mailto when openalex-api-key is configured", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(
        "researcher@example.com",
      );
      mockPolicyDataService.httpGet.mockResolvedValue(makeOpenAlexResponse(0));
      await tool.execute({ query: "x" }, makeContext());
      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ mailto: "researcher@example.com" }),
      );
    });

    it("filters out non-ArXiv results (no arxivId in landing_page_url)", async () => {
      const w = makeOpenAlexWork(0);
      w.primary_location.landing_page_url = "https://random.example.com/paper";
      w.open_access.oa_url = undefined as unknown as string;
      w.doi = "https://doi.org/10.1234/something";
      mockPolicyDataService.httpGet.mockResolvedValue({
        meta: { count: 1 },
        results: [w],
      });
      const r = await tool.execute({ query: "x" }, makeContext());
      expect(r.data?.papers).toHaveLength(0);
    });
  });

  describe("execute() - error path", () => {
    it("returns success:false on OpenAlex network error", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Network error"),
      );
      const result = await tool.execute({ query: "test" }, makeContext());
      expect(result.success).toBe(true); // BaseTool wraps
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("ArXiv 搜索失败");
      expect(result.data?.papers).toHaveLength(0);
    });

    it("preserves original error message", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Connection refused"),
      );
      const r = await tool.execute({ query: "x" }, makeContext());
      expect(r.data?.error).toContain("Connection refused");
    });
  });

  describe("execute() - circuit breaker", () => {
    it("opens circuit after 3 consecutive failures", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(new Error("API down"));

      // 3 consecutive failures
      await tool.execute({ query: "q1" }, makeContext());
      await tool.execute({ query: "q2" }, makeContext());
      await tool.execute({ query: "q3" }, makeContext());

      // 4th call should be short-circuited (no httpGet call)
      mockPolicyDataService.httpGet.mockClear();
      const r = await tool.execute({ query: "q4" }, makeContext());

      expect(mockPolicyDataService.httpGet).not.toHaveBeenCalled();
      expect(r.data?.success).toBe(false);
      expect(r.data?.error).toContain("熔断");
    });

    it("resets failure counter on successful call", async () => {
      mockPolicyDataService.httpGet
        .mockRejectedValueOnce(new Error("transient 1"))
        .mockRejectedValueOnce(new Error("transient 2"))
        .mockResolvedValueOnce(makeOpenAlexResponse(1)); // success resets

      await tool.execute({ query: "q1" }, makeContext());
      await tool.execute({ query: "q2" }, makeContext());
      await tool.execute({ query: "q3" }, makeContext()); // success resets counter

      // Now 2 more failures should NOT trip circuit (only 2 consecutive, counter was reset)
      mockPolicyDataService.httpGet
        .mockRejectedValueOnce(new Error("again 1"))
        .mockRejectedValueOnce(new Error("again 2"));
      await tool.execute({ query: "q4" }, makeContext());
      await tool.execute({ query: "q5" }, makeContext());

      // Circuit should still be closed
      mockPolicyDataService.httpGet.mockClear();
      mockPolicyDataService.httpGet.mockResolvedValue(makeOpenAlexResponse(0));
      await tool.execute({ query: "q6" }, makeContext());
      expect(mockPolicyDataService.httpGet).toHaveBeenCalled();
    });
  });

  describe("execute() - cancellation", () => {
    it("aborts immediately when signal pre-aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const r = await tool.execute(
        { query: "x" },
        makeContext({ signal: controller.signal }),
      );
      expect(r.success).toBe(false);
      expect(mockPolicyDataService.httpGet).not.toHaveBeenCalled();
    });
  });

  describe("execute() - result metadata", () => {
    it("includes executionId + duration", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeOpenAlexResponse(1));
      const r = await tool.execute({ query: "x" }, makeContext());
      expect(r.metadata?.executionId).toBe("exec-arxiv-001");
      expect(r.metadata?.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
