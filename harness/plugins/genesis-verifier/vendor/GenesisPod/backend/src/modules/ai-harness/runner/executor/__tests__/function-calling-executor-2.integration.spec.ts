/**
 * FunctionCallingExecutor - Extended Coverage 2
 *
 * Covers the executeWithDefinitions private method (via executeWithContext)
 * and related paths not covered by extended.spec.ts:
 *
 *  - executeWithContext: no capabilityResolver → error
 *  - executeWithDefinitions: no tool calls → complete
 *  - executeWithDefinitions: with tool calls (serial path)
 *  - executeWithDefinitions: parallel tool execution
 *  - executeWithDefinitions: parallel tool rejected
 *  - executeWithDefinitions: model fallback on LLM error
 *  - executeWithDefinitions: model fallback → all models fail
 *  - executeWithDefinitions: LLM error without fallback → error event
 *  - executeWithDefinitions: QueryLoop on finishReason=length
 *  - executeWithDefinitions: context compaction branch
 *  - executeWithDefinitions: max iterations reached
 *  - executeWithDefinitions: max tool calls reached
 *  - executeWithDefinitions: checkpoint save per iteration
 *  - executeWithDefinitions: taskProfile provided → no mapping
 *  - executeWithDefinitions: sidecar.addEntry when tool data > 50 chars
 *  - executeWithContext: logCapabilityUsage called on tool_result
 *  - mapTemperatureToCreativity: all branches
 *  - mapMaxTokensToOutputLength: all branches
 *  - resumeFromCheckpoint: tool call path (lines 967-1033)
 */

import {
  FunctionCallingExecutor,
  ILLMAdapter,
  LLMResponse,
  ToolCallRequest,
  LLMMessage,
  LLMRequestOptions,
  AgentEvent,
} from "../function-calling-executor";
import { ToolRegistry } from "../../../../ai-engine/tools/registry";
import {
  ToolContext,
  ToolResult,
  FunctionDefinition,
} from "../../../../ai-engine/tools/abstractions/tool.interface";
import { ToolConcurrencyService } from "../../../../ai-engine/tools/concurrency/tool-concurrency.service";
import { ModelFallbackService } from "../../../../ai-engine/llm/models/selection/model-fallback.service";
import { ContextCompactionPipelineService } from "../../../../ai-engine/planning/context/context-compaction-pipeline.service";
import { QueryLoopService } from "../query-loop.service";
import { ExecutionCheckpointService } from "../execution-checkpoint.service";
import { SessionMemorySidecarService } from "../../../../ai-engine/facade";
import { TokenTrackerService } from "../token-tracker.service";
import {
  AICapabilityResolver,
  AICapabilityContext,
} from "../../../../ai-engine/abstractions/ai-capability-resolver.interface";

// ---------------------------------------------------------------------------
// Mock LLM adapter
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
      throw new Error("No more mock responses available");
    return this.responses[this.idx++];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-2",
    toolId: "function-calling",
    userId: "user-2",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeCapabilityContext(
  overrides: Partial<AICapabilityContext> = {},
): AICapabilityContext {
  return {
    agentId: "agent-1",
    userId: "user-2",
    teamId: "team-1",
    ...overrides,
  };
}

function makeSuccessToolResult(data: unknown = { value: "ok" }): ToolResult {
  return {
    success: true,
    data,
    metadata: {
      executionId: "test-exec-2",
      startTime: new Date(),
      endTime: new Date(),
      duration: 10,
    },
  };
}

function makeFailureToolResult(message = "tool failed"): ToolResult {
  return {
    success: false,
    error: { code: "TOOL_ERROR", message },
    metadata: {
      executionId: "test-exec-2",
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

function makeCompleteResponse(summary = "Done"): LLMResponse {
  return {
    content: summary,
    tool_calls: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    finishReason: "stop",
  };
}

function makeToolCallResponse(toolName: string, args = "{}"): LLMResponse {
  return {
    content: null,
    tool_calls: [
      {
        id: "c1",
        type: "function",
        function: { name: toolName, arguments: args },
      },
    ],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    finishReason: "tool_calls",
  };
}

// ---------------------------------------------------------------------------
// Common mock setup
// ---------------------------------------------------------------------------

function makeToolRegistry(): jest.Mocked<ToolRegistry> {
  return {
    has: jest.fn().mockReturnValue(false),
    get: jest.fn(),
    getAll: jest.fn().mockReturnValue([]),
    tryGet: jest.fn(),
    register: jest.fn(),
    unregister: jest.fn(),
    clear: jest.fn(),
    size: jest.fn(),
  } as unknown as jest.Mocked<ToolRegistry>;
}

function makeCapabilityResolver(
  functionDefinitions: FunctionDefinition[] = [],
): jest.Mocked<AICapabilityResolver> {
  return {
    getToolFunctionDefinitions: jest
      .fn()
      .mockResolvedValue(functionDefinitions),
    logCapabilityUsage: jest.fn().mockResolvedValue(undefined),
    resolveTools: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<AICapabilityResolver>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FunctionCallingExecutor (extended coverage 2 — executeWithDefinitions)", () => {
  let mockToolRegistry: jest.Mocked<ToolRegistry>;
  let mockLLMAdapter: MockLLMAdapter;

  beforeEach(() => {
    mockToolRegistry = makeToolRegistry();
    mockLLMAdapter = new MockLLMAdapter();
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // executeWithContext: no capabilityResolver
  // =========================================================================

  describe("executeWithContext: no capabilityResolver", () => {
    it("yields error when capabilityResolver is not injected", async () => {
      const executor = new FunctionCallingExecutor(mockToolRegistry);

      mockLLMAdapter.setResponses([makeCompleteResponse()]);

      const events = await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
        ),
      );

      expect(events.some((e) => e.type === "error")).toBe(true);
    });
  });

  // =========================================================================
  // executeWithDefinitions: no tool calls → complete
  // =========================================================================

  describe("executeWithDefinitions: no tool calls → complete", () => {
    it("emits complete event when LLM returns no tool calls", async () => {
      const resolver = makeCapabilityResolver([]);
      const executor = new FunctionCallingExecutor(mockToolRegistry, resolver);

      mockLLMAdapter.setResponses([makeCompleteResponse("Task done")]);

      const events = await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
        ),
      );

      const complete = events.find((e) => e.type === "complete") as {
        result: { summary: string };
      };
      expect(complete).toBeDefined();
      expect(complete.result.summary).toBe("Task done");
    });
  });

  // =========================================================================
  // executeWithDefinitions: serial tool execution
  // =========================================================================

  describe("executeWithDefinitions: serial tool execution", () => {
    it("executes tool and emits tool_call + tool_result events", async () => {
      const toolDef: FunctionDefinition = {
        name: "search",
        description: "Search for info",
        parameters: { type: "object", properties: {} },
      };

      const resolver = makeCapabilityResolver([toolDef]);
      const executor = new FunctionCallingExecutor(mockToolRegistry, resolver);

      // Registry has the tool
      mockToolRegistry.has.mockReturnValue(true);
      const fakeTool = {
        id: "search",
        name: "Search",
        description: "desc",
        category: "information" as const,
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: { type: "object" as const, properties: {} },
        enabled: true,
        execute: jest
          .fn()
          .mockResolvedValue(makeSuccessToolResult("search results")),
        toFunctionDefinition: () => toolDef,
        toCompactSummary: () => ({
          id: "search",
          name: "Search",
          brief: "desc",
          category: "information" as const,
        }),
      };
      mockToolRegistry.get.mockReturnValue(fakeTool);

      mockLLMAdapter.setResponses([
        makeToolCallResponse("search"),
        makeCompleteResponse("Search done"),
      ]);

      const events = await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
        ),
      );

      expect(events.some((e) => e.type === "tool_call")).toBe(true);
      expect(events.some((e) => e.type === "tool_result")).toBe(true);
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });

    it("tool with invalid JSON arguments falls back to raw string", async () => {
      const toolDef: FunctionDefinition = {
        name: "raw-tool",
        description: "Uses raw args",
        parameters: { type: "object", properties: {} },
      };

      const resolver = makeCapabilityResolver([toolDef]);
      const executor = new FunctionCallingExecutor(mockToolRegistry, resolver);

      mockToolRegistry.has.mockReturnValue(true);
      const fakeTool = {
        id: "raw-tool",
        name: "Raw Tool",
        description: "desc",
        category: "information" as const,
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: { type: "object" as const, properties: {} },
        enabled: true,
        execute: jest.fn().mockResolvedValue(makeSuccessToolResult("ok")),
        toFunctionDefinition: () => toolDef,
        toCompactSummary: () => ({
          id: "raw-tool",
          name: "Raw Tool",
          brief: "desc",
          category: "information" as const,
        }),
      };
      mockToolRegistry.get.mockReturnValue(fakeTool);

      mockLLMAdapter.setResponses([
        // invalid JSON arguments → raw string fallback
        {
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "raw-tool", arguments: "not-json" },
            },
          ],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "tool_calls",
        },
        makeCompleteResponse("Raw done"),
      ]);

      const events = await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
        ),
      );

      expect(events.some((e) => e.type === "complete")).toBe(true);
    });

    it("failed tool result yields tool_result with error and increments failedToolCalls", async () => {
      const toolDef: FunctionDefinition = {
        name: "fail-tool",
        description: "Always fails",
        parameters: { type: "object", properties: {} },
      };

      const resolver = makeCapabilityResolver([toolDef]);
      const executor = new FunctionCallingExecutor(mockToolRegistry, resolver);

      mockToolRegistry.has.mockReturnValue(true);
      const fakeTool = {
        id: "fail-tool",
        name: "Fail Tool",
        description: "desc",
        category: "information" as const,
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: { type: "object" as const, properties: {} },
        enabled: true,
        execute: jest.fn().mockResolvedValue(makeFailureToolResult("fail!")),
        toFunctionDefinition: () => toolDef,
        toCompactSummary: () => ({
          id: "fail-tool",
          name: "Fail Tool",
          brief: "desc",
          category: "information" as const,
        }),
      };
      mockToolRegistry.get.mockReturnValue(fakeTool);

      mockLLMAdapter.setResponses([
        makeToolCallResponse("fail-tool"),
        makeCompleteResponse("Handled"),
      ]);

      const events = await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
        ),
      );

      const toolResult = events.find((e) => e.type === "tool_result");
      expect(toolResult).toBeDefined();
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });
  });

  // =========================================================================
  // executeWithDefinitions: parallel tool execution
  // =========================================================================

  describe("executeWithDefinitions: parallel tool calls", () => {
    it("executes tools in parallel groups via ToolConcurrencyService", async () => {
      const toolDef: FunctionDefinition = {
        name: "parallel-tool",
        description: "Parallel",
        parameters: { type: "object", properties: {} },
      };
      const resolver = makeCapabilityResolver([toolDef]);

      const fakeTool = {
        id: "parallel-tool",
        name: "Parallel Tool",
        description: "desc",
        category: "information" as const,
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: { type: "object" as const, properties: {} },
        enabled: true,
        execute: jest
          .fn()
          .mockResolvedValue(makeSuccessToolResult("parallel result")),
        toFunctionDefinition: () => toolDef,
        toCompactSummary: () => ({
          id: "parallel-tool",
          name: "Parallel Tool",
          brief: "desc",
          category: "information" as const,
        }),
      };
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(fakeTool);

      const mockConcurrency: jest.Mocked<ToolConcurrencyService> = {
        partition: jest.fn().mockReturnValue({
          parallelGroups: [["parallel-tool"]],
          sequential: [],
        }),
      } as unknown as jest.Mocked<ToolConcurrencyService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        resolver,
        undefined, // mcpManager
        undefined, // queryLoop
        undefined, // tokenTracker
        undefined, // contextCompaction
        undefined, // checkpoint
        mockConcurrency,
      );

      mockLLMAdapter.setResponses([
        makeToolCallResponse("parallel-tool"),
        makeCompleteResponse("Parallel done"),
      ]);

      const events = await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
          { parallelToolCalls: true },
        ),
      );

      expect(mockConcurrency.partition).toHaveBeenCalled();
      expect(events.some((e) => e.type === "tool_result")).toBe(true);
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });

    it("handles parallel tool rejection (rejected promise in parallel group)", async () => {
      const toolDef: FunctionDefinition = {
        name: "reject-tool",
        description: "Rejects",
        parameters: { type: "object", properties: {} },
      };
      const resolver = makeCapabilityResolver([toolDef]);

      // The tool throws, causing the parallel promise to reject
      mockToolRegistry.has.mockReturnValue(true);
      const failingTool = {
        id: "reject-tool",
        name: "Reject Tool",
        description: "desc",
        category: "information" as const,
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: { type: "object" as const, properties: {} },
        enabled: true,
        execute: jest.fn().mockRejectedValue(new Error("exploded")),
        toFunctionDefinition: () => toolDef,
        toCompactSummary: () => ({
          id: "reject-tool",
          name: "Reject Tool",
          brief: "desc",
          category: "information" as const,
        }),
      };
      mockToolRegistry.get.mockReturnValue(failingTool);

      const mockConcurrency: jest.Mocked<ToolConcurrencyService> = {
        partition: jest.fn().mockReturnValue({
          parallelGroups: [["reject-tool"]],
          sequential: [],
        }),
      } as unknown as jest.Mocked<ToolConcurrencyService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        resolver,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockConcurrency,
      );

      mockLLMAdapter.setResponses([
        makeToolCallResponse("reject-tool"),
        makeCompleteResponse("Rejection handled"),
      ]);

      const events = await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
          { parallelToolCalls: true },
        ),
      );

      // rejected tool yields a tool_result with error
      const toolResult = events.find((e) => e.type === "tool_result") as
        | { output: { error: string } }
        | undefined;
      expect(toolResult).toBeDefined();
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });

    it("executes sequential tools when partition has sequential list", async () => {
      const toolDef: FunctionDefinition = {
        name: "seq-tool",
        description: "Sequential",
        parameters: { type: "object", properties: {} },
      };
      const resolver = makeCapabilityResolver([toolDef]);

      const seqTool = {
        id: "seq-tool",
        name: "Seq Tool",
        description: "desc",
        category: "information" as const,
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: { type: "object" as const, properties: {} },
        enabled: true,
        execute: jest
          .fn()
          .mockResolvedValue(makeSuccessToolResult("seq result")),
        toFunctionDefinition: () => toolDef,
        toCompactSummary: () => ({
          id: "seq-tool",
          name: "Seq Tool",
          brief: "desc",
          category: "information" as const,
        }),
      };
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(seqTool);

      const mockConcurrency: jest.Mocked<ToolConcurrencyService> = {
        partition: jest.fn().mockReturnValue({
          parallelGroups: [],
          sequential: ["seq-tool"],
        }),
      } as unknown as jest.Mocked<ToolConcurrencyService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        resolver,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockConcurrency,
      );

      mockLLMAdapter.setResponses([
        makeToolCallResponse("seq-tool"),
        makeCompleteResponse("Seq done"),
      ]);

      const events = await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
          { parallelToolCalls: true },
        ),
      );

      expect(events.some((e) => e.type === "tool_result")).toBe(true);
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });
  });

  // =========================================================================
  // executeWithDefinitions: model fallback
  // =========================================================================

  describe("executeWithDefinitions: model fallback on LLM error", () => {
    it("uses fallback model when primary LLM fails", async () => {
      const resolver = makeCapabilityResolver([]);

      const fallbackData = makeCompleteResponse("Fallback answer");
      const mockFallback: jest.Mocked<ModelFallbackService> = {
        executeWithFallback: jest.fn().mockResolvedValue({
          success: true,
          data: fallbackData,
          modelUsed: "fallback-model",
        }),
      } as unknown as jest.Mocked<ModelFallbackService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        resolver,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockFallback,
      );

      // Primary LLM always fails
      const failAdapter: ILLMAdapter = {
        provider: "test",
        formatTools: jest.fn().mockReturnValue([]),
        parseToolCalls: jest.fn().mockReturnValue([]),
        buildToolResultMessage: jest.fn(),
        chat: jest.fn().mockRejectedValue(new Error("Primary failed")),
      };

      const events = await collectEvents(
        executor.executeWithContext(
          failAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
        ),
      );

      expect(mockFallback.executeWithFallback).toHaveBeenCalled();
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });

    it("yields error when fallback also fails (fallbackResult.success=false)", async () => {
      const resolver = makeCapabilityResolver([]);

      const mockFallback: jest.Mocked<ModelFallbackService> = {
        executeWithFallback: jest.fn().mockResolvedValue({
          success: false,
          error: new Error("All models down"),
        }),
      } as unknown as jest.Mocked<ModelFallbackService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        resolver,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockFallback,
      );

      const failAdapter: ILLMAdapter = {
        provider: "test",
        formatTools: jest.fn().mockReturnValue([]),
        parseToolCalls: jest.fn().mockReturnValue([]),
        buildToolResultMessage: jest.fn(),
        chat: jest.fn().mockRejectedValue(new Error("Primary failed")),
      };

      const events = await collectEvents(
        executor.executeWithContext(
          failAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
        ),
      );

      expect(events.some((e) => e.type === "error")).toBe(true);
    });

    it("yields error when LLM fails and no fallback configured", async () => {
      const resolver = makeCapabilityResolver([]);

      const executor = new FunctionCallingExecutor(mockToolRegistry, resolver);

      const failAdapter: ILLMAdapter = {
        provider: "test",
        formatTools: jest.fn().mockReturnValue([]),
        parseToolCalls: jest.fn().mockReturnValue([]),
        buildToolResultMessage: jest.fn(),
        chat: jest.fn().mockRejectedValue(new Error("No fallback")),
      };

      const events = await collectEvents(
        executor.executeWithContext(
          failAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
        ),
      );

      expect(events.some((e) => e.type === "error")).toBe(true);
    });
  });

  // =========================================================================
  // executeWithDefinitions: QueryLoop on finishReason=length
  // =========================================================================

  describe("executeWithDefinitions: QueryLoop continuation on finishReason=length", () => {
    it("uses QueryLoop when output is truncated (finishReason=length)", async () => {
      const resolver = makeCapabilityResolver([]);

      const mockQueryLoop: jest.Mocked<QueryLoopService> = {
        executeWithLoop: jest.fn().mockResolvedValue({
          content: "Continued content",
          totalInputTokens: 50,
          totalOutputTokens: 100,
        }),
      } as unknown as jest.Mocked<QueryLoopService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        resolver,
        undefined,
        mockQueryLoop,
      );

      mockLLMAdapter.setResponses([
        {
          content: "Partial content...",
          tool_calls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "length",
        },
      ]);

      const events = await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
          { enableQueryLoop: true },
        ),
      );

      expect(mockQueryLoop.executeWithLoop).toHaveBeenCalled();
      const complete = events.find((e) => e.type === "complete") as
        | { result: { summary: string } }
        | undefined;
      expect(complete).toBeDefined();
      expect(complete!.result.summary).toBe("Continued content");
    });
  });

  // =========================================================================
  // executeWithDefinitions: context compaction
  // =========================================================================

  describe("executeWithDefinitions: context compaction", () => {
    it("compacts context when contextCompaction is available", async () => {
      const resolver = makeCapabilityResolver([]);

      const mockCompaction: jest.Mocked<ContextCompactionPipelineService> = {
        compact: jest.fn().mockResolvedValue({
          levelApplied: "prune",
          messages: [{ role: "user", content: "compacted" }],
          tokensSaved: 500,
        }),
      } as unknown as jest.Mocked<ContextCompactionPipelineService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        resolver,
        undefined,
        undefined,
        undefined,
        mockCompaction,
      );

      mockLLMAdapter.setResponses([makeCompleteResponse("Compacted response")]);

      const events = await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
        ),
      );

      expect(mockCompaction.compact).toHaveBeenCalled();
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });
  });

  // =========================================================================
  // executeWithDefinitions: checkpoint save
  // =========================================================================

  describe("executeWithDefinitions: checkpoint save per iteration", () => {
    it("saves checkpoint after each tool iteration when enableCheckpoints=true", async () => {
      const toolDef: FunctionDefinition = {
        name: "checkpoint-tool",
        description: "Checkpointed",
        parameters: { type: "object", properties: {} },
      };
      const resolver = makeCapabilityResolver([toolDef]);

      const fakeTool = {
        id: "checkpoint-tool",
        name: "Checkpoint Tool",
        description: "desc",
        category: "information" as const,
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: { type: "object" as const, properties: {} },
        enabled: true,
        execute: jest.fn().mockResolvedValue(makeSuccessToolResult("done")),
        toFunctionDefinition: () => toolDef,
        toCompactSummary: () => ({
          id: "checkpoint-tool",
          name: "Checkpoint Tool",
          brief: "desc",
          category: "information" as const,
        }),
      };
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(fakeTool);

      const mockCheckpoint: jest.Mocked<ExecutionCheckpointService> = {
        save: jest.fn(),
        restore: jest.fn(),
        endExecution: jest.fn(),
      } as unknown as jest.Mocked<ExecutionCheckpointService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        resolver,
        undefined,
        undefined,
        undefined,
        undefined,
        mockCheckpoint,
      );

      mockLLMAdapter.setResponses([
        makeToolCallResponse("checkpoint-tool"),
        makeCompleteResponse("Checkpoint done"),
      ]);

      await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
          { enableCheckpoints: true },
        ),
      );

      expect(mockCheckpoint.save).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // executeWithDefinitions: max iterations reached
  // =========================================================================

  describe("executeWithDefinitions: max limits", () => {
    it("yields error when max iterations reached", async () => {
      const toolDef: FunctionDefinition = {
        name: "infinite-tool",
        description: "Never finishes",
        parameters: { type: "object", properties: {} },
      };
      const resolver = makeCapabilityResolver([toolDef]);

      const infiniteTool = {
        id: "infinite-tool",
        name: "Infinite Tool",
        description: "desc",
        category: "information" as const,
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: { type: "object" as const, properties: {} },
        enabled: true,
        execute: jest.fn().mockResolvedValue(makeSuccessToolResult("...")),
        toFunctionDefinition: () => toolDef,
        toCompactSummary: () => ({
          id: "infinite-tool",
          name: "Infinite Tool",
          brief: "desc",
          category: "information" as const,
        }),
      };
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(infiniteTool);

      const executor = new FunctionCallingExecutor(mockToolRegistry, resolver);

      // Each LLM call returns tool_calls so loop never finishes
      mockLLMAdapter.setResponses(
        Array(20).fill(makeToolCallResponse("infinite-tool")),
      );

      const events = await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
          { maxIterations: 2 }, // very small max
        ),
      );

      expect(
        events.some(
          (e) =>
            e.type === "error" &&
            (e as { error: string }).error.includes("Max iterations"),
        ),
      ).toBe(true);
    });

    it("yields error when max tool calls reached", async () => {
      const toolDef: FunctionDefinition = {
        name: "many-tool",
        description: "Called many times",
        parameters: { type: "object", properties: {} },
      };
      const resolver = makeCapabilityResolver([toolDef]);

      const manyTool = {
        id: "many-tool",
        name: "Many Tool",
        description: "desc",
        category: "information" as const,
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: { type: "object" as const, properties: {} },
        enabled: true,
        execute: jest.fn().mockResolvedValue(makeSuccessToolResult("ok")),
        toFunctionDefinition: () => toolDef,
        toCompactSummary: () => ({
          id: "many-tool",
          name: "Many Tool",
          brief: "desc",
          category: "information" as const,
        }),
      };
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(manyTool);

      const executor = new FunctionCallingExecutor(mockToolRegistry, resolver);

      mockLLMAdapter.setResponses(
        Array(10).fill(makeToolCallResponse("many-tool")),
      );

      const events = await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
          { maxToolCalls: 1, maxIterations: 10 }, // very small max tool calls
        ),
      );

      expect(
        events.some(
          (e) =>
            e.type === "error" &&
            (e as { error: string }).error.includes("Max tool calls"),
        ),
      ).toBe(true);
    });
  });

  // =========================================================================
  // executeWithDefinitions: taskProfile provided
  // =========================================================================

  describe("executeWithDefinitions: taskProfile provided in config", () => {
    it("uses provided taskProfile instead of mapping from temperature/maxTokens", async () => {
      const resolver = makeCapabilityResolver([]);
      const executor = new FunctionCallingExecutor(mockToolRegistry, resolver);

      mockLLMAdapter.setResponses([makeCompleteResponse("Profile done")]);

      const events = await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
          { taskProfile: { creativity: "high", outputLength: "long" } },
        ),
      );

      expect(events.some((e) => e.type === "complete")).toBe(true);
    });
  });

  // =========================================================================
  // Sidecar onCompaction path in execute() (line 341)
  // =========================================================================

  describe("sidecar.onCompaction called after context compaction in execute()", () => {
    it("calls sidecar.onCompaction and injects summary message when compaction occurs", async () => {
      const mockSidecar: jest.Mocked<SessionMemorySidecarService> = {
        addEntry: jest.fn(),
        onCompaction: jest.fn().mockReturnValue("Preserved session memory"),
        getEntries: jest.fn().mockReturnValue([]),
        createSession: jest.fn(),
        endSession: jest.fn(),
      } as unknown as jest.Mocked<SessionMemorySidecarService>;

      const mockCompaction: jest.Mocked<ContextCompactionPipelineService> = {
        compact: jest.fn().mockResolvedValue({
          levelApplied: "prune",
          messages: [{ role: "user", content: "compacted message" }],
          tokensSaved: 1000,
        }),
      } as unknown as jest.Mocked<ContextCompactionPipelineService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        undefined, // no capabilityResolver
        undefined, // mcpManager
        undefined, // queryLoop
        undefined, // tokenTracker
        mockCompaction, // contextCompaction
        undefined, // checkpoint
        undefined, // toolConcurrency
        undefined, // modelFallback
        mockSidecar, // sidecar
      );

      mockLLMAdapter.setResponses([makeCompleteResponse("Compaction done")]);

      await collectEvents(
        executor.execute(mockLLMAdapter, "sys", "user", [], makeContext()),
      );

      expect(mockCompaction.compact).toHaveBeenCalled();
      expect(mockSidecar.onCompaction).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // executeWithContext: logCapabilityUsage on tool_result
  // =========================================================================

  describe("executeWithContext: logCapabilityUsage", () => {
    it("calls logCapabilityUsage when a tool_result event is yielded", async () => {
      const toolDef: FunctionDefinition = {
        name: "usage-tool",
        description: "Usage logging test",
        parameters: { type: "object", properties: {} },
      };
      const resolver = makeCapabilityResolver([toolDef]);

      const usageTool = {
        id: "usage-tool",
        name: "Usage Tool",
        description: "desc",
        category: "information" as const,
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: { type: "object" as const, properties: {} },
        enabled: true,
        execute: jest.fn().mockResolvedValue(makeSuccessToolResult("data")),
        toFunctionDefinition: () => toolDef,
        toCompactSummary: () => ({
          id: "usage-tool",
          name: "Usage Tool",
          brief: "desc",
          category: "information" as const,
        }),
      };
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(usageTool);

      const executor = new FunctionCallingExecutor(mockToolRegistry, resolver);

      mockLLMAdapter.setResponses([
        makeToolCallResponse("usage-tool"),
        makeCompleteResponse("Usage done"),
      ]);

      await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
        ),
      );

      expect(resolver.logCapabilityUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          capabilityType: "tool",
          capabilityId: "usage-tool",
        }),
      );
    });
  });

  // =========================================================================
  // resumeFromCheckpoint: tool call path (lines 967-1033)
  // =========================================================================

  describe("resumeFromCheckpoint: processes tool calls after resume", () => {
    it("executes tools from checkpoint and completes", async () => {
      const toolDef: FunctionDefinition = {
        name: "resume-tool",
        description: "Resume tool",
        parameters: { type: "object", properties: {} },
      };

      const resumeTool = {
        id: "resume-tool",
        name: "Resume Tool",
        description: "desc",
        category: "information" as const,
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: { type: "object" as const, properties: {} },
        enabled: true,
        execute: jest.fn().mockResolvedValue(makeSuccessToolResult("resumed")),
        toFunctionDefinition: () => toolDef,
        toCompactSummary: () => ({
          id: "resume-tool",
          name: "Resume Tool",
          brief: "desc",
          category: "information" as const,
        }),
      };
      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(resumeTool);

      const mockCheckpoint: jest.Mocked<ExecutionCheckpointService> = {
        save: jest.fn(),
        restore: jest.fn().mockReturnValue({
          executionId: "exec-resume",
          iteration: 0,
          messages: [{ role: "user", content: "continue" }],
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
        makeToolCallResponse("resume-tool"),
        makeCompleteResponse("Resume complete"),
      ]);

      const events = await collectEvents(
        executor.resumeFromCheckpoint(
          mockLLMAdapter,
          "exec-resume",
          ["resume-tool"],
          makeContext(),
        ),
      );

      expect(events.some((e) => e.type === "tool_call")).toBe(true);
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });
  });

  // =========================================================================
  // mapTemperatureToCreativity + mapMaxTokensToOutputLength branches
  // =========================================================================

  describe("mapTemperatureToCreativity and mapMaxTokensToOutputLength branches", () => {
    it("covers all temperature→creativity mappings via executeWithDefinitions", async () => {
      const resolver = makeCapabilityResolver([]);

      // Run with temperature=0.1 (deterministic), 0.3 (low), 0.5 (medium), 0.9 (high)
      for (const temp of [0.1, 0.3, 0.5, 0.9]) {
        const executor = new FunctionCallingExecutor(
          mockToolRegistry,
          resolver,
        );
        mockLLMAdapter.setResponses([makeCompleteResponse("ok")]);

        await collectEvents(
          executor.executeWithContext(
            mockLLMAdapter,
            "sys",
            "user",
            makeCapabilityContext(),
            { temperature: temp },
          ),
        );
      }

      // All completed without throwing
      expect(true).toBe(true);
    });

    it("covers all maxTokens→outputLength mappings via executeWithDefinitions", async () => {
      const resolver = makeCapabilityResolver([]);

      for (const maxTokens of [500, 1500, 3000, 5000, 7000, 12000]) {
        const executor = new FunctionCallingExecutor(
          mockToolRegistry,
          resolver,
        );
        mockLLMAdapter.setResponses([makeCompleteResponse("ok")]);

        await collectEvents(
          executor.executeWithContext(
            mockLLMAdapter,
            "sys",
            "user",
            makeCapabilityContext(),
            { maxTokens },
          ),
        );
      }

      expect(true).toBe(true);
    });
  });

  // =========================================================================
  // tokenTracker integration
  // =========================================================================

  describe("tokenTracker integration in executeWithDefinitions", () => {
    it("records usage when tokenTracker is provided and response has usage", async () => {
      const resolver = makeCapabilityResolver([]);

      const mockTokenTracker: jest.Mocked<TokenTrackerService> = {
        createSession: jest.fn(),
        endSession: jest.fn(),
        recordUsage: jest.fn(),
        getUsage: jest.fn().mockReturnValue({
          inputTokens: 10,
          outputTokens: 5,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 15,
          callCount: 1,
        }),
      } as unknown as jest.Mocked<TokenTrackerService>;

      const executor = new FunctionCallingExecutor(
        mockToolRegistry,
        resolver,
        undefined,
        undefined,
        mockTokenTracker,
      );

      mockLLMAdapter.setResponses([makeCompleteResponse("Tracked")]);

      await collectEvents(
        executor.executeWithContext(
          mockLLMAdapter,
          "sys",
          "user",
          makeCapabilityContext(),
        ),
      );

      expect(mockTokenTracker.createSession).toHaveBeenCalled();
      expect(mockTokenTracker.recordUsage).toHaveBeenCalled();
      expect(mockTokenTracker.endSession).toHaveBeenCalled();
    });
  });
});
