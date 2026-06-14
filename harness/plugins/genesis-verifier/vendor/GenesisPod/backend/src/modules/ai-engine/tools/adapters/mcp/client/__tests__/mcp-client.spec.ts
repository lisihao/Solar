// SSRF guard mocked pass-through — these specs test MCP protocol, not SSRF (see ssrf-mcp-guard.spec.ts for the real check)
jest.mock("@/modules/ai-engine/safety/security/ssrf/ssrf-guard", () => ({
  ...jest.requireActual("@/modules/ai-engine/safety/security/ssrf/ssrf-guard"),
  assertUrlSafe: jest.fn().mockResolvedValue(new URL("http://mcp.example.com")),
}));

/**
 * Unit tests for BaseMCPClient / StdioMCPClient
 *
 * All I/O (child_process spawn) is fully mocked so no real processes are spawned.
 */

import { StdioMCPClient } from "../mcp-client";
import type { MCPServerConfig } from "../../abstractions/mcp.interface";

// ----- mock child_process -----

const mockStdin = {
  write: jest.fn(),
  end: jest.fn(),
};

const mockStdout = {
  on: jest.fn(),
};

const mockStderr = {
  on: jest.fn(),
};

const mockProcess = {
  stdin: mockStdin,
  stdout: mockStdout,
  stderr: mockStderr,
  on: jest.fn(),
  kill: jest.fn(),
};

jest.mock("child_process", () => ({
  spawn: jest.fn(() => mockProcess),
}));

// ----- helpers -----

function makeConfig(overrides?: Partial<MCPServerConfig>): MCPServerConfig {
  return {
    id: "test-server",
    name: "Test MCP Server",
    transport: "stdio",
    command: "test-mcp",
    args: ["--arg"],
    timeout: 5000,
    ...overrides,
  };
}

/**
 * Manually trigger a JSON-RPC response on the mocked stdout so that a pending
 * sendRequest promise resolves.
 */
function flushResponse(
  client: StdioMCPClient,
  id: number,
  result: unknown,
): void {
  // Access the protected handleResponse method via the base class
  (client as any).handleResponse({ jsonrpc: "2.0", id, result });
}

/**
 * Helper that simulates a full connect cycle by directly manipulating internal
 * state instead of calling the real connect() flow (which requires a live
 * child process to respond to the "initialize" JSON-RPC request).
 */
function simulateConnected(c: StdioMCPClient): void {
  (c as any)._connected = true;
  (c as any).process = { stdin: mockStdin, kill: mockProcess.kill };
  (c as any)._serverInfo = {
    name: "mock-server",
    version: "1.0.0",
    protocolVersion: "2024-11-05",
    capabilities: {},
  };
}

// ----- tests -----

describe("StdioMCPClient (BaseMCPClient)", () => {
  let client: StdioMCPClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new StdioMCPClient(makeConfig());
  });

  // ── construction ──────────────────────────────────────────────────────────

  it("should initialise with id from config", () => {
    expect(client.id).toBe("test-server");
  });

  it("should start disconnected", () => {
    expect(client.connected).toBe(false);
  });

  it("should have no serverInfo before connect", () => {
    expect(client.serverInfo).toBeUndefined();
  });

  // ── connect ───────────────────────────────────────────────────────────────

  describe("connect", () => {
    it("should spawn a process with the correct command and args", async () => {
      const { spawn } = await import("child_process");

      // Start connect() – doConnect() will spawn the process and then call
      // initialize() which issues sendRequest("initialize", ...).
      // We need to flush the pending initialize request so connect() can settle.
      const connectPromise = client.connect();

      // Yield to allow doConnect + sendRequest registration to run
      await new Promise((r) => setImmediate(r));

      // The first pending request id is 1 (initialize)
      flushResponse(client, 1, {
        name: "test-server",
        version: "1.0.0",
        protocolVersion: "2024-11-05",
        capabilities: { tools: true },
      });

      // Allow the notification send + connected=true assignment to run
      await new Promise((r) => setImmediate(r));

      await connectPromise;

      expect(spawn).toHaveBeenCalledWith(
        "test-mcp",
        ["--arg"],
        expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
      );
      expect(client.connected).toBe(true);
    });

    it("should set serverInfo after successful connect", async () => {
      const serverInfoPayload = {
        name: "my-server",
        version: "2.0.0",
        protocolVersion: "2024-11-05",
        capabilities: {},
      };

      const connectPromise = client.connect();
      await new Promise((r) => setImmediate(r));
      flushResponse(client, 1, serverInfoPayload);
      await new Promise((r) => setImmediate(r));
      await connectPromise;

      expect(client.serverInfo).toMatchObject(serverInfoPayload);
    });

    it("should be idempotent (second connect is a no-op)", async () => {
      const { spawn } = await import("child_process");

      const p1 = client.connect();
      await new Promise((r) => setImmediate(r));
      flushResponse(client, 1, {
        name: "s",
        version: "1",
        protocolVersion: "p",
        capabilities: {},
      });
      await new Promise((r) => setImmediate(r));
      await p1;

      // Second connect while already connected – should be a no-op
      await client.connect();

      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it("should throw when command is not set", async () => {
      const noCommandClient = new StdioMCPClient(
        makeConfig({ command: undefined }),
      );
      await expect(noCommandClient.connect()).rejects.toThrow(
        "Command is required",
      );
    });
  });

  // ── disconnect ────────────────────────────────────────────────────────────

  describe("disconnect", () => {
    it("should kill the child process and mark as disconnected", async () => {
      simulateConnected(client);
      expect(client.connected).toBe(true);

      await client.disconnect();

      expect(mockProcess.kill).toHaveBeenCalled();
      expect(client.connected).toBe(false);
    });

    it("should reject all pending requests with 'Client disconnected'", async () => {
      simulateConnected(client);

      // Queue a pending request without resolving it
      const pendingPromise = (client as any).sendRequest("tools/list", {});
      // Don't flush – disconnect before the response arrives

      await client.disconnect();

      await expect(pendingPromise).rejects.toThrow("Client disconnected");
    });

    it("should be idempotent (disconnect when not connected is a no-op)", async () => {
      expect(client.connected).toBe(false);
      await expect(client.disconnect()).resolves.toBeUndefined();
    });
  });

  // ── ensureConnected ───────────────────────────────────────────────────────

  describe("ensureConnected guard", () => {
    it("should throw 'Not connected' when listTools is called without connect", async () => {
      await expect(client.listTools()).rejects.toThrow("Not connected");
    });

    it("should throw 'Not connected' when callTool is called without connect", async () => {
      await expect(client.callTool("myTool", {})).rejects.toThrow(
        "Not connected",
      );
    });

    it("should throw 'Not connected' when listResources is called without connect", async () => {
      await expect(client.listResources()).rejects.toThrow("Not connected");
    });

    it("should throw 'Not connected' when readResource is called without connect", async () => {
      await expect(client.readResource("file://test")).rejects.toThrow(
        "Not connected",
      );
    });

    it("should throw 'Not connected' when listPrompts is called without connect", async () => {
      await expect(client.listPrompts()).rejects.toThrow("Not connected");
    });

    it("should throw 'Not connected' when getPrompt is called without connect", async () => {
      await expect(client.getPrompt("myPrompt")).rejects.toThrow(
        "Not connected",
      );
    });
  });

  // ── sendRequest pending limit ─────────────────────────────────────────────

  describe("sendRequest pending limit", () => {
    it("should throw 'Too many pending' when 100 requests are already queued", async () => {
      // Force connected state
      (client as any)._connected = true;
      (client as any).process = { stdin: mockStdin };

      // Flood pending requests map without flushing them
      for (let i = 0; i < 100; i++) {
        (client as any).pendingRequests.set(i, {
          resolve: jest.fn(),
          reject: jest.fn(),
        });
      }

      await expect(
        (client as any).sendRequest("tools/list", {}),
      ).rejects.toThrow("Too many pending");
    });
  });

  // ── handleResponse ────────────────────────────────────────────────────────

  describe("handleResponse", () => {
    it("should resolve the matching pending request with the result", async () => {
      (client as any)._connected = true;
      (client as any).process = { stdin: mockStdin };

      // Manually queue a pending request
      const resultPromise = new Promise((resolve) => {
        (client as any).pendingRequests.set(42, { resolve, reject: jest.fn() });
      });

      (client as any).handleResponse({
        jsonrpc: "2.0",
        id: 42,
        result: { tools: [] },
      });

      await expect(resultPromise).resolves.toEqual({ tools: [] });
    });

    it("should reject the matching pending request when error is present", async () => {
      (client as any)._connected = true;

      const errPromise = new Promise((_, reject) => {
        (client as any).pendingRequests.set(99, { resolve: jest.fn(), reject });
      });

      (client as any).handleResponse({
        jsonrpc: "2.0",
        id: 99,
        error: { code: -32601, message: "Method not found" },
      });

      await expect(errPromise).rejects.toThrow("Method not found");
    });

    it("should be a no-op for unknown response IDs", () => {
      expect(() =>
        (client as any).handleResponse({
          jsonrpc: "2.0",
          id: 9999,
          result: {},
        }),
      ).not.toThrow();
    });
  });

  // ── listTools ─────────────────────────────────────────────────────────────

  describe("listTools", () => {
    it("should return the tools array from the server response", async () => {
      (client as any)._connected = true;
      (client as any).process = { stdin: mockStdin };

      const mockTools = [
        {
          name: "search",
          description: "Search the web",
          inputSchema: { type: "object", properties: {} },
        },
      ];

      const p = client.listTools();
      await Promise.resolve();
      flushResponse(client, (client as any).requestId, { tools: mockTools });

      await expect(p).resolves.toEqual(mockTools);
    });

    it("should return empty array when response has no tools field", async () => {
      (client as any)._connected = true;
      (client as any).process = { stdin: mockStdin };

      const p = client.listTools();
      await Promise.resolve();
      flushResponse(client, (client as any).requestId, {});

      await expect(p).resolves.toEqual([]);
    });
  });

  // ── callTool ──────────────────────────────────────────────────────────────

  describe("callTool", () => {
    it("should return the tool result from the server", async () => {
      (client as any)._connected = true;
      (client as any).process = { stdin: mockStdin };

      const mockResult = {
        content: [{ type: "text", text: "Hello" }],
        isError: false,
      };

      const p = client.callTool("search", { query: "test" });
      await Promise.resolve();
      flushResponse(client, (client as any).requestId, mockResult);

      await expect(p).resolves.toEqual(mockResult);
    });
  });

  // ── listResources ─────────────────────────────────────────────────────────

  describe("listResources", () => {
    it("should return resources array", async () => {
      (client as any)._connected = true;
      (client as any).process = { stdin: mockStdin };

      const mockResources = [{ uri: "file://test", name: "Test File" }];

      const p = client.listResources();
      await Promise.resolve();
      flushResponse(client, (client as any).requestId, {
        resources: mockResources,
      });

      await expect(p).resolves.toEqual(mockResources);
    });

    it("should return empty array when resources field is missing", async () => {
      (client as any)._connected = true;
      (client as any).process = { stdin: mockStdin };

      const p = client.listResources();
      await Promise.resolve();
      flushResponse(client, (client as any).requestId, {});

      await expect(p).resolves.toEqual([]);
    });
  });

  // ── readResource ──────────────────────────────────────────────────────────

  describe("readResource", () => {
    it("should return the first content item", async () => {
      (client as any)._connected = true;
      (client as any).process = { stdin: mockStdin };

      const mockContent = {
        uri: "file://test",
        text: "file content",
        mimeType: "text/plain",
      };

      const p = client.readResource("file://test");
      await Promise.resolve();
      flushResponse(client, (client as any).requestId, {
        contents: [mockContent],
      });

      await expect(p).resolves.toEqual(mockContent);
    });

    it("should return a fallback when contents is empty", async () => {
      (client as any)._connected = true;
      (client as any).process = { stdin: mockStdin };

      const p = client.readResource("file://empty");
      await Promise.resolve();
      flushResponse(client, (client as any).requestId, { contents: [] });

      await expect(p).resolves.toEqual({ uri: "file://empty", text: "" });
    });
  });

  // ── listPrompts ───────────────────────────────────────────────────────────

  describe("listPrompts", () => {
    it("should return prompts array", async () => {
      (client as any)._connected = true;
      (client as any).process = { stdin: mockStdin };

      const mockPrompts = [{ name: "greet", description: "Greeting prompt" }];

      const p = client.listPrompts();
      await Promise.resolve();
      flushResponse(client, (client as any).requestId, {
        prompts: mockPrompts,
      });

      await expect(p).resolves.toEqual(mockPrompts);
    });
  });

  // ── getPrompt ─────────────────────────────────────────────────────────────

  describe("getPrompt", () => {
    it("should return messages array", async () => {
      (client as any)._connected = true;
      (client as any).process = { stdin: mockStdin };

      const mockMessages = [
        { role: "user", content: { type: "text", text: "Hello!" } },
      ];

      const p = client.getPrompt("greet", { name: "World" });
      await Promise.resolve();
      flushResponse(client, (client as any).requestId, {
        messages: mockMessages,
      });

      await expect(p).resolves.toEqual(mockMessages);
    });
  });

  // ── request timeout ───────────────────────────────────────────────────────

  describe("request timeout", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should reject with timeout error when server does not respond", async () => {
      (client as any)._connected = true;
      (client as any).process = { stdin: mockStdin };

      const p = (client as any).sendRequest("tools/list", {});

      jest.advanceTimersByTime(6000); // past the 5000ms timeout

      await expect(p).rejects.toThrow("Request timeout: tools/list");
    });
  });

  // ── processBuffer ─────────────────────────────────────────────────────────

  describe("processBuffer (stdio parsing)", () => {
    it("should parse complete JSON-RPC responses from the buffer", () => {
      const response = { jsonrpc: "2.0", id: 77, result: { done: true } };
      const cb = jest.fn();
      (client as any).pendingRequests.set(77, {
        resolve: cb,
        reject: jest.fn(),
      });

      // Simulate receiving a full line on stdout
      (client as any).buffer = JSON.stringify(response) + "\n";
      (client as any).processBuffer();

      expect(cb).toHaveBeenCalledWith({ done: true });
    });

    it("should buffer incomplete lines and process them on next chunk", () => {
      const partial1 = '{"jsonrpc":"2.0","id":88,"result":{';
      const partial2 = '"data":"value"}}\n';

      const cb = jest.fn();
      (client as any).pendingRequests.set(88, {
        resolve: cb,
        reject: jest.fn(),
      });

      (client as any).buffer = partial1;
      (client as any).processBuffer();
      expect(cb).not.toHaveBeenCalled(); // not yet complete

      (client as any).buffer += partial2;
      (client as any).processBuffer();
      expect(cb).toHaveBeenCalledWith({ data: "value" });
    });

    it("should ignore lines with invalid JSON without throwing", () => {
      (client as any).buffer = "not-json\n";
      expect(() => (client as any).processBuffer()).not.toThrow();
    });

    it("should ignore responses without an id field", () => {
      // Notification messages have no id
      const notification = {
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
      };
      (client as any).buffer = JSON.stringify(notification) + "\n";
      expect(() => (client as any).processBuffer()).not.toThrow();
    });
  });
});
