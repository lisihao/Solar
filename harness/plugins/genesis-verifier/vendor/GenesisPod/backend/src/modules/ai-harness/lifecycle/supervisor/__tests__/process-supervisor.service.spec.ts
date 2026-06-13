/**
 * ProcessSupervisorService Unit Tests
 *
 * Covers:
 *   - Core ExecutionStateManager functionality: start/finish/isActive/getState/convenience methods/getStats/forceCleanAll/auto-cleanup
 *   - Health check: timeout detection, zombie detection, expired memory cleanup
 *   - recoverOnStartup: recover with checkpoint → READY, no checkpoint → FAILED
 *
 * Uses jest.useFakeTimers() to control setInterval without real clock.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import {
  ProcessSupervisorService,
  StateCategory,
} from "../process-supervisor.service";
import { CacheService } from "@/common/cache/cache.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ProcessManagerService } from "@/modules/ai-harness/lifecycle/manager/process-manager.service";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockCacheService() {
  return {
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
  };
}

function makeMockPrisma() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ exists: true }]),
    agentProcess: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    processMemory: {
      deleteMany: jest.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProcessSupervisorService", () => {
  let service: ProcessSupervisorService;
  let mockCacheService: ReturnType<typeof makeMockCacheService>;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  // Helper to build the module, optionally injecting Prisma
  async function buildModule(withPrisma = false): Promise<TestingModule> {
    const providers: any[] = [
      ProcessSupervisorService,
      { provide: CacheService, useValue: mockCacheService },
    ];

    if (withPrisma) {
      providers.push({ provide: PrismaService, useValue: mockPrisma });
      // ProcessManagerService is @Optional() but we provide a stub to avoid DI warnings
      providers.push({
        provide: ProcessManagerService,
        useValue: {},
      });
    }

    return Test.createTestingModule({ providers }).compile();
  }

  beforeEach(async () => {
    jest.useFakeTimers();

    mockCacheService = makeMockCacheService();
    mockPrisma = makeMockPrisma();

    // Safe defaults
    mockPrisma.agentProcess.findMany.mockResolvedValue([]);
    mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.processMemory.deleteMany.mockResolvedValue({ count: 0 });

    const module = await buildModule(false);
    service = module.get<ProcessSupervisorService>(ProcessSupervisorService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // start() / finish() / isActive() / getState()
  // -------------------------------------------------------------------------

  describe("start()", () => {
    it("should start tracking a state and return true", () => {
      const result = service.start(StateCategory.TASK, "task-1", "My task");

      expect(result).toBe(true);
      expect(service.isActive(StateCategory.TASK, "task-1")).toBe(true);
    });

    it("should store description and metadata on the state entry", () => {
      const meta = { priority: "high", retries: 0 };
      service.start(StateCategory.TASK, "task-1", "Important task", meta);

      const entry = service.getState(StateCategory.TASK, "task-1");
      expect(entry).toBeDefined();
      expect(entry!.description).toBe("Important task");
      expect(entry!.metadata).toEqual(meta);
      expect(entry!.startTime).toBeGreaterThan(0);
    });

    it("should return false for a duplicate id in the same category", () => {
      service.start(StateCategory.TASK, "task-1", "First");
      const duplicate = service.start(StateCategory.TASK, "task-1", "Second");

      expect(duplicate).toBe(false);
      // Original entry must be preserved
      expect(service.getState(StateCategory.TASK, "task-1")!.description).toBe(
        "First",
      );
    });

    it("should allow the same id in different categories", () => {
      const r1 = service.start(StateCategory.TASK, "shared-id");
      const r2 = service.start(StateCategory.WORKFLOW, "shared-id");

      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(service.isActive(StateCategory.TASK, "shared-id")).toBe(true);
      expect(service.isActive(StateCategory.WORKFLOW, "shared-id")).toBe(true);
    });
  });

  describe("finish()", () => {
    it("should stop tracking the state and make isActive return false", () => {
      service.start(StateCategory.TASK, "task-1");
      service.finish(StateCategory.TASK, "task-1");

      expect(service.isActive(StateCategory.TASK, "task-1")).toBe(false);
      expect(service.getState(StateCategory.TASK, "task-1")).toBeUndefined();
    });

    it("should be a no-op when the id does not exist", () => {
      expect(() =>
        service.finish(StateCategory.TASK, "no-such-id"),
      ).not.toThrow();
    });

    it("should only remove the state in the specified category", () => {
      service.start(StateCategory.TASK, "id-1");
      service.start(StateCategory.WORKFLOW, "id-1");

      service.finish(StateCategory.TASK, "id-1");

      expect(service.isActive(StateCategory.TASK, "id-1")).toBe(false);
      expect(service.isActive(StateCategory.WORKFLOW, "id-1")).toBe(true);
    });
  });

  describe("isActive()", () => {
    it("should return true for an active entry", () => {
      service.start(StateCategory.TASK, "active-task");
      expect(service.isActive(StateCategory.TASK, "active-task")).toBe(true);
    });

    it("should return false for a non-existent entry", () => {
      expect(service.isActive(StateCategory.TASK, "ghost")).toBe(false);
    });

    it("should return false after the entry has been finished", () => {
      service.start(StateCategory.TASK, "finished-task");
      service.finish(StateCategory.TASK, "finished-task");
      expect(service.isActive(StateCategory.TASK, "finished-task")).toBe(false);
    });
  });

  describe("getState()", () => {
    it("should return the state entry for an active id", () => {
      service.start(StateCategory.WORKFLOW, "wf-1", "Workflow description");
      const state = service.getState(StateCategory.WORKFLOW, "wf-1");

      expect(state).toBeDefined();
      expect(state!.description).toBe("Workflow description");
    });

    it("should return undefined when id does not exist", () => {
      expect(
        service.getState(StateCategory.TASK, "no-such-task"),
      ).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Convenience methods: startTask / finishTask
  // -------------------------------------------------------------------------

  describe("startTask() / finishTask()", () => {
    it("startTask should track in the TASK category and return true", () => {
      expect(service.startTask("task-abc", "My task")).toBe(true);
      expect(service.isTaskExecuting("task-abc")).toBe(true);
    });

    it("finishTask should remove from the TASK category", () => {
      service.startTask("task-abc");
      service.finishTask("task-abc");
      expect(service.isTaskExecuting("task-abc")).toBe(false);
    });

    it("startTask should return false for a duplicate", () => {
      service.startTask("task-dup");
      expect(service.startTask("task-dup")).toBe(false);
    });

    it("isTaskExecuting should be false before start and true after", () => {
      expect(service.isTaskExecuting("task-new")).toBe(false);
      service.startTask("task-new");
      expect(service.isTaskExecuting("task-new")).toBe(true);
    });
  });

  describe("startWorkflow() / finishWorkflow()", () => {
    it("should track in the WORKFLOW category", () => {
      expect(service.startWorkflow("wf-1", "Workflow")).toBe(true);
      expect(service.isWorkflowExecuting("wf-1")).toBe(true);

      service.finishWorkflow("wf-1");
      expect(service.isWorkflowExecuting("wf-1")).toBe(false);
    });
  });

  describe("startRevision() / finishRevision()", () => {
    it("should track in the REVISION category", () => {
      expect(service.startRevision("rev-1", "Revision")).toBe(true);
      expect(service.isRevisionInProgress("rev-1")).toBe(true);

      service.finishRevision("rev-1");
      expect(service.isRevisionInProgress("rev-1")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getStats()
  // -------------------------------------------------------------------------

  describe("getStats()", () => {
    it("should return correct active counts and totalActive", () => {
      service.startTask("t-1");
      service.startTask("t-2");
      service.startWorkflow("w-1");

      const stats = service.getStats();

      expect(stats.totalActive).toBe(3);
      expect(stats.activeCounts[StateCategory.TASK]).toBe(2);
      expect(stats.activeCounts[StateCategory.WORKFLOW]).toBe(1);
    });

    it("should return a non-null oldestAge for populated categories", () => {
      service.startTask("t-early");
      jest.advanceTimersByTime(2000);
      service.startTask("t-late");

      const stats = service.getStats();

      // Oldest task was started 2 seconds before the second
      expect(stats.oldestAges[StateCategory.TASK]).toBeGreaterThanOrEqual(2000);
    });

    it("should return null oldestAge for an empty category", () => {
      // Create then clear a category
      service.startTask("t-1");
      service.finishTask("t-1");

      const stats = service.getStats();
      // category exists with size 0 → null
      expect(stats.oldestAges[StateCategory.TASK]).toBeNull();
    });

    it("should return zero totalActive when nothing is tracked", () => {
      const stats = service.getStats();
      expect(stats.totalActive).toBe(0);
    });

    it("should include ttlMs and cleanupIntervalMs in config", () => {
      const stats = service.getStats();
      expect(stats.config.ttlMs).toBe(30 * 60 * 1000);
      expect(stats.config.cleanupIntervalMs).toBe(5 * 60 * 1000);
    });
  });

  // -------------------------------------------------------------------------
  // forceCleanAll()
  // -------------------------------------------------------------------------

  describe("forceCleanAll()", () => {
    it("should clear all states across all categories", () => {
      service.startTask("t-1");
      service.startTask("t-2");
      service.startWorkflow("w-1");
      service.startRevision("r-1");

      expect(service.getStats().totalActive).toBe(4);

      service.forceCleanAll();

      expect(service.getStats().totalActive).toBe(0);
      expect(service.getActiveIds(StateCategory.TASK)).toEqual([]);
      expect(service.getActiveIds(StateCategory.WORKFLOW)).toEqual([]);
      expect(service.getActiveIds(StateCategory.REVISION)).toEqual([]);
    });

    it("should be a no-op when nothing is tracked", () => {
      expect(() => service.forceCleanAll()).not.toThrow();
      expect(service.getStats().totalActive).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Auto-cleanup of expired states
  // -------------------------------------------------------------------------

  describe("auto-cleanup (expired states)", () => {
    it("should remove states that have exceeded the TTL after the cleanup interval fires", () => {
      // Start a task, then advance past the 30-minute TTL
      service.startTask("old-task");

      // Move past TTL (30 min) + one cleanup interval (5 min)
      jest.advanceTimersByTime(31 * 60 * 1000);

      // Trigger the cleanup scheduler manually (the service's init starts it)
      void service.onModuleInit();
      jest.advanceTimersByTime(5 * 60 * 1000);

      expect(service.isTaskExecuting("old-task")).toBe(false);
    });

    it("should NOT remove states within the TTL period", () => {
      service.startTask("fresh-task");

      // Advance only 20 minutes (under the 30-minute TTL)
      jest.advanceTimersByTime(20 * 60 * 1000);

      void service.onModuleInit();
      jest.advanceTimersByTime(5 * 60 * 1000);

      expect(service.isTaskExecuting("fresh-task")).toBe(true);
    });

    it("triggerCleanup() should return before and after stats", () => {
      service.startTask("expiring-task");

      // Push the state past TTL so cleanup will remove it
      jest.advanceTimersByTime(31 * 60 * 1000);

      const { before, after } = service.triggerCleanup();

      expect(before.totalActive).toBe(1);
      expect(after.totalActive).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // healthCheck()  — requires Prisma
  // -------------------------------------------------------------------------

  describe("healthCheck()", () => {
    let prismaService: ProcessSupervisorService;

    beforeEach(async () => {
      // Rebuild with Prisma injected
      const module = await buildModule(true);
      prismaService = module.get<ProcessSupervisorService>(
        ProcessSupervisorService,
      );
      // Trigger onModuleInit so that dbTableReady and dbMemoryTableReady are
      // populated via $queryRawUnsafe (both return [{ exists: true }] by default)
      await prismaService.onModuleInit();
    });

    afterEach(() => {
      prismaService.onModuleDestroy();
    });

    it("should mark timed-out RUNNING processes as FAILED", async () => {
      const timedOutProcess = {
        id: "proc-timeout",
        agentId: "agent-1",
        updatedAt: new Date(Date.now() - 31 * 60 * 1000),
      };
      const _noZombies = {
        id: "proc-zombie",
        agentId: "agent-2",
        startedAt: new Date(),
      };

      // First findMany = timed out; second findMany = zombies
      mockPrisma.agentProcess.findMany
        .mockResolvedValueOnce([timedOutProcess])
        .mockResolvedValueOnce([]);
      mockPrisma.processMemory.deleteMany.mockResolvedValue({ count: 0 });

      await prismaService.healthCheck();

      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "proc-timeout" },
          data: expect.objectContaining({
            state: "FAILED",
            error: expect.stringContaining("timed out"),
          }),
        }),
      );
    });

    it("should mark zombie processes (RUNNING too long) as ZOMBIE", async () => {
      const zombieProcess = {
        id: "proc-zombie",
        agentId: "agent-z",
        startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      };

      // First findMany (timeouts) = empty; second (zombies) = zombie
      mockPrisma.agentProcess.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([zombieProcess]);
      mockPrisma.processMemory.deleteMany.mockResolvedValue({ count: 0 });

      await prismaService.healthCheck();

      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "proc-zombie" },
          data: { state: "ZOMBIE" },
        }),
      );
    });

    it("should delete expired processMemory records", async () => {
      mockPrisma.agentProcess.findMany.mockResolvedValue([]);
      mockPrisma.processMemory.deleteMany.mockResolvedValue({ count: 5 });

      await prismaService.healthCheck();

      expect(mockPrisma.processMemory.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });

    it("should not throw when Prisma is not injected (prisma is undefined)", async () => {
      // The base service built without Prisma should skip healthCheck silently
      await expect(service.healthCheck()).resolves.toBeUndefined();
    });

    it("should handle Prisma errors gracefully and not propagate them", async () => {
      mockPrisma.agentProcess.findMany.mockRejectedValue(new Error("DB error"));

      await expect(prismaService.healthCheck()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // recoverOnStartup()  — requires Prisma
  // -------------------------------------------------------------------------

  describe("recoverOnStartup()", () => {
    let prismaService: ProcessSupervisorService;

    beforeEach(async () => {
      const module = await buildModule(true);
      prismaService = module.get<ProcessSupervisorService>(
        ProcessSupervisorService,
      );
    });

    afterEach(() => {
      prismaService.onModuleDestroy();
    });

    it("should transition stale processes WITH a checkpoint to READY", async () => {
      const staleProcWithCheckpoint = {
        id: "proc-recoverable",
        state: "RUNNING",
        agentId: "agent-1",
        checkpoint: { step: 3, data: {} },
      };
      mockPrisma.agentProcess.findMany.mockResolvedValue([
        staleProcWithCheckpoint,
      ]);

      await prismaService.recoverOnStartup();

      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledWith({
        where: { id: "proc-recoverable" },
        data: { state: "READY" },
      });
    });

    it("should transition stale processes WITHOUT a checkpoint to FAILED", async () => {
      const staleProcNoCheckpoint = {
        id: "proc-lost",
        state: "RUNNING",
        agentId: "agent-2",
        checkpoint: null,
      };
      mockPrisma.agentProcess.findMany.mockResolvedValue([
        staleProcNoCheckpoint,
      ]);

      await prismaService.recoverOnStartup();

      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledWith({
        where: { id: "proc-lost" },
        data: expect.objectContaining({
          state: "FAILED",
          error: expect.stringContaining("checkpoint"),
          completedAt: expect.any(Date),
        }),
      });
    });

    it("should handle both recoverable and unrecoverable processes in the same batch", async () => {
      const withCheckpoint = {
        id: "proc-ok",
        state: "RUNNING",
        agentId: "a1",
        checkpoint: { resumed: true },
      };
      const noCheckpoint = {
        id: "proc-bad",
        state: "WAITING",
        agentId: "a2",
        checkpoint: null,
      };
      mockPrisma.agentProcess.findMany.mockResolvedValue([
        withCheckpoint,
        noCheckpoint,
      ]);

      await prismaService.recoverOnStartup();

      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledTimes(2);

      const calls = mockPrisma.agentProcess.updateMany.mock.calls as Array<
        [{ where: { id: string }; data: Record<string, unknown> }]
      >;
      const readyCall = calls.find((c) => c[0].where.id === "proc-ok");
      const failedCall = calls.find((c) => c[0].where.id === "proc-bad");

      expect(readyCall![0].data).toEqual({ state: "READY" });
      expect(failedCall![0].data).toMatchObject({ state: "FAILED" });
    });

    it("should do nothing when there are no stale processes", async () => {
      mockPrisma.agentProcess.findMany.mockResolvedValue([]);

      await prismaService.recoverOnStartup();

      expect(mockPrisma.agentProcess.updateMany).not.toHaveBeenCalled();
    });

    it("should not throw when Prisma is not injected", async () => {
      await expect(service.recoverOnStartup()).resolves.toBeUndefined();
    });

    it("should handle Prisma errors gracefully and not propagate them", async () => {
      mockPrisma.agentProcess.findMany.mockRejectedValue(
        new Error("Connection refused"),
      );

      await expect(prismaService.recoverOnStartup()).resolves.toBeUndefined();
    });

    it("should query for both RUNNING and WAITING stale processes", async () => {
      mockPrisma.agentProcess.findMany.mockResolvedValue([]);

      await prismaService.recoverOnStartup();

      expect(mockPrisma.agentProcess.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { state: { in: ["RUNNING", "WAITING"] } },
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // configure()
  // -------------------------------------------------------------------------

  describe("configure()", () => {
    it("should update ttlMs", () => {
      service.configure({ ttlMs: 60000 });
      expect(service.getStats().config.ttlMs).toBe(60000);
    });

    it("should update cleanupIntervalMs", () => {
      service.configure({ cleanupIntervalMs: 120000 });
      expect(service.getStats().config.cleanupIntervalMs).toBe(120000);
    });

    it("should restart the cleanup scheduler when enableAutoCleanup is toggled back on", () => {
      const setIntervalSpy = jest.spyOn(global, "setInterval");
      service.configure({ enableAutoCleanup: false });
      setIntervalSpy.mockClear();
      service.configure({ enableAutoCleanup: true });
      expect(setIntervalSpy).toHaveBeenCalled();
    });

    it("should stop the cleanup scheduler when enableAutoCleanup is set to false", () => {
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");
      void service.onModuleInit(); // ensure scheduler is running
      clearIntervalSpy.mockClear();
      service.configure({ enableAutoCleanup: false });
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it("should accept multiple config fields at once", () => {
      service.configure({ ttlMs: 90000, cleanupIntervalMs: 30000 });
      const stats = service.getStats();
      expect(stats.config.ttlMs).toBe(90000);
      expect(stats.config.cleanupIntervalMs).toBe(30000);
    });
  });

  // -------------------------------------------------------------------------
  // getActiveStates() / getActiveIds()
  // -------------------------------------------------------------------------

  describe("getActiveStates()", () => {
    it("should return the Map of all active states for a category", () => {
      service.startTask("t-1");
      service.startTask("t-2");

      const states = service.getActiveStates(StateCategory.TASK);
      expect(states).toBeDefined();
      expect(states!.size).toBe(2);
      expect(states!.get("t-1")).toBeDefined();
    });

    it("should return undefined for a category that has never been used", () => {
      expect(
        service.getActiveStates("never-used" as StateCategory),
      ).toBeUndefined();
    });
  });

  describe("getActiveIds()", () => {
    it("should return all active IDs for a category", () => {
      service.startTask("t-1");
      service.startTask("t-2");

      const ids = service.getActiveIds(StateCategory.TASK);
      expect(ids).toContain("t-1");
      expect(ids).toContain("t-2");
    });

    it("should return empty array for a category that does not exist", () => {
      expect(service.getActiveIds("ghost" as StateCategory)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Legacy compatibility methods
  // -------------------------------------------------------------------------

  describe("legacy compatibility methods", () => {
    it("getExecutingTaskIds() should return all active TASK ids", () => {
      service.startTask("t-a");
      service.startTask("t-b");
      const ids = service.getExecutingTaskIds();
      expect(ids).toContain("t-a");
      expect(ids).toContain("t-b");
    });

    it("getExecutingMissionIds() should return all active WORKFLOW ids", () => {
      service.startWorkflow("w-1");
      service.startWorkflow("w-2");
      const ids = service.getExecutingMissionIds();
      expect(ids).toContain("w-1");
      expect(ids).toContain("w-2");
    });

    it("getRevisingTaskIds() should return all active REVISION ids", () => {
      service.startRevision("r-1");
      const ids = service.getRevisingTaskIds();
      expect(ids).toContain("r-1");
    });
  });

  // -------------------------------------------------------------------------
  // clearCategory()
  // -------------------------------------------------------------------------

  describe("clearCategory()", () => {
    it("should clear only the specified category and leave others intact", () => {
      service.startTask("t-1");
      service.startTask("t-2");
      service.startWorkflow("w-1");

      service.clearCategory(StateCategory.TASK);

      expect(service.getActiveIds(StateCategory.TASK)).toEqual([]);
      expect(service.getActiveIds(StateCategory.WORKFLOW)).toHaveLength(1);
    });

    it("should be a no-op for a non-existent category", () => {
      expect(() =>
        service.clearCategory("non-existent" as StateCategory),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Redis dual-write (CacheService integration)
  // -------------------------------------------------------------------------

  describe("Redis dual-write", () => {
    it("should call cacheService.set() when a state is started", () => {
      service.start(StateCategory.TASK, "t-redis", "Test");

      expect(mockCacheService.set).toHaveBeenCalledWith(
        "ai:state:task:t-redis",
        expect.objectContaining({ description: "Test" }),
        expect.any(Number),
      );
    });

    it("should call cacheService.del() when a state is finished", () => {
      service.start(StateCategory.TASK, "t-redis");
      mockCacheService.set.mockClear();

      service.finish(StateCategory.TASK, "t-redis");

      expect(mockCacheService.del).toHaveBeenCalledWith(
        "ai:state:task:t-redis",
      );
    });

    it("should work correctly in memory-only mode when CacheService is not provided", async () => {
      // Build without CacheService
      const module = await Test.createTestingModule({
        providers: [ProcessSupervisorService],
      }).compile();
      const noRedisService = module.get<ProcessSupervisorService>(
        ProcessSupervisorService,
      );

      expect(() =>
        noRedisService.start(StateCategory.TASK, "t-1"),
      ).not.toThrow();
      expect(noRedisService.isActive(StateCategory.TASK, "t-1")).toBe(true);
      noRedisService.finish(StateCategory.TASK, "t-1");
      expect(noRedisService.isActive(StateCategory.TASK, "t-1")).toBe(false);

      noRedisService.onModuleDestroy();
    });
  });
});
