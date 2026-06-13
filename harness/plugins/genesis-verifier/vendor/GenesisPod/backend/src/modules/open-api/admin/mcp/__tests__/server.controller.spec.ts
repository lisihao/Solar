/**
 * Unit tests for MCPServerController
 *
 * Mock the cache service to break the @nestjs/cache-manager transitive dependency
 * (not installed in this project's node_modules).
 */

// Break the chain: common/cache -> @nestjs/cache-manager (not installed in this project)
jest.mock("@/common/cache/cache.service", () => ({
  CacheService: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  })),
}));

jest.mock("@/common/cache/cache.module", () => ({
  CacheModule: { register: jest.fn() },
}));

jest.mock("@/common/cache", () => ({
  CacheService: jest.fn(),
  CacheModule: { register: jest.fn() },
}));

// Mock guard modules before any imports
jest.mock("../../../../../common/guards/jwt-auth.guard", () => ({
  JwtAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockReturnValue(true),
  })),
}));

jest.mock("../../../../../common/guards/admin.guard", () => ({
  AdminGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockReturnValue(true),
  })),
}));

// Mock entire ai-engine facade to prevent further transitive deps
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

import { Test, TestingModule } from "@nestjs/testing";
import { MCPServerController } from "../server.controller";
import { MCPServerService } from "../../../external/mcp/mcp-server.service";
import { MCPSessionManager } from "../../../external/mcp/gateway/mcp-session-manager";
import { MCPStreamingBridge } from "../../../external/mcp/streaming/mcp-streaming-bridge";
import { MCPToolBridgeService } from "../../../external/mcp/bridge/mcp-tool-bridge.service";

describe("MCPServerController", () => {
  let controller: MCPServerController;
  let mockMcpServerService: jest.Mocked<MCPServerService>;
  let mockSessionManager: jest.Mocked<MCPSessionManager>;
  let mockStreamingBridge: jest.Mocked<MCPStreamingBridge>;
  let mockToolBridge: jest.Mocked<MCPToolBridgeService>;

  const mockDetailedStatus = {
    status: "healthy" as const,
    uptime: 3600,
    toolCount: 8,
    curatedToolCount: 5,
    bridgedToolCount: 3,
    totalToolCount: 8,
    tools: [
      { name: "genesis_ask", description: "Ask AI", source: "curated" },
      {
        name: "genesis_deep_research",
        description: "Research",
        source: "curated",
      },
    ],
    activeSessions: 4,
    capabilities: {
      tools: true,
      resources: true,
      prompts: true,
      streaming: true,
    },
    metrics24h: {
      totalCalls: 120,
      successRate: 98.5,
      avgDuration: 1500,
    },
  };

  const mockSessionStats = {
    activeSessions: 4,
    byClient: { "claude-code": 3, cursor: 1 },
    byApiKey: { "key-1": 2, "key-2": 2 },
  };

  const mockSessions = [
    {
      sessionId: "mcp-abc123",
      apiKeyId: "key-1",
      createdAt: new Date("2026-01-01"),
      lastActiveAt: new Date("2026-01-01"),
    },
  ];

  const mockStreamingStats = {
    activeConnections: 2,
    connections: [
      {
        sessionId: "mcp-abc123",
        connectedAt: new Date("2026-01-01"),
        subscriptionCount: 3,
      },
    ],
  };

  const mockBridgeStats = {
    total: 3,
    bySource: { "registry-tool": 2, "registry-skill": 1 },
  };

  const mockMetrics = {
    totalCalls: 100,
    successCount: 98,
    errorCount: 2,
    successRate: 98,
    avgDuration: 1200,
    byTool: {},
    byApiKey: {},
    bySource: {},
    recentErrors: [],
  };

  beforeAll(async () => {
    mockMcpServerService = {
      getDetailedStatus: jest.fn(),
      getMetrics: jest.fn(),
      getSessions: jest.fn(),
    } as unknown as jest.Mocked<MCPServerService>;

    mockSessionManager = {
      getStats: jest.fn(),
    } as unknown as jest.Mocked<MCPSessionManager>;

    mockStreamingBridge = {
      getStats: jest.fn(),
    } as unknown as jest.Mocked<MCPStreamingBridge>;

    mockToolBridge = {
      getStats: jest.fn(),
    } as unknown as jest.Mocked<MCPToolBridgeService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MCPServerController],
      providers: [
        { provide: MCPServerService, useValue: mockMcpServerService },
        { provide: MCPSessionManager, useValue: mockSessionManager },
        { provide: MCPStreamingBridge, useValue: mockStreamingBridge },
        { provide: MCPToolBridgeService, useValue: mockToolBridge },
      ],
    }).compile();

    controller = module.get<MCPServerController>(MCPServerController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockMcpServerService.getDetailedStatus.mockReturnValue(mockDetailedStatus);
    mockMcpServerService.getMetrics.mockReturnValue(mockMetrics);
    mockMcpServerService.getSessions.mockReturnValue(mockSessions as never);
    mockSessionManager.getStats.mockReturnValue(mockSessionStats);
    mockStreamingBridge.getStats.mockReturnValue(mockStreamingStats);
    mockToolBridge.getStats.mockReturnValue(mockBridgeStats);
  });

  describe("getStatus", () => {
    it("should return detailed status from MCPServerService", async () => {
      const result = await controller.getStatus();

      expect(result).toEqual(mockDetailedStatus);
      expect(mockMcpServerService.getDetailedStatus).toHaveBeenCalledTimes(1);
    });

    it("should reflect status = healthy when service is healthy", async () => {
      const result = await controller.getStatus();
      expect(result.status).toBe("healthy");
    });

    it("should include capabilities in status", async () => {
      const result = await controller.getStatus();
      expect(result.capabilities).toBeDefined();
      expect(result.capabilities.tools).toBe(true);
    });
  });

  describe("getMetrics", () => {
    it("should call getMetrics with no filters when no query params", async () => {
      const result = await controller.getMetrics();

      expect(mockMcpServerService.getMetrics).toHaveBeenCalledWith({
        startDate: undefined,
        endDate: undefined,
        toolName: undefined,
      });
      expect(result).toEqual(mockMetrics);
    });

    it("should parse startDate string to Date object", async () => {
      await controller.getMetrics("2026-01-01T00:00:00.000Z");

      const call = mockMcpServerService.getMetrics.mock.calls[0][0];
      expect(call?.startDate).toBeInstanceOf(Date);
    });

    it("should parse endDate string to Date object", async () => {
      await controller.getMetrics(
        "2026-01-01T00:00:00.000Z",
        "2026-01-31T23:59:59.000Z",
      );

      const call = mockMcpServerService.getMetrics.mock.calls[0][0];
      expect(call?.endDate).toBeInstanceOf(Date);
    });

    it("should pass toolName filter when provided", async () => {
      await controller.getMetrics(undefined, undefined, "genesis_ask");

      const call = mockMcpServerService.getMetrics.mock.calls[0][0];
      expect(call?.toolName).toBe("genesis_ask");
    });

    it("should pass all filters together", async () => {
      await controller.getMetrics(
        "2026-01-01",
        "2026-01-31",
        "genesis_deep_research",
      );

      const call = mockMcpServerService.getMetrics.mock.calls[0][0];
      expect(call?.startDate).toBeInstanceOf(Date);
      expect(call?.endDate).toBeInstanceOf(Date);
      expect(call?.toolName).toBe("genesis_deep_research");
    });
  });

  describe("getSessions", () => {
    it("should merge session manager stats with service sessions", async () => {
      const result = await controller.getSessions();

      expect(mockSessionManager.getStats).toHaveBeenCalledTimes(1);
      expect(mockMcpServerService.getSessions).toHaveBeenCalledTimes(1);

      expect(result.activeSessions).toBe(4);
      expect(result.sessions).toEqual(mockSessions);
    });

    it("should include byClient stats from session manager", async () => {
      const result = await controller.getSessions();
      expect(result.byClient).toEqual({ "claude-code": 3, cursor: 1 });
    });

    it("should include byApiKey stats from session manager", async () => {
      const result = await controller.getSessions();
      expect(result.byApiKey).toEqual({ "key-1": 2, "key-2": 2 });
    });
  });

  describe("getTools", () => {
    it("should return tool list from detailed status and bridge stats", async () => {
      const result = await controller.getTools();

      expect(mockMcpServerService.getDetailedStatus).toHaveBeenCalledTimes(1);
      expect(mockToolBridge.getStats).toHaveBeenCalledTimes(1);

      expect(result.tools).toEqual(mockDetailedStatus.tools);
      expect(result.totalCount).toBe(mockDetailedStatus.totalToolCount);
      expect(result.curatedCount).toBe(mockDetailedStatus.curatedToolCount);
      expect(result.bridgedCount).toBe(mockDetailedStatus.bridgedToolCount);
    });

    it("should include bridgeBySource from tool bridge stats", async () => {
      const result = await controller.getTools();
      expect(result.bridgeBySource).toEqual(mockBridgeStats.bySource);
    });
  });

  describe("getStreamingStatus", () => {
    it("should return streaming stats from MCPStreamingBridge", async () => {
      const result = await controller.getStreamingStatus();

      expect(mockStreamingBridge.getStats).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockStreamingStats);
    });

    it("should return activeConnections count", async () => {
      const result = await controller.getStreamingStatus();
      expect(result.activeConnections).toBe(2);
    });

    it("should return connections array", async () => {
      const result = await controller.getStreamingStatus();
      expect(Array.isArray(result.connections)).toBe(true);
      expect(result.connections).toHaveLength(1);
    });
  });

  describe("getCapabilities", () => {
    it("should return protocol version and capabilities", async () => {
      const result = await controller.getCapabilities();

      expect(mockMcpServerService.getDetailedStatus).toHaveBeenCalledTimes(1);
      expect(result.protocol.version).toBe("2024-11-05");
      expect(result.protocol.transport).toBe("streamable-http");
    });

    it("should include tool counts", async () => {
      const result = await controller.getCapabilities();

      expect(result.tools.curated).toBe(mockDetailedStatus.curatedToolCount);
      expect(result.tools.bridged).toBe(mockDetailedStatus.bridgedToolCount);
      expect(result.tools.total).toBe(mockDetailedStatus.totalToolCount);
    });

    it("should include health status", async () => {
      const result = await controller.getCapabilities();

      expect(result.health.status).toBe("healthy");
      expect(result.health.uptime).toBe(3600);
      expect(result.health.sessions).toBe(4);
    });

    it("should include capabilities flags from detailed status", async () => {
      const result = await controller.getCapabilities();

      expect(result.capabilities.tools).toBe(true);
      expect(result.capabilities.resources).toBe(true);
      expect(result.capabilities.prompts).toBe(true);
      expect(result.capabilities.streaming).toBe(true);
    });

    it("should reflect degraded status when service reports it", async () => {
      mockMcpServerService.getDetailedStatus.mockReturnValue({
        ...mockDetailedStatus,
        status: "degraded",
      });

      const result = await controller.getCapabilities();
      expect(result.health.status).toBe("degraded");
    });
  });
});
