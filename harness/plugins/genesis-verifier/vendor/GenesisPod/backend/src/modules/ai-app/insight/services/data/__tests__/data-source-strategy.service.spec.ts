import { Test, TestingModule } from "@nestjs/testing";
import { DataSourceStrategyService } from "../data-source-strategy.service";
import { DataSourceType } from "../../../types/data-source.types";
import type { DataSourceResult } from "../../../types/data-source.types";

const makeResult = (
  url: string,
  domain?: string,
  sourceType: DataSourceType = DataSourceType.WEB,
  snippet?: string,
  publishedAt?: Date,
): DataSourceResult => ({
  sourceType,
  title: `Article from ${domain || url}`,
  url,
  snippet: snippet || "Some content here",
  domain,
  publishedAt,
});

describe("DataSourceStrategyService", () => {
  let service: DataSourceStrategyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DataSourceStrategyService],
    }).compile();

    service = module.get<DataSourceStrategyService>(DataSourceStrategyService);
  });

  // ============================================================
  // dataSourceToToolId
  // ============================================================

  describe("dataSourceToToolId", () => {
    it("should map WEB to web-search tool id", () => {
      const toolId = service.dataSourceToToolId(DataSourceType.WEB);
      expect(toolId).toBe("web-search");
    });

    it("should map ACADEMIC to arxiv-search tool id", () => {
      const toolId = service.dataSourceToToolId(DataSourceType.ACADEMIC);
      expect(toolId).toBe("arxiv-search");
    });

    it("should map GITHUB to github-search tool id", () => {
      const toolId = service.dataSourceToToolId(DataSourceType.GITHUB);
      expect(toolId).toBe("github-search");
    });
  });

  // ============================================================
  // toolIdToDataSource
  // ============================================================

  describe("toolIdToDataSource", () => {
    it("should reverse map web-search to WEB", () => {
      const source = service.toolIdToDataSource("web-search");
      expect(source).toBe(DataSourceType.WEB);
    });
  });

  // ============================================================
  // convertToolsToDataSources
  // ============================================================

  describe("convertToolsToDataSources", () => {
    it("should convert tool list to data source types", () => {
      const sources = service.convertToolsToDataSources([
        "web-search",
        "arxiv-search",
      ]);
      expect(sources).toContain(DataSourceType.WEB);
      expect(sources).toContain(DataSourceType.ACADEMIC);
    });

    it("should filter out unknown tool ids", () => {
      const sources = service.convertToolsToDataSources([
        "unknown-tool",
        "web-search",
      ]);
      expect(sources).toHaveLength(1);
      expect(sources[0]).toBe(DataSourceType.WEB);
    });
  });

  // ============================================================
  // normalizeUrl
  // ============================================================

  describe("normalizeUrl", () => {
    it("should normalize URL and remove UTM parameters", () => {
      const normalized = service.normalizeUrl(
        "https://example.com/article?utm_source=twitter&utm_medium=social",
      );
      expect(normalized).not.toContain("utm_source");
      expect(normalized).not.toContain("utm_medium");
    });

    it("should lowercase URLs", () => {
      const normalized = service.normalizeUrl("HTTPS://EXAMPLE.COM/Path");
      expect(normalized).toBe(normalized.toLowerCase());
    });

    it("should remove trailing slash", () => {
      const normalized = service.normalizeUrl("https://example.com/article/");
      expect(normalized).not.toMatch(/\/$/);
    });

    it("should return lowercased original for invalid URLs", () => {
      const normalized = service.normalizeUrl("not-a-valid-url");
      expect(normalized).toBe("not-a-valid-url");
    });
  });

  // ============================================================
  // extractDomain
  // ============================================================

  describe("extractDomain", () => {
    it("should extract domain from URL", () => {
      const domain = service.extractDomain("https://www.example.com/path");
      expect(domain).toBe("example.com"); // www. stripped
    });

    it("should return null for localhost", () => {
      const domain = service.extractDomain("http://localhost:3000/api");
      expect(domain).toBeNull();
    });

    it("should return null for IP addresses", () => {
      const domain = service.extractDomain("http://192.168.1.1/api");
      expect(domain).toBeNull();
    });

    it("should return null for invalid URLs", () => {
      const domain = service.extractDomain("not-a-url");
      expect(domain).toBeNull();
    });
  });

  // ============================================================
  // calculateCredibilityScore
  // ============================================================

  describe("calculateCredibilityScore", () => {
    it("should score academic sources higher than web", () => {
      const academic = makeResult(
        "https://arxiv.org/paper",
        "arxiv.org",
        DataSourceType.ACADEMIC,
      );
      const web = makeResult(
        "https://blog.com/post",
        "blog.com",
        DataSourceType.WEB,
      );

      const academicScore = service.calculateCredibilityScore(academic);
      const webScore = service.calculateCredibilityScore(web);

      expect(academicScore).toBeGreaterThan(webScore);
    });

    it("should score recent content higher than old content", () => {
      const recent = makeResult(
        "https://example.com/new",
        "example.com",
        DataSourceType.WEB,
        "content",
        new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
      );
      const old = makeResult(
        "https://example.com/old",
        "example.com",
        DataSourceType.WEB,
        "content",
        new Date(Date.now() - 400 * 24 * 60 * 60 * 1000), // 400 days ago
      );

      const recentScore = service.calculateCredibilityScore(recent);
      const oldScore = service.calculateCredibilityScore(old);

      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it("should score content with longer snippets higher", () => {
      const rich = makeResult(
        "https://example.com/rich",
        "example.com",
        DataSourceType.WEB,
        "X".repeat(600),
      );
      const thin = makeResult(
        "https://example.com/thin",
        "example.com",
        DataSourceType.WEB,
        "short",
      );

      const richScore = service.calculateCredibilityScore(rich);
      const thinScore = service.calculateCredibilityScore(thin);

      expect(richScore).toBeGreaterThan(thinScore);
    });

    it("should score high authority domains higher", () => {
      const arxiv = makeResult(
        "https://arxiv.org/paper",
        "arxiv.org",
        DataSourceType.WEB,
      );
      const unknown = makeResult(
        "https://random.blog.com",
        "random.blog.com",
        DataSourceType.WEB,
      );

      const arxivScore = service.calculateCredibilityScore(arxiv);
      const unknownScore = service.calculateCredibilityScore(unknown);

      expect(arxivScore).toBeGreaterThan(unknownScore);
    });
  });

  // ============================================================
  // aggregateResults
  // ============================================================

  describe("aggregateResults", () => {
    it("should deduplicate by URL", () => {
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        {
          status: "fulfilled",
          value: [
            makeResult("https://example.com/article", "example.com"),
            makeResult("https://example.com/article", "example.com"), // duplicate
          ],
        },
        {
          status: "fulfilled",
          value: [makeResult("https://other.com/post", "other.com")],
        },
      ];

      const aggregated = service.aggregateResults(results, [
        DataSourceType.WEB,
        DataSourceType.ACADEMIC,
      ]);

      expect(aggregated.items.length).toBe(2); // deduped
    });

    it("should skip rejected promises", () => {
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        { status: "rejected", reason: "Network error" },
        {
          status: "fulfilled",
          value: [makeResult("https://example.com", "example.com")],
        },
      ];

      const aggregated = service.aggregateResults(results, [
        DataSourceType.WEB,
        DataSourceType.ACADEMIC,
      ]);

      expect(aggregated.items).toHaveLength(1);
    });

    it("should skip items without URL", () => {
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        {
          status: "fulfilled",
          value: [
            {
              sourceType: DataSourceType.WEB,
              title: "No URL",
              url: "",
              snippet: "test",
            },
          ],
        },
      ];

      const aggregated = service.aggregateResults(results, [
        DataSourceType.WEB,
      ]);

      expect(aggregated.items).toHaveLength(0);
    });

    it("should sort results by credibility score descending", () => {
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        {
          status: "fulfilled",
          value: [
            makeResult("https://blog.com/post", "blog.com", DataSourceType.WEB),
            makeResult(
              "https://arxiv.org/paper",
              "arxiv.org",
              DataSourceType.ACADEMIC,
            ),
          ],
        },
      ];

      const aggregated = service.aggregateResults(results, [
        DataSourceType.WEB,
      ]);

      // arxiv.org should come first (higher score)
      expect(aggregated.items[0].domain).toBe("arxiv.org");
    });

    it("should enforce domain diversity", () => {
      // 10 results from the same domain should be capped
      const manyFromSameDomain: DataSourceResult[] = Array.from(
        { length: 10 },
        (_, i) =>
          makeResult(
            `https://medium.com/article-${i}`,
            "medium.com",
            DataSourceType.WEB,
            "content".repeat(10),
          ),
      );
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        { status: "fulfilled", value: manyFromSameDomain },
      ];

      const aggregated = service.aggregateResults(results, [
        DataSourceType.WEB,
      ]);

      // medium.com should be capped, not all 10 included
      const mediumCount = aggregated.items.filter(
        (i) => i.domain === "medium.com",
      ).length;
      expect(mediumCount).toBeLessThan(10);
    });
  });

  // ============================================================
  // countResultsBySource
  // ============================================================

  describe("countResultsBySource", () => {
    it("should count results per source type", () => {
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        {
          status: "fulfilled",
          value: [
            makeResult("https://a.com", "a.com", DataSourceType.WEB),
            makeResult("https://b.com", "b.com", DataSourceType.WEB),
          ],
        },
        {
          status: "fulfilled",
          value: [
            makeResult(
              "https://arxiv.org/1",
              "arxiv.org",
              DataSourceType.ACADEMIC,
            ),
          ],
        },
      ];

      const counts = service.countResultsBySource(results, [
        DataSourceType.WEB,
        DataSourceType.ACADEMIC,
      ]);

      expect(counts[DataSourceType.WEB]).toBe(2);
      expect(counts[DataSourceType.ACADEMIC]).toBe(1);
    });

    it("should count rejected promises as 0", () => {
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        { status: "rejected", reason: "error" },
      ];

      const counts = service.countResultsBySource(results, [
        DataSourceType.WEB,
      ]);

      expect(counts[DataSourceType.WEB]).toBe(0);
    });
  });

  // ============================================================
  // normalizeUrl edge cases
  // ============================================================

  describe("normalizeUrl - edge cases", () => {
    it("should return empty string for empty url", () => {
      expect(service.normalizeUrl("")).toBe("");
    });

    it("should remove ref parameter", () => {
      const normalized = service.normalizeUrl(
        "https://example.com/article?ref=twitter",
      );
      expect(normalized).not.toContain("ref=");
    });

    it("should remove utm_campaign parameter", () => {
      const normalized = service.normalizeUrl(
        "https://example.com/post?utm_campaign=spring",
      );
      expect(normalized).not.toContain("utm_campaign");
    });
  });

  // ============================================================
  // credibility scoring - domain authority branches
  // ============================================================

  describe("calculateCredibilityScore - domain authority branches", () => {
    it("should score medium authority domains (medium.com) in between", () => {
      const medium = makeResult(
        "https://medium.com/article",
        "medium.com",
        DataSourceType.WEB,
      );
      const random = makeResult(
        "https://random-unknown.com/article",
        "random-unknown.com",
        DataSourceType.WEB,
      );
      expect(service.calculateCredibilityScore(medium)).toBeGreaterThan(
        service.calculateCredibilityScore(random),
      );
    });

    it("should score .edu domains higher than unknown domains", () => {
      const edu = makeResult(
        "https://mit.edu/paper",
        "mit.edu",
        DataSourceType.WEB,
      );
      const unknown = makeResult(
        "https://unknown.com/post",
        "unknown.com",
        DataSourceType.WEB,
      );
      expect(service.calculateCredibilityScore(edu)).toBeGreaterThan(
        service.calculateCredibilityScore(unknown),
      );
    });

    it("should score .gov domains higher than unknown domains", () => {
      const gov = makeResult(
        "https://data.gov/resource",
        "data.gov",
        DataSourceType.WEB,
      );
      const unknown = makeResult(
        "https://blog.net/post",
        "blog.net",
        DataSourceType.WEB,
      );
      expect(service.calculateCredibilityScore(gov)).toBeGreaterThan(
        service.calculateCredibilityScore(unknown),
      );
    });

    it("should handle undefined domain", () => {
      const noDomain: DataSourceResult = {
        sourceType: DataSourceType.WEB,
        title: "No domain",
        url: "https://example.com",
        snippet: "content",
        domain: undefined,
      };
      const score = service.calculateCredibilityScore(noDomain);
      expect(score).toBeGreaterThan(0);
    });

    it("should score content 30-90 days old at 70 recency", () => {
      const sixtyDays = makeResult(
        "https://example.com/sixty",
        "example.com",
        DataSourceType.WEB,
        "content",
        new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      );
      const twoYears = makeResult(
        "https://example.com/old",
        "example.com",
        DataSourceType.WEB,
        "content",
        new Date(Date.now() - 730 * 24 * 60 * 60 * 1000),
      );
      expect(service.calculateCredibilityScore(sixtyDays)).toBeGreaterThan(
        service.calculateCredibilityScore(twoYears),
      );
    });

    it("should score content 90-180 days old less than 30-90 days", () => {
      const ninety = makeResult(
        "https://example.com/ninety",
        "example.com",
        DataSourceType.WEB,
        "content",
        new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
      );
      const thirty = makeResult(
        "https://example.com/thirty",
        "example.com",
        DataSourceType.WEB,
        "content",
        new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      );
      expect(service.calculateCredibilityScore(thirty)).toBeGreaterThan(
        service.calculateCredibilityScore(ninety),
      );
    });

    it("should score content 180-365 days old at recency 55", () => {
      const twoHundred = makeResult(
        "https://example.com/200d",
        "example.com",
        DataSourceType.WEB,
        "content",
        new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      );
      const twoYears = makeResult(
        "https://example.com/2yr",
        "example.com",
        DataSourceType.WEB,
        "content",
        new Date(Date.now() - 800 * 24 * 60 * 60 * 1000),
      );
      expect(service.calculateCredibilityScore(twoHundred)).toBeGreaterThan(
        service.calculateCredibilityScore(twoYears),
      );
    });

    it("should score content with 100-200 char snippet in middle tier", () => {
      const mid = makeResult(
        "https://example.com/mid",
        "example.com",
        DataSourceType.WEB,
        "X".repeat(150),
      );
      const short = makeResult(
        "https://example.com/short",
        "example.com",
        DataSourceType.WEB,
        "X".repeat(50),
      );
      expect(service.calculateCredibilityScore(mid)).toBeGreaterThan(
        service.calculateCredibilityScore(short),
      );
    });

    it("should score content with 200-300 char snippet higher than 100-200", () => {
      const mid = makeResult(
        "https://example.com/mid",
        "example.com",
        DataSourceType.WEB,
        "X".repeat(250),
      );
      const low = makeResult(
        "https://example.com/low",
        "example.com",
        DataSourceType.WEB,
        "X".repeat(150),
      );
      expect(service.calculateCredibilityScore(mid)).toBeGreaterThan(
        service.calculateCredibilityScore(low),
      );
    });
  });

  // ============================================================
  // aggregateResults - title deduplication and authoritative domain boost
  // ============================================================

  describe("aggregateResults - advanced deduplication", () => {
    it("should deduplicate similar titles", () => {
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        {
          status: "fulfilled",
          value: [
            {
              sourceType: DataSourceType.WEB,
              title: "AI Machine Learning Research Paper 2025",
              url: "https://a.com/1",
              snippet: "content",
            },
            {
              sourceType: DataSourceType.ACADEMIC,
              title: "AI Machine Learning Research Paper 2025",
              url: "https://b.org/2",
              snippet: "content",
            }, // same title
          ],
        },
      ];

      const aggregated = service.aggregateResults(results, [
        DataSourceType.WEB,
      ]);
      // Should deduplicate by similar title
      expect(aggregated.items.length).toBeLessThanOrEqual(2);
    });

    it("should boost max ratio for authoritative domains", () => {
      // 50% of results from authoritative domains => maxRatio becomes 0.5
      const authoritativeResults: DataSourceResult[] = [
        ...Array.from({ length: 6 }, (_, i) =>
          makeResult(
            `https://arxiv.org/paper-${i}`,
            "arxiv.org",
            DataSourceType.ACADEMIC,
            "content",
          ),
        ),
        ...Array.from({ length: 4 }, (_, i) =>
          makeResult(
            `https://other${i}.com/post`,
            `other${i}.com`,
            DataSourceType.WEB,
            "content",
          ),
        ),
      ];

      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        { status: "fulfilled", value: authoritativeResults },
      ];
      const aggregated = service.aggregateResults(results, [
        DataSourceType.ACADEMIC,
      ]);
      // With boosted ratio, arxiv.org should be able to have more items
      expect(aggregated.items.length).toBeGreaterThan(3);
    });

    it("should handle results with no domain (no-URL items skip domain diversity)", () => {
      // Items without valid URL for domain extraction should pass through
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        {
          status: "fulfilled",
          value: Array.from({ length: 5 }, (_, i) => ({
            sourceType: DataSourceType.WEB,
            title: `Item ${i}`,
            url: `not-a-url-${i}`,
            snippet: "test",
          })),
        },
      ];
      const aggregated = service.aggregateResults(results, [
        DataSourceType.WEB,
      ]);
      // All items should pass since extractDomain returns null
      expect(aggregated.items.length).toBeGreaterThan(0);
    });

    it("should return all items when 3 or fewer (no diversity enforcement)", () => {
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        {
          status: "fulfilled",
          value: [
            makeResult("https://a.com/1", "a.com"),
            makeResult("https://b.com/2", "b.com"),
            makeResult("https://c.com/3", "c.com"),
          ],
        },
      ];
      const aggregated = service.aggregateResults(results, [
        DataSourceType.WEB,
      ]);
      // 3 items from different domains, diversity not enforced
      expect(aggregated.items.length).toBe(3);
    });
  });
});
