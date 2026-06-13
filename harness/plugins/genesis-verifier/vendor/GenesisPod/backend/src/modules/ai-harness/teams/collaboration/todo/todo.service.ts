/**
 * Todo Service
 * 待办管理服务
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  ITodoService,
  Todo,
  CreateTodoRequest,
  UpdateTodoRequest,
  TodoQuery,
  TodoStats,
  TodoStatus,
} from "./todo.interface";

/**
 * 待办管理服务
 *
 * Phase 4.1 技术债务：EngineTodo Prisma 模型尚未创建，
 * 所有方法在模型可用前返回安全的空数据并记录警告。
 */
@Injectable()
export class TodoService implements ITodoService {
  private readonly logger = new Logger(TodoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 检查 EngineTodo 模型是否在 Prisma Client 中可用。
   * Phase 4.1: 模型尚未创建，始终返回 false。
   */
  private isModelAvailable(): boolean {
    const available =
      "engineTodo" in (this.prisma as unknown as Record<string, unknown>);
    if (!available) {
      this.logger.warn(
        "Phase 4.1: EngineTodo Prisma model is not yet available. " +
          "Returning safe default. Create the model and migration to enable this feature.",
      );
    }
    return available;
  }

  /**
   * 创建待办
   */
  async create(_request: CreateTodoRequest): Promise<Todo> {
    if (!this.isModelAvailable()) {
      return this.emptyTodo();
    }

    const prismaModel = (this.prisma as unknown as Record<string, unknown>)
      .engineTodo as PrismaModelDelegate;

    const todo = await prismaModel.create({
      data: {
        type: _request.type,
        title: _request.title,
        description: _request.description,
        entityType: _request.entityType,
        entityId: _request.entityId,
        assigneeId: _request.assigneeId,
        priority: _request.priority ?? "medium",
        dueDate: _request.dueDate,
        parentId: _request.parentId,
        labels: _request.labels ?? [],
        metadata: _request.metadata as Record<string, unknown>,
        createdBy: _request.createdBy,
        status: "pending",
        progress: 0,
      },
    });

    const result = this.mapToTodo(todo);

    this.eventEmitter.emit("todo.created", {
      todoId: result.id,
      entityType: _request.entityType,
      entityId: _request.entityId,
    });

    return result;
  }

  /**
   * 批量创建
   */
  async createBatch(_requests: CreateTodoRequest[]): Promise<Todo[]> {
    if (!this.isModelAvailable()) {
      return [];
    }

    // 使用交互式事务（callback 形式）以兼容类型安全的动态模型访问
    return await this.prisma.$transaction(async (tx: unknown) => {
      const txModel = (tx as Record<string, unknown>)
        .engineTodo as PrismaModelDelegate;

      const results: Record<string, unknown>[] = [];
      for (const request of _requests) {
        const todo = await txModel.create({
          data: {
            type: request.type,
            title: request.title,
            description: request.description,
            entityType: request.entityType,
            entityId: request.entityId,
            assigneeId: request.assigneeId,
            priority: request.priority ?? "medium",
            dueDate: request.dueDate,
            parentId: request.parentId,
            labels: request.labels ?? [],
            metadata: request.metadata as Record<string, unknown>,
            createdBy: request.createdBy,
            status: "pending",
            progress: 0,
          },
        });
        results.push(todo);
      }

      return results.map((t) => this.mapToTodo(t));
    });
  }

  /**
   * 获取待办
   */
  async getById(id: string): Promise<Todo | null> {
    if (!this.isModelAvailable()) {
      return null;
    }

    const prismaModel = (this.prisma as unknown as Record<string, unknown>)
      .engineTodo as PrismaModelDelegate;

    const todo = await prismaModel.findUnique({ where: { id } });
    return todo ? this.mapToTodo(todo) : null;
  }

  /**
   * 查询待办
   */
  async query(query: TodoQuery): Promise<Todo[]> {
    if (!this.isModelAvailable()) {
      return [];
    }

    const prismaModel = (this.prisma as unknown as Record<string, unknown>)
      .engineTodo as PrismaModelDelegate;

    const where: Record<string, unknown> = {};

    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.parentId !== undefined) {
      where.parentId = query.parentId === null ? null : query.parentId;
    }

    if (query.status) {
      where.status = Array.isArray(query.status)
        ? { in: query.status }
        : query.status;
    }
    if (query.type) {
      where.type = Array.isArray(query.type) ? { in: query.type } : query.type;
    }
    if (query.priority) {
      where.priority = Array.isArray(query.priority)
        ? { in: query.priority }
        : query.priority;
    }
    if (query.labels?.length) {
      where.labels = { hasSome: query.labels };
    }
    // ★ 使用类型安全的日期过滤器构建
    const dateFilter: { lte?: Date; gte?: Date } = {};
    if (query.dueBefore) {
      dateFilter.lte = query.dueBefore;
    }
    if (query.dueAfter) {
      dateFilter.gte = query.dueAfter;
    }
    if (Object.keys(dateFilter).length > 0) {
      where.dueDate = dateFilter;
    }

    const orderBy: Record<string, string> = {};
    if (query.sortBy) {
      orderBy[query.sortBy] = query.sortOrder ?? "desc";
    } else {
      orderBy.createdAt = "desc";
    }

    const todos = await prismaModel.findMany({
      where,
      orderBy,
      take: query.limit ?? 50,
      skip: query.offset ?? 0,
    });

    return (todos as Record<string, unknown>[]).map((t) => this.mapToTodo(t));
  }

  /**
   * 更新待办
   */
  async update(
    id: string,
    request: UpdateTodoRequest,
    _updatedBy: string,
  ): Promise<Todo> {
    if (!this.isModelAvailable()) {
      throw new NotFoundException(`Todo ${id} not found`);
    }

    const prismaModel = (this.prisma as unknown as Record<string, unknown>)
      .engineTodo as PrismaModelDelegate;

    const existing = await prismaModel.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Todo ${id} not found`);
    }

    const data: Record<string, unknown> = {};
    if (request.title !== undefined) data.title = request.title;
    if (request.description !== undefined)
      data.description = request.description;
    if (request.status !== undefined) data.status = request.status;
    if (request.priority !== undefined) data.priority = request.priority;
    if (request.assigneeId !== undefined) data.assigneeId = request.assigneeId;
    if (request.dueDate !== undefined) data.dueDate = request.dueDate;
    if (request.labels !== undefined) data.labels = request.labels;
    if (request.progress !== undefined) data.progress = request.progress;
    if (request.blockedBy !== undefined) data.blockedBy = request.blockedBy;
    if (request.metadata !== undefined) {
      data.metadata = {
        ...(existing.metadata as Record<string, unknown>),
        ...request.metadata,
      };
    }

    const todo = await prismaModel.update({ where: { id }, data });
    return this.mapToTodo(todo);
  }

  /**
   * 完成待办
   */
  async complete(id: string, completedBy: string): Promise<Todo> {
    if (!this.isModelAvailable()) {
      throw new NotFoundException(`Todo ${id} not found`);
    }

    const prismaModel = (this.prisma as unknown as Record<string, unknown>)
      .engineTodo as PrismaModelDelegate;

    const todo = await prismaModel.update({
      where: { id },
      data: {
        status: "completed",
        progress: 100,
        completedAt: new Date(),
      },
    });

    this.eventEmitter.emit("todo.completed", {
      todoId: id,
      completedBy,
    });

    return this.mapToTodo(todo);
  }

  /**
   * 取消待办
   */
  async cancel(
    id: string,
    cancelledBy: string,
    reason?: string,
  ): Promise<Todo> {
    if (!this.isModelAvailable()) {
      throw new NotFoundException(`Todo ${id} not found`);
    }

    const prismaModel = (this.prisma as unknown as Record<string, unknown>)
      .engineTodo as PrismaModelDelegate;

    const existing = await prismaModel.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Todo ${id} not found`);
    }

    const todo = await prismaModel.update({
      where: { id },
      data: {
        status: "cancelled",
        metadata: {
          ...(existing.metadata as Record<string, unknown>),
          cancelledBy,
          cancelReason: reason,
          cancelledAt: new Date().toISOString(),
        },
      },
    });

    return this.mapToTodo(todo);
  }

  /**
   * 删除待办
   */
  async delete(id: string): Promise<void> {
    if (!this.isModelAvailable()) {
      return;
    }

    const prismaModel = (this.prisma as unknown as Record<string, unknown>)
      .engineTodo as PrismaModelDelegate;

    await prismaModel.delete({ where: { id } });
    this.logger.debug(`Deleted todo ${id}`);
  }

  /**
   * 获取统计
   */
  async getStats(filters?: {
    entityType?: string;
    entityId?: string;
    assigneeId?: string;
  }): Promise<TodoStats> {
    if (!this.isModelAvailable()) {
      return this.emptyStats();
    }

    const prismaModel = (this.prisma as unknown as Record<string, unknown>)
      .engineTodo as PrismaModelDelegate;

    const where: Record<string, unknown> = {};
    if (filters?.entityType) where.entityType = filters.entityType;
    if (filters?.entityId) where.entityId = filters.entityId;
    if (filters?.assigneeId) where.assigneeId = filters.assigneeId;

    const todos = await prismaModel.findMany({
      where,
      select: {
        status: true,
        priority: true,
        dueDate: true,
        completedAt: true,
      },
    });

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const stats: TodoStats = this.emptyStats();
    stats.total = (todos as Record<string, unknown>[]).length;

    for (const todo of todos as Record<string, unknown>[]) {
      stats.byStatus[todo.status as TodoStatus]++;
      stats.byPriority[todo.priority as keyof typeof stats.byPriority]++;

      if (
        todo.dueDate &&
        new Date(todo.dueDate as string) < now &&
        !["completed", "cancelled"].includes(todo.status as string)
      ) {
        stats.overdue++;
      }

      if (todo.completedAt && new Date(todo.completedAt as string) > weekAgo) {
        stats.completedThisWeek++;
      }
    }

    return stats;
  }

  /**
   * 获取子任务
   */
  async getChildren(parentId: string): Promise<Todo[]> {
    if (!this.isModelAvailable()) {
      return [];
    }

    const prismaModel = (this.prisma as unknown as Record<string, unknown>)
      .engineTodo as PrismaModelDelegate;

    const todos = await prismaModel.findMany({
      where: { parentId },
      orderBy: { createdAt: "asc" },
    });
    return (todos as Record<string, unknown>[]).map((t) => this.mapToTodo(t));
  }

  /**
   * 批量更新状态
   * 使用事务保证数据一致性
   */
  async batchUpdateStatus(
    ids: string[],
    status: TodoStatus,
    _updatedBy: string,
  ): Promise<Todo[]> {
    if (!this.isModelAvailable()) {
      return [];
    }

    const updateData: Record<string, unknown> = { status };
    if (status === "completed") {
      updateData.completedAt = new Date();
      updateData.progress = 100;
    }

    // ★ 使用事务保证 updateMany 和 findMany 的一致性
    return await this.prisma.$transaction(
      async (tx: unknown) => {
        const txModel = (tx as Record<string, unknown>)
          .engineTodo as PrismaModelDelegate;

        await txModel.updateMany({
          where: { id: { in: ids } },
          data: updateData,
        });

        const todos = await txModel.findMany({
          where: { id: { in: ids } },
        });

        return (todos as Record<string, unknown>[]).map((t) =>
          this.mapToTodo(t),
        );
      },
      { timeout: 30000 },
    ); // 30 秒超时
  }

  /**
   * 返回空的 TodoStats 默认值
   */
  private emptyStats(): TodoStats {
    return {
      total: 0,
      byStatus: {
        pending: 0,
        in_progress: 0,
        completed: 0,
        cancelled: 0,
        blocked: 0,
      },
      byPriority: {
        low: 0,
        medium: 0,
        high: 0,
        urgent: 0,
      },
      overdue: 0,
      completedThisWeek: 0,
    };
  }

  /**
   * 返回空的 Todo 占位值（仅供 create 在模型不可用时使用）
   */
  private emptyTodo(): Todo {
    return {
      id: "",
      type: "custom",
      title: "",
      entityType: "",
      entityId: "",
      createdBy: "",
      status: "pending",
      priority: "medium",
      labels: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * 映射数据库记录到 Todo 类型
   */
  private mapToTodo(record: Record<string, unknown>): Todo {
    return {
      id: record.id as string,
      type: record.type as Todo["type"],
      title: record.title as string,
      description: record.description as string | undefined,
      entityType: record.entityType as string,
      entityId: record.entityId as string,
      parentId: record.parentId as string | undefined,
      assigneeId: record.assigneeId as string | undefined,
      createdBy: record.createdBy as string,
      status: record.status as TodoStatus,
      priority: record.priority as Todo["priority"],
      labels: (record.labels as string[]) ?? [],
      dueDate: record.dueDate as Date | undefined,
      createdAt: record.createdAt as Date,
      updatedAt: record.updatedAt as Date,
      completedAt: record.completedAt as Date | undefined,
      progress: record.progress as number | undefined,
      blockedBy: record.blockedBy as string[] | undefined,
      metadata: record.metadata as Record<string, unknown> | undefined,
    };
  }
}

/**
 * 最小化 Prisma 模型委托接口，用于类型安全地调用动态模型方法。
 * Phase 4.1: EngineTodo / Review 模型实际不存在时，isModelAvailable() 会拦截调用。
 */
interface PrismaModelDelegate {
  create(args: {
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  findUnique(args: {
    where: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null>;
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, unknown> | Record<string, unknown>[];
    take?: number;
    skip?: number;
    select?: Record<string, unknown>;
  }): Promise<unknown[]>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  delete(args: {
    where: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}
