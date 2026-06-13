/**
 * Triage Decision Types
 *
 * 反馈分诊决策的类型定义
 */

import { AIModelType } from "@prisma/client";
import { TaskProfile } from "@/modules/ai-harness/facade";

// ============================================
// 基础类型
// ============================================

/**
 * 反馈类型
 */
export type FeedbackType =
  | "BUG"
  | "FEATURE"
  | "IMPROVEMENT"
  | "OTHER"
  | "ANNOTATION";

/**
 * 问题分类
 */
export type IssueClassification =
  | "ui_bug" // UI显示问题
  | "logic_error" // 逻辑错误
  | "performance" // 性能问题
  | "crash" // 崩溃/系统错误
  | "security" // 安全问题
  | "data_issue" // 数据问题
  | "feature_request" // 功能需求
  | "ux_improvement" // 体验优化
  | "documentation" // 文档问题
  | "other"; // 其他

/**
 * 优先级
 */
export type PriorityLevel = "critical" | "high" | "medium" | "low";

/**
 * 处理动作
 */
export type TriageAction =
  | "auto_fix" // 自动修复
  | "manual_fix" // 需人工修复
  | "request_info" // 需要更多信息
  | "reject" // 拒绝（无效/重复）
  | "defer"; // 延期处理

/**
 * 无效原因
 */
export type InvalidReason =
  | "spam" // 垃圾信息
  | "duplicate" // 重复反馈
  | "unclear" // 描述不清
  | "not_a_bug" // 不是bug（设计如此）
  | "wont_fix" // 不修复（超出范围）
  | "cannot_reproduce"; // 无法复现

/**
 * 复杂度等级
 */
export type ComplexityLevel = "trivial" | "simple" | "moderate" | "complex";

/**
 * 风险等级
 */
export type RiskLevel = "low" | "medium" | "high";

// ============================================
// 分诊输入
// ============================================

/**
 * 反馈附件
 */
export interface FeedbackAttachment {
  filename: string;
  url: string;
  mimeType: string;
  size: number;
}

/**
 * 分诊输入数据
 */
export interface TriageInput {
  feedbackId: string;
  type: FeedbackType;
  title: string;
  description: string;
  attachments: FeedbackAttachment[];
  metadata: {
    userEmail?: string;
    pageUrl?: string;
    userAgent?: string;
    errorStack?: string;
    consoleErrors?: string[];
    timestamp: Date;
  };
}

// ============================================
// 分诊决策
// ============================================

/**
 * 合理性判断结果
 */
export interface ValidityAssessment {
  isValid: boolean;
  confidence: number; // 0-100
  reason: string;
  invalidReason?: InvalidReason;
}

/**
 * 问题分类结果
 */
export interface ClassificationResult {
  type: "bug" | "feature" | "improvement" | "question" | "other";
  subType: IssueClassification;
  affectedModule: string; // e.g., "ai-office/ppt", "ai-ask"
  affectedFiles?: string[]; // 推测的相关文件
  keywords: string[]; // 提取的关键词
}

/**
 * 优先级评估因子
 */
export interface PriorityFactors {
  userImpact: number; // 0-100 影响用户数
  severity: number; // 0-100 问题严重程度
  frequency: number; // 0-100 发生频率
  businessImpact: number; // 0-100 业务影响
}

/**
 * 优先级评估结果
 */
export interface PriorityAssessment {
  level: PriorityLevel;
  score: number; // 0-100 综合得分
  factors: PriorityFactors;
  reasoning: string;
}

/**
 * 自动修复计划
 */
export interface AutoFixPlan {
  approach: string; // 修复方法描述
  estimatedComplexity: ComplexityLevel;
  riskLevel: RiskLevel;
  requiresReview: boolean; // 是否需要代码审查
  suggestedChanges?: {
    file: string;
    description: string;
  }[];
}

/**
 * 人工处理分配
 */
export interface ManualAssignment {
  suggestedOwner?: string; // 建议的负责人
  suggestedTeam?: string; // 建议的团队
  estimatedEffort: string; // 预估工作量 e.g., "2h", "1d"
  blockers?: string[]; // 阻塞因素
  notes?: string; // 备注
}

/**
 * 路由决策
 */
export interface RoutingDecision {
  action: TriageAction;
  confidence: number; // 0-100
  reasoning: string;
  autoFixPlan?: AutoFixPlan;
  manualAssignment?: ManualAssignment;
  requestedInfo?: string[]; // 如果需要更多信息
  rejectReason?: string; // 如果拒绝
}

/**
 * 相似问题
 */
export interface SimilarIssue {
  feedbackId: string;
  title: string;
  similarity: number; // 0-100
  status: string;
  resolution?: string;
  resolvedAt?: Date;
}

/**
 * 截图分析结果
 */
export interface ScreenshotAnalysis {
  hasScreenshot: boolean;
  detectedText?: string[]; // OCR 识别的文本
  detectedErrors?: string[]; // 识别的错误信息
  uiElements?: string[]; // 识别的UI元素
  pageIdentified?: string; // 识别的页面
  issueDescription?: string; // AI对问题的描述
}

/**
 * 完整的分诊决策
 */
export interface TriageDecision {
  feedbackId: string;
  triagedAt: Date;
  processingTimeMs: number;

  // 合理性判断
  validity: ValidityAssessment;

  // 分类结果
  classification: ClassificationResult;

  // 优先级评估
  priority: PriorityAssessment;

  // 路由决策
  routing: RoutingDecision;

  // 相似问题
  similarIssues: SimilarIssue[];

  // 截图分析
  screenshotAnalysis?: ScreenshotAnalysis;

  // 原始AI响应（用于调试）
  rawAiResponse?: string;
}

// ============================================
// 配置类型
// ============================================

/**
 * 自动修复阈值配置
 */
export interface AutoFixThresholds {
  minValidityConfidence: number; // 最低有效性置信度
  minRoutingConfidence: number; // 最低路由置信度
  maxComplexity: ComplexityLevel; // 最大允许复杂度
  maxRiskLevel: RiskLevel; // 最大允许风险
  excludePriorities: PriorityLevel[]; // 排除的优先级
}

/**
 * 分诊配置
 */
export interface TriageConfig {
  // AI 模型配置
  aiModel: string;
  taskProfile: TaskProfile;

  // 自动修复配置
  autoFixEnabled: boolean;
  autoFixThresholds: AutoFixThresholds;

  // 相似度匹配配置
  similarityThreshold: number; // 相似度阈值
  maxSimilarIssues: number; // 最大返回相似问题数

  // 通知配置
  notifyOnCritical: boolean;
  notifyChannels: string[];
}

// ============================================
// 默认配置
// ============================================

export const DEFAULT_TRIAGE_CONFIG: TriageConfig = {
  aiModel: AIModelType.CHAT,
  taskProfile: { creativity: "low", outputLength: "short" },

  autoFixEnabled: true,
  autoFixThresholds: {
    minValidityConfidence: 80,
    minRoutingConfidence: 85,
    maxComplexity: "simple",
    maxRiskLevel: "medium",
    excludePriorities: ["critical"],
  },

  similarityThreshold: 0.7,
  maxSimilarIssues: 5,

  notifyOnCritical: true,
  notifyChannels: ["feishu"],
};

// ============================================
// 工具函数
// ============================================

/**
 * 判断是否可以自动修复
 */
export function canAutoFix(
  decision: TriageDecision,
  config: TriageConfig = DEFAULT_TRIAGE_CONFIG,
): boolean {
  const { routing, priority, validity } = decision;
  const { autoFixThresholds } = config;

  // 必须启用自动修复
  if (!config.autoFixEnabled) return false;

  // 必须是有效问题
  if (!validity.isValid) return false;
  if (validity.confidence < autoFixThresholds.minValidityConfidence)
    return false;

  // 路由决策必须是 auto_fix
  if (routing.action !== "auto_fix") return false;

  // 置信度检查
  if (routing.confidence < autoFixThresholds.minRoutingConfidence) return false;

  // 检查自动修复计划
  if (!routing.autoFixPlan) return false;

  // 风险检查
  const riskLevels: RiskLevel[] = ["low", "medium", "high"];
  const maxRiskIndex = riskLevels.indexOf(autoFixThresholds.maxRiskLevel);
  const currentRiskIndex = riskLevels.indexOf(routing.autoFixPlan.riskLevel);
  if (currentRiskIndex > maxRiskIndex) return false;

  // 复杂度检查
  const complexityLevels: ComplexityLevel[] = [
    "trivial",
    "simple",
    "moderate",
    "complex",
  ];
  const maxComplexityIndex = complexityLevels.indexOf(
    autoFixThresholds.maxComplexity,
  );
  const currentComplexityIndex = complexityLevels.indexOf(
    routing.autoFixPlan.estimatedComplexity,
  );
  if (currentComplexityIndex > maxComplexityIndex) return false;

  // 优先级检查
  if (autoFixThresholds.excludePriorities.includes(priority.level))
    return false;

  return true;
}

/**
 * 计算优先级分数
 */
export function calculatePriorityScore(factors: PriorityFactors): number {
  const weights = {
    userImpact: 0.3,
    severity: 0.35,
    frequency: 0.15,
    businessImpact: 0.2,
  };

  return Math.round(
    factors.userImpact * weights.userImpact +
      factors.severity * weights.severity +
      factors.frequency * weights.frequency +
      factors.businessImpact * weights.businessImpact,
  );
}

/**
 * 根据分数确定优先级
 */
export function scoreToPriorityLevel(score: number): PriorityLevel {
  if (score >= 85) return "critical";
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  return "low";
}
