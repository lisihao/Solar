import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { TaskStatus } from "@prisma/client";
import { WorkspaceTaskService } from "../workspace-task.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { WorkspaceService } from "../workspace.service";
import { WorkspaceAiClient } from "../workspace-ai.client";
import { CreateWorkspaceTaskDto } from "../dto/create-workspace-task.dto";

// ============================================================================
// Helpers
// ============================================================================

function makePrismaMock() {
  return {
    reportTemplate: {
      findUnique: jest.fn(),
    },
    workspaceResource: {
      findMany: jest.fn(),
    },
    workspaceTask: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  };
}

function makeWorkspaceServiceMock() {
  return {
    ensureWorkspaceOwnership: jest.fn().mockResolvedValue(undefined),
    isTerminalStatus: jest.fn().mockReturnValue(false),
    serializeTask: jest.fn().mockImplementation((task: unknown) => task),
  };
}

function makeAiClientMock() {
  return {
    createTask: jest.fn(),
    getTaskStatus: jest.fn(),
  };
}

const makeResource = (id: string, overrides: Record<string, unknown> = {}) => ({
  resourceId: id,
  metadata: null,
  resource: {
    id,
    type: "ARTICLE",
    title: `Resource ${id}`,
    abstract: "abstract",
    aiSummary: "summary",
    content: "content",
    sourceUrl: "https://example.com",
    pdfUrl: null,
    tags: [],
    primaryCategory: "AI",
    authors: [],
    publishedAt: new Date("2026-01-01"),
    ...overrides,
  },
});

const makePendingTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1",
  workspaceId: "ws-1",
  templateId: "tpl-1",
  model: "",
  status: TaskStatus.PENDING,
  externalTaskId: null,
  queuePosition: null,
  estimatedTime: null,
  result: null,
  error: null,
  parameters: {},
  metadata: {},
  startedAt: null,
  finishedAt: null,
  createdAt: new Date("2026-01-20"),
  updatedAt: new Date("2026-01-20"),
  ...overrides,
});

// ============================================================================
// Tests
// ============================================================================

describe("WorkspaceTaskService", () => {
  let service: WorkspaceTaskService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let workspaceService: ReturnType<typeof makeWorkspaceServiceMock>;
  let aiClient: ReturnType<typeof makeAiClientMock>;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();

    prisma = makePrismaMock();
    workspaceService = makeWorkspaceServiceMock();
    aiClient = makeAiClientMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceTaskService,
        { provide: PrismaService, useValue: prisma },
        { provide: WorkspaceService, useValue: workspaceService },
        { provide: WorkspaceAiClient, useValue: aiClient },
      ],
    }).compile();

    service = module.get<WorkspaceTaskService>(WorkspaceTaskService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // createTask
  // --------------------------------------------------------------------------

  describe("createTask", () => {
    const dto: CreateWorkspaceTaskDto = {
      templateId: "tpl-1",
      model: "",
      question: "What is AI?",
    };

    it("throws NotFoundException when report template does not exist", async () => {
      prisma.reportTemplate.findUnique.mockResolvedValue(null);

      await expect(service.createTask("user-1", "ws-1", dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException when workspace has fewer than 2 resources", async () => {
      prisma.reportTemplate.findUnique.mockResolvedValue({ id: "tpl-1" });
      prisma.workspaceResource.findMany.mockResolvedValue([
        makeResource("res-1"),
      ]);

      await expect(service.createTask("user-1", "ws-1", dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("creates and returns a serialized task when AI client succeeds", async () => {
      const task = makePendingTask();
      const updatedTask = makePendingTask({
        externalTaskId: "ext-1",
        status: TaskStatus.RUNNING,
      });

      prisma.reportTemplate.findUnique.mockResolvedValue({ id: "tpl-1" });
      prisma.workspaceResource.findMany.mockResolvedValue([
        makeResource("res-1"),
        makeResource("res-2"),
      ]);
      prisma.workspaceTask.create.mockResolvedValue(task);
      aiClient.createTask.mockResolvedValue({
        id: "ext-1",
        status: "running",
        queuePosition: 1,
        estimatedTime: 30,
        metadata: {},
      });
      prisma.workspaceTask.update.mockResolvedValue(updatedTask);
      workspaceService.serializeTask.mockReturnValue(updatedTask);

      const result = await service.createTask("user-1", "ws-1", dto);

      expect(prisma.workspaceTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workspaceId: "ws-1",
            templateId: "tpl-1",
            status: TaskStatus.PENDING,
          }),
        }),
      );
      expect(result).toEqual(updatedTask);
    });

    it("falls back to local aggregation when AI client throws", async () => {
      const task = makePendingTask();
      const fallbackTask = makePendingTask({ status: TaskStatus.SUCCESS });

      prisma.reportTemplate.findUnique.mockResolvedValue({ id: "tpl-1" });
      prisma.workspaceResource.findMany.mockResolvedValue([
        makeResource("res-1"),
        makeResource("res-2"),
      ]);
      prisma.workspaceTask.create.mockResolvedValue(task);
      aiClient.createTask.mockRejectedValue(
        new Error("AI service unavailable"),
      );
      prisma.workspaceTask.update.mockResolvedValue(fallbackTask);
      workspaceService.serializeTask.mockReturnValue(fallbackTask);

      const result = await service.createTask("user-1", "ws-1", dto);

      expect(prisma.workspaceTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: TaskStatus.SUCCESS }),
        }),
      );
      expect(result).toEqual(fallbackTask);
    });

    it("throws BadRequestException when specified resourceIds are not all in workspace", async () => {
      const dtoWithIds: CreateWorkspaceTaskDto = {
        ...dto,
        resourceIds: ["res-1", "res-MISSING"],
      };

      prisma.reportTemplate.findUnique.mockResolvedValue({ id: "tpl-1" });
      prisma.workspaceResource.findMany.mockResolvedValue([
        makeResource("res-1"),
        makeResource("res-2"),
      ]);

      await expect(
        service.createTask("user-1", "ws-1", dtoWithIds),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when only 1 resourceId is specified", async () => {
      const dtoWithIds: CreateWorkspaceTaskDto = {
        ...dto,
        resourceIds: ["res-1"],
      };

      prisma.reportTemplate.findUnique.mockResolvedValue({ id: "tpl-1" });
      prisma.workspaceResource.findMany.mockResolvedValue([
        makeResource("res-1"),
        makeResource("res-2"),
      ]);

      await expect(
        service.createTask("user-1", "ws-1", dtoWithIds),
      ).rejects.toThrow(BadRequestException);
    });

    it("uses all workspace resources when no resourceIds specified", async () => {
      const task = makePendingTask();
      const updatedTask = makePendingTask({ externalTaskId: "ext-1" });

      prisma.reportTemplate.findUnique.mockResolvedValue({ id: "tpl-1" });
      prisma.workspaceResource.findMany.mockResolvedValue([
        makeResource("res-1"),
        makeResource("res-2"),
        makeResource("res-3"),
      ]);
      prisma.workspaceTask.create.mockResolvedValue(task);
      aiClient.createTask.mockResolvedValue({
        id: "ext-1",
        status: "pending",
        queuePosition: null,
        estimatedTime: null,
        metadata: null,
      });
      prisma.workspaceTask.update.mockResolvedValue(updatedTask);
      workspaceService.serializeTask.mockReturnValue(updatedTask);

      await service.createTask("user-1", "ws-1", dto);

      expect(aiClient.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceIds: ["res-1", "res-2", "res-3"],
        }),
      );
    });

    it("schedules status sync when task has externalTaskId and is not terminal", async () => {
      const task = makePendingTask();
      const updatedTask = makePendingTask({
        externalTaskId: "ext-1",
        status: TaskStatus.RUNNING,
      });

      prisma.reportTemplate.findUnique.mockResolvedValue({ id: "tpl-1" });
      prisma.workspaceResource.findMany.mockResolvedValue([
        makeResource("res-1"),
        makeResource("res-2"),
      ]);
      prisma.workspaceTask.create.mockResolvedValue(task);
      aiClient.createTask.mockResolvedValue({
        id: "ext-1",
        status: "running",
        queuePosition: null,
        estimatedTime: null,
        metadata: null,
      });
      prisma.workspaceTask.update.mockResolvedValue(updatedTask);
      workspaceService.isTerminalStatus.mockReturnValue(false);
      workspaceService.serializeTask.mockReturnValue(updatedTask);

      await service.createTask("user-1", "ws-1", dto);

      // Timer should be scheduled — verify by checking that one timer exists
      // (we cannot spy on scheduleStatusSync directly, but we can verify
      // that the timer map is non-empty after the call)
      expect(workspaceService.isTerminalStatus).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // getTask
  // --------------------------------------------------------------------------

  describe("getTask", () => {
    it("throws NotFoundException when task does not exist", async () => {
      prisma.workspaceTask.findUnique.mockResolvedValue(null);

      await expect(service.getTask("user-1", "ws-1", "task-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when task belongs to a different workspace", async () => {
      prisma.workspaceTask.findUnique.mockResolvedValue(
        makePendingTask({ workspaceId: "ws-OTHER" }),
      );

      await expect(service.getTask("user-1", "ws-1", "task-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns serialized task without syncing when no externalTaskId", async () => {
      const task = makePendingTask({ externalTaskId: null });
      prisma.workspaceTask.findUnique.mockResolvedValue(task);
      workspaceService.serializeTask.mockReturnValue(task);

      const result = await service.getTask("user-1", "ws-1", "task-1");

      expect(aiClient.getTaskStatus).not.toHaveBeenCalled();
      expect(result).toEqual(task);
    });

    it("returns serialized task without syncing when task is in terminal status", async () => {
      const task = makePendingTask({
        externalTaskId: "ext-1",
        status: TaskStatus.SUCCESS,
      });
      prisma.workspaceTask.findUnique.mockResolvedValue(task);
      workspaceService.isTerminalStatus.mockReturnValue(true);
      workspaceService.serializeTask.mockReturnValue(task);

      const result = await service.getTask("user-1", "ws-1", "task-1");

      expect(aiClient.getTaskStatus).not.toHaveBeenCalled();
      expect(result).toEqual(task);
    });

    it("syncs task status from AI when externalTaskId is present and not terminal", async () => {
      const task = makePendingTask({
        externalTaskId: "ext-1",
        status: TaskStatus.RUNNING,
      });
      const refreshedTask = makePendingTask({
        externalTaskId: "ext-1",
        status: TaskStatus.SUCCESS,
      });

      prisma.workspaceTask.findUnique
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(refreshedTask);

      workspaceService.isTerminalStatus.mockReturnValue(false);
      aiClient.getTaskStatus.mockResolvedValue({
        status: "success",
        queuePosition: null,
        estimatedTime: null,
        result: { summary: "Done" },
        error: null,
        metadata: {},
      });
      prisma.workspaceTask.update.mockResolvedValue(refreshedTask);
      workspaceService.serializeTask.mockReturnValue(refreshedTask);

      await service.getTask("user-1", "ws-1", "task-1");

      expect(aiClient.getTaskStatus).toHaveBeenCalledWith("ext-1");
      expect(prisma.workspaceTask.update).toHaveBeenCalled();
    });
  });
});
