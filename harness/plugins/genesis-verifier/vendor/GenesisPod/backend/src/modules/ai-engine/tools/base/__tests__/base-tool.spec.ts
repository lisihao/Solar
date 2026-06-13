import { BaseTool, createTool } from "../base-tool";
import {
  ToolCategory,
  ToolContext,
  JSONSchema,
} from "../../abstractions/tool.interface";
import { ToolError } from "@/modules/ai-engine/tools/abstractions/tool.error";

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "test-tool",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

const SIMPLE_SCHEMA: JSONSchema = { type: "object", properties: {} };

// ============================================================================
// Concrete implementation of BaseTool for testing
// ============================================================================

class TestTool extends BaseTool<{ value: string }, { result: string }> {
  readonly id = "test-tool";
  readonly name = "Test Tool";
  readonly description = "A test tool for unit testing";
  readonly category: ToolCategory = "processing";
  readonly inputSchema: JSONSchema = SIMPLE_SCHEMA;
  readonly outputSchema: JSONSchema = SIMPLE_SCHEMA;

  // Control the output and error behaviour from test code
  private _shouldThrow: Error | null = null;
  private _returnValue: { result: string } = { result: "ok" };

  setReturnValue(value: { result: string }): void {
    this._returnValue = value;
  }

  setThrowError(error: Error): void {
    this._shouldThrow = error;
  }

  protected async doExecute(
    _input: { value: string },
    _context: ToolContext,
  ): Promise<{ result: string }> {
    if (this._shouldThrow) {
      throw this._shouldThrow;
    }
    return this._returnValue;
  }

  // Expose protected methods for testing
  public exposeCheckCancellation(context: ToolContext): void {
    return this.checkCancellation(context);
  }

  public exposeCreateTimeoutPromise(timeout: number): Promise<never> {
    return this.createTimeoutPromise(timeout);
  }

  public async exposeExecuteWithTimeout<T>(
    promise: Promise<T>,
    timeout: number,
  ): Promise<T> {
    return this.executeWithTimeout(promise, timeout);
  }

  public exposeBuildMetadata(
    executionId: string,
    startTime: Date,
    context: ToolContext,
  ) {
    return this.buildMetadata(executionId, startTime, context);
  }
}

// ============================================================================
// Test suite: BaseTool
// ============================================================================

describe("BaseTool", () => {
  let tool: TestTool;

  beforeEach(() => {
    tool = new TestTool();
  });

  // --------------------------------------------------------------------------
  // Default property values
  // --------------------------------------------------------------------------

  describe("default property values", () => {
    it("should have version 1.0.0 by default", () => {
      expect(tool.version).toBe("1.0.0");
    });

    it("should have empty tags array by default", () => {
      expect(tool.tags).toEqual([]);
    });

    it("should have defaultTimeout of 30000 by default", () => {
      expect(tool.defaultTimeout).toBe(30000);
    });

    it("should be cancellable by default", () => {
      expect(tool.cancellable).toBe(true);
    });

    it("should be enabled by default", () => {
      expect(tool.enabled).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // execute – success path
  // --------------------------------------------------------------------------

  describe("execute", () => {
    it("should return success result when doExecute resolves", async () => {
      tool.setReturnValue({ result: "hello" });
      const ctx = createMockContext();
      const result = await tool.execute({ value: "x" }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ result: "hello" });
      expect(result.error).toBeUndefined();
    });

    it("should include metadata in the success result", async () => {
      const ctx = createMockContext({ executionId: "exec-42" });
      const result = await tool.execute({ value: "x" }, ctx);

      expect(result.metadata).toBeDefined();
      expect(result.metadata.executionId).toBe("exec-42");
      expect(result.metadata.startTime).toBeInstanceOf(Date);
      expect(result.metadata.endTime).toBeInstanceOf(Date);
      expect(typeof result.metadata.duration).toBe("number");
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it("should generate executionId via uuid when context does not provide one", async () => {
      const ctx = createMockContext({ executionId: "" });
      const result = await tool.execute({ value: "x" }, ctx);

      // uuid-generated id is a non-empty string
      expect(result.metadata.executionId).toBeTruthy();
    });

    it("should propagate retryCount from context into metadata", async () => {
      const ctx = createMockContext({ retryCount: 3 });
      const result = await tool.execute({ value: "x" }, ctx);

      expect(result.metadata.retryCount).toBe(3);
    });

    // ---- cancellation path ----

    it("should return failure result when AbortSignal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const ctx = createMockContext({ signal: controller.signal });

      const result = await tool.execute({ value: "x" }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe("TOOL_3002");
    });

    it("should not call doExecute when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const ctx = createMockContext({ signal: controller.signal });
      const spy = jest.spyOn(
        tool as unknown as { doExecute: jest.Mock },
        "doExecute",
      );

      await tool.execute({ value: "x" }, ctx);

      expect(spy).not.toHaveBeenCalled();
    });

    // ---- error path ----

    it("should return failure result when doExecute throws a generic Error", async () => {
      tool.setThrowError(new Error("something broke"));
      const ctx = createMockContext();
      const result = await tool.execute({ value: "x" }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toBe("something broke");
    });

    it("should return failure result when doExecute throws a ToolError", async () => {
      tool.setThrowError(
        ToolError.executionFailed("test-tool", "custom reason"),
      );
      const ctx = createMockContext();
      const result = await tool.execute({ value: "x" }, ctx);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("TOOL_3000");
    });

    it("should include metadata even in the failure result", async () => {
      tool.setThrowError(new Error("oops"));
      const ctx = createMockContext();
      const result = await tool.execute({ value: "x" }, ctx);

      expect(result.metadata).toBeDefined();
      expect(result.metadata.startTime).toBeInstanceOf(Date);
    });

    it("should expose retryable flag from the underlying ToolError", async () => {
      tool.setThrowError(ToolError.timeout("test-tool", 1000));
      const ctx = createMockContext();
      const result = await tool.execute({ value: "x" }, ctx);

      expect(result.error!.retryable).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return { valid: true } by default", () => {
      const validation = tool.validateInput({ value: "any" });
      expect(validation).toEqual({ valid: true });
    });

    it("should accept any input without throwing", () => {
      expect(() => tool.validateInput({ value: "" })).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // toFunctionDefinition
  // --------------------------------------------------------------------------

  describe("toFunctionDefinition", () => {
    it("should return a FunctionDefinition with name equal to tool id", () => {
      const def = tool.toFunctionDefinition();
      expect(def.name).toBe(tool.id);
    });

    it("should return description matching the tool description", () => {
      const def = tool.toFunctionDefinition();
      expect(def.description).toBe(tool.description);
    });

    it("should return inputSchema as parameters", () => {
      const def = tool.toFunctionDefinition();
      expect(def.parameters).toEqual(tool.inputSchema);
    });
  });

  // --------------------------------------------------------------------------
  // toCompactSummary
  // --------------------------------------------------------------------------

  describe("toCompactSummary", () => {
    it("should return summary with id, name, category", () => {
      const summary = tool.toCompactSummary();
      expect(summary.id).toBe(tool.id);
      expect(summary.name).toBe(tool.name);
      expect(summary.category).toBe(tool.category);
    });

    it("should not truncate descriptions shorter than or equal to 100 characters", () => {
      const summary = tool.toCompactSummary();
      expect(summary.brief).toBe(tool.description);
    });

    it("should truncate descriptions longer than 100 characters and append '...'", () => {
      class LongDescTool extends TestTool {
        override readonly description: string = "A".repeat(101);
      }
      const longTool = new LongDescTool();
      const summary = longTool.toCompactSummary();

      expect(summary.brief.length).toBe(100);
      expect(summary.brief.endsWith("...")).toBe(true);
    });

    it("should set tags to undefined when tags array is empty", () => {
      const summary = tool.toCompactSummary();
      expect(summary.tags).toBeUndefined();
    });

    it("should include tags when they are present", () => {
      class TaggedTool extends TestTool {
        override readonly tags = ["alpha", "beta"];
      }
      const taggedTool = new TaggedTool();
      const summary = taggedTool.toCompactSummary();

      expect(summary.tags).toEqual(["alpha", "beta"]);
    });
  });

  // --------------------------------------------------------------------------
  // buildMetadata (protected, exposed via wrapper)
  // --------------------------------------------------------------------------

  describe("buildMetadata", () => {
    it("should build metadata with correct executionId", () => {
      const startTime = new Date();
      const ctx = createMockContext({ retryCount: 2 });
      const meta = tool.exposeBuildMetadata("exec-99", startTime, ctx);

      expect(meta.executionId).toBe("exec-99");
    });

    it("should set startTime as provided", () => {
      const startTime = new Date(2024, 0, 1);
      const ctx = createMockContext();
      const meta = tool.exposeBuildMetadata("exec-1", startTime, ctx);

      expect(meta.startTime).toBe(startTime);
    });

    it("should calculate duration as a non-negative number", () => {
      const startTime = new Date();
      const ctx = createMockContext();
      const meta = tool.exposeBuildMetadata("exec-1", startTime, ctx);

      expect(meta.duration).toBeGreaterThanOrEqual(0);
    });

    it("should include retryCount from context", () => {
      const ctx = createMockContext({ retryCount: 5 });
      const meta = tool.exposeBuildMetadata("exec-1", new Date(), ctx);

      expect(meta.retryCount).toBe(5);
    });

    it("should set retryCount to undefined when not provided", () => {
      const ctx = createMockContext();
      const meta = tool.exposeBuildMetadata("exec-1", new Date(), ctx);

      expect(meta.retryCount).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // checkCancellation (protected, exposed via wrapper)
  // --------------------------------------------------------------------------

  describe("checkCancellation", () => {
    it("should not throw when signal is not aborted", () => {
      const controller = new AbortController();
      const ctx = createMockContext({ signal: controller.signal });
      expect(() => tool.exposeCheckCancellation(ctx)).not.toThrow();
    });

    it("should throw ToolError.cancelled when signal is aborted", () => {
      const controller = new AbortController();
      controller.abort();
      const ctx = createMockContext({ signal: controller.signal });
      expect(() => tool.exposeCheckCancellation(ctx)).toThrow(ToolError);
    });

    it("should not throw when no signal is provided", () => {
      const ctx = createMockContext();
      expect(() => tool.exposeCheckCancellation(ctx)).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // createTimeoutPromise (protected, exposed via wrapper)
  // --------------------------------------------------------------------------

  describe("createTimeoutPromise", () => {
    it("should return a promise that rejects after the given timeout", async () => {
      const promise = tool.exposeCreateTimeoutPromise(50);
      await expect(promise).rejects.toThrow(ToolError);
    }, 1000);

    it("should reject with a ToolError containing TIMEOUT code", async () => {
      const promise = tool.exposeCreateTimeoutPromise(50);
      try {
        await promise;
        fail("Expected rejection");
      } catch (err) {
        expect(err).toBeInstanceOf(ToolError);
        expect((err as ToolError).code).toBe("TOOL_3001");
      }
    }, 1000);
  });

  // --------------------------------------------------------------------------
  // executeWithTimeout (protected, exposed via wrapper)
  // --------------------------------------------------------------------------

  describe("executeWithTimeout", () => {
    it("should resolve with the promise value when it completes before timeout", async () => {
      const fastPromise = Promise.resolve("fast-result");
      const result = await tool.exposeExecuteWithTimeout(fastPromise, 5000);
      expect(result).toBe("fast-result");
    });

    it("should reject with a ToolError when promise takes longer than timeout", async () => {
      const slowPromise = new Promise<string>((resolve) =>
        setTimeout(() => resolve("slow"), 500),
      );
      await expect(
        tool.exposeExecuteWithTimeout(slowPromise, 50),
      ).rejects.toBeInstanceOf(ToolError);
    }, 2000);

    it("should reject with TIMEOUT code when timed out", async () => {
      const slowPromise = new Promise<string>((resolve) =>
        setTimeout(() => resolve("slow"), 500),
      );
      try {
        await tool.exposeExecuteWithTimeout(slowPromise, 50);
        fail("Expected rejection");
      } catch (err) {
        expect((err as ToolError).code).toBe("TOOL_3001");
      }
    }, 2000);
  });
});

// ============================================================================
// Test suite: createTool factory
// ============================================================================

describe("createTool", () => {
  const baseOptions = {
    id: "factory-tool" as const,
    name: "Factory Tool",
    description: "Created via factory",
    category: "generation" as ToolCategory,
    inputSchema: SIMPLE_SCHEMA,
    outputSchema: SIMPLE_SCHEMA,
    execute: async (_input: { query: string }, _ctx: ToolContext) => ({
      answer: "42",
    }),
  };

  it("should create a tool with the specified id, name, description, and category", () => {
    const tool = createTool(baseOptions);
    expect(tool.id).toBe("factory-tool");
    expect(tool.name).toBe("Factory Tool");
    expect(tool.description).toBe("Created via factory");
    expect(tool.category).toBe("generation");
  });

  it("should set defaultTimeout to 30000 when not specified", () => {
    const tool = createTool(baseOptions);
    expect(tool.defaultTimeout).toBe(30000);
  });

  it("should use provided defaultTimeout", () => {
    const tool = createTool({ ...baseOptions, defaultTimeout: 5000 });
    expect(tool.defaultTimeout).toBe(5000);
  });

  it("should set cancellable to true", () => {
    const tool = createTool(baseOptions);
    expect(tool.cancellable).toBe(true);
  });

  it("should set enabled to true", () => {
    const tool = createTool(baseOptions);
    expect(tool.enabled).toBe(true);
  });

  it("should include tags when provided", () => {
    const tool = createTool({ ...baseOptions, tags: ["search", "info"] });
    expect(tool.tags).toEqual(["search", "info"]);
  });

  it("should execute and return success result", async () => {
    const tool = createTool(baseOptions);
    const ctx = createMockContext();
    const result = await tool.execute({ query: "test" }, ctx);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ answer: "42" });
  });

  it("should include metadata in execute result", async () => {
    const tool = createTool(baseOptions);
    const ctx = createMockContext({ executionId: "exec-factory" });
    const result = await tool.execute({ query: "test" }, ctx);

    expect(result.metadata.executionId).toBe("exec-factory");
    expect(result.metadata.startTime).toBeInstanceOf(Date);
    expect(result.metadata.endTime).toBeInstanceOf(Date);
    expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
  });

  it("should return failure result when execute function throws", async () => {
    const failingTool = createTool({
      ...baseOptions,
      execute: async () => {
        throw new Error("factory error");
      },
    });
    const ctx = createMockContext();
    const result = await failingTool.execute({ query: "test" }, ctx);

    expect(result.success).toBe(false);
    expect(result.error!.message).toBe("factory error");
  });

  it("should use default validateInput that returns { valid: true } when no validate provided", () => {
    const tool = createTool(baseOptions);
    const validation = tool.validateInput!({ query: "any" });
    expect(validation).toEqual({ valid: true });
  });

  it("should use provided validate function", () => {
    const tool = createTool({
      ...baseOptions,
      validate: (_input: { query: string }) => ({
        valid: false,
        errors: [{ message: "bad" }],
      }),
    });
    const validation = tool.validateInput!({ query: "any" });
    expect(validation).toEqual({ valid: false, errors: [{ message: "bad" }] });
  });

  it("should generate correct FunctionDefinition via toFunctionDefinition", () => {
    const tool = createTool(baseOptions);
    const def = tool.toFunctionDefinition();

    expect(def.name).toBe("factory-tool");
    expect(def.description).toBe("Created via factory");
    expect(def.parameters).toEqual(SIMPLE_SCHEMA);
  });

  it("should generate correct CompactToolSummary via toCompactSummary", () => {
    const tool = createTool(baseOptions);
    const summary = tool.toCompactSummary();

    expect(summary.id).toBe("factory-tool");
    expect(summary.name).toBe("Factory Tool");
    expect(summary.category).toBe("generation");
    expect(summary.brief).toBe("Created via factory");
  });

  it("should truncate description in compact summary when it exceeds 100 chars", () => {
    const longDesc = "B".repeat(120);
    const tool = createTool({ ...baseOptions, description: longDesc });
    const summary = tool.toCompactSummary();

    expect(summary.brief.length).toBe(100);
    expect(summary.brief.endsWith("...")).toBe(true);
  });
});

