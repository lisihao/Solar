/**
 * Unit tests for SocialMissionStore
 * Covers all Prisma read/write paths including non-fatal catch branches.
 */

import { Logger } from "@nestjs/common";
import { SocialMissionStore } from "../social-mission-store.service";
import type { PrismaService } from "@/common/prisma/prisma.service";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return {
    socialMission: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    socialPublishLog: {
      create: jest.fn(),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

const MOCK_MISSION_ID = "mission-abc-123";
const MOCK_USER_ID = "user-xyz-456";
const MOCK_POD_ID = "pod-001";

/** C0/G1: 经 arbiter 唯一入口提交终态 intent(替代旧直调 store.markX)。 */
function applyCompleted(
  store: SocialMissionStore,
  detail?: {
    elapsedWallTimeMs?: number;
    tokensUsed?: number;
    costUsd?: number;
  },
) {
  return store.applyTerminalIfRunning(MOCK_MISSION_ID, {
    status: "completed",
    extra: { kind: "completed", detail },
  });
}
function applyFailed(
  store: SocialMissionStore,
  detail: {
    errorMessage: string;
    elapsedWallTimeMs?: number;
    tokensUsed?: number;
  },
) {
  return store.applyTerminalIfRunning(MOCK_MISSION_ID, {
    status: "failed",
    extra: { kind: "failed", detail },
  });
}
function applyCancelled(store: SocialMissionStore, reason?: string) {
  return store.applyTerminalIfRunning(MOCK_MISSION_ID, {
    status: "cancelled",
    extra: { kind: "cancelled", reason },
  });
}

function makeCreateArgs(overrides = {}) {
  return {
    id: MOCK_MISSION_ID,
    userId: MOCK_USER_ID,
    contentId: "content-999",
    platforms: ["wechat", "xiaohongshu"],
    connectionIds: { wechat: "conn-1", xiaohongshu: "conn-2" },
    depth: "standard",
    budgetProfile: "standard",
    language: "zh-CN",
    maxCredits: 20,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SocialMissionStore", () => {
  let store: SocialMissionStore;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    store = new SocialMissionStore(mockPrisma as unknown as PrismaService);
    loggerWarnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    loggerLogSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    // Default HOSTNAME env
    process.env.HOSTNAME = "test-host";
    delete process.env.RAILWAY_REPLICA_ID;
  });

  afterEach(() => {
    jest.clearAllMocks();
    loggerWarnSpy.mockRestore();
    loggerLogSpy.mockRestore();
  });

  // =========================================================================
  // create
  // =========================================================================

  describe("create", () => {
    it("should call prisma.socialMission.create with correct data", async () => {
      (mockPrisma.socialMission.create as jest.Mock).mockResolvedValue({});
      const args = makeCreateArgs();

      await store.create(args);

      expect(mockPrisma.socialMission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: MOCK_MISSION_ID,
            userId: MOCK_USER_ID,
            contentId: "content-999",
            platforms: ["wechat", "xiaohongshu"],
            depth: "standard",
            budgetProfile: "standard",
            language: "zh-CN",
            maxCredits: 20,
            status: "running",
          }),
        }),
      );
    });

    it("should use RAILWAY_REPLICA_ID as podId when set", async () => {
      process.env.RAILWAY_REPLICA_ID = "railway-pod-999";
      (mockPrisma.socialMission.create as jest.Mock).mockResolvedValue({});
      const args = makeCreateArgs();

      await store.create(args);

      const createArg = (mockPrisma.socialMission.create as jest.Mock).mock
        .calls[0][0];
      expect(createArg.data.podId).toBe("railway-pod-999");
      delete process.env.RAILWAY_REPLICA_ID;
    });

    it("should fall back to HOSTNAME as podId when RAILWAY_REPLICA_ID is absent", async () => {
      process.env.HOSTNAME = "my-local-host";
      (mockPrisma.socialMission.create as jest.Mock).mockResolvedValue({});

      await store.create(makeCreateArgs());

      const createArg = (mockPrisma.socialMission.create as jest.Mock).mock
        .calls[0][0];
      expect(createArg.data.podId).toBe("my-local-host");
    });

    it("should use 'local' as podId when both env vars are absent", async () => {
      delete process.env.RAILWAY_REPLICA_ID;
      delete process.env.HOSTNAME;
      (mockPrisma.socialMission.create as jest.Mock).mockResolvedValue({});

      await store.create(makeCreateArgs());

      const createArg = (mockPrisma.socialMission.create as jest.Mock).mock
        .calls[0][0];
      expect(createArg.data.podId).toBe("local");
    });

    it("should store workspaceId when provided", async () => {
      (mockPrisma.socialMission.create as jest.Mock).mockResolvedValue({});
      const args = makeCreateArgs({ workspaceId: "ws-007" });

      await store.create(args);

      const createArg = (mockPrisma.socialMission.create as jest.Mock).mock
        .calls[0][0];
      expect(createArg.data.workspaceId).toBe("ws-007");
    });

    it("should propagate errors from prisma.create", async () => {
      (mockPrisma.socialMission.create as jest.Mock).mockRejectedValue(
        new Error("DB write error"),
      );

      await expect(store.create(makeCreateArgs())).rejects.toThrow(
        "DB write error",
      );
    });

    it("should log after successful create", async () => {
      (mockPrisma.socialMission.create as jest.Mock).mockResolvedValue({});

      await store.create(makeCreateArgs());

      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(MOCK_MISSION_ID),
      );
    });
  });

  // =========================================================================
  // refreshHeartbeat
  // =========================================================================

  describe("refreshHeartbeat", () => {
    it("should call prisma.update with heartbeatAt and podId", async () => {
      (mockPrisma.socialMission.update as jest.Mock).mockResolvedValue({});

      await store.refreshHeartbeat(MOCK_MISSION_ID, MOCK_POD_ID);

      expect(mockPrisma.socialMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: MOCK_MISSION_ID },
          data: expect.objectContaining({
            podId: MOCK_POD_ID,
          }),
        }),
      );
    });

    it("should silently log warn on prisma error (non-fatal)", async () => {
      (mockPrisma.socialMission.update as jest.Mock).mockRejectedValue(
        new Error("row not found"),
      );

      await expect(
        store.refreshHeartbeat(MOCK_MISSION_ID, MOCK_POD_ID),
      ).resolves.toBeUndefined();

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(MOCK_MISSION_ID),
      );
    });
  });

  // =========================================================================
  // applyTerminalIfRunning — completed (C0/G1 唯一终态写入口)
  // =========================================================================

  describe("applyTerminalIfRunning — completed", () => {
    it("should conditional-write status=completed (WHERE running) and return won=true", async () => {
      (mockPrisma.socialMission.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const won = await applyCompleted(store, {
        elapsedWallTimeMs: 12000,
        tokensUsed: 500,
        costUsd: 0.03,
      });

      expect(won).toBe(true);
      expect(mockPrisma.socialMission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: MOCK_MISSION_ID, status: "running" },
          data: expect.objectContaining({
            status: "completed",
            elapsedWallTimeMs: 12000,
            costUsd: 0.03,
          }),
        }),
      );
    });

    it("should return won=false when no running row matched (race lost, no-op)", async () => {
      (mockPrisma.socialMission.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      await expect(applyCompleted(store)).resolves.toBe(false);
    });

    it("should convert tokensUsed to BigInt", async () => {
      (mockPrisma.socialMission.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await applyCompleted(store, { tokensUsed: 1234 });

      const updateArg = (mockPrisma.socialMission.updateMany as jest.Mock).mock
        .calls[0][0];
      expect(updateArg.data.tokensUsed).toBe(BigInt(1234));
    });

    it("should pass null tokensUsed when not provided", async () => {
      (mockPrisma.socialMission.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await applyCompleted(store);

      const updateArg = (mockPrisma.socialMission.updateMany as jest.Mock).mock
        .calls[0][0];
      expect(updateArg.data.tokensUsed).toBeNull();
    });

    it("should silently log warn on prisma error (non-fatal)", async () => {
      (mockPrisma.socialMission.updateMany as jest.Mock).mockRejectedValue(
        new Error("update failed"),
      );

      await expect(applyCompleted(store)).resolves.toBe(false);
      expect(loggerWarnSpy).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // applyTerminalIfRunning — failed (C0/G1 唯一终态写入口)
  // =========================================================================

  describe("applyTerminalIfRunning — failed", () => {
    it("should call prisma.updateMany with status=failed (条件写 WHERE running)", async () => {
      (mockPrisma.socialMission.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await applyFailed(store, {
        errorMessage: "Something went wrong",
        elapsedWallTimeMs: 5000,
      });

      expect(mockPrisma.socialMission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: MOCK_MISSION_ID, status: "running" },
          data: expect.objectContaining({
            status: "failed",
            elapsedWallTimeMs: 5000,
          }),
        }),
      );
    });

    it("should truncate errorMessage longer than 4000 chars", async () => {
      (mockPrisma.socialMission.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      const longMessage = "E".repeat(5000);

      await applyFailed(store, { errorMessage: longMessage });

      const updateArg = (mockPrisma.socialMission.updateMany as jest.Mock).mock
        .calls[0][0];
      expect(updateArg.data.errorMessage.length).toBe(4000);
    });

    it("should convert tokensUsed to BigInt when provided", async () => {
      (mockPrisma.socialMission.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await applyFailed(store, {
        errorMessage: "err",
        tokensUsed: 888,
      });

      const updateArg = (mockPrisma.socialMission.updateMany as jest.Mock).mock
        .calls[0][0];
      expect(updateArg.data.tokensUsed).toBe(BigInt(888));
    });

    it("should pass null tokensUsed when not provided", async () => {
      (mockPrisma.socialMission.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await applyFailed(store, { errorMessage: "err" });

      const updateArg = (mockPrisma.socialMission.updateMany as jest.Mock).mock
        .calls[0][0];
      expect(updateArg.data.tokensUsed).toBeNull();
    });

    it("should silently log warn on prisma error (non-fatal)", async () => {
      (mockPrisma.socialMission.updateMany as jest.Mock).mockRejectedValue(
        new Error("DB gone"),
      );

      await expect(applyFailed(store, { errorMessage: "x" })).resolves.toBe(
        false,
      );
      expect(loggerWarnSpy).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // applyTerminalIfRunning — cancelled (C0/G1 唯一终态写入口)
  // =========================================================================

  describe("applyTerminalIfRunning — cancelled", () => {
    it("should conditional-write status=cancelled + failureCode=user_cancelled (WHERE running)", async () => {
      (mockPrisma.socialMission.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const won = await applyCancelled(store, "aborted: user_cancelled");

      expect(won).toBe(true);
      expect(mockPrisma.socialMission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: MOCK_MISSION_ID, status: "running" },
          data: expect.objectContaining({ status: "cancelled" }),
        }),
      );
    });

    it("should return won=false when no running row matched (race lost, no-op)", async () => {
      (mockPrisma.socialMission.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      await expect(applyCancelled(store)).resolves.toBe(false);
    });
  });

  // =========================================================================
  // saveTrajectory
  // =========================================================================

  describe("saveTrajectory", () => {
    it("should call prisma.update with trajectory payload", async () => {
      (mockPrisma.socialMission.update as jest.Mock).mockResolvedValue({});
      const trajectory = { stages: ["s1", "s2"], ok: true };

      await store.saveTrajectory(MOCK_MISSION_ID, trajectory);

      expect(mockPrisma.socialMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: MOCK_MISSION_ID },
          data: { trajectory },
        }),
      );
    });

    it("should silently log warn on prisma error (non-fatal)", async () => {
      (mockPrisma.socialMission.update as jest.Mock).mockRejectedValue(
        new Error("trajectory save failed"),
      );

      await expect(
        store.saveTrajectory(MOCK_MISSION_ID, {}),
      ).resolves.toBeUndefined();
      expect(loggerWarnSpy).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // getOwner
  // =========================================================================

  describe("getOwner", () => {
    it("should return userId when mission exists", async () => {
      (mockPrisma.socialMission.findUnique as jest.Mock).mockResolvedValue({
        userId: MOCK_USER_ID,
      });

      const result = await store.getOwner(MOCK_MISSION_ID);

      expect(result).toBe(MOCK_USER_ID);
      expect(mockPrisma.socialMission.findUnique).toHaveBeenCalledWith({
        where: { id: MOCK_MISSION_ID },
        select: { userId: true },
      });
    });

    it("should return undefined when mission does not exist", async () => {
      (mockPrisma.socialMission.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await store.getOwner(MOCK_MISSION_ID);

      expect(result).toBeUndefined();
    });

    it("should return undefined when prisma throws", async () => {
      (mockPrisma.socialMission.findUnique as jest.Mock).mockRejectedValue(
        new Error("connection reset"),
      );

      const result = await store.getOwner(MOCK_MISSION_ID);

      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // getById
  // =========================================================================

  describe("getById", () => {
    it("should return mission row when found", async () => {
      const mockRow = {
        id: MOCK_MISSION_ID,
        userId: MOCK_USER_ID,
        status: "running",
      };
      (mockPrisma.socialMission.findFirst as jest.Mock).mockResolvedValue(
        mockRow,
      );

      const result = await store.getById(MOCK_MISSION_ID, MOCK_USER_ID);

      expect(result).toEqual(mockRow);
      expect(mockPrisma.socialMission.findFirst).toHaveBeenCalledWith({
        where: { id: MOCK_MISSION_ID, userId: MOCK_USER_ID },
      });
    });

    it("should return null when mission not found", async () => {
      (mockPrisma.socialMission.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await store.getById("nonexistent", MOCK_USER_ID);

      expect(result).toBeNull();
    });

    it("should pass userId filter correctly", async () => {
      (mockPrisma.socialMission.findFirst as jest.Mock).mockResolvedValue(null);

      await store.getById(MOCK_MISSION_ID, "different-user");

      expect(mockPrisma.socialMission.findFirst).toHaveBeenCalledWith({
        where: { id: MOCK_MISSION_ID, userId: "different-user" },
      });
    });
  });

  // =========================================================================
  // recordPublishLog (PR-6: admin 历史日志兼容)
  // =========================================================================

  describe("recordPublishLog", () => {
    it("should write socialPublishLog row with full detail", async () => {
      const createMock = mockPrisma.socialPublishLog
        .create as unknown as jest.Mock;
      createMock.mockResolvedValue({ id: "log-1" });

      await store.recordPublishLog({
        contentId: "c-1",
        action: "PUBLISH",
        status: "SUCCESS",
        details: { missionId: "m-1", platform: "wechat" },
      });

      expect(createMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contentId: "c-1",
          action: "PUBLISH",
          status: "SUCCESS",
          details: { missionId: "m-1", platform: "wechat" },
        }),
      });
    });

    it("should truncate long errorMessage to 4000 chars", async () => {
      const createMock = mockPrisma.socialPublishLog
        .create as unknown as jest.Mock;
      createMock.mockResolvedValue({ id: "log-2" });

      const longMsg = "x".repeat(8000);
      await store.recordPublishLog({
        contentId: "c-2",
        action: "PUBLISH",
        status: "FAILED",
        errorMessage: longMsg,
      });

      const callArg = createMock.mock.calls[0][0];
      expect(callArg.data.errorMessage).toHaveLength(4000);
    });

    it("should swallow create errors (non-fatal warn)", async () => {
      const createMock = mockPrisma.socialPublishLog
        .create as unknown as jest.Mock;
      createMock.mockRejectedValue(new Error("db down"));

      await expect(
        store.recordPublishLog({
          contentId: "c-3",
          action: "PUBLISH",
          status: "SUCCESS",
        }),
      ).resolves.toBeUndefined();

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[recordPublishLog]"),
      );
    });
  });
});
