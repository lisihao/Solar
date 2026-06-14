/**
 * MCPRelay — extra2 coverage: registerServer and connect paths
 *
 * Covers lines not reached by mcp-relay.spec.ts or mcp-relay-extra.spec.ts:
 * - registerServer: re-register existing server (line 73-74)
 * - registerServer: listTools success → tool registration loop (lines 79-113)
 * - registerServer: listTools throws → logs warn + re-throws (lines 86-91)
 * - registerServer: excluded tools are skipped (lines 96-99)
 * - unregisterServer: toolRegistry.unregister (line 123)
 * - isExcluded: string and regex matching (lines 234-241)
 *
 * Strategy: spy on private `connect()` to bypass real network/SDK import.
 */

import { ToolRegistry } from "../../../registry/tool.registry";
import { MCPRelay, type MCPServerConfig } from "../mcp-relay.service";
import type {
  MCPClientLike,
  MCPToolDescriptor,
} from "../mcp-relay-tool-adapter";

// ── Mock client factory ───────────────────────────────────────────────────────

function makeMockClientWithTools(tools: MCPToolDescriptor[]): MCPClientLike & {
  listTools: () => Promise<{ tools: MCPToolDescriptor[] }>;
  close?: () => Promise<void>;
} {
  return {
    callTool: jest.fn().mockResolvedValue({ content: "ok", isError: false }),
    listTools: jest.fn().mockResolvedValue({ tools }),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

function makeRegistryAndRelay() {
  const registry = new ToolRegistry();
  const relay = new MCPRelay(registry);
  return { registry, relay };
}

function makeConfig(
  id: string,
  extras?: Partial<MCPServerConfig>,
): MCPServerConfig {
  return {
    id,
    transport: { kind: "http", url: "http://localhost:8080/mcp" },
    ...extras,
  };
}

// Spy on the private `connect()` method to avoid real SDK import
function mockConnect(
  relay: MCPRelay,
  client: MCPClientLike & {
    listTools: () => Promise<{ tools: MCPToolDescriptor[] }>;
    close?: () => Promise<void>;
  },
) {
  return jest
    .spyOn(
      relay as unknown as {
        connect(config: MCPServerConfig): Promise<
          MCPClientLike & {
            listTools(): Promise<{ tools: MCPToolDescriptor[] }>;
            close?(): Promise<void>;
          }
        >;
      },
      "connect",
    )
    .mockResolvedValue(client);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MCPRelay — registerServer (full path via connect spy)", () => {
  it("registers new server, stores tools in ToolRegistry", async () => {
    const { registry, relay } = makeRegistryAndRelay();
    const tools: MCPToolDescriptor[] = [
      {
        name: "tool-a",
        description: "Tool A",
        inputSchema: { type: "object" },
      },
      {
        name: "tool-b",
        description: "Tool B",
        inputSchema: { type: "object" },
      },
    ];
    const mockClient = makeMockClientWithTools(tools);
    mockConnect(relay, mockClient);

    const result = await relay.registerServer(makeConfig("server-1"));

    expect(result.registered).toHaveLength(2);
    expect(result.registered).toContain("mcp:server-1/tool-a");
    expect(result.registered).toContain("mcp:server-1/tool-b");
    expect(result.skipped).toHaveLength(0);
    expect(registry.has("mcp:server-1/tool-a")).toBe(true);
    expect(registry.has("mcp:server-1/tool-b")).toBe(true);
  });

  it("re-registers existing server — calls unregisterServer first (line 73-74)", async () => {
    const { registry, relay } = makeRegistryAndRelay();

    // First registration
    const mockClient1 = makeMockClientWithTools([
      { name: "old-tool", inputSchema: { type: "object" } },
    ]);
    const connectSpy = mockConnect(relay, mockClient1);
    await relay.registerServer(makeConfig("srv-reregister"));

    expect(registry.has("mcp:srv-reregister/old-tool")).toBe(true);

    // Second registration with different tools
    const mockClient2 = makeMockClientWithTools([
      { name: "new-tool", inputSchema: { type: "object" } },
    ]);
    connectSpy.mockResolvedValue(mockClient2);

    await relay.registerServer(makeConfig("srv-reregister"));

    // old-tool should be removed, new-tool should be registered
    expect(registry.has("mcp:srv-reregister/old-tool")).toBe(false);
    expect(registry.has("mcp:srv-reregister/new-tool")).toBe(true);
  });

  it("skips excluded tools by exact string match (line 96-99)", async () => {
    const { registry, relay } = makeRegistryAndRelay();
    const tools: MCPToolDescriptor[] = [
      { name: "allowed-tool", inputSchema: { type: "object" } },
      { name: "excluded-tool", inputSchema: { type: "object" } },
    ];
    const mockClient = makeMockClientWithTools(tools);
    mockConnect(relay, mockClient);

    const result = await relay.registerServer(
      makeConfig("srv-exclude", { excludeTools: ["excluded-tool"] }),
    );

    expect(result.registered).toContain("mcp:srv-exclude/allowed-tool");
    expect(result.skipped).toContain("excluded-tool");
    expect(registry.has("mcp:srv-exclude/excluded-tool")).toBe(false);
  });

  it("skips excluded tools by regex match (isExcluded regex path)", async () => {
    const { registry: _registry, relay } = makeRegistryAndRelay();
    const tools: MCPToolDescriptor[] = [
      { name: "debug-info", inputSchema: { type: "object" } },
      { name: "prod-info", inputSchema: { type: "object" } },
    ];
    const mockClient = makeMockClientWithTools(tools);
    mockConnect(relay, mockClient);

    const result = await relay.registerServer(
      makeConfig("srv-regex", { excludeTools: [/^debug-.*/] }),
    );

    expect(result.skipped).toContain("debug-info");
    expect(result.registered).toContain("mcp:srv-regex/prod-info");
  });

  it("throws when listTools fails (lines 86-91)", async () => {
    const { relay } = makeRegistryAndRelay();
    const failingClient: MCPClientLike & {
      listTools: () => Promise<{ tools: MCPToolDescriptor[] }>;
      close?: () => Promise<void>;
    } = {
      callTool: jest.fn(),
      listTools: jest
        .fn()
        .mockRejectedValue(new Error("listTools network error")),
    };
    mockConnect(relay, failingClient);

    await expect(relay.registerServer(makeConfig("srv-fail"))).rejects.toThrow(
      "listTools network error",
    );
  });

  it("handles empty tools list from server", async () => {
    const { relay } = makeRegistryAndRelay();
    const mockClient = makeMockClientWithTools([]);
    mockConnect(relay, mockClient);

    const result = await relay.registerServer(makeConfig("srv-empty"));

    expect(result.registered).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("handles listTools returning no tools property (undefined)", async () => {
    const { relay } = makeRegistryAndRelay();
    const clientWithNoTools: MCPClientLike & {
      listTools: () => Promise<{ tools?: MCPToolDescriptor[] }>;
      close?: () => Promise<void>;
    } = {
      callTool: jest.fn(),
      listTools: jest.fn().mockResolvedValue({}), // no tools property
    };
    mockConnect(
      relay,
      clientWithNoTools as unknown as Parameters<typeof mockConnect>[1],
    );

    const result = await relay.registerServer(makeConfig("srv-notoolsprop"));

    expect(result.registered).toHaveLength(0);
  });
});

describe("MCPRelay — unregisterServer with registered tools (line 123)", () => {
  it("calls toolRegistry.unregister for each registered tool", async () => {
    const { registry, relay } = makeRegistryAndRelay();
    const tools: MCPToolDescriptor[] = [
      { name: "t1", inputSchema: { type: "object" } },
      { name: "t2", inputSchema: { type: "object" } },
    ];
    const mockClient = makeMockClientWithTools(tools);
    mockConnect(relay, mockClient);

    await relay.registerServer(makeConfig("srv-unreg"));
    expect(registry.has("mcp:srv-unreg/t1")).toBe(true);
    expect(registry.has("mcp:srv-unreg/t2")).toBe(true);

    await relay.unregisterServer("srv-unreg");

    expect(registry.has("mcp:srv-unreg/t1")).toBe(false);
    expect(registry.has("mcp:srv-unreg/t2")).toBe(false);
    expect(relay.listServers()).toHaveLength(0);
  });
});

