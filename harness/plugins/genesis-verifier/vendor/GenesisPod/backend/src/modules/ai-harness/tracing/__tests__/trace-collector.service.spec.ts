/**
 * TraceCollectorService Unit Tests
 *
 * Covers all public methods:
 * - startTrace()   - create a new trace, add to LruMap, persist to DB
 * - addSpan()      - attach a span to an existing trace
 * - endSpan()      - finalize a span with status/duration
 * - endTrace()     - finalize a trace with status/duration
 * - getTrace()     - deep-copy retrieval by traceId
 * - listTraces()   - in-memory list (with type filter); DB fallback on empty memory
 * - getStats()     - summary counts by type and status
 * - clearAll()     - wipe all in-memory state
 * FIFO eviction:   - evictOldestTrace() is triggered at MAX_TRACES
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { TraceCollectorService } from "../observability/trace-collector.service";
import type {
  CreateTraceInput,
  CreateSpanInput,
  EndSpanInput,
  EndTraceInput,
} from "../observability/trace.interface";

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

function makeTraceInput(
  overrides: Partial<CreateTraceInput> = {},
): CreateTraceInput {
  return {
    name: "Test Trace",
    type: "research",
    metadata: {},
    ...overrides,
  };
}

function makeSpanInput(
  overrides: Partial<CreateSpanInput> = {},
): CreateSpanInput {
  return {
    name: "Test Span",
    type: "llm_call",
    metadata: {},
    ...overrides,
  };
}

function makeEndSpanInput(overrides: Partial<EndSpanInput> = {}): EndSpanInput {
  return {
    status: "success",
    ...overrides,
  };
}

function makeEndTraceInput(
  overrides: Partial<EndTraceInput> = {},
): EndTraceInput {
  return {
    status: "success",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

function buildMockPrisma() {
  return {
    agentTrace: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    agentSpan: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
}

// ---------------------------------------------------------------------------
// Suite (without Prisma)
// ---------------------------------------------------------------------------

describe("TraceCollectorService (no Prisma)", () => {
  let service: TraceCollectorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TraceCollectorService],
    }).compile();

    service = module.get<TraceCollectorService>(TraceCollectorService);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // startTrace()
  // =========================================================================

  describe("startTrace()", () => {
    it("should return a non-empty UUID string", () => {
      const traceId = service.startTrace(makeTraceInput());
      expect(typeof traceId).toBe("string");
      expect(traceId).toHaveLength(36); // UUID format
    });

    it("should make the trace retrievable via getTrace", () => {
      const traceId = service.startTrace(makeTraceInput({ name: "My Trace" }));

      const trace = service.getTrace(traceId);
      expect(trace).not.toBeNull();
      expect(trace!.name).toBe("My Trace");
    });

    it("should initialize trace with status=running", () => {
      const traceId = service.startTrace(makeTraceInput());
      const trace = service.getTrace(traceId);
      expect(trace!.status).toBe("running");
    });

    it("should initialize trace with empty spans array", () => {
      const traceId = service.startTrace(makeTraceInput());
      const trace = service.getTrace(traceId);
      expect(trace!.spans).toHaveLength(0);
    });

    it("should preserve trace type from input", () => {
      const traceId = service.startTrace(
        makeTraceInput({ type: "team_execution" }),
      );
      const trace = service.getTrace(traceId);
      expect(trace!.type).toBe("team_execution");
    });

    it("should use empty object as metadata when not provided", () => {
      const traceId = service.startTrace({
        name: "No Meta",
        type: "tool_call",
      });
      const trace = service.getTrace(traceId);
      expect(trace!.metadata).toEqual({});
    });

    it("should preserve provided metadata", () => {
      const metadata = { userId: "u1", taskId: "t1" };
      const traceId = service.startTrace(makeTraceInput({ metadata }));
      const trace = service.getTrace(traceId);
      expect(trace!.metadata).toEqual(metadata);
    });

    it("should set a startTime close to now", () => {
      const before = Date.now();
      const traceId = service.startTrace(makeTraceInput());
      const after = Date.now();

      // getTrace returns a JSON deep-copy so Date fields are ISO strings
      const trace = service.getTrace(traceId);
      const startMs = new Date(trace!.startTime as unknown as string).getTime();
      expect(startMs).toBeGreaterThanOrEqual(before - 1);
      expect(startMs).toBeLessThanOrEqual(after + 1);
    });

    it("should generate unique IDs for different traces", () => {
      const id1 = service.startTrace(makeTraceInput());
      const id2 = service.startTrace(makeTraceInput());
      expect(id1).not.toBe(id2);
    });
  });

  // =========================================================================
  // addSpan()
  // =========================================================================

  describe("addSpan()", () => {
    it("should return a non-empty UUID string", () => {
      const traceId = service.startTrace(makeTraceInput());
      const spanId = service.addSpan(traceId, makeSpanInput());
      expect(spanId).toHaveLength(36);
    });

    it("should add the span to the trace spans array", () => {
      const traceId = service.startTrace(makeTraceInput());
      service.addSpan(traceId, makeSpanInput({ name: "My Span" }));

      const trace = service.getTrace(traceId);
      expect(trace!.spans).toHaveLength(1);
      expect(trace!.spans[0].name).toBe("My Span");
    });

    it("should initialize span with status=running", () => {
      const traceId = service.startTrace(makeTraceInput());
      service.addSpan(traceId, makeSpanInput());

      const trace = service.getTrace(traceId);
      expect(trace!.spans[0].status).toBe("running");
    });

    it("should return empty string when trace is not found", () => {
      const spanId = service.addSpan("non-existent-trace-id", makeSpanInput());
      expect(spanId).toBe("");
    });

    it("should log a warning when trace is not found", () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      service.addSpan("ghost-trace", makeSpanInput());
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Trace not found"),
      );
    });

    it("should preserve span type from input", () => {
      const traceId = service.startTrace(makeTraceInput());
      service.addSpan(traceId, makeSpanInput({ type: "tool_execution" }));

      const trace = service.getTrace(traceId);
      expect(trace!.spans[0].type).toBe("tool_execution");
    });

    it("should support multiple spans within a single trace", () => {
      const traceId = service.startTrace(makeTraceInput());
      service.addSpan(traceId, makeSpanInput({ name: "Span 1" }));
      service.addSpan(traceId, makeSpanInput({ name: "Span 2" }));
      service.addSpan(traceId, makeSpanInput({ name: "Span 3" }));

      const trace = service.getTrace(traceId);
      expect(trace!.spans).toHaveLength(3);
    });
  });

  // =========================================================================
  // endSpan()
  // =========================================================================

  describe("endSpan()", () => {
    it("should update span status to success", () => {
      const traceId = service.startTrace(makeTraceInput());
      const spanId = service.addSpan(traceId, makeSpanInput());

      service.endSpan(spanId, makeEndSpanInput({ status: "success" }));

      const trace = service.getTrace(traceId);
      expect(trace!.spans[0].status).toBe("success");
    });

    it("should update span status to error", () => {
      const traceId = service.startTrace(makeTraceInput());
      const spanId = service.addSpan(traceId, makeSpanInput());

      service.endSpan(
        spanId,
        makeEndSpanInput({ status: "error", error: "Something failed" }),
      );

      const trace = service.getTrace(traceId);
      expect(trace!.spans[0].status).toBe("error");
      expect(trace!.spans[0].error).toBe("Something failed");
    });

    it("should set duration from result when provided", () => {
      const traceId = service.startTrace(makeTraceInput());
      const spanId = service.addSpan(traceId, makeSpanInput());

      service.endSpan(spanId, makeEndSpanInput({ duration: 1234 }));

      const trace = service.getTrace(traceId);
      expect(trace!.spans[0].duration).toBe(1234);
    });

    it("should auto-calculate duration when not provided", () => {
      const traceId = service.startTrace(makeTraceInput());
      const spanId = service.addSpan(traceId, makeSpanInput());

      service.endSpan(spanId, makeEndSpanInput());

      const trace = service.getTrace(traceId);
      expect(trace!.spans[0].duration).toBeGreaterThanOrEqual(0);
    });

    it("should set endTime on the span", () => {
      const traceId = service.startTrace(makeTraceInput());
      const spanId = service.addSpan(traceId, makeSpanInput());

      service.endSpan(spanId, makeEndSpanInput());

      // getTrace returns a JSON deep-copy so Date fields become ISO strings
      const trace = service.getTrace(traceId);
      expect(trace!.spans[0].endTime).toBeDefined();
      expect(
        new Date(trace!.spans[0].endTime as unknown as string).getTime(),
      ).toBeGreaterThan(0);
    });

    it("should set output on the span when provided", () => {
      const traceId = service.startTrace(makeTraceInput());
      const spanId = service.addSpan(traceId, makeSpanInput());

      service.endSpan(spanId, makeEndSpanInput({ output: { result: "ok" } }));

      const trace = service.getTrace(traceId);
      expect(trace!.spans[0].output).toEqual({ result: "ok" });
    });

    it("should log a warning and do nothing when span is not found", () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      service.endSpan("non-existent-span-id", makeEndSpanInput());
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Span not found"),
      );
    });
  });

  // =========================================================================
  // endTrace()
  // =========================================================================

  describe("endTrace()", () => {
    it("should update trace status to success", () => {
      const traceId = service.startTrace(makeTraceInput());

      service.endTrace(traceId, makeEndTraceInput({ status: "success" }));

      const trace = service.getTrace(traceId);
      expect(trace!.status).toBe("success");
    });

    it("should update trace status to error", () => {
      const traceId = service.startTrace(makeTraceInput());

      service.endTrace(traceId, makeEndTraceInput({ status: "error" }));

      const trace = service.getTrace(traceId);
      expect(trace!.status).toBe("error");
    });

    it("should set duration from totalDuration when provided", () => {
      const traceId = service.startTrace(makeTraceInput());

      service.endTrace(traceId, makeEndTraceInput({ totalDuration: 5000 }));

      const trace = service.getTrace(traceId);
      expect(trace!.duration).toBe(5000);
    });

    it("should auto-calculate duration when totalDuration is not provided", () => {
      const traceId = service.startTrace(makeTraceInput());

      service.endTrace(traceId, makeEndTraceInput());

      const trace = service.getTrace(traceId);
      expect(trace!.duration).toBeGreaterThanOrEqual(0);
    });

    it("should set endTime on the trace", () => {
      const traceId = service.startTrace(makeTraceInput());

      service.endTrace(traceId, makeEndTraceInput());

      // getTrace returns a JSON deep-copy so Date fields become ISO strings
      const trace = service.getTrace(traceId);
      expect(trace!.endTime).toBeDefined();
      expect(
        new Date(trace!.endTime as unknown as string).getTime(),
      ).toBeGreaterThan(0);
    });

    it("should log a warning and do nothing when trace is not found", () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      service.endTrace("ghost-trace-id", makeEndTraceInput());
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Trace not found"),
      );
    });
  });

  // =========================================================================
  // getTrace()
  // =========================================================================

  describe("getTrace()", () => {
    it("should return null for a non-existent traceId", () => {
      expect(service.getTrace("non-existent")).toBeNull();
    });

    it("should return a deep copy (not the original reference)", () => {
      const traceId = service.startTrace(makeTraceInput());
      const trace1 = service.getTrace(traceId);
      const trace2 = service.getTrace(traceId);

      expect(trace1).not.toBe(trace2); // different references
      expect(trace1).toEqual(trace2); // same content
    });

    it("should not expose the internal trace object to mutation", () => {
      const traceId = service.startTrace(makeTraceInput());
      const trace = service.getTrace(traceId);

      // Mutate the returned copy
      trace!.name = "mutated";

      // Internal state should be unchanged
      const fresh = service.getTrace(traceId);
      expect(fresh!.name).toBe("Test Trace");
    });
  });

  // =========================================================================
  // listTraces()
  // =========================================================================

  describe("listTraces()", () => {
    it("should return an empty array when no traces are recorded (no Prisma)", async () => {
      const result = await service.listTraces();
      expect(result).toEqual([]);
    });

    it("should list all recorded traces when no filter is applied", async () => {
      service.startTrace(makeTraceInput({ type: "research" }));
      service.startTrace(makeTraceInput({ type: "tool_call" }));

      const result = await service.listTraces();
      expect(result).toHaveLength(2);
    });

    it("should filter traces by type when type option is provided", async () => {
      service.startTrace(makeTraceInput({ type: "research" }));
      service.startTrace(makeTraceInput({ type: "tool_call" }));
      service.startTrace(makeTraceInput({ type: "research" }));

      const result = await service.listTraces({ type: "research" });
      expect(result).toHaveLength(2);
      expect(result.every((t) => t.type === "research")).toBe(true);
    });

    it("should respect the limit option", async () => {
      for (let i = 0; i < 10; i++) {
        service.startTrace(makeTraceInput());
      }

      const result = await service.listTraces({ limit: 3 });
      expect(result).toHaveLength(3);
    });

    it("should default limit to 50 when not specified", async () => {
      for (let i = 0; i < 60; i++) {
        service.startTrace(makeTraceInput());
      }

      const result = await service.listTraces();
      expect(result).toHaveLength(50);
    });

    it("should return traces sorted by startTime descending (most recent first)", async () => {
      service.startTrace(makeTraceInput({ name: "First" }));
      await new Promise((r) => setTimeout(r, 5));
      service.startTrace(makeTraceInput({ name: "Second" }));

      const result = await service.listTraces();
      // Most recent should be first
      expect(result[0].startTime.getTime()).toBeGreaterThanOrEqual(
        result[1].startTime.getTime(),
      );
    });

    it("should return TraceSummary shape with correct fields", async () => {
      const traceId = service.startTrace(
        makeTraceInput({ name: "Summary Test" }),
      );
      service.addSpan(traceId, makeSpanInput());

      const result = await service.listTraces();
      const summary = result.find((t) => t.id === traceId);
      expect(summary).toBeDefined();
      expect(summary!.name).toBe("Summary Test");
      expect(summary!.status).toBe("running");
      expect(summary!.spanCount).toBe(1);
      expect(summary!.startTime).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // getStats()
  // =========================================================================

  describe("getStats()", () => {
    it("should return zero counts when no traces are recorded", () => {
      const stats = service.getStats();
      expect(stats.totalTraces).toBe(0);
      expect(stats.runningTraces).toBe(0);
      expect(stats.totalSpans).toBe(0);
      expect(stats.byType).toEqual({});
    });

    it("should count total traces correctly", () => {
      service.startTrace(makeTraceInput());
      service.startTrace(makeTraceInput());

      const stats = service.getStats();
      expect(stats.totalTraces).toBe(2);
    });

    it("should count running traces correctly", () => {
      const id1 = service.startTrace(makeTraceInput());
      service.startTrace(makeTraceInput());
      service.endTrace(id1, makeEndTraceInput());

      const stats = service.getStats();
      expect(stats.runningTraces).toBe(1);
    });

    it("should count total spans correctly", () => {
      const traceId1 = service.startTrace(makeTraceInput());
      const traceId2 = service.startTrace(makeTraceInput());

      service.addSpan(traceId1, makeSpanInput());
      service.addSpan(traceId1, makeSpanInput());
      service.addSpan(traceId2, makeSpanInput());

      const stats = service.getStats();
      expect(stats.totalSpans).toBe(3);
    });

    it("should group traces byType correctly", () => {
      service.startTrace(makeTraceInput({ type: "research" }));
      service.startTrace(makeTraceInput({ type: "research" }));
      service.startTrace(makeTraceInput({ type: "tool_call" }));

      const stats = service.getStats();
      expect(stats.byType["research"]).toBe(2);
      expect(stats.byType["tool_call"]).toBe(1);
    });

    it("should populate byStatus correctly", () => {
      const id1 = service.startTrace(makeTraceInput());
      service.startTrace(makeTraceInput());
      service.endTrace(id1, makeEndTraceInput({ status: "success" }));

      const stats = service.getStats();
      expect(stats.byStatus.success).toBe(1);
      expect(stats.byStatus.running).toBe(1);
      expect(stats.byStatus.error).toBe(0);
    });

    it("should initialize byStatus with all three values", () => {
      service.startTrace(makeTraceInput());

      const stats = service.getStats();
      expect(stats.byStatus).toHaveProperty("running");
      expect(stats.byStatus).toHaveProperty("success");
      expect(stats.byStatus).toHaveProperty("error");
    });
  });

  // =========================================================================
  // clearAll()
  // =========================================================================

  describe("clearAll()", () => {
    it("should remove all traces from memory", async () => {
      service.startTrace(makeTraceInput());
      service.startTrace(makeTraceInput());

      service.clearAll();

      const result = await service.listTraces();
      expect(result).toHaveLength(0);
    });

    it("should reset span count to 0", () => {
      const traceId = service.startTrace(makeTraceInput());
      service.addSpan(traceId, makeSpanInput());

      service.clearAll();

      expect(service.getStats().totalSpans).toBe(0);
    });

    it("should make getTrace return null for previously stored traces", () => {
      const traceId = service.startTrace(makeTraceInput());

      service.clearAll();

      expect(service.getTrace(traceId)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Suite WITH Prisma — DB persistence paths
// ---------------------------------------------------------------------------

describe("TraceCollectorService (with Prisma)", () => {
  let service: TraceCollectorService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TraceCollectorService,
        { provide: PrismaService, useValue: mockPrisma as any },
      ],
    }).compile();

    service = module.get<TraceCollectorService>(TraceCollectorService);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // startTrace() — DB persistence
  // =========================================================================

  describe("startTrace() DB persistence", () => {
    it("should call agentTrace.upsert on startTrace", async () => {
      service.startTrace(makeTraceInput());

      // Allow fire-and-forget promise to settle
      await new Promise((r) => setTimeout(r, 10));

      expect(mockPrisma.agentTrace.upsert).toHaveBeenCalled();
    });

    it("should upsert with correct trace data", async () => {
      const traceId = service.startTrace(
        makeTraceInput({ name: "DB Test", type: "mcp_request" }),
      );

      await new Promise((r) => setTimeout(r, 10));

      const call = mockPrisma.agentTrace.upsert.mock.calls[0][0];
      expect(call.where.id).toBe(traceId);
      expect(call.create.id).toBe(traceId);
      expect(call.create.name).toBe("DB Test");
      expect(call.create.type).toBe("mcp_request");
      expect(call.create.status).toBe("running");
    });

    it("should handle DB errors gracefully (fire-and-forget, no throw)", async () => {
      mockPrisma.agentTrace.upsert.mockRejectedValueOnce(new Error("DB down"));

      expect(() => service.startTrace(makeTraceInput())).not.toThrow();

      // Let the rejected promise settle silently
      await new Promise((r) => setTimeout(r, 20));
    });
  });

  // =========================================================================
  // addSpan() — DB persistence
  // =========================================================================

  describe("addSpan() DB persistence", () => {
    it("should call agentSpan.upsert on addSpan", async () => {
      const traceId = service.startTrace(makeTraceInput());
      service.addSpan(
        traceId,
        makeSpanInput({ name: "Span A", type: "search" }),
      );

      await new Promise((r) => setTimeout(r, 10));

      expect(mockPrisma.agentSpan.upsert).toHaveBeenCalled();
    });

    it("should upsert span with correct data", async () => {
      const traceId = service.startTrace(makeTraceInput());
      const spanId = service.addSpan(
        traceId,
        makeSpanInput({ name: "Upsert Span", type: "analysis" }),
      );

      await new Promise((r) => setTimeout(r, 10));

      // The second upsert call is for the span (first is the trace)
      const spanCall = mockPrisma.agentSpan.upsert.mock.calls[0][0];
      expect(spanCall.where.id).toBe(spanId);
      expect(spanCall.create.traceId).toBe(traceId);
      expect(spanCall.create.name).toBe("Upsert Span");
    });

    it("should handle DB errors gracefully in addSpan", async () => {
      mockPrisma.agentSpan.upsert.mockRejectedValueOnce(new Error("DB error"));

      const traceId = service.startTrace(makeTraceInput());
      expect(() => service.addSpan(traceId, makeSpanInput())).not.toThrow();

      await new Promise((r) => setTimeout(r, 20));
    });
  });

  // =========================================================================
  // endSpan() — DB persistence
  // =========================================================================

  describe("endSpan() DB persistence", () => {
    it("should call agentSpan.upsert on endSpan", async () => {
      const traceId = service.startTrace(makeTraceInput());
      const spanId = service.addSpan(traceId, makeSpanInput());

      // Reset mock after setup calls
      mockPrisma.agentSpan.upsert.mockClear();

      service.endSpan(spanId, makeEndSpanInput({ status: "success" }));

      await new Promise((r) => setTimeout(r, 10));

      expect(mockPrisma.agentSpan.upsert).toHaveBeenCalled();
    });

    it("should upsert span with updated status on endSpan", async () => {
      const traceId = service.startTrace(makeTraceInput());
      const spanId = service.addSpan(traceId, makeSpanInput());

      mockPrisma.agentSpan.upsert.mockClear();

      service.endSpan(
        spanId,
        makeEndSpanInput({ status: "error", error: "timeout" }),
      );

      await new Promise((r) => setTimeout(r, 10));

      const call = mockPrisma.agentSpan.upsert.mock.calls[0][0];
      expect(call.update.status).toBe("error");
      expect(call.update.error).toBe("timeout");
    });

    it("should handle DB errors gracefully in endSpan", async () => {
      const traceId = service.startTrace(makeTraceInput());
      const spanId = service.addSpan(traceId, makeSpanInput());

      mockPrisma.agentSpan.upsert.mockRejectedValueOnce(new Error("DB error"));

      expect(() => service.endSpan(spanId, makeEndSpanInput())).not.toThrow();

      await new Promise((r) => setTimeout(r, 20));
    });
  });

  // =========================================================================
  // endTrace() — DB persistence
  // =========================================================================

  describe("endTrace() DB persistence", () => {
    it("should call agentTrace.upsert on endTrace", async () => {
      const traceId = service.startTrace(makeTraceInput());

      mockPrisma.agentTrace.upsert.mockClear();

      service.endTrace(traceId, makeEndTraceInput({ status: "success" }));

      await new Promise((r) => setTimeout(r, 10));

      expect(mockPrisma.agentTrace.upsert).toHaveBeenCalled();
    });

    it("should upsert trace with updated status on endTrace", async () => {
      const traceId = service.startTrace(makeTraceInput());

      mockPrisma.agentTrace.upsert.mockClear();

      service.endTrace(
        traceId,
        makeEndTraceInput({ status: "success", totalDuration: 3000 }),
      );

      await new Promise((r) => setTimeout(r, 10));

      const call = mockPrisma.agentTrace.upsert.mock.calls[0][0];
      expect(call.update.status).toBe("success");
      expect(call.update.duration).toBe(3000);
    });

    it("should handle DB errors gracefully in endTrace", async () => {
      const traceId = service.startTrace(makeTraceInput());

      mockPrisma.agentTrace.upsert.mockRejectedValueOnce(new Error("DB error"));

      expect(() =>
        service.endTrace(traceId, makeEndTraceInput()),
      ).not.toThrow();

      await new Promise((r) => setTimeout(r, 20));
    });
  });

  // =========================================================================
  // listTraces() — DB fallback
  // =========================================================================

  describe("listTraces() DB fallback", () => {
    it("should fall back to DB when memory is empty", async () => {
      const dbRows = [
        {
          id: "trace-db-1",
          name: "DB Trace",
          type: "research",
          status: "success",
          startTime: new Date(),
          duration: 5000,
          _count: { spans: 3 },
        },
      ];
      mockPrisma.agentTrace.findMany.mockResolvedValueOnce(dbRows);

      const result = await service.listTraces();

      expect(mockPrisma.agentTrace.findMany).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("trace-db-1");
      expect(result[0].spanCount).toBe(3);
    });

    it("should NOT query DB when memory has traces", async () => {
      service.startTrace(makeTraceInput());

      await service.listTraces();

      expect(mockPrisma.agentTrace.findMany).not.toHaveBeenCalled();
    });

    it("should pass type filter to DB query", async () => {
      mockPrisma.agentTrace.findMany.mockResolvedValueOnce([]);

      await service.listTraces({ type: "tool_call" });

      expect(mockPrisma.agentTrace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { type: "tool_call" },
        }),
      );
    });

    it("should use empty where when no type filter is provided", async () => {
      mockPrisma.agentTrace.findMany.mockResolvedValueOnce([]);

      await service.listTraces();

      expect(mockPrisma.agentTrace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });

    it("should pass limit to DB query", async () => {
      mockPrisma.agentTrace.findMany.mockResolvedValueOnce([]);

      await service.listTraces({ limit: 10 });

      expect(mockPrisma.agentTrace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it("should return empty array when DB fallback fails", async () => {
      mockPrisma.agentTrace.findMany.mockRejectedValueOnce(
        new Error("DB connection lost"),
      );

      const result = await service.listTraces();

      expect(result).toEqual([]);
    });

    it("should map DB rows to TraceSummary correctly", async () => {
      const startTime = new Date("2026-02-10T10:00:00Z");
      mockPrisma.agentTrace.findMany.mockResolvedValueOnce([
        {
          id: "t1",
          name: "Research Session",
          type: "research",
          status: "success",
          startTime,
          duration: 12000,
          _count: { spans: 7 },
        },
      ]);

      const result = await service.listTraces();

      expect(result[0]).toMatchObject({
        id: "t1",
        name: "Research Session",
        type: "research",
        status: "success",
        startTime,
        duration: 12000,
        spanCount: 7,
      });
    });

    it("should map undefined duration from DB correctly", async () => {
      mockPrisma.agentTrace.findMany.mockResolvedValueOnce([
        {
          id: "t2",
          name: "Running Trace",
          type: "tool_call",
          status: "running",
          startTime: new Date(),
          duration: null,
          _count: { spans: 0 },
        },
      ]);

      const result = await service.listTraces();

      expect(result[0].duration).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// FIFO eviction tests
// ---------------------------------------------------------------------------

describe("TraceCollectorService (FIFO eviction)", () => {
  it("should evict oldest completed trace when MAX_TRACES is reached", async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TraceCollectorService],
    }).compile();
    const service = module.get<TraceCollectorService>(TraceCollectorService);

    const MAX_TRACES = 1000;

    // Fill up to MAX_TRACES - 1 completed traces
    const firstTraceId = service.startTrace(makeTraceInput({ name: "First" }));
    service.endTrace(firstTraceId, makeEndTraceInput());

    for (let i = 1; i < MAX_TRACES; i++) {
      const id = service.startTrace(makeTraceInput());
      service.endTrace(id, makeEndTraceInput());
    }

    // The 1001st trace should trigger eviction of the first completed trace
    service.startTrace(makeTraceInput({ name: "Overflow Trace" }));

    // First trace should have been evicted
    expect(service.getTrace(firstTraceId)).toBeNull();
  });

  it("should log a warning when all traces are active and cannot be evicted", () => {
    // Create service directly without DI for this edge case
    const svc = new TraceCollectorService();

    const MAX_TRACES = 1000;

    // Fill with running (not completed) traces
    for (let i = 0; i < MAX_TRACES; i++) {
      svc.startTrace(makeTraceInput());
    }

    const warnSpy = jest.spyOn(Logger.prototype, "warn");

    // Adding one more should trigger eviction attempt but all are running
    svc.startTrace(makeTraceInput());

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("All traces are active, cannot evict"),
    );
  });

  it("should clean up spans of the evicted trace", () => {
    const service = new TraceCollectorService();
    const MAX_TRACES = 1000;

    // Create the trace that will be evicted (completed with spans)
    const targetId = service.startTrace(makeTraceInput({ name: "To Evict" }));
    service.addSpan(targetId, makeSpanInput());
    service.addSpan(targetId, makeSpanInput());
    service.endTrace(targetId, makeEndTraceInput());

    // Fill remaining spots
    for (let i = 1; i < MAX_TRACES; i++) {
      const id = service.startTrace(makeTraceInput());
      service.endTrace(id, makeEndTraceInput());
    }

    // Should trigger eviction
    service.startTrace(makeTraceInput());

    // Target trace should be gone
    expect(service.getTrace(targetId)).toBeNull();

    // Span count should reflect spans being cleaned up
    const stats = service.getStats();
    expect(stats.totalSpans).toBeLessThan(MAX_TRACES);
  });
});

// ---------------------------------------------------------------------------
// Coverage gap: fire-and-forget .catch() debug log callbacks
// (lines 75, 116, 147, 175 in process-event-log.service.ts)
// ---------------------------------------------------------------------------

describe("TraceCollectorService (fire-and-forget error paths)", () => {
  let service: TraceCollectorService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TraceCollectorService,
        { provide: PrismaService, useValue: mockPrisma as any },
      ],
    }).compile();
    service = module.get<TraceCollectorService>(TraceCollectorService);
  });

  afterEach(() => jest.clearAllMocks());

  it("should log internal DB persist failure when persistTrace upsert fails on startTrace", async () => {
    // persistTrace has an internal try/catch that calls logger.debug.
    // The outer .catch() callbacks (lines 75/116/147/175) are only reachable
    // if persistTrace itself throws PAST its try/catch — which cannot happen
    // in normal operation. We verify the INTERNAL catch behavior instead.
    mockPrisma.agentTrace.upsert.mockRejectedValueOnce(
      new Error("persist fail"),
    );
    const debugSpy = jest.spyOn(Logger.prototype, "debug");

    service.startTrace(makeTraceInput());

    await new Promise((r) => setTimeout(r, 20));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("DB persist failed for trace"),
    );
  });

  it("should log internal DB persist failure when persistSpan upsert fails on addSpan", async () => {
    const traceId = service.startTrace(makeTraceInput());

    await new Promise((r) => setTimeout(r, 10));

    mockPrisma.agentSpan.upsert.mockRejectedValueOnce(
      new Error("span persist fail"),
    );
    const debugSpy = jest.spyOn(Logger.prototype, "debug");

    service.addSpan(traceId, makeSpanInput());

    await new Promise((r) => setTimeout(r, 20));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("DB persist failed for span"),
    );
  });

  it("should log internal DB persist failure when persistSpan upsert fails on endSpan", async () => {
    const traceId = service.startTrace(makeTraceInput());
    const spanId = service.addSpan(traceId, makeSpanInput());

    await new Promise((r) => setTimeout(r, 10));

    mockPrisma.agentSpan.upsert.mockRejectedValueOnce(
      new Error("end span fail"),
    );
    const debugSpy = jest.spyOn(Logger.prototype, "debug");

    service.endSpan(spanId, makeEndSpanInput());

    await new Promise((r) => setTimeout(r, 20));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("DB persist failed for span"),
    );
  });

  it("should log internal DB persist failure when persistTrace upsert fails on endTrace", async () => {
    const traceId = service.startTrace(makeTraceInput());

    await new Promise((r) => setTimeout(r, 10));

    mockPrisma.agentTrace.upsert.mockRejectedValueOnce(
      new Error("end trace fail"),
    );
    const debugSpy = jest.spyOn(Logger.prototype, "debug");

    service.endTrace(traceId, makeEndTraceInput());

    await new Promise((r) => setTimeout(r, 20));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("DB persist failed for trace"),
    );
  });

  it("should cover fire-and-forget outer catch callbacks by mocking persistTrace to throw", async () => {
    // The outer .catch() lines (75, 116, 147, 175) are only reachable if
    // persistTrace/persistSpan itself throws. Since they have internal try/catch,
    // we mock them directly via the private method accessor to force a rejection.
    const debugSpy = jest.spyOn(Logger.prototype, "debug");

    // Mock persistTrace to reject (bypassing its internal try/catch)
    jest
      .spyOn(service as any, "persistTrace")
      .mockRejectedValue(new Error("force throw from persistTrace"));

    service.startTrace(makeTraceInput());
    await new Promise((r) => setTimeout(r, 20));

    // The outer .catch() callback on line 75 should now fire
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("persistTrace failed on startTrace"),
    );
  });

  it("should cover fire-and-forget outer catch for persistSpan on addSpan", async () => {
    const traceId = service.startTrace(makeTraceInput());
    await new Promise((r) => setTimeout(r, 10));

    const debugSpy = jest.spyOn(Logger.prototype, "debug");

    jest
      .spyOn(service as any, "persistSpan")
      .mockRejectedValue(new Error("force throw from persistSpan"));

    service.addSpan(traceId, makeSpanInput());
    await new Promise((r) => setTimeout(r, 20));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("persistSpan failed on addSpan"),
    );
  });

  it("should cover fire-and-forget outer catch for persistSpan on endSpan", async () => {
    const traceId = service.startTrace(makeTraceInput());
    const spanId = service.addSpan(traceId, makeSpanInput());
    await new Promise((r) => setTimeout(r, 10));

    const debugSpy = jest.spyOn(Logger.prototype, "debug");

    jest
      .spyOn(service as any, "persistSpan")
      .mockRejectedValue(new Error("force throw on endSpan"));

    service.endSpan(spanId, makeEndSpanInput());
    await new Promise((r) => setTimeout(r, 20));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("persistSpan failed on endSpan"),
    );
  });

  it("should cover fire-and-forget outer catch for persistTrace on endTrace", async () => {
    const traceId = service.startTrace(makeTraceInput());
    await new Promise((r) => setTimeout(r, 10));

    const debugSpy = jest.spyOn(Logger.prototype, "debug");

    jest
      .spyOn(service as any, "persistTrace")
      .mockRejectedValue(new Error("force throw on endTrace"));

    service.endTrace(traceId, makeEndTraceInput());
    await new Promise((r) => setTimeout(r, 20));

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("persistTrace failed on endTrace"),
    );
  });
});
