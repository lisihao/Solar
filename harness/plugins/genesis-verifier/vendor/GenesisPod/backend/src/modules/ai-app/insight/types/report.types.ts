/**
 * Topic Research - Report Types
 *
 * 综合研究报告的类型定义
 */

// ==================== Report Section ====================

/**
 * 报告章节
 */
export interface ReportSection {
  /** 章节编号 (如 "1", "2") */
  sectionNumber: string;
  /** 章节标题 */
  title: string;
  /** 核心观点列表 */
  coreViewpoints: string[];
  /** 章节内容 (Markdown 格式) */
  content: string;
  /** 关键数据 */
  keyData: Array<{
    data: string;
    source: string;
  }>;
  /** 图表引用 (旧格式，保持兼容) */
  figureReferences: Array<{
    id: string;
    description: string;
    suggestedType: "趋势图" | "对比图" | "流程图" | "表格" | "其他";
  }>;
  /**
   * 内联图表 (新格式)
   * ★ 图表嵌入章节，根据正文内容需求生成
   */
  inlineCharts?: Array<{
    id: string;
    position: string;
    type: "line" | "bar" | "area" | "pie" | "radar" | "composed";
    title: string;
    description?: string;
    data: Array<{
      label: string;
      value: number;
      series?: string;
    }>;
    xAxis?: { label: string };
    yAxis?: { label: string; unit?: string };
    source?: string;
  }>;
}

// ==================== Report Appendix ====================

/**
 * 报告附录
 */
export interface ReportAppendix {
  /** 附录标题 */
  title: string;
  /** 附录内容 (Markdown 格式) */
  content: string;
}

// ==================== Report Reference ====================

/**
 * 参考文献
 */
export interface ReportReference {
  /** 引用索引 */
  index: number;
  /** 标题 */
  title: string;
  /** URL */
  url: string;
  /** 访问日期 */
  accessDate: string;
  /** 来源域名 */
  domain: string | null;
}

// ==================== Report Metadata ====================

/**
 * 报告元数据
 */
export interface ReportMetadata {
  /** 总字数 */
  totalWords: number;
  /** 总来源数 */
  totalSources: number;
  /** 研究时间范围 */
  researchPeriod: string;
  /** 生成时间 */
  generatedAt: string;
}

// ==================== Comprehensive Report ====================

/**
 * 综合研究报告
 */
export interface ComprehensiveReport {
  /** 前言 (Markdown 格式) */
  preface: string;
  /** 目录 (Markdown 格式) */
  tableOfContents: string;
  /** 执行摘要 (面向高管的快速阅读版) */
  executiveSummary: string;
  /** 各章节内容 */
  sections: ReportSection[];
  /** 结束语/建议 (Markdown 格式) */
  conclusion: string;
  /** 跨维度关联分析 (Markdown 格式) */
  crossDimensionAnalysis?: string;
  /** 风险评估 (Markdown 格式) */
  riskAssessment?: string;
  /** 战略建议 (Markdown 格式) */
  strategicRecommendations?: string;
  /** 附录列表 */
  appendices: ReportAppendix[];
  /** 参考文献列表 */
  references: ReportReference[];
  /** 元数据 */
  metadata: ReportMetadata;
}

// ==================== Report Highlight ====================

/**
 * 报告亮点 (旧格式兼容)
 */
export interface ReportHighlight {
  /** 亮点标题 */
  title: string;
  /** 亮点内容 */
  content: string;
  /** 类别 */
  category: string;
  /** 来源维度名称 */
  dimensionName: string;
}

// ==================== Report Chart Types ====================

/**
 * 图表数据点
 */
export interface ChartDataPoint {
  /** X轴标签 */
  label: string;
  /** 数值 */
  value: number;
  /** 系列名称（多系列时使用） */
  series?: string;
  /** 额外数据 */
  extra?: Record<string, unknown>;
}

/**
 * 图表类型
 */
export type ChartType = "line" | "bar" | "area" | "pie" | "radar" | "composed";

/**
 * 报告图表
 * ★ 支持两种类型：reference（引用原始图表）和 generated（AI 生成图表）
 */
export interface ReportChart {
  /** 图表ID */
  id: string;
  /** ★ 图表来源类型：reference=引用原始图表，generated=AI生成图表 */
  chartType?: "reference" | "generated";
  /** 图表类型（仅 generated 需要） */
  type?: ChartType;
  /** 图表标题 */
  title: string;
  /** 图表描述 */
  description?: string;
  /** 数据（仅 generated 需要） */
  data?: ChartDataPoint[];
  /** X轴配置 */
  xAxis?: {
    label: string;
    type?: "category" | "number" | "time";
  };
  /** Y轴配置 */
  yAxis?: {
    label: string;
    unit?: string;
    min?: number;
    max?: number;
  };
  /** 数据来源 */
  source?: string;
  /** 关联的章节ID */
  sectionId?: string;
  /** 图表位置 */
  position?: string;
  /** ★ 关联的维度ID */
  dimensionId?: string;
  /** ★ 关联的维度名称 */
  dimensionName?: string;
  /** ★ 引用图表特有：图片URL */
  imageUrl?: string;
  /** ★ 引用图表特有：证据引用索引 */
  evidenceCitationIndex?: number;
  /** ★ SOTA: 全文顺序编号（图 1, 图 2, ...） */
  figureNumber?: number;
}

/**
 * 内联图表（嵌入章节内）
 * ★ 新增：图表根据正文内容需求生成，位置由 position 指定
 */
export interface InlineChart extends ReportChart {
  /**
   * 图表在章节内的位置
   * - "after_paragraph_N": 在第 N 段之后 (N=1,2,3...)
   * - "after_heading_N": 在第 N 个小标题之后
   * - "end_of_section": 章节末尾
   */
  position: string;
}

// ==================== AI Response Types ====================

/**
 * AI 报告合成响应
 */
export interface AIReportSynthesisResponse {
  preface: string;
  tableOfContents: string;
  executiveSummary: string | ExecutiveSummaryObject;
  sections: ReportSection[];
  conclusion: string;
  appendices: ReportAppendix[];
  charts?: ReportChart[];
  /** v3.0: 跨维度关联分析 */
  crossDimensionAnalysis?: {
    title?: string;
    causalChains?: Array<{
      chain: string;
      explanation: string;
      timeframe: string;
    }>;
    keyLinkages?: Array<{
      dimensions: string[];
      relationship: string;
      impact: string;
    }>;
    /** 反馈回路：自我强化或自我抑制的循环效应 */
    feedbackLoops?: string[];
    /** 系统性效应：多维度联动可能触发的涌现效应 */
    systemicEffects?: string[];
    fullText?: string;
  };
  /** v3.0: 情景展望 */
  scenarioOutlook?: {
    baseline?: string;
    optimistic?: string;
    pessimistic?: string;
  };
  /** v3.0: 风险评估 */
  riskAssessment?: {
    title?: string;
    riskMatrix?: Array<{
      riskType: string;
      probability: string;
      impact: string;
      timeframe: string;
      indicators: string;
      mitigation?: string;
    }>;
    fullText?: string;
  };
  /** v3.0: 战略建议 */
  strategicRecommendations?: {
    title?: string;
    forEnterprise?: {
      shortTerm: string[];
      midTerm: string[];
    };
    forInvestors?: {
      opportunities: string[];
      risks: string[];
    };
    forPolicymakers?: {
      keyObservations: string[];
    };
    fullText?: string;
  };
  references: Array<{
    index: number;
    title: string;
    url: string;
    accessDate: string;
    domain: string | null;
  }>;
  metadata: {
    totalWords: number;
    totalSources: number;
    researchPeriod: string;
    generatedAt: string;
  };
}

/**
 * 执行摘要对象格式
 */
export interface ExecutiveSummaryObject {
  /** 核心论断：一句话概括本报告最重要的发现/判断 */
  thesisStatement?: string;
  coreConclusions?: string[];
  keyMetrics?: Array<{ metric: string; value: string; source: string }>;
  riskAlerts?: string[];
  actionItems?: string[];
  fullText?: string;
}

// ==================== Dimension Analysis Input ====================

/**
 * 维度分析输入（用于报告合成）
 */
export interface DimensionAnalysisInput {
  dimensionId: string;
  dimensionName: string;
  dimensionDescription: string | null;
  summary: string;
  keyFindings: Array<{
    finding: string;
    significance: string;
    evidenceIds: string[];
  }>;
  trends: Array<{
    trend: string;
    direction: string;
    timeframe: string;
    evidenceIds: string[];
  }>;
  challenges: Array<{
    challenge: string;
    impact: string;
    evidenceIds: string[];
  }>;
  opportunities: Array<{
    opportunity: string;
    potential: string;
    evidenceIds: string[];
  }>;
  detailedContent: string;
  sourcesUsed: number;
  /** ★ 章节优先级（数字越小越靠前） */
  priority?: number;
  /** ★ 引用的原始图表（来自证据） */
  figureReferences?: Array<{
    id: string;
    figureId?: string;
    evidenceCitationIndex?: number;
    figureIndex?: number;
    imageUrl?: string;
    caption: string;
    position: string;
    source?: string;
  }>;
  /** ★ AI 补充生成的图表 */
  generatedCharts?: Array<{
    id: string;
    type: "line" | "bar" | "pie" | "area" | "radar";
    title: string;
    position: string;
    data: Array<{ label: string; value: number; series?: string }>;
    source: string;
  }>;
}

// ==================== Evidence Input ====================

/**
 * 证据输入（用于报告合成）
 */
export interface EvidenceInput {
  citationIndex: number;
  title: string;
  url: string;
  domain: string | null;
  sourceType: string | null;
  publishedAt: Date | null;
  credibilityScore: number | null;
}

// ==================== Report Synthesis Result ====================

/**
 * 报告合成结果
 */
export interface ReportSynthesisResult {
  /** 执行摘要 */
  executiveSummary: string;
  /** 完整报告 (Markdown 格式，包含所有章节) */
  fullReport: string;
  /** 亮点列表 (兼容旧格式) */
  highlights: ReportHighlight[];
  /** 结构化报告数据 */
  structuredReport: ComprehensiveReport;
  /** 图表数据 */
  charts: ReportChart[];
}
