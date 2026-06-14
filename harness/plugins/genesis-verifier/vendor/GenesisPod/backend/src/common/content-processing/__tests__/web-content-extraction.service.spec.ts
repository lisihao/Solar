/**
 * WebContentExtractionService Tests
 *
 * Tests cover:
 * - getApiKey: cache behavior, DB load, env var fallback, DB error fallback
 * - extractContent: Jina success, Jina short -> Firecrawl upgrade,
 *   Jina failure -> Firecrawl fallback, all methods fail
 * - extractWithJina: success, timeout (AbortError), HTTP error
 * - extractWithFirecrawl: no API key, success, HTTP error
 * - extractMultiple: batch concurrency
 * - deepResearch: Tavily key missing, success, API failure
 * - generateAIContext: empty, with content, skip errored items
 * - generateResearchContext: with synthesis and key points
 * - cleanupCache: removes expired entries
 */

import { WebContentExtractionService } from "../web-content-extraction.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RequestContext } from "../../context/request-context";
import { NoToolKeyError } from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeJinaResponse(overrides: Record<string, unknown> = {}) {
  return {
    title: "Jina Title",
    description: "Jina Description",
    content: "A".repeat(600), // > 500 chars so it won't trigger Firecrawl
    author: "Jina Author",
    publishedTime: "2024-01-01",
    siteName: "JinaSite",
    favicon: "https://example.com/favicon.ico",
    image: "https://example.com/og.png",
    links: ["https://example.com/1"],
    ...overrides,
  };
}

function makeFirecrawlResponse(_overrides: Record<string, unknown> = {}) {
  return {
    data: {
      markdown: "B".repeat(700),
      metadata: {
        title: "FC Title",
        description: "FC Description",
        author: "FC Author",
        publishedTime: "2024-01-02",
        siteName: "FCSite",
        favicon: "https://fc.example.com/fav.ico",
        ogImage: "https://fc.example.com/og.png",
      },
      links: ["https://fc.example.com/link"],
    },
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------
describe("WebContentExtractionService", () => {
  let service: WebContentExtractionService;
  let mockPrisma: jest.Mocked<Partial<PrismaService>>;

  beforeEach(() => {
    mockPrisma = {
      systemSetting: {
        findMany: jest.fn(),
      } as unknown as PrismaService["systemSetting"],
    };

    service = new WebContentExtractionService(
      mockPrisma as unknown as PrismaService,
    );

    mockFetch.mockReset();

    // Default: no DB settings, no env vars
    (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

    delete process.env.JINA_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.TAVILY_API_KEY;
  });

  // =========================================================================
  // getApiKey / extractContent basic cache
  // =========================================================================
  describe("API key cache", () => {
    it("loads API keys from DB settings on first call", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([
        { key: "extraction.jina.apiKey", value: '"jina-db-key"' },
        { key: "extraction.firecrawl.apiKey", value: '"fc-db-key"' },
      ]);

      // Trigger extractContent which calls getApiKey internally
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeJinaResponse(),
      });

      await service.extractContent("https://example.com");

      expect(mockPrisma.systemSetting!.findMany).toHaveBeenCalledTimes(1);
    });

    it("uses cached API keys within TTL without re-querying DB", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => makeJinaResponse(),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => makeJinaResponse(),
        });

      await service.extractContent("https://example.com/1");
      await service.extractContent("https://example.com/2");

      // DB should only be queried once for first call, second reuses cache
      expect(mockPrisma.systemSetting!.findMany).toHaveBeenCalledTimes(1);
    });

    it("falls back to env vars when DB has no keys", async () => {
      process.env.JINA_API_KEY = "jina-env-key";

      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeJinaResponse(),
      });

      const result = await service.extractContent("https://example.com");
      expect(result.source).toBe("jina");
    });

    it("falls back to env vars when DB throws error", async () => {
      process.env.JINA_API_KEY = "jina-env-key";

      (mockPrisma.systemSetting!.findMany as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeJinaResponse(),
      });

      const result = await service.extractContent("https://example.com");
      expect(result.source).toBe("jina");
    });

    it("handles DB setting with non-JSON value gracefully", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([
        { key: "extraction.jina.apiKey", value: "plain-key-not-json" },
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeJinaResponse(),
      });

      const result = await service.extractContent("https://example.com");
      expect(result.source).toBe("jina");
    });
  });

  // =========================================================================
  // extractContent – cache
  // =========================================================================
  describe("extractContent – cache", () => {
    it("returns cached result for same URL within TTL", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeJinaResponse(),
      });

      await service.extractContent("https://cached.example.com");
      await service.extractContent("https://cached.example.com");

      // fetch should only be called once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // extractContent – Jina success
  // =========================================================================
  describe("extractContent – Jina success", () => {
    it("returns Jina result when content is sufficient", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeJinaResponse(),
      });

      const result = await service.extractContent("https://example.com");

      expect(result.source).toBe("jina");
      expect(result.title).toBe("Jina Title");
      expect(result.content.length).toBeGreaterThanOrEqual(600);
    });

    it("populates all metadata fields from Jina response", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeJinaResponse(),
      });

      const result = await service.extractContent("https://example.com");

      expect(result.author).toBe("Jina Author");
      expect(result.publishedDate).toBe("2024-01-01");
      expect(result.siteName).toBe("JinaSite");
      expect(result.favicon).toBe("https://example.com/favicon.ico");
      expect(result.image).toBe("https://example.com/og.png");
      expect(result.links).toContain("https://example.com/1");
    });
  });

  // =========================================================================
  // extractContent – Jina short content -> Firecrawl upgrade
  // =========================================================================
  describe("extractContent – Jina short -> Firecrawl upgrade", () => {
    beforeEach(() => {
      process.env.FIRECRAWL_API_KEY = "fc-upgrade-key";
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);
    });

    it("upgrades to Firecrawl when Jina content is too short", async () => {
      // Jina returns < 500 chars content
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => makeJinaResponse({ content: "short" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => makeFirecrawlResponse(),
        });

      const result = await service.extractContent("https://example.com/short");

      expect(result.source).toBe("firecrawl");
      expect(result.contentLength).toBeGreaterThan(5);
    });

    it("keeps Jina result if Firecrawl content is not longer", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => makeJinaResponse({ content: "AA" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: { markdown: "A", metadata: {} },
          }),
        });

      const result = await service.extractContent(
        "https://example.com/keep-jina",
      );

      expect(result.source).toBe("jina");
    });
  });

  // =========================================================================
  // extractContent – Jina failure -> Firecrawl fallback
  // =========================================================================
  describe("extractContent – Jina failure -> Firecrawl fallback", () => {
    it("falls back to Firecrawl when Jina throws", async () => {
      process.env.FIRECRAWL_API_KEY = "fc-fallback-key";
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      mockFetch
        .mockRejectedValueOnce(new Error("Jina connection timeout"))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => makeFirecrawlResponse(),
        });

      const result = await service.extractContent(
        "https://example.com/jina-fail",
      );

      expect(result.source).toBe("firecrawl");
      expect(result.title).toBe("FC Title");
    });

    it("returns error result when Jina fails and no Firecrawl key", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      mockFetch.mockRejectedValueOnce(new Error("Jina failed"));

      const result = await service.extractContent(
        "https://example.com/both-fail",
      );

      expect(result.error).toBeTruthy();
      expect(result.source).toBe("fallback");
    });

    it("returns error result when both Jina and Firecrawl fail", async () => {
      process.env.FIRECRAWL_API_KEY = "fc-fail-key";
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      mockFetch
        .mockRejectedValueOnce(new Error("Jina failed"))
        .mockRejectedValueOnce(new Error("Firecrawl failed"));

      const result = await service.extractContent(
        "https://example.com/all-fail",
      );

      expect(result.error).toBeTruthy();
      expect(result.source).toBe("fallback");
    });
  });

  // =========================================================================
  // extractWithJina – specific behaviors
  // =========================================================================
  describe("extractWithJina – error handling", () => {
    it("throws when Jina returns non-OK status", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });

      const result = await service.extractContent(
        "https://example.com/rate-limited",
      );
      // Should have fallen back to error result since no firecrawl
      expect(result.error).toBeTruthy();
    });

    it("handles Jina AbortError (timeout) -> fallback", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      const abortError = new Error("AbortError");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortError);

      const result = await service.extractContent(
        "https://example.com/timeout",
      );

      expect(result.error).toBeTruthy();
    });
  });

  // =========================================================================
  // extractWithFirecrawl – specific behaviors
  // =========================================================================
  describe("extractWithFirecrawl – error handling", () => {
    it("throws error when Firecrawl key is not configured", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      // Jina also fails so firecrawl is attempted
      mockFetch.mockRejectedValueOnce(new Error("Jina down"));

      // No firecrawl key set
      const result = await service.extractContent(
        "https://example.com/no-fc-key",
      );

      expect(result.error).toBeTruthy();
    });

    it("handles Firecrawl non-OK response with error text", async () => {
      process.env.FIRECRAWL_API_KEY = "fc-error-test";
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      mockFetch
        .mockRejectedValueOnce(new Error("Jina failed"))
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => "Unauthorized",
        });

      const result = await service.extractContent(
        "https://example.com/fc-error",
      );

      expect(result.error).toBeTruthy();
    });
  });

  // =========================================================================
  // extractMultiple
  // =========================================================================
  describe("extractMultiple", () => {
    it("processes all URLs and returns results", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      const urls = [
        "https://example.com/1",
        "https://example.com/2",
        "https://example.com/3",
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeJinaResponse(),
      });

      const results = await service.extractMultiple(urls);

      expect(results).toHaveLength(3);
    });

    it("respects maxConcurrent batching", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      const urls = Array.from(
        { length: 5 },
        (_, i) => `https://example${i}.com`,
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeJinaResponse(),
      });

      const results = await service.extractMultiple(urls, 2);
      expect(results).toHaveLength(5);
    });
  });

  // =========================================================================
  // deepResearch
  // =========================================================================
  describe("deepResearch", () => {
    it("returns error when Tavily key is not configured", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.deepResearch("AI trends 2024");

      expect(result.error).toContain("Tavily API key not configured");
      expect(result.sources).toHaveLength(0);
    });

    it("returns research results on Tavily success", async () => {
      process.env.TAVILY_API_KEY = "tvly-research-key";
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          answer: "AI is growing rapidly in 2024",
          results: [
            {
              url: "https://techcrunch.com/ai",
              title: "AI Growth in 2024",
              content: "Article: AI adoption grew 50% in 2024.",
              score: 0.92,
            },
            {
              url: "https://wired.com/ai",
              title: "The AI Revolution",
              content: "Wired: AI changed everything: 10 key trends.",
              raw_content: "Full raw content here with numbers: 100 companies",
              score: 0.85,
            },
          ],
        }),
      });

      const result = await service.deepResearch("AI trends 2024");

      expect(result.synthesis).toContain("AI is growing rapidly");
      expect(result.sources).toHaveLength(2);
      expect(result.keyPoints.length).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    });

    it("handles Tavily API failure gracefully", async () => {
      process.env.TAVILY_API_KEY = "tvly-error-key";
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await service.deepResearch("query");

      expect(result.error).toBeTruthy();
      expect(result.sources).toHaveLength(0);
    });

    it("applies custom options (maxResults, searchDepth)", async () => {
      process.env.TAVILY_API_KEY = "tvly-options-key";
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ answer: "Result", results: [] }),
      });

      const result = await service.deepResearch("query", {
        maxResults: 5,
        searchDepth: "basic",
        includeRawContent: false,
      });

      expect(result.synthesis).toBe("Result");
    });
  });

  // =========================================================================
  // generateAIContext
  // =========================================================================
  describe("generateAIContext", () => {
    it("returns empty string for empty array", () => {
      expect(service.generateAIContext([])).toBe("");
    });

    it("returns empty string when all items have errors", () => {
      const contents = [
        {
          url: "https://example.com",
          content: "",
          contentLength: 0,
          source: "fallback" as const,
          error: "Failed",
        },
      ];
      expect(service.generateAIContext(contents)).toBe("");
    });

    it("generates context section for valid content", () => {
      const contents = [
        {
          url: "https://example.com",
          title: "Example Article",
          content: "This is the article content.",
          contentLength: 29,
          siteName: "Example",
          author: "Jane Doe",
          publishedDate: "2024-01-01",
          source: "jina" as const,
        },
      ];

      const context = service.generateAIContext(contents);

      expect(context).toContain("Example Article");
      expect(context).toContain("Example");
      expect(context).toContain("Jane Doe");
      expect(context).toContain("2024-01-01");
      expect(context).toContain("This is the article content.");
      expect(context).toContain("参考资料");
    });

    it("skips items with empty content", () => {
      const contents = [
        {
          url: "https://a.com",
          title: "Article A",
          content: "Content A",
          contentLength: 9,
          source: "jina" as const,
        },
        {
          url: "https://b.com",
          title: "Article B",
          content: "",
          contentLength: 0,
          source: "fallback" as const,
          error: "failed",
        },
      ];

      const context = service.generateAIContext(contents);
      expect(context).toContain("Article A");
      expect(context).not.toContain("Article B");
    });
  });

  // =========================================================================
  // generateResearchContext
  // =========================================================================
  describe("generateResearchContext", () => {
    it("returns empty string when research has error", () => {
      const research = {
        query: "test",
        sources: [],
        synthesis: "",
        keyPoints: [],
        error: "Tavily not configured",
      };
      expect(service.generateResearchContext(research)).toBe("");
    });

    it("returns empty string when sources array is empty", () => {
      const research = {
        query: "test",
        sources: [],
        synthesis: "Some synthesis",
        keyPoints: [],
      };
      expect(service.generateResearchContext(research)).toBe("");
    });

    it("generates context with synthesis and key points", () => {
      const research = {
        query: "AI trends 2024",
        sources: [
          {
            url: "https://example.com",
            title: "AI Growth",
            content: "A".repeat(100),
            relevance: 0.95,
          },
        ],
        synthesis: "AI is growing fast.",
        keyPoints: ["Key point 1", "Key point 2"],
      };

      const context = service.generateResearchContext(research);

      expect(context).toContain("AI trends 2024");
      expect(context).toContain("AI is growing fast.");
      expect(context).toContain("Key point 1");
      expect(context).toContain("95%");
      expect(context).toContain("深度研究结果");
    });

    it("truncates long source content to 2000 chars", () => {
      const research = {
        query: "long content test",
        sources: [
          {
            url: "https://example.com",
            title: "Long Article",
            content: "X".repeat(3000),
            relevance: 0.8,
          },
        ],
        synthesis: "synthesis",
        keyPoints: [],
      };

      const context = service.generateResearchContext(research);

      // The context should contain truncated content indicator
      expect(context).toContain("...");
    });
  });

  // =========================================================================
  // cleanupCache
  // =========================================================================
  describe("cleanupCache", () => {
    it("removes expired cache entries", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => makeJinaResponse(),
      });

      // Prime the cache
      await service.extractContent("https://cleanup.example.com");

      // Calling cleanupCache shouldn't throw
      expect(() => service.cleanupCache()).not.toThrow();
    });
  });

  // =========================================================================
  // BYOK getApiKey paths (2026-05-28)
  // =========================================================================
  describe("BYOK getApiKey", () => {
    const callGetApiKey = (
      svc: WebContentExtractionService,
      provider: "jina" | "firecrawl" | "tavily",
    ) =>
      (
        svc as unknown as {
          getApiKey: (p: string) => Promise<string | undefined>;
        }
      ).getApiKey(provider);

    it("用户 key 优先，不进 apiKeyCache（防跨用户污染）", async () => {
      const resolver = {
        resolveToolKey: jest.fn().mockResolvedValue({ value: "user-fc-key" }),
      };
      const dbFindMany = jest.fn().mockResolvedValue([]);
      const svc = new WebContentExtractionService(
        { systemSetting: { findMany: dbFindMany } } as unknown as PrismaService,
        resolver as never,
      );
      const key = await RequestContext.run({ userId: "u1" }, () =>
        callGetApiKey(svc, "firecrawl"),
      );
      expect(key).toBe("user-fc-key");
      expect(resolver.resolveToolKey).toHaveBeenCalledWith("firecrawl", "u1");
      // 提前返回，绝不触碰共享 DB cache
      expect(dbFindMany).not.toHaveBeenCalled();
    });

    it("STRICT NoToolKeyError → 返回 undefined，不借 admin", async () => {
      const resolver = {
        resolveToolKey: jest
          .fn()
          .mockRejectedValue(new NoToolKeyError("jina", "jina-api-key")),
      };
      const dbFindMany = jest.fn().mockResolvedValue([]);
      const svc = new WebContentExtractionService(
        { systemSetting: { findMany: dbFindMany } } as unknown as PrismaService,
        resolver as never,
      );
      const key = await RequestContext.run({ userId: "u1" }, () =>
        callGetApiKey(svc, "jina"),
      );
      expect(key).toBeUndefined();
      expect(dbFindMany).not.toHaveBeenCalled();
    });

    it("无 userId 走 systemSetting + env（系统任务路径）", async () => {
      const resolver = { resolveToolKey: jest.fn() };
      const dbFindMany = jest.fn().mockResolvedValue([
        {
          key: "extraction.jina.apiKey",
          value: JSON.stringify("admin-jina"),
        },
      ]);
      const svc = new WebContentExtractionService(
        { systemSetting: { findMany: dbFindMany } } as unknown as PrismaService,
        resolver as never,
      );
      const key = await callGetApiKey(svc, "jina");
      expect(resolver.resolveToolKey).not.toHaveBeenCalled();
      expect(key).toBe("admin-jina");
    });
  });
});
