/**
 * Unit tests for MCPManager
 *
 * The MCPClientFactory (createMCPClient) is mocked so no real transports
 * are exercised. All client interactions go through mock IMCPClient objects.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { MCPManager } from "../mcp-manager";
import type {
  MCPServerConfig,
  MCPTool,
  MCPToolResult,
  MCPEvent,
} from "../../abstractions/mcp.interface";

// ----- mock createMCPClient -----

// We mock the factory module so MCPManager constructs mock clients
jest.mock("../../client/mcp-client-factory");
import { createMCPClient } from "../../client/mcp-client-factory";

const mockCreateMCPClient = createMCPClient as jest.MockedFunction<
  typeof createMCPClient
>;

// ----- helpers -----

function makeConfig(
  id: string,
  overrides?: Partial<MCPServerConfig>,
): MCPServerConfig {
  return {
    id,
    name: `Server-${id}`,
    transport: "http",
    url: `http://localhost/${id}`,
    ...overrides,
  };
}

function makeMockClient(id: string, connected = false) {
  const client = {
    id,
    connected,
    serverInfo: undefined as unknown,
    connect: jest.fn().mockImplementation(async () => {
      client.connected = true;
    }),
    disconnect: jest.fn().mockImplementation(async () => {
      client.connected = false;
    }),
    listTools: jest.fn().mockResolvedValue([]),
    callTool: jest.fn(),
    listResources: jest.fn().mockResolvedValue([]),
    readResource: jest.fn(),
    listPrompts: jest.fn().mockResolvedValue([]),
    getPrompt: jest.fn().mockResolvedValue([]),
  };
  return client;
}

// ----- tests -----

describe("MCPManager", () => {
  let manager: MCPManager;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [MCPManager],
    }).compile();

    manager = module.get<MCPManager>(MCPManager);
  });

  // ── registerServer ────────────────────────────────────────────────────────

  describe("registerServer", () => {
    it("should register a new server config", () => {
      manager.registerServer(makeConfig("s1"));
      expect(manager.getServerConfigs()).toHaveLength(1);
    });

    it("should throw when registering a duplicate server id", () => {
      manager.registerServer(makeConfig("s1"));
      expect(() => manager.registerServer(makeConfig("s1"))).toThrow(
        "already registered",
      );
    });

    it("should silently skip configs with missing required fields", () => {
      // id missing
      manager.registerServer({ id: "", name: "Bad", transport: "http" });
      expect(manager.getServerConfigs()).toHaveLength(0);

      // name missing
      manager.registerServer({ id: "x", name: "", transport: "http" });
      expect(manager.getServerConfigs()).toHaveLength(0);

      // transport missing
      manager.registerServer({ id: "y", name: "Y", transport: "" as any });
      expect(manager.getServerConfigs()).toHaveLength(0);
    });
  });

  // ── updateServerConfig ────────────────────────────────────────────────────

  describe("updateServerConfig", () => {
    it("should update the stored config", async () => {
      manager.registerServer(makeConfig("s1", { url: "http://old" }));
      await manager.updateServerConfig(makeConfig("s1", { url: "http://new" }));

      const configs = manager.getServerConfigs();
      expect(configs.find((c) => c.id === "s1")?.url).toBe("http://new");
    });

    it("should disconnect an existing connected client before updating", async () => {
      const mockClient = makeMockClient("s1", true);
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));
      await manager.connect("s1");

      expect(mockClient.connected).toBe(true);

      await manager.updateServerConfig(makeConfig("s1", { url: "http://new" }));

      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  // ── registerOrUpdateServer ────────────────────────────────────────────────

  describe("registerOrUpdateServer", () => {
    it("should register when server does not exist yet", async () => {
      await manager.registerOrUpdateServer(makeConfig("s1"));
      expect(manager.getServerConfigs()).toHaveLength(1);
    });

    it("should update when server already exists", async () => {
      manager.registerServer(makeConfig("s1", { url: "http://old" }));
      await manager.registerOrUpdateServer(
        makeConfig("s1", { url: "http://updated" }),
      );

      const configs = manager.getServerConfigs();
      expect(configs.find((c) => c.id === "s1")?.url).toBe("http://updated");
    });
  });

  // ── unregisterServer ──────────────────────────────────────────────────────

  describe("unregisterServer", () => {
    it("should remove the server config", async () => {
      manager.registerServer(makeConfig("s1"));
      await manager.unregisterServer("s1");

      expect(manager.getServerConfigs()).toHaveLength(0);
    });

    it("should disconnect a connected client before removing", async () => {
      const mockClient = makeMockClient("s1", true);
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));
      await manager.connect("s1");
      await manager.unregisterServer("s1");

      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  // ── connect ───────────────────────────────────────────────────────────────

  describe("connect", () => {
    it("should create a client and call connect()", async () => {
      const mockClient = makeMockClient("s1");
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));
      await manager.connect("s1");

      expect(mockClient.connect).toHaveBeenCalledTimes(1);
      expect(mockClient.connected).toBe(true);
    });

    it("should throw when server is not registered", async () => {
      await expect(manager.connect("unknown")).rejects.toThrow(
        "not registered",
      );
    });

    it("should not reconnect an already connected client", async () => {
      const mockClient = makeMockClient("s1");
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));
      await manager.connect("s1");
      await manager.connect("s1"); // second call

      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    });

    it("should emit a 'connected' event after successful connect", async () => {
      const mockClient = makeMockClient("s1");
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));

      const events: MCPEvent[] = [];
      manager.onEvent((e) => events.push(e));

      await manager.connect("s1");

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "connected", serverId: "s1" });
    });
  });

  // ── connectAll ────────────────────────────────────────────────────────────

  describe("connectAll", () => {
    it("should connect all registered servers", async () => {
      const c1 = makeMockClient("s1");
      const c2 = makeMockClient("s2");
      mockCreateMCPClient
        .mockReturnValueOnce(c1 as any)
        .mockReturnValueOnce(c2 as any);

      manager.registerServer(makeConfig("s1"));
      manager.registerServer(makeConfig("s2"));

      await manager.connectAll();

      expect(c1.connect).toHaveBeenCalled();
      expect(c2.connect).toHaveBeenCalled();
    });

    it("should continue connecting remaining servers if one fails", async () => {
      const c1 = makeMockClient("s1");
      c1.connect.mockRejectedValueOnce(new Error("connect failed"));
      const c2 = makeMockClient("s2");

      mockCreateMCPClient
        .mockReturnValueOnce(c1 as any)
        .mockReturnValueOnce(c2 as any);

      manager.registerServer(makeConfig("s1"));
      manager.registerServer(makeConfig("s2"));

      await manager.connectAll(); // should not throw

      expect(c2.connect).toHaveBeenCalled();
    });
  });

  // ── disconnect ────────────────────────────────────────────────────────────

  describe("disconnect", () => {
    it("should call client.disconnect() for a connected server", async () => {
      const mockClient = makeMockClient("s1");
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));
      await manager.connect("s1");

      await manager.disconnect("s1");

      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should emit a 'disconnected' event", async () => {
      const mockClient = makeMockClient("s1");
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));
      await manager.connect("s1");

      const events: MCPEvent[] = [];
      manager.onEvent((e) => events.push(e));

      await manager.disconnect("s1");

      expect(events.some((e) => e.type === "disconnected")).toBe(true);
    });

    it("should be a no-op when client is not connected", async () => {
      const mockClient = makeMockClient("s1", false);
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));
      await manager.connect("s1");
      // Manually set connected=false without going through disconnect
      mockClient.connected = false;

      await manager.disconnect("s1");
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });
  });

  // ── disconnectAll ─────────────────────────────────────────────────────────

  describe("disconnectAll", () => {
    it("should disconnect all connected clients", async () => {
      const c1 = makeMockClient("s1");
      const c2 = makeMockClient("s2");
      mockCreateMCPClient
        .mockReturnValueOnce(c1 as any)
        .mockReturnValueOnce(c2 as any);

      manager.registerServer(makeConfig("s1"));
      manager.registerServer(makeConfig("s2"));
      await manager.connectAll();

      await manager.disconnectAll();

      expect(c1.disconnect).toHaveBeenCalled();
      expect(c2.disconnect).toHaveBeenCalled();
    });
  });

  // ── getClient / getAllClients / getServerConfigs ───────────────────────────

  describe("getClient", () => {
    it("should return undefined for an unknown server", () => {
      expect(manager.getClient("unknown")).toBeUndefined();
    });

    it("should return the client after connect", async () => {
      const mockClient = makeMockClient("s1");
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));
      await manager.connect("s1");

      expect(manager.getClient("s1")).toBe(mockClient);
    });
  });

  describe("getAllClients", () => {
    it("should return all active clients", async () => {
      const c1 = makeMockClient("s1");
      const c2 = makeMockClient("s2");
      mockCreateMCPClient
        .mockReturnValueOnce(c1 as any)
        .mockReturnValueOnce(c2 as any);

      manager.registerServer(makeConfig("s1"));
      manager.registerServer(makeConfig("s2"));
      await manager.connectAll();

      expect(manager.getAllClients()).toHaveLength(2);
    });

    it("should return empty array when no clients", () => {
      expect(manager.getAllClients()).toEqual([]);
    });
  });

  describe("getServerConfigs", () => {
    it("should return all registered configs", () => {
      manager.registerServer(makeConfig("s1"));
      manager.registerServer(makeConfig("s2"));

      expect(manager.getServerConfigs()).toHaveLength(2);
    });
  });

  // ── getAllTools / getAllToolsFlat ───────────────────────────────────────────

  describe("getAllTools", () => {
    it("should return a map of serverId -> tools for connected clients", async () => {
      const c1 = makeMockClient("s1");
      const mockTools: MCPTool[] = [
        {
          name: "search",
          description: "Search",
          inputSchema: { type: "object" },
        },
      ];
      c1.listTools.mockResolvedValue(mockTools);
      mockCreateMCPClient.mockReturnValueOnce(c1 as any);

      manager.registerServer(makeConfig("s1"));
      await manager.connect("s1");

      const result = await manager.getAllTools();

      expect(result.get("s1")).toEqual(mockTools);
    });

    it("should set empty array for a server that errors during listTools", async () => {
      const c1 = makeMockClient("s1");
      c1.listTools.mockRejectedValue(new Error("listTools failed"));
      mockCreateMCPClient.mockReturnValueOnce(c1 as any);

      manager.registerServer(makeConfig("s1"));
      await manager.connect("s1");

      const result = await manager.getAllTools();

      expect(result.get("s1")).toEqual([]);
    });
  });

  describe("getAllToolsFlat", () => {
    it("should return a flat array of { serverId, tool } entries", async () => {
      const c1 = makeMockClient("s1");
      const c2 = makeMockClient("s2");

      const toolsS1: MCPTool[] = [
        { name: "tool-a", description: "A", inputSchema: { type: "object" } },
      ];
      const toolsS2: MCPTool[] = [
        { name: "tool-b", description: "B", inputSchema: { type: "object" } },
        { name: "tool-c", description: "C", inputSchema: { type: "object" } },
      ];
      c1.listTools.mockResolvedValue(toolsS1);
      c2.listTools.mockResolvedValue(toolsS2);

      mockCreateMCPClient
        .mockReturnValueOnce(c1 as any)
        .mockReturnValueOnce(c2 as any);

      manager.registerServer(makeConfig("s1"));
      manager.registerServer(makeConfig("s2"));
      await manager.connectAll();

      const flat = await manager.getAllToolsFlat();

      expect(flat).toHaveLength(3);
      expect(flat.map((f) => f.tool.name)).toEqual(
        expect.arrayContaining(["tool-a", "tool-b", "tool-c"]),
      );
    });
  });

  // ── callTool ──────────────────────────────────────────────────────────────

  describe("callTool", () => {
    it("should call the appropriate client and return the result", async () => {
      const mockClient = makeMockClient("s1");
      const mockResult: MCPToolResult = {
        content: [{ type: "text", text: "result" }],
        isError: false,
      };
      mockClient.callTool.mockResolvedValue(mockResult);
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));
      await manager.connect("s1");

      const result = await manager.callTool("s1", "search", { query: "test" });

      expect(mockClient.callTool).toHaveBeenCalledWith("search", {
        query: "test",
      });
      expect(result).toEqual(mockResult);
    });

    it("should throw when the server is not found", async () => {
      await expect(manager.callTool("unknown", "tool", {})).rejects.toThrow(
        "not found",
      );
    });

    it("should throw when the client is not connected", async () => {
      const mockClient = makeMockClient("s1", false);
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));
      // Connect to add client to map, then force disconnected
      await manager.connect("s1");
      mockClient.connected = false;

      await expect(manager.callTool("s1", "tool", {})).rejects.toThrow(
        "not connected",
      );
    });
  });

  // ── callToolAuto ──────────────────────────────────────────────────────────

  describe("callToolAuto", () => {
    it("should auto-route to the server that provides the tool", async () => {
      const mockClient = makeMockClient("s1");
      const tool: MCPTool = {
        name: "magic-tool",
        description: "magic",
        inputSchema: { type: "object" },
      };
      mockClient.listTools.mockResolvedValue([tool]);
      const mockResult: MCPToolResult = {
        content: [{ type: "text", text: "ok" }],
      };
      mockClient.callTool.mockResolvedValue(mockResult);
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));
      await manager.connect("s1");

      const result = await manager.callToolAuto("magic-tool", { input: "x" });

      expect(result).toEqual(mockResult);
    });

    it("should throw when no server provides the requested tool", async () => {
      const mockClient = makeMockClient("s1");
      mockClient.listTools.mockResolvedValue([]);
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));
      await manager.connect("s1");

      await expect(
        manager.callToolAuto("non-existent-tool", {}),
      ).rejects.toThrow("not found on any server");
    });
  });

  // ── onEvent ───────────────────────────────────────────────────────────────

  describe("onEvent", () => {
    it("should call registered handlers when an event is emitted", async () => {
      const mockClient = makeMockClient("s1");
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));

      const handler = jest.fn();
      manager.onEvent(handler);
      await manager.connect("s1");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "connected", serverId: "s1" }),
      );
    });

    it("should return an unsubscribe function that stops future events", async () => {
      const mockClient = makeMockClient("s1");
      const c2 = makeMockClient("s2");
      mockCreateMCPClient
        .mockReturnValueOnce(mockClient as any)
        .mockReturnValueOnce(c2 as any);

      manager.registerServer(makeConfig("s1"));
      manager.registerServer(makeConfig("s2"));

      const handler = jest.fn();
      const unsubscribe = manager.onEvent(handler);

      await manager.connect("s1");
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      await manager.connect("s2");
      expect(handler).toHaveBeenCalledTimes(1); // no more calls
    });

    it("should not throw if an event handler itself throws", async () => {
      const mockClient = makeMockClient("s1");
      mockCreateMCPClient.mockReturnValueOnce(mockClient as any);

      manager.registerServer(makeConfig("s1"));

      manager.onEvent(() => {
        throw new Error("handler error");
      });

      await expect(manager.connect("s1")).resolves.toBeUndefined();
    });
  });

  // ── LRU eviction (client map is capped at 50) ─────────────────────────────

  describe("LRU client eviction", () => {
    it("should evict the least-recently-used client when 50 are in the map", async () => {
      // Register 51 servers and connect them all
      const clients: ReturnType<typeof makeMockClient>[] = [];
      for (let i = 0; i < 51; i++) {
        const c = makeMockClient(`s${i}`);
        clients.push(c);
        mockCreateMCPClient.mockReturnValueOnce(c as any);
        manager.registerServer(makeConfig(`s${i}`));
      }

      for (let i = 0; i < 51; i++) {
        await manager.connect(`s${i}`);
      }

      // The first client (s0) should have been evicted by the LRU map
      expect(manager.getClient("s0")).toBeUndefined();
      // The last one (s50) should still be present
      expect(manager.getClient("s50")).toBeDefined();
    });
  });
});
