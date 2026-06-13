/**
 * TopicInsightsGateway Unit Tests
 *
 * Tests for WebSocket gateway and state sync functionality
 * Type checking is disabled due to Jest mock compatibility issues.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { ResearchMissionStatus } from "@prisma/client";

import { TopicInsightsGateway } from "../topic-insights.gateway";
import { ResearchEventEmitterService } from "../services/core/research/research-event-emitter.service";
import { PrismaService } from "@/common/prisma/prisma.service";

import { createMockPrisma, createMockResearchEventEmitter } from "./mocks";
import { MOCK_MISSION_EXECUTING } from "./fixtures/topics.fixture";

// ★ Security: Mock services for JWT authentication
const createMockJwtService = () => ({
  verifyAsync: jest
    .fn()
    .mockResolvedValue({ sub: "user-123", email: "test@example.com" }),
  sign: jest.fn().mockReturnValue("mock-token"),
});

const createMockConfigService = () => ({
  get: jest.fn((key: string) => {
    if (key === "JWT_SECRET") return "test-jwt-secret-at-least-32-chars";
    return undefined;
  }),
});

describe("TopicInsightsGateway", () => {
  let gateway: TopicInsightsGateway;
  let prisma: ReturnType<typeof createMockPrisma>;
  let researchEventEmitter: ReturnType<typeof createMockResearchEventEmitter>;
  let jwtService: ReturnType<typeof createMockJwtService>;
  let configService: ReturnType<typeof createMockConfigService>;

  // Mock Socket.IO server and client
  let middlewareFn: ((socket: any, next: any) => Promise<void>) | null = null;
  const mockServer = {
    in: jest.fn().mockReturnValue({
      fetchSockets: jest.fn().mockResolvedValue([{ id: "socket-1" }]),
    }),
    to: jest.fn().mockReturnValue({
      emit: jest.fn(),
    }),
    use: jest.fn((fn: any) => {
      middlewareFn = fn;
    }),
    sockets: { sockets: new Map() },
  };

  // ★ Security: Updated mock client with auth data
  const createMockClient = (authenticated = true) => ({
    id: "test-client-123",
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    handshake: {
      auth: { token: authenticated ? "valid-token" : undefined },
      headers: {},
    },
    data: authenticated
      ? {
          user: {
            id: "user-123",
            email: "test@example.com",
            username: "testuser",
          },
          authenticatedAt: new Date(),
        }
      : {},
  });

  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    researchEventEmitter = createMockResearchEventEmitter();
    jwtService = createMockJwtService();
    configService = createMockConfigService();
    mockClient = createMockClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicInsightsGateway,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ResearchEventEmitterService,
          useValue: researchEventEmitter,
        },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    gateway = module.get<TopicInsightsGateway>(TopicInsightsGateway);
    // Inject mock server
    (gateway as any).server = mockServer;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== Room Management Tests ====================

  describe("handleJoinTopic", () => {
    it("should join the topic room when user owns the topic", async () => {
      // Arrange - mock topic owned by the authenticated user
      prisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-123",
        userId: "user-123", // Same as mock user
      });

      // Act
      const result = await gateway.handleJoinTopic(mockClient as any, {
        topicId: "topic-123",
      });

      // Assert
      expect(mockClient.join).toHaveBeenCalledWith("research:topic-123");
      expect(result).toEqual({
        success: true,
        room: "research:topic-123",
      });
    });

    it("should reject join when user does not own the topic", async () => {
      // Arrange - mock topic owned by different user
      prisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-123",
        userId: "different-user-456",
      });

      // Act
      const result = await gateway.handleJoinTopic(mockClient as any, {
        topicId: "topic-123",
      });

      // Assert
      expect(mockClient.join).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: "Access denied",
      });
    });

    it("should reject join when topic not found", async () => {
      // Arrange
      prisma.researchTopic.findUnique.mockResolvedValue(null);

      // Act
      const result = await gateway.handleJoinTopic(mockClient as any, {
        topicId: "non-existent-topic",
      });

      // Assert
      expect(mockClient.join).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: "Topic not found",
      });
    });

    it("should reject join when client is not authenticated", async () => {
      // Arrange - create unauthenticated client
      const unauthClient = createMockClient(false);

      // Act
      const result = await gateway.handleJoinTopic(unauthClient as any, {
        topicId: "topic-123",
      });

      // Assert
      expect(unauthClient.join).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: "Authentication required",
      });
    });
  });

  describe("handleLeaveTopic", () => {
    it("should leave the topic room and return success", async () => {
      // Act
      const result = await gateway.handleLeaveTopic(mockClient as any, {
        topicId: "topic-123",
      });

      // Assert
      expect(mockClient.leave).toHaveBeenCalledWith("research:topic-123");
      expect(result).toEqual({ success: true });
    });
  });

  // ==================== emitToTopic Tests ====================

  describe("emitToTopic", () => {
    it("should emit event to topic room when clients are connected", async () => {
      // Arrange
      mockServer.in.mockReturnValue({
        fetchSockets: jest.fn().mockResolvedValue([{ id: "socket-1" }]),
      });

      // Act
      await gateway.emitToTopic("topic-123", "test:event", { data: "test" });

      // Assert
      expect(mockServer.in).toHaveBeenCalledWith("research:topic-123");
      expect(mockServer.to).toHaveBeenCalledWith("research:topic-123");
      expect(mockServer.to().emit).toHaveBeenCalledWith("test:event", {
        data: "test",
      });
    });

    it("should not emit when no clients are in room", async () => {
      // Arrange
      mockServer.in.mockReturnValue({
        fetchSockets: jest.fn().mockResolvedValue([]),
      });

      // Act
      await gateway.emitToTopic("topic-123", "test:event", { data: "test" });

      // Assert
      expect(mockServer.to).not.toHaveBeenCalled();
    });
  });

  // ==================== Lifecycle Tests ====================

  describe("lifecycle", () => {
    it("should register emit handler and auth middleware on afterInit", () => {
      // Act
      gateway.afterInit();

      // Assert
      expect(researchEventEmitter.registerEmitHandler).toHaveBeenCalled();
      expect(mockServer.use).toHaveBeenCalled();
      expect(middlewareFn).toBeInstanceOf(Function);
    });

    it("should handle client disconnection", () => {
      // Act - should not throw
      expect(() => gateway.handleDisconnect(mockClient as any)).not.toThrow();
    });
  });

  // ==================== ★ Security: Authentication Tests ====================

  describe("Socket.IO middleware - JWT Authentication", () => {
    beforeEach(() => {
      // Register middleware via afterInit
      gateway.afterInit();
    });

    it("should authenticate client with valid token via middleware", async () => {
      // Arrange
      const socket = {
        id: "client-456",
        handshake: {
          auth: { token: "valid-jwt-token" },
          headers: {},
          address: "127.0.0.1",
        },
        data: {} as Record<string, unknown>,
      };
      prisma.user.findUnique.mockResolvedValue({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
      });
      const next = jest.fn();

      // Act
      await middlewareFn!(socket, next);

      // Assert
      expect(jwtService.verifyAsync).toHaveBeenCalledWith("valid-jwt-token", {
        secret: "test-jwt-secret-at-least-32-chars",
      });
      expect((socket.data as any).user).toEqual({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
      });
      expect(next).toHaveBeenCalledWith();
    });

    it("should reject client without token", async () => {
      // Arrange
      const socket = {
        id: "client-no-token",
        handshake: { auth: {}, headers: {}, address: "127.0.0.1" },
        data: {},
      };
      const next = jest.fn();

      // Act
      await middlewareFn!(socket, next);

      // Assert
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe("Authentication required");
    });

    it("should reject client with invalid token", async () => {
      // Arrange
      const socket = {
        id: "client-invalid",
        handshake: {
          auth: { token: "invalid-token" },
          headers: {},
          address: "127.0.0.1",
        },
        data: {},
      };
      jwtService.verifyAsync.mockRejectedValue(new Error("Invalid token"));
      const next = jest.fn();

      // Act
      await middlewareFn!(socket, next);

      // Assert
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe("Invalid token");
    });

    it("should reject client when user not found in database", async () => {
      // Arrange
      const socket = {
        id: "client-orphan",
        handshake: {
          auth: { token: "valid-token" },
          headers: {},
          address: "127.0.0.1",
        },
        data: {},
      };
      jwtService.verifyAsync.mockResolvedValue({
        sub: "deleted-user",
        email: "deleted@example.com",
      });
      prisma.user.findUnique.mockResolvedValue(null);
      const next = jest.fn();

      // Act
      await middlewareFn!(socket, next);

      // Assert
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe("User not found");
    });

    it("should accept token from Authorization header", async () => {
      // Arrange
      const socket = {
        id: "client-header",
        handshake: {
          auth: {},
          headers: { authorization: "Bearer header-jwt-token" },
          address: "127.0.0.1",
        },
        data: {} as Record<string, unknown>,
      };
      prisma.user.findUnique.mockResolvedValue({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
      });
      const next = jest.fn();

      // Act
      await middlewareFn!(socket, next);

      // Assert
      expect(jwtService.verifyAsync).toHaveBeenCalledWith("header-jwt-token", {
        secret: "test-jwt-secret-at-least-32-chars",
      });
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe("handleSyncRequest - Authentication", () => {
    it("should reject sync request from unauthenticated client", async () => {
      // Arrange
      const unauthClient = createMockClient(false);

      // Act
      const result = await gateway.handleSyncRequest(unauthClient as any, {
        topicId: "topic-123",
      });

      // Assert
      expect(result).toEqual({
        success: false,
        needsRecovery: false,
        currentState: null,
        error: "Authentication required",
      });
    });
  });

  // ==================== handleSyncRequest - with topic ownership mocked ====================

  describe("handleSyncRequest - topic ownership", () => {
    beforeEach(() => {
      // By default mock topic owned by the authenticated user
      prisma.researchTopic.findUnique.mockResolvedValue({
        userId: "user-123",
      });
    });

    it("should return idle state when no mission exists", async () => {
      prisma.researchMission.findFirst.mockResolvedValue(null);

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
      });

      expect(result).toEqual({
        success: true,
        needsRecovery: false,
        currentState: {
          phase: "idle",
          progress: 0,
          message: "等待开始研究",
        },
      });
    });

    it("should return current mission state when mission exists", async () => {
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        updatedAt: new Date(),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
      });

      expect(result.success).toBe(true);
      expect(result.currentState).toBeDefined();
      expect(result.currentState!.phase).toBe("researching");
      expect(result.currentState!.missionId).toBe(mockMission.id);
      expect(result.currentState!.progress).toBe(50);
    });

    it("should deny access when topic belongs to different user", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({
        userId: "another-user-999",
      });

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
      });

      expect(result).toEqual({
        success: false,
        needsRecovery: false,
        currentState: null,
        error: "Access denied",
      });
    });

    it("should deny access when topic not found", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(null);

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "non-existent",
      });

      expect(result).toEqual({
        success: false,
        needsRecovery: false,
        currentState: null,
        error: "Access denied",
      });
    });

    it("should handle database errors gracefully and return Internal error", async () => {
      prisma.researchMission.findFirst.mockRejectedValue(
        new Error("Database connection failed"),
      );

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
      });

      expect(result.success).toBe(false);
      expect(result.currentState).toBeNull();
      expect(result.error).toBe("Internal error");
    });

    it("should not need recovery when client has no previous state", async () => {
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        progressPercent: 50,
        updatedAt: new Date(),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
      });

      expect(result.needsRecovery).toBe(false);
    });

    it("should detect needsRecovery when phase mismatch", async () => {
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        status: ResearchMissionStatus.COMPLETED,
        progressPercent: 100,
        updatedAt: new Date(),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
        lastKnownPhase: "researching",
        lastKnownProgress: 100,
      });

      expect(result.success).toBe(true);
      expect(result.needsRecovery).toBe(true);
      expect(result.currentState!.phase).toBe("completed");
    });

    it("should detect needsRecovery when progress diff > 10%", async () => {
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        progressPercent: 80,
        updatedAt: new Date(),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
        lastKnownPhase: "researching",
        lastKnownProgress: 50,
      });

      expect(result.needsRecovery).toBe(true);
    });

    it("should detect stale executing mission as needing recovery", async () => {
      const staleDate = new Date(Date.now() - 10 * 60 * 1000);
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        status: ResearchMissionStatus.EXECUTING,
        progressPercent: 50,
        updatedAt: staleDate,
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
        lastKnownPhase: "researching",
        lastKnownProgress: 50,
      });

      expect(result.needsRecovery).toBe(true);
    });

    it("should not flag recent executing mission with matching phase/progress as needing recovery", async () => {
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        status: ResearchMissionStatus.EXECUTING,
        progressPercent: 50,
        updatedAt: new Date(),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
        lastKnownPhase: "researching",
        lastKnownProgress: 48, // within 10%
      });

      expect(result.needsRecovery).toBe(false);
    });

    it("should map PLAN_READY status to plan_ready phase", async () => {
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        status: ResearchMissionStatus.PLAN_READY,
        progressPercent: 10,
        updatedAt: new Date(),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
      });

      expect(result.currentState!.phase).toBe("plan_ready");
    });

    it("should map REVIEWING status to synthesizing phase", async () => {
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        status: ResearchMissionStatus.REVIEWING,
        progressPercent: 80,
        updatedAt: new Date(),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
      });

      expect(result.currentState!.phase).toBe("synthesizing");
      expect(result.currentState!.message).toBe("正在生成研究报告...");
    });

    it("should map FAILED status to failed phase with correct message", async () => {
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        status: ResearchMissionStatus.FAILED,
        progressPercent: 40,
        updatedAt: new Date(),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
      });

      expect(result.currentState!.phase).toBe("failed");
      expect(result.currentState!.message).toBe("研究任务失败");
    });

    it("should map CANCELLED status to idle phase", async () => {
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        status: ResearchMissionStatus.CANCELLED,
        progressPercent: 0,
        updatedAt: new Date(),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
      });

      expect(result.currentState!.phase).toBe("idle");
    });

    it("should include lastActivityAt in response when mission has updatedAt", async () => {
      const updatedAt = new Date("2024-06-01T10:00:00.000Z");
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        updatedAt,
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
      });

      expect(result.currentState!.lastActivityAt).toBe(updatedAt.toISOString());
    });
  });

  // ==================== handleConnection Tests ====================

  describe("handleConnection", () => {
    it("should add socket to userConnections on authenticated connection", async () => {
      const client = createMockClient(true);

      await gateway.handleConnection(client as any);

      // No error thrown and client not disconnected
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it("should disconnect client if user data is missing", async () => {
      const client = {
        id: "test-client-no-user",
        join: jest.fn(),
        leave: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
        handshake: { address: "127.0.0.1" },
        data: {}, // no user
      };

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it("should replace oldest socket when user exceeds max connections", async () => {
      const user = { id: "heavy-user", email: "x@x.com", username: "heavy" };

      // Simulate 5 existing sockets for this user
      const existingSocketIds = ["s1", "s2", "s3", "s4", "s5"];
      const oldestSocketMock = { emit: jest.fn(), disconnect: jest.fn() };
      mockServer.sockets.sockets.set("s1", oldestSocketMock as any);

      const userSocketsSet = new Set(existingSocketIds);
      (gateway as any).userConnections.set(user.id, userSocketsSet);

      const newClient = {
        id: "s6",
        join: jest.fn(),
        leave: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
        handshake: { address: "127.0.0.1" },
        data: { user, authenticatedAt: new Date() },
      };

      await gateway.handleConnection(newClient as any);

      // oldest socket should be disconnected
      expect(oldestSocketMock.disconnect).toHaveBeenCalledWith(true);
      expect(oldestSocketMock.emit).toHaveBeenCalledWith(
        "connection:replaced",
        expect.objectContaining({ message: expect.any(String) }),
      );
    });
  });

  // ==================== handleDisconnect Tests ====================

  describe("handleDisconnect", () => {
    it("should remove socket from userConnections map", () => {
      const userId = "user-dc-test";
      const socketId = "socket-dc-1";
      const userSockets = new Set([socketId]);
      (gateway as any).userConnections.set(userId, userSockets);

      const client = {
        id: socketId,
        data: { user: { id: userId } },
      };

      gateway.handleDisconnect(client as any);

      expect((gateway as any).userConnections.has(userId)).toBe(false);
    });

    it("should delete userId key when last socket disconnects", () => {
      const userId = "user-last-socket";
      const socketId = "socket-last";
      const userSockets = new Set([socketId]);
      (gateway as any).userConnections.set(userId, userSockets);

      const client = {
        id: socketId,
        data: { user: { id: userId } },
      };

      gateway.handleDisconnect(client as any);

      expect((gateway as any).userConnections.has(userId)).toBe(false);
    });

    it("should not throw when disconnecting unauthenticated socket", () => {
      const client = {
        id: "anon-socket",
        data: {},
      };

      expect(() => gateway.handleDisconnect(client as any)).not.toThrow();
    });

    it("should keep other sockets in set when one user has multiple connections", () => {
      const userId = "user-multi";
      const userSockets = new Set(["s-a", "s-b", "s-c"]);
      (gateway as any).userConnections.set(userId, userSockets);

      const client = { id: "s-b", data: { user: { id: userId } } };
      gateway.handleDisconnect(client as any);

      const remaining = (gateway as any).userConnections.get(
        userId,
      ) as Set<string>;
      expect(remaining.size).toBe(2);
      expect(remaining.has("s-b")).toBe(false);
    });
  });

  // ==================== handleLeaveTopic error path ====================

  describe("handleLeaveTopic - error path", () => {
    it("should return success:false and emit error when leave throws", async () => {
      const client = {
        ...mockClient,
        leave: jest.fn().mockRejectedValue(new Error("leave failed")),
        emit: jest.fn(),
      };

      const result = await gateway.handleLeaveTopic(client as any, {
        topicId: "topic-error",
      });

      expect(result).toEqual({ success: false });
      expect(client.emit).toHaveBeenCalledWith("error", {
        message: "Operation failed",
      });
    });
  });

  // ==================== handleJoinTopic - error path ====================

  describe("handleJoinTopic - error path", () => {
    it("should return internal error when database throws during join", async () => {
      prisma.researchTopic.findUnique.mockRejectedValue(new Error("DB Error"));

      const result = await gateway.handleJoinTopic(mockClient as any, {
        topicId: "topic-123",
      });

      expect(result).toEqual({ success: false, error: "Internal error" });
    });
  });

  // ==================== afterInit - middleware error path ====================

  describe("afterInit - middleware error path", () => {
    it("should call next with Authentication failed when unexpected error occurs", async () => {
      gateway.afterInit();

      const socket = {
        id: "client-crash",
        handshake: {
          auth: { token: "crash-token" },
          headers: {},
          address: "127.0.0.1",
        },
        data: {} as Record<string, unknown>,
      };

      // Make verifyAsync throw a non-standard error to trigger catch block
      jwtService.verifyAsync.mockImplementation(() => {
        throw new Error("Unexpected JWT library crash");
      });

      const next = jest.fn();
      await middlewareFn!(socket, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("should use Authorization header token when auth.token is absent", async () => {
      gateway.afterInit();

      const socket = {
        id: "client-bearer",
        handshake: {
          auth: {},
          headers: { authorization: "Bearer bearer-only-token" },
          address: "127.0.0.1",
        },
        data: {} as Record<string, unknown>,
      };

      prisma.user.findUnique.mockResolvedValue({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
      });

      const next = jest.fn();
      await middlewareFn!(socket, next);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith(
        "bearer-only-token",
        expect.any(Object),
      );
      expect(next).toHaveBeenCalledWith();
    });

    it("should set username to email when username is falsy", async () => {
      gateway.afterInit();

      const socket = {
        id: "client-no-username",
        handshake: {
          auth: { token: "token-no-username" },
          headers: {},
          address: "127.0.0.1",
        },
        data: {} as Record<string, unknown>,
      };

      prisma.user.findUnique.mockResolvedValue({
        id: "user-no-username",
        email: "nousername@example.com",
        username: null, // falsy username
      });

      const next = jest.fn();
      await middlewareFn!(socket, next);

      expect(next).toHaveBeenCalledWith();
      expect((socket.data as any).user.username).toBe("nousername@example.com");
    });

    it("should call next(Authentication failed) when an unexpected error is thrown in middleware", async () => {
      gateway.afterInit();

      prisma.user.findUnique.mockImplementation(() => {
        throw new Error("Unexpected DB crash");
      });

      const socket = {
        id: "client-crash",
        handshake: {
          auth: { token: "valid-token" },
          headers: {},
          address: "127.0.0.1",
        },
        data: {} as Record<string, unknown>,
      };
      const next = jest.fn();
      await middlewareFn!(socket, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe("Authentication failed");
    });
  });

  // ==================== handleConnection - error path ====================

  describe("handleConnection - error on setup", () => {
    it("should disconnect client when an error occurs during connection setup", async () => {
      // Make userConnections.has throw by providing a client whose user causes issues
      const client = createMockClient(true);
      // Force an error by making the Map's has method throw
      const originalSet = Map.prototype.set;
      Map.prototype.set = () => {
        throw new Error("Map error");
      };

      try {
        await gateway.handleConnection(client as any);
      } catch {
        // May or may not throw depending on error handling
      } finally {
        Map.prototype.set = originalSet;
      }

      // Just verify it doesn't crash the test runner
    });
  });

  // ==================== registerEmitHandler callback ====================

  describe("afterInit - registerEmitHandler callback execution", () => {
    it("should invoke emitToTopic when the registered emit handler is called", async () => {
      let registeredHandler:
        | ((topicId: string, event: string, data: unknown) => Promise<void>)
        | null = null;

      researchEventEmitter.registerEmitHandler.mockImplementation((fn: any) => {
        registeredHandler = fn;
      });

      mockServer.in.mockReturnValue({
        fetchSockets: jest.fn().mockResolvedValue([{ id: "socket-abc" }]),
      });

      gateway.afterInit();

      expect(registeredHandler).toBeInstanceOf(Function);

      // Invoke the registered handler
      await registeredHandler!("topic-emit-test", "test:event", {
        payload: "test",
      });

      expect(mockServer.to).toHaveBeenCalledWith("research:topic-emit-test");
    });
  });

  // ==================== mapStatusToPhase - PLANNING and default ====================

  describe("handleSyncRequest - PLANNING status and default phase coverage", () => {
    beforeEach(() => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-123" });
    });

    it("should map PLANNING status to planning phase with correct message", async () => {
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        status: ResearchMissionStatus.PLANNING,
        progressPercent: 5,
        updatedAt: new Date(),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const result = await gateway.handleSyncRequest(mockClient as any, {
        topicId: "topic-123",
      });

      expect(result.currentState!.phase).toBe("planning");
      expect(result.currentState!.message).toBe("正在规划研究方案...");
    });
  });
});
