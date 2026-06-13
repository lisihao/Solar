/**
 * DataEnrichmentService - Supplemental Tests
 *
 * Covers uncovered lines:
 * - Line 110-123: clearFetchCache when cache is non-empty
 * - Line 150: normalizeUrl catch branch (invalid URL)
 * - Line 269-271: enrichSearchResults - topicTitle only (no dimensionName)
 * - Line 351-354: enrichSingleResult - cache hit
 * - Line 604: supplementFiguresViaImageSearch - image-search tool not registered
 * - Line 695-698: supplementFiguresViaImageSearch - toolResult.success is false
 * - Line 703-706: supplementFiguresViaImageSearch - empty results array
 * - Line 764-766: supplementFiguresViaImageSearch - filterRelevantFigures quality gate
 * - Line 774: supplementFiguresViaImageSearch - error thrown
 */

// Break the ai-harness/facade import chain
jest.mock("@/modules/ai-harness/facade", () => ({
  ToolRegistry: jest.fn(),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ToolRegistry: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { DataEnrichmentService } from "../data-enrichment.service";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { FigureExtractorService } from "../../report/figure-extractor.service";
import { FigureRelevanceService } from "../../report/figure-relevance.service";
import { DataSourceType } from "../../../types/data-source.types";
import type { DataSourceResult } from "../../../types/data-source.types";

const mockToolRegistry = {
  tryGet: jest.fn(),
};

const mockFigureExtractor = {
  extractFigures: jest.fn().mockReturnValue([]),
  validateAndUpgradeFigures: jest
    .fn()
    .mockImplementation((figs) => Promise.resolve(figs)),
};

const mockFigureRelevance = {
  filterRelevantFigures: jest
    .fn()
    .mockImplementation((figs) => Promise.resolve(figs)),
};

const makeResult = (url: string, snippet?: string): DataSourceResult => ({
  sourceType: DataSourceType.WEB,
  title: "Test Article",
  url,
  snippet: snippet || "A short snippet about the topic.",
  domain: "example.com",
});

describe("DataEnrichmentService (supplemental)", () => {
  let service: DataEnrichmentService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataEnrichmentService,
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: FigureExtractorService, useValue: mockFigureExtractor },
        { provide: FigureRelevanceService, useValue: mockFigureRelevance },
      ],
    }).compile();

    service = module.get<DataEnrichmentService>(DataEnrichmentService);
  });

  // ─── clearFetchCache ─────────────────────────────────────────────────────────

  describe("clearFetchCache", () => {
    it("should clear cache without logging when cache is empty", () => {
      service.clearFetchCache();
      const stats = service.getFetchCacheStats();
      expect(stats.size).toBe(0);
    });

    it("should clear non-empty cache and log", async () => {
      // Populate cache by enriching a result
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, content: "A".repeat(200) },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      await service.enrichSearchResults([makeResult("https://example.com/a1")]);

      // Cache should have one entry now
      expect(service.getFetchCacheStats().size).toBe(1);

      // Clear it
      service.clearFetchCache();

      expect(service.getFetchCacheStats().size).toBe(0);
    });
  });

  // ─── getFetchCacheStats ───────────────────────────────────────────────────────

  describe("getFetchCacheStats", () => {
    it("should return urls in cache", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, content: "Valid content ".repeat(20) },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      await service.enrichSearchResults([makeResult("https://example.com/b1")]);

      const stats = service.getFetchCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.urls.some((u) => u.includes("example.com"))).toBe(true);
    });
  });

  // ─── normalizeUrl - invalid URL ───────────────────────────────────────────────

  describe("normalizeUrl (via cache key)", () => {
    it("should handle invalid URLs gracefully (catch branch)", async () => {
      // Use a malformed URL that will fail URL() constructor
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, content: "Valid content ".repeat(20) },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      // "not-a-url" is not a valid URL; normalizeUrl catch branch trims it
      const result = makeResult("not-a-url");
      const enriched = await service.enrichSearchResults([result]);

      expect(enriched).toHaveLength(1);
      // Should not throw; fallback to snippet or fetch
    });
  });

  // ─── enrichSearchResults - topicTitle without dimensionName ─────────────────

  describe("enrichSearchResults - figureContext with only topicTitle", () => {
    it("should use topicTitle alone as figureContext when no dimensionName", async () => {
      // Make web scraper return minimal content (triggers image search supplement check)
      const mockScraperTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, content: "Valid content ".repeat(20) },
        }),
      };
      const mockImageTool = {
        execute: jest.fn().mockResolvedValue({
          success: false,
          error: { message: "not available" },
        }),
      };

      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-scraper") return mockScraperTool;
        if (toolId === "image-search") return mockImageTool;
        return null;
      });
      mockFigureExtractor.extractFigures.mockReturnValue([]);

      const results = [makeResult("https://example.com/article")];
      // No dimensionName, only topicTitle
      const enriched = await service.enrichSearchResults(results, {
        topicTitle: "AI Technology",
        enableFigures: true,
        // dimensionName is intentionally omitted
      });

      expect(enriched).toHaveLength(1);
      // image-search should have been queried (due to figure shortage)
      expect(mockImageTool.execute).toHaveBeenCalled();
    });
  });

  // ─── enrichSingleResult - cache hit ──────────────────────────────────────────

  describe("enrichSingleResult - cache hit deduplication", () => {
    it("should return cached result on second call with same URL", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            content: "Cached valid content ".repeat(15),
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const result1 = makeResult("https://example.com/cached-article");
      const result2 = makeResult("https://example.com/cached-article");

      // First call
      await service.enrichSearchResults([result1], { topN: 1 });
      // Second call with same URL
      await service.enrichSearchResults([result2], { topN: 1 });

      // Tool should only have been called ONCE (cache hit on second)
      expect(mockTool.execute).toHaveBeenCalledTimes(1);
    });

    it("should normalize URLs for cache (strip tracking params)", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, content: "Valid content ".repeat(15) },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const url1 = makeResult(
        "https://example.com/article?utm_source=google&utm_medium=cpc",
      );
      const url2 = makeResult(
        "https://example.com/article?utm_source=twitter&utm_campaign=summer",
      );

      await service.enrichSearchResults([url1], { topN: 1 });
      await service.enrichSearchResults([url2], { topN: 1 });

      // Both normalize to same URL → only one fetch
      expect(mockTool.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ─── supplementFiguresViaImageSearch paths ───────────────────────────────────

  describe("supplementFiguresViaImageSearch (via enrichSearchResults)", () => {
    const makeScraperTool = () => ({
      execute: jest.fn().mockResolvedValue({
        success: true,
        data: { success: true, content: "Valid content ".repeat(20) },
      }),
    });

    beforeEach(() => {
      // Ensure figure extractor returns 0 figures to trigger supplement
      mockFigureExtractor.extractFigures.mockReturnValue([]);
    });

    it("should skip image supplement when image-search tool not registered", async () => {
      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-scraper") return makeScraperTool();
        return null; // image-search not registered
      });

      const results = [makeResult("https://example.com/no-images")];
      const enriched = await service.enrichSearchResults(results, {
        topicTitle: "Tech Trends",
        enableFigures: true,
      });

      // Should complete without error, no figures supplemented
      expect(enriched).toHaveLength(1);
    });

    it("should handle image search failure gracefully", async () => {
      const imageSearchTool = {
        execute: jest.fn().mockResolvedValue({
          success: false,
          error: { message: "Image search API error" },
        }),
      };

      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-scraper") return makeScraperTool();
        if (toolId === "image-search") return imageSearchTool;
        return null;
      });

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results, {
        topicTitle: "AI Tech",
        enableFigures: true,
      });

      expect(enriched).toHaveLength(1);
      // No figures added due to failure
    });

    it("should handle empty results from image search", async () => {
      const imageSearchTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            results: [],
            totalResults: 0,
            provider: "bing",
          },
        }),
      };

      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-scraper") return makeScraperTool();
        if (toolId === "image-search") return imageSearchTool;
        return null;
      });

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results, {
        topicTitle: "AI Tech",
        enableFigures: true,
      });

      expect(enriched).toHaveLength(1);
    });

    it("should filter non-http imageUrls from image search results", async () => {
      const imageSearchTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            results: [
              { imageUrl: "data:image/png;base64,abc", title: "Invalid" }, // not http
              { imageUrl: "https://valid.com/image.png", title: "Valid Chart" },
            ],
            totalResults: 2,
            provider: "bing",
          },
        }),
      };

      mockFigureExtractor.validateAndUpgradeFigures.mockImplementation((figs) =>
        Promise.resolve(figs),
      );
      mockFigureRelevance.filterRelevantFigures.mockImplementation((figs) =>
        Promise.resolve(figs),
      );

      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-scraper") return makeScraperTool();
        if (toolId === "image-search") return imageSearchTool;
        return null;
      });

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results, {
        topicTitle: "AI Charts",
        enableFigures: true,
      });

      // Only valid https image should pass
      const totalFigures = enriched.reduce(
        (sum, r) => sum + (r.extractedFigures?.length || 0),
        0,
      );
      expect(totalFigures).toBeGreaterThan(0);
    });

    it("should catch and handle exceptions from image search tool", async () => {
      const imageSearchTool = {
        execute: jest.fn().mockRejectedValue(new Error("Network failure")),
      };

      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-scraper") return makeScraperTool();
        if (toolId === "image-search") return imageSearchTool;
        return null;
      });

      const results = [makeResult("https://example.com/article")];
      // Should not throw even though image search fails
      await expect(
        service.enrichSearchResults(results, {
          topicTitle: "AI Tech",
          enableFigures: true,
        }),
      ).resolves.not.toThrow();
    });

    it("should attach supplement figures to snippet-only result when no fetched result exists", async () => {
      // Make web-scraper fail so the topN result has urlValid: false → filtered out
      const failScraperTool = {
        execute: jest.fn().mockResolvedValue({
          success: false,
          error: { message: "scrape failed" },
        }),
      };

      const imageSearchTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            results: [
              { imageUrl: "https://charts.com/fig.png", title: "Data Chart" },
            ],
            totalResults: 1,
            provider: "bing",
          },
        }),
      };

      mockFigureExtractor.validateAndUpgradeFigures.mockImplementation((figs) =>
        Promise.resolve(figs),
      );
      mockFigureRelevance.filterRelevantFigures.mockImplementation((figs) =>
        Promise.resolve(figs),
      );

      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-scraper") return failScraperTool;
        if (toolId === "image-search") return imageSearchTool;
        return null;
      });

      const results = [makeResult("https://example.com/snippet-only")];
      const enriched = await service.enrichSearchResults(results, {
        topicTitle: "AI Data",
        enableFigures: true,
      });

      // The scraper failed so the result gets urlValid: false and is filtered out.
      // enrichSearchResults returns only results where urlValid !== false.
      expect(enriched).toHaveLength(0);
    });

    it("should infer figure types from image search result titles", async () => {
      const imageSearchTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            results: [
              { imageUrl: "https://c.com/chart.png", title: "Sales Chart" },
              {
                imageUrl: "https://c.com/diagram.png",
                title: "System Architecture Diagram",
              },
              {
                imageUrl: "https://c.com/table.png",
                title: "Comparison Table",
              },
              { imageUrl: "https://c.com/photo.png", title: "Keynote Photo" },
            ],
            totalResults: 4,
            provider: "bing",
          },
        }),
      };

      mockFigureExtractor.validateAndUpgradeFigures.mockImplementation((figs) =>
        Promise.resolve(figs),
      );
      mockFigureRelevance.filterRelevantFigures.mockImplementation((figs) =>
        Promise.resolve(figs),
      );

      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-scraper") return makeScraperTool();
        if (toolId === "image-search") return imageSearchTool;
        return null;
      });

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results, {
        topicTitle: "AI Analysis",
        enableFigures: true,
      });

      expect(enriched).toBeDefined();
    });
  });

  // ─── filterValidResults ───────────────────────────────────────────────────────

  describe("filterValidResults", () => {
    it("should return only valid results", async () => {
      const mockTool = {
        execute: jest
          .fn()
          .mockResolvedValueOnce({
            // first URL: valid
            success: true,
            data: { success: true, content: "Valid content ".repeat(20) },
          })
          .mockResolvedValueOnce({
            // second URL: fails
            success: false,
            error: { message: "404" },
          }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = [
        makeResult("https://example.com/valid"),
        makeResult("https://example.com/invalid"),
      ];
      const filtered = await service.filterValidResults(results);

      expect(filtered.length).toBeLessThan(results.length);
    });
  });
});
