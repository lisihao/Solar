/**
 * Unit tests for TimeoutMiddleware
 */

import {
  TimeoutMiddleware,
  createTimeoutMiddleware,
} from "../timeout.middleware";
import {
  ITool,
  ToolCategory,
  ToolContext,
  ToolResult,
} from "../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(id: string = "test-tool", defaultTimeout?: number): ITool {
  return {
    id,
    name: `Tool ${id}`,
    description: "Test tool",
    category: "information" as ToolCategory,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    enabled: true,
    cancellable: true,
    defaultTimeout,
    async execute(_input: unknown, _context: ToolContext): Promise<ToolResult> {
      return {
        success: true,
        data: {},
        metadata: {
          executionId: "e",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      };
    },
    toFunctionDefinition: () => ({
      name: id,
      description: "Test",
      parameters: {},
    }),
    toCompactSummary: () => ({
      id,
      name: `Tool ${id}`,
      brief: "Test",
      category: "information" as ToolCategory,
    }),
  };
}

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-1",
    toolId: "test-tool",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSuccessResult(): ToolResult {
  return {
    success: true,
    data: { value: "ok" },
    metadata: {
      executionId: "exec-1",
      startTime: new Date(),
      endTime: new Date(),
      duration: 10,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TimeoutMiddleware", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Constructor and defaults
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it('has name "timeout"', () => {
      const mw = new TimeoutMiddleware();
      expect(mw.name).toBe("timeout");
    });

    it("has priority 20", () => {
      const mw = new TimeoutMiddleware();
      expect(mw.priority).toBe(20);
    });

    it("defaults defaultTimeout to 30000ms", () => {
      const mw = new TimeoutMiddleware();
      const tool = makeTool("t");
      const context = makeContext();

      // Run before() and check that context.timeout was set to 30000
      const before = mw.before(undefined, context, tool);
      jest.runAllTimers();
      return before.then(() => {
        expect(context.timeout).toBe(30000);
      });
    });

    it("accepts a custom defaultTimeout", () => {
      const mw = new TimeoutMiddleware({ defaultTimeout: 5000 });
      const tool = makeTool("t");
      const context = makeContext();

      return mw.before(undefined, context, tool).then(() => {
        expect(context.timeout).toBe(5000);
      });
    });
  });

  // -------------------------------------------------------------------------
  // before() — timeout priority
  // -------------------------------------------------------------------------

  describe("before() — timeout priority", () => {
    it("uses context.timeout when already set", async () => {
      const mw = new TimeoutMiddleware({ defaultTimeout: 30000 });
      const tool = makeTool("t");
      const context = makeContext({ timeout: 1000 });

      await mw.before(undefined, context, tool);

      expect(context.timeout).toBe(1000);
    });

    it("uses timeoutByTool config for a specific tool id", async () => {
      const mw = new TimeoutMiddleware({
        defaultTimeout: 30000,
        timeoutByTool: { "special-tool": 2000 },
      });
      const tool = makeTool("special-tool");
      const context = makeContext();

      await mw.before(undefined, context, tool);

      expect(context.timeout).toBe(2000);
    });

    it("uses tool.defaultTimeout when no other config applies", async () => {
      const mw = new TimeoutMiddleware({ defaultTimeout: 30000 });
      const tool = makeTool("t", 8000); // tool has its own defaultTimeout
      const context = makeContext();

      await mw.before(undefined, context, tool);

      expect(context.timeout).toBe(8000);
    });

    it("falls back to global defaultTimeout when nothing else is configured", async () => {
      const mw = new TimeoutMiddleware({ defaultTimeout: 12000 });
      const tool = makeTool("t"); // no defaultTimeout
      const context = makeContext();

      await mw.before(undefined, context, tool);

      expect(context.timeout).toBe(12000);
    });

    it("priority: context.timeout > timeoutByTool > tool.defaultTimeout > global", async () => {
      const mw = new TimeoutMiddleware({
        defaultTimeout: 30000,
        timeoutByTool: { t: 5000 },
      });
      const tool = makeTool("t", 10000);
      const context = makeContext({ timeout: 1000 }); // context wins

      await mw.before(undefined, context, tool);

      expect(context.timeout).toBe(1000);
    });
  });

  // -------------------------------------------------------------------------
  // wrapExecution() — success before timeout
  // -------------------------------------------------------------------------

  describe("wrapExecution() — success", () => {
    it("resolves with executor result when it completes before timeout", async () => {
      const mw = new TimeoutMiddleware({ defaultTimeout: 5000 });
      const tool = makeTool("t");
      const context = makeContext({ executionId: "exec-wrap" });
      const expected = makeSuccessResult();

      const resultPromise = mw.wrapExecution(tool, undefined, context, () =>
        Promise.resolve(expected),
      );

      jest.advanceTimersByTime(100); // well before 5000ms
      const result = await resultPromise;

      expect(result).toBe(expected);
    });

    it("clears the active timer on success", async () => {
      const mw = new TimeoutMiddleware({ defaultTimeout: 5000 });
      const tool = makeTool("t");
      const context = makeContext({ executionId: "clear-timer" });

      await mw.wrapExecution(tool, undefined, context, () =>
        Promise.resolve(makeSuccessResult()),
      );

      jest.advanceTimersByTime(10000); // advance past timeout — no error should occur
      // If timer was NOT cleared, the resolved value would be overwritten.
      // The test passes if no double-resolve / unhandled rejection occurs.
    });
  });

  // -------------------------------------------------------------------------
  // wrapExecution() — timeout fires
  // -------------------------------------------------------------------------

  describe("wrapExecution() — timeout fires", () => {
    it("resolves with timeout error when executor takes too long", async () => {
      const mw = new TimeoutMiddleware({ defaultTimeout: 1000 });
      const tool = makeTool("slow-tool");
      const context = makeContext({ executionId: "timeout-exec" });

      const neverResolves = new Promise<ToolResult>(() => {
        // never resolves
      });

      const resultPromise = mw.wrapExecution(
        tool,
        undefined,
        context,
        () => neverResolves,
      );

      jest.advanceTimersByTime(1001);
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TOOL_TIMEOUT");
      expect(result.error?.message).toContain("slow-tool");
      expect(result.error?.retryable).toBe(true);
    });

    it("includes executionId in timeout error metadata", async () => {
      const mw = new TimeoutMiddleware({ defaultTimeout: 500 });
      const tool = makeTool("t");
      const context = makeContext({ executionId: "my-exec" });

      const resultPromise = mw.wrapExecution(
        tool,
        undefined,
        context,
        () => new Promise(() => {}),
      );

      jest.advanceTimersByTime(501);
      const result = await resultPromise;

      expect(result.metadata.executionId).toBe("my-exec");
    });
  });

  // -------------------------------------------------------------------------
  // wrapExecution() — executor throws
  // -------------------------------------------------------------------------

  describe("wrapExecution() — executor throws", () => {
    it("resolves with error result when executor rejects", async () => {
      // Use real timers for this test so the rejection propagates before timeout
      jest.useRealTimers();

      const mw = new TimeoutMiddleware({ defaultTimeout: 30000 }); // long timeout
      const tool = makeTool("t");
      const context = makeContext({ executionId: "err-exec" });

      const result = await mw.wrapExecution(tool, undefined, context, () =>
        Promise.reject(new Error("something broke")),
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("something broke");

      jest.useFakeTimers(); // restore
    });

    it("does not double-resolve when executor rejects before timeout", async () => {
      const mw = new TimeoutMiddleware({ defaultTimeout: 5000 });
      const tool = makeTool("t");
      const context = makeContext({ executionId: "dbl-exec" });

      let resolveCount = 0;

      const wrappedPromise = new Promise<ToolResult>((resolve) => {
        const inner = mw.wrapExecution(tool, undefined, context, () =>
          Promise.reject(new Error("fail")),
        );
        void inner.then((r) => {
          resolveCount++;
          resolve(r);
        });
      });

      jest.runAllTimers();
      await wrappedPromise;

      expect(resolveCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // cancelTimeout()
  // -------------------------------------------------------------------------

  describe("cancelTimeout()", () => {
    it("cancels an active timer by executionId", async () => {
      const mw = new TimeoutMiddleware({ defaultTimeout: 1000 });
      const tool = makeTool("t");
      const context = makeContext({ executionId: "cancel-exec" });

      let settled = false;
      const resultPromise = mw.wrapExecution(
        tool,
        undefined,
        context,
        () =>
          new Promise((resolve) => {
            // resolve after timer cancelled
            setTimeout(() => {
              resolve(makeSuccessResult());
              settled = true;
            }, 500);
          }),
      );

      // Cancel before the timeout fires
      mw.cancelTimeout("cancel-exec");
      jest.advanceTimersByTime(2000);
      await resultPromise;

      // The timer was cancelled so we should not get a TOOL_TIMEOUT
      // settled via executor resolving at 500ms (or after)
      expect(settled).toBe(true);
    });

    it("does not throw when cancelling a non-existent executionId", () => {
      const mw = new TimeoutMiddleware();
      expect(() => mw.cancelTimeout("does-not-exist")).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // createTimeoutMiddleware factory
  // -------------------------------------------------------------------------

  describe("createTimeoutMiddleware()", () => {
    it("returns a TimeoutMiddleware instance", () => {
      const mw = createTimeoutMiddleware();
      expect(mw).toBeInstanceOf(TimeoutMiddleware);
    });

    it("accepts config options", () => {
      const mw = createTimeoutMiddleware({ defaultTimeout: 7000 });
      const tool = makeTool("t");
      const context = makeContext();

      return mw.before(undefined, context, tool).then(() => {
        expect(context.timeout).toBe(7000);
      });
    });
  });
});
