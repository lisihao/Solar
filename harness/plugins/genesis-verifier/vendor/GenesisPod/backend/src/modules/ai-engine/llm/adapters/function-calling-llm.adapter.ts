/**
 * AI Engine - Function Calling LLM Adapter
 * 支持 Function Calling 的 LLM 适配器
 *
 * 用于与 FunctionCallingExecutor 配合使用
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
// 直接 import 协议接口（避免依赖 fc-executor，让 fc-executor 可搬 harness）
import type {
  ILLMAdapter as FunctionCallingILLMAdapter,
  LLMMessage,
  LLMRequestOptions,
  LLMResponse,
  ToolCallRequest,
} from "../abstractions/function-calling-protocol";
import { FunctionDefinition } from "../../tools/abstractions/tool.interface";
import { AiChatService, ChatMessage } from "../chat/ai-chat.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/facade";
import { KeyResolverService } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.service";
import { NoAvailableKeyError } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.errors";

/**
 * Function Calling LLM 适配器配置
 */
export interface FunctionCallingLLMAdapterConfig {
  /**
   * AI Member ID (用于获取模型配置)
   */
  aiMemberId?: string;

  /**
   * Workspace/Topic ID (用于上下文)
   */
  workspaceId?: string;

  /**
   * Provider 覆盖 (可选)
   */
  provider?: string;

  /**
   * Model ID 覆盖 (可选)
   */
  modelId?: string;

  /**
   * API Key 覆盖 (可选)
   */
  apiKey?: string;

  /**
   * API Endpoint 覆盖 (可选)
   */
  apiEndpoint?: string;

  /**
   * 调用上下文用户 ID（BYOK 解析所需）。
   *
   * 强 BYOK：apiKey 由 KeyResolver 按 userId+provider 解析（PERSONAL → ASSIGNED → throw）。
   * 不传 userId 时仅退化为 SYSTEM Secret 路径，仅供 background cron / health check 使用，
   * 业务调用方（如 AI Teams）必须传 senderId/ownerId。
   */
  userId?: string;
}

/**
 * Function Calling LLM Adapter
 *
 * 复用 AiChatService 的能力，支持多 Provider 的 Function Calling
 * 实现 FunctionCallingExecutor 所需的 ILLMAdapter 接口
 */
@Injectable()
export class FunctionCallingLLMAdapter implements FunctionCallingILLMAdapter {
  private readonly logger = new Logger(FunctionCallingLLMAdapter.name);
  readonly provider: string = "openai"; // 默认使用 OpenAI 格式

  private config?: FunctionCallingLLMAdapterConfig;

  constructor(
    private readonly aiChatService: AiChatService,
    private readonly prisma: PrismaService,
    private readonly secretsService: SecretsService,
    @Optional() private readonly keyResolver?: KeyResolverService,
  ) {}

  /**
   * 统一 apiKey 解析（BYOK 单源 + cron 兜底）
   *
   * 顺序：
   * 1. 有 userId → KeyResolver.resolveKey(userId, provider)
   *    PERSONAL → ASSIGNED → throw NoAvailableKeyError(provider)
   * 2. 无 userId（background cron / health check）→ 经 SecretsService 解 SYSTEM Secret
   *
   * 已删除：model.apiKey 明文列回读 + getApiKeyFromEnv 环境变量旁路。
   * 强 BYOK 边界由本函数收口。
   */
  private async resolveApiKeyForProvider(
    provider: string,
    secretKey: string | null,
  ): Promise<{ apiKey: string; apiEndpoint?: string | null }> {
    const userId = this.config?.userId;
    if (userId && this.keyResolver) {
      const resolved = await this.keyResolver.resolveKey(userId, provider);
      return { apiKey: resolved.apiKey, apiEndpoint: resolved.apiEndpoint };
    }
    if (secretKey) {
      const secretValue = await this.secretsService.getValueInternal(secretKey);
      if (secretValue) {
        return { apiKey: secretValue.trim() };
      }
      this.logger.warn(
        `[resolveApiKeyForProvider] Secret '${secretKey}' not found and no userId for BYOK resolution`,
      );
    }
    throw new NoAvailableKeyError(provider);
  }

  /**
   * 设置适配器配置
   */
  setConfig(config: FunctionCallingLLMAdapterConfig): void {
    this.config = config;
    this.logger.debug(
      `[setConfig] Configured: aiMemberId=${config.aiMemberId}, workspaceId=${config.workspaceId}`,
    );
  }

  /**
   * 获取当前配置
   */
  getConfig(): FunctionCallingLLMAdapterConfig | undefined {
    return this.config;
  }

  /**
   * 格式化工具定义为 OpenAI tools 格式
   */
  formatTools(
    functions: FunctionDefinition[],
  ): Array<{ type: "function"; function: FunctionDefinition }> {
    return functions.map((fn) => ({
      type: "function" as const,
      function: fn,
    }));
  }

  /**
   * 解析工具调用 (OpenAI 格式)
   */
  parseToolCalls(response: LLMResponse): ToolCallRequest[] {
    const toolCalls: ToolCallRequest[] = [];

    // OpenAI 新格式 (tool_calls)
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const call of response.tool_calls) {
        toolCalls.push({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
    }

    // OpenAI 旧格式 (function_call) - 兼容
    if (response.function_call) {
      toolCalls.push({
        id: `call_${Date.now()}`,
        name: response.function_call.name,
        arguments: response.function_call.arguments,
      });
    }

    return toolCalls;
  }

  /**
   * 构建工具结果消息 (OpenAI 格式)
   */
  buildToolResultMessage(
    toolCallId: string,
    toolName: string,
    result: unknown,
  ): LLMMessage {
    return {
      role: "tool",
      content: typeof result === "string" ? result : JSON.stringify(result),
      tool_call_id: toolCallId,
      name: toolName,
    };
  }

  /**
   * 执行 Chat Completion
   *
   * ★ 支持 TaskProfile 语义化参数映射
   */
  async chat(options: LLMRequestOptions): Promise<LLMResponse> {
    const {
      messages,
      functions,
      temperature,
      maxTokens,
      model,
      taskProfile, // ★ 提取 TaskProfile
    } = options;

    this.logger.debug(
      `[chat] Calling with ${messages.length} messages, ${functions?.length || 0} functions, taskProfile: ${JSON.stringify(taskProfile)}`,
    );

    // 获取 LLM 配置
    const llmConfig = await this.resolveLLMConfig();

    // 转换消息格式
    const chatMessages: ChatMessage[] = messages.map((m) =>
      this.convertLLMMessageToChatMessage(m),
    );

    // 构建请求参数
    interface RequestParams {
      provider: string;
      modelId: string;
      apiKey: string;
      apiEndpoint?: string;
      messages: ChatMessage[];
      taskProfile: typeof taskProfile;
      maxTokens?: number;
      temperature?: number;
      systemPrompt?: string;
      // ★ RAW FunctionDefinition[]，不预包成 {type,function}。下游 callXAIAPI /
      // callOpenAICompatibleAPI 会用 buildOpenAICompatibleTools 统一包一次。
      tools?: FunctionDefinition[];
      tool_choice?: string | { type: string; function: { name: string } };
    }

    const requestParams: RequestParams = {
      provider: this.config?.provider || llmConfig.provider,
      modelId: this.config?.modelId || model || llmConfig.modelId,
      apiKey: this.config?.apiKey || llmConfig.apiKey,
      apiEndpoint: this.config?.apiEndpoint || llmConfig.apiEndpoint,
      messages: chatMessages,
      // ★ 传递 TaskProfile，让 AI Engine 处理参数映射
      taskProfile,
      // 直接参数（优先级高于 TaskProfile）
      maxTokens,
      temperature,
    };

    // 添加系统提示词 (从第一条系统消息中提取)
    const systemMessage = messages.find((m) => m.role === "system");
    if (systemMessage?.content) {
      requestParams.systemPrompt = systemMessage.content;
    }

    // 如果有工具定义，添加 tools 参数
    if (functions && functions.length > 0) {
      // ★ 2026-05-21：传 RAW functions，不在此 formatTools 预包成 {type,function}。
      // 下游 callXAIAPI / callOpenAICompatibleAPI 会用 buildOpenAICompatibleTools
      // 统一包一次；这里再包就 double-wrap → tools[0].function 变成 {type,function}
      // 无 name → xAI 422 "tools[0]: missing field `name`"（Option A 把工具循环引到
      // callXAIAPI 后才暴露：此前 Path B 直接丢 tools，从没真正发出去）。
      requestParams.tools = functions;
      requestParams.tool_choice = options.tool_choice || "auto";
    }

    try {
      // 调用 AiChatService
      const result = await this.callAiChatServiceWithTools(requestParams);

      // 转换响应格式
      return this.convertToLLMResponse(result, requestParams.provider);
    } catch (error) {
      this.logger.error(`[chat] Failed to call AI service:`, error);
      throw error;
    }
  }

  /**
   * 调用 AiChatService (支持工具调用)
   *
   * ★ 统一通过 aiChatService.chat() 调用，支持 TaskProfile
   */
  private async callAiChatServiceWithTools(params: {
    provider: string;
    modelId: string;
    apiKey: string;
    apiEndpoint?: string;
    systemPrompt?: string;
    messages: ChatMessage[];
    maxTokens?: number;
    temperature?: number;
    taskProfile: unknown;
    // RAW FunctionDefinition[]（下游 buildOpenAICompatibleTools 统一包装）
    tools?: FunctionDefinition[];
    tool_choice?: string | { type: string; function: { name: string } };
  }): Promise<unknown> {
    const {
      provider,
      modelId,
      apiKey,
      apiEndpoint,
      systemPrompt,
      messages,
      maxTokens,
      temperature,
      taskProfile, // ★ 提取 TaskProfile
      tools,
      tool_choice,
    } = params;

    // ★ 2026-05-21：function calling 必须走 AiChatService 的 Standard 路径——
    // 它会把 tools 转发给 callXAIAPI，并按 userId 解析 BYOK key。传显式 apiKey 会强制
    // 进 Path B（AiDirectKeyService）：①根本不转发 tools（工具循环失效）；②给 xai
    // 无条件注入已废弃的 Live Search search_parameters → xAI 报 "Live search is
    // deprecated"。
    // 优先级：caller 显式 apiKey（连接测试 / 系统直连）> BYOK userId（Standard 路径，
    // 转发 tools）> 已解析的 apiKey（无 userId 的系统/cron 兜底）。
    const useByokUserId = !this.config?.apiKey && !!this.config?.userId;

    // ★ 调用 AiChatService.chat() - 统一入口
    return this.aiChatService.chat({
      provider,
      model: modelId,
      apiEndpoint,
      systemPrompt,
      messages,
      // ★ 传递 TaskProfile
      taskProfile,
      // 直接参数（优先级高于 TaskProfile）
      maxTokens,
      temperature,
      ...(useByokUserId ? { userId: this.config?.userId } : { apiKey }),
      ...(tools ? { tools, tool_choice } : {}),
    } as Parameters<typeof this.aiChatService.chat>[0]);
  }

  /**
   * 解析 LLM 配置
   */
  private async resolveLLMConfig(): Promise<{
    provider: string;
    modelId: string;
    apiKey: string;
    apiEndpoint?: string;
  }> {
    // 如果配置中有 aiMemberId，从数据库获取配置
    if (this.config?.aiMemberId) {
      return this.getAIMemberConfig();
    }

    // 显式配置的 modelId 路径：仅当 caller 显式给了 apiKey 时直用，否则走 BYOK
    if (this.config?.modelId) {
      const provider =
        this.config.provider || this.inferProvider(this.config.modelId);
      const apiEndpoint =
        this.config.apiEndpoint || this.getDefaultEndpoint(provider);
      if (this.config.apiKey) {
        return {
          provider,
          modelId: this.config.modelId,
          apiKey: this.config.apiKey,
          apiEndpoint,
        };
      }
      // ★ BYOK 单源：通过 KeyResolver 解析（PERSONAL → ASSIGNED → throw）
      const resolved = await this.resolveApiKeyForProvider(provider, null);
      return {
        provider,
        modelId: this.config.modelId,
        apiKey: resolved.apiKey,
        apiEndpoint: resolved.apiEndpoint ?? apiEndpoint,
      };
    }

    // 从数据库获取默认模型，apiKey 走 BYOK 单源（不再读 AIModel.apiKey 明文列）
    const defaultModel = await this.getDefaultModelFromDb();
    const provider =
      this.config?.provider || this.inferProvider(defaultModel.modelId);
    const fallbackEndpoint =
      this.config?.apiEndpoint ||
      defaultModel.apiEndpoint ||
      this.getDefaultEndpoint(provider);
    if (this.config?.apiKey) {
      return {
        provider,
        modelId: defaultModel.modelId,
        apiKey: this.config.apiKey,
        apiEndpoint: fallbackEndpoint,
      };
    }
    const resolved = await this.resolveApiKeyForProvider(
      provider,
      defaultModel.secretKey ?? null,
    );
    return {
      provider,
      modelId: defaultModel.modelId,
      apiKey: resolved.apiKey,
      apiEndpoint: resolved.apiEndpoint ?? fallbackEndpoint,
    };
  }

  /**
   * 从数据库获取默认模型（仅返回 modelId/provider/apiEndpoint/secretKey；
   * apiKey 不在此层读，由 resolveApiKeyForProvider 走 BYOK 单源解析）。
   */
  private async getDefaultModelFromDb(): Promise<{
    modelId: string;
    provider: string;
    apiEndpoint?: string;
    secretKey?: string | null;
  }> {
    const defaultModel = await this.prisma.aIModel.findFirst({
      where: {
        modelType: "CHAT",
        isDefault: true,
        isEnabled: true,
      },
      select: {
        modelId: true,
        provider: true,
        apiEndpoint: true,
        secretKey: true,
      },
    });

    if (defaultModel) {
      return {
        modelId: defaultModel.modelId,
        provider: defaultModel.provider,
        apiEndpoint: defaultModel.apiEndpoint ?? undefined,
        secretKey: defaultModel.secretKey,
      };
    }

    const anyModel = await this.prisma.aIModel.findFirst({
      where: {
        modelType: "CHAT",
        isEnabled: true,
      },
      select: {
        modelId: true,
        provider: true,
        apiEndpoint: true,
        secretKey: true,
      },
    });

    if (anyModel) {
      return {
        modelId: anyModel.modelId,
        provider: anyModel.provider,
        apiEndpoint: anyModel.apiEndpoint ?? undefined,
        secretKey: anyModel.secretKey,
      };
    }

    throw new Error(
      "No AI model configured in database. Please configure a CHAT model in Admin Console.",
    );
  }

  /**
   * 获取 AI Member 配置（apiKey 走 BYOK 单源，不再读 AIModel.apiKey 明文列）
   */
  private async getAIMemberConfig(): Promise<{
    provider: string;
    modelId: string;
    apiKey: string;
    apiEndpoint?: string;
  }> {
    if (!this.config?.aiMemberId) {
      throw new Error("FunctionCallingLLMAdapter: aiMemberId not configured");
    }

    const aiMember = await this.prisma.topicAIMember.findUnique({
      where: { id: this.config.aiMemberId },
      select: {
        aiModel: true,
        displayName: true,
      },
    });

    if (!aiMember) {
      throw new Error(`AI Member not found: ${this.config.aiMemberId}`);
    }

    let aiModelConfig = await this.prisma.aIModel.findFirst({
      where: {
        modelId: {
          equals: aiMember.aiModel,
          mode: "insensitive",
        },
        isEnabled: true,
      },
      select: {
        modelId: true,
        provider: true,
        secretKey: true,
        apiEndpoint: true,
      },
    });

    if (!aiModelConfig) {
      aiModelConfig = await this.prisma.aIModel.findFirst({
        where: {
          name: {
            equals: aiMember.aiModel,
            mode: "insensitive",
          },
          isEnabled: true,
        },
        select: {
          modelId: true,
          provider: true,
          secretKey: true,
          apiEndpoint: true,
        },
      });
    }

    const provider =
      aiModelConfig?.provider || this.inferProvider(aiMember.aiModel);
    const modelId = aiModelConfig?.modelId || aiMember.aiModel;
    const fallbackEndpoint =
      aiModelConfig?.apiEndpoint || this.getDefaultEndpoint(provider);

    // ★ BYOK 单源：apiKey 由 KeyResolver 按 userId+provider 解析；
    //   无 userId 时退化为 SYSTEM Secret 路径（仅供 background cron 使用）。
    const resolved = await this.resolveApiKeyForProvider(
      provider,
      aiModelConfig?.secretKey ?? null,
    );

    this.logger.debug(
      `[getAIMemberConfig] provider=${provider}, modelId=${modelId}, hasUserId=${!!this.config?.userId}`,
    );

    return {
      provider,
      modelId,
      apiKey: resolved.apiKey,
      apiEndpoint: resolved.apiEndpoint ?? fallbackEndpoint,
    };
  }

  /**
   * 从 Provider 推断默认 API Endpoint
   */
  private getDefaultEndpoint(provider: string): string {
    const lower = provider.toLowerCase();

    if (lower.includes("xai") || lower.includes("grok")) {
      return "https://api.x.ai/v1/chat/completions";
    }
    if (lower.includes("openai") || lower.includes("gpt")) {
      return "https://api.openai.com/v1/chat/completions";
    }
    if (lower.includes("anthropic") || lower.includes("claude")) {
      return "https://api.anthropic.com/v1/messages";
    }
    if (lower.includes("google") || lower.includes("gemini")) {
      return "https://generativelanguage.googleapis.com/v1beta/models";
    }

    return "";
  }

  /**
   * 从模型名称推断 Provider
   */
  private inferProvider(modelName: string): string {
    // ★ 模型名 → provider 的启发式：管理员把 modelId 起得有 provider 前缀就能识别。
    //   o-series / gpt-5+ 都属于 openai，无须再列具体型号（o4/o5/gpt-6 自动覆盖）。
    const lower = modelName.toLowerCase();

    if (lower.includes("grok")) return "xai";
    if (lower.includes("claude")) return "anthropic";
    if (lower.includes("gemini")) return "google";
    if (lower.includes("deepseek")) return "deepseek";
    if (lower.includes("gpt") || /^o\d/.test(lower)) return "openai";

    return "openai"; // 默认
  }

  /**
   * 转换 LLMMessage 到 ChatMessage
   */
  private convertLLMMessageToChatMessage(message: LLMMessage): ChatMessage {
    return {
      role:
        message.role === "system"
          ? "system"
          : message.role === "assistant"
            ? "assistant"
            : "user",
      content: message.content || "",
      name: message.name,
    };
  }

  /**
   * 转换 AiChatService 响应到 LLMResponse
   */
  private convertToLLMResponse(result: unknown, provider: string): LLMResponse {
    // 处理不同 Provider 的响应格式
    const lower = provider.toLowerCase();

    if (lower.includes("anthropic") || lower.includes("claude")) {
      return this.parseAnthropicResponse(result);
    }

    if (lower.includes("google") || lower.includes("gemini")) {
      return this.parseGoogleResponse(result);
    }

    // OpenAI 格式 (默认)
    return this.parseOpenAIResponse(result);
  }

  /**
   * 解析 OpenAI 响应
   *
   * ★ 支持 aiChatService.chat() 的新响应格式 (usage.totalTokens)
   */
  private parseOpenAIResponse(result: unknown): LLMResponse {
    const response = result as Record<string, unknown>;

    // AiChatService.chat() 返回的简化格式
    if (response.content !== undefined) {
      // ★ 处理两种响应格式：
      // - 旧格式: tokensUsed (from generateChatCompletion)
      // - 新格式: usage.totalTokens (from chat())
      const totalTokens =
        "tokensUsed" in response
          ? (response.tokensUsed as number)
          : ((response.usage as Record<string, unknown> | undefined)
              ?.totalTokens as number | undefined) || 0;

      return {
        content: response.content as string,
        usage: totalTokens
          ? {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens,
            }
          : undefined,
        model: response.model as string | undefined,
        finishReason:
          (response.finishReason as
            | "stop"
            | "length"
            | "function_call"
            | "tool_calls"
            | undefined) ?? "stop",
      };
    }

    // 原始 API 响应格式
    const choices = response.choices as
      | Array<Record<string, unknown>>
      | undefined;
    const choice = choices?.[0];
    const message = choice?.message as Record<string, unknown> | undefined;
    const usage = response.usage as Record<string, unknown> | undefined;

    return {
      content: (message?.content as string | null) || null,
      function_call: message?.function_call as
        | { name: string; arguments: string }
        | undefined,
      tool_calls: message?.tool_calls as
        | Array<{
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          }>
        | undefined,
      usage: usage
        ? {
            promptTokens: (usage.prompt_tokens as number | undefined) || 0,
            completionTokens:
              (usage.completion_tokens as number | undefined) || 0,
            totalTokens: (usage.total_tokens as number | undefined) || 0,
          }
        : undefined,
      model: response.model as string | undefined,
      finishReason: choice?.finish_reason as
        | "stop"
        | "length"
        | "function_call"
        | "tool_calls"
        | undefined,
    };
  }

  /**
   * 解析 Anthropic 响应
   */
  private parseAnthropicResponse(result: unknown): LLMResponse {
    const response = result as Record<string, unknown>;
    let content: string | null = null;
    const toolCalls: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }> = [];

    const contentBlocks = response.content as
      | Array<Record<string, unknown>>
      | undefined;
    if (contentBlocks && Array.isArray(contentBlocks)) {
      for (const block of contentBlocks) {
        if (block.type === "text") {
          content = (content || "") + (block.text as string);
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id as string,
            type: "function",
            function: {
              name: block.name as string,
              arguments: JSON.stringify(block.input),
            },
          });
        }
      }
    }

    const usage = response.usage as Record<string, unknown> | undefined;

    return {
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: usage
        ? {
            promptTokens: (usage.input_tokens as number | undefined) || 0,
            completionTokens: (usage.output_tokens as number | undefined) || 0,
            totalTokens:
              ((usage.input_tokens as number | undefined) || 0) +
              ((usage.output_tokens as number | undefined) || 0),
          }
        : undefined,
      model: response.model as string | undefined,
      finishReason:
        response.stop_reason === "tool_use"
          ? "tool_calls"
          : response.stop_reason === "max_tokens"
            ? "length"
            : ((response.finishReason as
                | "stop"
                | "length"
                | "function_call"
                | "tool_calls"
                | undefined) ?? "stop"),
    };
  }

  /**
   * 解析 Google 响应
   *
   * ★ 支持两种格式：
   * - 简化格式: AiChatService.chat() 返回的 { content, model, tokensUsed }
   * - 原始格式: Gemini API 原始响应 { candidates: [...] }
   */
  private parseGoogleResponse(result: unknown): LLMResponse {
    const response = result as Record<string, unknown>;

    // ★ 处理 AiChatService.chat() 返回的简化格式
    if (response.content !== undefined) {
      const totalTokens =
        "tokensUsed" in response
          ? (response.tokensUsed as number)
          : ((response.usage as Record<string, unknown> | undefined)
              ?.totalTokens as number | undefined) || 0;

      return {
        content: response.content as string,
        usage: totalTokens
          ? {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens,
            }
          : undefined,
        model: response.model as string | undefined,
        finishReason:
          (response.finishReason as
            | "stop"
            | "length"
            | "function_call"
            | "tool_calls"
            | undefined) ?? "stop",
      };
    }

    // 原始 Gemini API 响应格式
    const candidates = response.candidates as
      | Array<Record<string, unknown>>
      | undefined;
    const candidate = candidates?.[0];
    const candidateContent = candidate?.content as
      | Record<string, unknown>
      | undefined;
    const parts = candidateContent?.parts as
      | Array<Record<string, unknown>>
      | undefined;
    const content = (parts?.[0]?.text as string) || null;

    const usageMetadata = response.usageMetadata as
      | Record<string, unknown>
      | undefined;

    return {
      content,
      usage: usageMetadata
        ? {
            promptTokens:
              (usageMetadata.promptTokenCount as number | undefined) || 0,
            completionTokens:
              (usageMetadata.candidatesTokenCount as number | undefined) || 0,
            totalTokens:
              (usageMetadata.totalTokenCount as number | undefined) || 0,
          }
        : undefined,
      model: response.model as string | undefined,
      // ★ 2026-05-23 review-fix #4：原始 Gemini API 也要传播真实 finishReason
      //   （candidate.finishReason="MAX_TOKENS" → "length"），否则截断在裸 Gemini
      //   路径上仍然隐形（P1-engine 只修了 AiChatService 包装路径）。
      finishReason:
        (candidate?.finishReason as string | undefined) === "MAX_TOKENS"
          ? "length"
          : "stop",
    };
  }
}
