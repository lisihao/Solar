import { Test, TestingModule } from "@nestjs/testing";
import { RecommendationsController } from "../recommendations.controller";
import { RecommendationsService } from "../recommendations.service.postgres";

// ── Mock data ─────────────────────────────────────────────────────────────────

const mockRecommendation = (id: string, title: string) => ({
  id,
  title,
  type: "PAPER",
  category: "AI",
  qualityScore: 0.9,
  relevanceScore: 0.85,
});

const mockRecommendations = [
  mockRecommendation("res-001", "Deep Learning Fundamentals"),
  mockRecommendation("res-002", "Transformer Architecture"),
  mockRecommendation("res-003", "Attention Is All You Need"),
];

// ── Test suite ────────────────────────────────────────────────────────────────

describe("RecommendationsController", () => {
  let controller: RecommendationsController;
  let recommendationsService: jest.Mocked<RecommendationsService>;

  beforeEach(async () => {
    const mockService = {
      getPersonalizedRecommendations: jest.fn(),
      getContentBasedRecommendations: jest.fn(),
      getGraphBasedRecommendations: jest.fn(),
      getHybridRecommendations: jest.fn(),
      getColdStartRecommendations: jest.fn(),
      getRecommendationsByCategory: jest.fn(),
      getExploreRecommendations: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecommendationsController],
      providers: [{ provide: RecommendationsService, useValue: mockService }],
    }).compile();

    controller = module.get<RecommendationsController>(
      RecommendationsController,
    );
    recommendationsService = module.get(RecommendationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── getPersonalized ───────────────────────────────────────────────────────────

  describe("GET /recommendations/personalized", () => {
    it("delegates to service with userId and default limit when userId provided", async () => {
      recommendationsService.getPersonalizedRecommendations.mockResolvedValue(
        mockRecommendations as never,
      );

      const result = await controller.getPersonalized("user-001", 10);

      expect(
        recommendationsService.getPersonalizedRecommendations,
      ).toHaveBeenCalledWith("user-001", 10);
      expect(result).toEqual(mockRecommendations);
    });

    it("delegates to service with undefined userId for anonymous users", async () => {
      recommendationsService.getPersonalizedRecommendations.mockResolvedValue(
        mockRecommendations as never,
      );

      await controller.getPersonalized(undefined, 10);

      expect(
        recommendationsService.getPersonalizedRecommendations,
      ).toHaveBeenCalledWith(undefined, 10);
    });

    it("passes custom limit to service", async () => {
      recommendationsService.getPersonalizedRecommendations.mockResolvedValue(
        [] as never,
      );

      await controller.getPersonalized("user-001", 5);

      expect(
        recommendationsService.getPersonalizedRecommendations,
      ).toHaveBeenCalledWith("user-001", 5);
    });

    it("returns empty array when no personalized recommendations exist", async () => {
      recommendationsService.getPersonalizedRecommendations.mockResolvedValue(
        [] as never,
      );

      const result = await controller.getPersonalized("new-user", 10);

      expect(result).toEqual([]);
    });

    it("propagates service errors", async () => {
      recommendationsService.getPersonalizedRecommendations.mockRejectedValue(
        new Error("Service error"),
      );

      await expect(controller.getPersonalized("user-001", 10)).rejects.toThrow(
        "Service error",
      );
    });
  });

  // ── getContentBased ───────────────────────────────────────────────────────────

  describe("GET /recommendations/content/:id", () => {
    it("delegates to service with resource id and default limit", async () => {
      recommendationsService.getContentBasedRecommendations.mockResolvedValue(
        mockRecommendations as never,
      );

      const result = await controller.getContentBased("res-001", 10);

      expect(
        recommendationsService.getContentBasedRecommendations,
      ).toHaveBeenCalledWith("res-001", 10);
      expect(result).toEqual(mockRecommendations);
    });

    it("passes custom limit to service", async () => {
      recommendationsService.getContentBasedRecommendations.mockResolvedValue(
        mockRecommendations.slice(0, 3) as never,
      );

      await controller.getContentBased("res-001", 3);

      expect(
        recommendationsService.getContentBasedRecommendations,
      ).toHaveBeenCalledWith("res-001", 3);
    });

    it("returns empty array when content-based recommendations are unavailable", async () => {
      recommendationsService.getContentBasedRecommendations.mockResolvedValue(
        [] as never,
      );

      const result = await controller.getContentBased("isolated-res", 10);

      expect(result).toEqual([]);
    });

    it("propagates service errors", async () => {
      recommendationsService.getContentBasedRecommendations.mockRejectedValue(
        new Error("Embedding model unavailable"),
      );

      await expect(controller.getContentBased("res-001", 10)).rejects.toThrow(
        "Embedding model unavailable",
      );
    });
  });

  // ── getGraphBased ─────────────────────────────────────────────────────────────

  describe("GET /recommendations/graph/:id", () => {
    it("delegates to service with resource id and default limit", async () => {
      recommendationsService.getGraphBasedRecommendations.mockResolvedValue(
        mockRecommendations as never,
      );

      const result = await controller.getGraphBased("res-001", 10);

      expect(
        recommendationsService.getGraphBasedRecommendations,
      ).toHaveBeenCalledWith("res-001", 10);
      expect(result).toEqual(mockRecommendations);
    });

    it("passes custom limit to service", async () => {
      recommendationsService.getGraphBasedRecommendations.mockResolvedValue(
        [] as never,
      );

      await controller.getGraphBased("res-001", 7);

      expect(
        recommendationsService.getGraphBasedRecommendations,
      ).toHaveBeenCalledWith("res-001", 7);
    });

    it("propagates service errors", async () => {
      recommendationsService.getGraphBasedRecommendations.mockRejectedValue(
        new Error("Graph DB error"),
      );

      await expect(controller.getGraphBased("res-001", 10)).rejects.toThrow(
        "Graph DB error",
      );
    });
  });

  // ── getHybrid ─────────────────────────────────────────────────────────────────

  describe("GET /recommendations/hybrid/:id", () => {
    it("delegates to service with resource id, userId, and default limit", async () => {
      recommendationsService.getHybridRecommendations.mockResolvedValue(
        mockRecommendations as never,
      );

      const result = await controller.getHybrid("res-001", "user-001", 10);

      expect(
        recommendationsService.getHybridRecommendations,
      ).toHaveBeenCalledWith("res-001", "user-001", 10);
      expect(result).toEqual(mockRecommendations);
    });

    it("delegates to service with undefined userId for anonymous access", async () => {
      recommendationsService.getHybridRecommendations.mockResolvedValue(
        mockRecommendations as never,
      );

      await controller.getHybrid("res-001", undefined, 10);

      expect(
        recommendationsService.getHybridRecommendations,
      ).toHaveBeenCalledWith("res-001", undefined, 10);
    });

    it("passes custom limit to service", async () => {
      recommendationsService.getHybridRecommendations.mockResolvedValue(
        [] as never,
      );

      await controller.getHybrid("res-001", "user-001", 15);

      expect(
        recommendationsService.getHybridRecommendations,
      ).toHaveBeenCalledWith("res-001", "user-001", 15);
    });

    it("propagates service errors", async () => {
      recommendationsService.getHybridRecommendations.mockRejectedValue(
        new Error("Hybrid algorithm failed"),
      );

      await expect(
        controller.getHybrid("res-001", "user-001", 10),
      ).rejects.toThrow("Hybrid algorithm failed");
    });
  });

  // ── getColdStart ──────────────────────────────────────────────────────────────

  describe("GET /recommendations/cold-start", () => {
    it("delegates to service with default limit", async () => {
      recommendationsService.getColdStartRecommendations.mockResolvedValue(
        mockRecommendations as never,
      );

      const result = await controller.getColdStart(10);

      expect(
        recommendationsService.getColdStartRecommendations,
      ).toHaveBeenCalledWith(10);
      expect(result).toEqual(mockRecommendations);
    });

    it("passes custom limit to service", async () => {
      recommendationsService.getColdStartRecommendations.mockResolvedValue(
        mockRecommendations.slice(0, 5) as never,
      );

      await controller.getColdStart(5);

      expect(
        recommendationsService.getColdStartRecommendations,
      ).toHaveBeenCalledWith(5);
    });

    it("returns curated list for new users", async () => {
      const curatedList = [
        mockRecommendation("popular-1", "Getting Started with AI"),
        mockRecommendation("popular-2", "Best Practices in ML"),
      ];
      recommendationsService.getColdStartRecommendations.mockResolvedValue(
        curatedList as never,
      );

      const result = await controller.getColdStart(10);

      expect(result).toEqual(curatedList);
    });

    it("propagates service errors", async () => {
      recommendationsService.getColdStartRecommendations.mockRejectedValue(
        new Error("Cold start failed"),
      );

      await expect(controller.getColdStart(10)).rejects.toThrow(
        "Cold start failed",
      );
    });
  });

  // ── getByCategory ─────────────────────────────────────────────────────────────

  describe("GET /recommendations/category/:category", () => {
    it("delegates to service with category and default limit", async () => {
      recommendationsService.getRecommendationsByCategory.mockResolvedValue(
        mockRecommendations as never,
      );

      const result = await controller.getByCategory("AI", 10);

      expect(
        recommendationsService.getRecommendationsByCategory,
      ).toHaveBeenCalledWith("AI", 10);
      expect(result).toEqual(mockRecommendations);
    });

    it("handles different category names correctly", async () => {
      recommendationsService.getRecommendationsByCategory.mockResolvedValue(
        [] as never,
      );

      await controller.getByCategory("Blockchain", 10);

      expect(
        recommendationsService.getRecommendationsByCategory,
      ).toHaveBeenCalledWith("Blockchain", 10);
    });

    it("passes custom limit to service", async () => {
      recommendationsService.getRecommendationsByCategory.mockResolvedValue(
        [] as never,
      );

      await controller.getByCategory("Engineering", 20);

      expect(
        recommendationsService.getRecommendationsByCategory,
      ).toHaveBeenCalledWith("Engineering", 20);
    });

    it("returns empty array for empty categories", async () => {
      recommendationsService.getRecommendationsByCategory.mockResolvedValue(
        [] as never,
      );

      const result = await controller.getByCategory("EmptyCategory", 10);

      expect(result).toEqual([]);
    });

    it("propagates service errors", async () => {
      recommendationsService.getRecommendationsByCategory.mockRejectedValue(
        new Error("Category not found"),
      );

      await expect(controller.getByCategory("Unknown", 10)).rejects.toThrow(
        "Category not found",
      );
    });
  });

  // ── getExplore ────────────────────────────────────────────────────────────────

  describe("GET /recommendations/explore", () => {
    it("delegates to service with default limit", async () => {
      recommendationsService.getExploreRecommendations.mockResolvedValue(
        mockRecommendations as never,
      );

      const result = await controller.getExplore(10);

      expect(
        recommendationsService.getExploreRecommendations,
      ).toHaveBeenCalledWith(10);
      expect(result).toEqual(mockRecommendations);
    });

    it("passes custom limit to service", async () => {
      recommendationsService.getExploreRecommendations.mockResolvedValue(
        mockRecommendations as never,
      );

      await controller.getExplore(25);

      expect(
        recommendationsService.getExploreRecommendations,
      ).toHaveBeenCalledWith(25);
    });

    it("returns diverse set of resources for discovery", async () => {
      const diverseList = [
        mockRecommendation("res-A", "Quantum Computing"),
        mockRecommendation("res-B", "Biomedical AI"),
        mockRecommendation("res-C", "Climate Modeling"),
      ];
      recommendationsService.getExploreRecommendations.mockResolvedValue(
        diverseList as never,
      );

      const result = await controller.getExplore(10);

      expect(result).toEqual(diverseList);
    });

    it("propagates service errors", async () => {
      recommendationsService.getExploreRecommendations.mockRejectedValue(
        new Error("Explore service unavailable"),
      );

      await expect(controller.getExplore(10)).rejects.toThrow(
        "Explore service unavailable",
      );
    });
  });
});
