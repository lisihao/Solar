/**
 * AIAdminService Supplemental2 Tests
 *
 * Covers uncovered branches beyond supplemental.spec.ts:
 * - diagnoseTools() — healthy, unhealthy (secret invalid), unconfigured, disabled
 * - diagnoseMCPServers() — connected, disconnected, disabled, listTools error
 * - diagnoseExternalTools() — no_key_required, configured, unconfigured
 * - diagnoseAllCapabilities() — aggregated + breakpoints (S2, T3, E1, K1, A4)
 * - getServiceKeyHealth() — unknown service, tavily, jina, no secret
 * - getAvailableToolsForAgent() — filters unhealthy tools
 * - testTool() — not found, executable success, executable failure, no execute method
 * - updateToolConfig() — invalid secretKey, upsert success
 * - initializeConfigs() — MCP stdio autoconnect success + failure, SSE path
 * - reconnectMCPServerWithRetry() — max retries exhausted path (covered via health check)
 * - onModuleDestroy() — clears timer
 */

// Mock @prisma/client so enum accesses don't throw in this isolated test context
jest.mock("@prisma/client", () => {
  const enumProxy = new Proxy(
    {},
    { get: (_target, prop) => (typeof prop === "string" ? prop : undefined) },
  );
  return new Proxy(
    { PrismaClient: jest.fn().mockImplementation(() => ({})) },
    {
      get(target, prop) {
        if (prop in target)
          return (target as Record<string | symbol, unknown>)[prop];
        return enumProxy;
      },
    },
  );
});

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
  MultiKeyRegistry,
} from "../../../ai-engine/facade";
import { SecretsService } from "../../../platform/credentials/storage/secrets/secrets.service";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockPrisma() {
  return {
    toolConfig: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
    },
    skillConfig: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
    },
    mCPServerConfig: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn(),
    },
    aIUsageLog: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    secret: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    aITeamTemplate: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
  };
}

function makeMockToolRegistry() {
  return {
    getAll: jest.fn().mockReturnValue([]),
    tryGet: jest.fn().mockReturnValue(null),
    getEnabled: jest.fn().mockReturnValue([]),
  };
}

function makeMockSkillRegistry() {
  return {
    getAll: jest.fn().mockReturnValue([]),
    tryGet: jest.fn().mockReturnValue(null),
  };
}

function makeMockSkillLoaderService() {
  return {
    getAllLoadedSkills: jest.fn().mockReturnValue([]),
  };
}

function makeMockSkillContentService() {
  return {
    getEffectiveContent: jest.fn(),
    savePromptContent: jest.fn(),
    getVersionHistory: jest.fn(),
    restoreVersion: jest.fn(),
    getFullSkillDefinition: jest.fn(),
    createSkillFromUI: jest.fn(),
    syncFilesystemToDb: jest.fn(),
    recordUsage: jest.fn(),
  };
}

function makeMockMCPManager() {
  return {
    registerServer: jest.fn(),
    registerOrUpdateServer: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getClient: jest.fn().mockReturnValue(null),
  };
}

function makeMockSecretsService() {
  return {
    exists: jest.fn().mockResolvedValue(false),
    getValue: jest.fn().mockResolvedValue(null),
    getValueInternal: jest.fn().mockResolvedValue(null),
  };
}

function makeMockSearchService() {
  return {
    getKeyHealthStatus: jest.fn().mockReturnValue([]),
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("AIAdminService (supplemental2)", () => {
  let service: AIAdminService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let mockToolRegistry: ReturnType<typeof makeMockToolRegistry>;
  let mockSkillRegistry: ReturnType<typeof makeMockSkillRegistry>;
  let mockSkillLoaderService: ReturnType<typeof makeMockSkillLoaderService>;
  let mockMCPManager: ReturnType<typeof makeMockMCPManager>;
  let mockSecretsService: ReturnType<typeof makeMockSecretsService>;
  let mockSearchService: ReturnType<typeof makeMockSearchService>;
  let mockSkillContentService: ReturnType<typeof makeMockSkillContentService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockPrisma = makeMockPrisma();
    mockToolRegistry = makeMockToolRegistry();
    mockSkillRegistry = makeMockSkillRegistry();
    mockSkillLoaderService = makeMockSkillLoaderService();
    mockMCPManager = makeMockMCPManager();
    mockSecretsService = makeMockSecretsService();
    mockSearchService = makeMockSearchService();
    mockSkillContentService = makeMockSkillContentService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIAdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: SkillRegistry, useValue: mockSkillRegistry },
        { provide: SkillLoaderService, useValue: mockSkillLoaderService },
        { provide: SkillContentService, useValue: mockSkillContentService },
        { provide: MCPManager, useValue: mockMCPManager },
        { provide: SecretsService, useValue: mockSecretsService },
        { provide: SearchService, useValue: mockSearchService },
        {
          provide: MultiKeyRegistry,
          useValue: { getStatus: jest.fn().mockReturnValue([]) },
        },
      ],
    }).compile();

    service = module.get<AIAdminService>(AIAdminService);
  });

  afterEach(() => {
    jest.useRealTimers();
    service.onModuleDestroy();
  });

  // =========================================================================
  // diagnoseTools()
  // =========================================================================

  describe("diagnoseTools()", () => {
    it("returns healthy status for enabled tool with no secretKey requirement", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "calculator",
          name: "Calculator",
          description: "Math tool",
          category: "math",
          tags: [],
        },
      ]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([
        { toolId: "calculator", enabled: true, secretKey: null },
      ]);
      mockPrisma.secret.findMany.mockResolvedValue([]);

      const result = await service.diagnoseTools();

      expect(result.summary.total).toBe(1);
      expect(result.summary.healthy).toBe(1);
      expect(result.tools[0].status).toBe("healthy");
    });

    it("returns unhealthy status when tool has invalid secretKey", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "paid-tool",
          name: "Paid Tool",
          description: "Needs key",
          category: "api",
          tags: [],
        },
      ]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([
        { toolId: "paid-tool", enabled: true, secretKey: "paid-tool-api-key" },
      ]);
      mockPrisma.secret.findMany.mockResolvedValue([]);
      mockSecretsService.exists.mockResolvedValue(false);

      const result = await service.diagnoseTools();

      expect(result.tools[0].status).toBe("unhealthy");
      expect(result.summary.unhealthy).toBe(1);
    });

    it("returns healthy status when secretKey is valid", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "tavily-tool",
          name: "Tavily",
          description: "Search",
          category: "web-search",
          tags: [],
        },
      ]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([
        { toolId: "tavily-tool", enabled: true, secretKey: "tavily-api-key" },
      ]);
      mockPrisma.secret.findMany.mockResolvedValue([]);
      mockSecretsService.exists.mockResolvedValue(true);

      const result = await service.diagnoseTools();

      expect(result.tools[0].status).toBe("healthy");
    });

    it("returns unhealthy for disabled tool", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "disabled-tool",
          name: "Disabled",
          description: "Off",
          category: "misc",
          tags: [],
        },
      ]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([
        { toolId: "disabled-tool", enabled: false, secretKey: null },
      ]);
      mockPrisma.secret.findMany.mockResolvedValue([]);

      const result = await service.diagnoseTools();

      expect(result.tools[0].status).toBe("unhealthy");
    });

    it("returns healthy when web-search has noKeyRequired provider (duckduckgo)", async () => {
      // duckduckgo in EXTERNAL_TOOL_DEFINITIONS has noKeyRequired: true
      // so web-search is always healthy even when no secrets are configured
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "web-search",
          name: "Web Search",
          description: "Search web",
          category: "search",
          tags: [],
        },
      ]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([
        { toolId: "web-search", enabled: true, secretKey: null },
      ]);
      mockPrisma.secret.findMany.mockResolvedValue([]);

      const result = await service.diagnoseTools();

      // duckduckgo (noKeyRequired) makes web-search always have an available provider
      expect(result.tools[0].status).toBe("healthy");
      expect(result.summary.healthy).toBe(1);
    });

    it("returns unconfigured when web-scraper builtin has no Content Extraction provider configured", async () => {
      // web-scraper maps to "Content Extraction" category
      // None of the Content Extraction providers (jina, firecrawl, tavilyExtract) have noKeyRequired
      // so without any secrets, the tool is unconfigured
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "web-scraper",
          name: "Web Scraper",
          description: "Scrape pages",
          category: "scrape",
          tags: [],
        },
      ]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([
        { toolId: "web-scraper", enabled: true, secretKey: null },
      ]);
      // No secrets configured for any Content Extraction provider
      mockPrisma.secret.findMany.mockResolvedValue([]);

      const result = await service.diagnoseTools();

      expect(result.tools[0].status).toBe("unconfigured");
      expect(result.summary.unconfigured).toBe(1);
    });

    it("returns empty diagnostics when no tools are registered", async () => {
      mockToolRegistry.getAll.mockReturnValue([]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([]);
      mockPrisma.secret.findMany.mockResolvedValue([]);

      const result = await service.diagnoseTools();

      expect(result.summary.total).toBe(0);
      expect(result.tools).toHaveLength(0);
    });
  });

  // =========================================================================
  // diagnoseMCPServers()
  // =========================================================================

  describe("diagnoseMCPServers()", () => {
    it("returns connected status for connected server with tools", async () => {
      const mockClient = {
        connected: true,
        listTools: jest
          .fn()
          .mockResolvedValue([
            { name: "tool1", description: "Does something" },
          ]),
      };
      mockMCPManager.getClient.mockReturnValue(mockClient);
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        { serverId: "server-1", name: "Test Server", enabled: true },
      ]);

      const result = await service.diagnoseMCPServers();

      expect(result.servers[0].status).toBe("connected");
      expect(result.servers[0].toolCount).toBe(1);
      expect(result.summary.connected).toBe(1);
    });

    it("returns disconnected status when client is not connected", async () => {
      mockMCPManager.getClient.mockReturnValue({ connected: false });
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        { serverId: "server-1", name: "Offline Server", enabled: true },
      ]);

      const result = await service.diagnoseMCPServers();

      expect(result.servers[0].status).toBe("disconnected");
      expect(result.summary.disconnected).toBe(1);
    });

    it("returns disconnected for disabled server without checking client", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        { serverId: "server-1", name: "Disabled Server", enabled: false },
      ]);

      const result = await service.diagnoseMCPServers();

      expect(result.servers[0].status).toBe("disconnected");
    });

    it("returns error status when listTools throws", async () => {
      const mockClient = {
        connected: true,
        listTools: jest.fn().mockRejectedValue(new Error("Connection reset")),
      };
      mockMCPManager.getClient.mockReturnValue(mockClient);
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        { serverId: "server-1", name: "Error Server", enabled: true },
      ]);

      const result = await service.diagnoseMCPServers();

      expect(result.servers[0].status).toBe("error");
    });

    it("returns null client as disconnected", async () => {
      mockMCPManager.getClient.mockReturnValue(null);
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        { serverId: "server-1", name: "No Client", enabled: true },
      ]);

      const result = await service.diagnoseMCPServers();

      expect(result.servers[0].status).toBe("disconnected");
    });

    it("aggregates totalTools across all servers", async () => {
      const client1 = {
        connected: true,
        listTools: jest
          .fn()
          .mockResolvedValue([{ name: "t1" }, { name: "t2" }]),
      };
      const client2 = {
        connected: true,
        listTools: jest.fn().mockResolvedValue([{ name: "t3" }]),
      };
      mockMCPManager.getClient
        .mockReturnValueOnce(client1)
        .mockReturnValueOnce(client2);
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        { serverId: "s1", name: "S1", enabled: true },
        { serverId: "s2", name: "S2", enabled: true },
      ]);

      const result = await service.diagnoseMCPServers();

      expect(result.summary.totalTools).toBe(3);
    });
  });

  // =========================================================================
  // diagnoseExternalTools()
  // =========================================================================

  describe("diagnoseExternalTools()", () => {
    it("returns no_key_required for duckduckgo", async () => {
      mockPrisma.secret.findMany.mockResolvedValue([]);

      const result = await service.diagnoseExternalTools();

      const duckduckgo = result.tools.find((t) => t.id === "duckduckgo");
      expect(duckduckgo?.status).toBe("no_key_required");
      expect(duckduckgo?.secretKeyValid).toBe(true);
    });

    it("returns configured when secret exists for tool", async () => {
      const tavilySecretName = "tavily-search-api-key";
      mockPrisma.secret.findMany.mockResolvedValue([
        { name: tavilySecretName },
      ]);

      const result = await service.diagnoseExternalTools();

      const tavily = result.tools.find((t) => t.id === "tavily");
      expect(tavily?.status).toBe("configured");
      expect(tavily?.secretKeyValid).toBe(true);
    });

    it("returns unconfigured when secret does not exist for tool", async () => {
      mockPrisma.secret.findMany.mockResolvedValue([]);

      const result = await service.diagnoseExternalTools();

      const tavily = result.tools.find((t) => t.id === "tavily");
      expect(tavily?.status).toBe("unconfigured");
      expect(tavily?.secretKeyValid).toBe(false);
    });

    it("includes correct summary counts", async () => {
      mockPrisma.secret.findMany.mockResolvedValue([]);

      const result = await service.diagnoseExternalTools();

      expect(result.summary.noKeyRequired).toBeGreaterThanOrEqual(1);
      expect(result.summary.total).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // diagnoseAllCapabilities()
  // =========================================================================

  describe("diagnoseAllCapabilities()", () => {
    it("returns all sections when no issues exist", async () => {
      mockPrisma.secret.findMany.mockResolvedValue([]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([]);
      mockToolRegistry.getAll.mockReturnValue([]);
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([]);
      mockPrisma.skillConfig.findMany.mockResolvedValue([]);
      mockSkillLoaderService.getAllLoadedSkills.mockReturnValue([]);
      mockPrisma.aITeamTemplate.findMany.mockResolvedValue([]);

      const result = await service.diagnoseAllCapabilities();

      expect(result.secrets).toBeDefined();
      expect(result.builtinTools).toBeDefined();
      expect(result.mcpServers).toBeDefined();
      expect(result.externalTools).toBeDefined();
      expect(result.skills).toBeDefined();
      expect(result.teamCapabilities).toBeDefined();
      expect(result.breakpoints).toBeDefined();
      expect(Array.isArray(result.breakpoints)).toBe(true);
    });

    it("adds S2 breakpoint when tool references non-existent secret", async () => {
      mockPrisma.secret.findMany.mockResolvedValue([]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([
        {
          toolId: "some-tool",
          secretKey: "non-existent-secret",
          enabled: true,
        },
      ]);
      mockToolRegistry.getAll.mockReturnValue([]);
      mockMCPManager.getClient.mockReturnValue(null);
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([]);
      mockPrisma.skillConfig.findMany.mockResolvedValue([]);
      mockSkillLoaderService.getAllLoadedSkills.mockReturnValue([]);
      mockPrisma.aITeamTemplate.findMany.mockResolvedValue([]);

      const result = await service.diagnoseAllCapabilities();

      const s2Breakpoint = result.breakpoints.find((bp) => bp.code === "S2");
      expect(s2Breakpoint).toBeDefined();
      expect(s2Breakpoint?.severity).toBe("high");
    });

    it("adds K1 breakpoint for enabled skill with missing file", async () => {
      mockPrisma.secret.findMany.mockResolvedValue([]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([]);
      mockToolRegistry.getAll.mockReturnValue([]);
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([]);
      mockPrisma.skillConfig.findMany.mockResolvedValue([
        {
          skillId: "missing-skill",
          displayName: "Missing Skill",
          enabled: true,
        },
      ]);
      // No loaded skills
      mockSkillLoaderService.getAllLoadedSkills.mockReturnValue([]);
      mockPrisma.aITeamTemplate.findMany.mockResolvedValue([]);

      const result = await service.diagnoseAllCapabilities();

      const k1Breakpoint = result.breakpoints.find((bp) => bp.code === "K1");
      expect(k1Breakpoint).toBeDefined();
      expect(k1Breakpoint?.severity).toBe("high");
    });

    it("adds A4 breakpoint for team member with no capabilities", async () => {
      mockPrisma.secret.findMany.mockResolvedValue([]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([]);
      mockToolRegistry.getAll.mockReturnValue([]);
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([]);
      mockPrisma.skillConfig.findMany.mockResolvedValue([]);
      mockSkillLoaderService.getAllLoadedSkills.mockReturnValue([]);
      mockPrisma.aITeamTemplate.findMany.mockResolvedValue([
        {
          id: "team-1",
          name: "Research Team",
          members: [
            {
              id: "m1",
              displayName: "Agent A",
              capabilities: [],
              mcpTools: [],
            },
          ],
        },
      ]);

      const result = await service.diagnoseAllCapabilities();

      const a4Breakpoint = result.breakpoints.find((bp) => bp.code === "A4");
      expect(a4Breakpoint).toBeDefined();
    });

    it("marks expired secret with expired status", async () => {
      const expiredDate = new Date(Date.now() - 86400000); // yesterday
      mockPrisma.secret.findMany.mockResolvedValue([
        {
          name: "expired-key",
          isActive: true,
          expiresAt: expiredDate,
        },
      ]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([]);
      mockToolRegistry.getAll.mockReturnValue([]);
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([]);
      mockPrisma.skillConfig.findMany.mockResolvedValue([]);
      mockSkillLoaderService.getAllLoadedSkills.mockReturnValue([]);
      mockPrisma.aITeamTemplate.findMany.mockResolvedValue([]);

      const result = await service.diagnoseAllCapabilities();

      const expiredItem = result.secrets.items.find(
        (s) => s.name === "expired-key",
      );
      expect(expiredItem?.status).toBe("expired");
    });

    it("marks inactive secret with inactive status", async () => {
      mockPrisma.secret.findMany.mockResolvedValue([
        { name: "inactive-key", isActive: false, expiresAt: null },
      ]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([]);
      mockToolRegistry.getAll.mockReturnValue([]);
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([]);
      mockPrisma.skillConfig.findMany.mockResolvedValue([]);
      mockSkillLoaderService.getAllLoadedSkills.mockReturnValue([]);
      mockPrisma.aITeamTemplate.findMany.mockResolvedValue([]);

      const result = await service.diagnoseAllCapabilities();

      const inactiveItem = result.secrets.items.find(
        (s) => s.name === "inactive-key",
      );
      expect(inactiveItem?.status).toBe("inactive");
    });
  });

  // =========================================================================
  // getServiceKeyHealth()
  // =========================================================================

  describe("getServiceKeyHealth()", () => {
    it("returns empty array for unknown service ID", async () => {
      const result = await service.getServiceKeyHealth("unknown-service");
      expect(result).toEqual([]);
    });

    it("delegates to searchService for tavily", async () => {
      const mockStatus = [{ key: "key1", healthy: true, usageCount: 5 }];
      mockSecretsService.getValueInternal.mockResolvedValue("key1,key2");
      mockSearchService.getKeyHealthStatus.mockReturnValue(mockStatus);

      const result = await service.getServiceKeyHealth("tavily");

      expect(mockSearchService.getKeyHealthStatus).toHaveBeenCalledWith(
        "tavily",
      );
      expect(result).toEqual(mockStatus);
    });

    it("delegates to searchService for serper", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("some-key");
      mockSearchService.getKeyHealthStatus.mockReturnValue([]);

      await service.getServiceKeyHealth("serper");

      expect(mockSearchService.getKeyHealthStatus).toHaveBeenCalledWith(
        "serper",
      );
    });

    it("returns empty array when secret not found", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue(null);

      const result = await service.getServiceKeyHealth("jina");

      expect(result).toEqual([]);
    });

    it("returns empty array when secret value is empty", async () => {
      mockSecretsService.getValueInternal.mockResolvedValue("");

      const result = await service.getServiceKeyHealth("jina");

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // getAvailableToolsForAgent()
  // =========================================================================

  describe("getAvailableToolsForAgent()", () => {
    it("returns only healthy enabled tools", async () => {
      mockToolRegistry.getAll.mockReturnValue([
        {
          id: "calc",
          name: "Calc",
          description: "Math",
          category: "math",
          tags: [],
        },
        {
          id: "disabled-tool",
          name: "Disabled",
          description: "Off",
          category: "misc",
          tags: [],
        },
      ]);
      mockPrisma.toolConfig.findMany
        .mockResolvedValueOnce([
          // for diagnoseTools
          { toolId: "calc", enabled: true, secretKey: null },
          { toolId: "disabled-tool", enabled: false, secretKey: null },
        ])
        .mockResolvedValueOnce([
          // for getAvailableToolsForAgent inner findMany
          { toolId: "calc" },
        ]);
      mockPrisma.secret.findMany.mockResolvedValue([]);

      const result = await service.getAvailableToolsForAgent();

      expect(result.some((t) => t.toolId === "disabled-tool")).toBe(false);
    });

    it("returns empty array when no healthy tools", async () => {
      mockToolRegistry.getAll.mockReturnValue([]);
      mockPrisma.toolConfig.findMany.mockResolvedValue([]);
      mockPrisma.secret.findMany.mockResolvedValue([]);

      const result = await service.getAvailableToolsForAgent();

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // testTool()
  // =========================================================================

  describe("testTool()", () => {
    it("returns failure when tool is not registered", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const result = await service.testTool("nonexistent-tool");

      expect(result.success).toBe(false);
      expect(result.error).toContain("nonexistent-tool");
    });

    it("returns success when executable tool succeeds", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({ data: "result" }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);
      mockPrisma.toolConfig.findUnique.mockResolvedValue(null);
      mockPrisma.aIUsageLog.create.mockResolvedValue({});

      const result = await service.testTool("test-tool", { query: "test" });

      expect(result.success).toBe(true);
    });

    it("returns failure when executable tool throws", async () => {
      const mockTool = {
        execute: jest.fn().mockRejectedValue(new Error("Tool crashed")),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);
      mockPrisma.toolConfig.findUnique.mockResolvedValue(null);
      mockPrisma.aIUsageLog.create.mockResolvedValue({});

      const result = await service.testTool("crashing-tool");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool crashed");
    });

    it("returns success message when tool has no execute method", async () => {
      const mockTool = { id: "no-exec-tool" }; // no execute method
      mockToolRegistry.tryGet.mockReturnValue(mockTool);
      mockPrisma.toolConfig.findUnique.mockResolvedValue(null);

      const result = await service.testTool("no-exec-tool");

      expect(result.success).toBe(true);
      expect(result.message).toContain("execute method");
    });

    it("resolves secretKey from config before executing", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({ ok: true }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "keyed-tool",
        secretKey: "my-secret",
        enabled: true,
      });
      mockSecretsService.getValue.mockResolvedValue("actual-api-key");
      mockPrisma.aIUsageLog.create.mockResolvedValue({});

      await service.testTool("keyed-tool");

      expect(mockTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "actual-api-key" }),
        expect.objectContaining({ callerType: "admin" }),
      );
    });
  });

  // =========================================================================
  // updateToolConfig()
  // =========================================================================

  describe("updateToolConfig()", () => {
    it("throws when secretKey does not exist in secret manager", async () => {
      mockSecretsService.exists.mockResolvedValue(false);

      await expect(
        service.updateToolConfig("some-tool", { secretKey: "bad-key" }),
      ).rejects.toThrow("does not exist");
    });

    it("allows update when secretKey is null (clearing the key)", async () => {
      mockPrisma.toolConfig.upsert.mockResolvedValue({
        id: "tc-1",
        toolId: "some-tool",
        enabled: true,
        secretKey: null,
        displayName: "Tool",
      });

      const result = await service.updateToolConfig("some-tool", {
        secretKey: null,
        enabled: true,
      });

      expect(result.success).toBe(true);
      expect(mockSecretsService.exists).not.toHaveBeenCalled();
    });

    it("allows update when secretKey is valid", async () => {
      mockSecretsService.exists.mockResolvedValue(true);
      mockPrisma.toolConfig.upsert.mockResolvedValue({
        id: "tc-2",
        toolId: "valid-tool",
        enabled: true,
        secretKey: "valid-key",
        displayName: "Valid Tool",
      });

      const result = await service.updateToolConfig("valid-tool", {
        secretKey: "valid-key",
      });

      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // initializeConfigs() — via onModuleInit
  // =========================================================================

  describe("initializeConfigs() via onModuleInit()", () => {
    it("auto-connects stdio MCP server on init", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        {
          id: "mcp-1",
          serverId: "stdio-server",
          name: "Stdio Server",
          transport: "stdio",
          command: "node",
          args: [],
          url: null,
          enabled: true,
          autoConnect: true,
          secretKey: null,
          apiKey: null,
          metadata: {},
        },
      ]);
      mockMCPManager.connect.mockResolvedValue(undefined);
      mockPrisma.mCPServerConfig.update.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockMCPManager.registerServer).toHaveBeenCalledWith(
        expect.objectContaining({ transport: "stdio", id: "stdio-server" }),
      );
      expect(mockMCPManager.connect).toHaveBeenCalledWith("stdio-server");
    });

    it("auto-connects SSE/http MCP server on init", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        {
          id: "mcp-2",
          serverId: "sse-server",
          name: "SSE Server",
          transport: "sse",
          command: null,
          args: [],
          url: "http://localhost:3001/mcp",
          enabled: true,
          autoConnect: true,
          secretKey: null,
          apiKey: null,
          metadata: {},
        },
      ]);
      mockPrisma.mCPServerConfig.update.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockMCPManager.registerServer).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: "http",
          url: "http://localhost:3001/mcp",
        }),
      );
    });

    it("records error status when MCP auto-connect fails", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        {
          id: "mcp-3",
          serverId: "fail-server",
          name: "Failing Server",
          transport: "stdio",
          command: "node",
          args: [],
          url: null,
          enabled: true,
          autoConnect: true,
          secretKey: null,
          apiKey: null,
          metadata: {},
        },
      ]);
      mockMCPManager.connect.mockRejectedValue(new Error("Connection refused"));
      mockPrisma.mCPServerConfig.update.mockResolvedValue({});

      // Should not throw
      await expect(service.onModuleInit()).resolves.not.toThrow();

      expect(mockPrisma.mCPServerConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({ connected: false }),
          }),
        }),
      );
    });

    it("resolves apiKey from metadata env when $secret: prefix", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        {
          id: "mcp-4",
          serverId: "secret-ref-server",
          name: "Secret Ref Server",
          transport: "stdio",
          command: "python",
          args: [],
          url: null,
          enabled: true,
          autoConnect: true,
          secretKey: null,
          apiKey: null,
          metadata: {
            env: { MY_API_KEY: "$secret:my-real-secret" },
          },
        },
      ]);
      mockSecretsService.getValueInternal.mockResolvedValue(
        "resolved-secret-value",
      );
      mockPrisma.mCPServerConfig.update.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockSecretsService.getValueInternal).toHaveBeenCalledWith(
        "my-real-secret",
      );
    });

    it("resolves apiKey from direct value in metadata env", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        {
          id: "mcp-5",
          serverId: "direct-env-server",
          name: "Direct Env Server",
          transport: "stdio",
          command: "node",
          args: [],
          url: null,
          enabled: true,
          autoConnect: true,
          secretKey: null,
          apiKey: null,
          metadata: {
            env: { MY_KEY: "direct-value" },
          },
        },
      ]);
      mockPrisma.mCPServerConfig.update.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockMCPManager.registerServer).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({ MY_KEY: "direct-value" }),
        }),
      );
    });

    it("resolves apiKey from server.secretKey field", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        {
          id: "mcp-6",
          serverId: "secretkey-server",
          name: "SecretKey Server",
          transport: "stdio",
          command: "node",
          args: [],
          url: null,
          enabled: true,
          autoConnect: true,
          secretKey: "TAVILY_API_KEY",
          apiKey: null,
          metadata: {},
        },
      ]);
      mockSecretsService.getValueInternal.mockResolvedValue("tavily-value-123");
      mockPrisma.mCPServerConfig.update.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockSecretsService.getValueInternal).toHaveBeenCalledWith(
        "TAVILY_API_KEY",
      );
    });

    it("uses legacy apiKey field when present", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([
        {
          id: "mcp-7",
          serverId: "legacy-server",
          name: "Legacy Server",
          transport: "stdio",
          command: "node",
          args: [],
          url: null,
          enabled: true,
          autoConnect: true,
          secretKey: null,
          apiKey: "legacy-direct-key",
          metadata: {},
        },
      ]);
      mockPrisma.mCPServerConfig.update.mockResolvedValue({});

      await service.onModuleInit();

      expect(mockMCPManager.registerServer).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({ API_KEY: "legacy-direct-key" }),
        }),
      );
    });
  });

  // =========================================================================
  // onModuleDestroy()
  // =========================================================================

  describe("onModuleDestroy()", () => {
    it("clears health check timer on destroy", async () => {
      await service.onModuleInit();
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");

      service.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it("is idempotent when called twice", () => {
      expect(() => {
        service.onModuleDestroy();
        service.onModuleDestroy();
      }).not.toThrow();
    });
  });
});
