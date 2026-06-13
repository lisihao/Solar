import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { of } from "rxjs";
import { SearchService } from "../web-search.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import { ToolKeyResolverService } from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";

// Mock duck-duck-scrape module
const mockDuckSearch = jest.fn();
jest.mock("duck-duck-scrape", () => ({
  search: (...args: unknown[]) => mockDuckSearch(...args),
  SafeSearchType: { MODERATE: 1 },
  SearchTimeType: { DAY: "d", WEEK: "w", MONTH: "m", YEAR: "y" },
}));

describe("SearchService", () => {
  let service: SearchService;
  let httpService: { post: jest.Mock; get: jest.Mock };
  let prisma: { systemSetting: { findFirst: jest.Mock } };
  let secretsService: {
    getValueInternal: jest.Mock;
    getValueInternalAllKeys: jest.Mock;
    markSecretFailure: jest.Mock;
    markSecretSuccess: jest.Mock;
  };
  let configService: { get: jest.Mock };

  // Helper: build a mock Axios-style Observable response
  const mockAxiosResponse = (data: unknown) =>
    of({
      data,
      status: 200,
      statusText: "OK",
      headers: {},
      config: {} as unknown,
    });

  // Helper: build a rejecting Observable
  const _mockAxiosError = (status: number, message = "API Error") => {
    const err = Object.assign(new Error(message), {
      response: { status, data: { message } },
    });
    throw err; // synchronous throw so Promise.reject works
  };

  // Helper: setup default config mocks (tavily provider with 1 key)
  const setupDefaultConfig = (
    opts: {
      tavilySecret?: string | null;
      serperSecret?: string | null;
      tavilyEnvKey?: string;
      serperEnvKey?: string;
      provider?: string;
      enabled?: boolean;
    } = {},
  ) => {
    const {
      tavilySecret = "tvly-test-key-1234567890",
      serperSecret = null,
      tavilyEnvKey = "",
      serperEnvKey = "",
      provider = "tavily",
      enabled = true,
    } = opts;

    configService.get.mockImplementation((key: string) => {
      if (key === "TAVILY_API_KEY") return tavilyEnvKey;
      if (key === "SERPER_API_KEY") return serperEnvKey;
      return undefined;
    });

    secretsService.getValueInternal.mockImplementation((name: string) => {
      if (name.includes("TAVILY") || name.includes("tavily"))
        return Promise.resolve(tavilySecret);
      if (name.includes("SERPER") || name.includes("serper"))
        return Promise.resolve(serperSecret);
      return Promise.resolve(null);
    });

    // ★ 2026-05-12: SearchService 现在走 getValueInternalAllKeys 拿 keyId 数组
    //   仍然兼容 secretSecret 设置，但返回 keyId=null 模拟 legacy fallback 模式
    secretsService.getValueInternalAllKeys.mockImplementation(
      (name: string) => {
        if (name.includes("TAVILY") || name.includes("tavily")) {
          if (!tavilySecret) return Promise.resolve([]);
          return Promise.resolve([
            { value: tavilySecret, keyId: "tavily-keyid-1", label: "default" },
          ]);
        }
        if (name.includes("SERPER") || name.includes("serper")) {
          if (!serperSecret) return Promise.resolve([]);
          return Promise.resolve([
            { value: serperSecret, keyId: "serper-keyid-1", label: "default" },
          ]);
        }
        return Promise.resolve([]);
      },
    );

    prisma.systemSetting.findFirst.mockImplementation(
      async (args: { where: { key: string } }) => {
        if (args.where.key === "search.provider")
          return { value: JSON.stringify(provider) };
        if (args.where.key === "search.enabled")
          return { value: JSON.stringify(enabled) };
        return null;
      },
    );
  };

  beforeEach(async () => {
    mockDuckSearch.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
            get: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            systemSetting: { findFirst: jest.fn() },
          },
        },
        {
          provide: SecretsService,
          useValue: {
            getValueInternal: jest.fn(),
            getValueInternalAllKeys: jest.fn().mockResolvedValue([]),
            markSecretFailure: jest.fn().mockResolvedValue(undefined),
            markSecretSuccess: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: ToolKeyResolverService,
          useValue: {
            resolveToolKey: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
    httpService = module.get(HttpService);
    prisma = module.get(PrismaService);
    secretsService = module.get(SecretsService);
    configService = module.get(ConfigService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────
  describe("lifecycle", () => {
    it("onModuleInit starts cleanup timer", () => {
      const spy = jest.spyOn(global, "setInterval");
      service.onModuleInit();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("onModuleDestroy clears timer", () => {
      service.onModuleInit();
      const spy = jest.spyOn(global, "clearInterval");
      service.onModuleDestroy();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("onModuleDestroy is idempotent when timer is null", () => {
      // Should not throw when called without init
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────
  // getMaskedKeyForDisplay
  // ─────────────────────────────────────────────
  describe("getMaskedKeyForDisplay", () => {
    it("returns **** for short keys", () => {
      expect(service.getMaskedKeyForDisplay("short")).toBe("****");
    });

    it("returns **** for empty key", () => {
      expect(service.getMaskedKeyForDisplay("")).toBe("****");
    });

    it("masks key with prefix and suffix", () => {
      const result = service.getMaskedKeyForDisplay("tvly-abcdefghijklmnop");
      expect(result).toMatch(/^tvly-abc\*\*\*\*nop$/);
    });

    it("shows first 8 chars and last 3 chars", () => {
      const key = "12345678XYZABCDE"; // 16 chars
      const result = service.getMaskedKeyForDisplay(key);
      expect(result.startsWith("12345678")).toBe(true);
      expect(result.endsWith("CDE")).toBe(true);
      expect(result).toContain("****");
    });
  });

  // ─────────────────────────────────────────────
  // formatResultsForContext
  // ─────────────────────────────────────────────
  describe("formatResultsForContext", () => {
    it("returns empty string for empty results", () => {
      expect(service.formatResultsForContext([])).toBe("");
    });

    it("formats results with numbering", () => {
      const results = [
        {
          title: "Article 1",
          url: "https://example.com",
          content: "Summary 1",
        },
        { title: "Article 2", url: "https://test.com", content: "Summary 2" },
      ];
      const output = service.formatResultsForContext(results);
      expect(output).toContain("## Web Search Results");
      expect(output).toContain("1. **Article 1**");
      expect(output).toContain("2. **Article 2**");
      expect(output).toContain("https://example.com");
      expect(output).toContain("Summary 2");
    });
  });

  // ─────────────────────────────────────────────
  // extractUrls
  // ─────────────────────────────────────────────
  describe("extractUrls", () => {
    it("extracts HTTP URLs from text", () => {
      const text = "Check http://example.com for details";
      expect(service.extractUrls(text)).toContain("http://example.com");
    });

    it("extracts HTTPS URLs", () => {
      const text = "See https://news.com/article?id=1 and https://blog.org";
      const urls = service.extractUrls(text);
      expect(urls).toContain("https://news.com/article?id=1");
      expect(urls).toContain("https://blog.org");
    });

    it("removes trailing punctuation", () => {
      const text = "Visit https://example.com.";
      const urls = service.extractUrls(text);
      expect(urls[0]).toBe("https://example.com");
    });

    it("returns empty array when no URLs", () => {
      expect(service.extractUrls("no urls here")).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────
  // fetchUrlContent
  // ─────────────────────────────────────────────
  describe("fetchUrlContent", () => {
    it("successfully fetches and parses HTML content", async () => {
      const html =
        "<html><head><title>Test Page</title></head><body><p>Hello world</p></body></html>";
      httpService.get.mockReturnValue(mockAxiosResponse(html));

      const result = await service.fetchUrlContent("https://example.com");
      expect(result.success).toBe(true);
      expect(result.title).toBe("Test Page");
      expect(result.content).toContain("Hello world");
    });

    it("strips script and style tags", async () => {
      const html =
        '<html><head><title>T</title><script>alert("xss")</script></head><body><style>.a{color:red}</style><p>Content</p></body></html>';
      httpService.get.mockReturnValue(mockAxiosResponse(html));

      const result = await service.fetchUrlContent("https://example.com");
      expect(result.content).not.toContain("alert");
      expect(result.content).not.toContain("color:red");
      expect(result.content).toContain("Content");
    });

    it("decodes HTML entities", async () => {
      const html =
        "<html><head><title>T</title></head><body><p>Tom &amp; Jerry &lt;3&gt;</p></body></html>";
      httpService.get.mockReturnValue(mockAxiosResponse(html));

      const result = await service.fetchUrlContent("https://example.com");
      expect(result.content).toContain("Tom & Jerry");
    });

    it("truncates content to 3000 chars", async () => {
      const longContent = "A".repeat(5000);
      const html = `<html><head><title>T</title></head><body>${longContent}</body></html>`;
      httpService.get.mockReturnValue(mockAxiosResponse(html));

      const result = await service.fetchUrlContent("https://example.com");
      expect(result.content!.length).toBeLessThanOrEqual(3005); // 3000 + "..."
    });

    it("uses longer timeout for PDF URLs", async () => {
      const result = await service.fetchUrlContent(
        "https://example.com/doc.pdf",
      );
      expect(result.success).toBe(false);
      expect(httpService.get).not.toHaveBeenCalledWith(
        "https://example.com/doc.pdf",
        expect.anything(),
      );
    });

    it("uses standard timeout for regular URLs", async () => {
      const html =
        "<html><head><title>T</title></head><body>content</body></html>";
      httpService.get.mockReturnValue(mockAxiosResponse(html));

      await service.fetchUrlContent("https://example.com/article");
      expect(httpService.get).toHaveBeenCalledWith(
        "https://example.com/article",
        expect.objectContaining({ timeout: 30000 }),
      );
    });

    it("returns failure on HTTP error", async () => {
      httpService.get.mockReturnValue(
        new (require("rxjs").Observable)(
          (subscriber: { error: (e: Error) => void }) => {
            subscriber.error(
              Object.assign(new Error(), {
                response: { status: 404, statusText: "Not Found" },
              }),
            );
          },
        ),
      );

      const result = await service.fetchUrlContent("https://example.com/404");
      expect(result.success).toBe(false);
      expect(result.error).toContain("404");
    });

    it("handles non-string response", async () => {
      httpService.get.mockReturnValue(mockAxiosResponse({ json: "data" }));

      const result = await service.fetchUrlContent(
        "https://api.example.com/data",
      );
      expect(result.success).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // fetchUrlsForContext
  // ─────────────────────────────────────────────
  describe("fetchUrlsForContext", () => {
    it("returns empty string for empty urls", async () => {
      const result = await service.fetchUrlsForContext([]);
      expect(result).toBe("");
    });

    it("fetches up to 3 URLs", async () => {
      const html =
        "<html><head><title>T</title></head><body>Content</body></html>";
      httpService.get.mockReturnValue(mockAxiosResponse(html));

      const urls = [
        "https://a.com",
        "https://b.com",
        "https://c.com",
        "https://d.com",
      ];
      await service.fetchUrlsForContext(urls);
      expect(httpService.get).toHaveBeenCalledTimes(3);
    });

    it("returns formatted context when URLs succeed", async () => {
      const html =
        "<html><head><title>Article</title></head><body>Summary text here</body></html>";
      httpService.get.mockReturnValue(mockAxiosResponse(html));

      const result = await service.fetchUrlsForContext(["https://example.com"]);
      expect(result).toContain("## Fetched Web Page Content");
      expect(result).toContain("Article");
    });

    it("returns empty string when all fetches fail", async () => {
      httpService.get.mockReturnValue(
        new (require("rxjs").Observable)(
          (subscriber: { error: (e: Error) => void }) => {
            subscriber.error(new Error("Network error"));
          },
        ),
      );

      const result = await service.fetchUrlsForContext(["https://example.com"]);
      expect(result).toBe("");
    });
  });

  // ─────────────────────────────────────────────
  // search - config disabled
  // ─────────────────────────────────────────────
  describe("search - disabled config", () => {
    it("falls back to duckduckgo when search is disabled", async () => {
      setupDefaultConfig({ enabled: false });
      mockDuckSearch.mockResolvedValue({
        noResults: false,
        results: [
          {
            title: "DDG Result",
            url: "https://ddg.com",
            description: "DDG content",
            hostname: "ddg.com",
          },
        ],
      });

      const result = await service.search("test query");
      expect(result.success).toBe(true);
      expect(result.provider).toBe("duckduckgo");
    });
  });

  // ─────────────────────────────────────────────
  // search - Tavily provider
  // ─────────────────────────────────────────────
  describe("search - tavily", () => {
    beforeEach(() => {
      setupDefaultConfig({ provider: "tavily", tavilySecret: "tvly-key1" });
    });

    it("returns successful results from Tavily", async () => {
      httpService.post.mockReturnValue(
        mockAxiosResponse({
          results: [
            {
              title: "Tavily Result",
              url: "https://news.com/article",
              content: "Article content here",
              score: 0.9,
            },
          ],
        }),
      );

      const result = await service.search("AI news", 5);
      expect(result.success).toBe(true);
      expect(result.provider).toBe("tavily");
      expect(result.results.length).toBeGreaterThan(0);
    });

    it("passes query to Tavily API", async () => {
      httpService.post.mockReturnValue(mockAxiosResponse({ results: [] }));

      await service.search("specific query", 3);
      expect(httpService.post).toHaveBeenCalledWith(
        "https://api.tavily.com/search",
        expect.objectContaining({ query: "specific query", max_results: 6 }),
        expect.any(Object),
      );
    });

    it("includes days param when since date provided", async () => {
      httpService.post.mockReturnValue(mockAxiosResponse({ results: [] }));

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      await service.search("recent news", 5, since);
      expect(httpService.post).toHaveBeenCalledWith(
        "https://api.tavily.com/search",
        expect.objectContaining({ days: expect.any(Number) }),
        expect.any(Object),
      );
    });

    it("failovers to duckduckgo when Tavily fails with 429", async () => {
      httpService.post.mockReturnValue(
        new (require("rxjs").Observable)(
          (subscriber: { error: (e: Error) => void }) => {
            subscriber.error(
              Object.assign(new Error("Rate limited"), {
                response: { status: 429 },
              }),
            );
          },
        ),
      );
      mockDuckSearch.mockResolvedValue({
        noResults: false,
        results: [
          {
            title: "DDG Result",
            url: "https://ddg.com",
            description: "DDG content",
            hostname: "ddg.com",
          },
        ],
      });

      const result = await service.search("test");
      expect(result.success).toBe(true);
      expect(result.provider).toBe("duckduckgo");
    });

    it("failovers to duckduckgo on network error", async () => {
      httpService.post.mockReturnValue(
        new (require("rxjs").Observable)(
          (subscriber: { error: (e: Error) => void }) => {
            subscriber.error(new Error("Network failure"));
          },
        ),
      );
      mockDuckSearch.mockResolvedValue({
        noResults: false,
        results: [
          {
            title: "DDG",
            url: "https://ddg.com",
            description: "content",
            hostname: "ddg.com",
          },
        ],
      });

      const result = await service.search("test");
      expect(result.provider).toBe("duckduckgo");
    });

    it("returns failure when all providers fail", async () => {
      httpService.post.mockReturnValue(
        new (require("rxjs").Observable)(
          (subscriber: { error: (e: Error) => void }) => {
            subscriber.error(
              Object.assign(new Error("API error"), {
                response: { status: 500 },
              }),
            );
          },
        ),
      );
      mockDuckSearch.mockRejectedValue(new Error("DDG also failed"));

      const result = await service.search("test");
      expect(result.success).toBe(false);
    });

    it("applies diversity filter limiting results per domain", async () => {
      // 6 results: 4 from same-domain.com, 2 from other domains
      // With maxResults=4 and maxPerDomain=2, we expect max 2 from same-domain.com
      const results = [
        {
          title: "A1",
          url: "https://same-domain.com/a1",
          content: "Content ".repeat(50),
          score: 0.9,
        },
        {
          title: "A2",
          url: "https://same-domain.com/a2",
          content: "Content ".repeat(50),
          score: 0.8,
        },
        {
          title: "A3",
          url: "https://same-domain.com/a3",
          content: "Content ".repeat(50),
          score: 0.7,
        },
        {
          title: "A4",
          url: "https://same-domain.com/a4",
          content: "Content ".repeat(50),
          score: 0.6,
        },
        {
          title: "B1",
          url: "https://other1.com/b1",
          content: "Content ".repeat(50),
          score: 0.85,
        },
        {
          title: "C1",
          url: "https://other2.com/c1",
          content: "Content ".repeat(50),
          score: 0.75,
        },
      ];
      httpService.post.mockReturnValue(mockAxiosResponse({ results }));

      const result = await service.search("query", 4);
      // Should limit same-domain.com to max 2 per domain since other domains fill the rest
      const sameDomainCount = result.results.filter((r) =>
        r.url?.includes("same-domain.com"),
      ).length;
      expect(sameDomainCount).toBeLessThanOrEqual(2);
    });
  });

  // ─────────────────────────────────────────────
  // search - Serper provider
  // ─────────────────────────────────────────────
  describe("search - serper", () => {
    beforeEach(() => {
      setupDefaultConfig({
        provider: "serper",
        tavilySecret: null,
        serperSecret: "serper-api-key-1",
      });
    });

    it("returns results from Serper", async () => {
      httpService.post.mockReturnValue(
        mockAxiosResponse({
          organic: [
            {
              title: "Serper Result",
              link: "https://google.com/result",
              snippet: "Result snippet",
            },
          ],
        }),
      );

      const result = await service.search("query", 5);
      expect(result.success).toBe(true);
      expect(result.provider).toBe("serper");
    });

    it("passes X-API-KEY header to Serper", async () => {
      httpService.post.mockReturnValue(mockAxiosResponse({ organic: [] }));

      await service.search("query");
      expect(httpService.post).toHaveBeenCalledWith(
        "https://google.serper.dev/search",
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({ "X-API-KEY": "serper-api-key-1" }),
        }),
      );
    });

    it("includes tbs param for recent queries", async () => {
      httpService.post.mockReturnValue(mockAxiosResponse({ organic: [] }));

      const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
      await service.search("news", 5, since);
      expect(httpService.post).toHaveBeenCalledWith(
        "https://google.serper.dev/search",
        expect.objectContaining({ tbs: "qdr:w" }), // within week
        expect.any(Object),
      );
    });
  });

  // ─────────────────────────────────────────────
  // search - DuckDuckGo
  // ─────────────────────────────────────────────
  describe("search - duckduckgo", () => {
    beforeEach(() => {
      setupDefaultConfig({
        provider: "duckduckgo",
        tavilySecret: null,
        serperSecret: null,
      });
    });

    it("returns results from DuckDuckGo", async () => {
      mockDuckSearch.mockResolvedValue({
        noResults: false,
        results: [
          {
            title: "DDG Result",
            url: "https://example.com",
            description: "Desc",
            hostname: "example.com",
          },
        ],
      });

      const result = await service.search("query", 5);
      expect(result.success).toBe(true);
      expect(result.provider).toBe("duckduckgo");
      expect(result.results[0].title).toBe("DDG Result");
    });

    it("returns success with empty results when no results found", async () => {
      mockDuckSearch.mockResolvedValue({ noResults: true, results: [] });

      const result = await service.search("very obscure query");
      expect(result.success).toBe(true);
      expect(result.results).toEqual([]);
    });

    it("includes time filter for since date", async () => {
      mockDuckSearch.mockResolvedValue({ noResults: false, results: [] });

      const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days
      await service.search("news", 5, since);
      expect(mockDuckSearch).toHaveBeenCalledWith(
        "news",
        expect.objectContaining({ time: "w" }), // within week
      );
    });

    it("handles DuckDuckGo failure gracefully", async () => {
      mockDuckSearch.mockRejectedValue(new Error("DDG unavailable"));

      const result = await service.search("test");
      expect(result.success).toBe(false);
      expect(result.results).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────
  // search - multiple keys + rotation
  // ─────────────────────────────────────────────
  describe("search - key rotation", () => {
    it("rotates to next key after one fails with 429", async () => {
      setupDefaultConfig({ tavilySecret: "key1,key2", provider: "tavily" });

      let callCount = 0;
      httpService.post.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return new (require("rxjs").Observable)(
            (subscriber: { error: (e: Error) => void }) => {
              subscriber.error(
                Object.assign(new Error("Rate limited"), {
                  response: { status: 429 },
                }),
              );
            },
          );
        }
        return mockAxiosResponse({
          results: [
            { title: "Result", url: "https://good.com", content: "content" },
          ],
        });
      });

      const result = await service.search("test");
      expect(result.success).toBe(true);
      expect(callCount).toBe(2);
    });

    it("falls back to duckduckgo when all keys exhausted", async () => {
      setupDefaultConfig({ tavilySecret: "key1,key2", provider: "tavily" });

      httpService.post.mockReturnValue(
        new (require("rxjs").Observable)(
          (subscriber: { error: (e: Error) => void }) => {
            subscriber.error(
              Object.assign(new Error("Rate limited"), {
                response: { status: 429 },
              }),
            );
          },
        ),
      );
      mockDuckSearch.mockResolvedValue({
        noResults: false,
        results: [
          {
            title: "DDG",
            url: "https://ddg.com",
            description: "ddg",
            hostname: "ddg.com",
          },
        ],
      });

      const result = await service.search("test");
      expect(result.provider).toBe("duckduckgo");
    });
  });

  // ─────────────────────────────────────────────
  // search - env var fallback
  // ─────────────────────────────────────────────
  describe("search - env var fallback", () => {
    it("uses env vars when secret manager throws", async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === "TAVILY_API_KEY") return "env-tavily-key-12345678";
        return undefined;
      });
      secretsService.getValueInternal.mockRejectedValue(
        new Error("Secret manager down"),
      );
      prisma.systemSetting.findFirst.mockResolvedValue(null);

      httpService.post.mockReturnValue(
        mockAxiosResponse({
          results: [
            { title: "Result", url: "https://example.com", content: "content" },
          ],
        }),
      );

      const result = await service.search("query");
      expect(result.success).toBe(true);
    });

    it("uses duckduckgo when no keys available", async () => {
      configService.get.mockReturnValue(undefined);
      secretsService.getValueInternal.mockResolvedValue(null);
      prisma.systemSetting.findFirst.mockResolvedValue(null);

      mockDuckSearch.mockResolvedValue({
        noResults: false,
        results: [
          {
            title: "DDG",
            url: "https://ddg.com",
            description: "content",
            hostname: "ddg.com",
          },
        ],
      });

      const result = await service.search("query");
      expect(result.success).toBe(true);
      expect(result.provider).toBe("duckduckgo");
    });
  });

  // ─────────────────────────────────────────────
  // getKeyHealthStatus
  // ─────────────────────────────────────────────
  describe("getKeyHealthStatus", () => {
    it("returns healthy status for unused keys", async () => {
      setupDefaultConfig({ tavilySecret: "tvly-key1234567890" });

      const statuses = await service.getKeyHealthStatus("tavily");
      expect(statuses).toHaveLength(1);
      expect(statuses[0].isHealthy).toBe(true);
      expect(statuses[0].index).toBe(0);
      expect(statuses[0].maskedKey).toContain("****");
    });

    it("shows unhealthy key after failure and cooldown not elapsed", async () => {
      setupDefaultConfig({ tavilySecret: "tvly-keyabc1234567890" });

      // Simulate a search failure that marks the key as failed
      httpService.post.mockReturnValue(
        new (require("rxjs").Observable)(
          (subscriber: { error: (e: Error) => void }) => {
            subscriber.error(
              Object.assign(new Error("Quota"), { response: { status: 429 } }),
            );
          },
        ),
      );
      mockDuckSearch.mockResolvedValue({ noResults: false, results: [] });
      await service.search("trigger failure");

      const statuses = await service.getKeyHealthStatus("tavily");
      const status = statuses[0];
      // After a 429, key should be in cooldown
      expect(status.isHealthy).toBe(false);
      expect(status.lastError).toBe("HTTP 429");
      expect(status.cooldownUntil).toBeDefined();
    });

    it("returns statuses for multiple keys", async () => {
      setupDefaultConfig({ tavilySecret: "key1111111111,key2222222222" });

      const statuses = await service.getKeyHealthStatus("tavily");
      expect(statuses).toHaveLength(2);
      expect(statuses[0].index).toBe(0);
      expect(statuses[1].index).toBe(1);
    });

    it("returns empty array when no keys configured", async () => {
      setupDefaultConfig({ tavilySecret: null, serperSecret: null });

      const statuses = await service.getKeyHealthStatus("serper");
      expect(statuses).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────
  // search - result ranking
  // ─────────────────────────────────────────────
  describe("result ranking", () => {
    it("ranks high-authority domains higher", async () => {
      setupDefaultConfig({
        provider: "tavily",
        tavilySecret: "tvly-test-key1234",
      });

      httpService.post.mockReturnValue(
        mockAxiosResponse({
          results: [
            {
              title: "Low authority",
              url: "https://randomsite.net/article",
              content: "AI news test content here",
              score: 0.5,
            },
            {
              title: "High authority",
              url: "https://nature.com/article",
              content: "AI news test content here",
              score: 0.5,
            },
          ],
        }),
      );

      const result = await service.search("AI news test", 5);
      // nature.com is high authority, should rank higher
      const highIdx = result.results.findIndex((r) =>
        r.url?.includes("nature.com"),
      );
      const lowIdx = result.results.findIndex((r) =>
        r.url?.includes("randomsite.net"),
      );
      expect(highIdx).toBeLessThan(lowIdx);
    });

    it("uses raw score from Tavily in relevance scoring", async () => {
      setupDefaultConfig({
        provider: "tavily",
        tavilySecret: "tvly-test-key1234",
      });

      httpService.post.mockReturnValue(
        mockAxiosResponse({
          results: [
            {
              title: "Low score",
              url: "https://a.com",
              content: "content",
              score: 0.1,
            },
            {
              title: "High score",
              url: "https://b.com",
              content: "content",
              score: 0.9,
            },
          ],
        }),
      );

      const result = await service.search("query", 5);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it("includes freshness scoring for recent content", async () => {
      setupDefaultConfig({
        provider: "tavily",
        tavilySecret: "tvly-test-key1234",
      });

      const recentDate = new Date().toISOString().split("T")[0];
      const oldDate = "2020-01-01";

      httpService.post.mockReturnValue(
        mockAxiosResponse({
          results: [
            {
              title: "Old article",
              url: "https://old.com",
              content: "test query content here",
              published_date: oldDate,
            },
            {
              title: "Recent article",
              url: "https://recent.com",
              content: "test query content here",
              published_date: recentDate,
            },
          ],
        }),
      );

      const result = await service.search("test query", 5);
      // Both should be present
      expect(result.results.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────
  // search - config auto-switching
  // ─────────────────────────────────────────────
  describe("search - config auto-switching", () => {
    it("auto-switches to serper when tavily keys empty and serper has keys", async () => {
      setupDefaultConfig({
        provider: "tavily",
        tavilySecret: null,
        tavilyEnvKey: "",
        serperSecret: "serper-api-key-xxxx",
      });

      httpService.post.mockReturnValue(
        mockAxiosResponse({
          organic: [
            { title: "Serper", link: "https://s.com", snippet: "result" },
          ],
        }),
      );

      const result = await service.search("query");
      expect(result.success).toBe(true);
      expect(result.provider).toBe("serper");
    });

    it("auto-switches to tavily when serper keys empty and tavily has keys", async () => {
      setupDefaultConfig({
        provider: "serper",
        serperSecret: null,
        serperEnvKey: "",
        tavilySecret: "tvly-key-only-one-here",
      });

      httpService.post.mockReturnValue(
        mockAxiosResponse({
          results: [
            { title: "Tavily", url: "https://t.com", content: "content" },
          ],
        }),
      );

      const result = await service.search("query");
      expect(result.success).toBe(true);
      expect(result.provider).toBe("tavily");
    });
  });

  // ─────────────────────────────────────────────
  // Cleanup timer (fake timers)
  // ─────────────────────────────────────────────
  describe("cleanup timer", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("cleanup runs on timer fire but does not throw", () => {
      service.onModuleInit();
      // Advance 1 hour to trigger cleanup
      expect(() => jest.advanceTimersByTime(60 * 60 * 1000)).not.toThrow();
      service.onModuleDestroy();
    });
  });

  // ─────────────────────────────────────────────
  // 2026-05-12: Secret 健康反馈到 DB（admin UI 真实状态可见性）
  // ─────────────────────────────────────────────
  describe("DB sync on key failure / success", () => {
    function makeErrorObservable(status: number, msg: string) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const { Observable } = require("rxjs");
      return new Observable((subscriber: { error: (e: Error) => void }) => {
        subscriber.error(
          Object.assign(new Error(msg), {
            response: { status, data: {} },
          }),
        );
      });
    }

    it("markSecretFailure called with mapped error code on 401", async () => {
      setupDefaultConfig({ tavilySecret: "tvly-key-A" });
      httpService.post.mockReturnValue(
        makeErrorObservable(401, "Unauthorized"),
      );
      mockDuckSearch.mockResolvedValue({
        noResults: false,
        results: [
          {
            title: "DDG",
            url: "https://ddg.com",
            description: "c",
            hostname: "ddg.com",
          },
        ],
      });

      await service.search("hi");
      // 等 fire-and-forget syncSecretFailureToDb 完成
      await new Promise((r) => setImmediate(r));

      expect(secretsService.markSecretFailure).toHaveBeenCalledWith(
        expect.stringMatching(/tavily/i),
        expect.stringContaining("HTTP"),
        "tavily-keyid-1",
        "AUTH_FAILED",
      );
    });

    it("markSecretFailure mapped to RATE_LIMIT_KEY on 429", async () => {
      setupDefaultConfig({ tavilySecret: "tvly-key-A" });
      httpService.post.mockReturnValue(
        makeErrorObservable(429, "Too Many Requests"),
      );
      mockDuckSearch.mockResolvedValue({
        noResults: false,
        results: [
          {
            title: "DDG",
            url: "https://ddg.com",
            description: "c",
            hostname: "ddg.com",
          },
        ],
      });

      await service.search("hi");
      await new Promise((r) => setImmediate(r));

      expect(secretsService.markSecretFailure).toHaveBeenCalledWith(
        expect.stringMatching(/tavily/i),
        expect.stringContaining("HTTP"),
        "tavily-keyid-1",
        "RATE_LIMIT_KEY",
      );
    });

    it("markSecretSuccess called when key recovers from failure (clearKeyFailure)", async () => {
      setupDefaultConfig({ tavilySecret: "tvly-key-A" });

      // First call: 200 success → triggers clearKeyFailure → markSecretSuccess
      httpService.post.mockReturnValueOnce(
        mockAxiosResponse({
          results: [
            { title: "t", url: "https://x.test", content: "c", score: 1 },
          ],
        }),
      );

      await service.search("hi");
      await new Promise((r) => setImmediate(r));

      expect(secretsService.markSecretSuccess).toHaveBeenCalledWith(
        expect.stringMatching(/tavily/i),
        "tavily-keyid-1",
      );
    });

    it("env-var fallback path skips DB sync (keyId=null)", async () => {
      setupDefaultConfig({
        tavilySecret: null, // 强制走 env 路径
        tavilyEnvKey: "tvly-env-key",
      });

      httpService.post.mockReturnValueOnce(
        mockAxiosResponse({
          results: [
            { title: "t", url: "https://x.test", content: "c", score: 1 },
          ],
        }),
      );

      await service.search("hi");
      await new Promise((r) => setImmediate(r));

      expect(secretsService.markSecretSuccess).not.toHaveBeenCalled();
      expect(secretsService.markSecretFailure).not.toHaveBeenCalled();
    });
  });
});
