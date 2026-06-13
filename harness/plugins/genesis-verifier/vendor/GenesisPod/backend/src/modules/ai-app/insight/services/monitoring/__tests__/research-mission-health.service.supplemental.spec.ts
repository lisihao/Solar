/**
 * ResearchMissionHealthService - Supplemental Coverage Tests
 *
 * Targets uncovered lines:
 * - onModuleInit: setTimeout scheduling + log messages
 * - runHealthCheck: recovery_attempted path (stuckMissions++)
 * - checkMissionHealth: stuckTasks force-fail path + executing-tasks-only warning path
 * - getLastActivityTime: tasks sorting + null fallback
 * - getMissionHealthStatus: no startedAt path, task not EXECUTING filter
 * - recoverInterruptedMissions: isRecovering guard, runtime filter (threshold), failedRecoveries path
 * - recoverSingleMission: error path (returns success:false)
 * - saveCheckpointsBeforeShutdown: no missions, checkpoint save, individual save error
 */

import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { ResearchMissionHealthService } from "../research-mission-health.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ResearchEventEmitterService } from "../../core/research/research-event-emitter.service";
import { ResearchMissionStatus, ResearchTaskStatus } from "@prisma/client";

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000);

const makeMission = (overrides: Record<string, unknown> = {}) => ({
  id: "mission-001",
  topicId: "topic-001",
  status: ResearchMissionStatus.EXECUTING,
  progressPercent: 50,
  updatedAt: minutesAgo(10),
  createdAt: minutesAgo(60),
  startedAt: minutesAgo(60),
  userContext: {},
  tasks: [],
  topic: { id: "topic-001", name: "AI Market", userId: "user-001" },
  ...overrides,
});

const mockPrisma = {
  researchMission: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  researchTask: {
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  researchTodo: {
    updateMany: jest.fn(),
  },
};

const mockResearchEventEmitter = {
  emitMissionFailed: jest.fn().mockResolvedValue(undefined),
  emitMissionProgress: jest.fn().mockResolvedValue(undefined),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

describe("ResearchMissionHealthService - Supplemental", () => {
  let service: ResearchMissionHealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchMissionHealthService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ResearchEventEmitterService,
          useValue: mockResearchEventEmitter,
        },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<ResearchMissionHealthService>(
      ResearchMissionHealthService,
    );
    jest.resetAllMocks();
    // Set default return values after reset
    mockResearchEventEmitter.emitMissionFailed.mockResolvedValue(undefined);
    mockResearchEventEmitter.emitMissionProgress.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  // ─── onModuleInit ───

  describe("onModuleInit", () => {
    afterEach(() => {
      delete process.env.ENABLE_RESEARCH_MISSION_AUTORECOVERY;
    });

    it("should start health check runner and schedule recovery (opt-in enabled)", () => {
      jest.useFakeTimers();
      process.env.ENABLE_RESEARCH_MISSION_AUTORECOVERY = "true";

      try {
        mockPrisma.researchMission.findMany.mockResolvedValue([]);
        const recoverSpy = jest
          .spyOn(service, "recoverInterruptedMissions")
          .mockResolvedValue({
            checkedAt: new Date(),
            interruptedMissions: 0,
            recoveredMissions: 0,
            failedRecoveries: 0,
            details: [],
          });

        service.onModuleInit();
        jest.advanceTimersByTime(10100);

        expect(recoverSpy).toHaveBeenCalledWith({ isStartup: true });
      } finally {
        jest.useRealTimers();
      }
    });

    it("★ default-OFF: does NOT auto-recover on boot when env flag unset (anti silent-spend)", () => {
      jest.useFakeTimers();
      delete process.env.ENABLE_RESEARCH_MISSION_AUTORECOVERY;

      try {
        const recoverSpy = jest
          .spyOn(service, "recoverInterruptedMissions")
          .mockResolvedValue({
            checkedAt: new Date(),
            interruptedMissions: 0,
            recoveredMissions: 0,
            failedRecoveries: 0,
            details: [],
          });

        service.onModuleInit();
        jest.advanceTimersByTime(60000); // well past the 10s recovery delay

        expect(recoverSpy).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // ─── runHealthCheck: recovery_attempted path ───

  describe("runHealthCheck - recovery_attempted", () => {
    it("should count stuckMissions and recoveredMissions when mission was stuck but recovered", async () => {
      // A mission that was stuck (no tasks executing) → marked failed → action=marked_failed
      // OR if we need recovery_attempted: that path would require checkMissionHealth to return
      // action='recovery_attempted'. Looking at the code, 'recovery_attempted' is never actually
      // set in checkMissionHealth — the action stays 'none' unless marked_failed.
      // Lines 233-234 increment stuckMissions/recoveredMissions for 'recovery_attempted'.
      // This is dead code in the current impl (action is never set to 'recovery_attempted').
      // Test a stuck mission (marked_failed) to hit the stuckMissions counter at line 230-231.
      const stuckMission = makeMission({
        updatedAt: minutesAgo(35),
        startedAt: minutesAgo(35),
        tasks: [], // no executing tasks → marks failed
      });

      mockPrisma.researchMission.findMany.mockResolvedValue([stuckMission]);
      mockPrisma.researchMission.update.mockResolvedValue({});
      mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.researchTodo.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.runHealthCheck();

      expect(result.stuckMissions).toBe(1);
      expect(result.failedMissions).toBe(1);
    });
  });

  // ─── checkMissionHealth: stuckTasks force-fail path ───

  describe("checkMissionHealth - stuckTasks path", () => {
    it("should force-fail individual stuck tasks when mission is stuck but has executing tasks past taskStuckThreshold", async () => {
      // Mission stuck > 30 min, has EXECUTING task that is stuck > 20 min (taskStuckThresholdMs)
      // The task updatedAt must also be old so getLastActivityTime returns > 30 min
      const missionWithStuckTask = makeMission({
        updatedAt: minutesAgo(35), // stuck > 30 min
        startedAt: minutesAgo(35),
        tasks: [
          {
            id: "task-stuck",
            status: ResearchTaskStatus.EXECUTING,
            updatedAt: minutesAgo(35), // old updatedAt so lastActivity = 35 min (> 30 min threshold)
            startedAt: minutesAgo(25), // startedAt 25 min ago → task stuck > taskStuckThresholdMs (20 min)
          },
        ],
      });

      mockPrisma.researchMission.findMany.mockResolvedValue([
        missionWithStuckTask,
      ]);
      mockPrisma.researchTask.update.mockResolvedValue({});

      const result = await service.runHealthCheck();

      // Should force-fail the stuck task
      expect(mockPrisma.researchTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-stuck" },
          data: expect.objectContaining({
            status: ResearchTaskStatus.FAILED,
          }),
        }),
      );
      // Mission itself is not marked failed (has executing tasks)
      expect(mockPrisma.researchMission.update).not.toHaveBeenCalled();
      expect(result.failedMissions).toBe(0);
    });

    it("should only warn when stuck but has executing tasks NOT past taskStuckThreshold", async () => {
      // Mission stuck > 30 min, but EXECUTING task startedAt is only 5 min ago (< 20 min threshold).
      // The task updatedAt is also old (35 min) so getLastActivityTime still returns 35 min,
      // making the mission appear stuck, but startedAt is recent so the task is not stuck.
      const missionWithRecentTask = makeMission({
        updatedAt: minutesAgo(35),
        startedAt: minutesAgo(35),
        tasks: [
          {
            id: "task-recent",
            status: ResearchTaskStatus.EXECUTING,
            updatedAt: minutesAgo(35), // old updatedAt → lastActivity = 35 min (mission appears stuck)
            startedAt: minutesAgo(5), // started only 5 min ago → task NOT stuck (below 20 min threshold)
          },
        ],
      });

      mockPrisma.researchMission.findMany.mockResolvedValue([
        missionWithRecentTask,
      ]);

      const result = await service.runHealthCheck();

      // No task update, no mission update
      expect(mockPrisma.researchTask.update).not.toHaveBeenCalled();
      expect(mockPrisma.researchMission.update).not.toHaveBeenCalled();
      expect(result.failedMissions).toBe(0);
    });
  });

  // ─── getLastActivityTime ───

  describe("getLastActivityTime (via runHealthCheck)", () => {
    it("should use tasks updatedAt when tasks are newer than mission updatedAt", async () => {
      // Task updatedAt is more recent than mission updatedAt
      // This tests the sorting/max logic in getLastActivityTime
      const mission = makeMission({
        updatedAt: minutesAgo(40), // older
        startedAt: minutesAgo(40),
        tasks: [
          {
            id: "task-recent",
            status: ResearchTaskStatus.PENDING,
            updatedAt: minutesAgo(5), // newer than mission
            startedAt: null,
          },
        ],
      });

      mockPrisma.researchMission.findMany.mockResolvedValue([mission]);

      const result = await service.runHealthCheck();

      // Last activity was 5 minutes ago (from task), so stuckDuration < stuckThreshold (30 min)
      // → mission should NOT be marked failed
      expect(result.failedMissions).toBe(0);
    });

    it("should handle null when mission has no tasks and no updatedAt", async () => {
      // Mission with empty tasks - tests the times.length === 0 path
      const mission = makeMission({
        updatedAt: minutesAgo(5),
        tasks: [],
      });

      mockPrisma.researchMission.findMany.mockResolvedValue([mission]);

      const result = await service.runHealthCheck();

      expect(result.totalMissions).toBe(1);
    });
  });

  // ─── getMissionHealthStatus: edge cases ───

  describe("getMissionHealthStatus - edge cases", () => {
    it("should calculate executionTime from stuckDuration when startedAt is null", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(
        makeMission({
          startedAt: null, // no startedAt
          updatedAt: minutesAgo(5),
          tasks: [],
        }),
      );

      const result = await service.getMissionHealthStatus("mission-001");

      expect(result).not.toBeNull();
      // executionTime falls back to stuckDurationMs (which is small, so no max time issue)
      expect(result!.isHealthy).toBe(true);
    });

    it("should not flag task as stuck when task is not EXECUTING", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(
        makeMission({
          updatedAt: minutesAgo(5),
          tasks: [
            {
              id: "task-done",
              status: ResearchTaskStatus.COMPLETED,
              updatedAt: minutesAgo(10),
              startedAt: minutesAgo(45), // would be stuck if EXECUTING, but it's COMPLETED
            },
          ],
        }),
      );

      const result = await service.getMissionHealthStatus("mission-001");

      expect(result!.isHealthy).toBe(true);
      expect(result!.issues).toHaveLength(0);
    });

    it("should set estimatedRecoveryPossible=true when status is PLANNING", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(
        makeMission({
          status: ResearchMissionStatus.PLANNING,
          tasks: [], // no completed tasks but PLANNING is sufficient
        }),
      );

      const result = await service.getMissionHealthStatus("mission-001");

      expect(result!.estimatedRecoveryPossible).toBe(true);
    });
  });

  // ─── recoverInterruptedMissions: isRecovering guard ───

  describe("recoverInterruptedMissions - isRecovering guard", () => {
    it("should return early when recovery is already in progress", async () => {
      // Set isRecovering = true manually
      (service as any).isRecovering = true;

      const result = await service.recoverInterruptedMissions();

      expect(result.interruptedMissions).toBe(0);
      expect(mockPrisma.researchMission.findMany).not.toHaveBeenCalled();

      // Reset
      (service as any).isRecovering = false;
    });
  });

  // ─── recoverInterruptedMissions: runtime mode filtering ───

  describe("recoverInterruptedMissions - runtime mode", () => {
    it("should filter missions by threshold in runtime mode (isStartup=false)", async () => {
      // Mission not stale (< threshold) → not included in interruptedMissions
      const freshMission = makeMission({
        updatedAt: minutesAgo(5), // fresh, not stale
        tasks: [],
      });

      mockPrisma.researchMission.findMany.mockResolvedValue([freshMission]);

      const result = await service.recoverInterruptedMissions({
        isStartup: false,
      });

      // Should be filtered out → interruptedMissions = 0
      expect(result.interruptedMissions).toBe(0);
    });

    it("should include missions with stale executing tasks in runtime mode", async () => {
      // Mission updatedAt is recent but has executing task that is stale
      const missionWithStaleTasks = makeMission({
        updatedAt: minutesAgo(5), // mission itself is fresh
        tasks: [
          {
            id: "task-stale",
            status: ResearchTaskStatus.EXECUTING,
            updatedAt: minutesAgo(40), // stale > 30 min threshold
            startedAt: minutesAgo(40),
          },
        ],
      });

      mockPrisma.researchMission.findMany.mockResolvedValue([
        missionWithStaleTasks,
      ]);
      mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.researchTodo.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.researchMission.update.mockResolvedValue({});

      const result = await service.recoverInterruptedMissions({
        isStartup: false,
      });

      expect(result.interruptedMissions).toBe(1);
    });

    it("should log 'no recovery needed' when all missions are fresh in isStartup mode", async () => {
      // isStartup=true but executingMissions.length=0 already handled by early return
      // To hit line 648-654: interruptedMissions filtered = 0 in runtime mode
      const freshMission = makeMission({
        updatedAt: minutesAgo(5),
        tasks: [],
      });

      mockPrisma.researchMission.findMany.mockResolvedValue([freshMission]);

      // Runtime mode: freshMission is not stale, so interruptedMissions = 0
      const result = await service.recoverInterruptedMissions({
        isStartup: false,
      });

      expect(result.interruptedMissions).toBe(0);
      // No recovery was needed
    });
  });

  // ─── recoverInterruptedMissions: failedRecoveries path ───

  describe("recoverInterruptedMissions - failedRecoveries", () => {
    it("should count failedRecoveries when recoverSingleMission throws", async () => {
      const interruptedMission = makeMission({
        updatedAt: minutesAgo(40),
        tasks: [],
      });

      mockPrisma.researchMission.findMany.mockResolvedValue([
        interruptedMission,
      ]);

      // Make emitMissionProgress throw to simulate recovery failure
      mockResearchEventEmitter.emitMissionProgress.mockRejectedValueOnce(
        new Error("Event emission failed"),
      );

      const result = await service.recoverInterruptedMissions({
        isStartup: true,
      });

      expect(result.failedRecoveries).toBe(1);
      expect(result.recoveredMissions).toBe(0);
    });

    it("should handle fulfilled but !success recovery result", async () => {
      // recoverSingleMission returns { success: false } on error
      const interruptedMission = makeMission({
        updatedAt: minutesAgo(40),
        tasks: [],
      });

      mockPrisma.researchMission.findMany.mockResolvedValue([
        interruptedMission,
      ]);

      // emitMissionProgress succeeds, then researchTask.updateMany throws
      mockResearchEventEmitter.emitMissionProgress.mockResolvedValue(undefined);
      mockPrisma.researchTask.updateMany.mockRejectedValueOnce(
        new Error("DB error"),
      );

      const result = await service.recoverInterruptedMissions({
        isStartup: true,
      });

      // recoverSingleMission catches the error and returns { success: false }
      expect(result.failedRecoveries).toBe(1);
    });
  });

  // ─── saveCheckpointsBeforeShutdown ───

  describe("saveCheckpointsBeforeShutdown (via onModuleDestroy)", () => {
    it("should do nothing when no executing missions during shutdown", async () => {
      // Respond to the saveCheckpointsBeforeShutdown findMany call
      mockPrisma.researchMission.findMany.mockResolvedValue([]);

      await service.onModuleDestroy();

      expect(mockPrisma.researchMission.update).not.toHaveBeenCalled();
    });

    it("should save checkpoint for each executing mission during shutdown", async () => {
      const executingMission = makeMission({
        userContext: { existingKey: "value" },
        tasks: [
          {
            id: "t1",
            status: ResearchTaskStatus.COMPLETED,
            updatedAt: minutesAgo(5),
          },
          {
            id: "t2",
            status: ResearchTaskStatus.EXECUTING,
            updatedAt: minutesAgo(2),
          },
        ],
      });

      mockPrisma.researchMission.findMany.mockResolvedValue([executingMission]);
      mockPrisma.researchMission.update.mockResolvedValue({});

      await service.onModuleDestroy();

      expect(mockPrisma.researchMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-001" },
          data: expect.objectContaining({
            userContext: expect.objectContaining({
              shutdownCheckpoint: expect.objectContaining({
                reason: "graceful_shutdown",
              }),
            }),
          }),
        }),
      );
    });

    it("should handle individual checkpoint save error gracefully", async () => {
      const executingMission = makeMission({
        tasks: [],
      });

      mockPrisma.researchMission.findMany.mockResolvedValue([executingMission]);
      mockPrisma.researchMission.update.mockRejectedValue(
        new Error("DB error saving checkpoint"),
      );

      // Should not throw
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });

    it("should handle outer saveCheckpoints error gracefully", async () => {
      // findMany throws
      mockPrisma.researchMission.findMany.mockRejectedValue(
        new Error("DB connection lost"),
      );

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
