/**
 * WebScraperTool Unit Tests
 *
 * Tests the web-scraper tool in isolation using manual mocks for SearchService.
 * All tests call tool.execute(input, context) to exercise the full BaseTool
 * lifecycle (signal check → doExecute → result wrapping).
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  WebScraperTool,
  WebScraperInput,
  WebScraperOutput,
} from "../web-scraper.tool";
import { SearchService } from "../../../../../content/web-search/web-search.service";
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
    executionId: "exec-002",
    toolId: "web-scraper",
    createdAt: new Date(),
    ...overrides,
  };
}

/** Return value shape of SearchService.fetchUrlContent */
interface FetchUrlContentResult {
  success: boolean;
  title?: string;
  content?: string;
  error?: string;
}

/** Build a successful fetchUrlContent response */
function makeFetchSuccess(
  title: string,
  content: string,
): FetchUrlContentResult {
  return { success: true, title, content };
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

describe("WebScraperTool", () => {
  let tool: WebScraperTool;
  let mockSearchService: jest.Mocked<SearchServiceMock>;

  beforeEach(async () => {
    mockSearchService = createMockSearchService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebScraperTool,
        { provide: SearchService, useValue: mockSearchService },
      ],
    }).compile();

    tool = module.get<WebScraperTool>(WebScraperTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'web-scraper'", () => {
      expect(tool.id).toBe("web-scraper");
    });

    it("should belong to the 'information' category", () => {
      expect(tool.category).toBe("information");
    });
  });

  // -------------------------------------------------------------------------
  // Success path
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    it("should return success:true with title and content when fetch succeeds", async () => {
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("My Article Title", "This is the article body."),
      );

      const input: WebScraperInput = { url: "https://example.com/article" };
      const result: ToolResult<WebScraperOutput> = await tool.execute(
        input,
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.title).toBe("My Article Title");
      expect(result.data?.content).toBe("This is the article body.");
      expect(result.data?.url).toBe("https://example.com/article");
    });

    it("should set contentLength to the length of the returned content", async () => {
      const content = "Hello World";
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Title", content),
      );

      const result = await tool.execute(
        { url: "https://example.com" },
        makeContext(),
      );

      expect(result.data?.contentLength).toBe(content.length);
    });

    it("should call fetchUrlContent with the correct URL", async () => {
      const targetUrl = "https://docs.example.com/page";
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Docs Page", "Content"),
      );

      await tool.execute({ url: targetUrl }, makeContext());

      expect(mockSearchService.fetchUrlContent).toHaveBeenCalledWith(targetUrl);
    });

    it("should set url on the output to the original input URL", async () => {
      const targetUrl = "https://blog.example.org/post/123";
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Blog Post", "Body text"),
      );

      const result = await tool.execute({ url: targetUrl }, makeContext());

      expect(result.data?.url).toBe(targetUrl);
    });
  });

  // -------------------------------------------------------------------------
  // maxLength truncation
  // -------------------------------------------------------------------------

  describe("execute() - maxLength content truncation", () => {
    it("should truncate content that exceeds maxLength and append '...'", async () => {
      const longContent = "A".repeat(500);
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Title", longContent),
      );

      const maxLength = 100;
      const result = await tool.execute(
        { url: "https://example.com", maxLength },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      // content should be truncated substring + "..."
      expect(result.data?.content).toBe("A".repeat(100) + "...");
      expect(result.data?.contentLength).toBe(103); // 100 + "...".length
    });

    it("should NOT truncate content that is within maxLength", async () => {
      const shortContent = "Short content";
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Title", shortContent),
      );

      const result = await tool.execute(
        { url: "https://example.com", maxLength: 1000 },
        makeContext(),
      );

      expect(result.data?.content).toBe(shortContent);
      expect(result.data?.contentLength).toBe(shortContent.length);
    });

    it("should apply summary-mode 5K cap by default (no maxLength specified)", async () => {
      // Default extractMode is "summary" → content capped at 5000 chars
      const content = "B".repeat(9999);
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Page", content),
      );

      const result = await tool.execute(
        { url: "https://example.com" },
        makeContext(),
      );

      expect(result.data?.content).toBe("B".repeat(5000));
      expect(result.data?.contentLength).toBe(5000);
    });

    it("should truncate at exactly maxLength boundary", async () => {
      const content = "C".repeat(200);
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Title", content),
      );

      const result = await tool.execute(
        { url: "https://example.com", maxLength: 200 },
        makeContext(),
      );

      // Exactly 200 chars: should NOT be truncated
      expect(result.data?.content).toBe(content);
    });
  });

  // -------------------------------------------------------------------------
  // extractMode — summary / full modes + 8K hard cap
  // -------------------------------------------------------------------------

  describe("execute() - extractMode", () => {
    it("should default to summary mode and cap content at 5000 chars", async () => {
      const content = "X".repeat(10000);
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Title", content),
      );

      const result = await tool.execute(
        { url: "https://example.com" },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.content.length).toBeLessThanOrEqual(5000);
    });

    it("should cap summary mode output at 5K and NOT append '...' (clean slice)", async () => {
      const content = "S".repeat(6000);
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Title", content),
      );

      const result = await tool.execute(
        { url: "https://example.com", extractMode: "summary" },
        makeContext(),
      );

      expect(result.data?.content).toBe("S".repeat(5000));
      expect(result.data?.contentLength).toBe(5000);
    });

    it("should not truncate in summary mode when content is already under 5K", async () => {
      const content = "S".repeat(3000);
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Title", content),
      );

      const result = await tool.execute(
        { url: "https://example.com", extractMode: "summary" },
        makeContext(),
      );

      expect(result.data?.content).toBe(content);
      expect(result.data?.truncated).toBe(false);
    });

    it("should apply 8K hard cap in full mode and set truncated=true", async () => {
      const content = "F".repeat(10000);
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Title", content),
      );

      const result = await tool.execute(
        { url: "https://example.com", extractMode: "full" },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      // 8K cap: content slice(0, 8000) + "\n…[truncated]"
      expect(result.data?.content).toBe("F".repeat(8000) + "\n…[truncated]");
      expect(result.data?.truncated).toBe(true);
      expect(result.data?.originalLength).toBe(10000);
    });

    it("should not truncate in full mode when content is under 8K", async () => {
      const content = "F".repeat(7000);
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Title", content),
      );

      const result = await tool.execute(
        { url: "https://example.com", extractMode: "full" },
        makeContext(),
      );

      expect(result.data?.content).toBe(content);
      expect(result.data?.truncated).toBe(false);
      expect(result.data?.originalLength).toBe(7000);
    });

    it("should append '…[truncated]' to content when 8K cap triggers", async () => {
      const content = "Z".repeat(9000);
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Title", content),
      );

      const result = await tool.execute(
        { url: "https://example.com", extractMode: "full" },
        makeContext(),
      );

      expect(result.data?.content).toMatch(/…\[truncated\]$/);
      expect(result.data?.truncated).toBe(true);
    });

    it("should include originalLength equal to pre-cap length", async () => {
      const content = "A".repeat(9500);
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Title", content),
      );

      const result = await tool.execute(
        { url: "https://example.com", extractMode: "full" },
        makeContext(),
      );

      expect(result.data?.originalLength).toBe(9500);
    });

    it("summary mode: content under 5K should have truncated=false and correct originalLength", async () => {
      const content = "Y".repeat(4000);
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Title", content),
      );

      const result = await tool.execute(
        { url: "https://example.com", extractMode: "summary" },
        makeContext(),
      );

      expect(result.data?.truncated).toBe(false);
      expect(result.data?.originalLength).toBe(4000);
    });
  });

  // -------------------------------------------------------------------------
  // Input validation (validateInput is a standalone method; BaseTool.execute
  // does NOT call it internally - external callers decide when to use it)
  // -------------------------------------------------------------------------

  describe("validateInput() - standalone URL validation checks", () => {
    it("should return false for an invalid URL that fails new URL() parse", () => {
      expect(tool.validateInput({ url: "not-a-valid-url" })).toBe(false);
    });

    it("should return false for an empty string URL", () => {
      expect(tool.validateInput({ url: "" })).toBe(false);
    });

    it("should return false for a URL with missing protocol", () => {
      expect(tool.validateInput({ url: "www.example.com/page" })).toBe(false);
    });

    it("should return true for a valid https URL", () => {
      expect(tool.validateInput({ url: "https://example.com/path?q=1" })).toBe(
        true,
      );
    });

    it("should return true for a valid http URL", () => {
      expect(
        tool.validateInput({ url: "http://internal-server.local/api" }),
      ).toBe(true);
    });

    it("should return false for a ftp:// URL that new URL() parses but domain missing", () => {
      // new URL("ftp://") throws → returns false
      expect(tool.validateInput({ url: "ftp-not-parseable" })).toBe(false);
    });

    it("should return true for a URL with query params and fragment", () => {
      expect(
        tool.validateInput({
          url: "https://example.com/search?q=test#section",
        }),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // execute() with invalid URL - doExecute reaches fetchUrlContent since
  // BaseTool.execute() does NOT call validateInput internally
  // -------------------------------------------------------------------------

  describe("execute() - invalid URL reaches fetchUrlContent", () => {
    it("should call fetchUrlContent even with an invalid URL (no internal validation in execute)", async () => {
      // doExecute calls fetchUrlContent directly; URL validation is the
      // responsibility of the caller via validateInput()
      mockSearchService.fetchUrlContent.mockResolvedValue({
        success: false,
        error: "Invalid URL",
      });

      const result = await tool.execute(
        { url: "not-a-valid-url" },
        makeContext(),
      );

      expect(mockSearchService.fetchUrlContent).toHaveBeenCalledWith(
        "not-a-valid-url",
      );
      // doExecute returns success:false output (no throw)
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // fetchUrlContent returns failure
  // -------------------------------------------------------------------------

  describe("execute() - fetchUrlContent returns success:false", () => {
    it("should return data.success:false when fetchUrlContent returns success:false", async () => {
      mockSearchService.fetchUrlContent.mockResolvedValue({
        success: false,
        error: "HTTP 404: Not Found",
      });

      const result = await tool.execute(
        { url: "https://example.com/missing" },
        makeContext(),
      );

      // doExecute catches success:false and returns a structured failure object
      // The outer ToolResult.success is still true (doExecute returned normally)
      // ★ P0-LIVE-SCRAPER-EMPTY (2026-04-30): error 透传上游真实错误，不再
      //   硬编码 "Failed to fetch URL content"，让 LLM 知道是 HTTP 404 / 403 /
      //   Connection refused / timeout 等具体原因。
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.content).toBe("");
      expect(result.data?.contentLength).toBe(0);
      expect(result.data?.error).toBe("HTTP 404: Not Found");
    });

    it("should return empty title and content on fetch failure", async () => {
      mockSearchService.fetchUrlContent.mockResolvedValue({
        success: false,
        error: "Connection refused",
      });

      const result = await tool.execute(
        { url: "https://example.com" },
        makeContext(),
      );

      expect(result.data?.title).toBe("");
      expect(result.data?.content).toBe("");
    });

    it("should preserve the url field even on fetch failure", async () => {
      const targetUrl = "https://example.com/gone";
      mockSearchService.fetchUrlContent.mockResolvedValue({
        success: false,
        error: "Gone",
      });

      const result = await tool.execute({ url: targetUrl }, makeContext());

      expect(result.data?.url).toBe(targetUrl);
    });
  });

  // -------------------------------------------------------------------------
  // fetchUrlContent returns null / empty content
  // -------------------------------------------------------------------------

  describe("execute() - empty or missing content fields", () => {
    it("should handle missing title gracefully (use empty string)", async () => {
      mockSearchService.fetchUrlContent.mockResolvedValue({
        success: true,
        title: undefined,
        content: "Some content",
      });

      const result = await tool.execute(
        { url: "https://example.com" },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.title).toBe("");
    });

    it("should handle missing content gracefully (use empty string)", async () => {
      mockSearchService.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Page Title",
        content: undefined,
      });

      const result = await tool.execute(
        { url: "https://example.com" },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.content).toBe("");
      expect(result.data?.contentLength).toBe(0);
    });

    it("should handle empty string content without truncation", async () => {
      mockSearchService.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Title",
        content: "",
      });

      const result = await tool.execute(
        { url: "https://example.com" },
        makeContext(),
      );

      expect(result.data?.content).toBe("");
      expect(result.data?.contentLength).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Error path - SearchService throws
  // -------------------------------------------------------------------------

  describe("execute() - error path when SearchService throws", () => {
    it("should return data.success:false with error message when fetchUrlContent throws", async () => {
      mockSearchService.fetchUrlContent.mockRejectedValue(
        new Error("Network unreachable"),
      );

      const result = await tool.execute(
        { url: "https://example.com" },
        makeContext(),
      );

      // doExecute catches the exception and returns a failure WebScraperOutput
      // The outer ToolResult.success is still true because doExecute handled it
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBe("Network unreachable");
    });

    it("should return 'Unknown error' when a non-Error object is thrown", async () => {
      mockSearchService.fetchUrlContent.mockRejectedValue("some string error");

      const result = await tool.execute(
        { url: "https://example.com" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBe("Unknown error");
    });

    it("should include the url field even when doExecute catches an error", async () => {
      const targetUrl = "https://example.com/throws";
      mockSearchService.fetchUrlContent.mockRejectedValue(new Error("Timeout"));

      const result = await tool.execute({ url: targetUrl }, makeContext());

      expect(result.data?.url).toBe(targetUrl);
      expect(result.data?.contentLength).toBe(0);
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
      const result = await tool.execute(
        { url: "https://example.com" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/cancelled/i);
      // fetchUrlContent must NOT be called at all
      expect(mockSearchService.fetchUrlContent).not.toHaveBeenCalled();
    });

    it("should include error code TOOL_3002 when cancelled", async () => {
      const controller = new AbortController();
      controller.abort();

      const context = makeContext({ signal: controller.signal });
      const result = await tool.execute(
        { url: "https://example.com" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TOOL_3002");
    });

    it("should execute normally when signal is NOT aborted", async () => {
      const controller = new AbortController();
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Title", "Content"),
      );

      const context = makeContext({ signal: controller.signal });
      const result = await tool.execute(
        { url: "https://example.com" },
        context,
      );

      expect(result.success).toBe(true);
      expect(mockSearchService.fetchUrlContent).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Result metadata
  // -------------------------------------------------------------------------

  describe("execute() - result metadata", () => {
    it("should always include metadata with executionId, startTime, endTime, duration", async () => {
      mockSearchService.fetchUrlContent.mockResolvedValue(
        makeFetchSuccess("Title", "Content"),
      );

      const result = await tool.execute(
        { url: "https://example.com" },
        makeContext({ executionId: "exec-xyz" }),
      );

      expect(result.metadata.executionId).toBe("exec-xyz");
      expect(result.metadata.startTime).toBeInstanceOf(Date);
      expect(result.metadata.endTime).toBeInstanceOf(Date);
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it("should include metadata even when execution fails due to invalid URL", async () => {
      const result = await tool.execute(
        { url: "bad-url" },
        makeContext({ executionId: "exec-fail" }),
      );

      // BaseTool always populates metadata
      expect(result.metadata).toBeDefined();
      expect(result.metadata.executionId).toBe("exec-fail");
    });
  });
});
