// Must be before any imports that trigger the @nestjs/cache-manager chain
jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient { $connect = jest.fn(); $disconnect = jest.fn(); $on = jest.fn(); }, AIModelType: { CHAT: "CHAT" },
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: class {},
  RAGFacade: class {},
  ToolRegistry: class {},
  AgentFacade: class {},
  EvalPipelineService: class {},
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: class {},
  RAGFacade: class {},
  ToolRegistry: class {},
  AgentFacade: class {},
  EvalPipelineService: class {},
}));

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

const makeDataSourceResult = (
  url: string,
  snippet = "content",
): DataSourceResult => ({
  sourceType: DataSourceType.WEB,
  title: `Article ${url}`,
  url,
  snippet,
  domain: new URL(url).hostname,
});

const makeVariant = (
  id: string,
  query: string,
  type = QueryVariantType.ORIGINAL,
  weight = 1.0,
): QueryVariant => ({
  id,
  query,
  type,
  weight,
});

const makeVariantResult = (
  variant: QueryVariant,
  results: DataSourceResult[],
  success = true,
): VariantSearchResult => ({
  variant,
  results,
  executionTimeMs: 50,
  success,
});

describe("RAGFusionService", () => {
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
  // generateQueryVariants
  // ============================================================

  describe("generateQueryVariants", () => {
    it("should always include the original query as first variant", async () => {
      mockAiFacade.chatStructured.mockResolvedValue({
        data: {
          variants: [
            { query: "latest AI trends", type: "temporal", weight: 0.8 },
          ],
          overallRationale: "Mixed strategy",
        },
        rawContent: "",
        model: "",
      });

      const result = await service.generateQueryVariants({
        originalQuery: "artificial intelligence trends",
        context: { topicName: "AI Research", dimensionName: "Trends" },
      });

      expect(result.variants[0].type).toBe(QueryVariantType.ORIGINAL);
      expect(result.variants[0].query).toBe("artificial intelligence trends");
    });

    it("should include AI-generated variants", async () => {
      mockAiFacade.chatStructured.mockResolvedValue({
        data: {
          variants: [
            {
              query: "machine learning advances",
              type: "paraphrased",
              weight: 0.8,
            },
            { query: "AI progress 2025", type: "temporal", weight: 0.9 },
          ],
          overallRationale: "Comprehensive coverage",
        },
        rawContent: "",
        model: "",
      });

      const result = await service.generateQueryVariants({
        originalQuery: "AI trends",
        context: { topicName: "AI", dimensionName: "Progress" },
      });

      expect(result.variants.length).toBeGreaterThan(1);
      expect(
        result.variants.some((v) => v.type === QueryVariantType.PARAPHRASED),
      ).toBe(true);
    });

    it("should return only original query on AI error", async () => {
      mockAiFacade.chatStructured.mockRejectedValue(new Error("LLM error"));

      const result = await service.generateQueryVariants({
        originalQuery: "AI trends",
        context: { topicName: "AI", dimensionName: "Progress" },
      });

      expect(result.variants).toHaveLength(1);
      expect(result.variants[0].type).toBe(QueryVariantType.ORIGINAL);
      expect(result.rationale).toContain("变体生成失败");
    });

    it("should clamp variant weights to 0.5-1.0 range", async () => {
      mockAiFacade.chatStructured.mockResolvedValue({
        data: {
          variants: [
            { query: "test query 1", type: "expanded", weight: 0.1 }, // below min
            { query: "test query 2", type: "expanded", weight: 1.5 }, // above max
          ],
          overallRationale: "test",
        },
        rawContent: "",
        model: "",
      });

      const result = await service.generateQueryVariants({
        originalQuery: "test",
        context: { topicName: "Test", dimensionName: "Test" },
      });

      const generatedVariants = result.variants.filter(
        (v) => v.type !== QueryVariantType.ORIGINAL,
      );
      generatedVariants.forEach((v) => {
        expect(v.weight).toBeGreaterThanOrEqual(0.5);
        expect(v.weight).toBeLessThanOrEqual(1.0);
      });
    });

    it("should include generationTimeMs in result", async () => {
      mockAiFacade.chatStructured.mockResolvedValue({
        data: { variants: [], overallRationale: "test" },
        rawContent: "",
        model: "",
      });

      const result = await service.generateQueryVariants({
        originalQuery: "test",
        context: { topicName: "Test", dimensionName: "Test" },
      });

      expect(typeof result.generationTimeMs).toBe("number");
    });
  });

  // ============================================================
  // fuseResults
  // ============================================================

  describe("fuseResults", () => {
    it("should deduplicate results from multiple variants", () => {
      const original = makeVariant("v0", "AI", QueryVariantType.ORIGINAL, 1.0);
      const paraphrased = makeVariant(
        "v1",
        "artificial intelligence",
        QueryVariantType.PARAPHRASED,
        0.8,
      );

      const sharedUrl = "https://example.com/shared";
      const variantResults: VariantSearchResult[] = [
        makeVariantResult(original, [
          makeDataSourceResult(sharedUrl),
          makeDataSourceResult("https://example.com/unique-a"),
        ]),
        makeVariantResult(paraphrased, [
          makeDataSourceResult(sharedUrl), // duplicate
          makeDataSourceResult("https://example.com/unique-b"),
        ]),
      ];

      const fused = service.fuseResults(variantResults);

      const uniqueUrls = new Set(fused.items.map((i) => i.item.url));
      expect(uniqueUrls.size).toBe(fused.items.length); // no duplicates
      expect(fused.items.length).toBe(3); // 3 unique URLs
    });

    it("should apply coverage bonus to results appearing in multiple variants", () => {
      const original = makeVariant("v0", "AI", QueryVariantType.ORIGINAL, 1.0);
      const paraphrased = makeVariant(
        "v1",
        "ML",
        QueryVariantType.PARAPHRASED,
        1.0,
      );
      const expanded = makeVariant(
        "v2",
        "AI ML trends",
        QueryVariantType.EXPANDED,
        1.0,
      );

      const popularUrl = "https://popular.com/article";
      const variantResults: VariantSearchResult[] = [
        makeVariantResult(original, [makeDataSourceResult(popularUrl)]),
        makeVariantResult(paraphrased, [makeDataSourceResult(popularUrl)]),
        makeVariantResult(expanded, [makeDataSourceResult(popularUrl)]),
      ];

      const fused = service.fuseResults(variantResults, {
        coverageBonus: { threshold2: 1.2, threshold3: 1.5 },
      });

      const popular = fused.items.find((i) => i.item.url === popularUrl);
      expect(popular?.coverageCount).toBe(3);
    });

    it("should skip failed variant results", () => {
      const original = makeVariant("v0", "AI", QueryVariantType.ORIGINAL, 1.0);
      const failed = makeVariant("v1", "ML", QueryVariantType.PARAPHRASED, 0.8);

      const variantResults: VariantSearchResult[] = [
        makeVariantResult(original, [
          makeDataSourceResult("https://example.com/a"),
        ]),
        makeVariantResult(failed, [], false), // failed
      ];

      const fused = service.fuseResults(variantResults);

      expect(fused.metadata.successfulVariants).toBe(1);
      expect(fused.items).toHaveLength(1);
    });

    it("should mark contrastive results", () => {
      const contrastive = makeVariant(
        "v0",
        "AI risks",
        QueryVariantType.CONTRASTIVE,
        0.7,
      );
      const variantResults: VariantSearchResult[] = [
        makeVariantResult(contrastive, [
          makeDataSourceResult("https://risks.com/article"),
        ]),
      ];

      const fused = service.fuseResults(variantResults);

      expect(fused.items[0].isContrastiveResult).toBe(true);
    });

    it("should sort items by fusion score descending", () => {
      const original = makeVariant("v0", "AI", QueryVariantType.ORIGINAL, 1.0);
      const paraphrased = makeVariant(
        "v1",
        "ML",
        QueryVariantType.PARAPHRASED,
        0.5,
      );

      // First result appears in both variants (higher score), second only in one
      const sharedUrl = "https://shared.com";
      const variantResults: VariantSearchResult[] = [
        makeVariantResult(original, [
          makeDataSourceResult(sharedUrl),
          makeDataSourceResult("https://unique.com"),
        ]),
        makeVariantResult(paraphrased, [makeDataSourceResult(sharedUrl)]),
      ];

      const fused = service.fuseResults(variantResults);

      // Shared URL should rank higher
      expect(fused.items[0].item.url).toBe(sharedUrl);
    });

    it("should include correct metadata", () => {
      const v0 = makeVariant("v0", "AI", QueryVariantType.ORIGINAL, 1.0);
      const variantResults: VariantSearchResult[] = [
        makeVariantResult(v0, [makeDataSourceResult("https://example.com")]),
      ];

      const fused = service.fuseResults(variantResults);

      expect(fused.metadata.totalVariants).toBe(1);
      expect(fused.metadata.successfulVariants).toBe(1);
      expect(fused.metadata.totalUniqueResults).toBe(1);
      expect(typeof fused.metadata.executionTimeMs).toBe("number");
    });
  });

  // ============================================================
  // convertToDataSourceResults
  // ============================================================

  describe("convertToDataSourceResults", () => {
    it("should convert fused results to DataSourceResult format", () => {
      const v0 = makeVariant("v0", "AI", QueryVariantType.ORIGINAL, 1.0);
      const variantResults: VariantSearchResult[] = [
        makeVariantResult(v0, [makeDataSourceResult("https://example.com")]),
      ];

      const fused = service.fuseResults(variantResults);
      const dataSourceResults = service.convertToDataSourceResults(fused);

      expect(dataSourceResults).toHaveLength(1);
      expect(dataSourceResults[0]).toHaveProperty("url");
      expect(dataSourceResults[0].metadata?.fusionScore).toBeDefined();
      expect(dataSourceResults[0].metadata?.coverageCount).toBeDefined();
    });
  });

  // ============================================================
  // fusionSearch
  // ============================================================

  describe("fusionSearch", () => {
    it("should run end-to-end fusion search", async () => {
      mockAiFacade.chatStructured.mockResolvedValue({
        data: {
          variants: [
            { query: "AI latest research", type: "temporal", weight: 0.8 },
          ],
          overallRationale: "Temporal search",
        },
        rawContent: "",
        model: "",
      });

      const mockSearchFn = jest
        .fn()
        .mockResolvedValue([makeDataSourceResult("https://example.com/ai")]);

      const result = await service.fusionSearch(
        {
          originalQuery: "AI research",
          context: { topicName: "AI", dimensionName: "Research" },
        },
        mockSearchFn,
      );

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.metadata.totalVariants).toBeGreaterThan(0);
    });

    it("should handle search function failures gracefully", async () => {
      mockAiFacade.chatStructured.mockResolvedValue({
        data: {
          variants: [
            { query: "AI research latest", type: "temporal", weight: 0.8 },
          ],
          overallRationale: "test",
        },
        rawContent: "",
        model: "",
      });

      const mockSearchFn = jest
        .fn()
        .mockRejectedValue(new Error("Search error"));

      const result = await service.fusionSearch(
        {
          originalQuery: "AI research",
          context: { topicName: "AI", dimensionName: "Research" },
        },
        mockSearchFn,
      );

      // Should not throw, should return empty or partial results
      expect(result).toBeDefined();
      expect(result.metadata.successfulVariants).toBe(0);
    });
  });
});
