/**
 * LeaderToolService - Supplemental 2 Tests
 *
 * Covers uncovered branches:
 * - deleteDimension: inFlightMissionCount > 0 → skip deletion (lines 279-288)
 * - leaderAgenticSearch: tool execution unavailable → fallback (lines 661-672)
 * - leaderAgenticSearch: chatWithTools success path (lines 682-702)
 * - leaderAgenticSearch: catch block (lines 703-705)
 * - deduplicateResults: duplicate URL returns false (line 1045)
 * - deduplicateResults: item without URL returns true (line 1042)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { LeaderToolService, LeaderActionType } from "../leader-tool.service";
import { ChatFacade, ToolFacade } from "@/modules/ai-harness/facade";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { PrismaService } from "@/common/prisma/prisma.service";

const mockChatFacade = {
  chat: jest.fn(),
};

const mockToolFacade = {
  isToolExecutionAvailable: jest.fn(),
  chatWithTools: jest.fn(),
  capabilityResolveTools: jest.fn(),
};

const mockToolRegistry = {
  tryGet: jest.fn(),
};

const mockPrisma = {
  topicDimension: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    aggregate: jest.fn(),
  },
  researchTask: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  researchMission: {
    count: jest.fn(),
  },
};

describe("LeaderToolService (supplemental 2)", () => {
  let service: LeaderToolService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderToolService,
        { provide: ChatFacade, useValue: mockChatFacade },
        { provide: ToolFacade, useValue: mockToolFacade },
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LeaderToolService>(LeaderToolService);
  });

  // ============================================================
  // deleteDimension – in-flight missions prevent deletion (lines 279-288)
  // ============================================================

  describe("deleteDimension – in-flight missions prevent deletion", () => {
    it("should return success=false when in-flight missions reference the dimension", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue({
        id: "dim-locked",
        name: "Locked Dimension",
      });
      // in-flight missions count > 0
      mockPrisma.researchMission.count.mockResolvedValue(2);

      const result = await service.deleteDimension({
        topicId: "t1",
        dimensionName: "Locked Dimension",
      });

      expect(result.success).toBe(false);
      expect(result.action).toBe(LeaderActionType.DELETE_DIMENSION);
      expect(result.message).toContain("2");
      expect(result.message).toContain("正在执行的任务");
      // Should NOT proceed to delete
      expect(mockPrisma.topicDimension.delete).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // leaderAgenticSearch – tool execution unavailable (lines 661-672)
  // ============================================================

  describe("leaderAgenticSearch – tool execution unavailable", () => {
    it("should fall back to searchLatestData when isToolExecutionAvailable returns false", async () => {
      mockToolFacade.isToolExecutionAvailable.mockReturnValue(false);

      // searchLatestData will call web-search tool → return empty
      mockToolRegistry.tryGet.mockReturnValue(null);
      mockChatFacade.chat.mockResolvedValue({
        content: "AI market 2024\nAI trends 2024",
      });

      const result = await service.leaderAgenticSearch({
        topicName: "AI",
        topicType: "technology",
        researchQuestion: "What are the latest AI trends?",
      });

      expect(result).toBeDefined();
      expect(result.toolsUsed).toEqual([]);
      expect(result.tokensUsed).toBe(0);
      // Content comes from searchLatestData fallback (empty → "")
      expect(typeof result.content).toBe("string");
    });
  });

  // ============================================================
  // leaderAgenticSearch – success path (lines 682-702)
  // ============================================================

  describe("leaderAgenticSearch – success path with chatWithTools", () => {
    it("should return content and toolsUsed from chatWithTools result", async () => {
      mockToolFacade.isToolExecutionAvailable.mockReturnValue(true);
      mockToolFacade.chatWithTools.mockResolvedValue({
        content: "AI market is growing at 25% CAGR.",
        toolCalls: [{ toolId: "web-search" }, { toolId: "academic-search" }],
        tokensUsed: 500,
      });

      const result = await service.leaderAgenticSearch({
        topicName: "AI Market",
        topicType: "market",
        researchQuestion: "What is the AI market size?",
        maxToolCalls: 3,
      });

      expect(result.content).toBe("AI market is growing at 25% CAGR.");
      expect(result.toolsUsed).toEqual(["web-search", "academic-search"]);
      expect(result.tokensUsed).toBe(500);
    });

    it("should return empty content when chatWithTools returns no content", async () => {
      mockToolFacade.isToolExecutionAvailable.mockReturnValue(true);
      mockToolFacade.chatWithTools.mockResolvedValue({
        content: null,
        toolCalls: null,
        tokensUsed: null,
      });

      const result = await service.leaderAgenticSearch({
        topicName: "AI",
        topicType: "technology",
        researchQuestion: "AI overview",
      });

      expect(result.content).toBe("");
      expect(result.toolsUsed).toEqual([]);
      expect(result.tokensUsed).toBe(0);
    });
  });

  // ============================================================
  // leaderAgenticSearch – catch block (lines 703-705)
  // ============================================================

  describe("leaderAgenticSearch – error handling", () => {
    it("should return empty result when chatWithTools throws", async () => {
      mockToolFacade.isToolExecutionAvailable.mockReturnValue(true);
      mockToolFacade.chatWithTools.mockRejectedValue(
        new Error("Tool execution failed"),
      );

      const result = await service.leaderAgenticSearch({
        topicName: "AI",
        topicType: "technology",
        researchQuestion: "AI market",
      });

      expect(result.content).toBe("");
      expect(result.toolsUsed).toEqual([]);
      expect(result.tokensUsed).toBe(0);
    });
  });

  // ============================================================
  // deduplicateResults – duplicate URL returns false (line 1045)
  // ============================================================

  describe("deduplicateResults – direct invocation via reflection", () => {
    it("should remove duplicate URLs and keep items without URL", () => {
      const deduplicateResults = (service as any).deduplicateResults.bind(
        service,
      ) as (
        results: Array<{ url?: string; title?: string }>,
      ) => Array<{ url?: string; title?: string }>;

      const items = [
        { url: "http://example.com/article", title: "First" },
        { url: "http://example.com/article", title: "Duplicate" }, // same URL → removed
        { url: "http://other.com/page", title: "Other" },
        { url: "", title: "No URL" }, // empty URL → kept (return true branch)
        { url: undefined as unknown as string, title: "Undefined URL" }, // no url → kept
      ];

      const result = deduplicateResults(items);

      // Duplicate URL removed
      expect(
        result.filter((r) => r.url === "http://example.com/article"),
      ).toHaveLength(1);
      // Other URL kept
      expect(
        result.filter((r) => r.url === "http://other.com/page"),
      ).toHaveLength(1);
      // No-URL item kept
      expect(result.filter((r) => !r.url)).toHaveLength(2);
      // Total: 4 items (1 duplicate removed)
      expect(result).toHaveLength(4);
    });
  });
});
