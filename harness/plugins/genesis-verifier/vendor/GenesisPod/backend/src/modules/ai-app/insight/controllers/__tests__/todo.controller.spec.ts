// Break the ai-harness/facade import chain (transitively imports @nestjs/cache-manager)
jest.mock("@/modules/ai-harness/facade", () => ({}));
jest.mock("@/modules/ai-harness/facade", () => ({}));

import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { TodoController } from "../todo.controller";
import type {
  ResearchTodoService,
  MissionLifecycleService,
  MissionQueryService,
} from "../../services";

function createMockTodoService() {
  return {
    getTodos: jest.fn().mockResolvedValue({ items: [], summary: {} }),
    getTodoById: jest.fn().mockResolvedValue({ id: "todo-1", title: "Test" }),
    getTodoDetails: jest
      .fn()
      .mockResolvedValue({ id: "todo-1", activities: [] }),
    pauseTodo: jest.fn().mockResolvedValue({ id: "todo-1", status: "PAUSED" }),
    resumeTodo: jest
      .fn()
      .mockResolvedValue({ id: "todo-1", status: "RUNNING" }),
    cancelTodo: jest
      .fn()
      .mockResolvedValue({ id: "todo-1", status: "CANCELLED" }),
    retryTodo: jest.fn().mockResolvedValue({ id: "todo-1", status: "QUEUED" }),
    executeTodo: jest.fn().mockResolvedValue({ executing: true }),
    prioritizeTodo: jest
      .fn()
      .mockResolvedValue({ id: "todo-1", priority: "high" }),
    updateTodoProgress: jest
      .fn()
      .mockResolvedValue({ id: "todo-1", progress: 50 }),
    createUserRequestTodo: jest.fn().mockResolvedValue({ id: "todo-new" }),
    updateTodoContent: jest.fn().mockResolvedValue({ id: "todo-1" }),
    deleteTodo: jest.fn().mockResolvedValue(undefined),
    verifyTodoBelongsToTopic: jest.fn().mockResolvedValue(undefined),
    verifyTodoOrTaskBelongsToTopic: jest.fn().mockResolvedValue("todo"),
  } as unknown as jest.Mocked<ResearchTodoService>;
}

function createMockLifecycleService() {
  return {
    retryTask: jest.fn().mockResolvedValue({
      id: "task-1",
      title: "Research Task",
      status: "PENDING",
      taskType: "SEARCH",
      dimensionName: "Market",
    }),
  } as unknown as jest.Mocked<MissionLifecycleService>;
}

function createMockQueryService() {
  return {
    getTaskActivities: jest
      .fn()
      .mockResolvedValue({ task: {}, activities: [] }),
    verifyTaskBelongsToTopic: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<MissionQueryService>;
}

function createMockRequest(userId?: string) {
  return { user: { id: userId } };
}

describe("TodoController", () => {
  let controller: TodoController;
  let mockTodoService: jest.Mocked<ResearchTodoService>;
  let mockLifecycleService: jest.Mocked<MissionLifecycleService>;
  let mockQueryService: jest.Mocked<MissionQueryService>;
  let mockReq: ReturnType<typeof createMockRequest>;

  beforeEach(() => {
    mockTodoService = createMockTodoService();
    mockLifecycleService = createMockLifecycleService();
    mockQueryService = createMockQueryService();
    controller = new TodoController(
      mockTodoService as unknown as ResearchTodoService,
      mockLifecycleService as unknown as MissionLifecycleService,
      mockQueryService as unknown as MissionQueryService,
    );
    mockReq = createMockRequest("user-123");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getTodos", () => {
    it("should get todos for topic", async () => {
      const query = { missionId: "mission-1", status: "PENDING" } as never;
      await controller.getTodos(mockReq as never, "topic-1", query);
      expect(mockTodoService.getTodos).toHaveBeenCalledWith("topic-1", {
        missionId: "mission-1",
        status: "PENDING",
        type: undefined,
      });
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.getTodos(reqNoUser as never, "topic-1", {} as never),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("getTodoById", () => {
    it("should get todo by id", async () => {
      const result = await controller.getTodoById(
        mockReq as never,
        "topic-1",
        "todo-1",
      );
      expect(mockTodoService.getTodoById).toHaveBeenCalledWith("todo-1");
      expect(result).toEqual({ id: "todo-1", title: "Test" });
    });
  });

  describe("getTodoDetails", () => {
    it("should get todo details with activities", async () => {
      await controller.getTodoDetails(mockReq as never, "topic-1", "todo-1");
      expect(mockTodoService.getTodoDetails).toHaveBeenCalledWith("todo-1");
    });
  });

  describe("getTaskActivities", () => {
    it("should get task activities from query service", async () => {
      await controller.getTaskActivities(mockReq as never, "topic-1", "task-1");
      expect(mockQueryService.getTaskActivities).toHaveBeenCalledWith("task-1");
    });
  });

  describe("pauseTodo", () => {
    it("should pause a todo", async () => {
      const result = await controller.pauseTodo(
        mockReq as never,
        "topic-1",
        "todo-1",
      );
      expect(mockTodoService.pauseTodo).toHaveBeenCalledWith("todo-1");
      expect(result).toEqual({ id: "todo-1", status: "PAUSED" });
    });
  });

  describe("resumeTodo", () => {
    it("should resume a paused todo", async () => {
      const result = await controller.resumeTodo(
        mockReq as never,
        "topic-1",
        "todo-1",
      );
      expect(mockTodoService.resumeTodo).toHaveBeenCalledWith("todo-1");
      expect(result).toEqual({ id: "todo-1", status: "RUNNING" });
    });
  });

  describe("cancelTodo", () => {
    it("should cancel a todo with reason", async () => {
      const dto = { reason: "No longer needed" } as never;
      const result = await controller.cancelTodo(
        mockReq as never,
        "topic-1",
        "todo-1",
        dto,
      );
      expect(mockTodoService.cancelTodo).toHaveBeenCalledWith(
        "todo-1",
        "No longer needed",
      );
      expect(result).toEqual({ id: "todo-1", status: "CANCELLED" });
    });
  });

  describe("retryTodo", () => {
    it("should retry a failed todo", async () => {
      const result = await controller.retryTodo(
        mockReq as never,
        "topic-1",
        "todo-1",
      );
      expect(mockTodoService.retryTodo).toHaveBeenCalledWith("todo-1");
      expect(result).toEqual({ id: "todo-1", status: "QUEUED" });
    });

    it("should fall back to task retry when todo not found", async () => {
      mockTodoService.retryTodo.mockRejectedValue(
        new NotFoundException("Todo not found"),
      );

      const result = await controller.retryTodo(
        mockReq as never,
        "topic-1",
        "task-1",
      );

      expect(mockLifecycleService.retryTask).toHaveBeenCalledWith("task-1");
      expect(result.id).toBe("task-1");
      expect(result.status).toBe("QUEUED");
    });

    it("should rethrow when both todo and task retry fail", async () => {
      const notFoundError = new NotFoundException("Not found");
      mockTodoService.retryTodo.mockRejectedValue(notFoundError);
      mockLifecycleService.retryTask.mockRejectedValue(new Error("Task error"));

      await expect(
        controller.retryTodo(mockReq as never, "topic-1", "bad-id"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should rethrow non-NotFoundException errors", async () => {
      mockTodoService.retryTodo.mockRejectedValue(
        new Error("Some other error"),
      );

      await expect(
        controller.retryTodo(mockReq as never, "topic-1", "todo-err"),
      ).rejects.toThrow("Some other error");
    });
  });

  describe("executeTodo", () => {
    it("should execute a user-requested todo", async () => {
      const result = await controller.executeTodo(
        mockReq as never,
        "topic-1",
        "todo-1",
      );
      expect(mockTodoService.executeTodo).toHaveBeenCalledWith(
        "topic-1",
        "todo-1",
      );
      expect(result).toEqual({ executing: true });
    });
  });

  describe("prioritizeTodo", () => {
    it("should set todo priority", async () => {
      const dto = { priority: "high" } as never;
      const result = await controller.prioritizeTodo(
        mockReq as never,
        "topic-1",
        "todo-1",
        dto,
      );
      expect(mockTodoService.prioritizeTodo).toHaveBeenCalledWith(
        "todo-1",
        "high",
      );
      expect(result).toEqual({ id: "todo-1", priority: "high" });
    });
  });

  describe("updateTodoProgress", () => {
    it("should update todo progress and status message", async () => {
      const dto = { progress: 75, statusMessage: "Almost done" } as never;
      const _result = await controller.updateTodoProgress(
        mockReq as never,
        "topic-1",
        "todo-1",
        dto,
      );
      expect(mockTodoService.updateTodoProgress).toHaveBeenCalledWith(
        "todo-1",
        {
          progress: 75,
          statusMessage: "Almost done",
        },
      );
    });
  });

  describe("createUserRequestTodo", () => {
    it("should create user request todo", async () => {
      const dto = {
        title: "Research new market",
        description: "Analyze XYZ market",
      } as never;
      const result = await controller.createUserRequestTodo(
        mockReq as never,
        "topic-1",
        "mission-1",
        dto,
      );
      expect(mockTodoService.createUserRequestTodo).toHaveBeenCalledWith(
        "topic-1",
        "mission-1",
        "Research new market",
        "Analyze XYZ market",
      );
      expect(result).toEqual({ id: "todo-new" });
    });
  });

  describe("updateTodo", () => {
    it("should update todo title and description", async () => {
      const dto = { title: "New title", description: "New description" };
      await controller.updateTodo(mockReq as never, "topic-1", "todo-1", dto);
      expect(mockTodoService.updateTodoContent).toHaveBeenCalledWith(
        "todo-1",
        dto,
      );
    });
  });

  describe("deleteTodo", () => {
    it("should delete a user-request todo", async () => {
      await controller.deleteTodo(mockReq as never, "topic-1", "todo-1");
      expect(mockTodoService.deleteTodo).toHaveBeenCalledWith("todo-1");
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.deleteTodo(reqNoUser as never, "topic-1", "todo-1"),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
