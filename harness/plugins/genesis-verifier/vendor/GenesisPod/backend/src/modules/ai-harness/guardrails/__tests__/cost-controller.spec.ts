import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { CostController, BudgetPeriod } from "../resources/cost-controller";
import { CacheService } from "@/common/cache/cache.service";
import { ModelPricingRegistry } from "@/modules/ai-engine/llm/models/pricing/model-pricing.registry";

jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

const mockCacheService = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
};

// 替代之前的 6 模型硬编码价格表 — production 路径走 ModelPricingRegistry
// (DB AIModel 表)，spec 里 mock 该 registry 验证 calculateCost 真去查它。
const PRICING_FIXTURE: Record<
  string,
  { inputPricePerM: number; outputPricePerM: number }
> = {
  "gpt-4o": { inputPricePerM: 2.5, outputPricePerM: 10 },
  "gpt-4o-mini": { inputPricePerM: 0.15, outputPricePerM: 0.6 },
  "gpt-4-turbo": { inputPricePerM: 10, outputPricePerM: 30 },
  "claude-3-5-sonnet": { inputPricePerM: 3, outputPricePerM: 15 },
  "claude-3-opus": { inputPricePerM: 15, outputPricePerM: 75 },
  "claude-3-haiku": { inputPricePerM: 0.25, outputPricePerM: 1.25 },
};

const mockPricingRegistry = {
  estimateCost: jest.fn(
    (modelId: string, inputTokens: number, outputTokens: number) => {
      const p = PRICING_FIXTURE[modelId];
      if (!p) return null;
      return (
        (inputTokens / 1_000_000) * p.inputPricePerM +
        (outputTokens / 1_000_000) * p.outputPricePerM
      );
    },
  ),
};

describe("CostController", () => {
  let controller: CostController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostController,
        { provide: CacheService, useValue: mockCacheService },
        { provide: ModelPricingRegistry, useValue: mockPricingRegistry },
      ],
    }).compile();
    controller = module.get<CostController>(CostController);
  });

  afterEach(() => jest.clearAllMocks());

  // ==================== calculateCost ====================

  describe("calculateCost", () => {
    it("should delegate to ModelPricingRegistry for known model gpt-4o", () => {
      // gpt-4o: input=2.5/M, output=10/M (via mock registry — DB AIModel in prod)
      const cost = controller.calculateCost("gpt-4o", 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(12.5, 4);
      expect(mockPricingRegistry.estimateCost).toHaveBeenCalledWith(
        "gpt-4o",
        1_000_000,
        1_000_000,
      );
    });

    it("should calculate cost for gpt-4o-mini via registry", () => {
      const cost = controller.calculateCost(
        "gpt-4o-mini",
        1_000_000,
        1_000_000,
      );
      expect(cost).toBeCloseTo(0.75, 4);
    });

    it("should calculate cost for claude-3-5-sonnet via registry", () => {
      const cost = controller.calculateCost("claude-3-5-sonnet", 1_000_000, 0);
      expect(cost).toBeCloseTo(3, 4);
    });

    it("should calculate cost for claude-3-opus via registry", () => {
      const cost = controller.calculateCost("claude-3-opus", 0, 1_000_000);
      expect(cost).toBeCloseTo(75, 4);
    });

    it("should calculate cost for claude-3-haiku via registry", () => {
      const cost = controller.calculateCost(
        "claude-3-haiku",
        1_000_000,
        1_000_000,
      );
      expect(cost).toBeCloseTo(1.5, 4);
    });

    it("should calculate cost for gpt-4-turbo via registry", () => {
      const cost = controller.calculateCost(
        "gpt-4-turbo",
        1_000_000,
        1_000_000,
      );
      expect(cost).toBeCloseTo(40, 4);
    });

    it("should return 0 + warn for unknown model (no silent 0.001/k estimation)", () => {
      // Old behavior: silent (in+out)*0.001/1000 假估算 → 让预算永远扣不到钱。
      // New behavior: 0 + warn 一次，admin 应在 /admin/ai/models 配 priceXXX
      const cost = controller.calculateCost("unknown-model", 1000, 1000);
      expect(cost).toBe(0);
    });

    it("should return 0 cost for 0 tokens with known model", () => {
      const cost = controller.calculateCost("gpt-4o", 0, 0);
      expect(cost).toBe(0);
    });
  });

  // ==================== setModelPricing ====================

  describe("setModelPricing", () => {
    it("should allow setting custom model pricing", () => {
      controller.setModelPricing({
        model: "custom-model",
        inputPricePerMillion: 5,
        outputPricePerMillion: 15,
      });
      const cost = controller.calculateCost(
        "custom-model",
        1_000_000,
        1_000_000,
      );
      expect(cost).toBeCloseTo(20, 4);
    });

    it("should override existing pricing", () => {
      controller.setModelPricing({
        model: "gpt-4o",
        inputPricePerMillion: 1,
        outputPricePerMillion: 1,
      });
      const cost = controller.calculateCost("gpt-4o", 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(2, 4);
    });
  });

  // ==================== recordCost ====================

  describe("recordCost", () => {
    it("should create a full cost record with id and timestamp", () => {
      const record = controller.recordCost({
        category: "llm",
        operation: "chat",
        tokens: { input: 100, output: 50, total: 150 },
        cost: 0.01,
      });
      expect(record.id).toBeDefined();
      expect(record.timestamp).toBeInstanceOf(Date);
      expect(record.category).toBe("llm");
      expect(record.operation).toBe("chat");
      expect(record.cost).toBe(0.01);
    });

    it("should accumulate records in stats", () => {
      controller.recordCost({ category: "llm", operation: "op1", cost: 0.5 });
      controller.recordCost({ category: "llm", operation: "op2", cost: 1.5 });
      const stats = controller.getStats();
      expect(stats.totalCost).toBeCloseTo(2.0, 6);
    });

    it("should record tokens when provided", () => {
      controller.recordCost({
        category: "embedding",
        operation: "embed",
        tokens: { input: 500, output: 0, total: 500 },
        cost: 0.001,
      });
      const stats = controller.getStats();
      expect(stats.totalTokens).toBe(500);
    });

    it("should write record to Redis when cacheService present", async () => {
      mockCacheService.set.mockResolvedValue(undefined);
      controller.recordCost({ category: "llm", operation: "op", cost: 0.1 });
      // Allow void promise to settle
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringContaining("ai:cost:record:llm:"),
        expect.anything(),
        86400,
      );
    });

    it("should work without tokens field", () => {
      const record = controller.recordCost({
        category: "search",
        operation: "web-search",
        cost: 0.002,
      });
      expect(record.tokens).toBeUndefined();
      const stats = controller.getStats();
      expect(stats.totalTokens).toBe(0);
    });

    it("should update budget used when budget matches category", () => {
      const budget = controller.createBudget({
        name: "test-budget",
        amount: 10,
        period: "daily",
        categories: ["llm"],
      });
      controller.recordCost({ category: "llm", operation: "op", cost: 2 });
      const budgets = controller.getBudgets();
      const found = budgets.find((b) => b.id === budget.id);
      expect(found?.used).toBeCloseTo(2, 6);
    });

    it("should not update budget when category does not match", () => {
      const budget = controller.createBudget({
        name: "llm-only",
        amount: 10,
        period: "daily",
        categories: ["llm"],
      });
      controller.recordCost({ category: "image", operation: "gen", cost: 5 });
      const budgets = controller.getBudgets();
      const found = budgets.find((b) => b.id === budget.id);
      expect(found?.used).toBe(0);
    });

    it("should trigger warning log when budget threshold reached", () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      controller.createBudget({
        name: "warn-budget",
        amount: 10,
        period: "daily",
        alertThreshold: 0.8,
      });
      controller.recordCost({ category: "llm", operation: "op", cost: 9 });
      expect(warnSpy).toHaveBeenCalled();
    });

    it("should skip and reset expired budget during updateBudgets", () => {
      const budget = controller.createBudget({
        name: "about-to-expire",
        amount: 10,
        period: "hourly",
      });
      // Manually expire the budget
      (budget as any).periodEnd = new Date(Date.now() - 1000);
      // recordCost triggers updateBudgets which hits the expired check
      expect(() =>
        controller.recordCost({ category: "llm", operation: "op", cost: 1 }),
      ).not.toThrow();
    });
  });

  // ==================== checkBudget ====================

  describe("checkBudget", () => {
    it("should allow when no budgets are configured", () => {
      const result = controller.checkBudget(100, "llm");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(-1);
      expect(result.usageRate).toBe(0);
      expect(result.alertTriggered).toBe(false);
    });

    it("should allow when estimated cost is within budget", () => {
      controller.createBudget({ name: "b1", amount: 100, period: "daily" });
      const result = controller.checkBudget(50);
      expect(result.allowed).toBe(true);
    });

    it("should deny when estimated cost would exceed budget", () => {
      controller.createBudget({ name: "b2", amount: 10, period: "daily" });
      controller.recordCost({ category: "llm", operation: "op", cost: 9 });
      const result = controller.checkBudget(5);
      expect(result.allowed).toBe(false);
      expect(result.triggeredBudget).toBe("b2");
      expect(result.reason).toContain("b2");
    });

    it("should trigger alert when usage rate meets alertThreshold", () => {
      controller.createBudget({
        name: "alert-b",
        amount: 100,
        period: "daily",
        alertThreshold: 0.8,
      });
      controller.recordCost({ category: "llm", operation: "op", cost: 85 });
      const result = controller.checkBudget(1);
      expect(result.alertTriggered).toBe(true);
    });

    it("should skip budgets that do not match category filter", () => {
      controller.createBudget({
        name: "llm-budget",
        amount: 10,
        period: "daily",
        categories: ["llm"],
      });
      // Estimating for "image" category — budget is for "llm" only
      const result = controller.checkBudget(100, "image");
      expect(result.allowed).toBe(true);
    });

    it("should check budget when category matches", () => {
      controller.createBudget({
        name: "llm-budget2",
        amount: 10,
        period: "daily",
        categories: ["llm"],
      });
      controller.recordCost({ category: "llm", operation: "op", cost: 8 });
      const result = controller.checkBudget(5, "llm");
      expect(result.allowed).toBe(false);
    });

    it("should skip and reset expired budgets", () => {
      // Create a budget with expired period by manipulating internals
      const budget = controller.createBudget({
        name: "expired",
        amount: 10,
        period: "hourly",
      });
      // Manually expire it
      (budget as any).periodEnd = new Date(Date.now() - 1000);
      const result = controller.checkBudget(1000);
      expect(result.allowed).toBe(true);
    });
  });

  // ==================== createBudget ====================

  describe("createBudget", () => {
    const periods: BudgetPeriod[] = [
      "hourly",
      "daily",
      "weekly",
      "monthly",
      "yearly",
    ];

    for (const period of periods) {
      it(`should create budget for period: ${period}`, () => {
        const budget = controller.createBudget({
          name: `budget-${period}`,
          amount: 100,
          period,
        });
        expect(budget.id).toBeDefined();
        expect(budget.name).toBe(`budget-${period}`);
        expect(budget.amount).toBe(100);
        expect(budget.period).toBe(period);
        expect(budget.used).toBe(0);
        expect(budget.periodStart).toBeInstanceOf(Date);
        expect(budget.periodEnd).toBeInstanceOf(Date);
        expect(budget.periodEnd.getTime()).toBeGreaterThan(
          budget.periodStart.getTime(),
        );
      });
    }

    it("should set default alertThreshold to 0.8 when not provided", () => {
      const budget = controller.createBudget({
        name: "default-alert",
        amount: 100,
        period: "daily",
      });
      expect(budget.alertThreshold).toBe(0.8);
    });

    it("should use provided alertThreshold", () => {
      const budget = controller.createBudget({
        name: "custom-alert",
        amount: 100,
        period: "daily",
        alertThreshold: 0.5,
      });
      expect(budget.alertThreshold).toBe(0.5);
    });

    it("should set categories when provided", () => {
      const budget = controller.createBudget({
        name: "cat-budget",
        amount: 100,
        period: "daily",
        categories: ["llm", "embedding"],
      });
      expect(budget.categories).toEqual(["llm", "embedding"]);
    });

    it("should write budget to Redis when cacheService is present", async () => {
      mockCacheService.set.mockResolvedValue(undefined);
      controller.createBudget({
        name: "redis-budget",
        amount: 100,
        period: "daily",
      });
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringContaining("ai:cost:budget:"),
        expect.anything(),
        expect.any(Number),
      );
    });
  });

  // ==================== getStats ====================

  describe("getStats", () => {
    it("should return zeroed stats with no records", () => {
      const stats = controller.getStats();
      expect(stats.totalCost).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.byCategory).toEqual({});
      expect(stats.byOperation).toEqual({});
    });

    it("should group costs by category", () => {
      controller.recordCost({ category: "llm", operation: "chat", cost: 1.0 });
      controller.recordCost({
        category: "image",
        operation: "generate",
        cost: 0.5,
      });
      controller.recordCost({ category: "llm", operation: "embed", cost: 0.2 });
      const stats = controller.getStats();
      expect(stats.byCategory["llm"]).toBeCloseTo(1.2, 6);
      expect(stats.byCategory["image"]).toBeCloseTo(0.5, 6);
    });

    it("should group costs by operation", () => {
      controller.recordCost({ category: "llm", operation: "chat", cost: 1.0 });
      controller.recordCost({ category: "llm", operation: "chat", cost: 2.0 });
      const stats = controller.getStats();
      expect(stats.byOperation["chat"]).toBeCloseTo(3.0, 6);
    });

    it("should filter by startDate", () => {
      controller.recordCost({ category: "llm", operation: "op1", cost: 1.0 });
      const futureStart = new Date(Date.now() + 10000);
      const stats = controller.getStats({ startDate: futureStart });
      expect(stats.totalCost).toBe(0);
    });

    it("should filter by endDate", () => {
      controller.recordCost({ category: "llm", operation: "op1", cost: 1.0 });
      const pastEnd = new Date(Date.now() - 10000);
      const stats = controller.getStats({ endDate: pastEnd });
      expect(stats.totalCost).toBe(0);
    });

    it("should filter by category", () => {
      controller.recordCost({ category: "llm", operation: "op1", cost: 1.0 });
      controller.recordCost({ category: "image", operation: "op2", cost: 2.0 });
      const stats = controller.getStats({ category: "llm" });
      expect(stats.totalCost).toBeCloseTo(1.0, 6);
    });

    it("should filter by userId", () => {
      controller.recordCost({
        category: "llm",
        operation: "op1",
        cost: 1.0,
        userId: "user-a",
      });
      controller.recordCost({
        category: "llm",
        operation: "op2",
        cost: 2.0,
        userId: "user-b",
      });
      const stats = controller.getStats({ userId: "user-a" });
      expect(stats.totalCost).toBeCloseTo(1.0, 6);
    });

    it("should sum tokens across records", () => {
      controller.recordCost({
        category: "llm",
        operation: "chat",
        tokens: { input: 100, output: 50, total: 150 },
        cost: 0.01,
      });
      controller.recordCost({
        category: "llm",
        operation: "chat",
        tokens: { input: 200, output: 100, total: 300 },
        cost: 0.02,
      });
      const stats = controller.getStats();
      expect(stats.totalTokens).toBe(450);
    });
  });

  // ==================== getBudgets ====================

  describe("getBudgets", () => {
    it("should return empty array when no budgets", () => {
      expect(controller.getBudgets()).toEqual([]);
    });

    it("should return all created budgets", () => {
      controller.createBudget({ name: "b1", amount: 100, period: "daily" });
      controller.createBudget({ name: "b2", amount: 200, period: "weekly" });
      const budgets = controller.getBudgets();
      expect(budgets).toHaveLength(2);
    });
  });

  // ==================== Without CacheService ====================

  describe("without CacheService (Optional)", () => {
    let controllerNoCache: CostController;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [CostController, { provide: CacheService, useValue: null }],
      })
        .overrideProvider(CacheService)
        .useValue(undefined)
        .compile();
      controllerNoCache = module.get<CostController>(CostController);
    });

    it("should record costs without error", () => {
      const record = controllerNoCache.recordCost({
        category: "llm",
        operation: "chat",
        cost: 0.1,
      });
      expect(record.id).toBeDefined();
    });

    it("should create budget without error", () => {
      const budget = controllerNoCache.createBudget({
        name: "no-cache-budget",
        amount: 100,
        period: "daily",
      });
      expect(budget.id).toBeDefined();
    });

    it("should check budget without error", () => {
      const result = controllerNoCache.checkBudget(1);
      expect(result.allowed).toBe(true);
    });
  });

  // ==================== Period calculations ====================

  describe("period boundary calculations", () => {
    it("hourly period should start at current hour and end 1 hour later", () => {
      const budget = controller.createBudget({
        name: "hourly-test",
        amount: 1,
        period: "hourly",
      });
      expect(budget.periodStart.getMinutes()).toBe(0);
      expect(budget.periodEnd.getTime() - budget.periodStart.getTime()).toBe(
        60 * 60 * 1000,
      );
    });

    it("daily period should start at midnight and end next midnight", () => {
      const budget = controller.createBudget({
        name: "daily-test",
        amount: 1,
        period: "daily",
      });
      expect(budget.periodStart.getHours()).toBe(0);
      expect(budget.periodStart.getMinutes()).toBe(0);
      // Period end is the next midnight; allow 2 hours tolerance for DST transitions
      const diffMs = budget.periodEnd.getTime() - budget.periodStart.getTime();
      const oneDayMs = 24 * 60 * 60 * 1000;
      expect(diffMs).toBeGreaterThanOrEqual(oneDayMs - 2 * 60 * 60 * 1000);
      expect(diffMs).toBeLessThanOrEqual(oneDayMs + 2 * 60 * 60 * 1000);
    });

    it("monthly period should start on 1st and end on 1st of next month", () => {
      const budget = controller.createBudget({
        name: "monthly-test",
        amount: 1,
        period: "monthly",
      });
      expect(budget.periodStart.getDate()).toBe(1);
      expect(budget.periodEnd.getDate()).toBe(1);
    });

    it("yearly period should start Jan 1 and end Jan 1 next year", () => {
      const budget = controller.createBudget({
        name: "yearly-test",
        amount: 1,
        period: "yearly",
      });
      expect(budget.periodStart.getMonth()).toBe(0);
      expect(budget.periodStart.getDate()).toBe(1);
      expect(budget.periodEnd.getMonth()).toBe(0);
      expect(budget.periodEnd.getDate()).toBe(1);
      expect(budget.periodEnd.getFullYear()).toBe(
        budget.periodStart.getFullYear() + 1,
      );
    });

    it("weekly period should span 7 days", () => {
      const budget = controller.createBudget({
        name: "weekly-test",
        amount: 1,
        period: "weekly",
      });
      const diff = budget.periodEnd.getTime() - budget.periodStart.getTime();
      // Allow 2 hours tolerance for DST transitions within the 7-day window
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(diff).toBeGreaterThanOrEqual(sevenDaysMs - 2 * 60 * 60 * 1000);
      expect(diff).toBeLessThanOrEqual(sevenDaysMs + 2 * 60 * 60 * 1000);
    });
  });
});
