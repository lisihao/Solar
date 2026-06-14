/**
 * Unit Tests - SSEMCPClient
 */

import axios from "axios";
import { EventEmitter } from "events";
import { SSEMCPClient } from "../sse-mcp-client";
import { MCPServerConfig } from "../../abstractions/mcp.interface";

jest.mock("axios");
const mockedAxios = jest.mocked(axios);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<MCPServerConfig>): MCPServerConfig {
  return {
    id: "test-sse",
    name: "Test SSE Server",
    transport: "sse",
    url: "http://localhost:3002/sse",
    timeout: 5000,
    ...overrides,
  } as MCPServerConfig;
}

/** SSE event block string */
function sseBlock(fields: {
  event?: string;
  data?: string;
  id?: string;
}): string {
  const lines: string[] = [];
  if (fields.id) lines.push(`id: ${fields.id}`);
  if (fields.event) lines.push(`event: ${fields.event}`);
  if (fields.data) lines.push(`data: ${fields.data}`);
  return lines.join("\n") + "\n\n";
}

/** SSE endpoint event */
function endpointEvent(url: string): string {
  return sseBlock({ event: "endpoint", data: url });
}

/** SSE JSON-RPC data event */
function dataEvent(payload: object): string {
  return sseBlock({ data: JSON.stringify(payload) });
}

const INIT_RESULT = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  serverInfo: { name: "sse-srv", version: "1.0" },
};

/**
 * Helper: creates a mock axios instance + stream that supports a full
 * SSE connect/initialize sequence.
 *
 * The stream will emit:
 *   1. endpoint event → resolves openSSEConnection
 *   2. JSON-RPC response for each pending request, in order, as POST is called
 *
 * Returns { mockClient, stream }.
 */
function buildSseSetup(endpoint = "/messages") {
  const stream = new EventEmitter();
  const mockClient = {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  };
  (mockedAxios.create as jest.Mock).mockReturnValue(mockClient);

  // GET opens the SSE stream
  mockClient.get.mockImplementation(() => {
    setImmediate(() => {
      stream.emit("data", Buffer.from(endpointEvent(endpoint)));
    });
    return Promise.resolve({ data: stream });
  });

  return { mockClient, stream };
}

/**
 * Wire a single POST call so that after the POST resolves 202,
 * the SSE stream emits the JSON-RPC response.
 */
function wireSseResponse(
  mockClient: { post: jest.Mock },
  stream: EventEmitter,
  responsePayload: object,
) {
  mockClient.post.mockImplementationOnce((_url: string, body: unknown) => {
    const msg = body as { id?: number };
    if (msg.id !== undefined) {
      // Emit the response via SSE after a tick
      setImmediate(() => {
        stream.emit("data", Buffer.from(dataEvent(responsePayload)));
      });
    }
    return Promise.resolve({ status: 202 });
  });
}

/**
 * Fully connects a client, returning the mockClient and stream.
 * Handles initialize + notifications/initialized automatically.
 */
async function fullyConnect(client: SSEMCPClient, endpoint = "/messages") {
  const { mockClient, stream } = buildSseSetup(endpoint);

  // initialize (id=1)
  wireSseResponse(mockClient, stream, {
    jsonrpc: "2.0",
    id: 1,
    result: INIT_RESULT,
  });
  // notifications/initialized has no id, POST just returns 202
  mockClient.post.mockImplementationOnce(() =>
    Promise.resolve({ status: 202 }),
  );

  await client.connect();
  return { mockClient, stream };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SSEMCPClient", () => {
  let client: SSEMCPClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new SSEMCPClient(makeConfig());
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  // ─── Construction ─────────────────────────────────────────────────────────

  describe("construction", () => {
    it("has the correct id", () => {
      expect(client.id).toBe("test-sse");
    });

    it("is disconnected initially", () => {
      expect(client.connected).toBe(false);
    });
  });

  // ─── doConnect / connect ──────────────────────────────────────────────────

  describe("connect", () => {
    it("is connected after successful connect()", async () => {
      await fullyConnect(client);
      expect(client.connected).toBe(true);
    });

    it("does not reconnect when already connected", async () => {
      await fullyConnect(client);
      const createCalls = (mockedAxios.create as jest.Mock).mock.calls.length;
      await client.connect(); // second call – no-op
      expect((mockedAxios.create as jest.Mock).mock.calls.length).toBe(
        createCalls,
      );
    });

    it("throws when URL is missing", async () => {
      const c = new SSEMCPClient(makeConfig({ url: undefined }));
      buildSseSetup();
      await expect(c.connect()).rejects.toThrow();
    });

    it("includes Authorization header when API_KEY is set", async () => {
      const c = new SSEMCPClient(
        makeConfig({ env: { API_KEY: "secret-123" } }),
      );
      const { mockClient, stream } = buildSseSetup();
      wireSseResponse(mockClient, stream, {
        jsonrpc: "2.0",
        id: 1,
        result: INIT_RESULT,
      });
      mockClient.post.mockImplementationOnce(() =>
        Promise.resolve({ status: 202 }),
      );

      await c.connect();

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer secret-123",
          }),
        }),
      );
    });
  });

  // ─── disconnect ───────────────────────────────────────────────────────────

  describe("disconnect", () => {
    it("is disconnected after disconnect()", async () => {
      await fullyConnect(client);
      await client.disconnect();
      expect(client.connected).toBe(false);
    });

    it("does not throw when disconnecting while not connected", async () => {
      await expect(client.disconnect()).resolves.toBeUndefined();
    });

    it("aborts the SSE stream on disconnect", async () => {
      const { stream } = await fullyConnect(client);
      const abortSpy = jest.spyOn(AbortController.prototype, "abort");
      await client.disconnect();
      expect(abortSpy).toHaveBeenCalled();
      abortSpy.mockRestore();
      // stream reference cleanup
      stream.removeAllListeners();
    });
  });

  // ─── doSend ───────────────────────────────────────────────────────────────

  describe("doSend", () => {
    it("throws when not connected (httpClient null)", async () => {
      await expect(
        (client as unknown as { doSend(m: unknown): Promise<void> }).doSend({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      ).rejects.toThrow(
        "SSE client not connected or message endpoint not discovered",
      );
    });

    it("throws formatted HTTP error on non-200 POST response", async () => {
      const { mockClient } = await fullyConnect(client);

      const axiosError = Object.assign(new Error("Service Unavailable"), {
        response: { status: 503, data: "down" },
      });
      (axios.isAxiosError as unknown as jest.Mock) = jest
        .fn()
        .mockReturnValue(true);
      mockClient.post.mockRejectedValueOnce(axiosError);

      await expect(client.listTools()).rejects.toThrow("HTTP 503");
    });
  });

  // ─── High-level API methods ───────────────────────────────────────────────

  describe("high-level API methods", () => {
    it("listTools returns tools via SSE response", async () => {
      const { mockClient, stream } = await fullyConnect(client);

      const tools = [{ name: "echo", description: "echoes", inputSchema: {} }];
      wireSseResponse(mockClient, stream, {
        jsonrpc: "2.0",
        id: 2,
        result: { tools },
      });

      expect(await client.listTools()).toEqual(tools);
    });

    it("callTool returns tool result via SSE response", async () => {
      const { mockClient, stream } = await fullyConnect(client);

      const toolResult = { content: [{ type: "text", text: "42" }] };
      wireSseResponse(mockClient, stream, {
        jsonrpc: "2.0",
        id: 2,
        result: toolResult,
      });

      expect(await client.callTool("echo", { input: "hello" })).toEqual(
        toolResult,
      );
    });

    it("listResources returns resources", async () => {
      const { mockClient, stream } = await fullyConnect(client);

      const resources = [{ uri: "file://data.txt", name: "data" }];
      wireSseResponse(mockClient, stream, {
        jsonrpc: "2.0",
        id: 2,
        result: { resources },
      });

      expect(await client.listResources()).toEqual(resources);
    });

    it("readResource returns first content", async () => {
      const { mockClient, stream } = await fullyConnect(client);

      const contents = [{ uri: "file://a.txt", text: "content" }];
      wireSseResponse(mockClient, stream, {
        jsonrpc: "2.0",
        id: 2,
        result: { contents },
      });

      expect(await client.readResource("file://a.txt")).toEqual(contents[0]);
    });

    it("listPrompts returns prompts", async () => {
      const { mockClient, stream } = await fullyConnect(client);

      const prompts = [{ name: "summarize", description: "Summarizes text" }];
      wireSseResponse(mockClient, stream, {
        jsonrpc: "2.0",
        id: 2,
        result: { prompts },
      });

      expect(await client.listPrompts()).toEqual(prompts);
    });

    it("getPrompt returns messages", async () => {
      const { mockClient, stream } = await fullyConnect(client);

      const messages = [
        { role: "user", content: { type: "text", text: "Summarize this" } },
      ];
      wireSseResponse(mockClient, stream, {
        jsonrpc: "2.0",
        id: 2,
        result: { messages },
      });

      expect(await client.getPrompt("summarize")).toEqual(messages);
    });

    it("throws when calling API methods while not connected", async () => {
      await expect(client.listTools()).rejects.toThrow(
        "Not connected to MCP server",
      );
    });

    it("rejects pending request on JSON-RPC error response", async () => {
      const { mockClient, stream } = await fullyConnect(client);

      wireSseResponse(mockClient, stream, {
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32601, message: "Method not found" },
      });

      await expect(client.listTools()).rejects.toThrow("Method not found");
    });
  });

  // ─── Endpoint resolution ──────────────────────────────────────────────────

  describe("endpoint resolution", () => {
    it("uses absolute endpoint URL unchanged", async () => {
      const c = new SSEMCPClient(makeConfig());
      const { mockClient, stream } = buildSseSetup(
        "http://other.host/api/messages",
      );

      wireSseResponse(mockClient, stream, {
        jsonrpc: "2.0",
        id: 1,
        result: INIT_RESULT,
      });
      mockClient.post.mockImplementationOnce(() =>
        Promise.resolve({ status: 202 }),
      );

      await c.connect();

      // Trigger a call that goes to the endpoint
      wireSseResponse(mockClient, stream, {
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [] },
      });
      await c.listTools();

      const postCalls = mockClient.post.mock.calls;
      // All post calls after the first 2 (init + notify) should use absolute URL
      expect(postCalls[2][0]).toBe("http://other.host/api/messages");
    });

    it("resolves relative endpoint against base URL", async () => {
      const c = new SSEMCPClient(
        makeConfig({ url: "http://localhost:3002/sse" }),
      );
      const { mockClient, stream } = buildSseSetup("/api/messages");

      wireSseResponse(mockClient, stream, {
        jsonrpc: "2.0",
        id: 1,
        result: INIT_RESULT,
      });
      mockClient.post.mockImplementationOnce(() =>
        Promise.resolve({ status: 202 }),
      );

      await c.connect();

      wireSseResponse(mockClient, stream, {
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [] },
      });
      await c.listTools();

      const postCalls = mockClient.post.mock.calls;
      expect(postCalls[2][0]).toBe("http://localhost:3002/api/messages");
    });
  });

  // ─── SSE connection timeout ───────────────────────────────────────────────

  describe("SSE connection timeout", () => {
    it("rejects with timeout error when endpoint event never arrives", async () => {
      jest.useFakeTimers();

      const stream = new EventEmitter();
      const mockClient = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
      (mockedAxios.create as jest.Mock).mockReturnValue(mockClient);

      mockClient.get.mockResolvedValue({ data: stream }); // never emits endpoint

      const connectPromise = client.connect();
      jest.advanceTimersByTime(6000);

      await expect(connectPromise).rejects.toThrow("SSE connection timeout");
      jest.useRealTimers();
    });
  });

  // ─── SSE stream error handling ────────────────────────────────────────────

  describe("SSE stream error handling", () => {
    it("rejects connect() on stream error before endpoint is received", async () => {
      const stream = new EventEmitter();
      const mockClient = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
      (mockedAxios.create as jest.Mock).mockReturnValue(mockClient);

      mockClient.get.mockImplementation(() => {
        setImmediate(() => {
          stream.emit("error", new Error("Network reset"));
        });
        return Promise.resolve({ data: stream });
      });

      await expect(client.connect()).rejects.toThrow("Network reset");
    });

    it("sets _connected to false when SSE stream ends", async () => {
      const { stream } = await fullyConnect(client);
      expect(client.connected).toBe(true);

      stream.emit("end");

      // Give the event loop a tick
      await new Promise((r) => setImmediate(r));
      expect(client.connected).toBe(false);
    });

    it("does not reject when error is AbortError (normal disconnect)", async () => {
      const stream = new EventEmitter();
      const mockClient = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
      (mockedAxios.create as jest.Mock).mockReturnValue(mockClient);

      let resolveConnect!: () => void;
      const connectHold = new Promise<void>((r) => (resolveConnect = r));

      mockClient.get.mockImplementation(() => {
        setImmediate(() => {
          stream.emit("data", Buffer.from(endpointEvent("/messages")));
          resolveConnect();
        });
        return Promise.resolve({ data: stream });
      });

      const { mockClient: mockClient2, stream: stream2 } = buildSseSetup();
      // Use original mockClient for first connection
      (mockedAxios.create as jest.Mock).mockReturnValue(mockClient);

      wireSseResponse(mockClient, stream, {
        jsonrpc: "2.0",
        id: 1,
        result: INIT_RESULT,
      });
      mockClient.post.mockImplementationOnce(() =>
        Promise.resolve({ status: 202 }),
      );

      // connectHold synchronization
      const connectPromise = client.connect();
      await connectHold;
      await connectPromise.catch(() => {});

      // Emit AbortError - should not crash
      const abortErr = new Error("AbortError");
      abortErr.name = "AbortError";
      expect(() => stream.emit("error", abortErr)).not.toThrow();

      stream2.removeAllListeners();
      mockClient2.get.mockReset();
    });
  });

  // ─── Chunked SSE data ─────────────────────────────────────────────────────

  describe("SSE buffer chunking", () => {
    it("handles data arriving in multiple chunks after connect", async () => {
      const { mockClient, stream } = await fullyConnect(client);

      // Send a listTools response in two chunks
      const response = JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: [] },
      });
      const fullEvent = `data: ${response}\n\n`;
      const half = Math.floor(fullEvent.length / 2);

      mockClient.post.mockImplementationOnce(() => {
        setImmediate(() => {
          stream.emit("data", Buffer.from(fullEvent.slice(0, half)));
          stream.emit("data", Buffer.from(fullEvent.slice(half)));
        });
        return Promise.resolve({ status: 202 });
      });

      const tools = await client.listTools();
      expect(tools).toEqual([]);
    });
  });
});
