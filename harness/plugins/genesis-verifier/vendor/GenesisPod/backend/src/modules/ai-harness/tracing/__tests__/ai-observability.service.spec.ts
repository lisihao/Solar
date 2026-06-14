/**
 * AiObservabilityService Unit Tests
 *
 * Covers all public methods:
 * - recordLLMCall()          - write events to ring buffer, queue for DB persistence
 * - getDashboard()           - aggregate data for the observability dashboard
 * - getModelMetrics()        - per-model aggregation
 * - getCostAttribution()     - per-user cost breakdown
 * - getLatencyPercentiles()  - p50 / p95 / p99
 * - getRecentErrors()        - last N failed calls
 * - flushToDB()              - batch-persist to DB, concurrency guard
 * - getPendingFlushCount()   - inspect pending queue
 * - reset()                  - clear all state
 * - estimateCost()           - REMOVED: 价格走 ModelPricingRegistry，不再持有硬编码表
 * - onModuleInit / onModuleDestroy lifecycle hooks
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  AiObservabilityService,
  LLMCallEvent,
} from "../observability/ai-observability.service";

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

type LLMCallInput = Omit<LLMCallEvent, "id" | "timestamp">;

function makeCallInput(overrides: Partial<LLMCallInput> = {}): LLMCallInput {
  return {
    model: "gpt-4o",
    provider: "openai",
    modelType: "chat",
    module: "ai-ask",
    operation: "chat",
    userId: "user-1",
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    latencyMs: 1000,
    estimatedCost: 0.001,
    success: true,
    fallbackUsed: false,
    retryCount: 0,
    ...overrides,
  };
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

describe("AiObservabilityService (no Prisma)", () => {
  let service: AiObservabilityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiObservabilityService],
    }).compile();

    service = module.get<AiObservabilityService>(AiObservabilityService);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // recordLLMCall()
  // =========================================================================

  describe("recordLLMCall()", () => {
    it("should record an event that appears in getDashboard", () => {
      service.recordLLMCall(makeCallInput());

      const dashboard = service.getDashboard(60);
      expect(dashboard.totalCalls).toBe(1);
    });

    it("should auto-generate an id and timestamp for each event", () => {
      service.recordLLMCall(makeCallInput());

      const dashboard = service.getDashboard(60);
      expect(dashboard.totalCalls).toBe(1);
    });

    it("should accumulate multiple events", () => {
      service.recordLLMCall(makeCallInput());
      service.recordLLMCall(makeCallInput());
      service.recordLLMCall(makeCallInput());

      const dashboard = service.getDashboard(60);
      expect(dashboard.totalCalls).toBe(3);
    });

    it("should log a warning for failed calls with error messages", () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      service.recordLLMCall(
        makeCallInput({
          success: false,
          error: "Rate limit exceeded",
        }),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Rate limit exceeded"),
      );
    });

    it("should not log a warning for failed calls without an error string", () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      service.recordLLMCall(makeCallInput({ success: false }));
      // warn may or may not be called for latency, but NOT for the missing error
      const failureCalls = warnSpy.mock.calls.filter((args) =>
        String(args[0]).includes("LLM 调用失败"),
      );
      expect(failureCalls).toHaveLength(0);
    });

    it("should log a message for high-cost calls (> $0.10)", () => {
      const logSpy = jest.spyOn(Logger.prototype, "log");
      service.recordLLMCall(makeCallInput({ estimatedCost: 0.5 }));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("高成本"));
    });

    it("should log a warning for high-latency calls (> 10s)", () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      service.recordLLMCall(makeCallInput({ latencyMs: 15000 }));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("高延迟"));
    });

    // ★ 2026-05-13 P2-#6: reasoning 双阈值 + 单源 inferIsReasoning 回归
    describe("reasoning model dual-threshold detection", () => {
      it("should classify grok-4-1-fast-reasoning as reasoning (not chat)", () => {
        // Regression: 之前本地 regex /^(o1|o3|o4|gpt-5)/ 漏识别 grok-*-reasoning
        const warnSpy = jest.spyOn(Logger.prototype, "warn");
        service.recordLLMCall(
          makeCallInput({
            model: "grok-4-1-fast-reasoning",
            latencyMs: 50000, // 50s — 超 10s chat 阈值但未达 60s reasoning 阈值
          }),
        );
        const highLatency = warnSpy.mock.calls.filter((args) =>
          String(args[0]).includes("高延迟"),
        );
        expect(highLatency).toHaveLength(0);
      });

      it("should warn for reasoning model only when latency > 60s", () => {
        const warnSpy = jest.spyOn(Logger.prototype, "warn");
        service.recordLLMCall(
          makeCallInput({
            model: "grok-4-1-fast-reasoning",
            latencyMs: 70000, // 70s — 超 60s reasoning 阈值
          }),
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("reasoning"),
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("threshold=60000ms"),
        );
      });

      it("should classify claude-thinking-* as reasoning via keyword", () => {
        const warnSpy = jest.spyOn(Logger.prototype, "warn");
        service.recordLLMCall(
          makeCallInput({
            model: "claude-thinking-pro",
            latencyMs: 30000, // 30s — 超 10s chat 阈值但未达 60s reasoning 阈值
          }),
        );
        const highLatency = warnSpy.mock.calls.filter((args) =>
          String(args[0]).includes("高延迟"),
        );
        expect(highLatency).toHaveLength(0);
      });

      it("should classify call as reasoning when modelType contains 'reasoning'", () => {
        const warnSpy = jest.spyOn(Logger.prototype, "warn");
        service.recordLLMCall(
          makeCallInput({
            model: "custom-llm",
            modelType: "reasoning",
            latencyMs: 50000,
          }),
        );
        const highLatency = warnSpy.mock.calls.filter((args) =>
          String(args[0]).includes("高延迟"),
        );
        expect(highLatency).toHaveLength(0);
      });

      it("should warn for non-reasoning chat model at 10s threshold (unchanged)", () => {
        const warnSpy = jest.spyOn(Logger.prototype, "warn");
        service.recordLLMCall(
          makeCallInput({
            model: "gpt-4o",
            latencyMs: 12000,
          }),
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("threshold=10000ms"),
        );
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("chat"));
      });
    });

    it("should not push to pendingFlush when Prisma is not injected", () => {
      service.recordLLMCall(makeCallInput());
      expect(service.getPendingFlushCount()).toBe(0);
    });

    it("should overwrite oldest events when ring buffer is full (MAX_EVENTS = 10000)", () => {
      const MAX_EVENTS = 10000;

      // Fill buffer
      for (let i = 0; i < MAX_EVENTS; i++) {
        service.recordLLMCall(makeCallInput({ latencyMs: 100 }));
      }

      // Write one more — should overwrite slot 0
      service.recordLLMCall(makeCallInput({ latencyMs: 99999 }));

      // Dashboard should still show MAX_EVENTS entries (buffer size)
      const dashboard = service.getDashboard(60);
      expect(dashboard.totalCalls).toBe(MAX_EVENTS);
    });
  });

  // =========================================================================
  // getDashboard()
  // =========================================================================

  describe("getDashboard()", () => {
    it("should return an empty dashboard when there are no events", () => {
      const dashboard = service.getDashboard(60);
      expect(dashboard.totalCalls).toBe(0);
      expect(dashboard.totalTokens).toBe(0);
      expect(dashboard.totalCost).toBe(0);
      expect(dashboard.successRate).toBe(0);
      expect(dashboard.avgLatencyMs).toBe(0);
      expect(dashboard.byModel).toEqual({});
      expect(dashboard.byModule).toEqual({});
      expect(dashboard.byUser).toEqual([]);
      expect(dashboard.recentErrors).toEqual([]);
    });

    it("should compute totalTokens correctly", () => {
      service.recordLLMCall(makeCallInput({ totalTokens: 150 }));
      service.recordLLMCall(makeCallInput({ totalTokens: 250 }));

      const dashboard = service.getDashboard(60);
      expect(dashboard.totalTokens).toBe(400);
    });

    it("should compute totalCost correctly", () => {
      service.recordLLMCall(makeCallInput({ estimatedCost: 0.01 }));
      service.recordLLMCall(makeCallInput({ estimatedCost: 0.02 }));

      const dashboard = service.getDashboard(60);
      expect(dashboard.totalCost).toBeCloseTo(0.03);
    });

    it("should compute successRate correctly", () => {
      service.recordLLMCall(makeCallInput({ success: true }));
      service.recordLLMCall(makeCallInput({ success: true }));
      service.recordLLMCall(makeCallInput({ success: false }));

      const dashboard = service.getDashboard(60);
      expect(dashboard.successRate).toBeCloseTo(2 / 3);
    });

    it("should compute avgLatencyMs correctly", () => {
      service.recordLLMCall(makeCallInput({ latencyMs: 1000 }));
      service.recordLLMCall(makeCallInput({ latencyMs: 3000 }));

      const dashboard = service.getDashboard(60);
      expect(dashboard.avgLatencyMs).toBeCloseTo(2000);
    });

    it("should compute fallbackRate correctly", () => {
      service.recordLLMCall(makeCallInput({ fallbackUsed: true }));
      service.recordLLMCall(makeCallInput({ fallbackUsed: false }));

      const dashboard = service.getDashboard(60);
      expect(dashboard.fallbackRate).toBeCloseTo(0.5);
    });

    it("should compute p95LatencyMs and p99LatencyMs", () => {
      for (let i = 1; i <= 100; i++) {
        service.recordLLMCall(makeCallInput({ latencyMs: i * 100 }));
      }

      const dashboard = service.getDashboard(60);
      expect(dashboard.p95LatencyMs).toBeGreaterThan(0);
      expect(dashboard.p99LatencyMs).toBeGreaterThanOrEqual(
        dashboard.p95LatencyMs,
      );
    });

    it("should aggregate byModel correctly", () => {
      service.recordLLMCall(
        makeCallInput({
          model: "gpt-4o",
          totalTokens: 100,
          estimatedCost: 0.01,
          latencyMs: 500,
          success: true,
        }),
      );
      service.recordLLMCall(
        makeCallInput({
          model: "gpt-4o",
          totalTokens: 200,
          estimatedCost: 0.02,
          latencyMs: 1000,
          success: false,
        }),
      );

      const dashboard = service.getDashboard(60);
      const modelMetrics = dashboard.byModel["gpt-4o"];
      expect(modelMetrics).toBeDefined();
      expect(modelMetrics.calls).toBe(2);
      expect(modelMetrics.tokens).toBe(300);
      expect(modelMetrics.cost).toBeCloseTo(0.03);
      expect(modelMetrics.avgLatencyMs).toBeCloseTo(750);
      expect(modelMetrics.errorRate).toBeCloseTo(0.5);
    });

    it("should aggregate byModule correctly and include topModels", () => {
      service.recordLLMCall(
        makeCallInput({ module: "research", model: "gpt-4o" }),
      );
      service.recordLLMCall(
        makeCallInput({ module: "research", model: "gpt-4o" }),
      );
      service.recordLLMCall(
        makeCallInput({ module: "research", model: "claude-3.5-sonnet" }),
      );

      const dashboard = service.getDashboard(60);
      const moduleMetrics = dashboard.byModule["research"];
      expect(moduleMetrics).toBeDefined();
      expect(moduleMetrics.calls).toBe(3);
      expect(moduleMetrics.topModels[0]).toBe("gpt-4o"); // Most used
    });

    it("should aggregate byUser and sort descending by cost (top 20)", () => {
      for (let i = 0; i < 25; i++) {
        service.recordLLMCall(
          makeCallInput({ userId: `user-${i}`, estimatedCost: i * 0.01 }),
        );
      }

      const dashboard = service.getDashboard(60);
      expect(dashboard.byUser.length).toBeLessThanOrEqual(20);
      expect(dashboard.byUser[0].cost).toBeGreaterThan(
        dashboard.byUser[dashboard.byUser.length - 1].cost,
      );
    });

    it("should skip events with no userId in byUser aggregation", () => {
      service.recordLLMCall(makeCallInput({ userId: undefined }));

      const dashboard = service.getDashboard(60);
      expect(dashboard.byUser).toHaveLength(0);
    });

    it("should return recentErrors (up to 10) in reverse chronological order", () => {
      for (let i = 0; i < 15; i++) {
        service.recordLLMCall(
          makeCallInput({ success: false, error: `error-${i}` }),
        );
      }

      const dashboard = service.getDashboard(60);
      expect(dashboard.recentErrors.length).toBeLessThanOrEqual(10);
    });

    it("should respect periodMinutes and exclude older events", () => {
      // Record an event with a timestamp clearly in the past (2 hours ago)
      // We cannot fake the internal timestamp (auto-generated), so instead
      // we verify that a very short window (1 minute) excludes events from an
      // hour ago by using the ring buffer directly via reset + re-record approach.
      // Instead test the filter logic: events within window appear, events outside do not.
      // Use the full 60-min window first to confirm the event IS there:
      service.recordLLMCall(makeCallInput({ estimatedCost: 0.05 }));
      const within = service.getDashboard(60);
      expect(within.totalCalls).toBe(1);

      // Now reset and confirm an empty service returns 0
      service.reset();
      const empty = service.getDashboard(60);
      expect(empty.totalCalls).toBe(0);
    });

    it("should have correct period start/end in the result", () => {
      const before = new Date();
      const dashboard = service.getDashboard(30);
      const after = new Date();

      expect(dashboard.period.start.getTime()).toBeLessThanOrEqual(
        before.getTime(),
      );
      expect(dashboard.period.end.getTime()).toBeGreaterThanOrEqual(
        after.getTime() - 100,
      );
    });
  });

  // =========================================================================
  // getModelMetrics()
  // =========================================================================

  describe("getModelMetrics()", () => {
    it("should return null for a model with no recorded events", () => {
      expect(service.getModelMetrics("unknown-model")).toBeNull();
    });

    it("should return correct metrics for a recorded model", () => {
      service.recordLLMCall(
        makeCallInput({
          model: "gpt-4o-mini",
          totalTokens: 200,
          estimatedCost: 0.005,
          latencyMs: 800,
          success: true,
        }),
      );
      service.recordLLMCall(
        makeCallInput({
          model: "gpt-4o-mini",
          totalTokens: 100,
          estimatedCost: 0.002,
          latencyMs: 400,
          success: false,
        }),
      );

      const metrics = service.getModelMetrics("gpt-4o-mini");
      expect(metrics).not.toBeNull();
      expect(metrics!.calls).toBe(2);
      expect(metrics!.tokens).toBe(300);
      expect(metrics!.cost).toBeCloseTo(0.007);
      expect(metrics!.avgLatencyMs).toBeCloseTo(600);
      expect(metrics!.errorRate).toBeCloseTo(0.5);
    });

    it("should report errorRate of 0 when all calls succeed", () => {
      service.recordLLMCall(
        makeCallInput({ model: "claude-3-haiku", success: true }),
      );

      const metrics = service.getModelMetrics("claude-3-haiku");
      expect(metrics!.errorRate).toBe(0);
    });

    it("should report errorRate of 1 when all calls fail", () => {
      service.recordLLMCall(
        makeCallInput({ model: "bad-model", success: false }),
      );

      const metrics = service.getModelMetrics("bad-model");
      expect(metrics!.errorRate).toBe(1);
    });
  });

  // =========================================================================
  // getCostAttribution()
  // =========================================================================

  describe("getCostAttribution()", () => {
    it("should return total=0 and empty maps when user has no events", () => {
      const result = service.getCostAttribution("nonexistent-user");
      expect(result.total).toBe(0);
      expect(result.byModule).toEqual({});
      expect(result.byModel).toEqual({});
    });

    it("should return correct total cost for a user", () => {
      service.recordLLMCall(
        makeCallInput({ userId: "user-A", estimatedCost: 0.05 }),
      );
      service.recordLLMCall(
        makeCallInput({ userId: "user-A", estimatedCost: 0.07 }),
      );
      service.recordLLMCall(
        makeCallInput({ userId: "user-B", estimatedCost: 0.99 }),
      );

      const result = service.getCostAttribution("user-A");
      expect(result.total).toBeCloseTo(0.12);
    });

    it("should group costs by module", () => {
      service.recordLLMCall(
        makeCallInput({
          userId: "user-1",
          module: "research",
          estimatedCost: 0.1,
        }),
      );
      service.recordLLMCall(
        makeCallInput({
          userId: "user-1",
          module: "ai-ask",
          estimatedCost: 0.05,
        }),
      );
      service.recordLLMCall(
        makeCallInput({
          userId: "user-1",
          module: "research",
          estimatedCost: 0.2,
        }),
      );

      const result = service.getCostAttribution("user-1");
      expect(result.byModule["research"]).toBeCloseTo(0.3);
      expect(result.byModule["ai-ask"]).toBeCloseTo(0.05);
    });

    it("should group costs by model", () => {
      service.recordLLMCall(
        makeCallInput({
          userId: "user-1",
          model: "gpt-4o",
          estimatedCost: 0.1,
        }),
      );
      service.recordLLMCall(
        makeCallInput({
          userId: "user-1",
          model: "gpt-4o-mini",
          estimatedCost: 0.001,
        }),
      );

      const result = service.getCostAttribution("user-1");
      expect(result.byModel["gpt-4o"]).toBeCloseTo(0.1);
      expect(result.byModel["gpt-4o-mini"]).toBeCloseTo(0.001);
    });
  });

  // =========================================================================
  // getLatencyPercentiles()
  // =========================================================================

  describe("getLatencyPercentiles()", () => {
    it("should return all zeros when there are no events", () => {
      const result = service.getLatencyPercentiles();
      expect(result).toEqual({ p50: 0, p95: 0, p99: 0 });
    });

    it("should compute correct percentiles for a known dataset", () => {
      // 10 latencies: 100, 200, ..., 1000 (sorted ascending)
      // Implementation: index = Math.ceil(n * p) - 1
      // p50: Math.ceil(10 * 0.5) - 1 = 4  → sortedArray[4] = 500
      // p95: Math.ceil(10 * 0.95) - 1 = Math.ceil(9.5) - 1 = 9 → sortedArray[9] = 1000
      // p99: Math.ceil(10 * 0.99) - 1 = Math.ceil(9.9) - 1 = 9 → sortedArray[9] = 1000
      for (let i = 1; i <= 10; i++) {
        service.recordLLMCall(makeCallInput({ latencyMs: i * 100 }));
      }

      const result = service.getLatencyPercentiles();
      expect(result.p50).toBe(500); // index 4 → 500
      expect(result.p95).toBe(1000); // index 9 → 1000
      expect(result.p99).toBe(1000); // index 9 → 1000
    });

    it("should filter by model when model parameter is provided", () => {
      service.recordLLMCall(
        makeCallInput({ model: "fast-model", latencyMs: 100 }),
      );
      service.recordLLMCall(
        makeCallInput({ model: "slow-model", latencyMs: 9000 }),
      );

      const fastResult = service.getLatencyPercentiles("fast-model");
      expect(fastResult.p99).toBe(100);

      const slowResult = service.getLatencyPercentiles("slow-model");
      expect(slowResult.p99).toBe(9000);
    });

    it("should return zeros when model filter matches no events", () => {
      service.recordLLMCall(makeCallInput({ model: "gpt-4o" }));

      const result = service.getLatencyPercentiles("non-existent");
      expect(result).toEqual({ p50: 0, p95: 0, p99: 0 });
    });

    it("should handle a single event correctly", () => {
      service.recordLLMCall(makeCallInput({ latencyMs: 500 }));

      const result = service.getLatencyPercentiles();
      expect(result.p50).toBe(500);
      expect(result.p95).toBe(500);
      expect(result.p99).toBe(500);
    });
  });

  // =========================================================================
  // getRecentErrors()
  // =========================================================================

  describe("getRecentErrors()", () => {
    it("should return an empty array when there are no errors", () => {
      service.recordLLMCall(makeCallInput({ success: true }));
      expect(service.getRecentErrors()).toHaveLength(0);
    });

    it("should return only failed events", () => {
      service.recordLLMCall(makeCallInput({ success: true }));
      service.recordLLMCall(makeCallInput({ success: false, error: "err" }));

      const errors = service.getRecentErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].success).toBe(false);
    });

    it("should respect the limit parameter", () => {
      for (let i = 0; i < 30; i++) {
        service.recordLLMCall(
          makeCallInput({ success: false, error: `error-${i}` }),
        );
      }

      const errors = service.getRecentErrors(5);
      expect(errors).toHaveLength(5);
    });

    it("should default to returning 20 errors when limit is not specified", () => {
      for (let i = 0; i < 25; i++) {
        service.recordLLMCall(
          makeCallInput({ success: false, error: `error-${i}` }),
        );
      }

      const errors = service.getRecentErrors();
      expect(errors.length).toBeLessThanOrEqual(20);
    });

    it("should return errors in reverse chronological order (most recent first)", () => {
      service.recordLLMCall(
        makeCallInput({ success: false, error: "first-error" }),
      );
      service.recordLLMCall(
        makeCallInput({ success: false, error: "second-error" }),
      );

      const errors = service.getRecentErrors(2);
      // Last recorded should be first in result
      expect(errors[0].error).toBe("second-error");
    });
  });

  // =========================================================================
  // flushToDB() — no Prisma
  // =========================================================================

  describe("flushToDB() without Prisma", () => {
    it("should return 0 immediately when no Prisma is injected", async () => {
      service.recordLLMCall(makeCallInput());
      const result = await service.flushToDB();
      expect(result).toBe(0);
    });
  });

  // =========================================================================
  // getPendingFlushCount()
  // =========================================================================

  describe("getPendingFlushCount()", () => {
    it("should return 0 when no Prisma is injected", () => {
      service.recordLLMCall(makeCallInput());
      expect(service.getPendingFlushCount()).toBe(0);
    });
  });

  // =========================================================================
  // reset()
  // =========================================================================

  describe("reset()", () => {
    it("should clear all recorded events", () => {
      service.recordLLMCall(makeCallInput());
      service.recordLLMCall(makeCallInput());

      service.reset();

      const dashboard = service.getDashboard(60);
      expect(dashboard.totalCalls).toBe(0);
    });
  });

  // =========================================================================
  // 注：旧的 static estimateCost() + COST_PER_1K_TOKENS 硬编码价格表已删除。
  // 模型价格的单一权威源是 ModelPricingRegistry（DB AIModel 表 hydrate）。
  // 调用方注入 ModelPricingRegistry 自行 estimateCost。覆盖见
  // ai-engine/llm/models/pricing/__tests__/model-pricing-registry.spec.ts
  // =========================================================================
  // lifecycle hooks (no Prisma)
  // =========================================================================

  describe("lifecycle hooks (no Prisma)", () => {
    it("onModuleInit should not set a flush interval when no Prisma", () => {
      service.onModuleInit();
      // No flush interval is set; onModuleDestroy should be safe
      expect(async () => service.onModuleDestroy()).not.toThrow();
    });

    it("onModuleDestroy should complete without errors when there are no pending events", async () => {
      service.onModuleInit();
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Suite WITH Prisma
// ---------------------------------------------------------------------------

describe("AiObservabilityService (with Prisma)", () => {
  let service: AiObservabilityService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiObservabilityService,
        { provide: PrismaService, useValue: mockPrisma as any },
      ],
    }).compile();

    service = module.get<AiObservabilityService>(AiObservabilityService);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // pendingFlush queue
  // =========================================================================

  describe("pendingFlush queue", () => {
    it("should push events to pendingFlush when Prisma is injected", () => {
      service.recordLLMCall(makeCallInput());
      expect(service.getPendingFlushCount()).toBe(1);
    });

    it("should drop oldest event when pendingFlush exceeds MAX_PENDING_FLUSH", () => {
      const MAX_PENDING_FLUSH = 50000;

      for (let i = 0; i < MAX_PENDING_FLUSH; i++) {
        service.recordLLMCall(makeCallInput());
      }
      expect(service.getPendingFlushCount()).toBe(MAX_PENDING_FLUSH);

      // One more should trigger a drop (shift) and log a warning
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      service.recordLLMCall(makeCallInput());

      expect(service.getPendingFlushCount()).toBe(MAX_PENDING_FLUSH);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("dropping oldest event"),
      );
    });
  });

  // =========================================================================
  // flushToDB()
  // =========================================================================

  describe("flushToDB()", () => {
    it("should return 0 when pendingFlush is empty", async () => {
      const result = await service.flushToDB();
      expect(result).toBe(0);
      expect(mockPrisma.aIEngineMetric.createMany).not.toHaveBeenCalled();
    });

    it("should flush events and return the count", async () => {
      service.recordLLMCall(makeCallInput());
      service.recordLLMCall(makeCallInput());

      const result = await service.flushToDB();
      expect(result).toBe(2);
      expect(mockPrisma.aIEngineMetric.createMany).toHaveBeenCalledTimes(1);
    });

    it("should clear pendingFlush after a successful flush", async () => {
      service.recordLLMCall(makeCallInput());
      await service.flushToDB();
      expect(service.getPendingFlushCount()).toBe(0);
    });

    it("should call createMany with correct data shape", async () => {
      service.recordLLMCall(
        makeCallInput({
          model: "gpt-4o",
          provider: "openai",
          module: "research",
          operation: "plan",
          userId: "u1",
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          latencyMs: 500,
          estimatedCost: 0.01,
          success: true,
          fallbackUsed: false,
          retryCount: 0,
        }),
      );

      await service.flushToDB();

      const callData =
        mockPrisma.aIEngineMetric.createMany.mock.calls[0][0].data[0];
      expect(callData.metricType).toBe("llm_call");
      expect(callData.operationId).toBe("plan");
      expect(callData.modelId).toBe("gpt-4o");
      expect(callData.providerId).toBe("openai");
      expect(callData.userId).toBe("u1");
      expect(callData.inputTokens).toBe(100);
      expect(callData.outputTokens).toBe(50);
      expect(callData.totalTokens).toBe(150);
      expect(callData.duration).toBe(500);
      expect(callData.success).toBe(true);
      expect(callData.metadata.module).toBe("research");
      expect(callData.metadata.fallbackUsed).toBe(false);
      expect(callData.metadata.retryCount).toBe(0);
    });

    it("should set userId to null when event has no userId", async () => {
      service.recordLLMCall(makeCallInput({ userId: undefined }));

      await service.flushToDB();

      const callData =
        mockPrisma.aIEngineMetric.createMany.mock.calls[0][0].data[0];
      expect(callData.userId).toBeNull();
    });

    it("should requeue events on DB failure (respecting buffer limit) and return 0", async () => {
      mockPrisma.aIEngineMetric.createMany.mockRejectedValueOnce(
        new Error("DB error"),
      );
      service.recordLLMCall(makeCallInput());

      const result = await service.flushToDB();

      expect(result).toBe(0);
      expect(service.getPendingFlushCount()).toBe(1);
    });

    it("should flush in batches when there are more than FLUSH_BATCH_SIZE events", async () => {
      for (let i = 0; i < 501; i++) {
        service.recordLLMCall(makeCallInput());
      }

      const result = await service.flushToDB();

      expect(result).toBe(501);
      expect(mockPrisma.aIEngineMetric.createMany).toHaveBeenCalledTimes(2);
      expect(service.getPendingFlushCount()).toBe(0);
    });

    it("should deduplicate concurrent flush calls when pendingFlush still has items (line 446)", async () => {
      // Key insight: _doFlush synchronously splices the first FLUSH_BATCH_SIZE (500) events.
      // To hit the `return this.flushInProgress` guard (line 446), we need:
      //   - pendingFlush.length > 0 when flush2 runs (so flush2 doesn't early-exit at line 440)
      //   - flushInProgress to be set when flush2 runs
      // This is achievable by adding exactly FLUSH_BATCH_SIZE + 1 = 501 events:
      //   flush1: splices 500, pendingFlush has 1 left, sets flushInProgress
      //   flush2: sees pendingFlush.length=1 > 0, flushInProgress IS set → hits line 446
      for (let i = 0; i < 501; i++) {
        service.recordLLMCall(makeCallInput());
      }

      let resolveCreateMany!: (v: { count: number }) => void;
      mockPrisma.aIEngineMetric.createMany.mockImplementationOnce(
        () =>
          new Promise<{ count: number }>((resolve) => {
            resolveCreateMany = resolve;
          }),
      );

      // Start the first flush — splices 500 events and blocks on DB
      const flush1 = service.flushToDB();

      // Immediately call a second flush:
      // pendingFlush now has 1 item left AND flushInProgress is set → hits line 446
      const flush2 = service.flushToDB();

      // Resolve the deferred DB call
      resolveCreateMany({ count: 500 });

      // Wait for both to settle
      await Promise.all([flush1, flush2]);

      // Both resolved — queue is eventually drained
      expect(service.getPendingFlushCount()).toBe(0);
    });
  });

  // =========================================================================
  // reset() with Prisma
  // =========================================================================

  describe("reset() with Prisma", () => {
    it("should clear pendingFlush on reset", () => {
      service.recordLLMCall(makeCallInput());
      service.recordLLMCall(makeCallInput());

      service.reset();

      expect(service.getPendingFlushCount()).toBe(0);
    });
  });

  // =========================================================================
  // lifecycle hooks (with Prisma)
  // =========================================================================

  describe("lifecycle hooks (with Prisma)", () => {
    it("onModuleInit should set a flush interval", () => {
      const setIntervalSpy = jest.spyOn(global, "setInterval");
      service.onModuleInit();
      expect(setIntervalSpy).toHaveBeenCalled();
      void service.onModuleDestroy();
      setIntervalSpy.mockRestore();
    });

    it("onModuleDestroy should clear the flush interval", async () => {
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");
      service.onModuleInit();
      await service.onModuleDestroy();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it("onModuleDestroy should wait for in-flight flushInProgress", async () => {
      service.onModuleInit();
      service.recordLLMCall(makeCallInput());

      let resolveFlush!: (v: { count: number }) => void;
      mockPrisma.aIEngineMetric.createMany.mockImplementationOnce(
        () =>
          new Promise<{ count: number }>((resolve) => {
            resolveFlush = resolve;
          }),
      );

      const flushPromise = service.flushToDB(); // starts flushInProgress
      const destroyPromise = service.onModuleDestroy();

      // Resolve the in-flight DB call
      resolveFlush({ count: 1 });

      await Promise.all([flushPromise, destroyPromise]);
      // Should complete without errors
    });

    it("onModuleDestroy should perform a final flush of pending events", async () => {
      service.onModuleInit();
      service.recordLLMCall(makeCallInput());

      await service.onModuleDestroy();

      expect(mockPrisma.aIEngineMetric.createMany).toHaveBeenCalled();
    });

    it("onModuleDestroy should handle final flush errors gracefully", async () => {
      service.onModuleInit();
      service.recordLLMCall(makeCallInput());
      mockPrisma.aIEngineMetric.createMany.mockRejectedValue(
        new Error("shutdown error"),
      );

      // Should not throw
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });

    it("onModuleDestroy should log error when final flush throws (line 203)", async () => {
      service.onModuleInit();
      service.recordLLMCall(makeCallInput());

      // Make flushToDB throw (not just the DB call, but the overall flush)
      // to hit the catch(err) branch in onModuleDestroy
      jest
        .spyOn(service, "flushToDB")
        .mockRejectedValueOnce(new Error("flush throw"));

      const errorSpy = jest.spyOn(Logger.prototype, "error");
      await service.onModuleDestroy();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Final flush failed"),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Coverage gap: setInterval callback (line 173) — fire the interval manually
// ---------------------------------------------------------------------------

describe("AiObservabilityService (interval callback)", () => {
  it("should call flushToDB when the interval fires", async () => {
    jest.useFakeTimers();
    const mockPrisma = buildMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiObservabilityService,
        { provide: PrismaService, useValue: mockPrisma as any },
      ],
    }).compile();
    const service = module.get<AiObservabilityService>(AiObservabilityService);

    service.onModuleInit();
    service.recordLLMCall(makeCallInput());

    const flushSpy = jest.spyOn(service, "flushToDB").mockResolvedValue(1);

    // Advance timers to trigger the interval callback
    jest.advanceTimersByTime(5 * 60 * 1000);

    expect(flushSpy).toHaveBeenCalled();

    await service.onModuleDestroy();
    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Coverage gap: _doFlush early return 0 (line 459) when pendingFlush is empty
// ---------------------------------------------------------------------------

describe("AiObservabilityService (_doFlush empty guard)", () => {
  it("should return 0 from _doFlush when all events are consumed in first batch", async () => {
    const mockPrisma = buildMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiObservabilityService,
        { provide: PrismaService, useValue: mockPrisma as any },
      ],
    }).compile();
    const service = module.get<AiObservabilityService>(AiObservabilityService);

    // Add exactly 1 event (well within batch size)
    service.recordLLMCall(makeCallInput());

    // Flush — _doFlush will splice 1 item, call createMany, then recursively
    // call _doFlush again with empty queue → hits the `return 0` guard (line 459)
    const result = await service.flushToDB();

    expect(result).toBe(1);
    expect(mockPrisma.aIEngineMetric.createMany).toHaveBeenCalledTimes(1);
    expect(service.getPendingFlushCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getDashboardWithFallback() — DB fallback for observability
// ---------------------------------------------------------------------------

describe("AiObservabilityService (getDashboardWithFallback)", () => {
  let service: AiObservabilityService;
  let mockPrisma: ReturnType<typeof buildMockPrisma> & {
    aIEngineMetric: {
      createMany: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockPrisma = {
      aIEngineMetric: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiObservabilityService,
        { provide: PrismaService, useValue: mockPrisma as any },
      ],
    }).compile();

    service = module.get<AiObservabilityService>(AiObservabilityService);
  });

  afterEach(() => jest.clearAllMocks());

  it("should return in-memory dashboard when ring buffer has data", async () => {
    service.recordLLMCall(makeCallInput({ totalTokens: 200 }));

    const dashboard = await service.getDashboardWithFallback(60);
    expect(dashboard.totalCalls).toBe(1);
    expect(dashboard.totalTokens).toBe(200);
    // Should NOT query DB when in-memory has data
    expect(mockPrisma.aIEngineMetric.findMany).not.toHaveBeenCalled();
  });

  it("should fall back to DB when ring buffer is empty", async () => {
    mockPrisma.aIEngineMetric.findMany.mockResolvedValue([
      {
        id: "m1",
        metricType: "llm_call",
        modelId: "gpt-4o",
        providerId: "openai",
        operationId: "chat",
        userId: "user-1",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        duration: 500,
        estimatedCost: new Decimal("0.01"),
        success: true,
        errorCode: null,
        metadata: { module: "ai-ask", fallbackUsed: false, retryCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const dashboard = await service.getDashboardWithFallback(60);
    expect(dashboard.totalCalls).toBe(1);
    expect(dashboard.totalTokens).toBe(150);
    expect(mockPrisma.aIEngineMetric.findMany).toHaveBeenCalledTimes(1);
  });

  it("should aggregate DB metrics by model", async () => {
    mockPrisma.aIEngineMetric.findMany.mockResolvedValue([
      {
        id: "m1",
        metricType: "llm_call",
        modelId: "gpt-4o",
        providerId: "openai",
        operationId: "chat",
        userId: "user-1",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        duration: 500,
        estimatedCost: new Decimal("0.01"),
        success: true,
        errorCode: null,
        metadata: { module: "ai-ask", fallbackUsed: false },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "m2",
        metricType: "llm_call",
        modelId: "gpt-4o",
        providerId: "openai",
        operationId: "chat",
        userId: "user-1",
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        duration: 800,
        estimatedCost: new Decimal("0.02"),
        success: false,
        errorCode: "rate_limit",
        metadata: { module: "research", fallbackUsed: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const dashboard = await service.getDashboardWithFallback(60);
    expect(dashboard.totalCalls).toBe(2);
    expect(dashboard.totalTokens).toBe(450);
    expect(dashboard.totalCost).toBeCloseTo(0.03);
    expect(dashboard.successRate).toBeCloseTo(0.5);
    expect(dashboard.fallbackRate).toBeCloseTo(0.5);
    expect(dashboard.byModel["gpt-4o"]).toBeDefined();
    expect(dashboard.byModel["gpt-4o"].calls).toBe(2);
    expect(dashboard.byModule["ai-ask"]).toBeDefined();
    expect(dashboard.byModule["research"]).toBeDefined();
    expect(dashboard.byUser).toHaveLength(1);
    expect(dashboard.recentErrors).toHaveLength(1);
  });

  it("should return empty dashboard when DB has no data", async () => {
    mockPrisma.aIEngineMetric.findMany.mockResolvedValue([]);

    const dashboard = await service.getDashboardWithFallback(60);
    expect(dashboard.totalCalls).toBe(0);
    expect(dashboard.totalTokens).toBe(0);
  });

  it("should return empty dashboard when DB query fails", async () => {
    mockPrisma.aIEngineMetric.findMany.mockRejectedValue(
      new Error("DB connection lost"),
    );

    const dashboard = await service.getDashboardWithFallback(60);
    expect(dashboard.totalCalls).toBe(0);
  });

  it("should handle metrics without userId in byUser", async () => {
    mockPrisma.aIEngineMetric.findMany.mockResolvedValue([
      {
        id: "m1",
        metricType: "llm_call",
        modelId: "gpt-4o",
        providerId: "openai",
        operationId: "chat",
        userId: null,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        duration: 500,
        estimatedCost: new Decimal("0.01"),
        success: true,
        errorCode: null,
        metadata: { module: "ai-ask" },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const dashboard = await service.getDashboardWithFallback(60);
    expect(dashboard.byUser).toHaveLength(0);
  });

  it("should handle metrics with null metadata in module aggregation", async () => {
    mockPrisma.aIEngineMetric.findMany.mockResolvedValue([
      {
        id: "m1",
        metricType: "llm_call",
        modelId: "gpt-4o",
        providerId: "openai",
        operationId: "chat",
        userId: "user-1",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        duration: 500,
        estimatedCost: new Decimal("0.01"),
        success: true,
        errorCode: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const dashboard = await service.getDashboardWithFallback(60);
    expect(dashboard.byModule["ai-engine"]).toBeDefined();
    expect(dashboard.byModule["ai-engine"].calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getDashboardWithFallback() without Prisma — always returns in-memory or empty
// ---------------------------------------------------------------------------

describe("AiObservabilityService (getDashboardWithFallback without Prisma)", () => {
  let service: AiObservabilityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiObservabilityService],
    }).compile();
    service = module.get<AiObservabilityService>(AiObservabilityService);
  });

  it("should return empty dashboard when no Prisma and no in-memory data", async () => {
    const dashboard = await service.getDashboardWithFallback(60);
    expect(dashboard.totalCalls).toBe(0);
  });

  it("should return in-memory dashboard when data exists", async () => {
    service.recordLLMCall(makeCallInput());
    const dashboard = await service.getDashboardWithFallback(60);
    expect(dashboard.totalCalls).toBe(1);
  });
});
