import { Test, TestingModule } from "@nestjs/testing";
import {
  WritingMissionCheckpointService,
  MissionCheckpoint,
} from "../checkpoint.service";
import { PrismaService } from "@/common/prisma/prisma.service";

describe("WritingMissionCheckpointService", () => {
  let service: WritingMissionCheckpointService;
  let prismaService: PrismaService;

  const mockMission = {
    id: "mission-123",
    projectId: "project-456",
    result: null,
    status: "IN_PROGRESS",
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingMissionCheckpointService,
        {
          provide: PrismaService,
          useValue: {
            writingMission: {
              findUnique: jest.fn(),
              update: jest.fn(),
              findMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<WritingMissionCheckpointService>(
      WritingMissionCheckpointService,
    );
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("saveCheckpoint", () => {
    it("should save a new checkpoint", async () => {
      jest
        .spyOn(prismaService.writingMission, "findUnique")
        .mockResolvedValue(mockMission as any);
      jest
        .spyOn(prismaService.writingMission, "update")
        .mockResolvedValue(mockMission as any);

      await service.saveCheckpoint("mission-123", {
        projectId: "project-456",
        completedSteps: ["step1", "step2"],
        completedChapters: ["chapter1"],
        currentStep: "step3",
        context: { totalCount: 5 },
      });

      expect(prismaService.writingMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-123" },
          data: expect.objectContaining({
            result: expect.objectContaining({
              checkpoint: expect.objectContaining({
                missionId: "mission-123",
                projectId: "project-456",
                completedSteps: ["step1", "step2"],
                currentStep: "step3",
              }),
            }),
          }),
        }),
      );
    });

    it("should merge with existing checkpoint", async () => {
      const existingCheckpoint: MissionCheckpoint = {
        missionId: "mission-123",
        projectId: "project-456",
        completedSteps: ["step1"],
        completedChapters: [],
        currentStep: "step2",
        context: { existingKey: "value" },
        savedAt: new Date("2024-01-01"),
      };

      jest.spyOn(prismaService.writingMission, "findUnique").mockResolvedValue({
        ...mockMission,
        result: { checkpoint: existingCheckpoint },
      } as any);
      jest
        .spyOn(prismaService.writingMission, "update")
        .mockResolvedValue(mockMission as any);

      await service.saveCheckpoint("mission-123", {
        completedSteps: ["step1", "step2"],
        context: { newKey: "newValue" },
      });

      expect(prismaService.writingMission.update).toHaveBeenCalled();
    });

    it("should not throw error if mission not found (non-fatal)", async () => {
      jest
        .spyOn(prismaService.writingMission, "findUnique")
        .mockResolvedValue(null);

      // Source implementation catches errors and doesn't rethrow (line 122-127)
      // Checkpoint save failure should not stop the mission
      await expect(
        service.saveCheckpoint("nonexistent", {
          completedSteps: ["step1"],
          currentStep: "step2",
        }),
      ).resolves.not.toThrow();
    });
  });

  describe("loadCheckpoint", () => {
    it("should load an existing checkpoint", async () => {
      const checkpoint: MissionCheckpoint = {
        missionId: "mission-123",
        projectId: "project-456",
        completedSteps: ["step1", "step2"],
        completedChapters: ["chapter1"],
        currentStep: "step3",
        context: { totalCount: 5 },
        savedAt: new Date(),
      };

      jest.spyOn(prismaService.writingMission, "findUnique").mockResolvedValue({
        result: {
          checkpoint: {
            ...checkpoint,
            savedAt: checkpoint.savedAt.toISOString(),
          },
        },
      } as any);

      const result = await service.loadCheckpoint("mission-123");

      expect(result).toBeTruthy();
      expect(result?.missionId).toBe("mission-123");
      expect(result?.completedSteps).toEqual(["step1", "step2"]);
    });

    it("should return null if no checkpoint exists", async () => {
      jest.spyOn(prismaService.writingMission, "findUnique").mockResolvedValue({
        result: null,
      } as any);

      const result = await service.loadCheckpoint("mission-123");

      expect(result).toBeNull();
    });

    it("should return null if mission not found", async () => {
      jest
        .spyOn(prismaService.writingMission, "findUnique")
        .mockResolvedValue(null);

      const result = await service.loadCheckpoint("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("deleteCheckpoint", () => {
    it("should delete checkpoint while preserving other result data", async () => {
      jest.spyOn(prismaService.writingMission, "findUnique").mockResolvedValue({
        result: {
          checkpoint: { missionId: "mission-123" },
          otherData: "keep this",
        },
      } as any);
      jest
        .spyOn(prismaService.writingMission, "update")
        .mockResolvedValue(mockMission as any);

      await service.deleteCheckpoint("mission-123");

      expect(prismaService.writingMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-123" },
          data: expect.objectContaining({
            result: expect.objectContaining({
              otherData: "keep this",
            }),
          }),
        }),
      );
    });
  });

  describe("canResume", () => {
    it("should return true if checkpoint has progress and current step", async () => {
      const checkpoint: MissionCheckpoint = {
        missionId: "mission-123",
        projectId: "project-456",
        completedSteps: ["step1"],
        completedChapters: [],
        currentStep: "step2",
        context: {},
        savedAt: new Date(),
      };

      jest.spyOn(prismaService.writingMission, "findUnique").mockResolvedValue({
        result: {
          checkpoint: {
            ...checkpoint,
            savedAt: checkpoint.savedAt.toISOString(),
          },
        },
      } as any);

      const result = await service.canResume("mission-123");

      expect(result).toBe(true);
    });

    it("should return false if no progress", async () => {
      const checkpoint: MissionCheckpoint = {
        missionId: "mission-123",
        projectId: "project-456",
        completedSteps: [],
        completedChapters: [],
        currentStep: "step1",
        context: {},
        savedAt: new Date(),
      };

      jest.spyOn(prismaService.writingMission, "findUnique").mockResolvedValue({
        result: {
          checkpoint: {
            ...checkpoint,
            savedAt: checkpoint.savedAt.toISOString(),
          },
        },
      } as any);

      const result = await service.canResume("mission-123");

      expect(result).toBe(false);
    });

    it("should return false if no checkpoint exists", async () => {
      jest.spyOn(prismaService.writingMission, "findUnique").mockResolvedValue({
        result: null,
      } as any);

      const result = await service.canResume("mission-123");

      expect(result).toBe(false);
    });
  });

  describe("getResumableInfo", () => {
    it("should return resumable info with progress calculation", async () => {
      const checkpoint: MissionCheckpoint = {
        missionId: "mission-123",
        projectId: "project-456",
        completedSteps: ["step1", "step2"],
        completedChapters: ["chapter1"],
        currentStep: "step3",
        context: { totalCount: 5 },
        savedAt: new Date(),
      };

      jest.spyOn(prismaService.writingMission, "findUnique").mockResolvedValue({
        result: {
          checkpoint: {
            ...checkpoint,
            savedAt: checkpoint.savedAt.toISOString(),
          },
        },
      } as any);

      const result = await service.getResumableInfo("mission-123");

      expect(result).toEqual(
        expect.objectContaining({
          canResume: true,
          missionId: "mission-123",
          projectId: "project-456",
          completedCount: 2, // Math.max(2, 1) = 2
          totalCount: 5,
          progress: 40, // 2/5 * 100
          currentStep: "step3", // Current step from checkpoint
        }),
      );
    });

    it("should return default info if no checkpoint exists", async () => {
      jest.spyOn(prismaService.writingMission, "findUnique").mockResolvedValue({
        result: null,
      } as any);

      const result = await service.getResumableInfo("mission-123");

      expect(result).toEqual({
        canResume: false,
        missionId: "mission-123",
        projectId: "",
        completedCount: 0,
        totalCount: 0,
        progress: 0,
        lastSavedAt: null,
        currentStep: null,
        currentChapterId: null,
      });
    });
  });

  describe("cleanupExpiredCheckpoints", () => {
    it("should clean up expired checkpoints for completed missions", async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40); // 40 days ago

      const checkpoint: MissionCheckpoint = {
        missionId: "mission-123",
        projectId: "project-456",
        completedSteps: ["step1"],
        completedChapters: [],
        currentStep: "step2",
        context: {},
        savedAt: oldDate,
      };

      jest.spyOn(prismaService.writingMission, "findMany").mockResolvedValue([
        {
          id: "mission-123",
          result: {
            checkpoint: {
              ...checkpoint,
              savedAt: oldDate.toISOString(),
            },
          },
          status: "COMPLETED",
        },
      ] as any);
      jest.spyOn(prismaService.writingMission, "findUnique").mockResolvedValue({
        result: {
          checkpoint: {
            ...checkpoint,
            savedAt: oldDate.toISOString(),
          },
        },
      } as any);
      jest
        .spyOn(prismaService.writingMission, "update")
        .mockResolvedValue({} as any);

      const count = await service.cleanupExpiredCheckpoints(30);

      expect(count).toBe(1);
      expect(prismaService.writingMission.update).toHaveBeenCalled();
    });
  });

  describe("batchSaveCheckpoints", () => {
    it("should save multiple checkpoints", async () => {
      jest
        .spyOn(prismaService.writingMission, "findUnique")
        .mockResolvedValue(mockMission as any);
      jest
        .spyOn(prismaService.writingMission, "update")
        .mockResolvedValue(mockMission as any);

      await service.batchSaveCheckpoints([
        {
          missionId: "mission-1",
          data: {
            completedSteps: ["step1"],
            currentStep: "step2",
          },
        },
        {
          missionId: "mission-2",
          data: {
            completedSteps: ["step1", "step2"],
            currentStep: "step3",
          },
        },
      ]);

      expect(prismaService.writingMission.update).toHaveBeenCalledTimes(2);
    });
  });
});
