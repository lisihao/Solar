/**
 * AI Slides - 前端类型定义
 * 从后端类型重新导出供前端使用
 */

// ============================================================================
// 15种页面模板类型
// ============================================================================

export type SlideTemplateTypeString =
  | 'cover'
  | 'toc'
  | 'chapterTitle'
  | 'chapterSummary'
  | 'conclusion'
  | 'timeline'
  | 'multiColumn'
  | 'splitLayout'
  | 'dashboard'
  | 'evolutionRoadmap'
  | 'comparison'
  | 'caseStudy'
  | 'maturityModel'
  | 'riskOpportunity'
  | 'recommendations';

// ============================================================================
// 模板内容类型定义
// ============================================================================

/**
 * 所有模板内容的联合类型
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

// ============================================================================
// 各模板内容详细定义
// ============================================================================

/**
 * 封面页内容
 */
export interface CoverSlideContent {
  templateType: 'cover';
  title: string;
  subtitle?: string;
  author?: string;
  organization?: string;
  date?: string;
  tagline?: string;
  backgroundImage?: string;
  logo?: string;
}

/**
 * 目录页内容
 */
export interface TocSlideContent {
  templateType: 'toc';
  title: string;
  items: Array<{
    number: number;
    title: string;
    subtitle?: string;
    isActive?: boolean;
  }>;
  style?: 'numbered' | 'icons' | 'cards';
}

/**
 * 章节标题页内容
 */
export interface ChapterTitleSlideContent {
  templateType: 'chapterTitle';
  chapterNumber: number;
  title: string;
  subtitle?: string;
  description?: string;
  icon?: string;
  backgroundImage?: string;
}

/**
 * 章节摘要页内容
 */
export interface ChapterSummarySlideContent {
  templateType: 'chapterSummary';
  title: string;
  keyPoints: Array<{
    icon?: string;
    title: string;
    description: string;
    highlight?: boolean;
  }>;
  summary?: string;
  transitionText?: string;
}

/**
 * 结论页内容
 */
export interface ConclusionSlideContent {
  templateType: 'conclusion';
  title: string;
  keyTakeaways: Array<{
    icon?: string;
    text: string;
    emphasis?: 'high' | 'medium' | 'low';
  }>;
  callToAction?: string;
  nextSteps?: string[];
  closingMessage?: string;
}

/**
 * 时间线页内容
 */
export interface TimelineSlideContent {
  templateType: 'timeline';
  title: string;
  description?: string;
  events: Array<{
    id: string;
    date: string;
    title: string;
    description?: string;
    icon?: string;
    status: 'past' | 'current' | 'future';
    highlight?: boolean;
    color?: string;
    /** 🆕 事件配图 URL */
    imageUrl?: string;
  }>;
  orientation: 'horizontal' | 'vertical';
  showConnectors?: boolean;
}

/**
 * 多栏页内容
 */
export interface MultiColumnSlideContent {
  templateType: 'multiColumn';
  title: string;
  subtitle?: string;
  columns: Array<{
    icon?: string;
    title: string;
    content: string;
    items?: string[];
    highlight?: boolean;
    color?: string;
    /** 🆕 语义块配图 URL */
    imageUrl?: string;
    /** 🆕 图片位置 */
    imagePosition?: 'top' | 'bottom' | 'background';
  }>;
  columnCount: 2 | 3 | 4;
  layout?: 'equal' | 'weighted';
}

/**
 * 分屏布局页内容
 */
export interface SplitLayoutSlideContent {
  templateType: 'splitLayout';
  title: string;
  left: SplitSectionContent;
  right: SplitSectionContent;
  ratio: '50-50' | '60-40' | '40-60' | '70-30' | '30-70';
  dividerStyle?: 'line' | 'gradient' | 'none';
}

export interface SplitSectionContent {
  type: 'text' | 'image' | 'chart' | 'list' | 'quote' | 'stats';
  title?: string;
  content?: string;
  items?: string[];
  imageUrl?: string;
  quote?: {
    text: string;
    author?: string;
  };
  stats?: Array<{
    label: string;
    value: string;
    trend?: 'up' | 'down' | 'stable';
  }>;
  chartType?: 'bar' | 'line' | 'pie' | 'donut';
  chartData?: Array<{ label: string; value: number; color?: string }>;
}

/**
 * 仪表盘页内容
 */
export interface DashboardSlideContent {
  templateType: 'dashboard';
  title: string;
  subtitle?: string;
  metrics: Array<{
    id: string;
    label: string;
    value: string | number;
    unit?: string;
    trend?: 'up' | 'down' | 'stable';
    trendValue?: string;
    icon?: string;
    color?: string;
    size?: 'small' | 'medium' | 'large';
  }>;
  charts?: Array<{
    type: 'bar' | 'line' | 'pie' | 'donut' | 'area' | 'sparkline';
    title?: string;
    data: Array<{ label: string; value: number; color?: string }>;
    position:
      | 'top-left'
      | 'top-right'
      | 'bottom-left'
      | 'bottom-right'
      | 'center';
    size?: 'small' | 'medium' | 'large';
  }>;
  layout: 'grid' | 'flow' | 'bento';
  summary?: string;
}

/**
 * 演进路线图页内容
 */
export interface EvolutionRoadmapSlideContent {
  templateType: 'evolutionRoadmap';
  title: string;
  description?: string;
  stages: Array<{
    id: string;
    phase: string;
    title: string;
    description: string;
    timeframe?: string;
    status: 'completed' | 'in_progress' | 'planned' | 'future';
    milestones?: string[];
    deliverables?: string[];
    color?: string;
    icon?: string;
    /** 🆕 阶段配图 URL */
    imageUrl?: string;
  }>;
  currentStage?: number;
  showProgress?: boolean;
  orientation: 'horizontal' | 'vertical';
}

/**
 * 对比分析页内容
 */
export interface ComparisonSlideContent {
  templateType: 'comparison';
  title: string;
  description?: string;
  subjects: Array<{
    id: string;
    name: string;
    logo?: string;
    tagline?: string;
    isWinner?: boolean;
    color?: string;
  }>;
  criteria: Array<{
    name: string;
    icon?: string;
    weight?: number;
    values: Record<string, ComparisonValue>;
    winner?: string;
  }>;
  showScores?: boolean;
  showOverallWinner?: boolean;
  layout: 'table' | 'cards' | 'side-by-side';
}

export type ComparisonValue =
  | string
  | number
  | boolean
  | { text: string; score?: number; highlight?: boolean };

/**
 * 案例研究页内容
 */
export interface CaseStudySlideContent {
  templateType: 'caseStudy';
  title: string;
  company: string;
  industry?: string;
  logo?: string;
  heroImage?: string;
  challenge: {
    title?: string;
    description: string;
    painPoints?: string[];
    /** 🆕 挑战配图 URL */
    imageUrl?: string;
  };
  solution: {
    title?: string;
    description: string;
    highlights?: string[];
    /** 🆕 解决方案配图 URL */
    imageUrl?: string;
  };
  results: Array<{
    metric: string;
    value: string;
    improvement?: string;
    icon?: string;
    color?: string;
  }>;
  testimonial?: {
    quote: string;
    author: string;
    title: string;
    avatar?: string;
  };
  timeline?: string;
  tags?: string[];
}

/**
 * 成熟度模型页内容
 */
export interface MaturityModelSlideContent {
  templateType: 'maturityModel';
  title: string;
  description?: string;
  modelName?: string;
  dimensions: Array<{
    id: string;
    name: string;
    description?: string;
    icon?: string;
    weight?: number;
  }>;
  levels: Array<{
    level: number;
    name: string;
    description: string;
    color?: string;
    criteria?: string[];
  }>;
  currentAssessment: Record<string, number>;
  targetState?: Record<string, number>;
  showRadar?: boolean;
  showProgress?: boolean;
  recommendations?: string[];
}

/**
 * 风险机会矩阵页内容
 */
export interface RiskOpportunitySlideContent {
  templateType: 'riskOpportunity';
  title: string;
  description?: string;
  risks: Array<{
    id: string;
    title: string;
    description: string;
    probability: 'high' | 'medium' | 'low';
    impact: 'high' | 'medium' | 'low';
    category?: string;
    mitigation?: string;
    owner?: string;
    icon?: string;
    /** 🆕 风险配图 URL */
    imageUrl?: string;
  }>;
  opportunities: Array<{
    id: string;
    title: string;
    description: string;
    potential: 'high' | 'medium' | 'low';
    feasibility: 'high' | 'medium' | 'low';
    category?: string;
    action?: string;
    owner?: string;
    icon?: string;
    /** 🆕 机会配图 URL */
    imageUrl?: string;
  }>;
  showMatrix?: boolean;
  showMitigations?: boolean;
  layout: 'split' | 'matrix' | 'list';
}

/**
 * 建议列表页内容
 */
export interface RecommendationsSlideContent {
  templateType: 'recommendations';
  title: string;
  subtitle?: string;
  summary?: string;
  recommendations: Array<{
    id: string;
    number?: number;
    title: string;
    description: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    category?: string;
    timeframe?: 'immediate' | 'short_term' | 'medium_term' | 'long_term';
    effort?: 'low' | 'medium' | 'high';
    impact?: 'low' | 'medium' | 'high';
    owner?: string;
    icon?: string;
    dependencies?: string[];
    /** 🆕 建议配图 URL */
    imageUrl?: string;
  }>;
  showPriorityLegend?: boolean;
  showTimeline?: boolean;
  layout: 'numbered' | 'cards' | 'timeline';
  callToAction?: string;
}

// ============================================================================
// 检查点类型
// ============================================================================

export type CheckpointType =
  | 'task_decomposition'
  | 'outline_confirmed'
  | 'page_rendered'
  | 'batch_rendered'
  | 'user_modified'
  | 'auto_save';

export interface Checkpoint {
  id: string;
  sessionId: string;
  name: string;
  type: CheckpointType;
  version: string;
  timestamp: Date;
  state: CheckpointState;
  metadata: CheckpointMetadata;
}

export interface CheckpointMetadata {
  trigger: 'auto' | 'user';
  description?: string;
  previousCheckpointId?: string;
  durationMs?: number;
}

// ============================================================================
// 会话类型
// ============================================================================

export interface SourceSubscription {
  type: 'topic-insights' | 'research-project';
  sourceId: string;
  sourceName?: string;
  subscribedAt: string;
  lastSourceUpdatedAt: string;
  isStale: boolean;
}

export interface SlidesSession {
  id: string;
  userId: string;
  title: string;
  status: 'active' | 'completed' | 'archived';
  currentCheckpointId?: string;
  createdAt: Date;
  updatedAt: Date;
  sourceSubscription?: SourceSubscription | null;
}

// ============================================================================
// 检查点状态
// ============================================================================

export interface CheckpointState {
  taskDecomposition?: TaskDecomposition;
  outlinePlan?: OutlinePlan;
  pages: PageState[];
  conversation: ConversationMessage[];
  globalStyles?: GlobalStyles;
}

// ============================================================================
// 任务分解
// ============================================================================

export interface TaskDecomposition {
  totalPages: number;
  estimatedDuration: number;
  chapters: Chapter[];
  todoList: TodoItem[];
  designStrategy: DesignStrategy;
}

export interface Chapter {
  id: string;
  title: string;
  description: string;
  pageRange: { start: number; end: number };
  keyPoints: string[];
}

export interface TodoItem {
  id: string;
  task: string;
  status: 'pending' | 'in_progress' | 'completed';
  dependencies: string[];
  pageNumber?: number;
}

export interface DesignStrategy {
  overallStyle: string;
  colorScheme: 'dark' | 'light' | 'custom';
  emphasis: string[];
  targetAudience: string;
}

// ============================================================================
// 大纲规划
// ============================================================================

export interface OutlinePlan {
  title: string;
  totalPages: number;
  pages: PageOutline[];
  globalStyles: GlobalStyles;
  contentFlow: ContentFlow;
}

export interface PageOutline {
  pageNumber: number;
  title: string;
  templateType: PageTemplateType;
  purpose: string;
  keyPoints: string[];
  sourceReference?: string;
  imageRequirements?: ImageRequirement[];
  estimatedDuration?: number;
}

export interface ContentFlow {
  narrative: string;
  transitions: Array<{
    from: number;
    to: number;
    type: string;
  }>;
}

// ============================================================================
// 页面类型
// ============================================================================

export type PageTemplateType =
  | 'cover'
  | 'toc'
  | 'questions'
  | 'pillars'
  | 'framework'
  | 'timeline'
  | 'evolutionRoadmap'
  | 'dashboard'
  | 'comparison'
  | 'splitLayout'
  | 'caseStudy'
  | 'multiColumn'
  | 'recommendations'
  | 'maturityModel'
  | 'riskOpportunity';

// ============================================================================
// 页面状态
// ============================================================================

export interface PageState {
  pageNumber: number;
  outline: PageOutline;
  content?: PageContent;
  design?: PageDesign;
  html?: string;
  images?: GeneratedImage[];
  status: 'pending' | 'generating' | 'completed' | 'error';
  error?: string;
}

export interface PageContent {
  title: string;
  sections: ContentSection[];
  keyPoints: string[];
  dataPoints?: DataPoint[];
  quotes?: Quote[];
}

export interface ContentSection {
  id: string;
  heading?: string;
  content: string;
  type: 'text' | 'list' | 'table' | 'chart' | 'image';
}

export interface DataPoint {
  label: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
}

export interface Quote {
  text: string;
  author?: string;
  source?: string;
}

// ============================================================================
// 页面设计（四步设计过程）
// ============================================================================

export interface PageDesign {
  step1_drafting: DraftingResult;
  step2_refiningLayout: LayoutResult;
  step3_planningVisuals: VisualResult;
  step4_formulatingHTML: HTMLResult;
  /** AI 调用的系统提示词 */
  systemPrompt?: string;
  /** AI 调用的用户提示词（完整的输入上下文） */
  userPrompt?: string;
  /** AI 的原始响应（完整的思考过程） */
  rawResponse?: string;
}

export interface DraftingResult {
  style: string;
  coreElements: string[];
  mood: string;
}

export interface LayoutResult {
  alignment: string;
  graphicsPosition: string;
  spacing: string;
}

export interface VisualResult {
  backgroundColor: string;
  accentColors: string[];
  decorations: string[];
}

export interface HTMLResult {
  html?: string;
  externalDependencies?: string[];
  /** 使用的模板 ID */
  templateUsed?: string;
  /** 内容区块数量 */
  sectionsCount?: number;
  /** 是否包含图片 */
  hasImages?: boolean;
}

// ============================================================================
// 图像相关
// ============================================================================

export interface ImageRequirement {
  position: 'background' | 'inline' | 'card' | 'icon';
  semanticContext: string;
  style?: string;
  optional?: boolean;
}

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  semanticContext?: string;
  position: 'background' | 'inline' | 'card' | 'icon';
  width?: number;
  height?: number;
  generatedAt: Date;
}

// ============================================================================
// 全局样式（Genspark 设计系统）
// ============================================================================

export interface GlobalStyles {
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string;
  cardBackground: string;
  borderColor: string;
  accentColor: string;
  accentColorSecondary: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  fontFamily: string;
  bottomSafeZone: number;
}

export const GENSPARK_DESIGN_SYSTEM: GlobalStyles = {
  canvasWidth: 1280,
  canvasHeight: 720,
  backgroundColor: '#0F172A',
  cardBackground: '#1E293B',
  borderColor: '#334155',
  accentColor: '#D4AF37',
  accentColorSecondary: '#3B82F6',
  textPrimary: '#F8FAFC',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  fontFamily: "'Noto Sans SC', sans-serif",
  bottomSafeZone: 80,
};

// ============================================================================
// 对话消息
// ============================================================================

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: {
    toolCalls?: ToolCall[];
    pageReferences?: number[];
  };
}

export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  duration?: number;
}

// ============================================================================
// 质量报告
// ============================================================================

export interface QualityReport {
  overall: 'pass' | 'warning' | 'fail';
  score: number;
  issues: QualityIssue[];
  suggestions: string[];
  checkedAt: Date;
}

export interface QualityIssue {
  type: 'layout' | 'content' | 'consistency' | 'accessibility';
  severity: 'error' | 'warning' | 'info';
  pageNumber?: number;
  description: string;
  suggestion?: string;
}

// ============================================================================
// 流事件
// ============================================================================

/**
 * 流事件类型
 * 支持后端发送的所有事件类型
 */
export type StreamEventType =
  // 执行生命周期事件（后端协议）
  | 'execution:started'
  | 'execution:completed'
  | 'execution:failed'
  // 阶段事件（后端协议）
  | 'phase:started'
  | 'phase:progress'
  | 'phase:completed'
  // Agent 事件（后端协议）
  | 'agent:working'
  | 'agent:completed'
  // Mission Agent 事件（后端新协议）
  | 'mission:agent_working'
  | 'mission:agent_done'
  // 页面事件（后端协议）
  | 'slide:generated'
  // 旧协议兼容（保留）
  | 'session_created'
  | 'phase_started'
  | 'phase_completed'
  | 'checkpoint_created'
  | 'page_started'
  | 'page_completed'
  | 'progress_update'
  | 'heartbeat'
  | 'error'
  | 'complete'
  // 用户交互事件
  | 'user_message'
  | 'system_message'
  // 恢复事件
  | 'tool_call'
  // AI 思考事件（V5.0）
  | 'thinking:step'
  | 'thinking:decision'
  | 'thinking:insight'
  | 'thinking:warning'
  | 'thinking:output'
  | 'thinking:summary';

export interface StreamEvent {
  type: StreamEventType;
  timestamp: Date | string;
  sessionId?: string;
  executionId?: string;
  data: unknown;
}

/**
 * 后端阶段名称到前端阶段名称的映射
 */
export const PHASE_MAPPING: Record<string, GenerationProgress['phase']> = {
  // 后端阶段 -> 前端阶段
  analyzing: 'task_decomposition',
  'task-decomposition': 'task_decomposition',
  planning: 'outline_planning',
  'outline-planning': 'outline_planning',
  content_filling: 'page_rendering',
  'content-filling': 'page_rendering',
  image_generation: 'page_rendering',
  'image-generation': 'page_rendering',
  rendering: 'page_rendering',
  'page-rendering': 'page_rendering',
  reviewing: 'quality_review',
  'batch-review': 'quality_review',
  completed: 'quality_review',
  // 兼容旧协议
  task_decomposition: 'task_decomposition',
  outline_planning: 'outline_planning',
  page_rendering: 'page_rendering',
  quality_review: 'quality_review',
};

/**
 * Agent 角色类型
 */
export type AgentRole =
  | 'leader'
  | 'analyst'
  | 'strategist'
  | 'writer'
  | 'reviewer';

// ============================================================================
// 生成进度
// ============================================================================

export interface GenerationProgress {
  phase:
    | 'task_decomposition'
    | 'outline_planning'
    | 'page_rendering'
    | 'quality_review';
  phaseProgress: number;
  overallProgress: number;
  currentPage?: number;
  totalPages?: number;
  message: string;
}

// ============================================================================
// API 请求/响应类型
// ============================================================================

export interface GenerateRequest {
  title: string;
  sourceText: string;
  userRequirement?: string;
  targetPages?: number;
  stylePreference?: 'dark' | 'light' | 'custom';
  targetAudience?: string;
  customStyles?: Partial<GlobalStyles>;
  /** 主题ID，默认 'genspark-dark' */
  themeId?: string;
}

export interface SessionResponse {
  success: boolean;
  session: SlidesSession;
  latestCheckpoint?: {
    id: string;
    type: CheckpointType;
    timestamp: Date;
    pagesCount: number;
  };
}

export interface CheckpointsResponse {
  success: boolean;
  checkpoints: Checkpoint[];
}

export interface RestoreResponse {
  success: boolean;
  message: string;
  state: {
    pagesCount: number;
    hasOutline: boolean;
    hasTaskDecomposition: boolean;
  };
}
