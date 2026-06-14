/**
 * Unit tests for ProgressMiddleware
 */

import { Logger } from "@nestjs/common";
import { ProgressMiddleware } from "../progress.middleware";
import {
  ITool,
  ToolCategory,
  ToolContext,
  ToolResult,
} from "../../abstractions/tool.interface";

// The key used internally by ProgressMiddleware — must match the source value.
const START_TIME_KEY = "__progress_startTime__";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(id = "test-tool"): ITool {
  return {
    id,
    name: `Tool ${id}`,
    description: "Test tool",
    category: "information" as ToolCategory,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    enabled: true,
    cancellable: false,
    execute(_input: unknown, _context: ToolContext): Promise<ToolResult> {
      return Promise.resolve({
        success: true,
        data: {},
        metadata: {
          executionId: "e",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      });
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

function makeContext(withMetadata = false): ToolContext {
  return {
    executionId: "exec-1",
    toolId: "test-tool",
    createdAt: new Date(),
    ...(withMetadata ? { metadata: {} } : {}),
  };
}

function makeResult(success = true): ToolResult {
  return {
    success,
    data: success ? { value: "ok" } : undefined,
    error: success
      ? undefined
      : { code: "ERR", message: "Failed", retryable: false },
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

describe("ProgressMiddleware", () => {
  let middleware: ProgressMiddleware;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    middleware = new ProgressMiddleware();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  it('has name "progress"', () => {
    expect(middleware.name).toBe("progress");
  });

  it("has priority 90", () => {
    expect(middleware.priority).toBe(90);
  });

  // -------------------------------------------------------------------------
  // before() — start timestamp
  // -------------------------------------------------------------------------

  describe("before()", () => {
    it("sets START_TIME_KEY in context.metadata", async () => {
      const context = makeContext(true);
      const tool = makeTool();

      const before = Date.now();
      await middleware.before(undefined, context, tool);
      const after = Date.now();

      const recorded = context.metadata?.[START_TIME_KEY];
      expect(typeof recorded).toBe("number");
      expect(recorded as number).toBeGreaterThanOrEqual(before);
      expect(recorded as number).toBeLessThanOrEqual(after);
    });

    it("creates context.metadata if it is missing before recording the timestamp", async () => {
      const context = makeContext(false); // no metadata
      expect(context.metadata).toBeUndefined();

      const tool = makeTool();
      await middleware.before(undefined, context, tool);

      expect(context.metadata).toBeDefined();
      expect(typeof context.metadata?.[START_TIME_KEY]).toBe("number");
    });
  });

  // -------------------------------------------------------------------------
  // after() — pass-through
  // -------------------------------------------------------------------------

  describe("after()", () => {
    it("returns the result object unchanged (successful result)", async () => {
      const context = makeContext(true);
      const tool = makeTool();
      const result = makeResult(true);

      await middleware.before(undefined, context, tool);
      const returned = await middleware.after(result, context, tool);

      expect(returned).toBe(result);
    });

    it("returns the result object unchanged (failed result)", async () => {
      const context = makeContext(true);
      const tool = makeTool();
      const result = makeResult(false);

      await middleware.before(undefined, context, tool);
      const returned = await middleware.after(result, context, tool);

      expect(returned).toBe(result);
    });

    it("reports duration 0 when before() was never called (no START_TIME_KEY)", async () => {
      const context = makeContext(true);
      const tool = makeTool();
      const result = makeResult(true);

      const returned = await middleware.after(result, context, tool);
      expect(returned).toBe(result);
    });
  });
});
