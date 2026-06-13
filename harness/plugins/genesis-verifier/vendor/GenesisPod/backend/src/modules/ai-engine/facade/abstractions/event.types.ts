/**
 * AI Engine - Event Types
 * 事件系统类型定义
 */

import { JsonObject } from "./common.types";

/**
 * 基础事件
 */
export interface BaseEvent {
  /**
   * 事件 ID
   */
  id: string;

  /**
   * 事件类型
   */
  type: string;

  /**
   * 时间戳
   */
  timestamp: Date;

  /**
   * 来源
   */
  source?: string;

  /**
   * 元数据
   */
  metadata?: JsonObject;
}

/**
 * Agent 事件
 */
export type AgentEvent =
  | AgentPlanReadyEvent
  | AgentStepStartEvent
  | AgentStepProgressEvent
  | AgentStepCompleteEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentThinkingEvent
  | AgentArtifactEvent
  | AgentCompleteEvent
  | AgentErrorEvent;

/**
 * 计划就绪事件
 */
export interface AgentPlanReadyEvent extends BaseEvent {
  type: "plan_ready";
  plan: ExecutionPlan;
}

/**
 * 步骤开始事件
 */
export interface AgentStepStartEvent extends BaseEvent {
  type: "step_start";
  stepId: string;
  stepName: string;
  message?: string;
}

/**
 * 步骤进度事件
 */
export interface AgentStepProgressEvent extends BaseEvent {
  type: "step_progress";
  stepId: string;
  progress: number; // 0-100
  message?: string;
}

/**
 * 步骤完成事件
 */
export interface AgentStepCompleteEvent extends BaseEvent {
  type: "step_complete";
  stepId: string;
  result?: unknown;
  duration: number;
}

/**
 * 工具调用事件
 */
export interface AgentToolCallEvent extends BaseEvent {
  type: "tool_call";
  toolId: string;
  toolName: string;
  input: unknown;
}

/**
 * 工具结果事件
 */
export interface AgentToolResultEvent extends BaseEvent {
  type: "tool_result";
  toolId: string;
  toolName: string;
  output: unknown;
  success: boolean;
  duration: number;
}

/**
 * 思考事件
 */
export interface AgentThinkingEvent extends BaseEvent {
  type: "thinking";
  content: string;
}

/**
 * 产出物事件
 */
export interface AgentArtifactEvent extends BaseEvent {
  type: "artifact";
  artifact: Artifact;
}

/**
 * 完成事件
 */
export interface AgentCompleteEvent extends BaseEvent {
  type: "complete";
  result: AgentResult;
}

/**
 * 错误事件
 */
export interface AgentErrorEvent extends BaseEvent {
  type: "error";
  error: string;
  code?: string;
  recoverable?: boolean;
}

/**
 * 执行计划
 */
export interface ExecutionPlan {
  /**
   * 计划 ID
   */
  id: string;

  /**
   * 计划名称
   */
  name?: string;

  /**
   * 计划描述
   */
  description?: string;

  /**
   * 步骤列表
   */
  steps: PlanStep[];

  /**
   * 预估时长（毫秒）
   */
  estimatedDuration?: number;

  /**
   * 预估 Token
   */
  estimatedTokens?: number;

  /**
   * 创建时间
   */
  createdAt: Date;
}

/**
 * 计划步骤
 */
export interface PlanStep {
  /**
   * 步骤 ID
   */
  id: string;

  /**
   * 步骤名称
   */
  name: string;

  /**
   * 步骤描述
   */
  description?: string;

  /**
   * 步骤类型
   */
  type: "agent" | "skill" | "tool" | "decision" | "wait" | "parallel";

  /**
   * 执行器 ID
   */
  executor?: string;

  /**
   * 依赖的步骤 ID 列表
   */
  dependsOn?: string[];

  /**
   * 执行条件
   */
  condition?: string;

  /**
   * 输入参数
   */
  input?: JsonObject;

  /**
   * 重试配置
   */
  retry?: {
    maxRetries: number;
    delay: number;
  };

  /**
   * 超时时间（毫秒）
   */
  timeout?: number;

  /**
   * 是否允许失败后继续
   */
  continueOnFailure?: boolean;

  /**
   * 子步骤（parallel 类型使用）
   */
  children?: PlanStep[];
}

/**
 * Agent 结果
 */
export interface AgentResult {
  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 主要输出
   */
  output?: unknown;

  /**
   * 产出物列表
   */
  artifacts?: Artifact[];

  /**
   * 执行摘要
   */
  summary?: string;

  /**
   * 执行统计
   */
  stats: ExecutionStats;

  /**
   * 错误信息
   */
  error?: string;
}

/**
 * 产出物
 */
export interface Artifact {
  /**
   * 产出物 ID
   */
  id: string;

  /**
   * 类型
   */
  type: ArtifactType;

  /**
   * 名称
   */
  name: string;

  /**
   * MIME 类型
   */
  mimeType?: string;

  /**
   * 内容（小型内容直接嵌入）
   */
  content?: string;

  /**
   * URL（大型内容的引用）
   */
  url?: string;

  /**
   * 大小（字节）
   */
  size?: number;

  /**
   * 元数据
   */
  metadata?: JsonObject;

  /**
   * 创建时间
   */
  createdAt: Date;
}

/**
 * 产出物类型
 */
export type ArtifactType =
  | "text"
  | "code"
  | "image"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "audio"
  | "video"
  | "data"
  | "file";

/**
 * 执行统计
 */
export interface ExecutionStats {
  /**
   * 总时长（毫秒）
   */
  totalDuration: number;

  /**
   * 迭代次数
   */
  iterations: number;

  /**
   * 工具调用次数
   */
  toolCalls: number;

  /**
   * Token 使用量
   */
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };

  /**
   * 估算成本
   */
  estimatedCost?: number;

  /**
   * 步骤统计
   */
  stepStats?: StepStats[];
}

/**
 * 步骤统计
 */
export interface StepStats {
  /**
   * 步骤 ID
   */
  stepId: string;

  /**
   * 步骤名称
   */
  stepName: string;

  /**
   * 状态
   */
  status: "completed" | "failed" | "skipped";

  /**
   * 时长（毫秒）
   */
  duration: number;

  /**
   * 重试次数
   */
  retryCount: number;
}

/**
 * 工作流事件
 */
export type WorkflowEvent =
  | WorkflowStartEvent
  | WorkflowStepEvent
  | WorkflowCompleteEvent
  | WorkflowErrorEvent
  | WorkflowCheckpointEvent;

/**
 * 工作流开始事件
 */
export interface WorkflowStartEvent extends BaseEvent {
  type: "workflow_start";
  workflowId: string;
  workflowName?: string;
}

/**
 * 工作流步骤事件
 */
export interface WorkflowStepEvent extends BaseEvent {
  type: "workflow_step";
  workflowId: string;
  stepId: string;
  stepStatus: "started" | "completed" | "failed" | "skipped";
  result?: unknown;
}

/**
 * 工作流完成事件
 */
export interface WorkflowCompleteEvent extends BaseEvent {
  type: "workflow_complete";
  workflowId: string;
  success: boolean;
  result?: unknown;
}

/**
 * 工作流错误事件
 */
export interface WorkflowErrorEvent extends BaseEvent {
  type: "workflow_error";
  workflowId: string;
  stepId?: string;
  error: string;
}

/**
 * 工作流检查点事件
 */
export interface WorkflowCheckpointEvent extends BaseEvent {
  type: "workflow_checkpoint";
  workflowId: string;
  checkpointId: string;
  checkpointType: string;
}

/**
 * 事件发射器接口
 */
export interface IEventEmitter<T extends BaseEvent = BaseEvent> {
  /**
   * 发射事件
   */
  emit(event: T): void;

  /**
   * 订阅事件
   */
  on(type: string, listener: (event: T) => void): () => void;

  /**
   * 订阅所有事件
   */
  onAny(listener: (event: T) => void): () => void;

  /**
   * 一次性订阅
   */
  once(type: string, listener: (event: T) => void): () => void;

  /**
   * 移除监听器
   */
  off(type: string, listener: (event: T) => void): void;

  /**
   * 移除所有监听器
   */
  removeAllListeners(type?: string): void;
}
