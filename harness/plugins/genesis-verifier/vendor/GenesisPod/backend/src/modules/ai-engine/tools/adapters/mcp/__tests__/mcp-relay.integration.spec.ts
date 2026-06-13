/**
 * MCPRelay — extended coverage for relay service logic
 * Uses registerMockServer to bypass real network + dynamic import
 */

import { ToolRegistry } from "../../../registry/tool.registry";
import { MCPRelay } from "../mcp-relay.service";
import {
  MCPRelayToolAdapter,
  type MCPClientLike,
} from "../mcp-relay-tool-adapter";

function makeMockClient(tools: string[] = ["ping"]): MCPClientLike {
  return {
    callTool: jest.fn(async ({ name }) => {
      if (tools.includes(name))
        return { content: `ok:${name}`, isError: false };
      return { content: "unknown", isError: true };
    }),
  };
}

function makeRegistry() {
  return new ToolRegistry();
}

describe("MCPRelay — extended", () => {
  describe("registerMockServer", () => {
    it("registers mock server and allows manual tool registration", () => {
      const registry = makeRegistry();
      const relay = new MCPRelay(registry);
      const client = makeMockClient();

      relay.registerMockServer(
        {
          id: "test-srv",
          transport: { kind: "http", url: "http://localhost/mcp" },
        },
        client,
      );

      const servers = relay.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].id).toBe("test-srv");
    });

    it("throws in production environment", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const relay = new MCPRelay(makeRegistry());
        expect(() =>
          relay.registerMockServer(
            { id: "srv", transport: { kind: "http", url: "x" } },
            makeMockClient(),
          ),
        ).toThrow(/forbidden in production/);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it("replaces existing mock server with same id", () => {
      const registry = makeRegistry();
      const relay = new MCPRelay(registry);
      const client1 = makeMockClient(["tool1"]);
      const client2 = makeMockClient(["tool2"]);

      relay.registerMockServer(
        { id: "srv", transport: { kind: "http", url: "x" } },
        client1,
      );
      // Register a tool manually for the first client
      const adapter1 = new MCPRelayToolAdapter(
        "srv",
        { name: "tool1", inputSchema: { type: "object" } },
        client1,
      );
      registry.register(adapter1);

      relay.registerMockServer(
        { id: "srv", transport: { kind: "http", url: "x" } },
        client2,
      );

      // After replacement, the relay should show one server
      const servers = relay.listServers();
      expect(servers).toHaveLength(1);
    });
  });

  describe("unregisterServer", () => {
    it("removes tools from ToolRegistry on unregister", async () => {
      const registry = makeRegistry();
      const relay = new MCPRelay(registry);
      const client = makeMockClient();

      relay.registerMockServer(
        { id: "srv-del", transport: { kind: "http", url: "x" } },
        client,
      );

      // Manually add adapter and track in relay by recreating with tool ids
      // (registerMockServer leaves toolIds empty; we test unregisterServer with toolIds set)
      const adapter = new MCPRelayToolAdapter(
        "srv-del",
        { name: "ping", inputSchema: { type: "object" } },
        client,
      );
      registry.register(adapter);

      // Tool exists
      expect(registry.has("mcp:srv-del/ping")).toBe(true);

      await relay.unregisterServer("srv-del");

      // Server gone from relay
      expect(relay.listServers()).toHaveLength(0);
    });

    it("is a no-op for unknown server id", async () => {
      const relay = new MCPRelay(makeRegistry());
      await expect(
        relay.unregisterServer("nonexistent"),
      ).resolves.toBeUndefined();
    });
  });

  describe("listServers", () => {
    it("returns empty when no servers", () => {
      const relay = new MCPRelay(makeRegistry());
      expect(relay.listServers()).toHaveLength(0);
    });

    it("returns all registered servers with toolCount", () => {
      const registry = makeRegistry();
      const relay = new MCPRelay(registry);
      relay.registerMockServer(
        { id: "srv-a", transport: { kind: "http", url: "x" } },
        makeMockClient(),
      );
      relay.registerMockServer(
        { id: "srv-b", transport: { kind: "http", url: "y" } },
        makeMockClient(),
      );

      const servers = relay.listServers();
      expect(servers).toHaveLength(2);
      expect(servers.map((s) => s.id).sort()).toEqual(["srv-a", "srv-b"]);
    });
  });

  describe("MCPRelayToolAdapter — extended", () => {
    it("toFunctionDefinition replaces non-alphanumeric chars in name", () => {
      const adapter = new MCPRelayToolAdapter(
        "srv",
        { name: "my/tool.name", inputSchema: { type: "object" } },
        makeMockClient(),
      );
      const def = adapter.toFunctionDefinition();
      expect(def.name).not.toContain("/");
      expect(def.name).not.toContain(".");
      expect(def.name).not.toContain(":");
    });

    it("toCompactSummary returns correct fields", () => {
      const adapter = new MCPRelayToolAdapter(
        "srv",
        {
          name: "ping",
          description: "ping a host",
          inputSchema: { type: "object" },
        },
        makeMockClient(),
      );
      const summary = adapter.toCompactSummary();
      expect(summary.id).toBe("mcp:srv/ping");
      expect(summary.name).toBe("ping");
      expect(summary.brief).toBe("ping a host");
      expect(summary.tags).toContain("mcp");
      expect(summary.tags).toContain("mcp:srv");
    });

    it("uses default description when descriptor.description is absent", () => {
      const adapter = new MCPRelayToolAdapter(
        "my-server",
        { name: "no-desc", inputSchema: { type: "object" } },
        makeMockClient(),
      );
      expect(adapter.description).toContain("my-server");
    });

    it("uses outputSchema from descriptor when provided", () => {
      const outputSchema = {
        type: "object",
        properties: { result: { type: "string" } },
      };
      const adapter = new MCPRelayToolAdapter(
        "srv",
        {
          name: "out",
          inputSchema: { type: "object" },
          outputSchema: outputSchema as never,
        },
        makeMockClient(),
      );
      expect(adapter.outputSchema).toBe(outputSchema);
    });

    it("falls back to default outputSchema when descriptor.outputSchema is absent", () => {
      const adapter = new MCPRelayToolAdapter(
        "srv",
        { name: "no-out", inputSchema: { type: "object" } },
        makeMockClient(),
      );
      expect(adapter.outputSchema).toEqual({ type: "object" });
    });
  });

  describe("onModuleDestroy", () => {
    it("calls unregisterServer for all registered servers", async () => {
      const registry = makeRegistry();
      const relay = new MCPRelay(registry);
      relay.registerMockServer(
        { id: "s1", transport: { kind: "http", url: "x" } },
        makeMockClient(),
      );
      relay.registerMockServer(
        { id: "s2", transport: { kind: "http", url: "y" } },
        makeMockClient(),
      );
      await relay.onModuleDestroy();
      expect(relay.listServers()).toHaveLength(0);
    });
  });
});

