/**
 * ToolInvoker — supplement branch coverage spec
 *
 * Targets uncovered branches:
 *   - truncateResult(): null value, string truncation, JSON truncation, JSON.stringify fail
 *   - invoke() circuit breaker open → error result
 *   - invoke() result.success=false with timeout/validation error messages → failureCode
 *   - invoke() maxResultChars=0 → no truncation
 *   - invoke() truncated=true → warn logged
 *   - invoke() catch block with timeout message → TOOL_TIMEOUT failureCode
 *   - invoke() with tracer (span start/end/recordException)
 *   - invokeMany() signal aborted → break
 *   - invokeMany() all-failed aggregation
 *   - invokeMany() settled.status === "rejected" defensive path
 */

import { ToolInvoker } from "../tool-invoker";
import { ToolCircuitBreaker } from "../tool-circuit-breaker";
import type {
  IContextEnvelope,
  IParallelToolCallAction,
} from "../../../agents/abstractions";
import { Logger } from "@nestjs/common";

// Suppress logger
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeEnvelope(): IContextEnvelope {
  return {
    system: "",
    messages: [],
    reminders: [],
    tools: [],
    memory: { sessionId: "s1", userId: "u1" },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 100000,
      iterationsUsed: 0,
      iterationsRemaining: 10,
      wallTimeStartMs: Date.now(),
    },
  } as unknown as IContextEnvelope;
}

function makeToolRegistry(
  tools: Record<string, { success: boolean; data?: unknown; error?: string }>,
) {
  return {
    has: jest.fn((id: string) => id in tools),
    get: jest.fn((id: string) => {
      const t = tools[id];
      if (!t) return undefined;
      return {
        id,
        execute: jest.fn(async () => ({
          success: t.success,
          data: t.data,
          error: t.error ? { message: t.error } : undefined,
          metadata: {
            executionId: "x",
            startTime: new Date(),
            endTime: new Date(),
          },
        })),
      };
    }),
  };
}

function makeInvoker(
  registry: ReturnType<typeof makeToolRegistry>,
  circuitBreaker?: ToolCircuitBreaker,
  tracer?: unknown,
) {
  return new ToolInvoker(registry as never, circuitBreaker, tracer as never);
}

const baseOpts = { agentId: "agent-1" };

// ─── truncateResult via invoke (null output) ───────────────────────────────

describe("ToolInvoker supplement — truncateResult null output", () => {
  it("returns null output without truncation", async () => {
    const registry = makeToolRegistry({
      "null-tool": { success: true, data: null },
    });
    const invoker = makeInvoker(registry);
    const result = await invoker.invoke(
      { kind: "tool_call", toolId: "null-tool", input: {} },
      makeEnvelope(),
      baseOpts,
    );
    expect(result.output).toBeNull();
    expect(result.error).toBeUndefined();
  });
});

// ─── truncateResult via invoke (string truncation) ────────────────────────

describe("ToolInvoker supplement — string output truncation", () => {
  it("truncates large string output", async () => {
    const largeOutput = "x".repeat(35_000); // > DEFAULT_RESULT_MAX_CHARS (32000)
    const registry = makeToolRegistry({
      "large-tool": { success: true, data: largeOutput },
    });
    const invoker = makeInvoker(registry);
    const result = await invoker.invoke(
      { kind: "tool_call", toolId: "large-tool", input: {} },
      makeEnvelope(),
      baseOpts,
    );
    expect(typeof result.output).toBe("string");
    expect((result.output as string).includes("[TRUNCATED")).toBe(true);
  });

  it("does not truncate when maxResultChars=0", async () => {
    const largeOutput = "x".repeat(35_000);
    const registry = makeToolRegistry({
      "large-tool": { success: true, data: largeOutput },
    });
    const invoker = makeInvoker(registry);
    const result = await invoker.invoke(
      { kind: "tool_call", toolId: "large-tool", input: {} },
      makeEnvelope(),
      { ...baseOpts, maxResultChars: 0 },
    );
    expect(result.output).toBe(largeOutput); // Not truncated
  });
});

// ─── truncateResult via invoke (object truncation) ────────────────────────

describe("ToolInvoker supplement — object output truncation", () => {
  it("truncates large object output (JSON serialized)", async () => {
    const largeObj = { data: "y".repeat(20000) };
    const registry = makeToolRegistry({
      "obj-tool": { success: true, data: largeObj },
    });
    const invoker = makeInvoker(registry);
    const result = await invoker.invoke(
      { kind: "tool_call", toolId: "obj-tool", input: {} },
      makeEnvelope(),
      { ...baseOpts, maxResultChars: 100 },
    );
    expect(typeof result.output).toBe("string");
    expect((result.output as string).includes("[TRUNCATED")).toBe(true);
  });
});

// ─── circuit breaker open ─────────────────────────────────────────────────

describe("ToolInvoker supplement — circuit breaker open", () => {
  it("returns error when circuit breaker blocks tool", async () => {
    const registry = makeToolRegistry({
      "blocked-tool": { success: true, data: "ok" },
    });
    const cbMock = {
      allow: jest.fn().mockReturnValue(false),
      recordFailure: jest.fn(),
      recordSuccess: jest.fn(),
    } as unknown as ToolCircuitBreaker;

    const invoker = makeInvoker(registry, cbMock);
    const result = await invoker.invoke(
      { kind: "tool_call", toolId: "blocked-tool", input: {} },
      makeEnvelope(),
      baseOpts,
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toMatch(/open-circuited/);
    expect(result.failureCode).toBe("TOOL_RUNTIME_ERROR");
  });
});

// ─── invoke() tool failure with timeout error message ─────────────────────

describe("ToolInvoker supplement — tool failure with timeout error", () => {
  it("sets TOOL_TIMEOUT failureCode when error contains 'timeout'", async () => {
    const registry = makeToolRegistry({
      "slow-tool": { success: false, error: "request timed out after 5000ms" },
    });
    const invoker = makeInvoker(registry);
    const result = await invoker.invoke(
      { kind: "tool_call", toolId: "slow-tool", input: {} },
      makeEnvelope(),
      baseOpts,
    );
    expect(result.failureCode).toBe("TOOL_TIMEOUT");
  });

  it("sets TOOL_INPUT_VALIDATION_FAILED when error contains 'invalid input'", async () => {
    const registry = makeToolRegistry({
      "validate-tool": {
        success: false,
        error: "invalid input: missing query",
      },
    });
    const invoker = makeInvoker(registry);
    const result = await invoker.invoke(
      { kind: "tool_call", toolId: "validate-tool", input: {} },
      makeEnvelope(),
      baseOpts,
    );
    expect(result.failureCode).toBe("TOOL_INPUT_VALIDATION_FAILED");
  });

  it("uses Tool failed message when error.message is missing", async () => {
    const registry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({
        execute: jest.fn().mockResolvedValue({
          success: false,
          error: undefined, // no error object
          data: undefined,
          metadata: {
            executionId: "x",
            startTime: new Date(),
            endTime: new Date(),
          },
        }),
      }),
    };
    const invoker = makeInvoker(registry as never);
    const result = await invoker.invoke(
      { kind: "tool_call", toolId: "no-err-tool", input: {} },
      makeEnvelope(),
      baseOpts,
    );
    expect(result.error?.message).toMatch(/no-err-tool failed/);
  });
});

// ─── invoke() catch block with timeout ────────────────────────────────────

describe("ToolInvoker supplement — catch block timeout message", () => {
  it("sets TOOL_TIMEOUT failureCode when thrown error contains 'timeout'", async () => {
    const registry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({
        execute: jest.fn().mockRejectedValue(new Error("request timed out")),
      }),
    };
    const cbMock = {
      allow: jest.fn().mockReturnValue(true),
      recordFailure: jest.fn(),
      recordSuccess: jest.fn(),
    } as unknown as ToolCircuitBreaker;

    const invoker = makeInvoker(registry as never, cbMock);
    const result = await invoker.invoke(
      { kind: "tool_call", toolId: "timeout-tool", input: {} },
      makeEnvelope(),
      baseOpts,
    );
    expect(result.failureCode).toBe("TOOL_TIMEOUT");
    expect(cbMock.recordFailure).toHaveBeenCalled();
  });

  it("catches non-Error thrown from tool", async () => {
    const registry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({
        execute: jest.fn().mockRejectedValue("string error"),
      }),
    };
    const invoker = makeInvoker(registry as never);
    const result = await invoker.invoke(
      { kind: "tool_call", toolId: "str-err-tool", input: {} },
      makeEnvelope(),
      baseOpts,
    );
    expect(result.error?.message).toBe("string error");
  });
});

// ─── invoke() with tracer ──────────────────────────────────────────────────

describe("ToolInvoker supplement — with tracer", () => {
  it("calls tracer startSpan and end on success", async () => {
    const mockSpan = {
      recordException: jest.fn(),
      end: jest.fn(),
    };
    const mockTracer = {
      startSpan: jest.fn().mockReturnValue(mockSpan),
    };
    const registry = makeToolRegistry({
      "traced-tool": { success: true, data: "result" },
    });
    const invoker = makeInvoker(registry, undefined, mockTracer);

    await invoker.invoke(
      { kind: "tool_call", toolId: "traced-tool", input: {} },
      makeEnvelope(),
      baseOpts,
    );

    expect(mockTracer.startSpan).toHaveBeenCalledWith(
      "tool.traced-tool",
      expect.any(Object),
    );
    expect(mockSpan.end).toHaveBeenCalledWith({
      success: true,
      truncated: false,
    });
  });

  it("calls span.recordException and end on failure", async () => {
    const mockSpan = {
      recordException: jest.fn(),
      end: jest.fn(),
    };
    const mockTracer = { startSpan: jest.fn().mockReturnValue(mockSpan) };
    const registry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({
        execute: jest.fn().mockRejectedValue(new Error("fail")),
      }),
    };
    const invoker = makeInvoker(registry as never, undefined, mockTracer);

    await invoker.invoke(
      { kind: "tool_call", toolId: "fail-tool", input: {} },
      makeEnvelope(),
      baseOpts,
    );

    expect(mockSpan.recordException).toHaveBeenCalled();
    expect(mockSpan.end).toHaveBeenCalledWith({ success: false });
  });
});

// ─── invokeMany() — signal abort ──────────────────────────────────────────

describe("ToolInvoker supplement — invokeMany signal abort", () => {
  it("breaks out of loop when signal is aborted", async () => {
    const registry = makeToolRegistry({
      "tool-a": { success: true, data: "a" },
      "tool-b": { success: true, data: "b" },
    });
    const invoker = makeInvoker(registry);

    const controller = new AbortController();
    controller.abort();

    const parallel: IParallelToolCallAction = {
      kind: "parallel_tool_call",
      calls: [
        { kind: "tool_call", toolId: "tool-a", input: {} },
        { kind: "tool_call", toolId: "tool-b", input: {} },
      ],
    };

    const result = await invoker.invokeMany(parallel, makeEnvelope(), {
      agentId: "agent-1",
      signal: controller.signal,
    });

    // Signal was aborted before first batch, so no results
    expect(result.output).toEqual([]);
  });
});

// ─── invokeMany() — allFailed ─────────────────────────────────────────────

describe("ToolInvoker supplement — invokeMany all failed", () => {
  it("sets error when all parallel tools fail", async () => {
    const registry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({
        execute: jest.fn().mockRejectedValue(new Error("fail")),
      }),
    };
    const invoker = makeInvoker(registry as never);

    const parallel: IParallelToolCallAction = {
      kind: "parallel_tool_call",
      calls: [
        { kind: "tool_call", toolId: "t1", input: {} },
        { kind: "tool_call", toolId: "t2", input: {} },
      ],
    };

    const result = await invoker.invokeMany(parallel, makeEnvelope(), {
      agentId: "agent-1",
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toMatch(/all.*parallel tool calls failed/);
    expect(result.subResults).toHaveLength(2);
  });

  it("returns no error when at least one tool succeeds", async () => {
    const registry = makeToolRegistry({
      "tool-ok": { success: true, data: "ok" },
      "tool-fail": { success: false, error: "bad" },
    });
    const invoker = makeInvoker(registry);

    const parallel: IParallelToolCallAction = {
      kind: "parallel_tool_call",
      calls: [
        { kind: "tool_call", toolId: "tool-ok", input: {} },
        { kind: "tool_call", toolId: "tool-fail", input: {} },
      ],
    };

    const result = await invoker.invokeMany(parallel, makeEnvelope(), {
      agentId: "agent-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.subResults).toHaveLength(2);
  });
});

// ─── P1 partialData bytes in LLM error string ─────────────────────────────

describe("ToolInvoker supplement — partialData bytes in LLM error string", () => {
  it("appends partial data byte count to output.error when error has .data", async () => {
    const partialPayload = { content: "partial" };
    const partialErr = Object.assign(new Error("fetch failed"), {
      data: partialPayload,
    });
    const registry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({
        execute: jest.fn().mockRejectedValue(partialErr),
      }),
    };
    const invoker = makeInvoker(registry as never);
    const result = await invoker.invoke(
      { kind: "tool_call", toolId: "partial-tool", input: {} },
      makeEnvelope(),
      baseOpts,
    );
    // output.error (LLM-visible string) should include byte count
    const outputErr = (result.output as Record<string, unknown>)
      ?.error as string;
    expect(outputErr).toContain("fetch failed");
    expect(outputErr).toMatch(/partial data: \d+ bytes available/);
    // result.error (Error object) should remain unchanged
    expect(result.error?.message).toBe("fetch failed");
    // partialData should be present in output
    expect((result.output as Record<string, unknown>)?.partialData).toEqual(
      partialPayload,
    );
  });

  it("does not append bytes hint when error has no .data", async () => {
    const registry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({
        execute: jest.fn().mockRejectedValue(new Error("plain error")),
      }),
    };
    const invoker = makeInvoker(registry as never);
    const result = await invoker.invoke(
      { kind: "tool_call", toolId: "plain-err-tool", input: {} },
      makeEnvelope(),
      baseOpts,
    );
    const outputErr = (result.output as Record<string, unknown>)
      ?.error as string;
    expect(outputErr).toBe("plain error");
    expect(outputErr).not.toContain("bytes available");
  });
});
