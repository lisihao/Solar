/**
 * AI Engine Facade Types
 * 统一 API 类型定义
 */

import { AIModelType } from "@prisma/client";
import type { TaskProfile, ChatMessage } from "../../../ai-engine/llm/types";

// ==================== Re-export 统一类型（向后兼容） ====================

/**
 * 任务画像 - 语义化配置
 * Re-export from llm/types for backward compatibility
 */
export type { TaskProfile };

/**
 * 聊天消息
 * Re-export from llm/types for backward compatibility
 */
export type { ChatMessage };

// ==================== LLM 能力类型 ====================

/**
 * 积分计费信息
 * 当提供此信息时，AI Engine 会自动扣除积分
 */
export interface CreditBillingInfo {
  /** 用户 ID（必需） */
  userId: string;
  /** 模块类型（如 ai-ask, ai-teams, {app}） */
  moduleType: string;
  /** 操作类型（如 chat, refresh, summary） */
  operationType: string;
  /** 关联的业务实体 ID（可选） */
  referenceId?: string;
  /** 操作描述（可选） */
  description?: string;
}

/**
 * 聊天请求
 */
export interface ChatRequest {
  /** 消息列表 */
  messages: ChatMessage[];

  /** ★ 推荐：指定模型类型，由 AI Engine 选择具体模型 */
  modelType?: AIModelType;

  /** ★ 推荐：任务画像，AI Engine 自动映射参数 */
  taskProfile?: TaskProfile;

  /** 直接指定模型（不推荐，除非有特殊需求） */
  model?: string;

  /** 直接指定 maxTokens（覆盖 taskProfile） */
  maxTokens?: number;

  /** 直接指定 temperature（覆盖 taskProfile） */
  temperature?: number;

  /** 系统提示词（会自动添加到消息列表） */
  systemPrompt?: string;

  /**
   * 操作名称 — 描述此次 LLM 调用的业务语义（如 "大纲规划"、"章节写作"、"质量审核"）
   * 用于时延跟踪系统标识每个 step
   */
  operationName?: string;

  /** 是否启用流式响应 */
  stream?: boolean;

  /** 严格模式：API失败时抛出异常 */
  strictMode?: boolean;

  /** 跳过输入/输出 guardrails（用于内部系统调用，如 claim extraction、fact check） */
  skipGuardrails?: boolean;

  /**
   * 内部可信调用弱化档：正则护栏照常跑（含硬 block + PII 脱敏），但"可疑(warning)"
   * 结果只记日志、不升级 LLM moderation、不 block。用于 agent-to-agent 喂外部网页/
   * 研究语料（图文相关性、findings 复核等）的高误报场景——这些不是用户输入攻击面，
   * 不该被内容审核误杀。与 skipGuardrails（整体跳过）的区别：仍保留 PII/硬 block。
   */
  trustedInternal?: boolean;

  /** JSON 模式：告诉 LLM 输出严格 JSON（支持 OpenAI json_object、Google JSON mode 等） */
  responseFormat?: "json" | "text";

  /**
   * Prompt 缓存策略
   * - "auto": 自动缓存 system prompt（Anthropic: cache_control, OpenAI: 已自动生效）
   * - undefined: 不主动缓存（默认，向后兼容）
   */
  cachePolicy?: "auto";

  /**
   * ★ Phase 5: Frozen prompt cache prefix from PromptCacheCoordinatorService.
   * When provided, overrides the request's systemPrompt with the frozen bytes
   * and forces cache_control so all subagents in the same mission share a prefix.
   */
  sharedCachePrefix?: {
    systemPromptText: string;
  };

  /**
   * 原生结构化输出 — 支持的 provider 会使用原生 JSON Schema 约束
   * 不支持的 provider 会降级为 system prompt 文本指令
   */
  outputSchema?: {
    type: "json_schema";
    schema: Record<string, unknown>;
  };

  // ==================== 积分计费 ====================

  /**
   * ★ 积分计费信息
   * 提供后会自动扣除积分，无需在业务代码中手动调用 consumeCredits
   * tokensUsed 会自动从响应中获取
   */
  billing?: CreditBillingInfo;

  // ==================== AI Kernel 进程追踪 ====================

  /** AI Kernel 进程 ID（传递给 AiChatService 用于 Journal/Cost/Metrics 追踪） */
  processId?: string;

  // ==================== K3 Fix: Skill Injection Options ====================

  /**
   * K3 Fix: 领域（用于自动注入技能）
   * 设置后，chat() 方法会自动加载对应领域的 Skills
   */
  domain?: string;

  /**
   * K3 Fix: 技能匹配查询（Anthropic 风格 description-based matching）
   * 结合 domain 使用，自动加载匹配的 Skills
   */
  query?: string;

  /**
   * K3 Fix: 额外加载的技能 ID 列表
   */
  additionalSkills?: string[];

  /**
   * K3 Fix: 技能上下文（传递给技能的变量）
   */
  skillContext?: Record<string, unknown>;
}

/**
 * 聊天响应
 */
export interface ChatResponse {
  /** 响应内容 */
  content: string;

  /** 使用的模型 */
  model: string;

  /** 使用的 token 数 */
  tokensUsed: number;

  /** 输入 token 数 */
  inputTokens?: number;

  /** 输出 token 数 */
  outputTokens?: number;

  /** API 返回的完成原因（"stop"=正常完成, "length"=截断, "end_turn"等） */
  finishReason?: string;

  /** 是否为错误响应 */
  isError?: boolean;
}

/**
 * 流式响应块
 */
export interface StreamChunk {
  /** 内容片段 */
  content: string;

  /** 是否为最后一块 */
  done: boolean;

  /** 错误信息 */
  error?: string;

  /** Token 使用统计（在最后一块中返回） */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ==================== 搜索能力类型 ====================

/**
 * 数据源类型
 */
export type DataSource = "web" | "academic" | "news" | "local" | "github";

/**
 * 搜索请求
 */
export interface SearchRequest {
  /** 搜索查询 */
  query: string;

  /** 数据源（可选，默认自动选择） */
  sources?: DataSource[];

  /** 最大结果数 */
  maxResults?: number;

  /** 时间范围 */
  timeRange?: "day" | "week" | "month" | "year" | "all";

  /** 语言 */
  language?: string;
}

/**
 * 搜索结果项
 */
export interface SearchResultItem {
  /** 标题 */
  title: string;

  /** URL */
  url: string;

  /** 内容摘要 */
  content: string;

  /** 相关性分数 */
  score?: number;

  /** 发布日期 */
  publishedDate?: string;

  /** 域名 */
  domain?: string;

  /** 数据源类型 */
  sourceType?: DataSource;
}

/**
 * 搜索响应
 */
export interface SearchResponse {
  /** 是否成功 */
  success: boolean;

  /** 搜索结果 */
  results: SearchResultItem[];

  /** 错误信息 */
  error?: string;
}

// ==================== Agent 能力类型 ====================

/**
 * Agent 输入
 */
export interface AgentInput {
  /** 任务描述 */
  task: string;

  /** 上下文信息 */
  context?: string;

  /** 可用工具 */
  tools?: string[];

  /** 附加参数 */
  params?: Record<string, unknown>;
}

/**
 * Agent 输出
 */
export interface AgentOutput {
  /** 是否成功 */
  success: boolean;

  /** 输出内容 */
  result: unknown;

  /** 执行步骤 */
  steps?: AgentStep[];

  /** 错误信息 */
  error?: string;

  /** 执行时间（毫秒） */
  executionTime?: number;
}

/**
 * Agent 执行步骤
 */
export interface AgentStep {
  /** 步骤名称 */
  name: string;

  /** 步骤类型 */
  type: "thought" | "action" | "observation";

  /** 内容 */
  content: string;

  /** 时间戳 */
  timestamp: Date;
}

// ==================== 团队能力类型 ====================

/**
 * 团队类型
 */
export type TeamType = "research" | "debate" | "review" | "report" | "custom";

/**
 * 协作模式
 */
export type CollaborationMode = "sequential" | "parallel" | "debate";

/**
 * 团队配置
 */
export interface TeamConfig {
  /** Leader Agent 配置 */
  leader?: {
    role: string;
    systemPrompt?: string;
  };

  /** Member Agent 配置列表 */
  members?: Array<{
    role: string;
    systemPrompt?: string;
    tools?: string[];
  }>;

  /** 协作模式 */
  collaborationMode?: CollaborationMode;

  /** 约束配置 */
  constraints?: ConstraintConfig;
}

/**
 * 任务输入
 */
export interface MissionInput {
  /** 任务目标 */
  goal: string;

  /** 上下文信息 */
  context?: string;

  /** 用户 ID */
  userId?: string;

  /** 会话 ID */
  sessionId?: string;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 任务结果
 */
export interface MissionResult {
  /** 是否成功 */
  success: boolean;

  /** 输出内容 */
  output: unknown;

  /** 执行摘要 */
  summary?: string;

  /** 错误信息 */
  error?: string;

  /** 执行时间（毫秒） */
  executionTime?: number;

  /** 使用的 token 数 */
  tokensUsed?: number;
}

/**
 * 进度回调
 */
export type ProgressCallback = (progress: MissionProgress) => void;

/**
 * 任务进度
 */
export interface MissionProgress {
  /** 任务 ID */
  missionId: string;

  /** 阶段 */
  phase: string;

  /** 进度（0-100） */
  progress: number;

  /** 消息 */
  message: string;

  /** 附加数据 */
  data?: unknown;
}

// ==================== 上下文能力类型 ====================

/**
 * 上下文源类型
 */
export type ContextSourceType =
  | "topic"
  | "resource"
  | "memory"
  | "search"
  | "custom";

/**
 * 上下文源
 */
export interface ContextSource {
  /** 源类型 */
  type: ContextSourceType;

  /** 源 ID */
  id?: string;

  /** 直接内容 */
  content?: string;

  /**
   * 预查询的业务数据（推荐使用）
   * - type="topic": ResearchTopic with dimensions
   * - type="resource": Resource
   * 如果提供，buildContext() 将使用此数据而非通过 Prisma 查询
   * 这样可以避免 AI Engine 层依赖 AI App 层的业务模型
   */
  data?: unknown;

  /** 权重（用于优先级） */
  weight?: number;
}

/**
 * 构建上下文请求
 */
export interface BuildContextRequest {
  /** 上下文源列表 */
  sources: ContextSource[];

  /** 最大 token 数 */
  maxTokens?: number;

  /** 是否压缩 */
  compress?: boolean;
}

// ==================== 约束能力类型 ====================

/**
 * 约束类型
 */
export type ConstraintType = "token_limit" | "content_filter" | "json_schema";

/**
 * 约束配置
 */
export interface ConstraintConfig {
  /** 最大 token 数 */
  maxTokens?: number;

  /** 最大执行时间（毫秒） */
  maxExecutionTime?: number;

  /** 内容过滤规则 */
  contentFilter?: {
    enabled: boolean;
    rules?: string[];
  };

  /** JSON Schema 验证 */
  jsonSchema?: object;
}

/**
 * 约束检查结果
 */
export interface ConstraintResult {
  /** 是否通过 */
  passed: boolean;

  /** 违规列表 */
  violations?: Array<{
    type: ConstraintType;
    message: string;
  }>;

  /** 调整后的内容（如果有） */
  adjustedContent?: string;
}

// ==================== 模型选择类型 ====================

/**
 * 模型信息
 */
export interface ModelInfo {
  /** 模型 ID (modelId 字段) */
  id: string;

  /** 数据库主键 ID */
  dbId?: string;

  /** 显示名称 */
  name: string;

  /** 提供商 */
  provider: string;

  /** 是否为推理模型 */
  isReasoning?: boolean;

  /** 是否可用 */
  isAvailable?: boolean;

  /** 最大 token 数 */
  maxTokens?: number;

  /** UI 显示图标 */
  icon?: string | null;

  /** 是否默认模型 */
  isDefault?: boolean;
}

/**
 * 模型选择选项
 */
export interface ModelSelectionOptions {
  /** 模型类型 */
  modelType?: AIModelType;

  /** 是否需要推理能力 */
  requireReasoning?: boolean;

  /** 首选提供商 */
  preferredProvider?: string;

  /** 最小 maxTokens */
  minMaxTokens?: number;

  /**
   * BYOK v2：候选 provider 白名单。仅从这些 provider 的模型中挑选。
   * 用于避免「用户只配了 OpenAI Key，但模型路由选中了 Claude」。
   * - undefined：不过滤（管理员场景或后台任务）
   * - []：没有可用 provider（调用方应该在更上层提前报错）
   */
  availableProviders?: string[];
}

// ==================== Agent 执行类型 ====================

/**
 * Agent 执行请求
 */
export interface AgentExecutionRequest {
  /** Agent 类型或 ID */
  agentType: string;

  /** 任务描述 */
  task: string;

  /** 系统提示词 */
  systemPrompt?: string;

  /** 上下文信息 */
  context?: string;

  /** 使用的模型 */
  model?: string;

  /** 任务画像 */
  taskProfile?: TaskProfile;

  /** 执行配置 */
  config?: {
    maxTokens?: number;
    temperature?: number;
    enableSearch?: boolean;
    maxRetries?: number;
    timeout?: number;
  };

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Agent 执行结果
 */
export interface AgentExecutionResult {
  /** 是否成功 */
  success: boolean;

  /** 输出内容 */
  content: string;

  /** Token 使用量 */
  tokensUsed: number;

  /** 执行耗时（毫秒） */
  duration: number;

  /** 错误信息 */
  error?: string;

  /** 是否可重试 */
  retryable?: boolean;

  /** 搜索结果（如果启用） */
  searchResults?: Array<{ title: string; url: string; snippet: string }>;
}

// ==================== Tool 执行类型 ====================

/**
 * Tool 执行请求
 */
export interface ToolExecutionRequest {
  /** 工具 ID */
  toolId: string;

  /** 工具输入参数 */
  input: Record<string, unknown>;

  /** 执行上下文 */
  context?: {
    userId?: string;
    sessionId?: string;
    workspaceId?: string;
  };

  /** 超时时间（毫秒） */
  timeout?: number;
}

/**
 * Tool 执行结果
 */
export interface ToolExecutionResult<T = unknown> {
  /** 是否成功 */
  success: boolean;

  /** 返回数据 */
  data?: T;

  /** 错误信息 */
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };

  /** 执行元数据 */
  metadata: {
    executionId: string;
    duration: number;
    tokensUsed?: number;
  };
}

/**
 * 工具信息
 */
export interface ToolInfo {
  /** 工具 ID */
  id: string;

  /** 工具名称 */
  name: string;

  /** 工具描述 */
  description: string;

  /** 工具类别 */
  category: string;

  /** 是否启用 */
  enabled: boolean;

  /** 标签 */
  tags?: string[];
}

// ==================== 记忆能力类型 ====================

/**
 * 记忆类型
 */
export type MemoryType = "short" | "long";

/**
 * 存储记忆请求
 */
export interface StoreMemoryRequest {
  /** 会话 ID */
  sessionId: string;

  /** 内容 */
  content: string;

  /** 记忆类型 */
  type: MemoryType;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 检索记忆请求
 */
export interface RetrieveMemoryRequest {
  /** 会话 ID */
  sessionId: string;

  /** 查询（用于相关性检索） */
  query?: string;

  /** 返回数量 */
  topK?: number;
}

/**
 * 记忆项
 */
export interface MemoryItem {
  /** ID */
  id: string;

  /** 内容 */
  content: string;

  /** 记忆类型 */
  type: MemoryType;

  /** 相关性分数 */
  score?: number;

  /** 创建时间 */
  createdAt: Date;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ==================== 结构化输出类型 ====================

/**
 * JSON Schema 定义（简化版）
 */
export interface JsonSchemaDefinition {
  type: "object" | "array" | "string" | "number" | "boolean";
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  items?: JsonSchemaProperty;
  description?: string;
  /** OpenAI Structured Outputs: object schema must declare additionalProperties: false */
  additionalProperties?: boolean | JsonSchemaProperty;
}

export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  default?: unknown;
  /** OpenAI Structured Outputs: object schema must declare additionalProperties: false */
  additionalProperties?: boolean | JsonSchemaProperty;
}

/**
 * 结构化输出请求
 */
export interface StructuredChatRequest extends ChatRequest {
  /** JSON Schema 描述期望的输出结构 */
  schema: JsonSchemaDefinition;

  /** 解析失败时是否抛出异常（默认 true） */
  throwOnParseError?: boolean;

  /** 最大重试次数（JSON 解析失败时自动重试，默认 1） */
  maxRetries?: number;
}

/**
 * 结构化输出响应
 */
export interface StructuredChatResponse<T> {
  /** 类型安全的解析结果 */
  data: T;

  /** 原始响应文本 */
  rawContent: string;

  /** 使用的模型 */
  model: string;

  /** 使用的 token 数 */
  tokensUsed: number;

  /** 是否在重试后成功 */
  retriedParse: boolean;
}

// ==================== 研究能力类型（Late Registration） ====================

/**
 * 直接研究请求参数
 * ★ 由 ai-app/research 的 DiscussionResearchService 实现
 *   通过 AIFacade.registerResearchExecutor() 注册
 */
export interface DirectResearchParams {
  query: string;
  depth?: "quick" | "standard" | "deep";
  language?: string;
  dimensions?: string[];
  onProgress?: (stage: string, percent: number, message: string) => void;
}

/**
 * 直接研究结果
 * 结构与 ai-app/research/discussion/types.ts 对齐，但独立定义避免反向依赖
 */
export interface DirectResearchResult {
  report: {
    executiveSummary: string;
    sections: Array<{
      title: string;
      content: string;
      citations: number[];
    }>;
    conclusion: string;
    references: Array<{
      id: number;
      title: string;
      url: string;
      snippet: string;
      accessedAt: Date;
    }>;
    metadata: {
      totalSources: number;
      totalTokens: number;
      duration: number;
      searchRounds: number;
    };
  };
  searchRounds: Array<{
    round: number;
    stepId: string;
    query: string;
    resultsCount: number;
    sources: Array<{
      id: string;
      title: string;
      url: string;
      snippet: string;
      domain: string;
      publishedDate?: string;
      relevanceScore: number;
    }>;
    timestamp: Date;
  }>;
  duration: number;
}

/**
 * 研究能力执行器接口
 * ★ AI App 层实现此接口，通过 onModuleInit 注册到 Facade
 */
export interface IDirectResearchExecutor {
  executeDirectResearch(
    params: DirectResearchParams,
  ): Promise<DirectResearchResult>;
}

// ==================== 工具类别类型 ====================

/**
 * 工具类别
 */
export type ToolCategory =
  | "information"
  | "generation"
  | "processing"
  | "execution"
  | "integration"
  | "memory"
  | "export"
  | "collaboration";

// ==================== Re-exports for AI App consumption ====================
// Eliminates direct AI Engine internal imports from AI App modules

export {
  BUILTIN_TOOLS,
  type BuiltinToolId,
} from "@/modules/ai-harness/agents/abstractions/agent.types";
export type { AICapabilityContext } from "../../../ai-harness/runner/capabilities/ai-capability-resolver.service";
export type {
  ExecutionConfig,
  AgentEvent,
} from "../../../ai-harness/runner/executor/function-calling-executor";
