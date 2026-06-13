/**
 * Topic Insights Frontend Types
 *
 * 专题洞察模块的类型定义
 */

// ==================== Enums ====================

export enum ResearchTopicType {
  MACRO = 'MACRO',
  TECHNOLOGY = 'TECHNOLOGY',
  COMPANY = 'COMPANY',
  EVENT = 'EVENT',
}

export enum ResearchTopicStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ARCHIVED = 'ARCHIVED',
}

export enum RefreshFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
  MANUAL = 'MANUAL',
}

export enum DimensionStatus {
  PENDING = 'PENDING',
  RESEARCHING = 'RESEARCHING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum RefreshType {
  FULL = 'FULL',
  INCREMENTAL = 'INCREMENTAL',
  DIMENSION = 'DIMENSION',
}

export enum RefreshPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
}

export enum RefreshLogStatus {
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum ReportStatus {
  DRAFT = 'DRAFT',
  GENERATING = 'GENERATING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// ==================== Core Types ====================

/**
 * 专题配置（存储在 topicConfig JSON 字段中）
 */
export interface TopicConfig {
  knowledgeBaseIds?: string[]; // 关联的知识库ID列表
  searchTimeRange?: string; // 搜索时间范围: '1m', '3m', '6m', '1y', 'all'
  enableFigures?: boolean; // ★ 是否在报告中显示图表（默认 true）
  [key: string]: unknown; // 允许其他扩展配置
}

/**
 * 研究专题
 */
// 专题可见性
export type TopicVisibility = 'PRIVATE' | 'SHARED' | 'PUBLIC';

export interface ResearchTopic {
  id: string;
  name: string;
  description: string | null;
  type: ResearchTopicType;
  status: ResearchTopicStatus;
  visibility?: TopicVisibility; // 可见性：私有/共享/公开
  language?: 'zh' | 'en'; // 报告语言
  topicConfig?: TopicConfig; // ★ 专题配置（含知识库ID等）
  icon: string | null;
  color: string | null;
  refreshFrequency: RefreshFrequency;
  lastRefreshAt: string | null;
  totalReports: number;
  totalSources: number;
  userId?: string; // ★ 后端实际返回的字段名
  createdById?: string; // ★ 兼容旧代码
  createdAt: string;
  updatedAt: string;
  // ★ Mission 任务进度（Card 显示用，与 missionStatus 保持一致）
  missionTotalTasks?: number;
  missionCompletedTasks?: number;
  missionProgress?: number;
  missionStatus?: string | null;
  // Relations
  dimensions?: TopicDimension[];
  latestReport?: TopicReport | null;
  schedule?: TopicSchedule | null;
}

/**
 * 研究维度
 */
export interface TopicDimension {
  id: string;
  topicId: string;
  name: string;
  description: string | null;
  searchQueries: string[];
  searchSources: string[];
  sortOrder: number;
  isEnabled: boolean;
  minSources: number;
  status: DimensionStatus;
  lastResearchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 研究报告
 * v2.0 - 增强版报告结构
 */
export interface TopicReport {
  id: string;
  topicId: string;
  version: number;
  title: string | null;
  summary: string | null;
  executiveSummary?: string; // 执行摘要（兼容旧版，字符串格式）
  fullReport?: string; // 完整报告（Markdown）
  highlights: ReportHighlight[] | null;
  totalSources: number;
  status: ReportStatus;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Relations
  dimensionAnalyses?: DimensionAnalysis[];
  evidence?: TopicEvidence[];

  // ========== v2.0 增强字段 ==========
  /** 结构化执行摘要 */
  executiveSummaryV2?: ExecutiveSummaryV2;
  /** 跨维度关联分析 */
  crossDimensionAnalysis?: CrossDimensionAnalysis;
  /** 风险评估 */
  riskAssessment?: RiskAssessment;
  /** 战略建议 */
  strategicRecommendations?: StrategicRecommendations;
  /** 情景展望 */
  scenarioOutlook?: {
    baseline?: string;
    optimistic?: string;
    pessimistic?: string;
  };
  /** 数据来源说明 */
  dataSourceNotes?: string;
  /** 图表数据 */
  charts?: ReportChart[];
}

/**
 * v2.0 结构化执行摘要
 */
export interface ExecutiveSummaryV2 {
  /** 核心论断：一句话概括本报告最重要的发现/判断 */
  thesisStatement?: string;
  /** 核心结论（3-5条一句话结论） */
  coreConclusions: string[];
  /** 关键数据点 */
  keyMetrics: Array<{
    metric: string;
    value: string;
    source: string;
  }>;
  /** 风险提示 */
  riskAlerts: string[];
  /** 行动建议 */
  actionItems: string[];
  /** 完整文本 */
  fullText: string;
}

/**
 * 跨维度关联分析
 */
export interface CrossDimensionAnalysis {
  title: string;
  /** 因果链 */
  causalChains: Array<{
    chain: string;
    explanation: string;
    timeframe: string;
  }>;
  /** 关键联动点 */
  keyLinkages: Array<{
    dimensions: string[];
    relationship: string;
    impact: string;
  }>;
  /** 反馈回路：自我强化或自我抑制的循环效应 */
  feedbackLoops?: string[];
  /** 系统性效应：多维度联动可能触发的涌现效应 */
  systemicEffects?: string[];
  fullText: string;
}

/**
 * 风险评估
 */
export interface RiskAssessment {
  title: string;
  /** 风险矩阵 */
  riskMatrix: Array<{
    riskType: string;
    probability: '高' | '中' | '低';
    impact: '高' | '中' | '低';
    timeframe: '短期' | '中期' | '长期';
    indicators: string;
    mitigation: string;
  }>;
  fullText: string;
}

/**
 * 战略建议
 */
export interface StrategicRecommendations {
  title: string;
  /** 对企业决策者 */
  forEnterprise: {
    shortTerm: string[];
    midTerm: string[];
  };
  /** 对投资者 */
  forInvestors: {
    opportunities: string[];
    risks: string[];
  };
  /** 对政策研究者 */
  forPolicymakers: {
    keyObservations: string[];
  };
  fullText: string;
}

// ========== 图表数据类型 ==========

/**
 * 图表类型
 */
export type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'radar' | 'composed';

/**
 * 图表数据点
 */
export interface ChartDataPoint {
  /** X轴标签（通常是时间或类别） */
  label: string;
  /** 数值 */
  value: number;
  /** 系列名称（用于多系列图表） */
  series?: string;
  /** 额外数据 */
  extra?: Record<string, unknown>;
}

/**
 * 图表来源类型
 * - reference: 引用原始证据中的图表/图片
 * - generated: AI 根据数据生成的图表
 */
export type ChartSourceType = 'reference' | 'generated';

/**
 * 图表配置
 * ★ v3.0: 支持两种类型：reference（引用图表）和 generated（生成图表）
 */
export interface ReportChart {
  /** 图表ID */
  id: string;
  /** ★ 图表来源类型：reference=引用原始图表，generated=AI生成图表 */
  chartType?: ChartSourceType;
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
    type?: 'category' | 'number' | 'time';
  };
  /** Y轴配置 */
  yAxis?: {
    label: string;
    unit?: string;
    min?: number;
    max?: number;
  };
  /** 系列配置（多系列图表） */
  series?: Array<{
    name: string;
    color?: string;
  }>;
  /** 数据来源 */
  source?: string;
  /** 关联的章节ID */
  sectionId?: string;
  /** 图表在章节内的位置 */
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
 * 风险矩阵图表数据（特殊类型）
 */
export interface RiskMatrixChart {
  id: string;
  type: 'risk-matrix';
  title: string;
  data: Array<{
    risk: string;
    probability: number; // 0-100
    impact: number; // 0-100
    category?: string;
  }>;
}

/**
 * 时间轴图表数据（特殊类型）
 */
export interface TimelineChart {
  id: string;
  type: 'timeline';
  title: string;
  data: Array<{
    date: string;
    event: string;
    description?: string;
    category?: string;
  }>;
}

/**
 * 报告高亮
 */
export interface ReportHighlight {
  type: 'trend' | 'finding' | 'opportunity' | 'challenge';
  title: string;
  content: string;
  dimensionId?: string;
}

/**
 * 维度分析
 */
export interface DimensionAnalysis {
  id: string;
  reportId: string;
  dimensionId: string;
  summary: string | null;
  keyFindings: KeyFinding[];
  trends: Trend[];
  challenges: Challenge[];
  opportunities: Opportunity[];
  confidenceLevel: 'high' | 'medium' | 'low' | null;
  detailedContent: string | null;
  createdAt: string;
  // Relations
  dimension?: TopicDimension;
}

/**
 * 关键发现
 */
export interface KeyFinding {
  finding: string;
  significance: 'high' | 'medium' | 'low';
  evidenceIds: string[];
}

/**
 * 趋势
 */
export interface Trend {
  trend: string;
  direction: 'increasing' | 'decreasing' | 'stable' | 'emerging';
  timeframe: string;
  evidenceIds: string[];
}

/**
 * 挑战
 */
export interface Challenge {
  challenge: string;
  impact: string;
  evidenceIds: string[];
}

/**
 * 机会
 */
export interface Opportunity {
  opportunity: string;
  potential: string;
  evidenceIds: string[];
}

/**
 * 证据
 */
export interface TopicEvidence {
  id: string;
  reportId: string;
  title: string;
  url: string;
  domain: string | null;
  snippet: string | null;
  sourceType: string | null;
  publishedAt: string | null;
  credibilityScore: number | null;
  fetchedAt: string | null;
  createdAt: string;
  /** 引用索引，用于报告正文中的引用标记 [1], [2] 等 */
  citationIndex?: number | null;
}

/**
 * 刷新计划
 */
export interface TopicSchedule {
  id: string;
  topicId: string;
  frequency: RefreshFrequency;
  isEnabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  preferredTime: string | null;
  preferredDayOfWeek: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 刷新日志
 */
export interface TopicRefreshLog {
  id: string;
  topicId: string;
  reportId: string | null;
  triggerType: 'manual' | 'scheduled' | 'forced';
  status: RefreshLogStatus;
  startedAt: string;
  completedAt: string | null;
  dimensionsRefreshed: number;
  sourcesFound: number;
  error: string | null;
}

// ==================== DTOs ====================

/**
 * 创建专题 DTO
 */
export interface CreateTopicDto {
  name: string;
  description?: string;
  type: ResearchTopicType;
  topicConfig?: Record<string, unknown>;
  icon?: string;
  color?: string;
  refreshFrequency?: RefreshFrequency;
  visibility?: TopicVisibility; // ★ 可见性：私有/团队/公开
  language?: 'zh' | 'en'; // ★ 报告语言
  dimensions?: DimensionConfigDto[];
}

/**
 * 维度配置 DTO
 */
export interface DimensionConfigDto {
  name: string;
  description?: string;
  searchQueries?: string[];
  searchSources?: string[];
  sortOrder?: number;
  isEnabled?: boolean;
  minSources?: number;
}

/**
 * 更新专题 DTO
 */
export interface UpdateTopicDto {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  refreshFrequency?: RefreshFrequency;
  status?: ResearchTopicStatus;
  topicConfig?: TopicConfig; // ★ 专题配置更新
  visibility?: TopicVisibility; // ★ 可见性设置
}

/**
 * 查询专题 DTO
 */
export interface ListTopicsDto {
  type?: ResearchTopicType;
  status?: ResearchTopicStatus;
  search?: string;
  skip?: number;
  take?: number;
}

/**
 * 触发刷新 DTO
 */
export interface TriggerRefreshDto {
  type?: RefreshType;
  dimensionIds?: string[];
  priority?: RefreshPriority;
  notify?: boolean;
  notificationEmail?: string;
  researchDepth?: 'quick' | 'standard' | 'thorough';
}

/**
 * 添加维度 DTO
 */
export interface AddDimensionDto {
  name: string;
  description?: string;
  searchQueries?: string[];
  searchSources?: string[];
  sortOrder?: number;
  isEnabled?: boolean;
  minSources?: number;
}

/**
 * 更新维度 DTO
 */
export interface UpdateDimensionDto {
  name?: string;
  description?: string;
  searchQueries?: string[];
  searchSources?: string[];
  isEnabled?: boolean;
  minSources?: number;
}

/**
 * 调整维度顺序 DTO
 */
export interface ReorderDimensionsDto {
  dimensionIds: string[];
}

/**
 * 报告列表 DTO
 */
export interface ListReportsDto {
  limit?: number;
  cursor?: string;
}

/**
 * 导出报告 DTO
 */
export interface ExportReportDto {
  format: 'pdf' | 'docx';
  includeEvidence?: boolean;
  includeMetadata?: boolean;
}

/**
 * 比较报告 DTO
 */
export interface CompareReportsDto {
  from: number;
  to: number;
}

/**
 * 证据列表 DTO
 */
export interface ListEvidenceDto {
  dimensionId?: string;
  sourceType?: string;
  minCredibility?: number;
  sortBy?: 'credibility' | 'date' | 'relevance';
  pageSize?: number;
  page?: number;
}

/**
 * 更新刷新计划 DTO
 */
export interface UpdateScheduleDto {
  frequency?: RefreshFrequency;
  isEnabled?: boolean;
  preferredTime?: string;
  preferredDayOfWeek?: number;
}

/**
 * 日志列表 DTO
 */
export interface ListLogsDto {
  limit?: number;
  status?: RefreshLogStatus;
}

// ==================== Response Types ====================

/**
 * 刷新状态响应
 */
export interface RefreshStatusResponse {
  isRunning: boolean;
  startedAt?: string;
  currentPhase?: string;
  progress?: number;
  currentDimension?: string;
  completedDimensions?: number;
  totalDimensions?: number;
}

/**
 * 刷新进度事件
 */
export interface RefreshProgressEvent {
  topicId: string;
  reportId: string;
  phase: 'starting' | 'researching' | 'synthesizing' | 'completed' | 'failed';
  progress: number;
  currentDimension?: string;
  completedDimensions: number;
  totalDimensions: number;
  message: string;
  error?: string;
}

/**
 * 报告比较结果
 */
export interface ReportComparisonResult {
  fromVersion: number;
  toVersion: number;
  summary: {
    totalChanges: number;
    newFindings: number;
    removedFindings: number;
    updatedFindings: number;
  };
  dimensions: DimensionComparisonResult[];
}

/**
 * 维度比较结果
 */
export interface DimensionComparisonResult {
  dimensionId: string;
  dimensionName: string;
  changes: {
    type: 'added' | 'removed' | 'modified';
    field: string;
    oldValue?: string;
    newValue?: string;
  }[];
}

/**
 * 统计数据
 */
export interface TopicStats {
  totalReports: number;
  totalSources: number;
  totalEvidence: number;
  lastRefreshAt: string | null;
  avgCredibilityScore: number | null;
  dimensionStats: {
    dimensionId: string;
    name: string;
    status: DimensionStatus;
    evidenceCount: number;
  }[];
}

/**
 * 模板
 */
export interface ResearchTemplate {
  id: string;
  name: string;
  description: string;
  type: ResearchTopicType;
  dimensions: DimensionConfigDto[];
  icon?: string;
  color?: string;
}

// ==================== TODO Types ====================

/**
 * TODO 任务类型
 */
export enum ResearchTodoType {
  LEADER_PLANNING = 'LEADER_PLANNING',
  DIMENSION_RESEARCH = 'DIMENSION_RESEARCH',
  REPORT_WRITING = 'REPORT_WRITING',
  QUALITY_REVIEW = 'QUALITY_REVIEW',
  USER_REQUEST = 'USER_REQUEST',
}

/**
 * TODO 任务状态
 */
export enum ResearchTodoStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  IN_PROGRESS = 'IN_PROGRESS',
  REVIEWING = 'REVIEWING', // ★ v7.2: Leader 审核中
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * 研究 TODO
 */
export interface ResearchTodo {
  id: string;
  topicId: string;
  missionId: string;
  type: ResearchTodoType;
  title: string;
  description?: string;
  dimensionId?: string;
  dimensionName?: string;
  agentId?: string;
  agentName?: string;
  agentRole?: string;
  /** ★ Agent 使用的 AI 模型 ID */
  modelId?: string;
  /** ★ 模型展示名称（用于前端显示和图标匹配） */
  modelDisplayName?: string;
  /** ★ Leader Agent 分配此任务的理由（后端提供） */
  assignmentReason?: {
    agentReason?: string;
    modelReason?: string;
  };
  status: ResearchTodoStatus;
  progress: number;
  statusMessage?: string;
  priority: number;
  dependsOn: string[];
  startedAt?: string;
  completedAt?: string;
  estimatedMs?: number;
  actualMs?: number;
  result?: TodoResult;
  userCanPause: boolean;
  userCanCancel: boolean;
  userCanPrioritize: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * TODO 结果
 * 支持两种格式：
 * 1. 简单统计（keyFindings 为数字）
 * 2. 完整分析数据（包含 summary, keyFindings 数组, trends 等）
 */
export interface TodoResult {
  sourcesFound?: number;
  wordCount?: number;
  figuresUsed?: number;
  // keyFindings 可以是数量(number)或完整的发现列表
  keyFindings?: number | KeyFinding[];
  // 完整分析数据
  summary?: string;
  trends?: Trend[];
  challenges?: Challenge[];
  opportunities?: Opportunity[];
  error?: string;
  // 质量审核结果（QUALITY_REVIEW 任务专用）
  reviewedTasks?: number;
  dimensionReviews?: Array<{
    dimensionName: string;
    qualityLevel: string;
    score: number;
    issues: number;
    suggestions: string[];
  }>;
  overallReview?: {
    qualityLevel: string;
    score: number;
    recommendations: string[];
    needsReresearch: boolean;
  } | null;
  feedback?: string;
}

/**
 * TODO 汇总
 */
export interface TodoSummary {
  total: number;
  pending: number;
  queued: number;
  inProgress: number;
  paused: number;
  completed: number;
  failed: number;
  cancelled: number;
  overallProgress: number;
}

/**
 * TODO 列表响应
 */
export interface TodoListResponse {
  todos: ResearchTodo[];
  summary: TodoSummary;
}

/**
 * TODO 分组
 */
export interface TodoGroup {
  status: 'in_progress' | 'pending' | 'completed' | 'failed';
  label: string;
  todos: ResearchTodo[];
  isExpanded: boolean;
}

/**
 * TODO WebSocket 事件类型
 */
export enum TodoEventType {
  TODO_CREATED = 'todo:created',
  TODO_STATUS_CHANGED = 'todo:status_changed',
  TODO_PROGRESS = 'todo:progress',
  TODO_COMPLETED = 'todo:completed',
  TODO_FAILED = 'todo:failed',
  TODO_CANCELLED = 'todo:cancelled',
  TODO_PAUSED = 'todo:paused',
  TODO_RESUMED = 'todo:resumed',
  // ★ v7.2: Leader 审核事件
  TODO_REVIEWING = 'todo:reviewing',
  TODO_REVIEWED = 'todo:reviewed',
}
