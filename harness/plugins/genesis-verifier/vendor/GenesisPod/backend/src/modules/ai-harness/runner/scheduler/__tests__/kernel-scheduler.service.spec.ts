/**
 * KernelSchedulerService Unit Tests
 *
 * Covers: scheduleNext(), getStats(), lifecycle (onModuleInit / onModuleDestroy)
 *
 * Uses jest.useFakeTimers() to control setInterval without waiting for real clock.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { KernelSchedulerService } from "../kernel-scheduler.service";
import { PrismaService } from "@/common/prisma/prisma.service";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockPrisma() {
  return {
    agentProcess: {
      count: jest.fn(),
      updateMany: jest.fn(),
      groupBy: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $queryRawUnsafe: jest.fn(),
  };
}

function makeMockConfigService(overrides: Record<string, number> = {}) {
  const defaults: Record<string, number> = {
    KERNEL_MAX_CONCURRENT: 50,
    KERNEL_MAX_PER_TENANT: 10,
    KERNEL_SCHEDULE_INTERVAL_MS: 1000,
    ...overrides,
  };
  return {
    get: jest.fn().mockImplementation((key: string, fallback: number) => {
      return defaults[key] ?? fallback;
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("KernelSchedulerService", () => {
  let service: KernelSchedulerService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let mockConfigService: ReturnType<typeof makeMockConfigService>;

  beforeEach(async () => {
    jest.useFakeTimers();

    mockPrisma = makeMockPrisma();
    mockConfigService = makeMockConfigService();

    // Safe defaults — no running processes, no ready processes
    mockPrisma.agentProcess.count.mockResolvedValue(0);
    // checkTableExists uses $queryRaw(Prisma.sql`...`) — always return exists: true
    mockPrisma.$queryRaw.mockResolvedValue([{ exists: true }]);
    // scheduleNext uses $queryRawUnsafe for FOR UPDATE SKIP LOCKED
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    mockPrisma.agentProcess.groupBy.mockResolvedValue([]);
    mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KernelSchedulerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<KernelSchedulerService>(KernelSchedulerService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    // Initialize service (probes table existence, starts scheduler)
    await service.onModuleInit();
    // Clear call counts from init so individual tests start clean
    mockPrisma.$queryRawUnsafe.mockClear();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // scheduleNext()
  // -------------------------------------------------------------------------

  describe("scheduleNext()", () => {
    it("should schedule READY processes and return their IDs", async () => {
      // 0 running, 2 ready
      mockPrisma.agentProcess.count.mockResolvedValue(0);
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { id: "proc-A", user_id: "user-1" },
        { id: "proc-B", user_id: "user-2" },
      ]);
      mockPrisma.agentProcess.groupBy.mockResolvedValue([]);
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 1 });

      const scheduled = await service.scheduleNext();

      expect(scheduled).toContain("proc-A");
      expect(scheduled).toContain("proc-B");
      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledTimes(2);
    });

    it("should respect the global maxConcurrent limit and return empty when at capacity", async () => {
      // Already at max (50 running, max is 50)
      mockPrisma.agentProcess.count.mockResolvedValue(50);

      const scheduled = await service.scheduleNext();

      expect(scheduled).toEqual([]);
      // Should not even query READY processes
      expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it("should only schedule up to (maxConcurrent - running) slots", async () => {
      // 48 running, max 50 → 2 slots
      mockPrisma.agentProcess.count.mockResolvedValue(48);
      // Raw query returns 3 ready processes, but only 2 slots available
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { id: "proc-A", user_id: "user-1" },
        { id: "proc-B", user_id: "user-2" },
        { id: "proc-C", user_id: "user-3" },
      ]);
      mockPrisma.agentProcess.groupBy.mockResolvedValue([]);
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 1 });

      await service.scheduleNext();

      // The raw SQL query should be called with limit=2
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("LIMIT"),
        2,
      );
    });

    it("should respect the per-tenant maxPerTenant limit and skip tenants at capacity", async () => {
      // user-1 is already running 10 processes (= maxPerTenant)
      mockPrisma.agentProcess.count.mockResolvedValue(10);
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { id: "proc-A", user_id: "user-1" }, // user-1 at capacity → skip
        { id: "proc-B", user_id: "user-2" }, // user-2 has room → schedule
      ]);
      mockPrisma.agentProcess.groupBy.mockResolvedValue([
        { userId: "user-1", _count: 10 }, // user-1 is maxed out
      ]);
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 1 });

      const scheduled = await service.scheduleNext();

      expect(scheduled).not.toContain("proc-A");
      expect(scheduled).toContain("proc-B");
      // Only proc-B should be updated
      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "proc-B", state: "READY" } }),
      );
    });

    it("should return empty array when no READY processes exist", async () => {
      mockPrisma.agentProcess.count.mockResolvedValue(5);
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      const scheduled = await service.scheduleNext();

      expect(scheduled).toEqual([]);
      expect(mockPrisma.agentProcess.updateMany).not.toHaveBeenCalled();
    });

    it("should handle race conditions gracefully — skipping processes that fail to update", async () => {
      mockPrisma.agentProcess.count.mockResolvedValue(0);
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { id: "proc-A", user_id: "user-1" },
        { id: "proc-B", user_id: "user-2" },
      ]);
      mockPrisma.agentProcess.groupBy.mockResolvedValue([]);

      // proc-A: updateMany returns count=0 (race: already picked by another scheduler)
      // proc-B: updateMany returns count=1 (success)
      mockPrisma.agentProcess.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      const scheduled = await service.scheduleNext();

      expect(scheduled).not.toContain("proc-A");
      expect(scheduled).toContain("proc-B");
    });

    it("should return empty array and log error when a top-level DB error occurs", async () => {
      mockPrisma.agentProcess.count.mockRejectedValue(
        new Error("DB connection lost"),
      );

      const scheduled = await service.scheduleNext();

      expect(scheduled).toEqual([]);
    });

    it("should update process state to RUNNING with a startedAt timestamp", async () => {
      mockPrisma.agentProcess.count.mockResolvedValue(0);
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { id: "proc-X", user_id: "user-5" },
      ]);
      mockPrisma.agentProcess.groupBy.mockResolvedValue([]);
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 1 });

      await service.scheduleNext();

      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledWith({
        where: { id: "proc-X", state: "READY" },
        data: { state: "RUNNING", startedAt: expect.any(Date) },
      });
    });

    it("should accumulate per-tenant counts correctly across multiple scheduled processes", async () => {
      // maxPerTenant = 10; user-1 starts with 9 running → can add 1 more
      mockPrisma.agentProcess.count.mockResolvedValue(9);
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        { id: "proc-A", user_id: "user-1" },
        { id: "proc-B", user_id: "user-1" }, // second for same tenant — over limit after first
      ]);
      mockPrisma.agentProcess.groupBy.mockResolvedValue([
        { userId: "user-1", _count: 9 },
      ]);
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 1 });

      const scheduled = await service.scheduleNext();

      // Only the first one for user-1 should be scheduled
      expect(scheduled).toContain("proc-A");
      expect(scheduled).not.toContain("proc-B");
    });
  });

  // -------------------------------------------------------------------------
  // getStats()
  // -------------------------------------------------------------------------

  describe("getStats()", () => {
    it("should return running and ready counts from the database plus configured limits", async () => {
      mockPrisma.agentProcess.count
        .mockResolvedValueOnce(12) // RUNNING
        .mockResolvedValueOnce(5); // READY

      const stats = await service.getStats();

      expect(stats.running).toBe(12);
      expect(stats.ready).toBe(5);
      expect(stats.maxConcurrent).toBe(50);
      expect(stats.maxPerTenant).toBe(10);
    });

    it("should query running and ready counts concurrently", async () => {
      const callOrder: string[] = [];
      mockPrisma.agentProcess.count.mockImplementation(
        ({ where }: { where: { state: string } }) => {
          callOrder.push(where.state);
          return Promise.resolve(0);
        },
      );

      await service.getStats();

      // Both queries should be fired (order may vary due to Promise.all)
      expect(callOrder).toContain("RUNNING");
      expect(callOrder).toContain("READY");
      expect(mockPrisma.agentProcess.count).toHaveBeenCalledTimes(2);
    });

    it("should reflect custom config values when service is built with non-default config", async () => {
      const customConfig = makeMockConfigService({
        KERNEL_MAX_CONCURRENT: 20,
        KERNEL_MAX_PER_TENANT: 3,
      });

      mockPrisma.agentProcess.count.mockResolvedValue(0);

      const customModule: TestingModule = await Test.createTestingModule({
        providers: [
          KernelSchedulerService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: customConfig },
        ],
      }).compile();

      const customService = customModule.get<KernelSchedulerService>(
        KernelSchedulerService,
      );
      customService.onModuleDestroy();

      const stats = await customService.getStats();

      expect(stats.maxConcurrent).toBe(20);
      expect(stats.maxPerTenant).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Lifecycle: onModuleInit / onModuleDestroy
  // -------------------------------------------------------------------------

  describe("lifecycle", () => {
    it("should start the scheduler interval on onModuleInit", async () => {
      const setIntervalSpy = jest.spyOn(global, "setInterval");

      await service.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        1000, // KERNEL_SCHEDULE_INTERVAL_MS default
      );
    });

    it("should call scheduleNext automatically when the scheduler interval fires", async () => {
      const scheduleNextSpy = jest
        .spyOn(service, "scheduleNext")
        .mockResolvedValue([]);

      await service.onModuleInit();

      // Advance past one interval tick
      jest.advanceTimersByTime(1000);

      // Allow microtasks to flush
      await Promise.resolve();

      expect(scheduleNextSpy).toHaveBeenCalled();
    });

    it("should stop the scheduler interval on onModuleDestroy", async () => {
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");

      await service.onModuleInit();
      service.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it("should not fire scheduleNext after onModuleDestroy is called", async () => {
      const scheduleNextSpy = jest
        .spyOn(service, "scheduleNext")
        .mockResolvedValue([]);

      await service.onModuleInit();
      service.onModuleDestroy();

      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(scheduleNextSpy).not.toHaveBeenCalled();
    });

    it("should clear any existing interval before starting a new one (idempotent init)", async () => {
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");

      await service.onModuleInit();
      await service.onModuleInit(); // second call

      // Should clear the first interval before setting a new one
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it("should not start scheduler when table does not exist", async () => {
      // Build a new service instance where the table doesn't exist
      const noTablePrisma = makeMockPrisma();
      noTablePrisma.$queryRaw.mockResolvedValue([{ exists: false }]);
      noTablePrisma.agentProcess.count.mockResolvedValue(0);

      const noTableModule = await Test.createTestingModule({
        providers: [
          KernelSchedulerService,
          { provide: PrismaService, useValue: noTablePrisma },
          { provide: ConfigService, useValue: makeMockConfigService() },
        ],
      }).compile();

      const noTableService = noTableModule.get<KernelSchedulerService>(
        KernelSchedulerService,
      );

      const setIntervalSpy = jest.spyOn(global, "setInterval");
      const initialCallCount = setIntervalSpy.mock.calls.length;

      await noTableService.onModuleInit();

      // setInterval should NOT have been called for this new service instance
      expect(setIntervalSpy.mock.calls.length).toBe(initialCallCount);

      noTableService.onModuleDestroy();
    });

    it("onModuleDestroy() should be a no-op when scheduler was never started (null interval)", async () => {
      // Build a service where no scheduler was started (table doesn't exist)
      const noTablePrisma = makeMockPrisma();
      noTablePrisma.$queryRaw.mockResolvedValue([{ exists: false }]);
      noTablePrisma.agentProcess.count.mockResolvedValue(0);

      const noTableModule = await Test.createTestingModule({
        providers: [
          KernelSchedulerService,
          { provide: PrismaService, useValue: noTablePrisma },
          { provide: ConfigService, useValue: makeMockConfigService() },
        ],
      }).compile();

      const noTableService = noTableModule.get<KernelSchedulerService>(
        KernelSchedulerService,
      );

      await noTableService.onModuleInit();

      // Should not throw even though schedulerInterval is null
      expect(() => noTableService.onModuleDestroy()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // getStats() — tableExists = false branch
  // -------------------------------------------------------------------------

  describe("getStats() — when table does not exist", () => {
    it("should return zeroed stats with configured limits when table is not available", async () => {
      // Build a service where table check returns false
      const noTablePrisma = makeMockPrisma();
      noTablePrisma.$queryRaw.mockResolvedValue([{ exists: false }]);
      noTablePrisma.agentProcess.count.mockResolvedValue(0);

      const customConfig = makeMockConfigService({
        KERNEL_MAX_CONCURRENT: 30,
        KERNEL_MAX_PER_TENANT: 5,
      });

      const noTableModule = await Test.createTestingModule({
        providers: [
          KernelSchedulerService,
          { provide: PrismaService, useValue: noTablePrisma },
          { provide: ConfigService, useValue: customConfig },
        ],
      }).compile();

      const noTableService = noTableModule.get<KernelSchedulerService>(
        KernelSchedulerService,
      );
      await noTableService.onModuleInit();

      const stats = await noTableService.getStats();

      expect(stats.running).toBe(0);
      expect(stats.ready).toBe(0);
      expect(stats.maxConcurrent).toBe(30);
      expect(stats.maxPerTenant).toBe(5);

      // Should NOT have queried the DB when table doesn't exist
      expect(noTablePrisma.agentProcess.count).not.toHaveBeenCalled();

      noTableService.onModuleDestroy();
    });
  });

  // -------------------------------------------------------------------------
  // scheduleNext() — tableExists = false branch
  // -------------------------------------------------------------------------

  describe("scheduleNext() — when table does not exist", () => {
    it("should return empty array without hitting the DB when table is not available", async () => {
      const noTablePrisma = makeMockPrisma();
      noTablePrisma.$queryRaw.mockResolvedValue([{ exists: false }]);
      noTablePrisma.agentProcess.count.mockResolvedValue(0);

      const noTableModule = await Test.createTestingModule({
        providers: [
          KernelSchedulerService,
          { provide: PrismaService, useValue: noTablePrisma },
          { provide: ConfigService, useValue: makeMockConfigService() },
        ],
      }).compile();

      const noTableService = noTableModule.get<KernelSchedulerService>(
        KernelSchedulerService,
      );
      await noTableService.onModuleInit();

      // Clear the call from onModuleInit table check
      noTablePrisma.$queryRaw.mockClear();

      const result = await noTableService.scheduleNext();

      expect(result).toEqual([]);
      expect(noTablePrisma.agentProcess.count).not.toHaveBeenCalled();
      expect(noTablePrisma.$queryRawUnsafe).not.toHaveBeenCalled();

      noTableService.onModuleDestroy();
    });
  });

  // -------------------------------------------------------------------------
  // checkTableExists() — catch branch (returns false on DB error)
  // -------------------------------------------------------------------------

  describe("checkTableExists() — error handling", () => {
    it("should disable the scheduler when $queryRaw throws during table check", async () => {
      const errorPrisma = makeMockPrisma();
      errorPrisma.$queryRaw.mockRejectedValue(
        new Error("DB connection refused"),
      );
      errorPrisma.agentProcess.count.mockResolvedValue(0);

      const errorModule = await Test.createTestingModule({
        providers: [
          KernelSchedulerService,
          { provide: PrismaService, useValue: errorPrisma },
          { provide: ConfigService, useValue: makeMockConfigService() },
        ],
      }).compile();

      const errorService = errorModule.get<KernelSchedulerService>(
        KernelSchedulerService,
      );

      await errorService.onModuleInit();

      // Table check threw → tableExists = false → scheduleNext returns []
      errorPrisma.$queryRawUnsafe.mockClear();
      const result = await errorService.scheduleNext();

      expect(result).toEqual([]);
      expect(errorPrisma.agentProcess.count).not.toHaveBeenCalled();

      errorService.onModuleDestroy();
    });
  });
});
