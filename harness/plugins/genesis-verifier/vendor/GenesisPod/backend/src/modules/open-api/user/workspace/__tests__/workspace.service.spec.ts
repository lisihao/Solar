import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { TaskStatus } from "@prisma/client";
import { WorkspaceService } from "../workspace.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { CreateWorkspaceDto } from "../dto/create-workspace.dto";
import { UpdateWorkspaceResourcesDto } from "../dto/update-workspace-resources.dto";

const mockResource = {
  id: "res-1",
  title: "Test Resource",
  type: "ARTICLE",
  primaryCategory: "AI",
  tags: ["ai"],
  publishedAt: new Date("2026-01-10"),
  abstract: "Test abstract",
  aiSummary: "Test summary",
  thumbnailUrl: null,
};

const mockWorkspaceRaw = {
  id: "ws-1",
  userId: "user-1",
  status: "PENDING",
  createdAt: new Date("2026-01-20"),
  updatedAt: new Date("2026-01-20"),
  resources: [
    {
      resourceId: "res-1",
      metadata: null,
      createdAt: new Date("2026-01-20"),
      resource: mockResource,
    },
    {
      resourceId: "res-2",
      metadata: { note: "important" },
      createdAt: new Date("2026-01-20"),
      resource: { ...mockResource, id: "res-2", title: "Second Resource" },
    },
  ],
  tasks: [],
  reports: [],
};

const mockPrisma = {
  workspace: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  workspaceResource: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe("WorkspaceService", () => {
  let service: WorkspaceService;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
  });

  describe("createWorkspace", () => {
    it("creates workspace with 2+ unique resource IDs", async () => {
      const dto: CreateWorkspaceDto = {
        resourceIds: ["res-1", "res-2"],
      };
      mockPrisma.workspace.create.mockResolvedValue(mockWorkspaceRaw);

      const result = await service.createWorkspace("user-1", dto);

      expect(mockPrisma.workspace.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            resources: {
              create: [{ resourceId: "res-1" }, { resourceId: "res-2" }],
            },
          }),
        }),
      );
      expect(result.id).toBe("ws-1");
      expect(result.resourceCount).toBe(2);
    });

    it("throws BadRequestException when fewer than 2 unique resources provided", async () => {
      const dto: CreateWorkspaceDto = { resourceIds: ["res-1"] };

      await expect(service.createWorkspace("user-1", dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("deduplicates resource IDs before creating", async () => {
      const dto: CreateWorkspaceDto = {
        resourceIds: ["res-1", "res-1", "res-2"],
      };
      mockPrisma.workspace.create.mockResolvedValue(mockWorkspaceRaw);

      await service.createWorkspace("user-1", dto);

      expect(mockPrisma.workspace.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resources: {
              create: [{ resourceId: "res-1" }, { resourceId: "res-2" }],
            },
          }),
        }),
      );
    });

    it("throws BadRequestException when duplicate IDs result in fewer than 2", async () => {
      const dto: CreateWorkspaceDto = {
        resourceIds: ["res-1", "res-1"],
      };

      await expect(service.createWorkspace("user-1", dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("getWorkspace", () => {
    it("returns serialized workspace by ID without userId check", async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue(mockWorkspaceRaw);

      const result = await service.getWorkspace("ws-1");

      expect(result.id).toBe("ws-1");
      expect(result.resourceCount).toBe(2);
    });

    it("throws NotFoundException when workspace does not exist", async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue(null);

      await expect(service.getWorkspace("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when userId does not match workspace owner", async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue(mockWorkspaceRaw);

      await expect(service.getWorkspace("ws-1", "other-user")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("returns workspace when userId matches owner", async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue(mockWorkspaceRaw);

      const result = await service.getWorkspace("ws-1", "user-1");

      expect(result.id).toBe("ws-1");
    });
  });

  describe("updateWorkspaceResources", () => {
    it("adds resources via transaction with skipDuplicates", async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue({
        userId: "user-1",
      });
      mockPrisma.$transaction.mockResolvedValue([]);
      // For the final getWorkspace call
      mockPrisma.workspace.findUnique
        .mockResolvedValueOnce({ userId: "user-1" })
        .mockResolvedValueOnce(mockWorkspaceRaw);

      const dto: UpdateWorkspaceResourcesDto = {
        addResourceIds: ["res-3", "res-4"],
      };

      await service.updateWorkspaceResources("ws-1", "user-1", dto);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.workspaceResource.createMany).toHaveBeenCalledWith({
        data: [
          { workspaceId: "ws-1", resourceId: "res-3" },
          { workspaceId: "ws-1", resourceId: "res-4" },
        ],
        skipDuplicates: true,
      });
    });

    it("removes resources via transaction", async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue({ userId: "user-1" });
      mockPrisma.$transaction.mockResolvedValue([]);
      mockPrisma.workspace.findUnique
        .mockResolvedValueOnce({ userId: "user-1" })
        .mockResolvedValueOnce(mockWorkspaceRaw);

      const dto: UpdateWorkspaceResourcesDto = {
        removeResourceIds: ["res-1"],
      };

      await service.updateWorkspaceResources("ws-1", "user-1", dto);

      expect(mockPrisma.workspaceResource.deleteMany).toHaveBeenCalledWith({
        where: { workspaceId: "ws-1", resourceId: { in: ["res-1"] } },
      });
    });

    it("throws BadRequestException when neither add nor remove IDs provided", async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue({ userId: "user-1" });

      const dto: UpdateWorkspaceResourcesDto = {};

      await expect(
        service.updateWorkspaceResources("ws-1", "user-1", dto),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws ForbiddenException when user does not own workspace", async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue({ userId: "owner-id" });

      const dto: UpdateWorkspaceResourcesDto = {
        addResourceIds: ["res-3"],
      };

      await expect(
        service.updateWorkspaceResources("ws-1", "attacker", dto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("ensureWorkspaceOwnership", () => {
    it("resolves when user owns the workspace", async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue({ userId: "user-1" });

      await expect(
        service.ensureWorkspaceOwnership("ws-1", "user-1"),
      ).resolves.toBeUndefined();
    });

    it("throws NotFoundException when workspace does not exist", async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue(null);

      await expect(
        service.ensureWorkspaceOwnership("nonexistent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when user is not the owner", async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue({ userId: "owner" });

      await expect(
        service.ensureWorkspaceOwnership("ws-1", "intruder"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("serializeWorkspace", () => {
    it("serializes workspace with correct shape", () => {
      const result = service.serializeWorkspace(mockWorkspaceRaw as never);

      expect(result).toMatchObject({
        id: "ws-1",
        status: "PENDING",
        resourceCount: 2,
        resources: expect.arrayContaining([
          expect.objectContaining({
            id: "res-1",
            metadata: {},
            resource: mockResource,
          }),
        ]),
        tasks: [],
        reports: [],
      });
    });

    it("uses empty object as default when metadata is null", () => {
      const result = service.serializeWorkspace(mockWorkspaceRaw as never);

      // First resource has null metadata, should become {}
      expect(result.resources[0].metadata).toEqual({});
    });

    it("preserves non-null metadata", () => {
      const result = service.serializeWorkspace(mockWorkspaceRaw as never);

      // Second resource has { note: 'important' }
      expect(result.resources[1].metadata).toEqual({ note: "important" });
    });
  });

  describe("serializeTask", () => {
    const mockTask = {
      id: "task-1",
      workspaceId: "ws-1",
      templateId: "tpl-1",
      externalTaskId: "ext-123",
      model: "gpt-4",
      status: TaskStatus.PENDING,
      queuePosition: 1,
      estimatedTime: 30,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date("2026-01-20"),
      updatedAt: new Date("2026-01-20"),
      result: null,
      error: null,
      parameters: { depth: 3 },
      metadata: {},
    };

    it("serializes task with hasResult false when result is null", () => {
      const result = service.serializeTask(mockTask as never);

      expect(result.hasResult).toBe(false);
      expect(result.result).toBeUndefined();
    });

    it("sets hasResult true when result is present", () => {
      const taskWithResult = { ...mockTask, result: { summary: "Done" } };

      const result = service.serializeTask(taskWithResult as never);

      expect(result.hasResult).toBe(true);
    });

    it("omits result content by default (includeResult = false)", () => {
      const taskWithResult = { ...mockTask, result: { summary: "Done" } };

      const result = service.serializeTask(taskWithResult as never);

      expect(result.result).toBeUndefined();
    });

    it("includes result content when includeResult is true", () => {
      const taskWithResult = { ...mockTask, result: { summary: "Done" } };

      const result = service.serializeTask(taskWithResult as never, {
        includeResult: true,
      });

      expect(result.result).toEqual({ summary: "Done" });
    });

    it("returns null for parameters when null", () => {
      const taskNoParams = { ...mockTask, parameters: null };

      const result = service.serializeTask(taskNoParams as never);

      expect(result.parameters).toBeNull();
    });
  });

  describe("isTerminalStatus", () => {
    it("returns true for SUCCESS status", () => {
      expect(service.isTerminalStatus(TaskStatus.SUCCESS)).toBe(true);
    });

    it("returns true for FAILED status", () => {
      expect(service.isTerminalStatus(TaskStatus.FAILED)).toBe(true);
    });

    it("returns false for PENDING status", () => {
      expect(service.isTerminalStatus(TaskStatus.PENDING)).toBe(false);
    });

    it("returns false for RUNNING status", () => {
      expect(service.isTerminalStatus(TaskStatus.RUNNING)).toBe(false);
    });
  });
});
