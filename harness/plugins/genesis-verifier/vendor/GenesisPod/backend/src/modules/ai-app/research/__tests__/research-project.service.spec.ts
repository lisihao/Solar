/**
 * Tests for ResearchProjectService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { ResearchProjectService } from "../project/research-project.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";

jest.mock("../../../../common/prisma/prisma.service");

// Mock global fetch for sedimentToInsights tests
global.fetch = jest.fn();

describe("ResearchProjectService", () => {
  let service: ResearchProjectService;
  let prisma: jest.Mocked<PrismaService>;

  const userId = "user-123";
  const projectId = "project-456";

  const mockProject = {
    id: projectId,
    userId,
    name: "Test Project",
    description: "Test Description",
    icon: "📚",
    color: "#6366f1",
    status: "ACTIVE",
    visibility: "PRIVATE",
    researchType: "DEEP",
    lastAccessAt: new Date(),
    _count: { sources: 0, notes: 0, chats: 0, outputs: 0 },
  };

  beforeEach(async () => {
    const mockPrismaService = {
      researchProject: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      researchProjectOutput: {
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchProjectService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string, defaultValue?: string) => defaultValue ?? "",
            ),
          },
        },
      ],
    }).compile();

    service = module.get<ResearchProjectService>(ResearchProjectService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createProject", () => {
    it("should create a project with default values", async () => {
      (prisma.researchProject.create as jest.Mock).mockResolvedValue(
        mockProject,
      );

      const result = await service.createProject(userId, {
        name: "New Project",
      });

      expect(result).toBe(mockProject);
      expect(prisma.researchProject.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            name: "New Project",
            icon: "📚",
            color: "#6366f1",
          }),
        }),
      );
    });

    it("should use provided icon and color", async () => {
      (prisma.researchProject.create as jest.Mock).mockResolvedValue(
        mockProject,
      );

      await service.createProject(userId, {
        name: "Project",
        icon: "🔬",
        color: "#FF0000",
      });

      expect(prisma.researchProject.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            icon: "🔬",
            color: "#FF0000",
          }),
        }),
      );
    });
  });

  describe("getProjects", () => {
    it("should return projects with pagination", async () => {
      (prisma.researchProject.findMany as jest.Mock).mockResolvedValue([
        mockProject,
      ]);
      (prisma.researchProject.count as jest.Mock).mockResolvedValue(1);

      const result = await service.getProjects(userId);

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it("should apply search filter when provided", async () => {
      (prisma.researchProject.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.researchProject.count as jest.Mock).mockResolvedValue(0);

      await service.getProjects(userId, { search: "AI research" });

      expect(prisma.researchProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.any(Array),
          }),
        }),
      );
    });

    it("should filter by research type", async () => {
      (prisma.researchProject.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.researchProject.count as jest.Mock).mockResolvedValue(0);

      await service.getProjects(userId, { researchType: "FAST" });

      expect(prisma.researchProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.any(Array),
          }),
        }),
      );
    });

    it("should use default take and skip values", async () => {
      (prisma.researchProject.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.researchProject.count as jest.Mock).mockResolvedValue(0);

      const result = await service.getProjects(userId);

      expect(result.pagination.take).toBe(20);
      expect(result.pagination.skip).toBe(0);
    });
  });

  describe("getProject", () => {
    it("should return project for owner", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProject.update as jest.Mock).mockResolvedValue(
        mockProject,
      );

      const result = await service.getProject(userId, projectId);

      expect(result).toBe(mockProject);
      // Should update lastAccessAt for owner
      expect(prisma.researchProject.update).toHaveBeenCalled();
    });

    it("should allow access to public project from non-owner", async () => {
      const publicProject = {
        ...mockProject,
        userId: "other-user",
        visibility: "PUBLIC",
      };
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        publicProject,
      );

      const result = await service.getProject("non-owner", projectId);

      expect(result).toBe(publicProject);
      // Should not update lastAccessAt for non-owner
      expect(prisma.researchProject.update).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException when project not found", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getProject(userId, projectId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException for private project from non-owner", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        userId: "other-user",
        visibility: "PRIVATE",
      });

      await expect(service.getProject("non-owner", projectId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("updateProject", () => {
    it("should update project fields", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProject.update as jest.Mock).mockResolvedValue({
        ...mockProject,
        name: "Updated Name",
      });

      await service.updateProject(userId, projectId, {
        name: "Updated Name",
      });

      expect(prisma.researchProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: projectId },
        }),
      );
    });

    it("should throw NotFoundException when project not found", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateProject(userId, projectId, { name: "New Name" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when non-owner tries to update", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        userId: "other-user",
      });

      await expect(
        service.updateProject("non-owner", projectId, { name: "New Name" }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("deleteProject", () => {
    it("should soft delete project by setting status to DELETED", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProject.update as jest.Mock).mockResolvedValue({
        ...mockProject,
        status: "DELETED",
      });

      await service.deleteProject(userId, projectId);

      expect(prisma.researchProject.update).toHaveBeenCalledWith({
        where: { id: projectId },
        data: { status: "DELETED" },
      });
    });

    it("should throw NotFoundException when project not found", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteProject(userId, projectId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException when non-owner tries to delete", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        userId: "other-user",
      });

      await expect(
        service.deleteProject("non-owner", projectId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("archiveProject", () => {
    it("should archive project", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProject.update as jest.Mock).mockResolvedValue({
        ...mockProject,
        status: "ARCHIVED",
      });

      await service.archiveProject(userId, projectId);

      expect(prisma.researchProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "ARCHIVED" }),
        }),
      );
    });
  });

  describe("restoreProject", () => {
    it("should restore project to ACTIVE", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        status: "ARCHIVED",
      });
      (prisma.researchProject.update as jest.Mock).mockResolvedValue({
        ...mockProject,
        status: "ACTIVE",
      });

      await service.restoreProject(userId, projectId);

      expect(prisma.researchProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "ACTIVE" }),
        }),
      );
    });
  });

  describe("sedimentToInsights", () => {
    const outputId = "output-123";

    const mockOutput = {
      id: outputId,
      projectId,
      title: "Research Report",
      status: "COMPLETED",
      content: "Report content...",
      project: { userId },
    };

    it("should throw NotFoundException when output not found", async () => {
      (prisma.researchProjectOutput.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.sedimentToInsights(
          userId,
          projectId,
          { outputId, mode: "new_topic" },
          "token-abc",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when output is not completed", async () => {
      (prisma.researchProjectOutput.findFirst as jest.Mock).mockResolvedValue({
        ...mockOutput,
        status: "PENDING",
      });

      await expect(
        service.sedimentToInsights(
          userId,
          projectId,
          { outputId, mode: "new_topic" },
          "token-abc",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for add_dimension mode without targetTopicId", async () => {
      (prisma.researchProjectOutput.findFirst as jest.Mock).mockResolvedValue(
        mockOutput,
      );

      await expect(
        service.sedimentToInsights(
          userId,
          projectId,
          { outputId, mode: "add_dimension" },
          "token-abc",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should add dimension when mode is add_dimension", async () => {
      (prisma.researchProjectOutput.findFirst as jest.Mock).mockResolvedValue(
        mockOutput,
      );
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: "dim-1", topicId: "topic-1" } }),
      });

      const result = await service.sedimentToInsights(
        userId,
        projectId,
        { outputId, mode: "add_dimension", targetTopicId: "topic-1" },
        "token-abc",
      );

      expect(result.success).toBe(true);
      expect(result.result.mode).toBe("add_dimension");
      expect(result.result.topicId).toBe("topic-1");
    });

    it("should create new topic when mode is new_topic", async () => {
      (prisma.researchProjectOutput.findFirst as jest.Mock).mockResolvedValue(
        mockOutput,
      );
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "new-topic-1" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { id: "dim-2" } }),
        });

      const result = await service.sedimentToInsights(
        userId,
        projectId,
        { outputId, mode: "new_topic", topicName: "AI Market" },
        "token-abc",
      );

      expect(result.success).toBe(true);
      expect(result.result.mode).toBe("new_topic");
      expect(result.result.topicId).toBe("new-topic-1");
    });

    it("should throw BadRequestException when topic creation fails", async () => {
      (prisma.researchProjectOutput.findFirst as jest.Mock).mockResolvedValue(
        mockOutput,
      );
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
      });

      await expect(
        service.sedimentToInsights(
          userId,
          projectId,
          { outputId, mode: "new_topic" },
          "token-abc",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when topic creation returns no ID", async () => {
      (prisma.researchProjectOutput.findFirst as jest.Mock).mockResolvedValue(
        mockOutput,
      );
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ data: {} }), // No ID
      });

      await expect(
        service.sedimentToInsights(
          userId,
          projectId,
          { outputId, mode: "new_topic" },
          "token-abc",
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
