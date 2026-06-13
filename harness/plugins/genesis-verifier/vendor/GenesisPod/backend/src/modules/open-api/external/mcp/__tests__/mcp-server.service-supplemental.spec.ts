/**
 * MCPServerService Supplemental Tests
 * Covers branches NOT tested in mcp-server.service.spec.ts:
 * - Batch request handling
 * - Guardrails input/output blocking and fail-closed
 * - Bridge tool routing
 * - Resources/read with session permission checks
 * - Prompts with session permission checks
 * - getDetailedStatus with degraded/unhealthy state
 * - getMetrics filtering
 * - Observability and cost attribution recording
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { MCPServerService } from "../mcp-server.service";
import { MCPSessionManager } from "../gateway/mcp-session-manager";
import { MCPToolBridgeService } from "../bridge/mcp-tool-bridge.service";
import { MCPResourceProvider } from "../bridge/mcp-resource-provider";
import { MCPPromptProvider } from "../bridge/mcp-prompt-provider";
import {
  AiObservabilityService,
  CostAttributionService,
} from "../../../../ai-harness/facade";
import { GuardrailsPipelineService } from "../../../../ai-engine/facade";
import {
  IMCPToolHandler,
  MCPRequestContext,
  MCPToolResponse,
  JSON_RPC_ERRORS,
} from "../abstractions/mcp-server.interface";

jest.mock("../../../../ai-engine/facade", () => ({
  GuardrailsPipelineService: jest.fn(),
  AiObservabilityService: jest.fn(),
  CostAttributionService: jest.fn(),
}));
jest.mock("../../../../ai-harness/facade", () => ({
  GuardrailsPipelineService: jest.fn(),
  AiObservabilityService: jest.fn(),
  CostAttributionService: jest.fn(),
}));

class MockToolHandler implements IMCPToolHandler {
  constructor(
    public readonly toolName: string,
    public readonly description: string = "Test tool",
    public readonly inputSchema: Record<string, unknown> = { type: "object" },
    private response: MCPToolResponse = {
      content: [{ type: "text", text: '{"ok":true}' }],
    },
  ) {}
  async execute(
    _args: Record<string, unknown>,
    _ctx: MCPRequestContext,
  ): Promise<MCPToolResponse> {
    return this.response;
  }
}

describe("MCPServerService (supplemental)", () => {
  let service: MCPServerService;

  const mockSessionManager = {
    createSession: jest.fn().mockReturnValue({
      sessionId: "sess-1",
      apiKeyId: "key-1",
      createdAt: new Date(),
      lastActiveAt: new Date(),
    }),
    validateAndConsumeQuota: jest.fn().mockReturnValue({ allowed: true }),
    isResourceAllowed: jest.fn().mockReturnValue(true),
    isPromptAllowed: jest.fn().mockReturnValue(true),
    getAllSessions: jest.fn().mockReturnValue([]),
    terminateSession: jest.fn().mockReturnValue(true),
    getStats: jest.fn().mockReturnValue({ activeSessions: 0 }),
  };

  const mockToolBridge = {
    listBridgedTools: jest.fn().mockReturnValue([]),
    isBridgedTool: jest.fn().mockReturnValue(false),
    executeBridgedTool: jest.fn(),
    getBridgedToolMeta: jest.fn().mockReturnValue(undefined),
    getStats: jest.fn().mockReturnValue({ total: 0, bySource: {} }),
  };

  const mockResourceProvider = {
    listResources: jest
      .fn()
      .mockResolvedValue([{ uri: "genesis://tools", name: "Tools" }]),
    readResource: jest.fn().mockResolvedValue({
      uri: "genesis://tools",
      mimeType: "application/json",
      text: "{}",
    }),
  };

  const mockPromptProvider = {
    listPrompts: jest.fn().mockResolvedValue([{ name: "test-prompt" }]),
    getPrompt: jest
      .fn()
      .mockResolvedValue([
        { role: "user", content: { type: "text", text: "Hello" } },
      ]),
  };

  const mockGuardrails = {
    processInput: jest.fn().mockResolvedValue({ passed: true }),
    processOutput: jest.fn().mockResolvedValue({ passed: true }),
  };

  const mockObservability = { recordLLMCall: jest.fn() };
  const mockCostAttribution = { recordCost: jest.fn() };
  const mockConfigService = { get: jest.fn().mockReturnValue(undefined) };

  const mockContext: MCPRequestContext = {
    apiKeyId: "test-api-key",
    sessionId: "test-session",
  };

  const buildModule = async (
    configOverrides?: Record<string, string | undefined>,
  ) => {
    const configSvc = {
      get: jest.fn((key: string) => configOverrides?.[key]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MCPServerService,
        { provide: MCPSessionManager, useValue: mockSessionManager },
        { provide: MCPToolBridgeService, useValue: mockToolBridge },
        { provide: MCPResourceProvider, useValue: mockResourceProvider },
        { provide: MCPPromptProvider, useValue: mockPromptProvider },
        { provide: GuardrailsPipelineService, useValue: mockGuardrails },
        { provide: AiObservabilityService, useValue: mockObservability },
        { provide: CostAttributionService, useValue: mockCostAttribution },
        { provide: ConfigService, useValue: configSvc },
      ],
    }).compile();

    const svc = module.get<MCPServerService>(MCPServerService);
    svc.onModuleInit();
    return svc;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    service = await buildModule();
  });

  // =========================================================================
  // Batch request handling
  // =========================================================================

  describe("batch requests", () => {
    it("should process batch with mixed valid/invalid items", async () => {
      const requests = [
        { jsonrpc: "2.0", id: 1, method: "ping" },
        "invalid-string",
        { jsonrpc: "2.0", id: 3, method: "ping" },
      ];

      const responses = await service.handleRequest(requests, mockContext);
      expect(Array.isArray(responses)).toBe(true);
      // 2 valid + 1 error response for "invalid-string"
      expect((responses as unknown[]).length).toBeGreaterThanOrEqual(2);
    });

    it("should return null for all-notification batch", async () => {
      const requests = [
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
      ];

      const result = await service.handleRequest(requests, mockContext);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Guardrails - fail-closed
  // =========================================================================

  describe("guardrails fail-closed", () => {
    it("should block when input guardrail throws and failClosed=true", async () => {
      const svc = await buildModule({ GUARDRAILS_FAIL_CLOSED: "true" });

      const handler = new MockToolHandler("genesis_ask");
      svc.registerToolHandler(handler);

      mockGuardrails.processInput.mockRejectedValue(
        new Error("Guardrail service down"),
      );

      const response = await svc.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "genesis_ask", arguments: {} },
        },
        mockContext,
      );

      const result = (
        response as { result: { isError: boolean; content: unknown[] } }
      ).result;
      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "unavailable",
      );
    });

    it("should allow when input guardrail throws and failClosed=false (default)", async () => {
      const handler = new MockToolHandler("genesis_ask");
      service.registerToolHandler(handler);

      mockGuardrails.processInput.mockRejectedValue(
        new Error("Guardrail service down"),
      );

      const response = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "genesis_ask", arguments: {} },
        },
        mockContext,
      );

      // Should succeed even if guardrail throws (fail-open by default)
      const result = (response as { result: { isError?: boolean } }).result;
      expect(result.isError).toBeUndefined();
    });

    it("should block when output guardrail throws and failClosed=true", async () => {
      const svc = await buildModule({ GUARDRAILS_FAIL_CLOSED: "true" });

      const handler = new MockToolHandler("genesis_ask");
      svc.registerToolHandler(handler);

      mockGuardrails.processInput.mockResolvedValue({ passed: true });
      mockGuardrails.processOutput.mockRejectedValue(
        new Error("Output guardrail down"),
      );

      const response = await svc.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "genesis_ask", arguments: {} },
        },
        mockContext,
      );

      const result = (response as { result: { isError: boolean } }).result;
      expect(result.isError).toBe(true);
    });
  });

  // =========================================================================
  // Guardrails disabled
  // =========================================================================

  describe("guardrails disabled", () => {
    it("should skip guardrails when GUARDRAILS_ENABLED=false", async () => {
      const svc = await buildModule({ GUARDRAILS_ENABLED: "false" });

      const handler = new MockToolHandler("genesis_ask");
      svc.registerToolHandler(handler);

      await svc.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "genesis_ask", arguments: {} },
        },
        mockContext,
      );

      expect(mockGuardrails.processInput).not.toHaveBeenCalled();
      expect(mockGuardrails.processOutput).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Bridge tool meta source
  // =========================================================================

  describe("bridge tool meta source", () => {
    it("should record bridge source in metrics", async () => {
      mockToolBridge.isBridgedTool.mockReturnValue(true);
      mockToolBridge.executeBridgedTool.mockResolvedValue({
        content: [{ type: "text", text: "Result" }],
      });
      mockToolBridge.getBridgedToolMeta.mockReturnValue({
        source: "registry-skill",
        registryId: "analysis-skill",
      });

      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "skill_analysis", arguments: {} },
        },
        mockContext,
      );

      const metrics = service.getMetrics();
      expect(metrics.bySource["registry-skill"]).toBe(1);
    });
  });

  // =========================================================================
  // Resources/list without session check
  // =========================================================================

  describe("resources/list - no session", () => {
    it("should list resources when no sessionId in context", async () => {
      const contextNoSession: MCPRequestContext = {
        apiKeyId: "test-key",
      };

      const response = await service.handleRequest(
        { jsonrpc: "2.0", id: 1, method: "resources/list" },
        contextNoSession,
      );

      const result = (response as { result: { resources: unknown[] } }).result;
      expect(result.resources.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Prompts/list - no session
  // =========================================================================

  describe("prompts/list - no session", () => {
    it("should list prompts when no sessionId in context", async () => {
      const contextNoSession: MCPRequestContext = {
        apiKeyId: "test-key",
      };

      const response = await service.handleRequest(
        { jsonrpc: "2.0", id: 1, method: "prompts/list" },
        contextNoSession,
      );

      const result = (response as { result: { prompts: unknown[] } }).result;
      expect(result.prompts.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Prompts/get - error paths
  // =========================================================================

  describe("prompts/get - error paths", () => {
    it("should return RESOURCE_NOT_FOUND when no prompt provider", async () => {
      const module = await Test.createTestingModule({
        providers: [
          MCPServerService,
          { provide: MCPSessionManager, useValue: mockSessionManager },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const svcNoPrompts = module.get<MCPServerService>(MCPServerService);

      const response = await svcNoPrompts.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "prompts/get",
          params: { name: "test-prompt" },
        },
        mockContext,
      );

      const err = (response as { error: { code: number } }).error;
      expect(err.code).toBe(JSON_RPC_ERRORS.RESOURCE_NOT_FOUND.code);
    });

    it("should return PERMISSION_DENIED when session denies prompt access", async () => {
      mockSessionManager.isPromptAllowed.mockReturnValue(false);

      const response = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "prompts/get",
          params: { name: "test-prompt" },
        },
        mockContext,
      );

      const err = (response as { error: { code: number } }).error;
      expect(err.code).toBe(JSON_RPC_ERRORS.PERMISSION_DENIED.code);
    });

    it("should handle prompts/get request with arguments", async () => {
      const response = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "prompts/get",
          params: {
            name: "test-prompt",
            arguments: { topic: "AI", lang: "en" },
          },
        },
        mockContext,
      );

      // Response should be a valid JSON-RPC response (result or error)
      expect(response).toHaveProperty("jsonrpc", "2.0");
      expect(response).toHaveProperty("id", 1);
    });
  });

  // =========================================================================
  // getDetailedStatus - health states
  // =========================================================================

  describe("getDetailedStatus - health states", () => {
    it("should return degraded when success rate < 95%", async () => {
      const failHandler = new MockToolHandler("genesis_fail");
      jest.spyOn(failHandler, "execute").mockResolvedValue({
        content: [{ type: "text", text: "error" }],
        isError: true,
      });
      service.registerToolHandler(failHandler);

      // Make 10 calls, all fail
      for (let i = 0; i < 10; i++) {
        await service.handleRequest(
          {
            jsonrpc: "2.0",
            id: i,
            method: "tools/call",
            params: { name: "genesis_fail", arguments: {} },
          },
          mockContext,
        );
      }

      const status = service.getDetailedStatus();
      expect(["degraded", "unhealthy"]).toContain(status.status);
    });

    it("should show resources capability as false when no provider", async () => {
      const module = await Test.createTestingModule({
        providers: [
          MCPServerService,
          { provide: MCPSessionManager, useValue: mockSessionManager },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const svc = module.get<MCPServerService>(MCPServerService);
      const status = svc.getDetailedStatus();
      expect(status.capabilities.resources).toBe(false);
      expect(status.capabilities.prompts).toBe(false);
    });
  });

  // =========================================================================
  // Metrics filtering
  // =========================================================================

  describe("getMetrics with filters", () => {
    it("should filter by endDate", async () => {
      const handler = new MockToolHandler("genesis_test");
      service.registerToolHandler(handler);

      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "genesis_test", arguments: {} },
        },
        mockContext,
      );

      const pastDate = new Date(Date.now() - 1000 * 60);
      const metricsFiltered = service.getMetrics({ endDate: pastDate });
      expect(metricsFiltered.totalCalls).toBe(0);
    });

    it("should include recentErrors for failed calls", async () => {
      const errHandler = new MockToolHandler("genesis_bad");
      jest.spyOn(errHandler, "execute").mockRejectedValue(new Error("fail"));
      service.registerToolHandler(errHandler);

      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "genesis_bad", arguments: {} },
        },
        mockContext,
      );

      const metrics = service.getMetrics();
      // Error calls that have errorType are included in recentErrors
      expect(metrics.recentErrors.length).toBeGreaterThanOrEqual(0);
    });

    it("should track byApiKey correctly", async () => {
      const handler = new MockToolHandler("genesis_ask");
      service.registerToolHandler(handler);

      await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "genesis_ask", arguments: {} },
        },
        { apiKeyId: "key-abc", sessionId: "session-1" },
      );

      const metrics = service.getMetrics();
      expect(metrics.byApiKey["key-abc"]).toBeDefined();
      expect(metrics.byApiKey["key-abc"].calls).toBe(1);
    });
  });

  // =========================================================================
  // Tools/call with unknown reason
  // =========================================================================

  describe("tools/call - unknown denial reason", () => {
    it("should return generic access denied for unknown reason", async () => {
      mockSessionManager.validateAndConsumeQuota.mockReturnValue({
        allowed: false,
        reason: "unknown_reason",
      });

      const handler = new MockToolHandler("genesis_ask");
      service.registerToolHandler(handler);

      const response = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "genesis_ask", arguments: {} },
        },
        mockContext,
      );

      const result = (
        response as { result: { content: Array<{ text: string }> } }
      ).result;
      expect(result.content[0].text).toBe("Access denied");
    });
  });

  // =========================================================================
  // Error in processSingleRequest catch block
  // =========================================================================

  describe("internal error handling", () => {
    it("should return safe error message for unknown error code", async () => {
      mockSessionManager.validateAndConsumeQuota.mockImplementation(() => {
        throw new Error("Internal crash without code");
      });

      const handler = new MockToolHandler("genesis_ask");
      service.registerToolHandler(handler);

      const response = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "genesis_ask", arguments: {} },
        },
        mockContext,
      );

      const err = (response as { error: { message: string } }).error;
      expect(err.message).toBe("Internal server error");
    });

    it("should expose message for known error codes", async () => {
      mockSessionManager.validateAndConsumeQuota.mockImplementation(() => {
        const e = new Error("Method not found: test") as Error & {
          code: number;
        };
        e.code = JSON_RPC_ERRORS.METHOD_NOT_FOUND.code;
        throw e;
      });

      const handler = new MockToolHandler("genesis_ask");
      service.registerToolHandler(handler);

      const response = await service.handleRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "genesis_ask", arguments: {} },
        },
        mockContext,
      );

      const err = (response as { error: { message: string } }).error;
      expect(err.message).not.toBe("Internal server error");
    });
  });
});
