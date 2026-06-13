/**
 * Collaboration Types
 *
 * Type definitions for collaboration services:
 * - Research TODO
 * - Review Workflow
 * - Research Reviewer
 * - Research Reflection
 */

import type { ResearchTodoStatus, ResearchTodoType } from "@prisma/client";

// ==================== TODO ====================

export interface CreateTodoInput {
  topicId: string;
  missionId: string;
  type: ResearchTodoType;
  title: string;
  description?: string;
  dimensionId?: string;
  dimensionName?: string;
  agentId?: string;
  agentName?: string;
  agentRole?: string;
  /** ★ Agent 使用的 AI 模型 ID */
  modelId?: string;
  /** ★ Leader Agent 分配此任务的理由 */
  assignmentReason?: {
    agentReason?: string;
    modelReason?: string;
  };
  priority?: number;
  dependsOn?: string[];
  estimatedMs?: number;
  userCanPause?: boolean;
  userCanCancel?: boolean;
  userCanPrioritize?: boolean;
}

export interface UpdateTodoProgressInput {
  progress: number;
  statusMessage?: string;
}

export interface TodoFilter {
  missionId?: string;
  status?: ResearchTodoStatus[];
  type?: ResearchTodoType[];
}

export interface TodoSummary {
  total: number;
  pending: number;
  queued: number;
  inProgress: number;
  paused: number;
  completed: number;
  failed: number;
  cancelled: number;
  overallProgress: number;
}

export interface TodoResult {
  sourcesFound?: number;
  wordCount?: number;
  keyFindings?: number;
  figuresUsed?: number;
  error?: string;
}

export enum TodoEventType {
  TODO_CREATED = "todo:created",
  TODO_STATUS_CHANGED = "todo:status_changed",
  TODO_PROGRESS = "todo:progress",
  TODO_COMPLETED = "todo:completed",
  TODO_FAILED = "todo:failed",
  TODO_CANCELLED = "todo:cancelled",
  TODO_PAUSED = "todo:paused",
  TODO_RESUMED = "todo:resumed",
  /** ★ v7.2: Leader 审核相关事件 */
  TODO_REVIEWING = "todo:reviewing",
  TODO_REVIEWED = "todo:reviewed",
}

// ==================== Review Workflow ====================

/**
 * 创建审核任务的输入
 */
export interface CreateReviewTaskInput {
  reportId: string;
  sectionId?: string;
  sectionName: string;
  sectionOrder?: number;
  assigneeId?: string;
  assigneeName?: string;
  dueAt?: Date;
}

/**
 * 审核任务分配输入
 */
export interface AssignTaskInput {
  taskId: string;
  assigneeId: string;
  assigneeName: string;
  dueAt?: Date;
}

/**
 * 完成审核任务输入
 */
export interface CompleteTaskInput {
  taskId: string;
  approved: boolean;
  score?: number;
  comments?: string;
}

/**
 * 审核任务统计
 */
export interface ReviewTaskStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  approved: number;
  rejected: number;
  averageScore: number | null;
}

// ==================== Research Reviewer ====================

/**
 * 审核质量等级
 */
export enum ReviewQualityLevel {
  EXCELLENT = "excellent", // 优秀，可直接使用
  GOOD = "good", // 良好，可使用但有改进空间
  ACCEPTABLE = "acceptable", // 可接受，建议改进
  NEEDS_REVISION = "needs_revision", // 需要修订
  REJECTED = "rejected", // 拒绝，需要重新研究
}

/**
 * 单维度审核结果
 */
export interface DimensionReviewResult {
  dimensionId: string;
  dimensionName: string;
  qualityLevel: ReviewQualityLevel;
  overallScore: number; // 0-100
  scores: {
    breadth: number; // 广度得分
    depth: number; // 深度得分
    evidence: number; // 证据支撑得分
    coherence: number; // 逻辑连贯性得分
    currency: number; // 时效性得分
  };
  issues: ReviewIssue[];
  suggestions: string[];
  needsReresearch: boolean;
  reresearchFocus?: string[];
  actualModelId?: string; // ★ 实际使用的模型
}

/**
 * 审核问题
 */
export interface ReviewIssue {
  type:
    | "missing_coverage" // 缺少覆盖
    | "weak_evidence" // 证据薄弱
    | "outdated_info" // 信息过时
    | "logical_gap" // 逻辑漏洞
    | "shallow_analysis" // 分析浅显
    | "missing_perspective"; // 缺少视角
  severity: "critical" | "major" | "minor";
  description: string;
  affectedSection?: string;
}

/**
 * 全局审核结果
 */
export interface OverallReviewResult {
  topicId: string;
  topicName: string;
  qualityLevel: ReviewQualityLevel;
  overallScore: number;
  dimensionReviews: DimensionReviewResult[];
  crossDimensionIssues: ReviewIssue[];
  coverageAnalysis: {
    coveredAspects: string[];
    missingAspects: string[];
    coverageScore: number;
  };
  recommendations: string[];
  needsReresearch: boolean;
  dimensionsToReresearch: string[];
}

// ==================== Research Reflection ====================

/**
 * 反思结果
 */
export interface ReflectionResult {
  /** 决策：sufficient=证据充足，need_more=需要补充，pivot=需要调整方向 */
  decision: "sufficient" | "need_more" | "pivot";
  /** 证据质量评分 (0-100) */
  score: number;
  /** 识别的信息缺口 */
  gaps: string[];
  /** 推理过程 */
  reasoning: string;
  /** 建议的补充搜索查询（当 decision 为 need_more 时） */
  suggestedQueries?: string[];
}

/**
 * 反思上下文
 */
export interface ReflectionContext {
  /** 维度名称 */
  dimensionName: string;
  /** 维度描述 */
  dimensionDescription?: string;
  /** 研究目标/要点 */
  researchGoals?: string[];
  /** 当前收集的证据 */
  evidence: import("./research.types").EnrichedEvidenceData[];
  /** 用户配置的时效性要求 */
  freshnessRequirement?: string;
}
