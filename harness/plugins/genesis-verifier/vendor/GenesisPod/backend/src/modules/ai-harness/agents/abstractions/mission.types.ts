/**
 * AI Engine - Mission Interface
 * 任务（Mission）抽象接口定义
 */

import type { UploadedFile } from "@/modules/ai-harness/agents/abstractions/agent.types";
import type { ConstraintProfile } from "../../guardrails/constraints/constraint-profile";
import type { TeamId } from "../../teams/abstractions/team.interface";

// ==================== Mission ID ====================

export type MissionId = string;

// ==================== Mission 状态 ====================

export type MissionStatus =
  | "created"
  | "queued"
  | "parsing"
  | "planning"
  | "executing"
  | "reviewing"
  | "delivering"
  | "completed"
  | "failed"
  | "cancelled";

// ==================== Mission 输入 ====================

/**
 * Mission 输入（用户发起任务）
 */
export interface MissionInput {
  /** 任务描述/提示词 */
  prompt: string;

  /** 附加文件 */
  files?: UploadedFile[];

  /** 参考 URL */
  urls?: string[];

  /** 额外要求 */
  requirements?: string[];

  /** 参考资源 ID */
  resourceIds?: string[];

  /** 模板 ID */
  templateId?: string;

  /** 约束配置（覆盖 Team 默认） */
  constraints?: Partial<ConstraintProfile>;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ==================== Mission 接口 ====================

/**
 * Mission（用户下发给 Team 的任务）
 */
export interface IMission {
  /** Mission ID */
  readonly id: MissionId;

  /** 目标 Team ID */
  readonly teamId: TeamId;

  /** 用户 ID */
  readonly userId: string;

  /** 会话 ID */
  readonly sessionId?: string;

  /** 任务输入 */
  readonly input: MissionInput;

  /** 最终约束（合并 Team 默认和用户覆盖） */
  readonly constraints: ConstraintProfile;

  /** 当前状态 */
  status: MissionStatus;

  /** 创建时间 */
  readonly createdAt: Date;

  /** 开始时间 */
  startedAt?: Date;

  /** 完成时间 */
  completedAt?: Date;

  /** 取消信号 */
  signal?: AbortSignal;

  /** 元数据 */
  readonly metadata?: Record<string, unknown>;
}

// ==================== 解析后的意图 ====================

/**
 * 解析后的任务意图
 */
export interface ParsedIntent {
  /** 意图 ID */
  id: string;

  /** Mission ID */
  missionId: MissionId;

  /** 主要目标 */
  primaryGoal: string;

  /** 次要目标 */
  secondaryGoals: string[];

  /** 关键信息提取 */
  extractedInfo: ExtractedInfo;

  /** 任务类型 */
  taskType: TaskType;

  /** 复杂度评估 */
  complexity: ComplexityAssessment;

  /** 建议的执行策略 */
  suggestedStrategy: ExecutionStrategy;

  /** 置信度（0-1） */
  confidence: number;
}

/**
 * 提取的关键信息
 */
export interface ExtractedInfo {
  /** 主题/领域 */
  topics: string[];

  /** 实体（人名、组织、产品等） */
  entities: NamedEntity[];

  /** 时间范围 */
  timeRange?: TimeRange;

  /** 地理范围 */
  geoScope?: string[];

  /** 语言要求 */
  language?: string;

  /** 格式要求 */
  formatRequirements?: string[];

  /** 其他约束 */
  otherConstraints?: string[];
}

/**
 * 命名实体
 */
export interface NamedEntity {
  text: string;
  type: "person" | "organization" | "product" | "location" | "event" | "other";
  relevance: number;
}

/**
 * 时间范围
 */
export interface TimeRange {
  start?: Date;
  end?: Date;
  description?: string;
}

/**
 * 任务类型
 */
export type TaskType =
  | "research" // 研究调研
  | "analysis" // 分析评估
  | "creation" // 内容创作
  | "design" // 设计创意
  | "debate" // 辩论推演
  | "review" // 审核检查
  | "mixed"; // 混合任务

/**
 * 复杂度评估
 */
export interface ComplexityAssessment {
  /** 总体复杂度 */
  overall: ComplexityLevel;

  /** 信息复杂度 */
  informational: ComplexityLevel;

  /** 逻辑复杂度 */
  logical: ComplexityLevel;

  /** 创意复杂度 */
  creative: ComplexityLevel;

  /** 预估子任务数 */
  estimatedSubTasks: number;

  /** 预估耗时（毫秒） */
  estimatedDuration: number;

  /** 预估成本（积分） */
  estimatedCost: number;
}

export type ComplexityLevel = "low" | "medium" | "high" | "very_high";

/**
 * 执行策略
 */
export interface ExecutionStrategy {
  /** 推荐的工作流类型 */
  workflowType: "sequential" | "parallel" | "hybrid";

  /** 推荐的成员配置 */
  memberConfig: MemberRecommendation[];

  /** 是否需要多轮迭代 */
  needsIteration: boolean;

  /** 是否需要人工审核 */
  needsHumanReview: boolean;

  /** 关键风险点 */
  riskFactors: string[];
}

/**
 * 成员推荐
 */
export interface MemberRecommendation {
  roleId: string;
  count: number;
  modelSuggestion: string;
  reason: string;
}

// ==================== Mission 交付物 ====================

/**
 * Mission 交付物
 */
export interface MissionDeliverable {
  /** 交付物 ID */
  id: string;

  /** Mission ID */
  missionId: MissionId;

  /** 交付物类型 */
  type: DeliverableType;

  /** 交付物名称 */
  name: string;

  /** 交付物描述 */
  description: string;

  /** MIME 类型 */
  mimeType: string;

  /** 文件大小 */
  size: number;

  /** 文件 URL */
  url?: string;

  /** 内容（小文件可内联） */
  content?: unknown;

  /** 创建时间 */
  createdAt: Date;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

export type DeliverableType =
  | "report" // 报告文档
  | "presentation" // 演示文稿
  | "data" // 数据文件
  | "code" // 代码文件
  | "image" // 图片
  | "summary" // 摘要
  | "analysis" // 分析结果
  | "other"; // 其他

// ==================== Mission 结果 ====================

/**
 * Mission 结果
 */
export interface MissionResult {
  /** Mission ID */
  missionId: MissionId;

  /** 是否成功 */
  success: boolean;

  /** 交付物列表 */
  deliverables: MissionDeliverable[];

  /** 执行摘要 */
  summary: string;

  /** Token 消耗 */
  tokensUsed: number;

  /** 成本消耗（积分） */
  costUsed: number;

  /** 执行时间（毫秒） */
  duration: number;

  /** 错误信息（如果失败） */
  error?: MissionError;

  /** 执行统计 */
  statistics: MissionStatistics;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Mission 错误
 */
export interface MissionError {
  code: string;
  message: string;
  stepId?: string;
  memberId?: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

/**
 * Mission 统计
 */
export interface MissionStatistics {
  /** 总步骤数 */
  totalSteps: number;

  /** 完成步骤数 */
  completedSteps: number;

  /** 失败步骤数 */
  failedSteps: number;

  /** 跳过步骤数 */
  skippedSteps: number;

  /** 返工次数 */
  reworkCount: number;

  /** 参与成员数 */
  membersInvolved: number;

  /** 工具调用次数 */
  toolCalls: number;

  /** 技能调用次数 */
  skillCalls: number;

  /** 审核次数 */
  reviewCount: number;

  /** 审核通过率 */
  reviewPassRate: number;
}

// ==================== Mission 事件 ====================

/**
 * Mission 事件类型
 */
export type MissionEventType =
  | "mission_created"
  | "mission_started"
  | "parsing_started"
  | "parsing_completed"
  | "planning_started"
  | "planning_completed"
  | "step_started"
  | "step_progress"
  | "step_completed"
  | "step_failed"
  | "review_started"
  | "review_completed"
  | "rework_requested"
  | "rework_completed"
  | "delivering_started"
  | "deliverable_ready"
  | "mission_completed"
  | "mission_failed"
  | "mission_cancelled"
  | "cost_warning"
  | "timeout_warning";

/**
 * Mission 事件
 */
export interface MissionEvent {
  /** 事件类型 */
  type: MissionEventType;

  /** Mission ID */
  missionId: MissionId;

  /** 时间戳 */
  timestamp: Date;

  /** 事件数据 */
  data?: Record<string, unknown>;
}
