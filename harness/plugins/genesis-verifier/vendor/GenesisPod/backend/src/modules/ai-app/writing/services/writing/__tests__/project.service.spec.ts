/**
 * Unit tests for ProjectService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { ProjectService } from "../project.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

function buildMockPrisma() {
  return {
    writingProject: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    writingVolume: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    writingMission: {
      findFirst: jest.fn(),
    },
    writingChapter: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _sum: { wordCount: 0 } }),
    },
  };
}

describe("ProjectService", () => {
  let service: ProjectService;
  let prisma: ReturnType<typeof buildMockPrisma>;

  const mockProject = {
    id: "project-1",
    name: "My Novel",
    description: "An epic story",
    genre: "fantasy",
    targetWords: 100000,
    currentWords: 0,
    status: "PLANNING",
    ownerId: "user-1",
    storyBible: { id: "bible-1" },
    volumes: [],
    _count: { volumes: 0, missions: 0 },
    visibility: "PRIVATE",
  };

  beforeEach(async () => {
    prisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ProjectService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("create", () => {
    it("should create a project with default values", async () => {
      prisma.writingProject.create.mockResolvedValue(mockProject);

      const result = await service.create("user-1", {
        name: "My Novel",
        description: "An epic story",
      });

      expect(result.id).toBe("project-1");
      expect(prisma.writingProject.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "My Novel",
            ownerId: "user-1",
            storyBible: { create: {} },
          }),
        }),
      );
    });

    it("should use provided targetWords", async () => {
      prisma.writingProject.create.mockResolvedValue({
        ...mockProject,
        targetWords: 50000,
      });

      await service.create("user-1", {
        name: "Short Novel",
        targetWords: 50000,
      });

      const createCall = prisma.writingProject.create.mock.calls[0][0];
      expect(createCall.data.targetWords).toBe(50000);
    });
  });

  describe("findAll", () => {
    it("should return paginated projects for user", async () => {
      const projects = [{ ...mockProject }];
      prisma.writingProject.findMany
        .mockResolvedValueOnce(projects)
        .mockResolvedValueOnce(projects); // for status sync + refresh

      // No WRITING projects so syncProjectStatuses won't call findFirst
      const result = await service.findAll("user-1", { limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
    });

    it("should indicate hasMore when more results exist", async () => {
      const projects = Array.from({ length: 21 }, (_, i) => ({
        ...mockProject,
        id: `project-${i}`,
        status: "PLANNING",
      }));

      prisma.writingProject.findMany
        .mockResolvedValueOnce(projects)
        .mockResolvedValueOnce(projects.slice(0, 20));

      const result = await service.findAll("user-1", { limit: 20 });

      expect(result.hasMore).toBe(true);
    });

    it("should auto-fix WRITING status for projects without active missions", async () => {
      const writingProject = {
        ...mockProject,
        status: "WRITING",
        currentWords: 5000,
      };

      prisma.writingProject.findMany
        .mockResolvedValueOnce([writingProject])
        .mockResolvedValueOnce([{ ...writingProject, status: "REVISING" }]);
      prisma.writingMission.findFirst.mockResolvedValue(null);
      prisma.writingProject.findUnique.mockResolvedValue(writingProject);
      prisma.writingProject.update.mockResolvedValue({
        ...writingProject,
        status: "REVISING",
      });

      await service.findAll("user-1", {});

      expect(prisma.writingProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "REVISING" },
        }),
      );
    });
  });

  describe("findOne", () => {
    it("should return project with full details for owner", async () => {
      prisma.writingProject.findFirst.mockResolvedValue({
        ...mockProject,
        storyBible: {
          id: "bible-1",
          characters: [],
          worldSettings: [],
          terminologies: [],
          timelineEvents: [],
          factions: [],
        },
        volumes: [],
      });

      const result = await service.findOne("project-1", "user-1");

      expect(result.id).toBe("project-1");
    });

    it("should throw NotFoundException when project not found", async () => {
      prisma.writingProject.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne("missing-project", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("update", () => {
    it("should update project for owner", async () => {
      prisma.writingProject.findFirst.mockResolvedValue(mockProject);
      prisma.writingProject.update.mockResolvedValue({
        ...mockProject,
        name: "Updated Novel",
      });

      const result = await service.update("project-1", "user-1", {
        name: "Updated Novel",
      });

      expect(result.name).toBe("Updated Novel");
    });

    it("should throw ForbiddenException for non-owner", async () => {
      prisma.writingProject.findFirst.mockResolvedValue(null);

      await expect(
        service.update("project-1", "other-user", { name: "Stolen" }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("delete", () => {
    it("should delete project for owner", async () => {
      prisma.writingProject.findFirst.mockResolvedValue(mockProject);
      prisma.writingProject.delete.mockResolvedValue(mockProject);

      await service.delete("project-1", "user-1");

      expect(prisma.writingProject.delete).toHaveBeenCalledWith({
        where: { id: "project-1" },
      });
    });

    it("should throw ForbiddenException for non-owner", async () => {
      prisma.writingProject.findFirst.mockResolvedValue(null);

      await expect(service.delete("project-1", "other-user")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("createVolume", () => {
    it("should create a volume for project owner", async () => {
      prisma.writingProject.findFirst.mockResolvedValue(mockProject);
      prisma.writingVolume.create.mockResolvedValue({
        id: "volume-1",
        projectId: "project-1",
        volumeNumber: 1,
        title: "Volume One",
      });

      const result = await service.createVolume("project-1", "user-1", {
        volumeNumber: 1,
        title: "Volume One",
      });

      expect(result.id).toBe("volume-1");
    });
  });

  describe("findPublic", () => {
    it("should return public project info", async () => {
      prisma.writingProject.findFirst.mockResolvedValue({
        ...mockProject,
        visibility: "PUBLIC",
        createdAt: new Date("2025-01-01T00:00:00Z"),
        owner: { username: "author123" },
        volumes: [],
      });

      const result = await service.findPublic("project-1");

      expect(result).not.toBeNull();
      expect(result?.userName).toBe("author123");
    });

    it("should return null when project is private or not found", async () => {
      prisma.writingProject.findFirst.mockResolvedValue(null);

      const result = await service.findPublic("private-project");

      expect(result).toBeNull();
    });
  });

  describe("resetChaptersByNumbers", () => {
    it("should reset chapters and update project word count", async () => {
      prisma.writingChapter.updateMany.mockResolvedValue({ count: 3 });
      prisma.writingChapter.aggregate.mockResolvedValue({
        _sum: { wordCount: 5000 },
      });
      prisma.writingProject.update.mockResolvedValue(mockProject);

      await service.resetChaptersByNumbers("project-1", [1, 2, 3]);

      expect(prisma.writingChapter.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: "",
            wordCount: 0,
            status: "PLANNED",
          }),
        }),
      );
      expect(prisma.writingProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { currentWords: 5000 },
        }),
      );
    });
  });
});
