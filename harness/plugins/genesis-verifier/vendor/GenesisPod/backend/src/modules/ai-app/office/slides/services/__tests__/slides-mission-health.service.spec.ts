import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { SlidesMissionStatus, SlidesTaskStatus } from "@prisma/client";
import {
  SlidesMissionHealthService,
  HealthCheckResult,
  RecoveryResult,
  MissionHealthStatus,
} from "../slides-mission-health.service";
import { PrismaService } from "@/common/prisma/prisma.service";

// ============================================================================
// Helpers
// ============================================================================

const NOW = new Date("2026-01-01T12:00:00Z");

function msBefore(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function buildMission(
  overrides: Partial<{
    id: string;
    sessionId: string;
    status: SlidesMissionStatus;
    totalTasks: number;
    completedTasks: number;
    startedAt: Date | null;
    updatedAt: Date;
    createdAt: Date;
    metadata: unknown;
    tasks: Array<{
      id: string;
      status: SlidesTaskStatus;
      updatedAt: Date;
      startedAt: Date | null;
    }>;
  }> = {},
) {
  return {
    id: "mission-001",
    sessionId: "session-001",
    status: SlidesMissionStatus.EXECUTING,
    totalTasks: 10,
    completedTasks: 5,
    startedAt: msBefore(10 * 60 * 1000), // 10 minutes ago
    updatedAt: msBefore(5 * 60 * 1000), // 5 minutes ago
    createdAt: msBefore(15 * 60 * 1000),
    metadata: {},
    tasks: [],
    ...overrides,
  };
}

// ============================================================================
// Mock factories
// ============================================================================

const makePrismaMock = () => ({
  slidesMission: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  slidesTask: {
    updateMany: jest.fn(),
  },
});

const makeEventEmitterMock = () => ({
  emit: jest.fn(),
});

// ============================================================================
// Tests
// ============================================================================

describe("SlidesMissionHealthService", () => {
  let service: SlidesMissionHealthService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let eventEmitter: ReturnType<typeof makeEventEmitterMock>;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    prisma = makePrismaMock();
    eventEmitter = makeEventEmitterMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlidesMissionHealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<SlidesMissionHealthService>(
      SlidesMissionHealthService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    delete process.env.ENABLE_SLIDES_MISSION_AUTORECOVERY;
  });

  // --------------------------------------------------------------------------
  // onModuleInit / onModuleDestroy
  // --------------------------------------------------------------------------

  describe("onModuleInit", () => {
    it("should call startHealthCheckLoop and invoke findMany on the initial health check", async () => {
      prisma.slidesMission.findMany.mockResolvedValue([]);

      service.onModuleInit();
      // Allow the async initial health check to settle
      await Promise.resolve();
      await Promise.resolve();

      expect(prisma.slidesMission.findMany).toHaveBeenCalled();
    });

    it("should not throw synchronously even when findMany will reject", () => {
      prisma.slidesMission.findMany.mockRejectedValue(new Error("DB down"));

      // onModuleInit starts async tasks internally that swallow errors;
      // the call itself must not throw synchronously
      expect(() => service.onModuleInit()).not.toThrow();
    });
  });

  describe("onModuleDestroy", () => {
    it("should stop health check loop and save checkpoints", async () => {
      prisma.slidesMission.findMany.mockResolvedValue([]);

      await service.onModuleDestroy();

      // saveCheckpointsBeforeShutdown queries EXECUTING missions
      expect(prisma.slidesMission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: SlidesMissionStatus.EXECUTING },
        }),
      );
    });

    it("should not throw when checkpoint save fails", async () => {
      prisma.slidesMission.findMany.mockRejectedValue(new Error("DB error"));

      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // getConfig
  // --------------------------------------------------------------------------

  describe("getConfig", () => {
    it("should return a copy of HEALTH_CHECK_CONFIG", () => {
      const config = service.getConfig();
      expect(config.checkIntervalMs).toBe(5 * 60 * 1000);
      expect(config.stuckThresholdMs).toBe(30 * 60 * 1000);
      expect(config.maxExecutionTimeMs).toBe(2 * 60 * 60 * 1000);
      expect(config.maxRetries).toBe(3);
    });

    it("should return a defensive copy (not the original object)", () => {
      const config1 = service.getConfig();
      const config2 = service.getConfig();
      expect(config1).not.toBe(config2);
    });
  });

  // --------------------------------------------------------------------------
  // runHealthCheck / forceHealthCheck
  // --------------------------------------------------------------------------

  describe("runHealthCheck", () => {
    it("should return empty result when no active missions", async () => {
      prisma.slidesMission.findMany.mockResolvedValue([]);

      const result: HealthCheckResult = await service.runHealthCheck();

      expect(result.totalMissions).toBe(0);
      expect(result.stuckMissions).toBe(0);
      expect(result.details).toHaveLength(0);
    });

    it("should handle concurrent calls (overlap guarded by HealthCheckRunner)", async () => {
      // Overlap guard is now handled by HealthCheckRunner, not the service itself.
      // Direct runHealthCheck() calls run without skip logic.
      prisma.slidesMission.findMany.mockResolvedValue([]);

      const result = await service.runHealthCheck();
      expect(result.totalMissions).toBe(0);
      expect(result.details).toHaveLength(0);
    });

    it("should mark a mission failed when execution time exceeds 2 hours", async () => {
      const mission = buildMission({
        startedAt: msBefore(3 * 60 * 60 * 1000), // 3 hours ago
        updatedAt: msBefore(3 * 60 * 60 * 1000),
        tasks: [],
      });
      prisma.slidesMission.findMany.mockResolvedValue([mission]);
      prisma.slidesMission.update.mockResolvedValue(mission);
      prisma.slidesTask.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.runHealthCheck();

      expect(result.failedMissions).toBe(1);
      expect(result.stuckMissions).toBe(1);
      expect(prisma.slidesMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mission.id },
          data: expect.objectContaining({ status: SlidesMissionStatus.FAILED }),
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        "slides.mission.failed",
        expect.objectContaining({ missionId: mission.id }),
      );
    });

    it("should NOT mark failed when stuck >30min but has executing tasks", async () => {
      const mission = buildMission({
        startedAt: msBefore(40 * 60 * 1000),
        updatedAt: msBefore(40 * 60 * 1000),
        tasks: [
          {
            id: "task-001",
            status: SlidesTaskStatus.IN_PROGRESS,
            updatedAt: msBefore(35 * 60 * 1000),
            startedAt: msBefore(40 * 60 * 1000),
          },
        ],
      });
      prisma.slidesMission.findMany.mockResolvedValue([mission]);

      const result = await service.runHealthCheck();

      expect(result.failedMissions).toBe(0);
      expect(prisma.slidesMission.update).not.toHaveBeenCalled();
    });

    it("should mark failed when stuck >30min and has no executing tasks", async () => {
      const mission = buildMission({
        startedAt: msBefore(40 * 60 * 1000),
        updatedAt: msBefore(40 * 60 * 1000),
        tasks: [
          {
            id: "task-001",
            status: SlidesTaskStatus.COMPLETED,
            updatedAt: msBefore(35 * 60 * 1000),
            startedAt: msBefore(40 * 60 * 1000),
          },
        ],
      });
      prisma.slidesMission.findMany.mockResolvedValue([mission]);
      prisma.slidesMission.update.mockResolvedValue(mission);
      prisma.slidesTask.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.runHealthCheck();

      expect(result.failedMissions).toBe(1);
      expect(result.details[0].action).toBe("marked_failed");
    });

    it("should return action=none for a healthy mission", async () => {
      const mission = buildMission({
        startedAt: msBefore(5 * 60 * 1000),
        updatedAt: msBefore(1 * 60 * 1000),
        tasks: [],
      });
      prisma.slidesMission.findMany.mockResolvedValue([mission]);

      const result = await service.runHealthCheck();

      expect(result.failedMissions).toBe(0);
      expect(result.details[0].action).toBe("none");
    });

    it("should query PLANNING, EXECUTING, and REVIEWING missions", async () => {
      prisma.slidesMission.findMany.mockResolvedValue([]);

      await service.runHealthCheck();

      expect(prisma.slidesMission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: {
              in: expect.arrayContaining([
                SlidesMissionStatus.PLANNING,
                SlidesMissionStatus.EXECUTING,
                SlidesMissionStatus.REVIEWING,
              ]),
            },
          },
        }),
      );
    });

    it("forceHealthCheck delegates to runHealthCheck", async () => {
      prisma.slidesMission.findMany.mockResolvedValue([]);
      const result = await service.forceHealthCheck();
      expect(result).toHaveProperty("checkedAt");
    });
  });

  // --------------------------------------------------------------------------
  // getMissionHealthStatus
  // --------------------------------------------------------------------------

  describe("getMissionHealthStatus", () => {
    it("should return null when mission not found", async () => {
      prisma.slidesMission.findUnique.mockResolvedValue(null);

      const result = await service.getMissionHealthStatus("nonexistent");

      expect(result).toBeNull();
    });

    it("should return healthy status for a running mission with no issues", async () => {
      const mission = {
        ...buildMission(),
        status: SlidesMissionStatus.EXECUTING,
        tasks: [],
      };
      prisma.slidesMission.findUnique.mockResolvedValue(mission);

      const result = (await service.getMissionHealthStatus(
        mission.id,
      )) as MissionHealthStatus;

      expect(result.isHealthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("should report issues for a stuck mission", async () => {
      const mission = {
        ...buildMission({
          updatedAt: msBefore(35 * 60 * 1000),
          startedAt: msBefore(35 * 60 * 1000),
        }),
        tasks: [],
      };
      prisma.slidesMission.findUnique.mockResolvedValue(mission);

      const result = (await service.getMissionHealthStatus(
        mission.id,
      )) as MissionHealthStatus;

      expect(result.isHealthy).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("should report execution timeout issue", async () => {
      const mission = {
        ...buildMission({
          startedAt: msBefore(3 * 60 * 60 * 1000),
          updatedAt: msBefore(3 * 60 * 60 * 1000),
        }),
        tasks: [],
      };
      prisma.slidesMission.findUnique.mockResolvedValue(mission);

      const result = (await service.getMissionHealthStatus(
        mission.id,
      )) as MissionHealthStatus;

      expect(result.issues.some((i) => i.includes("120"))).toBe(true);
    });

    it("should correctly calculate progress from task counts", async () => {
      const mission = {
        ...buildMission({ totalTasks: 10, completedTasks: 7 }),
        tasks: [],
      };
      prisma.slidesMission.findUnique.mockResolvedValue(mission);

      const result = (await service.getMissionHealthStatus(
        mission.id,
      )) as MissionHealthStatus;

      expect(result.progress).toBe(70);
    });

    it("should set estimatedRecoveryPossible=true when in PLANNING status", async () => {
      const mission = {
        ...buildMission({ status: SlidesMissionStatus.PLANNING }),
        tasks: [],
      };
      prisma.slidesMission.findUnique.mockResolvedValue(mission);

      const result = (await service.getMissionHealthStatus(
        mission.id,
      )) as MissionHealthStatus;

      expect(result.estimatedRecoveryPossible).toBe(true);
    });

    it("should set estimatedRecoveryPossible=true when completed tasks exist", async () => {
      const mission = {
        ...buildMission({ status: SlidesMissionStatus.FAILED }),
        tasks: [
          {
            id: "t1",
            status: SlidesTaskStatus.COMPLETED,
            updatedAt: msBefore(5 * 60 * 1000),
            startedAt: msBefore(10 * 60 * 1000),
          },
        ],
      };
      prisma.slidesMission.findUnique.mockResolvedValue(mission);

      const result = (await service.getMissionHealthStatus(
        mission.id,
      )) as MissionHealthStatus;

      expect(result.estimatedRecoveryPossible).toBe(true);
    });

    it("should flag stuck IN_PROGRESS tasks as issues", async () => {
      const mission = {
        ...buildMission(),
        tasks: [
          {
            id: "t1",
            status: SlidesTaskStatus.IN_PROGRESS,
            updatedAt: msBefore(35 * 60 * 1000),
            startedAt: msBefore(35 * 60 * 1000),
          },
        ],
      };
      prisma.slidesMission.findUnique.mockResolvedValue(mission);

      const result = (await service.getMissionHealthStatus(
        mission.id,
      )) as MissionHealthStatus;

      expect(result.issues.some((i) => i.includes("1 个任务"))).toBe(true);
    });

    it("should mark FAILED mission as not healthy", async () => {
      const mission = {
        ...buildMission({ status: SlidesMissionStatus.FAILED }),
        tasks: [],
      };
      prisma.slidesMission.findUnique.mockResolvedValue(mission);

      const result = (await service.getMissionHealthStatus(
        mission.id,
      )) as MissionHealthStatus;

      expect(result.isHealthy).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // canResume
  // --------------------------------------------------------------------------

  describe("canResume", () => {
    it("should return false when mission not found", async () => {
      prisma.slidesMission.findUnique.mockResolvedValue(null);
      expect(await service.canResume("nonexistent")).toBe(false);
    });

    it("should return false for an EXECUTING mission", async () => {
      const mission = {
        ...buildMission({ status: SlidesMissionStatus.EXECUTING }),
        tasks: [],
      };
      prisma.slidesMission.findUnique.mockResolvedValue(mission);
      expect(await service.canResume(mission.id)).toBe(false);
    });

    it("should return false for a FAILED mission with no completed tasks", async () => {
      const mission = {
        ...buildMission({ status: SlidesMissionStatus.FAILED }),
        tasks: [],
      };
      prisma.slidesMission.findUnique.mockResolvedValue(mission);
      expect(await service.canResume(mission.id)).toBe(false);
    });

    it("should return true for a FAILED mission with completed tasks", async () => {
      const mission = {
        ...buildMission({ status: SlidesMissionStatus.FAILED }),
        tasks: [
          {
            id: "t1",
            status: SlidesTaskStatus.COMPLETED,
            updatedAt: msBefore(5 * 60 * 1000),
            startedAt: null,
          },
        ],
      };
      prisma.slidesMission.findUnique.mockResolvedValue(mission);
      expect(await service.canResume(mission.id)).toBe(true);
    });

    it("should return true for a CANCELLED mission with completed tasks", async () => {
      const mission = {
        ...buildMission({ status: SlidesMissionStatus.CANCELLED }),
        tasks: [
          {
            id: "t1",
            status: SlidesTaskStatus.COMPLETED,
            updatedAt: msBefore(5 * 60 * 1000),
            startedAt: null,
          },
        ],
      };
      prisma.slidesMission.findUnique.mockResolvedValue(mission);
      expect(await service.canResume(mission.id)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // recoverInterruptedMissions
  // --------------------------------------------------------------------------

  describe("recoverInterruptedMissions", () => {
    it("should return empty result when no EXECUTING missions", async () => {
      prisma.slidesMission.findMany.mockResolvedValue([]);

      const result: RecoveryResult = await service.recoverInterruptedMissions();

      expect(result.interruptedMissions).toBe(0);
      expect(result.recoveredMissions).toBe(0);
    });

    it("should skip missions that are recently active", async () => {
      const mission = buildMission({
        updatedAt: msBefore(1 * 60 * 1000), // only 1 minute ago (< 5 min threshold)
        tasks: [],
      });
      prisma.slidesMission.findMany.mockResolvedValue([mission]);

      const result = await service.recoverInterruptedMissions();

      expect(result.interruptedMissions).toBe(0);
    });

    it("should skip concurrent recovery calls", async () => {
      let firstResolve!: () => void;
      const slow = new Promise<void>((res) => {
        firstResolve = res;
      });
      prisma.slidesMission.findMany.mockReturnValueOnce(slow.then(() => []));

      const first = service.recoverInterruptedMissions();
      const second = service.recoverInterruptedMissions(); // should skip

      const skipped = await second;
      expect(skipped.interruptedMissions).toBe(0);

      firstResolve();
      await first;
    });

    it("should recover a stale EXECUTING mission and emit event", async () => {
      const mission = buildMission({
        updatedAt: msBefore(10 * 60 * 1000), // 10 min old > 5 min threshold
        tasks: [
          {
            id: "t1",
            status: SlidesTaskStatus.IN_PROGRESS,
            updatedAt: msBefore(10 * 60 * 1000),
            startedAt: msBefore(10 * 60 * 1000),
          },
        ],
      });
      prisma.slidesMission.findMany.mockResolvedValue([mission]);
      prisma.slidesTask.updateMany.mockResolvedValue({ count: 1 });
      prisma.slidesMission.update.mockResolvedValue(mission);

      const result = await service.recoverInterruptedMissions();

      expect(result.interruptedMissions).toBe(1);
      expect(result.recoveredMissions).toBe(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        "slides.mission.recovery_needed",
        expect.objectContaining({
          missionId: mission.id,
          resetTaskCount: 1,
        }),
      );
    });

    it("should count failed recovery attempts separately", async () => {
      const mission = buildMission({
        updatedAt: msBefore(10 * 60 * 1000),
        tasks: [],
      });
      prisma.slidesMission.findMany.mockResolvedValue([mission]);
      prisma.slidesTask.updateMany.mockRejectedValue(new Error("DB error"));

      const result = await service.recoverInterruptedMissions();

      expect(result.interruptedMissions).toBe(1);
      expect(result.failedRecoveries).toBe(1);
      expect(result.recoveredMissions).toBe(0);
    });

    it("should reset IN_PROGRESS tasks to PENDING during recovery", async () => {
      const mission = buildMission({
        updatedAt: msBefore(10 * 60 * 1000),
        tasks: [],
      });
      prisma.slidesMission.findMany.mockResolvedValue([mission]);
      prisma.slidesTask.updateMany.mockResolvedValue({ count: 2 });
      prisma.slidesMission.update.mockResolvedValue(mission);

      await service.recoverInterruptedMissions();

      expect(prisma.slidesTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            missionId: mission.id,
            status: SlidesTaskStatus.IN_PROGRESS,
          },
          data: expect.objectContaining({
            status: SlidesTaskStatus.PENDING,
            startedAt: null,
          }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // ENABLE_SLIDES_MISSION_AUTORECOVERY env gate
  // --------------------------------------------------------------------------

  describe("ENABLE_SLIDES_MISSION_AUTORECOVERY env gate", () => {
    it("does NOT arm the recovery setTimeout when flag is unset (default OFF)", () => {
      // health check loop still starts; only the recovery delay must be suppressed
      prisma.slidesMission.findMany.mockResolvedValue([]);

      service.onModuleInit();

      // The health-check loop may run, but the guard early-returns before
      // scheduling recoverInterruptedMissions, which is the only path that
      // queries EXECUTING missions for auto-resume. So that query must not fire.
      expect(prisma.slidesMission.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: SlidesMissionStatus.EXECUTING },
        }),
      );
    });

    it("calls recoverInterruptedMissions when flag is 'true' (opt-in)", async () => {
      process.env.ENABLE_SLIDES_MISSION_AUTORECOVERY = "true";
      // findMany returns [] for both health check and recovery
      prisma.slidesMission.findMany.mockResolvedValue([]);

      service.onModuleInit();

      // Advance fake timer to trigger the recovery setTimeout (10s delay)
      await jest.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();

      // recoverInterruptedMissions queries EXECUTING missions
      expect(prisma.slidesMission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: SlidesMissionStatus.EXECUTING },
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // saveCheckpointsBeforeShutdown (tested via onModuleDestroy)
  // --------------------------------------------------------------------------

  describe("saveCheckpointsBeforeShutdown", () => {
    it("should save shutdown checkpoint metadata for each executing mission", async () => {
      const mission = {
        ...buildMission({ completedTasks: 3, totalTasks: 10 }),
        tasks: [
          {
            id: "t1",
            status: SlidesTaskStatus.COMPLETED,
            updatedAt: NOW,
            startedAt: null,
          },
          {
            id: "t2",
            status: SlidesTaskStatus.IN_PROGRESS,
            updatedAt: NOW,
            startedAt: null,
          },
        ],
      };
      prisma.slidesMission.findMany.mockResolvedValue([mission]);
      prisma.slidesMission.update.mockResolvedValue(mission);

      await service.onModuleDestroy();

      expect(prisma.slidesMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mission.id },
          data: expect.objectContaining({
            metadata: expect.objectContaining({
              shutdownCheckpoint: expect.objectContaining({
                reason: "graceful_shutdown",
              }),
            }),
          }),
        }),
      );
    });

    it("should not throw even if individual mission update fails", async () => {
      const mission = { ...buildMission(), tasks: [] };
      prisma.slidesMission.findMany.mockResolvedValue([mission]);
      prisma.slidesMission.update.mockRejectedValue(new Error("write error"));

      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });
});
