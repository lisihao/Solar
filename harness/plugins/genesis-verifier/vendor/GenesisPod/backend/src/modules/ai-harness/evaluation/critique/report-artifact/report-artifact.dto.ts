/**
 * ReportArtifact —— Writer Stage 的结构化输出契约
 *
 * 上游：mission-pipeline-baseline.md §7 / mission-pipeline-writer-artifact.md §2
 *
 * 与现有 ResearchReport（裸 markdown + sections）的关系：
 *   - ResearchReport = v1（保留向后兼容，老 mission 仍可 render）
 *   - ReportArtifact = v2（结构化，三视图共享，角标溯源，图来源红线）
 *
 * 持久化路径：消费方自家 mission 表的 report_full + report_artifact_version 字段
 * （契约不绑定具体 ai-app 表名）。
 */

/** 章节节点（章节视图核心） */
export interface ArtifactSection {
  id: string;
  type:
    | "executive_summary"
    | "preface"
    | "dimension"
    | "cross_dimension"
    | "risk_assessment"
    | "recommendations"
    | "outlook"
    | "conclusion"
    | "appendix";
  level: 2 | 3;
  title: string;
  anchor: string;
  startOffset: number;
  endOffset: number;
  wordCount: number;
  readingTimeMinutes: number;
  parentId?: string;
  children?: ArtifactSection[];
  citations: number[];
  figureIds: string[];
  factIds: string[];
  noveltyScore?: number;
  sourceDimensionId?: string;
}

/** 引用条目（角标溯源核心） */
export interface ArtifactCitation {
  index: number;
  uuid: string;
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  snippetUri?: string;
  publishedAt?: string;
  accessedAt: string;
  sourceType:
    | "gov"
    | "academic"
    | "industry"
    | "news"
    | "blog"
    | "community"
    | "other";
  credibilityScore: number;
  occurrences: ArtifactCitationOccurrence[];
}

export interface ArtifactCitationOccurrence {
  sectionId: string;
  paragraphIndex: number;
  characterOffset: number;
}

/** 图（图文并茂核心） */
export interface ArtifactFigure {
  id: string;
  type: "reference" | "extracted_chart";
  evidenceCitationIndex: number;
  sourceUrl: string;
  sourcePageOrSection?: string;
  imageUrl?: string;
  imageDataUri?: string;
  data?: unknown;
  chartType?: "line" | "bar" | "pie" | "scatter" | "flow" | "table";
  title: string;
  caption: string;
  altText: string;
  accessibilityDesc?: string;
  sectionId: string;
  paragraphIndex: number;
  anchorMode: "after_paragraph" | "inline" | "sidebar";
  referencedBy: { sectionId: string; phrase: string }[];
  width?: "full" | "half" | "quarter";
  position?: "left" | "center" | "right";
}

/** 快速视图（QuickView） */
export interface ArtifactQuickView {
  executiveSummary: { markdown: string; wordCount: number };
  topHighlights: ArtifactHighlight[];
  topTrends: {
    title: string;
    description: string;
    sourceDimensionId?: string;
    direction?: "increasing" | "decreasing" | "stable" | "emerging";
    timeframe?: string;
  }[];
  keyRisks: { title: string; description: string }[];
  topRecommendations: { title: string; description: string }[];
  keyCitations: number[];
  /**
   * 兼容字段：v1 设计含图表，v2 (PR-quickview-parity 2026-05-09) 决定快速视图不展示图，
   * 字段保留但前端不再渲染；assembler 仍填前 N 个 figure id 以便其他消费方使用。
   */
  keyFigures: string[];
  estimatedReadingTime: number;
  whatYouWillLearn: string[];
  /**
   * ★ PR-quickview-parity (2026-05-09): 结构化风险矩阵（参照 TI riskAssessment.riskMatrix shape）。
   * 来源 analyst.riskMatrix；缺失时为空数组，前端表格短路。
   */
  riskMatrix: {
    riskType: string;
    probability: "高" | "中" | "低";
    impact: "高" | "中" | "低";
    timeframe: string;
  }[];
  /**
   * ★ PR-quickview-parity (2026-05-09): 按受众分组的战略建议（参照 TI strategicRecommendations.{forEnterprise, forInvestors}）。
   * 来源 analyst.recommendationsByAudience；缺失时 forEnterprise/forInvestors 都 undefined，前端卡片短路。
   */
  recommendationsByAudience?: {
    forEnterprise?: { shortTerm: string[]; midTerm: string[] };
    forInvestors?: { shortTerm: string[]; midTerm: string[] };
  };
  /**
   * ★ PR-quickview-parity (2026-05-09): 按维度分组的核心发现（参照 TI dimensionAnalyses[].keyFindings）。
   * 来源 analyst.keyFindingsByDimension；缺失时 assembler 用 insights[] supportingDimensions[0] 兜底分组。
   */
  keyFindingsByDimension: {
    dimensionId?: string;
    dimensionName: string;
    findings: {
      finding: string;
      significance: "high" | "medium" | "low";
    }[];
  }[];
  /**
   * ★ Foresight (2026-05-29 前瞻洞察 L1)：结构化前瞻判断，驱动"未来推演"卡片。
   * 来源 analyst.foresight；缺失时 undefined，前端卡片短路不渲染。
   */
  foresight?: {
    baseCase: {
      judgment: string;
      probability: number;
      confidence: "low" | "moderate" | "high";
      horizon: "0-6m" | "6-18m" | "18m-3y" | "3y+";
      resolutionCriteria: string;
      baseRate?: string;
      evidenceIds: string[];
    }[];
    scenarios: {
      kind: "bull" | "base" | "bear";
      narrative: string;
      trigger: string;
      probability: number;
    }[];
    predeterminedElements: string[];
    criticalUncertainties: string[];
    leadingIndicators: { signal: string; watchFor: string }[];
    // ★ Forecast 红队 (2026-05-29 L2)：s9 critic 阶段事前验尸后回灌（缺失=未跑红队）
    couldBeWrongIf?: string[];
    robustness?: number;
  };
}

export interface ArtifactHighlight {
  type: "finding" | "trend" | "risk" | "opportunity" | "recommendation";
  title: string;
  oneLineSummary: string;
  sourceDimensionId: string;
  citations: number[];
  figureIds?: string[];
}

/** 事实表（超越 TI 的差异化能力） */
export interface ArtifactFactTriple {
  id: string;
  entity: string;
  attribute: string;
  value: string;
  sources: number[];
  conflict?: ArtifactConflictResolution;
}

export interface ArtifactConflictResolution {
  factIds: string[];
  resolutionType: "kept-both" | "preferred-one" | "flagged-unresolved";
  rationale: string;
}

/** 元信息 */
export interface ArtifactMetadata {
  topic: string;
  generatedAt: string;
  generationTimeMs: number;
  version: number;
  versionLabel?: string;
  isIncremental: boolean;
  changesFromPrev?: {
    sectionId: string;
    type: "added" | "modified" | "deleted";
  }[];
  dimensionCount: number;
  sourceCount: number;
  factCount: number;
  figureCount: number;
  wordCount: number;
  readingTimeMinutes: number;
  styleProfile: "academic" | "executive" | "journalistic" | "technical";
  lengthProfile: "brief" | "standard" | "deep" | "extended" | "epic" | "mega";
  audienceProfile: "executive" | "domain-expert" | "general-public";
  language: "zh-CN" | "en-US";
  searchTimeRange?: "30d" | "90d" | "180d" | "365d" | "730d" | "all";
  totalTokens: { prompt: number; completion: number; total: number };
  costCents: number;
  modelTrail: string[];
  /**
   * ★ Phase Lead-2: M6 SYNTHESIS Lead Foreword
   * Lead 在 mission 末尾写的 meta-level 执行摘要（不同于 Writer.summary）：
   *   - whatWeAnswered[] vs M0 successCriteria 逐条评估
   *   - whatRemainsUnclear[] 诚实承认局限
   *   - howToRead 引导用户阅读
   *   - recommendedFollowUp[] 下一步研究方向
   * 渲染时放在 ExecutiveSummary 之前，作为整份报告"老板视角"。
   */
  leaderForeword?: {
    whatWeAnswered: {
      criterion: string;
      addressed: "yes" | "partial" | "no";
      evidence: string;
    }[];
    whatRemainsUnclear: string[];
    howToRead: string;
    recommendedFollowUp: string[];
    generatedAt: string;
  };
  /**
   * ★ 沉淀消费 v3 (2026-04-29): 全链路质量 trace —— 5 探针 + 5 维评分 + Top issues
   * 由 ai-harness/evaluation/critique/QualityTraceComputeService 汇总，
   * 写入 reportArtifact.metadata，前端可视化 + 离线评估都用同一份。
   */
  pipelineQualityTrace?: import("../../../facade").QualityTrace;
  /**
   * ★ 沉淀消费 v3 (2026-04-29): 10 维 EVALUATOR 模型独立评分 + 模型对比
   */
  pipelineEvaluation?: import("../../../facade").EvaluationResult;
  /**
   * ★ PR-A2 + v1.5 收尾 (2026-05-06 v1.4 报告装配重构):
   * StructuralReportAssembler 拼装时使用的 ReportTemplate.id（如
   * "multi-dimension-report@v1" / "single-agent-freeform@v1"），
   * 用于 observability：监控不同 template 形态的报告产出占比 + 失败率。
   */
  templateId?: string;
  /**
   * ★ PR-A1 + v1.5 (2026-05-06): MarkdownSanitizer 规则集版本，
   * 让历史 ReportArtifact 在规则升级后能识别"按哪个版本 sanitize 的"。
   */
  sanitizerVersion?: string;
  /**
   * ★ v1.5 (代码评审反馈): structural assembler 检测到
   * sections.length !== expectedSectionCount(template, segments) 时
   * 写入此字段，作为 observability 信号。caller 可据此进入 fallback 流程。
   */
  sectionCountMismatch?: { expected: number; actual: number };
}

/** 10 维质量评分 */
export interface ArtifactQualityVerdicts {
  overall: number;
  dimensions: {
    traceability: number;
    factualConsistency: number;
    novelty: number;
    coverage: number;
    redundancy: number;
    formatCorrectness: number;
    citationDensity: number;
    styleConformance: number;
    lengthAccuracy: number;
    chapterBalance: number;
  };
  hardGateViolations: {
    dimension: string;
    severity: "error" | "warning";
    message: string;
  }[];
  warnings: { dimension: string; message: string }[];
  qualityTrace: {
    stage: string;
    check: string;
    passed: boolean;
    timestamp: number;
  }[];
  /**
   * P100-1: 终态汇总（前端可一眼看到的"质量信号"）
   * - excellent: overall ≥ 85 & 无 hardGate
   * - good: overall 70-84 & 无 hardGate
   * - acceptable: overall 50-69 OR hardGate=warning
   * - poor: overall <50 OR hardGate=error
   */
  finalVerdict?: "excellent" | "good" | "acceptable" | "poor";
}

/** ★ ReportArtifact 完整结构（v2） */
export interface ReportArtifact {
  // 段 1：核心内容
  content: {
    fullMarkdown: string;
    fullReportUri?: string;
    fullReportSize: number;
  };
  // 段 2：结构元数据
  sections: ArtifactSection[];
  // 段 3：引用表
  citations: ArtifactCitation[];
  // 段 4：图表表
  figures: ArtifactFigure[];
  // 段 5：快速视图
  quickView: ArtifactQuickView;
  // 段 6：事实表
  factTable: ArtifactFactTriple[];
  // 段 7：元信息
  metadata: ArtifactMetadata;
  // 段 8：质量
  quality: ArtifactQualityVerdicts;
}
