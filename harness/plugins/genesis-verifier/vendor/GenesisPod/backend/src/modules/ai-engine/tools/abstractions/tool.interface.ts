/**
 * AI Engine - Tool Interface
 * 工具接口定义
 */

import { ValidationResult, JsonObject } from "@/modules/ai-engine/facade/index";

/**
 * 工具上下文
 */
export interface ToolContext {
  /**
   * 执行 ID
   */
  executionId: string;

  /**
   * 工具 ID
   */
  toolId: string;

  /**
   * 任务 ID（向后兼容）
   */
  taskId?: string;

  /**
   * 用户 ID
   */
  userId?: string;

  /**
   * 工作区 ID
   */
  workspaceId?: string;

  /**
   * 会话 ID
   */
  sessionId?: string;

  /**
   * 调用者 ID
   */
  callerId?: string;

  /**
   * 调用者类型
   */
  callerType?: "agent" | "skill" | "direct" | "orchestrator";

  /**
   * 取消信号
   */
  signal?: AbortSignal;

  /**
   * 超时时间（毫秒）
   */
  timeout?: number;

  /**
   * 当前重试次数
   */
  retryCount?: number;

  /**
   * AI Kernel 进程 ID
   */
  processId?: string;

  /**
   * 运行时环境（结构类型，避免反向依赖 ai-harness）
   *
   * - 提供给 PermissionMiddleware 做 entitlement 检查
   * - duck-typed 匹配 IRuntimeEnvironment 的 getUserEntitlements 子集
   * - 不传 → entitlement 检查跳过（仅对 requiredEntitlements 为空的工具安全）
   */
  environment?: {
    getUserEntitlements?: () => Promise<{ keys: string[] }>;
  };

  /**
   * 元数据
   */
  metadata?: JsonObject;

  /**
   * 创建时间
   */
  createdAt: Date;
}

/**
 * 工具结果
 */
export interface ToolResult<T = unknown> {
  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 返回数据
   */
  data?: T;

  /**
   * 错误信息
   */
  error?: ToolResultError;

  /**
   * 执行元数据
   */
  metadata: ToolResultMetadata;
}

/**
 * 工具结果错误
 */
export interface ToolResultError {
  /**
   * 错误码
   */
  code: string;

  /**
   * 错误消息
   */
  message: string;

  /**
   * 错误详情
   */
  details?: JsonObject;

  /**
   * 是否可重试
   */
  retryable?: boolean;
}

/**
 * 工具结果元数据
 */
export interface ToolResultMetadata {
  /**
   * 执行 ID
   */
  executionId: string;

  /**
   * 开始时间
   */
  startTime: Date;

  /**
   * 结束时间
   */
  endTime: Date;

  /**
   * 执行时长（毫秒）
   */
  duration: number;

  /**
   * 重试次数
   */
  retryCount?: number;

  /**
   * Token 使用量
   */
  tokensUsed?: number;

  /**
   * 额外信息
   */
  extra?: JsonObject;
}

/**
 * 工具类别
 * 使用字符串联合类型，支持扩展
 */
export type ToolCategory =
  | "information" // 信息获取
  | "generation" // 内容生成
  | "processing" // 数据处理
  | "execution" // 代码执行
  | "integration" // 外部集成
  | "memory" // 记忆管理
  | "export" // 导出
  | "collaboration" // 协作
  | string; // 允许自定义

/**
 * 内置工具 ID 常量
 */
export const BUILTIN_TOOLS = {
  // 信息获取
  WEB_SEARCH: "web-search",
  WEB_SCRAPER: "web-scraper",
  DATA_FETCH: "data-fetch",
  RAG_SEARCH: "rag-search",
  DATABASE_QUERY: "database-query",
  KNOWLEDGE_GRAPH: "knowledge-graph",
  IMAGE_SEARCH: "image-search",
  BING_IMAGE_SEARCH: "bing-image-search",
  GOOGLE_IMAGE_SEARCH: "google-image-search",
  SERPAPI_IMAGE_SEARCH: "serpapi-image-search",

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
  WECHAT_MP_PUBLISH: "wechat-mp-publish",
  XHS_PUBLISH: "xhs-publish",
  SOCIAL_PUBLISH_STATUS: "social-publish-status",

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

  // 协作
  AGENT_HANDOFF: "agent-handoff",
  HUMAN_APPROVAL: "human-approval",
  AGENT_COMMUNICATION: "agent-communication",
  TASK_DELEGATION: "task-delegation",
  CONSENSUS_MECHANISM: "consensus-mechanism",
  WORKFLOW_ORCHESTRATION: "workflow-orchestration",

  // 自动化
  BROWSER_CONTEXT: "browser-context",
} as const;

/**
 * 内置工具 ID 类型
 */
export type BuiltinToolId = (typeof BUILTIN_TOOLS)[keyof typeof BUILTIN_TOOLS];

/**
 * 工具 ID 类型（支持自定义）
 */
export type ToolId = BuiltinToolId | string;

/**
 * JSON Schema 类型
 */
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
  additionalProperties?: boolean | JSONSchema;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
  $ref?: string;
  definitions?: Record<string, JSONSchema>;
}

/**
 * Function Definition（用于 LLM Function Calling）
 */
export interface FunctionDefinition {
  /**
   * 函数名称
   */
  name: string;

  /**
   * 函数描述
   */
  description: string;

  /**
   * 参数 Schema
   */
  parameters: JSONSchema;

  /**
   * 是否严格模式
   */
  strict?: boolean;
}

/**
 * 精简工具摘要（用于 LLM 工具列表展示，节省 Token）
 *
 * 设计思路：
 * - LLM 在选择工具时，只需要知道工具名和用途，不需要完整参数 schema
 * - 当 LLM 决定调用某个工具时，再获取该工具的完整 FunctionDefinition
 * - 这样可以显著减少 System Prompt 中的 Token 消耗
 */
export interface CompactToolSummary {
  /**
   * 工具 ID（也是函数名）
   */
  id: string;

  /**
   * 工具名称（人类可读）
   */
  name: string;

  /**
   * 简短描述（限制 100 字符）
   */
  brief: string;

  /**
   * 工具类别
   */
  category: ToolCategory;

  /**
   * 标签（可选，便于分类展示）
   */
  tags?: string[];
}

/**
 * 工具列表构建选项
 */
export interface ToolListOptions {
  /**
   * 是否使用精简模式（默认 true）
   * - true: 只返回 CompactToolSummary，节省 Token
   * - false: 返回完整 FunctionDefinition
   */
  compact?: boolean;

  /**
   * 最大工具数量（默认不限制）
   */
  maxTools?: number;

  /**
   * 按类别过滤
   */
  categories?: ToolCategory[];

  /**
   * 按标签过滤
   */
  tags?: string[];
}

/**
 * 工具接口
 * 精简版，专注于单一原子操作
 */
export interface ITool<TInput = unknown, TOutput = unknown> {
  /**
   * 唯一标识符
   */
  readonly id: string;

  /**
   * 名称
   */
  readonly name: string;

  /**
   * 描述
   */
  readonly description: string;

  /**
   * 工具类别
   */
  readonly category: ToolCategory;

  /**
   * 输入 Schema
   */
  readonly inputSchema: JSONSchema;

  /**
   * 输出 Schema
   */
  readonly outputSchema: JSONSchema;

  /**
   * 标签
   */
  readonly tags?: string[];

  /**
   * 默认超时时间（毫秒）
   */
  readonly defaultTimeout?: number;

  /**
   * 是否支持取消
   */
  readonly cancellable?: boolean;

  /**
   * 是否启用
   */
  readonly enabled?: boolean;

  /**
   * ★ 副作用类别（D14 Tool sideEffect 元数据）
   *
   * - 'none': 纯查询，重跑无副作用（如 web-search / arxiv-search）
   * - 'idempotent': 写操作但幂等（如 set value by key）
   * - 'destructive': 不可逆 / 不幂等（如 email-sender / image-generation）
   *
   * 用于：
   *   - L2 stage 重跑时跳过 destructive 调用历史（mission-pipeline-baseline §9.7）
   *   - figure 来源红线（image-generation 标 destructive，结合 ToolACL 拦截）
   *
   * 不填 → 默认 'none'（保守假设无副作用）。
   */
  readonly sideEffect?: "none" | "idempotent" | "destructive";

  /**
   * ★ 调用所需的 entitlement keys（D13 ToolACL）
   *
   * 用户必须在 IRuntimeEnvironment.getUserEntitlements() 返回的 keys 集合中
   * 包含全部声明的 entitlement，才能在 catalog 中看到此工具且实际调用。
   *
   * 例：['finance.premium'] → 仅订阅高级金融数据用户可用
   *
   * 不填 → 公开工具，无访问限制。
   */
  readonly requiredEntitlements?: readonly string[];

  /**
   * ★ 输出超此字符数自动落盘 + 给模型 preview + spillPath（P0-3 借鉴 Anthropic Claude Code）
   *
   * - 超阈值时 ToolOutputTruncatorMiddleware 将完整内容上传到 object storage，
   *   并在返回给模型的 output 中注入 "spillPath: ..." 提示。
   * - 默认 30_000（参考 Anthropic Claude Code Bash tool 阈值）。
   * - 设为 Infinity 或不填则跳过落盘检查（只做普通截断保护）。
   *
   * 典型配置：
   *   - bash / shell 类：30_000
   *   - web fetch / RAG search：100_000
   *   - read 类（文档全文）：不填（走 tool-invoker DEFAULT_RESULT_MAX_CHARS 保底）
   */
  readonly maxResultSizeChars?: number;

  /**
   * 执行工具
   */
  execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>;

  /**
   * 验证输入
   * 可以返回 ValidationResult 或 boolean（向后兼容）
   */
  validateInput?(input: TInput): ValidationResult | boolean;

  /**
   * 转换为 Function Calling 格式
   */
  toFunctionDefinition(): FunctionDefinition;

  /**
   * 转换为精简摘要格式（节省 Token）
   */
  toCompactSummary(): CompactToolSummary;
}

/**
 * 工具定义（用于注册）
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  /**
   * 工具 ID
   */
  id: ToolId;

  /**
   * 工具名称
   */
  name: string;

  /**
   * 工具描述
   */
  description: string;

  /**
   * 工具类别
   */
  category: ToolCategory;

  /**
   * 输入 Schema
   */
  inputSchema: JSONSchema;

  /**
   * 输出 Schema
   */
  outputSchema: JSONSchema;

  /**
   * 标签
   */
  tags?: string[];

  /**
   * 版本
   */
  version?: string;

  /**
   * 默认超时
   */
  defaultTimeout?: number;

  /**
   * 是否支持取消
   */
  cancellable?: boolean;

  /**
   * 是否启用
   */
  enabled?: boolean;

  /**
   * 工厂函数
   */
  factory?: () => ITool<TInput, TOutput>;
}

/**
 * 工具配置
 */
export interface ToolConfig {
  /**
   * 超时时间（毫秒）
   */
  timeout?: number;

  /**
   * 重试配置
   */
  retry?: {
    maxRetries: number;
    delay: number;
    backoff?: "linear" | "exponential";
  };

  /**
   * 是否启用验证
   */
  validation?: boolean;

  /**
   * 是否启用日志
   */
  logging?: boolean;

  /**
   * 是否沙箱模式
   */
  sandbox?: boolean;

  /**
   * 自定义配置
   */
  custom?: JsonObject;
}
