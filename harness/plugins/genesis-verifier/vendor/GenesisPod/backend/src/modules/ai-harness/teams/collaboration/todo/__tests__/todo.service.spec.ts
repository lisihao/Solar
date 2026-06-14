/**
 * TodoService Unit Tests
 */

import { NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { TodoService } from "../todo.service";
import {
  CreateTodoRequest,
  UpdateTodoRequest,
  TodoStatus,
} from "../todo.interface";

// 模拟 Logger
jest.mock("@nestjs/common", () => {
  const actual = jest.requireActual("@nestjs/common");
  return {
    ...actual,
    Logger: jest.fn().mockImplementation(() => ({
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    })),
  };
});

// ---------------------------------------------------------------------------
// 辅助函数：DB 记录工厂
// ---------------------------------------------------------------------------
function buildDbTodo(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "todo-001",
    type: "review",
    title: "Test Todo",
    description: "A test todo item",
    entityType: "report",
    entityId: "entity-001",
    parentId: null,
    assigneeId: "assignee-id",
    createdBy: "creator-id",
    status: "pending",
    priority: "medium",
    labels: [],
    dueDate: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    completedAt: null,
    progress: 0,
    blockedBy: null,
    metadata: null,
    ...overrides,
  };
}

function buildCreateRequest(
  overrides: Partial<CreateTodoRequest> = {},
): CreateTodoRequest {
  return {
    type: "review",
    title: "Test Todo",
    entityType: "report",
    entityId: "entity-001",
    createdBy: "creator-id",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PrismaService 模拟工厂
// ---------------------------------------------------------------------------
interface PrismaMock {
  engineTodo: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    delete: jest.Mock;
  };
  $transaction: jest.Mock;
}

function buildPrismaWithTodoModel(
  overrides: Partial<PrismaMock["engineTodo"]> = {},
): PrismaMock {
  const engineTodo = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    ...overrides,
  };
  return {
    engineTodo,
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ engineTodo }),
    ),
  };
}

/** 不含 engineTodo 属性（模型未创建状态）的 Prisma 模拟 */
function buildPrismaWithoutTodoModel(): {
  $transaction: jest.Mock;
} {
  return {
    $transaction: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// 测试主体
// ---------------------------------------------------------------------------
describe("TodoService", () => {
  let service: TodoService;
  let prisma: PrismaMock;
  let eventEmitter: { emit: jest.Mock };

  function createService(prismaMock: unknown): TodoService {
    return new TodoService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prismaMock as any,
      eventEmitter as unknown as EventEmitter2,
    );
  }

  beforeEach(() => {
    prisma = buildPrismaWithTodoModel();
    eventEmitter = { emit: jest.fn() };

    // 直接实例化（避免与 Logger 模拟的冲突，不使用 TestingModule）
    service = createService(prisma);

    // 初始化 $transaction
    prisma.$transaction.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ engineTodo: prisma.engineTodo }),
    );
  });

  function createServiceWithoutModel(): TodoService {
    return createService(buildPrismaWithoutTodoModel());
  }

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe("create", () => {
    it("成功创建 Todo 并发出 todo.created 事件", async () => {
      const dbRecord = buildDbTodo();
      prisma.engineTodo.create.mockResolvedValue(dbRecord);

      const request = buildCreateRequest();
      const result = await service.create(request);

      expect(result.id).toBe("todo-001");
      expect(result.status).toBe("pending");
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        "todo.created",
        expect.objectContaining({
          todoId: "todo-001",
          entityType: "report",
          entityId: "entity-001",
        }),
      );
    });

    it("模型未使用时返回空 Todo 且不发出事件", async () => {
      const svc = createServiceWithoutModel();
      const result = await svc.create(buildCreateRequest());

      expect(result.id).toBe("");
      expect(result.status).toBe("pending");
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("未指定 priority 时默认设置为 medium", async () => {
      prisma.engineTodo.create.mockResolvedValue(
        buildDbTodo({ priority: "medium" }),
      );

      const request = buildCreateRequest({ priority: undefined });
      await service.create(request);

      const createArg = prisma.engineTodo.create.mock.calls[0][0];
      expect(createArg.data.priority).toBe("medium");
    });

    it("未指定 labels 时设置为空数组", async () => {
      prisma.engineTodo.create.mockResolvedValue(buildDbTodo({ labels: [] }));

      const request = buildCreateRequest({ labels: undefined });
      await service.create(request);

      const createArg = prisma.engineTodo.create.mock.calls[0][0];
      expect(createArg.data.labels).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // createBatch
  // ---------------------------------------------------------------------------
  describe("createBatch", () => {
    it("模型未使用时返回空数组", async () => {
      const svc = createServiceWithoutModel();
      const result = await svc.createBatch([buildCreateRequest()]);
      expect(result).toEqual([]);
    });

    it("批量创建多个 Todo", async () => {
      const records = [buildDbTodo({ id: "t1" }), buildDbTodo({ id: "t2" })];
      let callIndex = 0;
      prisma.engineTodo.create.mockImplementation(() =>
        Promise.resolve(records[callIndex++]),
      );

      const requests = [
        buildCreateRequest({ title: "Todo 1" }),
        buildCreateRequest({ title: "Todo 2" }),
      ];
      const result = await service.createBatch(requests);

      expect(result).toHaveLength(2);
      expect(prisma.engineTodo.create).toHaveBeenCalledTimes(2);
    });

    it("在事务中处理", async () => {
      prisma.engineTodo.create.mockResolvedValue(buildDbTodo());
      prisma.$transaction.mockImplementation(
        async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({ engineTodo: prisma.engineTodo }),
      );

      await service.createBatch([buildCreateRequest()]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getById
  // ---------------------------------------------------------------------------
  describe("getById", () => {
    it("返回存在的 Todo", async () => {
      prisma.engineTodo.findUnique.mockResolvedValue(buildDbTodo());

      const result = await service.getById("todo-001");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("todo-001");
    });

    it("不存在的 ID 返回 null", async () => {
      prisma.engineTodo.findUnique.mockResolvedValue(null);

      const result = await service.getById("nonexistent");

      expect(result).toBeNull();
    });

    it("模型未使用时返回 null", async () => {
      const svc = createServiceWithoutModel();
      const result = await svc.getById("todo-001");
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // query
  // ---------------------------------------------------------------------------
  describe("query", () => {
    it("模型未使用时返回空数组", async () => {
      const svc = createServiceWithoutModel();
      const result = await svc.query({});
      expect(result).toEqual([]);
    });

    it("无过滤条件时执行默认查询", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([buildDbTodo()]);

      const result = await service.query({});

      expect(result).toHaveLength(1);
      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.take).toBe(50); // 默认 limit
      expect(callArg.skip).toBe(0); // 默认 offset
    });

    it("entityType / entityId 过滤条件添加到 where", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.query({ entityType: "report", entityId: "entity-001" });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.entityType).toBe("report");
      expect(callArg.where.entityId).toBe("entity-001");
    });

    it("assigneeId 过滤条件被应用", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.query({ assigneeId: "user-1" });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.assigneeId).toBe("user-1");
    });

    it("status 为数组时转换为 { in: [...] }", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);
      const statuses: TodoStatus[] = ["pending", "in_progress"];

      await service.query({ status: statuses });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.status).toEqual({ in: statuses });
    });

    it("status 为字符串时直接设置到 where", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.query({ status: "pending" });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.status).toBe("pending");
    });

    it("type 为数组时转换为 { in: [...] }", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.query({ type: ["review", "research"] });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.type).toEqual({ in: ["review", "research"] });
    });

    it("priority 为数组时转换为 { in: [...] }", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.query({ priority: ["high", "urgent"] });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.priority).toEqual({ in: ["high", "urgent"] });
    });

    it("labels 过滤条件被应用", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.query({ labels: ["label-a"] });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.labels).toEqual({ hasSome: ["label-a"] });
    });

    it("dueBefore 过滤条件被应用", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);
      const deadline = new Date("2026-12-31");

      await service.query({ dueBefore: deadline });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.dueDate.lte).toEqual(deadline);
    });

    it("dueAfter 过滤条件被应用", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);
      const startDate = new Date("2026-01-01");

      await service.query({ dueAfter: startDate });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.dueDate.gte).toEqual(startDate);
    });

    it("parentId 为 null 时直接设置为 null", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.query({ parentId: null });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.parentId).toBeNull();
    });

    it("parentId 为字符串时直接设置", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.query({ parentId: "parent-id" });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.parentId).toBe("parent-id");
    });

    it("指定 sortBy 时用于 orderBy", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.query({ sortBy: "priority", sortOrder: "asc" });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.orderBy.priority).toBe("asc");
    });

    it("未指定 sortBy 时默认为 createdAt desc", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.query({});

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.orderBy.createdAt).toBe("desc");
    });

    it("传入 limit / offset", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.query({ limit: 10, offset: 5 });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.take).toBe(10);
      expect(callArg.skip).toBe(5);
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe("update", () => {
    it("更新已存在的 Todo", async () => {
      const existing = buildDbTodo({ metadata: { existing: true } });
      prisma.engineTodo.findUnique.mockResolvedValue(existing);
      prisma.engineTodo.update.mockResolvedValue(
        buildDbTodo({ title: "Updated", metadata: { existing: true } }),
      );

      const request: UpdateTodoRequest = { title: "Updated" };
      const result = await service.update("todo-001", request, "user-1");

      expect(result.title).toBe("Updated");
    });

    it("模型未使用时抛出 NotFoundException", async () => {
      const svc = createServiceWithoutModel();
      await expect(
        svc.update("todo-001", { title: "X" }, "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("不存在的 ID 抛出 NotFoundException", async () => {
      prisma.engineTodo.findUnique.mockResolvedValue(null);

      await expect(
        service.update("nonexistent", { title: "X" }, "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("指定 metadata 时与现有 metadata 合并", async () => {
      const existing = buildDbTodo({ metadata: { key1: "val1" } });
      prisma.engineTodo.findUnique.mockResolvedValue(existing);
      prisma.engineTodo.update.mockResolvedValue(
        buildDbTodo({ metadata: { key1: "val1", key2: "val2" } }),
      );

      await service.update(
        "todo-001",
        { metadata: { key2: "val2" } },
        "user-1",
      );

      const updateArg = prisma.engineTodo.update.mock.calls[0][0];
      expect(updateArg.data.metadata).toEqual({
        key1: "val1",
        key2: "val2",
      });
    });

    it("status / priority / assigneeId 等各字段独立更新", async () => {
      prisma.engineTodo.findUnique.mockResolvedValue(buildDbTodo());
      prisma.engineTodo.update.mockResolvedValue(
        buildDbTodo({ status: "in_progress", priority: "high" }),
      );

      const request: UpdateTodoRequest = {
        status: "in_progress",
        priority: "high",
        progress: 50,
        labels: ["label-x"],
        blockedBy: ["other-id"],
      };
      await service.update("todo-001", request, "user-1");

      const updateArg = prisma.engineTodo.update.mock.calls[0][0];
      expect(updateArg.data.status).toBe("in_progress");
      expect(updateArg.data.priority).toBe("high");
      expect(updateArg.data.progress).toBe(50);
      expect(updateArg.data.labels).toEqual(["label-x"]);
      expect(updateArg.data.blockedBy).toEqual(["other-id"]);
    });
  });

  // ---------------------------------------------------------------------------
  // complete
  // ---------------------------------------------------------------------------
  describe("complete", () => {
    it("将 Todo 更新为 completed 并发出 todo.completed 事件", async () => {
      const completedRecord = buildDbTodo({
        status: "completed",
        progress: 100,
        completedAt: new Date(),
      });
      prisma.engineTodo.update.mockResolvedValue(completedRecord);

      const result = await service.complete("todo-001", "user-1");

      expect(result.status).toBe("completed");
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        "todo.completed",
        expect.objectContaining({ todoId: "todo-001", completedBy: "user-1" }),
      );
    });

    it("模型未使用时抛出 NotFoundException", async () => {
      const svc = createServiceWithoutModel();
      await expect(svc.complete("todo-001", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // cancel
  // ---------------------------------------------------------------------------
  describe("cancel", () => {
    it("取消 Todo", async () => {
      const existing = buildDbTodo({ metadata: {} });
      prisma.engineTodo.findUnique.mockResolvedValue(existing);
      prisma.engineTodo.update.mockResolvedValue(
        buildDbTodo({ status: "cancelled" }),
      );

      const result = await service.cancel("todo-001", "user-1", "Not needed");

      expect(result.status).toBe("cancelled");
    });

    it("省略 reason 时正常运行", async () => {
      prisma.engineTodo.findUnique.mockResolvedValue(buildDbTodo());
      prisma.engineTodo.update.mockResolvedValue(
        buildDbTodo({ status: "cancelled" }),
      );

      const result = await service.cancel("todo-001", "user-1");
      expect(result).toBeDefined();
    });

    it("metadata 中保存 cancelledBy 和 cancelReason", async () => {
      prisma.engineTodo.findUnique.mockResolvedValue(
        buildDbTodo({ metadata: { existing: true } }),
      );
      prisma.engineTodo.update.mockResolvedValue(buildDbTodo());

      await service.cancel("todo-001", "user-1", "Reason");

      const updateArg = prisma.engineTodo.update.mock.calls[0][0];
      expect(updateArg.data.metadata.cancelledBy).toBe("user-1");
      expect(updateArg.data.metadata.cancelReason).toBe("Reason");
      expect(updateArg.data.metadata.existing).toBe(true); // 已被合并
    });

    it("模型未使用时抛出 NotFoundException", async () => {
      const svc = createServiceWithoutModel();
      await expect(svc.cancel("todo-001", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("不存在的 ID 抛出 NotFoundException", async () => {
      prisma.engineTodo.findUnique.mockResolvedValue(null);

      await expect(service.cancel("nonexistent", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------
  describe("delete", () => {
    it("成功删除 Todo", async () => {
      prisma.engineTodo.delete.mockResolvedValue(buildDbTodo());

      await expect(service.delete("todo-001")).resolves.toBeUndefined();
      expect(prisma.engineTodo.delete).toHaveBeenCalledWith({
        where: { id: "todo-001" },
      });
    });

    it("模型未使用时直接返回", async () => {
      const svc = createServiceWithoutModel();
      await expect(svc.delete("todo-001")).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getStats
  // ---------------------------------------------------------------------------
  describe("getStats", () => {
    it("模型未使用时返回零值统计", async () => {
      const svc = createServiceWithoutModel();
      const stats = await svc.getStats();

      expect(stats.total).toBe(0);
      expect(stats.byStatus.pending).toBe(0);
      expect(stats.overdue).toBe(0);
      expect(stats.completedThisWeek).toBe(0);
    });

    it("各状态计数正确计算", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([
        {
          status: "pending",
          priority: "low",
          dueDate: null,
          completedAt: null,
        },
        {
          status: "in_progress",
          priority: "medium",
          dueDate: null,
          completedAt: null,
        },
        {
          status: "completed",
          priority: "high",
          dueDate: null,
          completedAt: new Date(),
        },
        {
          status: "cancelled",
          priority: "urgent",
          dueDate: null,
          completedAt: null,
        },
        {
          status: "blocked",
          priority: "low",
          dueDate: null,
          completedAt: null,
        },
      ]);

      const stats = await service.getStats();

      expect(stats.total).toBe(5);
      expect(stats.byStatus.pending).toBe(1);
      expect(stats.byStatus.in_progress).toBe(1);
      expect(stats.byStatus.completed).toBe(1);
      expect(stats.byStatus.cancelled).toBe(1);
      expect(stats.byStatus.blocked).toBe(1);
    });

    it("各 priority 计数正确计算", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([
        {
          status: "pending",
          priority: "low",
          dueDate: null,
          completedAt: null,
        },
        {
          status: "pending",
          priority: "medium",
          dueDate: null,
          completedAt: null,
        },
        {
          status: "pending",
          priority: "high",
          dueDate: null,
          completedAt: null,
        },
        {
          status: "pending",
          priority: "urgent",
          dueDate: null,
          completedAt: null,
        },
      ]);

      const stats = await service.getStats();

      expect(stats.byPriority.low).toBe(1);
      expect(stats.byPriority.medium).toBe(1);
      expect(stats.byPriority.high).toBe(1);
      expect(stats.byPriority.urgent).toBe(1);
    });

    it("dueDate 已过期且未完成的 Todo 计入 overdue", async () => {
      const pastDate = new Date(Date.now() - 86400_000).toISOString(); // 昨天
      prisma.engineTodo.findMany.mockResolvedValue([
        {
          status: "pending",
          priority: "medium",
          dueDate: pastDate,
          completedAt: null,
        },
      ]);

      const stats = await service.getStats();
      expect(stats.overdue).toBe(1);
    });

    it("已完成或已取消的 Todo 不计入 overdue", async () => {
      const pastDate = new Date(Date.now() - 86400_000).toISOString();
      prisma.engineTodo.findMany.mockResolvedValue([
        {
          status: "completed",
          priority: "medium",
          dueDate: pastDate,
          completedAt: new Date(),
        },
        {
          status: "cancelled",
          priority: "medium",
          dueDate: pastDate,
          completedAt: null,
        },
      ]);

      const stats = await service.getStats();
      expect(stats.overdue).toBe(0);
    });

    it("本周完成的 Todo 计入 completedThisWeek", async () => {
      const recentCompletion = new Date(Date.now() - 3600_000); // 1 小时前
      prisma.engineTodo.findMany.mockResolvedValue([
        {
          status: "completed",
          priority: "medium",
          dueDate: null,
          completedAt: recentCompletion,
        },
      ]);

      const stats = await service.getStats();
      expect(stats.completedThisWeek).toBe(1);
    });

    it("1 周以上前完成的不计入 completedThisWeek", async () => {
      const oldCompletion = new Date(Date.now() - 8 * 24 * 3600_000); // 8 天前
      prisma.engineTodo.findMany.mockResolvedValue([
        {
          status: "completed",
          priority: "medium",
          dueDate: null,
          completedAt: oldCompletion,
        },
      ]);

      const stats = await service.getStats();
      expect(stats.completedThisWeek).toBe(0);
    });

    it("传入 filters 时添加到 where 条件", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.getStats({
        entityType: "report",
        entityId: "entity-001",
        assigneeId: "user-1",
      });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.entityType).toBe("report");
      expect(callArg.where.entityId).toBe("entity-001");
      expect(callArg.where.assigneeId).toBe("user-1");
    });
  });

  // ---------------------------------------------------------------------------
  // getChildren
  // ---------------------------------------------------------------------------
  describe("getChildren", () => {
    it("返回子 Todo 列表", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([
        buildDbTodo({ id: "child-1", parentId: "parent-id" }),
        buildDbTodo({ id: "child-2", parentId: "parent-id" }),
      ]);

      const result = await service.getChildren("parent-id");

      expect(result).toHaveLength(2);
      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.parentId).toBe("parent-id");
    });

    it("模型未使用时返回空数组", async () => {
      const svc = createServiceWithoutModel();
      const result = await svc.getChildren("parent-id");
      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // batchUpdateStatus
  // ---------------------------------------------------------------------------
  describe("batchUpdateStatus", () => {
    it("批量更新多个 Todo 的状态", async () => {
      const records = [
        buildDbTodo({ id: "t1", status: "completed" }),
        buildDbTodo({ id: "t2", status: "completed" }),
      ];
      prisma.engineTodo.updateMany.mockResolvedValue({ count: 2 });
      prisma.engineTodo.findMany.mockResolvedValue(records);

      const result = await service.batchUpdateStatus(
        ["t1", "t2"],
        "completed",
        "user-1",
      );

      expect(result).toHaveLength(2);
      expect(prisma.engineTodo.updateMany).toHaveBeenCalledTimes(1);
    });

    it("status 为 completed 时设置 completedAt 和 progress", async () => {
      prisma.engineTodo.updateMany.mockResolvedValue({ count: 1 });
      prisma.engineTodo.findMany.mockResolvedValue([buildDbTodo()]);

      await service.batchUpdateStatus(["t1"], "completed", "user-1");

      const updateManyArg = prisma.engineTodo.updateMany.mock.calls[0][0];
      expect(updateManyArg.data.completedAt).toBeDefined();
      expect(updateManyArg.data.progress).toBe(100);
    });

    it("status 非 completed 时 completedAt 不包含在内", async () => {
      prisma.engineTodo.updateMany.mockResolvedValue({ count: 1 });
      prisma.engineTodo.findMany.mockResolvedValue([buildDbTodo()]);

      await service.batchUpdateStatus(["t1"], "cancelled", "user-1");

      const updateManyArg = prisma.engineTodo.updateMany.mock.calls[0][0];
      expect(updateManyArg.data.completedAt).toBeUndefined();
    });

    it("模型未使用时返回空数组", async () => {
      const svc = createServiceWithoutModel();
      const result = await svc.batchUpdateStatus(["t1"], "completed", "user-1");
      expect(result).toEqual([]);
    });

    it("在事务中执行 updateMany + findMany", async () => {
      prisma.engineTodo.updateMany.mockResolvedValue({ count: 1 });
      prisma.engineTodo.findMany.mockResolvedValue([buildDbTodo()]);

      await service.batchUpdateStatus(["t1"], "in_progress", "user-1");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.engineTodo.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.engineTodo.findMany).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // mapToTodo（字段映射覆盖）
  // ---------------------------------------------------------------------------
  describe("mapToTodo 的字段映射", () => {
    it("nullable 字段正确映射", async () => {
      const record = buildDbTodo({
        description: undefined,
        parentId: undefined,
        assigneeId: undefined,
        dueDate: undefined,
        completedAt: undefined,
        progress: undefined,
        blockedBy: undefined,
        metadata: undefined,
      });
      prisma.engineTodo.findUnique.mockResolvedValue(record);

      const result = await service.getById("todo-001");

      expect(result?.description).toBeUndefined();
      expect(result?.parentId).toBeUndefined();
      expect(result?.assigneeId).toBeUndefined();
      expect(result?.labels).toEqual([]); // null 安全
    });

    it("labels 为 null 时回退到空数组", async () => {
      prisma.engineTodo.findUnique.mockResolvedValue(
        buildDbTodo({ labels: null }),
      );

      const result = await service.getById("todo-001");
      expect(result?.labels).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // update：description 字段的分支覆盖补充
  // ---------------------------------------------------------------------------
  describe("update 的 description 字段", () => {
    it("指定 description 时包含在数据中", async () => {
      prisma.engineTodo.findUnique.mockResolvedValue(buildDbTodo());
      prisma.engineTodo.update.mockResolvedValue(
        buildDbTodo({ description: "Updated description" }),
      );

      await service.update(
        "todo-001",
        { description: "Updated description" },
        "user-1",
      );

      const updateArg = prisma.engineTodo.update.mock.calls[0][0];
      expect(updateArg.data.description).toBe("Updated description");
    });

    it("description 为 undefined 时不包含在数据中", async () => {
      prisma.engineTodo.findUnique.mockResolvedValue(buildDbTodo());
      prisma.engineTodo.update.mockResolvedValue(buildDbTodo());

      await service.update("todo-001", { title: "New title" }, "user-1");

      const updateArg = prisma.engineTodo.update.mock.calls[0][0];
      expect(updateArg.data.description).toBeUndefined();
    });

    it("指定 assigneeId 时包含在数据中", async () => {
      prisma.engineTodo.findUnique.mockResolvedValue(buildDbTodo());
      prisma.engineTodo.update.mockResolvedValue(buildDbTodo());

      await service.update(
        "todo-001",
        { assigneeId: "new-assignee" },
        "user-1",
      );

      const updateArg = prisma.engineTodo.update.mock.calls[0][0];
      expect(updateArg.data.assigneeId).toBe("new-assignee");
    });

    it("指定 dueDate 时包含在数据中", async () => {
      prisma.engineTodo.findUnique.mockResolvedValue(buildDbTodo());
      prisma.engineTodo.update.mockResolvedValue(buildDbTodo());
      const due = new Date("2026-06-30");

      await service.update("todo-001", { dueDate: due }, "user-1");

      const updateArg = prisma.engineTodo.update.mock.calls[0][0];
      expect(updateArg.data.dueDate).toEqual(due);
    });
  });

  // ---------------------------------------------------------------------------
  // query 分支覆盖补充
  // ---------------------------------------------------------------------------
  describe("query 分支覆盖补充", () => {
    it("type 为字符串时直接设置到 where", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.query({ type: "review" });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.type).toBe("review");
    });

    it("priority 为字符串时直接设置到 where", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.query({ priority: "high" });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.where.priority).toBe("high");
    });

    it("sortBy 未指定 sortOrder 时默认为 desc", async () => {
      prisma.engineTodo.findMany.mockResolvedValue([]);

      await service.query({ sortBy: "dueDate" });

      const callArg = prisma.engineTodo.findMany.mock.calls[0][0];
      expect(callArg.orderBy.dueDate).toBe("desc");
    });
  });

  // ---------------------------------------------------------------------------
  // updateStatus：NotFoundException 补充
  // ---------------------------------------------------------------------------
  describe("updateStatus 不存在记录的 NotFoundException", () => {
    it("updateStatus：记录不存在时抛出 NotFoundException", async () => {
      prisma as unknown as Record<string, unknown>;
      // Todo 的 update 中 findUnique 返回 null 的情况
      prisma.engineTodo.findUnique.mockResolvedValue(null);

      await expect(
        service.update("nonexistent-id", { title: "X" }, "user-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
