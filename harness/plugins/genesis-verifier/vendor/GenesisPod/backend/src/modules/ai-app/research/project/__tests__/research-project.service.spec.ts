/**
 * Unit tests for ResearchProjectService
 *
 * All Prisma and external dependencies are fully mocked.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ResearchProjectService } from "../research-project.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  CreateStudioProjectDto,
  SedimentToInsightsDto,
  UpdateProjectDto,
} from "../dto";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const mockPrisma = {
  researchProject: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  researchProjectOutput: {
    findFirst: jest.fn(),
  },
};

const mockConfigService = {
  get: jest.fn().mockReturnValue("http://localhost:3001"),
};

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    userId: "user-1",
    name: "Test Project",
    description: "A test project",
    icon: "📚",
    color: "#6366f1",
    researchType: "DEEP",
    visibility: "PRIVATE",
    status: "ACTIVE",
    lastAccessAt: new Date(),
    _count: { sources: 0, notes: 0, chats: 0, outputs: 0 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ResearchProjectService", () => {
  let service: ResearchProjectService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchProjectService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<ResearchProjectService>(ResearchProjectService);
  });

  // =========================================================================
  // createProject
  // =========================================================================

  describe("createProject", () => {
    it("should create a project with provided fields", async () => {
      const dto: CreateStudioProjectDto = {
        name: "My Research",
        description: "Testing",
        icon: "🔬",
        color: "#ff0000",
        researchType: "DEEP",
        visibility: "PRIVATE",
      };
      const created = makeProject({ name: "My Research", icon: "🔬" });
      mockPrisma.researchProject.create.mockResolvedValue(created);

      const result = await service.createProject("user-1", dto);

      expect(mockPrisma.researchProject.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            name: "My Research",
            icon: "🔬",
            color: "#ff0000",
          }),
        }),
      );
      expect(result).toEqual(created);
    });

    it("should use default icon and color when not provided", async () => {
      const dto: CreateStudioProjectDto = { name: "Minimal Project" };
      mockPrisma.researchProject.create.mockResolvedValue(makeProject());

      await service.createProject("user-1", dto);

      expect(mockPrisma.researchProject.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            icon: "📚",
            color: "#6366f1",
            researchType: "DEEP",
            visibility: "PRIVATE",
          }),
        }),
      );
    });

    it("should include crossModuleSource when provided", async () => {
      const dto: CreateStudioProjectDto = {
        name: "Cross-module Project",
        crossModuleSource: {
          module: "writing",
          sourceId: "src-1",
          contextTitle: "Chapter 1",
          linkedAt: new Date().toISOString(),
        },
      };
      mockPrisma.researchProject.create.mockResolvedValue(makeProject());

      await service.createProject("user-1", dto);

      expect(mockPrisma.researchProject.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            crossModuleSource: expect.objectContaining({ module: "writing" }),
          }),
        }),
      );
    });
  });

  // =========================================================================
  // getProjects
  // =========================================================================

  describe("getProjects", () => {
    it("should return paginated projects", async () => {
      const projects = [makeProject()];
      mockPrisma.researchProject.findMany.mockResolvedValue(projects);
      mockPrisma.researchProject.count.mockResolvedValue(1);

      const result = await service.getProjects("user-1");

      expect(result.data).toEqual(projects);
      expect(result.pagination).toEqual({ total: 1, take: 20, skip: 0 });
    });

    it("should apply search conditions when search is provided", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue([]);
      mockPrisma.researchProject.count.mockResolvedValue(0);

      await service.getProjects("user-1", { search: "AI" });

      expect(mockPrisma.researchProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ userId: "user-1" }),
            ]),
          }),
        }),
      );
    });

    it("should filter by researchType when provided", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue([]);
      mockPrisma.researchProject.count.mockResolvedValue(0);

      await service.getProjects("user-1", { researchType: "FAST" });

      const callArgs = mockPrisma.researchProject.findMany.mock.calls[0][0];
      expect(callArgs.where).toMatchObject({ researchType: "FAST" });
    });

    it("should respect take and skip pagination params", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue([]);
      mockPrisma.researchProject.count.mockResolvedValue(0);

      const result = await service.getProjects("user-1", {
        take: 10,
        skip: 20,
      });

      expect(mockPrisma.researchProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 20 }),
      );
      expect(result.pagination).toMatchObject({ take: 10, skip: 20 });
    });

    it("should filter by ARCHIVED status when specified", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue([]);
      mockPrisma.researchProject.count.mockResolvedValue(0);

      await service.getProjects("user-1", { status: "ARCHIVED" });

      const callArgs = mockPrisma.researchProject.findMany.mock.calls[0][0];
      expect(callArgs.where.status).toBe("ARCHIVED");
    });
  });

  // =========================================================================
  // getProject
  // =========================================================================

  describe("getProject", () => {
    it("should return the project when user is owner", async () => {
      const project = makeProject({ userId: "user-1", visibility: "PRIVATE" });
      mockPrisma.researchProject.findUnique.mockResolvedValue(project);
      mockPrisma.researchProject.update.mockResolvedValue(project);

      const result = await service.getProject("user-1", "proj-1");

      expect(result).toEqual(project);
      expect(mockPrisma.researchProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "proj-1" },
          data: expect.objectContaining({ lastAccessAt: expect.any(Date) }),
        }),
      );
    });

    it("should throw NotFoundException when project does not exist", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(null);

      await expect(service.getProject("user-1", "nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException when user is not owner and project is PRIVATE", async () => {
      const project = makeProject({
        userId: "other-user",
        visibility: "PRIVATE",
      });
      mockPrisma.researchProject.findUnique.mockResolvedValue(project);

      await expect(service.getProject("user-1", "proj-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should allow access to PUBLIC projects from non-owners", async () => {
      const project = makeProject({
        userId: "other-user",
        visibility: "PUBLIC",
      });
      mockPrisma.researchProject.findUnique.mockResolvedValue(project);

      const result = await service.getProject("user-1", "proj-1");

      expect(result).toEqual(project);
      // Should NOT update lastAccessAt for non-owners
      expect(mockPrisma.researchProject.update).not.toHaveBeenCalled();
    });

    it("should not update lastAccessAt when user is not owner", async () => {
      const project = makeProject({
        userId: "other-user",
        visibility: "PUBLIC",
      });
      mockPrisma.researchProject.findUnique.mockResolvedValue(project);

      await service.getProject("user-1", "proj-1");

      expect(mockPrisma.researchProject.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // updateProject
  // =========================================================================

  describe("updateProject", () => {
    it("should update project fields", async () => {
      const project = makeProject();
      const updated = makeProject({ name: "Updated Name" });
      mockPrisma.researchProject.findUnique.mockResolvedValue(project);
      mockPrisma.researchProject.update.mockResolvedValue(updated);

      const dto: UpdateProjectDto = { name: "Updated Name" };
      const result = await service.updateProject("user-1", "proj-1", dto);

      expect(result).toEqual(updated);
      expect(mockPrisma.researchProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "proj-1" },
          data: expect.objectContaining({ name: "Updated Name" }),
        }),
      );
    });

    it("should throw NotFoundException when project not found", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(null);

      await expect(
        service.updateProject("user-1", "proj-1", { name: "x" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user does not own project", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(
        makeProject({ userId: "other-user" }),
      );

      await expect(
        service.updateProject("user-1", "proj-1", { name: "x" }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should not include undefined fields in update data", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchProject.update.mockResolvedValue(makeProject());

      await service.updateProject("user-1", "proj-1", {
        description: "new desc",
      });

      const callData = mockPrisma.researchProject.update.mock.calls[0][0].data;
      expect(callData).not.toHaveProperty("name");
      expect(callData).toHaveProperty("description", "new desc");
    });
  });

  // =========================================================================
  // deleteProject
  // =========================================================================

  describe("deleteProject", () => {
    it("should soft-delete by setting status to DELETED", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchProject.update.mockResolvedValue(
        makeProject({ status: "DELETED" }),
      );

      await service.deleteProject("user-1", "proj-1");

      expect(mockPrisma.researchProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "DELETED" },
        }),
      );
    });

    it("should throw NotFoundException when project not found", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(null);

      await expect(service.deleteProject("user-1", "proj-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException for non-owner", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(
        makeProject({ userId: "other-user" }),
      );

      await expect(service.deleteProject("user-1", "proj-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // =========================================================================
  // archiveProject / restoreProject
  // =========================================================================

  describe("archiveProject", () => {
    it("should set status to ARCHIVED", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(makeProject());
      mockPrisma.researchProject.update.mockResolvedValue(
        makeProject({ status: "ARCHIVED" }),
      );

      await service.archiveProject("user-1", "proj-1");

      const callData = mockPrisma.researchProject.update.mock.calls[0][0].data;
      expect(callData).toMatchObject({ status: "ARCHIVED" });
    });
  });

  describe("restoreProject", () => {
    it("should set status to ACTIVE", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(
        makeProject({ status: "ARCHIVED" }),
      );
      mockPrisma.researchProject.update.mockResolvedValue(makeProject());

      await service.restoreProject("user-1", "proj-1");

      const callData = mockPrisma.researchProject.update.mock.calls[0][0].data;
      expect(callData).toMatchObject({ status: "ACTIVE" });
    });
  });

  // =========================================================================
  // sedimentToInsights
  // =========================================================================

  describe("sedimentToInsights", () => {
    const baseOutput = {
      id: "out-1",
      projectId: "proj-1",
      status: "COMPLETED",
      title: "My Research Output",
      content: "Some content text",
      project: { userId: "user-1" },
    };

    it("should throw NotFoundException when output not found", async () => {
      mockPrisma.researchProjectOutput.findFirst.mockResolvedValue(null);

      const dto: SedimentToInsightsDto = {
        outputId: "out-1",
        mode: "new_topic",
      };
      await expect(
        service.sedimentToInsights("user-1", "proj-1", dto, "token"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when output is not COMPLETED", async () => {
      mockPrisma.researchProjectOutput.findFirst.mockResolvedValue({
        ...baseOutput,
        status: "PENDING",
      });

      const dto: SedimentToInsightsDto = {
        outputId: "out-1",
        mode: "new_topic",
      };
      await expect(
        service.sedimentToInsights("user-1", "proj-1", dto, "token"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for add_dimension mode without targetTopicId", async () => {
      mockPrisma.researchProjectOutput.findFirst.mockResolvedValue(baseOutput);

      const dto: SedimentToInsightsDto = {
        outputId: "out-1",
        mode: "add_dimension",
        // targetTopicId omitted
      };
      await expect(
        service.sedimentToInsights("user-1", "proj-1", dto, "token"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should succeed for add_dimension mode with valid targetTopicId", async () => {
      mockPrisma.researchProjectOutput.findFirst.mockResolvedValue(baseOutput);

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ data: { id: "dim-1", topicId: "topic-1" } }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const dto: SedimentToInsightsDto = {
        outputId: "out-1",
        mode: "add_dimension",
        targetTopicId: "topic-1",
        dimensionName: "Custom Dim",
      };
      const result = await service.sedimentToInsights(
        "user-1",
        "proj-1",
        dto,
        "my-token",
      );

      expect(result.success).toBe(true);
      expect(result.result.mode).toBe("add_dimension");
      expect(result.result.dimensionId).toBe("dim-1");
      expect(result.result.topicId).toBe("topic-1");
    });

    it("should succeed for new_topic mode and create topic + dimension", async () => {
      mockPrisma.researchProjectOutput.findFirst.mockResolvedValue(baseOutput);

      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ data: { id: "new-topic-1" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ data: { id: "new-dim-1" } }),
        });
      global.fetch = mockFetch as unknown as typeof fetch;

      const dto: SedimentToInsightsDto = {
        outputId: "out-1",
        mode: "new_topic",
        topicName: "New Topic",
      };
      const result = await service.sedimentToInsights(
        "user-1",
        "proj-1",
        dto,
        "my-token",
      );

      expect(result.success).toBe(true);
      expect(result.result.mode).toBe("new_topic");
      expect(result.result.topicId).toBe("new-topic-1");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should throw BadRequestException when add_dimension API call fails", async () => {
      mockPrisma.researchProjectOutput.findFirst.mockResolvedValue(baseOutput);

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
      }) as unknown as typeof fetch;

      const dto: SedimentToInsightsDto = {
        outputId: "out-1",
        mode: "add_dimension",
        targetTopicId: "topic-1",
      };
      await expect(
        service.sedimentToInsights("user-1", "proj-1", dto, "token"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when create topic API call fails", async () => {
      mockPrisma.researchProjectOutput.findFirst.mockResolvedValue(baseOutput);

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        statusText: "Service Unavailable",
      }) as unknown as typeof fetch;

      const dto: SedimentToInsightsDto = {
        outputId: "out-1",
        mode: "new_topic",
      };
      await expect(
        service.sedimentToInsights("user-1", "proj-1", dto, "token"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when new topic has no ID in response", async () => {
      mockPrisma.researchProjectOutput.findFirst.mockResolvedValue(baseOutput);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: {} }), // no id
      }) as unknown as typeof fetch;

      const dto: SedimentToInsightsDto = {
        outputId: "out-1",
        mode: "new_topic",
      };
      await expect(
        service.sedimentToInsights("user-1", "proj-1", dto, "token"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should use output title as dimensionName when none is provided in add_dimension", async () => {
      mockPrisma.researchProjectOutput.findFirst.mockResolvedValue(baseOutput);

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ data: { id: "dim-1", topicId: "topic-1" } }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const dto: SedimentToInsightsDto = {
        outputId: "out-1",
        mode: "add_dimension",
        targetTopicId: "topic-1",
        // dimensionName omitted
      };
      const result = await service.sedimentToInsights(
        "user-1",
        "proj-1",
        dto,
        "token",
      );

      expect(result.result.dimensionName).toBe(baseOutput.title);
    });

    it("should use configService APP_URL for API base", async () => {
      mockConfigService.get.mockReturnValue("https://myapp.example.com");
      mockPrisma.researchProjectOutput.findFirst.mockResolvedValue(baseOutput);

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: { id: "dim-1" } }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const dto: SedimentToInsightsDto = {
        outputId: "out-1",
        mode: "add_dimension",
        targetTopicId: "topic-1",
      };
      await service.sedimentToInsights("user-1", "proj-1", dto, "token");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("https://myapp.example.com"),
        expect.any(Object),
      );
    });
  });
});
