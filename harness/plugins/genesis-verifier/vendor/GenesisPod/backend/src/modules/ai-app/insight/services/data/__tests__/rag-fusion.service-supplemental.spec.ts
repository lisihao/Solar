/**
 * RAGFusionService - Supplemental Tests
 *
 * Covers uncovered branches:
 * - item without URL is skipped in fuseResults (line 236)
 * - weighted_sum fusion method (lines 256-257)
 * - ensemble fusion method (line 260)
 * - normalizeUrl with invalid URL → falls back to lowercased (line 340)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { RAGFusionService } from "../rag-fusion.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  QueryVariantType,
  VariantSearchResult,
  QueryVariant,
} from "../../../types/rag-fusion.types";
import { DataSourceType } from "../../../types/data-source.types";
import type { DataSourceResult } from "../../../types/data-source.types";

const mockAiFacade = {
  chatStructured: jest.fn(),
};

function makeDataSourceResult(
  url: string,
  snippet = "content",
): DataSourceResult {
  return {
    sourceType: DataSourceType.WEB,
    title: `Article ${url}`,
    url,
    snippet,
    domain: url ? new URL(url).hostname : "",
  };
}

function makeResultNoUrl(): DataSourceResult {
  return {
    sourceType: DataSourceType.WEB,
    title: "No URL result",
    url: undefined as unknown as string,
    snippet: "content without url",
  };
}

function makeVariant(
  id: string,
  query: string,
  type = QueryVariantType.ORIGINAL,
  weight = 1.0,
): QueryVariant {
  return { id, query, type, weight };
}

function makeVariantResult(
  variant: QueryVariant,
  results: DataSourceResult[],
  success = true,
): VariantSearchResult {
  return { variant, results, executionTimeMs: 50, success };
}

describe("RAGFusionService (supplemental)", () => {
  let service: RAGFusionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGFusionService,
        { provide: ChatFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<RAGFusionService>(RAGFusionService);
  });

  // ============================================================
  // fuseResults — skip items without URL (line 236)
  // ============================================================

  describe("fuseResults – items without URL are skipped", () => {
    it("should skip result items that have no URL", () => {
      const v0 = makeVariant("v0", "AI", QueryVariantType.ORIGINAL, 1.0);

      const variantResults: VariantSearchResult[] = [
        makeVariantResult(v0, [
          makeDataSourceResult("https://example.com/article"),
          makeResultNoUrl(), // no URL → skipped
        ]),
      ];

      const fused = service.fuseResults(variantResults);

      // Only the item with a URL should be included
      expect(fused.items).toHaveLength(1);
      expect(fused.items[0].item.url).toBe("https://example.com/article");
    });

    it("should handle variant result containing only items without URLs", () => {
      const v0 = makeVariant("v0", "AI", QueryVariantType.ORIGINAL, 1.0);

      const variantResults: VariantSearchResult[] = [
        makeVariantResult(v0, [makeResultNoUrl(), makeResultNoUrl()]),
      ];

      const fused = service.fuseResults(variantResults);

      expect(fused.items).toHaveLength(0);
      expect(fused.metadata.totalUniqueResults).toBe(0);
    });
  });

  // ============================================================
  // fuseResults — weighted_sum fusion method (lines 256-257)
  // ============================================================

  describe("fuseResults – weighted_sum fusion method", () => {
    it("should calculate scores using weighted_sum formula", () => {
      const v0 = makeVariant("v0", "AI", QueryVariantType.ORIGINAL, 1.0);
      const v1 = makeVariant(
        "v1",
        "machine learning",
        QueryVariantType.PARAPHRASED,
        0.8,
      );

      const url1 = "https://example.com/a";
      const url2 = "https://example.com/b";

      const variantResults: VariantSearchResult[] = [
        makeVariantResult(v0, [
          makeDataSourceResult(url1),
          makeDataSourceResult(url2),
        ]),
        makeVariantResult(v1, [makeDataSourceResult(url1)]),
      ];

      const fused = service.fuseResults(variantResults, {
        fusionMethod: "weighted_sum",
      });

      expect(fused.items.length).toBeGreaterThan(0);
      // url1 appears in both variants so should rank higher
      expect(fused.items[0].item.url).toBe(url1);
    });
  });

  // ============================================================
  // fuseResults — ensemble fusion method (line 260)
  // ============================================================

  describe("fuseResults – ensemble fusion method", () => {
    it("should calculate scores using ensemble (count-based) formula", () => {
      const v0 = makeVariant("v0", "AI", QueryVariantType.ORIGINAL, 1.0);
      const v1 = makeVariant(
        "v1",
        "artificial intelligence",
        QueryVariantType.PARAPHRASED,
        0.9,
      );
      const v2 = makeVariant("v2", "AI trends", QueryVariantType.EXPANDED, 0.7);

      const popularUrl = "https://popular.com/article";
      const rareUrl = "https://rare.com/article";

      const variantResults: VariantSearchResult[] = [
        makeVariantResult(v0, [
          makeDataSourceResult(popularUrl),
          makeDataSourceResult(rareUrl),
        ]),
        makeVariantResult(v1, [makeDataSourceResult(popularUrl)]),
        makeVariantResult(v2, [makeDataSourceResult(popularUrl)]),
      ];

      const fused = service.fuseResults(variantResults, {
        fusionMethod: "ensemble",
      });

      expect(fused.items.length).toBeGreaterThan(0);
      // popularUrl appears in 3 variants, rareUrl in only 1
      const popularItem = fused.items.find((i) => i.item.url === popularUrl);
      const rareItem = fused.items.find((i) => i.item.url === rareUrl);
      expect(popularItem!.fusionScore).toBeGreaterThan(rareItem!.fusionScore);
    });
  });

  // ============================================================
  // normalizeUrl — invalid URL falls back to lowercased (line 340)
  // ============================================================

  describe("normalizeUrl – invalid URL fallback", () => {
    it("should handle items with malformed URLs by lowercasing them", () => {
      const v0 = makeVariant("v0", "AI", QueryVariantType.ORIGINAL, 1.0);

      const malformedUrl = "not-a-valid-url/Path/With/Case";
      const malformedResult: DataSourceResult = {
        sourceType: DataSourceType.WEB,
        title: "Malformed URL result",
        url: malformedUrl,
        snippet: "some content",
      };

      const variantResults: VariantSearchResult[] = [
        makeVariantResult(v0, [malformedResult]),
      ];

      // Should not throw
      const fused = service.fuseResults(variantResults);

      expect(fused.items).toHaveLength(1);
      // URL should be normalized to lowercase
      expect(fused.items[0].item.url).toBe(malformedUrl);
    });

    it("should deduplicate results with same malformed URL (case-insensitive)", () => {
      const v0 = makeVariant("v0", "AI", QueryVariantType.ORIGINAL, 1.0);
      const v1 = makeVariant("v1", "ML", QueryVariantType.PARAPHRASED, 0.9);

      // Same path, different case → should be treated as duplicates after normalizing
      const url1 = "MALFORMED/path";
      const url2 = "malformed/path";

      const variantResults: VariantSearchResult[] = [
        makeVariantResult(v0, [
          {
            sourceType: DataSourceType.WEB,
            title: "A",
            url: url1,
            snippet: "s",
          },
        ]),
        makeVariantResult(v1, [
          {
            sourceType: DataSourceType.WEB,
            title: "B",
            url: url2,
            snippet: "s",
          },
        ]),
      ];

      const fused = service.fuseResults(variantResults);

      // Both normalize to "malformed/path" → deduplicated to 1
      expect(fused.items).toHaveLength(1);
    });
  });
});
