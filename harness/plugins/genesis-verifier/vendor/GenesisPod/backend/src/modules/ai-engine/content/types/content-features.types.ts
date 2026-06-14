/**
 * Content Feature Types — AI Engine Core (L2)
 *
 * 内容特征的核心类型定义，供 AI Engine 内部和 AI App 共同使用。
 * 这些类型定义在 L2 以确保依赖方向正确（L4 → L2，不反向）。
 *
 * 被以下模块使用：
 * - ai-engine/content/types/image-matching.types.ts (图文匹配 types)
 * - ai-app/office/content-analysis/ (内容分析服务)
 * - ai-app/office/common/ (模板选择等)
 */

// ============================================================================
// 内容特征枚举
// ============================================================================

export enum ContentComplexity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

export enum ContentCategory {
  NARRATIVE = "narrative",
  ANALYTICAL = "analytical",
  COMPARATIVE = "comparative",
  INSTRUCTIONAL = "instructional",
  PERSUASIVE = "persuasive",
  INFORMATIONAL = "informational",
}

export enum DataDensity {
  TEXT_HEAVY = "text_heavy",
  DATA_HEAVY = "data_heavy",
  BALANCED = "balanced",
  VISUAL_HEAVY = "visual_heavy",
}

export enum TemporalDimension {
  NONE = "none",
  HISTORICAL = "historical",
  CURRENT = "current",
  FUTURE = "future",
  TIMELINE = "timeline",
}

export enum HierarchyType {
  FLAT = "flat",
  HIERARCHICAL = "hierarchical",
  MATRIX = "matrix",
  NETWORK = "network",
}

// ============================================================================
// 基础接口
// ============================================================================

export interface ExtractedEntity {
  type:
    | "person"
    | "organization"
    | "product"
    | "technology"
    | "location"
    | "date"
    | "metric"
    | "concept";
  value: string;
  count: number;
  importance: number;
}

export interface VisualizationOpportunity {
  type:
    | "chart"
    | "timeline"
    | "comparison"
    | "matrix"
    | "flowchart"
    | "hierarchy"
    | "map";
  description: string;
  dataPoints?: string[];
  suggestedChartType?: string;
  priority: "high" | "medium" | "low";
}

// ============================================================================
// 内容特征分析结果
// ============================================================================

export interface ContentFeatures {
  category: ContentCategory;
  complexity: ContentComplexity;
  dataDensity: DataDensity;
  temporalDimension: TemporalDimension;
  hierarchyType: HierarchyType;
  wordCount: number;
  paragraphCount: number;
  listCount: number;
  tableCount: number;
  imageCount: number;
  codeBlockCount: number;
  keyTopics: string[];
  entities: ExtractedEntity[];
  sentiment?: "positive" | "neutral" | "negative";
  hasTimeline: boolean;
  hasComparison: boolean;
  hasStatistics: boolean;
  hasSteps: boolean;
  hasCaseStudy: boolean;
  hasRecommendations: boolean;
  hasRiskAnalysis: boolean;
  visualizationOpportunities: VisualizationOpportunity[];
}

// ============================================================================
// 段落/章节特征
// ============================================================================

export interface ParagraphFeatures {
  id: string;
  text: string;
  category: ContentCategory;
  keyPoints: string[];
  hasData: boolean;
  hasList: boolean;
  hasQuote: boolean;
  suggestedVisualization?: VisualizationOpportunity;
}

export interface SectionFeatures {
  id: string;
  title: string;
  level: number;
  paragraphs: ParagraphFeatures[];
  overallCategory: ContentCategory;
  complexity: ContentComplexity;
  keyMessages: string[];
  suggestedSlideTemplates?: string[];
  suggestedDocsSectionType?: string;
}
