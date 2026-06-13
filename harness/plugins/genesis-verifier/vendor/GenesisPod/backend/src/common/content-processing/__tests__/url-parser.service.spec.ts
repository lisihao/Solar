/**
 * UrlParserService Tests
 *
 * Tests cover:
 * - URL detection from text
 * - URL type identification
 * - SSRF blocked host checking
 * - URL parsing (webpage, image, video, code repo, social)
 * - Batch parsing and dedup
 * - Cache behavior
 * - AI context generation
 */

import { UrlParserService } from "../url-parser.service";
import { WebContentExtractionService } from "../web-content-extraction.service";

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeMockWebExtraction(
  overrides: Partial<{
    title: string;
    description: string;
    content: string;
    contentLength: number;
    siteName: string;
    author: string;
    publishedDate: string;
    favicon: string;
    image: string;
    links: string[];
    source: "jina" | "firecrawl" | "fallback";
    error?: string;
  }> = {},
) {
  return {
    url: "https://example.com",
    title: "Test Title",
    description: "Test Description",
    content: "Test content body text that is long enough to be useful.",
    contentLength: 55,
    siteName: "Example",
    author: "Test Author",
    publishedDate: "2024-01-01",
    favicon: "https://example.com/favicon.ico",
    image: "https://example.com/og.png",
    links: ["https://example.com/link1"],
    source: "jina" as const,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------
describe("UrlParserService", () => {
  let service: UrlParserService;
  let mockWebContentExtractionService: jest.Mocked<WebContentExtractionService>;

  beforeEach(() => {
    mockWebContentExtractionService = {
      extractContent: jest.fn(),
      extractMultiple: jest.fn(),
      deepResearch: jest.fn(),
      generateAIContext: jest.fn(),
      generateResearchContext: jest.fn(),
      cleanupCache: jest.fn(),
    } as unknown as jest.Mocked<WebContentExtractionService>;

    service = new UrlParserService(mockWebContentExtractionService);

    // Reset fetch mock
    mockFetch.mockReset();
  });

  afterEach(() => {
    service.clearCache();
  });

  // =========================================================================
  // detectUrls
  // =========================================================================
  describe("detectUrls", () => {
    it("detects a single URL in plain text", () => {
      const result = service.detectUrls(
        "Check out https://example.com for more info",
      );
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("https://example.com");
    });

    it("detects multiple URLs in text", () => {
      const result = service.detectUrls(
        "Visit https://foo.com and https://bar.org today",
      );
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.url)).toContain("https://foo.com");
      expect(result.map((r) => r.url)).toContain("https://bar.org");
    });

    it("returns empty array when no URLs present", () => {
      const result = service.detectUrls("No links here at all");
      expect(result).toHaveLength(0);
    });

    it("skips blocked internal hosts", () => {
      const result = service.detectUrls(
        "internal: http://localhost/admin and http://192.168.1.1/api",
      );
      expect(result).toHaveLength(0);
    });

    it("records correct start and end indices", () => {
      const text = "Go to https://example.com now";
      const result = service.detectUrls(text);
      expect(result[0].startIndex).toBe(text.indexOf("https://"));
      expect(result[0].endIndex).toBe(
        text.indexOf("https://") + "https://example.com".length,
      );
    });

    it("identifies platform for detected YouTube URL", () => {
      const result = service.detectUrls(
        "Watch https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );
      expect(result[0].type).toBe("VIDEO");
      expect(result[0].platform).toBe("youtube");
    });
  });

  // =========================================================================
  // identifyUrlType
  // =========================================================================
  describe("identifyUrlType", () => {
    it("identifies image URLs", () => {
      expect(
        service.identifyUrlType("https://cdn.example.com/photo.jpg"),
      ).toEqual({ type: "IMAGE" });
      expect(
        service.identifyUrlType("https://cdn.example.com/icon.png"),
      ).toEqual({ type: "IMAGE" });
      expect(
        service.identifyUrlType("https://cdn.example.com/image.webp"),
      ).toEqual({ type: "IMAGE" });
    });

    it("identifies video URLs by extension", () => {
      expect(
        service.identifyUrlType("https://cdn.example.com/clip.mp4"),
      ).toEqual({ type: "VIDEO" });
    });

    it("identifies document URLs", () => {
      expect(service.identifyUrlType("https://example.com/report.pdf")).toEqual(
        { type: "DOCUMENT" },
      );
      expect(service.identifyUrlType("https://example.com/doc.docx")).toEqual({
        type: "DOCUMENT",
      });
    });

    it("identifies YouTube as VIDEO with youtube platform", () => {
      expect(
        service.identifyUrlType("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      ).toEqual({ type: "VIDEO", platform: "youtube" });
    });

    it("identifies youtu.be short links as YouTube VIDEO", () => {
      expect(service.identifyUrlType("https://youtu.be/dQw4w9WgXcQ")).toEqual({
        type: "VIDEO",
        platform: "youtube",
      });
    });

    it("identifies Bilibili as VIDEO with bilibili platform", () => {
      expect(
        service.identifyUrlType("https://www.bilibili.com/video/BV1xx411c7mD"),
      ).toEqual({ type: "VIDEO", platform: "bilibili" });
    });

    it("identifies GitHub as CODE_REPO", () => {
      expect(service.identifyUrlType("https://github.com/nestjs/nest")).toEqual(
        { type: "CODE_REPO", platform: "github" },
      );
    });

    it("identifies Twitter as SOCIAL", () => {
      expect(
        service.identifyUrlType("https://twitter.com/user/status/123456789"),
      ).toEqual({ type: "SOCIAL", platform: "twitter" });
    });

    it("identifies x.com as SOCIAL with twitter platform", () => {
      expect(
        service.identifyUrlType("https://x.com/user/status/123456789"),
      ).toEqual({ type: "SOCIAL", platform: "twitter" });
    });

    it("identifies Notion as WEBPAGE with notion platform", () => {
      const result = service.identifyUrlType(
        "https://notion.so/my-workspace-page",
      );
      expect(result.type).toBe("WEBPAGE");
      expect(result.platform).toBe("notion");
    });

    it("identifies generic page as WEBPAGE", () => {
      expect(service.identifyUrlType("https://example.com/about")).toEqual({
        type: "WEBPAGE",
      });
    });

    it("identifies Figma as WEBPAGE with figma platform", () => {
      const result = service.identifyUrlType(
        "https://figma.com/file/abc123/MyDesign",
      );
      expect(result.type).toBe("WEBPAGE");
      expect(result.platform).toBe("figma");
    });
  });

  // =========================================================================
  // isBlockedHost
  // =========================================================================
  describe("isBlockedHost", () => {
    it("blocks localhost", () => {
      expect(service.isBlockedHost("http://localhost/admin")).toBe(true);
    });

    it("blocks 127.x.x.x", () => {
      expect(service.isBlockedHost("http://127.0.0.1:8080/")).toBe(true);
    });

    it("blocks 10.x.x.x (private)", () => {
      expect(service.isBlockedHost("http://10.0.0.1/secret")).toBe(true);
    });

    it("blocks 192.168.x.x", () => {
      expect(service.isBlockedHost("http://192.168.0.1/")).toBe(true);
    });

    it("blocks 169.254.x.x link-local", () => {
      expect(
        service.isBlockedHost("http://169.254.169.254/latest/meta-data"),
      ).toBe(true);
    });

    it("does not block a public URL", () => {
      expect(service.isBlockedHost("https://example.com")).toBe(false);
    });

    it("blocks invalid URL (returns true)", () => {
      expect(service.isBlockedHost("not-a-url")).toBe(true);
    });
  });

  // =========================================================================
  // parseUrl – happy paths
  // =========================================================================
  describe("parseUrl", () => {
    it("parses a webpage URL using WebContentExtractionService", async () => {
      mockWebContentExtractionService.extractContent.mockResolvedValue(
        makeMockWebExtraction(),
      );

      const result = await service.parseUrl("https://example.com");

      expect(result.status).toBe("success");
      expect(result.type).toBe("WEBPAGE");
      expect(result.preview.title).toBe("Test Title");
      expect(result.preview.description).toBe("Test Description");
      expect(result.extractedContent?.fullText).toBeTruthy();
    });

    it("returns cached result on second call", async () => {
      mockWebContentExtractionService.extractContent.mockResolvedValue(
        makeMockWebExtraction(),
      );

      await service.parseUrl("https://example.com/cache-test");
      await service.parseUrl("https://example.com/cache-test");

      expect(
        mockWebContentExtractionService.extractContent,
      ).toHaveBeenCalledTimes(1);
    });

    it("parses an image URL", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: (header: string) => {
            if (header === "content-type") return "image/jpeg";
            if (header === "content-length") return "204800";
            return null;
          },
        },
      });

      const result = await service.parseUrl(
        "https://cdn.example.com/photo.jpg",
      );

      expect(result.status).toBe("success");
      expect(result.type).toBe("IMAGE");
      expect(result.preview.image).toBe("https://cdn.example.com/photo.jpg");
      expect(result.extractedContent?.metadata?.mimeType).toBe("image/jpeg");
    });

    it("handles image URL with no content-length header", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: (header: string) => {
            if (header === "content-type") return "image/png";
            return null;
          },
        },
      });

      const result = await service.parseUrl("https://cdn.example.com/img.png");
      expect(result.status).toBe("success");
      expect(result.extractedContent?.metadata?.size).toBeUndefined();
    });

    it("marks failed status when extraction throws", async () => {
      mockWebContentExtractionService.extractContent.mockRejectedValue(
        new Error("Network error"),
      );
      // Fallback fetch also fails
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const result = await service.parseUrl("https://fail.example.com");

      expect(result.status).toBe("failed");
      expect(result.error).toBeTruthy();
    });

    it("parses YouTube URL via oEmbed success", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          title: "Rick Astley - Never Gonna Give You Up",
          author_name: "RickAstleyVEVO",
        }),
      });

      const result = await service.parseUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result.status).toBe("success");
      expect(result.type).toBe("VIDEO");
      expect(result.preview.siteName).toBe("YouTube");
      expect(result.preview.title).toBe(
        "Rick Astley - Never Gonna Give You Up",
      );
      expect(result.preview.author).toBe("RickAstleyVEVO");
    });

    it("uses default YouTube values when oEmbed fails", async () => {
      mockFetch.mockRejectedValue(new Error("oEmbed timeout"));

      const result = await service.parseUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result.status).toBe("success");
      expect(result.preview.siteName).toBe("YouTube");
      expect(result.preview.title).toContain("YouTube Video");
    });

    it("parses Bilibili URL with successful API response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            title: "Bilibili Test Video",
            desc: "A test video",
            owner: { name: "TestAuthor" },
            pic: "https://i0.hdslb.com/bfs/archive/thumb.jpg",
            stat: { view: 100000 },
            duration: 360,
          },
        }),
      });

      const result = await service.parseUrl(
        "https://www.bilibili.com/video/BV1xx411c7mD",
      );

      expect(result.status).toBe("success");
      expect(result.type).toBe("VIDEO");
      expect(result.preview.title).toBe("Bilibili Test Video");
      expect(result.preview.siteName).toBe("Bilibili");
    });

    it("uses default Bilibili values when API fails", async () => {
      mockFetch.mockRejectedValue(new Error("API error"));

      const result = await service.parseUrl(
        "https://www.bilibili.com/video/BV1xx411c7mD",
      );

      expect(result.status).toBe("success");
      expect(result.preview.siteName).toBe("Bilibili");
    });

    it("parses GitHub repository URL", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          full_name: "nestjs/nest",
          description: "A progressive Node.js framework",
          owner: {
            login: "nestjs",
            avatar_url: "https://avatars.github.com/u/1",
          },
          stargazers_count: 60000,
          forks_count: 7000,
          language: "TypeScript",
          topics: ["nodejs", "typescript"],
        }),
      });

      const result = await service.parseUrl("https://github.com/nestjs/nest");

      expect(result.status).toBe("success");
      expect(result.type).toBe("CODE_REPO");
      expect(result.preview.title).toBe("nestjs/nest");
      expect(result.extractedContent?.metadata?.stars).toBe(60000);
    });

    it("uses default GitHub values when API fails", async () => {
      mockFetch.mockRejectedValue(new Error("rate limit"));

      const result = await service.parseUrl("https://github.com/nestjs/nest");

      expect(result.status).toBe("success");
      expect(result.preview.siteName).toBe("GitHub");
    });

    it("falls back to webpage parsing when WebContentExtraction returns error", async () => {
      mockWebContentExtractionService.extractContent.mockResolvedValue(
        makeMockWebExtraction({ error: "Jina failed", content: "" }),
      );

      mockFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: (header: string) => {
            if (header === "content-type") return "text/html";
            return null;
          },
        },
        text: async () =>
          "<html><head><title>Fallback Page</title></head><body>Content</body></html>",
      });

      const result = await service.parseUrl("https://example.com/fallback");

      expect(result.status).toBe("success");
      expect(result.preview.title).toBe("Fallback Page");
    });
  });

  // =========================================================================
  // parseUrls (batch)
  // =========================================================================
  describe("parseUrls", () => {
    it("deduplicates URLs before parsing", async () => {
      mockWebContentExtractionService.extractContent.mockResolvedValue(
        makeMockWebExtraction(),
      );

      const results = await service.parseUrls([
        "https://example.com",
        "https://example.com",
        "https://example.com",
      ]);

      expect(results).toHaveLength(1);
      expect(
        mockWebContentExtractionService.extractContent,
      ).toHaveBeenCalledTimes(1);
    });

    it("processes more than batchSize URLs in batches", async () => {
      mockWebContentExtractionService.extractContent.mockResolvedValue(
        makeMockWebExtraction(),
      );

      const urls = Array.from(
        { length: 7 },
        (_, i) => `https://example${i}.com`,
      );
      const results = await service.parseUrls(urls);

      expect(results).toHaveLength(7);
    });
  });

  // =========================================================================
  // detectAndParseUrls
  // =========================================================================
  describe("detectAndParseUrls", () => {
    it("returns empty arrays when no URLs detected", async () => {
      const result = await service.detectAndParseUrls("No URLs here");
      expect(result.detectedUrls).toHaveLength(0);
      expect(result.parsedUrls).toHaveLength(0);
    });

    it("detects and parses URLs in text", async () => {
      mockWebContentExtractionService.extractContent.mockResolvedValue(
        makeMockWebExtraction(),
      );

      const result = await service.detectAndParseUrls(
        "See https://example.com for details",
      );

      expect(result.detectedUrls).toHaveLength(1);
      expect(result.parsedUrls).toHaveLength(1);
      expect(result.parsedUrls[0].url).toBe("https://example.com");
    });
  });

  // =========================================================================
  // clearCache
  // =========================================================================
  describe("clearCache", () => {
    it("clears cached URLs so next call re-fetches", async () => {
      mockWebContentExtractionService.extractContent.mockResolvedValue(
        makeMockWebExtraction(),
      );

      await service.parseUrl("https://example.com/clear-test");
      service.clearCache();
      await service.parseUrl("https://example.com/clear-test");

      expect(
        mockWebContentExtractionService.extractContent,
      ).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // generateAiContextFromParsedUrls
  // =========================================================================
  describe("generateAiContextFromParsedUrls", () => {
    it("returns empty string for empty array", () => {
      expect(service.generateAiContextFromParsedUrls([])).toBe("");
    });

    it("returns empty string when all URLs failed", () => {
      const failedUrl = {
        type: "WEBPAGE" as const,
        originalText: "https://example.com",
        url: "https://example.com",
        preview: {},
        status: "failed" as const,
        error: "Network error",
      };
      expect(service.generateAiContextFromParsedUrls([failedUrl])).toBe("");
    });

    it("generates context with title and description", () => {
      const parsedUrl = {
        type: "WEBPAGE" as const,
        originalText: "https://example.com",
        url: "https://example.com",
        preview: {
          title: "Example Site",
          description: "An example website",
          siteName: "Example",
          author: "Jane Doe",
        },
        status: "success" as const,
      };
      const context = service.generateAiContextFromParsedUrls([parsedUrl]);
      expect(context).toContain("Example Site");
      expect(context).toContain("Jane Doe");
      expect(context).toContain("Example");
      expect(context).toContain("An example website");
    });

    it("includes extracted content summary", () => {
      const parsedUrl = {
        type: "WEBPAGE" as const,
        originalText: "https://example.com",
        url: "https://example.com",
        preview: { title: "Test" },
        extractedContent: {
          summary: "This is a summary of the content",
        },
        status: "success" as const,
      };
      const context = service.generateAiContextFromParsedUrls([parsedUrl]);
      expect(context).toContain("This is a summary of the content");
    });

    it("includes GitHub metadata (stars, forks, language)", () => {
      const parsedUrl = {
        type: "CODE_REPO" as const,
        originalText: "https://github.com/nestjs/nest",
        url: "https://github.com/nestjs/nest",
        preview: { title: "nestjs/nest", siteName: "GitHub" },
        extractedContent: {
          metadata: {
            stars: 60000,
            forks: 7000,
            language: "TypeScript",
            platform: "github",
          },
        },
        status: "success" as const,
      };
      const context = service.generateAiContextFromParsedUrls([parsedUrl]);
      expect(context).toContain("60000");
      expect(context).toContain("TypeScript");
    });

    it("includes Bilibili duration formatted as mm:ss", () => {
      const parsedUrl = {
        type: "VIDEO" as const,
        originalText: "https://www.bilibili.com/video/BV1",
        url: "https://www.bilibili.com/video/BV1",
        preview: { title: "Bilibili Video", siteName: "Bilibili" },
        extractedContent: {
          metadata: {
            duration: 125,
            platform: "bilibili",
          },
        },
        status: "success" as const,
      };
      const context = service.generateAiContextFromParsedUrls([parsedUrl]);
      expect(context).toContain("2:05");
    });
  });
});
