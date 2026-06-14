/**
 * ResearchTodoService Unit Tests
 *
 * Tests for TODO lifecycle management:
 * - createTodo: create a new TODO
 * - getTodos: list TODOs with filtering
 * - getTodoById: fetch single TODO
 * - getTodoDetails: fetch TODO with activities
 * - updateTodoStatus: state transitions
 * - updateTodoProgress: progress tracking
 * - completeTodo: mark as complete
 * - failTodo: mark as failed
 * - pauseTodo / resumeTodo: pause and resume
 * - cancelTodo: user cancellation
 * - retryTodo: retry failed TODOs
 * - updateTodoContent: edit content
 * - deleteTodo: delete USER_REQUEST TODOs
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { ResearchTodoService } from "../research-todo.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ResearchEventEmitterService } from "../../core/research/research-event-emitter.service";
import { LeaderReviewService } from "../../core/leader/leader-review.service";
import { ResearchTodoStatus, ResearchTodoType } from "@prisma/client";
import { TodoEventType } from "../../../types/collaboration.types";

// ============================================================
// Helpers
// ============================================================

const makeTodo = (overrides: Record<string, unknown> = {}) => ({
  id: "todo-1",
  topicId: "topic-1",
  missionId: "mission-1",
  type: ResearchTodoType.DIMENSION_RESEARCH,
  title: "Research AI Trends",
  description: "Comprehensive research on AI trends",
  dimensionId: "dim-1",
  dimensionName: "技术发展",
  agentId: "agent-1",
  agentName: "Researcher Agent",
  agentRole: "researcher",
  modelId: "gpt-4o",
  assignmentReason: "Best suited for technical research",
  priority: 1,
  dependsOn: [],
  estimatedMs: 60000,
  userCanPause: true,
  userCanCancel: true,
  userCanPrioritize: true,
  status: ResearchTodoStatus.PENDING,
  progress: 0,
  statusMessage: null,
  result: null,
  startedAt: null,
  completedAt: null,
  actualMs: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  ...overrides,
});

// ============================================================
// Mocks
// ============================================================

const mockPrisma = {
  researchTodo: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  researchAgentActivity: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  aIModel: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  researchTopic: {
    findUnique: jest.fn(),
  },
  topicDimension: {
    create: jest.fn(),
  },
  researchTask: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    findFirst: jest.fn().mockResolvedValue(null),
    update: jest.fn(),
  },
  researchMission: {
    update: jest.fn(),
  },
};

const mockEventEmitter = {
  emitTodoEvent: jest.fn().mockResolvedValue(undefined),
  emitToTopic: jest.fn().mockResolvedValue(undefined),
  emitResumeMissionExecution: jest.fn(),
};

const mockLeaderService = {
  reviewTodo: jest.fn(),
  reviewTaskResult: jest.fn().mockResolvedValue({
    taskId: "todo-1",
    status: "approved",
    feedback: "Good work",
  }),
};

// ============================================================
// Test suite
// ============================================================

describe("ResearchTodoService", () => {
  let service: ResearchTodoService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.researchTodo.create.mockResolvedValue(makeTodo());
    mockPrisma.researchTodo.findMany.mockResolvedValue([makeTodo()]);
    mockPrisma.researchTodo.findUnique.mockResolvedValue(makeTodo());
    mockPrisma.researchTodo.update.mockResolvedValue(makeTodo());
    mockPrisma.researchTodo.delete.mockResolvedValue(undefined);

    mockPrisma.researchTopic.findUnique.mockResolvedValue({
      id: "topic-1",
      name: "AI Technology",
      userId: "user-1",
    });
    mockPrisma.topicDimension.create.mockResolvedValue({
      id: "dim-new-1",
      topicId: "topic-1",
      name: "New Dimension",
    });
    mockPrisma.researchTask.findMany.mockResolvedValue([]);
    mockPrisma.researchTask.count.mockResolvedValue(0);
    mockPrisma.researchTask.create.mockResolvedValue({
      id: "task-new-1",
      missionId: "mission-1",
    });
    mockPrisma.researchTask.findFirst.mockResolvedValue(null);
    mockPrisma.researchTask.update.mockResolvedValue({});
    mockPrisma.researchMission.update.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchTodoService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ResearchEventEmitterService, useValue: mockEventEmitter },
        { provide: LeaderReviewService, useValue: mockLeaderService },
      ],
    }).compile();

    service = module.get<ResearchTodoService>(ResearchTodoService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // createTodo
  // ============================================================

  describe("createTodo", () => {
    const createInput = {
      topicId: "topic-1",
      missionId: "mission-1",
      type: ResearchTodoType.DIMENSION_RESEARCH,
      title: "Research AI Trends",
      description: "Comprehensive research",
      dimensionId: "dim-1",
      dimensionName: "技术发展",
      agentId: "agent-1",
      agentName: "Researcher",
      agentRole: "researcher",
      modelId: "gpt-4o",
    };

    it("should create a TODO with PENDING status", async () => {
      const result = await service.createTodo(createInput);

      expect(mockPrisma.researchTodo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topicId: "topic-1",
            status: ResearchTodoStatus.PENDING,
          }),
        }),
      );
      expect(result).toBeDefined();
    });

    it("should emit TODO_CREATED event after creation", async () => {
      await service.createTodo(createInput);

      expect(mockEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        TodoEventType.TODO_CREATED,
        expect.objectContaining({ todo: expect.any(Object) }),
      );
    });

    it("should set default priority to 0 when not provided", async () => {
      await service.createTodo(createInput);

      expect(mockPrisma.researchTodo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: 0 }),
        }),
      );
    });

    it("should set userCanPause, userCanCancel defaults to true", async () => {
      await service.createTodo(createInput);

      expect(mockPrisma.researchTodo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userCanPause: true,
            userCanCancel: true,
          }),
        }),
      );
    });

    it("should persist modelId and assignmentReason", async () => {
      const inputWithExtras = {
        ...createInput,
        modelId: "claude-3-opus",
        assignmentReason: "Best for complex research",
      };

      await service.createTodo(inputWithExtras);

      expect(mockPrisma.researchTodo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            modelId: "claude-3-opus",
            assignmentReason: "Best for complex research",
          }),
        }),
      );
    });
  });

  // ============================================================
  // getTodos
  // ============================================================

  describe("getTodos", () => {
    it("should return todos with summary", async () => {
      const todos = [
        makeTodo({ status: ResearchTodoStatus.COMPLETED }),
        makeTodo({ id: "todo-2", status: ResearchTodoStatus.PENDING }),
      ];
      mockPrisma.researchTodo.findMany.mockResolvedValueOnce(todos);

      const result = await service.getTodos("topic-1");

      expect(result.todos).toBeDefined();
      expect(result.summary).toBeDefined();
    });

    it("should filter by missionId when provided", async () => {
      await service.getTodos("topic-1", { missionId: "mission-1" });

      expect(mockPrisma.researchTodo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ missionId: "mission-1" }),
        }),
      );
    });

    it("should filter by status when provided", async () => {
      await service.getTodos("topic-1", {
        status: [ResearchTodoStatus.PENDING, ResearchTodoStatus.IN_PROGRESS],
      });

      expect(mockPrisma.researchTodo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: {
              in: [ResearchTodoStatus.PENDING, ResearchTodoStatus.IN_PROGRESS],
            },
          }),
        }),
      );
    });

    it("should filter by type when provided", async () => {
      await service.getTodos("topic-1", {
        type: [ResearchTodoType.DIMENSION_RESEARCH],
      });

      expect(mockPrisma.researchTodo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: { in: [ResearchTodoType.DIMENSION_RESEARCH] },
          }),
        }),
      );
    });

    it("should include modelDisplayName for todos with modelId", async () => {
      const todoWithModel = makeTodo({ modelId: "gpt-4o" });
      mockPrisma.researchTodo.findMany.mockResolvedValueOnce([todoWithModel]);
      mockPrisma.aIModel.findMany.mockResolvedValueOnce([
        { modelId: "gpt-4o", displayName: "GPT-4o" },
      ]);

      const result = await service.getTodos("topic-1");

      expect(result.todos).toHaveLength(1);
    });
  });

  // ============================================================
  // getTodoById
  // ============================================================

  describe("getTodoById", () => {
    it("should return a TODO by ID", async () => {
      const todo = makeTodo();
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);

      const result = await service.getTodoById("todo-1");

      expect(result.id).toBe("todo-1");
    });

    it("should throw NotFoundException when TODO not found", async () => {
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(null);

      await expect(service.getTodoById("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================================================
  // getTodoDetails
  // ============================================================

  describe("getTodoDetails", () => {
    it("should return empty activities for USER_REQUEST type", async () => {
      const userRequestTodo = makeTodo({ type: "USER_REQUEST" });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(userRequestTodo);

      const result = await service.getTodoDetails("todo-1");

      expect(result.activities).toEqual([]);
    });

    it("should return activities for dimension research TODOs", async () => {
      const dimTodo = makeTodo({ dimensionId: "dim-1" });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(dimTodo);

      const activities = [{ id: "activity-1", content: "Searching..." }];
      mockPrisma.researchAgentActivity.findMany.mockResolvedValueOnce(
        activities,
      );

      const result = await service.getTodoDetails("todo-1");

      expect(result.activities).toEqual(activities);
    });

    it("should return empty activities when no dimensionId and no agentId", async () => {
      const todo = makeTodo({ dimensionId: null, agentId: null });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);

      const result = await service.getTodoDetails("todo-1");

      expect(result.activities).toEqual([]);
    });
  });

  // ============================================================
  // updateTodoStatus
  // ============================================================

  describe("updateTodoStatus", () => {
    it("should update status from QUEUED to IN_PROGRESS", async () => {
      const queuedTodo = makeTodo({ status: ResearchTodoStatus.QUEUED });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(queuedTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({
          status: ResearchTodoStatus.IN_PROGRESS,
          startedAt: new Date(),
        }),
      );

      const result = await service.updateTodoStatus(
        "todo-1",
        ResearchTodoStatus.IN_PROGRESS,
      );

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchTodoStatus.IN_PROGRESS,
          }),
        }),
      );
      expect(result).toBeDefined();
    });

    it("should set startedAt when transitioning to IN_PROGRESS", async () => {
      const queuedTodo = makeTodo({
        status: ResearchTodoStatus.QUEUED,
        startedAt: null,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(queuedTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.IN_PROGRESS }),
      );

      await service.updateTodoStatus("todo-1", ResearchTodoStatus.IN_PROGRESS);

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ startedAt: expect.any(Date) }),
        }),
      );
    });

    it("should set completedAt when transitioning to COMPLETED", async () => {
      const inProgressTodo = makeTodo({
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 5000),
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(inProgressTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.COMPLETED }),
      );

      await service.updateTodoStatus("todo-1", ResearchTodoStatus.COMPLETED);

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ completedAt: expect.any(Date) }),
        }),
      );
    });

    it("should emit TODO_STATUS_CHANGED event", async () => {
      const pendingTodo = makeTodo({ status: ResearchTodoStatus.PENDING });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(pendingTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.QUEUED }),
      );

      await service.updateTodoStatus("todo-1", ResearchTodoStatus.QUEUED);

      expect(mockEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        TodoEventType.TODO_STATUS_CHANGED,
        expect.objectContaining({ oldStatus: ResearchTodoStatus.PENDING }),
      );
    });

    it("should include optional message in update", async () => {
      const todo = makeTodo({ status: ResearchTodoStatus.QUEUED });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.IN_PROGRESS }),
      );

      await service.updateTodoStatus(
        "todo-1",
        ResearchTodoStatus.IN_PROGRESS,
        "Starting now",
      );

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statusMessage: "Starting now" }),
        }),
      );
    });
  });

  // ============================================================
  // updateTodoProgress
  // ============================================================

  describe("updateTodoProgress", () => {
    it("should update progress for IN_PROGRESS TODO", async () => {
      const inProgressTodo = makeTodo({
        status: ResearchTodoStatus.IN_PROGRESS,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(inProgressTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.IN_PROGRESS, progress: 50 }),
      );

      const result = await service.updateTodoProgress("todo-1", {
        progress: 50,
        statusMessage: "Halfway done",
      });

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ progress: 50 }),
        }),
      );
      expect(result).toBeDefined();
    });

    it("should throw BadRequestException for non-IN_PROGRESS TODO", async () => {
      const pendingTodo = makeTodo({ status: ResearchTodoStatus.PENDING });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(pendingTodo);

      await expect(
        service.updateTodoProgress("todo-1", { progress: 50 }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should cap progress at 100", async () => {
      const inProgressTodo = makeTodo({
        status: ResearchTodoStatus.IN_PROGRESS,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(inProgressTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.IN_PROGRESS, progress: 100 }),
      );

      await service.updateTodoProgress("todo-1", { progress: 150 });

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ progress: 100 }),
        }),
      );
    });

    it("should floor progress at 0", async () => {
      const inProgressTodo = makeTodo({
        status: ResearchTodoStatus.IN_PROGRESS,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(inProgressTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ progress: 0 }),
      );

      await service.updateTodoProgress("todo-1", { progress: -10 });

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ progress: 0 }),
        }),
      );
    });
  });

  // ============================================================
  // completeTodo
  // ============================================================

  describe("completeTodo", () => {
    it("should mark TODO as COMPLETED with progress=100", async () => {
      const inProgressTodo = makeTodo({
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 10000),
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(inProgressTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.COMPLETED, progress: 100 }),
      );

      await service.completeTodo("todo-1");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchTodoStatus.COMPLETED,
            progress: 100,
          }),
        }),
      );
    });

    it("should store result when provided", async () => {
      const todo = makeTodo({ status: ResearchTodoStatus.IN_PROGRESS });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.COMPLETED }),
      );

      const result = { summary: "Research complete", wordCount: 2500 };
      await service.completeTodo("todo-1", result);

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ result }),
        }),
      );
    });

    it("should emit TODO_COMPLETED event", async () => {
      const todo = makeTodo({ status: ResearchTodoStatus.IN_PROGRESS });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.COMPLETED }),
      );

      await service.completeTodo("todo-1");

      expect(mockEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        TodoEventType.TODO_COMPLETED,
        expect.objectContaining({ todoId: "todo-1" }),
      );
    });
  });

  // ============================================================
  // failTodo
  // ============================================================

  describe("failTodo", () => {
    it("should mark TODO as FAILED with error", async () => {
      const todo = makeTodo({ status: ResearchTodoStatus.IN_PROGRESS });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.FAILED }),
      );

      await service.failTodo("todo-1", "AI service unavailable");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchTodoStatus.FAILED,
            result: { error: "AI service unavailable" },
          }),
        }),
      );
    });

    it("should emit TODO_FAILED event", async () => {
      const todo = makeTodo({ status: ResearchTodoStatus.IN_PROGRESS });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.FAILED }),
      );

      await service.failTodo("todo-1", "Error occurred");

      expect(mockEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        TodoEventType.TODO_FAILED,
        expect.objectContaining({ todoId: "todo-1", error: "Error occurred" }),
      );
    });
  });

  // ============================================================
  // pauseTodo
  // ============================================================

  describe("pauseTodo", () => {
    it("should pause an IN_PROGRESS TODO", async () => {
      const inProgressTodo = makeTodo({
        status: ResearchTodoStatus.IN_PROGRESS,
        userCanPause: true,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(inProgressTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.PAUSED }),
      );

      await service.pauseTodo("todo-1");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ResearchTodoStatus.PAUSED }),
        }),
      );
    });

    it("should throw BadRequestException when TODO cannot be paused", async () => {
      const todo = makeTodo({
        status: ResearchTodoStatus.IN_PROGRESS,
        userCanPause: false,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);

      await expect(service.pauseTodo("todo-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException when TODO is not IN_PROGRESS", async () => {
      const todo = makeTodo({
        status: ResearchTodoStatus.PENDING,
        userCanPause: true,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);

      await expect(service.pauseTodo("todo-1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================================
  // resumeTodo
  // ============================================================

  describe("resumeTodo", () => {
    it("should resume a PAUSED TODO", async () => {
      const pausedTodo = makeTodo({ status: ResearchTodoStatus.PAUSED });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(pausedTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.IN_PROGRESS }),
      );

      await service.resumeTodo("todo-1");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchTodoStatus.IN_PROGRESS,
          }),
        }),
      );
    });

    it("should throw BadRequestException when TODO is not PAUSED", async () => {
      const todo = makeTodo({ status: ResearchTodoStatus.PENDING });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);

      await expect(service.resumeTodo("todo-1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================================
  // cancelTodo
  // ============================================================

  describe("cancelTodo", () => {
    it("should cancel a PENDING TODO", async () => {
      const pendingTodo = makeTodo({
        status: ResearchTodoStatus.PENDING,
        userCanCancel: true,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(pendingTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.CANCELLED }),
      );

      await service.cancelTodo("todo-1", "User cancelled");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchTodoStatus.CANCELLED,
          }),
        }),
      );
    });

    it("should cancel a QUEUED TODO", async () => {
      const queuedTodo = makeTodo({
        status: ResearchTodoStatus.QUEUED,
        userCanCancel: true,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(queuedTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.CANCELLED }),
      );

      await service.cancelTodo("todo-1");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchTodoStatus.CANCELLED,
          }),
        }),
      );
    });

    it("should throw BadRequestException when TODO cannot be cancelled", async () => {
      const todo = makeTodo({
        status: ResearchTodoStatus.PENDING,
        userCanCancel: false,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);

      await expect(service.cancelTodo("todo-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException when TODO is IN_PROGRESS", async () => {
      const todo = makeTodo({
        status: ResearchTodoStatus.IN_PROGRESS,
        userCanCancel: true,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);

      await expect(service.cancelTodo("todo-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should use provided reason in statusMessage", async () => {
      const todo = makeTodo({
        status: ResearchTodoStatus.PENDING,
        userCanCancel: true,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(makeTodo());

      await service.cancelTodo("todo-1", "Changed priorities");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            statusMessage: "Changed priorities",
          }),
        }),
      );
    });
  });

  // ============================================================
  // retryTodo
  // ============================================================

  describe("retryTodo", () => {
    it("should reset a FAILED TODO to QUEUED status", async () => {
      const failedTodo = makeTodo({ status: ResearchTodoStatus.FAILED });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(failedTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.QUEUED }),
      );

      await service.retryTodo("todo-1");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchTodoStatus.QUEUED,
            progress: 0,
            startedAt: null,
            completedAt: null,
          }),
        }),
      );
    });

    it("should throw BadRequestException when TODO is not FAILED", async () => {
      const todo = makeTodo({ status: ResearchTodoStatus.PENDING });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);

      await expect(service.retryTodo("todo-1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================================
  // updateTodoContent
  // ============================================================

  describe("updateTodoContent", () => {
    it("should update title and description for USER_REQUEST PENDING TODO", async () => {
      const userRequestTodo = makeTodo({
        type: "USER_REQUEST",
        status: ResearchTodoStatus.PENDING,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(userRequestTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(userRequestTodo);

      await service.updateTodoContent("todo-1", {
        title: "Updated Title",
        description: "Updated description",
      });

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: "Updated Title" }),
        }),
      );
    });

    it("should throw BadRequestException for non-USER_REQUEST type", async () => {
      const dimTodo = makeTodo({
        type: ResearchTodoType.DIMENSION_RESEARCH,
        status: ResearchTodoStatus.PENDING,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(dimTodo);

      await expect(
        service.updateTodoContent("todo-1", { title: "New title" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for non-PENDING status", async () => {
      const inProgressUserRequest = makeTodo({
        type: "USER_REQUEST",
        status: ResearchTodoStatus.IN_PROGRESS,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(
        inProgressUserRequest,
      );

      await expect(
        service.updateTodoContent("todo-1", { title: "New title" }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================================
  // deleteTodo
  // ============================================================

  describe("deleteTodo", () => {
    it("should delete a USER_REQUEST PENDING TODO", async () => {
      const userRequestTodo = makeTodo({
        type: "USER_REQUEST",
        status: ResearchTodoStatus.PENDING,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(userRequestTodo);

      await service.deleteTodo("todo-1");

      expect(mockPrisma.researchTodo.delete).toHaveBeenCalledWith({
        where: { id: "todo-1" },
      });
    });

    it("should throw BadRequestException when deleting non-USER_REQUEST type", async () => {
      const dimTodo = makeTodo({
        type: ResearchTodoType.DIMENSION_RESEARCH,
        status: ResearchTodoStatus.PENDING,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(dimTodo);

      await expect(service.deleteTodo("todo-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException when deleting non-PENDING TODO", async () => {
      const inProgressUserRequest = makeTodo({
        type: "USER_REQUEST",
        status: ResearchTodoStatus.IN_PROGRESS,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(
        inProgressUserRequest,
      );

      await expect(service.deleteTodo("todo-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should emit deletion event after deleting", async () => {
      const userRequestTodo = makeTodo({
        type: "USER_REQUEST",
        status: ResearchTodoStatus.PENDING,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(userRequestTodo);

      await service.deleteTodo("todo-1");

      expect(mockEventEmitter.emitToTopic).toHaveBeenCalled();
    });
  });

  // ============================================================
  // prioritizeTodo
  // ============================================================

  describe("prioritizeTodo", () => {
    it('should set priority to 100 for "high"', async () => {
      const todo = makeTodo({ userCanPrioritize: true });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ priority: 100 }),
      );

      await service.prioritizeTodo("todo-1", "high");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: 100 }),
        }),
      );
    });

    it('should set priority to 0 for "normal"', async () => {
      const todo = makeTodo({ userCanPrioritize: true });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ priority: 0 }),
      );

      await service.prioritizeTodo("todo-1", "normal");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: 0 }),
        }),
      );
    });

    it('should set priority to -100 for "low"', async () => {
      const todo = makeTodo({ userCanPrioritize: true });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ priority: -100 }),
      );

      await service.prioritizeTodo("todo-1", "low");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: -100 }),
        }),
      );
    });

    it("should throw BadRequestException when userCanPrioritize is false", async () => {
      const todo = makeTodo({ userCanPrioritize: false });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);

      await expect(service.prioritizeTodo("todo-1", "high")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================================
  // cancelTodo — PAUSED state
  // ============================================================

  describe("cancelTodo — PAUSED state", () => {
    it("should cancel a PAUSED TODO", async () => {
      const pausedTodo = makeTodo({
        status: ResearchTodoStatus.PAUSED,
        userCanCancel: true,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(pausedTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.CANCELLED }),
      );

      await service.cancelTodo("todo-1", "No longer needed");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchTodoStatus.CANCELLED,
          }),
        }),
      );
    });

    it('should use default "用户已取消" message when no reason provided', async () => {
      const pendingTodo = makeTodo({
        status: ResearchTodoStatus.PENDING,
        userCanCancel: true,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(pendingTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(makeTodo());

      await service.cancelTodo("todo-1");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statusMessage: "用户已取消" }),
        }),
      );
    });
  });

  // ============================================================
  // checkDependencies
  // ============================================================

  describe("checkDependencies", () => {
    it("should return true when todo has no dependencies", async () => {
      const todo = makeTodo({ dependsOn: [] });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);

      const result = await service.checkDependencies("todo-1");

      expect(result).toBe(true);
    });

    it("should return true when all dependencies are completed", async () => {
      const todo = makeTodo({ dependsOn: ["dep-1", "dep-2"] });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      mockPrisma.researchTodo.count = jest.fn().mockResolvedValue(2);

      const result = await service.checkDependencies("todo-1");

      expect(result).toBe(true);
    });

    it("should return false when some dependencies are not completed", async () => {
      const todo = makeTodo({ dependsOn: ["dep-1", "dep-2"] });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      mockPrisma.researchTodo.count = jest.fn().mockResolvedValue(1);

      const result = await service.checkDependencies("todo-1");

      expect(result).toBe(false);
    });
  });

  // ============================================================
  // createUserRequestTodo
  // ============================================================

  describe("createUserRequestTodo", () => {
    it("should create a USER_REQUEST type todo", async () => {
      mockPrisma.researchTodo.create.mockResolvedValueOnce(
        makeTodo({ type: ResearchTodoType.USER_REQUEST }),
      );

      const result = await service.createUserRequestTodo(
        "topic-1",
        "mission-1",
        "Research quantum computing applications",
        "Please provide detailed analysis",
      );

      expect(mockPrisma.researchTodo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: ResearchTodoType.USER_REQUEST,
            topicId: "topic-1",
            missionId: "mission-1",
            title: "Research quantum computing applications",
            agentId: "leader",
            priority: 800,
          }),
        }),
      );
      expect(result).toBeDefined();
    });

    it("should create USER_REQUEST without description", async () => {
      mockPrisma.researchTodo.create.mockResolvedValueOnce(
        makeTodo({ type: ResearchTodoType.USER_REQUEST }),
      );

      await service.createUserRequestTodo(
        "topic-1",
        "mission-1",
        "Simple request",
      );

      expect(mockPrisma.researchTodo.create).toHaveBeenCalled();
    });
  });

  // ============================================================
  // getNextExecutableTodo
  // ============================================================

  describe("getNextExecutableTodo", () => {
    it("should return null when no pending todos", async () => {
      // When pendingTodos is empty, the function returns null immediately
      // without making the second findMany call for completedTodos
      mockPrisma.researchTodo.findMany.mockResolvedValueOnce([]);

      const result = await service.getNextExecutableTodo("mission-1");

      expect(result).toBeNull();
    });

    it("should return the first todo with all dependencies completed", async () => {
      const completedTodo = makeTodo({
        id: "done-1",
        status: ResearchTodoStatus.COMPLETED,
      });
      const nextTodo = makeTodo({
        id: "todo-2",
        status: ResearchTodoStatus.PENDING,
        dependsOn: ["done-1"],
      });

      mockPrisma.researchTodo.findMany
        .mockResolvedValueOnce([nextTodo]) // pending todos
        .mockResolvedValueOnce([completedTodo]); // completed todos

      const result = await service.getNextExecutableTodo("mission-1");

      expect(result?.id).toBe("todo-2");
    });

    it("should return null when pending todo has unmet dependencies", async () => {
      const pendingTodo = makeTodo({
        id: "todo-blocked",
        status: ResearchTodoStatus.PENDING,
        dependsOn: ["dep-missing"],
      });

      mockPrisma.researchTodo.findMany
        .mockResolvedValueOnce([pendingTodo]) // pending todos
        .mockResolvedValueOnce([]); // no completed todos

      const result = await service.getNextExecutableTodo("mission-1");

      expect(result).toBeNull();
    });

    it("should return todo with no dependencies immediately", async () => {
      const noDependencyTodo = makeTodo({ id: "todo-free", dependsOn: [] });

      mockPrisma.researchTodo.findMany
        .mockResolvedValueOnce([noDependencyTodo]) // pending todos
        .mockResolvedValueOnce([]); // completed todos

      const result = await service.getNextExecutableTodo("mission-1");

      expect(result?.id).toBe("todo-free");
    });
  });

  // ============================================================
  // scheduleTodo
  // ============================================================

  describe("scheduleTodo", () => {
    it("should throw NotFoundException when todo does not exist", async () => {
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.scheduleTodo("topic-1", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should skip scheduling when TODO is not PENDING", async () => {
      const inProgressTodo = makeTodo({
        status: ResearchTodoStatus.IN_PROGRESS,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(inProgressTodo);

      await service.scheduleTodo("topic-1", "todo-1");

      // Should not call update
      expect(mockPrisma.researchTodo.update).not.toHaveBeenCalled();
    });

    it("should update status to QUEUED when scheduling a PENDING TODO", async () => {
      const pendingTodo = makeTodo({ status: ResearchTodoStatus.PENDING });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(pendingTodo);
      mockPrisma.researchTodo.count = jest.fn().mockResolvedValue(0); // no running tasks
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.QUEUED }),
      );
      // For executeTodo call (fire-and-forget)
      mockPrisma.researchTodo.findUnique.mockResolvedValue(null);

      await service.scheduleTodo("topic-1", "todo-1");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ResearchTodoStatus.QUEUED }),
        }),
      );
    });

    it("should include queue position in status message when tasks are running", async () => {
      const pendingTodo = makeTodo({ status: ResearchTodoStatus.PENDING });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(pendingTodo);
      mockPrisma.researchTodo.count = jest.fn().mockResolvedValue(2); // 2 running tasks
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.QUEUED }),
      );

      await service.scheduleTodo("topic-1", "todo-1");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            statusMessage: expect.stringContaining("2"),
          }),
        }),
      );
    });
  });

  // ============================================================
  // processNextQueuedTodo
  // ============================================================

  describe("processNextQueuedTodo", () => {
    it("should skip processing when tasks are still running", async () => {
      mockPrisma.researchTodo.count = jest.fn().mockResolvedValue(1); // 1 running

      await service.processNextQueuedTodo("topic-1");

      expect(mockPrisma.researchTodo.findFirst).not.toBeDefined();
    });

    it("should do nothing when no queued tasks exist", async () => {
      mockPrisma.researchTodo.count = jest.fn().mockResolvedValue(0); // no running
      mockPrisma.researchTodo.findFirst = jest.fn().mockResolvedValue(null);

      await service.processNextQueuedTodo("topic-1");

      // Should not throw
      expect(mockPrisma.researchTodo.findFirst).toHaveBeenCalled();
    });

    it("should start execution of next queued todo", async () => {
      const queuedTodo = makeTodo({
        id: "queued-todo",
        status: ResearchTodoStatus.QUEUED,
      });
      mockPrisma.researchTodo.count = jest.fn().mockResolvedValue(0);
      mockPrisma.researchTodo.findFirst = jest
        .fn()
        .mockResolvedValue(queuedTodo);

      // For executeTodo call — set up mock chain
      mockPrisma.researchTodo.findUnique.mockResolvedValue(null); // todo not found in executeTodo → will throw but fire-and-forget

      await service.processNextQueuedTodo("topic-1");

      expect(mockPrisma.researchTodo.findFirst).toHaveBeenCalled();
    });
  });

  // ============================================================
  // generateTodosFromMission
  // ============================================================

  describe("generateTodosFromMission", () => {
    const makeMission = (overrides: Record<string, unknown> = {}) => ({
      id: "mission-1",
      topicId: "topic-1",
      status: "ACTIVE",
      ...overrides,
    });

    beforeEach(() => {
      // Reset create to return sequentially different todos
      let createCount = 0;
      mockPrisma.researchTodo.create.mockImplementation(() => {
        createCount++;
        return Promise.resolve(makeTodo({ id: `todo-${createCount}` }));
      });
      // For completeTodo call inside generateTodosFromMission
      mockPrisma.researchTodo.update.mockResolvedValue(
        makeTodo({ status: ResearchTodoStatus.COMPLETED, progress: 100 }),
      );
    });

    it("should generate leader, dimension, report, and review TODOs", async () => {
      const mission = makeMission();
      const leaderPlan = {
        dimensions: [
          { id: "dim-1", name: "技术", description: "技术分析" },
          { id: "dim-2", name: "市场", description: "市场分析" },
        ],
        agentAssignments: [],
      };

      const todos = await service.generateTodosFromMission(
        mission as any,
        leaderPlan,
      );

      // leader + 2 dimension + report + review = 5
      expect(todos).toHaveLength(5);
    });

    it("should generate at least leader, report, review TODOs with no dimensions", async () => {
      const mission = makeMission();
      const leaderPlan = { dimensions: [], agentAssignments: [] };

      const todos = await service.generateTodosFromMission(
        mission as any,
        leaderPlan,
      );

      // leader + report + review = 3
      expect(todos).toHaveLength(3);
    });

    it("should map agent assignment modelId to dimension TODO", async () => {
      const mission = makeMission();
      const leaderPlan = {
        dimensions: [{ id: "dim-1", name: "技术" }],
        agentAssignments: [
          {
            agentType: "dimension_researcher",
            assignedDimensions: ["dim-1"],
            agentId: "agent-x",
            agentName: "技术研究员",
            modelId: "claude-3-opus",
            assignmentReason: {
              agentReason: "专长技术",
              modelReason: "强模型",
            },
          },
        ],
      };

      await service.generateTodosFromMission(mission as any, leaderPlan);

      // The dimension todo create call should include modelId
      const dimensionCreateCall = mockPrisma.researchTodo.create.mock.calls[1]; // 0=leader, 1=dimension
      expect(dimensionCreateCall[0].data.modelId).toBe("claude-3-opus");
    });

    it("should use fallback agentId when no assignment found", async () => {
      const mission = makeMission();
      const leaderPlan = {
        dimensions: [{ id: "dim-1", name: "经济" }],
        agentAssignments: [], // No assignments
      };

      await service.generateTodosFromMission(mission as any, leaderPlan);

      const dimensionCreateCall = mockPrisma.researchTodo.create.mock.calls[1];
      expect(dimensionCreateCall[0].data.agentId).toBe("researcher-1");
    });

    it("should use dimensionName field if name not set on dimension", async () => {
      const mission = makeMission();
      const leaderPlan = {
        dimensions: [{ dimensionId: "dim-1", dimensionName: "政策分析" }],
        agentAssignments: [],
      };

      await service.generateTodosFromMission(mission as any, leaderPlan);

      const dimensionCreateCall = mockPrisma.researchTodo.create.mock.calls[1];
      expect(dimensionCreateCall[0].data.dimensionName).toBe("政策分析");
    });

    it("should handle undefined leaderPlan.dimensions gracefully", async () => {
      const mission = makeMission();
      const leaderPlan = {}; // No dimensions or agentAssignments

      const todos = await service.generateTodosFromMission(
        mission as any,
        leaderPlan as any,
      );

      // leader + report + review = 3
      expect(todos).toHaveLength(3);
    });
  });

  // ============================================================
  // updateTodoStatus — FAILED and CANCELLED terminal states
  // ============================================================

  describe("updateTodoStatus — terminal state transitions", () => {
    it("should set completedAt when transitioning to FAILED", async () => {
      const inProgressTodo = makeTodo({
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 5000),
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(inProgressTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.FAILED }),
      );

      await service.updateTodoStatus("todo-1", ResearchTodoStatus.FAILED);

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ completedAt: expect.any(Date) }),
        }),
      );
    });

    it("should throw BadRequestException for invalid status transition (PENDING to COMPLETED)", async () => {
      const pendingTodo = makeTodo({ status: ResearchTodoStatus.PENDING });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(pendingTodo);

      await expect(
        service.updateTodoStatus("todo-1", ResearchTodoStatus.COMPLETED),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for invalid transition (COMPLETED to PENDING)", async () => {
      const completedTodo = makeTodo({ status: ResearchTodoStatus.COMPLETED });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(completedTodo);

      await expect(
        service.updateTodoStatus("todo-1", ResearchTodoStatus.PENDING),
      ).rejects.toThrow(BadRequestException);
    });

    it("should NOT set startedAt when already set for IN_PROGRESS transition", async () => {
      const existingStartedAt = new Date(Date.now() - 10000);
      const queuedTodo = makeTodo({
        status: ResearchTodoStatus.QUEUED,
        startedAt: existingStartedAt,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(queuedTodo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.IN_PROGRESS }),
      );

      await service.updateTodoStatus("todo-1", ResearchTodoStatus.IN_PROGRESS);

      const updateCall = mockPrisma.researchTodo.update.mock.calls[0][0];
      // startedAt should NOT be in update data since it was already set
      expect(updateCall.data.startedAt).toBeUndefined();
    });
  });

  // ============================================================
  // getTodos — summary calculation
  // ============================================================

  describe("getTodos — summary calculation", () => {
    it("should correctly count all status categories in summary", async () => {
      const todos = [
        makeTodo({ id: "t1", status: ResearchTodoStatus.PENDING }),
        makeTodo({ id: "t2", status: ResearchTodoStatus.QUEUED }),
        makeTodo({
          id: "t3",
          status: ResearchTodoStatus.IN_PROGRESS,
          progress: 50,
        }),
        makeTodo({ id: "t4", status: ResearchTodoStatus.PAUSED, progress: 30 }),
        makeTodo({ id: "t5", status: ResearchTodoStatus.COMPLETED }),
        makeTodo({ id: "t6", status: ResearchTodoStatus.FAILED }),
        makeTodo({ id: "t7", status: ResearchTodoStatus.CANCELLED }),
      ];
      mockPrisma.researchTodo.findMany.mockResolvedValueOnce(todos);

      const result = await service.getTodos("topic-1");

      expect(result.summary.pending).toBe(1);
      expect(result.summary.queued).toBe(1);
      expect(result.summary.inProgress).toBe(1);
      expect(result.summary.paused).toBe(1);
      expect(result.summary.completed).toBe(1);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.cancelled).toBe(1);
      expect(result.summary.total).toBe(7);
    });

    it("should calculate overallProgress based on completed and in-progress todos", async () => {
      const todos = [
        makeTodo({ id: "t1", status: ResearchTodoStatus.COMPLETED }),
        makeTodo({
          id: "t2",
          status: ResearchTodoStatus.IN_PROGRESS,
          progress: 60,
        }),
      ];
      mockPrisma.researchTodo.findMany.mockResolvedValueOnce(todos);

      const result = await service.getTodos("topic-1");

      // (100 + 60) / 2 active items = 80
      expect(result.summary.overallProgress).toBe(80);
    });

    it("should return 0 overallProgress when only failed/cancelled todos", async () => {
      const todos = [
        makeTodo({ id: "t1", status: ResearchTodoStatus.FAILED }),
        makeTodo({ id: "t2", status: ResearchTodoStatus.CANCELLED }),
      ];
      mockPrisma.researchTodo.findMany.mockResolvedValueOnce(todos);

      const result = await service.getTodos("topic-1");

      expect(result.summary.overallProgress).toBe(0);
    });
  });

  // ============================================================
  // getTodoById — with modelId lookup
  // ============================================================

  describe("getTodoById — model display name", () => {
    it("should return todo without modelDisplayName when modelId is null", async () => {
      const todo = makeTodo({ modelId: null });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);

      const result = await service.getTodoById("todo-1");

      expect(result.id).toBe("todo-1");
    });

    it("should enrich todo with modelDisplayName when modelId exists", async () => {
      const todo = makeTodo({ modelId: "claude-3-opus" });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      mockPrisma.aIModel.findMany.mockResolvedValueOnce([
        { modelId: "claude-3-opus", displayName: "Claude 3 Opus" },
      ]);

      const result = await service.getTodoById("todo-1");

      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // getTodoDetails — agentId fallback (no dimensionId)
  // ============================================================

  describe("getTodoDetails — agentId filter", () => {
    it("should filter activities by agentId when no dimensionId exists", async () => {
      const todo = makeTodo({ dimensionId: null, agentId: "agent-x" });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);

      const activities = [
        { id: "act-1", agentId: "agent-x", content: "Searching..." },
      ];
      mockPrisma.researchAgentActivity.findMany.mockResolvedValueOnce(
        activities,
      );

      const result = await service.getTodoDetails("todo-1");

      expect(result.activities).toEqual(activities);
      expect(mockPrisma.researchAgentActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ agentId: "agent-x" }),
        }),
      );
    });
  });

  // ============================================================
  // completeTodo — null startedAt
  // ============================================================

  describe("completeTodo — null startedAt", () => {
    it("should set actualMs to null when startedAt is null", async () => {
      const todo = makeTodo({
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: null,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.COMPLETED }),
      );

      await service.completeTodo("todo-1");

      expect(mockPrisma.researchTodo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actualMs: null }),
        }),
      );
    });

    it("should calculate actualMs when startedAt is set", async () => {
      const startedAt = new Date(Date.now() - 30000); // 30 sec ago
      const todo = makeTodo({
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ status: ResearchTodoStatus.COMPLETED }),
      );

      await service.completeTodo("todo-1");

      const updateCall = mockPrisma.researchTodo.update.mock.calls[0][0];
      expect(typeof updateCall.data.actualMs).toBe("number");
      expect(updateCall.data.actualMs).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // executeTodo — full flow coverage
  // ============================================================

  describe("executeTodo", () => {
    it("should throw NotFoundException when todo does not exist", async () => {
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.executeTodo("topic-1", "nonexistent-todo"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when todo type is not USER_REQUEST", async () => {
      const todo = makeTodo({ type: ResearchTodoType.DIMENSION_RESEARCH });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);

      await expect(service.executeTodo("topic-1", "todo-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException when todo is not in PENDING or QUEUED status", async () => {
      const todo = makeTodo({
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.IN_PROGRESS,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);

      await expect(service.executeTodo("topic-1", "todo-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should execute a USER_REQUEST todo with "新增维度" in title (isAddDimension branch)', async () => {
      const todo = makeTodo({
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.PENDING,
        title: "新增维度：经济分析",
        missionId: "mission-1",
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      // update for IN_PROGRESS transition
      const inProgressTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      mockPrisma.researchTodo.update
        .mockResolvedValueOnce(inProgressTodo) // set IN_PROGRESS
        .mockResolvedValueOnce(
          makeTodo({
            ...todo,
            status: ResearchTodoStatus.COMPLETED,
            progress: 100,
          }),
        ); // set COMPLETED

      // findMany for existing tasks
      mockPrisma.researchTask.findMany.mockResolvedValueOnce([{ priority: 5 }]);
      mockPrisma.researchTask.count.mockResolvedValueOnce(2);

      const result = await service.executeTodo("topic-1", "todo-1");

      expect(result).toBeDefined();
      expect(result.todo).toBeDefined();
      expect(mockPrisma.topicDimension.create).toHaveBeenCalled();
      expect(mockPrisma.researchTask.create).toHaveBeenCalled();
    });

    it('should execute a USER_REQUEST todo with "深入研究" in title (isDeepResearch branch)', async () => {
      const todo = makeTodo({
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.QUEUED,
        title: "深入研究：量子计算",
        missionId: "mission-1",
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      const inProgressTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      mockPrisma.researchTodo.update
        .mockResolvedValueOnce(inProgressTodo)
        .mockResolvedValueOnce(
          makeTodo({
            ...todo,
            status: ResearchTodoStatus.COMPLETED,
            progress: 100,
          }),
        );

      mockPrisma.researchTask.findMany.mockResolvedValueOnce([]);
      mockPrisma.researchTask.count.mockResolvedValueOnce(0);

      const result = await service.executeTodo("topic-1", "todo-1");

      expect(result).toBeDefined();
      expect(mockPrisma.topicDimension.create).toHaveBeenCalled();
    });

    it("should execute a generic USER_REQUEST todo (no special keyword, goes to review)", async () => {
      const todo = makeTodo({
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.PENDING,
        title: "请帮我查一下市场规模",
        missionId: "mission-1",
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      const inProgressTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      const completedTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.COMPLETED,
        progress: 100,
      });
      // 3 update calls: IN_PROGRESS, progress-95 (from reviewTodoResult), final COMPLETED
      mockPrisma.researchTodo.update
        .mockResolvedValueOnce(inProgressTodo)
        .mockResolvedValueOnce(inProgressTodo) // progress 95 update
        .mockResolvedValueOnce(completedTodo);

      // Leader review returns 'approved'
      mockLeaderService.reviewTaskResult.mockResolvedValueOnce({
        taskId: "todo-1",
        status: "approved",
        feedback: "任务完成",
      });

      const result = await service.executeTodo("topic-1", "todo-1");

      expect(result).toBeDefined();
      // emitTodoEvent calls eventEmitter.emitToTopic internally
      expect(mockEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        TodoEventType.TODO_COMPLETED,
        expect.anything(),
      );
    });

    it("should handle Leader review returning needs_revision", async () => {
      const todo = makeTodo({
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.PENDING,
        title: "查询竞争对手数据",
        missionId: "mission-1",
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      const inProgressTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      const failedTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.FAILED,
        progress: 90,
      });
      // 3 update calls: IN_PROGRESS, progress-95 (reviewTodoResult), final FAILED
      mockPrisma.researchTodo.update
        .mockResolvedValueOnce(inProgressTodo)
        .mockResolvedValueOnce(inProgressTodo) // progress 95 update
        .mockResolvedValueOnce(failedTodo);

      mockLeaderService.reviewTaskResult.mockResolvedValueOnce({
        taskId: "todo-1",
        status: "needs_revision",
        feedback: "Please add more detail",
        revisionInstructions: "Include market share data",
      });

      const result = await service.executeTodo("topic-1", "todo-1");

      // The returned todo comes from the second update call (failedTodo)
      expect(result.todo.status).toBe(ResearchTodoStatus.FAILED);
      // emitTodoEvent calls eventEmitter.emitToTopic internally
      expect(mockEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        TodoEventType.TODO_FAILED,
        expect.anything(),
      );
    });

    it("should handle Leader review returning rejected", async () => {
      const todo = makeTodo({
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.PENDING,
        title: "无关内容",
        missionId: "mission-1",
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      const inProgressTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      const failedTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.FAILED,
        progress: 90,
      });
      // 3 update calls: IN_PROGRESS, progress-95 (reviewTodoResult), final FAILED
      mockPrisma.researchTodo.update
        .mockResolvedValueOnce(inProgressTodo)
        .mockResolvedValueOnce(inProgressTodo) // progress 95 update
        .mockResolvedValueOnce(failedTodo);

      mockLeaderService.reviewTaskResult.mockResolvedValueOnce({
        taskId: "todo-1",
        status: "rejected",
        feedback: "Off topic",
      });

      const result = await service.executeTodo("topic-1", "todo-1");

      expect(result.todo.status).toBe(ResearchTodoStatus.FAILED);
    });

    it("should auto-approve todo when missionId is null (reviewTodoResult auto-approve)", async () => {
      const todo = makeTodo({
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.PENDING,
        title: "查询数据",
        missionId: null,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      const inProgressTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      const completedTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.COMPLETED,
        progress: 100,
      });
      // 3 calls: IN_PROGRESS, progress-95 (reviewTodoResult), final COMPLETED
      mockPrisma.researchTodo.update
        .mockResolvedValueOnce(inProgressTodo)
        .mockResolvedValueOnce(inProgressTodo) // progress 95 update
        .mockResolvedValueOnce(completedTodo);

      const result = await service.executeTodo("topic-1", "todo-1");

      expect(result).toBeDefined();
      expect(result.todo).toBeDefined();
    });

    it("should handle execution error and update todo to FAILED status", async () => {
      const todo = makeTodo({
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.PENDING,
        title: "新增维度：错误测试",
        missionId: "mission-1",
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      const inProgressTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      mockPrisma.researchTodo.update.mockResolvedValueOnce(inProgressTodo);

      // Make the topic lookup fail to trigger the error path
      mockPrisma.researchTopic.findUnique.mockResolvedValueOnce(null);

      // For the error recovery update
      mockPrisma.researchTodo.update.mockResolvedValueOnce(
        makeTodo({ ...todo, status: ResearchTodoStatus.FAILED }),
      );

      await expect(service.executeTodo("topic-1", "todo-1")).rejects.toThrow();
    });

    it("should execute addDimension with quality review task update (has qualityReviewTask)", async () => {
      const todo = makeTodo({
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.PENDING,
        title: "新增维度：区块链应用",
        missionId: "mission-1",
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      const inProgressTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      mockPrisma.researchTodo.update
        .mockResolvedValueOnce(inProgressTodo)
        .mockResolvedValueOnce(
          makeTodo({
            ...todo,
            status: ResearchTodoStatus.COMPLETED,
            progress: 100,
          }),
        );

      mockPrisma.researchTask.findMany.mockResolvedValueOnce([{ priority: 3 }]);
      mockPrisma.researchTask.count.mockResolvedValueOnce(1);

      // Quality review task exists
      const qualityReviewTask = {
        id: "quality-task-1",
        dependencies: ["task-old-1"],
      };
      mockPrisma.researchTask.findFirst.mockResolvedValueOnce(
        qualityReviewTask,
      );

      const result = await service.executeTodo("topic-1", "todo-1");

      expect(result).toBeDefined();
      // Quality review task should be updated with new dependency
      expect(mockPrisma.researchTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "quality-task-1" },
        }),
      );
    });

    it("should not re-add duplicate dependency to quality review task", async () => {
      const todo = makeTodo({
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.PENDING,
        title: "新增维度：重复依赖测试",
        missionId: "mission-1",
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      const inProgressTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      mockPrisma.researchTodo.update
        .mockResolvedValueOnce(inProgressTodo)
        .mockResolvedValueOnce(
          makeTodo({
            ...todo,
            status: ResearchTodoStatus.COMPLETED,
            progress: 100,
          }),
        );

      mockPrisma.researchTask.findMany.mockResolvedValueOnce([]);
      mockPrisma.researchTask.count.mockResolvedValueOnce(0);
      const newTask = { id: "task-new-1" };
      mockPrisma.researchTask.create.mockResolvedValueOnce(newTask);

      // Quality review task already has this task in deps
      const qualityReviewTask = {
        id: "quality-task-1",
        dependencies: ["task-new-1"],
      };
      mockPrisma.researchTask.findFirst.mockResolvedValueOnce(
        qualityReviewTask,
      );

      const result = await service.executeTodo("topic-1", "todo-1");

      expect(result).toBeDefined();
      // Should NOT call researchTask.update because dep already exists
      expect(mockPrisma.researchTask.update).not.toHaveBeenCalled();
    });

    it('should execute USER_REQUEST with "构建" keyword (treated as addDimension)', async () => {
      const todo = makeTodo({
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.PENDING,
        title: "构建完整的分析框架",
        missionId: "mission-1",
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      const inProgressTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      mockPrisma.researchTodo.update
        .mockResolvedValueOnce(inProgressTodo)
        .mockResolvedValueOnce(
          makeTodo({
            ...todo,
            status: ResearchTodoStatus.COMPLETED,
            progress: 100,
          }),
        );

      mockPrisma.researchTask.findMany.mockResolvedValueOnce([]);
      mockPrisma.researchTask.count.mockResolvedValueOnce(0);

      const result = await service.executeTodo("topic-1", "todo-1");

      expect(result).toBeDefined();
      expect(mockPrisma.topicDimension.create).toHaveBeenCalled();
    });

    it("should execute USER_REQUEST without missionId in addDimension (no task creation)", async () => {
      const todo = makeTodo({
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.PENDING,
        title: "新增维度：无Mission测试",
        missionId: null,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      const inProgressTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      mockPrisma.researchTodo.update
        .mockResolvedValueOnce(inProgressTodo)
        .mockResolvedValueOnce(
          makeTodo({
            ...todo,
            status: ResearchTodoStatus.COMPLETED,
            progress: 100,
          }),
        );

      const result = await service.executeTodo("topic-1", "todo-1");

      expect(result).toBeDefined();
      // No missionId means no researchTask.create
      expect(mockPrisma.researchTask.create).not.toHaveBeenCalled();
    });

    it("should execute deep research without missionId (no task creation)", async () => {
      const todo = makeTodo({
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.PENDING,
        title: "详细分析：市场竞争格局",
        missionId: null,
      });
      mockPrisma.researchTodo.findUnique.mockResolvedValueOnce(todo);
      const inProgressTodo = makeTodo({
        ...todo,
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(),
      });
      mockPrisma.researchTodo.update
        .mockResolvedValueOnce(inProgressTodo)
        .mockResolvedValueOnce(
          makeTodo({
            ...todo,
            status: ResearchTodoStatus.COMPLETED,
            progress: 100,
          }),
        );

      const result = await service.executeTodo("topic-1", "todo-1");

      expect(result).toBeDefined();
      expect(mockPrisma.topicDimension.create).toHaveBeenCalled();
      expect(mockPrisma.researchTask.create).not.toHaveBeenCalled();
    });
  });
});
