/**
 * Tests for ToolPipeline and ToolExecutor
 */

import {
  ToolPipeline,
  ToolExecutor,
  createDefaultPipeline,
} from "../tool-pipeline";
import { IToolMiddleware } from "../middleware.interface";
import {
  ITool,
  ToolContext,
  ToolResult,
  ToolCategory,
} from "../../abstractions/tool.interface";
import { ToolResultCacheService } from "../../cache/tool-result-cache.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockTool(overrides: Partial<ITool> = {}): ITool {
  return {
    id: "test-tool",
    name: "Test Tool",
    description: "A test tool",
    category: "information" as ToolCategory,
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    outputSchema: { type: "object" },
    enabled: true,
    cancellable: true,
    defaultTimeout: 5000,
    async execute(_input, _context) {
      return {
        success: true,
        data: { result: "ok" },
        metadata: {
          executionId: "exec-1",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      };
    },
    validateInput: () => ({ valid: true }),
    toFunctionDefinition() {
      return { name: "test-tool", description: "A test tool", parameters: {} };
    },
    toCompactSummary() {
      return {
        id: "test-tool",
        name: "Test Tool",
        brief: "A test tool",
        category: "information" as ToolCategory,
      };
    },
    ...overrides,
  };
}

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-123",
    toolId: "test-tool",
    userId: "user-1",
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockMiddleware(
  name: string,
  priority: number,
  overrides: Partial<IToolMiddleware> = {},
): IToolMiddleware {
  return {
    name,
    priority,
    before: jest.fn(),
    after: jest.fn(async (result) => result),
    onError: jest.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ToolPipeline
// ---------------------------------------------------------------------------

describe("ToolPipeline", () => {
  let pipeline: ToolPipeline;

  beforeEach(() => {
    pipeline = new ToolPipeline();
  });

  // -------------------------------------------------------------------------
  // use() — adds and sorts by priority
  // -------------------------------------------------------------------------

  describe("use()", () => {
    it("adds a single middleware", () => {
      const mw = createMockMiddleware("mw-a", 50);
      pipeline.use(mw);
      expect(pipeline.getAll()).toHaveLength(1);
      expect(pipeline.getAll()[0]).toBe(mw);
    });

    it("sorts middlewares by priority ascending", () => {
      const mwHigh = createMockMiddleware("mw-high", 10);
      const mwLow = createMockMiddleware("mw-low", 100);
      const mwMid = createMockMiddleware("mw-mid", 50);

      pipeline.use(mwLow).use(mwHigh).use(mwMid);

      const all = pipeline.getAll();
      expect(all[0]).toBe(mwHigh);
      expect(all[1]).toBe(mwMid);
      expect(all[2]).toBe(mwLow);
    });

    it("returns this for chaining", () => {
      const mw = createMockMiddleware("mw", 10);
      const ret = pipeline.use(mw);
      expect(ret).toBe(pipeline);
    });

    it("treats undefined priority as 100", () => {
      const mwNoPriority: IToolMiddleware = { name: "no-priority" };
      const mwPriority50 = createMockMiddleware("mw-50", 50);

      pipeline.use(mwNoPriority).use(mwPriority50);

      const all = pipeline.getAll();
      expect(all[0]).toBe(mwPriority50);
      expect(all[1]).toBe(mwNoPriority);
    });
  });

  // -------------------------------------------------------------------------
  // remove()
  // -------------------------------------------------------------------------

  describe("remove()", () => {
    it("removes an existing middleware and returns true", () => {
      const mw = createMockMiddleware("target", 10);
      pipeline.use(mw);

      const result = pipeline.remove("target");

      expect(result).toBe(true);
      expect(pipeline.getAll()).toHaveLength(0);
    });

    it("returns false when middleware name does not exist", () => {
      const result = pipeline.remove("nonexistent");
      expect(result).toBe(false);
    });

    it("only removes the matched middleware, leaving others intact", () => {
      const mwA = createMockMiddleware("mw-a", 10);
      const mwB = createMockMiddleware("mw-b", 20);
      pipeline.use(mwA).use(mwB);

      pipeline.remove("mw-a");

      const all = pipeline.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]).toBe(mwB);
    });
  });

  // -------------------------------------------------------------------------
  // getAll() — returns a copy
  // -------------------------------------------------------------------------

  describe("getAll()", () => {
    it("returns a copy, not the internal array", () => {
      const mw = createMockMiddleware("mw", 10);
      pipeline.use(mw);

      const copy = pipeline.getAll();
      copy.pop();

      expect(pipeline.getAll()).toHaveLength(1);
    });

    it("returns empty array when no middlewares", () => {
      expect(pipeline.getAll()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // execute() — happy path
  // -------------------------------------------------------------------------

  describe("execute() — success path", () => {
    it("calls before → tool.execute → after (reverse) in order", async () => {
      const callOrder: string[] = [];

      const mwA = createMockMiddleware("mw-a", 10, {
        before: jest.fn(async () => {
          callOrder.push("before-a");
        }),
        after: jest.fn(async (r) => {
          callOrder.push("after-a");
          return r;
        }),
      });
      const mwB = createMockMiddleware("mw-b", 20, {
        before: jest.fn(async () => {
          callOrder.push("before-b");
        }),
        after: jest.fn(async (r) => {
          callOrder.push("after-b");
          return r;
        }),
      });

      const tool = createMockTool({
        execute: jest.fn(async () => {
          callOrder.push("tool");
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
        }),
      });

      pipeline.use(mwA).use(mwB);
      await pipeline.execute(tool, {}, createMockContext());

      expect(callOrder).toEqual([
        "before-a",
        "before-b",
        "tool",
        "after-b",
        "after-a",
      ]);
    });

    it("returns the result from tool.execute when no middleware modifies it", async () => {
      const expectedData = { answer: 42 };
      const tool = createMockTool({
        execute: jest.fn(async () => ({
          success: true,
          data: expectedData,
          metadata: {
            executionId: "e",
            startTime: new Date(),
            endTime: new Date(),
            duration: 0,
          },
        })),
      });

      const result = await pipeline.execute(tool, {}, createMockContext());
      expect(result.success).toBe(true);
      expect(result.data).toEqual(expectedData);
    });

    it("works with no middlewares registered", async () => {
      const tool = createMockTool();
      const result = await pipeline.execute(
        tool,
        { query: "hello" },
        createMockContext(),
      );
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // execute() — before can modify input
  // -------------------------------------------------------------------------

  describe("execute() — before middleware modifies input", () => {
    it("passes the modified input to the next middleware and tool", async () => {
      const capturedInputs: unknown[] = [];

      const mwA = createMockMiddleware("mw-a", 10, {
        before: jest.fn(async (input) => {
          capturedInputs.push(input);
          return { ...(input as object), extra: "added-by-a" };
        }),
      });
      const mwB = createMockMiddleware("mw-b", 20, {
        before: jest.fn(async (input) => {
          capturedInputs.push(input);
        }),
      });

      const tool = createMockTool({
        execute: jest.fn(async (input) => {
          capturedInputs.push(input);
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
        }),
      });

      pipeline.use(mwA).use(mwB);
      await pipeline.execute(tool, { original: true }, createMockContext());

      expect(capturedInputs[0]).toEqual({ original: true });
      expect(capturedInputs[1]).toEqual({
        original: true,
        extra: "added-by-a",
      });
      expect(capturedInputs[2]).toEqual({
        original: true,
        extra: "added-by-a",
      });
    });

    it("does not replace input when before returns undefined", async () => {
      const capturedByTool: unknown[] = [];

      const mw = createMockMiddleware("mw", 10, {
        before: jest.fn(async () => undefined),
      });

      const originalInput = { keep: "me" };
      const tool = createMockTool({
        execute: jest.fn(async (input) => {
          capturedByTool.push(input);
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
        }),
      });

      pipeline.use(mw);
      await pipeline.execute(tool, originalInput, createMockContext());

      expect(capturedByTool[0]).toEqual(originalInput);
    });
  });

  // -------------------------------------------------------------------------
  // execute() — executionId auto-assigned
  // -------------------------------------------------------------------------

  describe("execute() — executionId", () => {
    it("assigns a new executionId when context has none", async () => {
      const context = createMockContext({ executionId: "" });
      const tool = createMockTool();

      await pipeline.execute(tool, {}, context);

      expect(context.executionId).toBeTruthy();
      expect(typeof context.executionId).toBe("string");
    });

    it("preserves existing executionId when context already has one", async () => {
      const context = createMockContext({ executionId: "existing-id" });
      const tool = createMockTool();

      await pipeline.execute(tool, {}, context);

      expect(context.executionId).toBe("existing-id");
    });
  });

  // -------------------------------------------------------------------------
  // execute() — error path with recovery
  // -------------------------------------------------------------------------

  describe("execute() — error recovery via onError", () => {
    it("calls onError on all middlewares when tool throws", async () => {
      const mwA = createMockMiddleware("mw-a", 10, {
        onError: jest.fn(async () => undefined),
      });
      const mwB = createMockMiddleware("mw-b", 20, {
        onError: jest.fn(async () => undefined),
      });

      const tool = createMockTool({
        execute: jest.fn(async () => {
          throw new Error("boom");
        }),
      });

      pipeline.use(mwA).use(mwB);
      await pipeline.execute(tool, {}, createMockContext());

      expect(mwA.onError).toHaveBeenCalled();
      expect(mwB.onError).toHaveBeenCalled();
    });

    it("returns recovery result from first middleware that provides one", async () => {
      const recovery: ToolResult = {
        success: true,
        data: { recovered: true },
        metadata: {
          executionId: "r",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      };

      const mwA = createMockMiddleware("mw-a", 10, {
        onError: jest.fn(async () => recovery),
      });
      const mwB = createMockMiddleware("mw-b", 20, {
        onError: jest.fn(async () => undefined),
      });

      const tool = createMockTool({
        execute: jest.fn(async () => {
          throw new Error("boom");
        }),
      });

      pipeline.use(mwA).use(mwB);
      const result = await pipeline.execute(tool, {}, createMockContext());

      expect(result).toBe(recovery);
      // mw-b should not be called once mw-a recovered
      expect(mwB.onError).not.toHaveBeenCalled();
    });

    it("wraps error into ToolError result when no middleware provides recovery", async () => {
      const tool = createMockTool({
        id: "failing-tool",
        execute: jest.fn(async () => {
          throw new Error("unexpected");
        }),
      });

      const result = await pipeline.execute(tool, {}, createMockContext());

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBeTruthy();
      expect(result.error!.message).toBeTruthy();
      expect(result.metadata).toBeDefined();
    });

    it("wraps error result includes executionId in metadata", async () => {
      const context = createMockContext({ executionId: "err-exec-id" });
      const tool = createMockTool({
        execute: jest.fn(async () => {
          throw new Error("fail");
        }),
      });

      const result = await pipeline.execute(tool, {}, context);

      expect(result.metadata.executionId).toBe("err-exec-id");
    });
  });
});

// ---------------------------------------------------------------------------
// ToolExecutor
// ---------------------------------------------------------------------------

describe("ToolExecutor", () => {
  it("creates a context with executionId, toolId, createdAt and calls pipeline.execute", async () => {
    const mockPipeline = {
      execute: jest.fn(async (_tool, _input, context: ToolContext) => ({
        success: true,
        data: {},
        metadata: {
          executionId: context.executionId,
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      })),
    } as unknown as ToolPipeline;

    const executor = new ToolExecutor(mockPipeline);
    const tool = createMockTool({ id: "my-tool" });
    const input = { query: "test" };

    await executor.execute(tool, input);

    expect(mockPipeline.execute).toHaveBeenCalledTimes(1);

    const [calledTool, calledInput, calledContext] = (
      mockPipeline.execute as jest.Mock
    ).mock.calls[0];
    expect(calledTool).toBe(tool);
    expect(calledInput).toEqual(input);
    expect(calledContext.toolId).toBe("my-tool");
    expect(calledContext.executionId).toBeTruthy();
    expect(calledContext.createdAt).toBeInstanceOf(Date);
  });

  it("merges options into context", async () => {
    const mockPipeline = {
      execute: jest.fn(async (_tool, _input, context: ToolContext) => ({
        success: true,
        data: {},
        metadata: {
          executionId: context.executionId,
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      })),
    } as unknown as ToolPipeline;

    const executor = new ToolExecutor(mockPipeline);
    const tool = createMockTool();

    await executor.execute(tool, {}, {
      userId: "user-42",
      sessionId: "sess-1",
    } as Partial<ToolContext>);

    const [, , calledContext] = (mockPipeline.execute as jest.Mock).mock
      .calls[0];
    expect(calledContext.userId).toBe("user-42");
    expect(calledContext.sessionId).toBe("sess-1");
  });

  it("returns the pipeline result", async () => {
    const expectedResult: ToolResult = {
      success: true,
      data: { value: 99 },
      metadata: {
        executionId: "x",
        startTime: new Date(),
        endTime: new Date(),
        duration: 5,
      },
    };

    const mockPipeline = {
      execute: jest.fn(async () => expectedResult),
    } as unknown as ToolPipeline;

    const executor = new ToolExecutor(mockPipeline);
    const tool = createMockTool();

    const result = await executor.execute(tool, {});
    expect(result).toBe(expectedResult);
  });
});

// ---------------------------------------------------------------------------
// createDefaultPipeline
// ---------------------------------------------------------------------------

describe("createDefaultPipeline()", () => {
  it("returns a ToolPipeline instance", () => {
    const pipeline = createDefaultPipeline();
    expect(pipeline).toBeInstanceOf(ToolPipeline);
  });

  it("returns a pipeline with no middlewares by default", () => {
    const pipeline = createDefaultPipeline();
    expect(pipeline.getAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ToolPipeline — cache integration
// ---------------------------------------------------------------------------

describe("ToolPipeline — cache integration", () => {
  function createMockCacheService(
    cachedValue: ToolResult | null,
  ): ToolResultCacheService {
    return {
      isCacheable: jest.fn().mockReturnValue(true),
      buildKey: jest.fn().mockReturnValue("tool:result:m:tool:abc123"),
      tryGet: jest.fn().mockResolvedValue(cachedValue),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as ToolResultCacheService;
  }

  it("returns cached result and does NOT call tool.execute on a cache hit", async () => {
    const cachedResult: ToolResult = {
      success: true,
      data: { from: "cache" },
      metadata: {
        executionId: "cached-exec",
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
      },
    };

    const mockCache = createMockCacheService(cachedResult);
    const pipeline = new ToolPipeline(mockCache);

    const executeFn = jest.fn();
    const tool = createMockTool({ sideEffect: "none", execute: executeFn });
    const context = createMockContext({
      metadata: { missionId: "mission-1" },
    });

    const result = await pipeline.execute(tool, { q: "hello" }, context);

    // tool.execute must not be called
    expect(executeFn).not.toHaveBeenCalled();
    // result data comes from cache
    expect(result.data).toEqual({ from: "cache" });
    // fromCache flag is set
    expect(result.metadata.extra?.fromCache).toBe(true);
  });

  it("calls tool.execute and writes to cache on a cache miss", async () => {
    const mockCache = createMockCacheService(null); // null = cache miss
    const pipeline = new ToolPipeline(mockCache);

    const freshResult: ToolResult = {
      success: true,
      data: { fresh: true },
      metadata: {
        executionId: "fresh-exec",
        startTime: new Date(),
        endTime: new Date(),
        duration: 10,
      },
    };

    const executeFn = jest.fn().mockResolvedValue(freshResult);
    const tool = createMockTool({ sideEffect: "none", execute: executeFn });
    const context = createMockContext({
      metadata: { missionId: "mission-2" },
    });

    const result = await pipeline.execute(tool, { q: "world" }, context);

    expect(executeFn).toHaveBeenCalledTimes(1);
    expect(result.data).toEqual({ fresh: true });
    expect(mockCache.set).toHaveBeenCalledWith(
      "tool:result:m:tool:abc123",
      freshResult,
    );
  });

  it("does not cache when isCacheable returns false", async () => {
    const mockCache = {
      isCacheable: jest.fn().mockReturnValue(false),
      buildKey: jest.fn(),
      tryGet: jest.fn(),
      set: jest.fn(),
    } as unknown as ToolResultCacheService;

    const pipeline = new ToolPipeline(mockCache);
    const tool = createMockTool({ sideEffect: "destructive" });
    const context = createMockContext();

    await pipeline.execute(tool, {}, context);

    expect(mockCache.tryGet).not.toHaveBeenCalled();
    expect(mockCache.set).not.toHaveBeenCalled();
  });
});
