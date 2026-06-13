/**
 * ReportArtifact 前端类型镜像
 *
 * 与 backend/src/modules/ai-app/agent-playground/dto/report-artifact.dto.ts 保持同步。
 */

export interface ArtifactSection {
  id: string;
  type:
    | 'executive_summary'
    | 'preface'
    | 'dimension'
    | 'cross_dimension'
    | 'risk_assessment'
    | 'recommendations'
    | 'outlook'
    | 'conclusion'
    | 'appendix';
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

export interface ArtifactCitation {
  index: number;
  uuid: string;
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  publishedAt?: string;
  accessedAt: string;
  sourceType:
    | 'gov'
    | 'academic'
    | 'industry'
    | 'news'
    | 'blog'
    | 'community'
    | 'other';
  credibilityScore: number;
  occurrences: ArtifactCitationOccurrence[];
}

export interface ArtifactCitationOccurrence {
  sectionId: string;
  paragraphIndex: number;
  characterOffset: number;
}

export interface ArtifactFigure {
  id: string;
  type: 'reference' | 'extracted_chart';
  evidenceCitationIndex: number;
  sourceUrl: string;
  sourcePageOrSection?: string;
  imageUrl?: string;
  imageDataUri?: string;
  data?: unknown;
  chartType?: 'line' | 'bar' | 'pie' | 'scatter' | 'flow' | 'table';
  title: string;
  caption: string;
  altText: string;
  accessibilityDesc?: string;
  sectionId: string;
  paragraphIndex: number;
  anchorMode: 'after_paragraph' | 'inline' | 'sidebar';
  referencedBy: { sectionId: string; phrase: string }[];
  width?: 'full' | 'half' | 'quarter';
  position?: 'left' | 'center' | 'right';
}

export interface ArtifactQuickView {
  executiveSummary: { markdown: string; wordCount: number };
  topHighlights: ArtifactHighlight[];
  topTrends: {
    title: string;
    description: string;
    sourceDimensionId?: string;
    direction?: 'increasing' | 'decreasing' | 'stable' | 'emerging';
    timeframe?: string;
  }[];
  keyRisks: { title: string; description: string }[];
  topRecommendations: { title: string; description: string }[];
  keyCitations: number[];
  /** 兼容字段：v2 (PR-quickview-parity) 起前端不渲染，但 backend 仍填充供其他消费方。 */
  keyFigures: string[];
  estimatedReadingTime: number;
  whatYouWillLearn: string[];
  /** 结构化风险矩阵（TI 同款），来源 analyst.riskMatrix。空数组时表格短路。 */
  riskMatrix: {
    riskType: string;
    probability: '高' | '中' | '低';
    impact: '高' | '中' | '低';
    timeframe: string;
  }[];
  /** 按受众分组的战略建议（TI 同款）。来源 analyst.recommendationsByAudience。 */
  recommendationsByAudience?: {
    forEnterprise?: { shortTerm: string[]; midTerm: string[] };
    forInvestors?: { shortTerm: string[]; midTerm: string[] };
  };
  /** 按维度分组的核心发现（TI 同款）。来源 analyst.keyFindingsByDimension。 */
  keyFindingsByDimension: {
    dimensionId?: string;
    dimensionName: string;
    findings: {
      finding: string;
      /** ★ 2026-05-27 (#108): 80-200 字解释段, 参照 Topic Insight 快速视图。Optional 兼容存量数据。 */
      body?: string;
      significance: 'high' | 'medium' | 'low';
    }[];
  }[];
  /** ★ Foresight (2026-05-29 前瞻洞察 L1)：结构化前瞻判断，驱动"未来推演"卡片。Optional 兼容存量数据。 */
  foresight?: {
    baseCase: {
      judgment: string;
      probability: number;
      confidence: 'low' | 'moderate' | 'high';
      horizon: '0-6m' | '6-18m' | '18m-3y' | '3y+';
      resolutionCriteria: string;
      baseRate?: string;
      evidenceIds: string[];
    }[];
    scenarios: {
      kind: 'bull' | 'base' | 'bear';
      narrative: string;
      trigger: string;
      probability: number;
    }[];
    predeterminedElements: string[];
    criticalUncertainties: string[];
    leadingIndicators: { signal: string; watchFor: string }[];
    /** ★ Forecast 红队 (2026-05-29 L2)：事前验尸回灌的反指标 + 韧性分（缺失=未跑红队） */
    couldBeWrongIf?: string[];
    robustness?: number;
  };
}

export interface ArtifactHighlight {
  type: 'finding' | 'trend' | 'risk' | 'opportunity' | 'recommendation';
  title: string;
  oneLineSummary: string;
  sourceDimensionId: string;
  citations: number[];
  figureIds?: string[];
}

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
  resolutionType: 'kept-both' | 'preferred-one' | 'flagged-unresolved';
  rationale: string;
}

export interface ArtifactMetadata {
  topic: string;
  generatedAt: string;
  generationTimeMs: number;
  version: number;
  versionLabel?: string;
  isIncremental: boolean;
  changesFromPrev?: {
    sectionId: string;
    type: 'added' | 'modified' | 'deleted';
  }[];
  dimensionCount: number;
  sourceCount: number;
  factCount: number;
  figureCount: number;
  wordCount: number;
  readingTimeMinutes: number;
  styleProfile: 'academic' | 'executive' | 'journalistic' | 'technical';
  lengthProfile: 'brief' | 'standard' | 'deep' | 'extended' | 'epic' | 'mega';
  audienceProfile: 'executive' | 'domain-expert' | 'general-public';
  language: 'zh-CN' | 'en-US';
  searchTimeRange?: '30d' | '90d' | '180d' | '365d' | '730d' | 'all';
  totalTokens: { prompt: number; completion: number; total: number };
  costCents: number;
  modelTrail: string[];
}

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
    severity: 'error' | 'warning';
    message: string;
  }[];
  warnings: { dimension: string; message: string }[];
  qualityTrace: {
    stage: string;
    check: string;
    passed: boolean;
    timestamp: number;
  }[];
  finalVerdict?: 'excellent' | 'good' | 'acceptable' | 'poor';
}

export interface ReportArtifact {
  content: {
    fullMarkdown: string;
    fullReportUri?: string;
    fullReportSize: number;
  };
  sections: ArtifactSection[];
  citations: ArtifactCitation[];
  figures: ArtifactFigure[];
  quickView: ArtifactQuickView;
  factTable: ArtifactFactTriple[];
  metadata: ArtifactMetadata;
  quality: ArtifactQualityVerdicts;
}

/** 检测一个 reportFull blob 是否 v2 ReportArtifact */
export function isReportArtifact(report: unknown): report is ReportArtifact {
  if (!report || typeof report !== 'object') return false;
  const r = report as Record<string, unknown>;
  return (
    !!r.content &&
    !!r.sections &&
    !!r.citations &&
    !!r.figures &&
    !!r.quickView &&
    !!r.metadata &&
    !!r.quality
  );
}
