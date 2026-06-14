/**
 * Slides Template Types
 * PPTX 渲染器所需的模板内容类型定义
 *
 * 注意：这些类型支持额外的属性以兼容渲染器的各种使用场景
 */

// ============================================================================
// Insight & Speaker Notes Types (洞察框和演讲备注)
// ============================================================================

/**
 * 洞察类型
 */
export type InsightType = "insight" | "warning" | "tip" | "summary";

/**
 * 洞察框配置
 */
export interface InsightConfig {
  type: InsightType;
  text: string;
  icon?: string;
}

/**
 * KPI项配置
 */
export interface KpiItem {
  value: string;
  label: string;
  unit?: string;
  trend?: "up" | "down" | "flat";
  trendValue?: string;
}

/**
 * 基础幻灯片内容
 */
export interface BaseSlideContent {
  templateType: string;
  title?: string;
  subtitle?: string;
  /** 底部洞察框 */
  insight?: InsightConfig;
  /** 演讲备注 */
  speakerNotes?: string;
  [key: string]: unknown; // 允许额外属性
}

/**
 * 封面幻灯片
 */
export interface CoverSlideContent extends BaseSlideContent {
  templateType: "cover";
  title: string;
  subtitle?: string;
  author?: string;
  date?: string;
  logo?: string;
  backgroundImage?: string;
  organization?: string;
  tagline?: string;
}

/**
 * 目录项
 */
export interface TocItem {
  number: number;
  title: string;
  description?: string;
  subtitle?: string;
  isActive?: boolean;
  [key: string]: unknown;
}

/**
 * 目录幻灯片
 */
export interface TocSlideContent extends BaseSlideContent {
  templateType: "toc";
  title: string;
  items: TocItem[];
}

/**
 * 章节标题幻灯片
 */
export interface ChapterTitleSlideContent extends BaseSlideContent {
  templateType: "chapterTitle";
  chapterNumber: number;
  title: string;
  subtitle?: string;
  description?: string;
}

/**
 * 关键点项
 */
export interface KeyPointItem {
  title?: string;
  text?: string;
  description?: string;
  icon?: string;
  highlight?: boolean;
  emphasis?: boolean;
  [key: string]: unknown;
}

/**
 * 仪表盘指标项
 */
export interface DashboardMetric {
  label: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "flat";
  icon?: string;
  [key: string]: unknown;
}

/**
 * 仪表盘图表
 */
export interface DashboardChart {
  type: string;
  title: string;
  data?: unknown;
  [key: string]: unknown;
}

/**
 * 风险项
 */
export interface RiskItem {
  title: string;
  description?: string;
  severity?: "high" | "medium" | "low";
  likelihood?: "high" | "medium" | "low";
  mitigation?: string;
  icon?: string;
  [key: string]: unknown;
}

/**
 * 机会项
 */
export interface OpportunityItem {
  title: string;
  description?: string;
  impact?: "high" | "medium" | "low";
  timeline?: string;
  icon?: string;
  [key: string]: unknown;
}

/**
 * 建议项
 */
export interface RecommendationItem {
  title: string;
  description?: string;
  priority?: "high" | "medium" | "low";
  timeline?: string;
  owner?: string;
  icon?: string;
  [key: string]: unknown;
}

/**
 * 成熟度级别
 */
export interface MaturityLevel {
  level: number;
  name: string;
  description?: string;
  criteria?: string[];
  icon?: string;
  [key: string]: unknown;
}

/**
 * 案例研究结果项
 */
export interface CaseStudyResult {
  metric: string;
  value: string;
  improvement?: string;
  icon?: string;
  [key: string]: unknown;
}

/**
 * 对比点
 */
export interface ComparisonPoint {
  text: string;
  highlight?: boolean;
  icon?: string;
  [key: string]: unknown;
}

/**
 * 章节摘要幻灯片
 */
export interface ChapterSummarySlideContent extends BaseSlideContent {
  templateType: "chapterSummary";
  title: string;
  keyPoints: KeyPointItem[];
  takeaways?: KeyPointItem[];
  summary?: string;
}

/**
 * 结论幻灯片
 */
export interface ConclusionSlideContent extends BaseSlideContent {
  templateType: "conclusion";
  title: string;
  summary: string;
  keyTakeaways: KeyPointItem[];
  callToAction?: string;
  closingMessage?: string;
  contactInfo?: {
    name?: string;
    email?: string;
    phone?: string;
    [key: string]: unknown;
  };
}

/**
 * 时间线事件
 */
export interface TimelineEvent {
  date: string;
  title: string;
  description?: string;
  icon?: string;
  status?: string;
  highlight?: boolean;
  [key: string]: unknown;
}

/**
 * 时间线幻灯片
 */
export interface TimelineSlideContent extends BaseSlideContent {
  templateType: "timeline";
  title: string;
  events: TimelineEvent[];
  orientation?: "horizontal" | "vertical";
}

/**
 * 列内容
 */
export interface ColumnContent {
  title: string;
  content: unknown;
  icon?: string;
  highlight?: boolean;
  items?: KeyPointItem[];
  /** 品牌颜色头部 */
  brandColor?: string;
  /** 品牌Logo (base64或URL) */
  logo?: string;
  /** 底部KPI统计 */
  kpis?: KpiItem[];
  [key: string]: unknown;
}

/**
 * 多列布局幻灯片
 */
export interface MultiColumnSlideContent extends BaseSlideContent {
  templateType: "multiColumn";
  title: string;
  columns: ColumnContent[];
  columnCount?: number;
}

/**
 * 分割内容
 */
export interface SplitContent {
  title?: string;
  content: unknown;
  image?: string;
  [key: string]: unknown;
}

/**
 * 分割布局幻灯片
 */
export interface SplitLayoutSlideContent extends BaseSlideContent {
  templateType: "splitLayout";
  title: string;
  leftContent?: SplitContent;
  rightContent?: SplitContent;
  left?: SplitContent;
  right?: SplitContent;
  ratio?: string;
  dividerStyle?: string;
}

/**
 * 仪表盘幻灯片
 */
export interface DashboardSlideContent extends BaseSlideContent {
  templateType: "dashboard";
  title: string;
  metrics: DashboardMetric[];
  charts?: DashboardChart[];
}

/**
 * 演进阶段
 */
export interface EvolutionStage {
  name: string;
  title?: string;
  phase?: string;
  timeframe?: string;
  description?: string;
  milestones?: string[];
  status?: string;
  [key: string]: unknown;
}

/**
 * 演进路线图幻灯片
 */
export interface EvolutionRoadmapSlideContent extends BaseSlideContent {
  templateType: "evolutionRoadmap";
  title: string;
  stages: EvolutionStage[];
  currentStage?: number;
}

/**
 * 对比选项
 */
export interface ComparisonOption {
  title: string;
  points: ComparisonPoint[];
  pros?: ComparisonPoint[];
  cons?: ComparisonPoint[];
  [key: string]: unknown;
}

/**
 * 对比幻灯片
 */
export interface ComparisonSlideContent extends BaseSlideContent {
  templateType: "comparison";
  title: string;
  leftOption: ComparisonOption;
  rightOption: ComparisonOption;
  verdict?: string;
}

/**
 * 案例研究幻灯片
 */
export interface CaseStudySlideContent extends BaseSlideContent {
  templateType: "caseStudy";
  title: string;
  company?: string;
  challenge: string;
  solution: string;
  results: CaseStudyResult[];
  quote?: {
    text: string;
    author: string;
    role?: string;
    [key: string]: unknown;
  };
}

/**
 * 成熟度模型幻灯片
 */
export interface MaturityModelSlideContent extends BaseSlideContent {
  templateType: "maturityModel";
  title: string;
  levels: MaturityLevel[];
  currentAssessment?: {
    level: number;
    notes?: string;
    [key: string]: unknown;
  };
}

/**
 * 风险与机会幻灯片
 */
export interface RiskOpportunitySlideContent extends BaseSlideContent {
  templateType: "riskOpportunity";
  title: string;
  risks: RiskItem[];
  opportunities: OpportunityItem[];
}

/**
 * 建议幻灯片
 */
export interface RecommendationsSlideContent extends BaseSlideContent {
  templateType: "recommendations";
  title: string;
  recommendations: RecommendationItem[];
  nextSteps?: RecommendationItem[];
}

/**
 * 所有幻灯片内容类型的联合类型
 */
export type SlideTemplateContent =
  | CoverSlideContent
  | TocSlideContent
  | ChapterTitleSlideContent
  | ChapterSummarySlideContent
  | ConclusionSlideContent
  | TimelineSlideContent
  | MultiColumnSlideContent
  | SplitLayoutSlideContent
  | DashboardSlideContent
  | EvolutionRoadmapSlideContent
  | ComparisonSlideContent
  | CaseStudySlideContent
  | MaturityModelSlideContent
  | RiskOpportunitySlideContent
  | RecommendationsSlideContent;

/**
 * 模板类型枚举
 */
export type SlideTemplateType = SlideTemplateContent["templateType"];
