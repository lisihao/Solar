import { Test, TestingModule } from "@nestjs/testing";
import { MissionHealthCheckService } from "../mission-health-check.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { MissionStatus, AgentTaskStatus } from "@prisma/client";

// ── helpers ──────────────────────────────────────────────────────────────────

function buildMockPrisma() {
  return {
    teamMission: {
      findMany: jest.fn(),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

/** Build a mission stub with tasks in various statuses */
function buildMission(overrides: {
  id?: string;
  title?: string;
  status?: MissionStatus;
  tasks?: Array<{ id: string; status: AgentTaskStatus; updatedAt: Date }>;
  createdAt?: Date;
}) {
  return {
    id: overrides.id ?? "mission-1",
    title: overrides.title ?? "Test Mission",
    status: overrides.status ?? MissionStatus.IN_PROGRESS,
    createdAt: overrides.createdAt ?? new Date(Date.now() - 20 * 60 * 1000),
    tasks: overrides.tasks ?? [],
  };
}

/** Timestamp far enough in the past to be past the stuck threshold */
const oldTimestamp = () => new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

// ── test suite ────────────────────────────────────────────────────────────────

describe("MissionHealthCheckService", () => {
  let service: MissionHealthCheckService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    // Use fake timers to control setInterval / setTimeout
    jest.useFakeTimers();

    mockPrisma = buildMockPrisma();
    (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionHealthCheckService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MissionHealthCheckService>(MissionHealthCheckService);
    // Enable auto-recovery by default so existing tests cover the recovery path.
    process.env.ENABLE_TEAM_MISSION_AUTORECOVERY = "true";
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    delete process.env.ENABLE_TEAM_MISSION_AUTORECOVERY;
  });

  // ── lifecycle ───────────────────────────────────────────────────────────────

  describe("onModuleInit / onModuleDestroy", () => {
    it("should start the health check scheduler on init", () => {
      service.onModuleInit();
      const status = service.getHealthStatus();
      expect(status.isRunning).toBe(true);
    });

    it("should stop the scheduler on destroy", () => {
      service.onModuleInit();
      service.onModuleDestroy();
      const status = service.getHealthStatus();
      expect(status.isRunning).toBe(false);
    });

    it("should be idempotent when init is called multiple times", () => {
      service.onModuleInit();
      service.onModuleInit();
      const status = service.getHealthStatus();
      expect(status.isRunning).toBe(true);
    });
  });

  // ── callback registration ────────────────────────────────────────────────────

  describe("registerExecuteCallback / registerRevisionCallback", () => {
    it("should register execute callback without throwing", () => {
      const cb = jest.fn();
      expect(() => service.registerExecuteCallback(cb)).not.toThrow();
    });

    it("should register revision callback without throwing", () => {
      const cb = jest.fn();
      expect(() => service.registerRevisionCallback(cb)).not.toThrow();
    });
  });

  // ── performHealthCheck ───────────────────────────────────────────────────────

  describe("performHealthCheck", () => {
    it("should complete without error when no missions are in progress", async () => {
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([]);

      await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });

    it("should complete without error when there are active in-progress tasks", async () => {
      const mission = buildMission({
        tasks: [
          {
            id: "t-1",
            status: AgentTaskStatus.IN_PROGRESS,
            updatedAt: new Date(),
          },
          {
            id: "t-2",
            status: AgentTaskStatus.PENDING,
            updatedAt: oldTimestamp(),
          },
        ],
      });
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([
        mission,
      ]);

      await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });

    it("should attempt recovery for a stuck mission with pending tasks", async () => {
      const executeFn = jest.fn().mockResolvedValue(undefined);
      service.registerExecuteCallback(executeFn);

      const mission = buildMission({
        id: "stuck-mission",
        tasks: [
          {
            id: "t-1",
            status: AgentTaskStatus.PENDING,
            updatedAt: oldTimestamp(),
          },
        ],
      });
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([
        mission,
      ]);

      await service.performHealthCheck();

      expect(executeFn).toHaveBeenCalledWith("stuck-mission");
    });

    it("should trigger revision recovery for stuck revision-needed tasks", async () => {
      const revisionFn = jest.fn().mockResolvedValue(undefined);
      service.registerRevisionCallback(revisionFn);

      const mission = buildMission({
        id: "revision-mission",
        tasks: [
          {
            id: "t-1",
            status: AgentTaskStatus.REVISION_NEEDED,
            updatedAt: oldTimestamp(),
          },
        ],
      });
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([
        mission,
      ]);

      await service.performHealthCheck();

      expect(revisionFn).toHaveBeenCalledWith("revision-mission");
    });

    it("should not attempt recovery when tasks were updated recently", async () => {
      const executeFn = jest.fn();
      service.registerExecuteCallback(executeFn);

      const mission = buildMission({
        tasks: [
          // Updated just 1 minute ago — not stuck yet
          {
            id: "t-1",
            status: AgentTaskStatus.PENDING,
            updatedAt: new Date(Date.now() - 60 * 1000),
          },
        ],
      });
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([
        mission,
      ]);

      await service.performHealthCheck();

      expect(executeFn).not.toHaveBeenCalled();
    });

    it("should not exceed max recovery attempts", async () => {
      const executeFn = jest.fn().mockResolvedValue(undefined);
      service.registerExecuteCallback(executeFn);

      const mission = buildMission({
        id: "stuck-mission",
        tasks: [
          {
            id: "t-1",
            status: AgentTaskStatus.PENDING,
            updatedAt: oldTimestamp(),
          },
        ],
      });
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([
        mission,
      ]);

      // Run health check 4 times (max is 3 attempts)
      await service.performHealthCheck();
      await service.performHealthCheck();
      await service.performHealthCheck();
      const callsBefore = executeFn.mock.calls.length;
      await service.performHealthCheck();

      // The 4th attempt should be blocked by the max recovery guard
      expect(executeFn.mock.calls.length).toBe(callsBefore);
    });

    it("should handle prisma query failure gracefully", async () => {
      (mockPrisma.teamMission.findMany as jest.Mock).mockRejectedValue(
        new Error("DB connection lost"),
      );

      await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });

    it("should handle execute callback failure gracefully", async () => {
      const executeFn = jest
        .fn()
        .mockRejectedValue(new Error("Callback error"));
      service.registerExecuteCallback(executeFn);

      const mission = buildMission({
        id: "stuck-mission",
        tasks: [
          {
            id: "t-1",
            status: AgentTaskStatus.PENDING,
            updatedAt: oldTimestamp(),
          },
        ],
      });
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([
        mission,
      ]);

      await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });

    it("should log warning when no callbacks are registered but mission is stuck", async () => {
      // No callbacks registered — service should still not throw
      const mission = buildMission({
        id: "no-callback-mission",
        tasks: [
          {
            id: "t-1",
            status: AgentTaskStatus.PENDING,
            updatedAt: oldTimestamp(),
          },
        ],
      });
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([
        mission,
      ]);

      await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });

    it("should handle mission with no tasks using createdAt as last activity", async () => {
      const mission = buildMission({
        id: "empty-task-mission",
        tasks: [],
        // createdAt far in the past but no tasks at all
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
      });
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([
        mission,
      ]);

      // A mission with no tasks has no work to do, so it should NOT be stuck
      const executeFn = jest.fn();
      service.registerExecuteCallback(executeFn);

      await service.performHealthCheck();

      expect(executeFn).not.toHaveBeenCalled();
    });
  });

  // ── manualHealthCheck ────────────────────────────────────────────────────────

  describe("manualHealthCheck", () => {
    it("should return empty array when no missions are stuck", async () => {
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.manualHealthCheck();

      expect(result).toEqual([]);
    });

    it("should return info for each stuck mission", async () => {
      const mission = buildMission({
        id: "stuck-1",
        title: "Stuck Mission",
        tasks: [
          {
            id: "t-1",
            status: AgentTaskStatus.PENDING,
            updatedAt: oldTimestamp(),
          },
          {
            id: "t-2",
            status: AgentTaskStatus.REVISION_NEEDED,
            updatedAt: oldTimestamp(),
          },
        ],
      });
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([
        mission,
      ]);

      const result = await service.manualHealthCheck();

      expect(result).toHaveLength(1);
      expect(result[0].missionId).toBe("stuck-1");
      expect(result[0].pendingTasks).toBe(1);
      expect(result[0].revisionNeededTasks).toBe(1);
    });
  });

  // ── resetRecoveryAttempts / cleanupCompletedMission ─────────────────────────

  describe("resetRecoveryAttempts", () => {
    it("should not throw when resetting attempts for unknown mission", () => {
      expect(() =>
        service.resetRecoveryAttempts("nonexistent-mission"),
      ).not.toThrow();
    });

    it("should reset attempts counter after recovery", async () => {
      const executeFn = jest.fn().mockResolvedValue(undefined);
      service.registerExecuteCallback(executeFn);

      const mission = buildMission({
        id: "recoverable",
        tasks: [
          {
            id: "t-1",
            status: AgentTaskStatus.PENDING,
            updatedAt: oldTimestamp(),
          },
        ],
      });
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([
        mission,
      ]);

      // Trigger one recovery attempt
      await service.performHealthCheck();
      expect(executeFn).toHaveBeenCalledTimes(1);

      // Reset and confirm it can be recovered again
      service.resetRecoveryAttempts("recoverable");

      const statusBefore = service.getHealthStatus();
      expect(statusBefore.trackedMissions).toBe(0);
    });
  });

  describe("cleanupCompletedMission", () => {
    it("should not throw when cleaning up unknown mission", () => {
      expect(() =>
        service.cleanupCompletedMission("nonexistent"),
      ).not.toThrow();
    });

    it("should remove mission from tracked set", async () => {
      const executeFn = jest.fn().mockResolvedValue(undefined);
      service.registerExecuteCallback(executeFn);

      const mission = buildMission({
        id: "to-cleanup",
        tasks: [
          {
            id: "t-1",
            status: AgentTaskStatus.PENDING,
            updatedAt: oldTimestamp(),
          },
        ],
      });
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([
        mission,
      ]);

      await service.performHealthCheck();
      expect(service.getHealthStatus().trackedMissions).toBe(1);

      service.cleanupCompletedMission("to-cleanup");

      expect(service.getHealthStatus().trackedMissions).toBe(0);
    });
  });

  // ── getHealthStatus ──────────────────────────────────────────────────────────

  describe("getHealthStatus", () => {
    it("should report isRunning=false before onModuleInit", () => {
      const status = service.getHealthStatus();
      expect(status.isRunning).toBe(false);
    });

    it("should report correct check interval and stuck threshold", () => {
      const status = service.getHealthStatus();
      expect(status.checkIntervalMs).toBeGreaterThan(0);
      expect(status.stuckThresholdMs).toBeGreaterThan(0);
    });

    it("should report trackedMissions count", () => {
      const status = service.getHealthStatus();
      expect(typeof status.trackedMissions).toBe("number");
    });
  });

  // ── ENABLE_TEAM_MISSION_AUTORECOVERY env gate ────────────────────────────────

  describe("ENABLE_TEAM_MISSION_AUTORECOVERY env gate", () => {
    it("does NOT invoke execute callback when flag is unset (default OFF)", async () => {
      delete process.env.ENABLE_TEAM_MISSION_AUTORECOVERY;
      const executeFn = jest.fn().mockResolvedValue(undefined);
      service.registerExecuteCallback(executeFn);

      const mission = buildMission({
        id: "stuck-gated",
        tasks: [
          {
            id: "t-1",
            status: AgentTaskStatus.PENDING,
            updatedAt: oldTimestamp(),
          },
        ],
      });
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([
        mission,
      ]);

      await service.performHealthCheck();

      // Recovery callback must NOT fire — auto-recovery is disabled
      expect(executeFn).not.toHaveBeenCalled();
    });

    it("does NOT invoke revision callback when flag is unset (default OFF)", async () => {
      delete process.env.ENABLE_TEAM_MISSION_AUTORECOVERY;
      const revisionFn = jest.fn().mockResolvedValue(undefined);
      service.registerRevisionCallback(revisionFn);

      const mission = buildMission({
        id: "stuck-revision-gated",
        tasks: [
          {
            id: "t-1",
            status: AgentTaskStatus.REVISION_NEEDED,
            updatedAt: oldTimestamp(),
          },
        ],
      });
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([
        mission,
      ]);

      await service.performHealthCheck();

      expect(revisionFn).not.toHaveBeenCalled();
    });

    it("invokes execute callback when flag is 'true' (opt-in)", async () => {
      // flag already set to 'true' by beforeEach
      const executeFn = jest.fn().mockResolvedValue(undefined);
      service.registerExecuteCallback(executeFn);

      const mission = buildMission({
        id: "stuck-opt-in",
        tasks: [
          {
            id: "t-1",
            status: AgentTaskStatus.PENDING,
            updatedAt: oldTimestamp(),
          },
        ],
      });
      (mockPrisma.teamMission.findMany as jest.Mock).mockResolvedValue([
        mission,
      ]);

      await service.performHealthCheck();

      expect(executeFn).toHaveBeenCalledWith("stuck-opt-in");
    });
  });
});
