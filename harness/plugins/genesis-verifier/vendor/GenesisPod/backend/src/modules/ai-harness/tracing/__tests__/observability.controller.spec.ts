/**
 * ObservabilityController Unit Tests
 *
 * Covers all three admin endpoints:
 * - GET /api/v1/admin/traces          (listTraces)
 * - GET /api/v1/admin/traces/stats    (getStats)
 * - GET /api/v1/admin/traces/:id      (getTrace)
 *
 * Guards (JwtAuthGuard, AdminGuard) are overridden to pass through so that
 * the controller logic itself is the focus of every test.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { ObservabilityController } from "@/modules/open-api/admin/observability/observability.controller";
import { TraceCollectorService } from "../observability/trace-collector.service";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { AdminGuard } from "@/common/guards/admin.guard";

// Suppress Logger noise during tests
jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRACE_ID = "trace-abc-001";

const mockTraceSummary = {
  id: TRACE_ID,
  name: "Research Trace",
  type: "research",
  status: "success",
  startTime: new Date("2025-01-01T10:00:00Z"),
  duration: 1200,
  spanCount: 3,
};

const mockTraceData = {
  id: TRACE_ID,
  name: "Research Trace",
  type: "research",
  status: "success",
  startTime: new Date("2025-01-01T10:00:00Z"),
  endTime: new Date("2025-01-01T10:00:01.200Z"),
  duration: 1200,
  metadata: {},
  spans: [],
};

const mockStats = {
  totalTraces: 5,
  runningTraces: 1,
  totalSpans: 12,
  byType: { research: 3, chat: 2 },
  byStatus: { running: 1, success: 3, error: 1 },
};

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------

const mockTraceCollector = {
  listTraces: jest.fn().mockResolvedValue([mockTraceSummary]),
  getStats: jest.fn().mockReturnValue(mockStats),
  getTrace: jest.fn().mockReturnValue(mockTraceData),
};

// Guard factory that always allows requests (used to bypass auth in unit tests)
const allowAllGuard = { canActivate: () => true };

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ObservabilityController", () => {
  let controller: ObservabilityController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ObservabilityController],
      providers: [
        {
          provide: TraceCollectorService,
          useValue: mockTraceCollector,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowAllGuard)
      .overrideGuard(AdminGuard)
      .useValue(allowAllGuard)
      .compile();

    controller = module.get<ObservabilityController>(ObservabilityController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── listTraces() ──────────────────────────────────────────────────────────

  describe("listTraces()", () => {
    it("should return wrapped trace list with default limit when no query params", async () => {
      const result = await controller.listTraces();

      expect(mockTraceCollector.listTraces).toHaveBeenCalledTimes(1);
      expect(mockTraceCollector.listTraces).toHaveBeenCalledWith({
        type: undefined,
        limit: 50,
      });
      expect(result).toEqual({ data: [mockTraceSummary] });
    });

    it("should parse limit string and forward as number", async () => {
      await controller.listTraces(undefined, "20");

      expect(mockTraceCollector.listTraces).toHaveBeenCalledWith({
        type: undefined,
        limit: 20,
      });
    });

    it("should forward type filter to listTraces", async () => {
      await controller.listTraces("research", "10");

      expect(mockTraceCollector.listTraces).toHaveBeenCalledWith({
        type: "research",
        limit: 10,
      });
    });

    it("should use default limit of 50 when limit string is NaN", async () => {
      await controller.listTraces(undefined, "not-a-number");

      expect(mockTraceCollector.listTraces).toHaveBeenCalledWith({
        type: undefined,
        limit: 50,
      });
    });

    it("should use default limit of 50 when limit is undefined", async () => {
      await controller.listTraces("chat", undefined);

      expect(mockTraceCollector.listTraces).toHaveBeenCalledWith({
        type: "chat",
        limit: 50,
      });
    });

    it("should return empty data array when service returns empty list", async () => {
      mockTraceCollector.listTraces.mockResolvedValueOnce([]);

      const result = await controller.listTraces();

      expect(result).toEqual({ data: [] });
    });

    it("should wrap multiple trace summaries in data field", async () => {
      const secondTrace = { ...mockTraceSummary, id: "trace-002" };
      mockTraceCollector.listTraces.mockResolvedValueOnce([
        mockTraceSummary,
        secondTrace,
      ]);

      const result = await controller.listTraces();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe(TRACE_ID);
      expect(result.data[1].id).toBe("trace-002");
    });
  });

  // ─── getStats() ────────────────────────────────────────────────────────────

  describe("getStats()", () => {
    it("should return wrapped stats object", () => {
      const result = controller.getStats();

      expect(mockTraceCollector.getStats).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: mockStats });
    });

    it("should reflect totalTraces count from service", () => {
      const result = controller.getStats();

      expect(result.data.totalTraces).toBe(5);
    });

    it("should reflect runningTraces count from service", () => {
      const result = controller.getStats();

      expect(result.data.runningTraces).toBe(1);
    });

    it("should return zero counts when service returns empty stats", () => {
      const emptyStats = {
        totalTraces: 0,
        runningTraces: 0,
        totalSpans: 0,
        byType: {},
        byStatus: { running: 0, success: 0, error: 0 },
      };
      mockTraceCollector.getStats.mockReturnValueOnce(emptyStats);

      const result = controller.getStats();

      expect(result.data.totalTraces).toBe(0);
      expect(result.data.totalSpans).toBe(0);
    });
  });

  // ─── getTrace() ────────────────────────────────────────────────────────────

  describe("getTrace()", () => {
    it("should return wrapped trace data when trace exists", () => {
      const result = controller.getTrace(TRACE_ID);

      expect(mockTraceCollector.getTrace).toHaveBeenCalledTimes(1);
      expect(mockTraceCollector.getTrace).toHaveBeenCalledWith(TRACE_ID);
      expect(result).toEqual({ data: mockTraceData });
    });

    it("should include trace id and name in wrapped data", () => {
      const result = controller.getTrace(TRACE_ID);

      expect(result.data.id).toBe(TRACE_ID);
      expect(result.data.name).toBe("Research Trace");
    });

    it("should throw NotFoundException when trace does not exist", () => {
      mockTraceCollector.getTrace.mockReturnValue(null);

      expect(() => controller.getTrace("non-existent-id")).toThrow(
        NotFoundException,
      );
      expect(() => controller.getTrace("non-existent-id")).toThrow(
        "Trace not found",
      );

      mockTraceCollector.getTrace.mockReturnValue(mockTraceData);
    });

    it("should throw NotFoundException with correct message for unknown trace id", () => {
      mockTraceCollector.getTrace.mockReturnValueOnce(null);

      let thrown: unknown;
      try {
        controller.getTrace("unknown-trace");
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(NotFoundException);
    });

    it("should forward the exact id string to the service", () => {
      const customId = "custom-trace-xyz-999";
      mockTraceCollector.getTrace.mockReturnValueOnce({
        ...mockTraceData,
        id: customId,
      });

      const result = controller.getTrace(customId);

      expect(mockTraceCollector.getTrace).toHaveBeenCalledWith(customId);
      expect(result.data.id).toBe(customId);
    });

    it("should return trace with spans when available", () => {
      const traceWithSpans = {
        ...mockTraceData,
        spans: [
          {
            id: "span-001",
            traceId: TRACE_ID,
            name: "LLM Call",
            type: "llm",
            status: "success",
            startTime: new Date("2025-01-01T10:00:00Z"),
          },
        ],
      };
      mockTraceCollector.getTrace.mockReturnValueOnce(traceWithSpans);

      const result = controller.getTrace(TRACE_ID);

      expect(result.data.spans).toHaveLength(1);
      expect(result.data.spans[0].name).toBe("LLM Call");
    });
  });
});
