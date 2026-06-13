/**
 * AI Engine - Mission Orchestrator Interface
 * 任务编排器接口定义
 *
 * 核心流程：Mission Input → Parse → Plan → Execute → Review → Deliver
 */

import { ITeam } from "../abstractions/team.interface";
import {
  MissionInput,
  MissionResult,
  MissionEvent,
  ParsedIntent,
  MissionDeliverable,
} from "../../agents/abstractions/mission.types";
import { MissionExecutionProfile, ResourceUsage } from "../constraints";
import { WorkflowExecutionState } from "../abstractions/workflow.interface";

// ==================== 执行计划 ====================

/**
 * 角色分配条目（SelfDrivenMissionPlanner P1 新增）。
 * roleId 必须来自 RoleInventory 白名单；modelId 由 election 填写（"" = 未分配）。
 */
export interface RoleAssignment {
  roleId: string;
  modelId: string;
}

/**
 * Mission 执行计划
 *
 * 扩展字段（P1 新增，设计见 §3 / §5.1 / ADR-009）：
 *   roleAssignments — 角色 → 模型映射（election 填 modelId）
 *   rubric          — LLM 生成的验收维度（passLine 经 clamp [60,90]）
 *   deliverableType — v1 仅 "report"
 * 无扩展字段时行为与既有 MissionExecutionPlan 完全兼容。
 */
export interface MissionExecutionPlan {
  /** 计划 ID */
  id: string;

  /** Mission ID */
  missionId: string;

  /** 解析后的意图 */
  parsedIntent: ParsedIntent;

  /** 计划步骤 */
  steps: ExecutionStep[];

  /** 预估成本 */
  estimatedCost: number;

  /** 预估时间（毫秒） */
  estimatedDuration: number;

  /** 创建时间 */
  createdAt: Date;

  /**
   * 角色 → 模型 映射列表（SelfDrivenMissionPlanner 输出）。
   * 普通 Planner 不产此字段，SelfDrivenMissionPlanner 必须填满。
   */
  roleAssignments?: RoleAssignment[];

  /**
   * LLM 生成的验收维度列表（RubricGenerator 输出，passLine ∈ [60, 90]）。
   */
  rubric?: Array<{ dimension: string; weight: number; passLine: number }>;

  /**
   * 交付件类型（v1 仅 "report"）。
   */
  deliverableType?: "report";

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 执行步骤
 */
export interface ExecutionStep {
  /** 步骤 ID */
  id: string;

  /** 步骤名称 */
  name: string;

  /** 步骤描述 */
  description: string;

  /** 执行者（成员 ID 或角色 ID） */
  executor: string;

  /** 步骤类型 */
  type: "task" | "review" | "integration" | "delivery";

  /**
   * 最适合该步骤的执行循环类型（SelfDrivenMissionPlanner P1 新增字段）。
   * 由 engine/planning StepDecompositionService 在角色无关分解阶段赋值；
   * harness planner 在组装扩展版 MissionExecutionPlan 时直接拷贝。
   * 普通 Planner 不填此字段，SelfDrivenMissionPlanner 必须填满。
   *
   *   react          → 开放式探索 / 工具调用
   *   plan-act       → 结构化多步推理，无实时工具
   *   leader-worker  → 多 worker 并行的任务分解
   */
  loopKind?: "react" | "plan-act" | "leader-worker";

  /** 依赖的步骤 ID */
  dependencies: string[];

  /** 预估耗时（毫秒） */
  estimatedDuration: number;

  /** 预估成本 */
  estimatedCost: number;

  /** 执行超时（毫秒）- 来自工作流配置 */
  timeout?: number;

  /** 输入参数 */
  input?: Record<string, unknown>;
}

// ==================== 执行状态 ====================

/**
 * Mission 执行状态
 */
export interface MissionExecutionState {
  /** Mission ID */
  missionId: string;

  /** 当前阶段 */
  phase: OrchestratorPhase;

  /** 工作流状态 */
  workflowState?: WorkflowExecutionState;

  /** 资源使用情况 */
  resourceUsage: ResourceUsage;

  /** 已完成的步骤 */
  completedSteps: string[];

  /** 当前执行的步骤 */
  currentSteps: string[];

  /** 失败的步骤 */
  failedSteps: string[];

  /** 审核结果 */
  reviewResults: StepReviewResult[];

  /** 中间产出物 */
  intermediateOutputs: Map<string, unknown>;

  /** 最终交付物 */
  deliverables: MissionDeliverable[];
}

/**
 * 编排器阶段
 */
export type OrchestratorPhase =
  | "idle"
  | "parsing"
  | "planning"
  | "executing"
  | "reviewing"
  | "delivering"
  | "completed"
  | "failed";

/**
 * 步骤审核结果
 */
export interface StepReviewResult {
  stepId: string;
  passed: boolean;
  score: number;
  feedback: string;
  reviewedAt: Date;
}

// ==================== 编排器配置 ====================

/**
 * 编排器配置
 */
export interface OrchestratorConfig {
  /**
   * 步骤失败时是否跳过继续执行（而非中断整个 mission）。
   * 注意：当前实现为"跳过失败步骤"，不是真正的重试。
   * 未来版本将实现带退避的步骤级重试。
   * @see AdaptiveReplannerService for future retry integration
   */
  enableAutoRetry: boolean;

  /** 最大重试次数 */
  maxRetries: number;

  /** 是否启用并行执行 */
  enableParallel: boolean;

  /** 审核策略 */
  reviewStrategy: "all" | "critical" | "sample" | "none";

  /** 事件缓冲大小 */
  eventBufferSize: number;

  /** 检查点间隔（毫秒） */
  checkpointInterval: number;
}

/**
 * 默认编排器配置
 */
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  enableAutoRetry: true,
  maxRetries: 3,
  enableParallel: true,
  reviewStrategy: "critical",
  eventBufferSize: 100,
  checkpointInterval: 30000,
};

// ==================== 编排器接口 ====================

/**
 * Mission 编排器接口
 */
export interface IMissionOrchestrator {
  /**
   * 执行 Mission（完整流程）
   */
  execute(
    input: MissionInput,
    team: ITeam,
    constraints?: Partial<MissionExecutionProfile>,
  ): AsyncGenerator<MissionEvent, MissionResult>;

  /**
   * 解析 Mission 意图
   */
  parse(input: MissionInput): Promise<ParsedIntent>;

  /**
   * 生成执行计划
   */
  plan(
    intent: ParsedIntent,
    team: ITeam,
    constraints: MissionExecutionProfile,
  ): Promise<MissionExecutionPlan>;

  /**
   * 执行计划
   */
  executePlan(
    plan: MissionExecutionPlan,
    team: ITeam,
    constraints: MissionExecutionProfile,
  ): AsyncGenerator<MissionEvent, MissionExecutionState>;

  /**
   * 审核步骤输出
   */
  review(
    stepId: string,
    output: unknown,
    team: ITeam,
  ): Promise<StepReviewResult>;

  /**
   * 生成交付物
   */
  deliver(
    state: MissionExecutionState,
    team: ITeam,
  ): Promise<MissionDeliverable[]>;

  /**
   * 取消执行
   */
  cancel(missionId: string): Promise<void>;

  /**
   * 获取执行状态
   */
  getState(missionId: string): MissionExecutionState | undefined;

  /**
   * 获取资源使用情况
   */
  getResourceUsage(missionId: string): ResourceUsage | undefined;
}

// ==================== 解析器接口 ====================

/**
 * 意图解析器接口
 */
export interface IIntentParser {
  /**
   * 解析 Mission 输入
   */
  parse(input: MissionInput): Promise<ParsedIntent>;
}

// ==================== 计划器接口 ====================

/**
 * 执行计划器接口
 */
export interface IExecutionPlanner {
  /**
   * 生成执行计划
   */
  plan(
    intent: ParsedIntent,
    team: ITeam,
    constraints: MissionExecutionProfile,
  ): Promise<MissionExecutionPlan>;

  /**
   * 优化执行计划
   */
  optimize(
    plan: MissionExecutionPlan,
    constraints: MissionExecutionProfile,
  ): Promise<MissionExecutionPlan>;
}

// ==================== 审核器接口 ====================

/**
 * 输出审核器接口
 */
export interface IOutputReviewer {
  /**
   * 审核步骤输出
   */
  review(
    stepId: string,
    output: unknown,
    criteria: ReviewCriteria,
  ): Promise<StepReviewResult>;

  /**
   * 批量审核
   */
  reviewBatch(
    items: Array<{ stepId: string; output: unknown }>,
    criteria: ReviewCriteria,
  ): Promise<StepReviewResult[]>;
}

/**
 * 审核标准
 */
export interface ReviewCriteria {
  /** 最低分数 */
  minScore: number;

  /** 必须检查项 */
  requiredChecks: string[];

  /** 可选检查项 */
  optionalChecks?: string[];

  /** 严格模式 */
  strictMode: boolean;
}

// ==================== 交付器接口 ====================

/**
 * 交付物生成器接口
 */
export interface IDeliveryGenerator {
  /**
   * 生成交付物
   */
  generate(
    outputs: Map<string, unknown>,
    deliverableTypes: string[],
  ): Promise<MissionDeliverable[]>;

  /**
   * 整合多个输出
   */
  integrate(outputs: unknown[], format: string): Promise<unknown>;
}
