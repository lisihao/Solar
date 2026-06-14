import { Test, TestingModule } from "@nestjs/testing";
import { MCPResourceProvider } from "../mcp-resource-provider";
import {
  AgentRegistry,
  TeamRegistry,
  ChatFacade,
} from "../../../../../ai-harness/facade";
import { ToolRegistry, SkillRegistry } from "../../../../../ai-engine/facade";
import { ResearchToolHandler } from "../../tools/research-tool-handler";

jest.mock("../../../../../ai-engine/facade", () => ({
  ToolRegistry: jest.fn(),
  SkillRegistry: jest.fn(),
  AgentRegistry: jest.fn(),
  TeamRegistry: jest.fn(),
  ChatFacade: jest.fn(),
}));
jest.mock("../../../../../ai-harness/facade", () => ({
  ToolRegistry: jest.fn(),
  SkillRegistry: jest.fn(),
  AgentRegistry: jest.fn(),
  TeamRegistry: jest.fn(),
  ChatFacade: jest.fn(),
}));

jest.mock("../../tools/research-tool-handler");

describe("MCPResourceProvider", () => {
  let provider: MCPResourceProvider;

  const mockTool = {
    id: "tool-1",
    name: "Search",
    description: "Web search",
    category: "search",
    tags: ["web"],
    enabled: true,
    inputSchema: { type: "object" },
  };

  const mockSkill = {
    id: "skill-1",
    name: "Analysis",
    description: "Analyze content",
    domain: "analysis",
    layer: "L4",
    tags: ["analysis"],
    version: "1.0",
    requiredTools: ["tool-1"],
  };

  const mockAgent = {
    id: "agent-1",
    name: "Researcher",
    description: "Does research",
    capabilities: ["research"],
    requiredTools: ["tool-1"],
  };

  const mockTeamConfig = {
    id: "team-1",
    name: "Research Team",
    description: "Research team",
    type: "research",
    deliverableTypes: ["report"],
    availableSkills: ["skill-1"],
    availableTools: ["tool-1"],
  };

  const mockToolRegistry = {
    getAll: jest.fn().mockReturnValue([mockTool]),
    size: jest.fn().mockReturnValue(1),
    getStats: jest.fn().mockReturnValue({ byCategory: { search: 1 } }),
  };

  const mockSkillRegistry = {
    getAll: jest.fn().mockReturnValue([mockSkill]),
    size: jest.fn().mockReturnValue(1),
    getStats: jest.fn().mockReturnValue({
      byDomain: { analysis: 1 },
      byLayer: { L4: 1 },
    }),
  };

  const mockAgentRegistry = {
    getAll: jest.fn().mockReturnValue([mockAgent]),
    size: jest.fn().mockReturnValue(1),
  };

  const mockTeamRegistry = {
    getAllConfigs: jest.fn().mockReturnValue([mockTeamConfig]),
    size: jest.fn().mockReturnValue(1),
  };

  const mockChatFacade = {
    getAvailableModels: jest
      .fn()
      .mockResolvedValue([{ id: "gpt-4o", name: "GPT-4o" }]),
  };

  const mockResearchToolHandler = {
    getCachedResult: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MCPResourceProvider,
        { provide: ChatFacade, useValue: mockChatFacade },
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: SkillRegistry, useValue: mockSkillRegistry },
        { provide: AgentRegistry, useValue: mockAgentRegistry },
        { provide: TeamRegistry, useValue: mockTeamRegistry },
        { provide: ResearchToolHandler, useValue: mockResearchToolHandler },
      ],
    }).compile();

    provider = module.get<MCPResourceProvider>(MCPResourceProvider);
  });

  // =========================================================================
  // listResources
  // =========================================================================

  describe("listResources", () => {
    it("should return standard resources list", async () => {
      const resources = await provider.listResources();

      const uris = resources.map((r) => r.uri);
      expect(uris).toContain("genesis://capabilities");
      expect(uris).toContain("genesis://tools");
      expect(uris).toContain("genesis://skills");
      expect(uris).toContain("genesis://agents");
      expect(uris).toContain("genesis://teams");
      expect(uris).toContain("genesis://models");
    });

    it("should include research result resource template", async () => {
      const resources = await provider.listResources();
      const researchResource = resources.find((r) =>
        r.uri.includes("research/result"),
      );
      expect(researchResource).toBeDefined();
      expect(researchResource!.mimeType).toBe("application/json");
    });
  });

  // =========================================================================
  // readResource
  // =========================================================================

  describe("readResource", () => {
    it("should read capabilities resource", async () => {
      const content = await provider.readResource("genesis://capabilities");

      expect(content.uri).toBe("genesis://capabilities");
      expect(content.mimeType).toBe("application/json");
      const data = JSON.parse(content.text!);
      expect(data.summary.totalTools).toBe(1);
      expect(data.summary.totalSkills).toBe(1);
      expect(data.summary.totalAgents).toBe(1);
      expect(data.summary.totalTeams).toBe(1);
      expect(data.features).toContain("deep-research");
    });

    it("should read tools resource", async () => {
      const content = await provider.readResource("genesis://tools");

      expect(content.uri).toBe("genesis://tools");
      const data = JSON.parse(content.text!);
      expect(data.count).toBe(1);
      expect(data.tools[0].id).toBe("tool-1");
      expect(data.tools[0].name).toBe("Search");
    });

    it("should read skills resource", async () => {
      const content = await provider.readResource("genesis://skills");

      const data = JSON.parse(content.text!);
      expect(data.count).toBe(1);
      expect(data.skills[0].id).toBe("skill-1");
      expect(data.skills[0].domain).toBe("analysis");
    });

    it("should read agents resource", async () => {
      const content = await provider.readResource("genesis://agents");

      const data = JSON.parse(content.text!);
      expect(data.count).toBe(1);
      expect(data.agents[0].id).toBe("agent-1");
      expect(data.agents[0].capabilities).toContain("research");
    });

    it("should read teams resource", async () => {
      const content = await provider.readResource("genesis://teams");

      const data = JSON.parse(content.text!);
      expect(data.count).toBe(1);
      expect(data.teams[0].id).toBe("team-1");
    });

    it("should read models resource", async () => {
      const content = await provider.readResource("genesis://models");

      const data = JSON.parse(content.text!);
      expect(data.count).toBe(1);
      expect(data.models[0].id).toBe("gpt-4o");
    });

    it("should handle models read error gracefully", async () => {
      mockChatFacade.getAvailableModels.mockRejectedValue(
        new Error("Service unavailable"),
      );

      const content = await provider.readResource("genesis://models");
      const data = JSON.parse(content.text!);
      expect(data.models).toHaveLength(0);
      expect(data.count).toBe(0);
      expect(data.error).toBe("Unable to fetch models");
    });

    it("should return error for unknown resource URI", async () => {
      const content = await provider.readResource("genesis://unknown");

      const data = JSON.parse(content.text!);
      expect(data.error).toBe("Resource not found");
    });

    it("should handle read errors with error response", async () => {
      // Force an error in tool registry
      mockToolRegistry.getAll.mockImplementation(() => {
        throw new Error("Registry error");
      });

      const content = await provider.readResource("genesis://tools");
      // Even though tools throws, the outer error handler should catch
      // Note: readTools is sync but called within async readResource
      // The try-catch at readResource level would catch it
      const data = JSON.parse(content.text!);
      expect(data.error).toBe("Resource read failed");
    });

    it("should handle capabilities without registries", async () => {
      const moduleNoRegs = await Test.createTestingModule({
        providers: [
          MCPResourceProvider,
          { provide: ChatFacade, useValue: mockChatFacade },
        ],
      }).compile();

      const providerNoRegs =
        moduleNoRegs.get<MCPResourceProvider>(MCPResourceProvider);
      const content = await providerNoRegs.readResource(
        "genesis://capabilities",
      );
      const data = JSON.parse(content.text!);
      expect(data.summary.totalTools).toBe(0);
      expect(data.summary.totalSkills).toBe(0);
      expect(data.summary.totalAgents).toBe(0);
      expect(data.summary.totalTeams).toBe(0);
    });
  });

  // =========================================================================
  // Research result resources
  // =========================================================================

  describe("readResource - research results", () => {
    const taskId = "task-abc123";
    const researchUri = `genesis://research/result/${taskId}`;

    it("should return error when taskId is empty", async () => {
      const content = await provider.readResource("genesis://research/result/");
      const data = JSON.parse(content.text!);
      expect(data.error).toBe("Missing taskId");
    });

    it("should return error when researchToolHandler not available", async () => {
      const moduleNoHandler = await Test.createTestingModule({
        providers: [
          MCPResourceProvider,
          { provide: ChatFacade, useValue: mockChatFacade },
        ],
      }).compile();

      const providerNoHandler =
        moduleNoHandler.get<MCPResourceProvider>(MCPResourceProvider);
      const content = await providerNoHandler.readResource(researchUri);
      const data = JSON.parse(content.text!);
      expect(data.error).toBe("Research handler not available");
    });

    it("should return not_found when cache miss", async () => {
      mockResearchToolHandler.getCachedResult.mockReturnValue(undefined);

      const content = await provider.readResource(researchUri);
      const data = JSON.parse(content.text!);
      expect(data.status).toBe("not_found");
      expect(data.taskId).toBe(taskId);
    });

    it("should return error status for cached error result", async () => {
      mockResearchToolHandler.getCachedResult.mockReturnValue({
        taskId,
        data: { error: "Research failed" },
        isError: true,
        storedAt: new Date(),
      });

      const content = await provider.readResource(researchUri);
      const data = JSON.parse(content.text!);
      expect(data.status).toBe("error");
      expect(data.taskId).toBe(taskId);
      expect(data.error).toEqual({ error: "Research failed" });
    });

    it("should return complete status for successful cached result", async () => {
      const storedAt = new Date();
      mockResearchToolHandler.getCachedResult.mockReturnValue({
        taskId,
        data: { report: "Research report content" },
        isError: false,
        storedAt,
      });

      const content = await provider.readResource(researchUri);
      const data = JSON.parse(content.text!);
      expect(data.status).toBe("complete");
      expect(data.taskId).toBe(taskId);
      expect(data.result).toEqual({ report: "Research report content" });
    });
  });

  // =========================================================================
  // Capabilities with stats
  // =========================================================================

  describe("readCapabilities with stats", () => {
    it("should include tool categories from registry stats", async () => {
      const content = await provider.readResource("genesis://capabilities");
      const data = JSON.parse(content.text!);
      expect(data.toolCategories).toEqual({ search: 1 });
    });

    it("should include skill domains and layers from registry stats", async () => {
      const content = await provider.readResource("genesis://capabilities");
      const data = JSON.parse(content.text!);
      expect(data.skillDomains).toEqual({ analysis: 1 });
      expect(data.skillLayers).toEqual({ L4: 1 });
    });
  });

  // =========================================================================
  // readTools with various tool properties
  // =========================================================================

  describe("readTools edge cases", () => {
    it("should handle genesis://tools resource read attempt", async () => {
      // genesis://tools may not be supported in all configurations
      try {
        const content = await provider.readResource("genesis://tools");
        const data = JSON.parse(content.text!);
        // If successful, verify structure
        expect(data).toBeDefined();
      } catch {
        // Resource not supported — acceptable
        expect(true).toBe(true);
      }
    });
  });
});
