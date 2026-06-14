/**
 * AI Engine - Common Types
 * 基础类型定义
 */

/**
 * 唯一标识符类型
 */
export type Id = string;

/**
 * 时间戳类型
 */
export type Timestamp = Date | string | number;

/**
 * 引擎执行模式（串行/并行）
 */
export enum EngineExecutionMode {
  /**
   * 串行执行
   */
  SEQUENTIAL = "sequential",

  /**
   * 并行执行
   */
  PARALLEL = "parallel",
}

/**
 * 基础上下文接口
 */
export interface BaseContext {
  /**
   * 执行 ID
   */
  executionId: string;

  /**
   * 用户 ID
   */
  userId?: string;

  /**
   * 会话 ID
   */
  sessionId?: string;

  /**
   * 取消信号
   */
  signal?: AbortSignal;

  /**
   * 元数据
   */
  metadata?: JsonObject;
}


/**
 * JSON 兼容值类型
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * JSON 对象类型
 */
export type JsonObject = Record<string, JsonValue>;

/**
 * 执行结果
 */
export interface ExecutionResult<T> {
  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 返回数据（成功时）
   */
  data?: T;

  /**
   * 错误信息（失败时）
   */
  error?: ExecutionError;

  /**
   * 执行元数据
   */
  metadata: ExecutionMetadata;
}

/**
 * 执行错误
 */
export interface ExecutionError {
  /**
   * 错误码
   */
  code: string;

  /**
   * 错误消息
   */
  message: string;

  /**
   * 错误详情
   */
  details?: JsonObject;

  /**
   * 原始错误
   */
  cause?: Error;

  /**
   * 是否可重试
   */
  retryable?: boolean;
}

/**
 * 执行元数据
 */
export interface ExecutionMetadata {
  /**
   * 执行 ID
   */
  executionId: string;

  /**
   * 开始时间
   */
  startTime: Date;

  /**
   * 结束时间
   */
  endTime: Date;

  /**
   * 执行时长（毫秒）
   */
  duration: number;

  /**
   * Token 使用量
   */
  tokensUsed?: number;

  /**
   * 估算成本
   */
  cost?: number;

  /**
   * 重试次数
   */
  retryCount?: number;

  /**
   * 额外元数据
   */
  extra?: JsonObject;
}

/**
 * 验证错误项
 */
export interface ValidationIssue {
  /**
   * 字段路径
   */
  path: string;

  /**
   * 错误消息
   */
  message: string;

  /**
   * 错误类型
   */
  type: string;

  /**
   * 实际值
   */
  value?: unknown;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  /**
   * 是否有效
   */
  valid: boolean;

  /**
   * 验证错误列表
   */
  errors?: ValidationIssue[];
}

/**
 * 能力描述符
 */
export interface CapabilityDescriptor {
  /**
   * 能力名称
   */
  name: string;

  /**
   * 能力描述
   */
  description: string;

  /**
   * 能力参数
   */
  parameters?: JsonObject;

  /**
   * 能力标签
   */
  tags?: string[];
}

/**
 * 前置条件结果
 */
export interface PreconditionResult {
  /**
   * 是否满足
   */
  satisfied: boolean;

  /**
   * 不满足的原因
   */
  reason?: string;

  /**
   * 缺失的依赖
   */
  missingDependencies?: string[];
}

/**
 * 重试配置
 */
export interface RetryConfig {
  /**
   * 最大重试次数
   */
  maxRetries: number;

  /**
   * 重试间隔（毫秒）
   */
  delay: number;

  /**
   * 退避策略
   */
  backoff?: "linear" | "exponential";

  /**
   * 最大延迟（毫秒）
   */
  maxDelay?: number;

  /**
   * 可重试的错误码
   */
  retryableCodes?: string[];
}

/**
 * 超时配置
 */
export interface TimeoutConfig {
  /**
   * 超时时间（毫秒）
   */
  timeout: number;

  /**
   * 超时信号
   */
  signal?: AbortSignal;
}

/**
 * 分页参数
 */
export interface PaginationParams {
  /**
   * 页码（从 1 开始）
   */
  page?: number;

  /**
   * 每页数量
   */
  limit?: number;

  /**
   * 偏移量
   */
  offset?: number;
}

/**
 * 分页结果
 */
export interface PaginatedResult<T> {
  /**
   * 数据列表
   */
  items: T[];

  /**
   * 总数
   */
  total: number;

  /**
   * 当前页码
   */
  page: number;

  /**
   * 每页数量
   */
  limit: number;

  /**
   * 总页数
   */
  totalPages: number;

  /**
   * 是否有下一页
   */
  hasNext: boolean;

  /**
   * 是否有上一页
   */
  hasPrev: boolean;
}

/**
 * 可选的深层部分类型
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * 可空类型
 */
export type Nullable<T> = T | null;

/**
 * 可选类型
 */
export type Optional<T> = T | undefined;

/**
 * 异步或同步类型
 */
export type MaybePromise<T> = T | Promise<T>;
