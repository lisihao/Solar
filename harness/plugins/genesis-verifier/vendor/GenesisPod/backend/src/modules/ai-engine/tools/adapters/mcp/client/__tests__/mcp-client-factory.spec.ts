// SSRF guard mocked pass-through — these specs test MCP protocol, not SSRF (see ssrf-mcp-guard.spec.ts for the real check)
jest.mock("@/modules/ai-engine/safety/security/ssrf/ssrf-guard", () => ({
  ...jest.requireActual("@/modules/ai-engine/safety/security/ssrf/ssrf-guard"),
  assertUrlSafe: jest.fn().mockResolvedValue(new URL("http://mcp.example.com")),
}));

/**
 * Unit tests for createMCPClient factory function
 */

import { createMCPClient } from "../mcp-client-factory";
import { StdioMCPClient } from "../mcp-client";
import { StreamableHttpMCPClient } from "../streamable-http-mcp-client";
import { SSEMCPClient } from "../sse-mcp-client";
import type { MCPServerConfig } from "../../abstractions/mcp.interface";

function makeConfig(
  transport: MCPServerConfig["transport"],
  overrides?: Partial<MCPServerConfig>,
): MCPServerConfig {
  return {
    id: "factory-test",
    name: "Factory Test Server",
    transport,
    command: "cmd",
    url: "http://localhost:3001",
    ...overrides,
  };
}

describe("createMCPClient (factory)", () => {
  it("should create a StdioMCPClient for stdio transport", () => {
    const client = createMCPClient(makeConfig("stdio"));
    expect(client).toBeInstanceOf(StdioMCPClient);
  });

  it("should create a StreamableHttpMCPClient for http transport", () => {
    const client = createMCPClient(makeConfig("http"));
    expect(client).toBeInstanceOf(StreamableHttpMCPClient);
  });

  it("should create an SSEMCPClient for sse transport", () => {
    const client = createMCPClient(makeConfig("sse"));
    expect(client).toBeInstanceOf(SSEMCPClient);
  });

  it("should throw for an unknown transport type", () => {
    const config = makeConfig("websocket" as any);
    expect(() => createMCPClient(config)).toThrow("Unknown transport");
  });

  it("created client should have the id from config", () => {
    const client = createMCPClient(
      makeConfig("stdio", { id: "my-stdio-server" }),
    );
    expect(client.id).toBe("my-stdio-server");
  });

  it("created clients should start disconnected", () => {
    const stdioClient = createMCPClient(makeConfig("stdio"));
    const httpClient = createMCPClient(makeConfig("http"));
    const sseClient = createMCPClient(makeConfig("sse"));

    expect(stdioClient.connected).toBe(false);
    expect(httpClient.connected).toBe(false);
    expect(sseClient.connected).toBe(false);
  });
});
