import { Test, TestingModule } from "@nestjs/testing";
import { HistoryService } from "../history.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { CollectionTaskStatus } from "@prisma/client";

jest.mock("../../../../../../common/prisma/prisma.service");

describe("HistoryService", () => {
  let service: HistoryService;
  let mockPrisma: {
    collectionTask: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const mockTask = {
    id: "task-1",
    name: "Import Task 1",
    status: CollectionTaskStatus.COMPLETED,
    totalItems: 100,
    successItems: 95,
    failedItems: 3,
    duplicateItems: 2,
    skippedItems: 0,
    startedAt: oneHourAgo,
    completedAt: now,
    createdAt: oneHourAgo,
    updatedAt: now,
    sourceId: "src-1",
    source: { id: "src-1", name: "Test Source" },
    resources: [],
    deduplicationRecords: [],
    progress: 100,
  };

  const _mockFailedTask = {
    ...mockTask,
    id: "task-2",
    name: "Failed Task",
    status: CollectionTaskStatus.FAILED,
    successItems: 10,
    failedItems: 90,
    startedAt: new Date(now.getTime() - 30 * 60 * 1000),
    completedAt: now,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma = {
      collectionTask: {
        findMany: jest.fn().mockResolvedValue([mockTask]),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(mockTask),
        delete: jest.fn().mockResolvedValue(mockTask),
        deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HistoryService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<HistoryService>(HistoryService);
  });

  // =========================================================================
  // getHistory
  // =========================================================================

  describe("getHistory", () => {
    it("should return history records with total count", async () => {
      const result = await service.getHistory();

      expect(result.records).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("should map task to HistoryRecord correctly", async () => {
      const result = await service.getHistory();
      const record = result.records[0];

      expect(record.id).toBe("task-1");
      expect(record.taskName).toBe("Import Task 1");
      expect(record.sourceName).toBe("Test Source");
      expect(record.status).toBe(CollectionTaskStatus.COMPLETED);
      expect(record.totalItems).toBe(100);
      expect(record.successItems).toBe(95);
      expect(record.failedItems).toBe(3);
      expect(record.duplicateItems).toBe(2);
      expect(record.skippedItems).toBe(0);
    });

    it("should calculate duration correctly", async () => {
      const result = await service.getHistory();
      const record = result.records[0];

      const expectedDuration = Math.floor(
        (now.getTime() - oneHourAgo.getTime()) / 1000,
      );
      expect(record.duration).toBeCloseTo(expectedDuration, -1);
    });

    it("should return 0 duration when startedAt or completedAt is null", async () => {
      const taskNoTimes = { ...mockTask, startedAt: null, completedAt: now };
      mockPrisma.collectionTask.findMany.mockResolvedValue([taskNoTimes]);

      const result = await service.getHistory();
      expect(result.records[0].duration).toBe(0);
    });

    it("should filter by status when provided", async () => {
      await service.getHistory({ status: CollectionTaskStatus.COMPLETED });

      expect(mockPrisma.collectionTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: CollectionTaskStatus.COMPLETED,
          }),
        }),
      );
    });

    it("should filter by sourceId when provided", async () => {
      await service.getHistory({ sourceId: "src-1" });

      expect(mockPrisma.collectionTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceId: "src-1",
          }),
        }),
      );
    });

    it("should filter by date range when provided", async () => {
      const startDate = new Date("2026-01-01");
      const endDate = new Date("2026-12-31");

      await service.getHistory({ startDate, endDate });

      expect(mockPrisma.collectionTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            completedAt: expect.objectContaining({
              gte: startDate,
              lte: endDate,
            }),
          }),
        }),
      );
    });

    it("should filter by startDate only when endDate not provided", async () => {
      const startDate = new Date("2026-01-01");

      await service.getHistory({ startDate });

      const callArgs = mockPrisma.collectionTask.findMany.mock.calls[0][0];
      expect(callArgs.where.completedAt.gte).toEqual(startDate);
      expect(callArgs.where.completedAt.lte).toBeUndefined();
    });

    it("should use default limit and offset", async () => {
      await service.getHistory();

      expect(mockPrisma.collectionTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          skip: 0,
        }),
      );
    });

    it("should use custom limit and offset", async () => {
      await service.getHistory({ limit: 10, offset: 20 });

      expect(mockPrisma.collectionTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });

    it("should return empty records when no tasks", async () => {
      mockPrisma.collectionTask.findMany.mockResolvedValue([]);
      mockPrisma.collectionTask.count.mockResolvedValue(0);

      const result = await service.getHistory();
      expect(result.records).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================

  describe("getStats", () => {
    const tasks = [
      {
        id: "t1",
        status: "COMPLETED",
        successItems: 100,
        duplicateItems: 5,
        failedItems: 2,
        startedAt: new Date("2026-03-01T10:00:00Z"),
        completedAt: new Date("2026-03-01T10:30:00Z"),
      },
      {
        id: "t2",
        status: "COMPLETED",
        successItems: 50,
        duplicateItems: 3,
        failedItems: 1,
        startedAt: new Date("2026-03-01T11:00:00Z"),
        completedAt: new Date("2026-03-01T11:15:00Z"),
      },
      {
        id: "t3",
        status: "FAILED",
        successItems: 0,
        duplicateItems: 0,
        failedItems: 20,
        startedAt: new Date("2026-03-01T12:00:00Z"),
        completedAt: new Date("2026-03-01T12:05:00Z"),
      },
    ];

    beforeEach(() => {
      mockPrisma.collectionTask.findMany.mockResolvedValue(tasks);
    });

    it("should calculate stats correctly for week period", async () => {
      const result = await service.getStats("week");

      expect(result.period).toBe("week");
      expect(result.totalTasks).toBe(3);
      expect(result.completedTasks).toBe(2);
      expect(result.failedTasks).toBe(1);
      expect(result.totalCollected).toBe(150); // 100 + 50 + 0
      expect(result.totalDuplicates).toBe(8); // 5 + 3 + 0
      expect(result.totalFailed).toBe(23); // 2 + 1 + 20
    });

    it("should calculate success rate", async () => {
      const result = await service.getStats("week");
      expect(result.successRate).toBeCloseTo((2 / 3) * 100, 1);
    });

    it("should return 0 success rate when no tasks", async () => {
      mockPrisma.collectionTask.findMany.mockResolvedValue([]);

      const result = await service.getStats("week");
      expect(result.successRate).toBe(0);
    });

    it("should calculate average duration", async () => {
      const result = await service.getStats("week");

      // t1: 30 min = 1800s, t2: 15 min = 900s, t3: 5 min = 300s
      // avg = (1800 + 900 + 300) / 3 = 1000s
      expect(result.avgDuration).toBeCloseTo(1000, -2);
    });

    it("should handle tasks with null startedAt/completedAt in duration calc", async () => {
      const tasksWithNull = [
        {
          id: "t1",
          status: "COMPLETED",
          successItems: 10,
          duplicateItems: 0,
          failedItems: 0,
          startedAt: null,
          completedAt: new Date(),
        },
      ];
      mockPrisma.collectionTask.findMany.mockResolvedValue(tasksWithNull);

      const result = await service.getStats("week");
      // Should handle null gracefully (0 contribution to duration)
      expect(result.avgDuration).toBe(0);
    });

    it("should query with day period range", async () => {
      await service.getStats("day");

      const callArgs = mockPrisma.collectionTask.findMany.mock.calls[0][0];
      const gte: Date = callArgs.where.completedAt.gte;
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Should be approximately 1 day ago (within 2 hours tolerance for DST)
      expect(Math.abs(gte.getTime() - dayAgo.getTime())).toBeLessThan(
        2 * 60 * 60 * 1000,
      );
    });

    it("should query with month period range", async () => {
      await service.getStats("month");

      const callArgs = mockPrisma.collectionTask.findMany.mock.calls[0][0];
      const gte: Date = callArgs.where.completedAt.gte;
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);

      expect(Math.abs(gte.getTime() - monthAgo.getTime())).toBeLessThan(5000);
    });

    it("should default to week period", async () => {
      const result = await service.getStats();
      expect(result.period).toBe("week");
    });
  });

  // =========================================================================
  // getTaskHistory
  // =========================================================================

  describe("getTaskHistory", () => {
    it("should return task with all relations", async () => {
      const fullTask = {
        ...mockTask,
        resources: [{ id: "r-1", title: "Resource 1" }],
        deduplicationRecords: [{ id: "d-1" }],
      };
      mockPrisma.collectionTask.findUnique.mockResolvedValue(fullTask);

      const result = await service.getTaskHistory("task-1");

      expect(result).toEqual(fullTask);
      expect(mockPrisma.collectionTask.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-1" },
          include: expect.objectContaining({
            source: true,
            resources: expect.objectContaining({ take: 50 }),
            deduplicationRecords: expect.objectContaining({ take: 50 }),
          }),
        }),
      );
    });

    it("should return null when task not found", async () => {
      mockPrisma.collectionTask.findUnique.mockResolvedValue(null);

      const result = await service.getTaskHistory("nonexistent");
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // deleteHistory
  // =========================================================================

  describe("deleteHistory", () => {
    it("should delete the task", async () => {
      await service.deleteHistory("task-1");

      expect(mockPrisma.collectionTask.delete).toHaveBeenCalledWith({
        where: { id: "task-1" },
      });
    });
  });

  // =========================================================================
  // cleanOldHistory
  // =========================================================================

  describe("cleanOldHistory", () => {
    it("should delete old completed/failed tasks and return count", async () => {
      mockPrisma.collectionTask.deleteMany.mockResolvedValue({ count: 10 });

      const result = await service.cleanOldHistory(30);
      expect(result).toBe(10);
    });

    it("should use correct cutoff date for 30 days", async () => {
      await service.cleanOldHistory(30);

      const callArgs = mockPrisma.collectionTask.deleteMany.mock.calls[0][0];
      const cutoffDate: Date = callArgs.where.completedAt.lt;

      const expectedCutoff = new Date();
      expectedCutoff.setDate(expectedCutoff.getDate() - 30);

      expect(
        Math.abs(cutoffDate.getTime() - expectedCutoff.getTime()),
      ).toBeLessThan(5000);
    });

    it("should only delete COMPLETED, FAILED, CANCELLED tasks", async () => {
      await service.cleanOldHistory(30);

      const callArgs = mockPrisma.collectionTask.deleteMany.mock.calls[0][0];
      expect(callArgs.where.status.in).toContain("COMPLETED");
      expect(callArgs.where.status.in).toContain("FAILED");
      expect(callArgs.where.status.in).toContain("CANCELLED");
    });

    it("should use default 30 days when not specified", async () => {
      await service.cleanOldHistory();

      const callArgs = mockPrisma.collectionTask.deleteMany.mock.calls[0][0];
      const cutoffDate: Date = callArgs.where.completedAt.lt;
      const expectedCutoff = new Date();
      expectedCutoff.setDate(expectedCutoff.getDate() - 30);

      expect(
        Math.abs(cutoffDate.getTime() - expectedCutoff.getTime()),
      ).toBeLessThan(5000);
    });
  });
});
