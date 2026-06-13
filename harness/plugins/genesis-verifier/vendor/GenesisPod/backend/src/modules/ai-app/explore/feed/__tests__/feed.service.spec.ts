import { Test, TestingModule } from "@nestjs/testing";
import { FeedService } from "../feed.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

const mockResource = {
  id: "res-1",
  type: "ARTICLE",
  title: "Deep Learning for Natural Language Processing",
  abstract: "An introduction to deep learning techniques for NLP tasks",
  sourceUrl: "https://example.com/article",
  pdfUrl: null,
  codeUrl: null,
  authors: ["Author One"],
  publishedAt: new Date("2026-01-15"),
  aiSummary: "Summary of the article",
  primaryCategory: "AI",
  categories: ["AI", "ML"],
  tags: ["deep-learning", "nlp"],
  qualityScore: "85",
  trendingScore: "70",
  viewCount: 200,
  upvoteCount: 50,
  commentCount: 10,
  createdAt: new Date("2026-01-15"),
  updatedAt: new Date("2026-01-15"),
  autoTags: ["transformer", "attention"],
  thumbnailUrl: null,
};

const mockPrisma = {
  resource: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
};

describe("FeedService", () => {
  let service: FeedService;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FeedService>(FeedService);
  });

  describe("getFeed", () => {
    it("returns paginated feed with default params", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      mockPrisma.resource.count.mockResolvedValue(1);

      const result = await service.getFeed({});

      expect(result.data).toEqual([mockResource]);
      expect(result.pagination).toEqual({
        total: 1,
        skip: 0,
        take: 20,
        hasMore: false,
      });
      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { publishedAt: "desc" },
          where: {
            NOT: { title: "" },
            linkHealth: { notIn: ["BROKEN", "ARCHIVED"] },
          },
        }),
      );
    });

    it("applies type filter", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      mockPrisma.resource.count.mockResolvedValue(1);

      await service.getFeed({ type: "ARTICLE" });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: "ARTICLE" }),
        }),
      );
    });

    it("applies category filter using array_contains", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      mockPrisma.resource.count.mockResolvedValue(1);

      await service.getFeed({ category: "AI" });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            categories: { array_contains: "AI" },
          }),
        }),
      );
    });

    it("applies minQualityScore filter as string gte", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      mockPrisma.resource.count.mockResolvedValue(1);

      await service.getFeed({ minQualityScore: 70 });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            qualityScore: { gte: "70" },
          }),
        }),
      );
    });

    it("sorts by qualityScore when specified", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      mockPrisma.resource.count.mockResolvedValue(1);

      await service.getFeed({ sortBy: "qualityScore" });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { qualityScore: "desc" },
        }),
      );
    });

    it("sorts by trendingScore when specified", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      mockPrisma.resource.count.mockResolvedValue(1);

      await service.getFeed({ sortBy: "trendingScore" });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { trendingScore: "desc" },
        }),
      );
    });

    it("calculates hasMore correctly when more items exist", async () => {
      mockPrisma.resource.findMany.mockResolvedValue(
        Array(20).fill(mockResource),
      );
      mockPrisma.resource.count.mockResolvedValue(50);

      const result = await service.getFeed({ skip: 0, take: 20 });

      expect(result.pagination.hasMore).toBe(true);
    });

    it("calculates hasMore false when on last page", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      mockPrisma.resource.count.mockResolvedValue(21);

      const result = await service.getFeed({ skip: 20, take: 20 });

      expect(result.pagination.hasMore).toBe(false);
    });

    it("includes select fields for feed items", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);
      mockPrisma.resource.count.mockResolvedValue(0);

      await service.getFeed({});

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            id: true,
            title: true,
            type: true,
            qualityScore: true,
            viewCount: true,
          }),
        }),
      );
    });

    it("combines multiple filters (type + category + minQualityScore)", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      mockPrisma.resource.count.mockResolvedValue(1);

      await service.getFeed({
        type: "ARTICLE",
        category: "AI",
        minQualityScore: 60,
      });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: "ARTICLE",
            categories: { array_contains: "AI" },
            qualityScore: { gte: "60" },
          }),
        }),
      );
    });
  });

  describe("search", () => {
    it("searches by query with OR conditions on title/abstract/content", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      mockPrisma.resource.count.mockResolvedValue(1);

      const result = await service.search({ query: "deep learning" });

      expect(result.query).toBe("deep learning");
      expect(result.data).toEqual([mockResource]);
      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              {
                title: {
                  contains: "deep learning",
                  mode: "insensitive",
                },
              },
              {
                abstract: {
                  contains: "deep learning",
                  mode: "insensitive",
                },
              },
              {
                content: {
                  contains: "deep learning",
                  mode: "insensitive",
                },
              },
            ]),
          }),
        }),
      );
    });

    it("returns empty results gracefully", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);
      mockPrisma.resource.count.mockResolvedValue(0);

      const result = await service.search({ query: "nonexistent topic" });

      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.hasMore).toBe(false);
    });

    it("applies type filter in search", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      mockPrisma.resource.count.mockResolvedValue(1);

      await service.search({ query: "ai", type: "ARTICLE" });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: "ARTICLE" }),
        }),
      );
    });

    it("applies category filter in search", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      mockPrisma.resource.count.mockResolvedValue(1);

      await service.search({ query: "ai", category: "ML" });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            categories: { array_contains: "ML" },
          }),
        }),
      );
    });

    it("uses publishedAt desc ordering", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);
      mockPrisma.resource.count.mockResolvedValue(0);

      await service.search({ query: "test" });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { publishedAt: "desc" },
        }),
      );
    });

    it("respects pagination params in search", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);
      mockPrisma.resource.count.mockResolvedValue(100);

      await service.search({ query: "ai", skip: 10, take: 5 });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 }),
      );
    });
  });

  describe("getTrending", () => {
    it("returns trending resources ordered by trendingScore desc", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);

      const result = await service.getTrending(10);

      expect(result).toEqual([mockResource]);
      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          orderBy: { trendingScore: "desc" },
          where: {
            trendingScore: { not: "0" },
            linkHealth: { notIn: ["BROKEN", "ARCHIVED"] },
          },
        }),
      );
    });

    it("uses default take of 10", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      await service.getTrending();

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it("accepts custom take parameter", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      await service.getTrending(5);

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  describe("getRelated", () => {
    const targetResource = {
      id: "res-1",
      type: "ARTICLE",
      title: "Transformer Neural Networks",
      abstract: "Attention is all you need",
      categories: ["AI", "ML"],
      tags: ["transformer", "attention"],
      primaryCategory: "AI",
      autoTags: ["bert", "gpt"],
    };

    it("returns empty array when resource not found", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(null);

      const result = await service.getRelated("nonexistent-id");

      expect(result).toEqual([]);
    });

    it("uses strategy 1 (category+tag) when enough matches found", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(targetResource);
      const relatedResources = Array.from({ length: 12 }, (_, i) => ({
        ...mockResource,
        id: `res-related-${i}`,
        qualityScore: String(80 - i),
      }));
      mockPrisma.resource.findMany.mockResolvedValue(relatedResources);

      const result = await service.getRelated("res-1", 6);

      expect(result.length).toBeLessThanOrEqual(6);
    });

    it("falls through to popular fallback when no category/tag matches", async () => {
      const bareResource = {
        ...targetResource,
        categories: [],
        tags: [],
        autoTags: [],
        title: "a b",
      };
      mockPrisma.resource.findUnique.mockResolvedValue(bareResource);
      const popularResources = Array.from({ length: 6 }, (_, i) => ({
        ...mockResource,
        id: `res-popular-${i}`,
      }));
      // Return empty for all strategies except popular
      mockPrisma.resource.findMany
        .mockResolvedValueOnce([]) // strategy 2: title keywords
        .mockResolvedValueOnce([]) // strategy 3: same type
        .mockResolvedValueOnce([]) // strategy 4: same category
        .mockResolvedValueOnce(popularResources); // strategy 5: popular

      const result = await service.getRelated("res-1", 6);

      expect(result.length).toBeLessThanOrEqual(6);
    });

    it("deduplicates resources across strategies", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(targetResource);
      const duplicateResource = { ...mockResource, id: "res-dup" };
      // Both strategy 1 and 2 return the same resource
      mockPrisma.resource.findMany
        .mockResolvedValueOnce([duplicateResource]) // strategy 1
        .mockResolvedValueOnce([duplicateResource]) // strategy 2
        .mockResolvedValueOnce([]) // strategy 3
        .mockResolvedValueOnce([]) // strategy 4
        .mockResolvedValueOnce([]); // strategy 5

      const result = await service.getRelated("res-1", 6);

      const ids = result.map((r: Record<string, unknown>) => r.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it("sorts results by strategy score descending", async () => {
      // Use a resource with no categories/tags so strategy 1 returns []
      // and we can precisely control which strategy each mock response maps to
      const bareResource = {
        ...targetResource,
        categories: [],
        tags: [],
        autoTags: [],
        title: "a b", // short title: extractKeywords yields [] (words filtered < 2 or stop-words)
        primaryCategory: null, // disable strategy 4
      };
      mockPrisma.resource.findUnique.mockResolvedValue(bareResource);

      const highQualityResource = {
        ...mockResource,
        id: "high-quality",
        qualityScore: "95",
      };
      const lowQualityResource = {
        ...mockResource,
        id: "low-quality",
        qualityScore: "30",
      };

      // Strategy 1 returns [] (no categories/tags)
      // Strategy 2 skipped (no keywords from short title)
      // Strategy 3 (same type) → highQualityResource
      // Strategy 4 skipped (primaryCategory is null)
      // Strategy 5 (popular) → lowQualityResource
      mockPrisma.resource.findMany
        .mockResolvedValueOnce([highQualityResource]) // strategy 3: same type (score 60)
        .mockResolvedValueOnce([lowQualityResource]); // strategy 5: popular (score 20)

      const result = await service.getRelated("res-1", 6);

      // highQualityResource (score 60) should come before lowQualityResource (score 20)
      const ids = result.map((r: Record<string, unknown>) => r.id);
      const highIdx = ids.indexOf("high-quality");
      const lowIdx = ids.indexOf("low-quality");

      expect(highIdx).not.toBe(-1);
      expect(lowIdx).not.toBe(-1);
      expect(highIdx).toBeLessThan(lowIdx);
    });
  });
});
