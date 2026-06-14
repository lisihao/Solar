/**
 * FederalRegisterTool Unit Tests
 *
 * Tests the federal-register tool in isolation by mocking PolicyDataService.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 * No API Key required (public API).
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  FederalRegisterTool,
  FederalRegisterOutput,
} from "../federal-register.tool";
import { PolicyDataService } from "../policy-data.service";
import {
  ToolContext,
  ToolResult,
} from "../../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-fr-001",
    toolId: "federal-register",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeFrApiDocument(overrides: Record<string, unknown> = {}) {
  return {
    document_number: "2024-12345",
    title: "Clean Air Standards Final Rule",
    abstract: "This rule establishes new standards for air quality.",
    type: "RULE",
    agencies: [{ name: "Environmental Protection Agency", slug: "epa" }],
    publication_date: "2024-01-15",
    html_url:
      "https://www.federalregister.gov/documents/2024/01/15/2024-12345/clean-air-standards",
    pdf_url:
      "https://www.federalregister.gov/documents/2024/01/15/2024-12345/clean-air-standards.pdf",
    subtype: undefined,
    executive_order_number: undefined,
    signing_date: undefined,
    ...overrides,
  };
}

function makeFrApiResponse(docCount = 1) {
  return {
    count: 500,
    results: Array.from({ length: docCount }, (_, i) =>
      makeFrApiDocument({
        document_number: `2024-${10000 + i}`,
        title: `Federal Document ${i + 1}`,
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Mock PolicyDataService
// ---------------------------------------------------------------------------

type PolicyDataServiceMock = Pick<PolicyDataService, "httpGet" | "getApiKey">;

function createMockPolicyDataService(): jest.Mocked<PolicyDataServiceMock> {
  return {
    httpGet: jest.fn(),
    getApiKey: jest.fn().mockResolvedValue(null),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("FederalRegisterTool", () => {
  let tool: FederalRegisterTool;
  let mockPolicyDataService: jest.Mocked<PolicyDataServiceMock>;

  beforeEach(async () => {
    mockPolicyDataService = createMockPolicyDataService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FederalRegisterTool,
        { provide: PolicyDataService, useValue: mockPolicyDataService },
      ],
    }).compile();

    tool = module.get<FederalRegisterTool>(FederalRegisterTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'federal-register'", () => {
      expect(tool.id).toBe("federal-register");
    });

    it("should belong to the 'information' category", () => {
      expect(tool.category).toBe("information");
    });

    it("should include policy-related tags", () => {
      expect(tool.tags).toContain("policy");
      expect(tool.tags).toContain("regulation");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true when query is provided", () => {
      expect(tool.validateInput({ query: "air quality" })).toBe(true);
    });

    it("should return true when documentType is provided", () => {
      expect(tool.validateInput({ documentType: "RULE" })).toBe(true);
    });

    it("should return true when agency is provided", () => {
      expect(tool.validateInput({ agency: "EPA" })).toBe(true);
    });

    it("should return true when startDate is provided", () => {
      expect(tool.validateInput({ startDate: "2024-01-01" })).toBe(true);
    });

    it("should return false when no search condition is provided", () => {
      expect(tool.validateInput({})).toBe(false);
    });

    it("should return true when only endDate is provided (no startDate)", () => {
      // Only startDate is checked in validateInput
      expect(tool.validateInput({ endDate: "2024-12-31" })).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    it("should return success:true with documents array", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeFrApiResponse(3));

      const result: ToolResult<FederalRegisterOutput> = await tool.execute(
        { query: "climate regulations" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.documents).toHaveLength(3);
      expect(result.data?.totalCount).toBe(500);
    });

    it("should map API fields to correct output shape", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeFrApiResponse(1));

      const result = await tool.execute({ query: "EPA" }, makeContext());

      const doc = result.data?.documents[0];
      expect(doc?.documentNumber).toBe("2024-10000");
      expect(doc?.type).toBe("RULE");
      expect(doc?.agencies).toContain("Environmental Protection Agency");
      expect(doc?.publicationDate).toBe("2024-01-15");
      expect(doc?.htmlUrl).toContain("federalregister.gov");
      expect(doc?.pdfUrl).toBeDefined();
    });

    it("should include correct query parameter for keyword search", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeFrApiResponse(0));

      await tool.execute({ query: "clean energy" }, makeContext());

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://www.federalregister.gov/api/v1/documents.json",
        expect.objectContaining({ "conditions[term]": "clean energy" }),
      );
    });

    it("should pass fields as an ARRAY param (fields[]), not a comma-joined string", async () => {
      // ★ 2026-05-25: FR API 强制 fields 数组参数；逗号 join 会被拒 HTTP 400。
      mockPolicyDataService.httpGet.mockResolvedValue(makeFrApiResponse(0));

      await tool.execute({ query: "x" }, makeContext());

      const calledParams = mockPolicyDataService.httpGet.mock.calls[0][1] as {
        "fields[]"?: unknown;
        fields?: unknown;
      };
      expect(Array.isArray(calledParams["fields[]"])).toBe(true);
      expect(calledParams["fields[]"]).toContain("title");
      expect(calledParams["fields[]"]).toContain("publication_date");
      // old broken single comma-joined `fields` must be gone
      expect(calledParams.fields).toBeUndefined();
    });

    it("should pass documentType as array parameter", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeFrApiResponse(0));

      await tool.execute(
        { documentType: "PRESDOC", query: "executive" },
        makeContext(),
      );

      const calledParams = mockPolicyDataService.httpGet.mock
        .calls[0][1] as Record<string, string>;
      // 2026-05-13 #46: 单值用 conditions[type]，不带 brackets
      expect(calledParams?.["conditions[type]"]).toBe("PRESDOC");
    });

    it("should pass agency filter correctly", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeFrApiResponse(0));

      await tool.execute({ agency: "DOE" }, makeContext());

      const calledParams = mockPolicyDataService.httpGet.mock
        .calls[0][1] as Record<string, string>;
      // 2026-05-13 #46: 单值用 conditions[agencies]，不带 brackets
      expect(calledParams?.["conditions[agencies]"]).toBe("DOE");
    });

    it("should pass date range parameters correctly", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeFrApiResponse(0));

      await tool.execute(
        { startDate: "2024-01-01", endDate: "2024-12-31" },
        makeContext(),
      );

      const calledParams = mockPolicyDataService.httpGet.mock
        .calls[0][1] as Record<string, string>;
      expect(calledParams?.["conditions[publication_date][gte]"]).toBe(
        "2024-01-01",
      );
      expect(calledParams?.["conditions[publication_date][lte]"]).toBe(
        "2024-12-31",
      );
    });

    it("should sort by relevance when sortByRelevance is true", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeFrApiResponse(0));

      await tool.execute(
        { query: "test", sortByRelevance: true },
        makeContext(),
      );

      const calledParams = mockPolicyDataService.httpGet.mock
        .calls[0][1] as Record<string, string>;
      expect(calledParams?.order).toBe("relevance");
    });

    it("should default to 'newest' sort order", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeFrApiResponse(0));

      await tool.execute({ query: "test" }, makeContext());

      const calledParams = mockPolicyDataService.httpGet.mock
        .calls[0][1] as Record<string, string>;
      expect(calledParams?.order).toBe("newest");
    });

    it("should cap maxResults at 100", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeFrApiResponse(0));

      await tool.execute({ query: "test", maxResults: 999 }, makeContext());

      const calledParams = mockPolicyDataService.httpGet.mock
        .calls[0][1] as Record<string, string>;
      expect(Number(calledParams?.per_page)).toBe(100);
    });

    it("should handle multiple documentTypes via array", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeFrApiResponse(0));

      await tool.execute({ documentType: ["RULE", "NOTICE"] }, makeContext());

      const calledParams = mockPolicyDataService.httpGet.mock
        .calls[0][1] as Record<string, unknown>;
      // ★ 2026-05-25: 多值用重复 key 数组（逗号 join 会被 FR API 当单个无效 type
      //   → 静默 count:0）。serializer 把数组展开为 conditions[type][]=RULE&...=NOTICE。
      expect(calledParams["conditions[type][]"]).toEqual(["RULE", "NOTICE"]);
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe("execute() - error path", () => {
    it("should return data.success=false when httpGet throws", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Service unavailable"),
      );

      const result = await tool.execute({ query: "test" }, makeContext());

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Federal Register 搜索失败");
    });

    it("should return empty documents on error", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(new Error("Timeout"));

      const result = await tool.execute({ query: "test" }, makeContext());

      expect(result.data?.documents).toHaveLength(0);
      expect(result.data?.totalCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  describe("execute() - cancellation", () => {
    it("should return success:false when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute(
        { query: "test" },
        makeContext({ signal: controller.signal }),
      );

      expect(result.success).toBe(false);
      expect(mockPolicyDataService.httpGet).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Executive Order fields
  // -------------------------------------------------------------------------

  describe("execute() - presidential documents", () => {
    it("should include executiveOrderNumber when present", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue({
        count: 1,
        results: [
          makeFrApiDocument({
            type: "PRESDOC",
            subtype: "Executive Order",
            executive_order_number: "14110",
            signing_date: "2024-01-10",
          }),
        ],
      });

      const result = await tool.execute(
        { documentType: "PRESDOC" },
        makeContext(),
      );

      expect(result.data?.documents[0].executiveOrderNumber).toBe("14110");
      expect(result.data?.documents[0].signingDate).toBe("2024-01-10");
      expect(result.data?.documents[0].subtype).toBe("Executive Order");
    });
  });
});
