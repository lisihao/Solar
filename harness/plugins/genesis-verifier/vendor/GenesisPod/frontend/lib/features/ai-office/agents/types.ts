/**
 * Agent 类型定义
 * 前端 Agent 系统类型
 */

// ==================== Agent 类型枚举 ====================

export enum AgentType {
  SLIDES = 'SLIDES',
  DOCS = 'DOCS',
  DESIGNER = 'DESIGNER',
}

export enum AgentTaskStatus {
  PENDING = 'PENDING',
  PLANNING = 'PLANNING',
  EXECUTING = 'EXECUTING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum ToolType {
  WEB_SEARCH = 'web_search',
  WEB_SCRAPER = 'web_scraper',
  DATA_FETCH = 'data_fetch',
  TEXT_GENERATION = 'text_generation',
  IMAGE_GENERATION = 'image_generation',
  CODE_GENERATION = 'code_generation',
  DATA_ANALYSIS = 'data_analysis',
  FILE_CONVERSION = 'file_conversion',
  EXPORT_PPTX = 'export_pptx',
  EXPORT_DOCX = 'export_docx',
  EXPORT_PDF = 'export_pdf',
  EXPORT_IMAGE = 'export_image',
}

export enum ArtifactType {
  PPTX = 'PPTX',
  DOCX = 'DOCX',
  PDF = 'PDF',
  IMAGE = 'IMAGE',
  CODE = 'CODE',
  DATA = 'DATA',
}

// ==================== Agent 输入/输出 ====================

export interface UploadedFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
}

export interface AgentInput {
  prompt: string;
  files?: UploadedFile[];
  urls?: string[];
  resourceIds?: string[];
  templateId?: string;
  options?: Record<string, unknown>;
}

export interface PlanStep {
  id: string;
  name: string;
  description: string;
  tool?: ToolType;
  dependencies: string[];
  estimatedDuration: number;
}

export interface AgentPlan {
  taskId: string;
  agentType: AgentType;
  steps: PlanStep[];
  estimatedTime: number;
  toolsRequired: ToolType[];
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category: string;
  defaultPrompt?: string;
  defaultOptions?: Record<string, unknown>;
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
  content?: unknown;
}

export interface AgentResult {
  success: boolean;
  artifacts: Artifact[];
  summary?: string;
  tokensUsed: number;
  duration: number;
  error?: string;
}

// ==================== Agent 事件 ====================

export interface PlanReadyEvent {
  type: 'plan_ready';
  plan: AgentPlan;
}

export interface StepStartEvent {
  type: 'step_start';
  stepId: string;
  message: string;
}

export interface StepProgressEvent {
  type: 'step_progress';
  stepId: string;
  progress: number;
  message: string;
}

export interface StepCompleteEvent {
  type: 'step_complete';
  stepId: string;
  result: unknown;
}

export interface ToolCallEvent {
  type: 'tool_call';
  tool: ToolType;
  input: unknown;
}

export interface ToolResultEvent {
  type: 'tool_result';
  tool: ToolType;
  output: unknown;
  duration: number;
}

export interface ArtifactEvent {
  type: 'artifact';
  artifact: Artifact;
}

export interface CompleteEvent {
  type: 'complete';
  result: AgentResult;
}

export interface ErrorEvent {
  type: 'error';
  error: string;
  stepId?: string;
}

export interface ThinkingEvent {
  type: 'thinking';
  content: string;
}

export interface ProgressEvent {
  type: 'progress';
  data: {
    phase: string;
    percentage: number;
    message: string;
    currentSection?: number;
    totalSections?: number;
  };
}

export type AgentEvent =
  | PlanReadyEvent
  | StepStartEvent
  | StepProgressEvent
  | StepCompleteEvent
  | ToolCallEvent
  | ToolResultEvent
  | ArtifactEvent
  | CompleteEvent
  | ErrorEvent
  | ThinkingEvent
  | ProgressEvent;

// ==================== Agent 配置 ====================

export interface AgentConfig {
  type: AgentType;
  name: string;
  description: string;
  icon: string;
  color: string;
  capabilities: string[];
  templates: AgentTemplate[];
}

export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  [AgentType.SLIDES]: {
    type: AgentType.SLIDES,
    name: 'AI Slides',
    description: '智能 PPT 生成器，快速创建专业演示文稿',
    icon: '📊',
    color: '#3B82F6',
    capabilities: ['自动生成大纲', '智能配图', '多种主题风格', '导出 PPTX'],
    templates: [],
  },
  [AgentType.DOCS]: {
    type: AgentType.DOCS,
    name: 'AI Docs',
    description: '智能文档助手，撰写专业文档报告',
    icon: '📄',
    color: '#10B981',
    capabilities: ['自动调研资料', '生成大纲', '撰写内容', '导出 Word/PDF'],
    templates: [],
  },
  [AgentType.DESIGNER]: {
    type: AgentType.DESIGNER,
    name: 'AI Designer',
    description: '智能设计工具，生成创意设计图',
    icon: '🎨',
    color: '#F59E0B',
    capabilities: ['海报设计', 'Logo 设计', 'Banner 生成', '多风格变体'],
    templates: [],
  },
};

// ==================== Task 相关 ====================

export interface AgentTask {
  id: string;
  userId?: string;
  agentType: AgentType;
  status: AgentTaskStatus;
  input: AgentInput;
  plan?: AgentPlan;
  result?: AgentResult;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  tokensUsed?: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ==================== Progress 相关 ====================

export interface ProgressState {
  phase: 'idle' | 'planning' | 'executing' | 'completed' | 'error';
  percentage: number;
  message: string;
  currentStep?: PlanStep | string;
  completedSteps: string[];
  totalSteps?: number;
  toolCalls: Array<{
    tool: ToolType | string;
    input: unknown;
    output?: unknown;
    duration?: number;
    timestamp: Date;
  }>;
}
