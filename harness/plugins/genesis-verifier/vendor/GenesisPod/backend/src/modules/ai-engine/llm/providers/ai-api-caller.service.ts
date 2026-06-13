import { Injectable } from "@nestjs/common";
import type { ChatMessage } from "../types/task-profile.types";
import type { FunctionDefinition } from "../../tools/abstractions/tool.interface";
import type { StructuredOutputStrategy } from "../output/structured/structured-output-strategy.types";
import { OpenaiCaller } from "./openai-caller";
import { AnthropicCaller } from "./anthropic-caller";
import { CohereCaller } from "./cohere-caller";
import { GoogleCaller } from "./google-caller";
import { XaiCaller } from "./xai-caller";
import type {
  ChatCompletionResult,
  EmbeddingApiResult,
} from "./base-http-caller";

export type {
  ChatCompletionResult,
  EmbeddingApiResult,
} from "./base-http-caller";

/**
 * AI API 调用服务
 * 负责：调用各个 provider 的 API（OpenAI、Anthropic、Google、XAI）
 *
 * 2026-06：本类已拆为 thin delegation facade —— 每个 provider 的实际调用逻辑
 * 抽到 `api-callers/` 下的 per-provider caller（OpenaiCaller / AnthropicCaller /
 * CohereCaller / GoogleCaller / XaiCaller），共享逻辑在 BaseHttpCaller。本 facade
 * 保留全部 public 方法签名不变，仅一行 delegation 转发到对应 caller，调用方无感。
 */
@Injectable()
export class AiApiCallerService {
  constructor(
    private readonly openaiCaller: OpenaiCaller,
    private readonly anthropicCaller: AnthropicCaller,
    private readonly cohereCaller: CohereCaller,
    private readonly googleCaller: GoogleCaller,
    private readonly xaiCaller: XaiCaller,
  ) {}

  /**
   * 调用 OpenAI 兼容格式的 API（OpenAI, Azure, 各种代理服务）
   * ★ 数据库驱动：使用 tokenParamName 配置决定 token 参数名
   */
  async callOpenAICompatibleAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    messages: ChatMessage[],
    maxTokens: number,
    temperature?: number,
    timeout: number = 120000,
    tokenParamName: string = "max_tokens",
    responseFormat?: string,
    reasoningDepth?: string,
    outputSchema?: { type: string; schema: Record<string, unknown> },
    schemaStrict?: boolean,
    isReasoning: boolean = false,
    structuredOutputStrategy?: StructuredOutputStrategy,
    outputJsonSchema?: Record<string, unknown>,
    schemaName?: string,
    tools?: FunctionDefinition[],
    /**
     * v3.1 §A：provider slug（与 AIModelConfig.provider 同语义）。
     * 用于通过 ModelCapabilityService.resolveCapabilities 判定模型是否拒绝
     * response_format（替代删除的 isDeepseekReasoner substring 反模式）。
     * 缺省 = "" → 保留 response_format（向后兼容旧调用方）。
     */
    provider: string = "",
    /** v3.1 §B+.3：BYOK userModelConfigId，catch 触发 self-heal；缺省 = 不触发。 */
    userModelConfigId?: string,
  ): Promise<ChatCompletionResult> {
    return this.openaiCaller.callOpenAICompatibleAPI(
      apiEndpoint,
      apiKey,
      modelId,
      messages,
      maxTokens,
      temperature,
      timeout,
      tokenParamName,
      responseFormat,
      reasoningDepth,
      outputSchema,
      schemaStrict,
      isReasoning,
      structuredOutputStrategy,
      outputJsonSchema,
      schemaName,
      tools,
      provider,
      userModelConfigId,
    );
  }

  /**
   * 调用 Anthropic Claude API
   */
  async callAnthropicAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    messages: ChatMessage[],
    maxTokens: number,
    temperature?: number,
    timeout: number = 120000,
    responseFormat?: string,
    _reasoningDepth?: string,
    cachePolicy?: string,
    structuredOutputStrategy?: StructuredOutputStrategy,
    outputJsonSchema?: Record<string, unknown>,
    schemaName?: string,
    /** v3.1 §B+.3：BYOK userModelConfigId，catch 触发 self-heal；缺省 = 不触发。 */
    userModelConfigId?: string,
  ): Promise<ChatCompletionResult> {
    return this.anthropicCaller.callAnthropicAPI(
      apiEndpoint,
      apiKey,
      modelId,
      messages,
      maxTokens,
      temperature,
      timeout,
      responseFormat,
      _reasoningDepth,
      cachePolicy,
      structuredOutputStrategy,
      outputJsonSchema,
      schemaName,
      userModelConfigId,
    );
  }

  /**
   * 调用 Cohere v2 Chat API（POST /v2/chat）。
   *
   * Cohere v2 chat 非 OpenAI-compatible：请求用 messages[]（role 同 OpenAI），
   * 但响应 message.content 是 content block 数组（[{type:"text",text}]），
   * usage 在 usage.tokens.{input,output}_tokens，finish_reason 为 COMPLETE/MAX_TOKENS。
   * 故单列 caller，不能复用 callOpenAICompatibleAPI（之前 cohere 落到 default 分支
   * 走 OpenAI 格式 → 响应解析失败，是「能发现/能配但运行时必挂」的假动态根因）。
   *
   * 首版聚焦文本对话：tool calling / native structured-output 暂不实现（responseFormat
   * ==="json" 时启用 Cohere 原生 json_object；其余结构化策略降级为 system prompt 约束）。
   */
  async callCohereAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    messages: ChatMessage[],
    maxTokens: number,
    temperature?: number,
    timeout: number = 120000,
    responseFormat?: string,
    // L2 fix：之前只转发 responseFormat，丢了 structuredOutputStrategy/schema →
    // schema/strategy 结构化请求在 Cohere 上变成无约束自由文本。下面接 prompt 兜底。
    structuredOutputStrategy?: StructuredOutputStrategy,
    outputJsonSchema?: Record<string, unknown>,
    schemaName?: string,
  ): Promise<ChatCompletionResult> {
    return this.cohereCaller.callCohereAPI(
      apiEndpoint,
      apiKey,
      modelId,
      messages,
      maxTokens,
      temperature,
      timeout,
      responseFormat,
      structuredOutputStrategy,
      outputJsonSchema,
      schemaName,
    );
  }

  /**
   * 调用 Google Gemini API
   */
  async callGoogleAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    messages: ChatMessage[],
    maxTokens: number,
    temperature?: number,
    timeout: number = 120000,
    responseFormat?: string,
    _reasoningDepth?: string,
    structuredOutputStrategy?: StructuredOutputStrategy,
    outputJsonSchema?: Record<string, unknown>,
    schemaName?: string,
    /** v3.1 §B+.3：BYOK userModelConfigId，catch 触发 self-heal；缺省 = 不触发。 */
    userModelConfigId?: string,
  ): Promise<ChatCompletionResult> {
    return this.googleCaller.callGoogleAPI(
      apiEndpoint,
      apiKey,
      modelId,
      messages,
      maxTokens,
      temperature,
      timeout,
      responseFormat,
      _reasoningDepth,
      structuredOutputStrategy,
      outputJsonSchema,
      schemaName,
      userModelConfigId,
    );
  }

  /**
   * 调用 xAI (Grok) API
   */
  async callXAIAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    messages: ChatMessage[],
    maxTokens: number,
    temperature?: number,
    timeout: number = 120000,
    tokenParamName: string = "max_tokens",
    responseFormat?: string,
    _reasoningDepth?: string,
    outputSchema?: { type: string; schema: Record<string, unknown> },
    schemaStrict?: boolean,
    isReasoning: boolean = false,
    structuredOutputStrategy?: StructuredOutputStrategy,
    outputJsonSchema?: Record<string, unknown>,
    schemaName?: string,
    tools?: FunctionDefinition[],
    /** v3.1 §B.5：BYOK 路径传 user_model_config.id；catch 触发 self-heal。缺省 → 不触发。 */
    userModelConfigId?: string,
  ): Promise<ChatCompletionResult> {
    return this.xaiCaller.callXAIAPI(
      apiEndpoint,
      apiKey,
      modelId,
      messages,
      maxTokens,
      temperature,
      timeout,
      tokenParamName,
      responseFormat,
      _reasoningDepth,
      outputSchema,
      schemaStrict,
      isReasoning,
      structuredOutputStrategy,
      outputJsonSchema,
      schemaName,
      tools,
      userModelConfigId,
    );
  }

  // ==================== Embedding API Methods ====================

  /**
   * 调用 OpenAI 兼容格式的 Embedding API（OpenAI, xAI, DeepSeek 等）
   * POST {endpoint}/embeddings, Bearer auth
   *
   * ★ 2026-05-12: 加 options.dimensions —— OpenAI text-embedding-3-* 的
   *   Matryoshka 维度截断。其他兼容 provider 不支持的字段会被忽略。
   * ★ 2026-05-12: 429 时读 Retry-After header，包装到 error message 让外层
   *   节流用更精确的 cooldown（fallback 60s 是粗估）。
   */
  async callOpenAICompatibleEmbeddingAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    inputs: string[],
    timeout: number = 60000,
    options?: { dimensions?: number },
  ): Promise<EmbeddingApiResult> {
    return this.openaiCaller.callOpenAICompatibleEmbeddingAPI(
      apiEndpoint,
      apiKey,
      modelId,
      inputs,
      timeout,
      options,
    );
  }

  /**
   * 调用 Google 原生 Embedding API
   * POST {baseUrl}/models/{model}:batchEmbedContents, x-goog-api-key header
   *
   * ★ 2026-05-12: 加 options.taskType —— Gemini gemini-embedding-001 必须按
   *   task 区分编码，document 与 query 用不同向量空间。不传 → 默认
   *   RETRIEVAL_DOCUMENT（最常见：向量化 KB chunk）。
   *   不区分会让检索召回率掉 5-15%。
   * ★ 2026-05-12: 加 options.dimensions —— gemini-embedding-001 Matryoshka 支持
   *   768/1536/3072 输出。
   */
  async callGoogleEmbeddingAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    inputs: string[],
    timeout: number = 60000,
    options?: { taskType?: string; dimensions?: number },
  ): Promise<EmbeddingApiResult> {
    return this.googleCaller.callGoogleEmbeddingAPI(
      apiEndpoint,
      apiKey,
      modelId,
      inputs,
      timeout,
      options,
    );
  }

  /**
   * 调用 Cohere Embedding API
   * POST {endpoint}/embed, Bearer auth, input_type: "search_document"
   *
   * ★ 2026-05-12: 默认 search_document，caller 应按场景传 search_query
   *   （查询侧），不区分会让检索召回率掉 5-15%。
   */
  async callCohereEmbeddingAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    inputs: string[],
    inputType: string = "search_document",
    timeout: number = 60000,
  ): Promise<EmbeddingApiResult> {
    return this.cohereCaller.callCohereEmbeddingAPI(
      apiEndpoint,
      apiKey,
      modelId,
      inputs,
      inputType,
      timeout,
    );
  }
}
