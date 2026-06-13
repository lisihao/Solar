/**
 * Unit tests for MCPClientRegistryService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { MCPClientRegistryService } from "../mcp-client-registry.service";
import { MCPManager } from "../../manager/mcp-manager";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ToolRegistry } from "../../../../registry/tool.registry";

// ----- mock data -----

const mockServerRecord = {
  id: "db-id-1",
  serverId: "server-1",
  name: "Test Server",
  description: "A test MCP server",
  transport: "http",
  url: "http://localhost:9000",
  enabled: true,
  autoConnect: true,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ----- mock factories -----

function makeMockPrisma() {
  return {
    mCPServerConfig: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(mockServerRecord),
      update: jest.fn().mockResolvedValue(mockServerRecord),
      delete: jest.fn().mockResolvedValue(mockServerRecord),
    },
  };
}

function makeMockMCPManager() {
  return {
    registerOrUpdateServer: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    unregisterServer: jest.fn().mockResolvedValue(undefined),
    getClient: jest.fn().mockReturnValue(undefined),
  };
}

function makeMockToolRegistry() {
  const tools: Array<{ id: string }> = [];
  return {
    register: jest.fn().mockImplementation((tool: { id: string }) => {
      tools.push(tool);
    }),
    unregister: jest.fn().mockImplementation((id: string) => {
      const idx = tools.findIndex((t) => t.id === id);
      if (idx !== -1) tools.splice(idx, 1);
    }),
    // Return a snapshot so iterating callers are not affected by concurrent mutations
    getAll: jest.fn().mockImplementation(() => [...tools]),
    _tools: tools,
  };
}

// ----- tests -----

describe("MCPClientRegistryService", () => {
  let service: MCPClientRegistryService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let mockMCPManager: ReturnType<typeof makeMockMCPManager>;
  let mockToolRegistry: ReturnType<typeof makeMockToolRegistry>;

  async function buildModule(withToolRegistry = true): Promise<void> {
    mockPrisma = makeMockPrisma();
    mockMCPManager = makeMockMCPManager();
    mockToolRegistry = makeMockToolRegistry();

    const providers: any[] = [
      MCPClientRegistryService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: MCPManager, useValue: mockMCPManager },
    ];

    if (withToolRegistry) {
      providers.push({ provide: ToolRegistry, useValue: mockToolRegistry });
    }

    const module: TestingModule = await Test.createTestingModule({
      providers,
    }).compile();

    service = module.get<MCPClientRegistryService>(MCPClientRegistryService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
  });

  // ── onModuleInit (auto-connect) ───────────────────────────────────────────

  describe("onModuleInit", () => {
    it("should auto-connect servers with enabled=true and autoConnect=true", async () => {
      await buildModule();
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([mockServerRecord]);
      mockPrisma.mCPServerConfig.findUnique.mockResolvedValue(mockServerRecord);

      await service.onModuleInit();

      expect(mockMCPManager.registerOrUpdateServer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "server-1" }),
      );
      expect(mockMCPManager.connect).toHaveBeenCalledWith("server-1");
    });

    it("should log and skip when no auto-connect servers are configured", async () => {
      await buildModule();
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([]);

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(mockMCPManager.connect).not.toHaveBeenCalled();
    });

    it("should continue with remaining servers when one auto-connect fails", async () => {
      await buildModule();

      const s1 = { ...mockServerRecord, serverId: "s1" };
      const s2 = { ...mockServerRecord, serverId: "s2" };
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([s1, s2]);
      mockPrisma.mCPServerConfig.findUnique
        .mockResolvedValueOnce(s1)
        .mockResolvedValueOnce(s2);

      mockMCPManager.connect
        .mockRejectedValueOnce(new Error("s1 failed"))
        .mockResolvedValueOnce(undefined);

      await service.onModuleInit();

      expect(mockMCPManager.connect).toHaveBeenCalledTimes(2);
    });

    it("should not throw if prisma query fails during auto-connect", async () => {
      await buildModule();
      mockPrisma.mCPServerConfig.findMany.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  // ── connectServer ─────────────────────────────────────────────────────────

  describe("connectServer", () => {
    beforeEach(async () => {
      await buildModule();
    });

    it("should register the server in MCPManager and connect", async () => {
      mockPrisma.mCPServerConfig.findUnique.mockResolvedValue(mockServerRecord);

      await service.connectServer("server-1");

      expect(mockMCPManager.registerOrUpdateServer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "server-1",
          transport: "http",
          url: "http://localhost:9000",
        }),
      );
      expect(mockMCPManager.connect).toHaveBeenCalledWith("server-1");
    });

    it("should set connection status to connected on success", async () => {
      mockPrisma.mCPServerConfig.findUnique.mockResolvedValue(mockServerRecord);

      await service.connectServer("server-1");

      const status = service.getConnectionStatus("server-1");
      expect(status.status).toBe("connected");
      expect(status.connectedAt).toBeInstanceOf(Date);
    });

    it("should throw and set error status when config not found", async () => {
      mockPrisma.mCPServerConfig.findUnique.mockResolvedValue(null);

      await expect(service.connectServer("unknown")).rejects.toThrow(
        "Server config not found",
      );
    });

    it("should throw when server has no URL configured", async () => {
      mockPrisma.mCPServerConfig.findUnique.mockResolvedValue({
        ...mockServerRecord,
        url: null,
      });

      await expect(service.connectServer("server-1")).rejects.toThrow(
        "no URL configured",
      );
    });

    it("should set error status when MCPManager.connect throws", async () => {
      mockPrisma.mCPServerConfig.findUnique.mockResolvedValue(mockServerRecord);
      mockMCPManager.connect.mockRejectedValue(new Error("connect failed"));

      await expect(service.connectServer("server-1")).rejects.toThrow(
        "connect failed",
      );

      const status = service.getConnectionStatus("server-1");
      expect(status.status).toBe("error");
      expect(status.error).toBe("connect failed");
    });
  });

  // ── connectServer with ToolRegistry ──────────────────────────────────────

  describe("connectServer – tool registration", () => {
    it("should register MCP tools in ToolRegistry after connecting", async () => {
      await buildModule(true);

      mockPrisma.mCPServerConfig.findUnique.mockResolvedValue(mockServerRecord);

      const mockClient = {
        connected: true,
        listTools: jest.fn().mockResolvedValue([
          {
            name: "tool-x",
            description: "X",
            inputSchema: { type: "object" },
          },
        ]),
      };
      mockMCPManager.getClient.mockReturnValue(mockClient);

      await service.connectServer("server-1");

      expect(mockToolRegistry.register).toHaveBeenCalledTimes(1);
      expect(mockToolRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({ id: "mcp:server-1:tool-x" }),
      );
    });

    it("should not register tools when ToolRegistry is absent", async () => {
      await buildModule(false);

      mockPrisma.mCPServerConfig.findUnique.mockResolvedValue(mockServerRecord);

      await service.connectServer("server-1");

      expect(mockToolRegistry.register).not.toHaveBeenCalled();
    });
  });

  // ── disconnectServer ──────────────────────────────────────────────────────

  describe("disconnectServer", () => {
    beforeEach(async () => {
      await buildModule();
    });

    it("should call MCPManager.disconnect and set status to disconnected", async () => {
      await service.disconnectServer("server-1");

      expect(mockMCPManager.disconnect).toHaveBeenCalledWith("server-1");

      const status = service.getConnectionStatus("server-1");
      expect(status.status).toBe("disconnected");
    });

    it("should not throw when MCPManager.disconnect errors", async () => {
      mockMCPManager.disconnect.mockRejectedValue(
        new Error("disconnect error"),
      );

      await expect(
        service.disconnectServer("server-1"),
      ).resolves.toBeUndefined();
    });

    it("should unregister MCP tools from ToolRegistry before disconnecting", async () => {
      // Pre-populate tools with mcp:server-1: prefix
      mockToolRegistry._tools.push(
        { id: "mcp:server-1:tool-a" },
        { id: "mcp:server-1:tool-b" },
        { id: "mcp:other-server:tool-c" },
      );

      await service.disconnectServer("server-1");

      expect(mockToolRegistry.unregister).toHaveBeenCalledWith(
        "mcp:server-1:tool-a",
      );
      expect(mockToolRegistry.unregister).toHaveBeenCalledWith(
        "mcp:server-1:tool-b",
      );
      expect(mockToolRegistry.unregister).not.toHaveBeenCalledWith(
        "mcp:other-server:tool-c",
      );
    });
  });

  // ── discoverTools ─────────────────────────────────────────────────────────

  describe("discoverTools", () => {
    beforeEach(async () => {
      await buildModule();
    });

    it("should return tools from the connected client", async () => {
      const tools = [
        {
          name: "search",
          description: "Search",
          inputSchema: { type: "object" },
        },
      ];
      mockMCPManager.getClient.mockReturnValue({
        connected: true,
        listTools: jest.fn().mockResolvedValue(tools),
      });

      const result = await service.discoverTools("server-1");

      expect(result).toEqual(tools);
    });

    it("should throw when no client exists for the server", async () => {
      mockMCPManager.getClient.mockReturnValue(undefined);

      await expect(service.discoverTools("server-1")).rejects.toThrow(
        "No connected client",
      );
    });

    it("should throw when client is not connected", async () => {
      mockMCPManager.getClient.mockReturnValue({ connected: false });

      await expect(service.discoverTools("server-1")).rejects.toThrow(
        "is not connected",
      );
    });
  });

  // ── getConnectionStatus / getConnectionStatuses ───────────────────────────

  describe("getConnectionStatus", () => {
    beforeEach(async () => {
      await buildModule();
    });

    it("should return disconnected by default for unknown server", () => {
      const status = service.getConnectionStatus("unknown");
      expect(status).toEqual({ status: "disconnected" });
    });
  });

  describe("getConnectionStatuses", () => {
    beforeEach(async () => {
      await buildModule();
    });

    it("should return all servers with their connection statuses", async () => {
      mockPrisma.mCPServerConfig.findMany.mockResolvedValue([mockServerRecord]);

      const statuses = await service.getConnectionStatuses();

      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toMatchObject({
        serverId: "server-1",
        connectionStatus: { status: "disconnected" },
      });
    });
  });

  // ── addServer ─────────────────────────────────────────────────────────────

  describe("addServer", () => {
    beforeEach(async () => {
      await buildModule();
    });

    it("should create a record via prisma and return it", async () => {
      const result = await service.addServer({
        serverId: "new-server",
        name: "New Server",
        transport: "http",
        url: "http://localhost:9001",
      });

      expect(mockPrisma.mCPServerConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            serverId: "new-server",
            transport: "http",
          }),
        }),
      );
      expect(result).toEqual(mockServerRecord);
    });

    it("should default enabled=true and autoConnect=false", async () => {
      await service.addServer({
        serverId: "s",
        name: "S",
        transport: "http",
        url: "http://x",
      });

      expect(mockPrisma.mCPServerConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ enabled: true, autoConnect: false }),
        }),
      );
    });
  });

  // ── updateServer ──────────────────────────────────────────────────────────

  describe("updateServer", () => {
    beforeEach(async () => {
      await buildModule();
    });

    it("should call prisma.update with the provided fields", async () => {
      await service.updateServer("db-id-1", { name: "Updated Name" });

      expect(mockPrisma.mCPServerConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "db-id-1" },
          data: expect.objectContaining({ name: "Updated Name" }),
        }),
      );
    });
  });

  // ── removeServer ──────────────────────────────────────────────────────────

  describe("removeServer", () => {
    beforeEach(async () => {
      await buildModule();
    });

    it("should unregister from MCPManager and delete the DB record", async () => {
      mockPrisma.mCPServerConfig.findUnique.mockResolvedValue(mockServerRecord);

      await service.removeServer("db-id-1");

      expect(mockMCPManager.unregisterServer).toHaveBeenCalledWith("server-1");
      expect(mockPrisma.mCPServerConfig.delete).toHaveBeenCalledWith({
        where: { id: "db-id-1" },
      });
    });

    it("should skip MCPManager unregister when server is not found in DB", async () => {
      mockPrisma.mCPServerConfig.findUnique.mockResolvedValue(null);

      await service.removeServer("non-existent-id");

      expect(mockMCPManager.unregisterServer).not.toHaveBeenCalled();
      expect(mockPrisma.mCPServerConfig.delete).toHaveBeenCalledWith({
        where: { id: "non-existent-id" },
      });
    });

    it("should not throw if MCPManager.unregisterServer errors", async () => {
      mockPrisma.mCPServerConfig.findUnique.mockResolvedValue(mockServerRecord);
      mockMCPManager.unregisterServer.mockRejectedValue(
        new Error("unreg error"),
      );

      await expect(service.removeServer("db-id-1")).resolves.toBeDefined();
    });
  });

  // ── findById ──────────────────────────────────────────────────────────────

  describe("findById", () => {
    beforeEach(async () => {
      await buildModule();
    });

    it("should call prisma.findUnique with the correct id", async () => {
      mockPrisma.mCPServerConfig.findUnique.mockResolvedValue(mockServerRecord);

      const result = await service.findById("db-id-1");

      expect(mockPrisma.mCPServerConfig.findUnique).toHaveBeenCalledWith({
        where: { id: "db-id-1" },
      });
      expect(result).toEqual(mockServerRecord);
    });
  });
});

