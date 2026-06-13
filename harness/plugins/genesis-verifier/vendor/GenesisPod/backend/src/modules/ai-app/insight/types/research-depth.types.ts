/**
 * V5 Research Quality Types
 *
 * V5 研究质量优化的类型定义
 * 包含：研究深度配置、Claim 验证、假设检验、事实核查等
 */

// ==================== Research Depth Config ====================

/**
 * 研究深度等级
 */
export type ResearchDepth = "quick" | "standard" | "thorough";

/**
 * 研究深度配置
 * 控制各阶段的迭代次数和功能开关
 */
export interface ResearchDepthConfig {
  /** 知识构建迭代次数 (1=单次搜索, 2=补充搜索, 3=深度搜索) */
  knowledgeIterations: number;
  /** 认知循环最大轮数 (claim提取→验证→补充搜索) */
  maxCognitiveLoops: number;
  /** 章节修订最大轮数 */
  maxRevisionRounds: number;
  /** 是否启用交叉验证 */
  crossValidationEnabled: boolean;
  /** 是否启用假设检验 */
  hypothesisTestingEnabled: boolean;
  /** 是否启用事实核查 */
  factCheckEnabled: boolean;
  /** 是否启用文献基线扫描 */
  literatureBaselineEnabled: boolean;
}

/**
 * 根据深度等级解析配置
 */
export function resolveResearchDepthConfig(
  depth: ResearchDepth,
): ResearchDepthConfig {
  switch (depth) {
    case "quick":
      return {
        knowledgeIterations: 1,
        maxCognitiveLoops: 0,
        maxRevisionRounds: 0,
        crossValidationEnabled: false,
        hypothesisTestingEnabled: false,
        factCheckEnabled: false,
        literatureBaselineEnabled: false,
      };
    case "standard":
      return {
        knowledgeIterations: 2,
        maxCognitiveLoops: 1,
        maxRevisionRounds: 1,
        crossValidationEnabled: true,
        hypothesisTestingEnabled: true,
        factCheckEnabled: false,
        literatureBaselineEnabled: true,
      };
    case "thorough":
      return {
        knowledgeIterations: 3,
        maxCognitiveLoops: 2,
        maxRevisionRounds: 2,
        crossValidationEnabled: true,
        hypothesisTestingEnabled: true,
        factCheckEnabled: true,
        literatureBaselineEnabled: true,
      };
  }
}

// ==================== Research Design (L1) ====================

/**
 * 研究设计 - L1 层输出
 * 扩展 LeaderPlan，包含框架选择、假设生成、交付标准
 */
export interface ResearchDesign {
  /** 分析框架 (如 PESTEL, Porter's Five Forces, SWOT 等) */
  analyticalFramework: string;
  /** 框架选择理由 */
  frameworkRationale: string;
  /** 初始假设列表 */
  hypotheses: ResearchHypothesis[];
  /** 交付标准 */
  deliverables: DeliverableSpec[];
}

/**
 * 研究假设
 */
export interface ResearchHypothesis {
  /** 假设 ID */
  id: string;
  /** 假设陈述 */
  statement: string;
  /** 假设类型 */
  type: "causal" | "correlational" | "descriptive" | "predictive";
  /** 验证所需的证据方向 */
  evidenceNeeded: string;
  /** 反方向搜索查询（用于假设驱动查询） */
  counterQuery?: string;
}

/**
 * 交付物规格
 */
export interface DeliverableSpec {
  /** 交付物名称 */
  name: string;
  /** 质量标准 */
  qualityCriteria: string[];
}

// ==================== Claim Extraction & Validation (L3) ====================

/**
 * 从研究内容中提取的事实断言
 */
export interface ExtractedClaim {
  /** Claim ID */
  id: string;
  /** 断言内容 */
  statement: string;
  /** 所属章节 ID */
  sectionId: string;
  /** 支撑该断言的证据索引 */
  sourceEvidenceIndices: number[];
  /** 重要性 */
  importance: "high" | "medium" | "low";
}

/**
 * Claim 验证状态
 */
export type ClaimVerificationStatus = "verified" | "unverified" | "disputed";

/**
 * 单个 Claim 的验证结果
 */
export interface ClaimValidationResult {
  /** Claim ID */
  claimId: string;
  /** 验证状态 */
  status: ClaimVerificationStatus;
  /** 支持该 Claim 的来源索引 */
  supportingSourceIndices: number[];
  /** 反对该 Claim 的来源索引 */
  contradictingSourceIndices: number[];
  /** 验证说明 */
  explanation: string;
}

/**
 * 批量验证结果
 */
export interface ClaimValidationBatchResult {
  /** 所有 claim 的验证结果 */
  results: ClaimValidationResult[];
  /** 统计 */
  stats: {
    verified: number;
    unverified: number;
    disputed: number;
    total: number;
  };
}

// ==================== Hypothesis Verification (L3) ====================

/**
 * 假设验证结果
 */
export interface HypothesisVerificationResult {
  /** 假设 ID */
  hypothesisId: string;
  /** 验证状态 */
  status: "supported" | "refuted" | "partially_supported" | "inconclusive";
  /** 支持证据摘要 */
  supportingEvidence: string;
  /** 反对证据摘要 */
  contradictingEvidence: string;
  /** 置信度 (0-100) */
  confidence: number;
  /** 修正建议（如果假设被部分否定） */
  refinedStatement?: string;
}

// ==================== Fact Check (L5) ====================

/**
 * 事实核查结果
 */
export interface FactCheckResult {
  /** 核查的引用列表 */
  citations: FactCheckCitation[];
  /** 总体准确度评分 (0-100) */
  accuracyScore: number;
  /** 发现的问题 */
  issues: string[];
}

/**
 * 单个引用的核查结果
 */
export interface FactCheckCitation {
  /** 引用标记 (如 [1], [2]) */
  citationMark: string;
  /** 引用上下文 */
  context: string;
  /** 是否与原始证据一致 */
  consistent: boolean;
  /** 不一致说明 */
  inconsistencyNote?: string;
}

// ==================== Extended Checkpoint ====================

/**
 * V5 扩展的 Checkpoint 上下文字段
 * 融入现有 ResearchCheckpoint.context 中
 */
export interface V5CheckpointContext {
  /** L1 研究设计 */
  researchDesign?: ResearchDesign;
  /** Claim 验证结果 */
  claimValidationResults?: ClaimValidationBatchResult;
  /** 认知循环已执行次数 */
  cognitiveLoopCount?: number;
  /** 假设验证结果 */
  hypothesisResults?: HypothesisVerificationResult[];
  /** 事实核查结果 */
  factCheckResult?: FactCheckResult;
  /** 当前研究深度 */
  researchDepth?: ResearchDepth;
}
