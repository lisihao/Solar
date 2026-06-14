/**
 * AutoDreamSchedulerService 单元测试
 */
import { AutoDreamSchedulerService } from "../memory-consolidation-scheduler.service";

describe("AutoDreamSchedulerService", () => {
  let service: AutoDreamSchedulerService;

  const mockDreamResult = {
    phasesCompleted: ["consolidation"],
    itemsProcessed: 5,
    itemsConsolidated: 3,
    itemsPruned: 2,
    durationMs: 100,
  };

  const mockAutoDreamService = {
    execute: jest.fn().mockResolvedValue(mockDreamResult),
    shouldRun: jest.fn().mockReturnValue(false),
    recordCompletedSession: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    service = new AutoDreamSchedulerService(mockAutoDreamService as never);
    // Enable by default so existing onModuleInit tests cover the start() path.
    process.env.ENABLE_MEMORY_CONSOLIDATION = "true";
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    delete process.env.ENABLE_MEMORY_CONSOLIDATION;
  });

  describe("onModuleInit / lifecycle", () => {
    it("should start scheduler on module init", () => {
      service.onModuleInit();
      const stats = service.getStats();
      // Timer should be running (lastCheckAt is null until first tick)
      expect(stats.lastCheckAt).toBeNull();
    });

    it("should stop scheduler on module destroy", () => {
      service.onModuleInit();
      service.onModuleDestroy();
      // Calling destroy again should be safe
      service.onModuleDestroy();
    });
  });

  describe("start / stop", () => {
    it("should not start twice (idempotent)", () => {
      service.start();
      service.start(); // second call should be no-op
      // No errors thrown
    });

    it("should allow restart after stop", () => {
      service.start();
      service.stop();
      service.start(); // Should restart without error
    });

    it("should stop timer when stop() is called", () => {
      service.start();
      service.stop();
      const stats = service.getStats();
      // After stop, timer is null internally
      expect(stats).toBeDefined();
    });

    it("should accept custom pollIntervalMs config", () => {
      service.start({ pollIntervalMs: 5000 });
      // Should not throw
      service.stop();
    });
  });

  describe("register / deregister", () => {
    it("should register a scope", () => {
      service.register({
        scopeId: "scope-1",
        getEntries: jest.fn().mockResolvedValue([]),
      });
      const stats = service.getStats();
      expect(stats.registeredScopes).toBe(1);
    });

    it("should replace existing scope on re-register", () => {
      service.register({
        scopeId: "scope-1",
        getEntries: jest.fn().mockResolvedValue([]),
      });
      service.register({
        scopeId: "scope-1",
        getEntries: jest.fn().mockResolvedValue([]),
      });
      expect(service.getStats().registeredScopes).toBe(1);
    });

    it("should deregister a scope", () => {
      service.register({
        scopeId: "scope-1",
        getEntries: jest.fn().mockResolvedValue([]),
      });
      service.deregister("scope-1");
      expect(service.getStats().registeredScopes).toBe(0);
    });

    it("should handle deregister of non-existent scope gracefully", () => {
      service.deregister("nonexistent");
      expect(service.getStats().registeredScopes).toBe(0);
    });

    it("should track multiple registered scopes", () => {
      service.register({
        scopeId: "scope-1",
        getEntries: jest.fn().mockResolvedValue([]),
      });
      service.register({
        scopeId: "scope-2",
        getEntries: jest.fn().mockResolvedValue([]),
      });
      service.register({
        scopeId: "scope-3",
        getEntries: jest.fn().mockResolvedValue([]),
      });
      expect(service.getStats().registeredScopes).toBe(3);
    });
  });

  describe("notifySessionCompleted", () => {
    it("should call recordCompletedSession on autoDreamService", () => {
      service.notifySessionCompleted("scope-1");
      expect(mockAutoDreamService.recordCompletedSession).toHaveBeenCalledWith(
        "scope-1",
      );
    });

    it("should auto-register scope if not already registered", () => {
      service.notifySessionCompleted("new-scope");
      expect(service.getStats().registeredScopes).toBe(1);
    });

    it("should not double-register if scope already registered", () => {
      service.register({
        scopeId: "scope-1",
        getEntries: jest.fn().mockResolvedValue([]),
      });
      service.notifySessionCompleted("scope-1");
      expect(service.getStats().registeredScopes).toBe(1);
    });
  });

  describe("triggerNow", () => {
    it("should return null for unknown scope", async () => {
      const result = await service.triggerNow("unknown-scope");
      expect(result).toBeNull();
    });

    it("should execute dream for registered scope", async () => {
      const getEntries = jest
        .fn()
        .mockResolvedValue([{ key: "k1", value: "v1", sessionId: "s1" }]);
      service.register({ scopeId: "scope-1", getEntries });

      const result = await service.triggerNow("scope-1");

      expect(mockAutoDreamService.execute).toHaveBeenCalledWith(
        "scope-1",
        [{ key: "k1", value: "v1", sessionId: "s1" }],
        undefined,
        undefined,
      );
      expect(result).toBe(mockDreamResult);
    });

    it("should return empty DreamResult if getEntries throws", async () => {
      service.register({
        scopeId: "failing-scope",
        getEntries: jest.fn().mockRejectedValue(new Error("fetch failed")),
      });

      const result = await service.triggerNow("failing-scope");

      expect(result).toEqual({
        phasesCompleted: [],
        itemsProcessed: 0,
        itemsConsolidated: 0,
        itemsPruned: 0,
        durationMs: 0,
      });
    });

    it("should pass consolidateFn if provided", async () => {
      const consolidateFn = jest
        .fn()
        .mockResolvedValue({ key: "k", value: "v" });
      service.register({
        scopeId: "scope-cf",
        getEntries: jest.fn().mockResolvedValue([]),
        consolidateFn,
      });

      await service.triggerNow("scope-cf");

      expect(mockAutoDreamService.execute).toHaveBeenCalledWith(
        "scope-cf",
        [],
        consolidateFn,
        undefined,
      );
    });

    it("should pass dreamConfig to execute", async () => {
      service.register({
        scopeId: "scope-1",
        getEntries: jest.fn().mockResolvedValue([]),
      });
      const dreamConfig = { minEntriesForDream: 5 };

      await service.triggerNow("scope-1", dreamConfig);

      expect(mockAutoDreamService.execute).toHaveBeenCalledWith(
        "scope-1",
        [],
        undefined,
        dreamConfig,
      );
    });
  });

  describe("tick (via timer)", () => {
    it("should update lastCheckAt when tick fires", async () => {
      service.start({ pollIntervalMs: 1000 });
      jest.advanceTimersByTime(1000);
      await Promise.resolve(); // let async tick run
      const stats = service.getStats();
      expect(stats.lastCheckAt).toBeInstanceOf(Date);
    });

    it("should trigger dream for scope that passes shouldRun gate", async () => {
      mockAutoDreamService.shouldRun.mockReturnValue(true);
      service.register({
        scopeId: "active-scope",
        getEntries: jest.fn().mockResolvedValue([]),
      });
      service.start({ pollIntervalMs: 1000 });

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockAutoDreamService.execute).toHaveBeenCalled();
    });

    it("should not trigger dream when shouldRun returns false", async () => {
      mockAutoDreamService.shouldRun.mockReturnValue(false);
      service.register({
        scopeId: "inactive-scope",
        getEntries: jest.fn().mockResolvedValue([]),
      });
      service.start({ pollIntervalMs: 1000 });

      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(mockAutoDreamService.execute).not.toHaveBeenCalled();
    });
  });

  describe("getStats", () => {
    it("should return copy of stats", () => {
      const stats1 = service.getStats();
      const stats2 = service.getStats();
      expect(stats1).toEqual(stats2);
      expect(stats1).not.toBe(stats2); // different object references
    });

    it("should initialize with zero counts and null lastCheckAt", () => {
      const stats = service.getStats();
      expect(stats.registeredScopes).toBe(0);
      expect(stats.totalRunsTriggered).toBe(0);
      expect(stats.lastCheckAt).toBeNull();
    });
  });

  // ── ENABLE_MEMORY_CONSOLIDATION env gate ─────────────────────────────────────

  describe("ENABLE_MEMORY_CONSOLIDATION env gate", () => {
    it("does NOT arm the poll interval when flag is unset (default OFF)", () => {
      delete process.env.ENABLE_MEMORY_CONSOLIDATION;
      const setIntSpy = jest.spyOn(global, "setInterval");

      service.onModuleInit();

      // pollTimer must remain null — no interval armed
      expect(setIntSpy).not.toHaveBeenCalled();
      setIntSpy.mockRestore();
    });

    it("does NOT arm the poll interval when flag is 'false'", () => {
      process.env.ENABLE_MEMORY_CONSOLIDATION = "false";
      const setIntSpy = jest.spyOn(global, "setInterval");

      service.onModuleInit();

      expect(setIntSpy).not.toHaveBeenCalled();
      setIntSpy.mockRestore();
    });

    it("arms the poll interval when flag is 'true' (opt-in)", () => {
      // flag already set to 'true' by beforeEach
      const setIntSpy = jest
        .spyOn(global, "setInterval")
        .mockReturnValue({ unref: jest.fn() } as never);

      service.onModuleInit();

      expect(setIntSpy).toHaveBeenCalled();
      setIntSpy.mockRestore();
    });

    it("tick does NOT fire for any scope when poll interval was not armed", async () => {
      delete process.env.ENABLE_MEMORY_CONSOLIDATION;
      mockAutoDreamService.shouldRun.mockReturnValue(true);
      service.register({
        scopeId: "scope-blocked",
        getEntries: jest.fn().mockResolvedValue([]),
      });

      service.onModuleInit();

      // Advance time — if interval were armed, execute would be called
      jest.advanceTimersByTime(60 * 60 * 1000 + 1);
      await Promise.resolve();

      expect(mockAutoDreamService.execute).not.toHaveBeenCalled();
    });
  });
});
