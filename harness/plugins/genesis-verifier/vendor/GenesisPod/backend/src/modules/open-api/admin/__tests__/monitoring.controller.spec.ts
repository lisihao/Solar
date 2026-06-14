import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { MonitoringController } from "../monitoring/monitoring.controller";
import { ErrorTrackingService } from "../../../platform/monitoring";
import { AIMetricsService } from "../../../platform/monitoring";
import { AIAdminService } from "../ai/ai-admin.service";
import { DbHealthService } from "../../../platform/monitoring/db-health.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  TraceCollectorService,
  EvalPipelineService,
} from "../../../ai-harness/facade";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
jest.mock("../../../../common/cache/cache.module", () => ({}));
jest.mock("../../../../common/cache/cache.service", () => ({
  CacheService: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------
const mockErrorTrackingService = {
  getErrorStats: jest.fn(),
  getAggregatedErrors: jest.fn(),
  getErrorList: jest.fn(),
  getErrorDetail: jest.fn(),
  resolveError: jest.fn(),
  resolveErrorsByCode: jest.fn(),
};

const mockAIMetricsService = {
  getMetricsSummary: jest.fn(),
  getModelUsageStats: jest.fn(),
  getRealtimeMetrics: jest.fn(),
  getErrorAnalysis: jest.fn(),
};

const mockAIAdminService = {
  diagnoseAllCapabilities: jest.fn(),
  diagnoseTools: jest.fn(),
  diagnoseExternalTools: jest.fn(),
  diagnoseMCPServers: jest.fn(),
};

const mockPrismaService = {
  healthCheck: jest.fn(),
  getPoolStats: jest.fn(),
};

const mockTraceCollectorService = {
  listTraces: jest.fn(),
  getStats: jest.fn(),
  getTrace: jest.fn(),
};

const mockEvalPipelineService = {
  evaluate: jest.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAuthRequest(userId = "admin-user-1") {
  return { user: { id: userId, email: "admin@example.com" } };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("MonitoringController", () => {
  let controller: MonitoringController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MonitoringController],
      providers: [
        { provide: ErrorTrackingService, useValue: mockErrorTrackingService },
        { provide: AIMetricsService, useValue: mockAIMetricsService },
        { provide: AIAdminService, useValue: mockAIAdminService },
        { provide: PrismaService, useValue: mockPrismaService },
        DbHealthService,
        { provide: TraceCollectorService, useValue: mockTraceCollectorService },
        { provide: EvalPipelineService, useValue: mockEvalPipelineService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MonitoringController>(
      MonitoringController,
    );
  });

  // ====================== Error Tracking ======================

  describe("getErrorStats()", () => {
    it("should call errorTrackingService with no filters by default", async () => {
      const stats = { total: 5, critical: 0, unresolved: 2 };
      mockErrorTrackingService.getErrorStats.mockResolvedValue(stats);

      const result = await controller.getErrorStats();

      expect(mockErrorTrackingService.getErrorStats).toHaveBeenCalledWith({
        startDate: undefined,
        endDate: undefined,
        component: undefined,
      });
      expect(result).toEqual(stats);
    });

    it("should parse date strings into Date objects", async () => {
      mockErrorTrackingService.getErrorStats.mockResolvedValue({});

      await controller.getErrorStats(
        "2026-01-01T00:00:00Z",
        "2026-01-31T23:59:59Z",
        "auth",
      );

      const call = mockErrorTrackingService.getErrorStats.mock.calls[0][0];
      expect(call.startDate).toBeInstanceOf(Date);
      expect(call.endDate).toBeInstanceOf(Date);
      expect(call.component).toBe("auth");
    });
  });

  describe("getAggregatedErrors()", () => {
    it("should pass all filter params to errorTrackingService", async () => {
      mockErrorTrackingService.getAggregatedErrors.mockResolvedValue([]);

      await controller.getAggregatedErrors(
        "2026-01-01",
        "2026-01-31",
        "critical",
        "database",
        "false",
        "10",
      );

      const call =
        mockErrorTrackingService.getAggregatedErrors.mock.calls[0][0];
      expect(call.severity).toBe("critical");
      expect(call.component).toBe("database");
      expect(call.resolved).toBe(false);
      expect(call.limit).toBe(10);
    });

    it("should pass resolved=true when query param is 'true'", async () => {
      mockErrorTrackingService.getAggregatedErrors.mockResolvedValue([]);

      await controller.getAggregatedErrors(
        undefined,
        undefined,
        undefined,
        undefined,
        "true",
        undefined,
      );

      const call =
        mockErrorTrackingService.getAggregatedErrors.mock.calls[0][0];
      expect(call.resolved).toBe(true);
    });
  });

  describe("getErrorList()", () => {
    it("should delegate to errorTrackingService.getErrorList", async () => {
      const errorList = { items: [], total: 0 };
      mockErrorTrackingService.getErrorList.mockResolvedValue(errorList);

      const result = await controller.getErrorList();

      expect(mockErrorTrackingService.getErrorList).toHaveBeenCalled();
      expect(result).toEqual(errorList);
    });

    it("should parse offset and limit as integers", async () => {
      mockErrorTrackingService.getErrorList.mockResolvedValue({ items: [] });

      await controller.getErrorList(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "20",
        "40",
      );

      const call = mockErrorTrackingService.getErrorList.mock.calls[0][0];
      expect(call.limit).toBe(20);
      expect(call.offset).toBe(40);
    });
  });

  describe("getErrorDetail()", () => {
    it("should return error detail for a given id", async () => {
      const detail = { id: "err-1", message: "NullPointerException" };
      mockErrorTrackingService.getErrorDetail.mockResolvedValue(detail);

      const result = await controller.getErrorDetail("err-1");

      expect(mockErrorTrackingService.getErrorDetail).toHaveBeenCalledWith(
        "err-1",
      );
      expect(result).toEqual(detail);
    });
  });

  describe("resolveError()", () => {
    it("should resolve error using the authenticated user id", async () => {
      mockErrorTrackingService.resolveError.mockResolvedValue({
        resolved: true,
      });
      const req = makeAuthRequest("user-42");

      const result = await controller.resolveError("err-1", req as any);

      expect(mockErrorTrackingService.resolveError).toHaveBeenCalledWith(
        "err-1",
        "user-42",
      );
      expect(result).toEqual({ resolved: true });
    });

    it("should fall back to 'admin' when request has no user", async () => {
      mockErrorTrackingService.resolveError.mockResolvedValue({
        resolved: true,
      });

      await controller.resolveError("err-1", {} as any);

      expect(mockErrorTrackingService.resolveError).toHaveBeenCalledWith(
        "err-1",
        "admin",
      );
    });
  });

  describe("resolveErrorsByCode()", () => {
    it("should resolve all errors matching the error code", async () => {
      mockErrorTrackingService.resolveErrorsByCode.mockResolvedValue({
        resolvedCount: 5,
      });
      const req = makeAuthRequest("admin-1");

      const result = await controller.resolveErrorsByCode(
        { errorCode: "ERR_DB_TIMEOUT" },
        req as any,
      );

      expect(mockErrorTrackingService.resolveErrorsByCode).toHaveBeenCalledWith(
        "ERR_DB_TIMEOUT",
        "admin-1",
      );
      expect(result).toEqual({ resolvedCount: 5 });
    });
  });

  // ====================== AI Metrics ======================

  describe("getAIMetricsSummary()", () => {
    it("should return metrics summary with no filters", async () => {
      const summary = { totalCalls: 100, successRate: 99 };
      mockAIMetricsService.getMetricsSummary.mockResolvedValue(summary);

      const result = await controller.getAIMetricsSummary();

      expect(mockAIMetricsService.getMetricsSummary).toHaveBeenCalledWith({
        startDate: undefined,
        endDate: undefined,
        userId: undefined,
      });
      expect(result).toEqual(summary);
    });

    it("should pass userId filter to metrics service", async () => {
      mockAIMetricsService.getMetricsSummary.mockResolvedValue({});

      await controller.getAIMetricsSummary(undefined, undefined, "user-123");

      const call = mockAIMetricsService.getMetricsSummary.mock.calls[0][0];
      expect(call.userId).toBe("user-123");
    });
  });

  describe("getModelUsageStats()", () => {
    it("should return model usage statistics", async () => {
      const stats = [{ model: "gpt-4", calls: 50 }];
      mockAIMetricsService.getModelUsageStats.mockResolvedValue(stats);

      const result = await controller.getModelUsageStats();

      expect(mockAIMetricsService.getModelUsageStats).toHaveBeenCalledWith({
        startDate: undefined,
        endDate: undefined,
      });
      expect(result).toEqual(stats);
    });
  });

  describe("getRealtimeMetrics()", () => {
    it("should return realtime AI metrics", async () => {
      const metrics = { activeCalls: 3 };
      mockAIMetricsService.getRealtimeMetrics.mockResolvedValue(metrics);

      const result = await controller.getRealtimeMetrics();

      expect(mockAIMetricsService.getRealtimeMetrics).toHaveBeenCalled();
      expect(result).toEqual(metrics);
    });
  });

  describe("getAIErrorAnalysis()", () => {
    it("should return AI error analysis", async () => {
      const analysis = { topErrors: [] };
      mockAIMetricsService.getErrorAnalysis.mockResolvedValue(analysis);

      const result = await controller.getAIErrorAnalysis();

      expect(mockAIMetricsService.getErrorAnalysis).toHaveBeenCalled();
      expect(result).toEqual(analysis);
    });
  });

  // ====================== Database Monitoring ======================

  describe("getDatabaseHealth()", () => {
    it("should call prismaService.healthCheck", async () => {
      const healthResult = { status: "healthy", latency: 5 };
      mockPrismaService.healthCheck.mockResolvedValue(healthResult);

      const result = await controller.getDatabaseHealth();

      expect(mockPrismaService.healthCheck).toHaveBeenCalled();
      expect(result).toEqual(healthResult);
    });
  });

  describe("getDatabasePoolStats()", () => {
    it("should call prismaService.getPoolStats", async () => {
      const poolStats = { active: 2, idle: 8 };
      mockPrismaService.getPoolStats.mockResolvedValue(poolStats);

      const result = await controller.getDatabasePoolStats();

      expect(mockPrismaService.getPoolStats).toHaveBeenCalled();
      expect(result).toEqual(poolStats);
    });
  });

  // ====================== System Health ======================

  describe("getSystemHealth()", () => {
    it("should return composite health status", async () => {
      mockAIAdminService.diagnoseAllCapabilities.mockResolvedValue({
        breakpoints: [],
        builtinTools: { summary: { total: 10, healthy: 10 } },
        skills: { summary: { total: 5 } },
        mcpServers: { summary: { total: 2 } },
        externalTools: { summary: {} },
      });
      mockErrorTrackingService.getErrorStats.mockResolvedValue({
        total: 0,
        critical: 0,
        error: 0,
        warning: 0,
        unresolved: 0,
      });
      mockAIMetricsService.getMetricsSummary.mockResolvedValue({
        totalCalls: 50,
        successRate: 99.5,
        avgDuration: 300,
        totalTokens: 10000,
      });

      const result = await controller.getSystemHealth();

      expect(result).toMatchObject({
        timestamp: expect.any(String),
        healthScore: expect.any(Number),
        status: expect.stringMatching(/healthy|degraded|unhealthy/),
        components: expect.objectContaining({
          aiEngine: expect.any(Object),
          errorTracking: expect.any(Object),
          aiMetrics: expect.any(Object),
        }),
      });
    });

    it("should show degraded status when there are critical errors", async () => {
      mockAIAdminService.diagnoseAllCapabilities.mockResolvedValue({
        breakpoints: [{ issue: "tool-1" }, { issue: "tool-2" }],
        builtinTools: { summary: {} },
        skills: { summary: {} },
        mcpServers: { summary: {} },
      });
      mockErrorTrackingService.getErrorStats.mockResolvedValue({
        total: 10,
        critical: 5,
        error: 3,
        warning: 2,
        unresolved: 5,
      });
      mockAIMetricsService.getMetricsSummary.mockResolvedValue({
        totalCalls: 100,
        successRate: 80,
        avgDuration: 500,
        totalTokens: 5000,
      });

      const result = await controller.getSystemHealth();

      expect(result.healthScore).toBeLessThan(100);
    });
  });

  // ====================== Trace Visualization ======================

  describe("listTraces()", () => {
    it("should return trace list with no filters", async () => {
      const traces = [{ id: "trace-1" }, { id: "trace-2" }];
      mockTraceCollectorService.listTraces.mockResolvedValue(traces);

      const result = await controller.listTraces();

      expect(mockTraceCollectorService.listTraces).toHaveBeenCalledWith({
        type: undefined,
        limit: undefined,
      });
      expect(result).toEqual(traces);
    });

    it("should parse limit from query param", async () => {
      mockTraceCollectorService.listTraces.mockResolvedValue([]);

      await controller.listTraces(undefined, "50");

      expect(mockTraceCollectorService.listTraces).toHaveBeenCalledWith({
        type: undefined,
        limit: 50,
      });
    });

    it("should pass trace type filter", async () => {
      mockTraceCollectorService.listTraces.mockResolvedValue([]);

      await controller.listTraces("RESEARCH", undefined);

      expect(mockTraceCollectorService.listTraces).toHaveBeenCalledWith({
        type: "RESEARCH",
        limit: undefined,
      });
    });
  });

  describe("getTraceStats()", () => {
    it("should return trace statistics", async () => {
      const stats = { total: 100, byType: {} };
      mockTraceCollectorService.getStats.mockReturnValue(stats);

      const result = await controller.getTraceStats();

      expect(mockTraceCollectorService.getStats).toHaveBeenCalled();
      expect(result).toEqual(stats);
    });
  });

  describe("getTraceDetail()", () => {
    it("should return trace when found", async () => {
      const trace = { id: "trace-1", spans: [] };
      mockTraceCollectorService.getTrace.mockReturnValue(trace);

      const result = await controller.getTraceDetail("trace-1");

      expect(mockTraceCollectorService.getTrace).toHaveBeenCalledWith(
        "trace-1",
      );
      expect(result).toEqual(trace);
    });

    it("should throw NotFoundException when trace not found", async () => {
      mockTraceCollectorService.getTrace.mockReturnValue(null);

      await expect(controller.getTraceDetail("missing-trace")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("evaluateTrace()", () => {
    it("should run evaluation and return result", async () => {
      const evalResult = { score: 0.92, feedback: "Good" };
      mockEvalPipelineService.evaluate.mockResolvedValue(evalResult);

      const result = await controller.evaluateTrace("trace-1");

      expect(mockEvalPipelineService.evaluate).toHaveBeenCalledWith("trace-1");
      expect(result).toEqual(evalResult);
    });
  });

  // ====================== APM Summary ======================

  describe("getAPMSummary()", () => {
    it("should return APM summary with zero values when no metricsService", async () => {
      // metricsService is @Optional, not provided in this test setup
      const result = await controller.getAPMSummary();

      expect(result).toMatchObject({
        timestamp: expect.any(String),
        http: expect.objectContaining({
          totalRequests: 0,
          totalErrors: 0,
        }),
        ai: expect.objectContaining({
          totalCalls: 0,
        }),
      });
    });
  });

  // ====================== Security Check ======================

  describe("runSecurityCheck()", () => {
    it("should return security check results with summary", async () => {
      const result = await controller.runSecurityCheck();

      expect(result).toMatchObject({
        timestamp: expect.any(String),
        summary: expect.objectContaining({
          total: expect.any(Number),
          pass: expect.any(Number),
          warn: expect.any(Number),
          fail: expect.any(Number),
          score: expect.any(Number),
        }),
        checks: expect.any(Array),
      });
    });
  });

  // ====================== Rate Limit Stats ======================

  describe("getRateLimitStats()", () => {
    it("should return null guards when rate limit services not provided", async () => {
      const result = await controller.getRateLimitStats();

      expect(result).toMatchObject({
        memoryGuard: null,
        distributedGuard: null,
      });
    });
  });

  // ====================== Dashboard ======================

  describe("getDashboard()", () => {
    it("should return dashboard data aggregating all metrics", async () => {
      mockErrorTrackingService.getErrorStats.mockResolvedValue({
        total: 2,
        critical: 0,
        unresolved: 1,
      });
      mockErrorTrackingService.getAggregatedErrors.mockResolvedValue([]);
      mockAIMetricsService.getMetricsSummary.mockResolvedValue({
        totalCalls: 50,
        successRate: 100,
        avgDuration: 200,
        totalTokens: 5000,
      });
      mockAIMetricsService.getRealtimeMetrics.mockResolvedValue({ active: 0 });
      mockAIMetricsService.getModelUsageStats.mockResolvedValue([]);
      mockAIAdminService.diagnoseAllCapabilities.mockResolvedValue({
        breakpoints: [],
        builtinTools: { summary: {} },
        skills: { summary: {} },
        mcpServers: { summary: {} },
        externalTools: { summary: {} },
      });

      const result = await controller.getDashboard();

      expect(result).toMatchObject({
        timestamp: expect.any(String),
        warnings: expect.any(Array),
      });
    });

    it("should include warnings in result when services fail", async () => {
      mockErrorTrackingService.getErrorStats.mockRejectedValue(
        new Error("Service unavailable"),
      );
      mockErrorTrackingService.getAggregatedErrors.mockRejectedValue(
        new Error("Service unavailable"),
      );
      mockAIMetricsService.getMetricsSummary.mockRejectedValue(
        new Error("Metrics unavailable"),
      );
      mockAIMetricsService.getRealtimeMetrics.mockRejectedValue(
        new Error("Metrics unavailable"),
      );
      mockAIMetricsService.getModelUsageStats.mockRejectedValue(
        new Error("Metrics unavailable"),
      );
      mockAIAdminService.diagnoseAllCapabilities.mockRejectedValue(
        new Error("Diagnosis unavailable"),
      );

      const result = await controller.getDashboard();

      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});
