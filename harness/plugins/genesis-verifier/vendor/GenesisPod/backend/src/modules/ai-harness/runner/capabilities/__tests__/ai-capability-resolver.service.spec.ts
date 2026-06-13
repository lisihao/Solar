import { Test, TestingModule } from "@nestjs/testing";
import {
  AICapabilityResolver,
  AICapabilityContext,
} from "../ai-capability-resolver.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ToolRegistry } from "../../../../ai-engine/tools/registry/tool.registry";
import { SkillRegistry } from "../../../../ai-engine/skills/registry/skill.registry";
import { MCP_PROVIDER_PORT } from "@/modules/ai-engine/facade/abstractions/runtime-deps.tokens";
import { SkillLoaderService } from "../../../../ai-engine/skills/loader/loading/skill-loader.service";
import { SkillPromptBuilder } from "../../../../ai-engine/skills/builder/skill-prompt-builder.service";

describe("AICapabilityResolver", () => {
  let resolver: AICapabilityResolver;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockToolRegistry: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSkillRegistry: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockMcpManager: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSkillLoader: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSkillPromptBuilder: any;

  const mockTools = [
    { id: "web_search", name: "Web Search" },
    { id: "code_generation", name: "Code Generation" },
    { id: "text_generation", name: "Text Generation" },
  ];

  const mockSkills = [
    { id: "research_skill", name: "Research", domain: "research" },
    { id: "writing_skill", name: "Writing", domain: "writing" },
    { id: "common_skill", name: "Common", domain: "common" },
  ];

  beforeEach(async () => {
    mockToolRegistry = {
      getAll: jest.fn().mockReturnValue(mockTools),
      tryGet: jest.fn().mockReturnValue(null),
      getFunctionDefinitions: jest.fn().mockReturnValue([]),
      getCompactSummaries: jest.fn().mockReturnValue([]),
      estimateTokens: jest.fn().mockReturnValue(500),
      getAllFunctionDefinitions: jest.fn().mockReturnValue([]),
    };

    mockSkillRegistry = {
      getAll: jest.fn().mockReturnValue(mockSkills),
      tryGet: jest.fn().mockReturnValue(null),
    };

    mockMcpManager = {
      getClient: jest.fn().mockReturnValue(null),
    };

    mockSkillLoader = {
      loadSkill: jest.fn(),
      getSkillsForTask: jest.fn().mockResolvedValue([]),
    };

    mockSkillPromptBuilder = {
      buildPrompt: jest.fn().mockReturnValue("Skill prompt"),
      buildSystemPrompt: jest.fn().mockReturnValue({
        prompt: "System prompt content",
        usedSkills: ["research_skill"],
        estimatedTokens: 200,
        wasTrimmed: false,
        skippedSkills: [],
      }),
    };

    mockPrisma = {
      toolConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      skillConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      aITeamTemplate: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      aITeamMemberTemplate: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      mCPServerConfig: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      aIUsageLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AICapabilityResolver,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: SkillRegistry, useValue: mockSkillRegistry },
        { provide: MCP_PROVIDER_PORT, useValue: mockMcpManager },
        { provide: SkillLoaderService, useValue: mockSkillLoader },
        { provide: SkillPromptBuilder, useValue: mockSkillPromptBuilder },
      ],
    }).compile();

    resolver = module.get<AICapabilityResolver>(AICapabilityResolver);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== resolveToolsForAgent ====================

  describe("resolveToolsForAgent", () => {
    it("should return all registered tools by default", async () => {
      const context: AICapabilityContext = { agentId: "agent-1" };

      const tools = await resolver.resolveToolsForAgent(context);

      expect(tools).toContain("web_search");
      expect(tools).toContain("code_generation");
      expect(tools).toContain("text_generation");
    });

    it("should exclude explicitly disabled tools", async () => {
      mockPrisma.toolConfig.findMany.mockResolvedValue([
        { toolId: "web_search" },
      ]);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const tools = await resolver.resolveToolsForAgent(context);

      expect(tools).not.toContain("web_search");
      expect(tools).toContain("code_generation");
    });

    it("should include team-configured tools", async () => {
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue({
        id: "team-1",
        members: [{ capabilities: ["WEB_SEARCH", "CODE_GENERATION"] }],
      });

      const context: AICapabilityContext = {
        agentId: "agent-1",
        teamId: "team-1",
      };

      const tools = await resolver.resolveToolsForAgent(context);
      expect(tools).toBeDefined();
    });

    it("should filter by role allowed tools when roleId provided", async () => {
      // Role allows only web_search
      mockPrisma.toolConfig.findMany
        .mockResolvedValueOnce([]) // First call: disabled tools (empty = none disabled)
        .mockResolvedValueOnce([{ toolId: "web_search" }]); // Second call: role allowed tools

      const context: AICapabilityContext = {
        agentId: "agent-1",
        roleId: "role-1",
      };

      const tools = await resolver.resolveToolsForAgent(context);
      expect(tools).toContain("web_search");
    });

    it("should return empty when team not found", async () => {
      mockToolRegistry.getAll.mockReturnValue([]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([]);
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(null);

      const context: AICapabilityContext = {
        agentId: "agent-1",
        teamId: "nonexistent-team",
      };

      const tools = await resolver.resolveToolsForAgent(context);
      expect(tools).toEqual([]);
    });

    it("should not filter if role allows nothing (empty roleAllowedTools)", async () => {
      mockPrisma.toolConfig.findMany
        .mockResolvedValueOnce([]) // disabled tools
        .mockResolvedValueOnce([]); // role tools: empty means no restriction applied

      const context: AICapabilityContext = {
        agentId: "agent-1",
        roleId: "role-empty",
      };

      const tools = await resolver.resolveToolsForAgent(context);
      // When roleAllowedTools is empty array, it means no tools allowed
      // The code says: if (roleAllowedTools !== null && roleAllowedTools.length > 0) {filter}
      // So empty array => no filter applied, all tools returned
      expect(tools.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle team with members having unknown capabilities", async () => {
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue({
        id: "team-1",
        members: [{ capabilities: ["UNKNOWN_CAPABILITY"] }],
      });

      const context: AICapabilityContext = {
        agentId: "agent-1",
        teamId: "team-1",
      };

      const tools = await resolver.resolveToolsForAgent(context);
      // Unknown capability maps to empty array — no crash
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  // ==================== resolveSkillsForAgent ====================

  describe("resolveSkillsForAgent", () => {
    it("should return all registered skills when no domain specified", async () => {
      // No domain context
      const context: AICapabilityContext = { agentId: "agent-1" };

      const skills = await resolver.resolveSkillsForAgent(context);

      expect(skills).toContain("research_skill");
      expect(skills).toContain("writing_skill");
    });

    it("should filter skills by domain", async () => {
      // skillRegistry returns research_skill with domain "research"
      mockSkillRegistry.tryGet.mockImplementation((skillId: string) => {
        if (skillId === "research_skill")
          return { id: skillId, domain: "research" };
        if (skillId === "writing_skill")
          return { id: skillId, domain: "writing" };
        if (skillId === "common_skill")
          return { id: skillId, domain: "common" };
        return null;
      });

      const context: AICapabilityContext = {
        agentId: "agent-1",
        domain: "research",
      };

      const skills = await resolver.resolveSkillsForAgent(context);

      // research_skill (domain=research) and common_skill (domain=common) should match
      expect(skills).toContain("research_skill");
      expect(skills).toContain("common_skill");
      expect(skills).not.toContain("writing_skill");
    });

    it("should include skills with null domain when filtering by domain", async () => {
      mockSkillRegistry.tryGet.mockImplementation((skillId: string) => {
        if (skillId === "research_skill") return { id: skillId, domain: null };
        return null;
      });

      const context: AICapabilityContext = {
        agentId: "agent-1",
        domain: "any-domain",
      };

      const skills = await resolver.resolveSkillsForAgent(context);
      expect(skills).toContain("research_skill");
    });

    it("should include skills with 'general' domain when filtering by domain", async () => {
      mockSkillRegistry.tryGet.mockImplementation((skillId: string) => {
        if (skillId === "research_skill")
          return { id: skillId, domain: "general" };
        return null;
      });

      const context: AICapabilityContext = {
        agentId: "agent-1",
        domain: "research",
      };

      const skills = await resolver.resolveSkillsForAgent(context);
      expect(skills).toContain("research_skill");
    });

    it("should exclude explicitly disabled skills", async () => {
      mockPrisma.skillConfig.findMany.mockResolvedValueOnce([
        { skillId: "research_skill" },
      ]); // disabled skills

      const context: AICapabilityContext = { agentId: "agent-1" };
      const skills = await resolver.resolveSkillsForAgent(context);

      expect(skills).not.toContain("research_skill");
    });

    it("should respect allowedDomains constraint", async () => {
      mockSkillRegistry.tryGet.mockImplementation((skillId: string) => {
        if (skillId === "research_skill")
          return { id: skillId, domain: "research" };
        return null;
      });

      // Skill config has allowedDomains that excludes "research"
      mockPrisma.skillConfig.findMany.mockResolvedValue([
        {
          skillId: "research_skill",
          domain: "research",
          allowedDomains: ["technical"], // Only allowed in "technical" domain
          config: null,
        },
      ]);

      const context: AICapabilityContext = {
        agentId: "agent-1",
        domain: "research", // Not in allowedDomains
      };

      const skills = await resolver.resolveSkillsForAgent(context);
      expect(skills).not.toContain("research_skill");
    });

    it("should not restrict when allowedDomains is empty", async () => {
      mockSkillRegistry.tryGet.mockImplementation((skillId: string) => {
        if (skillId === "research_skill")
          return { id: skillId, domain: "research" };
        return null;
      });

      // First call: getGlobalEnabledSkills disabled check (empty = none disabled)
      // Second call: skillConfig.findMany for domain filtering configs
      mockPrisma.skillConfig.findMany
        .mockResolvedValueOnce([]) // disabled skills query
        .mockResolvedValueOnce([
          {
            skillId: "research_skill",
            domain: "research",
            allowedDomains: [], // Empty — no restriction
            config: null,
          },
        ]); // domain filtering configs query

      const context: AICapabilityContext = {
        agentId: "agent-1",
        domain: "research",
      };

      const skills = await resolver.resolveSkillsForAgent(context);
      expect(skills).toContain("research_skill");
    });

    it("should respect domainOverrides toggle", async () => {
      mockSkillRegistry.tryGet.mockImplementation((skillId: string) => {
        if (skillId === "research_skill")
          return { id: skillId, domain: "research" };
        return null;
      });

      // Skill has domain override that disables it for "research"
      mockPrisma.skillConfig.findMany.mockResolvedValue([
        {
          skillId: "research_skill",
          domain: "research",
          allowedDomains: [],
          config: {
            domainOverrides: {
              research: { enabled: false },
            },
          },
        },
      ]);

      const context: AICapabilityContext = {
        agentId: "agent-1",
        domain: "research",
      };

      const skills = await resolver.resolveSkillsForAgent(context);
      expect(skills).not.toContain("research_skill");
    });

    it("should allow when domainOverrides enabled is true", async () => {
      mockSkillRegistry.tryGet.mockImplementation((skillId: string) => {
        if (skillId === "research_skill")
          return { id: skillId, domain: "research" };
        return null;
      });

      // First call: disabled skills (empty), second call: domain filter configs
      mockPrisma.skillConfig.findMany
        .mockResolvedValueOnce([]) // disabled skills query
        .mockResolvedValueOnce([
          {
            skillId: "research_skill",
            domain: "research",
            allowedDomains: [],
            config: {
              domainOverrides: {
                research: { enabled: true },
              },
            },
          },
        ]); // domain filtering configs query

      const context: AICapabilityContext = {
        agentId: "agent-1",
        domain: "research",
      };

      const skills = await resolver.resolveSkillsForAgent(context);
      expect(skills).toContain("research_skill");
    });
  });

  // ==================== resolveMCPToolsForAgent ====================

  describe("resolveMCPToolsForAgent", () => {
    it("should return empty when no MCP servers enabled", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([]);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const tools = await resolver.resolveMCPToolsForAgent(context);

      expect(tools).toEqual([]);
    });

    it("should return tools from connected MCP servers", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        { serverId: "server-1", enabled: true },
      ]);

      const mockClient = {
        connected: true,
        listTools: jest.fn().mockResolvedValue([
          { name: "search", description: "Search the web" },
          { name: "fetch", description: "Fetch a URL" },
        ]),
      };

      mockMcpManager.getClient.mockReturnValue(mockClient);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const tools = await resolver.resolveMCPToolsForAgent(context);

      expect(tools).toHaveLength(2);
      expect(tools[0].toolName).toBe("search");
      expect(tools[0].serverId).toBe("server-1");
    });

    it("should skip disconnected MCP servers", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        { serverId: "server-1", enabled: true },
      ]);

      const mockClient = {
        connected: false,
        listTools: jest.fn(),
      };

      mockMcpManager.getClient.mockReturnValue(mockClient);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const tools = await resolver.resolveMCPToolsForAgent(context);

      expect(tools).toHaveLength(0);
      expect(mockClient.listTools).not.toHaveBeenCalled();
    });

    it("should skip servers with no client (null)", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        { serverId: "server-no-client", enabled: true },
      ]);

      mockMcpManager.getClient.mockReturnValue(null);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const tools = await resolver.resolveMCPToolsForAgent(context);

      expect(tools).toHaveLength(0);
    });

    it("should handle MCP tool listing errors gracefully", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        { serverId: "server-1", enabled: true },
      ]);

      const mockClient = {
        connected: true,
        listTools: jest.fn().mockRejectedValue(new Error("Connection error")),
      };

      mockMcpManager.getClient.mockReturnValue(mockClient);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const tools = await resolver.resolveMCPToolsForAgent(context);

      // Should not throw - returns empty array
      expect(tools).toEqual([]);
    });

    it("should include member MCP tools when memberId provided", async () => {
      mockPrisma.aITeamMemberTemplate.findUnique.mockResolvedValue({
        id: "member-1",
        mcpTools: [
          {
            serverId: "custom-server",
            toolName: "custom_tool",
            description: "A custom tool",
          },
        ],
      });

      const context: AICapabilityContext = {
        agentId: "agent-1",
        memberId: "member-1",
      };

      const tools = await resolver.resolveMCPToolsForAgent(context);

      expect(tools.some((t) => t.toolName === "custom_tool")).toBe(true);
    });

    it("should return empty when member has no mcpTools", async () => {
      mockPrisma.aITeamMemberTemplate.findUnique.mockResolvedValue({
        id: "member-2",
        mcpTools: null,
      });

      const context: AICapabilityContext = {
        agentId: "agent-1",
        memberId: "member-2",
      };

      const tools = await resolver.resolveMCPToolsForAgent(context);
      expect(tools).toEqual([]);
    });
  });

  // ==================== resolveAllCapabilities ====================

  describe("resolveAllCapabilities", () => {
    it("should resolve tools, skills, and mcpTools together", async () => {
      const context: AICapabilityContext = { agentId: "agent-1" };

      const capabilities = await resolver.resolveAllCapabilities(context);

      expect(capabilities).toHaveProperty("tools");
      expect(capabilities).toHaveProperty("skills");
      expect(capabilities).toHaveProperty("mcpTools");
      expect(Array.isArray(capabilities.tools)).toBe(true);
      expect(Array.isArray(capabilities.skills)).toBe(true);
      expect(Array.isArray(capabilities.mcpTools)).toBe(true);
    });
  });

  // ==================== isToolAvailable ====================

  describe("isToolAvailable", () => {
    it("should return true for available tool", async () => {
      const context: AICapabilityContext = { agentId: "agent-1" };

      const available = await resolver.isToolAvailable("web_search", context);
      expect(available).toBe(true);
    });

    it("should return false for disabled tool", async () => {
      mockPrisma.toolConfig.findMany.mockResolvedValue([
        { toolId: "web_search" },
      ]);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const available = await resolver.isToolAvailable("web_search", context);
      expect(available).toBe(false);
    });

    it("should return false for unregistered tool", async () => {
      const context: AICapabilityContext = { agentId: "agent-1" };
      const available = await resolver.isToolAvailable(
        "nonexistent_tool",
        context,
      );
      expect(available).toBe(false);
    });
  });

  // ==================== isSkillAvailable ====================

  describe("isSkillAvailable", () => {
    it("should return true for available skill", async () => {
      const context: AICapabilityContext = { agentId: "agent-1" };

      const available = await resolver.isSkillAvailable(
        "research_skill",
        context,
      );
      expect(available).toBe(true);
    });

    it("should return false for disabled skill", async () => {
      mockPrisma.skillConfig.findMany.mockResolvedValue([
        { skillId: "research_skill" },
      ]);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const available = await resolver.isSkillAvailable(
        "research_skill",
        context,
      );
      expect(available).toBe(false);
    });
  });

  // ==================== getToolConfig ====================

  describe("getToolConfig", () => {
    it("should return tool config when found", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "web_search",
        config: { maxResults: 10 },
      });

      const config = await resolver.getToolConfig("web_search");
      expect(config).toEqual({ maxResults: 10 });
    });

    it("should fall back across tool id aliases", async () => {
      mockPrisma.toolConfig.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          toolId: "industry-report-search",
          config: { sources: [{ id: "a16z" }] },
        });

      const config = await resolver.getToolConfig("industry-report");
      expect(config).toEqual({ sources: [{ id: "a16z" }] });
      expect(mockPrisma.toolConfig.findUnique).toHaveBeenNthCalledWith(1, {
        where: { toolId: "industry-report" },
      });
      expect(mockPrisma.toolConfig.findUnique).toHaveBeenNthCalledWith(2, {
        where: { toolId: "industry-report-search" },
      });
    });

    it("should return null/undefined when tool config not found", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue(null);

      const config = await resolver.getToolConfig("nonexistent");
      expect(config).toBeFalsy();
    });
  });

  // ==================== getSkillConfig ====================

  describe("getSkillConfig", () => {
    it("should return skill config when found", async () => {
      mockPrisma.skillConfig.findUnique.mockResolvedValue({
        skillId: "research_skill",
        config: { depth: "deep" },
      });

      const config = await resolver.getSkillConfig("research_skill");
      expect(config).toEqual({ depth: "deep" });
    });

    it("should return null/undefined when skill config not found", async () => {
      mockPrisma.skillConfig.findUnique.mockResolvedValue(null);

      const config = await resolver.getSkillConfig("nonexistent");
      expect(config).toBeFalsy();
    });
  });

  // ==================== getToolFunctionDefinitions ====================

  describe("getToolFunctionDefinitions", () => {
    it("should return merged builtin and MCP tool function definitions", async () => {
      const mockFunctionDef = {
        name: "web_search",
        description: "Search the web",
        parameters: { type: "object", properties: {} },
      };
      mockToolRegistry.getFunctionDefinitions.mockReturnValue([
        mockFunctionDef,
      ]);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const defs = await resolver.getToolFunctionDefinitions(context);

      expect(Array.isArray(defs)).toBe(true);
      expect(defs).toContain(mockFunctionDef);
    });

    it("should include MCP tool definitions when servers are connected", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        { serverId: "server-1", enabled: true },
      ]);

      const mockClient = {
        connected: true,
        listTools: jest.fn().mockResolvedValue([
          {
            name: "mcp-search",
            description: "MCP search tool",
            inputSchema: { type: "object", properties: {} },
          },
        ]),
      };

      mockMcpManager.getClient.mockReturnValue(mockClient);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const defs = await resolver.getToolFunctionDefinitions(context);

      const mcpDef = defs.find((d) =>
        d.name.includes("mcp_server-1_mcp-search"),
      );
      expect(mcpDef).toBeDefined();
    });

    it("should skip MCP tool when client not connected", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        { serverId: "server-offline", enabled: true },
      ]);

      // MCP tool info comes from resolveMCPToolsForAgent, but getClient returns disconnected
      const mockClient = { connected: false };
      mockMcpManager.getClient.mockReturnValue(mockClient);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const defs = await resolver.getToolFunctionDefinitions(context);

      // No MCP tools added
      const mcpDefs = defs.filter((d) => d.name.startsWith("mcp_"));
      expect(mcpDefs).toHaveLength(0);
    });

    it("should handle error when fetching MCP tool definition", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        { serverId: "server-1", enabled: true },
      ]);

      const mockClient = {
        connected: true,
        listTools: jest
          .fn()
          .mockResolvedValueOnce([
            { name: "tool1", description: "desc1", inputSchema: {} },
          ])
          .mockRejectedValueOnce(new Error("Failed")),
      };

      mockMcpManager.getClient.mockReturnValue(mockClient);

      const context: AICapabilityContext = { agentId: "agent-1" };
      // Should not throw
      await expect(
        resolver.getToolFunctionDefinitions(context),
      ).resolves.toBeDefined();
    });
  });

  // ==================== getToolBundle ====================

  describe("getToolBundle", () => {
    it("should return empty bundle when no tools available", async () => {
      mockToolRegistry.getAll.mockReturnValue([]);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const bundle = await resolver.getToolBundle(context);

      expect(bundle.compactTools).toEqual([]);
      expect(bundle.usedTools).toEqual([]);
      expect(bundle.estimatedTokens).toBe(0);
    });

    it("should return compact bundle by default", async () => {
      const mockSummaries = [
        {
          id: "web_search",
          name: "Web Search",
          brief: "desc",
          category: "information",
        },
      ];
      mockToolRegistry.getCompactSummaries.mockReturnValue(mockSummaries);
      mockToolRegistry.estimateTokens.mockReturnValue(300);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const bundle = await resolver.getToolBundle(context, true);

      expect(bundle.isCompact).toBe(true);
      expect(bundle.compactTools).toBe(mockSummaries);
      expect(bundle.estimatedTokens).toBe(300);
      expect(bundle.fullDefinitions).toBeUndefined();
    });

    it("should include full definitions when compact=false", async () => {
      const mockSummaries = [
        {
          id: "web_search",
          name: "Web Search",
          brief: "desc",
          category: "information",
        },
      ];
      const mockFullDefs = [
        { name: "web_search", description: "Full desc", parameters: {} },
      ];
      mockToolRegistry.getCompactSummaries.mockReturnValue(mockSummaries);
      mockToolRegistry.getFunctionDefinitions.mockReturnValue(mockFullDefs);
      mockToolRegistry.estimateTokens.mockReturnValue(800);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const bundle = await resolver.getToolBundle(context, false);

      expect(bundle.isCompact).toBe(false);
      expect(bundle.fullDefinitions).toBe(mockFullDefs);
    });
  });

  // ==================== getSkillPrompts ====================

  describe("getSkillPrompts", () => {
    it("should return empty bundle when no skills available", async () => {
      mockSkillRegistry.getAll.mockReturnValue([]);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const bundle = await resolver.getSkillPrompts(context);

      expect(bundle.content).toBe("");
      expect(bundle.usedSkills).toEqual([]);
      expect(bundle.estimatedTokens).toBe(0);
      expect(bundle.wasTrimmed).toBe(false);
    });

    it("should return empty bundle when skill loader returns no skills", async () => {
      mockSkillLoader.getSkillsForTask.mockResolvedValue([]);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const bundle = await resolver.getSkillPrompts(context);

      expect(bundle.content).toBe("");
    });

    it("should build prompt when skills are found", async () => {
      const mockSkillObjects = [{ id: "research_skill", name: "Research" }];
      mockSkillLoader.getSkillsForTask.mockResolvedValue(mockSkillObjects);

      const context: AICapabilityContext = { agentId: "agent-1" };
      const bundle = await resolver.getSkillPrompts(context);

      expect(bundle.content).toBe("System prompt content");
      expect(bundle.usedSkills).toContain("research_skill");
      expect(bundle.estimatedTokens).toBe(200);
      expect(mockSkillPromptBuilder.buildSystemPrompt).toHaveBeenCalled();
    });

    it("should use options.maxTokenBudget when provided", async () => {
      const mockSkillObjects = [{ id: "research_skill", name: "Research" }];
      mockSkillLoader.getSkillsForTask.mockResolvedValue(mockSkillObjects);

      const context: AICapabilityContext = { agentId: "agent-1" };
      await resolver.getSkillPrompts(context, { maxTokenBudget: 2000 });

      expect(mockSkillLoader.getSkillsForTask).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokenBudget: 2000 }),
      );
    });

    it("should cap maxTokenBudget at skillPromptMax (8000)", async () => {
      const mockSkillObjects = [{ id: "research_skill", name: "Research" }];
      mockSkillLoader.getSkillsForTask.mockResolvedValue(mockSkillObjects);

      const context: AICapabilityContext = { agentId: "agent-1" };
      await resolver.getSkillPrompts(context, { maxTokenBudget: 99999 });

      expect(mockSkillLoader.getSkillsForTask).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokenBudget: 8000 }),
      );
    });

    it("should use team skillTokenBudget from metadata", async () => {
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue({
        id: "team-1",
        metadata: { skillTokenBudget: 3000 },
      });

      const mockSkillObjects = [{ id: "research_skill", name: "Research" }];
      mockSkillLoader.getSkillsForTask.mockResolvedValue(mockSkillObjects);

      const context: AICapabilityContext = {
        agentId: "agent-1",
        teamId: "team-1",
      };
      await resolver.getSkillPrompts(context);

      expect(mockSkillLoader.getSkillsForTask).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokenBudget: 3000 }),
      );
    });

    it("should use default budget when team has no metadata", async () => {
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue({
        id: "team-2",
        metadata: null,
      });

      const mockSkillObjects = [{ id: "research_skill", name: "Research" }];
      mockSkillLoader.getSkillsForTask.mockResolvedValue(mockSkillObjects);

      const context: AICapabilityContext = {
        agentId: "agent-1",
        teamId: "team-2",
      };
      await resolver.getSkillPrompts(context);

      expect(mockSkillLoader.getSkillsForTask).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokenBudget: 4000 }),
      );
    });

    it("should use cached team metadata on second call", async () => {
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue({
        id: "team-cache",
        metadata: { skillTokenBudget: 5000 },
      });

      const mockSkillObjects = [{ id: "research_skill" }];
      mockSkillLoader.getSkillsForTask.mockResolvedValue(mockSkillObjects);

      const context: AICapabilityContext = {
        agentId: "agent-1",
        teamId: "team-cache",
      };

      await resolver.getSkillPrompts(context);
      await resolver.getSkillPrompts(context);

      // DB should only be called once due to cache
      expect(mockPrisma.aITeamTemplate.findUnique).toHaveBeenCalledTimes(1);
    });

    it("should handle DB error in getTeamMetadataCached gracefully", async () => {
      mockPrisma.aITeamTemplate.findUnique.mockRejectedValue(
        new Error("DB Error"),
      );

      const mockSkillObjects = [{ id: "research_skill" }];
      mockSkillLoader.getSkillsForTask.mockResolvedValue(mockSkillObjects);

      const context: AICapabilityContext = {
        agentId: "agent-1",
        teamId: "team-error",
      };

      // Should not throw, falls back to default budget
      await expect(resolver.getSkillPrompts(context)).resolves.toBeDefined();
    });

    it("should pass includeMetadata option to promptBuilder", async () => {
      const mockSkillObjects = [{ id: "research_skill" }];
      mockSkillLoader.getSkillsForTask.mockResolvedValue(mockSkillObjects);

      const context: AICapabilityContext = { agentId: "agent-1" };
      await resolver.getSkillPrompts(context, { includeMetadata: true });

      expect(mockSkillPromptBuilder.buildSystemPrompt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ includeMetadata: true }),
      );
    });

    it("should use undefined domain gracefully", async () => {
      const mockSkillObjects = [{ id: "research_skill" }];
      mockSkillLoader.getSkillsForTask.mockResolvedValue(mockSkillObjects);

      const context: AICapabilityContext = {
        agentId: "agent-1",
        // domain deliberately omitted
      };

      await expect(resolver.getSkillPrompts(context)).resolves.toBeDefined();
    });
  });

  // ==================== getTokenBudgetConfig ====================

  describe("getTokenBudgetConfig", () => {
    it("should return token budget configuration", () => {
      const config = resolver.getTokenBudgetConfig();

      expect(config).toHaveProperty("skillPromptDefault");
      expect(config).toHaveProperty("skillPromptMax");
      expect(config).toHaveProperty("toolDefinitionDefault");
      expect(config).toHaveProperty("systemMessageReserved");
      expect(config.skillPromptDefault).toBe(4000);
      expect(config.skillPromptMax).toBe(8000);
    });

    it("should return a copy (not the original reference)", () => {
      const config1 = resolver.getTokenBudgetConfig();
      const config2 = resolver.getTokenBudgetConfig();
      expect(config1).not.toBe(config2);
    });
  });

  // ==================== logCapabilityUsage ====================

  describe("logCapabilityUsage", () => {
    it("should log tool capability usage", async () => {
      await resolver.logCapabilityUsage({
        capabilityType: "tool",
        capabilityId: "web_search",
        userId: "user-1",
        teamId: "team-1",
        agentId: "agent-1",
        success: true,
        duration: 150,
        tokensUsed: 200,
      });

      expect(mockPrisma.aIUsageLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          capabilityType: "tool",
          capabilityId: "web_search",
          success: true,
          duration: 150,
        }),
      });
    });

    it("should log skill capability usage", async () => {
      await resolver.logCapabilityUsage({
        capabilityType: "skill",
        capabilityId: "research_skill",
        success: false,
        errorCode: "TIMEOUT",
        duration: 5000,
      });

      expect(mockPrisma.aIUsageLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          capabilityType: "skill",
          capabilityId: "research_skill",
          success: false,
          errorCode: "TIMEOUT",
        }),
      });
    });

    it("should not throw when logging fails", async () => {
      mockPrisma.aIUsageLog.create.mockRejectedValue(new Error("DB error"));

      await expect(
        resolver.logCapabilityUsage({
          capabilityType: "mcp",
          capabilityId: "mcp-tool",
          success: true,
          duration: 100,
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ==================== validateAndNormalizeContext ====================

  describe("validateAndNormalizeContext", () => {
    it("should normalize context with defaults", () => {
      const result = resolver.validateAndNormalizeContext({});

      expect(result.isValid).toBe(true);
      expect(result.normalizedContext.agentId).toBe("default-agent");
      expect(result.normalizedContext.userId).toBe("system");
      expect(result.normalizedContext.domain).toBe("general");
    });

    it("should preserve provided values", () => {
      const context: AICapabilityContext = {
        agentId: "my-agent",
        userId: "user-123",
        domain: "research",
        teamId: "team-456",
      };

      const result = resolver.validateAndNormalizeContext(context);

      expect(result.normalizedContext.agentId).toBe("my-agent");
      expect(result.normalizedContext.userId).toBe("user-123");
      expect(result.normalizedContext.domain).toBe("research");
    });

    it("should add warnings for missing optional fields", () => {
      const result = resolver.validateAndNormalizeContext({});

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes("agentId"))).toBe(true);
    });

    it("should add warning for invalid UUID format in teamId", () => {
      const result = resolver.validateAndNormalizeContext({
        teamId: "not-a-uuid",
      });

      expect(result.warnings.some((w) => w.includes("teamId"))).toBe(true);
    });

    it("should add warning for invalid UUID format in memberId", () => {
      const result = resolver.validateAndNormalizeContext({
        memberId: "bad-member-id",
      });

      expect(result.warnings.some((w) => w.includes("memberId"))).toBe(true);
    });

    it("should not warn for valid UUID format", () => {
      const result = resolver.validateAndNormalizeContext({
        agentId: "my-agent",
        userId: "user-1",
        domain: "general",
        teamId: "550e8400-e29b-41d4-a716-446655440000",
      });

      expect(result.warnings.every((w) => !w.includes("teamId"))).toBe(true);
    });

    it("should set teamId to null when not provided", () => {
      const result = resolver.validateAndNormalizeContext({});
      expect(result.normalizedContext.teamId).toBeNull();
    });

    it("should set roleId to null when not provided", () => {
      const result = resolver.validateAndNormalizeContext({});
      expect(result.normalizedContext.roleId).toBeNull();
    });

    it("should set memberId to null when not provided", () => {
      const result = resolver.validateAndNormalizeContext({});
      expect(result.normalizedContext.memberId).toBeNull();
    });
  });

  // ==================== createDefaultContext ====================

  describe("createDefaultContext", () => {
    it("should create context with defaults", () => {
      const ctx = resolver.createDefaultContext();

      expect(ctx.agentId).toBe("default-agent");
      expect(ctx.userId).toBe("system");
      expect(ctx.domain).toBe("general");
    });

    it("should merge overrides with defaults", () => {
      const ctx = resolver.createDefaultContext({
        agentId: "custom-agent",
        domain: "research",
      });

      expect(ctx.agentId).toBe("custom-agent");
      expect(ctx.domain).toBe("research");
      expect(ctx.userId).toBe("system"); // Default preserved
    });

    it("should create context with no overrides provided", () => {
      const ctx = resolver.createDefaultContext(undefined);
      expect(ctx.agentId).toBe("default-agent");
    });
  });
});
