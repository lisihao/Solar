import { Test, TestingModule } from "@nestjs/testing";
import { LeaderToolService } from "../leader-tool.service";
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

describe("LeaderToolService", () => {
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
  // createDimension
  // ============================================================

  describe("createDimension", () => {
    it("should create a new dimension successfully", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue(null);
      mockPrisma.topicDimension.aggregate.mockResolvedValue({
        _max: { sortOrder: 3 },
      });
      mockPrisma.topicDimension.create.mockResolvedValue({
        id: "dim1",
        name: "Market Analysis",
        status: DimensionStatus.PENDING,
      });

      const result = await service.createDimension({
        topicId: "t1",
        name: "Market Analysis",
        description: "Analyze market trends",
      });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe("Market Analysis");
      expect(mockPrisma.topicDimension.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Market Analysis",
            sortOrder: 4,
            status: DimensionStatus.PENDING,
          }),
        }),
      );
    });

    it("should return failure when dimension already exists", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue({
        id: "dim1",
        name: "Market Analysis",
      });

      const result = await service.createDimension({
        topicId: "t1",
        name: "Market Analysis",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("已存在");
    });

    it("should handle database errors gracefully", async () => {
      mockPrisma.topicDimension.findFirst.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.createDimension({
        topicId: "t1",
        name: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("创建维度失败");
    });
  });

  // ============================================================
  // deleteDimension
  // ============================================================

  describe("deleteDimension", () => {
    it("should delete dimension by name and cancel running tasks", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue({
        id: "dim1",
        name: "Old Dimension",
      });
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.researchTask.count.mockResolvedValue(2);
      mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.topicDimension.delete.mockResolvedValue({});

      const result = await service.deleteDimension({
        topicId: "t1",
        dimensionName: "Old Dimension",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("2 个相关任务");
      expect(mockPrisma.topicDimension.delete).toHaveBeenCalledWith({
        where: { id: "dim1" },
      });
    });

    it("should return failure when dimension not found", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue(null);

      const result = await service.deleteDimension({
        topicId: "t1",
        dimensionName: "NonExistent",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("未找到匹配的维度");
    });

    it("should delete by dimensionId when provided", async () => {
      mockPrisma.topicDimension.findUnique.mockResolvedValue({
        id: "dim1",
        name: "Some Dimension",
      });
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.researchTask.count.mockResolvedValue(0);
      mockPrisma.topicDimension.delete.mockResolvedValue({});

      const result = await service.deleteDimension({
        topicId: "t1",
        dimensionId: "dim1",
      });

      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // cancelTask
  // ============================================================

  describe("cancelTask", () => {
    it("should cancel task by taskId", async () => {
      const task = {
        id: "task1",
        dimensionName: "Tech Trends",
        status: ResearchTaskStatus.PENDING,
      };
      mockPrisma.researchTask.findUnique.mockResolvedValue(task);
      mockPrisma.researchTask.update.mockResolvedValue({
        ...task,
        status: ResearchTaskStatus.FAILED,
      });

      const result = await service.cancelTask({
        topicId: "t1",
        taskId: "task1",
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.researchTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ResearchTaskStatus.FAILED },
        }),
      );
    });

    it("should return success without update when task already failed", async () => {
      const task = {
        id: "task1",
        dimensionName: "Tech Trends",
        status: ResearchTaskStatus.FAILED,
      };
      mockPrisma.researchTask.findUnique.mockResolvedValue(task);

      const result = await service.cancelTask({
        topicId: "t1",
        taskId: "task1",
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.researchTask.update).not.toHaveBeenCalled();
    });

    it("should return failure when task not found", async () => {
      mockPrisma.researchTask.findUnique.mockResolvedValue(null);

      const result = await service.cancelTask({
        topicId: "t1",
        taskId: "nonexistent",
      });

      expect(result.success).toBe(false);
    });
  });

  // ============================================================
  // updateDimension
  // ============================================================

  describe("updateDimension", () => {
    it("should update dimension name and description", async () => {
      const dimension = {
        id: "dim1",
        name: "Old Name",
        description: "Old desc",
      };
      mockPrisma.topicDimension.findFirst.mockResolvedValue(dimension);
      mockPrisma.topicDimension.update.mockResolvedValue({
        ...dimension,
        name: "New Name",
      });

      const result = await service.updateDimension({
        topicId: "t1",
        dimensionName: "Old Name",
        newName: "New Name",
        newDescription: "New desc",
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("New Name");
    });

    it("should return failure when dimension not found", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue(null);

      const result = await service.updateDimension({
        topicId: "t1",
        dimensionName: "NonExistent",
        newName: "Updated",
      });

      expect(result.success).toBe(false);
    });

    it("should return failure when no update fields are provided", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue({
        id: "dim1",
        name: "Test",
      });

      const result = await service.updateDimension({
        topicId: "t1",
        dimensionName: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("没有提供需要更新的内容");
    });
  });

  // ============================================================
  // createMultipleDimensions
  // ============================================================

  describe("createMultipleDimensions", () => {
    it("should create multiple dimensions and report success count", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue(null);
      mockPrisma.topicDimension.aggregate.mockResolvedValue({
        _max: { sortOrder: 0 },
      });
      mockPrisma.topicDimension.create.mockImplementation((args: any) =>
        Promise.resolve({ id: `dim-${args.data.name}`, name: args.data.name }),
      );

      const result = await service.createMultipleDimensions("t1", [
        { name: "Dimension A" },
        { name: "Dimension B" },
      ]);

      expect(result.success).toBe(true);
      expect(result.data?.created).toBe(2);
      expect(result.data?.total).toBe(2);
    });

    it("should handle partial failures", async () => {
      mockPrisma.topicDimension.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "existing", name: "Dimension B" });
      mockPrisma.topicDimension.aggregate.mockResolvedValue({
        _max: { sortOrder: 0 },
      });
      mockPrisma.topicDimension.create.mockResolvedValue({
        id: "new",
        name: "Dimension A",
      });

      const result = await service.createMultipleDimensions("t1", [
        { name: "Dimension A" },
        { name: "Dimension B" },
      ]);

      expect(result.data?.created).toBe(1);
      expect(result.data?.total).toBe(2);
    });
  });

  // ============================================================
  // mergeDimensions
  // ============================================================

  describe("mergeDimensions", () => {
    it("should merge source dimensions into target", async () => {
      const targetDimension = {
        id: "target",
        name: "Target",
        description: "Target desc",
      };
      const sourceDimensions = [
        { id: "src1", name: "Source A", description: "Desc A" },
        { id: "src2", name: "Source B", description: "Desc B" },
      ];

      mockPrisma.topicDimension.findFirst.mockResolvedValue(targetDimension);
      mockPrisma.topicDimension.findMany.mockResolvedValue(sourceDimensions);
      mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.topicDimension.update.mockResolvedValue({});
      mockPrisma.topicDimension.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.mergeDimensions({
        topicId: "t1",
        sourceDimensionNames: ["Source A", "Source B"],
        targetDimensionName: "Target",
      });

      expect(result.success).toBe(true);
      expect(result.data?.mergedCount).toBe(2);
    });

    it("should return failure when target not found", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue(null);

      const result = await service.mergeDimensions({
        topicId: "t1",
        sourceDimensionNames: ["Source A"],
        targetDimensionName: "NonExistent",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("未找到目标维度");
    });

    it("should return failure when no source dimensions found", async () => {
      mockPrisma.topicDimension.findFirst.mockResolvedValue({
        id: "target",
        name: "Target",
      });
      mockPrisma.topicDimension.findMany.mockResolvedValue([]);

      const result = await service.mergeDimensions({
        topicId: "t1",
        sourceDimensionNames: ["NonExistent"],
        targetDimensionName: "Target",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("未找到任何源维度");
    });
  });

  // ============================================================
  // searchLatestData
  // ============================================================

  describe("searchLatestData", () => {
    it("should return empty when web-search tool not registered", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const results = await service.searchLatestData({
        topicName: "AI",
        dimensionName: "Market Trends",
      });

      expect(results).toEqual([]);
    });

    it("should search and return results when tool is available", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "AI Market 2025",
                url: "https://example.com/ai-market",
                content: "AI market is growing",
                domain: "example.com",
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      // Provide explicit queries to avoid AI call
      const results = await service.searchLatestData(
        { topicName: "AI", dimensionName: "Market Trends" },
        ["AI market trends 2025"],
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].results.length).toBeGreaterThan(0);
    });

    it("should return empty when capability context lacks web-search tool", async () => {
      mockAiFacade.capabilityResolveTools.mockResolvedValue(["other-tool"]);

      const results = await service.searchLatestData(
        { topicName: "AI", dimensionName: "Market Trends" },
        ["AI market"],
        { agentId: "agent1", userId: "user1" } as any,
      );

      expect(results).toEqual([]);
    });
  });

  // ============================================================
  // generateEnhancedPlanningContext
  // ============================================================

  describe("generateEnhancedPlanningContext", () => {
    it("should return context with empty results when web-search not available", async () => {
      mockAiFacade.capabilityResolveTools.mockResolvedValue(["github-search"]);

      const context = await service.generateEnhancedPlanningContext(
        { topicName: "AI", dimensionName: "Market Trends" },
        { agentId: "leader", userId: "user1" } as any,
      );

      expect(context.latestSearchResults).toEqual([]);
      expect(context.contextSummary).toContain("工具不可用");
    });

    it("should return context with current date and freshness info", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const context = await service.generateEnhancedPlanningContext({
        topicName: "AI",
        dimensionName: "Market Trends",
      });

      expect(context.currentDate).toBeDefined();
      expect(context.freshnessRequirement).toBeDefined();
    });
  });
});
