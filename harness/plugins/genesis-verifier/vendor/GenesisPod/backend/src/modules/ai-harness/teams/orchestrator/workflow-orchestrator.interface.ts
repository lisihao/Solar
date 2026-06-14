/**
 * AI Engine - Orchestrator Interface
 * 编排器接口定义
 */

import { JsonObject } from "@/modules/ai-engine/facade/index";

/**
 * 工作流定义
 */
export interface Workflow {
  /**
   * 工作流 ID
   */
  id: string;

  /**
   * 工作流名称
   */
  name: string;

  /**
   * 工作流描述
   */
  description?: string;

  /**
   * 工作流步骤
   */
  steps: WorkflowStep[];

  /**
   * 执行模式
   */
  mode: WorkflowMode;

  /**
   * 入口步骤 ID
   */
  entryPoint?: string;

  /**
   * 全局配置
   */
  config?: WorkflowConfig;

  /**
   * 元数据
   */
  metadata?: JsonObject;
}

/**
 * 工作流模式
 */
export type WorkflowMode = "sequential" | "parallel" | "dag" | "reactive";

/**
 * 工作流步骤
 */
export interface WorkflowStep {
  /**
   * 步骤 ID
   */
  id: string;

  /**
   * 步骤类型
   */
  type: StepType;

  /**
   * 执行器 ID（Tool/Skill/Agent ID）
   */
  executor: string;

  /**
   * 步骤名称
   */
  name?: string;

  /**
   * 步骤描述
   */
  description?: string;

  /**
   * 输入映射
   */
  input?: StepInput;

  /**
   * 输出映射
   */
  output?: StepOutput;

  /**
   * 依赖的步骤 ID
   */
  dependsOn?: string[];

  /**
   * 执行条件
   */
  condition?: StepCondition;

  /**
   * 重试配置
   */
  retry?: RetryConfig;

  /**
   * 超时时间 (ms)
   */
  timeout?: number;

  /**
   * 错误处理
   */
  onError?: ErrorHandler;

  /**
   * 元数据
   */
  metadata?: JsonObject;
}

/**
 * 步骤类型
 */
export type StepType =
  | "tool" // 工具调用
  | "skill" // 技能调用
  | "agent" // Agent 调用
  | "handler" // 自定义 Handler（App 层注册的 WorkflowNodeHandler）
  | "decision" // 决策节点
  | "wait" // 等待
  | "parallel" // 并行执行
  | "loop" // 循环
  | "map" // 映射（并行处理数组，executor 指向 handler ID）
  | "reduce" // 归约
  | "transform" // 数据转换
  | "checkpoint" // 检查点
  | "human" // 人工介入
  | "subflow"; // 子工作流

/**
 * 步骤输入
 */
export interface StepInput {
  /**
   * 静态值
   */
  static?: JsonObject;

  /**
   * 从上下文映射
   */
  fromContext?: Record<string, string>;

  /**
   * 从其他步骤输出映射
   */
  fromStep?: Record<string, { stepId: string; path: string }>;

  /**
   * 表达式
   */
  expression?: string;
}

/**
 * 步骤输出
 */
export interface StepOutput {
  /**
   * 保存到上下文的路径
   */
  toContext?: string;

  /**
   * 转换表达式
   */
  transform?: string;
}

/**
 * 步骤条件
 */
export interface StepCondition {
  /**
   * 条件表达式
   */
  expression: string;

  /**
   * 条件为假时跳转到的步骤
   */
  skipTo?: string;
}

/**
 * 重试配置
 */
export interface RetryConfig {
  maxAttempts: number;
  delay: number;
  backoffMultiplier?: number;
  maxDelay?: number;
  retryOn?: string[];
}

/**
 * 错误处理器
 */
export interface ErrorHandler {
  /**
   * 处理策略
   */
  strategy: "abort" | "skip" | "retry" | "fallback" | "compensate";

  /**
   * 降级步骤 ID
   */
  fallbackStep?: string;

  /**
   * 补偿步骤 ID
   */
  compensateStep?: string;
}

/**
 * 工作流配置
 */
export interface WorkflowConfig {
  /**
   * 全局超时
   */
  timeout?: number;

  /**
   * 最大并行数
   */
  maxConcurrency?: number;

  /**
   * 是否启用检查点
   */
  enableCheckpoints?: boolean;

  /**
   * 检查点间隔
   */
  checkpointInterval?: number;

  /**
   * 是否启用追踪
   */
  enableTracing?: boolean;
}

/**
 * 执行上下文
 */
export interface ExecutionContext {
  /**
   * 执行 ID
   */
  executionId: string;

  /**
   * 工作流 ID
   */
  workflowId: string;

  /**
   * 用户 ID
   */
  userId?: string;

  /**
   * 会话 ID
   */
  sessionId?: string;

  /**
   * 输入数据
   */
  input: JsonObject;

  /**
   * 状态数据
   */
  state: JsonObject;

  /**
   * 步骤结果
   */
  stepResults: Map<string, StepResult>;

  /**
   * 取消信号
   */
  signal?: AbortSignal;

  /**
   * 开始时间
   */
  startTime: Date;

  /**
   * 元数据
   */
  metadata?: JsonObject;
}

/**
 * 步骤结果
 */
export interface StepResult {
  stepId: string;
  status: StepStatus;
  output?: unknown;
  error?: StepError;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  retryCount?: number;
}

/**
 * 步骤状态
 */
export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

/**
 * 步骤错误
 */
export interface StepError {
  code: string;
  message: string;
  details?: JsonObject;
  stack?: string;
}

/**
 * 执行事件
 */
export interface ExecutionEvent {
  type: ExecutionEventType;
  executionId: string;
  workflowId: string;
  stepId?: string;
  timestamp: Date;
  data?: unknown;
}

/**
 * 执行事件类型
 */
export type ExecutionEventType =
  | "workflow_started"
  | "workflow_completed"
  | "workflow_failed"
  | "workflow_cancelled"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "step_skipped"
  | "step_retry"
  | "checkpoint_saved"
  | "checkpoint_restored";

/**
 * 执行结果
 */
export interface ExecutionResult {
  /**
   * 执行 ID
   */
  executionId: string;

  /**
   * 工作流 ID
   */
  workflowId: string;

  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 输出数据
   */
  output?: unknown;

  /**
   * 错误信息
   */
  error?: {
    code: string;
    message: string;
    stepId?: string;
  };

  /**
   * 步骤结果
   */
  stepResults: StepResult[];

  /**
   * 开始时间
   */
  startTime: Date;

  /**
   * 结束时间
   */
  endTime: Date;

  /**
   * 执行时长 (ms)
   */
  duration: number;
}

/**
 * 编排器接口
 */
export interface IOrchestrator {
  /**
   * 编排器 ID
   */
  readonly id: string;

  /**
   * 执行工作流
   */
  execute(
    workflow: Workflow,
    input: JsonObject,
    options?: OrchestratorOptions,
  ): Promise<ExecutionResult>;

  /**
   * 流式执行工作流
   */
  executeStream(
    workflow: Workflow,
    input: JsonObject,
    options?: OrchestratorOptions,
  ): AsyncGenerator<ExecutionEvent, ExecutionResult>;

  /**
   * 恢复执行
   */
  resume(executionId: string, checkpoint: Checkpoint): Promise<ExecutionResult>;

  /**
   * 取消执行
   */
  cancel(executionId: string): Promise<void>;

  /**
   * 获取执行状态
   */
  getStatus(executionId: string): Promise<ExecutionStatus | null>;
}

/**
 * 编排器选项
 */
export interface OrchestratorOptions {
  userId?: string;
  sessionId?: string;
  timeout?: number;
  signal?: AbortSignal;
  metadata?: JsonObject;
}

/**
 * 执行状态
 */
export interface ExecutionStatus {
  executionId: string;
  workflowId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  currentStep?: string;
  progress: number;
  startTime: Date;
  stepResults: StepResult[];
}

/**
 * 检查点
 */
export interface Checkpoint {
  id: string;
  executionId: string;
  workflowId: string;
  stepId: string;
  context: ExecutionContext;
  timestamp: Date;
}
