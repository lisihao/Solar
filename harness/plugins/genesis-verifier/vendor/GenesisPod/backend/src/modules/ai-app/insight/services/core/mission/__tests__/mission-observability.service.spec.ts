/**
 * MissionObservabilityService Unit Tests
 *
 * Covers all public methods and all branches (Optional deps present / absent).
 */

import { Test, TestingModule } from "@nestjs/testing";
import { MissionObservabilityService } from "../mission-observability.service";
import {
  ErrorTrackingService,
  AIMetricsService,
} from "@/modules/platform/facade";
import { EventBusService } from "@/modules/ai-harness/facade";
import {
  CostAttributionService,
  TraceCollectorService,
} from "@/modules/ai-harness/facade";

// ─── Mock factories ───────────────────────────────────────────────────────────

function buildAllDeps() {
  const mockErrorTracking = {
    logError: jest.fn(),
  };

  const mockAiMetrics = {
    recordMetric: jest.fn(),
  };

  const mockCostAttribution = {
    recordCost: jest.fn(),
  };

  const mockKernelEventBus = {
    emit: jest.fn(),
  };

  const mockTraceCollector = {
    startTrace: jest.fn(),
    addSpan: jest.fn(),
    endSpan: jest.fn(),
    endTrace: jest.fn(),
  };

  return {
    mockErrorTracking,
    mockAiMetrics,
    mockCostAttribution,
    mockKernelEventBus,
    mockTraceCollector,
  };
}

async function buildService(
  deps: Partial<ReturnType<typeof buildAllDeps>> = {},
): Promise<{
  service: MissionObservabilityService;
  deps: ReturnType<typeof buildAllDeps>;
}> {
  const all = { ...buildAllDeps(), ...deps };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MissionObservabilityService,
      { provide: ErrorTrackingService, useValue: all.mockErrorTracking },
      { provide: AIMetricsService, useValue: all.mockAiMetrics },
      { provide: CostAttributionService, useValue: all.mockCostAttribution },
      { provide: EventBusService, useValue: all.mockKernelEventBus },
      { provide: TraceCollectorService, useValue: all.mockTraceCollector },
    ],
  }).compile();

  return {
    service: module.get<MissionObservabilityService>(
      MissionObservabilityService,
    ),
    deps: all,
  };
}

async function buildServiceNoDeps(): Promise<MissionObservabilityService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [MissionObservabilityService],
  }).compile();
  return module.get<MissionObservabilityService>(MissionObservabilityService);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MissionObservabilityService", () => {
  afterEach(() => jest.clearAllMocks());

  // ─── recordResearchCost ───────────────────────────────────────────────────────

  describe("recordResearchCost", () => {
    it("should record cost via costAttribution when present", async () => {
      const { service, deps } = await buildService();
      service.recordResearchCost(
        "user-1",
        "technology",
        "gpt-4o",
        "openai",
        1000,
        500,
        0.05,
      );
      expect(deps.mockCostAttribution.recordCost).toHaveBeenCalledWith({
        userId: "user-1",
        moduleType: "research:technology",
        model: "gpt-4o",
        provider: "openai",
        inputTokens: 1000,
        outputTokens: 500,
        estimatedCost: 0.05,
      });
    });

    it("should not throw when costAttribution is absent", async () => {
      const service = await buildServiceNoDeps();
      expect(() =>
        service.recordResearchCost("u1", "dim", "m", "p", 1, 1, 0.01),
      ).not.toThrow();
    });

    it("should handle recordCost throwing and log a warning", async () => {
      const { service, deps } = await buildService();
      deps.mockCostAttribution.recordCost.mockImplementation(() => {
        throw new Error("attribution failed");
      });
      // should not rethrow
      expect(() =>
        service.recordResearchCost("u1", "dim", "m", "p", 100, 50, 0.01),
      ).not.toThrow();
    });
  });

  // ─── emitKernelEvent ─────────────────────────────────────────────────────────

  describe("emitKernelEvent", () => {
    it("should emit event with correct shape when kernelEventBus is present", async () => {
      const { service, deps } = await buildService();
      service.emitKernelEvent(
        "mission.started",
        { missionId: "m1" },
        "corr-123",
      );
      expect(deps.mockKernelEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "mission.started",
          payload: { missionId: "m1" },
          metadata: expect.objectContaining({
            source: "topic-insights",
            correlationId: "corr-123",
          }),
        }),
      );
    });

    it("should emit event without correlationId when not provided", async () => {
      const { service, deps } = await buildService();
      service.emitKernelEvent("mission.completed", { missionId: "m2" });
      expect(deps.mockKernelEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "mission.completed",
          metadata: expect.objectContaining({ correlationId: undefined }),
        }),
      );
    });

    it("should not throw when kernelEventBus is absent", async () => {
      const service = await buildServiceNoDeps();
      expect(() =>
        service.emitKernelEvent("some.event", { missionId: "m1" }),
      ).not.toThrow();
    });

    it("should handle kernelEventBus.emit throwing and log warning", async () => {
      const { service, deps } = await buildService();
      deps.mockKernelEventBus.emit.mockImplementation(() => {
        throw new Error("event bus error");
      });
      expect(() =>
        service.emitKernelEvent("fail.event", { missionId: "m1" }),
      ).not.toThrow();
    });
  });

  // ─── logError ────────────────────────────────────────────────────────────────

  describe("logError", () => {
    it("should log error via errorTracking when present", async () => {
      const { service, deps } = await buildService();
      deps.mockErrorTracking.logError.mockResolvedValue(undefined);

      service.logError({
        errorCode: "E001",
        errorType: "LLMError",
        message: "LLM unavailable",
        severity: "error",
        component: "dimension-research",
        metadata: { missionId: "m1" },
      });

      await new Promise((r) => setImmediate(r));
      expect(deps.mockErrorTracking.logError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "E001",
          errorType: "LLMError",
          message: "LLM unavailable",
          severity: "error",
          component: "dimension-research",
          metadata: { missionId: "m1" },
        }),
      );
    });

    it("should not throw when errorTracking is absent", async () => {
      const service = await buildServiceNoDeps();
      expect(() =>
        service.logError({
          errorCode: "E002",
          errorType: "NetworkError",
          message: "timeout",
          severity: "warning",
          component: "crawler",
        }),
      ).not.toThrow();
    });

    it("should handle errorTracking.logError rejection gracefully", async () => {
      const { service, deps } = await buildService();
      deps.mockErrorTracking.logError.mockRejectedValue(
        new Error("tracking failed"),
      );

      expect(() =>
        service.logError({
          errorCode: "E003",
          errorType: "SomeError",
          message: "boom",
          severity: "critical",
          component: "orchestrator",
        }),
      ).not.toThrow();
      await new Promise((r) => setImmediate(r));
    });
  });

  // ─── recordMissionMetrics ────────────────────────────────────────────────────

  describe("recordMissionMetrics", () => {
    it("should record metrics via aiMetrics when present", async () => {
      const { service, deps } = await buildService();
      deps.mockAiMetrics.recordMetric.mockResolvedValue(undefined);

      service.recordMissionMetrics({
        missionId: "m1",
        topicId: "t1",
        success: true,
        completedTasks: 4,
        failedTasks: 0,
        totalTasks: 4,
      });

      await new Promise((r) => setImmediate(r));
      expect(deps.mockAiMetrics.recordMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          metricType: "mission_execution",
          operationId: "m1",
          success: true,
          metadata: expect.objectContaining({
            module: "topic-insights",
            topicId: "t1",
            completedTasks: 4,
            failedTasks: 0,
            totalTasks: 4,
          }),
        }),
      );
    });

    it("should not throw when aiMetrics is absent", async () => {
      const service = await buildServiceNoDeps();
      expect(() =>
        service.recordMissionMetrics({
          missionId: "m1",
          topicId: "t1",
          success: false,
          completedTasks: 2,
          failedTasks: 1,
          totalTasks: 3,
        }),
      ).not.toThrow();
    });

    it("should handle aiMetrics.recordMetric rejection gracefully", async () => {
      const { service, deps } = await buildService();
      deps.mockAiMetrics.recordMetric.mockRejectedValue(
        new Error("metrics failed"),
      );

      expect(() =>
        service.recordMissionMetrics({
          missionId: "m1",
          topicId: "t1",
          success: false,
          completedTasks: 0,
          failedTasks: 3,
          totalTasks: 3,
        }),
      ).not.toThrow();
      await new Promise((r) => setImmediate(r));
    });
  });

  // ─── startMissionTrace ───────────────────────────────────────────────────────

  describe("startMissionTrace", () => {
    it("should return traceId when traceCollector is present", async () => {
      const { service, deps } = await buildService();
      deps.mockTraceCollector.startTrace.mockReturnValue("trace-abc");

      const traceId = service.startMissionTrace("m1", "AI Research");

      expect(traceId).toBe("trace-abc");
      expect(deps.mockTraceCollector.startTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "research-mission:AI Research",
          type: "research_mission",
          metadata: expect.objectContaining({
            missionId: "m1",
            topicName: "AI Research",
            module: "topic-insights",
          }),
        }),
      );
    });

    it("should return null when traceCollector is absent", async () => {
      const service = await buildServiceNoDeps();
      expect(service.startMissionTrace("m1", "Test")).toBeNull();
    });

    it("should return null when startTrace throws", async () => {
      const { service, deps } = await buildService();
      deps.mockTraceCollector.startTrace.mockImplementation(() => {
        throw new Error("trace service down");
      });

      const result = service.startMissionTrace("m1", "Research");
      expect(result).toBeNull();
    });
  });

  // ─── addPhaseSpan ────────────────────────────────────────────────────────────

  describe("addPhaseSpan", () => {
    it("should return null when traceCollector is absent", async () => {
      const service = await buildServiceNoDeps();
      expect(service.addPhaseSpan("trace-1", "planning")).toBeNull();
    });

    it("should return null when traceId is empty", async () => {
      const { service } = await buildService();
      expect(service.addPhaseSpan("", "planning")).toBeNull();
    });

    it("should add span and return spanId for planning phase", async () => {
      const { service, deps } = await buildService();
      deps.mockTraceCollector.addSpan.mockReturnValue("span-1");

      const spanId = service.addPhaseSpan("trace-1", "planning", {
        extra: "info",
      });

      expect(spanId).toBe("span-1");
      expect(deps.mockTraceCollector.addSpan).toHaveBeenCalledWith("trace-1", {
        name: "planning",
        type: "planning",
        metadata: { extra: "info", module: "topic-insights" },
      });
    });

    it("should map 'researching' phase to 'analysis' span type", async () => {
      const { service, deps } = await buildService();
      deps.mockTraceCollector.addSpan.mockReturnValue("span-2");

      service.addPhaseSpan("trace-1", "researching");

      expect(deps.mockTraceCollector.addSpan).toHaveBeenCalledWith(
        "trace-1",
        expect.objectContaining({ type: "analysis" }),
      );
    });

    it("should map 'reviewing' phase to 'review' span type", async () => {
      const { service, deps } = await buildService();
      deps.mockTraceCollector.addSpan.mockReturnValue("span-3");

      service.addPhaseSpan("trace-1", "reviewing");

      expect(deps.mockTraceCollector.addSpan).toHaveBeenCalledWith(
        "trace-1",
        expect.objectContaining({ type: "review" }),
      );
    });

    it("should map 'synthesizing' phase to 'synthesis' span type", async () => {
      const { service, deps } = await buildService();
      deps.mockTraceCollector.addSpan.mockReturnValue("span-4");

      service.addPhaseSpan("trace-1", "synthesizing");

      expect(deps.mockTraceCollector.addSpan).toHaveBeenCalledWith(
        "trace-1",
        expect.objectContaining({ type: "synthesis" }),
      );
    });

    it("should map unknown phase to 'phase' span type", async () => {
      const { service, deps } = await buildService();
      deps.mockTraceCollector.addSpan.mockReturnValue("span-5");

      service.addPhaseSpan("trace-1", "unknown-phase");

      expect(deps.mockTraceCollector.addSpan).toHaveBeenCalledWith(
        "trace-1",
        expect.objectContaining({ type: "phase" }),
      );
    });

    it("should return null when addSpan throws", async () => {
      const { service, deps } = await buildService();
      deps.mockTraceCollector.addSpan.mockImplementation(() => {
        throw new Error("span error");
      });

      const result = service.addPhaseSpan("trace-1", "planning");
      expect(result).toBeNull();
    });
  });

  // ─── endPhaseSpan ────────────────────────────────────────────────────────────

  describe("endPhaseSpan", () => {
    it("should not throw when traceCollector is absent", async () => {
      const service = await buildServiceNoDeps();
      expect(() => service.endPhaseSpan("span-1", true)).not.toThrow();
    });

    it("should not throw when spanId is empty", async () => {
      const { service } = await buildService();
      expect(() => service.endPhaseSpan("", true)).not.toThrow();
    });

    it("should end span with success status", async () => {
      const { service, deps } = await buildService();
      service.endPhaseSpan("span-1", true, { output: "done" });

      expect(deps.mockTraceCollector.endSpan).toHaveBeenCalledWith("span-1", {
        status: "success",
        output: { output: "done" },
      });
    });

    it("should end span with error status", async () => {
      const { service, deps } = await buildService();
      service.endPhaseSpan("span-1", false, { reason: "timeout" });

      expect(deps.mockTraceCollector.endSpan).toHaveBeenCalledWith("span-1", {
        status: "error",
        output: { reason: "timeout" },
      });
    });

    it("should not throw when endSpan throws", async () => {
      const { service, deps } = await buildService();
      deps.mockTraceCollector.endSpan.mockImplementation(() => {
        throw new Error("endSpan failed");
      });

      expect(() => service.endPhaseSpan("span-1", true)).not.toThrow();
    });
  });

  // ─── endMissionTrace ─────────────────────────────────────────────────────────

  describe("endMissionTrace", () => {
    it("should not throw when traceCollector is absent", async () => {
      const service = await buildServiceNoDeps();
      expect(() => service.endMissionTrace("trace-1", true)).not.toThrow();
    });

    it("should not throw when traceId is empty", async () => {
      const { service } = await buildService();
      expect(() => service.endMissionTrace("", true)).not.toThrow();
    });

    it("should end trace with success status", async () => {
      const { service, deps } = await buildService();
      service.endMissionTrace("trace-1", true);

      expect(deps.mockTraceCollector.endTrace).toHaveBeenCalledWith("trace-1", {
        status: "success",
      });
    });

    it("should end trace with error status", async () => {
      const { service, deps } = await buildService();
      service.endMissionTrace("trace-1", false);

      expect(deps.mockTraceCollector.endTrace).toHaveBeenCalledWith("trace-1", {
        status: "error",
      });
    });

    it("should not throw when endTrace throws", async () => {
      const { service, deps } = await buildService();
      deps.mockTraceCollector.endTrace.mockImplementation(() => {
        throw new Error("endTrace failed");
      });

      expect(() => service.endMissionTrace("trace-1", true)).not.toThrow();
    });
  });
});
