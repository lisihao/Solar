/**
 * AI Engine - Executable Interface
 * 统一执行接口定义
 */

import {
  BaseContext,
  ExecutionResult,
  ValidationResult,
  CapabilityDescriptor,
} from "./common.types";

/**
 * 可执行组件接口
 * Tool, Skill, Agent 都实现此接口
 */
export interface IExecutable<
  TInput = unknown,
  TOutput = unknown,
  TContext extends BaseContext = BaseContext,
> {
  /**
   * 唯一标识符
   */
  readonly id: string;

  /**
   * 名称
   */
  readonly name: string;

  /**
   * 描述
   */
  readonly description: string;

  /**
   * 版本
   */
  readonly version?: string;

  /**
   * 标签
   */
  readonly tags?: string[];

  /**
   * 执行入口
   * @param input 输入参数
   * @param context 执行上下文
   * @returns 执行结果
   */
  execute(input: TInput, context: TContext): Promise<ExecutionResult<TOutput>>;

  /**
   * 验证输入（可选）
   * @param input 输入参数
   * @returns 验证结果
   */
  validateInput?(input: TInput): ValidationResult;

  /**
   * 获取能力描述（用于 LLM 工具选择）
   * @returns 能力描述符
   */
  getCapabilities?(): CapabilityDescriptor;
}

/**
 * 可取消的执行接口
 */
export interface ICancellable {
  /**
   * 取消执行
   * @param reason 取消原因
   */
  cancel(reason?: string): Promise<void>;

  /**
   * 是否已取消
   */
  isCancelled(): boolean;
}

/**
 * 可暂停的执行接口
 */
export interface IPausable {
  /**
   * 暂停执行
   */
  pause(): Promise<void>;

  /**
   * 恢复执行
   */
  resume(): Promise<void>;

  /**
   * 是否已暂停
   */
  isPaused(): boolean;
}

/**
 * 流式执行接口
 */
export interface IStreamable<TEvent> {
  /**
   * 流式执行
   * @yields 事件流
   */
  executeStream(...args: unknown[]): AsyncGenerator<TEvent>;
}

/**
 * 可重试的执行接口
 */
export interface IRetryable {
  /**
   * 是否可重试
   * @param error 错误
   */
  isRetryable(error: Error): boolean;

  /**
   * 获取重试延迟
   * @param attempt 尝试次数
   */
  getRetryDelay(attempt: number): number;
}

/**
 * 执行统计接口
 */
export interface IExecutionStats {
  /**
   * 获取执行统计
   */
  getStats(): ExecutionStatistics;

  /**
   * 重置统计
   */
  resetStats(): void;
}

/**
 * 执行统计数据
 */
export interface ExecutionStatistics {
  /**
   * 总执行次数
   */
  totalExecutions: number;

  /**
   * 成功次数
   */
  successCount: number;

  /**
   * 失败次数
   */
  failureCount: number;

  /**
   * 平均执行时间（毫秒）
   */
  avgDuration: number;

  /**
   * 最小执行时间（毫秒）
   */
  minDuration: number;

  /**
   * 最大执行时间（毫秒）
   */
  maxDuration: number;

  /**
   * 最后执行时间
   */
  lastExecutionAt?: Date;

  /**
   * 最后错误
   */
  lastError?: string;
}

/**
 * 健康检查接口
 */
export interface IHealthCheck {
  /**
   * 健康检查
   */
  healthCheck(): Promise<HealthCheckResult>;
}

/**
 * 健康检查结果
 */
export interface HealthCheckResult {
  /**
   * 是否健康
   */
  healthy: boolean;

  /**
   * 状态
   */
  status: "healthy" | "degraded" | "unhealthy";

  /**
   * 消息
   */
  message?: string;

  /**
   * 检查时间
   */
  checkedAt: Date;

  /**
   * 详情
   */
  details?: Record<string, unknown>;
}

/**
 * 可配置的接口
 */
export interface IConfigurable<TConfig> {
  /**
   * 获取配置
   */
  getConfig(): TConfig;

  /**
   * 更新配置
   * @param config 配置
   */
  updateConfig(config: Partial<TConfig>): void;

  /**
   * 重置为默认配置
   */
  resetConfig(): void;
}

/**
 * 可克隆的接口
 */
export interface ICloneable<T> {
  /**
   * 克隆
   */
  clone(): T;
}

/**
 * 可序列化的接口
 */
export interface ISerializable<T = unknown> {
  /**
   * 序列化
   */
  serialize(): T;

  /**
   * 反序列化
   * @param data 数据
   */
  deserialize?(data: T): void;
}

/**
 * 执行上下文构建器接口
 */
export interface IContextBuilder<TContext extends BaseContext> {
  /**
   * 设置执行 ID
   */
  withExecutionId(id: string): this;

  /**
   * 设置用户 ID
   */
  withUserId(userId: string): this;

  /**
   * 设置会话 ID
   */
  withSessionId(sessionId: string): this;

  /**
   * 设置取消信号
   */
  withSignal(signal: AbortSignal): this;

  /**
   * 设置超时
   */
  withTimeout(timeout: number): this;

  /**
   * 设置元数据
   */
  withMetadata(metadata: Record<string, unknown>): this;

  /**
   * 构建上下文
   */
  build(): TContext;
}
