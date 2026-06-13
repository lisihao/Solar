import { Test, TestingModule } from "@nestjs/testing";
import { FeedController } from "../feed.controller";
import { FeedService } from "../feed.service";

// ── Mock data ─────────────────────────────────────────────────────────────────

const mockFeedResult = {
  items: [
    {
      id: "res-001",
      title: "Introduction to Transformers",
      type: "PAPER",
      category: "AI",
      qualityScore: 0.95,
      trendingScore: 0.8,
      publishedAt: new Date("2026-01-15"),
    },
    {
      id: "res-002",
      title: "TypeScript Best Practices",
      type: "BLOG",
      category: "Engineering",
      qualityScore: 0.88,
      trendingScore: 0.6,
      publishedAt: new Date("2026-01-20"),
    },
  ],
  total: 2,
  skip: 0,
  take: 20,
};

const mockTrendingResult = [
  { id: "res-001", title: "GPT-5 Released", trendingScore: 0.99 },
  { id: "res-002", title: "React 20 Out", trendingScore: 0.95 },
];

const mockRelatedResult = [
  { id: "res-003", title: "Related to Transformers", similarity: 0.9 },
  { id: "res-004", title: "Attention Mechanisms", similarity: 0.85 },
];

const mockSearchResult = {
  items: [{ id: "res-001", title: "Machine Learning Basics", type: "PAPER" }],
  total: 1,
  skip: 0,
  take: 20,
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe("FeedController", () => {
  let controller: FeedController;
  let feedService: jest.Mocked<FeedService>;

  beforeEach(async () => {
    const mockService = {
      getFeed: jest.fn(),
      search: jest.fn(),
      getTrending: jest.fn(),
      getRelated: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeedController],
      providers: [{ provide: FeedService, useValue: mockService }],
    }).compile();

    controller = module.get<FeedController>(FeedController);
    feedService = module.get(FeedService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── getFeed ───────────────────────────────────────────────────────────────────

  describe("GET /feed", () => {
    it("delegates to feedService.getFeed with default pagination", async () => {
      feedService.getFeed.mockResolvedValue(mockFeedResult as never);

      const result = await controller.getFeed(0, 20);

      expect(feedService.getFeed).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        type: undefined,
        category: undefined,
        minQualityScore: undefined,
        sortBy: undefined,
      });
      expect(result).toEqual(mockFeedResult);
    });

    it("passes all filter options to feedService", async () => {
      feedService.getFeed.mockResolvedValue(mockFeedResult as never);

      const result = await controller.getFeed(
        10,
        30,
        "PAPER",
        "AI",
        0.8,
        "trendingScore",
      );

      expect(feedService.getFeed).toHaveBeenCalledWith({
        skip: 10,
        take: 30,
        type: "PAPER",
        category: "AI",
        minQualityScore: 0.8,
        sortBy: "trendingScore",
      });
      expect(result).toEqual(mockFeedResult);
    });

    it("supports sortBy=publishedAt", async () => {
      feedService.getFeed.mockResolvedValue(mockFeedResult as never);

      await controller.getFeed(
        0,
        20,
        undefined,
        undefined,
        undefined,
        "publishedAt",
      );

      expect(feedService.getFeed).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: "publishedAt" }),
      );
    });

    it("supports sortBy=qualityScore", async () => {
      feedService.getFeed.mockResolvedValue(mockFeedResult as never);

      await controller.getFeed(
        0,
        20,
        undefined,
        undefined,
        undefined,
        "qualityScore",
      );

      expect(feedService.getFeed).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: "qualityScore" }),
      );
    });

    it("propagates service errors", async () => {
      feedService.getFeed.mockRejectedValue(new Error("Database unavailable"));

      await expect(controller.getFeed(0, 20)).rejects.toThrow(
        "Database unavailable",
      );
    });

    it("passes BLOG type filter correctly", async () => {
      feedService.getFeed.mockResolvedValue({ items: [], total: 0 } as never);

      await controller.getFeed(0, 20, "BLOG");

      expect(feedService.getFeed).toHaveBeenCalledWith(
        expect.objectContaining({ type: "BLOG" }),
      );
    });
  });

  // ── search ────────────────────────────────────────────────────────────────────

  describe("GET /feed/search", () => {
    it("delegates to feedService.search with query and default pagination", async () => {
      feedService.search.mockResolvedValue(mockSearchResult as never);

      const result = await controller.search("machine learning", 0, 20);

      expect(feedService.search).toHaveBeenCalledWith({
        query: "machine learning",
        skip: 0,
        take: 20,
        type: undefined,
        category: undefined,
      });
      expect(result).toEqual(mockSearchResult);
    });

    it("passes type and category filters to feedService.search", async () => {
      feedService.search.mockResolvedValue(mockSearchResult as never);

      await controller.search("transformers", 20, 10, "PAPER", "AI");

      expect(feedService.search).toHaveBeenCalledWith({
        query: "transformers",
        skip: 20,
        take: 10,
        type: "PAPER",
        category: "AI",
      });
    });

    it("handles empty search results gracefully", async () => {
      feedService.search.mockResolvedValue({ items: [], total: 0 } as never);

      const result = await controller.search("nonexistent-query-xyz", 0, 20);

      expect(result).toEqual({ items: [], total: 0 });
    });

    it("propagates service errors during search", async () => {
      feedService.search.mockRejectedValue(new Error("Search index error"));

      await expect(controller.search("AI", 0, 20)).rejects.toThrow(
        "Search index error",
      );
    });
  });

  // ── getTrending ───────────────────────────────────────────────────────────────

  describe("GET /feed/trending", () => {
    it("delegates to feedService.getTrending with default take=10", async () => {
      feedService.getTrending.mockResolvedValue(mockTrendingResult as never);

      const result = await controller.getTrending(10);

      expect(feedService.getTrending).toHaveBeenCalledWith(10);
      expect(result).toEqual(mockTrendingResult);
    });

    it("passes custom take value to feedService.getTrending", async () => {
      feedService.getTrending.mockResolvedValue(mockTrendingResult as never);

      await controller.getTrending(5);

      expect(feedService.getTrending).toHaveBeenCalledWith(5);
    });

    it("returns empty array when no trending resources exist", async () => {
      feedService.getTrending.mockResolvedValue([] as never);

      const result = await controller.getTrending(10);

      expect(result).toEqual([]);
    });

    it("propagates service errors", async () => {
      feedService.getTrending.mockRejectedValue(new Error("Cache miss"));

      await expect(controller.getTrending(10)).rejects.toThrow("Cache miss");
    });
  });

  // ── getRelated ────────────────────────────────────────────────────────────────

  describe("GET /feed/related/:id", () => {
    it("delegates to feedService.getRelated with id and default take=5", async () => {
      feedService.getRelated.mockResolvedValue(mockRelatedResult as never);

      const result = await controller.getRelated("res-001", 5);

      expect(feedService.getRelated).toHaveBeenCalledWith("res-001", 5);
      expect(result).toEqual(mockRelatedResult);
    });

    it("passes custom take value to feedService.getRelated", async () => {
      feedService.getRelated.mockResolvedValue(mockRelatedResult as never);

      await controller.getRelated("res-001", 3);

      expect(feedService.getRelated).toHaveBeenCalledWith("res-001", 3);
    });

    it("returns empty array when no related resources found", async () => {
      feedService.getRelated.mockResolvedValue([] as never);

      const result = await controller.getRelated("unknown-res", 5);

      expect(result).toEqual([]);
    });

    it("propagates service errors when resource does not exist", async () => {
      feedService.getRelated.mockRejectedValue(new Error("Resource not found"));

      await expect(controller.getRelated("missing-id", 5)).rejects.toThrow(
        "Resource not found",
      );
    });
  });
});
