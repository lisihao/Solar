import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { WritingDataExportService } from "../writing-data-export.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("WritingDataExportService", () => {
  let service: WritingDataExportService;
  let mockPrisma: jest.Mocked<PrismaService>;

  const mockChapter = {
    id: "ch-1",
    title: "Chapter 1",
    chapterNumber: 1,
    content: "Chapter 1 content",
  };

  const mockVolume = {
    id: "vol-1",
    title: "Volume 1",
    volumeNumber: 1,
    chapters: [mockChapter],
  };

  const mockProject = {
    id: "proj-1",
    name: "My Novel",
    genre: "Fantasy",
    writingStyle: "jin_yong",
    createdAt: new Date("2025-01-01"),
    ownerId: "user-1",
    volumes: [mockVolume],
  };

  const mockProjectWithCount = {
    id: "proj-1",
    name: "My Novel",
    genre: "Fantasy",
    createdAt: new Date("2025-01-01"),
    _count: { volumes: 2 },
  };

  beforeEach(async () => {
    mockPrisma = {
      writingProject: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingDataExportService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WritingDataExportService>(WritingDataExportService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getProjectForExport", () => {
    it("should return exportable project data when found", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        mockProject,
      );

      const result = await service.getProjectForExport("proj-1", "user-1");

      expect(result.id).toBe("proj-1");
      expect(result.name).toBe("My Novel");
      expect(result.genre).toBe("Fantasy");
      expect(result.writingStyle).toBe("jin_yong");
      expect(result.volumes).toHaveLength(1);
    });

    it("should throw NotFoundException when project not found", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.getProjectForExport("nonexistent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when project belongs to different user", async () => {
      // findFirst returns null when ownerId doesn't match
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.getProjectForExport("proj-1", "wrong-user"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should query by both projectId and ownerId", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        mockProject,
      );

      await service.getProjectForExport("proj-1", "user-1");

      expect(mockPrisma.writingProject.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "proj-1", ownerId: "user-1" },
        }),
      );
    });

    it("should map volumes with chapters in the result", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        mockProject,
      );

      const result = await service.getProjectForExport("proj-1", "user-1");

      expect(result.volumes[0]).toMatchObject({
        id: "vol-1",
        title: "Volume 1",
        volumeNumber: 1,
      });
      expect(result.volumes[0].chapters).toHaveLength(1);
      expect(result.volumes[0].chapters[0]).toMatchObject({
        id: "ch-1",
        title: "Chapter 1",
        chapterNumber: 1,
        content: "Chapter 1 content",
      });
    });

    it("should handle project with no volumes", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue({
        ...mockProject,
        volumes: [],
      });

      const result = await service.getProjectForExport("proj-1", "user-1");

      expect(result.volumes).toEqual([]);
    });

    it("should include volumes ordered by volumeNumber", async () => {
      (mockPrisma.writingProject.findFirst as jest.Mock).mockResolvedValue(
        mockProject,
      );

      await service.getProjectForExport("proj-1", "user-1");

      expect(mockPrisma.writingProject.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            volumes: expect.objectContaining({
              orderBy: { volumeNumber: "asc" },
            }),
          }),
        }),
      );
    });
  });

  describe("listProjectsForExport", () => {
    it("should return list of projects with volume count", async () => {
      (mockPrisma.writingProject.findMany as jest.Mock).mockResolvedValue([
        mockProjectWithCount,
      ]);

      const result = await service.listProjectsForExport("user-1");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "proj-1",
        name: "My Novel",
        genre: "Fantasy",
        volumeCount: 2,
      });
    });

    it("should use default limit of 50", async () => {
      (mockPrisma.writingProject.findMany as jest.Mock).mockResolvedValue([]);

      await service.listProjectsForExport("user-1");

      expect(mockPrisma.writingProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it("should use custom limit when provided", async () => {
      (mockPrisma.writingProject.findMany as jest.Mock).mockResolvedValue([]);

      await service.listProjectsForExport("user-1", 10);

      expect(mockPrisma.writingProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it("should filter by userId", async () => {
      (mockPrisma.writingProject.findMany as jest.Mock).mockResolvedValue([]);

      await service.listProjectsForExport("user-1");

      expect(mockPrisma.writingProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ownerId: "user-1" },
        }),
      );
    });

    it("should order by updatedAt desc", async () => {
      (mockPrisma.writingProject.findMany as jest.Mock).mockResolvedValue([]);

      await service.listProjectsForExport("user-1");

      expect(mockPrisma.writingProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { updatedAt: "desc" },
        }),
      );
    });

    it("should return empty array when user has no projects", async () => {
      (mockPrisma.writingProject.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listProjectsForExport("user-1");

      expect(result).toEqual([]);
    });

    it("should handle project with null genre", async () => {
      (mockPrisma.writingProject.findMany as jest.Mock).mockResolvedValue([
        { ...mockProjectWithCount, genre: null },
      ]);

      const result = await service.listProjectsForExport("user-1");

      expect(result[0].genre).toBeNull();
    });
  });
});
