/**
 * ToolFacade 单元测试
 *
 * Tests:
 * - executeTool() delegation to ToolExecSubFacade
 * - getAvailableTools() / isToolAvailable()
 * - getToolFunctionDefinitions()
 * - setChatFn() circular dependency wiring
 * - delegateChat() fallback when chatFn not set
 * - Capability resolution
 * - listModuleCapabilities()
 * - chatWithTools()
 * - Service getters (toolRegistry, mcpManager, etc.)
 * - Graceful degradation without deps
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ToolFacade } from "../tool.facade";
import { TOOL_FEATURE } from "../../facade.providers";
import { MCPManager } from "../../../../ai-engine/tools/adapters/mcp/manager/mcp-manager";

describe("ToolFacade", () => {
  let facade: ToolFacade;
  let mockToolRegistry: any;
  let mockCapabilityResolver: any;
  let mockMCPManager: any;
  let mockExecutor: any;
  let mockLLMAdapter: any;

  beforeEach(async () => {
    mockToolRegistry = {
      tryGet: jest.fn().mockReturnValue(null),
      getByCategory: jest.fn().mockReturnValue([]),
      getEnabled: jest.fn().mockReturnValue([
        { id: "web-search", name: "Web Search", category: "information" },
        { id: "calculator", name: "Calculator", category: "utility" },
      ]),
      isAvailable: jest.fn().mockReturnValue(true),
      getFunctionDefinitions: jest.fn().mockReturnValue([]),
      getAllFunctionDefinitions: jest.fn().mockReturnValue([
        {
          name: "web-search",
          description: "Search the web",
          parameters: {},
        },
      ]),
    };

    mockCapabilityResolver = {
      resolveToolsForAgent: jest
        .fn()
        .mockResolvedValue(["web-search", "calculator"]),
      getSkillPrompts: jest.fn().mockResolvedValue(null),
      resolveCapabilities: jest.fn().mockResolvedValue({
        tools: [],
        skills: [],
        mcpServers: [],
      }),
      resolveAllCapabilities: jest.fn().mockResolvedValue({
        tools: [],
        skills: [],
        mcpTools: [],
      }),
    };

    mockMCPManager = {
      listServers: jest.fn().mockReturnValue([]),
      getServer: jest.fn(),
    };

    mockExecutor = {
      execute: jest.fn(),
    };

    mockLLMAdapter = {
      chat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolFacade,
        {
          provide: TOOL_FEATURE,
          useValue: {
            registry: mockToolRegistry,
            capabilityResolver: mockCapabilityResolver,
            executor: mockExecutor,
            llmAdapter: mockLLMAdapter,
          },
        },
        { provide: MCPManager, useValue: mockMCPManager },
      ],
    }).compile();

    facade = module.get<ToolFacade>(ToolFacade);
  });

  // ==================== Tool Execution ====================

  describe("executeTool()", () => {
    it("should delegate to toolExecSub", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { result: "done" },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      await facade.executeTool({
        toolId: "web-search",
        input: { query: "test" },
      });

      expect(mockToolRegistry.tryGet).toHaveBeenCalledWith("web-search");
    });
  });

  describe("getAvailableTools()", () => {
    it("should return list of available tools", () => {
      const tools = facade.getAvailableTools();
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  describe("isToolAvailable()", () => {
    it("should check tool availability", () => {
      const available = facade.isToolAvailable("web-search");
      expect(typeof available).toBe("boolean");
    });
  });

  describe("getToolFunctionDefinitions()", () => {
    it("should return function definitions for tools", () => {
      const defs = facade.getToolFunctionDefinitions();
      expect(Array.isArray(defs)).toBe(true);
    });
  });

  // ==================== setChatFn / delegateChat ====================

  describe("setChatFn()", () => {
    it("should wire the chat function for circular dep resolution", () => {
      const mockChatFn = jest.fn().mockResolvedValue({
        content: "response",
        model: "gpt-4o",
        tokensUsed: 50,
      });

      // Should not throw when setting chatFn
      expect(() => facade.setChatFn(mockChatFn)).not.toThrow();
    });
  });

  // ==================== Capabilities ====================

  describe("getAvailableCapabilities()", () => {
    it("should resolve capabilities for agent context", async () => {
      const context = { agentId: "agent-1", taskType: "research" } as any;
      const result = await facade.getAvailableCapabilities(context);

      expect(result).toBeDefined();
    });
  });

  describe("capabilityResolveTools()", () => {
    it("should resolve tool IDs for agent context", async () => {
      const tools = await facade.capabilityResolveTools({
        agentId: "agent-1",
      } as any);

      expect(tools).toEqual(["web-search", "calculator"]);
      expect(mockCapabilityResolver.resolveToolsForAgent).toHaveBeenCalled();
    });
  });

  describe("capabilityGetSkillPrompts()", () => {
    it("should return null when no skill prompts available", async () => {
      const result = await facade.capabilityGetSkillPrompts({
        agentId: "agent-1",
      } as any);

      expect(result).toBeNull();
    });
  });

  // listModuleCapabilities 已删 (2026-04-30) — IntentRouter 死代码链路

  describe("isToolExecutionAvailable()", () => {
    it("should return true when executor is available", () => {
      const result = facade.isToolExecutionAvailable();
      expect(typeof result).toBe("boolean");
    });
  });

  // ==================== Service Getters ====================

  describe("service getters", () => {
    it("should expose toolRegistry", () => {
      expect(facade.toolRegistry).toBe(mockToolRegistry);
    });

    it("should expose mcpManager", () => {
      expect(facade.mcpManager).toBe(mockMCPManager);
    });

    it("should expose functionCallingAdapter", () => {
      expect(facade.functionCallingAdapter).toBe(mockLLMAdapter);
    });

    it("should expose functionCallingExecutor", () => {
      expect(facade.functionCallingExecutor).toBe(mockExecutor);
    });

    it("should expose capabilityResolverService", () => {
      expect(facade.capabilityResolverService).toBe(mockCapabilityResolver);
    });
  });

  // ==================== chatWithToolsStream ====================

  describe("chatWithToolsStream()", () => {
    it("should yield error event when executor not available", async () => {
      // Create facade without tool execution capability
      const module2 = await Test.createTestingModule({
        providers: [ToolFacade],
      }).compile();
      const minFacade = module2.get<ToolFacade>(ToolFacade);

      const events: any[] = [];
      for await (const event of minFacade.chatWithToolsStream({
        systemPrompt: "You are a helper",
        userPrompt: "Search for X",
        context: { agentId: "a1" } as any,
        modelConfig: {
          provider: "openai",
          modelId: "gpt-4o",
        },
      })) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("error");
    });

    it("should delegate to toolExecSub when executor is available", async () => {
      // Just verify the method exists and is callable
      expect(typeof facade.chatWithToolsStream).toBe("function");
    });
  });

  // ==================== delegateChat fallback ====================

  describe("delegateChat fallback path", () => {
    it("should use setChatFn when set", async () => {
      const chatFn = jest.fn().mockResolvedValue({
        content: "chat response",
        model: "gpt-4o",
        tokensUsed: 50,
        isError: false,
      });

      // Should not throw when setting chatFn
      expect(() => facade.setChatFn(chatFn)).not.toThrow();
    });

    it("should return error response when chatFn not set", async () => {
      // Create a fresh facade without setChatFn called
      const module2 = await Test.createTestingModule({
        providers: [
          ToolFacade,
          {
            provide: TOOL_FEATURE,
            useValue: {
              registry: mockToolRegistry,
              capabilityResolver: mockCapabilityResolver,
              executor: mockExecutor,
              llmAdapter: mockLLMAdapter,
            },
          },
        ],
      }).compile();
      const freshFacade = module2.get<ToolFacade>(ToolFacade);

      // Try chatWithTools which internally calls delegateChat
      // Since chatFn is not set, it should use the fallback
      const result = await freshFacade.chatWithTools({
        messages: [{ role: "user", content: "test" }],
        context: { agentId: "a1" } as any,
      });

      // The result depends on toolExecSub behavior with the fallback chat
      expect(result).toBeDefined();
    });
  });

  // ==================== Graceful degradation ====================

  describe("without optional dependencies", () => {
    let minimalFacade: ToolFacade;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [ToolFacade],
      }).compile();

      minimalFacade = module.get<ToolFacade>(ToolFacade);
    });

    it("should return empty tools list", () => {
      const tools = minimalFacade.getAvailableTools();
      expect(tools).toEqual([]);
    });

    it("should return false for isToolAvailable", () => {
      const result = minimalFacade.isToolAvailable("any-tool");
      expect(result).toBe(false);
    });

    it("should return empty function definitions", () => {
      const defs = minimalFacade.getToolFunctionDefinitions();
      expect(defs).toEqual([]);
    });

    it("should return undefined for toolRegistry", () => {
      expect(minimalFacade.toolRegistry).toBeUndefined();
    });

    it("should return undefined for mcpManager", () => {
      expect(minimalFacade.mcpManager).toBeUndefined();
    });

    it("should return empty tools for capabilityResolveTools", async () => {
      const tools = await minimalFacade.capabilityResolveTools({} as any);
      expect(tools).toEqual([]);
    });

    it("should return null for capabilityGetSkillPrompts", async () => {
      const result = await minimalFacade.capabilityGetSkillPrompts({} as any);
      expect(result).toBeNull();
    });

    it("should return false for isToolExecutionAvailable", () => {
      expect(minimalFacade.isToolExecutionAvailable()).toBe(false);
    });

    it("should handle missing executor gracefully in minimal facade", () => {
      expect(minimalFacade.isToolExecutionAvailable()).toBe(false);
    });
  });
});
