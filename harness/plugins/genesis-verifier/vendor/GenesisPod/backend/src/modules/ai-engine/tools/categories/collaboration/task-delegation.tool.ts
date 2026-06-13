/**
 * Task Delegation Tool
 * 任务委派工具 - 将任务委派给其他 Agent 执行
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";


// ============================================================================
// Types
// ============================================================================

export type DelegationStatus =
  | "PENDING"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "REJECTED"
  | "CANCELLED";

export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export interface DelegatedTask {
  /**
   * 任务 ID
   */
  taskId: string;

  /**
   * 任务标题
   */
  title: string;

  /**
   * 任务描述
   */
  description: string;

  /**
   * 目标 Agent ID
   */
  targetAgent: string;

  /**
   * 优先级
   */
  priority: TaskPriority;

  /**
   * 截止时间
   */
  deadline?: string;

  /**
   * 上下文数据
   */
  context?: Record<string, unknown>;

  /**
   * 依赖的任务 ID
   */
  dependencies?: string[];

  /**
   * 预期输出格式
   */
  expectedOutput?: string;
}

export interface TaskDelegationInput {
  /**
   * 操作类型
   */
  operation: "DELEGATE" | "CHECK_STATUS" | "CANCEL" | "UPDATE" | "LIST";

  /**
   * 任务数据（DELEGATE 操作）
   */
  task?: DelegatedTask;

  /**
   * 任务 ID（CHECK_STATUS/CANCEL/UPDATE 操作）
   */
  taskId?: string;

  /**
   * 更新数据（UPDATE 操作）
   */
  updates?: Partial<DelegatedTask>;

  /**
   * 源 Agent ID
   */
  sourcestring?: string;

  /**
   * 过滤条件（LIST 操作）
   */
  filter?: {
    status?: DelegationStatus[];
    targetAgent?: string;
    priority?: TaskPriority[];
  };
}

export interface TaskDelegationOutput {
  /**
   * 操作是否成功
   */
  success: boolean;

  /**
   * 操作类型
   */
  operation: string;

  /**
   * 任务 ID
   */
  taskId?: string;

  /**
   * 委派状态
   */
  status?: DelegationStatus;

  /**
   * 任务结果（如果已完成）
   */
  result?: unknown;

  /**
   * 任务列表（LIST 操作）
   */
  tasks?: Array<{
    taskId: string;
    title: string;
    targetAgent: string;
    status: DelegationStatus;
    priority: TaskPriority;
    createdAt: string;
    completedAt?: string;
  }>;

  /**
   * 错误信息
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class TaskDelegationTool extends BaseTool<
  TaskDelegationInput,
  TaskDelegationOutput
> {
  private readonly logger = new Logger(TaskDelegationTool.name);

  // 模拟任务存储
  private taskStore: Map<
    string,
    DelegatedTask & {
      status: DelegationStatus;
      createdAt: string;
      updatedAt: string;
      completedAt?: string;
      result?: unknown;
    }
  > = new Map();

  readonly id = "task-delegation";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "collaboration";
  readonly tags = ["collaboration", "task", "delegation", "assignment"];
  readonly name = "任务委派";
  readonly description =
    "将任务委派给其他 Agent 执行，支持任务跟踪、状态查询、取消和更新。适用于多 Agent 协作场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "操作类型",
        enum: ["DELEGATE", "CHECK_STATUS", "CANCEL", "UPDATE", "LIST"],
      },
      task: {
        type: "object",
        description: "任务数据",
        properties: {
          taskId: { type: "string", description: "任务 ID" },
          title: { type: "string", description: "任务标题" },
          description: { type: "string", description: "任务描述" },
          targetAgent: { type: "string", description: "目标 Agent" },
          priority: {
            type: "string",
            enum: ["LOW", "NORMAL", "HIGH", "URGENT"],
            default: "NORMAL",
          },
          deadline: { type: "string", format: "date-time" },
          context: { type: "object", description: "上下文数据" },
          dependencies: {
            type: "array",
            items: { type: "string" },
            description: "依赖任务 ID",
          },
          expectedOutput: { type: "string", description: "预期输出格式" },
        },
        required: ["title", "description", "targetAgent"],
      },
      taskId: {
        type: "string",
        description: "任务 ID",
      },
      updates: {
        type: "object",
        description: "更新数据",
      },
      sourcestring: {
        type: "string",
        description: "源 Agent ID",
      },
      filter: {
        type: "object",
        description: "过滤条件",
        properties: {
          status: { type: "array", items: { type: "string" } },
          targetAgent: { type: "string" },
          priority: { type: "array", items: { type: "string" } },
        },
      },
    },
    required: ["operation"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean", description: "操作是否成功" },
      operation: { type: "string", description: "操作类型" },
      taskId: { type: "string", description: "任务 ID" },
      status: { type: "string", description: "委派状态" },
      result: { type: "object", description: "任务结果" },
      tasks: { type: "array", description: "任务列表" },
      error: { type: "string", description: "错误信息" },
    },
  };

  constructor() {
    super();
    // defaultTimeout set in class property
  }

  validateInput(input: TaskDelegationInput) {
    if (!input.operation) {
      return false;
    }

    const { operation, task, taskId } = input;

    switch (operation) {
      case "DELEGATE":
        if (!task?.title || !task?.description || !task?.targetAgent) {
          return false;
        }
        break;
      case "CHECK_STATUS":
      case "CANCEL":
      case "UPDATE":
        if (!taskId) return false;
        break;
      case "LIST":
        // 过滤条件可选
        break;
    }

    return true;
  }

  protected async doExecute(
    input: TaskDelegationInput,
    _context: ToolContext,
  ): Promise<TaskDelegationOutput> {
    const { operation, task, taskId, updates, filter } = input;

    this.logger.log(`[doExecute] Task delegation operation: ${operation}`);

    try {
      switch (operation) {
        case "DELEGATE":
          return this.delegateTask(task!);

        case "CHECK_STATUS":
          return this.checkTaskStatus(taskId!);

        case "CANCEL":
          return this.cancelTask(taskId!);

        case "UPDATE":
          return this.updateTask(taskId!, updates);

        case "LIST":
          return this.listTasks(filter);

        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`[doExecute] Task delegation failed: ${errorMessage}`);

      return {
        success: false,
        operation,
        error: errorMessage,
      };
    }
  }

  private delegateTask(task: DelegatedTask): TaskDelegationOutput {
    const taskId =
      task.taskId ||
      `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();

    this.taskStore.set(taskId, {
      ...task,
      taskId,
      priority: task.priority || "NORMAL",
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
    });

    // 模拟任务被接受
    setTimeout(() => {
      const storedTask = this.taskStore.get(taskId);
      if (storedTask && storedTask.status === "PENDING") {
        storedTask.status = "ACCEPTED";
        storedTask.updatedAt = new Date().toISOString();
      }
    }, 500);

    this.logger.log(
      `[delegateTask] Task ${taskId} delegated to ${task.targetAgent}`,
    );

    return {
      success: true,
      operation: "DELEGATE",
      taskId,
      status: "PENDING",
    };
  }

  private checkTaskStatus(taskId: string): TaskDelegationOutput {
    const task = this.taskStore.get(taskId);

    if (!task) {
      return {
        success: false,
        operation: "CHECK_STATUS",
        taskId,
        error: `Task not found (taskId="${taskId}", available: [${Array.from(this.taskStore.keys()).slice(0, 20).join(", ") || "<none>"}])`,
      };
    }

    return {
      success: true,
      operation: "CHECK_STATUS",
      taskId,
      status: task.status,
      result: task.result,
    };
  }

  private cancelTask(taskId: string): TaskDelegationOutput {
    const task = this.taskStore.get(taskId);

    if (!task) {
      return {
        success: false,
        operation: "CANCEL",
        taskId,
        error: `Task not found (taskId="${taskId}", available: [${Array.from(this.taskStore.keys()).slice(0, 20).join(", ") || "<none>"}])`,
      };
    }

    if (task.status === "COMPLETED" || task.status === "FAILED") {
      return {
        success: false,
        operation: "CANCEL",
        taskId,
        error: `Cannot cancel completed or failed task (taskId="${taskId}", currentStatus="${task.status}")`,
      };
    }

    task.status = "CANCELLED";
    task.updatedAt = new Date().toISOString();

    return {
      success: true,
      operation: "CANCEL",
      taskId,
      status: "CANCELLED",
    };
  }

  private updateTask(
    taskId: string,
    updates?: Partial<DelegatedTask>,
  ): TaskDelegationOutput {
    const task = this.taskStore.get(taskId);

    if (!task) {
      return {
        success: false,
        operation: "UPDATE",
        taskId,
        error: `Task not found (taskId="${taskId}", available: [${Array.from(this.taskStore.keys()).slice(0, 20).join(", ") || "<none>"}])`,
      };
    }

    if (task.status === "COMPLETED" || task.status === "CANCELLED") {
      return {
        success: false,
        operation: "UPDATE",
        taskId,
        error: `Cannot update completed or cancelled task (taskId="${taskId}", currentStatus="${task.status}")`,
      };
    }

    if (updates) {
      Object.assign(task, updates);
      task.updatedAt = new Date().toISOString();
    }

    return {
      success: true,
      operation: "UPDATE",
      taskId,
      status: task.status,
    };
  }

  private listTasks(
    filter?: TaskDelegationInput["filter"],
  ): TaskDelegationOutput {
    let tasks = Array.from(this.taskStore.values());

    if (filter) {
      if (filter.status && filter.status.length > 0) {
        tasks = tasks.filter((t) => filter.status!.includes(t.status));
      }
      if (filter.targetAgent) {
        tasks = tasks.filter((t) => t.targetAgent === filter.targetAgent);
      }
      if (filter.priority && filter.priority.length > 0) {
        tasks = tasks.filter((t) => filter.priority!.includes(t.priority));
      }
    }

    return {
      success: true,
      operation: "LIST",
      tasks: tasks.map((t) => ({
        taskId: t.taskId,
        title: t.title,
        targetAgent: String(t.targetAgent),
        status: t.status,
        priority: t.priority,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      })),
    };
  }
}
