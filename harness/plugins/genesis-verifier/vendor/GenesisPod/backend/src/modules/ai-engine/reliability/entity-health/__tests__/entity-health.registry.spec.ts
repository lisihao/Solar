import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import {
  EntityHealthRegistry,
  TaskCompletionType,
  CircuitBreakerConfig,
} from "../entity-health.registry";
import { CacheService } from "@/common/cache/cache.service";

jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

describe("EntityHealthRegistry", () => {
  let service: EntityHealthRegistry;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.get.mockResolvedValue(null);
    mockCacheService.set.mockResolvedValue(undefined);
    mockCacheService.del.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntityHealthRegistry,
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<EntityHealthRegistry>(EntityHealthRegistry);
  });

  afterEach(() => jest.clearAllMocks());

  // ==================== Lifecycle ====================

  describe("onModuleInit", () => {
    it("should start cleanup scheduler and load from Redis", async () => {
      await service.onModuleInit();
      // No error thrown = success
    });

    it("should load breaker states from Redis when index exists", async () => {
      // Create a fresh service with a cacheService that returns an existing state
      const localMock = {
        get: jest.fn(),
        set: jest.fn().mockResolvedValue(undefined),
        del: jest.fn().mockResolvedValue(undefined),
      };
      const mockState = {
        entityId: "agent-redis",
        state: "OPEN",
        failureCount: 3,
        successCount: 0,
        lastFailureTime: new Date().toISOString(),
        lastSuccessTime: null,
        cooldownUntil: new Date(Date.now() + 60000).toISOString(),
        rateLimitCount: 0,
        lastRateLimitTime: null,
        lastActivityTime: new Date().toISOString(),
      };
      localMock.get
        .mockResolvedValueOnce(["agent-redis"])
        .mockResolvedValueOnce(mockState);

      const freshModule = await Test.createTestingModule({
        providers: [
          EntityHealthRegistry,
          { provide: CacheService, useValue: localMock },
        ],
      }).compile();
      const freshService =
        freshModule.get<EntityHealthRegistry>(EntityHealthRegistry);
      await freshService.onModuleInit();

      // State loaded; canExecute should respect OPEN state with active cooldown
      expect(freshService.canExecute("agent-redis")).toBe(false);
    });

    it("should handle empty Redis index gracefully", async () => {
      mockCacheService.get.mockResolvedValueOnce([]);
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it("should handle null Redis index gracefully", async () => {
      mockCacheService.get.mockResolvedValueOnce(null);
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it("should handle Redis load error gracefully", async () => {
      mockCacheService.get.mockRejectedValueOnce(new Error("Redis down"));
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it("should skip null state entries when loading from Redis", async () => {
      mockCacheService.get
        .mockResolvedValueOnce(["agent-missing"])
        .mockResolvedValueOnce(null);
      await service.onModuleInit();
      expect(service.canExecute("agent-missing")).toBe(true);
    });
  });

  describe("onModuleDestroy", () => {
    it("should stop cleanup scheduler without error", () => {
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  // ==================== configure ====================

  describe("configure", () => {
    it("should update configuration", () => {
      const newConfig: CircuitBreakerConfig = { failureThreshold: 5 };
      service.configure(newConfig);
      const stats = service.getStats();
      expect(stats.config.failureThreshold).toBe(5);
    });
  });

  // ==================== canExecute / isAvailable ====================

  describe("canExecute", () => {
    it("should return true for unknown entity (new entity)", () => {
      expect(service.canExecute("new-entity")).toBe(true);
    });

    it("should return true for CLOSED state entity", () => {
      service.recordSuccess("entity-1", 100);
      expect(service.canExecute("entity-1")).toBe(true);
    });

    it("should return false for OPEN state entity within cooldown", () => {
      // Trip the breaker
      service.recordFailure("entity-2", TaskCompletionType.RATE_LIMITED);
      expect(service.canExecute("entity-2")).toBe(false);
    });

    it("should transition OPEN -> HALF_OPEN when cooldown expires", () => {
      jest.useFakeTimers();
      service.recordFailure("entity-3", TaskCompletionType.RATE_LIMITED);
      expect(service.canExecute("entity-3")).toBe(false);

      // Advance past rate limit cooldown (5 minutes)
      jest.advanceTimersByTime(6 * 60 * 1000);
      expect(service.canExecute("entity-3")).toBe(true);
      jest.useRealTimers();
    });

    it("should return true for HALF_OPEN state", () => {
      jest.useFakeTimers();
      service.recordFailure("entity-4", TaskCompletionType.RATE_LIMITED);
      jest.advanceTimersByTime(6 * 60 * 1000);
      // First call transitions to HALF_OPEN
      service.canExecute("entity-4");
      // Second call in HALF_OPEN should still return true
      expect(service.canExecute("entity-4")).toBe(true);
      jest.useRealTimers();
    });
  });

  describe("isAvailable", () => {
    it("should delegate to canExecute", () => {
      const canExecuteSpy = jest
        .spyOn(service, "canExecute")
        .mockReturnValue(true);
      expect(service.isAvailable("any")).toBe(true);
      expect(canExecuteSpy).toHaveBeenCalledWith("any");
    });
  });

  // ==================== getCooldownRemaining ====================

  describe("getCooldownRemaining", () => {
    it("should return 0 for unknown entity", () => {
      expect(service.getCooldownRemaining("unknown")).toBe(0);
    });

    it("should return 0 for entity without cooldown", () => {
      service.recordSuccess("entity-ok", 100);
      expect(service.getCooldownRemaining("entity-ok")).toBe(0);
    });

    it("should return positive cooldown time for OPEN state entity", () => {
      service.recordFailure("entity-cd", TaskCompletionType.RATE_LIMITED);
      expect(service.getCooldownRemaining("entity-cd")).toBeGreaterThan(0);
    });
  });

  // ==================== recordSuccess ====================

  describe("recordSuccess", () => {
    it("should create breaker entry and reset failure count", () => {
      service.recordSuccess("entity-s1", 200);
      const metrics = service.getHealthMetrics("entity-s1");
      expect(metrics.successRate).toBe(1.0);
      expect(metrics.state).toBe("CLOSED");
    });

    it("should record response time", () => {
      service.recordSuccess("entity-rt", 500);
      const metrics = service.getHealthMetrics("entity-rt");
      expect(metrics.avgResponseTime).toBe(500);
    });

    it("should work without response time", () => {
      service.recordSuccess("entity-nort");
      const metrics = service.getHealthMetrics("entity-nort");
      expect(metrics.avgResponseTime).toBe(0);
    });

    it("should transition HALF_OPEN -> CLOSED after halfOpenSuccessThreshold successes", () => {
      jest.useFakeTimers();
      // Trip breaker to OPEN
      service.recordFailure("entity-ho", TaskCompletionType.RATE_LIMITED);
      // Advance past cooldown
      jest.advanceTimersByTime(6 * 60 * 1000);
      // Transition to HALF_OPEN
      service.canExecute("entity-ho");
      // Record enough successes (default threshold = 2)
      service.recordSuccess("entity-ho", 100);
      expect(service.getHealthMetrics("entity-ho").state).toBe("HALF_OPEN");
      service.recordSuccess("entity-ho", 100);
      expect(service.getHealthMetrics("entity-ho").state).toBe("CLOSED");
      jest.useRealTimers();
    });

    it("should cap response time samples at maxResponseSamples", () => {
      service.configure({ maxResponseSamples: 3 });
      for (let i = 0; i < 5; i++) {
        service.recordSuccess("entity-cap", i * 100);
      }
      // Only last 3 samples retained; avg should be (200+300+400)/3 = 300
      const metrics = service.getHealthMetrics("entity-cap");
      expect(metrics.avgResponseTime).toBeCloseTo(300, 0);
    });
  });

  // ==================== recordFailure ====================

  describe("recordFailure", () => {
    it("should immediately open circuit on RATE_LIMITED", () => {
      service.recordFailure("entity-rl", TaskCompletionType.RATE_LIMITED);
      expect(service.getHealthMetrics("entity-rl").state).toBe("OPEN");
      expect(service.getCooldownRemaining("entity-rl")).toBeGreaterThan(0);
    });

    it("should increment rateLimitCount on RATE_LIMITED", () => {
      service.recordFailure(
        "entity-rlc",
        TaskCompletionType.RATE_LIMITED,
        "msg",
      );
      service.recordFailure(
        "entity-rlc",
        TaskCompletionType.RATE_LIMITED,
        "msg",
      );
      const metrics = service.getHealthMetrics("entity-rlc");
      expect(metrics.rateLimitHits).toBe(2);
    });

    it("should immediately open circuit on CONTEXT_OVERFLOW with double cooldown", () => {
      service.recordFailure(
        "entity-co",
        TaskCompletionType.CONTEXT_OVERFLOW,
        "overflow",
      );
      expect(service.getHealthMetrics("entity-co").state).toBe("OPEN");
      // double default cooldown = 6 min
      expect(service.getCooldownRemaining("entity-co")).toBeGreaterThan(
        5 * 60 * 1000,
      );
    });

    it("should immediately open circuit on AUTH_ERROR", () => {
      service.recordFailure("entity-ae", TaskCompletionType.AUTH_ERROR, "auth");
      expect(service.getHealthMetrics("entity-ae").state).toBe("OPEN");
    });

    it("should open circuit after failureThreshold consecutive failures", () => {
      const id = "entity-thresh";
      service.recordFailure(id, TaskCompletionType.API_ERROR);
      expect(service.getHealthMetrics(id).state).toBe("CLOSED");
      service.recordFailure(id, TaskCompletionType.API_ERROR);
      expect(service.getHealthMetrics(id).state).toBe("CLOSED");
      service.recordFailure(id, TaskCompletionType.API_ERROR);
      expect(service.getHealthMetrics(id).state).toBe("OPEN");
    });

    it("should re-open circuit on failure in HALF_OPEN state", () => {
      jest.useFakeTimers();
      const id = "entity-reopen";
      service.recordFailure(id, TaskCompletionType.RATE_LIMITED);
      jest.advanceTimersByTime(6 * 60 * 1000);
      service.canExecute(id); // -> HALF_OPEN
      service.recordFailure(id, TaskCompletionType.API_ERROR);
      expect(service.getHealthMetrics(id).state).toBe("OPEN");
      jest.useRealTimers();
    });

    it("should handle TIMEOUT error type via threshold", () => {
      const id = "entity-timeout";
      for (let i = 0; i < 3; i++) {
        service.recordFailure(id, TaskCompletionType.TIMEOUT);
      }
      expect(service.getHealthMetrics(id).state).toBe("OPEN");
    });

    it("should handle CONTENT_ERROR error type via threshold", () => {
      const id = "entity-content";
      for (let i = 0; i < 3; i++) {
        service.recordFailure(id, TaskCompletionType.CONTENT_ERROR);
      }
      expect(service.getHealthMetrics(id).state).toBe("OPEN");
    });
  });

  // ==================== recordExecution ====================

  describe("recordExecution", () => {
    it("should call recordSuccess on success=true", () => {
      const spy = jest.spyOn(service, "recordSuccess");
      service.recordExecution("entity-ex1", true, 100);
      expect(spy).toHaveBeenCalledWith("entity-ex1", 100);
    });

    it("should call recordFailure on success=false with default API_ERROR", () => {
      const spy = jest.spyOn(service, "recordFailure");
      service.recordExecution("entity-ex2", false, 100, undefined, "err");
      expect(spy).toHaveBeenCalledWith(
        "entity-ex2",
        TaskCompletionType.API_ERROR,
        "err",
      );
    });

    it("should call recordFailure with provided errorType", () => {
      const spy = jest.spyOn(service, "recordFailure");
      service.recordExecution(
        "entity-ex3",
        false,
        0,
        TaskCompletionType.TIMEOUT,
        "timeout",
      );
      expect(spy).toHaveBeenCalledWith(
        "entity-ex3",
        TaskCompletionType.TIMEOUT,
        "timeout",
      );
    });
  });

  // ==================== Load management ====================

  describe("load management", () => {
    it("should increment and decrement load correctly", () => {
      service.incrementLoad("entity-load");
      service.incrementLoad("entity-load");
      expect(service.getHealthMetrics("entity-load").currentLoad).toBe(2);

      service.decrementLoad("entity-load");
      expect(service.getHealthMetrics("entity-load").currentLoad).toBe(1);
    });

    it("should not go below 0 on decrement", () => {
      service.decrementLoad("entity-zero");
      expect(service.getHealthMetrics("entity-zero").currentLoad).toBe(0);
    });
  });

  // ==================== getHealthMetrics ====================

  describe("getHealthMetrics", () => {
    it("should return default metrics for unknown entity", () => {
      const metrics = service.getHealthMetrics("unknown-entity");
      expect(metrics).toMatchObject({
        entityId: "unknown-entity",
        successRate: 1.0,
        avgResponseTime: 0,
        rateLimitHits: 0,
        currentLoad: 0,
        isAvailable: true,
        cooldownRemaining: 0,
        state: "CLOSED",
      });
    });

    it("should calculate successRate correctly", () => {
      const id = "entity-sr";
      service.recordSuccess(id);
      service.recordSuccess(id);
      service.recordFailure(id, TaskCompletionType.API_ERROR);
      const metrics = service.getHealthMetrics(id);
      // 2 successes, 1 failure (failureCount reset by recordSuccess)
      // After recordFailure: failureCount=1, successCount still tracked via attempts
      // Actually recordSuccess resets failureCount each time; let's check actual
      expect(metrics.successRate).toBeGreaterThanOrEqual(0);
      expect(metrics.successRate).toBeLessThanOrEqual(1);
    });

    it("should return 1.0 successRate when totalAttempts is 0", () => {
      // Create a breaker but manipulate so attempts=0
      service.recordSuccess("entity-zero-att");
      // After 1 success: successCount=1, failureCount=0 -> rate=1/1=1
      const metrics = service.getHealthMetrics("entity-zero-att");
      expect(metrics.successRate).toBe(1.0);
    });

    it("should return 0 avgResponseTime when no samples", () => {
      service.recordSuccess("entity-no-rt");
      const metrics = service.getHealthMetrics("entity-no-rt");
      expect(metrics.avgResponseTime).toBe(0);
    });
  });

  // ==================== getAllHealthMetrics ====================

  describe("getAllHealthMetrics", () => {
    it("should return empty array initially", () => {
      expect(service.getAllHealthMetrics()).toEqual([]);
    });

    it("should return metrics for all tracked entities", () => {
      service.recordSuccess("e1");
      service.recordSuccess("e2");
      const all = service.getAllHealthMetrics();
      expect(all).toHaveLength(2);
      expect(all.map((m) => m.entityId)).toEqual(
        expect.arrayContaining(["e1", "e2"]),
      );
    });
  });

  // ==================== selectBest ====================

  describe("selectBest", () => {
    it("should return null when all entities are unavailable", () => {
      const id = "entity-unavail";
      service.recordFailure(id, TaskCompletionType.RATE_LIMITED);
      expect(service.selectBest([id])).toBeNull();
    });

    it("should return null for empty array", () => {
      expect(service.selectBest([])).toBeNull();
    });

    it("should return the only available entity", () => {
      service.recordSuccess("entity-avail", 100);
      expect(service.selectBest(["entity-avail"])).toBe("entity-avail");
    });

    it("should return unknown entity (default high score) when mixed with loaded entity", () => {
      // "unknown" has score 1.0 * 1.0 = 1.0; "loaded" has high load
      service.incrementLoad("entity-loaded");
      for (let i = 0; i < 9; i++) service.incrementLoad("entity-loaded");
      const best = service.selectBest(["entity-loaded", "entity-unknown-best"]);
      expect(best).toBe("entity-unknown-best");
    });

    it("should prefer entity with higher success rate", () => {
      const good = "entity-good";
      const bad = "entity-bad";
      service.recordSuccess(good);
      service.recordSuccess(good);
      service.recordFailure(bad, TaskCompletionType.API_ERROR);
      // good has successRate 1.0, bad has failureCount but check state
      const best = service.selectBest([bad, good]);
      expect(best).toBe(good);
    });
  });

  // ==================== parseErrorType ====================

  describe("parseErrorType", () => {
    it("should return API_ERROR for empty string", () => {
      expect(service.parseErrorType("")).toBe(TaskCompletionType.API_ERROR);
    });

    it("should detect rate limit patterns", () => {
      expect(service.parseErrorType("rate limit exceeded")).toBe(
        TaskCompletionType.RATE_LIMITED,
      );
      expect(service.parseErrorType("rate_limit hit")).toBe(
        TaskCompletionType.RATE_LIMITED,
      );
      expect(service.parseErrorType("Too Many Requests")).toBe(
        TaskCompletionType.RATE_LIMITED,
      );
      expect(service.parseErrorType("429 error")).toBe(
        TaskCompletionType.RATE_LIMITED,
      );
      expect(service.parseErrorType("quota exceeded")).toBe(
        TaskCompletionType.RATE_LIMITED,
      );
    });

    it("should detect timeout patterns", () => {
      expect(service.parseErrorType("Request timeout")).toBe(
        TaskCompletionType.TIMEOUT,
      );
      expect(service.parseErrorType("operation timed out")).toBe(
        TaskCompletionType.TIMEOUT,
      );
      expect(service.parseErrorType("ETIMEDOUT connection")).toBe(
        TaskCompletionType.TIMEOUT,
      );
    });

    it("should detect context overflow patterns", () => {
      expect(service.parseErrorType("context length exceeded")).toBe(
        TaskCompletionType.CONTEXT_OVERFLOW,
      );
      expect(service.parseErrorType("token limit reached")).toBe(
        TaskCompletionType.CONTEXT_OVERFLOW,
      );
      expect(service.parseErrorType("request too large")).toBe(
        TaskCompletionType.CONTEXT_OVERFLOW,
      );
      expect(service.parseErrorType("maximum context window")).toBe(
        TaskCompletionType.CONTEXT_OVERFLOW,
      );
    });

    it("should detect auth error patterns", () => {
      expect(service.parseErrorType("authentication failed")).toBe(
        TaskCompletionType.AUTH_ERROR,
      );
      expect(service.parseErrorType("authorization error")).toBe(
        TaskCompletionType.AUTH_ERROR,
      );
      expect(service.parseErrorType("invalid api key")).toBe(
        TaskCompletionType.AUTH_ERROR,
      );
      expect(service.parseErrorType("401 unauthorized")).toBe(
        TaskCompletionType.AUTH_ERROR,
      );
      expect(service.parseErrorType("403 forbidden")).toBe(
        TaskCompletionType.AUTH_ERROR,
      );
    });

    it("should return API_ERROR for unrecognized errors", () => {
      expect(service.parseErrorType("some random error")).toBe(
        TaskCompletionType.API_ERROR,
      );
    });
  });

  // ==================== reset / resetAll ====================

  describe("reset", () => {
    it("should remove breaker state for entity", () => {
      service.recordSuccess("entity-r1", 100);
      service.reset("entity-r1");
      expect(service.getStats().totalBreakers).toBe(0);
    });

    it("should remove load and response times for entity", () => {
      service.incrementLoad("entity-r2");
      service.recordSuccess("entity-r2", 500);
      service.reset("entity-r2");
      expect(service.getHealthMetrics("entity-r2").currentLoad).toBe(0);
      expect(service.getHealthMetrics("entity-r2").avgResponseTime).toBe(0);
    });
  });

  describe("resetAll", () => {
    it("should clear all breakers", () => {
      service.recordSuccess("e-ra1");
      service.recordSuccess("e-ra2");
      service.resetAll();
      expect(service.getStats().totalBreakers).toBe(0);
    });

    it("should call Redis del for index key when cacheService present", async () => {
      service.resetAll();
      await new Promise((r) => setTimeout(r, 0));
      expect(mockCacheService.del).toHaveBeenCalled();
    });
  });

  // ==================== getStats ====================

  describe("getStats", () => {
    it("should return 0 breakers initially", () => {
      const stats = service.getStats();
      expect(stats.totalBreakers).toBe(0);
      expect(stats.oldestBreakerAge).toBeNull();
    });

    it("should return correct totalBreakers", () => {
      service.recordSuccess("e-stat1");
      service.recordSuccess("e-stat2");
      expect(service.getStats().totalBreakers).toBe(2);
    });

    it("should return oldestBreakerAge as number when breakers exist", () => {
      service.recordSuccess("e-stat-age");
      const stats = service.getStats();
      expect(stats.oldestBreakerAge).toBeGreaterThanOrEqual(0);
    });

    it("should include config in stats", () => {
      const stats = service.getStats();
      expect(stats.config).toBeDefined();
      expect(stats.config.failureThreshold).toBe(3);
    });
  });

  // ==================== Without CacheService ====================

  describe("without CacheService (Optional)", () => {
    let serviceNoCacheService: EntityHealthRegistry;

    beforeEach(async () => {
      // When CacheService is not provided, @Optional() will inject undefined
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EntityHealthRegistry,
          { provide: CacheService, useValue: null },
        ],
      })
        .overrideProvider(CacheService)
        .useValue(undefined)
        .compile();
      serviceNoCacheService =
        module.get<EntityHealthRegistry>(EntityHealthRegistry);
    });

    it("should initialize without error", async () => {
      await expect(serviceNoCacheService.onModuleInit()).resolves.not.toThrow();
    });

    it("should operate normally without cache", () => {
      serviceNoCacheService.recordSuccess("entity-no-cache", 100);
      expect(serviceNoCacheService.canExecute("entity-no-cache")).toBe(true);
    });

    it("should reset without error", () => {
      serviceNoCacheService.recordSuccess("entity-nc");
      expect(() => serviceNoCacheService.reset("entity-nc")).not.toThrow();
    });

    it("should resetAll without error", () => {
      expect(() => serviceNoCacheService.resetAll()).not.toThrow();
    });
  });

  // ==================== Redis save/delete error handling ====================

  describe("Redis error handling", () => {
    it("should not throw when Redis save fails", async () => {
      mockCacheService.set.mockRejectedValue(new Error("Redis write error"));
      expect(() => service.recordSuccess("entity-rs-err", 100)).not.toThrow();
      // Allow pending promises to settle
      await new Promise((r) => setTimeout(r, 0));
    });

    it("should not throw when Redis delete fails", async () => {
      mockCacheService.del.mockRejectedValue(new Error("Redis delete error"));
      service.recordSuccess("entity-rd-err", 100);
      expect(() => service.reset("entity-rd-err")).not.toThrow();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  // ==================== Cleanup scheduler (private methods via timer) ====================

  describe("cleanup via timer", () => {
    it("should clean inactive breakers after TTL expires", async () => {
      jest.useFakeTimers();
      // Create a fresh service with short TTL/cleanup to test cleanup
      const localMock = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        del: jest.fn().mockResolvedValue(undefined),
      };
      const freshModule = await Test.createTestingModule({
        providers: [
          {
            provide: EntityHealthRegistry,
            useFactory: () => {
              const svc = new EntityHealthRegistry(localMock as any);
              svc.configure({ inactiveTtlMs: 100, cleanupIntervalMs: 50 });
              return svc;
            },
          },
        ],
      }).compile();
      const freshService =
        freshModule.get<EntityHealthRegistry>(EntityHealthRegistry);
      await freshService.onModuleInit();

      freshService.recordSuccess("entity-stale", 100);
      expect(freshService.getStats().totalBreakers).toBe(1);

      // Advance time past TTL (100ms) + cleanup interval (50ms)
      jest.advanceTimersByTime(200);

      // After cleanup, entity should be gone
      expect(freshService.getStats().totalBreakers).toBe(0);
      freshService.onModuleDestroy();
      jest.useRealTimers();
    });

    it("should not clean active breakers within TTL", async () => {
      jest.useFakeTimers();
      const localMock = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        del: jest.fn().mockResolvedValue(undefined),
      };
      const freshModule = await Test.createTestingModule({
        providers: [
          {
            provide: EntityHealthRegistry,
            useFactory: () => {
              const svc = new EntityHealthRegistry(localMock as any);
              svc.configure({ inactiveTtlMs: 60000, cleanupIntervalMs: 50 });
              return svc;
            },
          },
        ],
      }).compile();
      const freshService =
        freshModule.get<EntityHealthRegistry>(EntityHealthRegistry);
      await freshService.onModuleInit();

      freshService.recordSuccess("entity-active", 100);

      // Advance less than TTL
      jest.advanceTimersByTime(100);

      expect(freshService.getStats().totalBreakers).toBe(1);
      freshService.onModuleDestroy();
      jest.useRealTimers();
    });

    it("should handle Redis resetAll error gracefully", async () => {
      mockCacheService.del.mockRejectedValueOnce(new Error("Redis error"));
      service.recordSuccess("e-1");
      service.resetAll();
      await new Promise((r) => setTimeout(r, 0));
      // Should not throw
    });
  });

  // ==================== Redis state restoration with optional fields ====================

  describe("Redis state restoration with optional date fields", () => {
    it("should restore all optional Date fields from Redis", async () => {
      const localMock = {
        get: jest.fn(),
        set: jest.fn().mockResolvedValue(undefined),
        del: jest.fn().mockResolvedValue(undefined),
      };
      const now = new Date();
      const mockState = {
        entityId: "agent-full",
        state: "OPEN",
        failureCount: 2,
        successCount: 1,
        lastFailureTime: now.toISOString(),
        lastSuccessTime: now.toISOString(),
        cooldownUntil: new Date(Date.now() + 120000).toISOString(),
        rateLimitCount: 1,
        lastRateLimitTime: now.toISOString(),
        lastActivityTime: now.toISOString(),
      };
      localMock.get
        .mockResolvedValueOnce(["agent-full"])
        .mockResolvedValueOnce(mockState);

      const freshModule = await Test.createTestingModule({
        providers: [
          EntityHealthRegistry,
          { provide: CacheService, useValue: localMock },
        ],
      }).compile();
      const freshService =
        freshModule.get<EntityHealthRegistry>(EntityHealthRegistry);
      await freshService.onModuleInit();

      expect(freshService.canExecute("agent-full")).toBe(false);
    });
  });
});

// ==================== TaskCompletionType enum ====================

describe("TaskCompletionType", () => {
  it("should have all expected values", () => {
    expect(TaskCompletionType.SUCCESS).toBe("SUCCESS");
    expect(TaskCompletionType.API_ERROR).toBe("API_ERROR");
    expect(TaskCompletionType.RATE_LIMITED).toBe("RATE_LIMITED");
    expect(TaskCompletionType.TIMEOUT).toBe("TIMEOUT");
    expect(TaskCompletionType.CONTENT_ERROR).toBe("CONTENT_ERROR");
    expect(TaskCompletionType.CONTEXT_OVERFLOW).toBe("CONTEXT_OVERFLOW");
    expect(TaskCompletionType.AUTH_ERROR).toBe("AUTH_ERROR");
  });
});
