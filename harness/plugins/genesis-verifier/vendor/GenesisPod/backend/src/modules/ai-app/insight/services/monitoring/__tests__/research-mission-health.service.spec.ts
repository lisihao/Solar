/**
 * ResearchMissionHealthService Unit Tests
 *
 * Coverage targets:
 * - runHealthCheck: skips when already running, no active missions returns early
 * - runHealthCheck: marks failed when execution time exceeded
 * - runHealthCheck: marks failed when stuck with no executing tasks
 * - runHealthCheck: warns only when stuck but has executing tasks
 * - getMissionHealthStatus: returns null when not found, builds MissionHealthStatus
 * - canResume: false when not found, false when not failed/cancelled, true with completed tasks
 * - getConfig: returns health check configuration
 * - forceHealthCheck: delegates to runHealthCheck
 * - recoverInterruptedMissions: no executing missions returns early
 * - onModuleDestroy: clears interval and calls saveCheckpoints
 */

import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { ResearchMissionHealthService } from "../research-mission-health.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ResearchEventEmitterService } from "../../core/research/research-event-emitter.service";
import { ResearchMissionStatus, ResearchTaskStatus } from "@prisma/client";

// ──────────────────────────────────────────────────────────────────────────────
// Mock fixtures
// ──────────────────────────────────────────────────────────────────────────────

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000);

const makeMission = (overrides: Record<string, unknown> = {}) => ({
  id: "mission-001",
  topicId: "topic-001",
  status: ResearchMissionStatus.EXECUTING,
  progressPercent: 50,
  updatedAt: minutesAgo(10), // recently updated
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

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("ResearchMissionHealthService", () => {
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
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up interval if started
    await service.onModuleDestroy();
  });

  // ─────────────────────────── runHealthCheck ───────────────────────────────

  describe("runHealthCheck", () => {
    it("should return zero counts when no active missions", async () => {
      mockPrisma.researchMission.findMany.mockResolvedValue([]);

      const result = await service.runHealthCheck();

      expect(result.totalMissions).toBe(0);
      expect(result.stuckMissions).toBe(0);
    });

    it("should mark mission as failed when execution time exceeded (6+ hours)", async () => {
      const longRunningMission = makeMission({
        startedAt: new Date(now.getTime() - 7 * 60 * 60 * 1000), // 7 hours ago
        updatedAt: minutesAgo(5),
        tasks: [],
      });
      mockPrisma.researchMission.findMany.mockResolvedValue([
        longRunningMission,
      ]);
      mockPrisma.researchMission.update.mockResolvedValue({});
      mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.researchTodo.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.runHealthCheck();

      expect(result.failedMissions).toBeGreaterThan(0);
      expect(mockPrisma.researchMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchMissionStatus.FAILED,
          }),
        }),
      );
    });

    it("should mark stuck mission as failed when no executing tasks", async () => {
      const stuckMission = makeMission({
        updatedAt: minutesAgo(35), // stuck > 30 min
        startedAt: minutesAgo(35),
        tasks: [
          {
            id: "task-001",
            status: ResearchTaskStatus.PENDING,
            updatedAt: minutesAgo(35),
            startedAt: null,
          },
        ],
      });
      mockPrisma.researchMission.findMany.mockResolvedValue([stuckMission]);
      mockPrisma.researchMission.update.mockResolvedValue({});
      mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.researchTodo.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.runHealthCheck();

      expect(result.stuckMissions).toBeGreaterThan(0);
    });

    it("should not mark failed when stuck but has executing tasks", async () => {
      const missionWithExecutingTask = makeMission({
        updatedAt: minutesAgo(35), // inactive > 30 min
        startedAt: minutesAgo(35),
        tasks: [
          {
            id: "task-001",
            status: ResearchTaskStatus.EXECUTING,
            updatedAt: minutesAgo(5),
            startedAt: minutesAgo(35),
          },
        ],
      });
      mockPrisma.researchMission.findMany.mockResolvedValue([
        missionWithExecutingTask,
      ]);

      const result = await service.runHealthCheck();

      expect(result.failedMissions).toBe(0);
      expect(mockPrisma.researchMission.update).not.toHaveBeenCalled();
    });

    it("should return result with checkedAt timestamp", async () => {
      mockPrisma.researchMission.findMany.mockResolvedValue([]);

      const result = await service.runHealthCheck();

      expect(result.checkedAt).toBeInstanceOf(Date);
    });
  });

  // ────────────────────────── getMissionHealthStatus ────────────────────────

  describe("getMissionHealthStatus", () => {
    it("should return null when mission not found", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(null);

      const result = await service.getMissionHealthStatus("nonexistent-id");

      expect(result).toBeNull();
    });

    it("should return healthy status for recently active mission", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(
        makeMission({ updatedAt: minutesAgo(2), tasks: [] }),
      );

      const result = await service.getMissionHealthStatus("mission-001");

      expect(result).not.toBeNull();
      expect(result!.isHealthy).toBe(true);
      expect(result!.issues).toHaveLength(0);
    });

    it("should flag stuck issues for inactive mission", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(
        makeMission({
          updatedAt: minutesAgo(40),
          startedAt: minutesAgo(40),
          tasks: [],
        }),
      );

      const result = await service.getMissionHealthStatus("mission-001");

      expect(result!.isHealthy).toBe(false);
      expect(result!.issues.length).toBeGreaterThan(0);
    });

    it("should detect stuck executing tasks", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(
        makeMission({
          updatedAt: minutesAgo(5),
          startedAt: minutesAgo(60),
          tasks: [
            {
              id: "task-001",
              status: ResearchTaskStatus.EXECUTING,
              updatedAt: minutesAgo(5),
              startedAt: minutesAgo(45), // executing for 45 min > 30 min threshold
            },
          ],
        }),
      );

      const result = await service.getMissionHealthStatus("mission-001");

      expect(result!.issues.some((i) => i.includes("执行时间过长"))).toBe(true);
    });

    it("should set estimatedRecoveryPossible when there are completed tasks", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(
        makeMission({
          tasks: [
            {
              id: "task-001",
              status: ResearchTaskStatus.COMPLETED,
              updatedAt: minutesAgo(10),
              startedAt: minutesAgo(30),
            },
          ],
        }),
      );

      const result = await service.getMissionHealthStatus("mission-001");

      expect(result!.estimatedRecoveryPossible).toBe(true);
    });
  });

  // ─────────────────────────── canResume ────────────────────────────────────

  describe("canResume", () => {
    it("should return false when mission not found", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(null);

      const result = await service.canResume("nonexistent-id");

      expect(result).toBe(false);
    });

    it("should return false when mission status is EXECUTING", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(
        makeMission({
          status: ResearchMissionStatus.EXECUTING,
          tasks: [{ status: ResearchTaskStatus.COMPLETED }],
        }),
      );

      const result = await service.canResume("mission-001");

      expect(result).toBe(false);
    });

    it("should return false when no completed tasks", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(
        makeMission({
          status: ResearchMissionStatus.FAILED,
          tasks: [
            {
              status: ResearchTaskStatus.FAILED,
              updatedAt: now,
              startedAt: null,
            },
          ],
        }),
      );

      const result = await service.canResume("mission-001");

      expect(result).toBe(false);
    });

    it("should return true when failed mission has completed tasks", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(
        makeMission({
          status: ResearchMissionStatus.FAILED,
          tasks: [
            {
              id: "task-001",
              status: ResearchTaskStatus.COMPLETED,
              updatedAt: minutesAgo(20),
              startedAt: minutesAgo(40),
            },
            {
              id: "task-002",
              status: ResearchTaskStatus.FAILED,
              updatedAt: minutesAgo(10),
              startedAt: minutesAgo(20),
            },
          ],
        }),
      );

      const result = await service.canResume("mission-001");

      expect(result).toBe(true);
    });
  });

  // ─────────────────────────── getConfig ────────────────────────────────────

  describe("getConfig", () => {
    it("should return health check configuration", () => {
      const config = service.getConfig();

      expect(config.checkIntervalMs).toBeGreaterThan(0);
      expect(config.stuckThresholdMs).toBeGreaterThan(0);
      expect(config.maxExecutionTimeMs).toBeGreaterThan(
        config.stuckThresholdMs,
      );
      expect(config.maxRetries).toBeGreaterThan(0);
    });
  });

  // ──────────────────── recoverInterruptedMissions ──────────────────────────

  describe("recoverInterruptedMissions", () => {
    it("should return zero counts when no executing missions", async () => {
      mockPrisma.researchMission.findMany.mockResolvedValue([]);

      const result = await service.recoverInterruptedMissions();

      expect(result.interruptedMissions).toBe(0);
      expect(result.recoveredMissions).toBe(0);
    });

    it("should recover interrupted mission by resetting executing tasks", async () => {
      const interruptedMission = makeMission({
        updatedAt: new Date(now.getTime() - 35 * 60 * 1000), // stale > 30 min threshold
        tasks: [
          {
            id: "task-001",
            status: ResearchTaskStatus.EXECUTING,
            updatedAt: new Date(now.getTime() - 35 * 60 * 1000),
            startedAt: new Date(now.getTime() - 60 * 60 * 1000),
          },
        ],
      });
      mockPrisma.researchMission.findMany.mockResolvedValue([
        interruptedMission,
      ]);
      mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.researchTodo.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.researchMission.update.mockResolvedValue({});

      const result = await service.recoverInterruptedMissions();

      expect(result.interruptedMissions).toBeGreaterThan(0);
      expect(mockResearchEventEmitter.emitMissionProgress).toHaveBeenCalled();
    });
  });

  // ─────────────────────────── forceHealthCheck ─────────────────────────────

  describe("forceHealthCheck", () => {
    it("should run health check and return result", async () => {
      mockPrisma.researchMission.findMany.mockResolvedValue([]);

      const result = await service.forceHealthCheck();

      expect(result).toBeDefined();
      expect(result.checkedAt).toBeInstanceOf(Date);
    });
  });

  // ─────────────────────────── onModuleDestroy ──────────────────────────────

  describe("onModuleDestroy", () => {
    it("should stop health check interval and save checkpoints", async () => {
      mockPrisma.researchMission.findMany.mockResolvedValue([]);

      await service.onModuleDestroy();

      // No interval should be running after destroy
      // Checkpoint save is attempted even with empty mission list
      expect(mockPrisma.researchMission.findMany).toHaveBeenCalled();
    });
  });
});
