/**
 * AI Engine - Constraint Profile
 * 约束配置文件定义
 */

// ==================== 约束维度 ====================

/**
 * 成本约束
 */
export interface CostConstraint {
  /** 预算上限（积分/Token） */
  budget: number;

  /** 模型偏好 */
  modelPreference: ModelPreference;

  /** 是否允许超支 */
  allowOverBudget: boolean;

  /** 超支警告阈值（百分比） */
  warningThreshold: number;
}

export type ModelPreference = "cheap" | "balanced" | "premium";

/**
 * 质量约束
 */
export interface QualityConstraint {
  /** 研究深度 */
  depth: QualityDepth;

  /** 准确性要求 */
  accuracy: AccuracyRequirement;

  /** 是否需要 Leader 审核 */
  reviewRequired: boolean;

  /** 最小审核分数（0-10） */
  minReviewScore: number;

  /** 最大返工次数 */
  maxReworks: number;
}

export type QualityDepth = "quick" | "standard" | "comprehensive";

export type AccuracyRequirement =
  | "allow_inference"
  | "prefer_evidence"
  | "require_evidence";

/**
 * 效率约束
 */
export interface EfficiencyConstraint {
  /** 截止时间 */
  deadline?: Date;

  /** 最大执行时间（毫秒） */
  maxDuration: number;

  /** 优先级 */
  priority: Priority;

  /** 是否允许并行执行 */
  allowParallel: boolean;

  /** 最大并行数 */
  maxParallelism: number;
}

export type Priority = "urgent" | "high" | "normal" | "low";

// ==================== 约束配置 ====================

/**
 * 完整约束配置
 */
export interface ConstraintProfile {
  /** 成本约束 */
  cost: CostConstraint;

  /** 质量约束 */
  quality: QualityConstraint;

  /** 效率约束 */
  efficiency: EfficiencyConstraint;

  /** 预设模式（可选，覆盖上述配置） */
  preset?: ConstraintPreset;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ==================== 预设模式 ====================

export type ConstraintPreset = "fast" | "balanced" | "thorough";

/**
 * 预设配置
 */
export const CONSTRAINT_PRESETS: Record<
  ConstraintPreset,
  Omit<ConstraintProfile, "metadata" | "preset">
> = {
  fast: {
    cost: {
      budget: 100,
      modelPreference: "cheap",
      allowOverBudget: false,
      warningThreshold: 0.8,
    },
    quality: {
      depth: "quick",
      accuracy: "allow_inference",
      reviewRequired: false,
      minReviewScore: 5,
      maxReworks: 0,
    },
    efficiency: {
      maxDuration: 5 * 60 * 1000, // 5 minutes
      priority: "urgent",
      allowParallel: true,
      maxParallelism: 5,
    },
  },

  balanced: {
    cost: {
      budget: 500,
      modelPreference: "balanced",
      allowOverBudget: false,
      warningThreshold: 0.7,
    },
    quality: {
      depth: "standard",
      accuracy: "prefer_evidence",
      reviewRequired: true,
      minReviewScore: 7,
      maxReworks: 2,
    },
    efficiency: {
      maxDuration: 30 * 60 * 1000, // 30 minutes
      priority: "normal",
      allowParallel: true,
      maxParallelism: 3,
    },
  },

  thorough: {
    cost: {
      budget: 2000,
      modelPreference: "premium",
      allowOverBudget: true,
      warningThreshold: 0.9,
    },
    quality: {
      depth: "comprehensive",
      accuracy: "require_evidence",
      reviewRequired: true,
      minReviewScore: 8,
      maxReworks: 3,
    },
    efficiency: {
      maxDuration: 4 * 60 * 60 * 1000, // 4 hours
      priority: "normal",
      allowParallel: true,
      maxParallelism: 2,
    },
  },
};

// ==================== 工具函数 ====================

/**
 * 创建约束配置
 */
export function createConstraintProfile(
  preset: ConstraintPreset,
  overrides?: Partial<ConstraintProfile>,
): ConstraintProfile {
  const base = CONSTRAINT_PRESETS[preset];
  return {
    ...base,
    ...overrides,
    preset,
    cost: { ...base.cost, ...overrides?.cost },
    quality: { ...base.quality, ...overrides?.quality },
    efficiency: { ...base.efficiency, ...overrides?.efficiency },
  };
}

/**
 * 获取默认约束配置
 */
export function getDefaultConstraintProfile(): ConstraintProfile {
  return createConstraintProfile("balanced");
}

/**
 * 合并约束配置
 */
export function mergeConstraintProfiles(
  base: ConstraintProfile,
  override: Partial<ConstraintProfile>,
): ConstraintProfile {
  return {
    ...base,
    ...override,
    cost: { ...base.cost, ...override.cost },
    quality: { ...base.quality, ...override.quality },
    efficiency: { ...base.efficiency, ...override.efficiency },
  };
}
