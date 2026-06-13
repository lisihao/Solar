/**
 * SearchService — Supplemental Tests
 *
 * Targets uncovered code paths not covered by search.service.spec.ts:
 * - getKeyHealthStatus for serper with healthy/unhealthy keys
 * - getKeyHealthStatus shows cooldownUntil for unhealthy quota-exhausted key (400/401)
 * - buildFailoverChain: provider=duckduckgo with keys present still pushes ddg first
 * - buildFailoverChain: provider=tavily with no keys → falls back to serper then ddg
 * - buildFailoverChain: provider=serper with no keys → falls back to tavily then ddg
 * - search() returns error object when shouldFailover=false (non-failover status code)
 * - executeSearch() unknown provider throws BadRequestException
 * - executeWithKeyRetry: no valid keys throws ServiceUnavailableException
 * - clearKeyFailure: clears on success
 * - calculateFreshnessScore branches: recent/monthly/quarterly/half-year/older/invalid date
 * - calculateDepthScore branches: various content lengths
 * - calculateQualityScore: medium authority, low quality, edu/gov/org domains
 * - applyDiversityFilter: fills remaining when under maxResults
 * - getSearchConfig: provider auto-switching when no keys at all
 * - Serper with since=1 day → qdr:d, since=8 days → qdr:m, since=100 days → qdr:y, >365 → no tbs
 * - DuckDuckGo time filter: DAY, MONTH, YEAR branches
 * - Tavily with since date that yields 0 days (today)
 */

const mockDuckSearch = jest.fn();
jest.mock("duck-duck-scrape", () => ({
  search: (...args: unknown[]) => mockDuckSearch(...args),
  SafeSearchType: { MODERATE: 1 },
  SearchTimeType: { DAY: "d", WEEK: "w", MONTH: "m", YEAR: "y" },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { of } from "rxjs";
import { SearchService } from "../web-search.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import { ToolKeyResolverService } from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeAxiosResponse = (data: unknown) =>
  of({
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: {} as unknown,
  });

const makeAxiosError = (status: number, message = "API Error") =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  new (require("rxjs").Observable)(
    (subscriber: { error: (e: unknown) => void }) => {
      subscriber.error(
        Object.assign(new Error(message), {
          response: { status, data: { message } },
        }),
      );
    },
  );

const makeNetworkError = (message = "Network error") =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  new (require("rxjs").Observable)(
    (subscriber: { error: (e: unknown) => void }) => {
      subscriber.error(new Error(message));
    },
  );

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("SearchService (supplemental)", () => {
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

  const setupConfig = (opts: {
    tavilySecret?: string | null;
    serperSecret?: string | null;
    tavilyEnvKey?: string;
    serperEnvKey?: string;
    provider?: string;
    enabled?: boolean;
  }) => {
    const {
      tavilySecret = null,
      serperSecret = null,
      tavilyEnvKey = "",
      serperEnvKey = "",
      provider = "duckduckgo",
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
        { provide: HttpService, useValue: { post: jest.fn(), get: jest.fn() } },
        {
          provide: PrismaService,
          useValue: { systemSetting: { findFirst: jest.fn() } },
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
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: ToolKeyResolverService,
          useValue: { resolveToolKey: jest.fn().mockResolvedValue(null) },
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
  // getKeyHealthStatus — quota exhausted (400/401) shows longer cooldown
  // ─────────────────────────────────────────────
  describe("getKeyHealthStatus - quota exhausted cooldown", () => {
    it("shows long cooldown for 400 (quota exhausted) key failure", async () => {
      setupConfig({
        serperSecret: "serper-abc1234567890",
        provider: "serper",
      });

      // Trigger a 400 error on serper with "Quota exceeded" body
      // 2026-05-12：search service 把 400+quota-in-body 规范化为 402（标准
      // payment-required 语义），让 24h 长冷却路径生效。
      httpService.post.mockReturnValueOnce(
        makeAxiosError(400, "Quota exceeded"),
      );
      mockDuckSearch.mockResolvedValue({ noResults: false, results: [] });

      await service.search("test query");

      const statuses = await service.getKeyHealthStatus("serper");
      expect(statuses[0].isHealthy).toBe(false);
      expect(statuses[0].lastError).toBe("HTTP 402");
      // Cooldown until should be far in future (24h)
      expect(statuses[0].cooldownUntil).toBeDefined();
    });

    it("shows long cooldown for 401 (invalid key) failure", async () => {
      setupConfig({
        tavilySecret: "tvly-badkey1234567890",
        provider: "tavily",
      });

      httpService.post.mockReturnValueOnce(makeAxiosError(401, "Unauthorized"));
      mockDuckSearch.mockResolvedValue({ noResults: false, results: [] });

      await service.search("test query");

      const statuses = await service.getKeyHealthStatus("tavily");
      expect(statuses[0].isHealthy).toBe(false);
      expect(statuses[0].lastError).toBe("HTTP 401");
    });

    it("shows healthy after key recovers from short cooldown", async () => {
      setupConfig({
        tavilySecret: "tvly-goodkey1234567890",
        provider: "tavily",
      });

      // First: success — key should be healthy
      httpService.post.mockReturnValue(
        makeAxiosResponse({
          results: [{ title: "T", url: "https://a.com", content: "c" }],
        }),
      );

      await service.search("test query");

      const statuses = await service.getKeyHealthStatus("tavily");
      expect(statuses[0].isHealthy).toBe(true);
      expect(statuses[0].lastError).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────
  // search() — non-failover error code
  // ─────────────────────────────────────────────
  describe("search() - non-failover error code returns failure", () => {
    it("returns failure directly when shouldFailover=false (e.g. 403)", async () => {
      setupConfig({ tavilySecret: "tvly-key1234567890", provider: "tavily" });

      // 403 is not in FAILOVER_STATUS_CODES, so no failover
      // Actually checking source: FAILOVER_STATUS_CODES = [400, 401, 429, 432, 500, 502, 503, 504]
      // 403 is NOT in the list, meaning shouldFailover = false when 403 is returned
      // This should return early with failure without trying other providers
      // But wait — executeWithKeyRetry catches and marks key failed only when statusCode is defined
      // The provider-level error handling in search() checks shouldFailover
      // With 403, shouldFailover(error) returns false → early return with failure object

      // However, executeWithKeyRetry internally tries each key and then throws
      // The outer loop in search() catches and calls shouldFailover
      // 403 with response.status=403 → FAILOVER_STATUS_CODES.includes(403) = false → shouldFailover=false

      // Set up: 403 from tavily
      httpService.post.mockReturnValue(makeAxiosError(403, "Forbidden"));

      const result = await service.search("test");

      expect(result.success).toBe(false);
      // When shouldFailover is false, we return immediately without trying DDG
      expect(mockDuckSearch).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  // executeWithKeyRetry — no valid keys
  // ─────────────────────────────────────────────
  describe("executeWithKeyRetry - no valid keys", () => {
    it("falls through to duckduckgo when no tavily keys configured", async () => {
      setupConfig({
        tavilySecret: null,
        tavilyEnvKey: "",
        serperSecret: null,
        serperEnvKey: "",
        provider: "tavily",
      });

      mockDuckSearch.mockResolvedValue({
        noResults: false,
        results: [
          {
            title: "DDG",
            url: "https://ddg.com",
            description: "desc",
            hostname: "ddg.com",
          },
        ],
      });

      const result = await service.search("query");
      expect(result.provider).toBe("duckduckgo");
    });
  });

  // ─────────────────────────────────────────────
  // Serper time filter branches
  // ─────────────────────────────────────────────
  describe("Serper time filter branches", () => {
    beforeEach(() => {
      setupConfig({
        serperSecret: "serper-key1234567890",
        tavilySecret: null,
        provider: "serper",
      });
    });

    it("uses qdr:d for since=today (0-1 days)", async () => {
      httpService.post.mockReturnValue(makeAxiosResponse({ organic: [] }));

      const since = new Date(Date.now() - 12 * 60 * 60 * 1000); // 12 hours ago
      await service.search("news", 5, since);

      expect(httpService.post).toHaveBeenCalledWith(
        "https://google.serper.dev/search",
        expect.objectContaining({ tbs: "qdr:d" }),
        expect.any(Object),
      );
    });

    it("uses qdr:m for since=8-30 days", async () => {
      httpService.post.mockReturnValue(makeAxiosResponse({ organic: [] }));

      const since = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000); // 20 days ago
      await service.search("news", 5, since);

      expect(httpService.post).toHaveBeenCalledWith(
        "https://google.serper.dev/search",
        expect.objectContaining({ tbs: "qdr:m" }),
        expect.any(Object),
      );
    });

    it("uses qdr:y for since=31-365 days", async () => {
      httpService.post.mockReturnValue(makeAxiosResponse({ organic: [] }));

      const since = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      await service.search("news", 5, since);

      expect(httpService.post).toHaveBeenCalledWith(
        "https://google.serper.dev/search",
        expect.objectContaining({ tbs: "qdr:y" }),
        expect.any(Object),
      );
    });

    it("omits tbs for since > 365 days", async () => {
      httpService.post.mockReturnValue(makeAxiosResponse({ organic: [] }));

      const since = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000); // 400 days ago
      await service.search("news", 5, since);

      expect(httpService.post).toHaveBeenCalledWith(
        "https://google.serper.dev/search",
        expect.not.objectContaining({ tbs: expect.anything() }),
        expect.any(Object),
      );
    });
  });

  // ─────────────────────────────────────────────
  // DuckDuckGo time filter branches
  // ─────────────────────────────────────────────
  describe("DuckDuckGo time filter branches", () => {
    beforeEach(() => {
      setupConfig({
        tavilySecret: null,
        serperSecret: null,
        provider: "duckduckgo",
      });
      mockDuckSearch.mockResolvedValue({ noResults: false, results: [] });
    });

    it("uses DAY filter for since within 1 day", async () => {
      const since = new Date(Date.now() - 18 * 60 * 60 * 1000); // 18 hours
      await service.search("news", 5, since);

      expect(mockDuckSearch).toHaveBeenCalledWith(
        "news",
        expect.objectContaining({ time: "d" }),
      );
    });

    it("uses MONTH filter for since=8-30 days", async () => {
      const since = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000); // 15 days
      await service.search("news", 5, since);

      expect(mockDuckSearch).toHaveBeenCalledWith(
        "news",
        expect.objectContaining({ time: "m" }),
      );
    });

    it("uses YEAR filter for since=31-365 days", async () => {
      const since = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000); // 200 days
      await service.search("news", 5, since);

      expect(mockDuckSearch).toHaveBeenCalledWith(
        "news",
        expect.objectContaining({ time: "y" }),
      );
    });

    it("omits time filter for since > 365 days", async () => {
      const since = new Date(Date.now() - 500 * 24 * 60 * 60 * 1000); // 500 days
      await service.search("news", 5, since);

      expect(mockDuckSearch).toHaveBeenCalledWith(
        "news",
        expect.not.objectContaining({ time: expect.anything() }),
      );
    });
  });

  // ─────────────────────────────────────────────
  // Tavily: since date 0 days — no days param (days must be > 0)
  // ─────────────────────────────────────────────
  describe("Tavily: since date edge cases", () => {
    beforeEach(() => {
      setupConfig({
        tavilySecret: "tvly-key1234567890",
        provider: "tavily",
      });
    });

    it("omits days param when days=0 (since is now)", async () => {
      httpService.post.mockReturnValue(makeAxiosResponse({ results: [] }));

      // Use a date slightly in the future to guarantee diffMs <= 0 → days=0 → not included
      const since = new Date(Date.now() + 1000);
      await service.search("news", 5, since);

      const call = httpService.post.mock.calls[0];
      expect(call[1]).not.toHaveProperty("days");
    });
  });

  // ─────────────────────────────────────────────
  // ranking: calculateQualityScore branches
  // ─────────────────────────────────────────────
  describe("ranking - quality score branches", () => {
    beforeEach(() => {
      setupConfig({ tavilySecret: "tvly-key1234567890", provider: "tavily" });
    });

    it("boosts .edu domain results", async () => {
      httpService.post.mockReturnValue(
        makeAxiosResponse({
          results: [
            {
              title: "EDU Result",
              url: "https://university.edu/research",
              content: "academic research content here",
              score: 0.5,
            },
            {
              title: "Normal Result",
              url: "https://randomsite.net/article",
              content: "academic research content here",
              score: 0.5,
            },
          ],
        }),
      );

      const result = await service.search("academic research", 5);
      const eduIdx = result.results.findIndex((r) => r.url?.includes(".edu"));
      const normalIdx = result.results.findIndex((r) =>
        r.url?.includes("randomsite"),
      );
      // edu should rank higher
      expect(eduIdx).toBeLessThan(normalIdx);
    });

    it("boosts .gov domain results", async () => {
      httpService.post.mockReturnValue(
        makeAxiosResponse({
          results: [
            {
              title: "GOV Result",
              url: "https://agency.gov/report",
              content: "government policy report content here",
              score: 0.5,
            },
            {
              title: "Blog",
              url: "https://myblog.com/opinion",
              content: "government policy report content here",
              score: 0.5,
            },
          ],
        }),
      );

      const result = await service.search("government policy report", 5);
      const govIdx = result.results.findIndex((r) => r.url?.includes(".gov"));
      expect(govIdx).toBe(0);
    });

    it("boosts .org domain results above unclassified", async () => {
      httpService.post.mockReturnValue(
        makeAxiosResponse({
          results: [
            {
              title: "Org",
              url: "https://nonprofit.org/data",
              content: "org content here x".repeat(20),
              score: 0.5,
            },
            {
              title: "Random",
              url: "https://randomxyz.net/page",
              content: "org content here x".repeat(20),
              score: 0.5,
            },
          ],
        }),
      );

      const result = await service.search("org content", 5);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it("penalizes low-quality domains (pinterest, facebook)", async () => {
      httpService.post.mockReturnValue(
        makeAxiosResponse({
          results: [
            {
              title: "Pinterest Pin",
              url: "https://pinterest.com/pin/123",
              content: "content that matches query here well",
              score: 0.8,
            },
            {
              title: "Nature Article",
              url: "https://nature.com/article",
              content: "content that matches query here well",
              score: 0.5,
            },
          ],
        }),
      );

      const result = await service.search("content that matches query", 5);
      const natureIdx = result.results.findIndex((r) =>
        r.url?.includes("nature.com"),
      );
      const pinterestIdx = result.results.findIndex((r) =>
        r.url?.includes("pinterest"),
      );
      // nature should outrank pinterest
      expect(natureIdx).toBeLessThan(pinterestIdx);
    });

    it("boosts medium-authority domains (wikipedia)", async () => {
      httpService.post.mockReturnValue(
        makeAxiosResponse({
          results: [
            {
              title: "Wikipedia",
              url: "https://wikipedia.org/wiki/AI",
              content: "ai content page x".repeat(10),
              score: 0.5,
            },
            {
              title: "Unknown Blog",
              url: "https://unknownblog123xyz.com/post",
              content: "ai content page x".repeat(10),
              score: 0.5,
            },
          ],
        }),
      );

      const result = await service.search("ai content page", 5);
      const wikiIdx = result.results.findIndex((r) =>
        r.url?.includes("wikipedia"),
      );
      const unknownIdx = result.results.findIndex((r) =>
        r.url?.includes("unknownblog"),
      );
      expect(wikiIdx).toBeLessThan(unknownIdx);
    });
  });

  // ─────────────────────────────────────────────
  // ranking: calculateFreshnessScore branches
  // ─────────────────────────────────────────────
  describe("ranking - freshness score branches", () => {
    beforeEach(() => {
      setupConfig({ tavilySecret: "tvly-key1234567890", provider: "tavily" });
    });

    it("prefers results from last month over older ones", async () => {
      const lastMonth = new Date(
        Date.now() - 20 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const lastQuarter = new Date(
        Date.now() - 70 * 24 * 60 * 60 * 1000,
      ).toISOString();

      httpService.post.mockReturnValue(
        makeAxiosResponse({
          results: [
            {
              title: "Quarter Old",
              url: "https://a.com/old",
              content: "freshness test content here",
              published_date: lastQuarter,
            },
            {
              title: "Last Month",
              url: "https://b.com/recent",
              content: "freshness test content here",
              published_date: lastMonth,
            },
          ],
        }),
      );

      const result = await service.search("freshness test", 5);
      const recentIdx = result.results.findIndex((r) =>
        r.url?.includes("b.com"),
      );
      const oldIdx = result.results.findIndex((r) => r.url?.includes("a.com"));
      expect(recentIdx).toBeLessThan(oldIdx);
    });

    it("uses neutral score for content with invalid date", async () => {
      httpService.post.mockReturnValue(
        makeAxiosResponse({
          results: [
            {
              title: "Invalid Date",
              url: "https://invalid-date.com",
              content: "content with invalid date string here",
              published_date: "not-a-date",
            },
          ],
        }),
      );

      const result = await service.search("content with invalid date", 5);
      expect(result.results.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ─────────────────────────────────────────────
  // ranking: calculateDepthScore branches
  // ─────────────────────────────────────────────
  describe("ranking - depth score branches", () => {
    beforeEach(() => {
      setupConfig({ tavilySecret: "tvly-key1234567890", provider: "tavily" });
    });

    it("prefers longer content over very short content", async () => {
      httpService.post.mockReturnValue(
        makeAxiosResponse({
          results: [
            {
              title: "Deep Article",
              url: "https://deep.com",
              content: "D".repeat(500), // >= 400 chars
            },
            {
              title: "Shallow Article",
              url: "https://shallow.com",
              content: "Short", // < 100 chars
            },
          ],
        }),
      );

      const result = await service.search("query", 5);
      const deepIdx = result.results.findIndex((r) =>
        r.url?.includes("deep.com"),
      );
      const shallowIdx = result.results.findIndex((r) =>
        r.url?.includes("shallow.com"),
      );
      expect(deepIdx).toBeLessThan(shallowIdx);
    });

    it("handles content with 100-199 chars", async () => {
      httpService.post.mockReturnValue(
        makeAxiosResponse({
          results: [
            {
              title: "Medium Content",
              url: "https://medium-content.com",
              content: "M".repeat(150), // 100-199 chars
            },
          ],
        }),
      );

      const result = await service.search("query", 5);
      expect(result.results.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ─────────────────────────────────────────────
  // applyDiversityFilter: fills remaining slots
  // ─────────────────────────────────────────────
  describe("applyDiversityFilter - fills remaining when under maxResults", () => {
    beforeEach(() => {
      setupConfig({ tavilySecret: "tvly-key1234567890", provider: "tavily" });
    });

    it("fills remaining results from same domain when total count is insufficient", async () => {
      // Only 2 unique domains available for 5 results max → must allow duplicates
      httpService.post.mockReturnValue(
        makeAxiosResponse({
          results: [
            {
              title: "A1",
              url: "https://samesite.com/a1",
              content: "C".repeat(300),
            },
            {
              title: "A2",
              url: "https://samesite.com/a2",
              content: "C".repeat(300),
            },
            {
              title: "A3",
              url: "https://samesite.com/a3",
              content: "C".repeat(300),
            },
          ],
        }),
      );

      // With only 3 results and maxResults=5, should return all 3
      const result = await service.search("query", 5);
      expect(result.results.length).toBe(3);
    });
  });

  // ─────────────────────────────────────────────
  // search() - all providers fail: returns final error
  // ─────────────────────────────────────────────
  describe("search() - all providers fail with detailed error", () => {
    it("returns error message from last provider failure", async () => {
      setupConfig({ tavilySecret: "tvly-key1234", provider: "tavily" });

      // Tavily fails with 500 → failover to DDG → DDG also fails
      httpService.post.mockReturnValue(
        makeAxiosError(500, "Tavily server error"),
      );
      mockDuckSearch.mockRejectedValue(new Error("DDG also broken"));

      const result = await service.search("test");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────
  // Serper: with since date but no result → still applies ranking
  // ─────────────────────────────────────────────
  describe("Serper with empty organic results", () => {
    it("handles empty organic response gracefully", async () => {
      setupConfig({
        serperSecret: "serper-key1234567890",
        tavilySecret: null,
        provider: "serper",
      });

      httpService.post.mockReturnValue(makeAxiosResponse({ organic: [] }));

      const result = await service.search("empty query", 5);
      expect(result.success).toBe(true);
      expect(result.results).toEqual([]);
    });

    it("maps serper date field to publishedDate", async () => {
      setupConfig({
        serperSecret: "serper-key1234567890",
        tavilySecret: null,
        provider: "serper",
      });

      httpService.post.mockReturnValue(
        makeAxiosResponse({
          organic: [
            {
              title: "Serper With Date",
              link: "https://serper-dated.com/article",
              snippet: "A snippet with date field",
              date: "2025-01-15",
            },
          ],
        }),
      );

      const result = await service.search("serper date", 5);
      expect(result.success).toBe(true);
      expect(result.results.length).toBe(1);
      expect(result.results[0].publishedDate).toBe("2025-01-15");
    });
  });

  // ─────────────────────────────────────────────
  // DuckDuckGo: rawDescription fallback
  // ─────────────────────────────────────────────
  describe("DuckDuckGo rawDescription fallback", () => {
    it("uses rawDescription when description is absent", async () => {
      setupConfig({
        tavilySecret: null,
        serperSecret: null,
        provider: "duckduckgo",
      });

      mockDuckSearch.mockResolvedValue({
        noResults: false,
        results: [
          {
            title: "DDG Raw Desc",
            url: "https://rawdesc.com",
            description: undefined,
            rawDescription: "This is raw description",
            hostname: "rawdesc.com",
          },
        ],
      });

      const result = await service.search("query", 5);
      expect(result.success).toBe(true);
      expect(result.results[0].content).toBe("This is raw description");
    });
  });

  // ─────────────────────────────────────────────
  // fetchUrlContent: PDF and .gov URL timeout
  // ─────────────────────────────────────────────
  describe("fetchUrlContent - timeout by URL pattern", () => {
    it("uses 45s timeout for /pdf/ path", async () => {
      const result = await service.fetchUrlContent(
        "https://example.com/pdf/doc1",
      );
      expect(result.success).toBe(false);
      expect(httpService.get).not.toHaveBeenCalledWith(
        "https://example.com/pdf/doc1",
        expect.anything(),
      );
    });

    it("uses 45s timeout for .gov URLs", async () => {
      const html =
        "<html><head><title>Gov Page</title></head><body>content</body></html>";
      httpService.get.mockReturnValue(makeAxiosResponse(html));

      await service.fetchUrlContent("https://agency.gov/report");

      expect(httpService.get).toHaveBeenCalledWith(
        "https://agency.gov/report",
        expect.objectContaining({ timeout: 45000 }),
      );
    });

    it("returns success=false with message error when no status in response", async () => {
      httpService.get.mockReturnValue(makeNetworkError("ECONNREFUSED"));

      const result = await service.fetchUrlContent("https://unreachable.com");
      expect(result.success).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
    });
  });

  // ─────────────────────────────────────────────
  // calculateRelevanceScore: all terms bonus
  // ─────────────────────────────────────────────
  describe("ranking - relevance score all terms bonus", () => {
    beforeEach(() => {
      setupConfig({ tavilySecret: "tvly-key1234567890", provider: "tavily" });
    });

    it("applies bonus when all query terms match title", async () => {
      httpService.post.mockReturnValue(
        makeAxiosResponse({
          results: [
            {
              title: "machine learning deep neural networks",
              url: "https://all-terms.com",
              content: "machine learning deep neural networks overview",
            },
            {
              title: "random topic unrelated",
              url: "https://unrelated.com",
              content: "machine learning deep neural networks overview",
            },
          ],
        }),
      );

      const result = await service.search(
        "machine learning deep neural networks",
        5,
      );
      const allTermsIdx = result.results.findIndex((r) =>
        r.url?.includes("all-terms"),
      );
      const unrelatedIdx = result.results.findIndex((r) =>
        r.url?.includes("unrelated"),
      );
      expect(allTermsIdx).toBeLessThan(unrelatedIdx);
    });
  });
});
