/**
 * Image Search Tools 单元测试
 * 覆盖: BingImageSearchTool, GoogleImageSearchTool, SerpAPIImageSearchTool, ImageSearchAggregatorTool
 */
import { BingImageSearchTool } from "../bing-image-search.tool";
import { GoogleImageSearchTool } from "../google-image-search.tool";
import { SerpAPIImageSearchTool } from "../serpapi-image-search.tool";
import { ImageSearchAggregatorTool } from "../image-search-aggregator.tool";
import type { ImageSearchInput } from "../image-search.types";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockToolContext = {
  executionId: "test-exec-id",
  workflowId: "test-workflow",
  stepId: "test-step",
  userId: "test-user",
  sessionId: "test-session",
  state: {},
  signal: undefined,
};

const mockPolicyDataService = {
  getApiKey: jest.fn(),
  markKeyFailed: jest.fn(),
  clearKeyFailure: jest.fn(),
};

const makeSearchInput = (
  overrides: Partial<ImageSearchInput> = {},
): ImageSearchInput => ({
  query: "AI research charts",
  ...overrides,
});

// ──────────────────────────────────────────────────────────────────────────────
// BingImageSearchTool
// ──────────────────────────────────────────────────────────────────────────────
describe("BingImageSearchTool", () => {
  let tool: BingImageSearchTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new BingImageSearchTool(mockPolicyDataService as never);
  });

  describe("metadata", () => {
    it("should have correct id", () => {
      expect(tool.id).toBe("bing-image-search");
    });

    it("should have category information", () => {
      expect(tool.category).toBe("information");
    });

    it("should have non-empty name and description", () => {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
    });

    it("should have valid input schema", () => {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.required).toContain("query");
    });
  });

  describe("validateInput", () => {
    it("should return true for valid input", () => {
      expect(tool.validateInput(makeSearchInput())).toBe(true);
    });

    it("should return false for empty query", () => {
      expect(tool.validateInput(makeSearchInput({ query: "" }))).toBe(false);
      expect(tool.validateInput(makeSearchInput({ query: "   " }))).toBe(false);
    });

    it("should return false for query over 500 chars", () => {
      expect(
        tool.validateInput(makeSearchInput({ query: "a".repeat(501) })),
      ).toBe(false);
    });

    it("should return false for non-string query", () => {
      expect(tool.validateInput({ query: 123 as unknown as string })).toBe(
        false,
      );
    });

    it("should return true for exactly 500 char query", () => {
      expect(
        tool.validateInput(makeSearchInput({ query: "a".repeat(500) })),
      ).toBe(true);
    });
  });

  describe("execute (doExecute)", () => {
    it("should throw error when API key not configured", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(
        "Bing Image Search API key not configured",
      );
    });

    it("should return results on successful API call", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("test-api-key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          value: [
            {
              contentUrl: "https://example.com/img1.jpg",
              thumbnailUrl: "https://example.com/thumb1.jpg",
              name: "Chart 1",
              hostPageUrl: "https://example.com/page1",
              hostPageDisplayUrl: "example.com",
              width: 800,
              height: 600,
              contentSize: "51200",
              encodingFormat: "jpeg",
            },
          ],
          totalEstimatedMatches: 1000,
        }),
      });

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.results).toHaveLength(1);
      expect(result.data!.results[0].imageUrl).toBe(
        "https://example.com/img1.jpg",
      );
      expect(result.data!.provider).toBe("bing");
    });

    it("should handle API error response", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("test-api-key");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: jest.fn().mockResolvedValue("Access denied"),
      });

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(false);
      expect(mockPolicyDataService.markKeyFailed).toHaveBeenCalled();
    });

    it("should clamp numResults to 30", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("test-api-key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ value: [], totalEstimatedMatches: 0 }),
      });

      await tool.execute(
        makeSearchInput({ numResults: 100 }),
        mockToolContext as never,
      );

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("count=30");
    });

    it("should apply language mkt param for zh-CN", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ value: [], totalEstimatedMatches: 0 }),
      });

      await tool.execute(
        makeSearchInput({ language: "zh-CN" }),
        mockToolContext as never,
      );

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("mkt=zh-CN");
    });

    it("should apply language mkt param for en-US", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ value: [], totalEstimatedMatches: 0 }),
      });

      await tool.execute(
        makeSearchInput({ language: "en-US" }),
        mockToolContext as never,
      );

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("mkt=en-US");
    });

    it("should apply safeSearch strict param", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ value: [], totalEstimatedMatches: 0 }),
      });

      await tool.execute(
        makeSearchInput({ safeSearch: "strict" }),
        mockToolContext as never,
      );

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("safeSearch=Strict");
    });

    it("should apply size filter for small", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ value: [], totalEstimatedMatches: 0 }),
      });

      await tool.execute(
        makeSearchInput({ size: "small" }),
        mockToolContext as never,
      );

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("size=Small");
    });

    it("should apply size filter for medium", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ value: [], totalEstimatedMatches: 0 }),
      });

      await tool.execute(
        makeSearchInput({ size: "medium" }),
        mockToolContext as never,
      );

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("size=Medium");
    });

    it("should not apply size filter when size is any", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ value: [], totalEstimatedMatches: 0 }),
      });

      await tool.execute(
        makeSearchInput({ size: "any" }),
        mockToolContext as never,
      );

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).not.toContain("size=");
    });

    it("should handle fetch network error", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("key");
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(false);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GoogleImageSearchTool
// ──────────────────────────────────────────────────────────────────────────────
describe("GoogleImageSearchTool", () => {
  let tool: GoogleImageSearchTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new GoogleImageSearchTool(mockPolicyDataService as never);
  });

  describe("metadata", () => {
    it("should have correct id", () => {
      expect(tool.id).toBe("google-image-search");
    });

    it("should have category information", () => {
      expect(tool.category).toBe("information");
    });
  });

  describe("validateInput", () => {
    it("should validate correctly", () => {
      expect(tool.validateInput(makeSearchInput())).toBe(true);
      expect(tool.validateInput(makeSearchInput({ query: "" }))).toBe(false);
      expect(
        tool.validateInput(makeSearchInput({ query: "a".repeat(501) })),
      ).toBe(false);
    });
  });

  describe("execute", () => {
    it("should throw error when API key not configured", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(false);
    });

    it("should return results on successful API call", async () => {
      mockPolicyDataService.getApiKey
        .mockResolvedValueOnce("api-key") // google-image-search key
        .mockResolvedValueOnce("cse-engine-id"); // google-cse-engine-id

      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          searchInformation: { totalResults: "500" },
          items: [
            {
              link: "https://example.com/img.jpg",
              title: "Image Title",
              displayLink: "example.com",
              image: {
                contextLink: "https://example.com/page",
                thumbnailLink: "https://example.com/thumb.jpg",
                width: 800,
                height: 600,
                byteSize: 51200,
              },
            },
          ],
        }),
      });

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(true);
      expect(result.data?.results.length).toBeGreaterThan(0);
      expect(result.data?.provider).toBe("google-cse");
    });

    it("should handle missing items in response", async () => {
      mockPolicyDataService.getApiKey
        .mockResolvedValueOnce("api-key")
        .mockResolvedValueOnce("cse-engine-id");

      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          searchInformation: { totalResults: "0" },
        }),
      });

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(true);
      expect(result.data?.results).toHaveLength(0);
    });

    it("should handle API error response", async () => {
      mockPolicyDataService.getApiKey
        .mockResolvedValueOnce("api-key")
        .mockResolvedValueOnce("cse-engine-id");

      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: jest.fn().mockResolvedValue("Quota exceeded"),
      });

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(false);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SerpAPIImageSearchTool
// ──────────────────────────────────────────────────────────────────────────────
describe("SerpAPIImageSearchTool", () => {
  let tool: SerpAPIImageSearchTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new SerpAPIImageSearchTool(mockPolicyDataService as never);
  });

  describe("metadata", () => {
    it("should have correct id", () => {
      expect(tool.id).toBe("serpapi-image-search");
    });

    it("should have category information", () => {
      expect(tool.category).toBe("information");
    });
  });

  describe("validateInput", () => {
    it("should validate correctly", () => {
      expect(tool.validateInput(makeSearchInput())).toBe(true);
      expect(tool.validateInput(makeSearchInput({ query: "" }))).toBe(false);
    });
  });

  describe("execute", () => {
    it("should throw error when API key not configured", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(false);
    });

    it("should return results on successful API call", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("serpapi-key");

      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          images_results: [
            {
              original: "https://example.com/img.jpg",
              thumbnail: "https://example.com/thumb.jpg",
              title: "Chart Title",
              link: "https://example.com/page",
              source: "example.com",
              original_width: 1024,
              original_height: 768,
            },
          ],
          search_information: { total_results: 1000 },
        }),
      });

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(true);
      expect(result.data?.provider).toBe("serpapi");
      expect(result.data?.results.length).toBeGreaterThan(0);
    });

    it("should handle missing images_results", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      });

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(true);
      expect(result.data?.results).toHaveLength(0);
    });

    it("should handle API error", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("key");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: jest.fn().mockResolvedValue("Invalid API key"),
      });

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(false);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// ImageSearchAggregatorTool
// ──────────────────────────────────────────────────────────────────────────────
describe("ImageSearchAggregatorTool", () => {
  let tool: ImageSearchAggregatorTool;

  const mockBingTool = { execute: jest.fn() };
  const mockGoogleTool = { execute: jest.fn() };
  const mockSerpApiTool = { execute: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new ImageSearchAggregatorTool(
      mockPolicyDataService as never,
      mockBingTool as never,
      mockGoogleTool as never,
      mockSerpApiTool as never,
    );
  });

  describe("metadata", () => {
    it("should have correct id", () => {
      expect(tool.id).toBe("image-search");
    });

    it("should have category information", () => {
      expect(tool.category).toBe("information");
    });
  });

  describe("validateInput", () => {
    it("should validate correctly", () => {
      expect(tool.validateInput(makeSearchInput())).toBe(true);
      expect(tool.validateInput(makeSearchInput({ query: "" }))).toBe(false);
      expect(
        tool.validateInput(makeSearchInput({ query: "a".repeat(501) })),
      ).toBe(false);
    });
  });

  describe("execute (doExecute with fallback)", () => {
    const mockImageOutput = {
      results: [
        {
          imageUrl: "https://example.com/img.jpg",
          title: "Test",
          sourceUrl: "https://x.com",
          sourceDomain: "x.com",
        },
      ],
      success: true,
      totalResults: 1,
      provider: "serpapi" as const,
    };

    it("should use SerpAPI first when key is available", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("serpapi-key");
      mockSerpApiTool.execute.mockResolvedValue({
        success: true,
        data: mockImageOutput,
      });

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(true);
      expect(mockSerpApiTool.execute).toHaveBeenCalled();
      expect(mockBingTool.execute).not.toHaveBeenCalled();
    });

    it("should fall back to Bing when SerpAPI not configured", async () => {
      mockPolicyDataService.getApiKey
        .mockResolvedValueOnce(null) // SerpAPI - no key
        .mockResolvedValueOnce("bing-key"); // Bing - has key

      mockBingTool.execute.mockResolvedValue({
        success: true,
        data: { ...mockImageOutput, provider: "bing" },
      });

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(true);
      expect(mockBingTool.execute).toHaveBeenCalled();
    });

    it("should fall back to Google when SerpAPI and Bing fail", async () => {
      mockPolicyDataService.getApiKey
        .mockResolvedValueOnce("serpapi-key")
        .mockResolvedValueOnce("bing-key")
        .mockResolvedValueOnce("google-key");

      mockSerpApiTool.execute.mockResolvedValue({
        success: false,
        error: { message: "serpapi failed" },
      });
      mockBingTool.execute.mockResolvedValue({
        success: false,
        error: { message: "bing failed" },
      });
      mockGoogleTool.execute.mockResolvedValue({
        success: true,
        data: { ...mockImageOutput, provider: "google-cse" },
      });

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(true);
      expect(mockGoogleTool.execute).toHaveBeenCalled();
    });

    it("should throw when all providers fail", async () => {
      mockPolicyDataService.getApiKey
        .mockResolvedValueOnce("serpapi-key")
        .mockResolvedValueOnce("bing-key")
        .mockResolvedValueOnce("google-key");

      mockSerpApiTool.execute.mockRejectedValue(new Error("serpapi error"));
      mockBingTool.execute.mockRejectedValue(new Error("bing error"));
      mockGoogleTool.execute.mockRejectedValue(new Error("google error"));

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Image search failed");
    });

    it("should skip providers with no API key", async () => {
      mockPolicyDataService.getApiKey
        .mockResolvedValueOnce(null) // SerpAPI - no key
        .mockResolvedValueOnce(null) // Bing - no key
        .mockResolvedValueOnce(null); // Google - no key

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(false);
      expect(mockSerpApiTool.execute).not.toHaveBeenCalled();
      expect(mockBingTool.execute).not.toHaveBeenCalled();
      expect(mockGoogleTool.execute).not.toHaveBeenCalled();
    });

    it("should fall back when tool returns success=false with no data", async () => {
      mockPolicyDataService.getApiKey
        .mockResolvedValueOnce("serpapi-key")
        .mockResolvedValueOnce("bing-key");

      mockSerpApiTool.execute.mockResolvedValue({
        success: false,
        error: { message: "no results" },
      });
      mockBingTool.execute.mockResolvedValue({
        success: true,
        data: { ...mockImageOutput, provider: "bing" },
      });

      const result = await tool.execute(
        makeSearchInput(),
        mockToolContext as never,
      );

      expect(result.success).toBe(true);
      expect(result.data?.provider).toBe("bing");
    });
  });
});
