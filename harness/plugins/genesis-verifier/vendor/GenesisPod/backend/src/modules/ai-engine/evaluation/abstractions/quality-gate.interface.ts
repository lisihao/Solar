/**
 * Quality Gate Interface
 * 质量门禁抽象接口
 */

/**
 * 质量维度
 */
export type QualityDimension =
  | "diversity" // 多样性（词汇、句式）
  | "consistency" // 一致性（风格、事实）
  | "factual" // 事实准确性
  | "coherence" // 连贯性
  | "completeness" // 完整性
  | "relevance" // 相关性
  | "originality"; // 原创性

/**
 * 质量问题严重程度
 */
export type IssueSeverity = "error" | "warning" | "info";

/**
 * 质量问题
 */
export interface QualityIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  location?: {
    start: number;
    end: number;
    text?: string;
    line?: number;
    column?: number;
  };
  suggestion?: string;
  autoFixable?: boolean;
}

/**
 * 质量检查结果
 */
export interface QualityCheckResult {
  dimension: QualityDimension;
  score: number; // 0-100
  passed: boolean; // 是否通过
  issues: QualityIssue[]; // 发现的问题
  suggestions: string[]; // 改进建议
  metadata?: Record<string, unknown>;
  checkDuration?: number; // 检查耗时 (ms)
}

/**
 * 质量检查配置
 */
export interface QualityGateConfig {
  dimensions: QualityDimension[]; // 检查维度
  thresholds: {
    // 通过阈值
    [K in QualityDimension]?: number;
  };
  strictMode?: boolean; // 严格模式（任一不通过则失败）
  enableSuggestions?: boolean; // 是否生成建议
  maxIssuesPerDimension?: number; // 每个维度最大问题数
}

/**
 * 质量检查上下文
 */
export interface QualityCheckContext {
  contentType: "report" | "chapter" | "article" | "summary" | "code";
  previousContent?: string; // 之前的内容（用于一致性检查）
  referenceContent?: string; // 参考内容
  constraints?: Record<string, unknown>;
  language?: string; // 内容语言
}

/**
 * 质量门禁结果
 */
export interface QualityGateResult {
  passed: boolean;
  overallScore: number; // 综合评分
  results: QualityCheckResult[]; // 各维度结果
  summary: {
    passedCount: number;
    failedCount: number;
    totalIssues: number;
    criticalIssues: number;
  };
  recommendation: "approve" | "revise" | "reject";
  evaluationDuration: number; // 总评估耗时 (ms)
}

/**
 * 质量门禁服务接口
 */
export interface IQualityGate {
  /**
   * 执行质量门禁检查
   */
  evaluate(
    content: string,
    config: QualityGateConfig,
    context?: QualityCheckContext,
  ): Promise<QualityGateResult>;

  /**
   * 注册检查器
   */
  registerChecker(checker: IQualityChecker): void;

  /**
   * 获取可用检查器
   */
  getAvailableCheckers(): QualityDimension[];

  /**
   * 获取默认配置
   */
  getDefaultConfig(): QualityGateConfig;
}

/**
 * 质量检查器接口
 */
export interface IQualityChecker {
  readonly dimension: QualityDimension;
  readonly name: string;
  readonly description?: string;

  /**
   * 执行检查
   */
  check(
    content: string,
    context?: QualityCheckContext,
  ): Promise<QualityCheckResult>;

  /**
   * 检查器是否可用
   */
  isAvailable(): boolean;
}
