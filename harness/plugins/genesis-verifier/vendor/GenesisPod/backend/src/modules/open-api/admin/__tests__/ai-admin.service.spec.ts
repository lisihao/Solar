import { Test, TestingModule } from "@nestjs/testing";
import { AIAdminService } from "../ai/ai-admin.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { MCPManager } from "../../../ai-harness/facade";
import {
  ToolRegistry,
  SkillRegistry,
  SkillLoaderService,
  SkillContentService,
  SearchService,
} from "../../../ai-engine/facade";
import { SecretsService } from "../../../platform/credentials/storage/secrets/secrets.service";

describe("AIAdminService", () => {
  let service: AIAdminService;

  const mockPrismaService = {
    toolConfig: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      createMany: jest.fn(),
    },
    skillConfig: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      createMany: jest.fn(),
    },
    mCPServerConfig: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    aIUsageLog: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    secret: {
      findMany: jest.fn(),
    },
    aITeamTemplate: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockToolRegistry = {
    getAll: jest.fn().mockReturnValue([]),
    tryGet: jest.fn(),
    getEnabled: jest.fn().mockReturnValue([]),
  };

  const mockSkillRegistry = {
    getAll: jest.fn().mockReturnValue([]),
    tryGet: jest.fn(),
  };

  const mockSkillLoaderService = {
    getAllLoadedSkills: jest.fn().mockReturnValue([]),
  };

  const mockMCPManager = {
    registerServer: jest.fn(),
    registerOrUpdateServer: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    getClient: jest.fn(),
  };

  const mockSecretsService = {
    exists: jest.fn(),
    getValue: jest.fn(),
    getValueInternal: jest.fn(),
  };

  const mockSearchService = {
    getKeyHealthStatus: jest.fn().mockReturnValue([]),
  };

  const mockSkillContentService = {
    getEffectiveContent: jest.fn(),
    savePromptContent: jest.fn(),
    getVersionHistory: jest.fn(),
    restoreVersion: jest.fn(),
    getFullSkillDefinition: jest.fn(),
    createSkillFromUI: jest.fn(),
    syncFilesystemToDb: jest.fn(),
    recordUsage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default returns
    mockPrismaService.toolConfig.findMany.mockResolvedValue([]);
    mockPrismaService.skillConfig.findMany.mockResolvedValue([]);
    mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);
    mockPrismaService.secret.findMany.mockResolvedValue([]);
    mockPrismaService.aITeamTemplate.findMany.mockResolvedValue([]);
    mockPrismaService.toolConfig.createMany.mockResolvedValue({ count: 0 });
    mockPrismaService.skillConfig.createMany.mockResolvedValue({ count: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIAdminService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: SkillRegistry, useValue: mockSkillRegistry },
        { provide: SkillLoaderService, useValue: mockSkillLoaderService },
        { provide: SkillContentService, useValue: mockSkillContentService },
        { provide: MCPManager, useValue: mockMCPManager },
        { provide: SecretsService, useValue: mockSecretsService },
        { provide: SearchService, useValue: mockSearchService },
      ],
    }).compile();

    service = module.get<AIAdminService>(AIAdminService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ==================== onModuleInit / onModuleDestroy ====================

  describe("onModuleInit / onModuleDestroy lifecycle", () => {
    it("should initialize configs on module init", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);
      await service.onModuleInit();
      // syncToolConfigs and syncSkillConfigs are called
      expect(mockPrismaService.toolConfig.findMany).toHaveBeenCalled();
    });

    it("should start MCP health check timer on init", async () => {
      const setIntervalSpy = jest.spyOn(global, "setInterval");
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);
      await service.onModuleInit();
      expect(setIntervalSpy).toHaveBeenCalled();
    });

    it("should clear health check interval on destroy", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);
      await service.onModuleInit();
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");
      service.onModuleDestroy();
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it("should handle destroy when no interval is set", () => {
      // Should not throw when called before init
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  // ==================== syncToolConfigs ====================

  describe("syncToolConfigs (via onModuleInit)", () => {
    it("should create missing tool configs for registered tools", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "web-search",
          name: "Web Search",
          description: "Search the web",
          category: "search",
          tags: ["web"],
        },
      ]);
      mockPrismaService.toolConfig.findMany.mockResolvedValueOnce([
        { toolId: "web-search" },
      ]); // existing in db
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);

      await service.onModuleInit();

      // Already exists, no createMany needed
      expect(mockPrismaService.toolConfig.createMany).not.toHaveBeenCalled();
    });

    it("should create configs for tools not in database", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "new-tool",
          name: "New Tool",
          description: "A new tool",
          category: "general",
          tags: [],
        },
      ]);
      mockPrismaService.toolConfig.findMany.mockResolvedValueOnce([]); // no existing
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);

      await service.onModuleInit();

      expect(mockPrismaService.toolConfig.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ toolId: "new-tool", enabled: true }),
          ]),
          skipDuplicates: true,
        }),
      );
    });

    it("should handle sync error gracefully", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "tool-1",
          name: "Tool",
          description: "",
          category: "test",
          tags: [],
        },
      ]);
      mockPrismaService.toolConfig.findMany.mockRejectedValueOnce(
        new Error("DB error"),
      );
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);

      // Should not throw
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  // ==================== initializeConfigs MCP auto-connect ====================

  describe("initializeConfigs MCP auto-connect", () => {
    it("should auto-connect enabled stdio servers on init", async () => {
      mockToolRegistry.getAll.mockReturnValue([]);
      mockSkillRegistry.getAll.mockReturnValue([]);
      mockPrismaService.toolConfig.findMany.mockResolvedValue([]);
      mockPrismaService.skillConfig.findMany.mockResolvedValue([]);
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          serverId: "test-server",
          name: "Test Server",
          transport: "stdio",
          command: "/usr/bin/test",
          args: ["--arg1"],
          enabled: true,
          autoConnect: true,
          url: null,
          secretKey: null,
          apiKey: null,
          metadata: {},
        },
      ]);
      mockMCPManager.connect.mockResolvedValue(undefined);
      mockPrismaService.mCPServerConfig.update.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockMCPManager.registerServer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "test-server",
          transport: "stdio",
        }),
      );
      expect(mockMCPManager.connect).toHaveBeenCalledWith("test-server");
    });

    it("should auto-connect enabled SSE servers on init", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          serverId: "sse-server",
          name: "SSE Server",
          transport: "sse",
          command: null,
          args: [],
          enabled: true,
          autoConnect: true,
          url: "https://mcp.example.com",
          secretKey: null,
          apiKey: null,
          metadata: {},
        },
      ]);
      mockMCPManager.connect.mockResolvedValue(undefined);
      mockPrismaService.mCPServerConfig.update.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockMCPManager.registerServer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "sse-server",
          transport: "http",
        }),
      );
    });

    it("should handle MCP connection failure gracefully", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          serverId: "failing-server",
          name: "Failing Server",
          transport: "stdio",
          command: "/usr/bin/fail",
          args: [],
          enabled: true,
          autoConnect: true,
          url: null,
          secretKey: null,
          apiKey: null,
          metadata: {},
        },
      ]);
      mockMCPManager.connect.mockRejectedValue(new Error("Connection refused"));
      mockPrismaService.mCPServerConfig.update.mockResolvedValue({});

      // Should not throw
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it("should resolve env from secret manager when secretKey is set", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          serverId: "secret-server",
          name: "Secret Server",
          transport: "stdio",
          command: "/usr/bin/secret",
          args: [],
          enabled: true,
          autoConnect: true,
          url: null,
          secretKey: "MY_SECRET_KEY",
          apiKey: null,
          metadata: {},
        },
      ]);
      mockSecretsService.getValueInternal.mockResolvedValue("resolved-api-key");
      mockMCPManager.connect.mockResolvedValue(undefined);
      mockPrismaService.mCPServerConfig.update.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockSecretsService.getValueInternal).toHaveBeenCalledWith(
        "MY_SECRET_KEY",
      );
      expect(mockMCPManager.registerServer).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({
            MY_SECRET_KEY: "resolved-api-key",
          }),
        }),
      );
    });

    it("should use apiKey directly when secretKey is not set", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          serverId: "apikey-server",
          name: "API Key Server",
          transport: "stdio",
          command: "/usr/bin/apikey",
          args: [],
          enabled: true,
          autoConnect: true,
          url: null,
          secretKey: null,
          apiKey: "direct-api-key",
          metadata: {},
        },
      ]);
      mockMCPManager.connect.mockResolvedValue(undefined);
      mockPrismaService.mCPServerConfig.update.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockMCPManager.registerServer).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({
            API_KEY: "direct-api-key",
          }),
        }),
      );
    });

    it("should resolve secret references in metadata.env", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          serverId: "meta-server",
          name: "Meta Server",
          transport: "stdio",
          command: "/usr/bin/meta",
          args: [],
          enabled: true,
          autoConnect: true,
          url: null,
          secretKey: null,
          apiKey: null,
          metadata: {
            env: {
              SOME_KEY: "$secret:MY_SECRET",
              PLAIN_KEY: "plain-value",
            },
          },
        },
      ]);
      mockSecretsService.getValueInternal.mockResolvedValue("resolved-value");
      mockMCPManager.connect.mockResolvedValue(undefined);
      mockPrismaService.mCPServerConfig.update.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockSecretsService.getValueInternal).toHaveBeenCalledWith(
        "MY_SECRET",
      );
    });
  });

  // ==================== getUsageCountsByType ====================

  describe("getUsageCountsByType", () => {
    it("should return usage counts grouped by capability id", async () => {
      mockPrismaService.aIUsageLog.groupBy.mockResolvedValue([
        { capabilityId: "web-search", _count: { capabilityId: 15 } },
        { capabilityId: "text-gen", _count: { capabilityId: 30 } },
      ]);

      const result = await service.getUsageCountsByType("tool");

      expect(result["web-search"]).toBe(15);
      expect(result["text-gen"]).toBe(30);
      expect(mockPrismaService.aIUsageLog.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { capabilityType: "tool" },
        }),
      );
    });

    it("should return empty object when no usage logs", async () => {
      mockPrismaService.aIUsageLog.groupBy.mockResolvedValue([]);

      const result = await service.getUsageCountsByType("skill");

      expect(result).toEqual({});
    });
  });

  // ==================== getToolConfigs ====================

  describe("getToolConfigs", () => {
    it("should return tool configurations with stats", async () => {
      mockPrismaService.toolConfig.findMany.mockResolvedValue([]);

      const result = await service.getToolConfigs();

      expect(result).toHaveProperty("tools");
      expect(result).toHaveProperty("stats");
      expect(result.stats).toHaveProperty("total");
      expect(result.stats).toHaveProperty("enabled");
      expect(result.stats).toHaveProperty("implemented");
    });

    it("should merge database config with tool definitions", async () => {
      mockPrismaService.toolConfig.findMany.mockResolvedValue([
        {
          id: "db-1",
          toolId: "web-search",
          enabled: false,
          displayName: "Custom Name",
          secretKey: "test-secret",
          description: null,
          category: "search",
          tags: [],
          config: null,
          requiresAuth: false,
          allowedRoles: [],
        },
      ]);

      const result = await service.getToolConfigs();

      const webSearchTool = result.tools.find((t) => t.toolId === "web-search");
      expect(webSearchTool).toBeDefined();
      expect(webSearchTool?.enabled).toBe(false);
      expect(webSearchTool?.displayName).toBe("Custom Name");
      expect(webSearchTool?.secretKey).toBe("test-secret");
    });

    it("should include registry tools that are implemented", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "registered-tool",
          name: "Registered Tool",
          description: "A registered tool",
          category: "utility",
          tags: ["test"],
          inputSchema: null,
          outputSchema: null,
        },
      ]);
      mockPrismaService.toolConfig.findMany.mockResolvedValue([]);

      const result = await service.getToolConfigs();

      const tool = result.tools.find((t) => t.toolId === "registered-tool");
      expect(tool).toBeDefined();
      expect(tool?.implemented).toBe(true);
    });

    it("should include external tools from DB not in registry", async () => {
      mockToolRegistry.getAll.mockReturnValue([]);
      mockPrismaService.toolConfig.findMany.mockResolvedValue([
        {
          id: "db-ext-1",
          toolId: "external-api",
          enabled: true,
          displayName: "External API",
          description: "An external service",
          category: "external",
          tags: [],
          config: null,
          secretKey: null,
          requiresAuth: false,
          allowedRoles: [],
        },
      ]);

      const result = await service.getToolConfigs();

      const extTool = result.tools.find((t) => t.toolId === "external-api");
      expect(extTool).toBeDefined();
      expect(extTool?.implemented).toBe(false);
    });

    it("should compute stats correctly", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "tool-1",
          name: "Tool 1",
          description: "",
          category: "cat-a",
          tags: [],
          inputSchema: null,
          outputSchema: null,
        },
        {
          id: "tool-2",
          name: "Tool 2",
          description: "",
          category: "cat-b",
          tags: [],
          inputSchema: null,
          outputSchema: null,
        },
      ]);
      mockPrismaService.toolConfig.findMany.mockResolvedValue([
        {
          id: "db-1",
          toolId: "tool-1",
          enabled: false,
          displayName: null,
          description: null,
          category: "cat-a",
          tags: [],
          config: null,
          secretKey: null,
          requiresAuth: false,
          allowedRoles: [],
        },
      ]);

      const result = await service.getToolConfigs();

      expect(result.stats.total).toBeGreaterThanOrEqual(2);
      expect(result.stats.byCategory).toHaveProperty("cat-a");
    });
  });

  // ==================== diagnoseTools ====================

  describe("diagnoseTools", () => {
    it("should return healthy status for tools with no secret key required", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "simple-tool",
          name: "Simple Tool",
          description: "",
          category: "utility",
          tags: [],
        },
      ]);
      mockPrismaService.toolConfig.findMany.mockResolvedValue([]);
      mockPrismaService.secret.findMany.mockResolvedValue([]);

      const result = await service.diagnoseTools();

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].status).toBe("healthy");
      expect(result.summary.healthy).toBe(1);
    });

    it("should return unhealthy for disabled tool", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "disabled-tool",
          name: "Disabled Tool",
          description: "",
          category: "utility",
          tags: [],
        },
      ]);
      mockPrismaService.toolConfig.findMany.mockResolvedValue([
        {
          toolId: "disabled-tool",
          enabled: false,
          secretKey: null,
        },
      ]);
      mockPrismaService.secret.findMany.mockResolvedValue([]);

      const result = await service.diagnoseTools();

      expect(result.tools[0].status).toBe("unhealthy");
    });

    it("should return unhealthy when secretKey references missing secret", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "tool-with-secret",
          name: "Tool With Secret",
          description: "",
          category: "utility",
          tags: [],
        },
      ]);
      mockPrismaService.toolConfig.findMany.mockResolvedValue([
        {
          toolId: "tool-with-secret",
          enabled: true,
          secretKey: "MISSING_SECRET",
        },
      ]);
      mockPrismaService.secret.findMany.mockResolvedValue([]);
      mockSecretsService.exists.mockResolvedValue(false);

      const result = await service.diagnoseTools();

      expect(result.tools[0].status).toBe("unhealthy");
      expect(result.tools[0].secretKeyValid).toBe(false);
    });

    it("should return unconfigured for tools needing provider config", async () => {
      // BUILTIN_TOOL_TO_PROVIDER_CATEGORY maps "audio-generation" -> "TTS"
      // TTS providers (elevenlabs, googleTts) require a secret key - none have noKeyRequired
      // With no secrets configured, tool should be "unconfigured"
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "audio-generation",
          name: "Audio Generation",
          description: "",
          category: "TTS",
          tags: [],
        },
      ]);
      mockPrismaService.toolConfig.findMany.mockResolvedValue([
        {
          toolId: "audio-generation",
          enabled: true,
          secretKey: null,
        },
      ]);
      // No secrets configured for TTS providers
      mockPrismaService.secret.findMany.mockResolvedValue([]);

      const result = await service.diagnoseTools();

      expect(result.tools[0].status).toBe("unconfigured");
    });
  });

  // ==================== diagnoseMCPServers ====================

  describe("diagnoseMCPServers", () => {
    it("should return disconnected status for disabled server", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          serverId: "server-1",
          name: "Server 1",
          enabled: false,
        },
      ]);
      mockMCPManager.getClient.mockReturnValue(null);

      const result = await service.diagnoseMCPServers();

      expect(result.servers[0].status).toBe("disconnected");
      expect(result.servers[0].message).toContain("禁用");
    });

    it("should return connected status for connected server", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          serverId: "server-1",
          name: "Server 1",
          enabled: true,
        },
      ]);
      const mockClient = {
        connected: true,
        listTools: jest
          .fn()
          .mockResolvedValue([
            { name: "tool-a", description: "Tool A" },
            { name: "tool-b" },
          ]),
      };
      mockMCPManager.getClient.mockReturnValue(mockClient);

      const result = await service.diagnoseMCPServers();

      expect(result.servers[0].status).toBe("connected");
      expect(result.servers[0].toolCount).toBe(2);
    });

    it("should return error status when listTools fails", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          serverId: "server-1",
          name: "Server 1",
          enabled: true,
        },
      ]);
      const mockClient = {
        connected: true,
        listTools: jest.fn().mockRejectedValue(new Error("List failed")),
      };
      mockMCPManager.getClient.mockReturnValue(mockClient);

      const result = await service.diagnoseMCPServers();

      expect(result.servers[0].status).toBe("error");
    });

    it("should return summary with correct counts", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        { serverId: "s1", name: "Server 1", enabled: true },
        { serverId: "s2", name: "Server 2", enabled: false },
      ]);
      const connectedClient = {
        connected: true,
        listTools: jest.fn().mockResolvedValue([{ name: "t1" }]),
      };
      mockMCPManager.getClient
        .mockReturnValueOnce(connectedClient)
        .mockReturnValueOnce(null);

      const result = await service.diagnoseMCPServers();

      expect(result.summary.total).toBe(2);
      expect(result.summary.connected).toBe(1);
    });
  });

  // ==================== diagnoseExternalTools ====================

  describe("diagnoseExternalTools", () => {
    it("should identify tools with no key required", async () => {
      mockPrismaService.secret.findMany.mockResolvedValue([]);

      const result = await service.diagnoseExternalTools();

      const noKeyTools = result.tools.filter(
        (t) => t.status === "no_key_required",
      );
      expect(noKeyTools.length).toBeGreaterThan(0);
    });

    it("should mark tool as configured when secret exists", async () => {
      mockPrismaService.secret.findMany.mockResolvedValue([
        { name: "tavily-search-api-key" },
      ]);

      const result = await service.diagnoseExternalTools();

      const tavilyTool = result.tools.find((t) => t.id === "tavily");
      expect(tavilyTool?.status).toBe("configured");
      expect(tavilyTool?.secretKeyValid).toBe(true);
    });

    it("should mark tool as unconfigured when secret is missing", async () => {
      mockPrismaService.secret.findMany.mockResolvedValue([]);

      const result = await service.diagnoseExternalTools();

      const tavilyTool = result.tools.find((t) => t.id === "tavily");
      expect(tavilyTool?.status).toBe("unconfigured");
      expect(tavilyTool?.secretKeyValid).toBe(false);
    });

    it("should return correct summary counts", async () => {
      mockPrismaService.secret.findMany.mockResolvedValue([
        { name: "tavily-search-api-key" },
        { name: "jina-api-key" },
      ]);

      const result = await service.diagnoseExternalTools();

      expect(result.summary.total).toBeGreaterThan(0);
      expect(result.summary.configured).toBeGreaterThanOrEqual(2);
    });
  });

  // ==================== diagnoseAllCapabilities ====================

  describe("diagnoseAllCapabilities", () => {
    it("should return comprehensive diagnosis with all sections", async () => {
      mockPrismaService.secret.findMany.mockResolvedValue([
        {
          name: "test-secret",
          isActive: true,
          expiresAt: null,
        },
      ]);
      mockPrismaService.toolConfig.findMany.mockResolvedValue([]);
      mockPrismaService.skillConfig.findMany.mockResolvedValue([]);
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);
      mockPrismaService.aITeamTemplate.findMany.mockResolvedValue([]);
      mockMCPManager.getClient.mockReturnValue(null);

      const result = await service.diagnoseAllCapabilities();

      expect(result).toHaveProperty("secrets");
      expect(result).toHaveProperty("builtinTools");
      expect(result).toHaveProperty("mcpServers");
      expect(result).toHaveProperty("externalTools");
      expect(result).toHaveProperty("skills");
      expect(result).toHaveProperty("teamCapabilities");
      expect(result).toHaveProperty("breakpoints");
      expect(result.breakpoints).toBeInstanceOf(Array);
    });

    it("should flag expired secrets", async () => {
      mockPrismaService.secret.findMany.mockResolvedValue([
        {
          name: "expired-secret",
          isActive: true,
          expiresAt: new Date("2020-01-01"),
        },
      ]);
      mockPrismaService.toolConfig.findMany.mockResolvedValue([]);
      mockPrismaService.skillConfig.findMany.mockResolvedValue([]);
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);
      mockPrismaService.aITeamTemplate.findMany.mockResolvedValue([]);
      mockMCPManager.getClient.mockReturnValue(null);

      const result = await service.diagnoseAllCapabilities();

      const expiredSecrets = result.secrets.items.filter(
        (s) => s.status === "expired",
      );
      expect(expiredSecrets).toHaveLength(1);
    });

    it("should flag inactive secrets", async () => {
      mockPrismaService.secret.findMany.mockResolvedValue([
        {
          name: "inactive-secret",
          isActive: false,
          expiresAt: null,
        },
      ]);
      mockPrismaService.toolConfig.findMany.mockResolvedValue([]);
      mockPrismaService.skillConfig.findMany.mockResolvedValue([]);
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);
      mockPrismaService.aITeamTemplate.findMany.mockResolvedValue([]);
      mockMCPManager.getClient.mockReturnValue(null);

      const result = await service.diagnoseAllCapabilities();

      const inactiveSecrets = result.secrets.items.filter(
        (s) => s.status === "inactive",
      );
      expect(inactiveSecrets).toHaveLength(1);
      expect(result.secrets.summary.inactive).toBe(1);
    });

    it("should add S2 breakpoint when tool references non-existent secret", async () => {
      mockPrismaService.secret.findMany.mockResolvedValue([]); // no secrets
      mockPrismaService.toolConfig.findMany.mockResolvedValue([
        { toolId: "web-search", secretKey: "MISSING_SECRET" },
      ]);
      mockPrismaService.skillConfig.findMany.mockResolvedValue([]);
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);
      mockPrismaService.aITeamTemplate.findMany.mockResolvedValue([]);
      mockMCPManager.getClient.mockReturnValue(null);
      mockSecretsService.exists.mockResolvedValue(false);

      const result = await service.diagnoseAllCapabilities();

      const s2Breakpoints = result.breakpoints.filter((bp) => bp.code === "S2");
      expect(s2Breakpoints).toHaveLength(1);
    });

    it("should add K1 breakpoint for skill with missing file", async () => {
      mockPrismaService.secret.findMany.mockResolvedValue([]);
      mockPrismaService.toolConfig.findMany.mockResolvedValue([]);
      mockPrismaService.skillConfig.findMany.mockResolvedValue([
        {
          skillId: "missing-skill",
          displayName: "Missing Skill",
          enabled: true,
        },
      ]);
      mockSkillLoaderService.getAllLoadedSkills.mockReturnValue([]); // not loaded
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);
      mockPrismaService.aITeamTemplate.findMany.mockResolvedValue([]);
      mockMCPManager.getClient.mockReturnValue(null);

      const result = await service.diagnoseAllCapabilities();

      const k1Breakpoints = result.breakpoints.filter((bp) => bp.code === "K1");
      expect(k1Breakpoints).toHaveLength(1);
    });

    it("should add A4 breakpoint for team member with no capabilities", async () => {
      mockPrismaService.secret.findMany.mockResolvedValue([]);
      mockPrismaService.toolConfig.findMany.mockResolvedValue([]);
      mockPrismaService.skillConfig.findMany.mockResolvedValue([]);
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);
      mockPrismaService.aITeamTemplate.findMany.mockResolvedValue([
        {
          id: "team-1",
          name: "Test Team",
          members: [
            {
              id: "member-1",
              displayName: "Empty Member",
              capabilities: [],
              mcpTools: [],
            },
          ],
        },
      ]);
      mockMCPManager.getClient.mockReturnValue(null);
      mockSecretsService.exists.mockResolvedValue(false);

      const result = await service.diagnoseAllCapabilities();

      const a4Breakpoints = result.breakpoints.filter((bp) => bp.code === "A4");
      expect(a4Breakpoints).toHaveLength(1);
    });

    it("should identify referencedBy tools for secrets", async () => {
      mockPrismaService.secret.findMany.mockResolvedValue([
        { name: "my-secret", isActive: true, expiresAt: null },
      ]);
      mockPrismaService.toolConfig.findMany
        .mockResolvedValueOnce([
          { toolId: "web-search", secretKey: "my-secret" },
        ])
        .mockResolvedValueOnce([]) // for diagnoseTools
        .mockResolvedValueOnce([]) // for getAvailableToolsForAgent
        .mockResolvedValueOnce([]); // final calls

      mockPrismaService.skillConfig.findMany.mockResolvedValue([]);
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);
      mockPrismaService.aITeamTemplate.findMany.mockResolvedValue([]);
      mockMCPManager.getClient.mockReturnValue(null);
      mockSecretsService.exists.mockResolvedValue(true);

      const result = await service.diagnoseAllCapabilities();

      const mySecret = result.secrets.items.find((s) => s.name === "my-secret");
      expect(mySecret?.referencedBy).toContain("web-search");
    });
  });

  // ==================== getServiceKeyHealth ====================

  describe("getServiceKeyHealth", () => {
    it("should return empty array for unknown service", async () => {
      const result = await service.getServiceKeyHealth("unknown-service");

      expect(result).toEqual([]);
    });

    it("should delegate to SearchService for tavily", async () => {
      const mockStatus = [{ key: "tvly-key", status: "active" }];
      mockSearchService.getKeyHealthStatus.mockReturnValue(mockStatus);
      mockSecretsService.getValueInternal.mockResolvedValue(
        "tvly-key1,tvly-key2",
      );

      const result = await service.getServiceKeyHealth("tavily");

      expect(mockSearchService.getKeyHealthStatus).toHaveBeenCalledWith(
        "tavily",
      );
      expect(result).toEqual(mockStatus);
    });

    it("should delegate to SearchService for serper", async () => {
      const mockStatus = [{ key: "serper-key", status: "active" }];
      mockSearchService.getKeyHealthStatus.mockReturnValue(mockStatus);
      mockSecretsService.getValueInternal.mockResolvedValue("serper-key");

      await service.getServiceKeyHealth("serper");

      expect(mockSearchService.getKeyHealthStatus).toHaveBeenCalledWith(
        "serper",
      );
    });

    it("should return empty when secret not found", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue(null);

      const result = await service.getServiceKeyHealth("jina");

      expect(result).toEqual([]);
    });

    it("should return empty when secret has empty value", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("  ,  ,  ");

      const result = await service.getServiceKeyHealth("jina");

      expect(result).toEqual([]);
    });
  });

  // ==================== getToolKeyHealth (deprecated) ====================

  describe("getToolKeyHealth (deprecated)", () => {
    it("should delegate to getServiceKeyHealth", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue(null);

      const result = await service.getToolKeyHealth("jina");

      expect(result).toEqual([]);
    });
  });

  // ==================== getAvailableToolsForAgent ====================

  describe("getAvailableToolsForAgent", () => {
    it("should return only healthy enabled tools", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "healthy-tool",
          name: "Healthy Tool",
          description: "Works fine",
          category: "utility",
          tags: ["good"],
        },
        {
          id: "disabled-tool",
          name: "Disabled Tool",
          description: "",
          category: "utility",
          tags: [],
        },
      ]);
      mockPrismaService.toolConfig.findMany
        .mockResolvedValueOnce([]) // for diagnoseTools.getAll + getAll
        .mockResolvedValueOnce([
          { toolId: "healthy-tool" }, // enabled tools
        ]);
      mockPrismaService.secret.findMany.mockResolvedValue([]);

      const result = await service.getAvailableToolsForAgent();

      expect(result).toBeInstanceOf(Array);
    });

    it("should return tools with required properties", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "tool-1",
          name: "Tool 1",
          description: "A tool",
          category: "search",
          tags: ["tag1"],
        },
      ]);
      mockPrismaService.toolConfig.findMany.mockResolvedValue([
        { toolId: "tool-1", enabled: true, secretKey: null },
      ]);
      mockPrismaService.secret.findMany.mockResolvedValue([]);

      const result = await service.getAvailableToolsForAgent();

      if (result.length > 0) {
        expect(result[0]).toHaveProperty("toolId");
        expect(result[0]).toHaveProperty("name");
        expect(result[0]).toHaveProperty("description");
        expect(result[0]).toHaveProperty("category");
        expect(result[0]).toHaveProperty("tags");
      }
    });
  });

  // ==================== getToolAliases (PR-S0a) ====================

  describe("getToolAliases", () => {
    // ★ 2026-05-07 (PR-S0a Round 2): 架构师 follow-up — 看护 alias map 派生
    // 单源真理。若 backend tool-id-aliases.ts 改动后此 spec 不更新，立即红。
    it("returns aliasToRegistry shallow copy (no source-of-truth mutation risk)", () => {
      const result1 = service.getToolAliases();
      const result2 = service.getToolAliases();
      // 不同调用返回不同对象引用（浅拷贝），防止 caller 改 map 污染源
      expect(result1.aliasToRegistry).not.toBe(result2.aliasToRegistry);
      expect(result1.aliasToRegistry).toEqual(result2.aliasToRegistry);
    });

    it("computes multiProviderRegistryIds for N:1 parents only", () => {
      const result = service.getToolAliases();
      // 当前 N:1 父：web-search (4 providers) / web-scraper (3) / audio-generation (2)
      expect(result.multiProviderRegistryIds).toEqual(
        expect.arrayContaining([
          "web-search",
          "web-scraper",
          "audio-generation",
        ]),
      );
      expect(result.multiProviderRegistryIds.length).toBe(3);
    });

    it("does NOT include 1:1 mapping registry ids in multiProviderRegistryIds", () => {
      const result = service.getToolAliases();
      // 1:1 映射不应出现在 multiProvider 集合
      const oneToOneIds = [
        "arxiv-search",
        "pubmed",
        "openalex-search",
        "finance-api",
        "weather-api",
        "github-search",
        "federal-register",
        "congress-gov",
        "whitehouse-news",
        "hackernews-search",
        "industry-report-search",
        "semantic-scholar",
      ];
      for (const id of oneToOneIds) {
        expect(result.multiProviderRegistryIds).not.toContain(id);
      }
    });

    it("aliasToRegistry contains expected provider→registry mappings", () => {
      const { aliasToRegistry } = service.getToolAliases();
      // 看护几个关键 N:1 + 1:1 mapping
      expect(aliasToRegistry.tavily).toBe("web-search");
      expect(aliasToRegistry.perplexity).toBe("web-search");
      expect(aliasToRegistry.serper).toBe("web-search");
      expect(aliasToRegistry.duckduckgo).toBe("web-search");
      expect(aliasToRegistry.arxiv).toBe("arxiv-search");
      expect(aliasToRegistry.pubmed).toBe("pubmed");
      expect(aliasToRegistry.elevenlabs).toBe("audio-generation");
      expect(aliasToRegistry.googleTts).toBe("audio-generation");
    });
  });

  // ==================== updateToolConfig ====================

  describe("updateToolConfig", () => {
    it("should validate secretKey before saving", async () => {
      mockSecretsService.exists.mockResolvedValue(false);

      await expect(
        service.updateToolConfig("test-tool", { secretKey: "non-existent" }),
      ).rejects.toThrow("Secret key 'non-existent' does not exist");

      expect(mockSecretsService.exists).toHaveBeenCalledWith("non-existent");
      expect(mockPrismaService.toolConfig.upsert).not.toHaveBeenCalled();
    });

    it("should save config when secretKey is valid", async () => {
      mockSecretsService.exists.mockResolvedValue(true);
      mockPrismaService.toolConfig.upsert.mockResolvedValue({
        toolId: "test-tool",
        enabled: true,
        secretKey: "valid-secret",
      });

      const result = await service.updateToolConfig("test-tool", {
        secretKey: "valid-secret",
        enabled: true,
      });

      expect(result.success).toBe(true);
      expect(mockPrismaService.toolConfig.upsert).toHaveBeenCalled();
    });

    it("should allow null secretKey without validation", async () => {
      mockPrismaService.toolConfig.upsert.mockResolvedValue({
        toolId: "test-tool",
        enabled: true,
        secretKey: null,
      });

      const result = await service.updateToolConfig("test-tool", {
        secretKey: null,
        enabled: true,
      });

      expect(result.success).toBe(true);
      expect(mockSecretsService.exists).not.toHaveBeenCalled();
    });

    it("should allow undefined secretKey without validation", async () => {
      mockPrismaService.toolConfig.upsert.mockResolvedValue({
        toolId: "test-tool",
        enabled: false,
        secretKey: null,
      });

      const result = await service.updateToolConfig("test-tool", {
        enabled: false,
      });

      expect(result.success).toBe(true);
      expect(mockSecretsService.exists).not.toHaveBeenCalled();
    });

    // ★ 2026-05-07: 看护 Screenshot_5 真因回归 ——
    // N:1 映射（tavily/perplexity/serper/duckduckgo → web-search）下，绝不能把
    // provider 的 secretKey 同步到 multi-provider parent 行；否则 last-write-wins
    // 让 parent secretKey 变垃圾，再被前端 bridge 灌回所有 sibling provider。
    it("does NOT sync secretKey to multi-provider parent (N:1 mapping)", async () => {
      mockSecretsService.exists.mockResolvedValue(true);
      mockPrismaService.toolConfig.upsert.mockResolvedValue({
        toolId: "tavily",
        enabled: true,
        secretKey: "tavily-search-api-key",
      });

      await service.updateToolConfig("tavily", {
        secretKey: "tavily-search-api-key",
        enabled: true,
      });

      const upsertCalls = mockPrismaService.toolConfig.upsert.mock.calls;
      // 第 1 次 upsert: tavily 自己（必须有 secretKey）
      expect(upsertCalls[0][0].where).toEqual({ toolId: "tavily" });
      expect(upsertCalls[0][0].update.secretKey).toBe("tavily-search-api-key");
      // 第 2 次 upsert（如果有）: web-search parent（**禁止** secretKey 字段）
      if (upsertCalls.length > 1) {
        expect(upsertCalls[1][0].where).toEqual({ toolId: "web-search" });
        expect(upsertCalls[1][0].update.secretKey).toBeUndefined();
        expect(upsertCalls[1][0].create.secretKey).toBeUndefined();
        // enabled 仍然同步（capability-level on/off 是有意义的）
        expect(upsertCalls[1][0].update.enabled).toBe(true);
      }
    });

    // 1:1 映射（arxiv → arxiv-search）继续 sync —— 那种情况 provider 和 parent
    // 语义上是同一工具，sync 是为了与 ToolRegistry 注册名对齐。
    it("DOES sync secretKey to single-provider parent (1:1 mapping)", async () => {
      mockSecretsService.exists.mockResolvedValue(true);
      mockPrismaService.toolConfig.upsert.mockResolvedValue({
        toolId: "arxiv",
        enabled: true,
        secretKey: "arxiv-api-key",
      });

      await service.updateToolConfig("arxiv", {
        secretKey: "arxiv-api-key",
        enabled: true,
      });

      const upsertCalls = mockPrismaService.toolConfig.upsert.mock.calls;
      expect(upsertCalls.length).toBe(2);
      expect(upsertCalls[1][0].where).toEqual({ toolId: "arxiv-search" });
      expect(upsertCalls[1][0].update.secretKey).toBe("arxiv-api-key");
    });
  });

  // ==================== testTool ====================

  describe("testTool", () => {
    it("should return error for unregistered tool", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const result = await service.testTool("non-existent-tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("not implemented or registered");
    });

    it("should execute tool when it has execute method", async () => {
      const mockTool = {
        id: "executable-tool",
        execute: jest.fn().mockResolvedValue({ result: "ok" }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);
      mockPrismaService.toolConfig.findUnique.mockResolvedValue(null);
      mockPrismaService.aIUsageLog.create.mockResolvedValue({});

      const result = await service.testTool("executable-tool", {
        query: "test",
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ resultCount: 1 });
    });

    it("should return success message for tool without execute method", async () => {
      const mockTool = { id: "no-execute-tool" };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);
      mockPrismaService.toolConfig.findUnique.mockResolvedValue(null);

      const result = await service.testTool("no-execute-tool");

      expect(result.success).toBe(true);
      expect(result.message).toContain("execute method not available");
    });

    it("should return failure when tool execution throws", async () => {
      const mockTool = {
        id: "failing-tool",
        execute: jest.fn().mockRejectedValue(new Error("Execution failed")),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);
      mockPrismaService.toolConfig.findUnique.mockResolvedValue(null);
      mockPrismaService.aIUsageLog.create.mockResolvedValue({});

      const result = await service.testTool("failing-tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Execution failed");
    });

    it("should pass API key from secret to tool execute", async () => {
      const mockTool = {
        id: "tool-with-key",
        execute: jest.fn().mockResolvedValue({ ok: true }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);
      mockPrismaService.toolConfig.findUnique.mockResolvedValue({
        toolId: "tool-with-key",
        secretKey: "MY_API_KEY",
      });
      mockSecretsService.getValue.mockResolvedValue("actual-api-key");
      mockPrismaService.aIUsageLog.create.mockResolvedValue({});

      await service.testTool("tool-with-key", { query: "hello" });

      expect(mockTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "actual-api-key" }),
        expect.objectContaining({ callerType: "admin" }),
      );
    });
  });

  // ==================== getSkillConfigs ====================

  describe("getSkillConfigs", () => {
    it("should return skill configurations with stats", async () => {
      mockPrismaService.skillConfig.findMany.mockResolvedValue([]);

      const result = await service.getSkillConfigs();

      expect(result).toHaveProperty("skills");
      expect(result).toHaveProperty("stats");
      expect(result.stats).toHaveProperty("total");
      expect(result.stats).toHaveProperty("enabled");
    });

    it("should combine registry skills and loaded skills", async () => {
      mockSkillRegistry.getAll.mockReturnValue([
        {
          id: "registry-skill",
          name: "Registry Skill",
          description: "From registry",
          layer: "content",
          domain: "common",
        },
      ]);

      mockSkillLoaderService.getAllLoadedSkills.mockReturnValue([
        {
          metadata: {
            id: "loaded-skill",
            name: "Loaded Skill",
            description: "From loader",
            domain: "writing",
            tags: ["test"],
          },
        },
      ]);

      mockPrismaService.skillConfig.findMany.mockResolvedValue([]);

      const result = await service.getSkillConfigs();

      expect(result.skills.length).toBeGreaterThanOrEqual(1);
    });

    it("should include marketplace skills from DB", async () => {
      mockSkillRegistry.getAll.mockReturnValue([]);
      mockSkillLoaderService.getAllLoadedSkills.mockReturnValue([]);
      mockPrismaService.skillConfig.findMany.mockResolvedValue([
        {
          id: "db-skill-1",
          skillId: "marketplace-skill",
          displayName: "Marketplace Skill",
          description: "From marketplace",
          layer: "application",
          domain: "writing",
          enabled: true,
          tags: ["market"],
          config: null,
          allowedDomains: [],
        },
      ]);

      const result = await service.getSkillConfigs();

      const mpSkill = result.skills.find(
        (s) => s.skillId === "marketplace-skill",
      );
      expect(mpSkill).toBeDefined();
      expect(mpSkill?.source).toBe("marketplace");
    });

    it("should compute byLayer and byDomain stats", async () => {
      mockSkillRegistry.getAll.mockReturnValue([
        {
          id: "skill-a",
          name: "Skill A",
          description: "",
          layer: "content",
          domain: "writing",
          tags: [],
          requiredTools: [],
          requiredSkills: [],
        },
      ]);
      mockPrismaService.skillConfig.findMany.mockResolvedValue([]);

      const result = await service.getSkillConfigs();

      expect(result.stats.byLayer).toBeDefined();
      expect(result.stats.byDomain).toBeDefined();
    });
  });

  // ==================== updateSkillConfig ====================

  describe("updateSkillConfig", () => {
    it("should upsert skill config", async () => {
      mockPrismaService.skillConfig.upsert.mockResolvedValue({
        skillId: "test-skill",
        enabled: true,
      });

      const result = await service.updateSkillConfig("test-skill", {
        enabled: true,
        displayName: "Updated Skill",
      });

      expect(result.success).toBe(true);
      expect(mockPrismaService.skillConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { skillId: "test-skill" },
        }),
      );
    });

    it("should invalidate skill definitions cache after update", async () => {
      mockPrismaService.skillConfig.upsert.mockResolvedValue({
        skillId: "test-skill",
        enabled: false,
      });

      await service.updateSkillConfig("test-skill", { enabled: false });

      // Cache should be cleared - next getSkillConfigs should re-fetch
      expect(mockPrismaService.skillConfig.upsert).toHaveBeenCalled();
    });
  });

  // ==================== uploadSkill ====================

  describe("uploadSkill", () => {
    it("should upload skill from data", async () => {
      // The upload logic resolves skillId as: skillData.skillId || skillData.name || skillData.id
      // When skillId is provided directly, it uses that
      mockPrismaService.skillConfig.upsert.mockResolvedValue({
        skillId: "my-uploaded-skill",
        enabled: true,
      });

      const result = await service.uploadSkill({
        skillId: "my-uploaded-skill",
        name: "Uploaded Skill Display",
        description: "An uploaded skill",
        layer: "content",
        domain: "writing",
        tags: ["uploaded"],
      });

      expect(result).toBeDefined();
      expect(mockPrismaService.skillConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { skillId: "my-uploaded-skill" },
          create: expect.objectContaining({
            skillId: "my-uploaded-skill",
          }),
        }),
      );
    });

    it("should use skillId field when present", async () => {
      mockPrismaService.skillConfig.upsert.mockResolvedValue({
        skillId: "custom-skill-id",
        enabled: true,
      });

      await service.uploadSkill({
        skillId: "custom-skill-id",
        name: "My Skill",
      });

      expect(mockPrismaService.skillConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { skillId: "custom-skill-id" },
        }),
      );
    });

    it("should throw when no id field provided", async () => {
      await expect(
        service.uploadSkill({ description: "No id" }),
      ).rejects.toThrow("Skill must have an id, skillId, or name field");
    });
  });

  // ==================== getMCPServerConfigs ====================

  describe("getMCPServerConfigs", () => {
    it("should return MCP server configurations", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          id: "db-1",
          serverId: "test-server",
          name: "Test Server",
          description: "A test server",
          transport: "stdio",
          command: "/usr/bin/server",
          args: [],
          url: null,
          enabled: true,
          autoConnect: true,
          metadata: {},
        },
      ]);
      mockMCPManager.getClient.mockReturnValue({ connected: false });

      const result = await service.getMCPServerConfigs();

      expect(result).toHaveProperty("servers");
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].serverId).toBe("test-server");
      expect(result.servers[0].connected).toBe(false);
    });

    it("should include tools from connected server", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          id: "db-1",
          serverId: "connected-server",
          name: "Connected Server",
          description: null,
          transport: "sse",
          command: null,
          args: [],
          url: "https://mcp.example.com",
          enabled: true,
          autoConnect: true,
          metadata: { env: { API_KEY: "test" } },
        },
      ]);
      const connectedClient = {
        connected: true,
        listTools: jest
          .fn()
          .mockResolvedValue([{ name: "search", description: "Search tool" }]),
      };
      mockMCPManager.getClient.mockReturnValue(connectedClient);

      const result = await service.getMCPServerConfigs();

      expect(result.servers[0].connected).toBe(true);
      expect(result.servers[0].tools).toHaveLength(1);
    });

    it("should extract env from metadata", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          id: "db-1",
          serverId: "env-server",
          name: "Env Server",
          description: null,
          transport: "stdio",
          command: "/usr/bin/server",
          args: [],
          url: null,
          enabled: true,
          autoConnect: false,
          metadata: { env: { MY_KEY: "my-value" } },
        },
      ]);
      mockMCPManager.getClient.mockReturnValue({ connected: false });

      const result = await service.getMCPServerConfigs();

      expect(result.servers[0].env).toEqual({ MY_KEY: "my-value" });
    });
  });

  // ==================== addMCPServer ====================

  describe("addMCPServer", () => {
    it("should create a new stdio MCP server", async () => {
      mockPrismaService.mCPServerConfig.create.mockResolvedValue({
        id: "db-1",
        serverId: "new-server",
        name: "New Server",
        transport: "stdio",
        command: "/usr/bin/server",
        args: [],
        url: null,
        enabled: true,
        autoConnect: true,
        apiKey: null,
        secretKey: null,
        metadata: {},
      });
      mockMCPManager.connect.mockResolvedValue(undefined);
      mockPrismaService.mCPServerConfig.update.mockResolvedValue({});

      const result = await service.addMCPServer({
        serverId: "new-server",
        name: "New Server",
        transport: "stdio",
        command: "/usr/bin/server",
        args: [],
        enabled: true,
        autoConnect: true,
      });

      expect(result).toBeDefined();
      expect(mockMCPManager.registerServer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "new-server",
          transport: "stdio",
        }),
      );
    });

    it("should create an SSE MCP server", async () => {
      mockPrismaService.mCPServerConfig.create.mockResolvedValue({
        id: "db-2",
        serverId: "sse-server",
        name: "SSE Server",
        transport: "sse",
        command: null,
        args: [],
        url: "https://mcp.example.com",
        enabled: true,
        autoConnect: true,
        apiKey: null,
        secretKey: null,
        metadata: {},
      });
      mockMCPManager.connect.mockResolvedValue(undefined);
      mockPrismaService.mCPServerConfig.update.mockResolvedValue({});

      await service.addMCPServer({
        serverId: "sse-server",
        name: "SSE Server",
        transport: "sse",
        url: "https://mcp.example.com",
      });

      expect(mockMCPManager.registerServer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "sse-server",
          transport: "http",
        }),
      );
    });
  });

  // ==================== getAllConfigs ====================

  describe("getAllConfigs", () => {
    it("should return aggregated configs with tools, skills, and MCP servers", async () => {
      mockPrismaService.toolConfig.findMany.mockResolvedValue([]);
      mockPrismaService.skillConfig.findMany.mockResolvedValue([]);
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);

      const result = await service.getAllConfigs();

      expect(result).toHaveProperty("tools");
      expect(result).toHaveProperty("skills");
      expect(result).toHaveProperty("mcpServers");
      expect(result).toHaveProperty("timestamp");
      expect(result.tools).toHaveProperty("tools");
      expect(result.tools).toHaveProperty("stats");
      expect(result.skills).toHaveProperty("skills");
      expect(result.skills).toHaveProperty("stats");
      expect(result.mcpServers).toHaveProperty("servers");
    });

    it("should return timestamp in ISO format", async () => {
      mockPrismaService.toolConfig.findMany.mockResolvedValue([]);
      mockPrismaService.skillConfig.findMany.mockResolvedValue([]);
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([]);

      const result = await service.getAllConfigs();

      expect(typeof result.timestamp).toBe("string");
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });

  // ==================== batchUpdateTools ====================

  describe("batchUpdateTools", () => {
    it("should update multiple tools successfully using transaction", async () => {
      mockPrismaService.$transaction.mockResolvedValue([{}, {}]);

      const result = await service.batchUpdateTools([
        { toolId: "tool-1", enabled: true },
        { toolId: "tool-2", enabled: false },
      ]);

      expect(result.success).toBe(true);
      expect(result.updated).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    });

    it("should report errors when transaction fails", async () => {
      mockPrismaService.$transaction.mockRejectedValue(
        new Error("Database error"),
      );

      const result = await service.batchUpdateTools([
        { toolId: "tool-1", enabled: true },
        { toolId: "tool-2", enabled: false },
      ]);

      expect(result.success).toBe(false);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Transaction failed");
    });

    it("should handle empty array", async () => {
      mockPrismaService.$transaction.mockResolvedValue([]);

      const result = await service.batchUpdateTools([]);

      expect(result.success).toBe(true);
      expect(result.updated).toBe(0);
    });
  });

  // ==================== batchUpdateSkills ====================

  describe("batchUpdateSkills", () => {
    it("should update multiple skills successfully using transaction", async () => {
      mockPrismaService.$transaction.mockResolvedValue([{}, {}]);

      const result = await service.batchUpdateSkills([
        { skillId: "skill-1", enabled: true },
        { skillId: "skill-2", enabled: false },
      ]);

      expect(result.success).toBe(true);
      expect(result.updated).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it("should report errors when batch skill update fails", async () => {
      mockPrismaService.$transaction.mockRejectedValue(
        new Error("Skill DB error"),
      );

      const result = await service.batchUpdateSkills([
        { skillId: "skill-1", enabled: true },
      ]);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
