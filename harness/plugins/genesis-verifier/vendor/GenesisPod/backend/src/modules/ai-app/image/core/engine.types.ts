/**
 * GenesisPod v2.1 - 统一渲染架构类型定义
 *
 * 核心原则:
 * - 统一渲染模式: 图像模型(背景/视觉) + HTML/SVG(文字/图表)
 * - 所有模型从 AIModel 表获取，不硬编码
 * - 背景类型: solid | gradient | ai_generated
 */

// ============================================
// 背景类型定义 (替代原有的 RenderingMode)
// ============================================

/**
 * 背景类型 - 统一渲染模式下的唯一变量
 * - solid: 纯色背景，无需调用图像模型
 * - gradient: 渐变背景，无需调用图像模型
 * - ai_generated: AI生成背景，调用图像模型
 */
export type BackgroundType = "solid" | "gradient" | "ai_generated";

/**
 * 背景决策配置
 */
export interface BackgroundDecision {
  type: BackgroundType;
  reasoning: string;

  // 纯色/渐变背景配置
  colors?: {
    primary: string;
    secondary?: string;
    direction?: "horizontal" | "vertical" | "diagonal" | "radial";
  };

  // AI生成背景配置
  aiConfig?: {
    prompt: string;
    style: string;
    colorTone: string;
    complexity: "minimal" | "moderate" | "detailed";
  };
}

// ============================================
// 模板布局类型
// ============================================

export type TemplateLayoutType =
  | "cards"
  | "center_visual"
  | "timeline"
  | "comparison"
  | "pyramid"
  | "radial"
  | "statistics"
  | "checklist"
  | "funnel"
  | "matrix";

// ============================================
// 内容分析结果
// ============================================

export interface ContentAnalysis {
  type: "data_heavy" | "balanced" | "visual_concept";
  structureType:
    | "parallel_stories"
    | "sequential_process"
    | "central_concept"
    | "comparison"
    | "hierarchy";
  language: "zh" | "en" | "mixed";
  complexity: "high" | "medium" | "low";
  wordCount: number;
  hasData: boolean;
  hasTimeline: boolean;
  mainPointsCount: number;
  hasSummaryConclusion: boolean;
  reasoning: string;
}

// ============================================
// 信息架构
// ============================================

export interface PromptMetric {
  label: string;
  value: string;
  comparison?: string;
  trend?: "up" | "down" | "stable";
}

export interface PromptVisualCue {
  type?: "icon" | "chart" | "timeline" | "process" | "image";
  description?: string;
}

export interface PromptSection {
  id?: string;
  title?: string;
  summary?: string;
  bullets: string[];
  metrics: PromptMetric[];
  visual?: PromptVisualCue;
  iconType?: string;
  sectionType?: "main" | "summary";
}

export interface InformationArchitecture {
  title?: string;
  subtitle?: string;
  heroStatement?: string;
  centerVisualTitle?: string;
  centerVisualItems?: string[];
  sections: PromptSection[];
  callToAction?: string;
}

// ============================================
// 视觉语言配置
// ============================================

export type DesignStyle =
  | "consulting"
  | "tech"
  | "minimal"
  | "creative"
  | "dark"
  | "academic"
  | "business"
  | "genspark"
  | "tech_gradient"
  // Premium styles (对标 Genspark)
  | "genspark_pro"
  | "executive"
  | "tech_purple"
  | "sunset";

export type FontStyle = "sans" | "serif" | "mono" | "rounded";

export interface VisualLanguage {
  colorPalette: string[];
  primaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  typography?: string;
  iconography?: string;
  chartStyle?: string;
  designStyle?: DesignStyle;
  fontStyle?: FontStyle;
  borderRadius?: "none" | "small" | "medium" | "large";
  shadowStyle?: "none" | "subtle" | "medium" | "strong";
}

// ============================================
// 设计日志
// ============================================

export interface DesignJournalEntry {
  title: string;
  narrative: string;
}

// ============================================
// 统一渲染引擎输出 (替代原有的 PromptEngineeringInsights)
// ============================================

export interface VisualSpecification {
  // 背景决策 (统一渲染模式核心)
  backgroundDecision: BackgroundDecision;

  // 模板布局
  templateLayout: TemplateLayoutType;

  // 内容分析
  contentAnalysis: ContentAnalysis;

  // 信息架构
  informationArchitecture: InformationArchitecture;

  // 视觉语言
  visualLanguage: VisualLanguage;

  // 设计过程记录
  designJournal: DesignJournalEntry[];

  // 布局规划
  layoutPlan: string[];

  // 质量检查
  qualityChecks: string[];

  // 负面关键词 (用于图像生成)
  negativeKeywords: string[];

  // AI 图像生成提示词 (仅当 backgroundDecision.type === 'ai_generated')
  imagePrompt?: string;
  fallbackPrompt?: string;
}

// ============================================
// 可编辑元素定义
// ============================================

export type EditableElementType =
  | "text"
  | "heading"
  | "bullet"
  | "metric"
  | "icon"
  | "chart"
  | "image"
  | "shape";

export interface EditableElement {
  id: string;
  type: EditableElementType;
  content: string;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  style: {
    fontSize?: number;
    fontWeight?: string;
    color?: string;
    backgroundColor?: string;
    borderRadius?: number;
    opacity?: number;
  };
  locked?: boolean;
  layerIndex: number;
}

export interface EditableLayer {
  id: string;
  name: string;
  type: "background" | "content" | "overlay";
  visible: boolean;
  locked: boolean;
  elements: EditableElement[];
}

/**
 * 可编辑信息图 - 支持前端编辑的完整数据结构
 */
export interface EditableInfographic {
  id: string;
  version: number;

  // 画布尺寸
  canvas: {
    width: number;
    height: number;
    backgroundColor?: string;
  };

  // 图层结构
  layers: EditableLayer[];

  // 原始规格 (用于重新生成)
  specification: VisualSpecification;

  // 品牌配置引用
  brandKitId?: string;

  // 元数据
  metadata: {
    createdAt: string;
    updatedAt: string;
    createdBy?: string;
  };
}

// ============================================
// 品牌套件 (Brand Kit)
// ============================================

export interface BrandColor {
  name: string;
  hex: string;
  usage: "primary" | "secondary" | "accent" | "background" | "text";
}

export interface BrandFont {
  name: string;
  family: string;
  weight: number;
  usage: "heading" | "body" | "accent";
  fallback: string;
}

export interface BrandKit {
  id: string;
  name: string;
  description?: string;

  // 品牌颜色
  colors: BrandColor[];

  // 品牌字体
  fonts: BrandFont[];

  // 品牌 Logo
  logos: {
    primary?: string; // URL
    secondary?: string;
    icon?: string;
  };

  // 品牌语调 (用于文案生成)
  voice?: {
    tone: "formal" | "casual" | "friendly" | "professional";
    keywords: string[];
  };

  // 默认设计风格
  defaultStyle: DesignStyle;

  // 创建者
  userId: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// 导出格式
// ============================================

export type ExportFormat = "png" | "svg" | "pdf" | "pptx";

export interface ExportOptions {
  format: ExportFormat;
  scale?: 1 | 2 | 3 | 4; // 分辨率倍数
  quality?: number; // 0-100 (仅 PNG)
  includeBackground?: boolean;
  pageSize?: "a4" | "letter" | "16:9" | "custom"; // 仅 PDF/PPTX
}

export interface ExportResult {
  success: boolean;
  url?: string;
  base64?: string;
  format: ExportFormat;
  fileSize?: number;
  error?: string;
}

// ============================================
// Agent 系统类型
// ============================================

export interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  outputSchema: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  executionTime: number;
}

// Content Agent 输出
export interface ContentAgentOutput {
  informationArchitecture: InformationArchitecture;
  contentAnalysis: Omit<ContentAnalysis, "reasoning">;
}

// Layout Agent 输出
export interface LayoutAgentOutput {
  templateLayout: TemplateLayoutType;
  layoutPlan: string[];
  reasoning: string;
}

// Visual Agent 输出
export interface VisualAgentOutput {
  backgroundDecision: BackgroundDecision;
  iconMapping: Record<string, string>;
  chartRecommendations: Array<{
    sectionId: string;
    chartType: "bar" | "line" | "pie" | "donut" | "area" | "radar";
    config: Record<string, unknown>;
  }>;
}

// Style Agent 输出
export interface StyleAgentOutput {
  visualLanguage: VisualLanguage;
  designJournal: DesignJournalEntry[];
  qualityChecks: string[];
}

// ============================================
// 处理步骤
// ============================================

export interface ProcessingStep {
  step: string;
  status: "pending" | "processing" | "completed" | "error";
  title: string;
  content?: string;
  timestamp?: string;
  duration?: number;
}

// ============================================
// 生成结果
// ============================================

export interface GeneratedImageResult {
  id: string;
  imageUrl: string;
  prompt: string;
  enhancedPrompt?: string;

  // 统一渲染规格
  specification?: VisualSpecification;

  // 可编辑数据 (新增)
  editableData?: EditableInfographic;

  // 处理信息
  negativePrompt?: string;
  width: number;
  height: number;
  createdAt: string;
  processingSteps?: ProcessingStep[];
  extractedContent?: string;
  textModelUsed?: string;
  imageModelUsed?: string;

  // 错误信息
  error?: string;
}

// ============================================
// 生成选项
// ============================================

export interface GenerateImageOptions {
  // 输入源
  prompt?: string;
  urls?: string[];
  content?: string;
  imageBase64?: string;
  files?: Array<{ buffer: Buffer; mimeType: string; filename: string }>;

  // 模型选择 (可选，默认使用系统配置)
  textModelId?: string;
  imageModelId?: string;

  // 样式配置
  style?: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3";
  negativePrompt?: string;

  // 模板强制指定 (可选)
  templateLayout?: TemplateLayoutType;

  // 背景类型强制指定 (可选)
  backgroundType?: BackgroundType;

  // 品牌套件
  brandKitId?: string;

  // 跳过增强
  skipEnhancement?: boolean;

  // 用户信息
  userId?: string;
}

// ============================================
// 兼容性类型 (保持向后兼容)
// ============================================

/**
 * @deprecated 使用 BackgroundType 替代
 */
export type RenderingMode = "html_render" | "hybrid" | "ai_image";

/**
 * 将旧的 RenderingMode 映射到新的 BackgroundType
 */
export function mapRenderingModeToBackgroundType(
  mode: RenderingMode,
): BackgroundType {
  switch (mode) {
    case "ai_image":
      return "ai_generated";
    case "hybrid":
      return "ai_generated";
    case "html_render":
      return "gradient";
    default:
      return "gradient";
  }
}

/**
 * 将新的 BackgroundType 映射到旧的 RenderingMode (兼容性)
 */
export function mapBackgroundTypeToRenderingMode(
  type: BackgroundType,
): RenderingMode {
  switch (type) {
    case "ai_generated":
      return "hybrid";
    case "solid":
    case "gradient":
      return "html_render";
    default:
      return "hybrid";
  }
}
