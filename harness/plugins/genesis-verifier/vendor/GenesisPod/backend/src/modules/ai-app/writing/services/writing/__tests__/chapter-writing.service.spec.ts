/**
 * Unit tests for ChapterWritingService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { ChapterWritingService } from "../chapter-writing.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { WritingMissionLifecycleService } from "../../mission/writing-mission-lifecycle.service";
import { WritingMissionQueryService } from "../../mission/writing-mission-query.service";

function buildMockPrisma() {
  return {
    writingChapter: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    writingVolume: {
      findUnique: jest.fn(),
    },
  };
}

function buildMockMissionService() {
  return {
    execute: jest.fn(),
    getMissionStatus: jest.fn(),
    cancelMission: jest.fn(),
  };
}

describe("ChapterWritingService", () => {
  let service: ChapterWritingService;
  let prisma: ReturnType<typeof buildMockPrisma>;
  let missionService: ReturnType<typeof buildMockMissionService>;

  const mockVolume = {
    id: "volume-1",
    project: { ownerId: "user-1" },
  };

  const mockChapter = {
    id: "chapter-1",
    volumeId: "volume-1",
    chapterNumber: 1,
    title: "The Beginning",
    outline: "Hero discovers their destiny",
    content: null,
    wordCount: 0,
    status: "PLANNED",
    volume: {
      project: {
        id: "project-1",
        ownerId: "user-1",
        name: "My Novel",
      },
    },
    scenes: [],
    consistencyChecks: [],
  };

  beforeEach(async () => {
    prisma = buildMockPrisma();
    missionService = buildMockMissionService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterWritingService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: WritingMissionLifecycleService,
          useValue: {
            startMissionAsync: jest.fn().mockResolvedValue({ missionId: "m1" }),
            cancelMission: missionService.cancelMission,
          },
        },
        {
          provide: WritingMissionQueryService,
          useValue: { getMissionStatus: missionService.getMissionStatus },
        },
      ],
    }).compile();

    service = module.get<ChapterWritingService>(ChapterWritingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createChapter", () => {
    it("should create a chapter when user has access", async () => {
      prisma.writingVolume.findUnique.mockResolvedValue(mockVolume);
      prisma.writingChapter.create.mockResolvedValue({
        id: "chapter-new",
        chapterNumber: 1,
        title: "New Chapter",
      });

      const result = await service.createChapter("volume-1", "user-1", {
        chapterNumber: 1,
        title: "New Chapter",
        outline: "A new adventure begins",
      });

      expect(result.id).toBe("chapter-new");
      expect(prisma.writingChapter.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            volumeId: "volume-1",
            title: "New Chapter",
          }),
        }),
      );
    });

    it("should throw NotFoundException when volume not found", async () => {
      prisma.writingVolume.findUnique.mockResolvedValue(null);

      await expect(
        service.createChapter("volume-missing", "user-1", {
          chapterNumber: 1,
          title: "Chapter",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user does not own volume", async () => {
      prisma.writingVolume.findUnique.mockResolvedValue({
        ...mockVolume,
        project: { ownerId: "other-user" },
      });

      await expect(
        service.createChapter("volume-1", "user-1", {
          chapterNumber: 1,
          title: "Chapter",
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("getChapters", () => {
    it("should return chapters for authorized user", async () => {
      prisma.writingVolume.findUnique.mockResolvedValue(mockVolume);
      prisma.writingChapter.findMany.mockResolvedValue([mockChapter]);

      const result = await service.getChapters("volume-1", "user-1");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("chapter-1");
    });

    it("should throw ForbiddenException for unauthorized user", async () => {
      prisma.writingVolume.findUnique.mockResolvedValue({
        ...mockVolume,
        project: { ownerId: "other-user" },
      });

      await expect(service.getChapters("volume-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("getChapter", () => {
    it("should return chapter for authorized user", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapter);

      const result = await service.getChapter("chapter-1", "user-1");

      expect(result.id).toBe("chapter-1");
    });

    it("should throw NotFoundException when chapter not found", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(null);

      await expect(
        service.getChapter("chapter-missing", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException for unauthorized user", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue({
        ...mockChapter,
        volume: {
          project: { id: "project-1", ownerId: "other-user", name: "Novel" },
        },
      });

      await expect(service.getChapter("chapter-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("updateChapter", () => {
    it("should update chapter content and calculate word count", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapter);
      prisma.writingChapter.update.mockResolvedValue({
        ...mockChapter,
        content: "Updated content",
        wordCount: 2,
      });

      const result = await service.updateChapter("chapter-1", "user-1", {
        content: "Updated content",
      });

      expect(prisma.writingChapter.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            wordCount: expect.any(Number),
          }),
        }),
      );
      expect(result).toBeDefined();
    });

    it("should update without word count for non-content updates", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapter);
      prisma.writingChapter.update.mockResolvedValue({
        ...mockChapter,
        title: "New Title",
      });

      await service.updateChapter("chapter-1", "user-1", {
        title: "New Title",
      });

      const updateCall = prisma.writingChapter.update.mock.calls[0][0];
      expect(updateCall.data.wordCount).toBeUndefined();
    });
  });

  describe("startWriting", () => {
    it("should update chapter status and return mission input", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapter);
      prisma.writingChapter.update.mockResolvedValue({
        ...mockChapter,
        status: "WRITING",
      });

      const result = await service.startWriting("chapter-1", "user-1", {
        targetWordCount: 3000,
        additionalInstructions: "Make it exciting",
      });

      expect(result.missionInput).toBeDefined();
      expect(result.missionInput.projectId).toBe("project-1");
      expect(result.missionInput.missionType).toBe("chapter");
      expect(result.missionInput.targetWordCount).toBe(3000);
    });

    it("should use default word count when not specified", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapter);
      prisma.writingChapter.update.mockResolvedValue({
        ...mockChapter,
        status: "WRITING",
      });

      const result = await service.startWriting("chapter-1", "user-1", {});

      expect(result.missionInput.targetWordCount).toBe(3000);
    });
  });

  describe("getMissionStatus", () => {
    it("should delegate to WritingMissionService", async () => {
      missionService.getMissionStatus.mockResolvedValue({
        status: "COMPLETED",
      });

      const result = await service.getMissionStatus("mission-1", "user-1");

      expect(missionService.getMissionStatus).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
      );
      expect(result).toEqual({ status: "COMPLETED" });
    });
  });

  describe("cancelMission", () => {
    it("should delegate to WritingMissionService", async () => {
      missionService.cancelMission.mockResolvedValue({ cancelled: true });

      const result = await service.cancelMission("mission-1", "user-1");

      expect(missionService.cancelMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
      );
      expect(result).toEqual({ cancelled: true });
    });
  });
});
