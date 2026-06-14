/**
 * AI Engine - LLM Adapter Interface
 * LLM 适配器接口定义
 */

/**
 * LLM 消息角色
 */
export type LLMMessageRole = "system" | "user" | "assistant" | "tool";

/**
 * LLM 消息
 */
export interface LLMMessage {
  role: LLMMessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
}

/**
 * LLM 工具调用
 */
export interface LLMToolCall {
  id: string;
  type: "function";
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * LLM 工具定义
 */
export interface LLMToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * LLM 请求选项
 */
export interface LLMRequestOptions {
  /**
   * 消息列表
   */
  messages: LLMMessage[];

  /**
   * 模型 ID
   */
  model?: string;

  /**
   * 温度参数 (0-2)
   */
  temperature?: number;

  /**
   * 最大 token 数
   */
  maxTokens?: number;

  /**
   * Top-P 采样
   */
  topP?: number;

  /**
   * 停止序列
   */
  stopSequences?: string[];

  /**
   * 可用工具
   */
  tools?: LLMToolDefinition[];

  /**
   * 工具选择策略
   */
  toolChoice?: "auto" | "none" | "required" | { name: string };

  /**
   * 响应格式
   */
  responseFormat?: "text" | "json" | { type: "json_schema"; schema: unknown };

  /**
   * 流式输出
   */
  stream?: boolean;

  /**
   * 任务配置（推荐使用，AI Engine 自动映射参数）
   */
  taskProfile?: import("../types").TaskProfile;

  /**
   * 用户 ID (用于追踪)
   */
  userId?: string;

  /**
   * 请求超时 (ms)
   */
  timeout?: number;

  /**
   * 元数据
   */
  metadata?: Record<string, unknown>;
}

/**
 * LLM 响应
 */
export interface LLMResponse {
  /**
   * 响应 ID
   */
  id: string;

  /**
   * 响应内容
   */
  content: string | null;

  /**
   * 工具调用
   */
  toolCalls?: LLMToolCall[];

  /**
   * 完成原因
   */
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | null;

  /**
   * 使用量统计
   */
  usage?: LLMUsage;

  /**
   * 模型 ID
   */
  model: string;

  /**
   * 创建时间
   */
  createdAt: Date;
}

/**
 * LLM 使用量
 */
export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * LLM 流式响应块
 */
export interface LLMStreamChunk {
  /**
   * 响应 ID
   */
  id: string;

  /**
   * 内容增量
   */
  delta: {
    content?: string;
    toolCalls?: Partial<LLMToolCall>[];
  };

  /**
   * 完成原因
   */
  finishReason?: "stop" | "length" | "tool_calls" | "content_filter" | null;

  /**
   * 使用量 (最后一个块)
   */
  usage?: LLMUsage;
}

/**
 * LLM 适配器接口
 */
export interface ILLMAdapter {
  /**
   * 适配器 ID
   */
  readonly id: string;

  /**
   * 适配器名称
   */
  readonly name: string;

  /**
   * 支持的模型
   */
  readonly supportedModels: string[];

  /**
   * 默认模型
   */
  readonly defaultModel: string;

  /**
   * 聊天完成
   */
  chat(options: LLMRequestOptions): Promise<LLMResponse>;

  /**
   * 流式聊天完成
   */
  chatStream?(options: LLMRequestOptions): AsyncGenerator<LLMStreamChunk, void>;

  /**
   * 计算 token 数 (估算)
   */
  countTokens?(text: string): number;

  /**
   * 检查模型是否支持
   */
  supportsModel(model: string): boolean;

  /**
   * 获取模型配置
   */
  getModelConfig(
    model: string,
  ): LLMModelConfig | undefined | Promise<LLMModelConfig | undefined>;
}

/**
 * LLM 模型配置
 */
export interface LLMModelConfig {
  id: string;
  name: string;
  maxTokens: number;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

/**
 * 内置 LLM 提供商
 */
export const LLM_PROVIDERS = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GOOGLE: "google",
  XAI: "xai",
  GROK: "grok",
  DEEPSEEK: "deepseek",
  LOCAL: "local",
} as const;

export type LLMProvider = (typeof LLM_PROVIDERS)[keyof typeof LLM_PROVIDERS];

/**
 * 内置模型常量
 */
export const LLM_MODELS = {
  // OpenAI
  GPT4O: "gpt-4o",
  GPT4O_MINI: "gpt-4o-mini",
  GPT4_TURBO: "gpt-4-turbo",
  O1: "o1",
  O1_MINI: "o1-mini",

  // Anthropic
  CLAUDE_35_SONNET: "claude-3-5-sonnet-20241022",
  CLAUDE_35_HAIKU: "claude-3-5-haiku-20241022",
  CLAUDE_3_OPUS: "claude-3-opus-20240229",

  // Google
  GEMINI_PRO: "gemini-pro",
  GEMINI_PRO_VISION: "gemini-pro-vision",

  // xAI
  GROK_2: "grok-2-1212",
  GROK_2_VISION: "grok-2-vision-1212",

  // DeepSeek
  DEEPSEEK_CHAT: "deepseek-chat",
  DEEPSEEK_REASONER: "deepseek-reasoner",
} as const;

export type LLMModel = (typeof LLM_MODELS)[keyof typeof LLM_MODELS] | string;
