/** 违规严重程度 */
export type ViolationSeverity = "error" | "warning" | "info";

/** Layer 2 内容评分结果 */
export interface ContentScore {
  factuality: number;
  depth: number;
  coherence: number;
  completeness: number;
  overallScore: number;
}

/** Critique-lite 改进建议结果 */
export interface CritiqueResult {
  suggestions: string[];
  criticalIssues: string[];
  refinedSummary?: string;
}

/** 单条违规 */
export interface QualityViolation {
  rule: string;
  severity: ViolationSeverity;
  message: string;
  section?: string;
  autoFixed?: boolean;
}

/** 报告质量检查结果 */
export interface ReportQualityResult {
  passed: boolean;
  violations: QualityViolation[];
  wasAutoFixed: boolean;
  fixedContent?: string;
  rewriteGuidance: string[];
  scores: {
    formatting: number;
    citationCoverage: number;
    contentDepth: number;
    overall: number;
  };
}

/** 双层质量检查综合结果 */
export interface DualLayerQualityResult {
  /** Layer 1: 结构/格式检查 (existing) */
  structural: ReportQualityResult;
  /** Layer 2: LLM 内容评分 (new) */
  content: ContentScore;
  /** 改进建议（仅在 overallScore < 0.6 时生成） */
  critique?: CritiqueResult;
  /** 综合判定 */
  passed: boolean;
}

/** 事实检查结果 */
export interface FactCheckResult {
  totalClaims: number;
  verifiedClaims: number;
  disputedClaims: number;
  unverifiedClaims: number;
  accuracyScore: number;
  details: FactCheckDetail[];
}

export interface FactCheckDetail {
  claim: string;
  verdict: "verified" | "disputed" | "unverified";
  confidence: number;
  supportingSources: string[];
}

/** 一致性检查结果 */
export interface ConsistencyCheckResult {
  isConsistent: boolean;
  conflicts: ConsistencyConflict[];
  overallScore: number;
}

export interface ConsistencyConflict {
  type: "data_conflict" | "logic_contradiction" | "source_conflict";
  description: string;
  sections: string[];
  severity: "high" | "medium" | "low";
}
