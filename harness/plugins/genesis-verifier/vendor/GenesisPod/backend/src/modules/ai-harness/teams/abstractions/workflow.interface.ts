/**
 * AI Engine - Workflow Interface
 * 工作流抽象接口定义
 */

import { RoleId } from "./role.interface";

// ==================== 工作流类型 ====================

export type WorkflowType = "sequential" | "parallel" | "dag" | "hybrid";

// ==================== 步骤类型 ====================

export type WorkflowStepType =
  | "task" // 普通任务
  | "decision" // 决策节点
  | "parallel" // 并行执行
  | "loop" // 循环执行
  | "review" // 审核节点
  | "wait" // 等待节点
  | "handoff"; // 交接节点

// ==================== 步骤状态 ====================

export type WorkflowStepStatus =
  | "pending"
  | "ready"
  | "executing"
  | "waiting_review"
  | "completed"
  | "failed"
  | "skipped";

// ==================== 工作流接口 ====================

/**
 * 工作流定义
 */
export interface IWorkflow {
  /** 工作流 ID */
  readonly id: string;

  /** 工作流名称 */
  readonly name: string;

  /** 工作流类型 */
  readonly type: WorkflowType;

  /** 工作流步骤 */
  readonly steps: IWorkflowStep[];

  /** 入口步骤 ID */
  readonly entryStepId: string;

  /** 出口步骤 ID 列表 */
  readonly exitStepIds: string[];

  /** 全局超时时间（毫秒） */
  readonly timeout?: number;

  /** 元数据 */
  readonly metadata?: Record<string, unknown>;

  /**
   * 获取步骤
   */
  getStep(stepId: string): IWorkflowStep | undefined;

  /**
   * 获取入口步骤
   */
  getEntryStep(): IWorkflowStep;

  /**
   * 获取下一步骤
   */
  getNextSteps(currentStepId: string): IWorkflowStep[];

  /**
   * 获取依赖步骤
   */
  getDependencies(stepId: string): IWorkflowStep[];

  /**
   * 检查是否可执行
   */
  canExecute(stepId: string, completedStepIds: string[]): boolean;

  /**
   * 验证工作流定义
   */
  validate(): WorkflowValidationResult;
}

/**
 * 工作流步骤
 */
export interface IWorkflowStep {
  /** 步骤 ID */
  readonly id: string;

  /** 步骤名称 */
  readonly name: string;

  /** 步骤描述 */
  readonly description: string;

  /** 步骤类型 */
  readonly type: WorkflowStepType;

  /** 执行者角色（可以是多个） */
  readonly executorRoles: RoleId[];

  /** 是否并行执行（多个执行者时） */
  readonly parallel: boolean;

  /** 依赖的步骤 ID */
  readonly dependsOn: string[];

  /** 执行条件 */
  readonly condition?: StepCondition;

  /** 超时时间（毫秒） */
  readonly timeout?: number;

  /** 重试配置 */
  readonly retry?: RetryConfig;

  /** 审核配置（如果是审核步骤） */
  readonly reviewConfig?: ReviewConfig;

  /** 循环配置（如果是循环步骤） */
  readonly loopConfig?: LoopConfig;

  /** 元数据 */
  readonly metadata?: Record<string, unknown>;
}

// ==================== 步骤配置 ====================

/**
 * 步骤条件
 */
export interface StepCondition {
  /** 条件类型 */
  type: "expression" | "output_check" | "custom";

  /** 条件表达式 */
  expression?: string;

  /** 检查的输出字段 */
  outputField?: string;

  /** 期望值 */
  expectedValue?: unknown;

  /** 比较操作符 */
  operator?: "eq" | "ne" | "gt" | "lt" | "contains" | "exists";
}

/**
 * 重试配置
 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;

  /** 重试延迟（毫秒） */
  retryDelay: number;

  /** 延迟倍数（指数退避） */
  backoffMultiplier?: number;

  /** 最大延迟（毫秒） */
  maxDelay?: number;

  /** 可重试的错误类型 */
  retryableErrors?: string[];
}

/**
 * 审核配置
 */
export interface ReviewConfig {
  /** 审核者角色 */
  reviewerRole: RoleId;

  /** 审核标准 */
  criteria: ReviewCriterion[];

  /** 通过阈值（0-1） */
  passThreshold: number;

  /** 最大返工次数 */
  maxReworks: number;

  /** 自动通过条件 */
  autoPassCondition?: StepCondition;
}

/**
 * 审核标准
 */
export interface ReviewCriterion {
  /** 标准名称 */
  name: string;

  /** 标准描述 */
  description: string;

  /** 权重 */
  weight: number;
}

/**
 * 循环配置
 */
export interface LoopConfig {
  /** 最大迭代次数 */
  maxIterations: number;

  /** 退出条件 */
  exitCondition: StepCondition;

  /** 循环体步骤 ID 列表 */
  bodyStepIds: string[];
}

// ==================== 工作流验证 ====================

/**
 * 工作流验证结果
 */
export interface WorkflowValidationResult {
  /** 是否有效 */
  valid: boolean;

  /** 错误列表 */
  errors: WorkflowValidationError[];

  /** 警告列表 */
  warnings: WorkflowValidationWarning[];
}

/**
 * 工作流验证错误
 */
export interface WorkflowValidationError {
  /** 错误代码 */
  code: string;

  /** 错误消息 */
  message: string;

  /** 相关步骤 ID */
  stepId?: string;
}

/**
 * 工作流验证警告
 */
export interface WorkflowValidationWarning {
  /** 警告代码 */
  code: string;

  /** 警告消息 */
  message: string;

  /** 相关步骤 ID */
  stepId?: string;
}

// ==================== 工作流执行状态 ====================

/**
 * 工作流执行状态
 */
export interface WorkflowExecutionState {
  /** 执行 ID */
  executionId: string;

  /** 工作流 ID */
  workflowId: string;

  /** 当前状态 */
  status: "running" | "paused" | "completed" | "failed" | "cancelled";

  /** 各步骤状态 */
  stepStates: Map<string, StepExecutionState>;

  /** 开始时间 */
  startTime: Date;

  /** 结束时间 */
  endTime?: Date;

  /** 当前执行的步骤 ID 列表 */
  currentStepIds: string[];

  /** 已完成的步骤 ID 列表 */
  completedStepIds: string[];

  /** 失败的步骤 ID 列表 */
  failedStepIds: string[];

  /** 执行上下文 */
  context: Record<string, unknown>;
}

/**
 * 步骤执行状态
 */
export interface StepExecutionState {
  /** 步骤 ID */
  stepId: string;

  /** 状态 */
  status: WorkflowStepStatus;

  /** 开始时间 */
  startTime?: Date;

  /** 结束时间 */
  endTime?: Date;

  /** 重试次数 */
  retryCount: number;

  /** 输出 */
  output?: unknown;

  /** 错误 */
  error?: string;
}

// ==================== 工作流配置 ====================

/**
 * 工作流配置（用于创建工作流）
 */
export interface WorkflowConfig {
  id: string;
  name: string;
  type: WorkflowType;
  steps: WorkflowStepConfig[];
  entryStepId?: string;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

/**
 * 工作流步骤配置
 */
export interface WorkflowStepConfig {
  id: string;
  name: string;
  description?: string;
  type: WorkflowStepType;
  executorRoles: RoleId[];
  parallel?: boolean;
  dependsOn?: string[];
  condition?: StepCondition;
  timeout?: number;
  retry?: RetryConfig;
  reviewConfig?: ReviewConfig;
  loopConfig?: LoopConfig;
  metadata?: Record<string, unknown>;
}
