import { Test, TestingModule } from "@nestjs/testing";
import { StoryBibleService } from "../story-bible.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ForbiddenException, NotFoundException } from "@nestjs/common";

describe("StoryBibleService", () => {
  let service: StoryBibleService;
  let mockPrisma: jest.Mocked<PrismaService>;

  const mockProject = {
    id: "proj-1",
    title: "测试小说",
    ownerId: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockBible = {
    id: "bible-1",
    projectId: "proj-1",
    premise: "这是一个关于穿越的故事",
    theme: "宫廷权谋",
    tone: "严肃",
    worldType: "清朝宫廷",
    version: 1,
    lastSyncAt: new Date(),
    worldSettings: [
      {
        id: "ws-1",
        bibleId: "bible-1",
        category: "geography",
        name: "皇宫",
        description: "金碧辉煌",
        rules: [],
        references: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    characters: [
      {
        id: "char-1",
        bibleId: "bible-1",
        name: "苏曼",
        role: "protagonist",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    terminologies: [],
    timelineEvents: [],
    factions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = {
      writingProject: {
        findFirst: jest.fn(),
      },
      storyBible: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      writingCharacter: {
        findMany: jest.fn(),
      },
      worldSetting: {
        findMany: jest.fn(),
      },
      terminology: {
        findMany: jest.fn(),
      },
      timelineEvent: {
        findMany: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoryBibleService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<StoryBibleService>(StoryBibleService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getByProject", () => {
    it("should return bible when project exists and user is owner", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(
        mockBible,
      );

      const result = await service.getByProject("proj-1", "user-1");

      expect(result).toBeDefined();
      expect(result?.id).toBe("bible-1");
    });

    it("should throw ForbiddenException when project not found", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(service.getByProject("proj-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should return null when bible not found", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getByProject("proj-1", "user-1");

      expect(result).toBeNull();
    });

    it("should normalize world setting descriptions that are JSON strings", async () => {
      const bibleWithJsonDesc = {
        ...mockBible,
        worldSettings: [
          {
            ...mockBible.worldSettings[0],
            description: '{"key": "value"}',
          },
        ],
      };

      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(
        bibleWithJsonDesc,
      );

      const result = await service.getByProject("proj-1", "user-1");

      expect(result?.worldSettings[0].description).not.toContain("{");
    });

    it("should clean premise of [object Object] lines", async () => {
      const bibleWithBadPremise = {
        ...mockBible,
        premise: "正常前提\n[object Object]\n更多内容",
      };

      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(
        bibleWithBadPremise,
      );

      const result = await service.getByProject("proj-1", "user-1");

      expect(result?.premise).not.toContain("[object Object]");
    });
  });

  describe("update", () => {
    it("should update bible successfully", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (mockPrisma.storyBible.update as jest.Mock).mockResolvedValue({
        ...mockBible,
        premise: "新的故事前提",
      });

      const result = await service.update("proj-1", "user-1", {
        premise: "新的故事前提",
      });

      expect(mockPrisma.storyBible.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: "proj-1" },
          data: expect.objectContaining({ premise: "新的故事前提" }),
        }),
      );
      expect(result.premise).toBe("新的故事前提");
    });

    it("should throw ForbiddenException when project not found", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.update("proj-1", "user-1", { premise: "test" }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should increment version on update", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (mockPrisma.storyBible.update as jest.Mock).mockResolvedValue(mockBible);

      await service.update("proj-1", "user-1", {});

      expect(mockPrisma.storyBible.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: { increment: 1 } }),
        }),
      );
    });
  });

  describe("getSnapshot", () => {
    it("should return bible snapshot with snapshotAt timestamp", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(
        mockBible,
      );

      const result = await service.getSnapshot("proj-1");

      expect(result).toBeDefined();
      expect(result.snapshotAt).toBeInstanceOf(Date);
    });

    it("should throw NotFoundException when bible not found", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getSnapshot("proj-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getCharactersByIds", () => {
    it("should return characters filtered by ids", async () => {
      const mockChars = [{ id: "char-1", name: "苏曼" }];
      (mockPrisma.writingCharacter.findMany as jest.Mock).mockResolvedValue(
        mockChars,
      );

      const result = await service.getCharactersByIds("bible-1", ["char-1"]);

      expect(mockPrisma.writingCharacter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { bibleId: "bible-1", id: { in: ["char-1"] } },
        }),
      );
      expect(result).toEqual(mockChars);
    });
  });

  describe("getWorldSettings", () => {
    it("should return all world settings when no categories filter", async () => {
      const mockSettings = [{ id: "ws-1", category: "geography" }];
      (mockPrisma.worldSetting.findMany as jest.Mock).mockResolvedValue(
        mockSettings,
      );

      const result = await service.getWorldSettings("bible-1");

      expect(mockPrisma.worldSetting.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { bibleId: "bible-1" },
        }),
      );
      expect(result).toEqual(mockSettings);
    });

    it("should filter by categories when provided", async () => {
      (mockPrisma.worldSetting.findMany as jest.Mock).mockResolvedValue([]);

      await service.getWorldSettings("bible-1", ["geography"]);

      expect(mockPrisma.worldSetting.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: { in: ["geography"] },
          }),
        }),
      );
    });
  });

  describe("getTerminology", () => {
    it("should return all terminology when no terms filter", async () => {
      const mockTerms = [{ id: "term-1", term: "内功" }];
      (mockPrisma.terminology.findMany as jest.Mock).mockResolvedValue(
        mockTerms,
      );

      const result = await service.getTerminology("bible-1");

      expect(result).toEqual(mockTerms);
    });

    it("should filter by specific terms when provided", async () => {
      (mockPrisma.terminology.findMany as jest.Mock).mockResolvedValue([]);

      await service.getTerminology("bible-1", ["内功", "真气"]);

      expect(mockPrisma.terminology.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            term: { in: ["内功", "真气"] },
          }),
        }),
      );
    });
  });

  describe("getTimelineContext", () => {
    it("should return timeline events ordered by storyTime", async () => {
      const mockEvents = [
        { id: "ev-1", storyTime: "第一年" },
        { id: "ev-2", storyTime: "第二年" },
      ];
      (mockPrisma.timelineEvent.findMany as jest.Mock).mockResolvedValue(
        mockEvents,
      );

      const result = await service.getTimelineContext("bible-1");

      expect(mockPrisma.timelineEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { bibleId: "bible-1" },
          orderBy: { storyTime: "asc" },
        }),
      );
      expect(result).toEqual(mockEvents);
    });
  });
});
