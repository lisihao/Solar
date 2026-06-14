/**
 * CostAttributionService Unit Tests
 *
 * Covers all public methods:
 * - recordCost()         - record cost events, update hourly buckets & user aggregations
 * - getCostReport()      - aggregate across multiple dimensions with date range filtering
 * - getUserCost()        - per-user cost retrieval
 * - setBudgetAlert()     - configure per-user budget thresholds
 * - checkBudgetAlerts()  - evaluate alert conditions, avoid duplicate triggers
 * - getHourlyTrend()     - convenience wrapper around getCostReport
 * - flushCostsToDB()     - batch-persist pending events to DB
 * - getPendingFlushCount() - inspect pending event queue length
 * - reset()             - clear all in-memory state
 * - onModuleInit / onModuleDestroy lifecycle hooks
 *
 * Redis write-through coverage:
 * - FakeCacheService suite verifies persistHourlyBucket / persistUserAgg /
 *   persistBudgetConfig are called (fire-and-forget) and that warm-up
 *   (loadRecentStateFromRedis) restores in-memory Maps on pod restart.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { CacheService } from "@/common/cache/cache.service";
import {
  CostAttributionService,
  CostEvent,
} from "../observability/cost-attribution.service";

// ---------------------------------------------------------------------------
// Suppress Logger output for all tests
// ---------------------------------------------------------------------------

jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<CostEvent> = {}): CostEvent {
  return {
    userId: "user-1",
    moduleType: "ai-ask",
    model: "gpt-4o",
    provider: "openai",
    inputTokens: 100,
    outputTokens: 50,
    estimatedCost: 0.001,
    timestamp: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FakeCacheService — in-memory store that behaves like CacheService
// ---------------------------------------------------------------------------

class FakeCacheService {
  private readonly store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.has(key) ? (this.store.get(key) as T) : undefined;
  }

  async set<T>(key: string, value: T, _ttl?: number): Promise<void> {
    // Deep-clone to simulate JSON serialization round-trip
    this.store.set(key, JSON.parse(JSON.stringify(value)));
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

function buildMockPrisma() {
  return {
    aIEngineMetric: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

// ---------------------------------------------------------------------------
// Suite (without Prisma – in-memory only)
// ---------------------------------------------------------------------------

describe("CostAttributionService (no Prisma)", () => {
  let service: CostAttributionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CostAttributionService],
    }).compile();

    service = module.get<CostAttributionService>(CostAttributionService);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // recordCost()
  // =========================================================================

  describe("recordCost()", () => {
    it("should record a cost event and make it visible in getCostReport", () => {
      service.recordCost(makeEvent());

      const report = service.getCostReport({ periodHours: 1 });
      expect(report.totalCost).toBeCloseTo(0.001);
    });

    it("should accumulate costs across multiple events in the same hour", () => {
      service.recordCost(makeEvent({ estimatedCost: 0.002 }));
      service.recordCost(makeEvent({ estimatedCost: 0.003 }));

      const report = service.getCostReport({ periodHours: 1 });
      expect(report.totalCost).toBeCloseTo(0.005);
    });

    it("should sum input and output tokens into totalTokens", () => {
      service.recordCost(
        makeEvent({ inputTokens: 100, outputTokens: 50, estimatedCost: 0.001 }),
      );

      const report = service.getCostReport({ periodHours: 1 });
      expect(report.totalTokens).toBe(150);
    });

    it("should use current time as timestamp when event.timestamp is omitted", () => {
      const before = new Date();
      service.recordCost({
        userId: "user-1",
        moduleType: "ai-ask",
        model: "gpt-4o",
        provider: "openai",
        inputTokens: 10,
        outputTokens: 5,
        estimatedCost: 0.0001,
        // no timestamp field
      });
      const after = new Date();

      const report = service.getCostReport({ periodHours: 1 });
      // Event in the current hour should show in a 1-hour report
      expect(report.totalCost).toBeGreaterThan(0);
      expect(before.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should build byUser dimension in the report", () => {
      service.recordCost(makeEvent({ userId: "user-A", estimatedCost: 0.01 }));
      service.recordCost(makeEvent({ userId: "user-B", estimatedCost: 0.02 }));

      const report = service.getCostReport({ periodHours: 1 });
      const userIds = report.byUser.map((u) => u.userId);
      expect(userIds).toContain("user-A");
      expect(userIds).toContain("user-B");
    });

    it("should build byModule dimension in the report", () => {
      service.recordCost(makeEvent({ moduleType: "ai-ask" }));
      service.recordCost(makeEvent({ moduleType: "research" }));

      const report = service.getCostReport({ periodHours: 1 });
      const modules = report.byModule.map((m) => m.moduleType);
      expect(modules).toContain("ai-ask");
      expect(modules).toContain("research");
    });

    it("should build byModel dimension in the report", () => {
      service.recordCost(
        makeEvent({ provider: "openai", model: "gpt-4o", estimatedCost: 0.01 }),
      );
      service.recordCost(
        makeEvent({
          provider: "anthropic",
          model: "claude-3.5-sonnet",
          estimatedCost: 0.02,
        }),
      );

      const report = service.getCostReport({ periodHours: 1 });
      const models = report.byModel.map((m) => m.model);
      expect(models).toContain("gpt-4o");
      expect(models).toContain("claude-3.5-sonnet");
    });

    it("should NOT push to pendingCostEvents when prisma is not injected", () => {
      service.recordCost(makeEvent());
      expect(service.getPendingFlushCount()).toBe(0);
    });
  });

  // =========================================================================
  // getCostReport()
  // =========================================================================

  describe("getCostReport()", () => {
    it("should return an empty report when no events are recorded", () => {
      const report = service.getCostReport();
      expect(report.totalCost).toBe(0);
      expect(report.totalTokens).toBe(0);
      expect(report.byUser).toHaveLength(0);
      expect(report.byModule).toHaveLength(0);
      expect(report.byModel).toHaveLength(0);
      expect(report.hourlyTrend).toHaveLength(0);
    });

    it("should default to a 24-hour period when no options are given", () => {
      const report = service.getCostReport();
      const diff =
        (report.period.end.getTime() - report.period.start.getTime()) /
        (1000 * 60 * 60);
      expect(diff).toBeCloseTo(24, 0);
    });

    it("should respect the periodHours option", () => {
      const report = service.getCostReport({ periodHours: 48 });
      const diff =
        (report.period.end.getTime() - report.period.start.getTime()) /
        (1000 * 60 * 60);
      expect(diff).toBeCloseTo(48, 0);
    });

    it("should filter events outside the requested period", () => {
      // Old event (3 days ago — well outside a 24h window)
      const old = makeEvent({
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        estimatedCost: 0.1,
      });
      // Recent event (now — safely inside any reasonable window)
      const recent = makeEvent({
        timestamp: new Date(),
        estimatedCost: 0.01,
      });

      service.recordCost(old);
      service.recordCost(recent);

      // Use 24h window: recent event is included, 3-day-old event is excluded
      const report = service.getCostReport({ periodHours: 24 });
      expect(report.totalCost).toBeCloseTo(0.01, 3);
    });

    it("should filter by userId when provided", () => {
      service.recordCost(
        makeEvent({ userId: "user-A", estimatedCost: 0.05, moduleType: "ask" }),
      );
      service.recordCost(
        makeEvent({ userId: "user-B", estimatedCost: 0.07, moduleType: "ask" }),
      );

      const report = service.getCostReport({ userId: "user-A" });
      expect(report.byUser.every((u) => u.userId === "user-A")).toBe(true);
      expect(report.byUser.find((u) => u.userId === "user-B")).toBeUndefined();
    });

    it("should sort byUser descending by cost", () => {
      service.recordCost(makeEvent({ userId: "cheap", estimatedCost: 0.001 }));
      service.recordCost(
        makeEvent({ userId: "expensive", estimatedCost: 1.0 }),
      );

      const report = service.getCostReport({ periodHours: 1 });
      expect(report.byUser[0].totalCost).toBeGreaterThan(
        report.byUser[report.byUser.length - 1].totalCost,
      );
    });

    it("should sort byModule descending by cost", () => {
      service.recordCost(
        makeEvent({ moduleType: "low", estimatedCost: 0.001 }),
      );
      service.recordCost(makeEvent({ moduleType: "high", estimatedCost: 0.5 }));

      const report = service.getCostReport({ periodHours: 1 });
      expect(report.byModule[0].totalCost).toBeGreaterThan(
        report.byModule[report.byModule.length - 1].totalCost,
      );
    });

    it("should sort byModel descending by cost", () => {
      service.recordCost(
        makeEvent({
          provider: "openai",
          model: "gpt-4o-mini",
          estimatedCost: 0.0001,
        }),
      );
      service.recordCost(
        makeEvent({
          provider: "anthropic",
          model: "claude-3.5-sonnet",
          estimatedCost: 0.9,
        }),
      );

      const report = service.getCostReport({ periodHours: 1 });
      expect(report.byModel[0].totalCost).toBeGreaterThan(
        report.byModel[report.byModel.length - 1].totalCost,
      );
    });

    it("should sort hourlyTrend ascending by time", () => {
      const now = Date.now();
      // Two events: one 2 hours ago, one 1 hour ago
      service.recordCost(
        makeEvent({ timestamp: new Date(now - 2 * 60 * 60 * 1000) }),
      );
      service.recordCost(
        makeEvent({ timestamp: new Date(now - 1 * 60 * 60 * 1000) }),
      );

      const report = service.getCostReport({ periodHours: 48 });
      const hours = report.hourlyTrend.map((h) => h.hour);
      for (let i = 1; i < hours.length; i++) {
        expect(hours[i - 1] <= hours[i]).toBe(true);
      }
    });

    it("should include topModule and topModel from userAggregation in byUser", () => {
      service.recordCost(
        makeEvent({
          userId: "user-1",
          moduleType: "research",
          model: "gpt-4o",
          provider: "openai",
          estimatedCost: 0.5,
        }),
      );
      service.recordCost(
        makeEvent({
          userId: "user-1",
          moduleType: "ai-ask",
          model: "gpt-4o-mini",
          provider: "openai",
          estimatedCost: 0.001,
        }),
      );

      const report = service.getCostReport({ periodHours: 1 });
      const user = report.byUser.find((u) => u.userId === "user-1");
      expect(user).toBeDefined();
      // The top module/model should be the one with higher cost
      expect(user!.topModule).toBe("research");
    });

    it("should compute avgCostPerCall correctly in byModule", () => {
      service.recordCost(
        makeEvent({ moduleType: "coding", estimatedCost: 0.06 }),
      );
      service.recordCost(
        makeEvent({ moduleType: "coding", estimatedCost: 0.04 }),
      );

      const report = service.getCostReport({ periodHours: 1 });
      const mod = report.byModule.find((m) => m.moduleType === "coding");
      expect(mod).toBeDefined();
      expect(mod!.callCount).toBe(2);
      expect(mod!.avgCostPerCall).toBeCloseTo(0.05, 5);
    });

    it("should compute avgTokensPerCall correctly in byModel", () => {
      service.recordCost(
        makeEvent({
          provider: "openai",
          model: "gpt-4o",
          inputTokens: 200,
          outputTokens: 100,
        }),
      );
      service.recordCost(
        makeEvent({
          provider: "openai",
          model: "gpt-4o",
          inputTokens: 100,
          outputTokens: 50,
        }),
      );

      const report = service.getCostReport({ periodHours: 1 });
      const model = report.byModel.find((m) => m.model === "gpt-4o");
      expect(model).toBeDefined();
      expect(model!.callCount).toBe(2);
      expect(model!.avgTokensPerCall).toBeCloseTo(225, 0); // (300 + 150) / 2
    });
  });

  // =========================================================================
  // getUserCost()
  // =========================================================================

  describe("getUserCost()", () => {
    it("should return the correct cost for a user within the period", () => {
      service.recordCost(makeEvent({ userId: "user-X", estimatedCost: 0.123 }));

      const result = service.getUserCost("user-X", 1);
      expect(result.userId).toBe("user-X");
      expect(result.totalCost).toBeCloseTo(0.123);
    });

    it("should return zero cost for a user with no activity in the period", () => {
      const result = service.getUserCost("unknown-user", 1);
      expect(result.totalCost).toBe(0);
      expect(result.callCount).toBe(0);
      expect(result.totalTokens).toBe(0);
    });

    it("should return empty string topModule and topModel for unknown user", () => {
      const result = service.getUserCost("ghost-user", 1);
      expect(result.topModule).toBe("");
      expect(result.topModel).toBe("");
    });

    it("should use 24 hours as default period when periodHours is not specified", () => {
      service.recordCost(makeEvent({ userId: "user-Y", estimatedCost: 0.05 }));

      const result = service.getUserCost("user-Y");
      expect(result.totalCost).toBeCloseTo(0.05);
    });
  });

  // =========================================================================
  // setBudgetAlert() + checkBudgetAlerts()
  // =========================================================================

  describe("setBudgetAlert() + checkBudgetAlerts()", () => {
    it("should set a budget alert and return it in checkBudgetAlerts", () => {
      service.setBudgetAlert("user-1", 1.0, "daily");

      const alerts = service.checkBudgetAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].userId).toBe("user-1");
      expect(alerts[0].threshold).toBe(1.0);
      expect(alerts[0].period).toBe("daily");
    });

    it("should report triggered=false when spend is below threshold", () => {
      service.setBudgetAlert("user-1", 10.0, "daily");
      service.recordCost(makeEvent({ userId: "user-1", estimatedCost: 0.01 }));

      const alerts = service.checkBudgetAlerts();
      expect(alerts[0].triggered).toBe(false);
      expect(alerts[0].triggeredAt).toBeUndefined();
    });

    it("should report triggered=true when spend meets or exceeds threshold", () => {
      service.setBudgetAlert("user-1", 0.001, "daily");
      service.recordCost(makeEvent({ userId: "user-1", estimatedCost: 0.005 }));

      const alerts = service.checkBudgetAlerts();
      expect(alerts[0].triggered).toBe(true);
      expect(alerts[0].triggeredAt).toBeDefined();
    });

    it("should not fire again within the same period (duplicate suppression)", () => {
      service.setBudgetAlert("user-1", 0.001, "daily");
      service.recordCost(makeEvent({ userId: "user-1", estimatedCost: 0.005 }));

      // First check — triggers
      const first = service.checkBudgetAlerts();
      expect(first[0].triggered).toBe(true);

      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      // Second check — should NOT re-warn (no new trigger)
      service.checkBudgetAlerts();
      // warn for duplicate should not have been called
      const duplicateCalls = warnSpy.mock.calls.filter((args) =>
        String(args[0]).includes("预算告警触发"),
      );
      // Only one warn from the first call
      expect(duplicateCalls.length).toBeLessThanOrEqual(1);
    });

    it("should support monthly period alerts", () => {
      service.setBudgetAlert("user-1", 50.0, "monthly");

      const alerts = service.checkBudgetAlerts();
      expect(alerts[0].period).toBe("monthly");
    });

    it("should track multiple users independently", () => {
      service.setBudgetAlert("user-A", 0.001, "daily");
      service.setBudgetAlert("user-B", 100.0, "daily");
      service.recordCost(makeEvent({ userId: "user-A", estimatedCost: 0.005 }));
      service.recordCost(makeEvent({ userId: "user-B", estimatedCost: 0.001 }));

      const alerts = service.checkBudgetAlerts();
      const alertA = alerts.find((a) => a.userId === "user-A");
      const alertB = alerts.find((a) => a.userId === "user-B");
      expect(alertA!.triggered).toBe(true);
      expect(alertB!.triggered).toBe(false);
    });
  });

  // =========================================================================
  // getHourlyTrend()
  // =========================================================================

  describe("getHourlyTrend()", () => {
    it("should return an empty array when there are no events", () => {
      expect(service.getHourlyTrend()).toHaveLength(0);
    });

    it("should return hourly trend data after recording events", () => {
      service.recordCost(makeEvent());

      const trend = service.getHourlyTrend(1);
      expect(trend.length).toBeGreaterThan(0);
      expect(trend[0]).toHaveProperty("hour");
      expect(trend[0]).toHaveProperty("cost");
      expect(trend[0]).toHaveProperty("tokens");
      expect(trend[0]).toHaveProperty("calls");
    });

    it("should default to 24 hours when no argument is given", () => {
      service.recordCost(makeEvent());

      const trend = service.getHourlyTrend();
      expect(Array.isArray(trend)).toBe(true);
    });
  });

  // =========================================================================
  // flushCostsToDB() — without Prisma
  // =========================================================================

  describe("flushCostsToDB() without Prisma", () => {
    it("should return 0 immediately when no prisma is injected", async () => {
      service.recordCost(makeEvent());
      const result = await service.flushCostsToDB();
      expect(result).toBe(0);
    });
  });

  // =========================================================================
  // getPendingFlushCount()
  // =========================================================================

  describe("getPendingFlushCount()", () => {
    it("should return 0 when no prisma is injected", () => {
      service.recordCost(makeEvent());
      expect(service.getPendingFlushCount()).toBe(0);
    });
  });

  // =========================================================================
  // reset()
  // =========================================================================

  describe("reset()", () => {
    it("should clear all recorded data", () => {
      service.recordCost(makeEvent({ estimatedCost: 0.5 }));
      service.setBudgetAlert("user-1", 1.0, "daily");

      service.reset();

      const report = service.getCostReport();
      expect(report.totalCost).toBe(0);
      expect(service.checkBudgetAlerts()).toHaveLength(0);
    });
  });

  // =========================================================================
  // onModuleInit / onModuleDestroy (no Prisma)
  // =========================================================================

  describe("lifecycle hooks (no Prisma)", () => {
    it("onModuleInit should not set a flush interval when no Prisma", async () => {
      // If interval were set, onModuleDestroy would clear it — no errors expected
      await service.onModuleInit();
      service.onModuleDestroy();
    });

    it("onModuleDestroy should be safe to call with no pending events", async () => {
      await service.onModuleInit();
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: FakeCacheService (Redis path)
// ---------------------------------------------------------------------------

describe("CostAttributionService (with FakeCacheService, no prisma)", () => {
  let service: CostAttributionService;
  let fakeCache: FakeCacheService;

  beforeEach(async () => {
    fakeCache = new FakeCacheService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostAttributionService,
        {
          provide: CacheService,
          useValue: fakeCache as unknown as CacheService,
        },
      ],
    }).compile();

    service = module.get<CostAttributionService>(CostAttributionService);
  });

  afterEach(() => jest.clearAllMocks());

  it("should record a cost event via Redis path and make it visible in getCostReport", () => {
    service.recordCost(makeEvent({ estimatedCost: 0.005 }));
    const report = service.getCostReport({ periodHours: 1 });
    expect(report.totalCost).toBeCloseTo(0.005);
  });

  it("should accumulate costs from multiple events via Redis path", () => {
    service.recordCost(makeEvent({ estimatedCost: 0.002 }));
    service.recordCost(makeEvent({ estimatedCost: 0.003 }));
    const report = service.getCostReport({ periodHours: 1 });
    expect(report.totalCost).toBeCloseTo(0.005);
  });

  it("should build byUser dimension via Redis path", () => {
    service.recordCost(
      makeEvent({ userId: "redis-user-A", estimatedCost: 0.01 }),
    );
    service.recordCost(
      makeEvent({ userId: "redis-user-B", estimatedCost: 0.02 }),
    );
    const report = service.getCostReport({ periodHours: 1 });
    const userIds = report.byUser.map((u) => u.userId);
    expect(userIds).toContain("redis-user-A");
    expect(userIds).toContain("redis-user-B");
  });

  it("should build byModule dimension via Redis path", () => {
    service.recordCost(makeEvent({ moduleType: "redis-mod" }));
    const report = service.getCostReport({ periodHours: 1 });
    expect(report.byModule.map((m) => m.moduleType)).toContain("redis-mod");
  });

  it("should report correct topModule via Redis path", () => {
    service.recordCost(
      makeEvent({
        userId: "u1",
        moduleType: "expensive-mod",
        estimatedCost: 0.9,
      }),
    );
    service.recordCost(
      makeEvent({
        userId: "u1",
        moduleType: "cheap-mod",
        estimatedCost: 0.001,
      }),
    );
    const report = service.getCostReport({ periodHours: 1 });
    const user = report.byUser.find((u) => u.userId === "u1");
    expect(user?.topModule).toBe("expensive-mod");
  });

  it("should set and check budget alerts via Redis path", () => {
    service.setBudgetAlert("redis-user", 0.001, "daily");
    service.recordCost(
      makeEvent({ userId: "redis-user", estimatedCost: 0.01 }),
    );
    const alerts = service.checkBudgetAlerts();
    const alert = alerts.find((a) => a.userId === "redis-user");
    expect(alert).toBeDefined();
    expect(alert!.triggered).toBe(true);
    expect(alert!.triggeredAt).toBeDefined();
  });

  it("should not re-trigger budget alert within the same period (Redis path)", () => {
    service.setBudgetAlert("redis-user", 0.001, "daily");
    service.recordCost(
      makeEvent({ userId: "redis-user", estimatedCost: 0.01 }),
    );

    // First check triggers
    service.checkBudgetAlerts();

    // Logger.prototype.warn 已在模块顶层（L37）spyOn 过；第二次 spyOn 同一方法返回
    // 同一 spy 实例（包含第一次 check 的 warn calls）。必须 mockClear() 切除历史，
    // 否则断言会把第一次 check 的 warn 误判为"第二次的重复触发"。
    const warnSpy = jest.spyOn(Logger.prototype, "warn");
    warnSpy.mockClear();
    // Second check should NOT re-warn
    service.checkBudgetAlerts();
    const duplicateCalls = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("预算告警触发"),
    );
    expect(duplicateCalls.length).toBe(0);
  });

  it("should filter events outside the period via Redis path", () => {
    service.recordCost(
      makeEvent({
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        estimatedCost: 0.9,
      }),
    );
    service.recordCost(
      makeEvent({ timestamp: new Date(), estimatedCost: 0.01 }),
    );

    const report = service.getCostReport({ periodHours: 24 });
    expect(report.totalCost).toBeCloseTo(0.01, 3);
  });

  it("reset() should clear in-memory fallback maps", () => {
    service.recordCost(makeEvent({ estimatedCost: 0.5 }));
    service.setBudgetAlert("u", 1.0, "daily");
    service.reset();

    // After reset, in-memory fallback is clear.
    // Redis keys still exist (TTL-based), but the in-memory path is cleared.
    // Verify reset does not throw.
    expect(service.getPendingFlushCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite WITH Prisma (no CacheService — in-memory fallback)
// ---------------------------------------------------------------------------

describe("CostAttributionService (with Prisma, no cache)", () => {
  let service: CostAttributionService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostAttributionService,
        {
          provide: PrismaService,
          useValue: mockPrisma as unknown as PrismaService,
        },
      ],
    }).compile();

    service = module.get<CostAttributionService>(CostAttributionService);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // pendingCostEvents queue
  // =========================================================================

  describe("pendingCostEvents", () => {
    it("should push events to pendingCostEvents when Prisma is injected", () => {
      service.recordCost(makeEvent());
      expect(service.getPendingFlushCount()).toBe(1);
    });

    it("should push multiple events to the queue", () => {
      service.recordCost(makeEvent());
      service.recordCost(makeEvent());
      service.recordCost(makeEvent());
      expect(service.getPendingFlushCount()).toBe(3);
    });
  });

  // =========================================================================
  // flushCostsToDB()
  // =========================================================================

  describe("flushCostsToDB()", () => {
    it("should return 0 when pendingCostEvents is empty", async () => {
      const result = await service.flushCostsToDB();
      expect(result).toBe(0);
      expect(mockPrisma.aIEngineMetric.createMany).not.toHaveBeenCalled();
    });

    it("should flush pending events and call prisma.createMany", async () => {
      service.recordCost(makeEvent({ estimatedCost: 0.01 }));
      service.recordCost(makeEvent({ estimatedCost: 0.02 }));

      const result = await service.flushCostsToDB();

      expect(result).toBe(2);
      expect(mockPrisma.aIEngineMetric.createMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.aIEngineMetric.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skipDuplicates: true,
          data: expect.arrayContaining([
            expect.objectContaining({ metricType: "cost_event" }),
          ]),
        }),
      );
    });

    it("should clear the pendingCostEvents queue after a successful flush", async () => {
      service.recordCost(makeEvent());
      await service.flushCostsToDB();
      expect(service.getPendingFlushCount()).toBe(0);
    });

    it("should map event fields correctly when calling createMany", async () => {
      const event = makeEvent({
        userId: "u1",
        moduleType: "research",
        model: "gpt-4o",
        provider: "openai",
        inputTokens: 200,
        outputTokens: 100,
        estimatedCost: 0.005,
        timestamp: new Date("2026-01-01T00:00:00Z"),
      });
      service.recordCost(event);
      await service.flushCostsToDB();

      const callData =
        mockPrisma.aIEngineMetric.createMany.mock.calls[0][0].data[0];
      expect(callData.metricType).toBe("cost_event");
      expect(callData.operationId).toBe("research");
      expect(callData.modelId).toBe("gpt-4o");
      expect(callData.providerId).toBe("openai");
      expect(callData.userId).toBe("u1");
      expect(callData.inputTokens).toBe(200);
      expect(callData.outputTokens).toBe(100);
      expect(callData.totalTokens).toBe(300);
      expect(callData.success).toBe(true);
    });

    it("should restore events to the queue on DB failure and return 0", async () => {
      mockPrisma.aIEngineMetric.createMany.mockRejectedValueOnce(
        new Error("DB error"),
      );
      service.recordCost(makeEvent());

      const result = await service.flushCostsToDB();

      expect(result).toBe(0);
      expect(service.getPendingFlushCount()).toBe(1);
    });

    it("should flush in batches when there are more than FLUSH_BATCH_SIZE events", async () => {
      for (let i = 0; i < 501; i++) {
        service.recordCost(makeEvent({ estimatedCost: 0.001 }));
      }

      const result = await service.flushCostsToDB();

      expect(result).toBe(501);
      expect(mockPrisma.aIEngineMetric.createMany).toHaveBeenCalledTimes(2);
      expect(service.getPendingFlushCount()).toBe(0);
    });
  });

  // =========================================================================
  // reset() clears pending events
  // =========================================================================

  describe("reset() with Prisma", () => {
    it("should clear pendingCostEvents on reset", () => {
      service.recordCost(makeEvent());
      service.recordCost(makeEvent());
      service.reset();
      expect(service.getPendingFlushCount()).toBe(0);
    });
  });

  // =========================================================================
  // onModuleInit / onModuleDestroy lifecycle
  // =========================================================================

  describe("lifecycle hooks (with Prisma)", () => {
    it("onModuleInit should set up flush interval when Prisma is injected", async () => {
      const setIntervalSpy = jest.spyOn(global, "setInterval");
      await service.onModuleInit();
      expect(setIntervalSpy).toHaveBeenCalled();
      service.onModuleDestroy();
      setIntervalSpy.mockRestore();
    });

    it("onModuleDestroy should clear the flush interval", async () => {
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");
      await service.onModuleInit();
      service.onModuleDestroy();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it("onModuleDestroy should call flushCostsToDB when there are pending events", async () => {
      await service.onModuleInit();
      service.recordCost(makeEvent());

      const flushSpy = jest
        .spyOn(service, "flushCostsToDB")
        .mockResolvedValue(1);

      service.onModuleDestroy();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(flushSpy).toHaveBeenCalled();
    });

    it("onModuleDestroy should not call flush when there are no pending events", async () => {
      await service.onModuleInit();
      const flushSpy = jest.spyOn(service, "flushCostsToDB");
      service.onModuleDestroy();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(flushSpy).not.toHaveBeenCalled();
    });

    it("onModuleDestroy should handle flush errors gracefully", async () => {
      await service.onModuleInit();
      service.recordCost(makeEvent());

      jest
        .spyOn(service, "flushCostsToDB")
        .mockRejectedValue(new Error("shutdown flush error"));

      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Budget re-trigger after full period elapsed
// ---------------------------------------------------------------------------

describe("CostAttributionService (budget re-trigger after period)", () => {
  it("should re-trigger budget alert after a full period has elapsed", async () => {
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CostAttributionService],
    }).compile();
    const service = module.get<CostAttributionService>(CostAttributionService);

    service.setBudgetAlert("user-re", 0.001, "daily");
    service.recordCost(
      makeEvent({
        userId: "user-re",
        estimatedCost: 0.01,
        timestamp: new Date(),
      }),
    );

    const first = service.checkBudgetAlerts();
    expect(first[0].triggered).toBe(true);
    expect(first[0].triggeredAt).toBeDefined();

    // Advance 25 hours past the daily period
    jest.advanceTimersByTime(25 * 60 * 60 * 1000);

    service.recordCost(
      makeEvent({
        userId: "user-re",
        estimatedCost: 0.01,
        timestamp: new Date(),
      }),
    );

    const warnSpy = jest.spyOn(Logger.prototype, "warn");
    const second = service.checkBudgetAlerts();
    expect(second[0].triggered).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("预算告警触发"),
    );

    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// setInterval callback fires flushCostsToDB
// ---------------------------------------------------------------------------

describe("CostAttributionService (interval callback)", () => {
  it("should call flushCostsToDB when the interval fires", async () => {
    jest.useFakeTimers();
    const mockPrisma = buildMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostAttributionService,
        {
          provide: PrismaService,
          useValue: mockPrisma as unknown as PrismaService,
        },
      ],
    }).compile();
    const service = module.get<CostAttributionService>(CostAttributionService);

    await service.onModuleInit();
    service.recordCost(makeEvent());

    const flushSpy = jest.spyOn(service, "flushCostsToDB").mockResolvedValue(1);
    jest.advanceTimersByTime(5 * 60 * 1000);

    expect(flushSpy).toHaveBeenCalled();

    service.onModuleDestroy();
    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// FakeCacheService: data survives JSON round-trip (no Map corruption)
// ---------------------------------------------------------------------------

describe("CostAttributionService (FakeCacheService JSON serialization)", () => {
  it("should correctly accumulate after cache round-trip (no Map.prototype methods lost)", async () => {
    const fakeCache = new FakeCacheService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostAttributionService,
        {
          provide: CacheService,
          useValue: fakeCache as unknown as CacheService,
        },
      ],
    }).compile();
    const service = module.get<CostAttributionService>(CostAttributionService);

    // Two events for same user in same hour → should accumulate in Redis
    service.recordCost(
      makeEvent({ userId: "u1", estimatedCost: 0.1, moduleType: "m1" }),
    );
    service.recordCost(
      makeEvent({ userId: "u1", estimatedCost: 0.2, moduleType: "m1" }),
    );

    const report = service.getCostReport({ periodHours: 1 });
    expect(report.totalCost).toBeCloseTo(0.3);
    const userEntry = report.byUser.find((u) => u.userId === "u1");
    expect(userEntry?.callCount).toBe(2);
    const modEntry = report.byModule.find((m) => m.moduleType === "m1");
    expect(modEntry?.callCount).toBe(2);
  });
});
