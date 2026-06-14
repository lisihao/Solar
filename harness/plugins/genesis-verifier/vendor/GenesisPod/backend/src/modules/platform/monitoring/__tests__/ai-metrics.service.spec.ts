import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AIMetricsService } from "../metrics/ai-metrics.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";

describe("AIMetricsService", () => {
  let service: AIMetricsService;
  let mockPrisma: jest.Mocked<Partial<PrismaService>>;

  beforeEach(async () => {
    mockPrisma = {
      aIEngineMetric: {
        create: jest.fn().mockResolvedValue({ id: "metric-1" }),
        aggregate: jest.fn().mockResolvedValue({
          _count: { id: 0 },
          _sum: { duration: 0, totalTokens: 0, estimatedCost: null },
          _avg: { duration: null },
        }),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      } as unknown as PrismaService["aIEngineMetric"],
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIMetricsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AIMetricsService>(AIMetricsService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== recordMetric ====================

  describe("recordMetric", () => {
    it("records a successful LLM call metric", async () => {
      const id = await service.recordMetric({
        metricType: "llm_call",
        modelId: "gpt-4o",
        success: true,
        inputTokens: 100,
        outputTokens: 200,
        duration: 1500,
      });

      expect(id).toBe("metric-1");
      expect(mockPrisma.aIEngineMetric!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metricType: "llm_call",
            success: true,
            totalTokens: 300,
            metadata: expect.objectContaining({ module: "ai-engine" }),
          }),
        }),
      );
    });

    // ★ 2026-05-06 pricing 平台化：ai-metrics 不再内部算 cost；改由调用方
    //   （ai-engine.AiChatService / harness LlmExecutor）通过 ModelPricingRegistry
    //   算好后传 estimatedCost 进来。recordMetric 只负责写 DB。
    it("persists caller-provided estimatedCost into DB", async () => {
      await service.recordMetric({
        metricType: "llm_call",
        modelId: "gpt-4o",
        success: true,
        inputTokens: 1000,
        outputTokens: 1000,
        estimatedCost: 0.02,
      });

      const createCall = (mockPrisma.aIEngineMetric!.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.data.estimatedCost).toBeCloseTo(0.02, 4);
    });

    it("defaults estimatedCost to 0 when caller does not provide it (no internal pricing)", async () => {
      await service.recordMetric({
        metricType: "llm_call",
        modelId: "any-model",
        success: true,
        inputTokens: 1000,
        outputTokens: 1000,
        // estimatedCost intentionally omitted
      });

      const createCall = (mockPrisma.aIEngineMetric!.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.data.estimatedCost).toBe(0);
    });

    it("returns zero cost when no model or tokens provided", async () => {
      await service.recordMetric({
        metricType: "agent_execution",
        success: true,
      });

      const createCall = (mockPrisma.aIEngineMetric!.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.data.estimatedCost).toBe(0);
    });

    it("logs warning for failed metric", async () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();

      await service.recordMetric({
        metricType: "llm_call",
        success: false,
        errorCode: "TIMEOUT",
        errorMsg: "Request timed out",
      });

      expect(warnSpy).toHaveBeenCalled();
    });

    it("records totalTokens as sum of input + output", async () => {
      await service.recordMetric({
        metricType: "llm_call",
        success: true,
        inputTokens: 300,
        outputTokens: 700,
      });

      const createCall = (mockPrisma.aIEngineMetric!.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.data.totalTokens).toBe(1000);
    });
  });

  // ==================== getMetricsSummary ====================

  describe("getMetricsSummary", () => {
    it("returns zero summary when no data", async () => {
      (mockPrisma.aIEngineMetric!.aggregate as jest.Mock).mockResolvedValue({
        _count: { id: 0 },
        _sum: { duration: 0, totalTokens: 0, estimatedCost: null },
        _avg: { duration: null },
      });
      (mockPrisma.aIEngineMetric!.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.aIEngineMetric!.groupBy as jest.Mock).mockResolvedValue([]);

      const summary = await service.getMetricsSummary();

      expect(summary.totalCalls).toBe(0);
      expect(summary.successRate).toBe(0);
      expect(summary.avgDuration).toBe(0);
      expect(summary.totalTokens).toBe(0);
      expect(summary.estimatedCost).toBe(0);
    });

    it("computes success rate correctly", async () => {
      (mockPrisma.aIEngineMetric!.aggregate as jest.Mock).mockResolvedValue({
        _count: { id: 10 },
        _sum: { duration: 5000, totalTokens: 1000, estimatedCost: null },
        _avg: { duration: 500 },
      });
      // successfulCount = 8
      (mockPrisma.aIEngineMetric!.count as jest.Mock).mockResolvedValue(8);
      (mockPrisma.aIEngineMetric!.groupBy as jest.Mock).mockResolvedValue([]);

      const summary = await service.getMetricsSummary();

      expect(summary.totalCalls).toBe(10);
      expect(summary.successRate).toBe(80);
    });

    it("applies date range filter", async () => {
      const startDate = new Date("2025-01-01");
      const endDate = new Date("2025-01-31");
      (mockPrisma.aIEngineMetric!.aggregate as jest.Mock).mockResolvedValue({
        _count: { id: 0 },
        _sum: { totalTokens: 0, estimatedCost: null },
        _avg: { duration: null },
      });
      (mockPrisma.aIEngineMetric!.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.aIEngineMetric!.groupBy as jest.Mock).mockResolvedValue([]);

      await service.getMetricsSummary({ startDate, endDate });

      expect(mockPrisma.aIEngineMetric!.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: startDate,
              lte: endDate,
            }),
          }),
        }),
      );
    });

    it("applies userId filter", async () => {
      (mockPrisma.aIEngineMetric!.aggregate as jest.Mock).mockResolvedValue({
        _count: { id: 0 },
        _sum: { totalTokens: 0, estimatedCost: null },
        _avg: { duration: null },
      });
      (mockPrisma.aIEngineMetric!.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.aIEngineMetric!.groupBy as jest.Mock).mockResolvedValue([]);

      await service.getMetricsSummary({ userId: "user-123" });

      expect(mockPrisma.aIEngineMetric!.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-123" }),
        }),
      );
    });

    it("returns byModel and byType breakdowns", async () => {
      // aggregate: 1 main call + 7 trend-day calls = 8 total
      (mockPrisma.aIEngineMetric!.aggregate as jest.Mock).mockResolvedValue({
        _count: { id: 5 },
        _sum: { totalTokens: 500, estimatedCost: null },
        _avg: { duration: 300 },
      });
      // count: successfulCount (after aggregate) + 1 per byType stat = at least 1
      (mockPrisma.aIEngineMetric!.count as jest.Mock).mockResolvedValue(5);
      // groupBy: byModel (1st) + byType (2nd) — getByTypeStats also calls count per type
      (mockPrisma.aIEngineMetric!.groupBy as jest.Mock)
        .mockResolvedValueOnce([
          {
            modelId: "gpt-4o",
            _count: { id: 5 },
            _sum: { totalTokens: 500, estimatedCost: null },
          },
        ]) // byModel
        .mockResolvedValueOnce([
          {
            metricType: "llm_call",
            _count: { id: 5 },
            _avg: { duration: 300 },
          },
        ]); // byType

      const summary = await service.getMetricsSummary();

      expect(summary.byModel).toBeDefined();
      expect(summary.byType).toBeDefined();
      expect(summary.trend).toHaveLength(7); // 7 days
    });
  });

  // ==================== getModelUsageStats ====================

  describe("getModelUsageStats", () => {
    it("returns sorted model stats by total calls", async () => {
      (mockPrisma.aIEngineMetric!.groupBy as jest.Mock).mockResolvedValue([
        {
          modelId: "gpt-4o",
          providerId: "openai",
          _count: { id: 10 },
          _sum: { totalTokens: 5000, duration: 10000, estimatedCost: null },
          _avg: { totalTokens: 500, duration: 1000 },
        },
        {
          modelId: "claude-3-5-sonnet-20241022",
          providerId: "anthropic",
          _count: { id: 3 },
          _sum: { totalTokens: 1000, duration: 3000, estimatedCost: null },
          _avg: { totalTokens: 333, duration: 1000 },
        },
      ]);
      (mockPrisma.aIEngineMetric!.count as jest.Mock).mockResolvedValue(8);

      const result = await service.getModelUsageStats();

      expect(result).toHaveLength(2);
      expect(result[0].modelId).toBe("gpt-4o");
      expect(result[0].totalCalls).toBe(10);
      expect(result[0].successfulCalls).toBe(8);
      expect(result[0].failedCalls).toBe(2);
    });

    it("skips entries with null modelId", async () => {
      (mockPrisma.aIEngineMetric!.groupBy as jest.Mock).mockResolvedValue([
        {
          modelId: null,
          providerId: null,
          _count: { id: 5 },
          _sum: { totalTokens: 0, estimatedCost: null },
          _avg: { totalTokens: 0, duration: null },
        },
      ]);

      const result = await service.getModelUsageStats();
      expect(result).toHaveLength(0);
    });
  });

  // ==================== getRealtimeMetrics ====================

  describe("getRealtimeMetrics", () => {
    it("returns realtime metrics for last hour", async () => {
      // Promise.all order: totalCalls (count), successfulCalls (count),
      // avgDuration (aggregate), totalTokens (aggregate), errorCounts (groupBy)
      // Then getCallsPerMinute loops calling count() for each 5-min bucket
      (mockPrisma.aIEngineMetric!.count as jest.Mock)
        .mockResolvedValueOnce(20) // totalCalls
        .mockResolvedValueOnce(18) // successfulCalls
        .mockResolvedValue(0); // per-minute bucket counts
      (mockPrisma.aIEngineMetric!.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _avg: { duration: 500 } }) // avgDuration
        .mockResolvedValueOnce({ _sum: { totalTokens: 2000 } }); // totalTokens
      (mockPrisma.aIEngineMetric!.groupBy as jest.Mock).mockResolvedValue([]); // errorCounts

      const result = await service.getRealtimeMetrics();

      expect(result.lastHour.totalCalls).toBe(20);
      expect(result.lastHour.successfulCalls).toBe(18);
      expect(result.lastHour.failedCalls).toBe(2);
      expect(result.lastHour.successRate).toBe(90);
    });
  });

  // ==================== getErrorAnalysis ====================

  describe("getErrorAnalysis", () => {
    it("returns error breakdown by code, model, and type", async () => {
      (mockPrisma.aIEngineMetric!.groupBy as jest.Mock)
        .mockResolvedValueOnce([{ errorCode: "TIMEOUT", _count: { id: 5 } }])
        .mockResolvedValueOnce([{ modelId: "gpt-4o", _count: { id: 3 } }])
        .mockResolvedValueOnce([{ metricType: "llm_call", _count: { id: 5 } }]);
      (mockPrisma.aIEngineMetric!.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getErrorAnalysis();

      expect(result.byErrorCode).toHaveLength(1);
      expect(result.byErrorCode[0].errorCode).toBe("TIMEOUT");
      expect(result.byModel).toHaveLength(1);
      expect(result.byType).toHaveLength(1);
      expect(result.recentErrors).toEqual([]);
    });
  });
});
