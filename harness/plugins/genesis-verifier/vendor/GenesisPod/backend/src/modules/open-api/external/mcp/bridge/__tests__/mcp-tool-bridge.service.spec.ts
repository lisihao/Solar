import { Test, TestingModule } from "@nestjs/testing";
import { MCPToolBridgeService } from "../mcp-tool-bridge.service";
import {
  AgentRegistry,
  ChatFacade,
  ToolFacade,
  AgentFacade,
} from "../../../../../ai-harness/facade";
import { ToolRegistry, SkillRegistry } from "../../../../../ai-engine/facade";

jest.mock("../../../../../ai-engine/facade", () => ({
  ToolRegistry: jest.fn(),
  SkillRegistry: jest.fn(),
  AgentRegistry: jest.fn(),
  ChatFacade: jest.fn(),
  ToolFacade: jest.fn(),
  AgentFacade: jest.fn(),
}));
jest.mock("../../../../../ai-harness/facade", () => ({
  ToolRegistry: jest.fn(),
  SkillRegistry: jest.fn(),
  AgentRegistry: jest.fn(),
  ChatFacade: jest.fn(),
  ToolFacade: jest.fn(),
  AgentFacade: jest.fn(),
}));

describe("MCPToolBridgeService", () => {
  let service: MCPToolBridgeService;

  const mockTool = {
    id: "web-search",
    name: "Web Search",
    description: "Search the web",
    category: "search",
    tags: ["web", "search"],
    enabled: true,
    inputSchema: { type: "object", properties: {} },
    toFunctionDefinition: () => ({
      parameters: { type: "object", properties: {} },
    }),
  };

  const mockDisabledTool = {
    ...mockTool,
    id: "disabled-tool",
    enabled: false,
  };

  const mockSkill = {
    id: "skill-analysis",
    name: "Analysis Skill",
    description: "Analyze content",
    domain: "analysis",
    layer: "L4",
    tags: ["analysis"],
    version: "1.0.0",
    inputSchema: null,
    requiredTools: [],
  };

  const mockAgent = {
    id: "research-agent",
    name: "Research Agent",
    description: "Performs research",
    capabilities: ["research", "analysis"],
    requiredTools: ["web-search"],
  };

  const mockToolRegistry = {
    getAll: jest.fn().mockReturnValue([mockTool, mockDisabledTool]),
    size: jest.fn().mockReturnValue(2),
    getStats: jest.fn(),
  };

  const mockSkillRegistry = {
    getAll: jest.fn().mockReturnValue([mockSkill]),
    size: jest.fn().mockReturnValue(1),
    getStats: jest.fn(),
  };

  const mockAgentRegistry = {
    getAll: jest.fn().mockReturnValue([mockAgent]),
    size: jest.fn().mockReturnValue(1),
  };

  const mockChatFacade = {
    chat: jest.fn(),
    getAvailableModels: jest.fn(),
  };

  const mockToolFacade = {
    executeTool: jest.fn(),
  };

  const mockAgentFacade = {
    executeAgent: jest.fn(),
  };

  const mockContext = {
    apiKeyId: "test-api-key",
    sessionId: "test-session",
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MCPToolBridgeService,
        { provide: ChatFacade, useValue: mockChatFacade },
        { provide: ToolFacade, useValue: mockToolFacade },
        { provide: AgentFacade, useValue: mockAgentFacade },
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: SkillRegistry, useValue: mockSkillRegistry },
        { provide: AgentRegistry, useValue: mockAgentRegistry },
      ],
    }).compile();

    service = module.get<MCPToolBridgeService>(MCPToolBridgeService);
  });

  // =========================================================================
  // listBridgedTools
  // =========================================================================

  describe("listBridgedTools", () => {
    it("should list enabled tools from ToolRegistry", () => {
      const tools = service.listBridgedTools();

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("tool_web-search");
      // Disabled tool should NOT appear
      expect(toolNames).not.toContain("tool_disabled-tool");
    });

    it("should list skills from SkillRegistry", () => {
      const tools = service.listBridgedTools();

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("skill_skill-analysis");
    });

    it("should list agents from AgentRegistry", () => {
      const tools = service.listBridgedTools();

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("agent_research-agent");
    });

    it("should prefix tool names correctly by source", () => {
      const tools = service.listBridgedTools();

      const registryTool = tools.find((t) => t.name === "tool_web-search");
      expect(registryTool?.source).toBe("registry-tool");
      expect(registryTool?.description).toContain("[Tool]");

      const registrySkill = tools.find(
        (t) => t.name === "skill_skill-analysis",
      );
      expect(registrySkill?.source).toBe("registry-skill");
      expect(registrySkill?.description).toContain("[Skill:");

      const registryAgent = tools.find(
        (t) => t.name === "agent_research-agent",
      );
      expect(registryAgent?.source).toBe("registry-agent");
      expect(registryAgent?.description).toContain("[Agent]");
    });

    it("should build skill schema when inputSchema is null", () => {
      const skillWithoutSchema = { ...mockSkill, inputSchema: null };
      mockSkillRegistry.getAll.mockReturnValue([skillWithoutSchema]);

      const tools = service.listBridgedTools();
      const skillTool = tools.find((t) => t.name === "skill_skill-analysis");

      expect(skillTool?.inputSchema).toMatchObject({
        type: "object",
        properties: expect.objectContaining({
          task: expect.any(Object),
          context: expect.any(Object),
        }),
        required: ["task"],
      });
    });

    it("should build agent schema", () => {
      const tools = service.listBridgedTools();
      const agentTool = tools.find((t) => t.name === "agent_research-agent");

      expect(agentTool?.inputSchema).toMatchObject({
        type: "object",
        properties: expect.objectContaining({
          task: expect.any(Object),
          context: expect.any(Object),
        }),
        required: ["task"],
      });
    });

    it("should handle missing registries gracefully", async () => {
      const moduleNoRegistry = await Test.createTestingModule({
        providers: [
          MCPToolBridgeService,
          { provide: ChatFacade, useValue: mockChatFacade },
          { provide: ToolFacade, useValue: mockToolFacade },
          { provide: AgentFacade, useValue: mockAgentFacade },
        ],
      }).compile();

      const serviceNoRegistry =
        moduleNoRegistry.get<MCPToolBridgeService>(MCPToolBridgeService);
      const tools = serviceNoRegistry.listBridgedTools();
      expect(tools).toHaveLength(0);
    });

    it("should use skill inputSchema when provided", () => {
      const skillWithSchema = {
        ...mockSkill,
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      };
      mockSkillRegistry.getAll.mockReturnValue([skillWithSchema]);

      const tools = service.listBridgedTools();
      const skillTool = tools.find((t) => t.name === "skill_skill-analysis");
      expect(skillTool?.inputSchema).toEqual(skillWithSchema.inputSchema);
    });
  });

  // =========================================================================
  // isBridgedTool
  // =========================================================================

  describe("isBridgedTool", () => {
    it("should return true for tool_ prefix", () => {
      expect(service.isBridgedTool("tool_web_search")).toBe(true);
    });

    it("should return true for skill_ prefix", () => {
      expect(service.isBridgedTool("skill_analysis")).toBe(true);
    });

    it("should return true for agent_ prefix", () => {
      expect(service.isBridgedTool("agent_researcher")).toBe(true);
    });

    it("should return false for curated tools", () => {
      expect(service.isBridgedTool("genesis_ask")).toBe(false);
      expect(service.isBridgedTool("genesis_deep_research")).toBe(false);
    });

    it("should return false for arbitrary names", () => {
      expect(service.isBridgedTool("arbitrary_name")).toBe(false);
    });
  });

  // =========================================================================
  // getBridgedToolMeta
  // =========================================================================

  describe("getBridgedToolMeta", () => {
    it("should return meta after listBridgedTools has been called", () => {
      service.listBridgedTools();
      const meta = service.getBridgedToolMeta("tool_web-search");

      expect(meta).toBeDefined();
      expect(meta!.source).toBe("registry-tool");
      expect(meta!.registryId).toBe("web-search");
      expect(meta!.category).toBe("search");
    });

    it("should return undefined for unknown tool", () => {
      service.listBridgedTools();
      const meta = service.getBridgedToolMeta("unknown_tool");
      expect(meta).toBeUndefined();
    });
  });

  // =========================================================================
  // executeBridgedTool
  // =========================================================================

  describe("executeBridgedTool", () => {
    beforeEach(() => {
      service.listBridgedTools(); // populate meta
    });

    it("should return error for unknown tool", async () => {
      const result = await service.executeBridgedTool(
        "unknown_tool",
        {},
        mockContext,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown bridged tool");
    });

    it("should execute registry-tool via toolFacade", async () => {
      mockToolFacade.executeTool.mockResolvedValue({
        success: true,
        data: { results: ["item1"] },
        metadata: {
          executionId: "exec-1",
          duration: 100,
          tokensUsed: 50,
        },
      });

      const result = await service.executeBridgedTool(
        "tool_web-search",
        { query: "test" },
        mockContext,
      );

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.result).toEqual({ results: ["item1"] });
      expect(parsed.metadata.executionId).toBe("exec-1");
    });

    it("should return error when registry-tool fails", async () => {
      mockToolFacade.executeTool.mockResolvedValue({
        success: false,
        error: {
          message: "Tool failed",
          code: "TOOL_ERROR",
          retryable: false,
        },
      });

      const result = await service.executeBridgedTool(
        "tool_web-search",
        {},
        mockContext,
      );
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.error).toBe("Tool failed");
    });

    it("should execute registry-skill via chatFacade", async () => {
      mockChatFacade.chat.mockResolvedValue({
        content: "Analysis result",
        model: "gpt-4o",
        tokensUsed: 100,
        isError: false,
      });

      const result = await service.executeBridgedTool(
        "skill_skill-analysis",
        { task: "Analyze this", context: "some context" },
        mockContext,
      );

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.result).toBe("Analysis result");
      expect(parsed.skillUsed).toBe("skill-analysis");
    });

    it("should execute skill without context", async () => {
      mockChatFacade.chat.mockResolvedValue({
        content: "Result",
        model: "gpt-4o",
        tokensUsed: 50,
        isError: false,
      });

      await service.executeBridgedTool(
        "skill_skill-analysis",
        { task: "Do task" },
        mockContext,
      );

      expect(mockChatFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "Do task" }),
          ]),
          additionalSkills: ["skill-analysis"],
        }),
      );
    });

    it("should use input arg as task when task not specified for skill", async () => {
      mockChatFacade.chat.mockResolvedValue({
        content: "Result",
        model: "gpt-4o",
        tokensUsed: 50,
        isError: false,
      });

      await service.executeBridgedTool(
        "skill_skill-analysis",
        { input: "input text" },
        mockContext,
      );

      expect(mockChatFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: "input text" }),
          ]),
        }),
      );
    });

    it("should execute registry-agent via agentFacade", async () => {
      mockAgentFacade.executeAgent.mockResolvedValue({
        success: true,
        content: "Research complete",
        tokensUsed: 500,
        duration: 5000,
        retryable: false,
      });

      const result = await service.executeBridgedTool(
        "agent_research-agent",
        { task: "Research AI", context: "tech" },
        mockContext,
      );

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.result).toBe("Research complete");
      expect(parsed.agentUsed).toBe("research-agent");
    });

    it("should return error when agent fails", async () => {
      mockAgentFacade.executeAgent.mockResolvedValue({
        success: false,
        error: "Agent timed out",
        retryable: true,
      });

      const result = await service.executeBridgedTool(
        "agent_research-agent",
        { task: "Research AI" },
        mockContext,
      );

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.error).toBe("Agent timed out");
    });

    it("should handle exceptions during tool execution", async () => {
      mockToolFacade.executeTool.mockRejectedValue(new Error("Network error"));

      // The service may either catch the error or rethrow it
      try {
        const result = await service.executeBridgedTool(
          "tool_web-search",
          {},
          mockContext,
        );
        // If caught, result should indicate error
        expect(result.isError).toBe(true);
      } catch (err: unknown) {
        // If rethrown, the error should contain the original message
        expect((err as Error).message).toContain("Network error");
      }
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================

  describe("getStats", () => {
    it("should return empty stats before listBridgedTools", () => {
      const stats = service.getStats();
      expect(stats.total).toBe(0);
      expect(stats.bySource).toEqual({});
    });

    it("should return correct stats after listBridgedTools", () => {
      service.listBridgedTools();
      const stats = service.getStats();

      expect(stats.total).toBeGreaterThan(0);
      expect(stats.bySource["registry-tool"]).toBe(1); // only enabled tool
      expect(stats.bySource["registry-skill"]).toBe(1);
      expect(stats.bySource["registry-agent"]).toBe(1);
    });
  });
});
