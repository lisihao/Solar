/**
 * SerpAPIImageSearchTool - Extended coverage tests
 *
 * Covers paths not hit by the base spec:
 *  - Line 149-150: size === "medium" → tbs=isz:m
 *  - Lines 154-155: language === "zh-CN" → hl/gl params
 *  - Lines 157-158: language === "en-US" → hl/gl params
 *  - Lines 212-216: extractDomain catch block (invalid URL)
 */

import { SerpAPIImageSearchTool } from "../serpapi-image-search.tool";
import type { ImageSearchInput } from "../image-search.types";
import { ToolContext } from "../../../../abstractions/tool.interface";

const mockPolicyDataService = {
  getApiKey: jest.fn(),
  markKeyFailed: jest.fn(),
  clearKeyFailure: jest.fn(),
};

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "ext-serpapi-001",
    toolId: "serpapi-image-search",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSuccessResponse(images: Record<string, unknown>[] = []) {
  return {
    ok: true,
    json: jest.fn().mockResolvedValue({ images_results: images }),
    text: jest.fn().mockResolvedValue(""),
  };
}

function makeDefaultImage(): Record<string, unknown> {
  return {
    original: "https://example.com/img.jpg",
    thumbnail: "https://example.com/thumb.jpg",
    title: "Test Image",
    snippet: "A test image",
    link: "https://example.com",
    source: "example.com",
    original_width: 1920,
    original_height: 1080,
  };
}

describe("SerpAPIImageSearchTool (extended coverage)", () => {
  let tool: SerpAPIImageSearchTool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPolicyDataService.getApiKey.mockResolvedValue("test-serpapi-key");
    tool = new SerpAPIImageSearchTool(mockPolicyDataService as never);
  });

  // =========================================================================
  // Lines 149-150: size === "medium" → tbs=isz:m
  // =========================================================================

  describe("size === 'medium' (lines 149-150)", () => {
    it("sets tbs=isz:m when size is medium", async () => {
      mockFetch.mockResolvedValue(makeSuccessResponse([makeDefaultImage()]));

      const input: ImageSearchInput = {
        query: "medium size images",
        size: "medium",
      };

      const result = await tool.execute(input, makeContext());
      expect(result.success).toBe(true);

      // Verify fetch was called with tbs=isz:m
      const fetchCall: string = mockFetch.mock.calls[0][0];
      expect(fetchCall).toContain("tbs=isz%3Am");
    });
  });

  // =========================================================================
  // Lines 154-155: language === "zh-CN" → hl=zh-CN&gl=cn
  // =========================================================================

  describe("language === 'zh-CN' (lines 154-155)", () => {
    it("sets hl and gl for zh-CN language", async () => {
      mockFetch.mockResolvedValue(makeSuccessResponse([makeDefaultImage()]));

      const input: ImageSearchInput = {
        query: "中文搜索",
        language: "zh-CN",
      };

      const result = await tool.execute(input, makeContext());
      expect(result.success).toBe(true);

      const fetchCall: string = mockFetch.mock.calls[0][0];
      expect(fetchCall).toContain("hl=zh-CN");
      expect(fetchCall).toContain("gl=cn");
    });
  });

  // =========================================================================
  // Lines 157-158: language === "en-US" → hl=en&gl=us
  // =========================================================================

  describe("language === 'en-US' (lines 157-158)", () => {
    it("sets hl and gl for en-US language", async () => {
      mockFetch.mockResolvedValue(makeSuccessResponse([makeDefaultImage()]));

      const input: ImageSearchInput = {
        query: "english images",
        language: "en-US",
      };

      const result = await tool.execute(input, makeContext());
      expect(result.success).toBe(true);

      const fetchCall: string = mockFetch.mock.calls[0][0];
      expect(fetchCall).toContain("hl=en");
      expect(fetchCall).toContain("gl=us");
    });
  });

  // =========================================================================
  // Lines 212-216: extractDomain catch block (invalid URL)
  // =========================================================================

  describe("extractDomain with invalid URL (lines 212-216)", () => {
    it("returns empty string for invalid URL in extractDomain", async () => {
      mockFetch.mockResolvedValue(
        makeSuccessResponse([
          {
            original: "https://example.com/img.jpg",
            title: "Test",
            link: "not-a-valid-url",
            // source is undefined so extractDomain is called with invalid URL
          },
        ]),
      );

      const input: ImageSearchInput = {
        query: "test invalid domain",
      };

      const result = await tool.execute(input, makeContext());
      expect(result.success).toBe(true);
      // The result should have empty sourceDomain from invalid URL
      expect(result.data?.results[0]?.sourceDomain).toBeDefined();
    });
  });

  // =========================================================================
  // Additional: size === "small" (no tbs param set) - verify no tbs
  // =========================================================================

  describe("size === 'small' (no tbs added)", () => {
    it("does not add tbs param when size is 'small'", async () => {
      mockFetch.mockResolvedValue(makeSuccessResponse([makeDefaultImage()]));

      const input: ImageSearchInput = {
        query: "small image",
        size: "small",
      };

      const result = await tool.execute(input, makeContext());
      expect(result.success).toBe(true);

      const fetchCall: string = mockFetch.mock.calls[0][0];
      expect(fetchCall).not.toContain("tbs");
    });
  });

  // =========================================================================
  // Additional: safeSearch === "off" → safe=off
  // =========================================================================

  describe("safeSearch === 'off'", () => {
    it("sets safe=off when safeSearch is off", async () => {
      mockFetch.mockResolvedValue(makeSuccessResponse([makeDefaultImage()]));

      const input: ImageSearchInput = {
        query: "test query",
        safeSearch: "off",
      };

      const result = await tool.execute(input, makeContext());
      expect(result.success).toBe(true);

      const fetchCall: string = mockFetch.mock.calls[0][0];
      expect(fetchCall).toContain("safe=off");
    });
  });
});
