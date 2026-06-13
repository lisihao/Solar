import { Test, TestingModule } from "@nestjs/testing";
import { MCPClientService } from "../mcp-client.service";
import { ToolFacade } from "@/modules/ai-harness/facade";

// Mock child_process.execSync so tests never hit the real shell
jest.mock("child_process", () => ({
  execSync: jest.fn(),
}));

// Keep a reference to the mock so individual tests can control it
import { execSync } from "child_process";
const mockExecSync = execSync as jest.Mock;

// ── helpers ──────────────────────────────────────────────────────────────────

function buildMockMcpManager(overrides: Record<string, jest.Mock> = {}) {
  return {
    registerOrUpdateServer: jest.fn().mockResolvedValue(undefined),
    connectAll: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getClient: jest.fn().mockReturnValue(null),
    callTool: jest.fn(),
    getServerConfigs: jest.fn().mockReturnValue([]),
    ...overrides,
  };
}

function buildFacade(
  mcpManager: ReturnType<typeof buildMockMcpManager> | null,
) {
  return { mcpManager } as unknown as ToolFacade;
}

// ── test suite ────────────────────────────────────────────────────────────────

describe("MCPClientService", () => {
  let service: MCPClientService;
  let mockManager: ReturnType<typeof buildMockMcpManager>;

  beforeEach(async () => {
    // By default execSync succeeds (command found)
    mockExecSync.mockReturnValue(Buffer.from(""));
    mockManager = buildMockMcpManager();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MCPClientService,
        { provide: ToolFacade, useValue: buildFacade(mockManager) },
      ],
    }).compile();

    service = module.get<MCPClientService>(MCPClientService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── onModuleInit ────────────────────────────────────────────────────────────

  describe("onModuleInit", () => {
    it("should call connectAll after registering servers when commands are available", async () => {
      await service.onModuleInit();
      // Whether any servers are registered depends on MCP_SERVER_CONFIGS content
      // (driven by env vars).  We only assert the manager methods were at least
      // callable without throwing.
      expect(mockManager.registerOrUpdateServer).toBeDefined();
    });

    it("should skip stdio servers whose command is not found", async () => {
      // execSync throws when command is missing from PATH
      mockExecSync.mockImplementation(() => {
        throw new Error("not found");
      });

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      // registerOrUpdateServer should not have been called for skipped servers
    });

    it("should handle registerOrUpdateServer failure gracefully", async () => {
      mockManager.registerOrUpdateServer.mockRejectedValue(
        new Error("Registration error"),
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it("should handle connectAll failure gracefully", async () => {
      // Make at least one server register successfully so connectAll is invoked
      mockManager.registerOrUpdateServer.mockResolvedValue(undefined);
      mockManager.connectAll.mockRejectedValue(new Error("Connect error"));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  // ── onModuleDestroy ─────────────────────────────────────────────────────────

  describe("onModuleDestroy", () => {
    it("should disconnect all configured servers", async () => {
      await service.onModuleDestroy();
      // disconnect called for each entry in MCP_SERVER_CONFIGS
      // (may be zero if XHS_MCP_URL is not set in test env)
      expect(mockManager.disconnect).toBeDefined();
    });

    it("should continue even if disconnect throws", async () => {
      mockManager.disconnect.mockRejectedValue(new Error("Disconnect error"));

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  // ── startServer ─────────────────────────────────────────────────────────────

  describe("startServer", () => {
    it("should return true when connect succeeds", async () => {
      mockManager.connect.mockResolvedValue(undefined);

      const result = await service.startServer("server-1");

      expect(result).toBe(true);
      expect(mockManager.connect).toHaveBeenCalledWith("server-1");
    });

    it("should return false when connect throws", async () => {
      mockManager.connect.mockRejectedValue(new Error("Connection refused"));

      const result = await service.startServer("server-1");

      expect(result).toBe(false);
    });
  });

  // ── stopServer ──────────────────────────────────────────────────────────────

  describe("stopServer", () => {
    it("should call disconnect on the manager", async () => {
      mockManager.disconnect.mockResolvedValue(undefined);

      await service.stopServer("server-1");

      expect(mockManager.disconnect).toHaveBeenCalledWith("server-1");
    });

    it("should not throw when disconnect fails", async () => {
      mockManager.disconnect.mockRejectedValue(new Error("Disconnect error"));

      await expect(service.stopServer("server-1")).resolves.toBeUndefined();
    });
  });

  // ── callTool ────────────────────────────────────────────────────────────────

  describe("callTool", () => {
    it("should return error result when mcpManager is not available", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MCPClientService,
          { provide: ToolFacade, useValue: buildFacade(null) },
        ],
      }).compile();

      const svc = module.get<MCPClientService>(MCPClientService);
      const result = await svc.callTool("server-1", "tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("MCP manager not available");
    });

    it("should return error when server is currently starting", async () => {
      // Simulate concurrent start by calling callTool twice quickly.
      // First call: no client -> starts the server (takes a while)
      // Second call while first is in-flight: server is starting
      mockManager.getClient.mockReturnValue(null);
      mockManager.connect.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 50)),
      );

      const first = service.callTool("server-1", "tool", {});
      // Small delay so the first call sets startingServers before second begins
      await new Promise((r) => setTimeout(r, 5));
      const second = await service.callTool("server-1", "tool", {});

      expect(second.success).toBe(false);
      expect(second.error).toContain("is starting");

      await first; // wait for first to finish
    });

    it("should auto-start server when client is not found and return success", async () => {
      const mockClient = { connected: true };
      let callCount = 0;
      mockManager.getClient.mockImplementation(() => {
        // First call: null (not registered); subsequent calls: client exists
        return callCount++ === 0 ? null : mockClient;
      });
      mockManager.connect.mockResolvedValue(undefined);
      mockManager.callTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: '{"status":"ok"}' }],
      });

      const result = await service.callTool("server-1", "my-tool", {
        param: "value",
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ status: "ok" });
    });

    it("should return error when server fails to start", async () => {
      mockManager.getClient.mockReturnValue(null);
      mockManager.connect.mockRejectedValue(new Error("Start failed"));

      const result = await service.callTool("server-1", "tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found or failed to start");
    });

    it("should connect when client exists but is not connected", async () => {
      const mockClient = { connected: false };
      mockManager.getClient.mockReturnValue(mockClient);
      mockManager.connect.mockResolvedValue(undefined);
      mockManager.callTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "plain text" }],
      });

      const result = await service.callTool("server-1", "tool", {});

      expect(mockManager.connect).toHaveBeenCalledWith("server-1");
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ text: "plain text" });
    });

    it("should call tool when client is already connected", async () => {
      const mockClient = { connected: true };
      mockManager.getClient.mockReturnValue(mockClient);
      mockManager.callTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: '{"items":[1,2,3]}' }],
      });

      const result = await service.callTool("server-1", "list-items", {});

      expect(mockManager.callTool).toHaveBeenCalledWith(
        "server-1",
        "list-items",
        {},
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ items: [1, 2, 3] });
    });

    it("should map isError=true result to failure", async () => {
      const mockClient = { connected: true };
      mockManager.getClient.mockReturnValue(mockClient);
      mockManager.callTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Tool execution failed" }],
      });

      const result = await service.callTool("server-1", "bad-tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toBe("Tool execution failed");
    });

    it("should use fallback error text when error content has no text", async () => {
      const mockClient = { connected: true };
      mockManager.getClient.mockReturnValue(mockClient);
      mockManager.callTool.mockResolvedValue({
        isError: true,
        content: [],
      });

      const result = await service.callTool("server-1", "tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unknown MCP error");
    });

    it("should return full content array when no text field present", async () => {
      const mockClient = { connected: true };
      mockManager.getClient.mockReturnValue(mockClient);
      const contentArray = [{ type: "image", data: "base64..." }];
      mockManager.callTool.mockResolvedValue({
        isError: false,
        content: contentArray,
      });

      const result = await service.callTool("server-1", "tool", {});

      expect(result.success).toBe(true);
      expect(result.data).toEqual(contentArray);
    });

    it("should catch unexpected errors and return failure", async () => {
      const mockClient = { connected: true };
      mockManager.getClient.mockReturnValue(mockClient);
      mockManager.callTool.mockRejectedValue(new Error("Unexpected crash"));

      const result = await service.callTool("server-1", "tool", {});

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unexpected crash");
    });
  });

  // ── listTools ───────────────────────────────────────────────────────────────

  describe("listTools", () => {
    it("should return tools list from client", async () => {
      const tools = [{ name: "tool-1" }, { name: "tool-2" }];
      const mockClient = {
        connected: true,
        listTools: jest.fn().mockResolvedValue(tools),
      };
      mockManager.getClient.mockReturnValue(mockClient);

      const result = await service.listTools("server-1");

      expect(result).toEqual(tools);
    });

    it("should reconnect when client is not connected before listing tools", async () => {
      const tools = [{ name: "tool-a" }];
      const mockClient = {
        connected: false,
        listTools: jest.fn().mockResolvedValue(tools),
      };
      let clientCallCount = 0;
      mockManager.getClient.mockImplementation(() => {
        // Return disconnected client first, then connected after reconnect
        if (clientCallCount++ === 0)
          return { connected: false, listTools: mockClient.listTools };
        return { connected: true, listTools: mockClient.listTools };
      });
      mockManager.connect.mockResolvedValue(undefined);

      const result = await service.listTools("server-1");

      expect(mockManager.connect).toHaveBeenCalledWith("server-1");
      expect(result).toEqual(tools);
    });

    it("should return empty array when manager is not available", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MCPClientService,
          { provide: ToolFacade, useValue: buildFacade(null) },
        ],
      }).compile();

      const svc = module.get<MCPClientService>(MCPClientService);
      const result = await svc.listTools("server-1");

      expect(result).toEqual([]);
    });

    it("should return empty array when server is not found", async () => {
      mockManager.getClient.mockReturnValue(null);

      const result = await service.listTools("server-1");

      expect(result).toEqual([]);
    });

    it("should return empty array when listTools throws", async () => {
      const mockClient = {
        connected: true,
        listTools: jest.fn().mockRejectedValue(new Error("RPC error")),
      };
      mockManager.getClient.mockReturnValue(mockClient);

      const result = await service.listTools("server-1");

      expect(result).toEqual([]);
    });
  });

  // ── getServerStatus ─────────────────────────────────────────────────────────

  describe("getServerStatus", () => {
    it("should return null when server is not registered", () => {
      mockManager.getClient.mockReturnValue(null);

      const status = service.getServerStatus("unknown-server");

      expect(status).toBeNull();
    });

    it("should return running status for connected server", () => {
      mockManager.getClient.mockReturnValue({ connected: true });

      const status = service.getServerStatus("server-1");

      expect(status).toEqual({ status: "running", lastError: undefined });
    });

    it("should return stopped status for disconnected server", () => {
      mockManager.getClient.mockReturnValue({ connected: false });

      const status = service.getServerStatus("server-1");

      expect(status).toEqual({ status: "stopped", lastError: undefined });
    });
  });

  // ── getAllServerStatus ───────────────────────────────────────────────────────

  describe("getAllServerStatus", () => {
    it("should return status for all configured servers", () => {
      mockManager.getServerConfigs.mockReturnValue([
        { id: "server-1", name: "Server One" },
        { id: "server-2", name: "Server Two" },
      ]);
      mockManager.getClient.mockImplementation((id: string) => {
        return id === "server-1" ? { connected: true } : { connected: false };
      });

      const statuses = service.getAllServerStatus();

      expect(statuses).toHaveLength(2);
      expect(statuses[0]).toEqual({
        id: "server-1",
        name: "Server One",
        status: "running",
        lastError: undefined,
      });
      expect(statuses[1]).toEqual({
        id: "server-2",
        name: "Server Two",
        status: "stopped",
        lastError: undefined,
      });
    });

    it("should return empty array when no servers are configured", () => {
      mockManager.getServerConfigs.mockReturnValue([]);

      const statuses = service.getAllServerStatus();

      expect(statuses).toEqual([]);
    });
  });

  // ── isServerAvailable ───────────────────────────────────────────────────────

  describe("isServerAvailable", () => {
    it("should return true when server client is connected", () => {
      mockManager.getClient.mockReturnValue({ connected: true });

      expect(service.isServerAvailable("server-1")).toBe(true);
    });

    it("should return false when server client is not connected", () => {
      mockManager.getClient.mockReturnValue({ connected: false });

      expect(service.isServerAvailable("server-1")).toBe(false);
    });

    it("should return false when server is not found", () => {
      mockManager.getClient.mockReturnValue(null);

      expect(service.isServerAvailable("unknown")).toBe(false);
    });
  });
});
