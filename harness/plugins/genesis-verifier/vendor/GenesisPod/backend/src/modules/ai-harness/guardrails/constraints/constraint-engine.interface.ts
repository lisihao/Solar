/**
 * AI Engine - Constraint Engine Interface
 * 约束引擎接口定义
 */

import {
  ConstraintProfile,
  ModelPreference,
  QualityDepth,
} from "./constraint-profile";

// ==================== 约束评估结果 ====================

/**
 * 约束评估结果
 */
export interface ConstraintEvaluation {
  /** 是否满足所有约束 */
  satisfied: boolean;

  /** 成本评估 */
  cost: CostEvaluation;

  /** 质量评估 */
  quality: QualityEvaluation;

  /** 效率评估 */
  efficiency: EfficiencyEvaluation;

  /** 整体健康度（0-1） */
  healthScore: number;

  /** 警告列表 */
  warnings: ConstraintWarning[];

  /** 违规列表 */
  violations: ConstraintViolation[];

  /** 建议 */
  suggestions: ConstraintSuggestion[];
}

/**
 * 成本评估
 */
export interface CostEvaluation {
  /** 当前消耗 */
  currentUsage: number;

  /** 预算上限 */
  budget: number;

  /** 使用率（0-1） */
  usageRate: number;

  /** 剩余预算 */
  remaining: number;

  /** 预估总消耗 */
  estimatedTotal: number;

  /** 是否会超预算 */
  willExceedBudget: boolean;

  /** 状态 */
  status: "healthy" | "warning" | "critical" | "exceeded";
}

/**
 * 质量评估
 */
export interface QualityEvaluation {
  /** 当前质量分数（0-10） */
  currentScore: number;

  /** 最低要求分数 */
  requiredScore: number;

  /** 是否满足要求 */
  meetRequirement: boolean;

  /** 审核次数 */
  reviewCount: number;

  /** 返工次数 */
  reworkCount: number;

  /** 最大返工次数 */
  maxReworks: number;

  /** 状态 */
  status: "excellent" | "good" | "acceptable" | "poor";
}

/**
 * 效率评估
 */
export interface EfficiencyEvaluation {
  /** 已用时间（毫秒） */
  elapsedTime: number;

  /** 最大时间（毫秒） */
  maxDuration: number;

  /** 时间使用率（0-1） */
  timeUsageRate: number;

  /** 剩余时间（毫秒） */
  remainingTime: number;

  /** 预估完成时间（毫秒） */
  estimatedCompletion: number;

  /** 是否会超时 */
  willTimeout: boolean;

  /** 状态 */
  status: "on_track" | "at_risk" | "delayed" | "timeout";
}

// ==================== 约束警告和违规 ====================

/**
 * 约束警告
 */
export interface ConstraintWarning {
  /** 警告类型 */
  type: "cost" | "quality" | "efficiency";

  /** 警告代码 */
  code: string;

  /** 警告消息 */
  message: string;

  /** 当前值 */
  currentValue: number;

  /** 阈值 */
  threshold: number;

  /** 严重程度 */
  severity: "low" | "medium" | "high";
}

/**
 * 约束违规
 */
export interface ConstraintViolation {
  /** 违规类型 */
  type: "cost" | "quality" | "efficiency";

  /** 违规代码 */
  code: string;

  /** 违规消息 */
  message: string;

  /** 当前值 */
  currentValue: number;

  /** 限制值 */
  limit: number;

  /** 超出量 */
  excess: number;

  /** 是否可恢复 */
  recoverable: boolean;
}

/**
 * 约束建议
 */
export interface ConstraintSuggestion {
  /** 建议类型 */
  type: "cost" | "quality" | "efficiency" | "general";

  /** 建议代码 */
  code: string;

  /** 建议消息 */
  message: string;

  /** 预期改进 */
  expectedImprovement: string;

  /** 优先级 */
  priority: number;
}

// ==================== 资源分配 ====================

/**
 * 资源需求
 */
export interface ResourceRequirement {
  /** 预估 Token 消耗 */
  estimatedTokens: number;

  /** 预估时间（毫秒） */
  estimatedDuration: number;

  /** 所需模型能力 */
  requiredCapabilities: string[];

  /** 并行度需求 */
  parallelismNeeded: number;
}

/**
 * 资源分配
 */
export interface ResourceAllocation {
  /** 分配的模型 */
  model: string;

  /** 模型偏好 */
  modelTier: ModelPreference;

  /** 最大 Token 数 */
  maxTokens: number;

  /** 超时时间（毫秒） */
  timeout: number;

  /** 允许的并行度 */
  parallelism: number;

  /** 质量深度 */
  qualityDepth: QualityDepth;

  /** 是否启用审核 */
  reviewEnabled: boolean;

  /** 分配理由 */
  reasoning: string;
}

// ==================== 降级策略 ====================

/**
 * 降级策略
 */
export interface DegradationStrategy {
  /** 策略类型 */
  type:
    | "model_downgrade"
    | "reduce_parallelism"
    | "skip_review"
    | "reduce_iterations"
    | "simplify_task";

  /** 策略描述 */
  description: string;

  /** 预期节省（成本/时间） */
  expectedSaving: {
    cost?: number;
    time?: number;
  };

  /** 质量影响 */
  qualityImpact: "none" | "minor" | "moderate" | "significant";

  /** 应用方式 */
  apply: () => Partial<ConstraintProfile>;
}

// ==================== 约束引擎接口 ====================

/**
 * 约束引擎接口
 */
export interface IConstraintEngine {
  /**
   * 评估当前约束状态
   */
  evaluate(
    constraints: ConstraintProfile,
    currentUsage: ResourceUsage,
  ): ConstraintEvaluation;

  /**
   * 分配资源
   */
  allocate(
    requirements: ResourceRequirement,
    constraints: ConstraintProfile,
  ): ResourceAllocation;

  /**
   * 预估成本
   */
  estimateCost(
    requirements: ResourceRequirement,
    constraints: ConstraintProfile,
  ): CostEstimate;

  /**
   * 建议降级策略
   */
  suggestDegradation(
    violation: ConstraintViolation,
    constraints: ConstraintProfile,
  ): DegradationStrategy[];

  /**
   * 重新平衡约束
   */
  rebalance(
    constraints: ConstraintProfile,
    priority: "cost" | "quality" | "efficiency",
  ): ConstraintProfile;

  /**
   * 检查是否可以继续执行
   */
  canContinue(
    constraints: ConstraintProfile,
    currentUsage: ResourceUsage,
  ): { canContinue: boolean; reason?: string };
}

// ==================== 资源使用情况 ====================

/**
 * 资源使用情况
 */
export interface ResourceUsage {
  /** 已消耗 Token */
  tokensUsed: number;

  /** 已消耗成本（积分） */
  costUsed: number;

  /** 已用时间（毫秒） */
  timeElapsed: number;

  /** 审核次数 */
  reviewCount: number;

  /** 返工次数 */
  reworkCount: number;

  /** 当前质量分数 */
  qualityScore?: number;

  /** 完成进度（0-1） */
  progress: number;
}

/**
 * 成本预估
 */
export interface CostEstimate {
  /** 预估总成本（积分） */
  totalCost: number;

  /** 成本明细 */
  breakdown: CostBreakdown[];

  /** 预估时间（毫秒） */
  estimatedDuration: number;

  /** 置信度（0-1） */
  confidence: number;

  /** 是否在预算内 */
  withinBudget: boolean;

  /** 超出预算金额（如果超出） */
  overBudgetAmount?: number;

  /**
   * 本次预估使用的价格来源。
   * 'registry' = 来自 ModelPricingRegistry（admin 已配置模型 + 价格）；
   * 'fallback' = 来自 EMERGENCY_TIER_COSTS_NO_MODELS（admin 尚未注册任何模型的兜底）。
   */
  pricingSource?: "registry" | "fallback";
}

/**
 * 成本明细
 */
export interface CostBreakdown {
  /** 类别 */
  category: string;

  /** 描述 */
  description: string;

  /** 成本 */
  cost: number;

  /** 占比 */
  percentage: number;
}
