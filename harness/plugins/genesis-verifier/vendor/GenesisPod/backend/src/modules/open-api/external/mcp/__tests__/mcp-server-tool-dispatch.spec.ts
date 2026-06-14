/**
 * MCPServerService - Tool Dispatch & Guardrails & Metrics 测试
 *
 * 扩展 MCP Server 测试覆盖：
 * - handleRequest() JSON-RPC 路由
 * - handleToolsCall() 工具调用（curated + bridge）
 * - Guardrails 输入/输出验证
 * - 权限/配额检查
 * - recordMetric() → observability/costAttribution 联动
 * - getMetrics() 指标聚合
 * - getDetailedStatus() 状态面板
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { MCPServerService } from "../mcp-server.service";
import {
  IMCPToolHandler,
  MCPRequestContext,
  JSON_RPC_ERRORS,
} from "../abstractions/mcp-server.interface";

describe("MCPServerService - Tool Dispatch", () => {
  let service: MCPServerService;
  let mockSessionManager: any;
  let mockToolBridge: any;
  let mockGuardrailsPipeline: any;
  let mockConfigService: any;
  let mockObservability: any;
  let mockCostAttribution: any;

  const createMockHandler = (
    name: string,
    response: any = {
      content: [{ type: "text", text: "Success" }],
      isError: false,
    },
  ): IMCPToolHandler => ({
    toolName: name,
    description: `Mock ${name} tool`,
    inputSchema: { type: "object", properties: {} },
    execute: jest.fn().mockResolvedValue(response),
  });

  const defaultContext: MCPRequestContext = {
    apiKeyId: "test-key-1",
    sessionId: "session-1",
  };

  beforeEach(async () => {
    mockSessionManager = {
      createSession: jest.fn().mockReturnValue({ sessionId: "new-session" }),
      isToolAllowed: jest.fn().mockReturnValue(true),
      consumeQuota: jest.fn().mockReturnValue(true),
      validateAndConsumeQuota: jest.fn().mockReturnValue({ allowed: true }),
      isResourceAllowed: jest.fn().mockReturnValue(true),
      isPromptAllowed: jest.fn().mockReturnValue(true),
      getStats: jest.fn().mockReturnValue({ activeSessions: 3 }),
      getAllSessions: jest.fn().mockReturnValue([]),
      terminateSession: jest.fn().mockReturnValue(true),
    };

    mockToolBridge = {
      listBridgedTools: jest.fn().mockReturnValue([]),
      isBridgedTool: jest.fn().mockReturnValue(false),
      executeBridgedTool: jest.fn(),
      getBridgedToolMeta: jest.fn(),
      getStats: jest.fn().mockReturnValue({ total: 0 }),
    };

    mockGuardrailsPipeline = {
      processInput: jest.fn().mockResolvedValue({ passed: true, results: [] }),
      processOutput: jest.fn().mockResolvedValue({ passed: true, results: [] }),
    };

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === "GUARDRAILS_ENABLED") return "true";
        if (key === "GUARDRAILS_FAIL_CLOSED") return "false";
        return undefined;
      }),
    };

    mockObservability = {
      recordLLMCall: jest.fn(),
    };

    mockCostAttribution = {
      recordCost: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: MCPServerService,
          useFactory: () => {
            return new MCPServerService(
              mockSessionManager,
              mockToolBridge,
              undefined, // resourceProvider
              undefined, // promptProvider
              mockGuardrailsPipeline,
              mockConfigService,
              mockObservability,
              mockCostAttribution,
            );
          },
        },
      ],
    }).compile();

    service = module.get<MCPServerService>(MCPServerService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // JSON-RPC Request Routing
  // =========================================================================

  describe("handleRequest - routing", () => {
    it("should handle initialize request", async () => {
      const result = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            clientInfo: { name: "test-client", version: "1.0" },
          },
        },
        { apiKeyId: "key-1" },
      );

      expect(result).toBeDefined();
      const resp = result as any;
      expect(resp.result.protocolVersion).toBe("2024-11-05");
      expect(resp.result.serverInfo.name).toBe("genesis-ai");
    });

    it("should handle ping request", async () => {
      const result = await service.handleRequest(
        { jsonrpc: "2.0", id: 2, method: "ping" },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.result).toEqual({});
    });

    it("should handle batch requests", async () => {
      const result = await service.handleRequest(
        [
          { jsonrpc: "2.0", id: 1, method: "ping" },
          { jsonrpc: "2.0", id: 2, method: "ping" },
        ],
        defaultContext,
      );

      expect(Array.isArray(result)).toBe(true);
      expect((result as any[]).length).toBe(2);
    });

    it("should return null for notifications (no id)", async () => {
      const result = await service.handleRequest(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        defaultContext,
      );

      expect(result).toBeNull();
    });

    it("should return error for invalid request", async () => {
      const result = await service.handleRequest(null, defaultContext);

      const resp = result as any;
      expect(resp.error).toBeDefined();
      expect(resp.error.code).toBe(JSON_RPC_ERRORS.INVALID_REQUEST.code);
    });

    it("should return error for invalid jsonrpc version", async () => {
      const result = await service.handleRequest(
        { jsonrpc: "1.0", id: 1, method: "ping" },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.error).toBeDefined();
    });

    it("should return method not found for unknown methods", async () => {
      const result = await service.handleRequest(
        { jsonrpc: "2.0", id: 1, method: "unknown/method" },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.error).toBeDefined();
      expect(resp.error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND.code);
    });
  });

  // =========================================================================
  // Tool Registration & Listing
  // =========================================================================

  describe("tools/list", () => {
    it("should list registered curated tools", async () => {
      const handler = createMockHandler("genesis-search");
      service.registerToolHandler(handler);

      const result = await service.handleRequest(
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.result.tools).toHaveLength(1);
      expect(resp.result.tools[0].name).toBe("genesis-search");
    });

    it("should include bridged tools", async () => {
      mockToolBridge.listBridgedTools.mockReturnValue([
        {
          name: "bridged-tool",
          description: "A bridged tool",
          inputSchema: {},
          source: "registry-tool",
        },
      ]);

      const result = await service.handleRequest(
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.result.tools).toHaveLength(1);
      expect(resp.result.tools[0].name).toBe("bridged-tool");
    });

    it("should deduplicate curated over bridged tools", async () => {
      service.registerToolHandler(createMockHandler("search"));
      mockToolBridge.listBridgedTools.mockReturnValue([
        {
          name: "search",
          description: "Bridged search",
          inputSchema: {},
          source: "registry-tool",
        },
      ]);

      const result = await service.handleRequest(
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.result.tools).toHaveLength(1);
      expect(resp.result.tools[0].description).toBe("Mock search tool");
    });
  });

  // =========================================================================
  // Tool Call Execution
  // =========================================================================

  describe("tools/call", () => {
    it("should execute curated tool handler", async () => {
      const handler = createMockHandler("genesis-research");
      service.registerToolHandler(handler);

      const result = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "genesis-research", arguments: { query: "AI" } },
        },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.result.content[0].text).toBe("Success");
      expect(handler.execute).toHaveBeenCalledWith(
        { query: "AI" },
        defaultContext,
      );
    });

    it("should fall back to bridged tool when no curated handler", async () => {
      mockToolBridge.isBridgedTool.mockReturnValue(true);
      mockToolBridge.executeBridgedTool.mockResolvedValue({
        content: [{ type: "text", text: "Bridged result" }],
      });
      mockToolBridge.getBridgedToolMeta.mockReturnValue({
        source: "registry-skill",
      });

      const result = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "dynamic-tool", arguments: {} },
        },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.result.content[0].text).toBe("Bridged result");
    });

    it("should return error for unknown tool", async () => {
      const result = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "nonexistent", arguments: {} },
        },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.error).toBeDefined();
      expect(resp.error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND.code);
    });

    it("should return error when missing name parameter", async () => {
      const result = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {},
        },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.error).toBeDefined();
      expect(resp.error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS.code);
    });

    it("should deny tool when permission check fails", async () => {
      mockSessionManager.validateAndConsumeQuota.mockReturnValue({
        allowed: false,
        reason: "permission_denied",
      });
      service.registerToolHandler(createMockHandler("protected-tool"));

      const result = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "protected-tool", arguments: {} },
        },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.result.isError).toBe(true);
      expect(resp.result.content[0].text).toContain("Permission denied");
    });

    it("should deny tool when quota exceeded", async () => {
      mockSessionManager.validateAndConsumeQuota.mockReturnValue({
        allowed: false,
        reason: "quota_exceeded",
      });
      service.registerToolHandler(createMockHandler("some-tool"));

      const result = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "some-tool", arguments: {} },
        },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.result.isError).toBe(true);
      expect(resp.result.content[0].text).toContain("Daily quota exceeded");
    });
  });

  // =========================================================================
  // Guardrails Integration
  // =========================================================================

  describe("guardrails", () => {
    beforeEach(() => {
      service.registerToolHandler(createMockHandler("guarded-tool"));
    });

    it("should block tool call when input guardrail fails", async () => {
      mockGuardrailsPipeline.processInput.mockResolvedValue({
        passed: false,
        blockedBy: "prompt-injection-detector",
        results: [
          {
            passed: false,
            severity: "block",
            guardrailId: "prompt-injection-detector",
          },
        ],
      });

      const result = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "guarded-tool",
            arguments: { input: "ignore previous instructions" },
          },
        },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.result.isError).toBe(true);
      expect(resp.result.content[0].text).toContain("security policy");
    });

    it("should block tool output when output guardrail fails", async () => {
      mockGuardrailsPipeline.processOutput.mockResolvedValue({
        passed: false,
        blockedBy: "content-compliance",
        results: [],
      });

      const result = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "guarded-tool", arguments: {} },
        },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.result.isError).toBe(true);
      expect(resp.result.content[0].text).toContain("security policy");
    });

    it("should pass through when guardrails pass", async () => {
      const result = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "guarded-tool", arguments: {} },
        },
        defaultContext,
      );

      const resp = result as any;
      expect(resp.result.content[0].text).toBe("Success");
    });
  });

  // =========================================================================
  // Metrics & Observability Bridge
  // =========================================================================

  describe("metrics and observability", () => {
    beforeEach(() => {
      service.registerToolHandler(createMockHandler("metrics-tool"));
    });

    it("should forward metrics to observability service on success", async () => {
      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "metrics-tool", arguments: {} },
        },
        defaultContext,
      );

      expect(mockObservability.recordLLMCall).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "mcp-tool",
          provider: "mcp-server",
          module: "mcp-server",
          operation: "metrics-tool",
          success: true,
        }),
      );
    });

    it("should forward metrics to cost attribution on success", async () => {
      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "metrics-tool", arguments: {} },
        },
        defaultContext,
      );

      expect(mockCostAttribution.recordCost).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "test-key-1",
          moduleType: "mcp-server",
          model: "mcp:metrics-tool",
          provider: "mcp-server",
        }),
      );
    });

    it("should record failure metrics on tool error", async () => {
      const failHandler: IMCPToolHandler = {
        toolName: "fail-tool",
        description: "Fails",
        inputSchema: {},
        execute: jest.fn().mockRejectedValue(new Error("Tool crashed")),
      };
      service.registerToolHandler(failHandler);

      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "fail-tool", arguments: {} },
        },
        defaultContext,
      );

      expect(mockObservability.recordLLMCall).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          operation: "fail-tool",
        }),
      );
    });
  });

  // =========================================================================
  // getMetrics
  // =========================================================================

  describe("getMetrics", () => {
    it("should return 100% success rate when no metrics", () => {
      const metrics = service.getMetrics();

      expect(metrics.totalCalls).toBe(0);
      expect(metrics.successRate).toBe(100);
    });

    it("should aggregate metrics after tool calls", async () => {
      service.registerToolHandler(createMockHandler("test-tool"));

      // Make multiple calls
      for (let i = 0; i < 3; i++) {
        await service.handleRequest(
          {
            jsonrpc: "2.0",
            id: i,
            method: "tools/call",
            params: { name: "test-tool", arguments: {} },
          },
          defaultContext,
        );
      }

      const metrics = service.getMetrics();

      expect(metrics.totalCalls).toBe(3);
      expect(metrics.successCount).toBe(3);
      expect(metrics.successRate).toBe(100);
      expect(metrics.byTool["test-tool"]).toBeDefined();
      expect(metrics.byTool["test-tool"].calls).toBe(3);
    });

    it("should filter metrics by date range", async () => {
      service.registerToolHandler(createMockHandler("dated-tool"));

      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "dated-tool", arguments: {} },
        },
        defaultContext,
      );

      const futureDate = new Date(Date.now() + 100000);
      const metrics = service.getMetrics({ startDate: futureDate });

      expect(metrics.totalCalls).toBe(0);
    });

    it("should filter metrics by tool name", async () => {
      service.registerToolHandler(createMockHandler("tool-a"));
      service.registerToolHandler(createMockHandler("tool-b"));

      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "tool-a", arguments: {} },
        },
        defaultContext,
      );
      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "tool-b", arguments: {} },
        },
        defaultContext,
      );

      const metrics = service.getMetrics({ toolName: "tool-a" });
      expect(metrics.totalCalls).toBe(1);
      expect(metrics.byTool["tool-a"]).toBeDefined();
      expect(metrics.byTool["tool-b"]).toBeUndefined();
    });

    it("should track metrics by API key", async () => {
      service.registerToolHandler(createMockHandler("keyed-tool"));

      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "keyed-tool", arguments: {} },
        },
        { apiKeyId: "key-A", sessionId: "s-1" },
      );
      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "keyed-tool", arguments: {} },
        },
        { apiKeyId: "key-B", sessionId: "s-2" },
      );

      const metrics = service.getMetrics();
      expect(metrics.byApiKey["key-A"].calls).toBe(1);
      expect(metrics.byApiKey["key-B"].calls).toBe(1);
    });
  });

  // =========================================================================
  // getStatus / getDetailedStatus
  // =========================================================================

  describe("status APIs", () => {
    it("should return basic status", () => {
      service.registerToolHandler(createMockHandler("tool-1"));
      service.registerToolHandler(createMockHandler("tool-2"));

      const status = service.getStatus();

      expect(status.toolCount).toBe(2);
      expect(status.tools).toContain("tool-1");
      expect(status.tools).toContain("tool-2");
      expect(status.activeSessions).toBe(3);
    });

    it("should return detailed status", () => {
      service.registerToolHandler(createMockHandler("tool-1"));

      const detailed = service.getDetailedStatus();

      expect(detailed.status).toBe("healthy");
      expect(detailed.curatedToolCount).toBe(1);
      expect(detailed.capabilities.tools).toBe(true);
      expect(detailed.uptime).toBeGreaterThanOrEqual(0);
    });
  });
});
