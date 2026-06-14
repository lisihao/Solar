/**
 * WhiteHouseNewsTool Unit Tests
 *
 * Tests the whitehouse-news tool in isolation by mocking SearchService
 * and PolicyDataService.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  WhiteHouseNewsTool,
  WhiteHouseNewsOutput,
} from "../whitehouse-news.tool";
import { SearchService } from "../../../../../content/web-search/web-search.service";
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
    executionId: "exec-wh-001",
    toolId: "whitehouse-news",
    createdAt: new Date(),
    ...overrides,
  };
}

function makePageContent(items: Array<{ title: string; url: string }>) {
  return items.map(({ title, url }) => `[${title}](${url})`).join("\n\n");
}

function makeSearchServiceResult(success = true, content?: string) {
  return {
    success,
    content: content ?? "",
    url: "https://www.whitehouse.gov/news/",
  };
}

// ---------------------------------------------------------------------------
// Mock Services
// ---------------------------------------------------------------------------

type SearchServiceMock = Pick<SearchService, "fetchUrlContent">;

function createMockSearchService(): jest.Mocked<SearchServiceMock> {
  return {
    fetchUrlContent: jest.fn(),
  };
}

type PolicyDataServiceMock = Pick<
  PolicyDataService,
  "httpGet" | "getApiKey" | "formatDate"
>;

function createMockPolicyDataService(): jest.Mocked<PolicyDataServiceMock> {
  return {
    httpGet: jest.fn(),
    getApiKey: jest.fn().mockResolvedValue(null),
    formatDate: jest.fn().mockReturnValue("2024-01-15"),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("WhiteHouseNewsTool", () => {
  let tool: WhiteHouseNewsTool;
  let mockSearchService: jest.Mocked<SearchServiceMock>;
  let mockPolicyDataService: jest.Mocked<PolicyDataServiceMock>;

  beforeEach(async () => {
    mockSearchService = createMockSearchService();
    mockPolicyDataService = createMockPolicyDataService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhiteHouseNewsTool,
        { provide: SearchService, useValue: mockSearchService },
        { provide: PolicyDataService, useValue: mockPolicyDataService },
      ],
    }).compile();

    tool = module.get<WhiteHouseNewsTool>(WhiteHouseNewsTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'whitehouse-news'", () => {
      expect(tool.id).toBe("whitehouse-news");
    });

    it("should belong to the 'information' category", () => {
      expect(tool.category).toBe("information");
    });

    it("should include policy-related tags", () => {
      expect(tool.tags).toContain("policy");
      expect(tool.tags).toContain("whitehouse");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should always return true (no required fields)", () => {
      expect(tool.validateInput({})).toBe(true);
    });

    it("should return true with all fields provided", () => {
      expect(
        tool.validateInput({
          query: "infrastructure",
          contentType: "statements",
          limit: 5,
        }),
      ).toBe(true);
    });

    it("should return true with no fields (latest news mode)", () => {
      expect(tool.validateInput({})).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path - content parsing
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    it("should return success:true with parsed items from page content", async () => {
      const content = makePageContent([
        {
          title: "President Signs New Infrastructure Bill",
          url: "https://www.whitehouse.gov/briefing-room/statements-releases/2024/01/15/president-signs-new-infrastructure-bill/",
        },
        {
          title: "Press Briefing by Secretary",
          url: "https://www.whitehouse.gov/briefing-room/press-briefings/2024/01/15/press-briefing-by-secretary/",
        },
      ]);

      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeSearchServiceResult(true, content),
      );

      const result: ToolResult<WhiteHouseNewsOutput> = await tool.execute(
        { contentType: "all" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.items.length).toBeGreaterThan(0);
      expect(result.data?.source).toBe("whitehouse.gov");
    });

    it("should filter out navigation links from parsed content", async () => {
      const content = makePageContent([
        {
          title: "Skip to main content",
          url: "https://www.whitehouse.gov/briefing-room/statements-releases/2024/01/15/test/#main",
        },
        {
          title: "Real News Article",
          url: "https://www.whitehouse.gov/briefing-room/statements-releases/2024/01/15/real-news/",
        },
      ]);

      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeSearchServiceResult(true, content),
      );

      const result = await tool.execute(
        { contentType: "statements" },
        makeContext(),
      );

      const items = result.data?.items || [];
      const hasSkipLink = items.some((item) =>
        item.title.toLowerCase().includes("skip"),
      );
      expect(hasSkipLink).toBe(false);
    });

    it("should infer Statement type from URL pattern", async () => {
      const content = makePageContent([
        {
          title: "Statement on Climate",
          url: "https://www.whitehouse.gov/briefing-room/statements-releases/2024/01/15/statement-on-climate/",
        },
      ]);

      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeSearchServiceResult(true, content),
      );

      const result = await tool.execute({ query: "climate" }, makeContext());

      const item = result.data?.items[0];
      expect(item?.type).toBe("Statement");
    });

    it("should infer Press Briefing type from URL pattern", async () => {
      const content = makePageContent([
        {
          title: "Daily Briefing",
          url: "https://www.whitehouse.gov/briefing-room/press-briefings/2024/01/15/daily-briefing/",
        },
      ]);

      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeSearchServiceResult(true, content),
      );

      const result = await tool.execute(
        { contentType: "press-briefings" },
        makeContext(),
      );

      const item = result.data?.items[0];
      expect(item?.type).toBe("Press Briefing");
    });

    it("should extract date from URL when available", async () => {
      const content = makePageContent([
        {
          title: "Presidential Action Announcement",
          url: "https://www.whitehouse.gov/briefing-room/presidential-actions/2024/03/21/test-order/",
        },
      ]);

      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeSearchServiceResult(true, content),
      );

      const result = await tool.execute(
        { contentType: "presidential-actions" },
        makeContext(),
      );

      const item = result.data?.items[0];
      expect(item?.date).toBe("2024-03-21");
    });

    it("should use query-based search URL when query is provided", async () => {
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeSearchServiceResult(true, ""),
      );

      await tool.execute({ query: "immigration" }, makeContext());

      const calledUrl = mockSearchService.fetchUrlContent.mock.calls[0][0];
      expect(calledUrl).toContain("immigration");
      expect(calledUrl).toContain("whitehouse.gov");
    });

    it("should respect limit parameter on returned items", async () => {
      const manyLinks = Array.from({ length: 20 }, (_, i) => ({
        title: `Article ${i + 1}`,
        url: `https://www.whitehouse.gov/briefing-room/statements-releases/2024/01/${String(i + 1).padStart(2, "0")}/article-${i + 1}/`,
      }));

      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeSearchServiceResult(true, makePageContent(manyLinks)),
      );

      const result = await tool.execute(
        { contentType: "statements", limit: 5 },
        makeContext(),
      );

      expect(result.data?.items.length).toBeLessThanOrEqual(5);
    });
  });

  // -------------------------------------------------------------------------
  // Fallback to Federal Register
  // -------------------------------------------------------------------------

  describe("execute() - fallback to Federal Register", () => {
    it("should fallback to Federal Register for executive-orders when page fetch fails", async () => {
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeSearchServiceResult(false, ""),
      );

      mockPolicyDataService.httpGet.mockResolvedValue({
        count: 5,
        results: [
          {
            title: "Executive Order 14110",
            abstract: "On safe AI",
            publication_date: "2024-01-10",
            html_url: "https://www.federalregister.gov/documents/2024-14110",
            subtype: "Executive Order",
            executive_order_number: "14110",
          },
        ],
      });

      const result = await tool.execute(
        { contentType: "executive-orders" },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.source).toContain("Federal Register");
      expect(result.data?.items.length).toBeGreaterThan(0);
    });

    it("should return error when both page fetch and fallback fail", async () => {
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeSearchServiceResult(false),
      );

      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Federal Register also down"),
      );

      const result = await tool.execute(
        { contentType: "executive-orders" },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe("execute() - error path", () => {
    it("should return success:false when SearchService throws for non-EO content", async () => {
      mockSearchService.fetchUrlContent.mockRejectedValue(
        new Error("Fetch error"),
      );

      const result = await tool.execute(
        { contentType: "press-briefings" },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("白宫新闻获取失败");
    });

    it("should return empty items on fetch failure", async () => {
      mockSearchService.fetchUrlContent.mockRejectedValue(
        new Error("Network error"),
      );

      const result = await tool.execute(
        { contentType: "statements" },
        makeContext(),
      );

      expect(result.data?.items).toHaveLength(0);
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
        { contentType: "all" },
        makeContext({ signal: controller.signal }),
      );

      expect(result.success).toBe(false);
      expect(mockSearchService.fetchUrlContent).not.toHaveBeenCalled();
    });
  });
});
