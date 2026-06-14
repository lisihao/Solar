/**
 * Quality Enhancement Types
 *
 * P1 优化：自一致性验证和批评-改进循环类型定义
 * 参考：Self-Consistency (Wang et al., 2022), Reflexion (Shinn et al., 2023)
 */

// ==================== Self-Consistency Types ====================

/**
 * 推理路径
 */
export interface ReasoningPath {
  id: string;
  reasoning: string; // 完整推理过程
  conclusion: string; // 最终结论
  confidence: number; // 0-1
  keySteps: string[]; // 关键推理步骤
  evidenceUsed: string[]; // 使用的证据 ID
  temperature: number; // 生成时的 temperature
  generatedAt: Date;
}

/**
 * 一致性检查结果
 */
export interface ConsistencyCheckResult {
  // 所有推理路径
  paths: ReasoningPath[];

  // 多数结论
  majorityConclusion: string;

  // 一致性率 0-1
  agreementRate: number;

  // 是否一致（agreementRate >= threshold）
  isConsistent: boolean;

  // 异议路径
  dissidentPaths: ReasoningPath[];

  // 综合结论（融合多数和异议）
  synthesizedConclusion: string;

  // 结论聚类
  clusters: Array<{
    theme: string;
    pathIds: string[];
    isMajority: boolean;
    representativeConclusion: string;
  }>;

  // 是否需要人工审核
  needsHumanReview: boolean;

  // 审核原因
  reviewReasons?: string[];
}

/**
 * 自一致性配置
 */
export interface SelfConsistencyConfig {
  // 是否启用
  enabled: boolean;

  // 生成的推理路径数
  numPaths: number;

  // 一致性阈值
  consistencyThreshold: number;

  // 使用的 temperature 范围
  temperatureRange: {
    min: number;
    max: number;
  };

  // 是否在不一致时综合结论
  synthesizeOnDisagreement: boolean;

  // 人工审核阈值（低于此值需要人工审核）
  humanReviewThreshold: number;
}

/**
 * 默认自一致性配置
 */
export const DEFAULT_SELF_CONSISTENCY_CONFIG: SelfConsistencyConfig = {
  enabled: true,
  numPaths: 5,
  consistencyThreshold: 0.7,
  temperatureRange: {
    min: 0.3,
    max: 0.9,
  },
  synthesizeOnDisagreement: true,
  humanReviewThreshold: 0.5,
};

// ==================== Critique-Refine Types ====================

/**
 * 批评项类别
 */
export enum CritiqueCategory {
  FACTUAL = "factual", // 事实准确性
  LOGICAL = "logical", // 逻辑严谨性
  COVERAGE = "coverage", // 覆盖完整性
  CLARITY = "clarity", // 表达清晰度
  STYLE = "style", // 风格一致性
  DEPTH = "depth", // 分析深度
  RELEVANCE = "relevance", // 相关性
  CITATION = "citation", // 引用规范
}

/**
 * 批评项严重程度
 */
export enum CritiqueSeverity {
  CRITICAL = "critical", // 必须修正
  MAJOR = "major", // 应该修正
  MINOR = "minor", // 建议修正
  SUGGESTION = "suggestion", // 可选改进
}

/**
 * 单个批评项
 */
export interface CritiqueItem {
  id: string;
  category: CritiqueCategory;
  severity: CritiqueSeverity;

  // 问题位置
  location: {
    type: "paragraph" | "sentence" | "section" | "document";
    reference: string; // 段落号、句子等
    quote?: string; // 相关引文
  };

  // 问题描述
  issue: string;

  // 改进建议
  suggestion: string;

  // 修复示例（可选）
  exampleFix?: string;

  // 相关证据（如果是事实性问题）
  relatedEvidence?: string[];
}

/**
 * 批评结果
 */
export interface CritiqueResult {
  // 总体评分 0-1
  overallScore: number;

  // 各维度评分
  categoryScores: Record<CritiqueCategory, number>;

  // 批评项列表
  items: CritiqueItem[];

  // 优点
  strengths: string[];

  // 关键问题（critical 级别）
  criticalIssues: CritiqueItem[];

  // 改进优先级
  improvementPriorities: string[];

  // 综合评语
  summary: string;

  // 是否达到质量标准
  meetsQualityStandard: boolean;

  // 建议的改进轮数
  suggestedRefinementRounds: number;
}

/**
 * 改进结果
 */
export interface RefineResult {
  // 改进后的内容
  refinedContent: string;

  // 应用的修改
  changesApplied: Array<{
    critiqueItemId: string;
    original: string;
    revised: string;
    reason: string;
    changeType: "correction" | "improvement" | "addition" | "deletion";
  }>;

  // 剩余问题（未能修复的）
  remainingIssues: CritiqueItem[];

  // 改进评分提升
  scoreImprovement: number;

  // 改进摘要
  refinementSummary: string;
}

/**
 * 批评-改进循环迭代
 */
export interface CritiqueRefineIteration {
  iterationNumber: number;
  critique: CritiqueResult;
  refinement: RefineResult;
  contentBefore: string;
  contentAfter: string;
  scoreChange: number;
  timestamp: Date;
}

/**
 * 批评-改进循环结果
 */
export interface CritiqueRefineLoopResult {
  // 最终内容
  finalContent: string;

  // 所有迭代
  iterations: CritiqueRefineIteration[];

  // 最终评分
  finalScore: number;

  // 总改进幅度
  totalScoreImprovement: number;

  // 总修改数
  totalChanges: number;

  // 是否达到目标分数
  reachedTargetScore: boolean;

  // 停止原因
  stopReason:
    | "target_reached"
    | "max_iterations"
    | "no_improvement"
    | "no_critical_issues"
    | "manual_stop";

  // 元数据
  metadata: {
    totalIterations: number;
    totalTimeMs: number;
    tokensUsed: number;
  };
}

/**
 * 批评-改进配置
 */
export interface CritiqueRefineConfig {
  // 是否启用
  enabled: boolean;

  // 最大迭代次数
  maxIterations: number;

  // 目标分数
  targetScore: number;

  // 是否在无关键问题时停止
  stopOnNoCritical: boolean;

  // 是否在无改进时停止
  stopOnNoImprovement: boolean;

  // 最小改进阈值（低于此值视为无改进）
  minImprovementThreshold: number;

  // 启用的批评类别
  enabledCategories: CritiqueCategory[];

  // 质量标准
  qualityStandard: {
    minOverallScore: number;
    maxCriticalIssues: number;
    maxMajorIssues: number;
  };
}

/**
 * 默认批评-改进配置
 */
export const DEFAULT_CRITIQUE_REFINE_CONFIG: CritiqueRefineConfig = {
  enabled: true,
  maxIterations: 3,
  targetScore: 0.85,
  stopOnNoCritical: true,
  stopOnNoImprovement: true,
  minImprovementThreshold: 0.02,
  enabledCategories: [
    CritiqueCategory.FACTUAL,
    CritiqueCategory.LOGICAL,
    CritiqueCategory.COVERAGE,
    CritiqueCategory.CLARITY,
  ],
  qualityStandard: {
    minOverallScore: 0.75,
    maxCriticalIssues: 0,
    maxMajorIssues: 3,
  },
};

// ==================== Section Self-Evaluation Types ====================

/** 4 维自评维度（从 10 维中选最可补救的 4 个） */
export type SelfEvalDimension =
  | "analytical_depth"
  | "evidence_coverage"
  | "actionability"
  | "writing_quality";

/** 单 section 自评结果 */
export interface SectionSelfEvalResult {
  scores: Record<SelfEvalDimension, number>; // 1-10
  weakAreas: SelfEvalDimension[]; // score < threshold 的维度
  overallOk: boolean; // 所有维度 >= threshold
}

/** 补救动作类型 */
export type RemediationActionType =
  | "deepen_analysis"
  | "inject_evidence"
  | "add_recommendations"
  | "improve_style";

/** 单个补救动作 */
export interface RemediationAction {
  type: RemediationActionType;
  dimension: SelfEvalDimension;
  score: number; // 自评分数
  guidance: string; // 补救指令
}

/** 补救执行结果 */
export interface RemediationResult {
  content: string; // 补救后的内容
  actionsApplied: RemediationAction[];
  skipped: boolean;
  skipReason?: string;
}

/** 补救过程追踪（附加到 ChapterEvaluation） */
export interface RemediationTrace {
  sectionTitle: string;
  originalModel: string;
  remediationModel?: string; // 补救使用的模型（升级后的 STRONG 模型）
  /** 补救前 4 维自评分数（写作后、补救前的首轮评估） */
  selfEvalScores: Record<string, number>;
  /** 补救后 4 维自评分数（强制闭环：补救完成后的重评） */
  selfEvalScoresAfter?: Record<string, number>;
  /** 补救前后平均分差（正数 = 改善；负数 = 退步） */
  scoreDelta?: number;
  /** 补救后是否真正解决了所有弱维度（所有分数 >= 7） */
  weakAreasResolved?: boolean;
  actions: Array<{
    type: string; // deepen_analysis | inject_evidence | ...
    dimension: string;
    scoreBefore: number;
    /** 补救后该维度的新分数（强制重评产出） */
    scoreAfter?: number;
    guidance: string;
  }>;
  wasRemediated: boolean; // 是否执行了补救
  skippedReason?: string; // 跳过原因
  /** 用于 Prompt 版本溯源（写作时 prompt 的版本 + hash） */
  promptVersion?: string;
  promptHash?: string;
}

// ==================== Combined Quality Enhancement Types ====================

/**
 * 综合质量增强配置
 */
export interface QualityEnhancementConfig {
  selfConsistency: SelfConsistencyConfig;
  critiqueRefine: CritiqueRefineConfig;
}

/**
 * 综合质量报告
 */
export interface QualityEnhancementReport {
  // 自一致性结果
  consistencyResult?: ConsistencyCheckResult;

  // 批评-改进结果
  critiqueRefineResult?: CritiqueRefineLoopResult;

  // 综合质量分数
  overallQualityScore: number;

  // 质量指标
  qualityMetrics: {
    factualAccuracy: number;
    logicalCoherence: number;
    coverageCompleteness: number;
    expressionClarity: number;
    consistencyRate: number;
  };

  // 建议
  recommendations: string[];

  // 是否通过质量门槛
  passedQualityGate: boolean;
}
