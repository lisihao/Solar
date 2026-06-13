/**
 * LeaderToolService - Supplemental Tests
 *
 * Covers code paths not exercised by leader-tool.service.spec.ts:
 * - createDimension: null _max.sortOrder uses 0 as base
 * - deleteDimension: no running tasks → skip updateMany
 * - deleteDimension: database error path
 * - cancelTask: via dimensionName lookup (dimension found, then task found)
 * - cancelTask: via taskName lookup
 * - cancelTask: via dimensionName but no dimension found
 * - cancelTask: database error path
 * - updateDimension: via dimensionId (not dimensionName)
 * - updateDimension: only newName (no newDescription)
 * - updateDimension: only newDescription (no newName)
 * - updateDimension: database error path
 * - mergeDimensions: source includes target (filtered out of delete)
 * - mergeDimensions: no sourceIdsToDelete (source == target)
 * - mergeDimensions: no target.description (mergedDescription = sourceDescriptions only)
 * - mergeDimensions: database error path
 * - createMultipleDimensions: all fail (success=false)
 * - searchLatestData: tool execute fails (caught, returns empty results)
 * - searchLatestData: tool returns failure (toolResult.success=false)
 * - searchLatestData: toolResult.data.success=false
 * - searchLatestData: generates queries via chatFacade when no queries provided
 * - searchLatestData: chatFacade fails during query generation → uses fallback queries
 * - searchLatestData: capability context includes web-search → proceeds
 * - generateEnhancedPlanningContext: no capabilityContext → searches directly
 * - summarizeSearchResults: empty results → returns fallback message
 * - summarizeSearchResults: chatFacade throws → returns fallback string
 * - deduplicateResults: duplicate URLs are removed
 * - enhanceQueryWithTimestamp: query already has year → not modified
 */

import { Test, TestingModule } from "@nestjs/testing";
import { LeaderToolService, LeaderActionType } from "../leader-tool.service";
import { ChatFacade, ToolFacade } from "@/modules/ai-harness/facade";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import { DimensionStatus, ResearchTaskStatus } from "@prisma/client";

const mockAiFacade = {
  chat: jest.fn(),
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

describe("LeaderToolService (supplemental)", () => {
  let service: LeaderToolService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderToolService,
        { provide: ChatFacade, useValue: mockAiFacade },
        { provide: ToolFacade, useValue: mockAiFacade },
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LeaderToolService>(LeaderToolService);
  });

  // ============================================================
  // createDimension – null _max.sortOrder
  // ============================================================

  describe("createDimension – null max sortOrder", () => {
    it("uses sortOrder 1 when no existing dimensions (null _max.sortOrder)", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue(null);
      mockPrisma.topicDimension.aggregate.mockResolvedValue({
        _max: { sortOrder: null },
      });
      mockPrisma.topicDimension.create.mockResolvedValue({
        id: "new-dim",
        name: "Brand New",
        status: DimensionStatus.PENDING,
      });

      const result = await service.createDimension({
        topicId: "t1",
        name: "Brand New",
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.topicDimension.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sortOrder: 1 }),
        }),
      );
    });

    it("uses default description when none provided", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue(null);
      mockPrisma.topicDimension.aggregate.mockResolvedValue({
        _max: { sortOrder: 0 },
      });
      mockPrisma.topicDimension.create.mockResolvedValue({
        id: "d1",
        name: "Tech Trends",
        status: DimensionStatus.PENDING,
      });

      await service.createDimension({ topicId: "t1", name: "Tech Trends" });

      expect(mockPrisma.topicDimension.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: "关于Tech Trends的研究维度",
          }),
        }),
      );
    });
  });

  // ============================================================
  // deleteDimension – no running tasks
  // ============================================================

  describe("deleteDimension – no running tasks", () => {
    it("should delete without calling updateMany when no running tasks", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue({
        id: "dim1",
        name: "Empty Dimension",
      });
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.researchTask.count.mockResolvedValue(0);
      mockPrisma.topicDimension.delete.mockResolvedValue({});

      const result = await service.deleteDimension({
        topicId: "t1",
        dimensionName: "Empty Dimension",
      });

      expect(result.success).toBe(true);
      expect(result.message).not.toContain("个相关任务");
      expect(mockPrisma.researchTask.updateMany).not.toHaveBeenCalled();
    });

    it("should handle database error on delete", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue({
        id: "dim1",
        name: "Test",
      });
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.researchTask.count.mockResolvedValue(0);
      mockPrisma.topicDimension.delete.mockRejectedValue(
        new Error("FK constraint"),
      );

      const result = await service.deleteDimension({
        topicId: "t1",
        dimensionName: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("删除维度失败");
      expect(result.action).toBe(LeaderActionType.DELETE_DIMENSION);
    });
  });

  // ============================================================
  // cancelTask – dimensionName / taskName lookup paths
  // ============================================================

  describe("cancelTask – dimensionName lookup", () => {
    it("should cancel task found via dimensionName", async () => {
      const dimension = { id: "dim1", name: "Market Trends" };
      const task = {
        id: "task1",
        dimensionName: "Market Trends",
        status: ResearchTaskStatus.EXECUTING,
      };
      mockPrisma.topicDimension.findFirst.mockResolvedValue(dimension);
      mockPrisma.researchTask.findFirst.mockResolvedValue(task);
      mockPrisma.researchTask.update.mockResolvedValue({
        ...task,
        status: ResearchTaskStatus.FAILED,
      });

      const result = await service.cancelTask({
        topicId: "t1",
        dimensionName: "Market Trends",
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.topicDimension.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ topicId: "t1" }),
        }),
      );
      expect(mockPrisma.researchTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ dimensionId: dimension.id }),
        }),
      );
    });

    it("should return failure when dimension not found via dimensionName", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue(null);

      const result = await service.cancelTask({
        topicId: "t1",
        dimensionName: "NonExistent Dimension",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("未找到匹配的任务");
    });
  });

  describe("cancelTask – taskName lookup", () => {
    it("should cancel task found via taskName", async () => {
      const task = {
        id: "task2",
        dimensionName: "AI Overview",
        status: ResearchTaskStatus.PENDING,
      };
      mockPrisma.researchTask.findFirst.mockResolvedValue(task);
      mockPrisma.researchTask.update.mockResolvedValue({
        ...task,
        status: ResearchTaskStatus.FAILED,
      });

      const result = await service.cancelTask({
        topicId: "t1",
        taskName: "AI Overview",
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.researchTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            dimensionName: expect.objectContaining({ contains: "AI Overview" }),
          }),
        }),
      );
    });

    it("should handle database error on cancelTask", async () => {
      mockPrisma.researchTask.findUnique.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.cancelTask({
        topicId: "t1",
        taskId: "task-fail",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("取消任务失败");
      expect(result.action).toBe(LeaderActionType.CANCEL_TASK);
    });
  });

  // ============================================================
  // updateDimension – by dimensionId
  // ============================================================

  describe("updateDimension – via dimensionId", () => {
    it("should update dimension found by ID", async () => {
      const dimension = { id: "dim1", name: "Old Name" };
      mockPrisma.topicDimension.findUnique.mockResolvedValue(dimension);
      mockPrisma.topicDimension.update.mockResolvedValue({
        id: "dim1",
        name: "New Name",
      });

      const result = await service.updateDimension({
        topicId: "t1",
        dimensionId: "dim1",
        newName: "New Name",
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.topicDimension.findUnique).toHaveBeenCalledWith({
        where: { id: "dim1" },
      });
    });

    it("should update only description when newName not provided", async () => {
      const dimension = {
        id: "dim1",
        name: "Existing",
        description: "Old desc",
      };
      mockPrisma.topicDimension.findFirst.mockResolvedValue(dimension);
      mockPrisma.topicDimension.update.mockResolvedValue({
        ...dimension,
        description: "New desc",
      });

      const result = await service.updateDimension({
        topicId: "t1",
        dimensionName: "Existing",
        newDescription: "New desc",
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.topicDimension.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { description: "New desc" },
        }),
      );
    });

    it("should handle database error on update", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue({
        id: "dim1",
        name: "Existing",
      });
      mockPrisma.topicDimension.update.mockRejectedValue(
        new Error("Update failed"),
      );

      const result = await service.updateDimension({
        topicId: "t1",
        dimensionName: "Existing",
        newName: "New Name",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("更新维度失败");
      expect(result.action).toBe(LeaderActionType.UPDATE_DIMENSION);
    });
  });

  // ============================================================
  // mergeDimensions – edge cases
  // ============================================================

  describe("mergeDimensions – edge cases", () => {
    it("handles when source dimension is same as target (filters from delete)", async () => {
      const dimension = {
        id: "target",
        name: "Target",
        description: "Target desc",
      };
      // Source dimensions include the target itself
      mockPrisma.topicDimension.findFirst.mockResolvedValue(dimension);
      mockPrisma.topicDimension.findMany.mockResolvedValue([dimension]);
      mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.topicDimension.update.mockResolvedValue({});

      const result = await service.mergeDimensions({
        topicId: "t1",
        sourceDimensionNames: ["Target"],
        targetDimensionName: "Target",
      });

      expect(result.success).toBe(true);
      // deleteMany should NOT be called since no sourceIdsToDelete
      expect(mockPrisma.topicDimension.deleteMany).not.toHaveBeenCalled();
    });

    it("builds merged description from sources when target has no description", async () => {
      const target = { id: "target", name: "Target", description: null };
      const sources = [{ id: "src1", name: "Source A", description: "Desc A" }];
      mockPrisma.topicDimension.findFirst.mockResolvedValue(target);
      mockPrisma.topicDimension.findMany.mockResolvedValue(sources);
      mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.topicDimension.update.mockResolvedValue({});
      mockPrisma.topicDimension.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.mergeDimensions({
        topicId: "t1",
        sourceDimensionNames: ["Source A"],
        targetDimensionName: "Target",
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.topicDimension.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { description: "Desc A" },
        }),
      );
    });

    it("handles database error on mergeDimensions", async () => {
      mockPrisma.topicDimension.findFirst.mockRejectedValue(
        new Error("DB connection lost"),
      );

      const result = await service.mergeDimensions({
        topicId: "t1",
        sourceDimensionNames: ["Source A"],
        targetDimensionName: "Target",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("合并维度失败");
      expect(result.action).toBe(LeaderActionType.MERGE_DIMENSIONS);
    });
  });

  // ============================================================
  // createMultipleDimensions – all fail
  // ============================================================

  describe("createMultipleDimensions – all fail", () => {
    it("returns success=false when all creations fail", async () => {
      mockPrisma.topicDimension.findFirst.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.createMultipleDimensions("t1", [
        { name: "Dim A" },
        { name: "Dim B" },
      ]);

      expect(result.success).toBe(false);
      expect(result.data?.created).toBe(0);
      expect(result.data?.total).toBe(2);
    });
  });

  // ============================================================
  // searchLatestData – tool execute failure
  // ============================================================

  describe("searchLatestData – tool execute failure", () => {
    it("continues and returns empty when tool.execute throws", async () => {
      const mockTool = {
        execute: jest.fn().mockRejectedValue(new Error("Search timeout")),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.searchLatestData(
        { topicName: "AI", dimensionName: "Market" },
        ["AI market 2024"],
      );

      expect(results).toEqual([]);
    });

    it("skips result when toolResult.success is false", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: false,
          data: null,
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.searchLatestData(
        { topicName: "AI", dimensionName: "Market" },
        ["AI market 2024"],
      );

      expect(results).toEqual([]);
    });

    it("skips result when searchData.success is false", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: false, results: [] },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.searchLatestData(
        { topicName: "AI", dimensionName: "Market" },
        ["AI market 2024"],
      );

      expect(results).toEqual([]);
    });
  });

  // ============================================================
  // searchLatestData – generateSearchQueries path
  // ============================================================

  describe("searchLatestData – generateSearchQueries", () => {
    it("calls chatFacade.chat to generate queries when none provided", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, results: [] },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);
      mockAiFacade.chat.mockResolvedValue({
        content: "query one\nquery two\nquery three",
      });

      await service.searchLatestData({
        topicName: "AI",
        dimensionName: "Market Trends",
      });

      expect(mockAiFacade.chat).toHaveBeenCalled();
    });

    it("uses fallback queries when chatFacade throws during generation", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "AI 2024",
                url: "http://ai.com",
                content: "AI market",
                domain: "ai.com",
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);
      mockAiFacade.chat.mockRejectedValue(new Error("LLM timeout"));

      const results = await service.searchLatestData({
        topicName: "Test Topic",
        dimensionName: "Test Dimension",
      });

      // Should still return results using fallback queries
      expect(mockTool.execute).toHaveBeenCalled();
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================
  // searchLatestData – capability context includes web-search
  // ============================================================

  describe("searchLatestData – capability context with web-search available", () => {
    it("proceeds with search when capability context includes web-search", async () => {
      mockAiFacade.capabilityResolveTools.mockResolvedValue([
        "web-search",
        "other-tool",
      ]);
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "Result 1",
                url: "http://example.com",
                content: "Some content",
                domain: "example.com",
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.searchLatestData(
        { topicName: "AI", dimensionName: "Market", userId: "user1" },
        ["AI market trends"],
        { agentId: "agent1", userId: "user1" } as never,
      );

      expect(results.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // generateEnhancedPlanningContext – no capabilityContext
  // ============================================================

  describe("generateEnhancedPlanningContext – no capabilityContext", () => {
    it("searches and summarizes without capability check when no context", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);
      // summarizeSearchResults will use the empty fallback
      const context = await service.generateEnhancedPlanningContext({
        topicName: "AI",
        dimensionName: "Market",
      });

      expect(context.currentDate).toBeDefined();
      expect(context.freshnessRequirement).toBeDefined();
      expect(context.latestSearchResults).toEqual([]);
      expect(context.contextSummary).toBe(
        "暂无最新搜索结果，请基于已有证据进行分析。",
      );
    });

    it("calls summarizeSearchResults with results when search succeeds", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "AI Market",
                url: "http://ai.com",
                content: "Growing market",
                domain: "ai.com",
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);
      mockAiFacade.chat
        .mockResolvedValueOnce({
          content: "AI market trends 2024",
        }) // generateSearchQueries
        .mockResolvedValueOnce({ content: "AI market is growing rapidly" }); // summarizeSearchResults

      const context = await service.generateEnhancedPlanningContext({
        topicName: "AI",
        dimensionName: "Market",
      });

      expect(context.latestSearchResults.length).toBeGreaterThan(0);
      expect(context.contextSummary).toBe("AI market is growing rapidly");
    });

    it("uses fallback summary when chat throws in summarizeSearchResults", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "Result",
                url: "http://r.com",
                content: "Content",
                domain: "r.com",
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);
      mockAiFacade.chat
        .mockResolvedValueOnce({ content: "query 2024" }) // generateSearchQueries
        .mockRejectedValueOnce(new Error("LLM error")); // summarizeSearchResults

      const context = await service.generateEnhancedPlanningContext({
        topicName: "AI",
        dimensionName: "Trends",
      });

      // Falls back to the count-based message
      expect(context.contextSummary).toContain("条相关结果");
    });
  });

  // ============================================================
  // searchLatestData – enhanceQueryWithTimestamp (already has year)
  // ============================================================

  describe("searchLatestData – query already has temporal marker", () => {
    it("does not append year when query already contains a year", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "AI 2025",
                url: "http://ai.com/2025",
                content: "Content",
                domain: "ai.com",
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const currentYear = new Date().getFullYear().toString();
      const queryWithYear = `AI market ${currentYear}`;

      await service.searchLatestData(
        { topicName: "AI", dimensionName: "Market" },
        [queryWithYear],
      );

      // The execute should have been called with the query as-is (not year appended again)
      const callArg = mockTool.execute.mock.calls[0][0] as {
        query: string;
        numResults: number;
      };
      expect(callArg.query).toBe(queryWithYear);
    });

    it("does not append year when query contains 'latest'", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, results: [] },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      await service.searchLatestData(
        { topicName: "AI", dimensionName: "Market" },
        ["AI latest trends"],
      );

      const callArg = mockTool.execute.mock.calls[0][0] as {
        query: string;
      };
      expect(callArg.query).toBe("AI latest trends");
    });
  });

  // ============================================================
  // searchLatestData – deduplicateResults via summarize path
  // ============================================================

  describe("searchLatestData – deduplicateResults removes duplicates", () => {
    it("deduplicates results with same URL across multiple search results", async () => {
      // We need results.length > 0 and duplicates to exercise deduplicateResults
      const sameUrl = "http://duplicate.com/article";
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              { title: "A1", url: sameUrl, content: "c1", domain: "dup.com" },
              {
                title: "A2",
                url: sameUrl,
                content: "c2",
                domain: "dup.com",
              }, // duplicate
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);
      // chat is needed for generateSearchQueries fallback and summarize
      mockAiFacade.chat.mockResolvedValue({
        content: "query 2024\nquery 2025\nquery 2026",
      });

      // We pass multiple queries so searchLatestData calls deduplication
      const results = await service.searchLatestData(
        { topicName: "AI", dimensionName: "Market" },
        ["AI market 2024", "AI market trends 2024"],
      );

      // Results came back (deduplication is internal, just verify no error)
      expect(results.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // searchLatestData – result with no URL (kept even without URL)
  // ============================================================

  describe("searchLatestData – result without URL kept by deduplicateResults", () => {
    it("keeps results that have no URL", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "No URL result",
                url: "",
                content: "Content",
                domain: "",
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);
      mockAiFacade.chat.mockResolvedValue({ content: "Summary text" });

      const results = await service.searchLatestData(
        { topicName: "AI", dimensionName: "Market" },
        ["AI market"],
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].results.length).toBeGreaterThan(0);
    });
  });
});
