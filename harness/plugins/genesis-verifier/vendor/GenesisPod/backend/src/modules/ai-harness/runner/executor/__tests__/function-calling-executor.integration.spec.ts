/**
 * FunctionCallingExecutor - Extended Coverage Tests
 *
 * Covers branches not hit by the base spec:
 *  - parallel tool execution (parallelToolCalls + ToolConcurrencyService)
 *  - model-fallback on LLM failure
 *  - context compaction branch
 *  - QueryLoop continuation (finishReason === "length")
 *  - checkpoint save per iteration
 *  - resumeFromCheckpoint (success / error paths)
 *  - invalid MCP tool ID format
 *  - executeTool retry failure path (enableRetry=true, retryStrategy returns failure)
 *  - sessionMemorySidecar addEntry / onCompaction paths
 */

import {
  FunctionCallingExecutor,
  ILLMAdapter,
  LLMResponse,
  ToolCallRequest,
  LLMMessage,
  LLMRequestOptions,
  AgentEvent,
  ExecutionConfig,
} from "../function-calling-executor";
import { ToolRegistry } from "../../../../ai-engine/tools/registry";
import {
  ToolContext,
  ToolResult,
  FunctionDefinition,
  ITool,
} from "../../../../ai-engine/tools/abstractions/tool.interface";
import { ToolConcurrencyService } from "../../../../ai-engine/tools/concurrency/tool-concurrency.service";
import { ModelFallbackService } from "../../../../ai-engine/llm/models/selection/model-fallback.service";
import { ContextCompactionPipelineService } from "../../../../ai-engine/planning/context/context-compaction-pipeline.service";
import { QueryLoopService } from "../query-loop.service";
import { ExecutionCheckpointService } from "../execution-checkpoint.service";
import { SessionMemorySidecarService } from "../../../../ai-engine/facade";
import { TokenTrackerService } from "../token-tracker.service";

// ---------------------------------------------------------------------------
// Minimal MockTool
// ---------------------------------------------------------------------------

class MockTool implements ITool {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly description: string,
    private readonly executeResult: ToolResult,
  ) {}

  readonly category = "information" as const;
  readonly inputSchema = { type: "object" as const, properties: {} };
  readonly outputSchema = { type: "object" as const, properties: {} };
  readonly enabled = true;

  async execute(_input: unknown, _context: ToolContext): Promise<ToolResult> {
    return this.executeResult;
  }

  toFunctionDefinition(): FunctionDefinition {
    return {
      name: this.id,
      description: this.description,
      parameters: this.inputSchema,
    };
  }

  toCompactSummary() {
    return {
      id: this.id,
      name: this.name,
      brief: this.description,
      category: this.category,
    };
  }
}

// ---------------------------------------------------------------------------
// MockLLMAdapter
// ---------------------------------------------------------------------------

class MockLLMAdapter implements ILLMAdapter {
  readonly provider = "test";
  private responses: LLMResponse[] = [];
  private idx = 0;

  setResponses(responses: LLMResponse[]) {
    this.responses = responses;
    this.idx = 0;
  }

  formatTools(fns: FunctionDefinition[]): unknown {
    return fns;
  }

  parseToolCalls(response: LLMResponse): ToolCallRequest[] {
    if (!response.tool_calls) return [];
    return response.tool_calls.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));
  }

  buildToolResultMessage(
    toolCallId: string,
    toolName: string,
    result: unknown,
  ): LLMMessage {
    return {
      role: "tool",
      content: JSON.stringify(result),
      tool_call_id: toolCallId,
      name: toolName,
    };
  }

  async chat(_opts: LLMRequestOptions): Promise<LLMResponse> {
    if (this.idx >= this.responses.length)
      throw new Error("No more mock responses");
    return this.responses[this.idx++];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec",
    toolId: "function-calling",
    userId: "user-1",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSuccessResult(data: unknown = { value: "ok" }): ToolResult {
  return {
    success: true,
    data,
    metadata: {
      executionId: "test-exec",
      startTime: new Date(),
      endTime: new Date(),
      duration: 10,
    },
  };
}

function _makeFailureResult(message = "tool failed"): ToolResult {
  return {
    success: false,
    error: { code: "TOOL_ERROR", message },
    metadata: {
      executionId: "test-exec",
      startTime: new Date(),
      endTime: new Date(),
      duration: 10,
    },
  };
}

async function collectEvents(
  gen: AsyncGenerator<AgentEvent>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of gen) {
    events.push(e);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("FunctionCallingExecutor (extended coverage)", () => {
  let mockToolRegistry: jest.Mocked<ToolRegistry>;
  let mockLLMAdapter: MockLLMAdapter;

  beforeEach(() => {
    mockToolRegistry = {
      has: jest.fn().mockReturnValue(false),
      get: jest.fn(),
      getAll: jest.fn().mockReturnValue([]),
      tryGet: jest.fn(),
      register: jest.fn(),
      unregister: jest.fn(),
      clear: jest.fn(),
      size: jest.fn(),
    } as unknown as jest.Mocked<ToolRegistry>;

    mockLLMAdapter = new MockLLMAdapter();
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // Parallel tool execution
  // =========================================================================

  describe("parallel tool calls (parallelToolCalls=true + ToolConcurrencyService)", () => {
    it("should execute tools in parallel groups when parallelToolCalls=true", async () => {
      const mockTool = new MockTool(
        "tool-a",
        "Tool A",
        "desc",
        makeSuccessResult({ parallel: true }),
      );
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(mockTool);

      const mockConcurrency: jest.Mocked<ToolConcurrencyService> = {
        partition: jest.fn().mockReturnValue({
          parallelGroups: [["tool-a"]],
          sequential: [],
        }),
      } as unknown as jest.Mocked<ToolConcurrencyService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockConcurrency,
      );

      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "tool-a", arguments: "{}" },
            },
          ],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "tool_calls",
        },
        {
          content: "Done parallel",
          tool_calls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        },
      ]);

      const config: Partial<ExecutionConfig> = { parallelToolCalls: true };
      const events = await collectEvents(
        executor.execute(
          mockLLMAdapter,
          "sys",
          "user",
          ["tool-a"],
          makeContext(),
          config,
        ),
      );

      expect(mockConcurrency.partition).toHaveBeenCalled();
      const toolResultEvents = events.filter((e) => e.type === "tool_result");
      expect(toolResultEvents.length).toBeGreaterThanOrEqual(1);
      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
    });

    it("should handle rejected parallel tool promises gracefully", async () => {
      const mockTool: ITool = {
        id: "tool-b",
        name: "Tool B",
        description: "desc",
        category: "information" as const,
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: { type: "object" as const, properties: {} },
        enabled: true,
        execute: jest.fn().mockRejectedValue(new Error("parallel rejection")),
        toFunctionDefinition: () => ({
          name: "tool-b",
          description: "desc",
          parameters: { type: "object", properties: {} },
        }),
        toCompactSummary: () => ({
          id: "tool-b",
          name: "Tool B",
          brief: "desc",
          category: "information" as const,
        }),
      };
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(mockTool);

      const mockConcurrency: jest.Mocked<ToolConcurrencyService> = {
        partition: jest.fn().mockReturnValue({
          parallelGroups: [["tool-b"]],
          sequential: [],
        }),
      } as unknown as jest.Mocked<ToolConcurrencyService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockConcurrency,
      );

      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "tool-b", arguments: "{}" },
            },
          ],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "tool_calls",
        },
        {
          content: "Handled rejection",
          tool_calls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        },
      ]);

      const config: Partial<ExecutionConfig> = {
        parallelToolCalls: true,
        enableRetry: false,
      };
      const events = await collectEvents(
        executor.execute(
          mockLLMAdapter,
          "sys",
          "user",
          ["tool-b"],
          makeContext(),
          config,
        ),
      );

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
    });

    it("should execute sequential tools in partition.sequential", async () => {
      const mockTool = new MockTool(
        "tool-seq",
        "Seq",
        "desc",
        makeSuccessResult(),
      );
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(mockTool);

      const mockConcurrency: jest.Mocked<ToolConcurrencyService> = {
        partition: jest.fn().mockReturnValue({
          parallelGroups: [],
          sequential: ["tool-seq"],
        }),
      } as unknown as jest.Mocked<ToolConcurrencyService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockConcurrency,
      );

      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "tool-seq", arguments: "{}" },
            },
          ],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "tool_calls",
        },
        {
          content: "Sequential done",
          tool_calls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        },
      ]);

      const config: Partial<ExecutionConfig> = { parallelToolCalls: true };
      const events = await collectEvents(
        executor.execute(
          mockLLMAdapter,
          "sys",
          "user",
          ["tool-seq"],
          makeContext(),
          config,
        ),
      );

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
    });
  });

  // =========================================================================
  // Model fallback on LLM failure
  // =========================================================================

  describe("model fallback when LLM chat throws", () => {
    it("should use modelFallback when primary LLM call fails and fallback succeeds", async () => {
      const mockFallback: jest.Mocked<ModelFallbackService> = {
        executeWithFallback: jest.fn().mockResolvedValue({
          success: true,
          data: {
            content: "Fallback answer",
            tool_calls: [],
            usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
            finishReason: "stop",
          },
          modelUsed: "fallback-model",
        }),
      } as unknown as jest.Mocked<ModelFallbackService>;

      // Build adapter that throws on first call
      const throwingAdapter: ILLMAdapter = {
        provider: "test",
        formatTools: jest.fn().mockReturnValue([]),
        parseToolCalls: jest.fn().mockReturnValue([]),
        buildToolResultMessage: jest.fn(),
        chat: jest.fn().mockRejectedValue(new Error("Primary model down")),
      };

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockFallback,
      );

      const events = await collectEvents(
        executor.execute(throwingAdapter, "sys", "user", [], makeContext()),
      );

      expect(mockFallback.executeWithFallback).toHaveBeenCalled();
      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
    });

    it("should yield error event when modelFallback also fails", async () => {
      const mockFallback: jest.Mocked<ModelFallbackService> = {
        executeWithFallback: jest.fn().mockResolvedValue({
          success: false,
          error: new Error("All models failed"),
        }),
      } as unknown as jest.Mocked<ModelFallbackService>;

      const throwingAdapter: ILLMAdapter = {
        provider: "test",
        formatTools: jest.fn().mockReturnValue([]),
        parseToolCalls: jest.fn().mockReturnValue([]),
        buildToolResultMessage: jest.fn(),
        chat: jest.fn().mockRejectedValue(new Error("Primary down")),
      };

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockFallback,
      );

      const events = await collectEvents(
        executor.execute(throwingAdapter, "sys", "user", [], makeContext()),
      );

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
    });
  });

  // =========================================================================
  // Checkpoint saving
  // =========================================================================

  describe("checkpoint saving (enableCheckpoints=true)", () => {
    it("should call checkpoint.save after each iteration when enableCheckpoints=true", async () => {
      const mockTool = new MockTool(
        "tool-ck",
        "CK Tool",
        "desc",
        makeSuccessResult(),
      );
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(mockTool);

      const mockCheckpoint: jest.Mocked<ExecutionCheckpointService> = {
        save: jest.fn(),
        restore: jest.fn().mockReturnValue(null),
        endExecution: jest.fn(),
      } as unknown as jest.Mocked<ExecutionCheckpointService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockCheckpoint,
      );

      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "tool-ck", arguments: "{}" },
            },
          ],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "tool_calls",
        },
        {
          content: "Complete",
          tool_calls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        },
      ]);

      const config: Partial<ExecutionConfig> = { enableCheckpoints: true };
      const events = await collectEvents(
        executor.execute(
          mockLLMAdapter,
          "sys",
          "user",
          ["tool-ck"],
          makeContext(),
          config,
        ),
      );

      expect(mockCheckpoint.save).toHaveBeenCalled();
      expect(mockCheckpoint.endExecution).toHaveBeenCalled();
      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
    });
  });

  // =========================================================================
  // QueryLoop continuation (finishReason === "length")
  // =========================================================================

  describe("QueryLoop continuation when finishReason=length", () => {
    it("should use queryLoop when enableQueryLoop=true and finishReason=length", async () => {
      const mockQueryLoop: jest.Mocked<QueryLoopService> = {
        executeWithLoop: jest.fn().mockResolvedValue({
          content: "Continued full answer",
          totalInputTokens: 50,
          totalOutputTokens: 100,
        }),
      } as unknown as jest.Mocked<QueryLoopService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        mockQueryLoop,
      );

      mockLLMAdapter.setResponses([
        {
          content: "Truncated answer...",
          tool_calls: [],
          usage: {
            promptTokens: 100,
            completionTokens: 4096,
            totalTokens: 4196,
          },
          finishReason: "length",
        },
      ]);

      const config: Partial<ExecutionConfig> = { enableQueryLoop: true };
      const events = await collectEvents(
        executor.execute(
          mockLLMAdapter,
          "sys",
          "user",
          [],
          makeContext(),
          config,
        ),
      );

      expect(mockQueryLoop.executeWithLoop).toHaveBeenCalled();
      const completeEvent = events.find((e) => e.type === "complete") as any;
      expect(completeEvent).toBeDefined();
      expect(completeEvent.result.summary).toBe("Continued full answer");
    });
  });

  // =========================================================================
  // resumeFromCheckpoint
  // =========================================================================

  describe("resumeFromCheckpoint()", () => {
    it("should yield error when checkpoint service not available", async () => {
      const executor = new FunctionCallingExecutor(mockToolRegistry);

      const events = await collectEvents(
        executor.resumeFromCheckpoint(
          mockLLMAdapter,
          "exec-1",
          [],
          makeContext(),
        ),
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "error",
        error: "Checkpoint service not available",
      });
    });

    it("should yield error when no checkpoint found for executionId", async () => {
      const mockCheckpoint: jest.Mocked<ExecutionCheckpointService> = {
        save: jest.fn(),
        restore: jest.fn().mockReturnValue(null),
        endExecution: jest.fn(),
      } as unknown as jest.Mocked<ExecutionCheckpointService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockCheckpoint,
      );

      const events = await collectEvents(
        executor.resumeFromCheckpoint(
          mockLLMAdapter,
          "missing-exec",
          [],
          makeContext(),
        ),
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "error",
        error: expect.stringContaining("No checkpoint found"),
      });
    });

    it("should resume and complete when checkpoint exists and LLM returns direct answer", async () => {
      const mockCheckpoint: jest.Mocked<ExecutionCheckpointService> = {
        save: jest.fn(),
        restore: jest.fn().mockReturnValue({
          executionId: "exec-resume",
          iteration: 2,
          messages: [
            { role: "system", content: "sys" },
            { role: "user", content: "resume from here" },
          ],
          toolResults: [],
          tokenUsage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            totalTokens: 150,
            callCount: 2,
          },
          timestamp: new Date(),
        }),
        endExecution: jest.fn(),
      } as unknown as jest.Mocked<ExecutionCheckpointService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockCheckpoint,
      );

      mockLLMAdapter.setResponses([
        {
          content: "Resumed answer",
          tool_calls: [],
          usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
          finishReason: "stop",
        },
      ]);

      const events = await collectEvents(
        executor.resumeFromCheckpoint(
          mockLLMAdapter,
          "exec-resume",
          [],
          makeContext(),
        ),
      );

      const completeEvent = events.find((e) => e.type === "complete") as any;
      expect(completeEvent).toBeDefined();
      expect(completeEvent.result.summary).toBe("Resumed answer");
    });

    it("should yield error when LLM fails during resume", async () => {
      const mockCheckpoint: jest.Mocked<ExecutionCheckpointService> = {
        save: jest.fn(),
        restore: jest.fn().mockReturnValue({
          executionId: "exec-fail",
          iteration: 0,
          messages: [{ role: "user", content: "hello" }],
          toolResults: [],
          tokenUsage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            totalTokens: 0,
            callCount: 0,
          },
          timestamp: new Date(),
        }),
        endExecution: jest.fn(),
      } as unknown as jest.Mocked<ExecutionCheckpointService>;

      const failAdapter: ILLMAdapter = {
        provider: "test",
        formatTools: jest.fn().mockReturnValue([]),
        parseToolCalls: jest.fn().mockReturnValue([]),
        buildToolResultMessage: jest.fn(),
        chat: jest.fn().mockRejectedValue(new Error("LLM down during resume")),
      };

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockCheckpoint,
      );

      const events = await collectEvents(
        executor.resumeFromCheckpoint(
          failAdapter,
          "exec-fail",
          [],
          makeContext(),
        ),
      );

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
    });
  });

  // =========================================================================
  // MCP tool invalid format
  // =========================================================================

  describe("MCP tool invalid format", () => {
    it("should handle mcp_ tool with < 3 parts in ID (invalid format)", async () => {
      const mockMCPManager: jest.Mocked<{ callTool: jest.Mock }> = {
        callTool: jest.fn(),
      };

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        mockMCPManager as any,
      );

      // Tool name "mcp_only" has only 2 parts → invalid
      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "mcp_only", arguments: "{}" },
            },
          ],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "tool_calls",
        },
        {
          content: "MCP format error handled",
          tool_calls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        },
      ]);

      const events = await collectEvents(
        executor.execute(
          mockLLMAdapter,
          "sys",
          "user",
          ["mcp_only"],
          makeContext(),
        ),
      );

      // Should not have called callTool (invalid format returns failure)
      expect(mockMCPManager.callTool).not.toHaveBeenCalled();
      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
    });

    it("should handle MCP callTool throwing an exception", async () => {
      const mockMCPManager: jest.Mocked<{ callTool: jest.Mock }> = {
        callTool: jest
          .fn()
          .mockRejectedValue(new Error("MCP server unreachable")),
      };

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        mockMCPManager as any,
      );

      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "mcp_server_tool", arguments: "{}" },
            },
          ],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "tool_calls",
        },
        {
          content: "MCP exception handled",
          tool_calls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        },
      ]);

      const events = await collectEvents(
        executor.execute(
          mockLLMAdapter,
          "sys",
          "user",
          ["mcp_server_tool"],
          makeContext(),
        ),
      );

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
    });
  });

  // =========================================================================
  // Retry strategy: executeTool with enableRetry=true and retryStrategy failure
  // =========================================================================

  describe("executeTool with enableRetry=true and retry failure path", () => {
    it("should return failure result when retry strategy reports failure", async () => {
      // Tool execution always throws to trigger retry strategy failure path
      const failingTool: ITool = {
        id: "retry-fail-tool",
        name: "Retry Fail",
        description: "always fails",
        category: "information" as const,
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: { type: "object" as const, properties: {} },
        enabled: true,
        execute: jest.fn().mockRejectedValue(new Error("always fails")),
        toFunctionDefinition: () => ({
          name: "retry-fail-tool",
          description: "always fails",
          parameters: { type: "object", properties: {} },
        }),
        toCompactSummary: () => ({
          id: "retry-fail-tool",
          name: "Retry Fail",
          brief: "always fails",
          category: "information" as const,
        }),
      };
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(failingTool);

      const executor = new FunctionCallingExecutor(mockToolRegistry);

      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "retry-fail-tool", arguments: "{}" },
            },
          ],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "tool_calls",
        },
        {
          content: "Handled retry failure",
          tool_calls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        },
      ]);

      const config: Partial<ExecutionConfig> = { enableRetry: true };
      const events = await collectEvents(
        executor.execute(
          mockLLMAdapter,
          "sys",
          "user",
          ["retry-fail-tool"],
          makeContext(),
          config,
        ),
      );

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
    });
  });

  // =========================================================================
  // SessionMemorySidecar paths
  // =========================================================================

  describe("SessionMemorySidecar integration", () => {
    it("should call sidecar.addEntry when tool result data is long enough (>50 chars)", async () => {
      const mockTool = new MockTool(
        "sidecar-tool",
        "Sidecar Tool",
        "desc",
        makeSuccessResult("A".repeat(100)), // > 50 chars
      );
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(mockTool);

      const mockSidecar: jest.Mocked<SessionMemorySidecarService> = {
        addEntry: jest.fn(),
        onCompaction: jest.fn().mockReturnValue(null),
        getEntries: jest.fn().mockReturnValue([]),
        createSession: jest.fn(),
        endSession: jest.fn(),
      } as unknown as jest.Mocked<SessionMemorySidecarService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockSidecar,
      );

      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "sidecar-tool", arguments: "{}" },
            },
          ],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "tool_calls",
        },
        {
          content: "Done",
          tool_calls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        },
      ]);

      await collectEvents(
        executor.execute(
          mockLLMAdapter,
          "sys",
          "user",
          ["sidecar-tool"],
          makeContext(),
        ),
      );

      expect(mockSidecar.addEntry).toHaveBeenCalled();
    });

    it("should NOT call sidecar.addEntry when tool result data is short (<=50 chars)", async () => {
      const mockTool = new MockTool(
        "short-tool",
        "Short Tool",
        "desc",
        makeSuccessResult("short"), // <= 50 chars
      );
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(mockTool);

      const mockSidecar: jest.Mocked<SessionMemorySidecarService> = {
        addEntry: jest.fn(),
        onCompaction: jest.fn().mockReturnValue(null),
        getEntries: jest.fn().mockReturnValue([]),
        createSession: jest.fn(),
        endSession: jest.fn(),
      } as unknown as jest.Mocked<SessionMemorySidecarService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockSidecar,
      );

      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "short-tool", arguments: "{}" },
            },
          ],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "tool_calls",
        },
        {
          content: "Done",
          tool_calls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        },
      ]);

      await collectEvents(
        executor.execute(
          mockLLMAdapter,
          "sys",
          "user",
          ["short-tool"],
          makeContext(),
        ),
      );

      expect(mockSidecar.addEntry).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // TokenTracker integration
  // =========================================================================

  describe("TokenTracker integration", () => {
    it("should call tokenTracker.createSession and endSession on execute", async () => {
      const mockTokenTracker: jest.Mocked<TokenTrackerService> = {
        createSession: jest.fn(),
        recordUsage: jest.fn(),
        getUsage: jest.fn().mockReturnValue({
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 0,
          callCount: 0,
        }),
        endSession: jest.fn(),
      } as unknown as jest.Mocked<TokenTrackerService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        undefined,
        mockTokenTracker,
      );

      mockLLMAdapter.setResponses([
        {
          content: "Direct answer",
          tool_calls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        },
      ]);

      await collectEvents(
        executor.execute(mockLLMAdapter, "sys", "user", [], makeContext()),
      );

      expect(mockTokenTracker.createSession).toHaveBeenCalled();
      expect(mockTokenTracker.recordUsage).toHaveBeenCalled();
      expect(mockTokenTracker.endSession).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Context compaction branch (contextCompaction provided)
  // =========================================================================

  describe("context compaction branch", () => {
    it("should invoke contextCompaction.compact at each iteration and apply none level", async () => {
      const mockCompaction: jest.Mocked<ContextCompactionPipelineService> = {
        compact: jest.fn().mockResolvedValue({
          messages: [
            { role: "system", content: "sys" },
            { role: "user", content: "user" },
          ],
          levelApplied: "none",
          messagesRemoved: 0,
          tokensSaved: 0,
          summaryInserted: false,
        }),
      } as unknown as jest.Mocked<ContextCompactionPipelineService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        undefined,
        undefined,
        mockCompaction,
      );

      mockLLMAdapter.setResponses([
        {
          content: "Answer",
          tool_calls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        },
      ]);

      const events = await collectEvents(
        executor.execute(mockLLMAdapter, "sys", "user", [], makeContext()),
      );

      expect(mockCompaction.compact).toHaveBeenCalled();
      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
    });

    it("should replace messages array when compaction levelApplied !== none", async () => {
      const mockCompaction: jest.Mocked<ContextCompactionPipelineService> = {
        compact: jest.fn().mockResolvedValue({
          messages: [
            { role: "system", content: "sys" },
            { role: "user", content: "summarized context" },
          ],
          levelApplied: "prune",
          messagesRemoved: 5,
          tokensSaved: 1000,
          summaryInserted: false,
        }),
      } as unknown as jest.Mocked<ContextCompactionPipelineService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined,
        undefined,
        undefined,
        undefined,
        mockCompaction,
      );

      mockLLMAdapter.setResponses([
        {
          content: "After compaction",
          tool_calls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        },
      ]);

      const events = await collectEvents(
        executor.execute(mockLLMAdapter, "sys", "user", [], makeContext()),
      );

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
    });
  });
});
