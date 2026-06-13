/**
 * TodoController - Supplemental Tests
 *
 * Covers uncovered lines (UnauthorizedException branches for each endpoint):
 * lines 107, 131, 156, 181, 207, 234, 262, 314, 340, 366, 395, 426
 */

import { UnauthorizedException } from "@nestjs/common";
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
  } as unknown as jest.Mocked<ResearchTodoService>;
}

function createMockLifecycleService() {
  return {
    retryTask: jest.fn(),
  } as unknown as jest.Mocked<MissionLifecycleService>;
}

function createMockQueryService() {
  return {
    getTaskActivities: jest
      .fn()
      .mockResolvedValue({ task: {}, activities: [] }),
  } as unknown as jest.Mocked<MissionQueryService>;
}

function noUserReq() {
  return { user: { id: undefined } };
}

describe("TodoController (supplemental - UnauthorizedException branches)", () => {
  let controller: TodoController;
  let mockTodoService: jest.Mocked<ResearchTodoService>;
  let mockLifecycleService: jest.Mocked<MissionLifecycleService>;
  let mockQueryService: jest.Mocked<MissionQueryService>;

  beforeEach(() => {
    mockTodoService = createMockTodoService();
    mockLifecycleService = createMockLifecycleService();
    mockQueryService = createMockQueryService();
    controller = new TodoController(
      mockTodoService as unknown as ResearchTodoService,
      mockLifecycleService as unknown as MissionLifecycleService,
      mockQueryService as unknown as MissionQueryService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("getTodoById: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.getTodoById(noUserReq() as never, "topic-1", "todo-1"),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("getTodoDetails: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.getTodoDetails(noUserReq() as never, "topic-1", "todo-1"),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("getTaskActivities: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.getTaskActivities(noUserReq() as never, "topic-1", "task-1"),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("pauseTodo: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.pauseTodo(noUserReq() as never, "topic-1", "todo-1"),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("resumeTodo: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.resumeTodo(noUserReq() as never, "topic-1", "todo-1"),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("cancelTodo: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.cancelTodo(noUserReq() as never, "topic-1", "todo-1", {
        reason: "test",
      } as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("retryTodo: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.retryTodo(noUserReq() as never, "topic-1", "todo-1"),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("executeTodo: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.executeTodo(noUserReq() as never, "topic-1", "todo-1"),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("prioritizeTodo: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.prioritizeTodo(noUserReq() as never, "topic-1", "todo-1", {
        priority: "high",
      } as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("updateTodoProgress: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.updateTodoProgress(noUserReq() as never, "topic-1", "todo-1", {
        progress: 50,
      } as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("createUserRequestTodo: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.createUserRequestTodo(
        noUserReq() as never,
        "topic-1",
        "mission-1",
        { title: "Test", description: "Test" } as never,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("updateTodo: should throw UnauthorizedException when user missing", async () => {
    await expect(
      controller.updateTodo(noUserReq() as never, "topic-1", "todo-1", {
        title: "New",
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
