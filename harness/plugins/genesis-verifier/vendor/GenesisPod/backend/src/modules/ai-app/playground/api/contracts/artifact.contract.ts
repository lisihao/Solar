/**
 * artifact.contract.ts —— ReportArtifact canonical view contract（B1-1）
 *
 * 单一源：本文件是 playground reportArtifact 字段的 backend canonical 形状。
 * frontend report-artifact.types.ts 应在 B4 切换时改为 mirror 此文件。
 *
 * 落地依据：
 *   docs/architecture/ai-app/playground/agent-team-thinning-plan-2026-05-26.md
 *   §6.6 Artifact semantics / §6.6.2 First-cut artifact version map
 *   §6.6.4 Large-artifact and off-load policy
 *
 * Source anchors（当前实现位置，B3-2 port 时参考）：
 *   - 前端 v2 shape: frontend/lib/features/playground/report-artifact.types.ts
 *   - 前端 v1→v2 normalization: frontend/lib/features/playground/synthesize-artifact.ts
 *
 * 注意 §6.6.4 R2 off-load 约束：
 *   - reportFull 可能 off-loaded 到 R2（DB NULL + reportFullUri 非 NULL）
 *   - projector 必须假设此情况存在，不得永远假定 inline cheap select
 *   - 若 off-load fetch 威胁 p95 < 200ms gate，需引入 large-artifact fetch policy
 */

// ============================================================================
// V2 Canonical ReportArtifact（来源 mirror frontend report-artifact.types.ts）
// ============================================================================

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

export interface ArtifactCitationOccurrence {
  sectionId: string;
  paragraphIndex: number;
  characterOffset: number;
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
  referencedBy: Array<{ sectionId: string; phrase: string }>;
  width?: "full" | "half" | "quarter";
  position?: "left" | "center" | "right";
}

export interface ArtifactHighlight {
  type: "finding" | "trend" | "risk" | "opportunity" | "recommendation";
  title: string;
  oneLineSummary: string;
  sourceDimensionId: string;
  citations: number[];
  figureIds?: string[];
}

export interface ArtifactQuickView {
  executiveSummary: { markdown: string; wordCount: number };
  topHighlights: ArtifactHighlight[];
  topTrends: Array<{
    title: string;
    description: string;
    sourceDimensionId?: string;
    direction?: "increasing" | "decreasing" | "stable" | "emerging";
    timeframe?: string;
  }>;
  keyRisks: Array<{ title: string; description: string }>;
  topRecommendations: Array<{ title: string; description: string }>;
  keyCitations: number[];
  /** 兼容字段：v2 起前端不渲染但 backend 仍填充供其他消费方。 */
  keyFigures: string[];
  estimatedReadingTime: number;
  whatYouWillLearn: string[];
  riskMatrix: Array<{
    riskType: string;
    probability: "高" | "中" | "低";
    impact: "高" | "中" | "低";
    timeframe: string;
  }>;
  recommendationsByAudience?: {
    forEnterprise?: { shortTerm: string[]; midTerm: string[] };
    forInvestors?: { shortTerm: string[]; midTerm: string[] };
  };
  keyFindingsByDimension: Array<{
    dimensionId?: string;
    dimensionName: string;
    findings: Array<{
      finding: string;
      /** ★ 2026-05-27 (#108): 80-200 字解释段, 参照 Topic Insight 快速视图。Optional 兼容存量数据。 */
      body?: string;
      significance: "high" | "medium" | "low";
    }>;
  }>;
  /** ★ Foresight (2026-05-29 前瞻洞察 L1)：结构化前瞻判断，驱动前端"未来推演"卡片。Optional 兼容存量数据。 */
  foresight?: {
    baseCase: Array<{
      judgment: string;
      probability: number;
      confidence: "low" | "moderate" | "high";
      horizon: "0-6m" | "6-18m" | "18m-3y" | "3y+";
      resolutionCriteria: string;
      baseRate?: string;
      evidenceIds: string[];
    }>;
    scenarios: Array<{
      kind: "bull" | "base" | "bear";
      narrative: string;
      trigger: string;
      probability: number;
    }>;
    predeterminedElements: string[];
    criticalUncertainties: string[];
    leadingIndicators: Array<{ signal: string; watchFor: string }>;
    /** ★ Forecast 红队 (2026-05-29 L2)：事前验尸回灌的反指标 + 韧性分（缺失=未跑红队） */
    couldBeWrongIf?: string[];
    robustness?: number;
  };
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
  resolutionType: "kept-both" | "preferred-one" | "flagged-unresolved";
  rationale: string;
}

export interface ArtifactMetadata {
  topic: string;
  generatedAt: string;
  generationTimeMs: number;
  version: number;
  versionLabel?: string;
  isIncremental: boolean;
  changesFromPrev?: Array<{
    sectionId: string;
    type: "added" | "modified" | "deleted";
  }>;
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
  hardGateViolations: Array<{
    dimension: string;
    severity: "error" | "warning";
    message: string;
  }>;
  warnings: Array<{ dimension: string; message: string }>;
  qualityTrace: Array<{
    stage: string;
    check: string;
    passed: boolean;
    timestamp: number;
  }>;
  finalVerdict?: "excellent" | "good" | "acceptable" | "poor";
}

/**
 * V2 ReportArtifact —— canonical 形状。
 *
 * §6.6.4 R2 off-load 兼容：content.fullReportUri 非空时 content.fullMarkdown 可能为空，
 * projector 需要负责 hydrate（first cut 通过现有 Prisma JSON hydration 路径）。
 */
export interface ReportArtifactV2 {
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

// ============================================================================
// V1 Legacy ResearchReport（§6.6.2 line 806-810）
// ============================================================================

/**
 * v1 legacy shape 由 frontend/synthesize-artifact.ts 处理。
 * B3-2 ArtifactComposerService 必须按 §6.6.2 6 条规则 port 此映射到后端。
 */
export interface ReportV1ResearchReport {
  title: string;
  summary: string;
  sections: Array<{
    /** 在 v1 中以中文章节标题为 key 的自由结构。 */
    title: string;
    body: string;
    /** 可选子章节。 */
    subsections?: Array<{ title: string; body: string }>;
  }>;
  conclusion?: string;
  citations?: Array<{
    url: string;
    title?: string;
    publishedAt?: string;
  }>;
}

// ============================================================================
// V1 → V2 normalization rules contract（§6.6.2）
// ============================================================================

/**
 * §6.6.2 6 条 normalization 规则的契约表达。
 * B3-2 ArtifactComposerService 必须严格按此映射实施。任何 deviation 需要更新此表 + 同 PR 改 plan §6.6.2。
 */
export const V1_TO_V2_MAPPING_RULES = [
  {
    rule: 1,
    v1Path: "title",
    v2Path: "metadata.topic + sections[].title (top-level display)",
    note: "v1.title 同时填 metadata.topic 与 top-level display title",
  },
  {
    rule: 2,
    v1Path: "summary",
    v2Path: "quickView.executiveSummary.markdown",
    note: "wordCount 由 ArtifactComposerService 计算",
  },
  {
    rule: 3,
    v1Path: "sections[]",
    v2Path: "sections[] + content.fullMarkdown",
    note: "v1 section.body 拼成 fullMarkdown；subsections 转为 ArtifactSection.children level=3",
  },
  {
    rule: 4,
    v1Path: "conclusion",
    v2Path: "sections[type=conclusion] when present",
    note: "缺 conclusion 时 v2 sections 不强制包含 conclusion 类型",
  },
  {
    rule: 5,
    v1Path: "citations[]",
    v2Path: "citations[]",
    note: "title 缺失时用 hostname 派生 fallback title（new URL(url).hostname）",
  },
  {
    rule: 6,
    v1Path: "(absent figures/factTable/quality/quickView)",
    v2Path: "schema-complete empty collections or zeroed structures",
    note: "缺失字段必填 empty-state，禁止 leave missing",
  },
] as const;

// ============================================================================
// Canonical view-facing ReportArtifact union（§6.2 reportArtifact 字段）
// ============================================================================

/**
 * canonical view 暴露给前端的 reportArtifact 形状。
 *
 * - v2 ReportArtifact：B3-2 完成后的标准路径
 * - v1 normalized：B3-2 强制 normalize 为 v2 形状，不直接暴露 v1
 * - null artifact：以 EmptyArtifactSentinel（在 view-state.contract.ts）返回，不是 undefined
 */
export type ReportArtifactView = ReportArtifactV2;

/**
 * v2 shape 检测（mirror frontend isReportArtifact，但用作 backend type guard）。
 *
 * 注意：projector / composer 不应在 backend 里用此函数判断"要不要 normalize"——
 * 应根据 mission row 上的 `reportArtifactVersion` 字段决定（§6.6 line 478）。
 * 此函数仅作为 schema sanity check 工具。
 */
export function isReportArtifactV2(blob: unknown): blob is ReportArtifactV2 {
  if (!blob || typeof blob !== "object") return false;
  const r = blob as Record<string, unknown>;
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
