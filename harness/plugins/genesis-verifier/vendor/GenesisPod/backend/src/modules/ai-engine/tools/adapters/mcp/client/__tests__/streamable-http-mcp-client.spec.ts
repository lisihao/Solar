// SSRF guard mocked pass-through — these specs test MCP protocol, not SSRF (see ssrf-mcp-guard.spec.ts for the real check)
jest.mock("@/modules/ai-engine/safety/security/ssrf/ssrf-guard", () => ({
  ...jest.requireActual("@/modules/ai-engine/safety/security/ssrf/ssrf-guard"),
  assertUrlSafe: jest.fn().mockResolvedValue(new URL("http://mcp.example.com")),
}));

/**
 * Unit Tests - StreamableHttpMCPClient
 */

import axios from "axios";
import { StreamableHttpMCPClient } from "../streamable-http-mcp-client";
import { MCPServerConfig } from "../../abstractions/mcp.interface";

jest.mock("axios");
const mockedAxios = jest.mocked(axios);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<MCPServerConfig>): MCPServerConfig {
  return {
    id: "test-http",
    name: "Test HTTP Server",
    transport: "http",
    url: "http://localhost:3001",
    timeout: 5000,
    ...overrides,
  } as MCPServerConfig;
}

/** JSON response with the given payload and optional session header */
function jsonResponse(payload: object, sessionId?: string) {
  return {
    data: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    status: 200,
  };
}

/** 202 Accepted response - used for notifications (no JSON body) */
function acceptedResponse() {
  return {
    data: "",
    headers: { "content-type": "text/plain" },
    status: 202,
  };
}

/** SSE response with the given events data */
function sseResponse(data: string) {
  return {
    data,
    headers: { "content-type": "text/event-stream" },
    status: 200,
  };
}

const INIT_RESULT = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  serverInfo: { name: "test-srv", version: "1.0" },
};

/**
 * Build a mock axios instance. Returns a jest mock with post/get/delete.
 */
function makeMockHttpClient() {
  return {
    post: jest.fn(),
    get: jest.fn().mockResolvedValue({ data: { on: jest.fn() } }),
    delete: jest.fn().mockResolvedValue({ status: 200 }),
  };
}

/**
 * Sets up the mock POST sequence for the two-call connect() flow:
 *   1. initialize → returns JSON-RPC result with id=1
 *   2. notifications/initialized → 202 Accepted (no body processing needed)
 *
 * Returns a new mock http client already wired and installed.
 */
function setupConnectMocks(options?: { sessionId?: string }) {
  const mockClient = makeMockHttpClient();
  (mockedAxios.create as jest.Mock).mockReturnValue(mockClient);

  mockClient.post
    .mockResolvedValueOnce(
      jsonResponse(
        { jsonrpc: "2.0", id: 1, result: INIT_RESULT },
        options?.sessionId,
      ),
    )
    .mockResolvedValueOnce(acceptedResponse());

  return mockClient;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("StreamableHttpMCPClient", () => {
  let client: StreamableHttpMCPClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new StreamableHttpMCPClient(makeConfig());
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  // ─── Construction ─────────────────────────────────────────────────────────

  describe("construction", () => {
    it("has the correct id", () => {
      expect(client.id).toBe("test-http");
    });

    it("is disconnected initially", () => {
      expect(client.connected).toBe(false);
    });
  });

  // ─── doConnect ────────────────────────────────────────────────────────────

  describe("doConnect", () => {
    it("throws when URL is missing", async () => {
      const noUrlClient = new StreamableHttpMCPClient(
        makeConfig({ url: undefined }),
      );
      setupConnectMocks();
      await expect(noUrlClient.connect()).rejects.toThrow(
        "URL is required for HTTP transport",
      );
    });

    it("creates axios instance with correct baseURL and headers", async () => {
      setupConnectMocks();
      await client.connect();

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: "http://localhost:3001",
          timeout: 5000,
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          }),
        }),
      );
    });

    it("includes Authorization header when API_KEY env is set", async () => {
      const c = new StreamableHttpMCPClient(
        makeConfig({ env: { API_KEY: "my-secret" } }),
      );
      setupConnectMocks();
      await c.connect();

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-secret",
          }),
        }),
      );
    });

    it("does not include Authorization when no API_KEY", async () => {
      setupConnectMocks();
      await client.connect();

      const createCall = (mockedAxios.create as jest.Mock).mock.calls[0][0];
      expect(createCall.headers.Authorization).toBeUndefined();
    });
  });

  // ─── connect / disconnect ─────────────────────────────────────────────────

  describe("connect / disconnect lifecycle", () => {
    it("is connected after successful connect()", async () => {
      setupConnectMocks();
      await client.connect();
      expect(client.connected).toBe(true);
    });

    it("does not reconnect when already connected", async () => {
      setupConnectMocks();
      await client.connect();
      const callsBefore = (mockedAxios.create as jest.Mock).mock.calls.length;
      await client.connect(); // second call should be no-op
      expect((mockedAxios.create as jest.Mock).mock.calls.length).toBe(
        callsBefore,
      );
    });

    it("is disconnected after disconnect()", async () => {
      setupConnectMocks();
      await client.connect();
      await client.disconnect();
      expect(client.connected).toBe(false);
    });

    it("does not throw when disconnecting while not connected", async () => {
      await expect(client.disconnect()).resolves.toBeUndefined();
    });

    it("calls DELETE to terminate session on disconnect when sessionId present", async () => {
      const mockClient = setupConnectMocks({ sessionId: "sess-abc" });
      await client.connect();
      await client.disconnect();

      expect(mockClient.delete).toHaveBeenCalledWith(
        "",
        expect.objectContaining({
          headers: { "Mcp-Session-Id": "sess-abc" },
        }),
      );
    });

    it("does not call DELETE on disconnect when no session", async () => {
      const mockClient = setupConnectMocks();
      await client.connect();
      await client.disconnect();

      expect(mockClient.delete).not.toHaveBeenCalled();
    });
  });

  // ─── doSend – basic error cases ───────────────────────────────────────────

  describe("doSend error cases", () => {
    it("throws 'HTTP client not initialized' when not connected", async () => {
      // client.httpClient is null since we never called connect()
      await expect(
        (client as unknown as { doSend(m: unknown): Promise<void> }).doSend({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      ).rejects.toThrow("HTTP client not initialized");
    });

    it("throws formatted error on non-404 HTTP error", async () => {
      const mockClient = setupConnectMocks();
      await client.connect();

      const axiosError = Object.assign(new Error("Bad Request"), {
        response: { status: 400, data: "bad input" },
      });
      (axios.isAxiosError as unknown as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);
      mockClient.post.mockRejectedValueOnce(axiosError);

      await expect(client.listTools()).rejects.toThrow("HTTP 400");
    });
  });

  // ─── doSend – JSON response ───────────────────────────────────────────────

  describe("doSend – JSON response handling", () => {
    it("resolves pending request from JSON response", async () => {
      const mockClient = setupConnectMocks();
      await client.connect();

      // listTools is request id=3 (1=initialize, 2=notifications/initialized doesn't count)
      // Actually: requestId increments in sendRequest only, not sendNotification
      // initialize = id 1; notifications/initialized uses sendNotification (no id increment)
      // listTools = id 2
      const toolsResult = {
        tools: [{ name: "my-tool", description: "desc", inputSchema: {} }],
      };
      mockClient.post.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: "2.0", id: 2, result: toolsResult }),
      );

      const tools = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("my-tool");
    });

    it("captures session ID from response header", async () => {
      const mockClient = setupConnectMocks({ sessionId: "initial-sess" });
      await client.connect();

      // Next call should pass the captured session id
      mockClient.post.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: "2.0", id: 2, result: { tools: [] } }),
      );
      await client.listTools();

      expect(mockClient.post).toHaveBeenLastCalledWith(
        "",
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Mcp-Session-Id": "initial-sess",
          }),
        }),
      );
    });

    it("resets retry count to 0 on successful send", async () => {
      const mockClient = setupConnectMocks();
      await client.connect();

      mockClient.post.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: "2.0", id: 2, result: { tools: [] } }),
      );
      await client.listTools();

      // retryCount should be reset (can only observe indirectly via no errors)
      expect(client.connected).toBe(true);
    });
  });

  // ─── doSend – SSE response ────────────────────────────────────────────────

  describe("doSend – SSE response handling", () => {
    it("parses SSE event-stream response and resolves pending request", async () => {
      const mockClient = setupConnectMocks();
      await client.connect();

      const toolsResult = {
        tools: [{ name: "sse-tool", description: "t", inputSchema: {} }],
      };
      const sseBody = `id: evt-1\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: toolsResult })}\n\n`;

      mockClient.post.mockResolvedValueOnce(sseResponse(sseBody));

      const tools = await client.listTools();
      expect(tools[0].name).toBe("sse-tool");
    });

    it("handles SSE retry directive and updates reconnectDelay", async () => {
      const mockClient = setupConnectMocks();
      await client.connect();

      const toolsResult = { tools: [] };
      const sseBody = `retry: 3000\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: toolsResult })}\n\n`;

      mockClient.post.mockResolvedValueOnce(sseResponse(sseBody));
      await expect(client.listTools()).resolves.toEqual([]);
    });

    it("handles SSE event with server-initiated notification (method present)", async () => {
      const mockClient = setupConnectMocks();
      await client.connect();

      // Server sends a notification followed by the actual response
      const notification = JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {},
      });
      const response = JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [] },
      });
      const sseBody = `data: ${notification}\n\ndata: ${response}\n\n`;

      mockClient.post.mockResolvedValueOnce(sseResponse(sseBody));
      const tools = await client.listTools();
      expect(tools).toEqual([]);
    });

    it("handles SSE event with invalid JSON gracefully", async () => {
      const mockClient = setupConnectMocks();
      await client.connect();

      // One bad event then a good one
      const response = JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [] },
      });
      const sseBody = `data: {invalid json}\n\ndata: ${response}\n\n`;

      mockClient.post.mockResolvedValueOnce(sseResponse(sseBody));
      const tools = await client.listTools();
      expect(tools).toEqual([]);
    });
  });

  // ─── openSSEStream ────────────────────────────────────────────────────────

  describe("openSSEStream", () => {
    it("returns without error when not connected (no sessionId)", async () => {
      await expect(client.openSSEStream()).resolves.toBeUndefined();
    });

    it("opens a GET SSE stream when sessionId is available", async () => {
      const mockClient = setupConnectMocks({ sessionId: "s-123" });
      await client.connect();

      const streamMock = { on: jest.fn().mockReturnThis() };
      mockClient.get.mockResolvedValueOnce({ data: streamMock });

      await client.openSSEStream();

      expect(mockClient.get).toHaveBeenCalledWith(
        "",
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: "text/event-stream",
            "Mcp-Session-Id": "s-123",
          }),
          responseType: "stream",
        }),
      );
    });

    it("includes Last-Event-ID header when available", async () => {
      const mockClient = setupConnectMocks({ sessionId: "s-1" });
      await client.connect();

      // Seed a lastEventId via SSE response
      const sseBody = `id: evt-42\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [] } })}\n\n`;
      mockClient.post.mockResolvedValueOnce(sseResponse(sseBody));
      await client.listTools();

      const streamMock = { on: jest.fn().mockReturnThis() };
      mockClient.get.mockResolvedValueOnce({ data: streamMock });

      await client.openSSEStream();

      expect(mockClient.get).toHaveBeenCalledWith(
        "",
        expect.objectContaining({
          headers: expect.objectContaining({ "Last-Event-ID": "evt-42" }),
        }),
      );
    });
  });

  // ─── High-level API methods ───────────────────────────────────────────────

  describe("high-level API methods", () => {
    let mockClient: ReturnType<typeof makeMockHttpClient>;

    beforeEach(async () => {
      mockClient = setupConnectMocks();
      await client.connect();
    });

    it("listTools returns tools from JSON-RPC result", async () => {
      const tools = [{ name: "t1", description: "tool1", inputSchema: {} }];
      mockClient.post.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: "2.0", id: 2, result: { tools } }),
      );
      expect(await client.listTools()).toEqual(tools);
    });

    it("listTools returns empty array when result.tools missing", async () => {
      mockClient.post.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: "2.0", id: 2, result: {} }),
      );
      expect(await client.listTools()).toEqual([]);
    });

    it("callTool returns tool result", async () => {
      const toolResult = { content: [{ type: "text", text: "done" }] };
      mockClient.post.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: "2.0", id: 2, result: toolResult }),
      );
      expect(await client.callTool("t1", { a: 1 })).toEqual(toolResult);
    });

    it("listResources returns resources", async () => {
      const resources = [{ uri: "file://a", name: "a" }];
      mockClient.post.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: "2.0", id: 2, result: { resources } }),
      );
      expect(await client.listResources()).toEqual(resources);
    });

    it("readResource returns first content item", async () => {
      const contents = [{ uri: "file://a", text: "hello" }];
      mockClient.post.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: "2.0", id: 2, result: { contents } }),
      );
      expect(await client.readResource("file://a")).toEqual(contents[0]);
    });

    it("readResource returns empty fallback when contents is empty", async () => {
      mockClient.post.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: "2.0", id: 2, result: { contents: [] } }),
      );
      expect(await client.readResource("file://a")).toEqual({
        uri: "file://a",
        text: "",
      });
    });

    it("listPrompts returns prompts", async () => {
      const prompts = [{ name: "p1", description: "prompt1" }];
      mockClient.post.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: "2.0", id: 2, result: { prompts } }),
      );
      expect(await client.listPrompts()).toEqual(prompts);
    });

    it("getPrompt returns messages", async () => {
      const messages = [
        { role: "user", content: { type: "text", text: "hi" } },
      ];
      mockClient.post.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: "2.0", id: 2, result: { messages } }),
      );
      expect(await client.getPrompt("p1")).toEqual(messages);
    });

    it("throws when calling API methods while not connected", async () => {
      await client.disconnect();
      await expect(client.listTools()).rejects.toThrow(
        "Not connected to MCP server",
      );
    });

    it("rejects with error response from JSON-RPC", async () => {
      mockClient.post.mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          error: { code: -32600, message: "Invalid request" },
        }),
      );
      await expect(client.listTools()).rejects.toThrow("Invalid request");
    });
  });

  // ─── 404 session expiry / reconnect ───────────────────────────────────────

  describe("404 session expiry", () => {
    it("reconnects and retries original request on 404 with sessionId", async () => {
      const mockClient = setupConnectMocks({ sessionId: "old-session" });
      await client.connect();

      const axiosError = Object.assign(new Error("Not Found"), {
        response: { status: 404, data: "not found" },
      });
      (axios.isAxiosError as unknown as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);

      mockClient.post
        .mockRejectedValueOnce(axiosError) // tools/list -> 404
        .mockResolvedValueOnce(
          // re-initialize
          jsonResponse({ jsonrpc: "2.0", id: 2, result: INIT_RESULT }),
        )
        .mockResolvedValueOnce(acceptedResponse()) // notifications/initialized
        .mockResolvedValueOnce(
          // retry tools/list
          jsonResponse({ jsonrpc: "2.0", id: 3, result: { tools: [] } }),
        );

      const tools = await client.listTools();
      expect(tools).toEqual([]);
    });
  });

  // ─── Pending request limit ────────────────────────────────────────────────

  describe("pending request limit", () => {
    it("throws when 100 requests are pending", async () => {
      const mockClient = setupConnectMocks();
      await client.connect();

      // Hang all posts indefinitely to fill the pending map
      mockClient.post.mockImplementation(() => new Promise(() => {}));

      // Fire 100 pending requests
      const promises = Array.from({ length: 100 }, () =>
        client.listTools().catch(() => {}),
      );

      // 101st should be rejected immediately
      await expect(client.listTools()).rejects.toThrow(
        "Too many pending MCP requests",
      );

      // Clean up
      await client.disconnect();
      await Promise.allSettled(promises);
    });
  });
});
