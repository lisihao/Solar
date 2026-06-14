/**
 * Todo Interface
 * 待办管理抽象接口
 */

/**
 * 待办状态
 */
export type TodoStatus =
  | "pending" // 待处理
  | "in_progress" // 进行中
  | "completed" // 已完成
  | "cancelled" // 已取消
  | "blocked"; // 被阻塞

/**
 * 待办优先级
 */
export type TodoPriority = "low" | "medium" | "high" | "urgent";

/**
 * 待办类型
 */
export type TodoType =
  | "revision" // 修订
  | "review" // 审查
  | "research" // 研究
  | "writing" // 写作
  | "fix" // 修复
  | "enhancement" // 增强
  | "custom"; // 自定义

/**
 * 创建待办请求
 */
export interface CreateTodoRequest {
  type: TodoType;
  title: string;
  description?: string;
  entityType: string; // 关联实体类型
  entityId: string; // 关联实体 ID
  assigneeId?: string; // 负责人
  priority?: TodoPriority;
  dueDate?: Date;
  parentId?: string; // 父待办（用于子任务）
  labels?: string[];
  metadata?: Record<string, unknown>;
  createdBy: string;
}

/**
 * 待办记录
 */
export interface Todo {
  id: string;
  type: TodoType;
  title: string;
  description?: string;

  // 关联
  entityType: string;
  entityId: string;
  parentId?: string;
  children?: Todo[];

  // 分配
  assigneeId?: string;
  assigneeName?: string;
  createdBy: string;

  // 状态
  status: TodoStatus;
  priority: TodoPriority;
  labels: string[];

  // 时间
  dueDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;

  // 进度
  progress?: number; // 0-100
  blockedBy?: string[]; // 阻塞此任务的其他待办 ID

  // 元数据
  metadata?: Record<string, unknown>;
}

/**
 * 更新待办请求
 */
export interface UpdateTodoRequest {
  title?: string;
  description?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  assigneeId?: string;
  dueDate?: Date;
  labels?: string[];
  progress?: number;
  blockedBy?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * 待办查询条件
 */
export interface TodoQuery {
  entityType?: string;
  entityId?: string;
  assigneeId?: string;
  status?: TodoStatus | TodoStatus[];
  type?: TodoType | TodoType[];
  priority?: TodoPriority | TodoPriority[];
  labels?: string[];
  dueBefore?: Date;
  dueAfter?: Date;
  parentId?: string | null; // null 表示顶级待办
  limit?: number;
  offset?: number;
  sortBy?: "priority" | "dueDate" | "createdAt" | "updatedAt";
  sortOrder?: "asc" | "desc";
}

/**
 * 待办统计
 */
export interface TodoStats {
  total: number;
  byStatus: Record<TodoStatus, number>;
  byPriority: Record<TodoPriority, number>;
  overdue: number;
  completedThisWeek: number;
}

/**
 * 待办服务接口
 */
export interface ITodoService {
  /**
   * 创建待办
   */
  create(request: CreateTodoRequest): Promise<Todo>;

  /**
   * 批量创建
   */
  createBatch(requests: CreateTodoRequest[]): Promise<Todo[]>;

  /**
   * 获取待办
   */
  getById(id: string): Promise<Todo | null>;

  /**
   * 查询待办
   */
  query(query: TodoQuery): Promise<Todo[]>;

  /**
   * 更新待办
   */
  update(
    id: string,
    request: UpdateTodoRequest,
    updatedBy: string,
  ): Promise<Todo>;

  /**
   * 完成待办
   */
  complete(id: string, completedBy: string): Promise<Todo>;

  /**
   * 取消待办
   */
  cancel(id: string, cancelledBy: string, reason?: string): Promise<Todo>;

  /**
   * 删除待办
   */
  delete(id: string): Promise<void>;

  /**
   * 获取统计
   */
  getStats(filters?: {
    entityType?: string;
    entityId?: string;
    assigneeId?: string;
  }): Promise<TodoStats>;

  /**
   * 获取子任务
   */
  getChildren(parentId: string): Promise<Todo[]>;

  /**
   * 批量更新状态
   */
  batchUpdateStatus(
    ids: string[],
    status: TodoStatus,
    updatedBy: string,
  ): Promise<Todo[]>;
}
