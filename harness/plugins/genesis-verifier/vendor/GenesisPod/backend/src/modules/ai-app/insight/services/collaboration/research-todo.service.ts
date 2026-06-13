/**
 * Research TODO Service
 *
 * 管理研究任务的 TODO 列表，提供任务可视化和进度追踪
 * 参考 Claude Code 的 TODO 机制设计
 *
 * 功能：
 * - TODO CRUD 操作
 * - 从 Mission 自动生成 TODO 列表
 * - 状态更新和进度追踪
 * - WebSocket 事件推送
 * - 数据库持久化
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  ResearchTodoStatus,
  ResearchTodoType,
  ResearchTaskStatus,
  Prisma,
  DimensionStatus,
} from "@prisma/client";
import type { ResearchTodo, ResearchMission } from "@prisma/client";
import { ResearchEventEmitterService } from "../core/research/research-event-emitter.service";
import { LeaderReviewService } from "../core/leader/leader-review.service";
import { BillingContext } from "@/modules/platform/facade";
import type { ReviewDecision } from "../../types/leader.types";
import { getModelDisplayNameMap } from "../../utils/model-display-name";
import {
  TodoEventType,
  type CreateTodoInput,
  type UpdateTodoProgressInput,
  type TodoFilter,
  type TodoSummary,
  type TodoResult,
} from "../../types/collaboration.types";

// ==================== Service ====================

@Injectable()
export class ResearchTodoService {
  private readonly logger = new Logger(ResearchTodoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: ResearchEventEmitterService,
    private readonly leaderReview: LeaderReviewService,
  ) {}

  // ==================== CRUD 操作 ====================

  /**
   * 创建新的 TODO
   */
  async createTodo(input: CreateTodoInput): Promise<ResearchTodo> {
    const todo = await this.prisma.researchTodo.create({
      data: {
        topicId: input.topicId,
        missionId: input.missionId,
        type: input.type,
        title: input.title,
        description: input.description,
        dimensionId: input.dimensionId,
        dimensionName: input.dimensionName,
        agentId: input.agentId,
        agentName: input.agentName,
        agentRole: input.agentRole,
        modelId: input.modelId, // ★ 保存 Agent 使用的模型 ID
        assignmentReason: input.assignmentReason, // ★ 保存 Leader 分配理由
        priority: input.priority ?? 0,
        dependsOn: input.dependsOn ?? [],
        estimatedMs: input.estimatedMs,
        userCanPause: input.userCanPause ?? true,
        userCanCancel: input.userCanCancel ?? true,
        userCanPrioritize: input.userCanPrioritize ?? true,
        status: ResearchTodoStatus.PENDING,
      },
    });

    // 发送 WebSocket 事件
    await this.emitTodoEvent(input.topicId, TodoEventType.TODO_CREATED, {
      todo: this.formatTodoForClient(todo),
    });

    this.logger.log(`[createTodo] Created TODO ${todo.id}: ${todo.title}`);
    return todo;
  }

  /**
   * 获取专题的 TODO 列表
   */
  async getTodos(
    topicId: string,
    filter?: TodoFilter,
  ): Promise<{ todos: ResearchTodo[]; summary: TodoSummary }> {
    const where: Prisma.ResearchTodoWhereInput = {
      topicId,
      ...(filter?.missionId && { missionId: filter.missionId }),
      ...(filter?.status?.length && { status: { in: filter.status } }),
      ...(filter?.type?.length && { type: { in: filter.type } }),
    };

    const todos = await this.prisma.researchTodo.findMany({
      where,
      orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "asc" }],
    });

    // ★ 2026-05-05 P1 修复：todo.modelId 与 task.modelId 不同步问题
    //   - todo.modelId 在 createTodo 时一次性写入 leader plan 的 assignment.modelId
    //   - task.modelId 在 task COMPLETED 时被 updateTaskStatus(actualModelId) 覆盖
    //   - 两表无主键关联，平行存在 → leader plan 没分配的 dim 在 todo 表里 modelId=NULL
    //     → 截图 9 模型列空白
    //   方案：批量从同 (mission, dimensionId) 的 ResearchTask.modelId 兜底
    const todosNeedingFallback = todos.filter(
      (t) => !t.modelId && t.missionId && t.dimensionId,
    );
    const dimToTaskModelId = new Map<string, string>();
    if (todosNeedingFallback.length > 0) {
      const fallbackTasks = await this.prisma.researchTask.findMany({
        where: {
          missionId: {
            in: Array.from(
              new Set(
                todosNeedingFallback
                  .map((t) => t.missionId)
                  .filter((id): id is string => !!id),
              ),
            ),
          },
          dimensionId: {
            in: todosNeedingFallback
              .map((t) => t.dimensionId)
              .filter((id): id is string => !!id),
          },
          modelId: { not: null },
        },
        select: { missionId: true, dimensionId: true, modelId: true },
      });
      for (const task of fallbackTasks) {
        if (task.dimensionId && task.modelId) {
          dimToTaskModelId.set(
            `${task.missionId}::${task.dimensionId}`,
            task.modelId,
          );
        }
      }
    }

    // ★ 批量查询模型展示名称（包含 fallback 来的）
    const allModelIds = new Set<string>();
    for (const t of todos) {
      const effectiveId =
        t.modelId ||
        (t.missionId && t.dimensionId
          ? dimToTaskModelId.get(`${t.missionId}::${t.dimensionId}`)
          : undefined);
      if (effectiveId) allModelIds.add(effectiveId);
    }
    const modelDisplayNameMap = await getModelDisplayNameMap(
      this.prisma,
      Array.from(allModelIds),
    );

    const enrichedTodos = todos.map((todo) => {
      const fallbackModelId =
        !todo.modelId && todo.missionId && todo.dimensionId
          ? dimToTaskModelId.get(`${todo.missionId}::${todo.dimensionId}`)
          : undefined;
      const effectiveModelId = todo.modelId || fallbackModelId || null;
      return {
        ...todo,
        modelId: effectiveModelId,
        modelDisplayName: effectiveModelId
          ? modelDisplayNameMap.get(effectiveModelId)
          : undefined,
      };
    });

    const summary = this.calculateSummary(todos);

    return { todos: enrichedTodos, summary };
  }

  /**
   * 获取单个 TODO 详情
   */
  async getTodoById(
    todoId: string,
  ): Promise<ResearchTodo & { modelDisplayName?: string }> {
    const todo = await this.prisma.researchTodo.findUnique({
      where: { id: todoId },
    });

    if (!todo) {
      throw new NotFoundException(`TODO ${todoId} not found`);
    }

    if (todo.modelId) {
      const map = await getModelDisplayNameMap(this.prisma, [todo.modelId]);
      return { ...todo, modelDisplayName: map.get(todo.modelId) };
    }

    return todo;
  }

  /**
   * 验证 TODO 属于指定专题。
   * 用于 controller 接收 URL 路径参数时的归属校验。
   * @throws NotFoundException 若 TODO 不存在或不属于该专题
   */
  async verifyTodoBelongsToTopic(
    todoId: string,
    topicId: string,
  ): Promise<void> {
    const todo = await this.prisma.researchTodo.findUnique({
      where: { id: todoId },
      select: { topicId: true },
    });
    if (!todo || todo.topicId !== topicId) {
      throw new NotFoundException(`TODO ${todoId} not found`);
    }
  }

  /**
   * 验证 ID 属于指定专题 —— 支持 ResearchTodo 或 ResearchTask。
   * 前端的 "retry" 端点会把两种 ID 混用，此方法统一归属校验。
   * @returns "todo" | "task" 命中哪种实体
   * @throws NotFoundException 若两种实体都不属于该专题
   */
  async verifyTodoOrTaskBelongsToTopic(
    id: string,
    topicId: string,
  ): Promise<"todo" | "task"> {
    const todo = await this.prisma.researchTodo.findUnique({
      where: { id },
      select: { topicId: true },
    });
    if (todo) {
      if (todo.topicId !== topicId) {
        throw new NotFoundException(`TODO ${id} not found`);
      }
      return "todo";
    }

    const task = await this.prisma.researchTask.findUnique({
      where: { id },
      select: { mission: { select: { topicId: true } } },
    });
    if (!task || task.mission.topicId !== topicId) {
      throw new NotFoundException(`TODO ${id} not found`);
    }
    return "task";
  }

  /**
   * 获取 TODO 详情（包含关联的 Agent 活动）
   * ★ 修复：USER_REQUEST 类型的 TODO 不应显示其他任务的活动
   */
  async getTodoDetails(todoId: string): Promise<{
    todo: ResearchTodo;
    activities: unknown[];
  }> {
    const todo = await this.getTodoById(todoId);

    // ★ 对于 USER_REQUEST 类型的 TODO，只有在执行后才有活动记录
    // 未执行的用户请求不应显示其他任务的活动
    if (todo.type === "USER_REQUEST") {
      // USER_REQUEST TODO 暂无关联活动（除非我们将来支持记录执行过程）
      return { todo, activities: [] };
    }

    // 其他类型的 TODO：根据维度或代理过滤
    const whereCondition: Prisma.ResearchAgentActivityWhereInput = {
      topicId: todo.topicId,
      missionId: todo.missionId,
    };

    if (todo.dimensionId) {
      // 维度研究 TODO：只显示该维度的活动
      whereCondition.dimensionId = todo.dimensionId;
    } else if (todo.agentId) {
      // 有明确代理的 TODO
      whereCondition.agentId = todo.agentId;
    } else {
      // 没有维度也没有代理，返回空（避免返回所有活动）
      return { todo, activities: [] };
    }

    const activities = await this.prisma.researchAgentActivity.findMany({
      where: whereCondition,
      orderBy: { createdAt: "asc" },
    });

    return { todo, activities };
  }

  // ==================== 状态管理 ====================

  /**
   * 更新 TODO 状态
   */
  async updateTodoStatus(
    todoId: string,
    newStatus: ResearchTodoStatus,
    message?: string,
  ): Promise<ResearchTodo> {
    const todo = await this.getTodoById(todoId);
    const oldStatus = todo.status;

    // 验证状态转换
    this.validateStatusTransition(oldStatus, newStatus);

    // 更新字段
    const updateData: Prisma.ResearchTodoUpdateInput = {
      status: newStatus,
      ...(message && { statusMessage: message }),
    };

    // 状态特定更新
    if (newStatus === ResearchTodoStatus.IN_PROGRESS && !todo.startedAt) {
      updateData.startedAt = new Date();
    }

    if (
      newStatus === ResearchTodoStatus.COMPLETED ||
      newStatus === ResearchTodoStatus.FAILED ||
      newStatus === ResearchTodoStatus.CANCELLED
    ) {
      updateData.completedAt = new Date();
      if (todo.startedAt) {
        updateData.actualMs = Date.now() - todo.startedAt.getTime();
      }
    }

    const updatedTodo = await this.prisma.researchTodo.update({
      where: { id: todoId },
      data: updateData,
    });

    // 发送状态变更事件
    await this.emitTodoEvent(todo.topicId, TodoEventType.TODO_STATUS_CHANGED, {
      todoId,
      oldStatus,
      newStatus,
      message,
      todo: this.formatTodoForClient(updatedTodo),
    });

    this.logger.log(
      `[updateTodoStatus] TODO ${todoId}: ${oldStatus} -> ${newStatus}`,
    );
    return updatedTodo;
  }

  /**
   * 更新 TODO 进度
   */
  async updateTodoProgress(
    todoId: string,
    input: UpdateTodoProgressInput,
  ): Promise<ResearchTodo> {
    const todo = await this.getTodoById(todoId);

    // 只有进行中的任务才能更新进度
    if (todo.status !== ResearchTodoStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Cannot update progress for TODO with status ${todo.status}`,
      );
    }

    const updatedTodo = await this.prisma.researchTodo.update({
      where: { id: todoId },
      data: {
        progress: Math.min(100, Math.max(0, input.progress)),
        statusMessage: input.statusMessage,
      },
    });

    // 发送进度事件
    await this.emitTodoEvent(todo.topicId, TodoEventType.TODO_PROGRESS, {
      todoId,
      progress: updatedTodo.progress,
      statusMessage: input.statusMessage,
    });

    return updatedTodo;
  }

  /**
   * 完成 TODO（带结果）
   */
  async completeTodo(
    todoId: string,
    result?: TodoResult,
  ): Promise<ResearchTodo> {
    const todo = await this.getTodoById(todoId);

    const updatedTodo = await this.prisma.researchTodo.update({
      where: { id: todoId },
      data: {
        status: ResearchTodoStatus.COMPLETED,
        progress: 100,
        completedAt: new Date(),
        actualMs: todo.startedAt ? Date.now() - todo.startedAt.getTime() : null,
        result: result ? (result as Prisma.InputJsonValue) : undefined,
        statusMessage: "已完成",
      },
    });

    // 发送完成事件
    await this.emitTodoEvent(todo.topicId, TodoEventType.TODO_COMPLETED, {
      todoId,
      result,
      duration: updatedTodo.actualMs,
      todo: this.formatTodoForClient(updatedTodo),
    });

    this.logger.log(`[completeTodo] TODO ${todoId} completed`);
    return updatedTodo;
  }

  /**
   * 标记 TODO 失败
   */
  async failTodo(todoId: string, error: string): Promise<ResearchTodo> {
    const todo = await this.getTodoById(todoId);

    const updatedTodo = await this.prisma.researchTodo.update({
      where: { id: todoId },
      data: {
        status: ResearchTodoStatus.FAILED,
        completedAt: new Date(),
        actualMs: todo.startedAt ? Date.now() - todo.startedAt.getTime() : null,
        result: { error } as Prisma.InputJsonValue,
        statusMessage: `失败: ${error}`,
      },
    });

    // 发送失败事件
    await this.emitTodoEvent(todo.topicId, TodoEventType.TODO_FAILED, {
      todoId,
      error,
      canRetry: true,
      todo: this.formatTodoForClient(updatedTodo),
    });

    this.logger.error(`[failTodo] TODO ${todoId} failed: ${error}`);
    return updatedTodo;
  }

  // ==================== 用户操作 ====================

  /**
   * ★ 更新 TODO 内容（标题和描述）
   * 仅限 USER_REQUEST 类型且状态为 PENDING 的 TODO
   */
  async updateTodoContent(
    todoId: string,
    input: { title?: string; description?: string },
  ): Promise<ResearchTodo> {
    const todo = await this.getTodoById(todoId);

    // 只允许编辑 USER_REQUEST 类型
    if (todo.type !== "USER_REQUEST") {
      throw new BadRequestException("只能编辑用户请求类型的任务");
    }

    // 只允许编辑 PENDING 状态
    if (todo.status !== ResearchTodoStatus.PENDING) {
      throw new BadRequestException("只能编辑待处理状态的任务");
    }

    const updatedTodo = await this.prisma.researchTodo.update({
      where: { id: todoId },
      data: {
        ...(input.title && { title: input.title }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
      },
    });

    this.logger.log(`[updateTodoContent] TODO ${todoId} updated`);
    return updatedTodo;
  }

  /**
   * ★ 删除 TODO
   * 仅限 USER_REQUEST 类型且状态为 PENDING 的 TODO
   */
  async deleteTodo(todoId: string): Promise<void> {
    const todo = await this.getTodoById(todoId);

    // 只允许删除 USER_REQUEST 类型
    if (todo.type !== "USER_REQUEST") {
      throw new BadRequestException("只能删除用户请求类型的任务");
    }

    // 只允许删除 PENDING 状态
    if (todo.status !== ResearchTodoStatus.PENDING) {
      throw new BadRequestException("只能删除待处理状态的任务");
    }

    await this.prisma.researchTodo.delete({
      where: { id: todoId },
    });

    // 发送删除事件
    await this.emitTodoEvent(todo.topicId, TodoEventType.TODO_STATUS_CHANGED, {
      todoId,
      oldStatus: todo.status,
      newStatus: "DELETED",
      message: "用户已删除",
    });

    this.logger.log(`[deleteTodo] TODO ${todoId} deleted`);
  }

  /**
   * 暂停 TODO
   */
  async pauseTodo(todoId: string): Promise<ResearchTodo> {
    const todo = await this.getTodoById(todoId);

    if (!todo.userCanPause) {
      throw new BadRequestException("This TODO cannot be paused");
    }

    if (todo.status !== ResearchTodoStatus.IN_PROGRESS) {
      throw new BadRequestException("Only in-progress TODOs can be paused");
    }

    const updatedTodo = await this.prisma.researchTodo.update({
      where: { id: todoId },
      data: {
        status: ResearchTodoStatus.PAUSED,
        statusMessage: "用户已暂停",
      },
    });

    await this.emitTodoEvent(todo.topicId, TodoEventType.TODO_PAUSED, {
      todoId,
      todo: this.formatTodoForClient(updatedTodo),
    });

    this.logger.log(`[pauseTodo] TODO ${todoId} paused by user`);
    return updatedTodo;
  }

  /**
   * 恢复 TODO
   */
  async resumeTodo(todoId: string): Promise<ResearchTodo> {
    const todo = await this.getTodoById(todoId);

    if (todo.status !== ResearchTodoStatus.PAUSED) {
      throw new BadRequestException("Only paused TODOs can be resumed");
    }

    const updatedTodo = await this.prisma.researchTodo.update({
      where: { id: todoId },
      data: {
        status: ResearchTodoStatus.IN_PROGRESS,
        statusMessage: "已恢复执行",
      },
    });

    await this.emitTodoEvent(todo.topicId, TodoEventType.TODO_RESUMED, {
      todoId,
      todo: this.formatTodoForClient(updatedTodo),
    });

    this.logger.log(`[resumeTodo] TODO ${todoId} resumed by user`);
    return updatedTodo;
  }

  /**
   * 取消 TODO
   */
  async cancelTodo(todoId: string, reason?: string): Promise<ResearchTodo> {
    const todo = await this.getTodoById(todoId);

    if (!todo.userCanCancel) {
      throw new BadRequestException("This TODO cannot be cancelled");
    }

    const cancellableStatuses: ResearchTodoStatus[] = [
      ResearchTodoStatus.PENDING,
      ResearchTodoStatus.QUEUED,
      ResearchTodoStatus.PAUSED,
    ];

    if (!cancellableStatuses.includes(todo.status)) {
      throw new BadRequestException(
        `Cannot cancel TODO with status ${todo.status}`,
      );
    }

    const updatedTodo = await this.prisma.researchTodo.update({
      where: { id: todoId },
      data: {
        status: ResearchTodoStatus.CANCELLED,
        completedAt: new Date(),
        statusMessage: reason || "用户已取消",
      },
    });

    await this.emitTodoEvent(todo.topicId, TodoEventType.TODO_CANCELLED, {
      todoId,
      reason,
      todo: this.formatTodoForClient(updatedTodo),
    });

    this.logger.log(`[cancelTodo] TODO ${todoId} cancelled: ${reason}`);
    return updatedTodo;
  }

  /**
   * 重试失败的 TODO
   */
  async retryTodo(todoId: string): Promise<ResearchTodo> {
    const todo = await this.getTodoById(todoId);

    if (todo.status !== ResearchTodoStatus.FAILED) {
      throw new BadRequestException("Only failed TODOs can be retried");
    }

    const updatedTodo = await this.prisma.researchTodo.update({
      where: { id: todoId },
      data: {
        status: ResearchTodoStatus.QUEUED,
        progress: 0,
        startedAt: null,
        completedAt: null,
        actualMs: null,
        result: Prisma.DbNull,
        statusMessage: "等待重试",
      },
    });

    await this.emitTodoEvent(todo.topicId, TodoEventType.TODO_STATUS_CHANGED, {
      todoId,
      oldStatus: ResearchTodoStatus.FAILED,
      newStatus: ResearchTodoStatus.QUEUED,
      message: "任务已重新排队",
      todo: this.formatTodoForClient(updatedTodo),
    });

    this.logger.log(`[retryTodo] TODO ${todoId} queued for retry`);
    return updatedTodo;
  }

  /**
   * 调整 TODO 优先级
   */
  async prioritizeTodo(
    todoId: string,
    priority: "high" | "normal" | "low",
  ): Promise<ResearchTodo> {
    const todo = await this.getTodoById(todoId);

    if (!todo.userCanPrioritize) {
      throw new BadRequestException("This TODO cannot be prioritized");
    }

    const priorityValue = {
      high: 100,
      normal: 0,
      low: -100,
    }[priority];

    const updatedTodo = await this.prisma.researchTodo.update({
      where: { id: todoId },
      data: { priority: priorityValue },
    });

    this.logger.log(
      `[prioritizeTodo] TODO ${todoId} priority set to ${priority}`,
    );
    return updatedTodo;
  }

  // ==================== Mission 集成 ====================

  /**
   * 从 Mission 生成 TODO 列表
   * 在 Leader 规划完成后调用
   */
  async generateTodosFromMission(
    mission: ResearchMission,
    leaderPlan: {
      dimensions?: Array<{
        id?: string;
        dimensionId?: string;
        name?: string;
        dimensionName?: string;
        description?: string;
      }>;
      agentAssignments?: Array<{
        agentType?: string;
        assignedDimensions?: string[];
        agentId?: string;
        agentName?: string;
        modelId?: string;
        assignmentReason?: {
          agentReason?: string;
          modelReason?: string;
        };
      }>;
    },
  ): Promise<ResearchTodo[]> {
    const todos: ResearchTodo[] = [];
    const topicId = mission.topicId;
    const missionId = mission.id;

    this.logger.log(
      `[generateTodosFromMission] Generating TODOs for mission ${missionId}`,
    );

    // 1. Leader 规划 TODO（已完成）
    const leaderTodo = await this.createTodo({
      topicId,
      missionId,
      type: ResearchTodoType.LEADER_PLANNING,
      title: "Leader 任务理解与规划",
      description: "Leader 分析研究主题，制定研究策略和任务分配",
      agentId: "leader",
      agentName: "研究协调员",
      agentRole: "leader",
      assignmentReason: {
        agentReason:
          "Leader 负责全局规划和任务协调，具备任务分解和策略制定能力",
        modelReason: "使用推理模型进行复杂的任务理解和规划决策",
      },
      priority: 1000,
      userCanPause: false,
      userCanCancel: false,
    });
    // 立即标记为完成
    await this.completeTodo(leaderTodo.id, {
      keyFindings: leaderPlan?.dimensions?.length || 0,
    });
    todos.push(leaderTodo);

    // 2. 为每个维度创建研究 TODO
    const dimensions = leaderPlan?.dimensions || [];
    const agentAssignments = leaderPlan?.agentAssignments || [];
    const dimensionTodoIds: string[] = [];

    for (let i = 0; i < dimensions.length; i++) {
      const dim = dimensions[i];
      const dimId = dim.id || dim.dimensionId;

      // ★ 查找此维度对应的 Agent 分配，获取 modelId
      const assignment = agentAssignments.find(
        (a) =>
          a.agentType === "dimension_researcher" &&
          dimId &&
          a.assignedDimensions?.includes(dimId),
      );

      const todoName = dim.name || dim.dimensionName || "未命名维度";
      const dimensionTodo = await this.createTodo({
        topicId,
        missionId,
        type: ResearchTodoType.DIMENSION_RESEARCH,
        title: `${todoName}维度研究`,
        description: dim.description || `研究 ${todoName} 相关内容`,
        dimensionId: dimId || "",
        dimensionName: todoName,
        agentId: assignment?.agentId || `researcher-${i + 1}`,
        agentName: assignment?.agentName || `研究员 ${i + 1}`,
        agentRole: "researcher",
        modelId: assignment?.modelId, // ★ 保存分配的模型 ID
        assignmentReason: assignment?.assignmentReason || {
          agentReason: `研究员专注于「${todoName}」领域的深度信息收集和分析`,
          modelReason: "使用擅长信息检索和内容分析的模型",
        },
        priority: 500 - i,
        dependsOn: [leaderTodo.id],
        estimatedMs: 120000, // 预估 2 分钟
      });
      dimensionTodoIds.push(dimensionTodo.id);
      todos.push(dimensionTodo);
    }

    // 3. 报告撰写 TODO
    const reportTodo = await this.createTodo({
      topicId,
      missionId,
      type: ResearchTodoType.REPORT_WRITING,
      title: "报告撰写",
      description: "整合各维度研究结果，撰写完整研究报告",
      agentId: "synthesizer",
      agentName: "报告撰写员",
      agentRole: "synthesizer",
      assignmentReason: {
        agentReason: "综合撰写员擅长整合多维度研究成果，生成结构化的专业报告",
        modelReason: "使用具有强大语言生成和总结能力的模型",
      },
      priority: 100,
      dependsOn: dimensionTodoIds,
      estimatedMs: 180000, // 预估 3 分钟
    });
    todos.push(reportTodo);

    // 4. 质量审核 TODO
    const reviewTodo = await this.createTodo({
      topicId,
      missionId,
      type: ResearchTodoType.QUALITY_REVIEW,
      title: "质量审核",
      description: "审核研究报告质量，确保内容准确性和完整性",
      agentId: "reviewer",
      agentName: "质量审核员",
      agentRole: "reviewer",
      assignmentReason: {
        agentReason: "质量审核员专注于内容准确性、逻辑一致性和完整性检查",
        modelReason: "使用擅长一致性检查和质量评估的模型",
      },
      priority: 50,
      dependsOn: [reportTodo.id],
      estimatedMs: 60000, // 预估 1 分钟
    });
    todos.push(reviewTodo);

    this.logger.log(
      `[generateTodosFromMission] Generated ${todos.length} TODOs for mission ${missionId}`,
    );

    return todos;
  }

  /**
   * 获取下一个可执行的 TODO
   * 根据依赖关系和优先级
   */
  async getNextExecutableTodo(missionId: string): Promise<ResearchTodo | null> {
    // 获取所有待执行的 TODO
    const pendingTodos = await this.prisma.researchTodo.findMany({
      where: {
        missionId,
        status: {
          in: [ResearchTodoStatus.PENDING, ResearchTodoStatus.QUEUED],
        },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });

    if (pendingTodos.length === 0) {
      return null;
    }

    // 获取已完成的 TODO ID
    const completedTodos = await this.prisma.researchTodo.findMany({
      where: {
        missionId,
        status: ResearchTodoStatus.COMPLETED,
      },
      select: { id: true },
    });
    const completedIds = new Set(completedTodos.map((t) => t.id));

    // 找到第一个依赖都已完成的 TODO
    for (const todo of pendingTodos) {
      const dependencies = todo.dependsOn || [];
      const allDepsCompleted = dependencies.every((depId) =>
        completedIds.has(depId),
      );

      if (allDepsCompleted) {
        return todo;
      }
    }

    return null;
  }

  /**
   * 检查 TODO 依赖是否满足
   */
  async checkDependencies(todoId: string): Promise<boolean> {
    const todo = await this.getTodoById(todoId);
    const dependencies = todo.dependsOn || [];

    if (dependencies.length === 0) {
      return true;
    }

    const completedCount = await this.prisma.researchTodo.count({
      where: {
        id: { in: dependencies },
        status: ResearchTodoStatus.COMPLETED,
      },
    });

    return completedCount === dependencies.length;
  }

  /**
   * 创建用户请求的 TODO
   */
  async createUserRequestTodo(
    topicId: string,
    missionId: string,
    title: string,
    description?: string,
  ): Promise<ResearchTodo> {
    return this.createTodo({
      topicId,
      missionId,
      type: ResearchTodoType.USER_REQUEST,
      title,
      description,
      agentId: "leader",
      agentName: "研究协调员",
      agentRole: "leader",
      priority: 800, // 用户请求优先级较高
    });
  }

  /**
   * ★ v7.2: 调度 TODO 任务
   * 将 TODO 加入任务队列，根据当前队列状态决定是否立即执行
   *
   * 调度策略：
   * 1. 如果当前没有正在执行的 USER_REQUEST 任务 → 立即执行
   * 2. 如果有正在执行的任务 → 仅入队，等待前序任务完成后自动触发
   *
   * @param topicId 专题 ID
   * @param todoId TODO ID
   */
  async scheduleTodo(topicId: string, todoId: string): Promise<void> {
    this.logger.log(`[scheduleTodo] Scheduling TODO ${todoId} for execution`);

    // 1. 获取 TODO 信息
    const todo = await this.prisma.researchTodo.findUnique({
      where: { id: todoId },
    });

    if (!todo) {
      throw new NotFoundException(`TODO ${todoId} not found`);
    }

    if (todo.status !== ResearchTodoStatus.PENDING) {
      this.logger.warn(
        `[scheduleTodo] TODO ${todoId} is not PENDING (status: ${todo.status}), skipping`,
      );
      return;
    }

    // 2. 检查当前是否有正在执行的 USER_REQUEST 任务
    const runningTodos = await this.prisma.researchTodo.count({
      where: {
        topicId,
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.IN_PROGRESS,
      },
    });

    // 3. 更新 TODO 状态为 QUEUED
    const updatedTodo = await this.prisma.researchTodo.update({
      where: { id: todoId },
      data: {
        status: ResearchTodoStatus.QUEUED,
        statusMessage:
          runningTodos > 0
            ? `排队中（前方 ${runningTodos} 个任务），等待 ${todo.agentName || "研究员"} 执行...`
            : `已分配给 ${todo.agentName || "研究员"}，准备执行...`,
      },
    });

    // 发送状态更新事件
    await this.emitTodoEvent(topicId, TodoEventType.TODO_STATUS_CHANGED, {
      todoId,
      oldStatus: ResearchTodoStatus.PENDING,
      newStatus: ResearchTodoStatus.QUEUED,
      message: `任务已分配给 ${todo.agentName || "研究员"}，${runningTodos > 0 ? "排队等待" : "准备执行"}`,
      todo: this.formatTodoForClient(updatedTodo),
    });

    // 4. 根据队列状态决定是否立即执行
    // ★ 捕获 BillingContext，fire-and-forget 路径需要显式传播
    const billingCtx = BillingContext.get();

    if (runningTodos === 0) {
      // 没有正在执行的任务，立即开始
      this.logger.log(
        `[scheduleTodo] No running tasks, starting TODO ${todoId} immediately`,
      );
      const startFn = () => this.executeTodo(topicId, todoId);
      const wrapped = billingCtx
        ? () => BillingContext.run(billingCtx, startFn)
        : startFn;
      void wrapped().catch((error: Error) => {
        this.logger.error(
          `[scheduleTodo] Failed to execute TODO ${todoId}: ${error.message}`,
        );
      });
    } else {
      // 有任务在执行，等待其完成后由 processNextQueuedTodo 触发
      this.logger.log(
        `[scheduleTodo] ${runningTodos} tasks running, TODO ${todoId} queued for later`,
      );
    }
  }

  /**
   * ★ v7.2: 处理队列中的下一个 TODO
   * 在当前任务完成后调用，检查并执行下一个排队的任务
   *
   * @param topicId 专题 ID
   */
  async processNextQueuedTodo(topicId: string): Promise<void> {
    // 检查是否有正在执行的任务
    const runningCount = await this.prisma.researchTodo.count({
      where: {
        topicId,
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.IN_PROGRESS,
      },
    });

    if (runningCount > 0) {
      this.logger.log(
        `[processNextQueuedTodo] ${runningCount} tasks still running, skip`,
      );
      return;
    }

    // 获取下一个排队的任务（按优先级和创建时间排序）
    const nextTodo = await this.prisma.researchTodo.findFirst({
      where: {
        topicId,
        type: ResearchTodoType.USER_REQUEST,
        status: ResearchTodoStatus.QUEUED,
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });

    if (!nextTodo) {
      this.logger.log(`[processNextQueuedTodo] No queued tasks for ${topicId}`);
      return;
    }

    this.logger.log(
      `[processNextQueuedTodo] Starting next queued TODO: ${nextTodo.id}`,
    );

    // ★ 确保 BillingContext 传播到 fire-and-forget 的 executeTodo
    const existingCtx = BillingContext.get();
    const startFn = () => this.executeTodo(topicId, nextTodo.id);
    const wrapped = existingCtx
      ? () => BillingContext.run(existingCtx, startFn)
      : async () => {
          // BillingContext 可能在前一个 TODO 结束时丢失，从 DB 恢复
          const topic = await this.prisma.researchTopic.findUnique({
            where: { id: topicId },
            select: { userId: true },
          });
          if (topic?.userId) {
            return BillingContext.run(
              {
                userId: topic.userId,
                moduleType: "topic-insights",
                operationType: "research",
                referenceId: topicId,
              },
              startFn,
            );
          }
          return startFn();
        };

    void wrapped().catch((error: Error) => {
      this.logger.error(
        `[processNextQueuedTodo] Failed to execute TODO ${nextTodo.id}: ${error.message}`,
      );
    });
  }

  /**
   * ★ v7.2: Leader 审核 TODO 执行结果
   *
   * @param topicId 专题 ID
   * @param todo TODO 信息
   * @param executionResult 执行结果描述
   * @returns 审核决策
   */
  private async reviewTodoResult(
    topicId: string,
    todo: ResearchTodo,
    executionResult: string,
  ): Promise<ReviewDecision> {
    this.logger.log(`[reviewTodoResult] Leader reviewing TODO ${todo.id}`);

    // 发送审核中事件
    await this.emitTodoEvent(topicId, TodoEventType.TODO_REVIEWING, {
      todoId: todo.id,
      message: "Leader 正在审核研究成果...",
      todo: this.formatTodoForClient(todo),
    });

    // 更新状态消息
    await this.prisma.researchTodo.update({
      where: { id: todo.id },
      data: {
        progress: 95,
        statusMessage: "Leader 正在审核研究成果...",
      },
    });

    try {
      // 调用 Leader 审核服务
      if (!todo.missionId) {
        // 没有 Mission，默认通过
        this.logger.log(
          `[reviewTodoResult] No mission for TODO ${todo.id}, auto-approve`,
        );
        return {
          taskId: todo.id,
          status: "approved",
          feedback: "任务完成（无需审核）",
        };
      }

      const reviewResult = await this.leaderReview.reviewTaskResult(
        todo.missionId,
        todo.id,
        {
          todoTitle: todo.title,
          todoDescription: todo.description,
          executionResult,
          agentName: todo.agentName,
          agentId: todo.agentId,
        },
        todo.dimensionName || todo.title,
      );

      this.logger.log(
        `[reviewTodoResult] Review result for TODO ${todo.id}: ${reviewResult.status}`,
      );

      return reviewResult;
    } catch (error) {
      // 审核失败时默认通过，避免阻塞流程
      this.logger.error(
        `[reviewTodoResult] Review failed for TODO ${todo.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return {
        taskId: todo.id,
        status: "approved",
        feedback: "审核服务异常，默认通过",
      };
    }
  }

  /**
   * ★ 执行用户请求的 TODO
   * 解析 TODO 内容，执行相应操作（如新增维度并研究）
   */
  async executeTodo(
    topicId: string,
    todoId: string,
  ): Promise<{ todo: ResearchTodo; message: string }> {
    this.logger.log(`[executeTodo] Starting execution for TODO ${todoId}`);

    // 1. 获取 TODO 信息
    const todo = await this.prisma.researchTodo.findUnique({
      where: { id: todoId },
    });

    if (!todo) {
      throw new NotFoundException(`TODO ${todoId} not found`);
    }

    // 2. 验证 TODO 类型和状态
    if (todo.type !== ResearchTodoType.USER_REQUEST) {
      throw new BadRequestException(
        `Only USER_REQUEST type TODOs can be executed. Got: ${todo.type}`,
      );
    }

    // ★ v7.2: 允许 PENDING 或 QUEUED 状态的 TODO 执行
    if (
      todo.status !== ResearchTodoStatus.PENDING &&
      todo.status !== ResearchTodoStatus.QUEUED
    ) {
      throw new BadRequestException(
        `TODO must be in PENDING or QUEUED status to execute. Current: ${todo.status}`,
      );
    }

    const previousStatus = todo.status;

    // 3. 更新状态为 IN_PROGRESS
    const updatedTodo = await this.prisma.researchTodo.update({
      where: { id: todoId },
      data: {
        status: ResearchTodoStatus.IN_PROGRESS,
        startedAt: new Date(),
        statusMessage: `${todo.agentName || "研究员"} 正在执行任务...`,
      },
    });

    // 发送状态更新事件
    await this.emitTodoEvent(topicId, TodoEventType.TODO_STATUS_CHANGED, {
      todoId,
      oldStatus: previousStatus,
      newStatus: ResearchTodoStatus.IN_PROGRESS,
      message: "正在执行用户请求...",
      todo: this.formatTodoForClient(updatedTodo),
    });

    // 4. 解析 TODO 内容，判断要执行什么操作
    const todoTitle = (todo.title || "").toLowerCase();
    const todoDesc = (todo.description || "").toLowerCase();

    let resultMessage = "";

    try {
      // ★ 判断是否需要新增维度/章节
      const isAddDimension =
        todoTitle.includes("新增维度") ||
        todoTitle.includes("添加维度") ||
        todoTitle.includes("新增章节") ||
        todoTitle.includes("添加章节") ||
        todoTitle.includes("独立章节") ||
        todoDesc.includes("新增维度") ||
        todoDesc.includes("新增章节") ||
        // 匹配 "研究: xxx" 格式（Leader 创建的研究任务）
        /^研究[:：]/.test(todoTitle) ||
        // 匹配用户请求的研究相关任务（如"构建xxx"、"分析xxx"、"梳理xxx"等）
        todoTitle.includes("构建") ||
        todoTitle.includes("梳理") ||
        todoTitle.includes("整理") ||
        todoTitle.includes("总结") ||
        todoTitle.includes("归纳") ||
        todoTitle.includes("补充") ||
        todoTitle.includes("完善");

      // ★ 标记是否是"入队列"操作（这些操作只创建任务，实际研究会单独审核）
      const isDeepResearch =
        todoTitle.includes("深入研究") ||
        todoTitle.includes("详细分析") ||
        todoTitle.includes("分析");

      // ★ "入队列"操作：创建维度/深入研究只是把任务加入队列，不需要审核
      // 实际的研究工作会在 ResearchTask 执行完成后由质量审核任务统一审核
      const isQueueOperation = isAddDimension || isDeepResearch;

      if (isAddDimension) {
        // 新增维度/章节操作
        resultMessage = await this.executeAddDimension(topicId, todo);
      } else if (isDeepResearch) {
        // 深入研究操作
        resultMessage = await this.executeDeepResearch(topicId, todo);
      } else {
        // 通用执行：标记为完成
        resultMessage = `任务「${todo.title}」已记录，将在后续研究中考虑`;
      }

      // 5. ★ v7.4: 只对非"入队列"操作进行 Leader 审核
      // "入队列"操作（新增维度、深入研究）的实际研究会在 ResearchTask 完成后审核
      let finalStatus: ResearchTodoStatus;
      let finalMessage: string;

      if (isQueueOperation) {
        // ★ 跳过审核：入队列操作直接标记为完成
        // 实际研究会在 ResearchTask 执行完成后由质量审核任务统一审核
        finalStatus = ResearchTodoStatus.COMPLETED;
        finalMessage = resultMessage;
        this.logger.log(
          `[executeTodo] Skipping review for queue operation: ${todo.title}`,
        );
      } else {
        // 非入队列操作：进行 Leader 审核
        const reviewResult = await this.reviewTodoResult(
          topicId,
          todo,
          resultMessage,
        );

        if (reviewResult.status === "approved") {
          finalStatus = ResearchTodoStatus.COMPLETED;
          finalMessage = `${resultMessage}\n\n✅ Leader 审核通过: ${reviewResult.feedback}`;
        } else if (reviewResult.status === "needs_revision") {
          // 需要修订：标记为失败，用户可以重试
          finalStatus = ResearchTodoStatus.FAILED;
          finalMessage = `⚠️ Leader 要求修订: ${reviewResult.feedback}${reviewResult.revisionInstructions ? `\n修订建议: ${reviewResult.revisionInstructions}` : ""}`;
        } else {
          // rejected
          finalStatus = ResearchTodoStatus.FAILED;
          finalMessage = `❌ Leader 审核未通过: ${reviewResult.feedback}`;
        }
      }

      const completedTodo = await this.prisma.researchTodo.update({
        where: { id: todoId },
        data: {
          status: finalStatus,
          progress: finalStatus === ResearchTodoStatus.COMPLETED ? 100 : 90,
          completedAt: new Date(),
          actualMs: updatedTodo.startedAt
            ? Date.now() - updatedTodo.startedAt.getTime()
            : null,
          statusMessage: finalMessage,
        },
      });

      // 发送完成/失败事件
      if (finalStatus === ResearchTodoStatus.COMPLETED) {
        await this.emitTodoEvent(topicId, TodoEventType.TODO_COMPLETED, {
          todoId,
          result: { message: finalMessage },
          duration: completedTodo.actualMs,
          todo: this.formatTodoForClient(completedTodo),
        });
      } else {
        await this.emitTodoEvent(topicId, TodoEventType.TODO_FAILED, {
          todoId,
          error: finalMessage,
          todo: this.formatTodoForClient(completedTodo),
        });
      }

      this.logger.log(
        `[executeTodo] TODO ${todoId} completed with status: ${finalStatus}`,
      );

      // ★ v7.2: 任务完成后，检查并执行队列中的下一个任务
      void this.processNextQueuedTodo(topicId).catch((err: Error) => {
        this.logger.error(
          `[executeTodo] Failed to process next queued todo: ${err.message}`,
        );
      });

      return {
        todo: completedTodo,
        message: finalMessage,
      };
    } catch (error) {
      // 执行失败，更新状态
      const failedTodo = await this.prisma.researchTodo.update({
        where: { id: todoId },
        data: {
          status: ResearchTodoStatus.FAILED,
          statusMessage: `执行失败: ${error instanceof Error ? error.message : "未知错误"}`,
        },
      });

      await this.emitTodoEvent(topicId, TodoEventType.TODO_FAILED, {
        todo: this.formatTodoForClient(failedTodo),
        error: error instanceof Error ? error.message : "未知错误",
      });

      // ★ v7.2: 即使失败也要处理队列中的下一个任务
      void this.processNextQueuedTodo(topicId).catch((err: Error) => {
        this.logger.error(
          `[executeTodo] Failed to process next queued todo after failure: ${err.message}`,
        );
      });

      throw error;
    }
  }

  /**
   * 执行新增维度操作
   * ★ v7.3: 任务加入 Mission 调度队列，而非直接执行（修复插队问题）
   */
  private async executeAddDimension(
    topicId: string,
    todo: ResearchTodo,
  ): Promise<string> {
    this.logger.log(
      `[executeAddDimension] Adding new dimension for topic ${topicId}`,
    );

    // 从 title 或 description 中提取维度名称
    const todoTitleStr = todo.title || "";
    const titleMatch = todoTitleStr.match(/[：:「](.+?)[」]?$/);
    const dimensionName = titleMatch
      ? titleMatch[1].trim()
      : todoTitleStr.replace(/新增维度|添加维度|[：:]/g, "").trim();

    // 获取 topic 信息
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    // 创建新维度（绑定到当前 mission，与 schema 隔离规则一致）
    const dimension = await this.prisma.topicDimension.create({
      data: {
        topicId,
        missionId: todo.missionId ?? null,
        name: dimensionName,
        description: todo.description || `用户请求新增的维度：${dimensionName}`,
        status: DimensionStatus.PENDING,
        sortOrder: 100,
        searchQueries: [dimensionName], // 使用维度名作为初始搜索词
      },
    });

    this.logger.log(
      `[executeAddDimension] Created dimension ${dimension.id}: ${dimensionName} (mission=${todo.missionId ?? "none"})`,
    );

    // ★ v7.3: 创建 ResearchTask 并加入调度队列（PENDING 状态）
    // 任务将由 Mission 的 startExecution 循环调度执行，而非直接执行
    let task = null;
    let queuePosition = 0;
    if (todo.missionId) {
      // 获取当前队列中的最大优先级，新任务排在最后
      const existingTasks = await this.prisma.researchTask.findMany({
        where: {
          missionId: todo.missionId,
          taskType: "dimension_research",
        },
        orderBy: { priority: "desc" },
        take: 1,
      });

      // 新任务优先级 = 当前最大优先级 + 1（排在队列末尾）
      const maxPriority = existingTasks[0]?.priority || 0;
      const newPriority = maxPriority + 1;

      // 计算队列位置（待处理的任务数）
      const pendingCount = await this.prisma.researchTask.count({
        where: {
          missionId: todo.missionId,
          status: ResearchTaskStatus.PENDING,
        },
      });
      queuePosition = pendingCount + 1;

      // ★ v7.4: 为新维度创建专属 Agent，而非复用已有 Agent
      // 每个维度内容不同，应由专属研究员负责，避免"经济研究员"研究"哲学"的问题
      const sanitizedDimName = dimensionName
        .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")
        .substring(0, 30);
      const newAgentId = `researcher_${sanitizedDimName}_${Date.now()}`;

      task = await this.prisma.researchTask.create({
        data: {
          missionId: todo.missionId,
          title: `研究: ${dimensionName}`,
          description:
            todo.description || `用户请求的新维度研究：${dimensionName}`,
          taskType: "dimension_research",
          dimensionName: dimensionName,
          dimensionId: dimension.id,
          // ★ v7.4: 为新维度创建专属 Agent，确保 Agent 与维度内容匹配
          assignedAgent: newAgentId,
          assignedAgentType: "dimension_researcher",
          modelId: todo.modelId || "", // ★ 使用 Leader 分配的模型，由 TaskProfile 决定
          // ★ v7.3: 使用计算的优先级，确保排在已有任务后面
          priority: newPriority,
          // ★ v7.3: 状态为 PENDING，由 Mission 调度执行
          status: ResearchTaskStatus.PENDING,
        },
      });

      // 更新 Mission 的 totalTasks 计数
      await this.prisma.researchMission.update({
        where: { id: todo.missionId },
        data: {
          totalTasks: { increment: 1 },
        },
      });

      // ★ v7.4: 更新质量审核任务的依赖，把新任务加进去
      // 这样质量审核会等待所有维度研究（包括新增的）完成后才执行
      const qualityReviewTask = await this.prisma.researchTask.findFirst({
        where: {
          missionId: todo.missionId,
          taskType: "quality_review",
        },
      });

      if (qualityReviewTask) {
        const currentDeps = qualityReviewTask.dependencies || [];
        if (!currentDeps.includes(task.id)) {
          await this.prisma.researchTask.update({
            where: { id: qualityReviewTask.id },
            data: {
              dependencies: [...currentDeps, task.id],
            },
          });
          this.logger.log(
            `[executeAddDimension] Updated quality_review task dependencies to include ${task.id}`,
          );
        }
      }

      this.logger.log(
        `[executeAddDimension] Created ResearchTask ${task.id} for dimension ${dimensionName}, priority: ${newPriority}, queue position: ${queuePosition}`,
      );

      // ★ v7.3: 触发任务执行（通过事件解耦，避免循环依赖）
      this.eventEmitter.emitResumeMissionExecution(todo.missionId, topicId);
    }

    // ★ v7.3: 不再直接执行研究，而是返回"已加入队列"的消息
    // 研究将由 Mission 的 startExecution 循环调度执行
    const message =
      queuePosition > 0
        ? `已创建新维度「${dimensionName}」并加入研究队列（第 ${queuePosition} 位）。研究将按顺序自动执行。`
        : `已创建新维度「${dimensionName}」并加入研究队列。研究将按顺序自动执行。`;

    this.logger.log(
      `[executeAddDimension] Dimension ${dimensionName} added to queue successfully`,
    );

    return message;
  }

  /**
   * 执行深入研究操作
   * ★ v7.3: 任务加入 Mission 调度队列，而非直接执行（修复插队问题）
   */
  private async executeDeepResearch(
    topicId: string,
    todo: ResearchTodo,
  ): Promise<string> {
    this.logger.log(`[executeDeepResearch] Deep research for topic ${topicId}`);

    // 从 title 或 description 中提取研究主题
    const researchTopic = todo.title
      .replace(/深入研究|详细分析|[：:]/g, "")
      .trim();

    // 获取 topic 信息
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    // 创建专门的深入研究维度（绑定到当前 mission）
    const dimensionName = `深入分析：${researchTopic}`;
    const dimension = await this.prisma.topicDimension.create({
      data: {
        topicId,
        missionId: todo.missionId ?? null,
        name: dimensionName,
        description:
          todo.description ||
          `用户请求深入研究的主题：${researchTopic}\n\n请进行详细、全面的分析。`,
        status: DimensionStatus.PENDING,
        sortOrder: 100,
        searchQueries: [researchTopic, `${researchTopic} 详细分析`],
      },
    });

    this.logger.log(
      `[executeDeepResearch] Created deep research dimension ${dimension.id}: ${dimensionName} (mission=${todo.missionId ?? "none"})`,
    );

    // ★ v7.3: 创建 ResearchTask 并加入调度队列（PENDING 状态）
    let task = null;
    let queuePosition = 0;
    if (todo.missionId) {
      // 获取当前队列中的最大优先级，新任务排在最后
      const existingTasks = await this.prisma.researchTask.findMany({
        where: {
          missionId: todo.missionId,
          taskType: "dimension_research",
        },
        orderBy: { priority: "desc" },
        take: 1,
      });

      // 新任务优先级 = 当前最大优先级 + 1（排在队列末尾）
      const maxPriority = existingTasks[0]?.priority || 0;
      const newPriority = maxPriority + 1;

      // 计算队列位置
      const pendingCount = await this.prisma.researchTask.count({
        where: {
          missionId: todo.missionId,
          status: ResearchTaskStatus.PENDING,
        },
      });
      queuePosition = pendingCount + 1;

      task = await this.prisma.researchTask.create({
        data: {
          missionId: todo.missionId,
          title: `研究: ${dimensionName}`,
          description:
            todo.description || `用户请求的深入研究：${researchTopic}`,
          taskType: "dimension_research",
          dimensionName: dimensionName,
          dimensionId: dimension.id,
          assignedAgent: todo.agentId || "researcher_dynamic",
          assignedAgentType: "dimension_researcher",
          modelId: todo.modelId,
          // ★ v7.3: 使用计算的优先级
          priority: newPriority,
          // ★ v7.3: 状态为 PENDING，由 Mission 调度执行
          status: ResearchTaskStatus.PENDING,
        },
      });

      // 更新 Mission 的 totalTasks 计数
      await this.prisma.researchMission.update({
        where: { id: todo.missionId },
        data: {
          totalTasks: { increment: 1 },
        },
      });

      this.logger.log(
        `[executeDeepResearch] Created ResearchTask ${task.id} for deep research ${dimensionName}, priority: ${newPriority}, queue position: ${queuePosition}`,
      );

      // ★ v7.3: 触发任务执行（通过事件解耦，避免循环依赖）
      this.eventEmitter.emitResumeMissionExecution(todo.missionId, topicId);
    }

    // ★ v7.3: 不再直接执行研究，返回"已加入队列"的消息
    const message =
      queuePosition > 0
        ? `已创建深入研究任务「${researchTopic}」并加入研究队列（第 ${queuePosition} 位）。研究将按顺序自动执行。`
        : `已创建深入研究任务「${researchTopic}」并加入研究队列。研究将按顺序自动执行。`;

    this.logger.log(
      `[executeDeepResearch] Deep research ${researchTopic} added to queue successfully`,
    );

    return message;
  }

  // ==================== 辅助方法 ====================

  /**
   * 计算 TODO 汇总
   */
  private calculateSummary(todos: ResearchTodo[]): TodoSummary {
    const summary: TodoSummary = {
      total: todos.length,
      pending: 0,
      queued: 0,
      inProgress: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      overallProgress: 0,
    };

    for (const todo of todos) {
      switch (todo.status) {
        case ResearchTodoStatus.PENDING:
          summary.pending++;
          break;
        case ResearchTodoStatus.QUEUED:
          summary.queued++;
          break;
        case ResearchTodoStatus.IN_PROGRESS:
          summary.inProgress++;
          break;
        case ResearchTodoStatus.PAUSED:
          summary.paused++;
          break;
        case ResearchTodoStatus.COMPLETED:
          summary.completed++;
          break;
        case ResearchTodoStatus.FAILED:
          summary.failed++;
          break;
        case ResearchTodoStatus.CANCELLED:
          summary.cancelled++;
          break;
      }
    }

    // 计算整体进度（排除取消和失败的）
    const activeItems =
      summary.pending +
      summary.queued +
      summary.inProgress +
      summary.paused +
      summary.completed;
    if (activeItems > 0) {
      summary.overallProgress = Math.round(
        (summary.completed * 100 +
          todos
            .filter(
              (t) =>
                t.status === ResearchTodoStatus.IN_PROGRESS ||
                t.status === ResearchTodoStatus.PAUSED,
            )
            .reduce((sum, t) => sum + t.progress, 0)) /
          activeItems,
      );
    }

    return summary;
  }

  /**
   * 验证状态转换是否有效
   */
  private validateStatusTransition(
    from: ResearchTodoStatus,
    to: ResearchTodoStatus,
  ): void {
    const validTransitions: Record<ResearchTodoStatus, ResearchTodoStatus[]> = {
      [ResearchTodoStatus.PENDING]: [
        ResearchTodoStatus.QUEUED,
        ResearchTodoStatus.CANCELLED,
      ],
      [ResearchTodoStatus.QUEUED]: [
        ResearchTodoStatus.IN_PROGRESS,
        ResearchTodoStatus.CANCELLED,
      ],
      [ResearchTodoStatus.IN_PROGRESS]: [
        ResearchTodoStatus.PAUSED,
        ResearchTodoStatus.COMPLETED,
        ResearchTodoStatus.FAILED,
      ],
      [ResearchTodoStatus.PAUSED]: [
        ResearchTodoStatus.IN_PROGRESS,
        ResearchTodoStatus.CANCELLED,
      ],
      [ResearchTodoStatus.COMPLETED]: [],
      [ResearchTodoStatus.FAILED]: [ResearchTodoStatus.QUEUED],
      [ResearchTodoStatus.CANCELLED]: [],
    };

    if (!validTransitions[from]?.includes(to)) {
      throw new BadRequestException(
        `Invalid status transition from ${from} to ${to}`,
      );
    }
  }

  /**
   * 格式化 TODO 用于客户端
   */
  private formatTodoForClient(todo: ResearchTodo): Record<string, unknown> {
    return {
      id: todo.id,
      topicId: todo.topicId,
      missionId: todo.missionId,
      type: todo.type,
      title: todo.title,
      description: todo.description,
      dimensionId: todo.dimensionId,
      dimensionName: todo.dimensionName,
      agentId: todo.agentId,
      agentName: todo.agentName,
      agentRole: todo.agentRole,
      assignmentReason: todo.assignmentReason, // ★ Leader 分配理由
      status: todo.status,
      progress: todo.progress,
      statusMessage: todo.statusMessage,
      priority: todo.priority,
      dependsOn: todo.dependsOn,
      startedAt: todo.startedAt?.toISOString(),
      completedAt: todo.completedAt?.toISOString(),
      estimatedMs: todo.estimatedMs,
      actualMs: todo.actualMs,
      result: todo.result,
      userCanPause: todo.userCanPause,
      userCanCancel: todo.userCanCancel,
      userCanPrioritize: todo.userCanPrioritize,
      createdAt: todo.createdAt.toISOString(),
      updatedAt: todo.updatedAt.toISOString(),
    };
  }

  /**
   * 发送 TODO 事件到 WebSocket
   */
  private async emitTodoEvent(
    topicId: string,
    event: TodoEventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.eventEmitter.emitToTopic(topicId, event, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }
}
