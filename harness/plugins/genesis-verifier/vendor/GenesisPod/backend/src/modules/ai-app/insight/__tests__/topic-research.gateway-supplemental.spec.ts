/**
 * TopicInsightsGateway Supplemental Unit Tests
 *
 * Targets uncovered lines:
 * - WsRateLimiter: evict expired entries (line 72), maxRequests reached (line 75-76)
 * - handleJoinTopic: rate limit exceeded (line 168, 185-202)
 * - handleLeaveTopic: rate limit exceeded (line 234)
 * - handleSyncRequest: rate limit exceeded (line 427-428, 476-479, 542-545)
 * - mapStatusToPhase: default branch (line 712)
 * - buildCurrentMessage: plan_ready, analyzing, recovering, default (line 733, 741)
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

describe("TopicInsightsGateway (supplemental)", () => {
  let gateway: TopicInsightsGateway;
  let prisma: ReturnType<typeof createMockPrisma>;
  let researchEventEmitter: ReturnType<typeof createMockResearchEventEmitter>;
  let jwtService: ReturnType<typeof createMockJwtService>;
  let configService: ReturnType<typeof createMockConfigService>;

  const mockServer = {
    in: jest.fn().mockReturnValue({
      fetchSockets: jest.fn().mockResolvedValue([{ id: "socket-1" }]),
    }),
    to: jest.fn().mockReturnValue({
      emit: jest.fn(),
    }),
    use: jest.fn(),
    sockets: { sockets: new Map() },
  };

  const createMockClient = (
    authenticated = true,
    userId = "user-123",
    username = "testuser",
  ) => ({
    id: "test-client-123",
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
    handshake: {
      auth: { token: authenticated ? "valid-token" : undefined },
      headers: {},
      address: "127.0.0.1",
    },
    data: authenticated
      ? {
          user: { id: userId, email: `${username}@example.com`, username },
          authenticatedAt: new Date(),
        }
      : {},
  });

  beforeEach(async () => {
    prisma = createMockPrisma();
    researchEventEmitter = createMockResearchEventEmitter();
    jwtService = createMockJwtService();
    configService = createMockConfigService();

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
    (gateway as any).server = mockServer;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== WsRateLimiter internal behavior ====================

  describe("WsRateLimiter - rate limiting logic", () => {
    it("should allow requests when under the limit", () => {
      const rateLimiter = (gateway as any).rateLimiter;
      // Allow first request
      expect(rateLimiter.allow("test-user")).toBe(true);
    });

    it("should evict expired entries from the window and allow new ones", () => {
      const rateLimiter = (gateway as any).rateLimiter;
      const userId = "eviction-test-user";

      // Manually set timestamps that are older than windowMs (60000ms)
      const expiredTimestamps = [Date.now() - 70_000, Date.now() - 65_000];
      rateLimiter.windows.set(userId, expiredTimestamps);

      // This call should evict the old timestamps and succeed
      const result = rateLimiter.allow(userId);
      expect(result).toBe(true);

      // After eviction and one new entry, we should have exactly 1 entry
      const remaining = rateLimiter.windows.get(userId);
      expect(remaining).toBeDefined();
      expect(remaining.length).toBe(1);
    });

    it("should block requests when max requests reached within window", () => {
      const rateLimiter = (gateway as any).rateLimiter;
      const userId = "rate-limited-user";
      const now = Date.now();

      // Fill up the window with 30 recent timestamps (maxRequests = 30)
      const timestamps = Array.from({ length: 30 }, (_, i) => now - i * 100);
      rateLimiter.windows.set(userId, timestamps);

      // 31st request should be blocked
      const result = rateLimiter.allow(userId);
      expect(result).toBe(false);
    });

    it("should cleanup user window on cleanup()", () => {
      const rateLimiter = (gateway as any).rateLimiter;
      const userId = "cleanup-user";
      rateLimiter.windows.set(userId, [Date.now()]);

      rateLimiter.cleanup(userId);

      expect(rateLimiter.windows.has(userId)).toBe(false);
    });
  });

  // ==================== handleJoinTopic - rate limit exceeded ====================

  describe("handleJoinTopic - rate limit exceeded", () => {
    it("should return rate limit error when user exceeds join:topic rate limit", async () => {
      const client = createMockClient(true, "rate-user", "rateuser");
      const rateLimiter = (gateway as any).rateLimiter;
      const now = Date.now();

      // Pre-fill rate limiter with 30 recent entries for this user
      const timestamps = Array.from({ length: 30 }, (_, i) => now - i * 100);
      rateLimiter.windows.set("rate-user", timestamps);

      const result = await gateway.handleJoinTopic(client as any, {
        topicId: "topic-123",
      });

      expect(result).toEqual({ success: false, error: "Rate limit exceeded" });
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  // ==================== handleLeaveTopic - rate limit exceeded ====================

  describe("handleLeaveTopic - rate limit exceeded", () => {
    it("should return rate limit error when user exceeds leave:topic rate limit", async () => {
      const client = createMockClient(true, "rate-leave-user", "leavelimit");
      const rateLimiter = (gateway as any).rateLimiter;
      const now = Date.now();

      // Pre-fill rate limiter with 30 recent entries for this user
      const timestamps = Array.from({ length: 30 }, (_, i) => now - i * 100);
      rateLimiter.windows.set("rate-leave-user", timestamps);

      const result = await gateway.handleLeaveTopic(client as any, {
        topicId: "topic-123",
      });

      expect(result).toEqual({ success: false, error: "Rate limit exceeded" });
      expect(client.leave).not.toHaveBeenCalled();
    });

    it("should not apply rate limit for unauthenticated client on leave", async () => {
      // Client with no user — should skip rate limit check and proceed
      const client = {
        id: "unauth-leave",
        join: jest.fn(),
        leave: jest.fn().mockResolvedValue(undefined),
        emit: jest.fn(),
        disconnect: jest.fn(),
        handshake: { address: "127.0.0.1", auth: {}, headers: {} },
        data: {}, // no user
      };

      const result = await gateway.handleLeaveTopic(client as any, {
        topicId: "topic-123",
      });

      expect(result).toEqual({ success: true });
    });
  });

  // ==================== handleSyncRequest - rate limit exceeded ====================

  describe("handleSyncRequest - rate limit exceeded", () => {
    it("should return rate limit error when user exceeds sync:request rate limit", async () => {
      const client = createMockClient(true, "rate-sync-user", "syncuser");
      const rateLimiter = (gateway as any).rateLimiter;
      const now = Date.now();

      // Pre-fill rate limiter with 30 recent entries for this user
      const timestamps = Array.from({ length: 30 }, (_, i) => now - i * 100);
      rateLimiter.windows.set("rate-sync-user", timestamps);

      const result = await gateway.handleSyncRequest(client as any, {
        topicId: "topic-123",
      });

      expect(result).toEqual({
        success: false,
        needsRecovery: false,
        currentState: null,
        error: "Rate limit exceeded",
      });
    });
  });

  // ==================== mapStatusToPhase - default branch ====================

  describe("mapStatusToPhase - default / unknown status", () => {
    it("should return idle for unknown/default status", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-123" });

      // Use an unexpected status value to trigger the default branch
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        status: "UNKNOWN_STATUS" as ResearchMissionStatus,
        progressPercent: 0,
        updatedAt: new Date(),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const client = createMockClient(true);
      const result = await gateway.handleSyncRequest(client as any, {
        topicId: "topic-123",
      });

      expect(result.currentState!.phase).toBe("idle");
    });
  });

  // ==================== buildCurrentMessage - uncovered phases ====================

  describe("buildCurrentMessage - plan_ready, analyzing, recovering, default", () => {
    beforeEach(() => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-123" });
    });

    it("should return correct message for plan_ready phase", async () => {
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        status: ResearchMissionStatus.PLAN_READY,
        progressPercent: 10,
        updatedAt: new Date(),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const client = createMockClient(true);
      const result = await gateway.handleSyncRequest(client as any, {
        topicId: "topic-123",
      });

      // plan_ready phase falls through to default in buildCurrentMessage
      // which returns "等待开始研究"
      expect(result.currentState!.phase).toBe("plan_ready");
      expect(result.currentState!.message).toBe("等待开始研究");
    });

    it("should return correct message for completed phase", async () => {
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        status: ResearchMissionStatus.COMPLETED,
        progressPercent: 100,
        updatedAt: new Date(),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const client = createMockClient(true);
      const result = await gateway.handleSyncRequest(client as any, {
        topicId: "topic-123",
      });

      expect(result.currentState!.phase).toBe("completed");
      expect(result.currentState!.message).toBe("研究已完成");
    });

    it("should return progress message for researching phase", async () => {
      const mockMission = {
        ...MOCK_MISSION_EXECUTING,
        status: ResearchMissionStatus.EXECUTING,
        progressPercent: 42,
        updatedAt: new Date(),
        tasks: [],
      };
      prisma.researchMission.findFirst.mockResolvedValue(mockMission);

      const client = createMockClient(true);
      const result = await gateway.handleSyncRequest(client as any, {
        topicId: "topic-123",
      });

      expect(result.currentState!.message).toContain("42%");
    });
  });

  // ==================== handleConnection - connection counting ====================

  describe("handleConnection - multiple users", () => {
    it("should track separate socket sets per user", async () => {
      const client1 = createMockClient(true, "user-a", "userA");
      client1.id = "socket-a1";
      const client2 = createMockClient(true, "user-b", "userB");
      client2.id = "socket-b1";

      await gateway.handleConnection(client1 as any);
      await gateway.handleConnection(client2 as any);

      const connectionsA = (gateway as any).userConnections.get("user-a");
      const connectionsB = (gateway as any).userConnections.get("user-b");

      expect(connectionsA?.has("socket-a1")).toBe(true);
      expect(connectionsB?.has("socket-b1")).toBe(true);
    });

    it("should add second socket for same user without replacing", async () => {
      const userId = "user-multi-connect";
      const client1 = createMockClient(true, userId, "multiuser");
      client1.id = "socket-m1";
      const client2 = createMockClient(true, userId, "multiuser");
      client2.id = "socket-m2";

      await gateway.handleConnection(client1 as any);
      await gateway.handleConnection(client2 as any);

      const connections = (gateway as any).userConnections.get(userId);
      expect(connections?.has("socket-m1")).toBe(true);
      expect(connections?.has("socket-m2")).toBe(true);
    });
  });

  // ==================== handleDisconnect - rate limiter cleanup on last socket ====================

  describe("handleDisconnect - rate limiter cleanup", () => {
    it("should call rateLimiter.cleanup when last socket disconnects", () => {
      const userId = "user-final-dc";
      const socketId = "final-socket";
      const userSockets = new Set([socketId]);
      (gateway as any).userConnections.set(userId, userSockets);

      // Pre-populate rate limiter for this user
      (gateway as any).rateLimiter.windows.set(userId, [Date.now()]);

      const client = { id: socketId, data: { user: { id: userId } } };
      gateway.handleDisconnect(client as any);

      // Rate limiter should have been cleaned up
      expect((gateway as any).rateLimiter.windows.has(userId)).toBe(false);
    });

    it("should NOT remove rate limiter when user still has other sockets", () => {
      const userId = "user-still-connected";
      const userSockets = new Set(["socket-x", "socket-y"]);
      (gateway as any).userConnections.set(userId, userSockets);
      (gateway as any).rateLimiter.windows.set(userId, [Date.now()]);

      const client = { id: "socket-x", data: { user: { id: userId } } };
      gateway.handleDisconnect(client as any);

      // Rate limiter should still be present — user has socket-y remaining
      expect((gateway as any).rateLimiter.windows.has(userId)).toBe(true);
    });
  });
});
