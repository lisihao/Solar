/**
 * ResearchMemoryService Unit Tests
 */

// Break the ai-harness/facade import chain (transitively imports @nestjs/cache-manager)
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { ResearchMemoryService } from "../research-memory.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

// ─── Mocks ───────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchMission: {
      findUnique: jest.fn(),
    },
    researchMemory: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const mockAiFacade = {
    chat: jest.fn().mockResolvedValue({
      content: JSON.stringify({
        findings: [
          {
            entity: "AI Market",
            finding: "AI market is growing at 15% annually",
            category: "fact",
            confidence: 0.9,
            sourceDimension: "Market Analysis",
            sourceUrls: [],
            tags: ["AI", "market", "growth"],
          },
        ],
      }),
    }),
  };

  return { mockPrisma, mockAiFacade };
}

const mockMission = {
  id: "mission-1",
  tasks: [
    {
      id: "task-1",
      dimensionName: "Market Analysis",
      result: {
        summary: "AI market is growing",
        keyFindings: ["15% annual growth"],
        trends: [],
        challenges: [],
      },
      resultSummary: "Market growing",
    },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ResearchMemoryService", () => {
  let service: ResearchMemoryService;
  let prisma: ReturnType<typeof buildMocks>["mockPrisma"];
  let aiFacade: ReturnType<typeof buildMocks>["mockAiFacade"];

  beforeEach(async () => {
    const mocks = buildMocks();
    prisma = mocks.mockPrisma;
    aiFacade = mocks.mockAiFacade;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchMemoryService,
        { provide: PrismaService, useValue: mocks.mockPrisma },
        { provide: ChatFacade, useValue: mocks.mockAiFacade },
      ],
    }).compile();

    service = module.get<ResearchMemoryService>(ResearchMemoryService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── extractAndStoreFindings ────────────────────────────────────────────────

  describe("extractAndStoreFindings", () => {
    it("should return 0 when mission not found", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(null);

      const result = await service.extractAndStoreFindings(
        "nonexistent",
        "topic-1",
      );
      expect(result).toBe(0);
    });

    it("should return 0 when mission has no completed tasks", async () => {
      prisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        tasks: [],
      });

      const result = await service.extractAndStoreFindings(
        "mission-1",
        "topic-1",
      );
      expect(result).toBe(0);
    });

    it("should extract and store findings from completed tasks", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(mockMission);
      prisma.researchMemory.createMany.mockResolvedValue({ count: 1 });

      const result = await service.extractAndStoreFindings(
        "mission-1",
        "topic-1",
      );
      expect(result).toBe(1);
      expect(prisma.researchMemory.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              entity: "AI Market",
              topicId: "topic-1",
              missionId: "mission-1",
            }),
          ]),
        }),
      );
    });

    it("should return 0 when AI returns empty response", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(mockMission);
      aiFacade.chat.mockResolvedValue({ content: null });

      const result = await service.extractAndStoreFindings(
        "mission-1",
        "topic-1",
      );
      expect(result).toBe(0);
    });

    it("should return 0 when AI returns invalid JSON", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(mockMission);
      aiFacade.chat.mockResolvedValue({ content: "not valid json" });

      const result = await service.extractAndStoreFindings(
        "mission-1",
        "topic-1",
      );
      expect(result).toBe(0);
    });

    it("should return 0 when AI call fails", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(mockMission);
      aiFacade.chat.mockRejectedValue(new Error("API error"));

      const result = await service.extractAndStoreFindings(
        "mission-1",
        "topic-1",
      );
      expect(result).toBe(0);
    });

    it("should handle batch insert failure gracefully", async () => {
      prisma.researchMission.findUnique.mockResolvedValue(mockMission);
      prisma.researchMemory.createMany.mockRejectedValue(new Error("DB error"));

      const result = await service.extractAndStoreFindings(
        "mission-1",
        "topic-1",
      );
      expect(result).toBe(0);
    });
  });

  // ─── getRelevantMemories ────────────────────────────────────────────────────

  describe("getRelevantMemories", () => {
    it("should return matching memories", async () => {
      const mockMemories = [
        {
          entity: "AI Market",
          finding: "Growing market",
          category: "fact",
          confidence: 0.9,
          tags: ["AI", "market"],
          sourceDimension: "Market Analysis",
        },
      ];
      prisma.researchMemory.findMany.mockResolvedValue(mockMemories);

      const result = await service.getRelevantMemories("AI market", "topic-1");
      expect(result).toHaveLength(1);
      expect(result[0].entity).toBe("AI Market");
    });

    it("should return empty array on error", async () => {
      prisma.researchMemory.findMany.mockRejectedValue(new Error("DB error"));

      const result = await service.getRelevantMemories("AI", "topic-1");
      expect(result).toEqual([]);
    });

    it("should work without topicId filter", async () => {
      prisma.researchMemory.findMany.mockResolvedValue([]);

      const result = await service.getRelevantMemories("query");
      expect(result).toEqual([]);
      expect(prisma.researchMemory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ topicId: expect.anything() }),
        }),
      );
    });

    it("should respect limit parameter", async () => {
      prisma.researchMemory.findMany.mockResolvedValue([]);

      await service.getRelevantMemories("query", "topic-1", 5);
      expect(prisma.researchMemory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });

  // ─── getMemorySummary ───────────────────────────────────────────────────────

  describe("getMemorySummary", () => {
    it("should return default message when no memories found", async () => {
      prisma.researchMemory.findMany.mockResolvedValue([]);

      const result = await service.getMemorySummary("topic-1");
      expect(result).toContain("暂无先前研究记忆");
    });

    it("should return formatted summary grouped by category", async () => {
      prisma.researchMemory.findMany.mockResolvedValue([
        {
          entity: "AI",
          finding: "AI is transformative",
          category: "fact",
          confidence: 0.9,
        },
        {
          entity: "Market",
          finding: "Market is growing",
          category: "trend",
          confidence: 0.85,
        },
      ]);

      const result = await service.getMemorySummary("topic-1");
      expect(result).toContain("先前研究发现");
      expect(result).toContain("AI");
      expect(result).toContain("Market");
    });

    it("should return error message on DB failure", async () => {
      prisma.researchMemory.findMany.mockRejectedValue(new Error("DB error"));

      const result = await service.getMemorySummary("topic-1");
      expect(result).toContain("失败");
    });
  });

  // ─── onModuleDestroy ────────────────────────────────────────────────────────

  describe("onModuleDestroy", () => {
    it("should not throw", () => {
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });
});
