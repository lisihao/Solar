/**
 * 内容分析类型定义 - AI Office 共享模块
 * 用于 Slides 和 Docs 的智能内容分析和模板匹配
 *
 * 核心特征类型（enums + base interfaces）定义在 AI Engine L2:
 *   ai-engine/content/types/content-features.types.ts
 * 此文件 re-export 核心类型并扩展 L4 特有的业务类型。
 */

// Re-export core content feature types from L3 (AI Engine) via Facade
export {
  ContentComplexity,
  ContentCategory,
  DataDensity,
  TemporalDimension,
  HierarchyType,
} from "@/modules/ai-harness/facade";
export type {
  ContentFeatures,
  ExtractedEntity,
  VisualizationOpportunity,
  ParagraphFeatures,
  SectionFeatures,
} from "@/modules/ai-harness/facade";

// Re-import for local use in interfaces below
import type {
  ContentFeatures,
  ParagraphFeatures,
  SectionFeatures,
} from "@/modules/ai-harness/facade";

// ============================================================================
// 内容分析请求/响应 (L4 业务类型)
// ============================================================================

/**
 * 内容分析输入
 */
export interface ContentAnalysisInput {
  content: string;
  contentType?: "markdown" | "html" | "text" | "json";
  context?: {
    title?: string;
    purpose?: string;
    targetAudience?: string;
    industry?: string;
    modelId?: string;
  };
  options?: {
    extractEntities?: boolean;
    detectVisualizationOpportunities?: boolean;
    analyzeSentiment?: boolean;
    maxKeyTopics?: number;
  };
}

/**
 * 内容分析结果
 */
export interface ContentAnalysisResult {
  features: ContentFeatures;
  summary: string;
  suggestedStructure: SuggestedStructure;
  confidence: number;
  processingTime: number;
}

/**
 * 建议的结构
 */
export interface SuggestedStructure {
  forSlides?: {
    suggestedSlideCount: number;
    suggestedTemplates: string[];
    chapterBreakdown: Array<{
      title: string;
      slideCount: number;
      templates: string[];
    }>;
  };
  forDocs?: {
    suggestedWordCount: number;
    suggestedSections: Array<{
      title: string;
      type: string;
      estimatedWords: number;
    }>;
    documentStyle: "formal" | "casual" | "technical" | "executive";
  };
}

/**
 * 完整文档分析结果
 */
export interface DocumentAnalysisResult {
  title: string;
  overview: ContentAnalysisResult;
  sections: SectionFeatures[];
  crossSectionInsights: {
    mainTheme: string;
    narrativeFlow: string[];
    keyTakeaways: string[];
  };
}

// ============================================================================
// MECE 原则验证
// ============================================================================

export interface MECEValidation {
  isMutuallyExclusive: boolean;
  isCollectivelyExhaustive: boolean;
  overlaps: Array<{
    section1: string;
    section2: string;
    overlapDescription: string;
  }>;
  gaps: Array<{
    description: string;
    suggestedAddition: string;
  }>;
  score: number;
  recommendations: string[];
}

// ============================================================================
// 内容分段策略
// ============================================================================

export interface SegmentationStrategy {
  type: "by_topic" | "by_length" | "by_structure" | "hybrid";
  targetSegmentCount?: number;
  maxWordsPerSegment?: number;
  preserveHeadings: boolean;
  groupRelatedContent: boolean;
}

export interface ContentSegment {
  id: string;
  order: number;
  title?: string;
  content: string;
  features: ParagraphFeatures;
  suggestedTemplate: string;
  transitionHint?: string;
}
