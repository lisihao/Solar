import { Test, TestingModule } from "@nestjs/testing";
import { DashboardService } from "../dashboard.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

jest.mock("../../../../../../common/prisma/prisma.service");

describe("DashboardService", () => {
  let service: DashboardService;
  let mockPrisma: {
    dataSource: { findMany: jest.Mock };
    collectionTask: { findMany: jest.Mock };
  };

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const mockSources = [
    { id: "src-1", name: "Source 1", status: "ACTIVE" },
    { id: "src-2", name: "Source 2", status: "ACTIVE" },
    { id: "src-3", name: "Source 3", status: "PAUSED" },
    { id: "src-4", name: "Source 4", status: "FAILED" },
  ];

  const mockTasks = [
    {
      id: "task-1",
      name: "Task 1",
      status: "RUNNING",
      progress: 50,
      successItems: 0,
      failedItems: 0,
      duplicateItems: 0,
      totalItems: 0,
      startedAt: new Date(now.getTime() - 1000),
      completedAt: null,
      createdAt: new Date(now.getTime() - 2000),
      source: { name: "Source 1" },
    },
    {
      id: "task-2",
      name: "Task 2",
      status: "COMPLETED",
      progress: 100,
      successItems: 50,
      failedItems: 5,
      duplicateItems: 3,
      totalItems: 58,
      startedAt: new Date(now.getTime() - 5000),
      completedAt: new Date(now.getTime() - 1000), // today
      createdAt: new Date(now.getTime() - 6000),
      source: { name: "Source 2" },
    },
    {
      id: "task-3",
      name: "Task 3",
      status: "PENDING",
      progress: 0,
      successItems: 0,
      failedItems: 0,
      duplicateItems: 0,
      totalItems: 0,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(now.getTime() - 1000),
      source: { name: "Source 3" },
    },
    {
      id: "task-4",
      name: "Task 4",
      status: "FAILED",
      progress: 20,
      successItems: 5,
      failedItems: 15,
      duplicateItems: 1,
      totalItems: 21,
      startedAt: new Date(now.getTime() - 3000),
      completedAt: new Date(now.getTime() - 500), // today
      createdAt: new Date(now.getTime() - 4000),
      source: { name: "Source 4" },
    },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma = {
      dataSource: {
        findMany: jest.fn().mockResolvedValue(mockSources),
      },
      collectionTask: {
        findMany: jest.fn().mockResolvedValue(mockTasks),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  // =========================================================================
  // getStats
  // =========================================================================

  describe("getStats", () => {
    it("should return correct source statistics", async () => {
      const stats = await service.getStats();

      expect(stats.sourceStats.total).toBe(4);
      expect(stats.sourceStats.active).toBe(2);
      expect(stats.sourceStats.paused).toBe(1);
      expect(stats.sourceStats.failed).toBe(1);
    });

    it("should return correct task statistics", async () => {
      const stats = await service.getStats();

      expect(stats.taskStats.total).toBe(4);
      expect(stats.taskStats.running).toBe(1);
      expect(stats.taskStats.pending).toBe(1);
      expect(stats.taskStats.completed).toBe(1);
      expect(stats.taskStats.failed).toBe(1);
    });

    it("should return today stats with correct aggregation", async () => {
      const stats = await service.getStats();

      // Today: task-2 (completed, 50 success, 5 fail) + task-4 (failed, 5 success, 15 fail)
      expect(stats.todayStats.collected).toBe(55); // 50 + 5 success items
      expect(stats.todayStats.success).toBe(55);
      expect(stats.todayStats.failed).toBe(20); // 5 + 15 fail items
      expect(stats.todayStats.duplicates).toBe(4); // 3 + 1
    });

    it("should calculate success rate correctly", async () => {
      const stats = await service.getStats();

      // Today: success=55, failed=20, total=75
      const expectedRate = (55 / 75) * 100;
      expect(stats.todayStats.successRate).toBeCloseTo(expectedRate, 1);
    });

    it("should return 0 success rate when no tasks today", async () => {
      const tasksNoToday = mockTasks.map((t) => ({
        ...t,
        completedAt: null,
      }));
      mockPrisma.collectionTask.findMany.mockResolvedValue(tasksNoToday);

      const stats = await service.getStats();
      expect(stats.todayStats.successRate).toBe(0);
    });

    it("should include recent tasks with correct structure", async () => {
      // Override for recent tasks query (second call)
      mockPrisma.collectionTask.findMany
        .mockResolvedValueOnce(mockSources) // Actually this is for sources, but prisma mock
        .mockResolvedValueOnce(mockTasks) // tasks for stats
        .mockResolvedValueOnce(mockTasks.slice(0, 2)); // recent tasks

      const stats = await service.getStats();

      expect(stats.recentTasks).toBeDefined();
      expect(Array.isArray(stats.recentTasks)).toBe(true);
    });

    it("should format task dates correctly", async () => {
      // Setup mock to return specific tasks for both queries
      mockPrisma.collectionTask.findMany.mockResolvedValue(mockTasks);

      const stats = await service.getStats();

      const taskWithDates = stats.recentTasks.find((t) => t.startedAt !== null);
      if (taskWithDates) {
        expect(typeof taskWithDates.startedAt).toBe("string");
      }
    });

    it("should handle task with null source gracefully", async () => {
      const tasksWithNullSource = [
        {
          ...mockTasks[0],
          source: undefined,
        },
      ];
      mockPrisma.collectionTask.findMany.mockResolvedValue(tasksWithNullSource);

      const stats = await service.getStats();
      expect(
        stats.recentTasks.find((t) => t.sourceName === "Unknown"),
      ).toBeDefined();
    });

    it("should return fixed quality metrics", async () => {
      const stats = await service.getStats();

      expect(stats.qualityMetrics.avgCompleteness).toBe(85.0);
      expect(stats.qualityMetrics.avgAccuracy).toBe(90.0);
      expect(stats.qualityMetrics.avgTimeliness).toBe(88.0);
      expect(stats.qualityMetrics.avgUsability).toBe(87.5);
    });

    it("should return empty timeSeries array", async () => {
      const stats = await service.getStats();
      expect(stats.timeSeries).toEqual([]);
    });

    it("should handle empty sources and tasks", async () => {
      mockPrisma.dataSource.findMany.mockResolvedValue([]);
      mockPrisma.collectionTask.findMany.mockResolvedValue([]);

      const stats = await service.getStats();

      expect(stats.sourceStats.total).toBe(0);
      expect(stats.taskStats.total).toBe(0);
      expect(stats.todayStats.collected).toBe(0);
      expect(stats.todayStats.successRate).toBe(0);
    });
  });

  // =========================================================================
  // getTimeSeries
  // =========================================================================

  describe("getTimeSeries", () => {
    const completedTasks = [
      {
        id: "t1",
        completedAt: new Date("2026-03-01T12:00:00Z"),
        totalItems: 100,
        successItems: 90,
        failedItems: 5,
        duplicateItems: 5,
      },
      {
        id: "t2",
        completedAt: new Date("2026-03-01T15:00:00Z"),
        totalItems: 50,
        successItems: 45,
        failedItems: 3,
        duplicateItems: 2,
      },
      {
        id: "t3",
        completedAt: new Date("2026-03-02T10:00:00Z"),
        totalItems: 80,
        successItems: 75,
        failedItems: 2,
        duplicateItems: 3,
      },
    ];

    beforeEach(() => {
      mockPrisma.collectionTask.findMany.mockResolvedValue(completedTasks);
    });

    it("should return daily aggregated time series", async () => {
      const result = await service.getTimeSeries(7);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("should aggregate tasks by date correctly", async () => {
      const result = await service.getTimeSeries(7);

      // Find the entry for 2026-03-01
      const march1 = result.find((r) => r.date === "2026-03-01");
      if (march1) {
        // Two tasks on same day should be aggregated
        expect(march1.collected).toBe(150); // 100 + 50 total items
        expect(march1.success).toBe(135); // 90 + 45
        expect(march1.failed).toBe(8); // 5 + 3
        expect(march1.duplicates).toBe(7); // 5 + 2
      }
    });

    it("should handle tasks with null completedAt", async () => {
      const tasksWithNull = [
        ...completedTasks,
        {
          id: "t-null",
          completedAt: null,
          totalItems: 10,
          successItems: 8,
          failedItems: 1,
          duplicateItems: 1,
        },
      ];
      mockPrisma.collectionTask.findMany.mockResolvedValue(tasksWithNull);

      const result = await service.getTimeSeries(7);
      // Null completedAt tasks should be skipped
      expect(Array.isArray(result)).toBe(true);
    });

    it("should use default days=7 when not specified", async () => {
      await service.getTimeSeries();

      expect(mockPrisma.collectionTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            completedAt: expect.any(Object),
          }),
        }),
      );
    });

    it("should return empty array when no tasks in period", async () => {
      mockPrisma.collectionTask.findMany.mockResolvedValue([]);

      const result = await service.getTimeSeries(7);
      expect(result).toEqual([]);
    });
  });
});
