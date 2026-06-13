/**
 * CongressGovTool Unit Tests
 *
 * Tests the congress-gov tool in isolation by mocking PolicyDataService.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { CongressGovTool, CongressGovOutput } from "../congress-gov.tool";
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
    executionId: "exec-congress-001",
    toolId: "congress-gov",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeCongressApiBill(overrides: Record<string, unknown> = {}) {
  return {
    number: "1234",
    type: "HR",
    congress: 118,
    title: "An Act to Test Things",
    shortTitle: "Test Act",
    latestAction: { actionDate: "2024-01-15", text: "Passed House" },
    introducedDate: "2023-03-01",
    sponsors: [{ fullName: "Rep. John Doe" }],
    url: "https://www.congress.gov/bill/118th-congress/house-bill/1234",
    policyArea: { name: "Science and Technology" },
    committees: { item: [{ name: "Committee on Science" }] },
    ...overrides,
  };
}

function makeCongressApiResponse(billCount = 1) {
  return {
    bills: Array.from({ length: billCount }, (_, i) =>
      makeCongressApiBill({
        number: String(1000 + i),
        title: `Test Bill ${i + 1}`,
      }),
    ),
    pagination: { count: 500 },
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
    getApiKey: jest.fn(),
    clearKeyFailure: jest.fn(),
    markKeyFailed: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("CongressGovTool", () => {
  let tool: CongressGovTool;
  let mockPolicyDataService: jest.Mocked<PolicyDataServiceMock>;

  beforeEach(async () => {
    mockPolicyDataService = createMockPolicyDataService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CongressGovTool,
        { provide: PolicyDataService, useValue: mockPolicyDataService },
      ],
    }).compile();

    tool = module.get<CongressGovTool>(CongressGovTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'congress-gov'", () => {
      expect(tool.id).toBe("congress-gov");
    });

    it("should belong to the 'information' category", () => {
      expect(tool.category).toBe("information");
    });

    it("should include policy-related tags", () => {
      expect(tool.tags).toContain("policy");
      expect(tool.tags).toContain("legislation");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true when query is provided", () => {
      expect(tool.validateInput({ query: "AI regulation" })).toBe(true);
    });

    it("should return true when congress is provided", () => {
      expect(tool.validateInput({ congress: 118 })).toBe(true);
    });

    it("should return true when billType is provided", () => {
      expect(tool.validateInput({ billType: "hr" })).toBe(true);
    });

    it("should return true when billNumber is provided", () => {
      expect(tool.validateInput({ billNumber: "hr1234" })).toBe(true);
    });

    it("should return true when subject is provided", () => {
      expect(tool.validateInput({ subject: "Health" })).toBe(true);
    });

    it("should return false when no search condition is provided", () => {
      expect(tool.validateInput({})).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // API Key requirement
  // -------------------------------------------------------------------------

  describe("execute() - API key handling", () => {
    it("should return success:false with error message when no API key", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);

      const result: ToolResult<CongressGovOutput> = await tool.execute(
        { query: "climate" },
        makeContext(),
      );

      expect(result.success).toBe(true); // outer success since doExecute returns error object
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Congress.gov API Key");
      expect(mockPolicyDataService.httpGet).not.toHaveBeenCalled();
    });

    it("should proceed with API call when key is available", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("test_api_key");
      mockPolicyDataService.httpGet.mockResolvedValue(
        makeCongressApiResponse(2),
      );

      const result = await tool.execute({ query: "climate" }, makeContext());

      expect(result.data?.success).toBe(true);
      expect(mockPolicyDataService.httpGet).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    beforeEach(() => {
      mockPolicyDataService.getApiKey.mockResolvedValue("valid_key");
    });

    it("should return success:true with bills array", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        makeCongressApiResponse(3),
      );

      const result = await tool.execute({ query: "AI" }, makeContext());

      expect(result.data?.success).toBe(true);
      expect(result.data?.bills).toHaveLength(3);
      expect(result.data?.totalCount).toBe(500);
    });

    it("should map bill fields correctly", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        makeCongressApiResponse(1),
      );

      const result = await tool.execute({ query: "test" }, makeContext());

      const bill = result.data?.bills[0];
      expect(bill?.number).toMatch(/HR\.\d+/);
      expect(bill?.title).toBeDefined();
      expect(bill?.congress).toBe(118);
      expect(bill?.introducedDate).toBeDefined();
      expect(bill?.sponsors).toContain("Rep. John Doe");
      expect(bill?.policyArea).toBe("Science and Technology");
    });

    it("should handle billType array filter in URL construction", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        makeCongressApiResponse(0),
      );

      await tool.execute(
        { query: "AI", billType: "hr", congress: 118 },
        makeContext(),
      );

      const calledUrl = mockPolicyDataService.httpGet.mock.calls[0][0];
      expect(calledUrl).toContain("/hr");
    });

    it("should handle billNumber to construct specific bill URL", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue({
        bills: [makeCongressApiBill()],
        pagination: { count: 1 },
      });

      await tool.execute(
        { congress: 118, billNumber: "hr1234" },
        makeContext(),
      );

      const calledUrl = mockPolicyDataService.httpGet.mock.calls[0][0];
      expect(calledUrl).toContain("/bill/118/hr/1234");
    });

    it("should return error for invalid bill number format", async () => {
      const result = await tool.execute(
        { billNumber: "invalidformat" },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("无效的法案编号格式");
    });

    it("should strip Chinese characters from query with sanitizeQuery", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(
        makeCongressApiResponse(0),
      );

      await tool.execute({ query: "人工智能 AI regulation" }, makeContext());

      const calledParams = mockPolicyDataService.httpGet.mock
        .calls[0][1] as Record<string, string>;
      expect(calledParams?.q).not.toMatch(/[\u4e00-\u9fff]/);
      expect(calledParams?.q).toContain("AI regulation");
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe("execute() - error path", () => {
    beforeEach(() => {
      mockPolicyDataService.getApiKey.mockResolvedValue("valid_key");
    });

    it("should return success:false in data when httpGet throws", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Network failure"),
      );

      const result = await tool.execute({ query: "test" }, makeContext());

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Congress.gov 搜索失败");
    });

    it("should return empty bills array on error", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(new Error("Timeout"));

      const result = await tool.execute({ query: "bills" }, makeContext());

      expect(result.data?.bills).toHaveLength(0);
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
        { query: "AI" },
        makeContext({ signal: controller.signal }),
      );

      expect(result.success).toBe(false);
      expect(mockPolicyDataService.getApiKey).not.toHaveBeenCalled();
    });
  });
});
