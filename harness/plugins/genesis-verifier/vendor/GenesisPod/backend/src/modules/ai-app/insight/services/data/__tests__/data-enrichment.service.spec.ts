// Break the ai-harness/facade import chain (transitively imports @nestjs/cache-manager)
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

const makeResult = (url: string): DataSourceResult => ({
  sourceType: DataSourceType.WEB,
  title: "Test Article",
  url,
  snippet: "A short snippet about the topic.",
  domain: "example.com",
});

describe("DataEnrichmentService", () => {
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

  // ============================================================
  // enrichSearchResults
  // ============================================================

  describe("enrichSearchResults", () => {
    it("should return empty array when given no results", async () => {
      const result = await service.enrichSearchResults([]);
      expect(result).toEqual([]);
    });

    it("should fall back to snippet when web-scraper tool is not registered", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results);

      // urlValid: false results are filtered out by enrichSearchResults
      expect(enriched).toHaveLength(0);
    });

    it("should fetch full content when scraper succeeds", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            content: "A".repeat(500),
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results);

      expect(enriched[0].contentSource).toBe("fetched");
      expect(enriched[0].urlValid).toBe(true);
      expect(enriched[0].fullContent).toHaveLength(500);
    });

    it("should truncate content to maxContentLength", async () => {
      const longContent = "B".repeat(5000);
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, content: longContent },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results, {
        maxContentLength: 1000,
      });

      expect(enriched[0].fullContent).toHaveLength(1000);
    });

    it("should mark remaining results (beyond topN) without enrichment", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const results = [
        makeResult("https://example.com/1"),
        makeResult("https://example.com/2"),
        makeResult("https://example.com/3"),
      ];
      const enriched = await service.enrichSearchResults(results, { topN: 1 });

      // result[0] (topN=1 range) gets urlValid: false (scraper not registered) → filtered out
      // result[1] and result[2] (remaining) get urlValid: true → kept
      expect(enriched).toHaveLength(2);
      expect(enriched[0].urlValid).toBe(true); // remaining assumed valid
      expect(enriched[0].contentSource).toBe("snippet");
    });

    it("should process sequentially when parallel=false", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, content: "Content ".repeat(50) },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = [
        makeResult("https://example.com/1"),
        makeResult("https://example.com/2"),
      ];
      const enriched = await service.enrichSearchResults(results, {
        parallel: false,
        topN: 2,
      });

      expect(enriched).toHaveLength(2);
      expect(mockTool.execute).toHaveBeenCalledTimes(2);
    });

    it("should fall back to snippet when tool execution fails", async () => {
      const mockTool = {
        execute: jest.fn().mockRejectedValue(new Error("Network error")),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results);

      // urlValid: false results are filtered out by enrichSearchResults
      expect(enriched).toHaveLength(0);
    });

    it("should fall back when tool returns unsuccessful result", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: false,
          error: { message: "Scrape failed" },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results);

      // urlValid: false results are filtered out by enrichSearchResults
      expect(enriched).toHaveLength(0);
    });

    it("should mark content as invalid when it looks like an error page", async () => {
      const errorPageContent = "404 Page Not Found. " + "X".repeat(200);
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, content: errorPageContent },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = [makeResult("https://example.com/missing")];
      const enriched = await service.enrichSearchResults(results);

      // Invalid (error page) results have urlValid: false and are filtered out
      expect(enriched).toHaveLength(0);
    });

    it("should extract figures when enableFigures=true (default)", async () => {
      const mockFigures = [
        { imageUrl: "https://example.com/img.png", caption: "Figure 1" },
      ];
      mockFigureExtractor.extractFigures.mockReturnValue(mockFigures);

      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            content: "Valid content ".repeat(50),
            html: "<img src='img.png'>",
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results, {
        enableFigures: true,
      });

      expect(enriched[0].extractedFigures).toHaveLength(1);
    });

    it("should skip figure extraction when enableFigures=false", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, content: "Valid content ".repeat(50) },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = [makeResult("https://example.com/article")];
      await service.enrichSearchResults(results, {
        enableFigures: false,
      });

      expect(mockFigureExtractor.extractFigures).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // getEnrichmentStats
  // ============================================================

  describe("getEnrichmentStats", () => {
    it("should calculate correct stats from enriched results", () => {
      const enrichedResults = [
        {
          contentSource: "fetched",
          fullContent: "A".repeat(100),
          urlValid: true,
        },
        {
          contentSource: "snippet",
          fullContent: "B".repeat(50),
          urlValid: false,
        },
        {
          contentSource: "fetched",
          fullContent: "C".repeat(200),
          urlValid: true,
        },
      ] as any;

      const stats = service.getEnrichmentStats(enrichedResults);

      expect(stats.total).toBe(3);
      expect(stats.fetched).toBe(2);
      expect(stats.snippetOnly).toBe(1);
      expect(stats.validUrls).toBe(2);
      expect(stats.invalidUrls).toBe(1);
      expect(stats.avgContentLength).toBe(Math.round(350 / 3));
    });

    it("should return zeroed stats for empty results", () => {
      const stats = service.getEnrichmentStats([]);

      expect(stats.total).toBe(0);
      expect(stats.avgContentLength).toBe(0);
    });
  });

  // ============================================================
  // validateUrls
  // ============================================================

  describe("validateUrls", () => {
    it("should return invalid result when tool not registered", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const results = await service.validateUrls(["https://example.com"]);

      expect(results).toHaveLength(1);
      expect(results[0].isValid).toBe(false);
      expect(results[0].hasContent).toBe(false);
    });

    it("should return valid result when scraper succeeds with meaningful content", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, content: "Valid content ".repeat(20) },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.validateUrls(["https://example.com"]);

      expect(results[0].isValid).toBe(true);
      expect(results[0].statusCode).toBe(200);
    });

    it("should handle validation errors gracefully", async () => {
      const mockTool = {
        execute: jest.fn().mockRejectedValue(new Error("timeout")),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.validateUrls(["https://example.com"]);

      expect(results[0].isValid).toBe(false);
      expect(results[0].errorReason).toContain("timeout");
    });
  });

  // ============================================================
  // Image search supplement
  // ============================================================

  describe("image search supplement", () => {
    const mockWebScraperTool = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        data: { success: true, content: "Valid content ".repeat(50) },
      }),
    };

    const mockImageSearchTool = {
      execute: jest.fn(),
    };

    beforeEach(() => {
      // Return different tools depending on the tool ID
      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-scraper") return mockWebScraperTool;
        if (toolId === "image-search") return mockImageSearchTool;
        return null;
      });
    });

    it("should trigger image search when extracted figures < threshold", async () => {
      // Web scraper returns content but extractor returns 0 figures
      mockFigureExtractor.extractFigures.mockReturnValue([]);
      mockImageSearchTool.execute.mockResolvedValue({
        success: true,
        data: {
          success: true,
          results: [
            {
              imageUrl: "https://img.com/chart1.png",
              title: "AI Market Chart",
              sourceUrl: "https://source.com",
              sourceDomain: "source.com",
              width: 800,
              height: 600,
            },
            {
              imageUrl: "https://img.com/chart2.png",
              title: "Technology Trend Graph",
              sourceUrl: "https://source2.com",
              sourceDomain: "source2.com",
            },
          ],
          totalResults: 2,
          provider: "bing",
        },
      });

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results, {
        enableFigures: true,
        topicTitle: "AI Technology",
        dimensionName: "Market Analysis",
      });

      // Image search should have been called
      expect(mockImageSearchTool.execute).toHaveBeenCalled();
      // Figures should be attached to the result
      expect(enriched[0].extractedFigures?.length).toBeGreaterThan(0);
    });

    it("should NOT trigger image search when enough figures already extracted", async () => {
      // Return 12 figures from web extraction (above threshold of 10)
      const figures = Array.from({ length: 12 }, (_, i) => ({
        imageUrl: `https://example.com/fig${i}.png`,
        caption: `Figure ${i}`,
        type: "chart" as const,
        alt: `Figure ${i}`,
      }));
      mockFigureExtractor.extractFigures.mockReturnValue(figures);

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results, {
        enableFigures: true,
        topicTitle: "AI Technology",
        dimensionName: "Market Analysis",
      });

      expect(mockImageSearchTool.execute).not.toHaveBeenCalled();
      expect(enriched[0].extractedFigures).toHaveLength(12);
    });

    it("should NOT trigger image search when enableFigures=false", async () => {
      mockFigureExtractor.extractFigures.mockReturnValue([]);

      const results = [makeResult("https://example.com/article")];
      await service.enrichSearchResults(results, {
        enableFigures: false,
        topicTitle: "AI Technology",
      });

      expect(mockImageSearchTool.execute).not.toHaveBeenCalled();
    });

    it("should NOT trigger image search when no topicTitle provided", async () => {
      mockFigureExtractor.extractFigures.mockReturnValue([]);

      const results = [makeResult("https://example.com/article")];
      await service.enrichSearchResults(results, {
        enableFigures: true,
        // no topicTitle
      });

      expect(mockImageSearchTool.execute).not.toHaveBeenCalled();
    });

    it("should handle image search tool not registered gracefully", async () => {
      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-scraper") return mockWebScraperTool;
        return null; // image-search not registered
      });
      mockFigureExtractor.extractFigures.mockReturnValue([]);

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results, {
        enableFigures: true,
        topicTitle: "AI Technology",
      });

      // Should complete without error, no supplemented figures
      expect(enriched).toHaveLength(1);
    });

    it("should handle image search failure gracefully", async () => {
      mockFigureExtractor.extractFigures.mockReturnValue([]);
      mockImageSearchTool.execute.mockRejectedValue(new Error("API Error"));

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results, {
        enableFigures: true,
        topicTitle: "AI Technology",
      });

      // Should complete without error
      expect(enriched).toHaveLength(1);
    });

    it("should run supplemented figures through quality gates", async () => {
      mockFigureExtractor.extractFigures.mockReturnValue([]);
      mockImageSearchTool.execute.mockResolvedValue({
        success: true,
        data: {
          success: true,
          results: [
            {
              imageUrl: "https://img.com/chart1.png",
              title: "Data Chart",
              sourceUrl: "https://source.com",
              sourceDomain: "source.com",
            },
          ],
          totalResults: 1,
          provider: "bing",
        },
      });

      // Simulate quality gate rejecting all figures
      mockFigureRelevance.filterRelevantFigures.mockResolvedValue([]);

      const results = [makeResult("https://example.com/article")];
      const enriched = await service.enrichSearchResults(results, {
        enableFigures: true,
        topicTitle: "AI Technology",
      });

      // validateAndUpgradeFigures should have been called for supplement
      expect(mockFigureExtractor.validateAndUpgradeFigures).toHaveBeenCalled();
      // filterRelevantFigures should have been called for supplement
      expect(mockFigureRelevance.filterRelevantFigures).toHaveBeenCalled();
      // But all rejected, so no figures attached
      expect(enriched[0].extractedFigures?.length || 0).toBe(0);
    });
  });

  // ============================================================
  // filterValidResults
  // ============================================================

  describe("filterValidResults", () => {
    it("should filter out results with invalid URLs", async () => {
      const mockTool = {
        execute: jest
          .fn()
          .mockResolvedValueOnce({
            success: true,
            data: { success: true, content: "Valid content ".repeat(20) },
          })
          .mockResolvedValueOnce({
            success: false,
            error: { message: "Not found" },
          }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = [
        makeResult("https://valid.com"),
        makeResult("https://invalid.com"),
      ];
      const filtered = await service.filterValidResults(results);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].url).toBe("https://valid.com");
    });
  });
});
