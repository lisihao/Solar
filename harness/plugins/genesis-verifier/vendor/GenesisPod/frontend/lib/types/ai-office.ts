/**
 * AI Office 核心类型定义
 */

// ============================================================================
// 资源类型定义
// ============================================================================

export type ResourceType =
  | 'youtube_video'
  | 'academic_paper'
  | 'web_page'
  | 'database'
  | 'file';

export type ResourceStatus = 'pending' | 'collecting' | 'collected' | 'failed';

export interface ResourceRef {
  type: ResourceType;
  collection: string;
  id: string;
}

export interface BaseResource {
  _id: string;
  userId: string;
  resourceId: string;
  resourceType: ResourceType;
  status: ResourceStatus;
  collectedAt: Date;
  updatedAt: Date;
}

// YouTube资源
export interface YouTubeMetadata {
  title: string;
  description: string;
  channel: {
    id: string;
    name: string;
    subscribers: number;
  };
  duration: string;
  publishedAt: Date;
  statistics: {
    views: number;
    likes: number;
    comments: number;
  };
  thumbnails: {
    default: string;
    medium: string;
    high: string;
  };
  tags: string[];
  category: string;
  language: string;
}

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  confidence?: number;
}

export interface YouTubeContent {
  subtitles: {
    [lang: string]: Array<{
      start: number;
      end: number;
      text: string;
    }>;
  };
  transcription?: {
    fullText: string;
    segments: TranscriptionSegment[];
  };
  keyFrames: Array<{
    timestamp: number;
    url: string;
    description?: string;
  }>;
}

export interface AIAnalysis {
  summary: string;
  keyPoints: string[];
  topics: string[];
  entities: Array<{
    name: string;
    type: 'person' | 'organization' | 'technology' | 'concept';
  }>;
  sentiment: {
    overall: 'positive' | 'neutral' | 'negative';
    confidence: number;
  };
  difficultyLevel: 'beginner' | 'intermediate' | 'advanced';
  targetAudience: string[];
  prerequisites: string[];
  learningOutcomes: string[];
}

// ============================================================================
// 结构化AI摘要 (新增)
// ============================================================================

/**
 * 结构化摘要基础接口
 * 用于统一不同资源类型的AI分析输出
 */
export interface StructuredAISummary {
  // 核心摘要（必需）
  overview: string; // 200-300字概览

  // 分类信息
  category: string;
  subcategories: string[];

  // 关键信息
  keyPoints: string[]; // 3-5个要点
  keywords: string[]; // 3-8个关键词

  // 元信息
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  readingTime: number; // 分钟

  // 可视化建议
  visualizations?: Array<{
    type: 'timeline' | 'flowchart' | 'diagram' | 'chart' | 'matrix';
    description: string;
    dataPoints?: string[];
  }>;

  // 质量评分
  confidence: number; // 0-1

  // 生成信息
  generatedAt: Date;
  model: string;
}

/**
 * 学术论文专属结构化摘要
 */
export interface PaperAISummary extends StructuredAISummary {
  // 论文特定字段
  contributions: string[]; // 主要贡献
  methodology: string; // 研究方法
  results: string; // 主要结果
  limitations: string[]; // 局限性
  futureWork: string[]; // 后续工作方向

  // 学术指标
  citationContext?: {
    citationCount: number;
    h5Index?: number;
    impactFactor?: number;
  };

  // 相关性
  relatedTopics: string[];
  field: string;
  subfield: string;
}

/**
 * 新闻文章专属结构化摘要
 */
export interface NewsAISummary extends StructuredAISummary {
  // 新闻特定字段
  headline: string;
  coreNews: string; // 核心新闻事实
  background: string; // 背景信息
  impact: string; // 影响分析
  quotes?: Array<{
    text: string;
    source: string;
  }>;

  // 新闻特性
  newsFactor: 'breaking' | 'developing' | 'analysis' | 'feature';
  sentiment: 'positive' | 'neutral' | 'negative';
  urgency: 'high' | 'medium' | 'low';

  // 关联信息
  relatedEntities: Array<{
    name: string;
    type: 'person' | 'organization' | 'location' | 'event';
    relevance: number;
  }>;
}

/**
 * 视频专属结构化摘要
 */
export interface VideoAISummary extends StructuredAISummary {
  // 视频特定字段
  speakers: Array<{
    name: string;
    role?: string;
    expertise?: string;
  }>;

  chapters: Array<{
    timestamp: number; // 秒数
    title: string;
    summary: string;
  }>;

  mainTopic: string;
  subtopics: string[];

  // 视频特性
  videoType: 'lecture' | 'tutorial' | 'interview' | 'demo' | 'discussion';
  pace: 'slow' | 'normal' | 'fast';
  audience: 'beginner' | 'intermediate' | 'advanced';

  // 可视化资源
  keyFrames?: Array<{
    timestamp: number;
    description: string;
    importance: number;
  }>;

  // 观看信息
  estimatedWatchTime: number; // 分钟
  keyTimestamps: Array<{
    time: number;
    label: string;
  }>;
}

/**
 * 开源项目专属结构化摘要
 */
export interface ProjectAISummary extends StructuredAISummary {
  // 项目特定字段
  projectName: string;
  purpose: string; // 项目目的
  mainFeatures: string[]; // 主要功能
  techStack: string[]; // 技术栈

  // 项目指标
  activity: {
    stars: number;
    forks: number;
    openIssues: number;
    activeContributors: number;
    lastUpdate: Date;
    isActive: boolean;
  };

  // 项目特性
  maturity: 'alpha' | 'beta' | 'stable' | 'mature';
  license: string;
  ecosystem: string;

  // 使用指南
  gettingStarted: string;
  useCases: string[];
  learningCurve: 'easy' | 'moderate' | 'steep';
}

/**
 * 报告专用摘要类型 (Reports TAB)
 */
export interface ReportAISummary extends StructuredAISummary {
  // 报告特定字段
  reportTitle: string;
  publisherName: string;
  publisherLogo?: string;
  reportDate: Date;

  // 核心内容
  executiveSummary: string; // 100-150 字的核心摘要
  keyFindings: string[]; // 3-5 个核心发现
  mainThemes: string[]; // 报告的主要主题

  // 数据洞察
  metrics: Array<{
    name: string;
    value: string | number;
    unit?: string;
    trend?: 'up' | 'down' | 'stable';
    yearOverYear?: number; // YoY 增长率
  }>;

  // 市场/行业分析
  marketInsights: {
    marketSize?: string;
    growthRate?: number;
    mainPlayers?: string[];
    trendingTopics?: string[];
  };

  // 预测和建议
  outlook: string; // 未来展望（300+ 字）
  recommendations: Array<{
    target: string; // "企业", "政策制定者", "投资者" 等
    action: string;
  }>;

  // 风险和机遇
  riskFactors?: Array<{
    title: string;
    description: string;
    severity: 'high' | 'medium' | 'low';
  }>;

  opportunities?: Array<{
    title: string;
    description: string;
    potential: 'high' | 'medium' | 'low';
  }>;

  // 报告质量指标
  reportType:
    | 'research'
    | 'market-analysis'
    | 'threat-report'
    | 'whitepaper'
    | 'industry-insight';
  credibilityScore: number; // 0-1，基于发布商和内容质量
  analysisDepth: 'surface' | 'moderate' | 'deep'; // 分析深度

  // 关系数据
  relatedReports?: Array<{
    id: string;
    title: string;
    publisherName: string;
  }>;

  // 引用和出处
  dataSource?: Array<{
    name: string;
    url?: string;
    accessDate?: Date;
  }>;
}

/**
 * 联合类型：所有资源的结构化摘要
 */
export type ResourceAISummary =
  | StructuredAISummary
  | PaperAISummary
  | NewsAISummary
  | VideoAISummary
  | ProjectAISummary
  | ReportAISummary;

export interface YouTubeResource extends BaseResource {
  resourceType: 'youtube_video';
  url: string;
  metadata: YouTubeMetadata;
  content: YouTubeContent;
  aiAnalysis: AIAnalysis;
}

// Papers资源
export interface PaperMetadata {
  title: string;
  authors: Array<{
    name: string;
    affiliation: string;
    email?: string;
  }>;
  abstract: string;
  keywords: string[];
  publishedAt: Date;
  venue: string;
  doi?: string;
  arxivId?: string;
  citations: number;
  pdfUrl?: string;
}

export interface PaperFigure {
  id: string;
  caption: string;
  url?: string;
  pageNumber?: number;
}

export interface PaperTable {
  id: string;
  caption: string;
  data: string[][];
  pageNumber?: number;
}

export interface PaperEquation {
  id: string;
  latex: string;
  description?: string;
}

export interface PaperReference {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
}

export interface PaperContent {
  fullText: string;
  sections: Array<{
    title: string;
    content: string;
    level: number;
  }>;
  figures: PaperFigure[];
  tables: PaperTable[];
  equations: PaperEquation[];
  references: PaperReference[];
}

export interface PaperAIAnalysis {
  summary: string;
  contributions: string[];
  methodology: string;
  results: string;
  limitations: string[];
  futureWork: string[];
  impact: 'low' | 'medium' | 'high' | 'very high';
  field: string;
  subfields: string[];
}

export interface PaperResource extends BaseResource {
  resourceType: 'academic_paper';
  metadata: PaperMetadata;
  content: PaperContent;
  aiAnalysis: PaperAIAnalysis;
}

// Web资源
export interface WebMetadata {
  title: string;
  description?: string;
  author?: string;
  publishedAt?: Date;
  siteName?: string;
  language: string;
}

export interface WebContent {
  rawHtml?: string;
  cleanedText: string;
  structuredData?: Record<string, unknown>;
  images: Array<{
    src: string;
    alt: string;
  }>;
  links: string[];
}

export interface WebResource extends BaseResource {
  resourceType: 'web_page';
  url: string;
  metadata: WebMetadata;
  content: WebContent;
  aiAnalysis: {
    summary: string;
    mainTopics: string[];
    keyInsights: string[];
    credibility: number;
  };
}

export type Resource = YouTubeResource | PaperResource | WebResource;

// ============================================================================
// 文档类型定义
// ============================================================================

export type DocumentType = 'word' | 'excel' | 'ppt' | 'article' | 'research';

export type DocumentStatus = 'draft' | 'generating' | 'completed' | 'failed';

export interface DocumentResource {
  resourceRef: ResourceRef;
}

export interface AIConfig {
  model: string;
  language: string;
  detailLevel: number; // 1-5
  professionalLevel: number; // 1-5
}

// 文档样式类型
export interface DocumentStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  color?: string;
  backgroundColor?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;
  margin?: string;
  padding?: string;
}

// Word文档内容
export interface WordSection {
  id: string;
  type: 'heading' | 'paragraph' | 'list' | 'table' | 'image';
  content: string;
  aiGenerated: boolean;
  sourceResources?: string[];
  level?: number;
  style?: DocumentStyle;
}

export interface WordContent {
  sections: WordSection[];
}

// Excel单元格值类型
export type CellValue = string | number | boolean | Date | null;

// Excel图表类型
export interface ExcelChart {
  id: string;
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'area';
  title?: string;
  dataRange: string;
  position: { row: number; col: number };
  size: { width: number; height: number };
}

// Excel文档内容
export interface ExcelSheet {
  name: string;
  data: CellValue[][];
  charts?: ExcelChart[];
}

export interface ExcelContent {
  sheets: ExcelSheet[];
}

// PPT元素类型
export interface PPTElement {
  id: string;
  type: 'text' | 'image' | 'shape' | 'chart' | 'table' | 'video';
  position: { x: number; y: number };
  size: { width: number; height: number };
  content: string | Record<string, unknown>;
  style?: DocumentStyle;
}

// PPT文档内容
export interface PPTSlide {
  id: string;
  layout: string;
  elements: PPTElement[];
  notes?: string;
}

export interface PPTContent {
  slides: PPTSlide[];
  theme?: string;
}

// 文档版本内容联合类型
export type DocumentVersionContent =
  | WordContent
  | ExcelContent
  | PPTContent
  | ArticleContent;

// 文档版本快照
export interface DocumentVersion {
  id: string;
  timestamp: Date;
  type: 'auto' | 'manual'; // 自动保存 vs 手动保存
  trigger: 'ai_generation' | 'user_edit' | 'manual_save'; // 触发方式
  content: DocumentVersionContent; // 快照内容（根据文档类型不同而不同）
  metadata: {
    title: string;
    wordCount?: number;
    slideCount?: number;
    description?: string; // 版本描述
  };
  aiModel?: string; // 如果是AI生成的，记录使用的模型
  userPrompt?: string; // 如果是AI生成的，记录用户提示词
}

export interface BaseDocument {
  _id: string;
  userId: string;
  type: DocumentType;
  title: string;
  status: DocumentStatus;
  resources: DocumentResource[];
  template?: {
    id: string;
    version: string;
  };
  aiConfig: AIConfig;
  generationHistory: Array<{
    timestamp: Date;
    action: 'create' | 'edit' | 'regenerate';
    aiModel: string;
    userPrompt?: string;
    cost?: number;
  }>;
  // 新增：版本历史
  versions: DocumentVersion[];
  currentVersionId?: string; // 当前激活的版本ID
  metadata: {
    wordCount?: number;
    pageCount?: number;
    slideCount?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface WordDocument extends BaseDocument {
  type: 'word';
  content: WordContent;
}

export interface ExcelDocument extends BaseDocument {
  type: 'excel';
  content: ExcelContent;
}

export interface PPTDocument extends BaseDocument {
  type: 'ppt';
  content: PPTContent;
}

// Article文档内容（简化的通用文档）
export interface ArticleContent {
  markdown: string;
  html?: string;
}

export interface ArticleDocument extends BaseDocument {
  type: 'article';
  content: ArticleContent;
}

export type Document =
  | WordDocument
  | ExcelDocument
  | PPTDocument
  | ArticleDocument;

// ============================================================================
// AI聊天类型定义
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system';

export interface MentionedResource {
  resourceRef: ResourceRef;
  title: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  mentionedResources?: MentionedResource[];
  attachments?: Array<{
    type: 'image' | 'file';
    url: string;
  }>;
  metadata?: {
    model?: string;
    tokens?: number;
    cost?: number;
    latency?: number;
  };
  timestamp: Date;
}

export interface ChatSession {
  _id: string;
  userId: string;
  documentId: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// 模板类型定义
// ============================================================================

// 模板格式配置
export interface TemplateSectionFormat {
  width?: number | string;
  height?: number | string;
  columns?: number;
  alignment?: 'left' | 'center' | 'right';
  spacing?: number;
}

// 颜色配置
export interface ColorPalette {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  text?: string;
  [key: string]: string | undefined;
}

// 字体配置
export interface FontConfig {
  heading?: string;
  body?: string;
  code?: string;
  sizes?: {
    h1?: number;
    h2?: number;
    h3?: number;
    body?: number;
  };
}

// 模板Sheet定义
export interface TemplateSheet {
  name: string;
  columns: string[];
  rowTemplate?: Record<string, string>;
}

// 模板Slide定义
export interface TemplateSlide {
  layout: string;
  placeholders: string[];
  style?: DocumentStyle;
}

export interface TemplateSection {
  id: string;
  title: string;
  type: 'ai_generated' | 'data_table' | 'cover_page' | 'custom';
  aiPrompt?: string;
  variables?: string[];
  format?: TemplateSectionFormat;
}

export interface Template {
  _id: string;
  userId?: string;
  type: DocumentType;
  name: string;
  description: string;
  category: string;
  tags: string[];
  compatibleResourceTypes: ResourceType[];
  structure: {
    sections?: TemplateSection[];
    sheets?: TemplateSheet[];
    slides?: TemplateSlide[];
  };
  styles: {
    theme?: string;
    colors?: ColorPalette;
    fonts?: FontConfig;
  };
  usage: {
    count: number;
    rating: number;
    reviews: number;
  };
  isPublic: boolean;
  version: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// UI状态类型定义
// ============================================================================

export interface UIState {
  // 中间栏状态
  middlePanelWidth: number;
  resourceListCollapsed: boolean;

  // 当前选中
  selectedResourceIds: string[];
  currentDocumentId?: string;

  // 加载状态
  isLoading: boolean;
  loadingMessage?: string;

  // 错误状态
  error?: {
    message: string;
    code?: string;
  };
}

// ============================================================================
// API请求/响应类型定义
// ============================================================================

export interface AddResourceRequest {
  type: ResourceType;
  url: string;
  collectionId?: string;
  options?: {
    autoAnalyze: boolean;
    extractSubtitles: boolean;
  };
}

export interface AddResourceResponse {
  resourceId: string;
  status: ResourceStatus;
  estimatedTime: number;
}

export interface CreateDocumentRequest {
  type: DocumentType;
  title: string;
  resourceIds: string[];
  templateId?: string;
  aiConfig: AIConfig;
}

export interface CreateDocumentResponse {
  documentId: string;
  status: DocumentStatus;
}

export interface ChatRequest {
  documentId: string;
  message: string;
  mentionedResources?: MentionedResource[];
  context?: {
    currentSection?: string;
    selectedText?: string;
  };
}

// Chat stream event data types
export interface ChatTokenData {
  token: string;
  messageId?: string;
}

export interface ChatCompleteData {
  messageId: string;
  totalTokens?: number;
  cost?: number;
}

export interface ChatErrorData {
  code: string;
  message: string;
}

export type ChatStreamEventData =
  | ChatTokenData
  | ChatCompleteData
  | ChatErrorData
  | string;

export interface ChatStreamEvent {
  event: 'token' | 'complete' | 'error';
  data: ChatStreamEventData;
}
