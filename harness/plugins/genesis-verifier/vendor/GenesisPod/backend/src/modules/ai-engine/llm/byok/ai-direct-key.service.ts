import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import type {
  ChatMessage,
  ChatCompletionResult,
} from "../chat/ai-chat.service";
import type { TaskProfile } from "../types";
import {
  reasoningDepthToEffort,
  safeReasoningEffort,
  ensureChatCompletionsPath,
  ensureMessagesPath,
  ensureCohereChatPath,
} from "../types";
import { TaskProfileMapperService } from "../chat/task-profile-mapper.service";
import { AiModelConfigService } from "../models/config/ai-model-config.service";
import { AiImageGenerationService } from "../image/ai-image-generation.service";
import { AiModelDiscoveryService } from "../models/catalog/ai-model-discovery.service";
import { AiChatPromptService } from "../chat/ai-chat-prompt.service";
import { AiChatRetryService } from "../chat/ai-chat-retry.service";

/**
 * AI Direct Key Service
 * 职责：BYOK (Bring Your Own Key) 直连 API 调用 (Path B)
 *
 * 从 AiChatService 提取，处理：
 * - 使用用户提供的 API Key 直接调用各 Provider
 * - 图片生成请求检测和路由
 * - Provider 特定的 API 调用格式
 */

/**
 * Gemini 能力纠正回退模型：当用户配置的 Gemini 模型与请求能力不匹配
 * （image-only 模型跑文本请求 / 文本模型跑图片请求）时切到此通用多模态模型。
 * 注：这是 **Provider 特定的能力纠正**（Gemini 直调路径必须传真实 model 名），
 * 不是 TaskProfile 可解析的 LLM 默认值——故不适用"fallback 用空字符串"红线。
 */
const GEMINI_CAPABILITY_FALLBACK_MODEL = "gemini-2.0-flash-exp";

@Injectable()
export class AiDirectKeyService {
  private readonly logger = new Logger(AiDirectKeyService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly taskProfileMapper: TaskProfileMapperService,
    private readonly modelConfigService: AiModelConfigService,
    private readonly retryService: AiChatRetryService,
    @Inject(forwardRef(() => AiImageGenerationService))
    private readonly imageGenerationService: AiImageGenerationService,
    @Inject(forwardRef(() => AiModelDiscoveryService))
    private readonly modelDiscoveryService: AiModelDiscoveryService,
    private readonly promptService: AiChatPromptService,
  ) {}

  /**
   * 推断模型是否为推理模型
   */
  private inferIsReasoning(modelId: string): boolean {
    return this.modelConfigService.isReasoningModel(modelId);
  }

  /**
   * Generate a chat completion using a specific API key
   * Used for AI Group feature where models are configured per-tenant
   */
  async generateChatCompletionWithKey(options: {
    provider: string;
    modelId: string;
    apiKey: string;
    apiEndpoint?: string;
    systemPrompt?: string;
    messages: ChatMessage[];
    taskProfile?: TaskProfile;
    maxTokens?: number;
    temperature?: number;
    displayName?: string;
    capabilities?: string[];
    enableSearch?: boolean;
    responseFormat?: string;
  }): Promise<ChatCompletionResult> {
    const {
      provider,
      modelId,
      apiKey,
      apiEndpoint,
      systemPrompt,
      messages,
      taskProfile,
      maxTokens: explicitMaxTokens,
      temperature: explicitTemperature,
      displayName,
      capabilities = [],
      enableSearch = true,
      responseFormat,
    } = options;

    // ★ 关键修复 (2026-04-26): mapToParameters 必须接到真实 modelConfig，
    //   否则 isReasoning=false 默认走非推理路径，推理模型 token boost 完全失效。
    //   先查 DB 拿到 gpt-5.4 等模型的 isReasoning / maxTokens / costTier 等字段，
    //   再算 effective maxTokens / temperature。
    //   旧代码传 null → BYOK 推理模型 max_completion_tokens 算成 4000（medium 默认），
    //   OpenAI reasoning_tokens 不计入此限制，CoT 可吃 50k+ token，visible 输出空。
    const modelConfigForMapping =
      await this.modelConfigService.getModelConfig(modelId);

    // Map taskProfile to parameters if provided
    let maxTokens: number;
    let temperature: number;

    if (explicitMaxTokens !== undefined || explicitTemperature !== undefined) {
      maxTokens = explicitMaxTokens ?? 2048;
      temperature = explicitTemperature ?? 0.7;
    } else if (taskProfile) {
      const profileParams = this.taskProfileMapper.mapToParameters(
        taskProfile,
        modelConfigForMapping,
      );
      maxTokens = profileParams.maxTokens;
      temperature = profileParams.temperature;
    } else {
      maxTokens = 2048;
      temperature = 0.7;
    }

    this.logger.debug(
      `Generating chat completion with key for provider: ${provider}, model: ${modelId}, apiKeyLength: ${apiKey?.length || 0}, endpoint: ${apiEndpoint}`,
    );

    if (!apiKey) {
      this.logger.warn(
        `No API key provided for ${provider}, returning error response`,
      );
      const aiName =
        displayName ||
        this.modelDiscoveryService.formatModelDisplayName(modelId);
      const envVarName =
        this.modelDiscoveryService.getEnvVarNameForProvider(provider);
      return {
        content: `**API Key 未配置**\n\n我是 ${aiName}，但无法生成回复，因为 "${modelId}" 的 API Key 未配置。\n\n**解决方法：**\n1. 进入管理后台 → AI 模型管理\n2. 找到 "${modelId}" 并添加 API Key\n3. 或设置环境变量：${envVarName}\n\n*请配置 API Key 后重试。*`,
        model: modelId,
        tokensUsed: 0,
      };
    }

    this.logger.debug(
      `API key confirmed for ${provider}: ${apiKey.substring(0, 8)}...${apiKey.slice(-4)}`,
    );

    // Augment messages with URL content
    const augmentedMessages =
      await this.promptService.augmentMessagesWithUrlContent(
        messages,
        enableSearch,
      );

    // Build full messages with system prompt
    const fullMessages: ChatMessage[] = [];
    if (systemPrompt) {
      fullMessages.push({ role: "system", content: systemPrompt });
    }
    fullMessages.push(...augmentedMessages);

    try {
      switch (provider.toLowerCase()) {
        case "xai":
        case "grok":
          // 2026-05-21 收口：移除无条件注入的 search_parameters（Grok Live Search）。
          // xAI 已废弃 Live Search —— 任何带 search_parameters 的请求都被拒：
          //   "Live search is deprecated. Please switch to the Agent Tools API
          //    (https://docs.x.ai/docs/guides/tools/overview)"。
          // 此前本分支对所有 xai 直连（含完全无搜索意图的对话）都强行附加该字段，
          // 导致 grok BYOK 直连全部 400。grok 联网搜索需迁移到 xAI Agent Tools API（另案）。
          return await this.callApiWithKey(
            apiEndpoint || "https://api.x.ai/v1/chat/completions",
            {
              model: modelId || "grok-3-latest",
              messages: fullMessages.map((m) => ({
                role: m.role,
                content: m.content,
              })),
              max_tokens: maxTokens,
              temperature,
              ...(responseFormat === "json"
                ? { response_format: { type: "json_object" } }
                : {}),
            },
            { Authorization: `Bearer ${apiKey}` },
            "grok",
          );

        case "openai":
        case "gpt": {
          // Check if user is requesting image generation
          const lastUserMsg = fullMessages
            .filter((m) => m.role === "user")
            .pop();
          const userText = lastUserMsg?.content?.toLowerCase() || "";
          const hasImageCapability = capabilities.includes("IMAGE_GENERATION");
          const isImageRequest =
            this.imageGenerationService.isImageGenerationRequest(userText);
          if (isImageRequest && hasImageCapability) {
            this.logger.debug(
              `Image generation request detected, using DALL-E 3`,
            );
            const buildDallEPrompt = (): string => {
              const recentMessages = fullMessages.slice(-10);
              const contextParts: string[] = [];

              for (const msg of recentMessages) {
                if (msg.role === "assistant" && msg.name) {
                  const truncatedContent = msg.content.substring(0, 2000);
                  contextParts.push(
                    `[${msg.name}'s analysis]: ${truncatedContent}`,
                  );
                }
              }

              const userRequest = lastUserMsg?.content || "";

              if (contextParts.length > 0) {
                const context = contextParts.join("\n\n");
                return `Based on the following context:\n\n${context}\n\nUser's request: ${userRequest}\n\nIMPORTANT INSTRUCTIONS FOR IMAGE GENERATION:\n1. Create a professional infographic or data visualization\n2. ALL TEXT IN THE IMAGE MUST BE IN ENGLISH - do not use Chinese or other non-Latin characters as they may appear garbled\n3. If the context contains Chinese data/names, translate them to English equivalents\n4. Use clean, modern design with clear labels, legends, and proper typography\n5. Ensure all text is legible and properly rendered\n6. Use appropriate charts (bar, line, pie) to visualize numerical data`;
              }

              return `${userRequest}\n\nIMPORTANT: All text in the image must be in English. Use clean, professional design.`;
            };

            const dallePrompt = buildDallEPrompt();
            this.logger.debug(
              `[DALL-E 3] Context-aware prompt length: ${dallePrompt.length}`,
            );
            return await this.imageGenerationService.callDallE3(
              apiKey,
              dallePrompt,
            );
          }

          const effectiveModelId = modelId || "";
          // ★ 2026-06-10 P0 修复（gpt-5.4 BYOK 全失败）：isReasoning / tokenParamName 改用
          //   上方已 await 的 modelConfigForMapping 权威值——与 maxTokens boost 同源
          //   （task-profile-mapper.service:80 同样读 modelConfig.isReasoning）。
          //   原先走 sync inferIsReasoning → isReasoningModel 的同步缓存/启发式，对 gpt-5.4 等
          //   新 reasoning 模型缓存未命中即判 false → 发 max_tokens → OpenAI INVALID_REQUEST
          //   "Unsupported parameter: max_tokens" 全部失败 + circuit breaker 打开。
          //   DB 显式配了 tokenParamName 时优先直用（最权威）；两者皆缺才回退启发式。
          const isReasoning =
            modelConfigForMapping?.isReasoning ??
            this.inferIsReasoning(effectiveModelId);
          const tokenParamName =
            modelConfigForMapping?.tokenParamName ??
            (isReasoning ? "max_completion_tokens" : "max_tokens");
          const tokenParam = { [tokenParamName]: maxTokens };

          // ★ reasoning_effort 由 task profile reasoningDepth 决定（共享映射），
          //   不再 hardcode "low"。caller 传 deep → high effort（多步推理任务）；
          //   不传 → 缺省 low（最省 token，避免 CoT 吃光 max_completion_tokens）。
          //   safeReasoningEffort 自动降级不支持 minimal 的模型（如 gpt-5.x BYOK 变体）。
          const reasoningEffort = safeReasoningEffort(
            taskProfile?.reasoningDepth,
            effectiveModelId,
          );
          const origEffort = reasoningDepthToEffort(
            taskProfile?.reasoningDepth,
          );
          if (isReasoning && origEffort !== reasoningEffort) {
            this.logger.warn(
              `[OpenAI BYOK] minimal effort not supported by ${effectiveModelId}, downgrading to ${reasoningEffort}`,
            );
          }
          const reasoningParam = isReasoning
            ? { reasoning_effort: reasoningEffort }
            : {};

          this.logger.debug(
            `[OpenAI BYOK] model=${effectiveModelId}, ` +
              `${tokenParamName}=${maxTokens}, isReasoning=${isReasoning}` +
              `${isReasoning ? ` (reasoning_effort=${reasoningEffort})` : ""}`,
          );

          return await this.callApiWithKey(
            ensureChatCompletionsPath(apiEndpoint) ||
              "https://api.openai.com/v1/chat/completions",
            {
              model: effectiveModelId,
              messages: fullMessages.map((m) => ({
                role: m.role,
                content: m.content,
              })),
              ...tokenParam,
              ...reasoningParam,
              // 推理模型不支持 temperature 参数
              ...(!isReasoning ? { temperature } : {}),
              ...(responseFormat === "json"
                ? { response_format: { type: "json_object" } }
                : {}),
            },
            { Authorization: `Bearer ${apiKey}` },
            effectiveModelId,
          );
        }

        case "anthropic":
        case "claude": {
          if (responseFormat === "json") {
            this.logger.warn(
              `[BYOK] responseFormat="json" requested for Anthropic but native JSON mode is not supported. ` +
                `Relying on system prompt constraint only.`,
            );
          }
          const systemMessage = fullMessages.find((m) => m.role === "system");
          const otherMessages = fullMessages.filter((m) => m.role !== "system");
          return await this.callClaudeApiWithKey(
            ensureMessagesPath(apiEndpoint) ||
              "https://api.anthropic.com/v1/messages",
            apiKey,
            modelId || "",
            systemMessage?.content,
            otherMessages,
            maxTokens,
            temperature,
            responseFormat,
          );
        }

        case "google":
        case "gemini":
          return await this.callGeminiApiWithKey(
            apiKey,
            modelId || "",
            apiEndpoint,
            fullMessages,
            maxTokens,
            temperature,
            displayName,
            capabilities,
            enableSearch,
            responseFormat,
          );

        // OpenAI-compatible providers (Groq, OpenRouter, MiniMax, etc.)
        case "groq":
        case "openrouter":
        case "minimax":
        case "deepseek":
        case "qwen":
        case "alibaba":
        case "doubao":
        case "bytedance":
        case "zhipu":
        case "glm":
        case "kimi":
        case "moonshot": {
          const compatChatUrl = ensureChatCompletionsPath(apiEndpoint);
          if (!compatChatUrl) {
            throw new Error(
              `API endpoint is required for provider: ${provider}`,
            );
          }
          return await this.callApiWithKey(
            compatChatUrl,
            {
              model: modelId || "",
              messages: fullMessages.map((m) => ({
                role: m.role,
                content: m.content,
              })),
              max_tokens: maxTokens,
              temperature,
              ...(responseFormat === "json"
                ? { response_format: { type: "json_object" } }
                : {}),
            },
            { Authorization: `Bearer ${apiKey}` },
            modelId || "",
          );
        }

        case "cohere": {
          // Cohere v2 chat 专用（非 OpenAI-compatible），避免落 default 用 Grok 端点。
          const cohereChatUrl =
            ensureCohereChatPath(apiEndpoint) ||
            "https://api.cohere.com/v2/chat";
          return await this.callCohereApiWithKey(
            cohereChatUrl,
            apiKey,
            modelId || "",
            fullMessages,
            maxTokens,
            temperature,
            responseFormat,
          );
        }

        default:
          this.logger.warn(`Unknown provider: ${provider}, using Grok`);
          return await this.callApiWithKey(
            ensureChatCompletionsPath(apiEndpoint) ||
              "https://api.x.ai/v1/chat/completions",
            {
              model: modelId || "",
              messages: fullMessages.map((m) => ({
                role: m.role,
                content: m.content,
              })),
              max_tokens: maxTokens,
              temperature,
            },
            { Authorization: `Bearer ${apiKey}` },
            "grok",
          );
      }
    } catch (error) {
      const errorResponse = error as {
        response?: { data?: unknown; status?: number };
      };
      const errorDetails =
        error instanceof Error
          ? {
              message: error.message,
              name: error.name,
              response: errorResponse.response?.data,
              status: errorResponse.response?.status,
            }
          : error;
      this.logger.error(
        `API call failed for ${provider}: ${JSON.stringify(errorDetails)}`,
      );

      const responseData = errorResponse.response?.data as
        | { error?: { message?: string } }
        | undefined;
      const errorMessage =
        responseData?.error?.message ||
        (error instanceof Error ? error.message : "Unknown API error");

      if (
        errorMessage.includes("截断") ||
        errorMessage.includes("上下文") ||
        errorMessage.includes("context") ||
        errorMessage.includes("token") ||
        errorMessage.includes("length")
      ) {
        this.logger.warn(
          `[${provider}] Rethrowing context-related error for caller to handle: ${errorMessage}`,
        );
        throw error;
      }

      return {
        content: `API Error: ${errorMessage}\n\nProvider: ${provider}\nModel: ${modelId}\n\nPlease check your API key and model configuration.`,
        model: modelId,
        tokensUsed: 0,
      };
    }
  }

  /**
   * Helper method to call OpenAI-compatible APIs with automatic retry
   */
  private async callApiWithKey(
    url: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
    modelName: string,
  ): Promise<ChatCompletionResult> {
    const maxTokens =
      (body.max_completion_tokens as number | undefined) ||
      (body.max_tokens as number | undefined) ||
      2048;
    const dynamicTimeout = this.modelConfigService.getTimeoutForModel(
      modelName,
      maxTokens,
    );

    const estimateTokens = (text: string): number => {
      if (!text) return 0;
      const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
      const totalChars = text.length;
      const chineseRatio = chineseChars / totalChars || 0;
      return Math.ceil(
        totalChars * (chineseRatio * 1.5 + (1 - chineseRatio) * 0.25),
      );
    };

    const messages = body.messages as
      | Array<{ role: string; content: string }>
      | undefined;
    const systemPromptTokens = messages?.find((m) => m.role === "system")
      ?.content
      ? estimateTokens(messages.find((m) => m.role === "system")!.content)
      : 0;
    const userTokens =
      messages
        ?.filter((m) => m.role === "user")
        .reduce((sum, m) => sum + estimateTokens(m.content || ""), 0) || 0;
    const totalEstimatedTokens = systemPromptTokens + userTokens;

    this.logger.debug(
      `[${modelName}] Calling API: ${url.replace(/Bearer\s+\S+/, "Bearer ***")}`,
    );
    this.logger.debug(
      `[${body.model}] Request: model=${body.model}, ` +
        `maxTokens=${body.max_completion_tokens || body.max_tokens || "?"}, ` +
        `estimatedPromptTokens=${totalEstimatedTokens} (system=${systemPromptTokens}, user=${userTokens})`,
    );

    return await this.retryService.withExponentialBackoff(
      async () => {
        const response = await firstValueFrom(
          this.httpService.post(url, body, {
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            timeout: dynamicTimeout,
          }),
        );

        const data = response.data;
        const messageObj = data.choices?.[0]?.message;
        const content =
          messageObj?.content ||
          messageObj?.text ||
          messageObj?.output ||
          (typeof messageObj === "string" ? messageObj : null);

        if (data.error) {
          this.logger.error(
            `[${modelName}] API returned error: ${JSON.stringify(data.error)}`,
          );
        }

        const finishReason = data.choices?.[0]?.finish_reason;

        if (messageObj?.refusal) {
          this.logger.error(
            `[${modelName}] API refused to respond: ${messageObj.refusal}`,
          );
          throw new Error(`AI 拒绝响应: ${messageObj.refusal}`);
        }

        if (!content) {
          this.logger.warn(
            `[${modelName}] Message object structure: ${JSON.stringify(messageObj || {}).substring(0, 500)}`,
          );
        }

        if (!content) {
          const usage = data.usage || {};
          const completionDetails = usage.completion_tokens_details || {};
          const reasoningTokens = completionDetails.reasoning_tokens || 0;
          const completionTokens = usage.completion_tokens || 0;

          this.logger.warn(
            `[${modelName}] API returned empty content! ` +
              `finish_reason=${finishReason}, ` +
              `prompt_tokens=${usage.prompt_tokens || "?"}, ` +
              `completion_tokens=${completionTokens || "?"}, ` +
              `reasoning_tokens=${reasoningTokens || "?"}, ` +
              `total_tokens=${usage.total_tokens || "?"}, ` +
              `full response: ${JSON.stringify(data).substring(0, 800)}`,
          );

          const isReasoningModelExhausted =
            reasoningTokens > 0 && reasoningTokens >= completionTokens * 0.9;

          if (finishReason === "length") {
            if (isReasoningModelExhausted) {
              this.logger.error(
                `[${modelName}] CRITICAL: Reasoning model exhausted all tokens on reasoning (${reasoningTokens}/${completionTokens}).`,
              );
              throw new Error(
                `AI 推理模型的 token 全部用于思考，没有空间输出结果。请增加 max_tokens 设置（建议 8000+）。`,
              );
            } else {
              this.logger.error(
                `[${modelName}] CRITICAL: Response completely truncated (no content generated).`,
              );
              throw new Error(
                `AI 响应被完全截断（上下文可能过大）。请减少上下文消息或简化请求。`,
              );
            }
          }
          throw new Error(`AI 返回空响应 (原因: ${finishReason || "unknown"})`);
        }

        let finalContent = content;
        if (finishReason === "length") {
          this.logger.warn(
            `[${modelName}] Response content was truncated (finish_reason=length), content length: ${content.length}`,
          );
          if (
            !content.endsWith(".") &&
            !content.endsWith("。") &&
            !content.endsWith("!") &&
            !content.endsWith("！") &&
            !content.endsWith("?") &&
            !content.endsWith("？")
          ) {
            finalContent = content + "\n\n[... 响应因长度限制被截断]";
          }
        }

        return {
          content: finalContent,
          model: modelName,
          tokensUsed: data.usage?.total_tokens || 0,
        };
      },
      `${modelName}-API`,
      modelName,
    );
  }

  /**
   * Helper method to call Claude API with key
   */
  private async callClaudeApiWithKey(
    url: string,
    apiKey: string,
    modelId: string,
    systemPrompt: string | undefined,
    messages: ChatMessage[],
    maxTokens: number,
    temperature: number,
    responseFormat?: string,
  ): Promise<ChatCompletionResult> {
    if (responseFormat === "json") {
      this.logger.warn(
        `[BYOK/Claude] responseFormat="json" requested but Anthropic does not support ` +
          `json_object mode natively. Relying on system prompt constraint only.`,
      );
    }
    const dynamicTimeout = Math.max(
      120000,
      Math.min(600000, 120000 + Math.ceil(maxTokens / 1000) * 15000),
    );

    return await this.retryService.withExponentialBackoff(
      async () => {
        const response = await firstValueFrom(
          this.httpService.post(
            url,
            {
              model: modelId,
              max_tokens: maxTokens,
              temperature,
              system: systemPrompt,
              messages: messages.map((m) => ({
                role: m.role === "assistant" ? "assistant" : "user",
                content: m.content,
              })),
            },
            {
              headers: {
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
              },
              timeout: dynamicTimeout,
            },
          ),
        );

        const data = response.data;
        return {
          content: data.content?.[0]?.text || "",
          model: "claude",
          tokensUsed:
            (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        };
      },
      "Claude-API",
      "claude",
    );
  }

  /**
   * Helper method to call Cohere v2 Chat API with key (BYOK 直连)。
   * 非 OpenAI-compatible：messages[] 请求，响应 message.content[] 文本块拼接，
   * usage 在 usage.tokens.{input,output}_tokens。
   */
  private async callCohereApiWithKey(
    url: string,
    apiKey: string,
    modelId: string,
    messages: ChatMessage[],
    maxTokens: number,
    temperature: number,
    responseFormat?: string,
  ): Promise<ChatCompletionResult> {
    const dynamicTimeout = Math.max(
      120000,
      Math.min(600000, 120000 + Math.ceil(maxTokens / 1000) * 15000),
    );

    return await this.retryService.withExponentialBackoff(
      async () => {
        const response = await firstValueFrom(
          this.httpService.post(
            url,
            {
              model: modelId,
              max_tokens: maxTokens,
              temperature,
              messages: messages.map((m) => ({
                role: m.role,
                content:
                  typeof m.content === "string"
                    ? m.content
                    : JSON.stringify(m.content),
              })),
              ...(responseFormat === "json"
                ? { response_format: { type: "json_object" } }
                : {}),
            },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              timeout: dynamicTimeout,
            },
          ),
        );

        const data = response.data ?? {};
        const blocks = (data.message?.content ?? []) as Array<{
          type?: string;
          text?: string;
        }>;
        const content = blocks
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("");
        const tokens = data.usage?.tokens ?? {};
        return {
          content,
          model: modelId,
          tokensUsed: (tokens.input_tokens || 0) + (tokens.output_tokens || 0),
        };
      },
      "Cohere-API",
      modelId,
    );
  }

  /**
   * Helper method to call Gemini API with key
   * Supports both text and image generation
   */
  private async callGeminiApiWithKey(
    apiKey: string,
    modelId: string,
    _apiEndpoint: string | undefined,
    messages: ChatMessage[],
    maxTokens: number,
    temperature: number,
    displayName?: string,
    capabilities: string[] = [],
    enableSearch: boolean = true,
    responseFormat?: string,
  ): Promise<ChatCompletionResult> {
    const dynamicTimeout = Math.max(
      120000,
      Math.min(600000, 120000 + Math.ceil(maxTokens / 1000) * 15000),
    );

    const lastUserMessage = messages.filter((m) => m.role === "user").pop();
    const userContent = lastUserMessage?.content?.toLowerCase() || "";
    const isImageRequestByContent =
      this.imageGenerationService.isImageGenerationRequest(userContent);

    const hasImageCapability = capabilities.includes("IMAGE_GENERATION");

    const modelIdLower = modelId.toLowerCase();
    const isImagenModel = modelIdLower.startsWith("imagen");

    const isGeminiImageModel =
      modelIdLower.includes("gemini") &&
      (modelIdLower.includes("image") || modelIdLower.includes("2.0"));

    const isImageRequest = isImageRequestByContent && hasImageCapability;

    this.logger.debug(
      `[Gemini] Image detection: modelId=${modelId}, displayName=${displayName}`,
    );
    this.logger.debug(
      `[Gemini] Image detection details: hasImageCapability=${hasImageCapability}, capabilities=${JSON.stringify(capabilities)}, isImageRequestByContent=${isImageRequestByContent}`,
    );
    this.logger.debug(
      `[Gemini] Image detection result: isImagenModel=${isImagenModel}, isGeminiImageModel=${isGeminiImageModel}, finalIsImageRequest=${isImageRequest}`,
    );

    const buildImagePrompt = (): string => {
      const recentMessages = messages.slice(-10);
      const conversationParts: string[] = [];

      for (const msg of recentMessages) {
        const cleanContent = msg.content
          .replace(/^@[\w\-()]+\s*/g, "")
          .replace(
            /!\[.*?\]\(data:image\/[^)]+\)/g,
            "[Previously generated image]",
          )
          .trim();

        if (!cleanContent || cleanContent === "[Previously generated image]") {
          continue;
        }

        if (msg.role === "user") {
          conversationParts.push(`User request: ${cleanContent}`);
        } else if (msg.role === "assistant" && msg.name) {
          if (cleanContent.length > 10) {
            conversationParts.push(
              `${msg.name} responded: ${cleanContent.substring(0, 500)}`,
            );
          }
        }
      }

      let userRequest = lastUserMessage?.content || "";
      userRequest = userRequest.replace(/^@[\w\-()]+\s*/g, "").trim();

      if (conversationParts.length > 1) {
        const history = conversationParts.slice(0, -1).join("\n");
        return `Based on this conversation history:\n${history}\n\nCurrent request: ${userRequest}\n\nGenerate an image that fulfills the current request while maintaining consistency with the previous context.`;
      }

      return userRequest;
    };

    // Use Imagen API only if explicitly configured as Imagen model
    if (isImageRequest && isImagenModel) {
      this.logger.debug(`Using Imagen model for image generation: ${modelId}`);
      const imagePrompt = buildImagePrompt();
      return await this.imageGenerationService.callImagenApi(
        apiKey,
        modelId,
        imagePrompt,
      );
    }

    const isImageOnlyModel =
      modelIdLower.includes("image") || modelIdLower.startsWith("imagen");

    let effectiveModelId = modelId;

    if (isImageOnlyModel && !isImageRequest) {
      effectiveModelId = GEMINI_CAPABILITY_FALLBACK_MODEL;
      this.logger.debug(
        `[Gemini] Image-only model ${modelId} used for non-image request, falling back to ${effectiveModelId}`,
      );
    } else if (isImageRequest && isGeminiImageModel) {
      this.logger.debug(
        `[Gemini] Using configured Gemini image model: ${modelId}`,
      );
    } else if (isImageRequest && !isGeminiImageModel && !isImagenModel) {
      const imageCapableModel = GEMINI_CAPABILITY_FALLBACK_MODEL;
      this.logger.debug(
        `[Gemini] Image request with non-image model ${modelId}, switching to ${imageCapableModel}`,
      );
      effectiveModelId = imageCapableModel;
    } else {
      this.logger.debug(
        `[Gemini] Using configured model: ${effectiveModelId}, isImageRequest: ${isImageRequest}`,
      );
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModelId}:generateContent?key=${apiKey}`;

    this.logger.debug(
      `Calling Gemini API: ${url.replace(apiKey, "***")}, imageRequest=${isImageRequest}`,
    );

    const systemMessage = messages.find((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    const isGemini3ImageModel =
      effectiveModelId.includes("gemini-3") &&
      effectiveModelId.includes("image");

    interface GeminiContent {
      role: string;
      parts: Array<{ text: string }>;
    }

    let contents: GeminiContent[];

    if (isGemini3ImageModel && isImageRequest) {
      const lastUserMsg = otherMessages.filter((m) => m.role === "user").pop();

      let cleanPrompt = lastUserMsg?.content || "Generate an image";
      cleanPrompt = cleanPrompt
        .replace(/^@[\w\-()]+\s*/g, "")
        .replace(/!\[.*?\]\(data:image\/[^)]+\)/g, "")
        .trim();

      this.logger.debug(
        `[Gemini 3 Image] Using single-turn format, prompt: "${cleanPrompt.substring(0, 100)}..."`,
      );

      contents = [
        {
          role: "user",
          parts: [{ text: cleanPrompt }],
        },
      ];
    } else {
      contents = otherMessages.map((m) => {
        let cleanContent = m.content;

        if (cleanContent.includes("![Generated Image](data:image")) {
          cleanContent = cleanContent.replace(
            /!\[Generated Image\]\(data:image\/[^)]+\)/g,
            "[An image was generated based on the previous request]",
          );
          this.logger.debug(
            `[Gemini] Cleaned base64 image from message, role: ${m.role}`,
          );
        }

        return {
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: cleanContent }],
        };
      });
    }

    interface GeminiRequestBody {
      contents: GeminiContent[];
      generationConfig: {
        maxOutputTokens: number;
        temperature: number;
        responseModalities?: string[];
        responseMimeType?: string;
      };
      tools?: Array<{ googleSearch: Record<string, never> }>;
      systemInstruction?: { parts: Array<{ text: string }> };
    }

    const requestBody: GeminiRequestBody = {
      contents,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
      },
    };

    if (isImageRequest) {
      requestBody.generationConfig.responseModalities = ["TEXT", "IMAGE"];
      this.logger.log(
        `[Gemini] Image generation enabled, model: ${effectiveModelId}, isGemini3=${isGemini3ImageModel}`,
      );
    } else {
      if (enableSearch) {
        requestBody.tools = [
          {
            googleSearch: {},
          },
        ];
      }

      if (systemMessage) {
        requestBody.systemInstruction = {
          parts: [{ text: systemMessage.content }],
        };
      }

      if (responseFormat === "json") {
        requestBody.generationConfig.responseMimeType = "application/json";
      }
    }

    const response = await this.retryService.withExponentialBackoff(
      async () =>
        firstValueFrom(
          this.httpService.post(url, requestBody, {
            headers: {
              "Content-Type": "application/json",
            },
            timeout: dynamicTimeout,
          }),
        ),
      "Gemini-API",
      "gemini",
    );

    const data = response.data;

    this.logger.verbose(`[Gemini] Response status: ${response.status}`);

    if (data.candidates?.[0]) {
      const candidate = data.candidates[0];
      if (candidate.safetyRatings) {
        const blocked = candidate.safetyRatings.filter(
          (r: { probability?: string; blocked?: boolean }) =>
            r.probability === "HIGH" || r.blocked,
        );
        if (blocked.length > 0) {
          this.logger.warn(
            `[Gemini] Safety blocked: ${JSON.stringify(blocked)}`,
          );
        }
      }
    }

    if (data.promptFeedback?.blockReason) {
      this.logger.error(
        `[Gemini] Prompt blocked: ${data.promptFeedback.blockReason}`,
      );
      return {
        content: `Response blocked by Gemini safety filters: ${data.promptFeedback.blockReason}`,
        model: "gemini",
        tokensUsed: 0,
      };
    }

    const parts = data.candidates?.[0]?.content?.parts || [];
    let textContent = "";
    const images: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (part.text) {
        textContent += part.text;
      }
      if (part.inlineData) {
        const mimeType = part.inlineData.mimeType || "image/png";
        const base64Data = part.inlineData.data?.replace(/\s/g, "") || "";

        if (base64Data && base64Data.length > 0) {
          const validBase64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
          if (!validBase64Regex.test(base64Data)) {
            this.logger.warn(
              `[Gemini] Part ${i} base64 has invalid characters!`,
            );
          }

          const imageMarkdown = `![Generated Image](data:${mimeType};base64,${base64Data})`;
          images.push(imageMarkdown);
        } else {
          this.logger.warn(`[Gemini] Part ${i} has inlineData but no data!`);
        }
      }
    }

    let finalContent = textContent;
    if (images.length > 0) {
      finalContent =
        images.join("\n\n") + (textContent ? "\n\n" + textContent : "");
      this.logger.log(
        `[Gemini] Generated ${images.length} image(s), final content length: ${finalContent.length}`,
      );
    }

    // FALLBACK: If image request but no images returned
    if (isImageRequest && images.length === 0) {
      this.logger.warn(
        `[Gemini] Image generation requested but no images returned, falling back to Imagen API`,
      );

      const buildFallbackImagePrompt = (): string => {
        const recentMessages = messages.slice(-10);
        const contextParts: string[] = [];

        for (const msg of recentMessages) {
          if (msg.role === "assistant" && msg.name) {
            const truncatedContent = msg.content.substring(0, 2000);
            contextParts.push(`[${msg.name}'s analysis]: ${truncatedContent}`);
          }
        }

        const lastUserMsg = messages.filter((m) => m.role === "user").pop();
        const userRequest = lastUserMsg?.content || "";

        if (contextParts.length > 0) {
          const context = contextParts.join("\n\n");
          return `Based on the following context from the discussion:\n\n${context}\n\nUser's request: ${userRequest}\n\nIMPORTANT INSTRUCTIONS:\n1. Create a professional infographic or data visualization\n2. ALL TEXT IN THE IMAGE MUST BE IN ENGLISH - do not use Chinese or other non-Latin characters\n3. If the context contains Chinese data/names, translate them to English\n4. Use clean, modern design with clear labels and legends\n5. Ensure all text is legible and properly rendered`;
        }

        return `${userRequest}\n\nIMPORTANT: All text in the image must be in English.`;
      };

      const imagePrompt = buildFallbackImagePrompt();
      this.logger.log(
        `[Imagen Fallback] Context-aware prompt length: ${imagePrompt.length}`,
      );

      try {
        const imagenResult = await this.imageGenerationService.callImagenApi(
          apiKey,
          "imagen-4.0-generate-001",
          imagePrompt,
        );

        if (
          imagenResult.content &&
          !imagenResult.content.includes("图像生成失败")
        ) {
          this.logger.log(`[Imagen Fallback] Successfully generated image`);
          if (textContent && textContent.length > 50) {
            return {
              content: imagenResult.content + "\n\n" + textContent,
              model: "gemini+imagen",
              tokensUsed:
                (data.usageMetadata?.promptTokenCount || 0) +
                (data.usageMetadata?.candidatesTokenCount || 0),
            };
          }
          return imagenResult;
        }
      } catch (imagenError) {
        this.logger.error(`[Imagen Fallback] Failed: ${imagenError}`);
      }

      // Try DALL-E 3 fallback
      const openaiKey = this.configService.get<string>("OPENAI_API_KEY");
      if (openaiKey) {
        this.logger.log(`[DALL-E 3 Fallback] Imagen failed, trying DALL-E 3`);
        try {
          const dallePrompt = buildFallbackImagePrompt();
          const dalleResult = await this.imageGenerationService.callDallE3(
            openaiKey,
            dallePrompt,
          );
          if (
            dalleResult.content &&
            !dalleResult.content.includes("图像生成失败")
          ) {
            this.logger.log(`[DALL-E 3 Fallback] Successfully generated image`);
            if (textContent && textContent.length > 50) {
              return {
                content: dalleResult.content + "\n\n" + textContent,
                model: "gemini+dalle3",
                tokensUsed:
                  (data.usageMetadata?.promptTokenCount || 0) +
                  (data.usageMetadata?.candidatesTokenCount || 0),
              };
            }
            return dalleResult;
          }
        } catch (dalleError) {
          this.logger.error(`[DALL-E 3 Fallback] Failed: ${dalleError}`);
        }
      }

      if (textContent) {
        return {
          content:
            textContent +
            "\n\n---\n\n**⚠️ 图片生成失败**\n\nAI 生成了上面的描述内容，但未能生成实际图片。\n\n**可能的解决方案：**\n1. 确保 Google API Key 启用了图片生成功能\n2. 检查 Imagen API 是否已在 Google Cloud 控制台启用\n3. 尝试使用配置了 OPENAI_API_KEY 的 AI 成员（支持 DALL-E 3）",
          model: "gemini",
          tokensUsed:
            (data.usageMetadata?.promptTokenCount || 0) +
            (data.usageMetadata?.candidatesTokenCount || 0),
        };
      }
    }

    const finishReason = data.candidates?.[0]?.finishReason;

    if (!finalContent) {
      this.logger.warn(
        `[Gemini] Empty response (finishReason=${finishReason}), full data: ${JSON.stringify(data).substring(0, 500)}`,
      );
      if (finishReason === "MAX_TOKENS") {
        this.logger.error(`[Gemini] CRITICAL: Response completely truncated!`);
        throw new Error(
          `AI 响应被完全截断（上下文可能过大）。请减少上下文消息或简化请求。`,
        );
      }
      throw new Error(`AI 返回空响应 (原因: ${finishReason || "unknown"})`);
    }

    if (finishReason === "MAX_TOKENS") {
      this.logger.warn(
        `[Gemini] Response truncated, content length: ${finalContent.length}`,
      );
      if (
        !finalContent.endsWith(".") &&
        !finalContent.endsWith("。") &&
        !finalContent.endsWith("!") &&
        !finalContent.endsWith("！") &&
        !finalContent.endsWith("?") &&
        !finalContent.endsWith("？")
      ) {
        finalContent = finalContent + "\n\n[... 响应因长度限制被截断]";
      }
    }

    return {
      content: finalContent,
      model: "gemini",
      tokensUsed:
        (data.usageMetadata?.promptTokenCount || 0) +
        (data.usageMetadata?.candidatesTokenCount || 0),
    };
  }
}
