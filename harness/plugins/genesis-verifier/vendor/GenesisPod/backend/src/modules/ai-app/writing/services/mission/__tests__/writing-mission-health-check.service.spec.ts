/**
 * Unit tests for WritingMissionHealthCheckService
 *
 * Covers:
 * - onModuleInit / onModuleDestroy lifecycle
 * - getHealthStatus: reports correct configuration values
 * - performHealthCheck: no stuck missions path
 * - performHealthCheck: stuck missions found and marked as FAILED
 * - performHealthCheck: handles Prisma errors gracefully
 * - manualHealthCheck: returns stuck missions list
 * - findStuckMissions: filters missions by stuck threshold and max execution time
 * - markMissionAsFailed: updates mission and project status
 */

import { Test, TestingModule } from "@nestjs/testing";
import { WritingMissionHealthCheckService } from "../writing-mission-health-check.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

// ==================== Helpers ====================

function buildMockPrisma() {
  return {
    writingMission: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    writingProject: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

function makeInProgressMission(
  overrides: Partial<{
    id: string;
    projectId: string;
    missionType: string;
    status: string;
    createdAt: Date;
    startedAt: Date | null;
    updatedAt: Date;
  }> = {},
) {
  const now = new Date();
  return {
    id: "mission-1",
    projectId: "project-1",
    missionType: "WRITE_CHAPTER",
    status: "IN_PROGRESS",
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ==================== Tests ====================

describe("WritingMissionHealthCheckService", () => {
  let service: WritingMissionHealthCheckService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    jest.useFakeTimers();
    mockPrisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingMissionHealthCheckService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WritingMissionHealthCheckService>(
      WritingMissionHealthCheckService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  // ==================== Lifecycle ====================

  describe("lifecycle", () => {
    it("should start scheduler on onModuleInit", () => {
      // onModuleInit is called by NestJS after compile
      service.onModuleInit();
      const status = service.getHealthStatus();
      expect(status.isRunning).toBe(true);
    });

    it("should stop scheduler on onModuleDestroy", () => {
      service.onModuleInit();
      expect(service.getHealthStatus().isRunning).toBe(true);

      service.onModuleDestroy();
      expect(service.getHealthStatus().isRunning).toBe(false);
    });

    it("should not throw when onModuleDestroy called without init", () => {
      expect(() => service.onModuleDestroy()).not.toThrow();
    });

    it("should not duplicate intervals when onModuleInit called twice", () => {
      service.onModuleInit();
      service.onModuleInit(); // Called again
      const status = service.getHealthStatus();
      expect(status.isRunning).toBe(true);
    });
  });

  // ==================== getHealthStatus ====================

  describe("getHealthStatus", () => {
    it("should return correct configuration values", () => {
      const status = service.getHealthStatus();

      expect(status.checkIntervalMs).toBe(5 * 60 * 1000);
      expect(status.stuckThresholdMs).toBe(30 * 60 * 1000);
      expect(status.maxExecutionTimeMs).toBe(2 * 60 * 60 * 1000);
    });

    it("should report isRunning=false before init", () => {
      const status = service.getHealthStatus();
      expect(status.isRunning).toBe(false);
    });

    it("should report isRunning=true after init", () => {
      service.onModuleInit();
      const status = service.getHealthStatus();
      expect(status.isRunning).toBe(true);
    });

    it("should report isRunning=false after destroy", () => {
      service.onModuleInit();
      service.onModuleDestroy();
      const status = service.getHealthStatus();
      expect(status.isRunning).toBe(false);
    });
  });

  // ==================== performHealthCheck ====================

  describe("performHealthCheck", () => {
    it("should complete without error when no missions are in progress", async () => {
      mockPrisma.writingMission.findMany.mockResolvedValue([]);

      await expect(service.performHealthCheck()).resolves.toBeUndefined();
      expect(mockPrisma.writingMission.update).not.toHaveBeenCalled();
    });

    it("should not mark fresh missions as failed", async () => {
      const freshMission = makeInProgressMission({
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: new Date(),
      });
      mockPrisma.writingMission.findMany.mockResolvedValue([freshMission]);

      await service.performHealthCheck();

      expect(mockPrisma.writingMission.update).not.toHaveBeenCalled();
    });

    it("should mark stuck missions as FAILED", async () => {
      const stuckDate = new Date(Date.now() - 35 * 60 * 1000); // 35 minutes ago
      const stuckMission = makeInProgressMission({
        id: "stuck-mission-1",
        projectId: "project-stuck",
        createdAt: stuckDate,
        updatedAt: stuckDate,
        startedAt: stuckDate,
      });
      mockPrisma.writingMission.findMany.mockResolvedValue([stuckMission]);
      mockPrisma.writingProject.findUnique.mockResolvedValue({
        currentWords: 0,
      });

      await service.performHealthCheck();

      expect(mockPrisma.writingMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "stuck-mission-1" },
          data: expect.objectContaining({
            status: "FAILED",
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it("should update project status to PLANNING when currentWords=0", async () => {
      const stuckDate = new Date(Date.now() - 35 * 60 * 1000);
      const stuckMission = makeInProgressMission({
        id: "mission-no-words",
        projectId: "project-empty",
        createdAt: stuckDate,
        updatedAt: stuckDate,
        startedAt: stuckDate,
      });
      mockPrisma.writingMission.findMany.mockResolvedValue([stuckMission]);
      mockPrisma.writingProject.findUnique.mockResolvedValue({
        currentWords: 0,
      });

      await service.performHealthCheck();

      expect(mockPrisma.writingProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "project-empty" },
          data: { status: "PLANNING" },
        }),
      );
    });

    it("should update project status to REVISING when currentWords>0", async () => {
      const stuckDate = new Date(Date.now() - 35 * 60 * 1000);
      const stuckMission = makeInProgressMission({
        id: "mission-with-words",
        projectId: "project-has-content",
        createdAt: stuckDate,
        updatedAt: stuckDate,
        startedAt: stuckDate,
      });
      mockPrisma.writingMission.findMany.mockResolvedValue([stuckMission]);
      mockPrisma.writingProject.findUnique.mockResolvedValue({
        currentWords: 5000,
      });

      await service.performHealthCheck();

      expect(mockPrisma.writingProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "project-has-content" },
          data: { status: "REVISING" },
        }),
      );
    });

    it("should mark mission as FAILED when exceeded max execution time", async () => {
      const veryOldDate = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago
      const oldMission = makeInProgressMission({
        id: "old-mission",
        createdAt: veryOldDate,
        updatedAt: new Date(), // updated recently but created too long ago
        startedAt: veryOldDate,
      });
      mockPrisma.writingMission.findMany.mockResolvedValue([oldMission]);
      mockPrisma.writingProject.findUnique.mockResolvedValue(null);

      await service.performHealthCheck();

      expect(mockPrisma.writingMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "old-mission" },
          data: expect.objectContaining({ status: "FAILED" }),
        }),
      );
    });

    it("should handle Prisma findMany error gracefully", async () => {
      mockPrisma.writingMission.findMany.mockRejectedValue(
        new Error("Database connection lost"),
      );

      await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });

    it("should handle mission update error gracefully", async () => {
      const stuckDate = new Date(Date.now() - 35 * 60 * 1000);
      const stuckMission = makeInProgressMission({
        id: "fail-update-mission",
        createdAt: stuckDate,
        updatedAt: stuckDate,
        startedAt: stuckDate,
      });
      mockPrisma.writingMission.findMany.mockResolvedValue([stuckMission]);
      mockPrisma.writingMission.update.mockRejectedValue(
        new Error("Update failed"),
      );

      await expect(service.performHealthCheck()).resolves.toBeUndefined();
    });

    it("should handle multiple stuck missions", async () => {
      const stuckDate = new Date(Date.now() - 35 * 60 * 1000);
      const missions = [
        makeInProgressMission({
          id: "m1",
          projectId: "p1",
          createdAt: stuckDate,
          updatedAt: stuckDate,
          startedAt: stuckDate,
        }),
        makeInProgressMission({
          id: "m2",
          projectId: "p2",
          createdAt: stuckDate,
          updatedAt: stuckDate,
          startedAt: stuckDate,
        }),
        makeInProgressMission({
          id: "m3",
          projectId: "p3",
          createdAt: stuckDate,
          updatedAt: stuckDate,
          startedAt: stuckDate,
        }),
      ];
      mockPrisma.writingMission.findMany.mockResolvedValue(missions);
      mockPrisma.writingProject.findUnique.mockResolvedValue({
        currentWords: 0,
      });

      await service.performHealthCheck();

      expect(mockPrisma.writingMission.update).toHaveBeenCalledTimes(3);
    });
  });

  // ==================== manualHealthCheck ====================

  describe("manualHealthCheck", () => {
    it("should return empty array when no stuck missions", async () => {
      mockPrisma.writingMission.findMany.mockResolvedValue([]);

      const result = await service.manualHealthCheck();

      expect(result).toEqual([]);
    });

    it("should return stuck mission info", async () => {
      const stuckDate = new Date(Date.now() - 35 * 60 * 1000);
      const stuckMission = makeInProgressMission({
        id: "manual-check-mission",
        projectId: "project-manual",
        missionType: "WRITE_CHAPTER",
        createdAt: stuckDate,
        updatedAt: stuckDate,
        startedAt: stuckDate,
      });
      mockPrisma.writingMission.findMany.mockResolvedValue([stuckMission]);

      const result = await service.manualHealthCheck();

      expect(result).toHaveLength(1);
      expect(result[0].missionId).toBe("manual-check-mission");
      expect(result[0].projectId).toBe("project-manual");
      expect(result[0].missionType).toBe("WRITE_CHAPTER");
      expect(result[0].stuckDurationMs).toBeGreaterThan(0);
    });

    it("should not mark missions as failed (read-only operation)", async () => {
      const stuckDate = new Date(Date.now() - 35 * 60 * 1000);
      const stuckMission = makeInProgressMission({
        createdAt: stuckDate,
        updatedAt: stuckDate,
        startedAt: stuckDate,
      });
      mockPrisma.writingMission.findMany.mockResolvedValue([stuckMission]);

      await service.manualHealthCheck();

      expect(mockPrisma.writingMission.update).not.toHaveBeenCalled();
    });

    it("should return correct stuck duration", async () => {
      const stuckMs = 45 * 60 * 1000; // 45 minutes
      const stuckDate = new Date(Date.now() - stuckMs);
      const stuckMission = makeInProgressMission({
        createdAt: stuckDate,
        updatedAt: stuckDate,
        startedAt: stuckDate,
      });
      mockPrisma.writingMission.findMany.mockResolvedValue([stuckMission]);

      const result = await service.manualHealthCheck();

      expect(result[0].stuckDurationMs).toBeGreaterThanOrEqual(stuckMs - 1000);
      expect(result[0].stuckDurationMs).toBeLessThanOrEqual(stuckMs + 1000);
    });
  });

  // ==================== findStuckMissions edge cases ====================

  describe("stuck mission detection edge cases", () => {
    it("should use updatedAt for activity detection when available", async () => {
      const oldCreated = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const recentUpdate = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago (recent)
      const mission = makeInProgressMission({
        createdAt: oldCreated,
        startedAt: oldCreated,
        updatedAt: recentUpdate,
      });
      mockPrisma.writingMission.findMany.mockResolvedValue([mission]);

      const result = await service.manualHealthCheck();

      // Should NOT be stuck because updatedAt is recent (5 min < 30 min threshold)
      // BUT createdAt is 1 hour ago (< 2 hour max), so it depends on which check fires
      // updatedAt is recent, and createdAt < maxExecutionTime threshold (2h), so not stuck
      expect(result).toHaveLength(0);
    });

    it("should fall back to createdAt when startedAt and updatedAt unavailable", async () => {
      const stuckDate = new Date(Date.now() - 35 * 60 * 1000);
      const mission = makeInProgressMission({
        createdAt: stuckDate,
        startedAt: null,
        updatedAt: stuckDate,
      });
      mockPrisma.writingMission.findMany.mockResolvedValue([mission]);

      const result = await service.manualHealthCheck();

      expect(result).toHaveLength(1);
    });
  });
});
