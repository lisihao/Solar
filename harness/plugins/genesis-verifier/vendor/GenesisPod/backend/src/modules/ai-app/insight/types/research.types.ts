/**
 * Topic Research - Research Types
 *
 * 维度研究相关的类型定义
 */

// ==================== Research Options ====================

/**
 * 研究选项
 */
export interface ResearchOptions {
  /** 最大来源数量 */
  maxSources?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 强制刷新（忽略缓存） */
  forceRefresh?: boolean;
  /** 自定义搜索查询词 */
  searchQueries?: string[];
  /** 自定义搜索来源 */
  searchSources?: string[];
}

// ==================== Dimension Analysis Result ====================

/**
 * 维度分析结果
 */
export interface DimensionAnalysisResult {
  /** 维度 ID */
  dimensionId: string;
  /** 核心摘要 */
  summary: string;
  /** 关键发现 */
  keyFindings: KeyFinding[];
  /** 趋势分析 */
  trends: Trend[];
  /** 挑战分析 */
  challenges: Challenge[];
  /** 机会分析 */
  opportunities: Opportunity[];
  /** 使用的证据数量 */
  evidenceUsed: number;
  /** 置信度 */
  confidenceLevel: "high" | "medium" | "low";
  /** 详细内容（Markdown 格式） */
  detailedContent: string;
  /** 引用的原始图表 */
  figureReferences?: FigureReference[];
  /** AI 补充生成的图表 */
  generatedCharts?: GeneratedChart[];
  /** 实际使用的 LLM 模型 ID */
  modelUsed?: string;
  /** 补救过程追踪 */
  remediationTraces?: import("./quality.types").RemediationTrace[];
}

// ==================== Key Finding ====================

/**
 * 关键发现
 */
export interface KeyFinding {
  /** 发现内容 */
  finding: string;
  /** 重要性 */
  significance: "high" | "medium" | "low";
  /** 支撑证据的 ID 列表 */
  evidenceIds: string[];
}

// ==================== Trend ====================

/**
 * 趋势
 */
export interface Trend {
  /** 趋势描述 */
  trend: string;
  /** 趋势方向 */
  direction: "increasing" | "decreasing" | "stable" | "emerging";
  /** 时间范围 */
  timeframe: string;
  /** 支撑证据的 ID 列表 */
  evidenceIds: string[];
}

// ==================== Challenge ====================

/**
 * 挑战
 */
export interface Challenge {
  /** 挑战描述 */
  challenge: string;
  /** 影响分析 */
  impact: string;
  /** 支撑证据的 ID 列表 */
  evidenceIds: string[];
}

// ==================== Opportunity ====================

/**
 * 机会
 */
export interface Opportunity {
  /** 机会描述 */
  opportunity: string;
  /** 潜力评估 */
  potential: string;
  /** 支撑证据的 ID 列表 */
  evidenceIds: string[];
}

// ==================== Evidence Data ====================

/**
 * 证据数据（用于提示词）
 */
export interface EvidenceData {
  /** 证据 ID */
  id: string;
  /** 标题 */
  title: string;
  /** URL */
  url: string;
  /** 域名 */
  domain: string | null;
  /** 内容片段 */
  snippet: string | null;
  /** 来源类型 */
  sourceType: string | null;
  /** 发布时间（可能是 Date 对象或 ISO 字符串） */
  publishedAt: Date | string | null;
  /** 可信度评分 */
  credibilityScore: number | null;
  /** 全局引用编号（1-based，在维度全量 evidence 中的位置）— 由 filterEvidenceForSection 设置 */
  promptIndex?: number;
}

// ==================== Figure Reference Types ====================

/**
 * 图表引用（引用原始证据中的图表）
 */
export interface FigureReference {
  /** 图表 ID */
  id: string;
  /** 图表唯一 ID（如 FIG-1），对应 figureRegistry 中的 key */
  figureId?: string;
  /** 来源证据编号 [1], [2] — 由系统从 figureRegistry 回填 */
  evidenceCitationIndex?: number;
  /** 证据中的第几个图表（从 0 开始） — 由系统从 figureRegistry 回填 */
  figureIndex?: number;
  /** 图片 URL（从 figureRegistry 回填） */
  imageUrl?: string;
  /** 图表标题 */
  caption: string;
  /** 位置：after_paragraph_N */
  position: string;
  /** 来源说明 */
  source?: string;
  /** 相关性说明 */
  relevance?: string;
}

/**
 * 生成的图表（当原始图表不足时 AI 补充生成）
 */
export interface GeneratedChart {
  /** 图表 ID */
  id: string;
  /** 图表类型 */
  type: "line" | "bar" | "pie" | "area" | "radar";
  /** 图表标题 */
  title: string;
  /** 位置：after_paragraph_N */
  position: string;
  /** 图表数据 */
  data: Array<{ label: string; value: number; series?: string }>;
  /** 数据来源说明 */
  source: string;
  /** 生成原因 */
  reason?: string;
}

// ==================== AI Response Types ====================

/**
 * AI 维度分析响应
 */
export interface AIDimensionAnalysisResponse {
  dimensionAnalysis: {
    summary: string;
    keyFindings: Array<{
      finding: string;
      significance: "high" | "medium" | "low";
      evidenceIds: string[];
    }>;
    trends: Array<{
      trend: string;
      direction: "increasing" | "decreasing" | "stable" | "emerging";
      timeframe: string;
      evidenceIds: string[];
    }>;
    keyPlayers?: Array<{
      name: string;
      role: string;
      significance: string;
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
    dataGaps: string[];
    confidenceLevel: "high" | "medium" | "low";
    confidenceReason: string;
  };
  detailedContent: string;
  /** 引用的原始图表 */
  figureReferences?: FigureReference[];
  /** AI 补充生成的图表 */
  generatedCharts?: GeneratedChart[];
  evidenceUsage: {
    total: number;
    highCredibility: number;
    mediumCredibility: number;
    lowCredibility: number;
  };
}

// Note: AggregatedSearchResult 和 SearchResultItem 已在 data-source.types.ts 中定义
// 这里不再重复导出，使用 data-source.types.ts 中的定义

// ==================== Data Enrichment Types ====================

import type { DataSourceResult } from "./data-source.types";

/**
 * 从网页中提取的图表/图片信息
 */
export interface ExtractedFigure {
  /** 图片 URL */
  imageUrl: string;
  /** 图片标题/说明 */
  caption: string;
  /** 图表类型 */
  type: "chart" | "table" | "diagram" | "photo";
  /** alt 文本 */
  alt?: string;
  /** 图片宽度 */
  width?: number;
  /** 图片高度 */
  height?: number;
  /** 标记此图片来自图片搜索补充（非从证据页面抓取），不得继承文本证据的 citationIndex */
  isImageSearchSupplement?: boolean;
}

/**
 * 增强后的搜索结果
 * 在原有 DataSourceResult 基础上增加完整内容字段
 */
export interface EnrichedResult extends DataSourceResult {
  /** 完整网页内容（最多 3000 字） */
  fullContent: string | null;
  /** 内容来源：fetched=成功抓取，snippet=降级到原snippet */
  contentSource: "fetched" | "snippet";
  /** URL 有效性：内容是否有意义（非 404/403 等错误页面） */
  urlValid: boolean;
  /** 从网页中提取的图表/图片列表 */
  extractedFigures?: ExtractedFigure[];
}

/**
 * 增强后的证据数据（用于提示词）
 * 在原有 EvidenceData 基础上增加完整内容字段
 */
export interface EnrichedEvidenceData extends EvidenceData {
  /** 完整网页内容（最多 3000 字） */
  fullContent?: string | null;
  /** 内容来源：fetched=成功抓取，snippet=降级到原snippet */
  contentSource?: "fetched" | "snippet";
  /** 从网页中提取的图表/图片列表 */
  extractedFigures?: ExtractedFigure[];
}
