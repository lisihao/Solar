/**
 * ResearchCheckpointService Unit Tests
 *
 * Coverage targets:
 * - saveCheckpoint: mission not found throws, saves checkpoint to userContext
 * - loadCheckpoint: mission not found returns null, no checkpoint returns null, returns checkpoint
 * - canResume: mission not found, wrong status, no completed tasks, all tasks done, valid resume
 * - getResumableInfo: mission not found returns null, builds ResumableMissionInfo
 * - getResumableMissions: filters by userId and status, excludes missions with no completed tasks
 * - resumeMission: cannot resume returns failure, resets failed tasks, updates mission status
 * - clearCheckpoint: mission not found (no-op), removes checkpoint from userContext
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ResearchCheckpointService } from "../research-checkpoint.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ResearchMissionStatus, ResearchTaskStatus } from "@prisma/client";

// ──────────────────────────────────────────────────────────────────────────────
// Mock fixtures
// ──────────────────────────────────────────────────────────────────────────────

const makeMission = (overrides: Record<string, unknown> = {}) => ({
  id: "mission-001",
  topicId: "topic-001",
  status: ResearchMissionStatus.FAILED,
  progressPercent: 50,
  totalTasks: 4,
  userContext: {},
  updatedAt: new Date(),
  createdAt: new Date(),
  startedAt: new Date(),
  tasks: [
    {
      id: "task-001",
      status: ResearchTaskStatus.COMPLETED,
      dimensionId: "dim-001",
      taskType: "dimension_research",
      updatedAt: new Date(),
    },
    {
      id: "task-002",
      status: ResearchTaskStatus.FAILED,
      dimensionId: null,
      taskType: "synthesis",
      updatedAt: new Date(),
    },
  ],
  topic: { name: "AI Market Research" },
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
    count: jest.fn(),
  },
  researchTodo: {
    updateMany: jest.fn(),
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("ResearchCheckpointService", () => {
  let service: ResearchCheckpointService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchCheckpointService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ResearchCheckpointService>(ResearchCheckpointService);
    jest.clearAllMocks();
  });

  // ────────────────────────── saveCheckpoint ────────────────────────────────

  describe("saveCheckpoint", () => {
    it("should throw when mission not found", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(null);

      await expect(service.saveCheckpoint("nonexistent-id")).rejects.toThrow(
        "Mission nonexistent-id not found",
      );
    });

    it("should save checkpoint to mission userContext", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(makeMission());
      mockPrisma.researchMission.update.mockResolvedValue({});

      const checkpoint = await service.saveCheckpoint("mission-001");

      expect(checkpoint.missionId).toBe("mission-001");
      expect(checkpoint.topicId).toBe("topic-001");
      expect(checkpoint.completedTasks).toContain("task-001");
      expect(checkpoint.completedDimensions).toContain("dim-001");
      expect(mockPrisma.researchMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-001" },
          data: expect.objectContaining({
            userContext: expect.objectContaining({
              checkpoint: expect.any(Object),
            }),
          }),
        }),
      );
    });

    it("should identify current executing task", async () => {
      const mission = makeMission({
        tasks: [
          {
            id: "task-001",
            status: ResearchTaskStatus.COMPLETED,
            dimensionId: "dim-001",
            taskType: "dimension_research",
            updatedAt: new Date(),
          },
          {
            id: "task-002",
            status: ResearchTaskStatus.EXECUTING,
            dimensionId: "dim-002",
            taskType: "dimension_research",
            updatedAt: new Date(),
          },
        ],
      });
      mockPrisma.researchMission.findUnique.mockResolvedValue(mission);
      mockPrisma.researchMission.update.mockResolvedValue({});

      const checkpoint = await service.saveCheckpoint("mission-001");

      expect(checkpoint.currentTask).toBe("task-002");
      expect(checkpoint.currentDimensionId).toBe("dim-002");
    });

    it("should merge additional context with checkpoint", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(makeMission());
      mockPrisma.researchMission.update.mockResolvedValue({});

      const checkpoint = await service.saveCheckpoint("mission-001", {
        customKey: "customValue",
      });

      expect(checkpoint.context).toHaveProperty("customKey", "customValue");
    });
  });

  // ─────────────────────────── loadCheckpoint ───────────────────────────────

  describe("loadCheckpoint", () => {
    it("should return null when mission not found", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(null);

      const result = await service.loadCheckpoint("nonexistent-id");

      expect(result).toBeNull();
    });

    it("should return null when no checkpoint in userContext", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-001",
        topicId: "topic-001",
        userContext: {},
      });

      const result = await service.loadCheckpoint("mission-001");

      expect(result).toBeNull();
    });

    it("should return checkpoint from userContext", async () => {
      const savedCheckpoint = {
        missionId: "mission-001",
        topicId: "topic-001",
        completedTasks: ["task-001"],
        completedDimensions: ["dim-001"],
        currentTask: null,
        currentDimensionId: null,
        context: {},
        savedAt: new Date().toISOString(),
      };
      mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-001",
        topicId: "topic-001",
        userContext: { checkpoint: savedCheckpoint },
      });

      const result = await service.loadCheckpoint("mission-001");

      expect(result).not.toBeNull();
      expect(result!.missionId).toBe("mission-001");
    });
  });

  // ─────────────────────────── canResume ────────────────────────────────────

  describe("canResume", () => {
    it("should return canResume: false when mission not found", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(null);

      const result = await service.canResume("nonexistent-id");

      expect(result.canResume).toBe(false);
      expect(result.reason).toContain("不存在");
    });

    it("should return canResume: false when mission status is EXECUTING", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(
        makeMission({ status: ResearchMissionStatus.EXECUTING }),
      );

      const result = await service.canResume("mission-001");

      expect(result.canResume).toBe(false);
      expect(result.reason).toContain("EXECUTING");
    });

    it("should return canResume: false when no completed tasks", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(
        makeMission({
          tasks: [
            {
              id: "task-001",
              status: ResearchTaskStatus.FAILED,
              dimensionId: null,
              taskType: "synthesis",
              updatedAt: new Date(),
            },
          ],
        }),
      );

      const result = await service.canResume("mission-001");

      expect(result.canResume).toBe(false);
      expect(result.reason).toContain("没有已完成");
    });

    it("should return canResume: false when all tasks completed", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(
        makeMission({
          tasks: [
            {
              id: "task-001",
              status: ResearchTaskStatus.COMPLETED,
              dimensionId: "dim-001",
              taskType: "dimension_research",
              updatedAt: new Date(),
            },
          ],
        }),
      );

      const result = await service.canResume("mission-001");

      expect(result.canResume).toBe(false);
      expect(result.reason).toContain("已完成");
    });

    it("should return canResume: true with partial progress and pending tasks", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(makeMission());

      const result = await service.canResume("mission-001");

      expect(result.canResume).toBe(true);
      expect(result.reason).toContain("可恢复");
    });
  });

  // ─────────────────────────── getResumableInfo ─────────────────────────────

  describe("getResumableInfo", () => {
    it("should return null when mission not found", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(null);

      const result = await service.getResumableInfo("nonexistent-id");

      expect(result).toBeNull();
    });

    it("should build ResumableMissionInfo with canResume status", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(makeMission());
      mockPrisma.researchTask.count.mockResolvedValue(1);

      const result = await service.getResumableInfo("mission-001");

      expect(result).not.toBeNull();
      expect(result!.missionId).toBe("mission-001");
      expect(result!.topicName).toBe("AI Market Research");
      expect(result!.canResume).toBe(true);
    });
  });

  // ─────────────────────────── resumeMission ────────────────────────────────

  describe("resumeMission", () => {
    it("should return failure when mission cannot be resumed", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(
        makeMission({ status: ResearchMissionStatus.EXECUTING }),
      );

      const result = await service.resumeMission("mission-001");

      expect(result.success).toBe(false);
      expect(result.message).toBeTruthy();
    });

    it("should reset failed tasks, todos, and set mission to EXECUTING", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(makeMission());
      mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.researchTodo.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.researchMission.update.mockResolvedValue({});

      const result = await service.resumeMission("mission-001");

      expect(result.success).toBe(true);
      expect(mockPrisma.researchTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchTaskStatus.PENDING,
          }),
        }),
      );
      expect(mockPrisma.researchMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchMissionStatus.EXECUTING,
          }),
        }),
      );
    });
  });

  // ─────────────────────────── getResumableMissions ─────────────────────────

  describe("getResumableMissions", () => {
    it("should return empty array when no missions found", async () => {
      mockPrisma.researchMission.findMany.mockResolvedValue([]);

      const result = await service.getResumableMissions("user-001");

      expect(result).toEqual([]);
    });

    it("should exclude missions with no completed tasks", async () => {
      const missionNoCompleted = makeMission({
        tasks: [
          {
            id: "task-001",
            status: "FAILED",
            dimensionId: null,
            taskType: "synthesis",
            updatedAt: new Date(),
          },
        ],
      });
      mockPrisma.researchMission.findMany.mockResolvedValue([
        missionNoCompleted,
      ]);

      const result = await service.getResumableMissions("user-001");

      expect(result).toHaveLength(0);
    });

    it("should include missions with partial progress (some completed tasks)", async () => {
      const missionWithProgress = makeMission(); // has 1 completed task by default
      mockPrisma.researchMission.findMany.mockResolvedValue([
        missionWithProgress,
      ]);

      const result = await service.getResumableMissions("user-001");

      expect(result).toHaveLength(1);
      expect(result[0].missionId).toBe("mission-001");
      expect(result[0].topicName).toBe("AI Market Research");
    });

    it("should return multiple missions with partial progress", async () => {
      const mission1 = makeMission({ id: "mission-001" });
      const mission2 = makeMission({
        id: "mission-002",
        topicId: "topic-002",
        tasks: [
          {
            id: "task-010",
            status: "COMPLETED",
            dimensionId: "dim-001",
            taskType: "dimension_research",
            updatedAt: new Date(),
          },
          {
            id: "task-011",
            status: "PENDING",
            dimensionId: null,
            taskType: "synthesis",
            updatedAt: new Date(),
          },
        ],
      });
      mockPrisma.researchMission.findMany.mockResolvedValue([
        mission1,
        mission2,
      ]);

      const result = await service.getResumableMissions("user-001");

      expect(result).toHaveLength(2);
    });

    it("should call canResume for each mission with partial progress", async () => {
      const mission = makeMission();
      mockPrisma.researchMission.findMany.mockResolvedValue([mission]);

      await service.getResumableMissions("user-001");

      // canResume is called internally — it calls findUnique again
      expect(mockPrisma.researchMission.findUnique).toHaveBeenCalled();
    });
  });

  // ─────────────────────────── clearCheckpoint ──────────────────────────────

  describe("clearCheckpoint", () => {
    it("should do nothing when mission not found", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue(null);

      await service.clearCheckpoint("nonexistent-id");

      expect(mockPrisma.researchMission.update).not.toHaveBeenCalled();
    });

    it("should remove checkpoint from userContext", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-001",
        userContext: {
          checkpoint: { missionId: "mission-001" },
          otherField: "preserved",
        },
      });
      mockPrisma.researchMission.update.mockResolvedValue({});

      await service.clearCheckpoint("mission-001");

      const updateCall = mockPrisma.researchMission.update.mock.calls[0][0];
      expect(updateCall.data.userContext).not.toHaveProperty("checkpoint");
      expect(updateCall.data.userContext).toHaveProperty(
        "otherField",
        "preserved",
      );
    });

    it("should do nothing when no checkpoint exists in userContext", async () => {
      mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-001",
        userContext: { someOtherField: true },
      });

      await service.clearCheckpoint("mission-001");

      expect(mockPrisma.researchMission.update).not.toHaveBeenCalled();
    });
  });
});
