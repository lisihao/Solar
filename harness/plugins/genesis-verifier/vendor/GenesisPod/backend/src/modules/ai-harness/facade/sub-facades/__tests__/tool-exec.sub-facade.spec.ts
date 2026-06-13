/**
 * ToolExecSubFacade Unit Tests
 */

import { ToolExecSubFacade } from "../tool-exec.sub-facade";

// ============================================================================
// Mocks / Factories
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockToolRegistry: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockToolExecutor: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockLlmAdapter: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCapabilityResolver: any;
let mockChatFn: jest.MockedFunction<(req: unknown) => Promise<unknown>>;

function createFacade(
  options: {
    withRegistry?: boolean;
    withExecutor?: boolean;
    withLlmAdapter?: boolean;
    withCapabilityResolver?: boolean;
  } = {},
): ToolExecSubFacade {
  const toolFeature = options.withRegistry
    ? {
        registry: mockToolRegistry,
        executor: options.withExecutor ? mockToolExecutor : undefined,
        llmAdapter: options.withLlmAdapter ? mockLlmAdapter : undefined,
      }
    : undefined;

  return new ToolExecSubFacade(
    toolFeature,
    options.withCapabilityResolver ? mockCapabilityResolver : undefined,
    mockChatFn,
  );
}

// ============================================================================
// Test suite
// ============================================================================

describe("ToolExecSubFacade", () => {
  beforeEach(() => {
    mockToolRegistry = {
      tryGet: jest.fn().mockReturnValue(null),
      getByCategory: jest.fn().mockReturnValue([]),
      getEnabled: jest.fn().mockReturnValue([]),
      isAvailable: jest.fn().mockReturnValue(false),
      getFunctionDefinitions: jest.fn().mockReturnValue([]),
      getAllFunctionDefinitions: jest.fn().mockReturnValue([]),
    };

    mockToolExecutor = {
      executeWithContext: jest.fn(),
    };

    mockLlmAdapter = {
      setConfig: jest.fn(),
    };

    mockCapabilityResolver = {
      resolveAllCapabilities: jest.fn().mockResolvedValue({
        tools: [],
        skills: [],
        mcpTools: [],
      }),
    };

    mockChatFn = jest.fn().mockResolvedValue({
      content: "Hello response",
      model: "gpt-4o",
      tokensUsed: 100,
      isError: false,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // executeTool — no registry
  // --------------------------------------------------------------------------

  describe("executeTool — no registry", () => {
    it("should return error when tool registry not available", async () => {
      const facade = createFacade();

      const result = await facade.executeTool({
        toolId: "web_search",
        input: { query: "test" },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TOOL_REGISTRY_NOT_AVAILABLE");
      expect(result.error?.retryable).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // executeTool — tool not found
  // --------------------------------------------------------------------------

  describe("executeTool — tool not found", () => {
    it("should return TOOL_NOT_FOUND error when tool not in registry", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const facade = createFacade({ withRegistry: true });
      const result = await facade.executeTool({
        toolId: "nonexistent",
        input: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TOOL_NOT_FOUND");
      expect(result.error?.message).toContain("nonexistent");
      expect(result.error?.retryable).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // executeTool — tool disabled
  // --------------------------------------------------------------------------

  describe("executeTool — tool disabled", () => {
    it("should return TOOL_DISABLED error when tool.enabled === false", async () => {
      const disabledTool = {
        id: "web_search",
        name: "Web Search",
        description: "Search",
        category: "information",
        enabled: false,
        defaultTimeout: 30000,
        execute: jest.fn(),
      };
      mockToolRegistry.tryGet.mockReturnValue(disabledTool);

      const facade = createFacade({ withRegistry: true });
      const result = await facade.executeTool({
        toolId: "web_search",
        input: { query: "test" },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TOOL_DISABLED");
    });
  });

  // --------------------------------------------------------------------------
  // executeTool — success
  // --------------------------------------------------------------------------

  describe("executeTool — success", () => {
    it("should execute tool and return success result", async () => {
      const mockTool = {
        id: "web_search",
        name: "Web Search",
        description: "Search the web",
        category: "information",
        enabled: true,
        defaultTimeout: 30000,
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { results: ["result1", "result2"] },
          error: undefined,
          metadata: { tokensUsed: 50 },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const facade = createFacade({ withRegistry: true });
      const result = await facade.executeTool<{ results: string[] }>({
        toolId: "web_search",
        input: { query: "AI news" },
        context: { userId: "user-1", sessionId: "sess-1" },
        timeout: 60000,
      });

      expect(result.success).toBe(true);
      expect(result.data?.results).toContain("result1");
      expect(result.metadata?.tokensUsed).toBe(50);
      expect(mockTool.execute).toHaveBeenCalledWith(
        { query: "AI news" },
        expect.objectContaining({
          toolId: "web_search",
          userId: "user-1",
          sessionId: "sess-1",
          timeout: 60000,
        }),
      );
    });

    it("should include error details in result when tool returns error", async () => {
      const mockTool = {
        id: "web_search",
        enabled: true,
        defaultTimeout: 30000,
        execute: jest.fn().mockResolvedValue({
          success: false,
          data: undefined,
          error: {
            code: "RATE_LIMIT",
            message: "Too many requests",
            retryable: true,
          },
          metadata: { tokensUsed: 0 },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const facade = createFacade({ withRegistry: true });
      const result = await facade.executeTool({
        toolId: "web_search",
        input: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("RATE_LIMIT");
      expect(result.error?.retryable).toBe(true);
    });

    it("should use tool defaultTimeout when request.timeout is not provided", async () => {
      const mockTool = {
        id: "slow_tool",
        enabled: true,
        defaultTimeout: 120000,
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {},
          error: undefined,
          metadata: { tokensUsed: 0 },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const facade = createFacade({ withRegistry: true });
      await facade.executeTool({ toolId: "slow_tool", input: {} });

      expect(mockTool.execute).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ timeout: 120000 }),
      );
    });

    it("should use 30000 as default timeout when neither request nor tool specifies it", async () => {
      const mockTool = {
        id: "tool-no-timeout",
        enabled: true,
        defaultTimeout: undefined,
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {},
          error: undefined,
          metadata: { tokensUsed: 0 },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const facade = createFacade({ withRegistry: true });
      await facade.executeTool({ toolId: "tool-no-timeout", input: {} });

      expect(mockTool.execute).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ timeout: 30000 }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // executeTool — exception handling
  // --------------------------------------------------------------------------

  describe("executeTool — exception handling", () => {
    it("should return TOOL_EXECUTION_ERROR when tool.execute throws", async () => {
      const mockTool = {
        id: "buggy_tool",
        enabled: true,
        defaultTimeout: 30000,
        execute: jest.fn().mockRejectedValue(new Error("Internal tool error")),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const facade = createFacade({ withRegistry: true });
      const result = await facade.executeTool({
        toolId: "buggy_tool",
        input: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TOOL_EXECUTION_ERROR");
      expect(result.error?.message).toBe("Internal tool error");
      expect(result.error?.retryable).toBe(true);
    });

    it("should handle non-Error throw values", async () => {
      const mockTool = {
        id: "buggy_tool",
        enabled: true,
        defaultTimeout: 30000,
        execute: jest.fn().mockRejectedValue("plain string error"),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const facade = createFacade({ withRegistry: true });
      const result = await facade.executeTool({
        toolId: "buggy_tool",
        input: {},
      });

      expect(result.error?.message).toBe("plain string error");
    });
  });

  // --------------------------------------------------------------------------
  // getAvailableTools
  // --------------------------------------------------------------------------

  describe("getAvailableTools", () => {
    it("should return empty array when no registry", () => {
      const facade = createFacade();
      const tools = facade.getAvailableTools();

      expect(tools).toEqual([]);
    });

    it("should return all enabled tools when no category filter", () => {
      const toolList = [
        {
          id: "web_search",
          name: "Web Search",
          description: "Search",
          category: "information",
          enabled: true,
          tags: ["search"],
        },
        {
          id: "code_gen",
          name: "Code Gen",
          description: "Code",
          category: "generation",
          enabled: true,
          tags: [],
        },
      ];
      mockToolRegistry.getEnabled.mockReturnValue(toolList);

      const facade = createFacade({ withRegistry: true });
      const tools = facade.getAvailableTools();

      expect(tools).toHaveLength(2);
      expect(tools[0].id).toBe("web_search");
      expect(tools[0].enabled).toBe(true);
    });

    it("should filter tools by category when provided", () => {
      const infoTools = [
        {
          id: "web_search",
          name: "Web Search",
          description: "desc",
          category: "information",
          enabled: true,
          tags: [],
        },
      ];
      mockToolRegistry.getByCategory.mockReturnValue(infoTools);

      const facade = createFacade({ withRegistry: true });
      const tools = facade.getAvailableTools("information");

      expect(mockToolRegistry.getByCategory).toHaveBeenCalledWith(
        "information",
      );
      expect(tools).toHaveLength(1);
      expect(tools[0].category).toBe("information");
    });

    it("should mark tool as enabled=true when tool.enabled is undefined", () => {
      const toolList = [
        {
          id: "tool1",
          name: "Tool 1",
          description: "desc",
          category: "processing",
          enabled: undefined,
          tags: [],
        },
      ];
      mockToolRegistry.getEnabled.mockReturnValue(toolList);

      const facade = createFacade({ withRegistry: true });
      const tools = facade.getAvailableTools();

      expect(tools[0].enabled).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // isToolAvailable
  // --------------------------------------------------------------------------

  describe("isToolAvailable", () => {
    it("should return false when no registry", () => {
      const facade = createFacade();
      expect(facade.isToolAvailable("web_search")).toBe(false);
    });

    it("should return true when registry says tool is available", () => {
      mockToolRegistry.isAvailable.mockReturnValue(true);

      const facade = createFacade({ withRegistry: true });
      expect(facade.isToolAvailable("web_search")).toBe(true);
      expect(mockToolRegistry.isAvailable).toHaveBeenCalledWith("web_search");
    });

    it("should return false when registry says tool is not available", () => {
      mockToolRegistry.isAvailable.mockReturnValue(false);

      const facade = createFacade({ withRegistry: true });
      expect(facade.isToolAvailable("disabled_tool")).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getToolFunctionDefinitions
  // --------------------------------------------------------------------------

  describe("getToolFunctionDefinitions", () => {
    it("should return empty array when no registry", () => {
      const facade = createFacade();
      expect(facade.getToolFunctionDefinitions()).toEqual([]);
    });

    it("should return all function definitions when no toolIds provided", () => {
      const allDefs = [
        { name: "web_search", description: "Search", parameters: {} },
        { name: "code_gen", description: "Code", parameters: {} },
      ];
      mockToolRegistry.getAllFunctionDefinitions.mockReturnValue(allDefs);

      const facade = createFacade({ withRegistry: true });
      const defs = facade.getToolFunctionDefinitions();

      expect(mockToolRegistry.getAllFunctionDefinitions).toHaveBeenCalled();
      expect(defs).toBe(allDefs);
    });

    it("should return filtered definitions when toolIds provided", () => {
      const filteredDefs = [
        { name: "web_search", description: "Search", parameters: {} },
      ];
      mockToolRegistry.getFunctionDefinitions.mockReturnValue(filteredDefs);

      const facade = createFacade({ withRegistry: true });
      const defs = facade.getToolFunctionDefinitions(["web_search"]);

      expect(mockToolRegistry.getFunctionDefinitions).toHaveBeenCalledWith([
        "web_search",
      ]);
      expect(defs).toBe(filteredDefs);
    });
  });

  // --------------------------------------------------------------------------
  // getAvailableCapabilities
  // --------------------------------------------------------------------------

  describe("getAvailableCapabilities", () => {
    it("should return empty capability summary when no resolver", async () => {
      const facade = createFacade();
      const result = await facade.getAvailableCapabilities({
        agentId: "agent-1",
      });

      expect(result.tools).toEqual([]);
      expect(result.skills).toEqual([]);
      expect(result.mcpTools).toEqual([]);
    });

    it("should resolve capabilities from capabilityResolver", async () => {
      mockCapabilityResolver.resolveAllCapabilities.mockResolvedValue({
        tools: ["web_search", "code_gen"],
        skills: ["research_skill"],
        mcpTools: [
          {
            serverId: "server-1",
            toolName: "mcp-tool",
            description: "MCP tool",
          },
        ],
      });

      // Registry lookup for tool details
      mockToolRegistry.tryGet.mockImplementation((id: string) => {
        if (id === "web_search") {
          return {
            id: "web_search",
            name: "Web Search",
            description: "Search the web",
            category: "information",
            enabled: true,
            toFunctionDefinition: () => ({
              name: "web_search",
              description: "Search",
              parameters: {},
            }),
          };
        }
        return null;
      });

      const facade = createFacade({
        withRegistry: true,
        withCapabilityResolver: true,
      });
      const result = await facade.getAvailableCapabilities({
        agentId: "agent-1",
      });

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].id).toBe("web_search");
      expect(result.tools[0].name).toBe("Web Search");
      expect(result.tools[1].id).toBe("code_gen");
      expect(result.tools[1].name).toBe("code_gen"); // Falls back to ID when tool not found
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].id).toBe("research_skill");
      expect(result.mcpTools).toHaveLength(1);
      expect(result.mcpTools[0].toolName).toBe("mcp-tool");
    });

    it("should handle tools with no registry entry gracefully", async () => {
      mockCapabilityResolver.resolveAllCapabilities.mockResolvedValue({
        tools: ["unknown_tool"],
        skills: [],
        mcpTools: [],
      });
      mockToolRegistry.tryGet.mockReturnValue(null);

      const facade = createFacade({
        withRegistry: true,
        withCapabilityResolver: true,
      });
      const result = await facade.getAvailableCapabilities({
        agentId: "agent-1",
      });

      expect(result.tools[0].name).toBe("unknown_tool");
      expect(result.tools[0].description).toBe("");
      expect(result.tools[0].category).toBe("information");
    });
  });

  // --------------------------------------------------------------------------
  // chatWithTools
  // --------------------------------------------------------------------------

  describe("chatWithTools", () => {
    it("should fall back to plain chat when no capabilityResolver", async () => {
      const facade = createFacade({ withRegistry: true });
      const result = await facade.chatWithTools({
        messages: [{ role: "user", content: "Hello" }],
        context: { agentId: "agent-1" },
      });

      expect(result.content).toBe("Hello response");
      expect(result.toolCalls).toEqual([]);
      expect(mockChatFn).toHaveBeenCalled();
    });

    it("should fall back to plain chat when no executor", async () => {
      const facade = createFacade({
        withRegistry: true,
        withCapabilityResolver: true,
      });
      const result = await facade.chatWithTools({
        messages: [{ role: "user", content: "Test" }],
        context: { agentId: "agent-1" },
        modelType: undefined,
        model: "gpt-4o",
      });

      expect(result.content).toBe("Hello response");
      expect(result.model).toBe("gpt-4o");
    });

    it("should use placeholder implementation when both resolver and executor available", async () => {
      const facade = createFacade({
        withRegistry: true,
        withCapabilityResolver: true,
        withExecutor: true,
        withLlmAdapter: true,
      });
      const result = await facade.chatWithTools({
        messages: [{ role: "user", content: "Hello" }],
        context: { agentId: "agent-1" },
      });

      // placeholder returns plain chat result
      expect(result.content).toBe("Hello response");
      expect(result.toolCalls).toEqual([]);
    });

    it("should pass isError from chat response", async () => {
      mockChatFn.mockResolvedValue({
        content: "Error occurred",
        model: "gpt-4o",
        tokensUsed: 0,
        isError: true,
      });

      const facade = createFacade();
      const result = await facade.chatWithTools({
        messages: [{ role: "user", content: "Trigger error" }],
        context: { agentId: "agent-1" },
      });

      expect(result.isError).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // chatWithToolsStream
  // --------------------------------------------------------------------------

  describe("chatWithToolsStream", () => {
    it("should yield error event when no executor/adapter", async () => {
      const facade = createFacade({ withRegistry: true });
      const events: unknown[] = [];

      for await (const event of facade.chatWithToolsStream({
        systemPrompt: "System",
        userPrompt: "User",
        context: { agentId: "agent-1" },
        modelConfig: { provider: "openai", modelId: "gpt-4o" },
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect((events[0] as { type: string }).type).toBe("error");
    });

    it("should stream events when executor and adapter are available", async () => {
      const fakeEvents = [
        { type: "thinking", content: "Processing..." },
        { type: "final", content: "Done" },
      ];

      async function* eventStream() {
        for (const e of fakeEvents) yield e;
      }

      mockToolExecutor.executeWithContext = jest
        .fn()
        .mockReturnValue(eventStream());

      const facade = createFacade({
        withRegistry: true,
        withExecutor: true,
        withLlmAdapter: true,
      });

      const events: unknown[] = [];
      for await (const event of facade.chatWithToolsStream({
        systemPrompt: "System",
        userPrompt: "User",
        context: { agentId: "agent-1" },
        modelConfig: {
          provider: "openai",
          modelId: "gpt-4o",
          apiKey: "sk-test",
          apiEndpoint: "https://api.openai.com",
        },
        executionConfig: { maxIterations: 5 },
      })) {
        events.push(event);
      }

      expect(mockLlmAdapter.setConfig).toHaveBeenCalledWith({
        provider: "openai",
        modelId: "gpt-4o",
        apiKey: "sk-test",
        apiEndpoint: "https://api.openai.com",
      });
      expect(events).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // isToolExecutionAvailable
  // --------------------------------------------------------------------------

  describe("isToolExecutionAvailable", () => {
    it("should return false when no tools feature", () => {
      const facade = createFacade();
      expect(facade.isToolExecutionAvailable()).toBe(false);
    });

    it("should return false when registry exists but no executor", () => {
      const facade = createFacade({ withRegistry: true });
      expect(facade.isToolExecutionAvailable()).toBe(false);
    });

    it("should return false when executor exists but no llmAdapter", () => {
      const facade = createFacade({ withRegistry: true, withExecutor: true });
      expect(facade.isToolExecutionAvailable()).toBe(false);
    });

    it("should return true when both executor and llmAdapter available", () => {
      const facade = createFacade({
        withRegistry: true,
        withExecutor: true,
        withLlmAdapter: true,
      });
      expect(facade.isToolExecutionAvailable()).toBe(true);
    });
  });
});
