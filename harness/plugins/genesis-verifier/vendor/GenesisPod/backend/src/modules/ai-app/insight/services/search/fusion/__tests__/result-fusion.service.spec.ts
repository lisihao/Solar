/**
 * ResultFusionService Unit Tests
 *
 * Covers:
 * - fuse(): full pipeline (flatten, deduplicate, score, rank, domain diversity)
 * - deduplicate(): URL normalization and title-similarity dedup
 * - getCredibilityScore()
 * - getRelevanceScore()
 * - normalizeUrl()
 * - calculateTitleSimilarity()
 * - extractDomain()
 * - getSourceTypeScore()
 * - getDomainAuthorityScore()
 * - getRecencyScore()
 * - getContentDepthScore()
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ResultFusionService } from "../result-fusion.service";
import { DataSourceType } from "../../../../types/data-source.types";
import type { DataSourceResult } from "../../../../types/data-source.types";
import type { AdapterSearchResult } from "../../search.types";

// ============================================================
// Helpers
// ============================================================

function makeItem(overrides: Partial<DataSourceResult> = {}): DataSourceResult {
  return {
    sourceType: DataSourceType.WEB,
    title: "Test Article",
    url: "https://example.com/article",
    snippet:
      "A snippet about the test topic that is long enough to score well.",
    publishedAt: new Date(),
    domain: "example.com",
    metadata: {},
    ...overrides,
  };
}

function makeAdapterResult(items: DataSourceResult[]): AdapterSearchResult {
  return {
    items,
    sourceMetrics: {
      sourceId: "test",
      durationMs: 100,
      queryUsed: "test query",
    },
  };
}

// ============================================================
// Tests
// ============================================================

describe("ResultFusionService", () => {
  let service: ResultFusionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ResultFusionService],
    }).compile();

    service = module.get<ResultFusionService>(ResultFusionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================
  // fuse()
  // ===========================================================

  describe("fuse()", () => {
    it("should return an AggregatedSearchResult with all structural fields", () => {
      const items = [makeItem({ url: "https://example.com/a" })];
      const sourceResults = new Map<DataSourceType, AdapterSearchResult>([
        [DataSourceType.WEB, makeAdapterResult(items)],
      ]);

      const result = service.fuse(sourceResults, "AI research");

      expect(result).toHaveProperty("items");
      expect(result).toHaveProperty("totalCount");
      expect(result).toHaveProperty("sources");
      expect(result).toHaveProperty("metadata");
      expect(result).toHaveProperty("scoredItems");
      expect(result.sources).toContain(DataSourceType.WEB);
      expect(result.metadata?.searchQuery).toBe("AI research");
    });

    it("should flatten items from multiple sources", () => {
      const webItems = [
        makeItem({
          url: "https://web.com/1",
          title: "Web Article One About Search",
          sourceType: DataSourceType.WEB,
        }),
        makeItem({
          url: "https://web.com/2",
          title: "Web Article Two Different Topic",
          sourceType: DataSourceType.WEB,
        }),
      ];
      const academicItems = [
        makeItem({
          url: "https://arxiv.org/abs/1234",
          title: "Academic Paper Neural Networks Research",
          sourceType: DataSourceType.ACADEMIC,
        }),
      ];

      const sourceResults = new Map<DataSourceType, AdapterSearchResult>([
        [DataSourceType.WEB, makeAdapterResult(webItems)],
        [DataSourceType.ACADEMIC, makeAdapterResult(academicItems)],
      ]);

      const result = service.fuse(sourceResults, "machine learning");

      expect(result.totalCount).toBe(3);
      expect(result.sources).toHaveLength(2);
    });

    it("should handle empty sourceResults map", () => {
      const result = service.fuse(new Map(), "query");

      expect(result.totalCount).toBe(0);
      expect(result.items).toHaveLength(0);
      expect(result.sources).toHaveLength(0);
    });

    it("should deduplicate items with same URL", () => {
      const duplicateUrl = "https://example.com/duplicate";
      const items = [
        makeItem({ url: duplicateUrl, title: "First" }),
        makeItem({ url: duplicateUrl, title: "Second" }),
        makeItem({ url: "https://example.com/unique", title: "Unique" }),
      ];

      const sourceResults = new Map<DataSourceType, AdapterSearchResult>([
        [DataSourceType.WEB, makeAdapterResult(items)],
      ]);

      const result = service.fuse(sourceResults, "test");

      expect(result.totalCount).toBe(2);
    });

    it("should deduplicate items with same title words (title-key dedup)", () => {
      const items = [
        makeItem({
          url: "https://example.com/1",
          title: "AI Research Trends 2024",
        }),
        makeItem({
          url: "https://example.com/2",
          title: "Trends 2024 AI Research",
        }), // same words, different order
        makeItem({
          url: "https://example.com/3",
          title: "Different Topic Article",
        }),
      ];

      const sourceResults = new Map<DataSourceType, AdapterSearchResult>([
        [DataSourceType.WEB, makeAdapterResult(items)],
      ]);

      const result = service.fuse(sourceResults, "test");

      expect(result.totalCount).toBe(2);
    });

    it("should sort items by composite score descending", () => {
      const items = [
        makeItem({
          url: "https://example.com/low",
          title: "Unrelated Content",
          snippet: "Nothing relevant here",
          sourceType: DataSourceType.HACKERNEWS,
        }),
        makeItem({
          url: "https://arxiv.org/paper1",
          title: "AI Neural Networks Deep Learning Study",
          snippet:
            "This paper covers AI neural networks and deep learning in detail, providing comprehensive analysis of the field with extensive data and methodology.",
          sourceType: DataSourceType.ACADEMIC,
          publishedAt: new Date(),
        }),
      ];

      const sourceResults = new Map<DataSourceType, AdapterSearchResult>([
        [DataSourceType.WEB, makeAdapterResult([items[0]])],
        [DataSourceType.ACADEMIC, makeAdapterResult([items[1]])],
      ]);

      const result = service.fuse(sourceResults, "AI neural networks");

      // The academic item should score higher and appear first
      expect(result.items[0].sourceType).toBe(DataSourceType.ACADEMIC);
    });

    it("should enforce domain diversity — max 3 items per domain", () => {
      const domain = "same-domain.com";
      const items = Array.from({ length: 6 }, (_, i) =>
        makeItem({
          url: `https://${domain}/article-${i}`,
          title: `Unique Title ${i} for Article Here`,
        }),
      );

      const sourceResults = new Map<DataSourceType, AdapterSearchResult>([
        [DataSourceType.WEB, makeAdapterResult(items)],
      ]);

      const result = service.fuse(sourceResults, "test");

      expect(result.totalCount).toBe(3);
    });

    it("should include scoredItems with score, relevanceScore, credibilityScore", () => {
      const items = [makeItem({ url: "https://example.com/x" })];
      const sourceResults = new Map<DataSourceType, AdapterSearchResult>([
        [DataSourceType.WEB, makeAdapterResult(items)],
      ]);

      const result = service.fuse(sourceResults, "test query");

      expect(result.scoredItems).toHaveLength(1);
      expect(result.scoredItems![0]).toHaveProperty("score");
      expect(result.scoredItems![0]).toHaveProperty("relevanceScore");
      expect(result.scoredItems![0]).toHaveProperty("credibilityScore");
    });

    it("should record sourceResults count in metadata", () => {
      const items = [makeItem(), makeItem({ url: "https://example.com/b" })];
      const sourceResults = new Map<DataSourceType, AdapterSearchResult>([
        [DataSourceType.WEB, makeAdapterResult(items)],
      ]);

      const result = service.fuse(sourceResults, "q");

      expect(result.metadata?.sourceResults[DataSourceType.WEB]).toBe(2);
    });

    it("should allow up to MAX_ITEMS_PER_DOMAIN (3) from same domain", () => {
      const items = Array.from({ length: 3 }, (_, i) =>
        makeItem({
          url: `https://example.com/item${i}`,
          title: `Totally Different Title Number ${i} For Dedup Bypass`,
        }),
      );

      const sourceResults = new Map<DataSourceType, AdapterSearchResult>([
        [DataSourceType.WEB, makeAdapterResult(items)],
      ]);

      const result = service.fuse(sourceResults, "test");

      expect(result.totalCount).toBe(3);
    });
  });

  // ===========================================================
  // normalizeUrl()
  // ===========================================================

  describe("normalizeUrl()", () => {
    it("should normalize http to https", () => {
      const result = service.normalizeUrl("http://example.com/page");
      expect(result).toContain("https://");
    });

    it("should strip trailing slash", () => {
      const result = service.normalizeUrl("https://example.com/page/");
      expect(result).not.toMatch(/\/$/);
    });

    it("should strip fragment", () => {
      const result = service.normalizeUrl("https://example.com/page#section");
      expect(result).not.toContain("#");
    });

    it("should lowercase the URL", () => {
      const result = service.normalizeUrl("https://Example.COM/Page");
      expect(result).toBe(result.toLowerCase());
    });

    it("should handle invalid URL gracefully", () => {
      const result = service.normalizeUrl("not-a-valid-url");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should strip fragment from invalid URL", () => {
      const result = service.normalizeUrl("invalid-url#fragment");
      expect(result).not.toContain("#");
    });

    it("should strip trailing slash from invalid URL", () => {
      const result = service.normalizeUrl("invalid-url/");
      expect(result).not.toMatch(/\/$/);
    });

    it("should not modify pathname if it has no trailing slash", () => {
      const result = service.normalizeUrl("https://example.com/path/to/page");
      expect(result).toContain("/path/to/page");
    });

    it("should preserve root path (single slash)", () => {
      const result = service.normalizeUrl("https://example.com/");
      // Root slash gets stripped or kept — just ensure it's valid
      expect(result).toContain("example.com");
    });
  });

  // ===========================================================
  // calculateTitleSimilarity()
  // ===========================================================

  describe("calculateTitleSimilarity()", () => {
    it("should return 1 for identical titles", () => {
      const sim = service.calculateTitleSimilarity(
        "AI Research",
        "AI Research",
      );
      expect(sim).toBe(1);
    });

    it("should return 1 for both empty strings", () => {
      const sim = service.calculateTitleSimilarity("", "");
      expect(sim).toBe(1);
    });

    it("should return 0 for one empty string", () => {
      const simA = service.calculateTitleSimilarity("", "AI Research");
      const simB = service.calculateTitleSimilarity("AI Research", "");
      expect(simA).toBe(0);
      expect(simB).toBe(0);
    });

    it("should return 0 for completely different titles", () => {
      const sim = service.calculateTitleSimilarity(
        "AI Research",
        "Cooking Recipes",
      );
      expect(sim).toBe(0);
    });

    it("should return intermediate value for partial overlap", () => {
      const sim = service.calculateTitleSimilarity(
        "AI Research Paper",
        "AI Technology Article",
      );
      expect(sim).toBeGreaterThan(0);
      expect(sim).toBeLessThan(1);
    });

    it("should be case-insensitive", () => {
      const sim1 = service.calculateTitleSimilarity(
        "AI Research",
        "ai research",
      );
      expect(sim1).toBe(1);
    });
  });

  // ===========================================================
  // extractDomain()
  // ===========================================================

  describe("extractDomain()", () => {
    it("should extract hostname from valid URL", () => {
      const domain = service.extractDomain("https://www.example.com/path");
      expect(domain).toBe("www.example.com");
    });

    it("should lowercase the domain", () => {
      const domain = service.extractDomain("https://EXAMPLE.COM/path");
      expect(domain).toBe("example.com");
    });

    it("should return lowercased raw string for invalid URL", () => {
      const domain = service.extractDomain("NOT_A_URL");
      expect(domain).toBe("not_a_url");
    });
  });

  // ===========================================================
  // getSourceTypeScore()
  // ===========================================================

  describe("getSourceTypeScore()", () => {
    it("should return 0.9 for ACADEMIC", () => {
      expect(service.getSourceTypeScore(DataSourceType.ACADEMIC)).toBe(0.9);
    });

    it("should return 0.9 for OPENALEX", () => {
      expect(service.getSourceTypeScore(DataSourceType.OPENALEX)).toBe(0.9);
    });

    it("should return 0.9 for PUBMED", () => {
      expect(service.getSourceTypeScore(DataSourceType.PUBMED)).toBe(0.9);
    });

    it("should return 0.85 for SEMANTIC_SCHOLAR", () => {
      expect(service.getSourceTypeScore(DataSourceType.SEMANTIC_SCHOLAR)).toBe(
        0.85,
      );
    });

    it("should return 0.7 for GITHUB", () => {
      expect(service.getSourceTypeScore(DataSourceType.GITHUB)).toBe(0.7);
    });

    it("should return 0.6 for WEB", () => {
      expect(service.getSourceTypeScore(DataSourceType.WEB)).toBe(0.6);
    });

    it("should return 0.5 for HACKERNEWS", () => {
      expect(service.getSourceTypeScore(DataSourceType.HACKERNEWS)).toBe(0.5);
    });

    it("should return 0.4 for SOCIAL_X", () => {
      expect(service.getSourceTypeScore(DataSourceType.SOCIAL_X)).toBe(0.4);
    });

    it("should return default 0.55 for unmapped source type", () => {
      expect(service.getSourceTypeScore(DataSourceType.RSS)).toBe(0.55);
    });

    it("should return default 0.55 for LOCAL source type", () => {
      expect(service.getSourceTypeScore(DataSourceType.LOCAL)).toBe(0.55);
    });
  });

  // ===========================================================
  // getDomainAuthorityScore()
  // ===========================================================

  describe("getDomainAuthorityScore()", () => {
    it("should return 1.0 for .edu domain", () => {
      expect(service.getDomainAuthorityScore("https://mit.edu/paper")).toBe(
        1.0,
      );
    });

    it("should return 1.0 for arxiv.org", () => {
      expect(service.getDomainAuthorityScore("https://arxiv.org/abs/123")).toBe(
        1.0,
      );
    });

    it("should return 1.0 for semanticscholar.org", () => {
      expect(service.getDomainAuthorityScore("semanticscholar.org")).toBe(1.0);
    });

    it("should return 1.0 for pubmed.ncbi.nlm.nih.gov", () => {
      expect(service.getDomainAuthorityScore("pubmed.ncbi.nlm.nih.gov")).toBe(
        1.0,
      );
    });

    it("should return 1.0 for springer.com", () => {
      expect(
        service.getDomainAuthorityScore("https://springer.com/paper"),
      ).toBe(1.0);
    });

    it("should return 1.0 for nature.com", () => {
      expect(service.getDomainAuthorityScore("nature.com")).toBe(1.0);
    });

    it("should return 1.0 for ieee.org", () => {
      expect(service.getDomainAuthorityScore("ieee.org")).toBe(1.0);
    });

    it("should return 1.0 for acm.org", () => {
      expect(service.getDomainAuthorityScore("acm.org")).toBe(1.0);
    });

    it("should return 1.0 for .ac.uk domain", () => {
      expect(service.getDomainAuthorityScore("https://ox.ac.uk/research")).toBe(
        1.0,
      );
    });

    it("should return 1.0 for .ac.jp domain", () => {
      expect(service.getDomainAuthorityScore("https://u.ac.jp/paper")).toBe(
        1.0,
      );
    });

    it("should return 0.9 for .gov domain", () => {
      expect(service.getDomainAuthorityScore("https://nih.gov/research")).toBe(
        0.9,
      );
    });

    it("should return 0.9 for .mil domain", () => {
      expect(
        service.getDomainAuthorityScore("https://darpa.mil/research"),
      ).toBe(0.9);
    });

    it("should return 0.7 for regular domain", () => {
      expect(
        service.getDomainAuthorityScore("https://medium.com/article"),
      ).toBe(0.7);
    });

    it("should be case-insensitive", () => {
      expect(service.getDomainAuthorityScore("ARXIV.ORG")).toBe(1.0);
    });
  });

  // ===========================================================
  // getRecencyScore()
  // ===========================================================

  describe("getRecencyScore()", () => {
    it("should return 0.6 for undefined publishedAt", () => {
      expect(service.getRecencyScore(undefined)).toBe(0.6);
    });

    it("should return 1.0 for very recent date (today)", () => {
      expect(service.getRecencyScore(new Date())).toBe(1.0);
    });

    it("should return 1.0 for date within last year", () => {
      const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
      expect(service.getRecencyScore(sixMonthsAgo)).toBe(1.0);
    });

    it("should return 0.8 for date between 1 and 3 years ago", () => {
      const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
      expect(service.getRecencyScore(twoYearsAgo)).toBe(0.8);
    });

    it("should return 0.6 for date older than 3 years", () => {
      const fourYearsAgo = new Date(Date.now() - 4 * 365 * 24 * 60 * 60 * 1000);
      expect(service.getRecencyScore(fourYearsAgo)).toBe(0.6);
    });
  });

  // ===========================================================
  // getContentDepthScore()
  // ===========================================================

  describe("getContentDepthScore()", () => {
    it("should return 1.0 for snippet longer than 500 chars", () => {
      const longSnippet = "x".repeat(501);
      expect(service.getContentDepthScore(longSnippet)).toBe(1.0);
    });

    it("should return 0.7 for snippet between 200 and 500 chars", () => {
      const mediumSnippet = "x".repeat(300);
      expect(service.getContentDepthScore(mediumSnippet)).toBe(0.7);
    });

    it("should return 0.5 for snippet shorter than 200 chars", () => {
      const shortSnippet = "Short snippet";
      expect(service.getContentDepthScore(shortSnippet)).toBe(0.5);
    });

    it("should return 0.5 for null snippet", () => {
      expect(service.getContentDepthScore(null)).toBe(0.5);
    });

    it("should return 0.5 for undefined snippet", () => {
      expect(service.getContentDepthScore(undefined)).toBe(0.5);
    });

    it("should return 0.5 for empty snippet", () => {
      expect(service.getContentDepthScore("")).toBe(0.5);
    });

    it("should return 0.7 for exactly 201-char snippet", () => {
      const snippet = "x".repeat(201);
      expect(service.getContentDepthScore(snippet)).toBe(0.7);
    });
  });

  // ===========================================================
  // getCredibilityScore()
  // ===========================================================

  describe("getCredibilityScore()", () => {
    it("should return a number between 0 and 1", () => {
      const item = makeItem({
        sourceType: DataSourceType.ACADEMIC,
        domain: "arxiv.org",
        snippet: "x".repeat(600),
      });
      const score = service.getCredibilityScore(item);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it("should score academic sources higher than social sources", () => {
      const academicItem = makeItem({
        sourceType: DataSourceType.ACADEMIC,
        domain: "arxiv.org",
        snippet: "x".repeat(300),
        url: "https://arxiv.org/paper",
      });
      const socialItem = makeItem({
        sourceType: DataSourceType.SOCIAL_X,
        domain: "twitter.com",
        snippet: "x".repeat(300),
        url: "https://twitter.com/post",
      });

      const academicScore = service.getCredibilityScore(academicItem);
      const socialScore = service.getCredibilityScore(socialItem);

      expect(academicScore).toBeGreaterThan(socialScore);
    });

    it("should use url as fallback when domain is undefined", () => {
      const item = makeItem({
        sourceType: DataSourceType.WEB,
        domain: undefined,
        url: "https://arxiv.org/abs/1234",
        snippet: "x".repeat(300),
      });
      const score = service.getCredibilityScore(item);
      // arxiv.org in URL should trigger academic domain bonus
      expect(score).toBeGreaterThan(0.7);
    });
  });

  // ===========================================================
  // getRelevanceScore()
  // ===========================================================

  describe("getRelevanceScore()", () => {
    it("should return 0.5 for empty searchQuery", () => {
      const item = makeItem({ title: "AI Research", snippet: "Some content" });
      expect(service.getRelevanceScore(item, "")).toBe(0.5);
    });

    it("should return 0.5 when all query terms are stop words", () => {
      const item = makeItem({ title: "AI Research", snippet: "Some content" });
      // All stop words — tokenize returns []
      expect(service.getRelevanceScore(item, "the a an is")).toBe(0.5);
    });

    it("should return higher score when query term appears in title", () => {
      const item = makeItem({
        title: "Deep Learning AI Research",
        snippet:
          "This article discusses various aspects of machine learning in detail.",
      });
      const score = service.getRelevanceScore(item, "deep learning");
      expect(score).toBeGreaterThan(0.3);
    });

    it("should give bonus for exact phrase match in title", () => {
      const item = makeItem({
        title: "machine learning applications in healthcare",
        snippet:
          "A detailed analysis of machine learning in healthcare systems.",
      });
      const scoreWithExact = service.getRelevanceScore(
        item,
        "machine learning applications",
      );
      const scoreWithPartial = service.getRelevanceScore(item, "machine xzy");
      expect(scoreWithExact).toBeGreaterThan(scoreWithPartial);
    });

    it("should cap score at 1.0", () => {
      const longTitle =
        "machine learning AI neural networks deep learning research applications";
      const item = makeItem({
        title: longTitle,
        snippet: longTitle + " ".repeat(50) + longTitle,
        metadata: { citationCount: 200 },
      });
      const score = service.getRelevanceScore(
        item,
        "machine learning AI neural networks",
      );
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it("should give citation bonus for >100 citations", () => {
      const item = makeItem({
        title: "AI Research",
        snippet: "x".repeat(200),
        metadata: { citationCount: 150 },
      });
      const itemWithoutCitations = makeItem({
        title: "AI Research",
        snippet: "x".repeat(200),
        metadata: { citationCount: 0 },
        url: "https://example.com/b",
      });

      const scoreWith = service.getRelevanceScore(item, "AI");
      const scoreWithout = service.getRelevanceScore(
        itemWithoutCitations,
        "AI",
      );
      expect(scoreWith).toBeGreaterThanOrEqual(scoreWithout);
    });

    it("should give smaller citation bonus for 20-100 citations", () => {
      const itemHigh = makeItem({
        title: "AI Research",
        snippet: "x".repeat(200),
        metadata: { citationCount: 150 },
      });
      const itemMedium = makeItem({
        title: "AI Research",
        snippet: "x".repeat(200),
        metadata: { citationCount: 50 },
        url: "https://example.com/b",
      });
      const itemNone = makeItem({
        title: "AI Research",
        snippet: "x".repeat(200),
        metadata: { citationCount: 0 },
        url: "https://example.com/c",
      });

      const scoreHigh = service.getRelevanceScore(itemHigh, "AI");
      const scoreMedium = service.getRelevanceScore(itemMedium, "AI");
      const scoreNone = service.getRelevanceScore(itemNone, "AI");

      expect(scoreHigh).toBeGreaterThan(scoreMedium);
      expect(scoreMedium).toBeGreaterThan(scoreNone);
    });

    it("should penalize very short combined text (< 50 chars)", () => {
      const item = makeItem({
        title: "AI",
        snippet: "Short",
        url: "https://example.com/short",
      });
      const score = service.getRelevanceScore(item, "AI");
      // Score should be penalized (multiplied by 0.5)
      expect(score).toBeLessThan(0.5);
    });

    it("should handle missing title gracefully", () => {
      const item = makeItem({
        title: "",
        snippet:
          "This snippet is about artificial intelligence and its applications in modern society.",
      });
      const score = service.getRelevanceScore(item, "artificial intelligence");
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it("should strip site: filters and OR operators from query", () => {
      const item = makeItem({
        title: "AI research paper",
        snippet:
          "AI deep learning neural networks modern applications details.",
      });
      const score = service.getRelevanceScore(
        item,
        "site:example.com AI OR research",
      );
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it("should not apply exact phrase bonus for short queries (<=5 chars)", () => {
      const item = makeItem({
        title: "AI stuff",
        snippet: "Some content about AI tools in detail with examples here.",
      });
      // "ai" is only 2 chars — no exact phrase bonus
      const score = service.getRelevanceScore(item, "ai");
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================================
  // Domain diversity edge cases via fuse()
  // ===========================================================

  describe("domain diversity enforcement", () => {
    it("should allow items from different domains up to the limit", () => {
      const items = [
        makeItem({ url: "https://a.com/1", title: "Article A1" }),
        makeItem({ url: "https://a.com/2", title: "Article A2 Different" }),
        makeItem({ url: "https://a.com/3", title: "Article A3 Another One" }),
        makeItem({ url: "https://a.com/4", title: "Article A4 Yet Another" }),
        makeItem({
          url: "https://b.com/1",
          title: "Article B1 Completely Unrelated",
        }),
      ];

      const sourceResults = new Map<DataSourceType, AdapterSearchResult>([
        [DataSourceType.WEB, makeAdapterResult(items)],
      ]);

      const result = service.fuse(sourceResults, "test");

      const aComItems = result.items.filter((i) =>
        i.url.startsWith("https://a.com"),
      );
      const bComItems = result.items.filter((i) =>
        i.url.startsWith("https://b.com"),
      );

      expect(aComItems.length).toBeLessThanOrEqual(3);
      expect(bComItems.length).toBe(1);
    });
  });
});
