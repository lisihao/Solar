// SSRF guard mocked pass-through — these specs test MCP protocol, not SSRF (see ssrf-mcp-guard.spec.ts for the real check)
jest.mock("@/modules/ai-engine/safety/security/ssrf/ssrf-guard", () => ({
  ...jest.requireActual("@/modules/ai-engine/safety/security/ssrf/ssrf-guard"),
  assertUrlSafe: jest.fn().mockResolvedValue(new URL("http://mcp.example.com")),
}));

/**
 * StreamableHttpMCPClient — extra branch coverage
 *
 * Targets uncovered lines not hit by streamable-http-mcp-client.spec.ts:
 * - doDisconnect: pendingRequests rejection (line 64)
 * - doDisconnect: sseAbortController.abort (lines 70-71)
 * - doDisconnect: clearTimeout reconnectTimer (lines 75-76)
 * - doSend: session expired 404 → handleReconnect (line 148)
 * - doSend: throw non-axios error (line 155)
 * - openSSEStream: data/end/error event handlers (lines 187-213)
 * - handleSSEEvent: event.retry path (line 241)
 * - parseSSEBuffer: retry: line (line 295)
 * - scheduleReconnect (lines 315-340)
 * - handleReconnect: max retries exceeded (line 350)
 * - handleReconnect: initialize fails → catch (lines 358-364)
 */

import axios from "axios";
import { EventEmitter } from "events";
import { StreamableHttpMCPClient } from "../streamable-http-mcp-client";
import type { MCPServerConfig } from "../../abstractions/mcp.interface";

jest.mock("axios");
const mockedAxios = jest.mocked(axios);

function makeConfig(overrides?: Partial<MCPServerConfig>): MCPServerConfig {
  return {
    id: "test-extra",
    name: "Test Extra HTTP Server",
    transport: "http",
    url: "http://localhost:3002",
    timeout: 5000,
    ...overrides,
  } as MCPServerConfig;
}

const INIT_RESULT = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  serverInfo: { name: "test-srv", version: "1.0" },
};

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

function acceptedResponse() {
  return {
    data: "",
    headers: { "content-type": "text/plain" },
    status: 202,
  };
}

function makeMockHttpClient() {
  return {
    post: jest.fn(),
    get: jest.fn().mockResolvedValue({ data: { on: jest.fn() } }),
    delete: jest.fn().mockResolvedValue({ status: 200 }),
  };
}

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

// Type alias for private access
type PrivateClient = {
  pendingRequests: Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >;
  sseAbortController: AbortController | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  httpClient: unknown;
  sessionId: string | null;
  retryCount: number;
  maxRetries: number;
  reconnectDelay: number;
  doDisconnect(): Promise<void>;
  doSend(msg: unknown): Promise<void>;
  handleReconnect(msg: unknown): Promise<void>;
  scheduleReconnect(): void;
  handleSSEEvent(event: {
    id?: string;
    event?: string;
    data: string;
    retry?: number;
  }): void;
};

describe("StreamableHttpMCPClient — doDisconnect extra branches", () => {
  let client: StreamableHttpMCPClient;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    client = new StreamableHttpMCPClient(makeConfig());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("rejects pending requests when doDisconnect is called directly", async () => {
    const priv = client as unknown as PrivateClient;

    // Manually inject a pending request
    const rejected: Error[] = [];
    priv.pendingRequests.set(42, {
      resolve: jest.fn(),
      reject: (err) => rejected.push(err),
    });
    // Also set a mock httpClient so delete doesn't fail
    priv.httpClient = null; // no sessionId, so delete is skipped

    await priv.doDisconnect();

    expect(rejected).toHaveLength(1);
    expect(rejected[0].message).toBe("Client disconnecting");
  });

  it("aborts sseAbortController when doDisconnect is called with one set", async () => {
    const priv = client as unknown as PrivateClient;
    const abortController = new AbortController();
    const abortSpy = jest.spyOn(abortController, "abort");
    priv.sseAbortController = abortController;

    await priv.doDisconnect();

    expect(abortSpy).toHaveBeenCalled();
    expect(priv.sseAbortController).toBeNull();
  });

  it("clears reconnectTimer when doDisconnect is called with timer set", async () => {
    const priv = client as unknown as PrivateClient;
    // Set a fake timer
    const timer = setTimeout(() => {
      // dummy
    }, 60000);
    priv.reconnectTimer = timer;

    await priv.doDisconnect();

    expect(priv.reconnectTimer).toBeNull();
  });
});

// ── doSend: 404 session expired → handleReconnect ────────────────────────────

describe("StreamableHttpMCPClient — doSend session expired (404)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls handleReconnect when server returns 404 with active sessionId", async () => {
    const mockClient = setupConnectMocks({ sessionId: "sess-xyz" });
    const client = new StreamableHttpMCPClient(makeConfig());
    await client.connect();

    const priv = client as unknown as PrivateClient;

    // Spy on handleReconnect to verify it's called
    const handleReconnectSpy = jest
      .spyOn(
        priv as unknown as { handleReconnect(m: unknown): Promise<void> },
        "handleReconnect",
      )
      .mockResolvedValue(undefined);

    const axiosError = Object.assign(new Error("Not Found"), {
      response: { status: 404, data: "session not found" },
      isAxiosError: true,
    });
    (axios.isAxiosError as unknown as jest.Mock) = jest
      .fn()
      .mockReturnValue(true);
    mockClient.post.mockRejectedValueOnce(axiosError);

    // doSend: when 404 and sessionId set → calls handleReconnect
    await priv.doSend({ jsonrpc: "2.0", id: 99, method: "tools/list" });
    expect(handleReconnectSpy).toHaveBeenCalled();
  });

  it("throws non-axios error directly from doSend", async () => {
    const mockClient = setupConnectMocks();
    const client = new StreamableHttpMCPClient(makeConfig());
    await client.connect();

    const priv = client as unknown as PrivateClient;

    // Non-axios error: not a known AxiosError
    const genericError = new Error("Network timeout");
    (axios.isAxiosError as unknown as jest.Mock) = jest
      .fn()
      .mockReturnValue(false);
    mockClient.post.mockRejectedValueOnce(genericError);

    await expect(
      priv.doSend({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    ).rejects.toThrow("Network timeout");
  });
});

// ── openSSEStream: stream event handlers ────────────────────────────────────

describe("StreamableHttpMCPClient — openSSEStream event handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("processes data events from SSE stream", async () => {
    const mockClient = setupConnectMocks({ sessionId: "s-data" });
    const client = new StreamableHttpMCPClient(makeConfig());
    await client.connect();

    // Create a real EventEmitter to simulate the stream
    const streamEmitter = new EventEmitter();
    mockClient.get.mockResolvedValueOnce({ data: streamEmitter });

    // Open SSE stream (registers event handlers)
    const openPromise = client.openSSEStream();

    // Emit a data chunk containing a valid SSE event with a JSON-RPC notification
    const notification = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/ping",
      params: {},
    });
    streamEmitter.emit("data", Buffer.from(`data: ${notification}\n\n`));

    await openPromise;
    // No errors thrown — data handler ran
    expect(mockClient.get).toHaveBeenCalledTimes(1);
  });

  it("schedules reconnect on stream 'end' event when connected", async () => {
    const mockClient = setupConnectMocks({ sessionId: "s-end" });
    const client = new StreamableHttpMCPClient(makeConfig());
    await client.connect();

    // Make the client appear connected internally
    const priv = client as unknown as PrivateClient & { _connected: boolean };
    priv._connected = true;

    const scheduleReconnectSpy = jest
      .spyOn(
        priv as unknown as { scheduleReconnect(): void },
        "scheduleReconnect",
      )
      .mockImplementation(() => {
        // no-op to avoid timer leaks
      });

    const streamEmitter = new EventEmitter();
    mockClient.get.mockResolvedValueOnce({ data: streamEmitter });

    // Start openSSEStream — it awaits the GET then registers handlers
    const openPromise = client.openSSEStream();
    // Wait for the GET to resolve and handlers to be registered
    await Promise.resolve();
    await Promise.resolve();
    // Now emit the 'end' event (handlers are registered)
    streamEmitter.emit("end");
    await openPromise;

    expect(scheduleReconnectSpy).toHaveBeenCalled();
  });

  it("schedules reconnect on stream 'error' event when connected (non-AbortError)", async () => {
    const mockClient = setupConnectMocks({ sessionId: "s-err" });
    const client = new StreamableHttpMCPClient(makeConfig());
    await client.connect();

    const priv = client as unknown as PrivateClient & { _connected: boolean };
    priv._connected = true;

    const scheduleReconnectSpy = jest
      .spyOn(
        priv as unknown as { scheduleReconnect(): void },
        "scheduleReconnect",
      )
      .mockImplementation(() => {
        // no-op
      });

    const streamEmitter = new EventEmitter();
    mockClient.get.mockResolvedValueOnce({ data: streamEmitter });

    const openPromise = client.openSSEStream();
    // Wait for handlers to be registered
    await Promise.resolve();
    await Promise.resolve();
    const streamError = new Error("Stream broken");
    streamEmitter.emit("error", streamError);
    await openPromise;

    expect(scheduleReconnectSpy).toHaveBeenCalled();
  });

  it("does NOT schedule reconnect on AbortError from stream", async () => {
    const mockClient = setupConnectMocks({ sessionId: "s-abort" });
    const client = new StreamableHttpMCPClient(makeConfig());
    await client.connect();

    const priv = client as unknown as PrivateClient & { _connected: boolean };
    priv._connected = true;

    const scheduleReconnectSpy = jest
      .spyOn(
        priv as unknown as { scheduleReconnect(): void },
        "scheduleReconnect",
      )
      .mockImplementation(() => {
        // no-op
      });

    const streamEmitter = new EventEmitter();
    mockClient.get.mockResolvedValueOnce({ data: streamEmitter });

    const openPromise = client.openSSEStream();
    // Wait for handlers to be registered
    await Promise.resolve();
    await Promise.resolve();
    const abortError = Object.assign(new Error("Aborted"), {
      name: "AbortError",
    });
    streamEmitter.emit("error", abortError);
    await openPromise;

    expect(scheduleReconnectSpy).not.toHaveBeenCalled();
  });

  it("handles GET rejection in openSSEStream gracefully when non-AbortError", async () => {
    const mockClient = setupConnectMocks({ sessionId: "s-getfail" });
    const client = new StreamableHttpMCPClient(makeConfig());
    await client.connect();

    const getError = new Error("GET request failed");
    mockClient.get.mockRejectedValueOnce(getError);

    // Should not throw — error is caught and logged
    await expect(client.openSSEStream()).resolves.toBeUndefined();
  });
});

// ── handleSSEEvent: event.retry path ─────────────────────────────────────────

describe("StreamableHttpMCPClient — handleSSEEvent retry", () => {
  it("updates reconnectDelay from SSE retry directive", () => {
    const client = new StreamableHttpMCPClient(makeConfig());
    const priv = client as unknown as PrivateClient;

    priv.handleSSEEvent({
      data: "", // empty data → returns early without JSON parse
      retry: 5000,
    });

    expect(priv.reconnectDelay).toBe(5000);
  });
});

// ── parseSSEBuffer: retry: line ───────────────────────────────────────────────

describe("StreamableHttpMCPClient — parseSSEBuffer retry line", () => {
  it("parses retry field from SSE buffer via handleSSEEvent", () => {
    const client = new StreamableHttpMCPClient(makeConfig());
    const priv = client as unknown as PrivateClient;

    // Initial reconnectDelay is 1000
    expect(priv.reconnectDelay).toBe(1000);

    // handleSSEEvent with retry should update reconnectDelay
    // This also covers the parseSSEBuffer `retry:` line indirectly
    // since processSSEData → handleSSEEvent carries the parsed retry value
    priv.handleSSEEvent({ data: "some-data", retry: 9000 });

    // reconnectDelay updated to 9000 (but the data parse may fail since it's not JSON)
    // The retry is set before the data parse attempt
    expect(priv.reconnectDelay).toBe(9000);
  });

  it("parseSSEBuffer handles retry: line in raw SSE text", async () => {
    const mockClient = setupConnectMocks();
    const client = new StreamableHttpMCPClient(makeConfig());
    await client.connect();

    const priv = client as unknown as PrivateClient;

    // Spy on handleSSEEvent to capture what retry value was parsed
    const handleSSESpy = jest.spyOn(
      priv as unknown as {
        handleSSEEvent(e: { retry?: number; data: string }): void;
      },
      "handleSSEEvent",
    );

    const toolsResult = { tools: [] };
    const sseBody = `retry: 4200\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: toolsResult })}\n\n`;

    mockClient.post.mockResolvedValueOnce({
      data: sseBody,
      headers: { "content-type": "text/event-stream" },
      status: 200,
    });

    await client.listTools();

    // handleSSEEvent should have been called with parsed retry=4200
    const callArgs = handleSSESpy.mock.calls[0]?.[0];
    expect(callArgs?.retry).toBe(4200);
  });
});

// ── scheduleReconnect ─────────────────────────────────────────────────────────

describe("StreamableHttpMCPClient — scheduleReconnect", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("schedules a reconnect timer and increments retryCount", () => {
    const client = new StreamableHttpMCPClient(makeConfig());
    const priv = client as unknown as PrivateClient;

    // Spy on openSSEStream to avoid actual network calls
    jest.spyOn(client, "openSSEStream").mockResolvedValue(undefined);

    priv.scheduleReconnect();

    expect(priv.retryCount).toBe(1);
    expect(priv.reconnectTimer).not.toBeNull();

    // Advance fake timers to trigger the setTimeout callback
    jest.runAllTimers();

    expect(client.openSSEStream).toHaveBeenCalled();
  });

  it("logs error and returns when max retries exceeded", () => {
    const client = new StreamableHttpMCPClient(makeConfig());
    const priv = client as unknown as PrivateClient;

    // Set retryCount to maxRetries
    priv.retryCount = priv.maxRetries;

    jest.spyOn(client, "openSSEStream").mockResolvedValue(undefined);

    priv.scheduleReconnect();

    // Should NOT schedule a timer when max retries are exhausted
    expect(priv.reconnectTimer).toBeNull();
    expect(client.openSSEStream).not.toHaveBeenCalled();
  });
});

// ── handleReconnect: max retries + catch ─────────────────────────────────────

describe("StreamableHttpMCPClient — handleReconnect", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws when max retries exceeded in handleReconnect", async () => {
    const client = new StreamableHttpMCPClient(makeConfig());
    const priv = client as unknown as PrivateClient;

    priv.retryCount = priv.maxRetries; // Already at max

    await expect(
      priv.handleReconnect({ method: "tools/list" }),
    ).rejects.toThrow("Max reconnect retries reached");
  });

  it("wraps initialize error in handleReconnect catch", async () => {
    const mockClient = setupConnectMocks({ sessionId: "sess-reconnect" });
    const client = new StreamableHttpMCPClient(makeConfig());
    await client.connect();

    const priv = client as unknown as PrivateClient;

    // Make initialize() fail by rejecting the next POST
    mockClient.post.mockRejectedValueOnce(
      new Error("Init failed during reconnect"),
    );

    // retryCount is 0 so it passes the max check
    await expect(
      priv.handleReconnect({ method: "tools/list" }),
    ).rejects.toThrow("Reconnect failed: Init failed during reconnect");
  });
});
