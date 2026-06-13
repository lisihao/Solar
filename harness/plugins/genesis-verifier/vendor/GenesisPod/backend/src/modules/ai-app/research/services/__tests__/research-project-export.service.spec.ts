import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import {
  ResearchProjectExportService,
  ExportableResearchProjectData,
  ResearchProjectListItem,
} from "../research-project-export.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("ResearchProjectExportService", () => {
  let service: ResearchProjectExportService;

  const mockPrisma = {
    researchProject: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchProjectExportService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ResearchProjectExportService>(
      ResearchProjectExportService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== getProjectForExport ====================

  describe("getProjectForExport", () => {
    const projectId = "project-1";
    const userId = "user-1";

    const mockOutput = {
      id: "output-1",
      type: "REPORT",
      title: "Final Report",
      status: "COMPLETED",
      content: "Full report content here",
    };

    const mockProject = {
      id: projectId,
      name: "AI Research Project",
      description: "Deep dive into AI",
      researchType: "DEEP_RESEARCH",
      createdAt: new Date("2025-03-01"),
      outputs: [mockOutput],
    };

    it("should throw NotFoundException when project is not found", async () => {
      mockPrisma.researchProject.findFirst.mockResolvedValue(null);

      await expect(
        service.getProjectForExport(projectId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException with projectId in error message", async () => {
      mockPrisma.researchProject.findFirst.mockResolvedValue(null);

      await expect(
        service.getProjectForExport("missing-id", userId),
      ).rejects.toThrow("missing-id");
    });

    it("should query with correct projectId and userId", async () => {
      mockPrisma.researchProject.findFirst.mockResolvedValue(mockProject);

      await service.getProjectForExport(projectId, userId);

      expect(mockPrisma.researchProject.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: projectId, userId },
        }),
      );
    });

    it("should filter outputs to COMPLETED status in query", async () => {
      mockPrisma.researchProject.findFirst.mockResolvedValue(mockProject);

      await service.getProjectForExport(projectId, userId);

      const callArg = mockPrisma.researchProject.findFirst.mock.calls[0][0];
      expect(callArg.include.outputs.where).toEqual({ status: "COMPLETED" });
    });

    it("should limit outputs to 5 in query", async () => {
      mockPrisma.researchProject.findFirst.mockResolvedValue(mockProject);

      await service.getProjectForExport(projectId, userId);

      const callArg = mockPrisma.researchProject.findFirst.mock.calls[0][0];
      expect(callArg.include.outputs.take).toBe(5);
    });

    it("should return a properly shaped ExportableResearchProjectData", async () => {
      mockPrisma.researchProject.findFirst.mockResolvedValue(mockProject);

      const result: ExportableResearchProjectData =
        await service.getProjectForExport(projectId, userId);

      expect(result.id).toBe(projectId);
      expect(result.name).toBe("AI Research Project");
      expect(result.description).toBe("Deep dive into AI");
      expect(result.researchType).toBe("DEEP_RESEARCH");
      expect(result.createdAt).toEqual(new Date("2025-03-01"));
    });

    it("should map each output to the correct shape", async () => {
      mockPrisma.researchProject.findFirst.mockResolvedValue(mockProject);

      const result = await service.getProjectForExport(projectId, userId);

      expect(result.outputs).toHaveLength(1);
      expect(result.outputs[0]).toEqual({
        id: "output-1",
        type: "REPORT",
        title: "Final Report",
        status: "COMPLETED",
        content: "Full report content here",
      });
    });

    it("should return empty outputs array when project has no completed outputs", async () => {
      const projectNoOutputs = { ...mockProject, outputs: [] };
      mockPrisma.researchProject.findFirst.mockResolvedValue(projectNoOutputs);

      const result = await service.getProjectForExport(projectId, userId);

      expect(result.outputs).toEqual([]);
    });

    it("should handle null description gracefully", async () => {
      const projectNullDesc = {
        ...mockProject,
        description: null,
        outputs: [],
      };
      mockPrisma.researchProject.findFirst.mockResolvedValue(projectNullDesc);

      const result = await service.getProjectForExport(projectId, userId);

      expect(result.description).toBeNull();
    });

    it("should handle null content in output gracefully", async () => {
      const outputNullContent = { ...mockOutput, content: null };
      const projectWithNullContent = {
        ...mockProject,
        outputs: [outputNullContent],
      };
      mockPrisma.researchProject.findFirst.mockResolvedValue(
        projectWithNullContent,
      );

      const result = await service.getProjectForExport(projectId, userId);

      expect(result.outputs[0].content).toBeNull();
    });
  });

  // ==================== listProjectsForExport ====================

  describe("listProjectsForExport", () => {
    const userId = "user-1";

    const mockProjects = [
      {
        id: "project-1",
        name: "Project One",
        description: "First project",
        researchType: "DEEP_RESEARCH",
        createdAt: new Date("2025-06-01"),
        _count: { outputs: 5 },
      },
      {
        id: "project-2",
        name: "Project Two",
        description: null,
        researchType: "QUICK_SCAN",
        createdAt: new Date("2025-05-01"),
        _count: { outputs: 0 },
      },
    ];

    it("should return an array of ResearchProjectListItem", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue(mockProjects);

      const result: ResearchProjectListItem[] =
        await service.listProjectsForExport(userId);

      expect(Array.isArray(result)).toBe(true);
    });

    it("should map each project to a ResearchProjectListItem with correct fields", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue(mockProjects);

      const result = await service.listProjectsForExport(userId);

      expect(result[0]).toEqual({
        id: "project-1",
        name: "Project One",
        description: "First project",
        researchType: "DEEP_RESEARCH",
        createdAt: new Date("2025-06-01"),
        outputCount: 5,
      });
    });

    it("should map outputCount from _count.outputs", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue(mockProjects);

      const result = await service.listProjectsForExport(userId);

      expect(result[1].outputCount).toBe(0);
    });

    it("should query with userId and ACTIVE status", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue([]);

      await service.listProjectsForExport(userId);

      expect(mockPrisma.researchProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, status: "ACTIVE" },
        }),
      );
    });

    it("should order by lastAccessAt desc", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue([]);

      await service.listProjectsForExport(userId);

      const callArg = mockPrisma.researchProject.findMany.mock.calls[0][0];
      expect(callArg.orderBy).toEqual({ lastAccessAt: "desc" });
    });

    it("should default limit to 50", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue([]);

      await service.listProjectsForExport(userId);

      expect(mockPrisma.researchProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it("should respect a custom limit", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue([]);

      await service.listProjectsForExport(userId, 20);

      expect(mockPrisma.researchProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });

    it("should return empty array when user has no active projects", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue([]);

      const result = await service.listProjectsForExport(userId);

      expect(result).toEqual([]);
    });
  });
});
