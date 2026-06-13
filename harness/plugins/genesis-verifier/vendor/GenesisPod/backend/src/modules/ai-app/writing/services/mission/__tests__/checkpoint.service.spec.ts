import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import {
  WritingMissionCheckpointService,
  MissionCheckpoint,
} from "../checkpoint.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

describe("WritingMissionCheckpointService", () => {
  let service: WritingMissionCheckpointService;
  let mockPrisma: any;

  const missionId = "mission-abc";
  const projectId = "project-xyz";

  const savedAt = new Date("2024-01-15T10:00:00.000Z");

  const makeValidCheckpoint = (overrides = {}): MissionCheckpoint => ({
    missionId,
    projectId,
    completedSteps: ["step-1", "step-2"],
    completedChapters: ["ch-1"],
    currentStep: "step-3",
    currentChapterId: "ch-2",
    context: { totalCount: 10 },
    savedAt,
    ...overrides,
  });

  const makeMissionResult = (
    checkpoint?: Partial<MissionCheckpoint> | null,
  ) => {
    if (checkpoint === null || checkpoint === undefined) {
      return null;
    }
    return {
      checkpoint: {
        missionId: checkpoint.missionId ?? missionId,
        projectId: checkpoint.projectId ?? projectId,
        completedSteps: checkpoint.completedSteps ?? ["step-1"],
        completedChapters: checkpoint.completedChapters ?? ["ch-1"],
        currentStep: checkpoint.currentStep ?? "step-2",
        currentChapterId: checkpoint.currentChapterId ?? undefined,
        context: checkpoint.context ?? {},
        savedAt: (checkpoint.savedAt ?? savedAt).toISOString(),
      },
    };
  };

  beforeEach(async () => {
    mockPrisma = {
      writingMission: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingMissionCheckpointService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WritingMissionCheckpointService>(
      WritingMissionCheckpointService,
    );

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  // ==================== saveCheckpoint ====================

  describe("saveCheckpoint", () => {
    it("should save a new checkpoint for a mission", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue({
        id: missionId,
        projectId,
        result: null,
      });
      mockPrisma.writingMission.update.mockResolvedValue({});

      await service.saveCheckpoint(missionId, {
        completedSteps: ["step-1"],
        currentStep: "step-2",
      });

      expect(mockPrisma.writingMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: missionId },
          data: expect.objectContaining({
            result: expect.objectContaining({
              checkpoint: expect.objectContaining({
                currentStep: "step-2",
                completedSteps: ["step-1"],
              }),
            }),
          }),
        }),
      );
    });

    it("should merge with existing checkpoint data", async () => {
      const existingResult = makeMissionResult({
        completedSteps: ["step-1"],
        completedChapters: [],
        currentStep: "step-2",
        context: { existingKey: "value" },
        savedAt,
      });

      mockPrisma.writingMission.findUnique.mockResolvedValue({
        id: missionId,
        projectId,
        result: existingResult,
      });
      mockPrisma.writingMission.update.mockResolvedValue({});

      await service.saveCheckpoint(missionId, {
        completedSteps: ["step-1", "step-2"],
        currentStep: "step-3",
        context: { newKey: "new-value" },
      });

      const updateCall = mockPrisma.writingMission.update.mock.calls[0][0];
      const savedCheckpoint = updateCall.data.result.checkpoint;

      // New context should be merged with existing
      expect(savedCheckpoint.context.existingKey).toBe("value");
      expect(savedCheckpoint.context.newKey).toBe("new-value");
      expect(savedCheckpoint.completedSteps).toEqual(["step-1", "step-2"]);
    });

    it("should not throw when mission is not found (silently fails)", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue(null);

      // Should not throw
      await expect(
        service.saveCheckpoint("nonexistent", { currentStep: "step-1" }),
      ).resolves.not.toThrow();
    });

    it("should not throw when update fails (checkpoint resilience)", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue({
        id: missionId,
        projectId,
        result: null,
      });
      mockPrisma.writingMission.update.mockRejectedValue(new Error("DB error"));

      // Should not throw - resilience rule
      await expect(
        service.saveCheckpoint(missionId, { currentStep: "step-1" }),
      ).resolves.not.toThrow();
    });

    it("should preserve existing result data when adding checkpoint", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue({
        id: missionId,
        projectId,
        result: { otherData: "preserved" },
      });
      mockPrisma.writingMission.update.mockResolvedValue({});

      await service.saveCheckpoint(missionId, { currentStep: "step-1" });

      const updateCall = mockPrisma.writingMission.update.mock.calls[0][0];
      expect(updateCall.data.result.otherData).toBe("preserved");
    });

    it("should store savedAt as ISO string", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue({
        id: missionId,
        projectId,
        result: null,
      });
      mockPrisma.writingMission.update.mockResolvedValue({});

      await service.saveCheckpoint(missionId, { currentStep: "step-1" });

      const updateCall = mockPrisma.writingMission.update.mock.calls[0][0];
      const savedAtValue = updateCall.data.result.checkpoint.savedAt;
      expect(typeof savedAtValue).toBe("string");
      expect(() => new Date(savedAtValue)).not.toThrow();
    });
  });

  // ==================== loadCheckpoint ====================

  describe("loadCheckpoint", () => {
    it("should load a valid checkpoint from mission result", async () => {
      const result = makeMissionResult(makeValidCheckpoint());
      mockPrisma.writingMission.findUnique.mockResolvedValue({ result });

      const checkpoint = await service.loadCheckpoint(missionId);

      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.missionId).toBe(missionId);
      expect(checkpoint!.currentStep).toBe("step-3");
      expect(checkpoint!.completedSteps).toEqual(["step-1", "step-2"]);
    });

    it("should return null when mission not found", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue(null);

      const checkpoint = await service.loadCheckpoint("nonexistent");

      expect(checkpoint).toBeNull();
    });

    it("should return null when result has no checkpoint", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue({
        result: { someOtherData: "value" },
      });

      const checkpoint = await service.loadCheckpoint(missionId);

      expect(checkpoint).toBeNull();
    });

    it("should return null when result is null", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue({ result: null });

      const checkpoint = await service.loadCheckpoint(missionId);

      expect(checkpoint).toBeNull();
    });

    it("should return null for invalid checkpoint format (missing required fields)", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue({
        result: {
          checkpoint: {
            // Missing missionId, projectId, completedSteps, currentStep
            incomplete: true,
          },
        },
      });

      const checkpoint = await service.loadCheckpoint(missionId);

      expect(checkpoint).toBeNull();
    });

    it("should convert ISO string savedAt to Date", async () => {
      const result = makeMissionResult(makeValidCheckpoint());
      mockPrisma.writingMission.findUnique.mockResolvedValue({ result });

      const checkpoint = await service.loadCheckpoint(missionId);

      expect(checkpoint!.savedAt).toBeInstanceOf(Date);
    });

    it("should return null on database error", async () => {
      mockPrisma.writingMission.findUnique.mockRejectedValue(
        new Error("DB connection lost"),
      );

      const checkpoint = await service.loadCheckpoint(missionId);

      expect(checkpoint).toBeNull();
    });
  });

  // ==================== deleteCheckpoint ====================

  describe("deleteCheckpoint", () => {
    it("should delete checkpoint from mission result", async () => {
      const result = makeMissionResult(makeValidCheckpoint());
      mockPrisma.writingMission.findUnique.mockResolvedValue({ result });
      mockPrisma.writingMission.update.mockResolvedValue({});

      await service.deleteCheckpoint(missionId);

      const updateCall = mockPrisma.writingMission.update.mock.calls[0][0];
      expect(updateCall.data.result.checkpoint).toBeUndefined();
    });

    it("should preserve other result data when deleting checkpoint", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue({
        result: {
          otherData: "keep this",
          checkpoint: {
            missionId,
            projectId,
            completedSteps: [],
            completedChapters: [],
            currentStep: "s1",
            context: {},
            savedAt: "2024-01-01T00:00:00.000Z",
          },
        },
      });
      mockPrisma.writingMission.update.mockResolvedValue({});

      await service.deleteCheckpoint(missionId);

      const updateCall = mockPrisma.writingMission.update.mock.calls[0][0];
      expect(updateCall.data.result.otherData).toBe("keep this");
    });

    it("should do nothing when mission not found (return early)", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue(null);

      await service.deleteCheckpoint("nonexistent");

      expect(mockPrisma.writingMission.update).not.toHaveBeenCalled();
    });

    it("should throw when update fails", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue({
        result: makeMissionResult(makeValidCheckpoint()),
      });
      mockPrisma.writingMission.update.mockRejectedValue(
        new Error("Update failed"),
      );

      await expect(service.deleteCheckpoint(missionId)).rejects.toThrow(
        "Update failed",
      );
    });
  });

  // ==================== canResume ====================

  describe("canResume", () => {
    it("should return true when checkpoint has progress and current step", async () => {
      const result = makeMissionResult(makeValidCheckpoint());
      mockPrisma.writingMission.findUnique.mockResolvedValue({ result });

      const canResume = await service.canResume(missionId);

      expect(canResume).toBe(true);
    });

    it("should return false when no checkpoint exists", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue({ result: null });

      const canResume = await service.canResume(missionId);

      expect(canResume).toBe(false);
    });

    it("should return false when checkpoint has no progress (empty steps and chapters)", async () => {
      const result = makeMissionResult({
        ...makeValidCheckpoint(),
        completedSteps: [],
        completedChapters: [],
        currentStep: "step-1",
      });
      mockPrisma.writingMission.findUnique.mockResolvedValue({ result });

      const canResume = await service.canResume(missionId);

      expect(canResume).toBe(false);
    });

    it("should return false when currentStep is empty", async () => {
      const result = makeMissionResult({
        ...makeValidCheckpoint(),
        completedSteps: ["step-1"],
        currentStep: "",
      });
      mockPrisma.writingMission.findUnique.mockResolvedValue({ result });

      const canResume = await service.canResume(missionId);

      expect(canResume).toBe(false);
    });

    it("should return true when only completedChapters has progress", async () => {
      const result = makeMissionResult({
        ...makeValidCheckpoint(),
        completedSteps: [],
        completedChapters: ["ch-1"],
        currentStep: "writing",
      });
      mockPrisma.writingMission.findUnique.mockResolvedValue({ result });

      const canResume = await service.canResume(missionId);

      expect(canResume).toBe(true);
    });
  });

  // ==================== getResumableInfo ====================

  describe("getResumableInfo", () => {
    it("should return full resumable info with progress calculation", async () => {
      const checkpoint = makeValidCheckpoint();
      checkpoint.context = { totalCount: 10 };
      const result = makeMissionResult(checkpoint);
      mockPrisma.writingMission.findUnique.mockResolvedValue({ result });

      const info = await service.getResumableInfo(missionId);

      expect(info.canResume).toBe(true);
      expect(info.missionId).toBe(missionId);
      expect(info.projectId).toBe(projectId);
      expect(info.completedCount).toBe(2); // max(completedSteps=2, completedChapters=1)
      expect(info.totalCount).toBe(10);
      expect(info.progress).toBe(20); // 2/10 = 20%
    });

    it("should return empty info when no checkpoint", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue({ result: null });

      const info = await service.getResumableInfo(missionId);

      expect(info.canResume).toBe(false);
      expect(info.missionId).toBe(missionId);
      expect(info.completedCount).toBe(0);
      expect(info.totalCount).toBe(0);
      expect(info.progress).toBe(0);
      expect(info.lastSavedAt).toBeNull();
      expect(info.currentStep).toBeNull();
      expect(info.currentChapterId).toBeNull();
    });

    it("should calculate 0 progress when totalCount is 0", async () => {
      const checkpoint = makeValidCheckpoint();
      checkpoint.context = {}; // No totalCount
      const result = makeMissionResult(checkpoint);
      mockPrisma.writingMission.findUnique.mockResolvedValue({ result });

      const info = await service.getResumableInfo(missionId);

      expect(info.progress).toBe(0);
    });

    it("should include lastSavedAt when checkpoint exists", async () => {
      const result = makeMissionResult(makeValidCheckpoint());
      mockPrisma.writingMission.findUnique.mockResolvedValue({ result });

      const info = await service.getResumableInfo(missionId);

      expect(info.lastSavedAt).toBeInstanceOf(Date);
    });

    it("should return currentChapterId from checkpoint", async () => {
      const checkpoint = makeValidCheckpoint({
        currentChapterId: "ch-specific",
      });
      const result = makeMissionResult(checkpoint);
      mockPrisma.writingMission.findUnique.mockResolvedValue({ result });

      const info = await service.getResumableInfo(missionId);

      expect(info.currentChapterId).toBe("ch-specific");
    });
  });

  // ==================== cleanupExpiredCheckpoints ====================

  describe("cleanupExpiredCheckpoints", () => {
    it("should cleanup expired checkpoints for completed missions", async () => {
      const oldDate = new Date("2020-01-01T00:00:00.000Z");
      const expiredMission = {
        id: "mission-old",
        status: "COMPLETED",
        result: makeMissionResult({
          ...makeValidCheckpoint(),
          savedAt: oldDate,
        }),
      };

      mockPrisma.writingMission.findMany.mockResolvedValue([expiredMission]);
      // For deleteCheckpoint calls
      mockPrisma.writingMission.findUnique.mockResolvedValue({
        result: expiredMission.result,
      });
      mockPrisma.writingMission.update.mockResolvedValue({});

      const count = await service.cleanupExpiredCheckpoints(30);

      expect(count).toBe(1);
    });

    it("should not cleanup recent checkpoints", async () => {
      const recentDate = new Date(); // Current date = not expired
      const recentMission = {
        id: "mission-recent",
        status: "COMPLETED",
        result: makeMissionResult({
          ...makeValidCheckpoint(),
          savedAt: recentDate,
        }),
      };

      mockPrisma.writingMission.findMany.mockResolvedValue([recentMission]);

      const count = await service.cleanupExpiredCheckpoints(30);

      expect(count).toBe(0);
      expect(mockPrisma.writingMission.update).not.toHaveBeenCalled();
    });

    it("should not cleanup missions without checkpoints", async () => {
      mockPrisma.writingMission.findMany.mockResolvedValue([
        { id: "mission-no-cp", status: "COMPLETED", result: null },
      ]);

      const count = await service.cleanupExpiredCheckpoints(30);

      expect(count).toBe(0);
    });

    it("should use default 30 days cutoff", async () => {
      mockPrisma.writingMission.findMany.mockResolvedValue([]);

      await service.cleanupExpiredCheckpoints();

      expect(mockPrisma.writingMission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: {
              in: ["COMPLETED", "FAILED", "CANCELLED"],
            },
          },
        }),
      );
    });

    it("should throw when findMany fails", async () => {
      mockPrisma.writingMission.findMany.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(service.cleanupExpiredCheckpoints()).rejects.toThrow(
        "DB error",
      );
    });
  });

  // ==================== batchSaveCheckpoints ====================

  describe("batchSaveCheckpoints", () => {
    it("should save multiple checkpoints in parallel", async () => {
      mockPrisma.writingMission.findUnique.mockResolvedValue({
        id: "m1",
        projectId: "p1",
        result: null,
      });
      mockPrisma.writingMission.update.mockResolvedValue({});

      await service.batchSaveCheckpoints([
        { missionId: "m1", data: { currentStep: "step-1" } },
        { missionId: "m2", data: { currentStep: "step-2" } },
      ]);

      expect(mockPrisma.writingMission.findUnique).toHaveBeenCalledTimes(2);
    });

    it("should handle empty batch", async () => {
      await expect(service.batchSaveCheckpoints([])).resolves.not.toThrow();
    });
  });
});
