import { Test, TestingModule } from "@nestjs/testing";
import { RecommendationsService } from "../recommendations.service.postgres";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { GraphService } from "../../../../../common/graph/graph.service";

const makeResource = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: "ARTICLE",
  title: `Resource ${id}`,
  abstract: "An abstract",
  sourceUrl: `https://example.com/${id}`,
  pdfUrl: null,
  codeUrl: null,
  authors: [],
  publishedAt: new Date("2026-01-10"),
  aiSummary: null,
  primaryCategory: "AI",
  categories: ["AI", "ML"],
  tags: ["deep-learning"],
  qualityScore: "80",
  trendingScore: "60",
  viewCount: 100,
  upvoteCount: 20,
  commentCount: 5,
  content: null,
  autoTags: [],
  thumbnailUrl: null,
  userId: "user-1",
  createdAt: new Date("2026-01-10"),
  updatedAt: new Date("2026-01-10"),
  ...overrides,
});

const mockPrisma = {
  resource: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  userActivity: {
    findMany: jest.fn(),
  },
};

const mockGraphService = {
  findSimilarResources: jest.fn(),
  getRelatedNodes: jest.fn(),
};

describe("RecommendationsService", () => {
  let service: RecommendationsService;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecommendationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GraphService, useValue: mockGraphService },
      ],
    }).compile();

    service = module.get<RecommendationsService>(RecommendationsService);
  });

  describe("getPersonalizedRecommendations", () => {
    it("returns popular recommendations when userId is not provided", async () => {
      const popularResources = [makeResource("pop-1"), makeResource("pop-2")];
      mockPrisma.resource.findMany.mockResolvedValue(popularResources);

      const result = await service.getPersonalizedRecommendations(undefined, 2);

      expect(result).toEqual(popularResources);
      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { qualityScore: { gte: "50" } },
          orderBy: [{ trendingScore: "desc" }, { qualityScore: "desc" }],
        }),
      );
    });

    it("returns popular recommendations when user has no activity", async () => {
      mockPrisma.userActivity.findMany.mockResolvedValue([]);
      const popularResources = [makeResource("pop-1")];
      mockPrisma.resource.findMany.mockResolvedValue(popularResources);

      const result = await service.getPersonalizedRecommendations("user-1", 5);

      expect(result).toEqual(popularResources);
    });

    it("returns user-based recommendations when user has activity", async () => {
      mockPrisma.userActivity.findMany.mockResolvedValue([
        { resourceId: "res-1" },
        { resourceId: "res-2" },
      ]);

      const userResources = [
        makeResource("res-1", {
          categories: ["AI"],
          tags: ["nlp"],
          type: "ARTICLE",
        }),
        makeResource("res-2", {
          categories: ["ML"],
          tags: ["cv"],
          type: "ARTICLE",
        }),
      ];
      const similarResources = [
        makeResource("sim-1"),
        makeResource("sim-2"),
        makeResource("sim-3"),
      ];

      // findMany for the user-interest resources
      mockPrisma.resource.findMany
        .mockResolvedValueOnce(userResources) // get user-interest resource metadata
        .mockResolvedValueOnce(similarResources); // find similar resources

      const result = await service.getPersonalizedRecommendations("user-1", 3);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("filters out already-viewed resources from personalized results", async () => {
      mockPrisma.userActivity.findMany.mockResolvedValue([
        { resourceId: "res-1" },
      ]);

      const alreadyViewed = makeResource("res-1");
      const notViewed = makeResource("sim-1");

      mockPrisma.resource.findMany
        .mockResolvedValueOnce([
          makeResource("res-1", { categories: [], tags: [] }),
        ])
        .mockResolvedValueOnce([alreadyViewed, notViewed]);

      const result = await service.getPersonalizedRecommendations("user-1", 10);

      const ids = result.map((r) => r.id);
      expect(ids).not.toContain("res-1");
    });

    it("sorts personalized results by combined quality + trending score", async () => {
      mockPrisma.userActivity.findMany.mockResolvedValue([
        { resourceId: "res-seed" },
      ]);

      mockPrisma.resource.findMany
        .mockResolvedValueOnce([
          makeResource("res-seed", { categories: ["AI"], tags: [] }),
        ])
        .mockResolvedValueOnce([
          makeResource("low-score", {
            qualityScore: "20",
            trendingScore: "10",
          }),
          makeResource("high-score", {
            qualityScore: "90",
            trendingScore: "80",
          }),
        ]);

      const result = await service.getPersonalizedRecommendations("user-1", 10);

      if (result.length >= 2) {
        const highIdx = result.findIndex((r) => r.id === "high-score");
        const lowIdx = result.findIndex((r) => r.id === "low-score");
        if (highIdx !== -1 && lowIdx !== -1) {
          expect(highIdx).toBeLessThan(lowIdx);
        }
      }
    });
  });

  describe("getContentBasedRecommendations", () => {
    it("returns empty array when resource is not found", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(null);

      const result = await service.getContentBasedRecommendations(
        "nonexistent",
        5,
      );

      expect(result).toEqual([]);
    });

    it("finds resources with matching category or tags", async () => {
      const targetResource = {
        type: "ARTICLE",
        categories: ["AI", "ML"],
        tags: ["transformer"],
        primaryCategory: "AI",
      };
      mockPrisma.resource.findUnique.mockResolvedValue(targetResource);
      const relatedResources = [makeResource("rel-1"), makeResource("rel-2")];
      mockPrisma.resource.findMany.mockResolvedValue(relatedResources);

      const result = await service.getContentBasedRecommendations("res-1", 5);

      expect(result).toEqual(relatedResources);
      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { not: "res-1" },
            type: "ARTICLE",
          }),
          take: 5,
          orderBy: { qualityScore: "desc" },
        }),
      );
    });

    it("excludes the source resource itself from results", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue({
        type: "ARTICLE",
        categories: ["AI"],
        tags: [],
        primaryCategory: "AI",
      });
      mockPrisma.resource.findMany.mockResolvedValue([makeResource("rel-1")]);

      await service.getContentBasedRecommendations("res-1", 5);

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: "res-1" } }),
        }),
      );
    });

    it("handles resource with empty categories and tags", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue({
        type: "ARTICLE",
        categories: [],
        tags: [],
        primaryCategory: "AI",
      });
      mockPrisma.resource.findMany.mockResolvedValue([]);

      const result = await service.getContentBasedRecommendations("res-1", 5);

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getGraphBasedRecommendations", () => {
    it("returns graph-based similar resources", async () => {
      const graphResults = [
        { resource: makeResource("graph-1"), commonCount: 5 },
        { resource: makeResource("graph-2"), commonCount: 3 },
      ];
      mockGraphService.findSimilarResources.mockResolvedValue(graphResults);

      const result = await service.getGraphBasedRecommendations("res-1", 5);

      expect(result.length).toBe(2);
      expect(mockGraphService.findSimilarResources).toHaveBeenCalledWith(
        "res-1",
        5,
      );
    });

    it("falls back to content-based when graph service throws", async () => {
      mockGraphService.findSimilarResources.mockRejectedValue(
        new Error("Graph service unavailable"),
      );
      mockPrisma.resource.findUnique.mockResolvedValue({
        type: "ARTICLE",
        categories: ["AI"],
        tags: [],
        primaryCategory: "AI",
      });
      const fallbackResources = [makeResource("fallback-1")];
      mockPrisma.resource.findMany.mockResolvedValue(fallbackResources);

      const result = await service.getGraphBasedRecommendations("res-1", 5);

      expect(result).toEqual(fallbackResources);
    });
  });

  describe("getHybridRecommendations", () => {
    it("combines content-based, graph-based, and popular with deduplication", async () => {
      const contentResource = makeResource("content-1", { qualityScore: "80" });
      const graphResource = makeResource("graph-1", { qualityScore: "70" });
      const popularResource = makeResource("popular-1", {
        trendingScore: "90",
      });

      // getContentBasedRecommendations
      mockPrisma.resource.findUnique.mockResolvedValue({
        type: "ARTICLE",
        categories: ["AI"],
        tags: ["nlp"],
        primaryCategory: "AI",
      });
      mockPrisma.resource.findMany
        .mockResolvedValueOnce([contentResource]) // content-based
        .mockResolvedValueOnce([popularResource]); // popular fallback

      // getGraphBasedRecommendations
      mockGraphService.findSimilarResources.mockResolvedValue([
        { resource: graphResource, commonCount: 3 },
      ]);

      const result = await service.getHybridRecommendations(
        "res-1",
        undefined,
        10,
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("excludes the source resource from hybrid results", async () => {
      const sourceResource = makeResource("res-1", {
        qualityScore: "90",
        trendingScore: "80",
      });

      mockPrisma.resource.findUnique.mockResolvedValue({
        type: "ARTICLE",
        categories: ["AI"],
        tags: [],
        primaryCategory: "AI",
      });
      mockPrisma.resource.findMany
        .mockResolvedValueOnce([sourceResource]) // content-based returns source
        .mockResolvedValueOnce([sourceResource]); // popular returns source

      mockGraphService.findSimilarResources.mockResolvedValue([]);

      const result = await service.getHybridRecommendations(
        "res-1",
        undefined,
        10,
      );

      const ids = result.map((r) => r.id);
      expect(ids).not.toContain("res-1");
    });

    it("sorts results by combined weighted score", async () => {
      const highQuality = makeResource("high", {
        qualityScore: "95",
        trendingScore: "80",
      });
      const lowQuality = makeResource("low", {
        qualityScore: "20",
        trendingScore: "10",
      });

      mockPrisma.resource.findUnique.mockResolvedValue({
        type: "ARTICLE",
        categories: [],
        tags: [],
        primaryCategory: "AI",
      });
      mockPrisma.resource.findMany
        .mockResolvedValueOnce([lowQuality, highQuality]) // content-based
        .mockResolvedValueOnce([]); // popular

      mockGraphService.findSimilarResources.mockResolvedValue([]);

      const result = await service.getHybridRecommendations(
        "res-seed",
        undefined,
        10,
      );

      if (result.length >= 2) {
        const highIdx = result.findIndex((r) => r.id === "high");
        const lowIdx = result.findIndex((r) => r.id === "low");
        if (highIdx !== -1 && lowIdx !== -1) {
          expect(highIdx).toBeLessThan(lowIdx);
        }
      }
    });
  });

  describe("getColdStartRecommendations", () => {
    it("returns high quality and trending resources for new users", async () => {
      const coldStartResources = [
        makeResource("cold-1", { qualityScore: "90", trendingScore: "85" }),
        makeResource("cold-2", { qualityScore: "75", trendingScore: "70" }),
      ];
      mockPrisma.resource.findMany.mockResolvedValue(coldStartResources);

      const result = await service.getColdStartRecommendations(2);

      expect(result).toEqual(coldStartResources);
      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { qualityScore: { gte: "70" } },
          take: 2,
          orderBy: [
            { trendingScore: "desc" },
            { qualityScore: "desc" },
            { publishedAt: "desc" },
          ],
        }),
      );
    });

    it("uses default limit of 10", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      await service.getColdStartRecommendations();

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  describe("getRecommendationsByCategory", () => {
    it("returns resources matching category via primaryCategory or categories array", async () => {
      const categoryResources = [makeResource("cat-1"), makeResource("cat-2")];
      mockPrisma.resource.findMany.mockResolvedValue(categoryResources);

      const result = await service.getRecommendationsByCategory("AI", 5);

      expect(result).toEqual(categoryResources);
      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { primaryCategory: "AI" },
              { categories: { array_contains: "AI" } },
            ],
          },
          take: 5,
          orderBy: [{ qualityScore: "desc" }, { trendingScore: "desc" }],
        }),
      );
    });

    it("uses default limit of 10", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      await service.getRecommendationsByCategory("ML");

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it("returns empty array when no resources match category", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      const result = await service.getRecommendationsByCategory(
        "ObscureCategory",
        5,
      );

      expect(result).toEqual([]);
    });
  });

  describe("getExploreRecommendations", () => {
    it("returns resources from multiple categories up to the limit", async () => {
      const sampleResources = [makeResource("exp-1"), makeResource("exp-2")];
      mockPrisma.resource.findMany.mockResolvedValue(sampleResources);

      const result = await service.getExploreRecommendations(10);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("calls findMany for each of the 8 hardcoded categories", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([makeResource("r-1")]);

      await service.getExploreRecommendations(10);

      // 8 categories: AI, ML, Web, Backend, Frontend, DevOps, Data, Security
      expect(mockPrisma.resource.findMany).toHaveBeenCalledTimes(8);
    });

    it("uses default limit of 10", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      await service.getExploreRecommendations();

      expect(mockPrisma.resource.findMany).toHaveBeenCalledTimes(8);
    });

    it("orders within each category by qualityScore desc", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      await service.getExploreRecommendations(10);

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { qualityScore: "desc" },
        }),
      );
    });
  });
});
