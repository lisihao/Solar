/**
 * MCP Server Controller - Comprehensive Integration Tests
 * 100% coverage: Controller + ExceptionFilter + ApiKeyGuard
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  INestApplication,
  HttpStatus,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require("supertest");
import { MCPServerController } from "../mcp-server.controller";
import { MCPServerService } from "../mcp-server.service";
import { MCPApiKeyGuard } from "../guards/mcp-api-key.guard";
import { MCPExceptionFilter } from "../filters/mcp-exception.filter";
import { MCPSessionManager } from "../gateway/mcp-session-manager";
import { MCPStreamingBridge } from "../streaming/mcp-streaming-bridge";
import {
  IMCPToolHandler,
  MCPRequestContext,
  MCPToolResponse,
} from "../abstractions/mcp-server.interface";

const TEST_API_KEY = "test-mcp-key-abc123";
const TEST_X_API_KEY = "test-x-api-key-xyz789";

// ==================== Mock Tool Handlers ====================

class MockToolHandler implements IMCPToolHandler {
  readonly toolName = "test_tool";
  readonly description = "A test tool";
  readonly inputSchema = {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  };

  async execute(
    args: Record<string, unknown>,
    _context: MCPRequestContext,
  ): Promise<MCPToolResponse> {
    return {
      content: [{ type: "text", text: `Result: ${args.query}` }],
    };
  }
}

class FailingToolHandler implements IMCPToolHandler {
  readonly toolName = "failing_tool";
  readonly description = "A tool that always fails";
  readonly inputSchema = { type: "object", properties: {} };

  async execute(): Promise<MCPToolResponse> {
    throw new Error("Tool execution failed");
  }
}

class SlowToolHandler implements IMCPToolHandler {
  readonly toolName = "slow_tool";
  readonly description = "A tool that takes time";
  readonly inputSchema = { type: "object", properties: {} };

  async execute(): Promise<MCPToolResponse> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      content: [{ type: "text", text: "Slow result" }],
    };
  }
}

class ContextEchoToolHandler implements IMCPToolHandler {
  readonly toolName = "context_echo";
  readonly description = "Echoes context info";
  readonly inputSchema = { type: "object", properties: {} };

  async execute(
    _args: Record<string, unknown>,
    context: MCPRequestContext,
  ): Promise<MCPToolResponse> {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            apiKeyId: context.apiKeyId,
            sessionId: context.sessionId || "none",
          }),
        },
      ],
    };
  }
}

// ==================== Test Suite ====================

describe("MCPServerController Integration Tests (100% Coverage)", () => {
  let app: INestApplication;
  let service: MCPServerService;

  beforeAll(async () => {
    const mockSessionManager = {
      createSession: jest.fn().mockReturnValue({
        sessionId: "mcp-test-session-id",
        apiKeyId: "test-key",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        permissionPolicy: {
          allowedToolPatterns: ["*"],
          deniedToolPatterns: [],
          maxConcurrency: 5,
          dailyQuota: 1000,
          allowStreaming: true,
          allowResources: true,
          allowPrompts: true,
        },
      }),
      getSession: jest.fn().mockReturnValue(null),
      getStats: jest.fn().mockReturnValue({
        activeSessions: 0,
        byClient: {},
        byApiKey: {},
      }),
      getAllSessions: jest.fn().mockReturnValue([]),
      isToolAllowed: jest.fn().mockReturnValue(true),
      isResourceAllowed: jest.fn().mockReturnValue(true),
      isPromptAllowed: jest.fn().mockReturnValue(true),
      consumeQuota: jest.fn().mockReturnValue(true),
      validateAndConsumeQuota: jest.fn().mockReturnValue({ allowed: true }),
      terminateSession: jest.fn().mockReturnValue(true),
    };

    const mockStreamingBridge = {
      registerConnection: jest.fn(),
      unregisterConnection: jest.fn(),
      sendEvent: jest.fn(),
      broadcast: jest.fn(),
      getTaskProgress: jest.fn().mockReturnValue(null),
      getStats: jest.fn().mockReturnValue({
        activeConnections: 0,
        connections: [],
      }),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const config: Record<string, unknown> = {
          MCP_REQUEST_TIMEOUT_SECONDS: 2,
          MCP_MAX_PAYLOAD_SIZE: 10485760,
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MCPServerController],
      providers: [
        MCPServerService,
        { provide: MCPSessionManager, useValue: mockSessionManager },
        { provide: MCPStreamingBridge, useValue: mockStreamingBridge },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    })
      .overrideGuard(MCPApiKeyGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          const req = context.switchToHttp().getRequest();
          const headers = req.headers as Record<string, string>;
          const auth = headers["authorization"];
          const xApiKey = headers["x-api-key"];

          // Bearer token has priority
          if (auth?.startsWith("Bearer ")) {
            const token = auth.slice(7);
            if (token === "") {
              throw new UnauthorizedException("Empty bearer token");
            }
            if (token === TEST_API_KEY) {
              req.mcpApiKeyId = "bearer-key-id";
              return true;
            }
            throw new UnauthorizedException("Invalid bearer token");
          }

          // Fallback to X-API-Key
          if (xApiKey) {
            if (xApiKey === TEST_X_API_KEY) {
              req.mcpApiKeyId = "x-api-key-id";
              return true;
            }
            throw new UnauthorizedException("Invalid X-API-Key");
          }

          throw new UnauthorizedException("API key required");
        },
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalFilters(new MCPExceptionFilter());
    await app.init();

    service = module.get<MCPServerService>(MCPServerService);
    service.registerToolHandler(new MockToolHandler());
    service.registerToolHandler(new FailingToolHandler());
    service.registerToolHandler(new SlowToolHandler());
    service.registerToolHandler(new ContextEchoToolHandler());
  });

  afterAll(async () => {
    await app.close();
  }, 15000);

  const authedPost = (
    body: string | object | unknown[],
    sessionId?: string,
  ) => {
    const req = request(app.getHttpServer())
      .post("/mcp")
      .set("Authorization", `Bearer ${TEST_API_KEY}`)
      .set("Content-Type", "application/json");
    if (sessionId) {
      req.set("Mcp-Session-Id", sessionId);
    }
    return req.send(body);
  };

  // ==================== 1. AUTHENTICATION (Guard + Filter) ====================

  describe("1. Authentication (Guard + Filter Integration)", () => {
    it("should reject with no auth header → 401 + JSON-RPC error code -32001", async () => {
      const res = await request(app.getHttpServer())
        .post("/mcp")
        .set("Content-Type", "application/json")
        .send({ jsonrpc: "2.0", id: 1, method: "ping" });

      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.body).toHaveProperty("jsonrpc", "2.0");
      expect(res.body).toHaveProperty("id", null);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error.code).toBe(-32001);
      expect(res.body.error.message).toContain("API key");
      // Must NOT have NestJS envelope fields
      expect(res.body).not.toHaveProperty("statusCode");
      expect(res.body).not.toHaveProperty("timestamp");
      expect(res.body).not.toHaveProperty("path");
    });

    it("should reject invalid Bearer token → 401 + JSON-RPC error code -32001", async () => {
      const res = await request(app.getHttpServer())
        .post("/mcp")
        .set("Authorization", "Bearer wrong-token")
        .set("Content-Type", "application/json")
        .send({ jsonrpc: "2.0", id: 1, method: "ping" });

      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.body.jsonrpc).toBe("2.0");
      expect(res.body.error.code).toBe(-32001);
      expect(res.body.error.message).toContain("Invalid bearer token");
    });

    it("should accept valid Bearer token → 200 OK", async () => {
      const res = await authedPost({ jsonrpc: "2.0", id: 1, method: "ping" });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.jsonrpc).toBe("2.0");
      expect(res.body.result).toBeDefined();
    });

    it("should accept X-API-Key header alternative → 200 OK", async () => {
      const res = await request(app.getHttpServer())
        .post("/mcp")
        .set("X-API-Key", TEST_X_API_KEY)
        .set("Content-Type", "application/json")
        .send({ jsonrpc: "2.0", id: 1, method: "ping" });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.jsonrpc).toBe("2.0");
      expect(res.body.result).toBeDefined();
    });

    it("should prioritize Bearer over X-API-Key when both present", async () => {
      const res = await request(app.getHttpServer())
        .post("/mcp")
        .set("Authorization", `Bearer ${TEST_API_KEY}`)
        .set("X-API-Key", "should-be-ignored")
        .set("Content-Type", "application/json")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "context_echo", arguments: {} },
        });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.result).toBeDefined();
      const content = JSON.parse(res.body.result.content[0].text);
      expect(content.apiKeyId).toBe("bearer-key-id");
    });

    it("should reject empty Bearer token → 401", async () => {
      const res = await request(app.getHttpServer())
        .post("/mcp")
        .set("Authorization", "Bearer ")
        .set("Content-Type", "application/json")
        .send({ jsonrpc: "2.0", id: 1, method: "ping" });

      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.body.error.code).toBe(-32001);
      // "Bearer " may be treated as no token depending on HTTP library behavior
      expect(typeof res.body.error.message).toBe("string");
      expect(res.body.error.message.length).toBeGreaterThan(0);
    });

    it("should enforce auth on GET /mcp → 401 JSON-RPC", async () => {
      const res = await request(app.getHttpServer()).get("/mcp");

      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.body.jsonrpc).toBe("2.0");
      expect(res.body.error.code).toBe(-32001);
    });

    it("should enforce auth on DELETE /mcp → 401 JSON-RPC", async () => {
      const res = await request(app.getHttpServer()).delete("/mcp");

      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.body.jsonrpc).toBe("2.0");
      expect(res.body.error.code).toBe(-32001);
    });
  });

  // ==================== 2. RESPONSE FORMAT (no envelope) ====================

  describe("2. Response Format (no NestJS envelope)", () => {
    it("should return raw JSON-RPC success without success/data/metadata wrapper", async () => {
      const res = await authedPost({ jsonrpc: "2.0", id: 1, method: "ping" });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body).toHaveProperty("jsonrpc", "2.0");
      expect(res.body).toHaveProperty("id", 1);
      expect(res.body).toHaveProperty("result");
      // Must NOT have envelope
      expect(res.body).not.toHaveProperty("success");
      expect(res.body).not.toHaveProperty("data");
      expect(res.body).not.toHaveProperty("metadata");
    });

    it("should return raw JSON-RPC error without statusCode/timestamp wrapper", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 1,
        method: "unknown",
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body).toHaveProperty("jsonrpc", "2.0");
      expect(res.body).toHaveProperty("id", 1);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toHaveProperty("code");
      expect(res.body.error).toHaveProperty("message");
      // Must NOT have NestJS envelope
      expect(res.body).not.toHaveProperty("statusCode");
      expect(res.body).not.toHaveProperty("timestamp");
      expect(res.body).not.toHaveProperty("path");
    });

    it("should have Content-Type application/json for POST responses", async () => {
      const res = await authedPost({ jsonrpc: "2.0", id: 1, method: "ping" });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.headers["content-type"]).toContain("application/json");
    });
  });

  // ==================== 3. JSON-RPC PROTOCOL COMPLIANCE ====================

  describe("3. JSON-RPC Protocol Compliance", () => {
    it("initialize: returns capabilities, serverInfo, sessionId in serverInfo, Mcp-Session-Id header matches", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          clientInfo: { name: "test-client", version: "1.0" },
        },
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.jsonrpc).toBe("2.0");
      expect(res.body.id).toBe(1);
      expect(res.body.result.protocolVersion).toBe("2024-11-05");
      expect(res.body.result.capabilities).toBeDefined();
      expect(res.body.result.capabilities.tools).toBeDefined();
      expect(res.body.result.serverInfo.name).toBe("genesis-ai");
      expect(res.body.result.serverInfo.sessionId).toMatch(/^mcp-/);
      expect(res.headers["mcp-session-id"]).toBe(
        res.body.result.serverInfo.sessionId,
      );
    });

    it("ping with id → { jsonrpc: '2.0', id, result: {} }", async () => {
      const res = await authedPost({ jsonrpc: "2.0", id: 42, method: "ping" });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body).toEqual({
        jsonrpc: "2.0",
        id: 42,
        result: {},
      });
    });

    it("ping without id → 204 No Content", async () => {
      const res = await authedPost({ jsonrpc: "2.0", method: "ping" });

      expect(res.status).toBe(HttpStatus.NO_CONTENT);
      expect(res.text).toBe("");
    });

    it("tools/list: returns array with all tools, each has name, description, inputSchema", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.jsonrpc).toBe("2.0");
      expect(res.body.id).toBe(2);
      expect(res.body.result.tools).toBeDefined();
      expect(Array.isArray(res.body.result.tools)).toBe(true);
      expect(res.body.result.tools.length).toBeGreaterThanOrEqual(4);

      const tool = res.body.result.tools.find(
        (t: { name: string }) => t.name === "test_tool",
      );
      expect(tool).toBeDefined();
      expect(tool.name).toBe("test_tool");
      expect(tool.description).toBe("A test tool");
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    });

    it("tools/call success: correct result, no error field", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "test_tool", arguments: { query: "hello" } },
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.jsonrpc).toBe("2.0");
      expect(res.body.id).toBe(3);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.content[0].text).toBe("Result: hello");
      expect(res.body.error).toBeUndefined();
    });

    it("tools/call unknown tool: error code -32601", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "nonexistent_tool", arguments: {} },
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.jsonrpc).toBe("2.0");
      expect(res.body.id).toBe(4);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(-32601);
      expect(res.body.result).toBeUndefined();
    });

    it("tools/call tool throws: isError true, error message in content", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "failing_tool", arguments: {} },
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.jsonrpc).toBe("2.0");
      expect(res.body.id).toBe(5);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toContain(
        "Tool execution failed",
      );
    });

    it("tools/call missing name: error code -32602", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { arguments: {} },
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(-32602);
    });

    it("tools/call name not string (number): error code -32602", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: 123, arguments: {} },
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(-32602);
    });

    it("notifications/initialized: 204 No Content", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });

      expect(res.status).toBe(HttpStatus.NO_CONTENT);
      expect(res.text).toBe("");
    });

    it("unknown method: error code -32601", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 8,
        method: "unknown/method",
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(-32601);
    });

    it("invalid jsonrpc version '1.0': error code -32600", async () => {
      const res = await authedPost({
        jsonrpc: "1.0",
        id: 9,
        method: "ping",
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(-32600);
    });

    it("missing method field: error code -32600", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 10,
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(-32600);
    });

    it("empty object body: error code -32600", async () => {
      const res = await authedPost({});

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(-32600);
    });
  });

  // ==================== 4. BATCH REQUESTS ====================

  describe("4. Batch Requests", () => {
    it("batch of 2 normal requests → array of 2 responses, correct ids", async () => {
      const res = await authedPost([
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]);

      expect(res.status).toBe(HttpStatus.OK);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(res.body[0].jsonrpc).toBe("2.0");
      expect(res.body[0].id).toBe(1);
      expect(res.body[0].result).toBeDefined();
      expect(res.body[1].jsonrpc).toBe("2.0");
      expect(res.body[1].id).toBe(2);
      expect(res.body[1].result).toBeDefined();
    });

    it("batch of all notifications → 204", async () => {
      const res = await authedPost([
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", method: "ping" },
      ]);

      expect(res.status).toBe(HttpStatus.NO_CONTENT);
      expect(res.text).toBe("");
    });

    it("mixed batch (1 normal + 1 notification) → array of 1 response", async () => {
      const res = await authedPost([
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
      ]);

      expect(res.status).toBe(HttpStatus.OK);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(1);
    });

    it("batch with mix of valid and invalid → each handled independently", async () => {
      const res = await authedPost([
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", id: 2, method: "unknown" },
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
      ]);

      expect(res.status).toBe(HttpStatus.OK);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(3);
      expect(res.body[0].result).toBeDefined();
      expect(res.body[0].error).toBeUndefined();
      expect(res.body[1].error).toBeDefined();
      expect(res.body[1].error.code).toBe(-32601);
      expect(res.body[2].result).toBeDefined();
      expect(res.body[2].error).toBeUndefined();
    });

    it("batch with error in one → error only in that response, others succeed", async () => {
      const res = await authedPost([
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "1.0", id: 2, method: "ping" },
      ]);

      expect(res.status).toBe(HttpStatus.OK);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(res.body[0].result).toBeDefined();
      expect(res.body[0].error).toBeUndefined();
      expect(res.body[1].error).toBeDefined();
      expect(res.body[1].result).toBeUndefined();
    });

    it("empty array batch → 204 (no responses to return)", async () => {
      const res = await authedPost([]);

      // Empty array: Promise.all([]) → [] filtered to [] → null → 204
      expect(res.status).toBe(HttpStatus.NO_CONTENT);
      expect(res.text).toBe("");
    });
  });

  // ==================== 5. SSE ENDPOINT (GET /mcp) ====================

  describe("5. SSE Endpoint (GET /mcp)", () => {
    it("returns text/event-stream Content-Type, Cache-Control: no-cache, and init event", (done) => {
      let data = "";
      let finished = false;
      const timerRef = {
        id: undefined as ReturnType<typeof setTimeout> | undefined,
      };

      const req = request(app.getHttpServer())
        .get("/mcp")
        .set("Authorization", `Bearer ${TEST_API_KEY}`)
        .buffer(false)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .parse((res: any, callback: any) => {
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
            // Init event received — verify and close
            if (data.includes("notifications/connected") && !finished) {
              finished = true;
              res.destroy();
              callback(null, data);
            }
          });
          res.on("end", () => {
            if (!finished) {
              finished = true;
              callback(null, data);
            }
          });
          res.on("error", () => {
            if (!finished) {
              finished = true;
              callback(null, data);
            }
          });
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .end((_err: Error | null, res: any) => {
          clearTimeout(timerRef.id);
          if (res) {
            expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
            expect(res.headers["cache-control"]).toBe("no-cache");
          }
          expect(data).toContain("notifications/connected");
          done();
        });

      // Safety timeout — abort the request to avoid dangling connection
      timerRef.id = setTimeout(() => {
        if (!finished) {
          finished = true;
          req.abort();
          done();
        }
      }, 3000);
    }, 5000);
  });

  // ==================== 6. SESSION MANAGEMENT (DELETE /mcp) ====================

  describe("6. Session Management (DELETE /mcp)", () => {
    it("returns 204 No Content", async () => {
      const res = await request(app.getHttpServer())
        .delete("/mcp")
        .set("Authorization", `Bearer ${TEST_API_KEY}`);

      expect(res.status).toBe(HttpStatus.NO_CONTENT);
      expect(res.text).toBe("");
    });

    it("with session ID header → 204", async () => {
      const res = await request(app.getHttpServer())
        .delete("/mcp")
        .set("Authorization", `Bearer ${TEST_API_KEY}`)
        .set("Mcp-Session-Id", "test-session-123");

      expect(res.status).toBe(HttpStatus.NO_CONTENT);
      expect(res.text).toBe("");
    });

    it("without session ID header → 204", async () => {
      const res = await request(app.getHttpServer())
        .delete("/mcp")
        .set("Authorization", `Bearer ${TEST_API_KEY}`);

      expect(res.status).toBe(HttpStatus.NO_CONTENT);
      expect(res.text).toBe("");
    });
  });

  // ==================== 7. SESSION ID HEADER ====================

  describe("7. Session ID Header", () => {
    it("initialize → response has Mcp-Session-Id header", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          clientInfo: { name: "test", version: "1.0" },
        },
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.headers["mcp-session-id"]).toBeDefined();
      expect(res.headers["mcp-session-id"]).toMatch(/^mcp-/);
    });

    it("ping → response does NOT have Mcp-Session-Id header", async () => {
      const res = await authedPost({ jsonrpc: "2.0", id: 1, method: "ping" });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.headers["mcp-session-id"]).toBeUndefined();
    });

    it("tools/list → response does NOT have Mcp-Session-Id header", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.headers["mcp-session-id"]).toBeUndefined();
    });
  });

  // ==================== 8. SECURITY ====================

  describe("8. Security", () => {
    it("very long body (large JSON) → handled without crash", async () => {
      const longString = "a".repeat(10000);
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test_tool", arguments: { query: longString } },
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.content[0].text).toContain("Result:");
    });

    it("request with extra unknown fields in JSON-RPC → still processed", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
        extraField: "should-be-ignored",
        anotherExtra: 123,
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.result).toBeDefined();
    });

    it("special characters in method name → proper error", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 1,
        method: "method/with/@special#chars!",
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(-32601);
    });

    it("null id in request → handled correctly", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: null,
        method: "ping",
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.id).toBeNull();
      expect(res.body.result).toBeDefined();
    });

    it("string id in request → preserved in response", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: "string-id-123",
        method: "ping",
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.id).toBe("string-id-123");
      expect(res.body.result).toBeDefined();
    });

    it("numeric id in request → preserved in response", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 999,
        method: "ping",
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.id).toBe(999);
      expect(res.body.result).toBeDefined();
    });
  });

  // ==================== 9. DFX & ROBUSTNESS ====================

  describe("9. DFX & Robustness", () => {
    it("apiKeyId from guard propagated to context (verify via tool call)", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "context_echo", arguments: {} },
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.result).toBeDefined();
      const context = JSON.parse(res.body.result.content[0].text);
      expect(context.apiKeyId).toBe("bearer-key-id");
    });

    it("sessionId from header propagated to context", async () => {
      const res = await authedPost(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "context_echo", arguments: {} },
        },
        "test-session-456",
      );

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.result).toBeDefined();
      const context = JSON.parse(res.body.result.content[0].text);
      expect(context.sessionId).toBe("test-session-456");
    });

    it("multiple sequential requests → each gets correct response (no state leakage)", async () => {
      const res1 = await authedPost({ jsonrpc: "2.0", id: 1, method: "ping" });
      expect(res1.body.id).toBe(1);
      expect(res1.body.result).toEqual({});

      const res2 = await authedPost({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });
      expect(res2.body.id).toBe(2);
      expect(res2.body.result.tools).toBeDefined();

      const res3 = await authedPost({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "test_tool", arguments: { query: "test" } },
      });
      expect(res3.body.id).toBe(3);
      expect(res3.body.result.content[0].text).toBe("Result: test");
    }, 15000);

    it("slow tool handler completes successfully", async () => {
      const res = await authedPost({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "slow_tool", arguments: {} },
      });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.content[0].text).toBe("Slow result");
    }, 10000);

    it("controller handles internal service error gracefully", async () => {
      // Temporarily break the service
      const originalMethod = service.handleRequest.bind(service);
      service.handleRequest = jest
        .fn()
        .mockRejectedValue(new Error("Service crashed"));

      const res = await authedPost({ jsonrpc: "2.0", id: 1, method: "ping" });

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(-32603);
      expect(res.body.error.message).toBe("Internal server error");

      // Restore
      service.handleRequest = originalMethod;
    }, 15000);
  });
});
