/**
 * AI Engine - Agent 类型定义
 * 统一的 Agent 系统类型（纯字符串 ID 设计）
 */

// ==================== ID 类型 ====================

/**
 * Agent ID 类型
 */
export type AgentId = string;

/**
 * 工具 ID 类型
 */
export type ToolId = string;

/**
 * 技能 ID 类型
 */
export type SkillId = string;

// ==================== 内置工具常量 ====================

export const BUILTIN_TOOLS = {
  // 信息获取
  WEB_SEARCH: "web-search",
  WEB_SCRAPER: "web-scraper",
  DATA_FETCH: "data-fetch",
  RAG_SEARCH: "rag-search",
  DATABASE_QUERY: "database-query",
  KNOWLEDGE_GRAPH: "knowledge-graph",

  // 内容生成
  TEXT_GENERATION: "text-generation",
  IMAGE_GENERATION: "image-generation",
  CODE_GENERATION: "code-generation",
  AUDIO_GENERATION: "audio-generation",
  VIDEO_GENERATION: "video-generation",
  STRUCTURED_OUTPUT: "structured-output",

  // 数据处理
  DATA_ANALYSIS: "data-analysis",
  FILE_CONVERSION: "file-conversion",
  FILE_PARSER: "file-parser",
  DATA_VALIDATION: "data-validation",
  DATA_CLEANING: "data-cleaning",
  DOCUMENT_DIFF: "document-diff",
  TEMPLATE_RENDER: "template-render",

  // 代码执行
  PYTHON_EXECUTOR: "python-executor",
  JAVASCRIPT_EXECUTOR: "javascript-executor",
  SQL_EXECUTOR: "sql-executor",
  SHELL_EXECUTOR: "shell-executor",
  CONTAINER_EXECUTOR: "container-executor",
  OCR_RECOGNITION: "ocr-recognition",

  // 外部集成
  MESSAGE_PUSH: "message-push",
  CLOUD_STORAGE: "cloud-storage",
  GITHUB_INTEGRATION: "github-integration",
  EMAIL_SENDER: "email-sender",
  CALENDAR_INTEGRATION: "calendar-integration",
  WEBHOOK_TRIGGER: "webhook-trigger",

  // 记忆管理
  SHORT_TERM_MEMORY: "short-term-memory",
  LONG_TERM_MEMORY: "long-term-memory",
  ENTITY_MEMORY: "entity-memory",
  KNOWLEDGE_BASE: "knowledge-base",
  USER_PREFERENCES: "user-preferences",

  // 导出
  EXPORT_PPTX: "export-pptx",
  EXPORT_DOCX: "export-docx",
  EXPORT_PDF: "export-pdf",
  EXPORT_IMAGE: "export-image",

  // Agent 协作
  AGENT_HANDOFF: "agent-handoff",
  HUMAN_APPROVAL: "human-approval",
  AGENT_COMMUNICATION: "agent-communication",
  TASK_DELEGATION: "task-delegation",
  CONSENSUS_MECHANISM: "consensus-mechanism",
  WORKFLOW_ORCHESTRATION: "workflow-orchestration",
} as const;

export type BuiltinToolId = (typeof BUILTIN_TOOLS)[keyof typeof BUILTIN_TOOLS];

// ==================== 任务状态 ====================

/**
 * Agent 任务状态
 */
export type AgentTaskStatus =
  | "pending"
  | "planning"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

// ==================== 产出物类型 ====================

/**
 * 执行模式（plan-based / reactive / hybrid）
 *
 * 2026-05-01 (PR-X-T): 从 core/types/context.types.ts 上提到这里。
 * context.types.ts 整文件作废（同名 SkillContext 与 skills/abstractions/skill.interface.ts
 * 冲突；其他类型 0 production consumer）。
 */
export type ExecutionMode = "plan-based" | "reactive" | "hybrid";

/**
 * 产出物类型
 */
export type ArtifactType =
  | "pptx"
  | "docx"
  | "pdf"
  | "image"
  | "code"
  | "data"
  | "text"
  | "audio"
  | "video";

// ==================== AI 模型类型 ====================

/**
 * AI 模型类型
 */
export type AIModelType =
  | "chat"
  | "chat-fast"
  | "multimodal"
  | "embedding"
  | "image";

// ==================== Agent 输入/输出 ====================

/**
 * 上传的文件/附件
 */
export interface UploadedFile {
  /** 文件 ID */
  id: string;
  /** 文件名 */
  name: string;
  /** MIME 类型 */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** 文件 URL */
  url?: string;
  /** 文件内容（二进制或字符串） */
  content?: Buffer | string;
  /** 附件类型 */
  type?: "file" | "image" | "url" | "code";
}

/**
 * Agent 输入（统一接口）
 * 适用于所有类型的 Agent（Plan-Based 和 ReAct）
 */
export interface AgentInput {
  /** 用户提示词/消息 */
  prompt: string;

  /** 上传的文件/附件 */
  files?: UploadedFile[];

  /** 参考网址 */
  urls?: string[];

  /** 引用的资源 ID */
  resourceIds?: string[];

  /** 使用的模板 ID */
  templateId?: string;

  /** 上下文信息（用于 ReAct Agent） */
  context?: Record<string, unknown>;

  /** 额外选项 */
  options?: Record<string, unknown>;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 执行计划步骤
 */
export interface PlanStep {
  id: string;
  name: string;
  description: string;
  /** 使用的工具 ID */
  toolId?: ToolId;
  /** 使用的模型类型 */
  modelType?: AIModelType;
  /** 依赖的步骤 ID */
  dependencies: string[];
  /** 预估耗时（毫秒） */
  estimatedDuration: number;
}

/**
 * Agent 执行计划
 */
export interface AgentPlan {
  taskId: string;
  agentId: AgentId;
  steps: PlanStep[];
  estimatedTime: number;
  toolsRequired: ToolId[];
  modelsRequired: AIModelType[];
  metadata?: Record<string, unknown>;
}

/**
 * Agent 模板
 */
export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category: string;
  defaultPrompt?: string;
  defaultOptions?: Record<string, unknown>;
}

/**
 * Agent 产出物
 */
export interface Artifact {
  id: string;
  type: ArtifactType;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
  content?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Agent 结果
 */
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
  type: "plan_ready";
  plan: AgentPlan;
}

export interface StepStartEvent {
  type: "step_start";
  stepId: string;
  message: string;
}

export interface StepProgressEvent {
  type: "step_progress";
  stepId: string;
  progress: number;
  message: string;
}

export interface StepCompleteEvent {
  type: "step_complete";
  stepId: string;
  result: unknown;
}

export interface ToolCallEvent {
  type: "tool_call";
  toolId: ToolId;
  input: unknown;
}

export interface ToolResultEvent {
  type: "tool_result";
  toolId: ToolId;
  output: unknown;
  duration: number;
}

export interface ArtifactEvent {
  type: "artifact";
  artifact: Artifact;
}

export interface CompleteEvent {
  type: "complete";
  result: AgentResult;
}

export interface ErrorEvent {
  type: "error";
  error: string;
  stepId?: string;
}

/**
 * Agent 事件联合类型
 */
export type AgentEvent =
  | PlanReadyEvent
  | StepStartEvent
  | StepProgressEvent
  | StepCompleteEvent
  | ToolCallEvent
  | ToolResultEvent
  | ArtifactEvent
  | CompleteEvent
  | ErrorEvent;

// ==================== Agent 配置 ====================

/**
 * Agent 配置
 */
export interface AgentConfig {
  id: AgentId;
  name: string;
  description: string;
  icon: string;
  color: string;
  capabilities: string[];
  templates: AgentTemplate[];
  /** Agent 选择关键词，用于 Orchestrator 自动路由 */
  selectionKeywords?: string[];
}
