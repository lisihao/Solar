import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { MCPServerService } from "../mcp-server.service";
import {
  IMCPToolHandler,
  MCPRequestContext,
  MCPToolResponse,
  JSON_RPC_ERRORS,
  JsonRpcRequest,
  JsonRpcResponse,
} from "../abstractions/mcp-server.interface";
import { GuardrailsPipelineService } from "../../../../ai-engine/facade";
import { MCPSessionManager } from "../gateway/mcp-session-manager";

// Mock tool handler
class MockToolHandler implements IMCPToolHandler {
  constructor(
    public readonly toolName: string,
    public readonly description: string,
    public readonly inputSchema: Record<string, unknown>,
    private readonly executeFn?: (
      args: Record<string, unknown>,
      context: MCPRequestContext,
    ) => Promise<MCPToolResponse>,
  ) {}

  async execute(
    args: Record<string, unknown>,
    context: MCPRequestContext,
  ): Promise<MCPToolResponse> {
    if (this.executeFn) {
      return this.executeFn(args, context);
    }
    return {
      content: [
        {
          type: "text",
          text: `Executed ${this.toolName} with args: ${JSON.stringify(args)}`,
        },
      ],
    };
  }
}

describe("MCPServerService", () => {
  let service: MCPServerService;
  let mockSessionManager: jest.Mocked<MCPSessionManager>;

  beforeEach(async () => {
    mockSessionManager = {
      createSession: jest.fn((apiKeyId: string, clientInfo?: any) => ({
        sessionId: `mcp-${Math.random().toString(16).slice(2)}`,
        apiKeyId,
        clientInfo,
        createdAt: new Date(),
        lastActiveAt: new Date(),
      })),
      getSession: jest.fn(),
      getStats: jest.fn(() => ({
        activeSessions: 0,
        byClient: {},
        byApiKey: {},
      })),
      isToolAllowed: jest.fn(() => true),
      isResourceAllowed: jest.fn(() => true),
      isPromptAllowed: jest.fn(() => true),
      consumeQuota: jest.fn(() => true),
      validateAndConsumeQuota: jest.fn(() => ({ allowed: true })),
      getAllSessions: jest.fn(() => []),
      terminateSession: jest.fn(() => true),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MCPServerService,
        { provide: MCPSessionManager, useValue: mockSessionManager },
      ],
    }).compile();

    service = module.get<MCPServerService>(MCPServerService);
    service.onModuleInit();
  });

  describe("1. FUNCTIONAL - registerToolHandler", () => {
    it("should register a single tool handler", () => {
      const handler = new MockToolHandler("test-tool", "Test description", {
        type: "object",
      });
      service.registerToolHandler(handler);

      const status = service.getStatus();
      expect(status.toolCount).toBe(1);
      expect(status.tools).toEqual(["test-tool"]);
    });

    it("should register multiple tool handlers", () => {
      const handler1 = new MockToolHandler("tool-1", "First tool", {
        type: "object",
      });
      const handler2 = new MockToolHandler("tool-2", "Second tool", {
        type: "object",
      });

      service.registerToolHandler(handler1);
      service.registerToolHandler(handler2);

      const status = service.getStatus();
      expect(status.toolCount).toBe(2);
      expect(status.tools).toContain("tool-1");
      expect(status.tools).toContain("tool-2");
    });

    it("should overwrite when registering duplicate tool name", () => {
      const handler1 = new MockToolHandler("duplicate", "First", {
        type: "object",
      });
      const handler2 = new MockToolHandler("duplicate", "Second", {
        type: "object",
      });

      service.registerToolHandler(handler1);
      service.registerToolHandler(handler2);

      const status = service.getStatus();
      expect(status.toolCount).toBe(1);

      const toolsList = (service as any).handleToolsList();
      expect(toolsList.tools[0].description).toBe("Second");
    });
  });

  describe("1. FUNCTIONAL - handleRequest", () => {
    const context: MCPRequestContext = { apiKeyId: "test-key" };

    it("should handle single valid request", async () => {
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      };

      const response = await service.handleRequest(request, context);
      expect(response).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: {},
      });
    });

    it("should handle batch requests", async () => {
      const batch: JsonRpcRequest[] = [
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ];

      const response = await service.handleRequest(batch, context);
      expect(Array.isArray(response)).toBe(true);
      expect((response as JsonRpcResponse[]).length).toBe(2);
      expect((response as JsonRpcResponse[])[0].id).toBe(1);
      expect((response as JsonRpcResponse[])[1].id).toBe(2);
    });

    it("should return null for empty batch array", async () => {
      const response = await service.handleRequest([], context);
      expect(response).toBeNull();
    });

    it("should handle null body", async () => {
      const response = (await service.handleRequest(
        null,
        context,
      )) as JsonRpcResponse;
      expect(response.jsonrpc).toBe("2.0");
      expect(response.error?.code).toBe(-32600);
      expect(response.error?.message).toBe("Invalid Request");
      // errorResponse(null, ...) uses id ?? undefined, so id is omitted
      expect(response.id).toBeUndefined();
    });

    it("should handle undefined body", async () => {
      const response = (await service.handleRequest(
        undefined,
        context,
      )) as JsonRpcResponse;
      expect(response.jsonrpc).toBe("2.0");
      expect(response.error?.code).toBe(-32600);
      expect(response.id).toBeUndefined();
    });

    it("should handle string body", async () => {
      const response = (await service.handleRequest(
        "invalid",
        context,
      )) as JsonRpcResponse;
      expect(response.jsonrpc).toBe("2.0");
      expect(response.error?.code).toBe(-32600);
      expect(response.id).toBeUndefined();
    });

    it("should handle number body", async () => {
      const response = (await service.handleRequest(
        123,
        context,
      )) as JsonRpcResponse;
      expect(response.jsonrpc).toBe("2.0");
      expect(response.error?.code).toBe(-32600);
      expect(response.id).toBeUndefined();
    });
  });

  describe("1. FUNCTIONAL - processSingleRequest", () => {
    const context: MCPRequestContext = { apiKeyId: "test-key" };

    it("should process valid jsonrpc request", async () => {
      const request: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "ping" };
      const response = await service.handleRequest(request, context);
      expect((response as JsonRpcResponse).jsonrpc).toBe("2.0");
      expect((response as JsonRpcResponse).result).toEqual({});
    });

    it("should reject invalid jsonrpc version", async () => {
      const request = { jsonrpc: "1.0", id: 1, method: "ping" };
      const response = await service.handleRequest(request, context);
      expect((response as JsonRpcResponse).error).toEqual({
        code: JSON_RPC_ERRORS.INVALID_REQUEST.code,
        message: JSON_RPC_ERRORS.INVALID_REQUEST.message,
      });
    });

    it("should reject missing method", async () => {
      const request = { jsonrpc: "2.0", id: 1 };
      const response = await service.handleRequest(request, context);
      expect((response as JsonRpcResponse).error).toEqual({
        code: JSON_RPC_ERRORS.INVALID_REQUEST.code,
        message: JSON_RPC_ERRORS.INVALID_REQUEST.message,
      });
    });

    it("should return null for notification (no id) on ping", async () => {
      const request: JsonRpcRequest = { jsonrpc: "2.0", method: "ping" };
      const response = await service.handleRequest(request, context);
      expect(response).toBeNull();
    });

    it("should return null for notification on initialize", async () => {
      const request: JsonRpcRequest = { jsonrpc: "2.0", method: "initialize" };
      const response = await service.handleRequest(request, context);
      expect(response).toBeNull();
    });

    it("should return null for notification on tools/list", async () => {
      const request: JsonRpcRequest = { jsonrpc: "2.0", method: "tools/list" };
      const response = await service.handleRequest(request, context);
      expect(response).toBeNull();
    });

    it("should return null for notification on unknown method", async () => {
      const request: JsonRpcRequest = { jsonrpc: "2.0", method: "unknown" };
      const response = await service.handleRequest(request, context);
      expect(response).toBeNull();
    });

    it("should return null for notification that throws", async () => {
      const handler = new MockToolHandler(
        "error-tool",
        "Error tool",
        { type: "object" },
        async () => {
          throw new Error("Tool error");
        },
      );
      service.registerToolHandler(handler);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "error-tool" },
      };
      const response = await service.handleRequest(request, context);
      expect(response).toBeNull();
    });
  });

  describe("1. FUNCTIONAL - dispatch methods", () => {
    const context: MCPRequestContext = { apiKeyId: "test-key" };

    it("should handle initialize method", async () => {
      mockSessionManager.createSession.mockReturnValue({
        sessionId: "mcp-test789",
        apiKeyId: "test-key",
        createdAt: new Date(),
        lastActiveAt: new Date(),
      });

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      };
      const response = await service.handleRequest(request, context);
      const result = (response as JsonRpcResponse).result as Record<
        string,
        unknown
      >;

      expect(result.protocolVersion).toBe("2024-11-05");
      const serverInfo = result.serverInfo as Record<string, unknown>;
      expect(serverInfo.name).toBe("genesis-ai");
      expect(serverInfo.version).toBe("2.0.0");
      expect(serverInfo.sessionId).toBe("mcp-test789");
      const capabilities = result.capabilities as Record<string, unknown>;
      expect(capabilities.tools).toEqual({ listChanged: true });
    });

    it("should handle tools/list method", async () => {
      const handler = new MockToolHandler("test-tool", "Test description", {
        type: "object",
        properties: { foo: { type: "string" } },
      });
      service.registerToolHandler(handler);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      };
      const response = await service.handleRequest(request, context);
      const result = (response as JsonRpcResponse).result as {
        tools: unknown[];
      };

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]).toEqual({
        name: "test-tool",
        description: "Test description",
        inputSchema: {
          type: "object",
          properties: { foo: { type: "string" } },
        },
      });
    });

    it("should handle tools/call method", async () => {
      const handler = new MockToolHandler("echo", "Echo tool", {
        type: "object",
      });
      service.registerToolHandler(handler);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo", arguments: { message: "hello" } },
      };

      const response = await service.handleRequest(request, context);
      const result = (response as JsonRpcResponse).result as MCPToolResponse;

      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("echo");
      expect(result.content[0].text).toContain("hello");
    });

    it("should handle notifications/initialized method", async () => {
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "notifications/initialized",
      };
      const response = await service.handleRequest(request, context);
      expect((response as JsonRpcResponse).result).toBeUndefined();
    });

    it("should handle ping method", async () => {
      const request: JsonRpcRequest = { jsonrpc: "2.0", id: 1, method: "ping" };
      const response = await service.handleRequest(request, context);
      expect((response as JsonRpcResponse).result).toEqual({});
    });

    it("should reject unknown method", async () => {
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "unknown-method",
      };
      const response = await service.handleRequest(request, context);
      expect((response as JsonRpcResponse).error).toEqual({
        code: JSON_RPC_ERRORS.METHOD_NOT_FOUND.code,
        message: "Method not found: unknown-method",
      });
    });
  });

  describe("1. FUNCTIONAL - handleInitialize", () => {
    const context: MCPRequestContext = { apiKeyId: "test-key" };

    it("should initialize with clientInfo", async () => {
      const createdSession = {
        sessionId: "mcp-test123",
        apiKeyId: "test-key",
        clientInfo: { name: "TestClient", version: "1.0.0" },
        createdAt: new Date(),
        lastActiveAt: new Date(),
      };
      mockSessionManager.createSession.mockReturnValue(createdSession);
      mockSessionManager.getAllSessions.mockReturnValue([createdSession]);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "TestClient", version: "1.0.0" } },
      };

      const response = await service.handleRequest(request, context);
      const result = (response as JsonRpcResponse).result as Record<
        string,
        unknown
      >;
      const serverInfo = result.serverInfo as Record<string, unknown>;

      expect(serverInfo.sessionId).toBe("mcp-test123");

      const sessions = service.getSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe("mcp-test123");
      expect(sessions[0].clientInfo).toEqual({
        name: "TestClient",
        version: "1.0.0",
      });
    });

    it("should initialize without clientInfo", async () => {
      const createdSession = {
        sessionId: "mcp-test456",
        apiKeyId: "test-key",
        createdAt: new Date(),
        lastActiveAt: new Date(),
      };
      mockSessionManager.createSession.mockReturnValue(createdSession);
      mockSessionManager.getAllSessions.mockReturnValue([createdSession]);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      };
      const response = await service.handleRequest(request, context);
      const result = (response as JsonRpcResponse).result as Record<
        string,
        unknown
      >;
      const serverInfo = result.serverInfo as Record<string, unknown>;

      expect(serverInfo.sessionId).toBe("mcp-test456");

      const sessions = service.getSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].clientInfo).toBeUndefined();
    });

    it("should generate unique session IDs", async () => {
      let callCount = 0;
      mockSessionManager.createSession.mockImplementation(
        (apiKeyId: string) => ({
          sessionId: `mcp-unique-${callCount++}`,
          apiKeyId,
          createdAt: new Date(),
          lastActiveAt: new Date(),
        }),
      );

      const request1: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      };
      const request2: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
      };
      const context1: MCPRequestContext = { apiKeyId: "key1" };
      const context2: MCPRequestContext = { apiKeyId: "key2" };

      const response1 = await service.handleRequest(request1, context1);
      const response2 = await service.handleRequest(request2, context2);

      const serverInfo1 = (
        (response1 as JsonRpcResponse).result as Record<string, unknown>
      ).serverInfo as Record<string, string>;
      const serverInfo2 = (
        (response2 as JsonRpcResponse).result as Record<string, unknown>
      ).serverInfo as Record<string, string>;

      expect(serverInfo1.sessionId).not.toBe(serverInfo2.sessionId);
    });
  });

  describe("1. FUNCTIONAL - handleToolsList", () => {
    it("should return empty tools list", async () => {
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      };
      const response = await service.handleRequest(request, {
        apiKeyId: "test",
      });
      const result = (response as JsonRpcResponse).result as {
        tools: unknown[];
      };

      expect(result.tools).toEqual([]);
    });

    it("should return one tool with all properties", async () => {
      const handler = new MockToolHandler("my-tool", "My description", {
        type: "object",
        properties: { param1: { type: "string" } },
        required: ["param1"],
      });
      service.registerToolHandler(handler);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      };
      const response = await service.handleRequest(request, {
        apiKeyId: "test",
      });
      const result = (response as JsonRpcResponse).result as {
        tools: unknown[];
      };

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]).toEqual({
        name: "my-tool",
        description: "My description",
        inputSchema: {
          type: "object",
          properties: { param1: { type: "string" } },
          required: ["param1"],
        },
      });
    });

    it("should return multiple tools", async () => {
      service.registerToolHandler(
        new MockToolHandler("tool-a", "Description A", { type: "object" }),
      );
      service.registerToolHandler(
        new MockToolHandler("tool-b", "Description B", { type: "object" }),
      );
      service.registerToolHandler(
        new MockToolHandler("tool-c", "Description C", { type: "object" }),
      );

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      };
      const response = await service.handleRequest(request, {
        apiKeyId: "test",
      });
      const result = (response as JsonRpcResponse).result as {
        tools: Array<{ name: string }>;
      };

      expect(result.tools).toHaveLength(3);
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("tool-a");
      expect(names).toContain("tool-b");
      expect(names).toContain("tool-c");
    });
  });

  describe("1. FUNCTIONAL - handleToolsCall", () => {
    const context: MCPRequestContext = { apiKeyId: "test-key" };

    it("should execute tool successfully", async () => {
      const handler = new MockToolHandler(
        "greet",
        "Greet user",
        { type: "object" },
        async (args) => ({
          content: [{ type: "text", text: `Hello, ${args.name}!` }],
        }),
      );
      service.registerToolHandler(handler);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "greet", arguments: { name: "Alice" } },
      };

      const response = await service.handleRequest(request, context);
      const result = (response as JsonRpcResponse).result as MCPToolResponse;

      expect(result.content[0].text).toBe("Hello, Alice!");
    });

    it("should return error for unknown tool", async () => {
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "nonexistent" },
      };

      const response = await service.handleRequest(request, context);
      expect((response as JsonRpcResponse).error).toEqual({
        code: JSON_RPC_ERRORS.METHOD_NOT_FOUND.code,
        message: "Unknown tool: nonexistent",
      });
    });

    it("should return error for missing name parameter", async () => {
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {},
      };

      const response = await service.handleRequest(request, context);
      expect((response as JsonRpcResponse).error).toEqual({
        code: JSON_RPC_ERRORS.INVALID_PARAMS.code,
        message: "Missing required parameter: name",
      });
    });

    it("should return error when name is not a string", async () => {
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: 123 },
      };

      const response = await service.handleRequest(request, context);
      expect((response as JsonRpcResponse).error?.code).toBe(
        JSON_RPC_ERRORS.INVALID_PARAMS.code,
      );
    });

    it("should default to empty object when arguments not provided", async () => {
      let receivedArgs: Record<string, unknown> | null = null;
      const handler = new MockToolHandler(
        "test",
        "Test",
        { type: "object" },
        async (args) => {
          receivedArgs = args;
          return { content: [{ type: "text", text: "ok" }] };
        },
      );
      service.registerToolHandler(handler);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test" },
      };

      await service.handleRequest(request, context);
      expect(receivedArgs).toEqual({});
    });

    it("should handle tool execution error", async () => {
      const handler = new MockToolHandler(
        "failing-tool",
        "Failing tool",
        { type: "object" },
        async () => {
          throw new Error("Tool execution failed");
        },
      );
      service.registerToolHandler(handler);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "failing-tool" },
      };

      const response = await service.handleRequest(request, context);
      const result = (response as JsonRpcResponse).result as MCPToolResponse;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Tool execution failed");
    });
  });

  describe("1. FUNCTIONAL - errorResponse", () => {
    it("should create error response with string id", async () => {
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: "abc",
        method: "unknown",
      };
      const response = await service.handleRequest(request, {
        apiKeyId: "test",
      });

      expect((response as JsonRpcResponse).id).toBe("abc");
      expect((response as JsonRpcResponse).error?.code).toBe(
        JSON_RPC_ERRORS.METHOD_NOT_FOUND.code,
      );
    });

    it("should create error response with number id", async () => {
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 999,
        method: "unknown",
      };
      const response = await service.handleRequest(request, {
        apiKeyId: "test",
      });

      expect((response as JsonRpcResponse).id).toBe(999);
      expect((response as JsonRpcResponse).error?.code).toBe(
        JSON_RPC_ERRORS.METHOD_NOT_FOUND.code,
      );
    });

    it("should create error response with null id (non-object body)", async () => {
      // errorResponse(null, ...) uses id ?? undefined, so id field is undefined (omitted from JSON)
      const response = await service.handleRequest(
        { invalid: true },
        { apiKeyId: "test" },
      );

      expect((response as JsonRpcResponse).id).toBeUndefined();
      expect((response as JsonRpcResponse).error?.code).toBe(
        JSON_RPC_ERRORS.INVALID_REQUEST.code,
      );
    });
  });

  describe("2. METRICS & MONITORING - recordMetric", () => {
    it("should record metric after successful tool call", async () => {
      const handler = new MockToolHandler("metric-tool", "Metric tool", {
        type: "object",
      });
      service.registerToolHandler(handler);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "metric-tool" },
      };

      await service.handleRequest(request, { apiKeyId: "key-123" });

      const metrics = service.getMetrics();
      expect(metrics.totalCalls).toBe(1);
      expect(metrics.successCount).toBe(1);
      expect(metrics.byTool["metric-tool"].calls).toBe(1);
      expect(metrics.byApiKey["key-123"].calls).toBe(1);
    });

    it("should record metric after tool call failure", async () => {
      const handler = new MockToolHandler(
        "error-tool",
        "Error tool",
        { type: "object" },
        async () => {
          const error = new Error("Test error");
          error.name = "TestError";
          throw error;
        },
      );
      service.registerToolHandler(handler);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "error-tool" },
      };

      await service.handleRequest(request, { apiKeyId: "key-456" });

      const metrics = service.getMetrics();
      expect(metrics.totalCalls).toBe(1);
      expect(metrics.errorCount).toBe(1);
      expect(metrics.byTool["error-tool"].errors).toBe(1);
      expect(metrics.recentErrors).toHaveLength(1);
      expect(metrics.recentErrors[0].errorType).toBe("TestError");
    });
  });

  describe("2. METRICS & MONITORING - getMetrics", () => {
    beforeEach(async () => {
      const successTool = new MockToolHandler("success", "Success", {
        type: "object",
      });
      const errorTool = new MockToolHandler(
        "error",
        "Error",
        { type: "object" },
        async () => {
          throw new Error("Fail");
        },
      );

      service.registerToolHandler(successTool);
      service.registerToolHandler(errorTool);
    });

    it("should return empty metrics in initial state", () => {
      const metrics = service.getMetrics();
      expect(metrics.totalCalls).toBe(0);
      expect(metrics.successCount).toBe(0);
      expect(metrics.errorCount).toBe(0);
      expect(metrics.successRate).toBe(100);
      expect(metrics.avgDuration).toBe(0);
      expect(Object.keys(metrics.byTool)).toHaveLength(0);
      expect(Object.keys(metrics.byApiKey)).toHaveLength(0);
    });

    it("should aggregate metrics after multiple calls", async () => {
      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "success" },
        },
        { apiKeyId: "key1" },
      );
      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "success" },
        },
        { apiKeyId: "key1" },
      );
      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "error" },
        },
        { apiKeyId: "key2" },
      );

      const metrics = service.getMetrics();
      expect(metrics.totalCalls).toBe(3);
      expect(metrics.successCount).toBe(2);
      expect(metrics.errorCount).toBe(1);
      expect(metrics.successRate).toBeCloseTo(66.67, 1);
      expect(metrics.avgDuration).toBeGreaterThanOrEqual(0);
    });

    it("should filter by startDate", async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 10000);

      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "success" },
        },
        { apiKeyId: "key1" },
      );

      const metrics = service.getMetrics({
        startDate: new Date(now.getTime() + 5000),
      });
      expect(metrics.totalCalls).toBe(0);

      const metricsAll = service.getMetrics({ startDate: past });
      expect(metricsAll.totalCalls).toBe(1);
    });

    it("should filter by endDate", async () => {
      const past = new Date(Date.now() - 10000);

      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "success" },
        },
        { apiKeyId: "key1" },
      );

      const metrics = service.getMetrics({ endDate: past });
      expect(metrics.totalCalls).toBe(0);

      const metricsAll = service.getMetrics({ endDate: new Date() });
      expect(metricsAll.totalCalls).toBe(1);
    });

    it("should filter by toolName", async () => {
      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "success" },
        },
        { apiKeyId: "key1" },
      );
      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "error" },
        },
        { apiKeyId: "key1" },
      );

      const metrics = service.getMetrics({ toolName: "success" });
      expect(metrics.totalCalls).toBe(1);
      expect(metrics.byTool["success"].calls).toBe(1);
      expect(metrics.byTool["error"]).toBeUndefined();
    });

    it("should aggregate byTool correctly", async () => {
      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "success" },
        },
        { apiKeyId: "key1" },
      );
      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "success" },
        },
        { apiKeyId: "key1" },
      );
      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "error" },
        },
        { apiKeyId: "key1" },
      );

      const metrics = service.getMetrics();
      expect(metrics.byTool["success"].calls).toBe(2);
      expect(metrics.byTool["success"].errors).toBe(0);
      expect(metrics.byTool["success"].avgDuration).toBeGreaterThanOrEqual(0);

      expect(metrics.byTool["error"].calls).toBe(1);
      expect(metrics.byTool["error"].errors).toBe(1);
    });

    it("should aggregate byApiKey with lastUsed timestamp", async () => {
      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "success" },
        },
        { apiKeyId: "key-alpha" },
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "success" },
        },
        { apiKeyId: "key-alpha" },
      );

      const metrics = service.getMetrics();
      expect(metrics.byApiKey["key-alpha"].calls).toBe(2);
      expect(metrics.byApiKey["key-alpha"].lastUsed).toBeInstanceOf(Date);
    });

    it("should limit recentErrors to 10 and sort newest first", async () => {
      for (let i = 0; i < 15; i++) {
        await service.handleRequest(
          {
            jsonrpc: "2.0",
            id: i,
            method: "tools/call",
            params: { name: "error" },
          },
          { apiKeyId: "key1" },
        );
      }

      const metrics = service.getMetrics();
      expect(metrics.recentErrors).toHaveLength(10);
      expect(
        metrics.recentErrors[0].timestamp.getTime(),
      ).toBeGreaterThanOrEqual(metrics.recentErrors[9].timestamp.getTime());
    });
  });

  describe("2. METRICS & MONITORING - circular buffer", () => {
    it("should evict old metrics when exceeding MAX_METRICS", async () => {
      const MAX_METRICS = 10000;
      const handler = new MockToolHandler("test", "Test", { type: "object" });
      service.registerToolHandler(handler);

      // Push more than MAX_METRICS
      for (let i = 0; i < MAX_METRICS + 100; i++) {
        await service.handleRequest(
          {
            jsonrpc: "2.0",
            id: i,
            method: "tools/call",
            params: { name: "test" },
          },
          { apiKeyId: "key1" },
        );
      }

      const metrics = service.getMetrics();
      // Circular buffer keeps exactly MAX_METRICS entries (oldest overwritten)
      expect(metrics.totalCalls).toBe(MAX_METRICS);
    });
  });

  describe("2. METRICS & MONITORING - getStatus", () => {
    it("should return empty status initially", () => {
      const status = service.getStatus();
      expect(status.toolCount).toBe(0);
      expect(status.tools).toEqual([]);
      expect(status.activeSessions).toBe(0);
    });

    it("should return status with tools", () => {
      service.registerToolHandler(
        new MockToolHandler("tool1", "Tool 1", { type: "object" }),
      );
      service.registerToolHandler(
        new MockToolHandler("tool2", "Tool 2", { type: "object" }),
      );

      const status = service.getStatus();
      expect(status.toolCount).toBe(2);
      expect(status.tools).toContain("tool1");
      expect(status.tools).toContain("tool2");
    });

    it("should return status with sessions", async () => {
      mockSessionManager.getStats.mockReturnValue({
        activeSessions: 2,
        byClient: {},
        byApiKey: {},
      });

      const status = service.getStatus();
      expect(status.activeSessions).toBe(2);
    });
  });

  describe("2. METRICS & MONITORING - getDetailedStatus", () => {
    beforeEach(async () => {
      const successTool = new MockToolHandler("success", "Success", {
        type: "object",
      });
      service.registerToolHandler(successTool);
    });

    it("should return healthy status with high success rate", async () => {
      for (let i = 0; i < 100; i++) {
        await service.handleRequest(
          {
            jsonrpc: "2.0",
            id: i,
            method: "tools/call",
            params: { name: "success" },
          },
          { apiKeyId: "key1" },
        );
      }

      const status = service.getDetailedStatus();
      expect(status.status).toBe("healthy");
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(status.totalToolCount).toBe(1);
      expect(status.tools).toHaveLength(1);
      expect(status.tools[0].name).toBe("success");
      expect(status.tools[0].description).toBe("Success");
      expect(status.metrics24h.totalCalls).toBe(100);
      expect(status.metrics24h.successRate).toBe(100);
    });

    it("should return degraded status with 80-95% success rate", async () => {
      const errorTool = new MockToolHandler(
        "error",
        "Error",
        { type: "object" },
        async () => {
          throw new Error("Fail");
        },
      );
      service.registerToolHandler(errorTool);

      // 90 success, 10 errors = 90% success rate
      for (let i = 0; i < 90; i++) {
        await service.handleRequest(
          {
            jsonrpc: "2.0",
            id: i,
            method: "tools/call",
            params: { name: "success" },
          },
          { apiKeyId: "key1" },
        );
      }
      for (let i = 0; i < 10; i++) {
        await service.handleRequest(
          {
            jsonrpc: "2.0",
            id: i + 90,
            method: "tools/call",
            params: { name: "error" },
          },
          { apiKeyId: "key1" },
        );
      }

      const status = service.getDetailedStatus();
      expect(status.status).toBe("degraded");
      expect(status.metrics24h.successRate).toBeCloseTo(90, 0);
    });

    it("should return unhealthy status with <80% success rate", async () => {
      const errorTool = new MockToolHandler(
        "error",
        "Error",
        { type: "object" },
        async () => {
          throw new Error("Fail");
        },
      );
      service.registerToolHandler(errorTool);

      // 70 success, 30 errors = 70% success rate
      for (let i = 0; i < 70; i++) {
        await service.handleRequest(
          {
            jsonrpc: "2.0",
            id: i,
            method: "tools/call",
            params: { name: "success" },
          },
          { apiKeyId: "key1" },
        );
      }
      for (let i = 0; i < 30; i++) {
        await service.handleRequest(
          {
            jsonrpc: "2.0",
            id: i + 70,
            method: "tools/call",
            params: { name: "error" },
          },
          { apiKeyId: "key1" },
        );
      }

      const status = service.getDetailedStatus();
      expect(status.status).toBe("unhealthy");
      expect(status.metrics24h.successRate).toBeCloseTo(70, 0);
    });
  });

  describe("2. METRICS & MONITORING - getSessions", () => {
    it("should return empty array initially", () => {
      mockSessionManager.getAllSessions.mockReturnValue([]);
      const sessions = service.getSessions();
      expect(sessions).toEqual([]);
    });

    it("should return sessions after initialize calls", async () => {
      const sessions = [
        {
          sessionId: "mcp-session1",
          apiKeyId: "key1",
          clientInfo: { name: "Client1", version: "1.0" },
          createdAt: new Date(),
          lastActiveAt: new Date(),
        },
        {
          sessionId: "mcp-session2",
          apiKeyId: "key2",
          clientInfo: { name: "Client2", version: "2.0" },
          createdAt: new Date(),
          lastActiveAt: new Date(),
        },
      ];
      mockSessionManager.getAllSessions.mockReturnValue(sessions);

      const result = service.getSessions();
      expect(result).toHaveLength(2);
      expect(result[0].sessionId).toBe("mcp-session1");
      expect(result[0].clientInfo).toEqual({
        name: "Client1",
        version: "1.0",
      });
      expect(result[1].clientInfo).toEqual({
        name: "Client2",
        version: "2.0",
      });
      expect(result[0].createdAt).toBeInstanceOf(Date);
    });
  });

  describe("4. SECURITY & EDGE CASES - batch requests", () => {
    it("should filter out notifications from batch response", async () => {
      const batch = [
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", method: "ping" }, // notification
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ];

      const response = await service.handleRequest(batch, { apiKeyId: "test" });
      expect(Array.isArray(response)).toBe(true);
      expect((response as JsonRpcResponse[]).length).toBe(2);
      expect((response as JsonRpcResponse[])[0].id).toBe(1);
      expect((response as JsonRpcResponse[])[1].id).toBe(2);
    });

    it("should handle batch with mix of valid, invalid, and notifications", async () => {
      const batch = [
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "1.0", id: 2, method: "ping" }, // invalid
        { jsonrpc: "2.0", method: "ping" }, // notification
        { jsonrpc: "2.0", id: 3, method: "unknown" }, // error
      ];

      const response = await service.handleRequest(batch, { apiKeyId: "test" });
      expect(Array.isArray(response)).toBe(true);
      expect((response as JsonRpcResponse[]).length).toBe(3);

      const responses = response as JsonRpcResponse[];
      expect(responses[0].id).toBe(1);
      expect(responses[0].result).toEqual({});

      expect(responses[1].id).toBe(2);
      expect(responses[1].error?.code).toBe(
        JSON_RPC_ERRORS.INVALID_REQUEST.code,
      );

      expect(responses[2].id).toBe(3);
      expect(responses[2].error?.code).toBe(
        JSON_RPC_ERRORS.METHOD_NOT_FOUND.code,
      );
    });
  });

  describe("4. SECURITY & EDGE CASES - tools/call edge cases", () => {
    it("should handle numeric name parameter", async () => {
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: 123 },
      };

      const response = await service.handleRequest(request, {
        apiKeyId: "test",
      });
      expect((response as JsonRpcResponse).error?.code).toBe(
        JSON_RPC_ERRORS.INVALID_PARAMS.code,
      );
    });

    it("should handle empty string name parameter", async () => {
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "" },
      };

      const response = await service.handleRequest(request, {
        apiKeyId: "test",
      });
      // Empty string is falsy, so !params?.name is true → INVALID_PARAMS
      expect((response as JsonRpcResponse).error?.code).toBe(
        JSON_RPC_ERRORS.INVALID_PARAMS.code,
      );
      expect((response as JsonRpcResponse).error?.message).toBe(
        "Missing required parameter: name",
      );
    });
  });

  describe("4. SECURITY & EDGE CASES - concurrent execution", () => {
    it("should handle concurrent tool calls correctly", async () => {
      let counter = 0;
      const handler = new MockToolHandler(
        "counter",
        "Counter",
        { type: "object" },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          counter++;
          return { content: [{ type: "text", text: `Count: ${counter}` }] };
        },
      );
      service.registerToolHandler(handler);

      const requests = Array.from({ length: 10 }, (_, i) => ({
        jsonrpc: "2.0" as const,
        id: i,
        method: "tools/call",
        params: { name: "counter" },
      }));

      const responses = await Promise.all(
        requests.map((req) => service.handleRequest(req, { apiKeyId: "test" })),
      );

      expect(responses).toHaveLength(10);
      expect(counter).toBe(10);

      const metrics = service.getMetrics();
      expect(metrics.totalCalls).toBe(10);
      expect(metrics.successCount).toBe(10);
    });
  });

  describe("5. DFX - Session LRU eviction", () => {
    it("should maintain session count under LRU limit", async () => {
      // Session manager handles LRU eviction
      mockSessionManager.getAllSessions.mockReturnValue(
        Array.from({ length: 1000 }, (_, i) => ({
          sessionId: `mcp-session${i}`,
          apiKeyId: `key${i}`,
          createdAt: new Date(),
          lastActiveAt: new Date(),
        })),
      );

      const sessions = service.getSessions();
      expect(sessions.length).toBeLessThanOrEqual(1000);
    });
  });

  describe("5. DFX - Metrics circular buffer behavior", () => {
    it("should maintain metrics length after exceeding MAX_METRICS", async () => {
      const MAX_METRICS = 10000;
      const handler = new MockToolHandler("test", "Test", { type: "object" });
      service.registerToolHandler(handler);

      for (let i = 0; i < MAX_METRICS + 200; i++) {
        await service.handleRequest(
          {
            jsonrpc: "2.0",
            id: i,
            method: "tools/call",
            params: { name: "test" },
          },
          { apiKeyId: "key1" },
        );
      }

      const metricsInternal = (service as any).metrics;
      expect(metricsInternal.length).toBeLessThanOrEqual(MAX_METRICS);
    });
  });

  describe("5. DFX - Error type tracking", () => {
    it("should track error types in metrics", async () => {
      const handler = new MockToolHandler(
        "typed-error",
        "Typed error",
        { type: "object" },
        async () => {
          const error = new Error("Custom error");
          error.name = "CustomErrorType";
          throw error;
        },
      );
      service.registerToolHandler(handler);

      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "typed-error" },
        },
        { apiKeyId: "key1" },
      );

      const metrics = service.getMetrics();
      expect(metrics.recentErrors).toHaveLength(1);
      expect(metrics.recentErrors[0].toolName).toBe("typed-error");
      expect(metrics.recentErrors[0].errorType).toBe("CustomErrorType");
      expect(metrics.recentErrors[0].timestamp).toBeInstanceOf(Date);
    });
  });
});

describe("MCPServerService with Guardrails", () => {
  let service: MCPServerService;
  let mockGuardrailsPipeline: jest.Mocked<GuardrailsPipelineService>;
  let mockConfigService: jest.Mocked<Partial<ConfigService>>;
  let mockSessionManager: jest.Mocked<MCPSessionManager>;

  beforeEach(async () => {
    mockGuardrailsPipeline = {
      processInput: jest.fn(),
      processOutput: jest.fn(),
    } as any;

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === "GUARDRAILS_ENABLED") return "true";
        if (key === "GUARDRAILS_FAIL_CLOSED") return "false";
        return undefined;
      }),
    };

    mockSessionManager = {
      createSession: jest.fn((apiKeyId: string, clientInfo?: any) => ({
        sessionId: `mcp-${Math.random().toString(16).slice(2)}`,
        apiKeyId,
        clientInfo,
        createdAt: new Date(),
        lastActiveAt: new Date(),
      })),
      getSession: jest.fn(),
      getStats: jest.fn(() => ({
        activeSessions: 0,
        byClient: {},
        byApiKey: {},
      })),
      isToolAllowed: jest.fn(() => true),
      isResourceAllowed: jest.fn(() => true),
      isPromptAllowed: jest.fn(() => true),
      consumeQuota: jest.fn(() => true),
      validateAndConsumeQuota: jest.fn(() => ({ allowed: true })),
      getAllSessions: jest.fn(() => []),
      terminateSession: jest.fn(() => true),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MCPServerService,
        { provide: MCPSessionManager, useValue: mockSessionManager },
        {
          provide: GuardrailsPipelineService,
          useValue: mockGuardrailsPipeline,
        },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MCPServerService>(MCPServerService);
    service.onModuleInit();
  });

  describe("3. GUARDRAILS - Input validation", () => {
    it("should block request when input guardrail fails", async () => {
      const handler = new MockToolHandler("test-tool", "Test", {
        type: "object",
      });
      service.registerToolHandler(handler);

      mockGuardrailsPipeline.processInput.mockResolvedValue({
        passed: false,
        results: [],
      });

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test-tool", arguments: { data: "malicious" } },
      };

      const response = await service.handleRequest(request, {
        apiKeyId: "key1",
      });
      const result = (response as JsonRpcResponse).result as MCPToolResponse;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Request blocked by security policy");
      expect(mockGuardrailsPipeline.processInput).toHaveBeenCalledWith({
        content: JSON.stringify({ data: "malicious" }),
        context: { toolName: "test-tool", sessionId: undefined },
      });
    });

    it("should allow request when input guardrail passes", async () => {
      const handler = new MockToolHandler("test-tool", "Test", {
        type: "object",
      });
      service.registerToolHandler(handler);

      mockGuardrailsPipeline.processInput.mockResolvedValue({
        passed: true,
        results: [],
      });

      mockGuardrailsPipeline.processOutput.mockResolvedValue({
        passed: true,
        results: [],
      });

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test-tool", arguments: { data: "safe" } },
      };

      const response = await service.handleRequest(request, {
        apiKeyId: "key1",
      });
      const result = (response as JsonRpcResponse).result as MCPToolResponse;

      expect(result.isError).toBeUndefined();
      expect(mockGuardrailsPipeline.processInput).toHaveBeenCalled();
    });

    it("should execute tool when input guardrail throws and fail-open", async () => {
      const handler = new MockToolHandler("test-tool", "Test", {
        type: "object",
      });
      service.registerToolHandler(handler);

      mockGuardrailsPipeline.processInput.mockRejectedValue(
        new Error("Guardrail service unavailable"),
      );
      mockGuardrailsPipeline.processOutput.mockResolvedValue({
        passed: true,
        results: [],
      });

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test-tool" },
      };

      const response = await service.handleRequest(request, {
        apiKeyId: "key1",
      });
      const result = (response as JsonRpcResponse).result as MCPToolResponse;

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("test-tool");
    });

    it("should block when input guardrail throws and fail-closed", async () => {
      mockConfigService.get = jest.fn((key: string) => {
        if (key === "GUARDRAILS_ENABLED") return "true";
        if (key === "GUARDRAILS_FAIL_CLOSED") return "true";
        return undefined;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MCPServerService,
          { provide: MCPSessionManager, useValue: mockSessionManager },
          {
            provide: GuardrailsPipelineService,
            useValue: mockGuardrailsPipeline,
          },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      service = module.get<MCPServerService>(MCPServerService);
      service.onModuleInit();

      const handler = new MockToolHandler("test-tool", "Test", {
        type: "object",
      });
      service.registerToolHandler(handler);

      mockGuardrailsPipeline.processInput.mockRejectedValue(
        new Error("Guardrail service unavailable"),
      );

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test-tool" },
      };

      const response = await service.handleRequest(request, {
        apiKeyId: "key1",
      });
      const result = (response as JsonRpcResponse).result as MCPToolResponse;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Security validation unavailable");
    });
  });

  describe("3. GUARDRAILS - Output validation", () => {
    it("should block response when output guardrail fails", async () => {
      const handler = new MockToolHandler(
        "test-tool",
        "Test",
        { type: "object" },
        async () => ({
          content: [{ type: "text", text: "sensitive data" }],
        }),
      );
      service.registerToolHandler(handler);

      mockGuardrailsPipeline.processInput.mockResolvedValue({
        passed: true,
        results: [],
      });

      mockGuardrailsPipeline.processOutput.mockResolvedValue({
        passed: false,
        results: [],
      });

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test-tool" },
      };

      const response = await service.handleRequest(request, {
        apiKeyId: "key1",
      });
      const result = (response as JsonRpcResponse).result as MCPToolResponse;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(
        "Response blocked by security policy",
      );
    });

    it("should return result when output guardrail passes", async () => {
      const handler = new MockToolHandler(
        "test-tool",
        "Test",
        { type: "object" },
        async () => ({
          content: [{ type: "text", text: "safe output" }],
        }),
      );
      service.registerToolHandler(handler);

      mockGuardrailsPipeline.processInput.mockResolvedValue({
        passed: true,
        results: [],
      });

      mockGuardrailsPipeline.processOutput.mockResolvedValue({
        passed: true,
        results: [],
      });

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test-tool" },
      };

      const response = await service.handleRequest(request, {
        apiKeyId: "key1",
      });
      const result = (response as JsonRpcResponse).result as MCPToolResponse;

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe("safe output");
    });

    it("should return result when output guardrail throws and fail-open", async () => {
      const handler = new MockToolHandler(
        "test-tool",
        "Test",
        { type: "object" },
        async () => ({
          content: [{ type: "text", text: "output" }],
        }),
      );
      service.registerToolHandler(handler);

      mockGuardrailsPipeline.processInput.mockResolvedValue({
        passed: true,
        results: [],
      });

      mockGuardrailsPipeline.processOutput.mockRejectedValue(
        new Error("Output check failed"),
      );

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test-tool" },
      };

      const response = await service.handleRequest(request, {
        apiKeyId: "key1",
      });
      const result = (response as JsonRpcResponse).result as MCPToolResponse;

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe("output");
    });

    it("should block when output guardrail throws and fail-closed", async () => {
      mockConfigService.get = jest.fn((key: string) => {
        if (key === "GUARDRAILS_ENABLED") return "true";
        if (key === "GUARDRAILS_FAIL_CLOSED") return "true";
        return undefined;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MCPServerService,
          { provide: MCPSessionManager, useValue: mockSessionManager },
          {
            provide: GuardrailsPipelineService,
            useValue: mockGuardrailsPipeline,
          },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      service = module.get<MCPServerService>(MCPServerService);
      service.onModuleInit();

      const handler = new MockToolHandler(
        "test-tool",
        "Test",
        { type: "object" },
        async () => ({
          content: [{ type: "text", text: "output" }],
        }),
      );
      service.registerToolHandler(handler);

      mockGuardrailsPipeline.processInput.mockResolvedValue({
        passed: true,
        results: [],
      });

      mockGuardrailsPipeline.processOutput.mockRejectedValue(
        new Error("Output check failed"),
      );

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test-tool" },
      };

      const response = await service.handleRequest(request, {
        apiKeyId: "key1",
      });
      const result = (response as JsonRpcResponse).result as MCPToolResponse;

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Security validation unavailable");
    });
  });

  describe("3. GUARDRAILS - Disabled state", () => {
    it("should skip guardrails checks when disabled", async () => {
      mockConfigService.get = jest.fn((key: string) => {
        if (key === "GUARDRAILS_ENABLED") return "false";
        return undefined;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MCPServerService,
          { provide: MCPSessionManager, useValue: mockSessionManager },
          {
            provide: GuardrailsPipelineService,
            useValue: mockGuardrailsPipeline,
          },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      service = module.get<MCPServerService>(MCPServerService);
      service.onModuleInit();

      const handler = new MockToolHandler("test-tool", "Test", {
        type: "object",
      });
      service.registerToolHandler(handler);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test-tool" },
      };

      await service.handleRequest(request, { apiKeyId: "key1" });

      expect(mockGuardrailsPipeline.processInput).not.toHaveBeenCalled();
      expect(mockGuardrailsPipeline.processOutput).not.toHaveBeenCalled();
    });
  });
});
