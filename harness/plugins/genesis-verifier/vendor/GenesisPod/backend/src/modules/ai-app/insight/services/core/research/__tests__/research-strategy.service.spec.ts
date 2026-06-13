/**
 * ResearchStrategyService Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ResearchStrategyService } from "../research-strategy.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { DimensionStatus } from "@prisma/client";
import {
  ResearchStrategyType,
  DimensionFreshnessLevel,
} from "../../../../types/strategy.types";

// ─── Mocks ───────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchTopic: {
      findUnique: jest.fn(),
    },
  };

  return { mockPrisma };
}

const mockDimension = {
  id: "dim-1",
  name: "Market Analysis",
  status: DimensionStatus.COMPLETED,
  lastResearchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago (FRESH)
  isEnabled: true,
  sortOrder: 1,
};

const mockTopicWithFreshDimensions = {
  id: "topic-1",
  name: "AI Research",
  totalReports: 2,
  lastRefreshAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  dimensions: [mockDimension],
  reports: [{ id: "report-1", generatedAt: new Date() }],
};

const mockTopicNeverResearched = {
  id: "topic-2",
  name: "Brand New Topic",
  totalReports: 0,
  lastRefreshAt: null,
  dimensions: [
    {
      ...mockDimension,
      lastResearchedAt: null,
      status: DimensionStatus.PENDING,
    },
  ],
  reports: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ResearchStrategyService", () => {
  let service: ResearchStrategyService;
  let prisma: ReturnType<typeof buildMocks>["mockPrisma"];

  beforeEach(async () => {
    const mocks = buildMocks();
    prisma = mocks.mockPrisma;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchStrategyService,
        { provide: PrismaService, useValue: mocks.mockPrisma },
      ],
    }).compile();

    service = module.get<ResearchStrategyService>(ResearchStrategyService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── analyzeAndRecommend ────────────────────────────────────────────────────

  describe("analyzeAndRecommend", () => {
    it("should throw error when topic not found", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(service.analyzeAndRecommend("nonexistent")).rejects.toThrow(
        "Topic not found",
      );
    });

    it("should recommend NEW strategy for topic never researched", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(
        mockTopicNeverResearched,
      );

      const result = await service.analyzeAndRecommend("topic-2");
      expect(result.strategy).toBe(ResearchStrategyType.NEW);
      expect(result.requiresConfirmation).toBe(false);
    });

    it("should recommend UP_TO_DATE when all dimensions are fresh", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(
        mockTopicWithFreshDimensions,
      );

      const result = await service.analyzeAndRecommend("topic-1");
      expect(result.strategy).toBe(ResearchStrategyType.UP_TO_DATE);
      expect(result.stats.freshDimensions).toBe(1);
    });

    it("should recommend INCREMENTAL when some dimensions are stale", async () => {
      const staleDimension = {
        ...mockDimension,
        id: "dim-stale",
        lastResearchedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
        status: DimensionStatus.COMPLETED,
      };
      const freshDimension = {
        ...mockDimension,
        id: "dim-fresh",
        lastResearchedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
      };

      prisma.researchTopic.findUnique.mockResolvedValue({
        ...mockTopicWithFreshDimensions,
        totalReports: 2,
        dimensions: [
          staleDimension,
          freshDimension,
          freshDimension,
          freshDimension,
          freshDimension,
        ],
      });

      const result = await service.analyzeAndRecommend("topic-1");
      // 1 stale out of 5 total = 20%, below 70% threshold -> INCREMENTAL
      expect(result.strategy).toBe(ResearchStrategyType.INCREMENTAL);
    });

    it("should recommend FULL_REFRESH when most dimensions need update", async () => {
      const staleDimensions = Array(4).fill({
        ...mockDimension,
        lastResearchedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days
        status: DimensionStatus.COMPLETED,
      });

      prisma.researchTopic.findUnique.mockResolvedValue({
        ...mockTopicWithFreshDimensions,
        dimensions: staleDimensions,
      });

      const result = await service.analyzeAndRecommend("topic-1");
      expect(result.strategy).toBe(ResearchStrategyType.FULL_REFRESH);
    });

    it("should include dimension freshness info in response", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(
        mockTopicWithFreshDimensions,
      );

      const result = await service.analyzeAndRecommend("topic-1");
      expect(result.dimensions).toHaveLength(1);
      expect(result.dimensions[0].dimensionName).toBe("Market Analysis");
      expect(result.dimensions[0].freshnessLevel).toBe(
        DimensionFreshnessLevel.FRESH,
      );
    });

    it("should include estimated scope in response", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(
        mockTopicNeverResearched,
      );

      const result = await service.analyzeAndRecommend("topic-2");
      expect(result.estimatedScope).toBeDefined();
      expect(result.estimatedScope.isFullResearch).toBe(true);
    });
  });

  // ─── quickCheck ─────────────────────────────────────────────────────────────

  describe("quickCheck", () => {
    it("should return needsResearch=false for up-to-date topic", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(
        mockTopicWithFreshDimensions,
      );

      const result = await service.quickCheck("topic-1");
      expect(result.needsResearch).toBe(false);
      expect(result.suggestedButtonText).toBe("研究已是最新");
    });

    it("should return needsResearch=true and isNewResearch=true for new topic", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(
        mockTopicNeverResearched,
      );

      const result = await service.quickCheck("topic-2");
      expect(result.needsResearch).toBe(true);
      expect(result.isNewResearch).toBe(true);
      expect(result.suggestedButtonText).toBe("开始研究");
    });

    it("should include dimensionsNeedingUpdate count", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(
        mockTopicNeverResearched,
      );

      const result = await service.quickCheck("topic-2");
      expect(result.dimensionsNeedingUpdate).toBe(1);
    });
  });

  // ─── getSmartRefreshOptions ─────────────────────────────────────────────────

  describe("getSmartRefreshOptions", () => {
    it("should return forceRefresh=true for NEW strategy", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(
        mockTopicNeverResearched,
      );

      const result = await service.getSmartRefreshOptions("topic-2");
      expect(result.forceRefresh).toBe(true);
      expect(result.incremental).toBe(false);
      expect(result.strategy).toBe(ResearchStrategyType.NEW);
    });

    it("should return incremental=true for INCREMENTAL strategy", async () => {
      const staleDimension = {
        ...mockDimension,
        id: "dim-stale",
        lastResearchedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        status: DimensionStatus.COMPLETED,
      };
      const freshDimensions = Array(4).fill({
        ...mockDimension,
        lastResearchedAt: new Date(),
      });

      prisma.researchTopic.findUnique.mockResolvedValue({
        ...mockTopicWithFreshDimensions,
        dimensions: [staleDimension, ...freshDimensions],
      });

      const result = await service.getSmartRefreshOptions("topic-1");
      expect(result.incremental).toBe(true);
      expect(result.strategy).toBe(ResearchStrategyType.INCREMENTAL);
    });

    it("should return no-op for UP_TO_DATE strategy", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(
        mockTopicWithFreshDimensions,
      );

      const result = await service.getSmartRefreshOptions("topic-1");
      expect(result.strategy).toBe(ResearchStrategyType.UP_TO_DATE);
      expect(result.forceRefresh).toBe(false);
    });
  });
});
