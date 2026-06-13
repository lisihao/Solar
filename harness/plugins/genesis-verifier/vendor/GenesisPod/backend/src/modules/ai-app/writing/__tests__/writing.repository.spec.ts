/**
 * WritingRepository 单元测试
 */

import { Test, TestingModule } from "@nestjs/testing";
import { WritingRepository } from "../writing.repository";
import { PrismaService } from "../../../../common/prisma/prisma.service";

// ==================== Mock ====================

const mockPrisma = {
  writingProject: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  writingVolume: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  writingChapter: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  storyBible: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  writingCharacter: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  worldSetting: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

// ==================== Tests ====================

describe("WritingRepository", () => {
  let repo: WritingRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repo = module.get<WritingRepository>(WritingRepository);
  });

  // ==================== WritingProject ====================

  describe("findProjectsByOwnerId", () => {
    it("should query projects by ownerId ordered by updatedAt desc", async () => {
      mockPrisma.writingProject.findMany.mockResolvedValue([]);
      await repo.findProjectsByOwnerId("user-001");
      expect(mockPrisma.writingProject.findMany).toHaveBeenCalledWith({
        where: { ownerId: "user-001" },
        include: undefined,
        orderBy: { updatedAt: "desc" },
      });
    });
  });

  describe("findProjectById", () => {
    it("should find project by id", async () => {
      const project = { id: "proj-1", title: "我的小说" };
      mockPrisma.writingProject.findUnique.mockResolvedValue(project);

      const result = await repo.findProjectById("proj-1");
      expect(result).toEqual(project);
    });

    it("should return null when not found", async () => {
      mockPrisma.writingProject.findUnique.mockResolvedValue(null);
      expect(await repo.findProjectById("missing")).toBeNull();
    });
  });

  describe("findProjectByIdAndOwner", () => {
    it("should find project with both id and ownerId conditions", async () => {
      const project = { id: "proj-1", ownerId: "user-001" };
      mockPrisma.writingProject.findFirst.mockResolvedValue(project);

      const result = await repo.findProjectByIdAndOwner("proj-1", "user-001");
      expect(result).toEqual(project);
      expect(mockPrisma.writingProject.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "proj-1", ownerId: "user-001" },
        }),
      );
    });
  });

  describe("createProject", () => {
    it("should create a writing project", async () => {
      const data = { title: "新小说", ownerId: "user-001" } as never;
      const created = { id: "proj-1", ...data };
      mockPrisma.writingProject.create.mockResolvedValue(created);

      const result = await repo.createProject(data);
      expect(result).toEqual(created);
    });
  });

  describe("updateProject", () => {
    it("should update a project", async () => {
      mockPrisma.writingProject.update.mockResolvedValue({ id: "proj-1" });
      await repo.updateProject("proj-1", { title: "更新标题" });
      expect(mockPrisma.writingProject.update).toHaveBeenCalledWith({
        where: { id: "proj-1" },
        data: { title: "更新标题" },
        include: undefined,
      });
    });
  });

  describe("deleteProject", () => {
    it("should delete a project", async () => {
      mockPrisma.writingProject.delete.mockResolvedValue({ id: "proj-1" });
      await repo.deleteProject("proj-1");
      expect(mockPrisma.writingProject.delete).toHaveBeenCalledWith({
        where: { id: "proj-1" },
      });
    });
  });

  describe("countProjects", () => {
    it("should count projects", async () => {
      mockPrisma.writingProject.count.mockResolvedValue(3);
      const result = await repo.countProjects({ ownerId: "u1" } as never);
      expect(result).toBe(3);
    });
  });

  // ==================== WritingVolume ====================

  describe("findVolumesByProjectId", () => {
    it("should find volumes ordered by volumeNumber asc", async () => {
      mockPrisma.writingVolume.findMany.mockResolvedValue([]);
      await repo.findVolumesByProjectId("proj-1");
      expect(mockPrisma.writingVolume.findMany).toHaveBeenCalledWith({
        where: { projectId: "proj-1" },
        include: undefined,
        orderBy: { volumeNumber: "asc" },
      });
    });
  });

  describe("createVolume", () => {
    it("should create a volume", async () => {
      const data = { projectId: "proj-1", title: "第一卷" } as never;
      mockPrisma.writingVolume.create.mockResolvedValue({ id: "v1", ...data });
      await repo.createVolume(data);
      expect(mockPrisma.writingVolume.create).toHaveBeenCalled();
    });
  });

  describe("deleteManyVolumes", () => {
    it("should bulk delete volumes", async () => {
      mockPrisma.writingVolume.deleteMany.mockResolvedValue({ count: 2 });
      const result = await repo.deleteManyVolumes({
        projectId: "proj-1",
      } as never);
      expect(result.count).toBe(2);
    });
  });

  // ==================== WritingChapter ====================

  describe("findChaptersByVolumeId", () => {
    it("should find chapters ordered by chapterNumber asc", async () => {
      mockPrisma.writingChapter.findMany.mockResolvedValue([]);
      await repo.findChaptersByVolumeId("vol-1");
      expect(mockPrisma.writingChapter.findMany).toHaveBeenCalledWith({
        where: { volumeId: "vol-1" },
        include: undefined,
        orderBy: { chapterNumber: "asc" },
      });
    });
  });

  describe("findChaptersByProjectId", () => {
    it("should find chapters ordered by volume then chapterNumber", async () => {
      mockPrisma.writingChapter.findMany.mockResolvedValue([]);
      await repo.findChaptersByProjectId("proj-1");
      expect(mockPrisma.writingChapter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { volume: { projectId: "proj-1" } },
          orderBy: [
            { volume: { volumeNumber: "asc" } },
            { chapterNumber: "asc" },
          ],
        }),
      );
    });
  });

  describe("createChapter", () => {
    it("should create a chapter", async () => {
      const data = { volumeId: "v1", title: "第一章" } as never;
      mockPrisma.writingChapter.create.mockResolvedValue({ id: "c1", ...data });
      await repo.createChapter(data);
      expect(mockPrisma.writingChapter.create).toHaveBeenCalled();
    });
  });

  describe("updateChapter", () => {
    it("should update chapter content", async () => {
      mockPrisma.writingChapter.update.mockResolvedValue({ id: "c1" });
      await repo.updateChapter("c1", { content: "新内容" });
      expect(mockPrisma.writingChapter.update).toHaveBeenCalledWith({
        where: { id: "c1" },
        data: { content: "新内容" },
        include: undefined,
      });
    });
  });

  describe("deleteChapter / deleteManyChapters", () => {
    it("should delete a single chapter", async () => {
      mockPrisma.writingChapter.delete.mockResolvedValue({ id: "c1" });
      await repo.deleteChapter("c1");
      expect(mockPrisma.writingChapter.delete).toHaveBeenCalledWith({
        where: { id: "c1" },
      });
    });

    it("should bulk delete chapters", async () => {
      mockPrisma.writingChapter.deleteMany.mockResolvedValue({ count: 5 });
      const result = await repo.deleteManyChapters({ volumeId: "v1" } as never);
      expect(result.count).toBe(5);
    });
  });

  describe("countChapters", () => {
    it("should count chapters", async () => {
      mockPrisma.writingChapter.count.mockResolvedValue(12);
      const result = await repo.countChapters({ status: "COMPLETED" } as never);
      expect(result).toBe(12);
    });
  });

  describe("groupChaptersByStatus", () => {
    it("should group chapters by status", async () => {
      const grouped = [
        { status: "COMPLETED", _count: { status: 5 } },
        { status: "DRAFT", _count: { status: 3 } },
      ];
      mockPrisma.writingChapter.groupBy.mockResolvedValue(grouped);

      const result = await repo.groupChaptersByStatus("proj-1");
      expect(result).toEqual(grouped);
      expect(mockPrisma.writingChapter.groupBy).toHaveBeenCalledWith({
        by: ["status"],
        where: { volume: { projectId: "proj-1" } },
        _count: { status: true },
      });
    });
  });

  // ==================== StoryBible ====================

  describe("findStoryBibleByProjectId", () => {
    it("should find story bible by projectId", async () => {
      const bible = { id: "b1", projectId: "proj-1" };
      mockPrisma.storyBible.findUnique.mockResolvedValue(bible);

      const result = await repo.findStoryBibleByProjectId("proj-1");
      expect(result).toEqual(bible);
      expect(mockPrisma.storyBible.findUnique).toHaveBeenCalledWith({
        where: { projectId: "proj-1" },
        include: undefined,
      });
    });
  });

  describe("createStoryBible", () => {
    it("should create story bible", async () => {
      const data = { projectId: "proj-1" } as never;
      mockPrisma.storyBible.create.mockResolvedValue({ id: "b1" });
      await repo.createStoryBible(data);
      expect(mockPrisma.storyBible.create).toHaveBeenCalledWith({ data });
    });
  });

  describe("updateStoryBible", () => {
    it("should update story bible by projectId", async () => {
      mockPrisma.storyBible.update.mockResolvedValue({ id: "b1" });
      await repo.updateStoryBible("proj-1", { worldView: "奇幻世界" });
      expect(mockPrisma.storyBible.update).toHaveBeenCalledWith({
        where: { projectId: "proj-1" },
        data: { worldView: "奇幻世界" },
      });
    });
  });

  // ==================== Character ====================

  describe("findCharactersByBibleId", () => {
    it("should find characters ordered by createdAt desc", async () => {
      mockPrisma.writingCharacter.findMany.mockResolvedValue([]);
      await repo.findCharactersByBibleId("b1");
      expect(mockPrisma.writingCharacter.findMany).toHaveBeenCalledWith({
        where: { bibleId: "b1" },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("createCharacter", () => {
    it("should create character", async () => {
      const data = { bibleId: "b1", name: "主角" } as never;
      mockPrisma.writingCharacter.create.mockResolvedValue({ id: "ch1" });
      await repo.createCharacter(data);
      expect(mockPrisma.writingCharacter.create).toHaveBeenCalledWith({ data });
    });
  });

  describe("updateCharacter", () => {
    it("should update character", async () => {
      mockPrisma.writingCharacter.update.mockResolvedValue({ id: "ch1" });
      await repo.updateCharacter("ch1", { description: "更新描述" });
      expect(mockPrisma.writingCharacter.update).toHaveBeenCalledWith({
        where: { id: "ch1" },
        data: { description: "更新描述" },
      });
    });
  });

  describe("deleteCharacter", () => {
    it("should delete character", async () => {
      mockPrisma.writingCharacter.delete.mockResolvedValue({ id: "ch1" });
      await repo.deleteCharacter("ch1");
      expect(mockPrisma.writingCharacter.delete).toHaveBeenCalledWith({
        where: { id: "ch1" },
      });
    });
  });

  // ==================== WorldSetting ====================

  describe("findWorldSettingsByBibleId", () => {
    it("should find world settings ordered by createdAt desc", async () => {
      mockPrisma.worldSetting.findMany.mockResolvedValue([]);
      await repo.findWorldSettingsByBibleId("b1");
      expect(mockPrisma.worldSetting.findMany).toHaveBeenCalledWith({
        where: { bibleId: "b1" },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("createWorldSetting", () => {
    it("should create world setting", async () => {
      const data = { bibleId: "b1", category: "地理" } as never;
      mockPrisma.worldSetting.create.mockResolvedValue({ id: "ws1" });
      await repo.createWorldSetting(data);
      expect(mockPrisma.worldSetting.create).toHaveBeenCalledWith({ data });
    });
  });

  // ==================== getPrismaClient ====================

  describe("getPrismaClient", () => {
    it("should return the prisma service instance", () => {
      expect(repo.getPrismaClient()).toBe(mockPrisma);
    });
  });
});
