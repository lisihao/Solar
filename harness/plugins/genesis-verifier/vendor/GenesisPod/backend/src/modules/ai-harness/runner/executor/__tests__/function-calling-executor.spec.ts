import { Test, TestingModule } from "@nestjs/testing";
import { FunctionCallingExecutor } from "../function-calling-executor";
import { ToolRegistry } from "../../../../ai-engine/tools/registry";
import { AICapabilityResolver } from "../../capabilities/ai-capability-resolver.service";
import { MCP_PROVIDER_PORT } from "@/modules/ai-engine/facade/abstractions/runtime-deps.tokens";
import type { MCPManager } from "@/modules/ai-harness/facade";
import {
  ILLMAdapter,
  LLMResponse,
  ToolCallRequest,
  LLMMessage,
  LLMRequestOptions,
  ExecutionConfig,
  AgentEvent,
} from "../function-calling-executor";
import {
  ToolContext,
  ToolResult,
  FunctionDefinition,
  ITool,
} from "../../../../ai-engine/tools/abstractions/tool.interface";

// Mock Tool Implementation
class MockTool implements ITool {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly description: string,
    private readonly executeResult: ToolResult,
  ) {}

  readonly category = "information";
  readonly inputSchema = { type: "object", properties: {} };
  readonly outputSchema = { type: "object", properties: {} };
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

// Mock LLM Adapter
class MockLLMAdapter implements ILLMAdapter {
  readonly provider = "test-provider";
  private responses: LLMResponse[] = [];
  private currentResponseIndex = 0;

  setResponses(responses: LLMResponse[]) {
    this.responses = responses;
    this.currentResponseIndex = 0;
  }

  formatTools(functions: FunctionDefinition[]): unknown {
    return functions.map((f) => ({ type: "function", function: f }));
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

  async chat(_options: LLMRequestOptions): Promise<LLMResponse> {
    if (this.currentResponseIndex >= this.responses.length) {
      throw new Error("No more mock responses available");
    }
    return this.responses[this.currentResponseIndex++];
  }
}

describe("FunctionCallingExecutor", () => {
  let executor: FunctionCallingExecutor;
  let mockToolRegistry: jest.Mocked<ToolRegistry>;
  let mockCapabilityResolver: jest.Mocked<AICapabilityResolver>;
  let mockMCPManager: jest.Mocked<MCPManager>;
  let mockLLMAdapter: MockLLMAdapter;

  beforeEach(async () => {
    // Mock ToolRegistry
    mockToolRegistry = {
      has: jest.fn(),
      get: jest.fn(),
      getAll: jest.fn(),
      tryGet: jest.fn(),
      register: jest.fn(),
      unregister: jest.fn(),
      clear: jest.fn(),
      size: jest.fn(),
    } as any;

    // Mock AICapabilityResolver
    mockCapabilityResolver = {
      getToolFunctionDefinitions: jest.fn(),
      logCapabilityUsage: jest.fn(),
    } as any;

    // Mock MCPManager
    mockMCPManager = {
      callTool: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FunctionCallingExecutor,
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: AICapabilityResolver, useValue: mockCapabilityResolver },
        { provide: MCP_PROVIDER_PORT, useValue: mockMCPManager },
      ],
    }).compile();

    executor = module.get<FunctionCallingExecutor>(FunctionCallingExecutor);
    mockLLMAdapter = new MockLLMAdapter();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== Execute Method Tests ====================

  describe("execute() - ReAct Loop", () => {
    it("should execute a complete ReAct loop with tool call and final answer", async () => {
      // Setup: Create a mock tool
      const mockTool = new MockTool("test-tool", "Test Tool", "A test tool", {
        success: true,
        data: { result: "tool execution result" },
        metadata: {
          executionId: "test-exec",
          startTime: new Date(),
          endTime: new Date(),
          duration: 100,
        },
      });

      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(mockTool);

      // Mock LLM responses:
      // 1. First response: tool call
      // 2. Second response: final answer (no tool calls)
      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "test-tool",
                arguments: JSON.stringify({ query: "test" }),
              },
            },
          ],
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
          finishReason: "tool_calls",
        },
        {
          content: "Final answer based on tool result",
          tool_calls: [],
          usage: {
            promptTokens: 150,
            completionTokens: 30,
            totalTokens: 180,
          },
          finishReason: "stop",
        },
      ]);

      const context: ToolContext = {
        executionId: "test-exec",
        toolId: "function-calling",
        userId: "user-1",
        createdAt: new Date(),
      };

      const events: AgentEvent[] = [];
      for await (const event of executor.execute(
        mockLLMAdapter,
        "You are a helpful assistant",
        "Test user prompt",
        ["test-tool"],
        context,
      )) {
        events.push(event);
      }

      // Verify event sequence
      expect(events).toHaveLength(5);

      // Event 1: tool_call
      expect(events[0]).toMatchObject({
        type: "tool_call",
        tool: "test-tool",
        input: { query: "test" },
      });

      // Event 2: tool_progress (progress: 0, before tool execution)
      expect(events[1]).toMatchObject({
        type: "tool_progress",
        tool: "test-tool",
        progress: 0,
      });

      // Event 3: tool_progress (progress: 100, after tool execution)
      expect(events[2]).toMatchObject({
        type: "tool_progress",
        tool: "test-tool",
        progress: 100,
      });

      // Event 4: tool_result
      expect(events[3]).toMatchObject({
        type: "tool_result",
        tool: "test-tool",
        output: { result: "tool execution result" },
      });

      // Event 5: complete
      expect(events[4]).toMatchObject({
        type: "complete",
        result: {
          success: true,
          summary: "Final answer based on tool result",
          tokensUsed: 330, // 150 + 180
        },
      });
    });

    it("should handle max iterations limit", async () => {
      // Mock LLM to always return tool calls (infinite loop scenario)
      mockLLMAdapter.setResponses(
        Array(20).fill({
          content: null,
          tool_calls: [
            {
              id: "call-loop",
              type: "function",
              function: {
                name: "test-tool",
                arguments: "{}",
              },
            },
          ],
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
          finishReason: "tool_calls",
        }),
      );

      const mockTool = new MockTool("test-tool", "Test Tool", "A test tool", {
        success: true,
        data: { result: "ok" },
        metadata: {
          executionId: "test-exec",
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
        },
      });

      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(mockTool);

      const context: ToolContext = {
        executionId: "test-exec",
        toolId: "function-calling",
        userId: "user-1",
        createdAt: new Date(),
      };

      const config: Partial<ExecutionConfig> = {
        maxIterations: 3,
        maxToolCalls: 100,
      };

      const events: AgentEvent[] = [];
      for await (const event of executor.execute(
        mockLLMAdapter,
        "You are a helpful assistant",
        "Test prompt",
        ["test-tool"],
        context,
        config,
      )) {
        events.push(event);
      }

      // Should stop after maxIterations
      // Each iteration produces 2 events (tool_call + tool_result)
      // Plus error event + complete event
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error).toContain("Max iterations reached");
    });

    it("should handle max tool calls limit", async () => {
      // Mock LLM to return multiple tool calls
      mockLLMAdapter.setResponses(
        Array(10).fill({
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "test-tool", arguments: "{}" },
            },
            {
              id: "call-2",
              type: "function",
              function: { name: "test-tool", arguments: "{}" },
            },
          ],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: "tool_calls",
        }),
      );

      const mockTool = new MockTool("test-tool", "Test Tool", "A test tool", {
        success: true,
        data: { result: "ok" },
        metadata: {
          executionId: "test-exec",
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
        },
      });

      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(mockTool);

      const context: ToolContext = {
        executionId: "test-exec",
        toolId: "function-calling",
        createdAt: new Date(),
      };

      const config: Partial<ExecutionConfig> = {
        maxIterations: 100,
        maxToolCalls: 5,
      };

      const events: AgentEvent[] = [];
      for await (const event of executor.execute(
        mockLLMAdapter,
        "System prompt",
        "User prompt",
        ["test-tool"],
        context,
        config,
      )) {
        events.push(event);
      }

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error).toContain("Max tool calls reached");
    });

    it("should handle tool execution errors", async () => {
      // Mock tool that fails
      const mockTool = new MockTool("failing-tool", "Failing Tool", "Fails", {
        success: false,
        error: {
          code: "TOOL_ERROR",
          message: "Tool execution failed",
        },
        metadata: {
          executionId: "test-exec",
          startTime: new Date(),
          endTime: new Date(),
          duration: 50,
        },
      });

      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(mockTool);

      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "failing-tool",
                arguments: "{}",
              },
            },
          ],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: "tool_calls",
        },
        {
          content: "I encountered an error",
          tool_calls: [],
          usage: { promptTokens: 150, completionTokens: 30, totalTokens: 180 },
          finishReason: "stop",
        },
      ]);

      const context: ToolContext = {
        executionId: "test-exec",
        toolId: "function-calling",
        createdAt: new Date(),
      };

      const events: AgentEvent[] = [];
      for await (const event of executor.execute(
        mockLLMAdapter,
        "System prompt",
        "User prompt",
        ["failing-tool"],
        context,
      )) {
        events.push(event);
      }

      // Should still emit tool_result event with error
      const toolResultEvent = events.find(
        (e) => e.type === "tool_result",
      ) as any;
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent.output).toBeUndefined();

      // Should eventually complete
      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
    });

    it("should handle tool not found error", async () => {
      mockToolRegistry.has.mockReturnValue(false);

      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "nonexistent-tool",
                arguments: "{}",
              },
            },
          ],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: "tool_calls",
        },
        {
          content: "Tool not found",
          tool_calls: [],
          usage: { promptTokens: 150, completionTokens: 30, totalTokens: 180 },
          finishReason: "stop",
        },
      ]);

      const context: ToolContext = {
        executionId: "test-exec",
        toolId: "function-calling",
        createdAt: new Date(),
      };

      const events: AgentEvent[] = [];
      for await (const event of executor.execute(
        mockLLMAdapter,
        "System prompt",
        "User prompt",
        ["nonexistent-tool"],
        context,
      )) {
        events.push(event);
      }

      const toolResultEvent = events.find(
        (e) => e.type === "tool_result",
      ) as any;
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent.output).toBeUndefined();
    });

    it("should handle LLM call failures", async () => {
      mockLLMAdapter.setResponses([]);

      const context: ToolContext = {
        executionId: "test-exec",
        toolId: "function-calling",
        createdAt: new Date(),
      };

      const events: AgentEvent[] = [];
      for await (const event of executor.execute(
        mockLLMAdapter,
        "System prompt",
        "User prompt",
        [],
        context,
      )) {
        events.push(event);
      }

      const errorEvents = events.filter((e) => e.type === "error");
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        type: "error",
        error: expect.stringContaining("No more mock responses available"),
      });
    });

    it("should complete immediately when LLM returns no tool calls", async () => {
      mockLLMAdapter.setResponses([
        {
          content: "Direct answer without using tools",
          tool_calls: [],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: "stop",
        },
      ]);

      const context: ToolContext = {
        executionId: "test-exec",
        toolId: "function-calling",
        createdAt: new Date(),
      };

      const events: AgentEvent[] = [];
      for await (const event of executor.execute(
        mockLLMAdapter,
        "System prompt",
        "User prompt",
        [],
        context,
      )) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "complete",
        result: {
          success: true,
          summary: "Direct answer without using tools",
          tokensUsed: 150,
        },
      });
    });
  });

  // ==================== MCP Tool Execution Tests ====================

  describe("MCP Tool Execution", () => {
    it("should execute MCP tools when tool ID starts with mcp_", async () => {
      mockMCPManager.callTool.mockResolvedValue({
        content: [{ type: "text", text: "MCP tool result" }],
        isError: false,
      });

      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "mcp_server1_search",
                arguments: JSON.stringify({ query: "test" }),
              },
            },
          ],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: "tool_calls",
        },
        {
          content: "Result from MCP",
          tool_calls: [],
          usage: { promptTokens: 150, completionTokens: 30, totalTokens: 180 },
          finishReason: "stop",
        },
      ]);

      const context: ToolContext = {
        executionId: "test-exec",
        toolId: "function-calling",
        createdAt: new Date(),
      };

      const events: AgentEvent[] = [];
      for await (const event of executor.execute(
        mockLLMAdapter,
        "System prompt",
        "User prompt",
        ["mcp_server1_search"],
        context,
      )) {
        events.push(event);
      }

      expect(mockMCPManager.callTool).toHaveBeenCalledWith(
        "server1",
        "search",
        { query: "test" },
      );

      const toolResultEvent = events.find(
        (e) => e.type === "tool_result",
      ) as any;
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent.output).toBe("MCP tool result");
    });

    it("should handle MCP tool errors", async () => {
      mockMCPManager.callTool.mockResolvedValue({
        content: [{ type: "text", text: "MCP error occurred" }],
        isError: true,
      });

      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "mcp_server1_failing_tool",
                arguments: "{}",
              },
            },
          ],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: "tool_calls",
        },
        {
          content: "Handled MCP error",
          tool_calls: [],
          usage: { promptTokens: 150, completionTokens: 30, totalTokens: 180 },
          finishReason: "stop",
        },
      ]);

      const context: ToolContext = {
        executionId: "test-exec",
        toolId: "function-calling",
        createdAt: new Date(),
      };

      const events: AgentEvent[] = [];
      for await (const event of executor.execute(
        mockLLMAdapter,
        "System prompt",
        "User prompt",
        ["mcp_server1_failing_tool"],
        context,
      )) {
        events.push(event);
      }

      const toolResultEvent = events.find(
        (e) => e.type === "tool_result",
      ) as any;
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent.output).toBeUndefined();
    });
  });

  // ==================== getAllFunctionDefinitions Tests ====================

  describe("getAllFunctionDefinitions()", () => {
    it("should return function definitions for all registered tools", () => {
      const tool1 = new MockTool("tool-1", "Tool 1", "First tool", {
        success: true,
        data: {},
        metadata: {
          executionId: "test",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      });

      const tool2 = new MockTool("tool-2", "Tool 2", "Second tool", {
        success: true,
        data: {},
        metadata: {
          executionId: "test",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      });

      mockToolRegistry.getAll.mockReturnValue([tool1, tool2]);

      const definitions = executor.getAllFunctionDefinitions();

      expect(definitions).toHaveLength(2);
      expect(definitions[0]).toMatchObject({
        name: "tool-1",
        description: "First tool",
      });
      expect(definitions[1]).toMatchObject({
        name: "tool-2",
        description: "Second tool",
      });
    });

    it("should return empty array when no tools registered", () => {
      mockToolRegistry.getAll.mockReturnValue([]);

      const definitions = executor.getAllFunctionDefinitions();

      expect(definitions).toHaveLength(0);
    });
  });

  // ==================== ExecutionConfig Tests ====================

  describe("ExecutionConfig", () => {
    it("should use default config when no config provided", async () => {
      mockLLMAdapter.setResponses([
        {
          content: "Direct answer",
          tool_calls: [],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: "stop",
        },
      ]);

      const context: ToolContext = {
        executionId: "test-exec",
        toolId: "function-calling",
        createdAt: new Date(),
      };

      const events: AgentEvent[] = [];
      for await (const event of executor.execute(
        mockLLMAdapter,
        "System prompt",
        "User prompt",
        [],
        context,
      )) {
        events.push(event);
      }

      // Verify default config was used (maxIterations: 10, maxToolCalls: 20)
      expect(events[0].type).toBe("complete");
    });

    it("should merge custom config with defaults", async () => {
      mockLLMAdapter.setResponses([
        {
          content: "Answer",
          tool_calls: [],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: "stop",
        },
      ]);

      const context: ToolContext = {
        executionId: "test-exec",
        toolId: "function-calling",
        createdAt: new Date(),
      };

      const customConfig: Partial<ExecutionConfig> = {
        temperature: 0.5,
        maxTokens: 2000,
      };

      const events: AgentEvent[] = [];
      for await (const event of executor.execute(
        mockLLMAdapter,
        "System prompt",
        "User prompt",
        [],
        context,
        customConfig,
      )) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("complete");
    });
  });

  // ==================== executeWithContext Tests ====================

  describe("executeWithContext()", () => {
    it("should execute with AICapabilityContext", async () => {
      const functionDefs: FunctionDefinition[] = [
        {
          name: "test-tool",
          description: "Test tool",
          parameters: { type: "object", properties: {} },
        },
      ];

      mockCapabilityResolver.getToolFunctionDefinitions.mockResolvedValue(
        functionDefs,
      );
      mockCapabilityResolver.logCapabilityUsage.mockResolvedValue(undefined);

      const mockTool = new MockTool("test-tool", "Test Tool", "A test tool", {
        success: true,
        data: { result: "success" },
        metadata: {
          executionId: "test-exec",
          startTime: new Date(),
          endTime: new Date(),
          duration: 100,
        },
      });

      mockToolRegistry.has.mockReturnValue(true);
      mockToolRegistry.get.mockReturnValue(mockTool);

      mockLLMAdapter.setResponses([
        {
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "test-tool", arguments: "{}" },
            },
          ],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          finishReason: "tool_calls",
        },
        {
          content: "Final answer",
          tool_calls: [],
          usage: { promptTokens: 150, completionTokens: 30, totalTokens: 180 },
          finishReason: "stop",
        },
      ]);

      const context = {
        userId: "user-1",
        agentId: "agent-1",
        teamId: "team-1",
      };

      const events: AgentEvent[] = [];
      for await (const event of executor.executeWithContext(
        mockLLMAdapter,
        "System prompt",
        "User prompt",
        context,
      )) {
        events.push(event);
      }

      expect(
        mockCapabilityResolver.getToolFunctionDefinitions,
      ).toHaveBeenCalledWith(context);
      expect(mockCapabilityResolver.logCapabilityUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          capabilityType: "tool",
          capabilityId: "test-tool",
          userId: "user-1",
          success: true,
        }),
      );

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
    });

    it("should yield error when AICapabilityResolver not available", async () => {
      const executorWithoutResolver = new FunctionCallingExecutor(
        mockToolRegistry,
      );

      const context = { userId: "user-1" };

      const events: AgentEvent[] = [];
      for await (const event of executorWithoutResolver.executeWithContext(
        mockLLMAdapter,
        "System prompt",
        "User prompt",
        context,
      )) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "error",
        error: "AICapabilityResolver not available",
      });
    });
  });
});
