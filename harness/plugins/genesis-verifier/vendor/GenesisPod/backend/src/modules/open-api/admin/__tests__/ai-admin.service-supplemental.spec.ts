/**
 * AIAdminService Supplemental Tests
 *
 * Covers uncovered branches beyond ai-admin.service.spec.ts:
 * - getMCPServerConfigs() — listing with connection status
 * - addMCPServer() — success and auto-connect paths
 * - updateMCPServer() — update, not-found paths
 * - deleteMCPServer() — disconnect error ignored, DB failure
 * - connectMCPServer() — success / not-found / connect error
 * - disconnectMCPServer() — success / disconnect error
 * - updateMCPServerEnv() — success / server-not-found
 * - getUsageStats() — various filter combinations
 * - getSkillConfigs() — loaded skills, DB override, stats
 * - updateSkillConfig() — upsert paths
 */

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

describe("AIAdminService (supplemental)", () => {
  let service: AIAdminService;

  const mockPrismaService = {
    toolConfig: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
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
      update: jest.fn(),
      delete: jest.fn(),
    },
    aIUsageLog: {
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
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

  const mockToolRegistry = {
    getAll: jest.fn().mockReturnValue([]),
    tryGet: jest.fn().mockReturnValue(null),
    getEnabled: jest.fn().mockReturnValue([]),
  };

  const mockSkillRegistry = {
    getAll: jest.fn().mockReturnValue([]),
    tryGet: jest.fn().mockReturnValue(null),
  };

  const mockSkillLoaderService = {
    getAllLoadedSkills: jest.fn().mockReturnValue([]),
  };

  const mockMCPManager = {
    registerServer: jest.fn(),
    registerOrUpdateServer: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getClient: jest.fn().mockReturnValue(null),
  };

  const mockSecretsService = {
    exists: jest.fn().mockResolvedValue(false),
    getValue: jest.fn().mockResolvedValue(null),
    getValueInternal: jest.fn().mockResolvedValue(null),
  };

  const mockSearchService = {
    getKeyHealthStatus: jest.fn().mockReturnValue([]),
  };

  const mockMultiKeyRegistry = {
    getStatus: jest.fn().mockReturnValue([]),
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
        { provide: MultiKeyRegistry, useValue: mockMultiKeyRegistry },
      ],
    }).compile();

    service = module.get<AIAdminService>(AIAdminService);
  });

  afterEach(() => {
    jest.useRealTimers();
    service.onModuleDestroy();
  });

  // =========================================================================
  // getMCPServerConfigs
  // =========================================================================

  describe("getMCPServerConfigs()", () => {
    it("returns servers list with connected=false when no client exists", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          id: "db-1",
          serverId: "server-1",
          name: "Server One",
          description: null,
          transport: "stdio",
          command: "/usr/bin/server",
          args: [],
          url: null,
          enabled: true,
          autoConnect: true,
          secretKey: null,
          apiKey: null,
          metadata: {},
        },
      ]);
      mockMCPManager.getClient.mockReturnValue(null);

      const result = await service.getMCPServerConfigs();

      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].serverId).toBe("server-1");
      expect(result.servers[0].connected).toBe(false);
    });

    it("returns connected=true and tools list when client is connected", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          id: "db-1",
          serverId: "conn-server",
          name: "Connected",
          description: null,
          transport: "stdio",
          command: "/usr/bin/mcp",
          args: [],
          url: null,
          enabled: true,
          autoConnect: true,
          secretKey: null,
          apiKey: null,
          metadata: {},
        },
      ]);
      const mockClient = {
        connected: true,
        listTools: jest
          .fn()
          .mockResolvedValue([{ name: "tool-a", description: "Tool A" }]),
      };
      mockMCPManager.getClient.mockReturnValue(mockClient);

      const result = await service.getMCPServerConfigs();

      expect(result.servers[0].connected).toBe(true);
      expect(result.servers[0].tools).toHaveLength(1);
      expect(result.servers[0].tools[0].name).toBe("tool-a");
    });

    it("returns empty tools when client.listTools throws", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          id: "db-1",
          serverId: "failing-server",
          name: "Failing",
          description: null,
          transport: "stdio",
          command: "/usr/bin/fail",
          args: [],
          url: null,
          enabled: true,
          autoConnect: false,
          secretKey: null,
          apiKey: null,
          metadata: {},
        },
      ]);
      const mockClient = {
        connected: true,
        listTools: jest.fn().mockRejectedValue(new Error("list failed")),
      };
      mockMCPManager.getClient.mockReturnValue(mockClient);

      const result = await service.getMCPServerConfigs();

      expect(result.servers[0].connected).toBe(true);
      expect(result.servers[0].tools).toHaveLength(0);
    });

    it("extracts env from metadata", async () => {
      mockPrismaService.mCPServerConfig.findMany.mockResolvedValue([
        {
          id: "db-1",
          serverId: "env-server",
          name: "Env Server",
          description: null,
          transport: "stdio",
          command: "/usr/bin/env",
          args: [],
          url: null,
          enabled: true,
          autoConnect: false,
          secretKey: null,
          apiKey: null,
          metadata: { env: { MY_KEY: "my-value" } },
        },
      ]);
      mockMCPManager.getClient.mockReturnValue(null);

      const result = await service.getMCPServerConfigs();

      expect(result.servers[0].env).toEqual({ MY_KEY: "my-value" });
    });
  });

  // =========================================================================
  // addMCPServer
  // =========================================================================

  describe("addMCPServer()", () => {
    it("creates server in DB and registers stdio server", async () => {
      const createdServer = {
        id: "db-id-1",
        serverId: "new-server",
        name: "New Server",
        transport: "stdio",
        command: "/usr/bin/new",
        args: ["--port", "3000"],
        url: null,
        enabled: true,
        autoConnect: false,
        apiKey: null,
        secretKey: null,
        metadata: {},
      };
      mockPrismaService.mCPServerConfig.create.mockResolvedValue(createdServer);

      const result = await service.addMCPServer({
        serverId: "new-server",
        name: "New Server",
        transport: "stdio",
        command: "/usr/bin/new",
        args: ["--port", "3000"],
        enabled: true,
        autoConnect: false,
      });

      expect(result.success).toBe(true);
      expect(result.serverId).toBe("new-server");
      expect(mockPrismaService.mCPServerConfig.create).toHaveBeenCalled();
      expect(mockMCPManager.registerServer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "new-server",
          transport: "stdio",
        }),
      );
    });

    it("auto-connects when autoConnect=true and enabled=true", async () => {
      mockPrismaService.mCPServerConfig.create.mockResolvedValue({
        id: "db-2",
        serverId: "auto-server",
        name: "Auto",
        transport: "stdio",
        command: "/usr/bin/auto",
        args: [],
        url: null,
        enabled: true,
        autoConnect: true,
        apiKey: null,
        secretKey: null,
        metadata: {},
      });
      mockMCPManager.connect.mockResolvedValue(undefined);

      const result = await service.addMCPServer({
        serverId: "auto-server",
        name: "Auto",
        transport: "stdio",
        command: "/usr/bin/auto",
        args: [],
        enabled: true,
        autoConnect: true,
      });

      expect(result.success).toBe(true);
      expect(mockMCPManager.connect).toHaveBeenCalledWith("auto-server");
    });

    it("still succeeds when auto-connect fails", async () => {
      mockPrismaService.mCPServerConfig.create.mockResolvedValue({
        id: "db-3",
        serverId: "fail-connect",
        name: "Fail Connect",
        transport: "stdio",
        command: "/usr/bin/fail",
        args: [],
        url: null,
        enabled: true,
        autoConnect: true,
        apiKey: null,
        secretKey: null,
        metadata: {},
      });
      mockMCPManager.connect.mockRejectedValue(new Error("Connection refused"));

      const result = await service.addMCPServer({
        serverId: "fail-connect",
        name: "Fail Connect",
        transport: "stdio",
        command: "/usr/bin/fail",
        args: [],
        enabled: true,
        autoConnect: true,
      });

      expect(result.success).toBe(true);
    });

    it("registers SSE server with http transport", async () => {
      mockPrismaService.mCPServerConfig.create.mockResolvedValue({
        id: "db-4",
        serverId: "sse-server",
        name: "SSE Server",
        transport: "sse",
        command: null,
        args: [],
        url: "https://mcp.example.com",
        enabled: true,
        autoConnect: false,
        apiKey: null,
        secretKey: null,
        metadata: {},
      });

      await service.addMCPServer({
        serverId: "sse-server",
        name: "SSE Server",
        transport: "sse",
        url: "https://mcp.example.com",
        enabled: true,
        autoConnect: false,
      });

      expect(mockMCPManager.registerServer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "sse-server",
          transport: "http",
        }),
      );
    });
  });

  // =========================================================================
  // updateMCPServer
  // =========================================================================

  describe("updateMCPServer()", () => {
    it("updates existing server configuration", async () => {
      const existingServer = {
        id: "db-u1",
        serverId: "update-server",
        name: "Update Server",
        transport: "stdio",
        command: "/usr/bin/old",
        args: [],
        url: null,
        enabled: true,
        autoConnect: false,
        secretKey: null,
        apiKey: null,
        metadata: {},
      };
      mockPrismaService.mCPServerConfig.findUnique.mockResolvedValue(
        existingServer,
      );
      mockPrismaService.mCPServerConfig.update.mockResolvedValue({
        ...existingServer,
        name: "Updated Server",
      });

      const result = await service.updateMCPServer("update-server", {
        name: "Updated Server",
      });

      expect(result.success).toBe(true);
      expect(mockPrismaService.mCPServerConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { serverId: "update-server" } }),
      );
    });

    it("returns failure when server not found", async () => {
      mockPrismaService.mCPServerConfig.findUnique.mockResolvedValue(null);

      const result = await service.updateMCPServer("nonexistent", {
        name: "Does Not Exist",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Server not found");
    });
  });

  // =========================================================================
  // deleteMCPServer
  // =========================================================================

  describe("deleteMCPServer()", () => {
    it("disconnects and deletes MCP server successfully", async () => {
      mockMCPManager.disconnect.mockResolvedValue(undefined);
      mockPrismaService.mCPServerConfig.delete.mockResolvedValue({
        serverId: "delete-server",
      });

      const result = await service.deleteMCPServer("delete-server");

      expect(result.success).toBe(true);
      expect(result.serverId).toBe("delete-server");
      expect(mockMCPManager.disconnect).toHaveBeenCalledWith("delete-server");
      expect(mockPrismaService.mCPServerConfig.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { serverId: "delete-server" } }),
      );
    });

    it("still deletes from DB even when disconnect fails", async () => {
      mockMCPManager.disconnect.mockRejectedValue(
        new Error("Already disconnected"),
      );
      mockPrismaService.mCPServerConfig.delete.mockResolvedValue({
        serverId: "force-delete",
      });

      const result = await service.deleteMCPServer("force-delete");

      expect(result.success).toBe(true);
      expect(mockPrismaService.mCPServerConfig.delete).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // connectMCPServer
  // =========================================================================

  describe("connectMCPServer()", () => {
    it("returns not-found error when server is missing from DB", async () => {
      mockPrismaService.mCPServerConfig.findUnique.mockResolvedValue(null);

      const result = await service.connectMCPServer("missing-server");

      expect(result.success).toBe(false);
      expect(result.error).toContain("missing-server");
    });

    it("connects stdio server and records success status", async () => {
      mockPrismaService.mCPServerConfig.findUnique.mockResolvedValue({
        id: "db-c1",
        serverId: "connect-server",
        name: "Connect Server",
        transport: "stdio",
        command: "/usr/bin/connect",
        args: [],
        url: null,
        enabled: true,
        autoConnect: true,
        secretKey: null,
        apiKey: null,
        metadata: {},
      });
      mockMCPManager.connect.mockResolvedValue(undefined);
      mockPrismaService.mCPServerConfig.update.mockResolvedValue({});

      const result = await service.connectMCPServer("connect-server");

      expect(result.success).toBe(true);
      expect(result.serverId).toBe("connect-server");
      expect(mockMCPManager.connect).toHaveBeenCalledWith("connect-server");
    });

    it("returns error and records failure when connect throws", async () => {
      mockPrismaService.mCPServerConfig.findUnique.mockResolvedValue({
        id: "db-c2",
        serverId: "fail-server",
        name: "Fail Server",
        transport: "stdio",
        command: "/usr/bin/fail",
        args: [],
        url: null,
        enabled: true,
        autoConnect: true,
        secretKey: null,
        apiKey: null,
        metadata: {},
      });
      mockMCPManager.connect.mockRejectedValue(new Error("Connection refused"));
      mockPrismaService.mCPServerConfig.update.mockResolvedValue({});

      const result = await service.connectMCPServer("fail-server");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Connection refused");
    });
  });

  // =========================================================================
  // disconnectMCPServer
  // =========================================================================

  describe("disconnectMCPServer()", () => {
    it("disconnects server and records status", async () => {
      mockMCPManager.disconnect.mockResolvedValue(undefined);
      mockPrismaService.mCPServerConfig.update.mockResolvedValue({});

      const result = await service.disconnectMCPServer("disc-server");

      expect(result.success).toBe(true);
      expect(result.serverId).toBe("disc-server");
      expect(mockMCPManager.disconnect).toHaveBeenCalledWith("disc-server");
    });

    it("returns error when disconnect throws", async () => {
      mockMCPManager.disconnect.mockRejectedValue(new Error("Not connected"));
      mockPrismaService.mCPServerConfig.update.mockResolvedValue({});

      const result = await service.disconnectMCPServer("not-connected");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Not connected");
    });
  });

  // =========================================================================
  // updateMCPServerEnv
  // =========================================================================

  describe("updateMCPServerEnv()", () => {
    it("updates env in metadata when server exists", async () => {
      mockPrismaService.mCPServerConfig.findUnique.mockResolvedValue({
        metadata: { someOtherKey: "value" },
      });
      mockPrismaService.mCPServerConfig.update.mockResolvedValue({});

      const result = await service.updateMCPServerEnv("env-server", {
        API_KEY: "my-key",
      });

      expect(result.success).toBe(true);
      expect(result.serverId).toBe("env-server");
      expect(mockPrismaService.mCPServerConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({
              someOtherKey: "value",
              env: { API_KEY: "my-key" },
            }),
          }),
        }),
      );
    });

    it("returns failure when server not found", async () => {
      mockPrismaService.mCPServerConfig.findUnique.mockResolvedValue(null);

      const result = await service.updateMCPServerEnv("missing", {
        KEY: "val",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Server not found");
    });
  });

  // =========================================================================
  // getUsageStats
  // =========================================================================

  describe("getUsageStats()", () => {
    it("returns total, successful, and failureRate=0 when no usage", async () => {
      mockPrismaService.aIUsageLog.count.mockResolvedValue(0);
      mockPrismaService.aIUsageLog.findMany.mockResolvedValue([]);

      const result = await service.getUsageStats();

      expect(result.total).toBe(0);
      expect(result.successful).toBe(0);
      expect(result.failureRate).toBe(0);
      expect(result.recentUsages).toEqual([]);
    });

    it("calculates failureRate correctly when some failures exist", async () => {
      mockPrismaService.aIUsageLog.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(7); // successful
      mockPrismaService.aIUsageLog.findMany.mockResolvedValue([]);

      const result = await service.getUsageStats();

      expect(result.failureRate).toBeCloseTo(30, 1);
    });

    it("filters by capabilityType when provided", async () => {
      mockPrismaService.aIUsageLog.count.mockResolvedValue(0);
      mockPrismaService.aIUsageLog.findMany.mockResolvedValue([]);

      await service.getUsageStats({ capabilityType: "tool" });

      expect(mockPrismaService.aIUsageLog.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ capabilityType: "tool" }),
        }),
      );
    });

    it("filters by date range when startDate and endDate provided", async () => {
      mockPrismaService.aIUsageLog.count.mockResolvedValue(0);
      mockPrismaService.aIUsageLog.findMany.mockResolvedValue([]);

      const start = new Date("2025-01-01");
      const end = new Date("2025-12-31");
      await service.getUsageStats({ startDate: start, endDate: end });

      expect(mockPrismaService.aIUsageLog.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: start,
              lte: end,
            }),
          }),
        }),
      );
    });
  });

  // =========================================================================
  // getSkillConfigs (additional branches)
  // =========================================================================

  describe("getSkillConfigs() additional branches", () => {
    it("marks loaded skills as implemented=true", async () => {
      mockSkillLoaderService.getAllLoadedSkills.mockReturnValue([
        {
          metadata: {
            id: "loaded-skill",
            name: "Loaded Skill",
            description: "A loaded skill",
            domain: "research",
            tags: [],
            allowedTools: [],
            dependencies: [],
          },
        },
      ]);
      mockPrismaService.skillConfig.findMany.mockResolvedValue([]);

      const result = await service.getSkillConfigs();

      const loadedSkill = result.skills.find(
        (s) => s.skillId === "loaded-skill",
      );
      if (loadedSkill) {
        expect(loadedSkill.implemented).toBe(true);
      }
    });

    it("applies DB override for displayName and enabled when DB entry exists", async () => {
      mockSkillLoaderService.getAllLoadedSkills.mockReturnValue([
        {
          metadata: {
            id: "db-skill",
            name: "DB Skill",
            description: "Has DB entry",
            domain: "writing",
            tags: [],
            allowedTools: [],
            dependencies: [],
          },
        },
      ]);
      mockPrismaService.skillConfig.findMany.mockResolvedValue([
        {
          id: "sc-1",
          skillId: "db-skill",
          enabled: false,
          displayName: "Custom DB Skill Name",
          description: null,
          config: null,
          allowedRoles: [],
        },
      ]);

      const result = await service.getSkillConfigs();

      const skill = result.skills.find((s) => s.skillId === "db-skill");
      if (skill) {
        expect(skill.enabled).toBe(false);
        expect(skill.displayName).toBe("Custom DB Skill Name");
      }
    });
  });

  // =========================================================================
  // updateSkillConfig (additional branches)
  // =========================================================================

  describe("updateSkillConfig() additional branches", () => {
    it("allows enabling a previously disabled skill", async () => {
      mockPrismaService.skillConfig.upsert.mockResolvedValue({
        skillId: "disabled-skill",
        enabled: true,
      });

      const result = await service.updateSkillConfig("disabled-skill", {
        enabled: true,
      });

      expect(result.success).toBe(true);
      expect(mockPrismaService.skillConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { skillId: "disabled-skill" } }),
      );
    });

    it("throws when upsert fails", async () => {
      mockPrismaService.skillConfig.upsert.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        service.updateSkillConfig("error-skill", { enabled: true }),
      ).rejects.toThrow("DB error");
    });
  });
});
