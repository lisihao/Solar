import { Test, TestingModule } from "@nestjs/testing";
import { MonitorService } from "../monitor.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

// ============================================================================
// Helpers
// ============================================================================

function makePrismaMock() {
  return {
    collectionTask: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    name: "Collect AI Papers",
    status: "RUNNING",
    progress: 50,
    currentStep: "Fetching",
    successItems: 10,
    duplicateItems: 2,
    failedItems: 1,
    processedItems: 13,
    startedAt: new Date(Date.now() - 60000), // started 60 seconds ago
    completedAt: null,
    source: { name: "ArXiv" },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("MonitorService", () => {
  let service: MonitorService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [MonitorService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<MonitorService>(MonitorService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------- getRunningTasks ----------

  describe("getRunningTasks", () => {
    it("queries for RUNNING tasks only", async () => {
      prisma.collectionTask.findMany.mockResolvedValue([]);

      await service.getRunningTasks();

      expect(prisma.collectionTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: "RUNNING" } }),
      );
    });

    it("maps task fields to the TaskMonitor shape", async () => {
      const task = makeTask();
      prisma.collectionTask.findMany.mockResolvedValue([task]);

      const result = await service.getRunningTasks();

      expect(result).toHaveLength(1);
      const monitor = result[0];
      expect(monitor.id).toBe("task-1");
      expect(monitor.name).toBe("Collect AI Papers");
      expect(monitor.sourceName).toBe("ArXiv");
      expect(monitor.status).toBe("RUNNING");
      expect(monitor.progress).toBe(50);
      expect(monitor.collected).toBe(10);
      expect(monitor.duplicates).toBe(2);
      expect(monitor.failed).toBe(1);
    });

    it("calculates elapsed time in seconds", async () => {
      const startedAt = new Date(Date.now() - 90000); // 90 seconds ago
      prisma.collectionTask.findMany.mockResolvedValue([
        makeTask({ startedAt }),
      ]);

      const result = await service.getRunningTasks();

      expect(result[0].elapsedTime).toBeGreaterThanOrEqual(89);
      expect(result[0].elapsedTime).toBeLessThanOrEqual(91);
    });

    it("sets elapsedTime to 0 when startedAt is null", async () => {
      prisma.collectionTask.findMany.mockResolvedValue([
        makeTask({ startedAt: null }),
      ]);

      const result = await service.getRunningTasks();

      expect(result[0].elapsedTime).toBe(0);
    });

    it("calculates estimatedTimeLeft based on progress", async () => {
      // 50% done in 60s → estimated 60s remaining
      const startedAt = new Date(Date.now() - 60000);
      prisma.collectionTask.findMany.mockResolvedValue([
        makeTask({ startedAt, progress: 50 }),
      ]);

      const result = await service.getRunningTasks();

      // Allow some delta for test timing
      expect(result[0].estimatedTimeLeft).toBeGreaterThanOrEqual(55);
      expect(result[0].estimatedTimeLeft).toBeLessThanOrEqual(65);
    });

    it("sets estimatedTimeLeft to 0 when progress is 0", async () => {
      prisma.collectionTask.findMany.mockResolvedValue([
        makeTask({ progress: 0 }),
      ]);

      const result = await service.getRunningTasks();

      expect(result[0].estimatedTimeLeft).toBe(0);
    });

    it("uses 'Processing' as currentStep fallback when null", async () => {
      prisma.collectionTask.findMany.mockResolvedValue([
        makeTask({ currentStep: null }),
      ]);

      const result = await service.getRunningTasks();

      expect(result[0].currentStep).toBe("Processing");
    });

    it("returns empty array when no tasks are running", async () => {
      prisma.collectionTask.findMany.mockResolvedValue([]);

      const result = await service.getRunningTasks();

      expect(result).toHaveLength(0);
    });
  });

  // ---------- getSystemMetrics ----------

  describe("getSystemMetrics", () => {
    it("returns the expected shape with cpu, memory, and task counts", async () => {
      const now = Date.now();
      const recentCompleted = makeTask({
        status: "COMPLETED",
        completedAt: new Date(now - 30000), // within last minute
        successItems: 5,
      });
      const running = makeTask({ status: "RUNNING" });
      const pending = makeTask({
        id: "task-p",
        status: "PENDING",
        source: { name: "X" },
      });
      const failed = makeTask({
        id: "task-f",
        status: "FAILED",
        source: { name: "Y" },
      });

      prisma.collectionTask.findMany.mockResolvedValue([
        recentCompleted,
        running,
        pending,
        failed,
      ]);

      const metrics = await service.getSystemMetrics();

      expect(metrics.activeTasks).toBe(1);
      expect(metrics.queuedTasks).toBe(1);
      expect(metrics.collectionsPerMinute).toBe(5);
      expect(metrics.cpu).toBeDefined();
      expect(metrics.cpu.cores).toBeGreaterThan(0);
      expect(metrics.memory.total).toBeGreaterThan(0);
      expect(metrics.memory.used).toBeGreaterThan(0);
      expect(metrics.uptime).toBeGreaterThan(0);
    }, 10000); // allow up to 10s for CPU sampling

    it("calculates error rate correctly", async () => {
      prisma.collectionTask.findMany.mockResolvedValue([
        makeTask({ status: "COMPLETED", completedAt: null }),
        makeTask({
          id: "t2",
          status: "COMPLETED",
          completedAt: null,
          source: { name: "X" },
        }),
        makeTask({
          id: "t3",
          status: "FAILED",
          completedAt: null,
          source: { name: "Y" },
        }),
      ]);

      const metrics = await service.getSystemMetrics();

      // 1 failed / (2 completed + 1 failed) = 33.3%
      expect(metrics.errorRate).toBeCloseTo(33.33, 0);
    }, 10000);

    it("returns 0 error rate when there are no completed or failed tasks", async () => {
      prisma.collectionTask.findMany.mockResolvedValue([
        makeTask({ status: "RUNNING" }),
      ]);

      const metrics = await service.getSystemMetrics();

      expect(metrics.errorRate).toBe(0);
    }, 10000);
  });

  // ---------- getTaskDetail ----------

  describe("getTaskDetail", () => {
    it("returns null when task is not found", async () => {
      prisma.collectionTask.findUnique.mockResolvedValue(null);

      const result = await service.getTaskDetail("nonexistent");

      expect(result).toBeNull();
    });

    it("returns task with elapsedTime and throughput", async () => {
      const startedAt = new Date(Date.now() - 120000); // 120 seconds ago
      const task = {
        ...makeTask({ startedAt, processedItems: 60 }),
        resources: [],
        deduplicationRecords: [],
      };
      prisma.collectionTask.findUnique.mockResolvedValue(task);

      const result = await service.getTaskDetail("task-1");

      expect(result).not.toBeNull();
      expect(result?.elapsedTime).toBeGreaterThanOrEqual(119);
      // throughput = 60 items / ~120 seconds ≈ 0.5 items/sec
      expect(result?.throughput).toBeGreaterThan(0);
    });

    it("returns throughput=0 when startedAt is null", async () => {
      const task = {
        ...makeTask({ startedAt: null, processedItems: 10 }),
        resources: [],
        deduplicationRecords: [],
      };
      prisma.collectionTask.findUnique.mockResolvedValue(task);

      const result = await service.getTaskDetail("task-1");

      expect(result?.throughput).toBe(0);
    });

    it("passes task id to prisma findUnique", async () => {
      prisma.collectionTask.findUnique.mockResolvedValue(null);

      await service.getTaskDetail("task-xyz");

      expect(prisma.collectionTask.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "task-xyz" } }),
      );
    });
  });

  // ---------- getRecentLogs ----------

  describe("getRecentLogs", () => {
    it("returns an array of log entries", async () => {
      const logs = await service.getRecentLogs();
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThan(0);
    });

    it("each log entry has required fields", async () => {
      const logs = await service.getRecentLogs();
      for (const log of logs) {
        expect(log).toHaveProperty("timestamp");
        expect(log).toHaveProperty("level");
        expect(log).toHaveProperty("message");
      }
    });

    it("includes the taskId in the first log when provided", async () => {
      const logs = await service.getRecentLogs("task-abc");
      expect(logs[0].taskId).toBe("task-abc");
    });
  });

  // ---------- getPerformanceMetrics ----------

  describe("getPerformanceMetrics", () => {
    it("returns an empty array when no tasks are found", async () => {
      prisma.collectionTask.findMany.mockResolvedValue([]);

      const result = await service.getPerformanceMetrics(1);

      expect(result).toEqual([]);
    });

    it("groups tasks into 5-minute intervals", async () => {
      const baseTime = new Date("2026-03-01T12:00:00Z").getTime();

      // Two tasks in same 5-min bucket
      const task1 = makeTask({
        startedAt: new Date(baseTime),
        successItems: 3,
        duplicateItems: 1,
        failedItems: 0,
        status: "COMPLETED",
        completedAt: null,
      });
      const task2 = makeTask({
        id: "task-2",
        startedAt: new Date(baseTime + 60000), // +1 min (same bucket)
        successItems: 7,
        duplicateItems: 0,
        failedItems: 2,
        status: "COMPLETED",
        completedAt: null,
        source: { name: "GitHub" },
      });
      // Task in a different bucket
      const task3 = makeTask({
        id: "task-3",
        startedAt: new Date(baseTime + 10 * 60000), // +10 min (different bucket)
        successItems: 5,
        duplicateItems: 0,
        failedItems: 0,
        status: "RUNNING",
        completedAt: null,
        source: { name: "RSS" },
      });

      prisma.collectionTask.findMany.mockResolvedValue([task1, task2, task3]);

      const result = await service.getPerformanceMetrics(1);

      // Should have 2 distinct time buckets
      expect(result).toHaveLength(2);

      // Results should be sorted by timestamp ascending
      expect(result[0].timestamp.getTime()).toBeLessThan(
        result[1].timestamp.getTime(),
      );
    });

    it("skips tasks where startedAt is null", async () => {
      prisma.collectionTask.findMany.mockResolvedValue([
        makeTask({ startedAt: null }),
      ]);

      const result = await service.getPerformanceMetrics(1);

      expect(result).toHaveLength(0);
    });

    it("passes startTime filter to prisma query", async () => {
      prisma.collectionTask.findMany.mockResolvedValue([]);

      const before = Date.now();
      await service.getPerformanceMetrics(2);
      const after = Date.now();

      const callArg = prisma.collectionTask.findMany.mock.calls[0][0];
      const gte: Date = callArg.where.startedAt.gte;
      const expectedMs = 2 * 3600000;

      expect(before - gte.getTime()).toBeGreaterThanOrEqual(expectedMs - 1000);
      expect(after - gte.getTime()).toBeLessThanOrEqual(expectedMs + 1000);
    });
  });
});
