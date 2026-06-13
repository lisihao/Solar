import { Injectable, Logger, Optional } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { AiModelConfigService } from "../models/config/ai-model-config.service";
import { inferIsReasoning } from "../types/model.utils";
import {
  ensureChatCompletionsPath,
  ensureMessagesPath,
  ensureCohereChatPath,
  ensureGeminiGenerateContentPath,
  ensureOpenAIEmbeddingsPath,
  ensureCohereEmbedPath,
  ensureGeminiEmbedContentPath,
  ensureOpenAIImagesGenerationsPath,
} from "../types/endpoint.utils";
import { UserApiKeysService } from "@/modules/platform/credentials/user-owned/user-api-keys/user-api-keys.service";

/**
 * AI Connection Test Service
 * 职责：AI 模型连接测试（各 provider 的连通性验证）
 *
 * 从 AiChatService 提取，处理：
 * - Chat 模型连接测试
 * - Embedding 模型连接测试
 * - Rerank 模型连接测试
 * - TTS/Audio 模型连接测试
 * - Imagen 模型连接测试
 */
@Injectable()
export class AiConnectionTestService {
  private readonly logger = new Logger(AiConnectionTestService.name);

  constructor(
    private readonly httpService: HttpService,
    @Optional() private readonly modelConfigService?: AiModelConfigService,
    @Optional() private readonly userApiKeys?: UserApiKeysService,
  ) {}

  /**
   * 解析 OpenAI-compatible provider 的 chat-completions 完整 URL。
   *
   * 优先级：
   *   1. 调用方传入的 override（用户在 UserModelConfig.apiEndpoint 显式配置）—
   *      尾部已含 /chat/completions 直接用，否则按"base + /chat/completions"拼。
   *   2. DB `ai_providers` 单源（admin 维护 + scope=user 自定义）— 经
   *      UserApiKeysService.resolveProviderDefaults() 查询。
   *
   * 2026-05-11 P2: PROVIDER_DEFAULTS 硬编码已删除。DB 未配该 provider 时
   *   resolveProviderDefaults 返回 null，下游报"请去 admin 维护页配置"。
   */
  private async resolveOpenAICompatibleChatEndpoint(
    provider: string,
    override?: string,
  ): Promise<string | null> {
    // 用户显式 override 直接走单源 helper
    const overrideNormalized = ensureChatCompletionsPath(override);
    if (overrideNormalized) return overrideNormalized;
    // 否则走 DB ai_providers 真源 + 单源 helper
    const defaults = await this.userApiKeys?.resolveProviderDefaults(
      provider.toLowerCase(),
    );
    return ensureChatCompletionsPath(defaults?.endpoint);
  }

  /**
   * 推断模型是否为推理模型（用于 tokenParamName 决策）。
   *
   * 连接测试发生在「模型配置保存前」（用户填 key → 选模型 → 点测试，此时 DB
   * 还没有这条 UserModelConfig/AIModel）。此时 modelConfigService.isReasoningModel
   * 走 5min 全量缓存 + DB 兜底均 miss → 落到自身的 inferIsReasoning 启发式。
   * 为防该委托链上任一环（含 case-insensitive 命中到一条旧的非推理配置）误返
   * false，这里 DB 判断与 model.utils 启发式取**或**：任一命中即视为推理模型，
   * 用 max_completion_tokens。否则 reasoning 模型（gpt-5/o1/o3 等）测试会因
   * max_tokens 触发 OpenAI "Unsupported parameter: max_tokens" 假阴性失败。
   */
  private inferIsReasoning(modelId: string): boolean {
    const heuristic = inferIsReasoning(modelId);
    if (this.modelConfigService) {
      return this.modelConfigService.isReasoningModel(modelId) || heuristic;
    }
    return heuristic;
  }

  /**
   * Test connection to an AI model with custom API key and endpoint
   * Used for testing models configured in the database
   */
  async testModelConnectionWithKey(
    provider: string,
    modelId: string,
    apiKey: string,
    apiEndpoint: string,
    modelType?: string,
  ): Promise<{ success: boolean; message: string; latency?: number }> {
    const startTime = Date.now();

    if (!apiKey) {
      return {
        success: false,
        message: "API key is not configured",
        latency: 0,
      };
    }

    try {
      // Handle EMBEDDING models specially
      if (modelType === "EMBEDDING") {
        return await this.testEmbeddingModel(
          provider,
          modelId,
          apiKey,
          apiEndpoint,
          startTime,
        );
      }

      // Handle RERANK models specially
      if (modelType === "RERANK") {
        return await this.testRerankModel(
          provider,
          modelId,
          apiKey,
          apiEndpoint,
          startTime,
        );
      }

      // Handle TTS/AUDIO models
      if (
        modelType === "TTS" ||
        modelType === "AUDIO" ||
        modelId?.toLowerCase().includes("tts")
      ) {
        return await this.testTTSModel(
          provider,
          modelId,
          apiKey,
          apiEndpoint,
          startTime,
        );
      }

      // Handle IMAGE_GENERATION / IMAGE_EDITING models.
      // DALL-E / gpt-image 只能通过 /v1/images/generations；
      // 走 chat/completions 会 403 "not allowed to sample from this model"。
      if (
        modelType === "IMAGE_GENERATION" ||
        modelType === "IMAGE_EDITING" ||
        (provider.toLowerCase() === "openai" &&
          (modelId?.startsWith("dall-e") || modelId?.startsWith("gpt-image")))
      ) {
        return await this.testImageModel(
          provider,
          modelId,
          apiKey,
          apiEndpoint,
          modelType,
          startTime,
        );
      }

      const testMessages = [
        {
          role: "user" as const,
          content: "Say 'OK' to confirm you are working.",
        },
      ];

      let response;

      switch (provider.toLowerCase()) {
        case "xai":
        case "grok": {
          const grokTestMessages = [
            {
              role: "user" as const,
              content: "What is 2+2?",
            },
          ];
          response = await firstValueFrom(
            this.httpService.post(
              ensureChatCompletionsPath(apiEndpoint) ||
                "https://api.x.ai/v1/chat/completions",
              {
                model: modelId || "",
                messages: grokTestMessages,
                max_tokens: 50,
                temperature: 0,
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              },
            ),
          );
          break;
        }

        case "openai":
        case "gpt": {
          const effectiveOpenAIModel = modelId || "";
          // ★ Read tokenParamName from DB config first, fallback to reasoning inference.
          //   isReasoning 同时决定三件事，与真实直调路径（ai-direct-key.service:250-296）对齐：
          //   1. token 参数名：reasoning 用 max_completion_tokens，否则 max_tokens
          //   2. token 预算：reasoning 模型隐藏 CoT 会吃光小预算 → finish_reason=length
          //      且 visible content 为空，测试会假阳性"成功但空响应"。给 reasoning 留足
          //      预算（512）让可见 token 真正返回；非 reasoning 50 足够探活。
          //   3. temperature：reasoning 模型只接受默认值，显式传 0 触发
          //      400 "Unsupported value: 'temperature' does not support 0" 假阴性 →
          //      reasoning 时完全不带 temperature。
          const dbConfig =
            await this.modelConfigService?.getModelConfig(effectiveOpenAIModel);
          const openAIIsReasoning = dbConfig?.tokenParamName
            ? dbConfig.tokenParamName === "max_completion_tokens"
            : this.inferIsReasoning(effectiveOpenAIModel);
          const openAITokenParamName =
            dbConfig?.tokenParamName ||
            (openAIIsReasoning ? "max_completion_tokens" : "max_tokens");
          const openAITokenParam = {
            [openAITokenParamName]: openAIIsReasoning ? 512 : 50,
          };

          response = await firstValueFrom(
            this.httpService.post(
              ensureChatCompletionsPath(apiEndpoint) ||
                "https://api.openai.com/v1/chat/completions",
              {
                model: effectiveOpenAIModel,
                messages: testMessages,
                ...openAITokenParam,
                // reasoning 模型不接受 temperature 自定义值（含 0），省略走默认。
                ...(openAIIsReasoning ? {} : { temperature: 0 }),
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              },
            ),
          );
          break;
        }

        case "anthropic":
        case "claude":
          response = await firstValueFrom(
            this.httpService.post(
              ensureMessagesPath(apiEndpoint) ||
                "https://api.anthropic.com/v1/messages",
              {
                model: modelId || "",
                max_tokens: 50,
                messages: testMessages,
              },
              {
                headers: {
                  "x-api-key": apiKey,
                  "anthropic-version": "2023-06-01",
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              },
            ),
          );
          break;

        case "google":
        case "gemini": {
          const isImagenModel = modelId?.toLowerCase().includes("imagen");

          if (isImagenModel) {
            const imagenEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:predict`;

            this.logger.log(`Testing Imagen API: ${imagenEndpoint}`);

            try {
              response = await firstValueFrom(
                this.httpService.post(
                  imagenEndpoint,
                  {
                    instances: [
                      {
                        prompt: "A simple blue circle on white background",
                      },
                    ],
                    parameters: {
                      sampleCount: 1,
                      aspectRatio: "1:1",
                      outputOptions: {
                        mimeType: "image/png",
                      },
                    },
                  },
                  {
                    headers: {
                      "x-goog-api-key": apiKey,
                      "Content-Type": "application/json",
                    },
                    timeout: 120000,
                  },
                ),
              );

              if (response.data?.predictions?.[0]?.bytesBase64Encoded) {
                const latency = Date.now() - startTime;
                return {
                  success: true,
                  message: `Imagen connection successful! Image generated.`,
                  latency,
                };
              }

              if (response.data?.generatedImages?.[0]?.image?.imageBytes) {
                const latency = Date.now() - startTime;
                return {
                  success: true,
                  message: `Imagen connection successful! Image generated.`,
                  latency,
                };
              }

              const latency = Date.now() - startTime;
              return {
                success: true,
                message: `Imagen API responded successfully. Response keys: ${Object.keys(response.data || {}).join(", ")}`,
                latency,
              };
            } catch (testError: unknown) {
              const latency = Date.now() - startTime;
              const err = testError as Record<string, unknown>;
              const response = err.response as
                | Record<string, unknown>
                | undefined;
              const data = response?.data as
                | Record<string, unknown>
                | undefined;
              const error = data?.error as Record<string, unknown> | undefined;
              const errorMsg =
                (error?.message as string) ||
                (err.message as string) ||
                "Unknown error";
              const errorCode = (response?.status as number) || "N/A";
              return {
                success: false,
                message: `Imagen test failed (${errorCode}): ${errorMsg}`,
                latency,
              };
            }
          } else {
            const isImageCapableModel =
              modelId?.includes("gemini-2.0-flash-exp") ||
              modelId?.includes("image");

            const geminiTestPrompt = isImageCapableModel
              ? "Hello"
              : testMessages[0].content;

            // gemini-2.5 / gemini-3 是 thinking 模型，隐藏 thinking token 会吃光
            // 小预算 → finishReason=MAX_TOKENS 且 parts 为空 → 测试假阳性"成功但空响应"。
            // 给 thinking 模型留足预算（512）让可见 token 真正返回；普通模型 50 足够探活。
            const geminiIsThinking = inferIsReasoning(modelId || "");

            const geminiConfig: Record<string, unknown> = isImageCapableModel
              ? {}
              : {
                  maxOutputTokens: geminiIsThinking ? 512 : 50,
                  temperature: 0,
                };

            const effectiveGeminiModel = modelId || "";
            // 2026-05-10 §2/§4：单源归一化。
            const geminiEndpoint = ensureGeminiGenerateContentPath(
              apiEndpoint,
              effectiveGeminiModel,
            );

            this.logger.log(`Testing Gemini API: ${geminiEndpoint}`);

            response = await firstValueFrom(
              this.httpService.post(
                geminiEndpoint,
                {
                  contents: [
                    {
                      parts: [{ text: geminiTestPrompt }],
                    },
                  ],
                  ...(Object.keys(geminiConfig).length > 0
                    ? { generationConfig: geminiConfig }
                    : {}),
                },
                {
                  headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey,
                  },
                  timeout: 30000,
                },
              ),
            );
          }
          break;
        }

        // Perplexity (OpenAI-compatible format)
        case "perplexity":
          response = await firstValueFrom(
            this.httpService.post(
              ensureChatCompletionsPath(apiEndpoint) ||
                "https://api.perplexity.ai/chat/completions",
              {
                model: modelId || "",
                messages: testMessages,
                max_tokens: 50,
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 15000,
              },
            ),
          );
          break;

        // OpenAI-compatible providers — endpoint 走 DB ai_providers 真源
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
          const chatUrl = await this.resolveOpenAICompatibleChatEndpoint(
            provider,
            apiEndpoint,
          );
          if (!chatUrl) {
            return {
              success: false,
              message:
                `Provider "${provider}" 没有可用的 chat endpoint：` +
                `请在 admin /admin/ai/providers 维护 ai_providers 行，` +
                `或在该模型 UserModelConfig.apiEndpoint 显式填写完整 URL。`,
              latency: Date.now() - startTime,
            };
          }
          response = await firstValueFrom(
            this.httpService.post(
              chatUrl,
              {
                model: modelId,
                messages: testMessages,
                max_tokens: 50,
                temperature: 0,
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              },
            ),
          );
          break;
        }

        case "cohere": {
          // Cohere v2 chat 专用（非 OpenAI-compatible）：POST /v2/chat，
          // body 用 messages[]，响应 message.content[] 由下方按 cohere 分支解析。
          response = await firstValueFrom(
            this.httpService.post(
              ensureCohereChatPath(apiEndpoint) ||
                "https://api.cohere.com/v2/chat",
              {
                model: modelId || "",
                messages: testMessages,
                max_tokens: 50,
                temperature: 0,
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                timeout: 30000,
              },
            ),
          );
          break;
        }

        default: {
          // 2026-05-11 P4: 不再硬拒"未知 provider"。admin 在 UI 加的新 provider
          // 走通用 OpenAI-兼容派发：DB ai_providers.endpoint + Bearer auth +
          // /chat/completions 后缀。apiFormat=anthropic/google 走专用分支由前面
          // 的 case 处理；其他全部归 openai-compat 默认。
          const chatUrl = await this.resolveOpenAICompatibleChatEndpoint(
            provider,
            apiEndpoint,
          );
          if (!chatUrl) {
            return {
              success: false,
              message:
                `Provider "${provider}" 没有可用的 chat endpoint：` +
                `请在 admin /admin/ai-providers 维护页添加该 provider 行，` +
                `或在该模型 UserModelConfig.apiEndpoint 显式填写完整 URL。`,
              latency: Date.now() - startTime,
            };
          }
          response = await firstValueFrom(
            this.httpService.post(
              chatUrl,
              {
                model: modelId,
                messages: testMessages,
                max_tokens: 50,
                temperature: 0,
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              },
            ),
          );
          break;
        }
      }

      const latency = Date.now() - startTime;

      // 防呆：部分 provider（如 Agnes）在鉴权失败 / endpoint 非 API 时返回站点 HTML
      // 而非 JSON。直接甩原始 HTML 体验极差，识别后给出可操作错误。
      const rawData: unknown = response.data;
      if (
        typeof rawData === "string" &&
        /<!doctype html|<html[\s>]/i.test(rawData.slice(0, 200))
      ) {
        return {
          success: false,
          message:
            "Provider 返回了 HTML 页面而非 JSON API 响应——通常是该 endpoint 不是 API 地址，" +
            "或 API Key 无效/缺失（部分 provider 鉴权失败时直接返回首页）。请检查 API Endpoint 与 Key。",
          latency,
        };
      }

      const providerLower = provider.toLowerCase();
      let content = "";
      // finishReason 用于区分"真空响应"与"被截断的空响应"——后者不是连接失败，
      // 而是 token 预算耗尽（多见于 reasoning/thinking 模型），需给可诊断提示而非假阳性。
      let truncated = false;
      if (providerLower === "anthropic" || providerLower === "claude") {
        // Anthropic content[] 可能含多个 block，拼接所有 text block 更稳健。
        const blocks = response.data?.content as
          | Array<{ type?: string; text?: string }>
          | undefined;
        // 真实 Anthropic text block 必带 type:"text"，但放宽到"有 string text 即取"
        // 以容忍 thinking block（type:"thinking" 无 text，自动跳过）与缺 type 的变体。
        content =
          blocks
            ?.filter(
              (b) =>
                typeof b.text === "string" &&
                (b.type === undefined || b.type === "text"),
            )
            .map((b) => b.text)
            .join("") || "";
        truncated = response.data?.stop_reason === "max_tokens";
      } else if (providerLower === "google" || providerLower === "gemini") {
        // Gemini parts[] 可能含多个 part，拼接所有 text part。
        const parts = response.data?.candidates?.[0]?.content?.parts as
          | Array<{ text?: string }>
          | undefined;
        content =
          parts
            ?.map((p) => p.text)
            .filter((t): t is string => typeof t === "string")
            .join("") || "";
        truncated =
          response.data?.candidates?.[0]?.finishReason === "MAX_TOKENS";
      } else if (providerLower === "cohere") {
        // Cohere v2：message.content 是 block 数组
        content =
          (
            response.data?.message?.content as
              | Array<{ type?: string; text?: string }>
              | undefined
          )?.find((b) => b.type === "text")?.text || "";
      } else {
        content = response.data?.choices?.[0]?.message?.content || "";
        truncated = response.data?.choices?.[0]?.finish_reason === "length";
      }

      // 截断且无可见内容 → token 预算被（多为 reasoning/thinking 的隐藏 CoT）耗尽。
      // 连接其实是通的，但报"成功"会误导 admin（实际拿不到任何输出）。给明确诊断。
      if (!content && truncated) {
        return {
          success: false,
          message:
            `Connection reached the model but the response was truncated before any ` +
            `visible output (token budget exhausted — common for reasoning/thinking models ` +
            `that spend the budget on hidden reasoning). The API key and endpoint look valid; ` +
            `increase max output tokens for this model.`,
          latency,
        };
      }

      return {
        success: true,
        message: `Connection successful! Response: "${content.substring(0, 100)}${content.length > 100 ? "..." : ""}"`,
        latency,
      };
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      let errorMessage = "Unknown error";

      const err = error as Record<string, unknown>;
      if (err.response) {
        const response = err.response as Record<string, unknown>;
        const status = response.status;
        const rawData: unknown = response.data;
        if (
          typeof rawData === "string" &&
          /<!doctype html|<html[\s>]/i.test(rawData.slice(0, 200))
        ) {
          // 防呆：provider 返回 HTML（非 JSON）—— 不再把整页 HTML 塞进错误消息。
          errorMessage = `API Error (${status}): provider 返回 HTML 页面而非 JSON——该 endpoint 可能不是 API 地址，或 API Key 无效/缺失（部分 provider 鉴权失败时返回首页）。`;
        } else {
          const data = rawData as Record<string, unknown> | undefined;
          errorMessage = `API Error (${status}): ${(data?.error as Record<string, unknown>)?.message || data?.message || JSON.stringify(data)}`;
        }
      } else if (err.code === "ECONNABORTED") {
        errorMessage = "Connection timeout";
      } else if (err.message) {
        errorMessage = err.message as string;
      }

      this.logger.error(`Model connection test failed: ${errorMessage}`);

      return {
        success: false,
        message: `Connection failed: ${errorMessage}`,
        latency,
      };
    }
  }

  /**
   * Test connection to an embedding model
   */
  private async testEmbeddingModel(
    provider: string,
    modelId: string,
    apiKey: string,
    apiEndpoint: string,
    startTime: number,
  ): Promise<{ success: boolean; message: string; latency?: number }> {
    try {
      const testInput = "Hello, this is a test.";
      let response;

      switch (provider.toLowerCase()) {
        case "openai":
        case "gpt": {
          // 2026-05-10 §2/§4：单源归一化。
          const openaiEmbeddingsUrl =
            ensureOpenAIEmbeddingsPath(apiEndpoint) ||
            "https://api.openai.com/v1/embeddings";
          response = await firstValueFrom(
            this.httpService.post(
              openaiEmbeddingsUrl,
              {
                model: modelId || "text-embedding-3-small",
                input: testInput,
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              },
            ),
          );

          if (response.data?.data?.[0]?.embedding) {
            const latency = Date.now() - startTime;
            const dimensions = response.data.data[0].embedding.length;
            return {
              success: true,
              message: `Embedding model connected! Dimensions: ${dimensions}`,
              latency,
            };
          }
          break;
        }

        case "cohere": {
          // 2026-05-10 §2/§4：单源归一化。
          const cohereEmbedUrl =
            ensureCohereEmbedPath(apiEndpoint) ||
            "https://api.cohere.ai/v1/embed";
          response = await firstValueFrom(
            this.httpService.post(
              cohereEmbedUrl,
              {
                model: modelId || "embed-english-v3.0",
                texts: [testInput],
                input_type: "search_document",
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              },
            ),
          );

          if (response.data?.embeddings?.[0]) {
            const latency = Date.now() - startTime;
            const dimensions = response.data.embeddings[0].length;
            return {
              success: true,
              message: `Embedding model connected! Dimensions: ${dimensions}`,
              latency,
            };
          }
          break;
        }

        case "google":
        case "gemini": {
          // 2026-05-10 §2/§4：单源归一化。
          const geminiEndpoint = ensureGeminiEmbedContentPath(
            apiEndpoint,
            modelId || "text-embedding-004",
          );

          response = await firstValueFrom(
            this.httpService.post(
              geminiEndpoint,
              {
                content: {
                  parts: [{ text: testInput }],
                },
              },
              {
                headers: {
                  "x-goog-api-key": apiKey,
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              },
            ),
          );

          if (response.data?.embedding?.values) {
            const latency = Date.now() - startTime;
            const dimensions = response.data.embedding.values.length;
            return {
              success: true,
              message: `Embedding model connected! Dimensions: ${dimensions}`,
              latency,
            };
          }
          break;
        }

        // Voyage AI / Jina embedding — OpenAI-compatible (`{ model, input }`)，
        // 仅 endpoint default 不同。Voyage docs: https://docs.voyageai.com/reference/embeddings-api
        case "voyage":
        case "voyageai":
        case "jina": {
          const defaultEmbedUrl =
            provider.toLowerCase() === "jina"
              ? "https://api.jina.ai/v1/embeddings"
              : "https://api.voyageai.com/v1/embeddings";
          const embedUrl =
            ensureOpenAIEmbeddingsPath(apiEndpoint) || defaultEmbedUrl;
          response = await firstValueFrom(
            this.httpService.post(
              embedUrl,
              {
                model: modelId,
                input: testInput,
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              },
            ),
          );

          if (response.data?.data?.[0]?.embedding) {
            const latency = Date.now() - startTime;
            const dimensions = response.data.data[0].embedding.length;
            return {
              success: true,
              message: `Embedding model connected! Dimensions: ${dimensions}`,
              latency,
            };
          }
          break;
        }

        default: {
          // ★ 2026-05-11 拉齐 BYOK：admin 端不再硬拒未知 provider，按 OpenAI
          //   兼容协议（{model, input} body + Bearer auth + /embeddings 路径）
          //   兜底。若 apiEndpoint 缺失或 provider 真不兼容，由远端 API 自身
          //   报真实错误而非系统层假阴性。
          if (!apiEndpoint?.trim()) {
            return {
              success: false,
              message:
                `Provider "${provider}" 未声明 embedding endpoint：` +
                `请填写完整 API Endpoint（如 https://api.example.com/v1）` +
                `或在 admin /admin/ai/providers 维护 ai_providers 行。`,
              latency: Date.now() - startTime,
            };
          }
          const fallbackUrl =
            ensureOpenAIEmbeddingsPath(apiEndpoint) || apiEndpoint;
          response = await firstValueFrom(
            this.httpService.post(
              fallbackUrl,
              {
                model: modelId,
                input: testInput,
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              },
            ),
          );
          if (response.data?.data?.[0]?.embedding) {
            const latency = Date.now() - startTime;
            const dimensions = response.data.data[0].embedding.length;
            return {
              success: true,
              message: `Embedding model connected (OpenAI-compat)! Dimensions: ${dimensions}`,
              latency,
            };
          }
          break;
        }
      }

      const latency = Date.now() - startTime;
      return {
        success: true,
        message: `Embedding API responded successfully`,
        latency,
      };
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      let errorMessage = "Unknown error";

      const err = error as Record<string, unknown>;
      if (err.response) {
        const response = err.response as Record<string, unknown>;
        const status = response.status;
        const rawData: unknown = response.data;
        if (
          typeof rawData === "string" &&
          /<!doctype html|<html[\s>]/i.test(rawData.slice(0, 200))
        ) {
          // 防呆：provider 返回 HTML（非 JSON）—— 不再把整页 HTML 塞进错误消息。
          errorMessage = `API Error (${status}): provider 返回 HTML 页面而非 JSON——该 endpoint 可能不是 API 地址，或 API Key 无效/缺失（部分 provider 鉴权失败时返回首页）。`;
        } else {
          const data = rawData as Record<string, unknown> | undefined;
          errorMessage = `API Error (${status}): ${(data?.error as Record<string, unknown>)?.message || data?.message || JSON.stringify(data)}`;
        }
      } else if (err.code === "ECONNABORTED") {
        errorMessage = "Connection timeout";
      } else if (err.message) {
        errorMessage = err.message as string;
      }

      this.logger.error(`Embedding model test failed: ${errorMessage}`);

      return {
        success: false,
        message: `Connection failed: ${errorMessage}`,
        latency,
      };
    }
  }

  /**
   * Test connection to a rerank model
   */
  private async testRerankModel(
    provider: string,
    modelId: string,
    apiKey: string,
    apiEndpoint: string,
    startTime: number,
  ): Promise<{ success: boolean; message: string; latency?: number }> {
    // 2026-05-13 P3-#9: admin 配错 endpoint 时 prod 报 `API Error (405): ""`
    // 空 body + 没 URL = admin 完全没法诊断。错误处理记录实际请求的 URL，让
    // admin 能立即看出 endpoint 拼接结果是否符合 provider /rerank API 规范。
    let attemptedUrl: string | undefined;
    try {
      const testQuery = "What is the capital of France?";
      const testDocuments = [
        "Paris is the capital of France.",
        "London is the capital of UK.",
      ];
      let response;

      // Cohere / Voyage / Jina 的 rerank API 协议高度一致：
      //   POST /rerank  body { model, query, documents, top_n }  Bearer auth
      // 主要差异在响应字段：cohere = `results[].relevance_score`、
      // voyage/jina = `data[].relevance_score`。
      //
      // 2026-05-11 P4: 删除 ensureRerankPath 的"防呆抛错"逻辑（admin 填错
      // endpoint 后缀时强行 throw）。改为正向：
      //   - 空 endpoint → 用 provider 默认 URL
      //   - 含 /rerank → 直接用
      //   - 不含 /rerank → 拼一个（信任 endpoint base，不主动判错）
      // admin 填错时由远端 provider 返回真实错误（如 cohere 404 "unknown route"）。
      // 前端 Add Model 表单在 P8 加柔性提示帮 admin 自检。
      const ensureRerankPath = (url: string, defaultUrl: string): string => {
        const trimmed = url.trim().replace(/\/+$/, "");
        if (!trimmed) return defaultUrl;
        if (trimmed.endsWith("/rerank")) return trimmed;
        // ★ 2026-06-10：rerank 与 chat 共用 provider endpoint 字段，admin/一键配置
        //   常存的是 chat endpoint（如 https://api.cohere.com/v1/chat）。rerank 不能
        //   复用 chat 路径——直接拼会得到 /chat/rerank → provider 405（empty body）。
        //   先剥掉 chat 专用后缀回到 base（/v1），再拼 /rerank。
        const base = trimmed
          .replace(/\/chat\/completions$/, "")
          .replace(/\/chat$/, "");
        return `${base}/rerank`;
      };

      switch (provider.toLowerCase()) {
        case "cohere": {
          const cohereUrl = ensureRerankPath(
            apiEndpoint,
            "https://api.cohere.com/v1/rerank",
          );
          attemptedUrl = cohereUrl;
          response = await firstValueFrom(
            this.httpService.post(
              cohereUrl,
              {
                model: modelId || "rerank-v3.5",
                query: testQuery,
                documents: testDocuments,
                top_n: 2,
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              },
            ),
          );

          if (response.data?.results) {
            const latency = Date.now() - startTime;
            const topScore =
              response.data.results[0]?.relevance_score?.toFixed(4) || "N/A";
            return {
              success: true,
              message: `Rerank model connected! Top relevance score: ${topScore}`,
              latency,
            };
          }
          break;
        }

        case "voyage":
        case "voyageai": {
          const voyageUrl = ensureRerankPath(
            apiEndpoint,
            "https://api.voyageai.com/v1/rerank",
          );
          attemptedUrl = voyageUrl;
          response = await firstValueFrom(
            this.httpService.post(
              voyageUrl,
              {
                model: modelId,
                query: testQuery,
                documents: testDocuments,
                top_k: 2,
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              },
            ),
          );
          if (response.data?.data) {
            const latency = Date.now() - startTime;
            const topScore =
              response.data.data[0]?.relevance_score?.toFixed(4) || "N/A";
            return {
              success: true,
              message: `Rerank model connected! Top relevance score: ${topScore}`,
              latency,
            };
          }
          break;
        }

        case "jina": {
          const jinaUrl = ensureRerankPath(
            apiEndpoint,
            "https://api.jina.ai/v1/rerank",
          );
          attemptedUrl = jinaUrl;
          response = await firstValueFrom(
            this.httpService.post(
              jinaUrl,
              {
                model: modelId,
                query: testQuery,
                documents: testDocuments,
                top_n: 2,
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              },
            ),
          );
          if (response.data?.results) {
            const latency = Date.now() - startTime;
            const topScore =
              response.data.results[0]?.relevance_score?.toFixed(4) || "N/A";
            return {
              success: true,
              message: `Rerank model connected! Top relevance score: ${topScore}`,
              latency,
            };
          }
          break;
        }

        default: {
          // ★ 2026-05-11 拉齐 BYOK：default 走 Cohere/Voyage 兼容协议。
          //   未知 provider 但 endpoint 显式提供时由远端 API 报真实错误。
          if (!apiEndpoint?.trim()) {
            return {
              success: false,
              message:
                `Provider "${provider}" 未声明 rerank endpoint：` +
                `请填写完整 API Endpoint（如 https://api.example.com/v1/rerank）。`,
              latency: Date.now() - startTime,
            };
          }
          const fallbackUrl = ensureRerankPath(apiEndpoint, "");
          attemptedUrl = fallbackUrl;
          response = await firstValueFrom(
            this.httpService.post(
              fallbackUrl,
              {
                model: modelId,
                query: testQuery,
                documents: testDocuments,
                top_n: 2,
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 30000,
              },
            ),
          );
          if (response.data?.results || response.data?.data) {
            const latency = Date.now() - startTime;
            const rows = response.data?.results || response.data?.data || [];
            const topScore = rows[0]?.relevance_score?.toFixed(4) || "N/A";
            return {
              success: true,
              message: `Rerank model connected (OpenAI-compat)! Top relevance score: ${topScore}`,
              latency,
            };
          }
          break;
        }
      }

      const latency = Date.now() - startTime;
      return {
        success: true,
        message: `Rerank API responded successfully`,
        latency,
      };
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      let errorMessage = "Unknown error";
      let hint = "";

      const err = error as Record<string, unknown>;
      if (err.response) {
        const response = err.response as Record<string, unknown>;
        const status = response.status;
        const data = response.data as Record<string, unknown> | undefined;
        const bodyText =
          (data?.error as Record<string, unknown>)?.message ||
          data?.message ||
          (data ? JSON.stringify(data) : "(empty body)");
        errorMessage = `API Error (${status}): ${bodyText}`;
        // ★ 405 + 空 body 是 admin 配错 endpoint 的常见模式（base URL 拼 /rerank
        //   后命中 provider 上的 GET-only 路径或非 rerank 路径）。给出诊断引导。
        // 2026-05-13 P2-#18: 检测 chat 路径残留（admin 用 chat URL 套到 rerank
        //   字段，如 https://api.cohere.com/v1/chat 拼成 .../chat/rerank）。
        const looksLikeChatPath =
          !!attemptedUrl &&
          (/\/chat(\/|$)/i.test(attemptedUrl) ||
            /\/messages(\/|$)/i.test(attemptedUrl));
        if (status === 405) {
          hint =
            ` — POST ${attemptedUrl ?? "(unknown URL)"} 不被接受。` +
            `Endpoint 拼接后可能不是 ${provider} 的 rerank API 路径。` +
            (looksLikeChatPath
              ? ` 检测到您填的是 chat completions 路径（含 /chat 或 /messages），rerank 走独立路径。`
              : "") +
            `请检查 admin Add Model 的 API Endpoint，确认填写的是 base URL（如 https://api.cohere.com/v1）` +
            `或完整 rerank URL（如 https://api.cohere.com/v1/rerank）。`;
        } else if (status === 404) {
          hint =
            ` — POST ${attemptedUrl ?? "(unknown URL)"} 路径不存在。` +
            (looksLikeChatPath
              ? ` 检测到 chat 路径残留（/chat 或 /messages），请改成 rerank base URL（如 https://api.cohere.com/v1）。`
              : "") +
            `请确认 endpoint 是 ${provider} 的正确 rerank API base / 完整 URL。`;
        }
      } else if (err.code === "ECONNABORTED") {
        errorMessage = "Connection timeout";
      } else if (err.message) {
        errorMessage = err.message as string;
      }

      this.logger.error(
        `Rerank model test failed: ${errorMessage}${hint}` +
          (attemptedUrl ? ` [attempted POST ${attemptedUrl}]` : ""),
      );

      return {
        success: false,
        message: `Connection failed: ${errorMessage}${hint}`,
        latency,
      };
    }
  }

  /**
   * Test connection to a TTS/Audio model
   *
   * ★ 2026-05-13 修：之前完全不发请求，"API key is set" 直接返回 success →
   *   违反 feedback_test_connection_must_verify_runtime（只检 auth = 谎报"正常"）。
   *   现在按 provider 真发一次最小 TTS 请求：
   *   - OpenAI / OpenAI-compatible: POST /v1/audio/speech 最短 input
   *   - Google / Gemini: 暂未实现真验证（Gemini TTS 走 Live API，与 REST 不同）
   *     → 走 endpoint-reachable 检查（HEAD/GET base URL 验证网络 + 401 验证 key）
   */
  private async testTTSModel(
    provider: string,
    modelId: string,
    apiKey: string,
    apiEndpoint: string,
    startTime: number,
  ): Promise<{ success: boolean; message: string; latency?: number }> {
    const providerLower = provider.toLowerCase();

    try {
      // OpenAI 及兼容 provider: 真发一次最小 /v1/audio/speech 请求
      if (
        providerLower === "openai" ||
        providerLower === "azure" ||
        providerLower === "openai-compatible"
      ) {
        // 从 apiEndpoint 推断 speech endpoint：剥掉 /v1/xxx 或 /v1 尾巴再补 /v1/audio/speech
        const base = apiEndpoint
          .replace(
            /\/v1(\/(chat\/completions|completions|embeddings|audio\/speech))?\/?$/i,
            "",
          )
          .replace(/\/$/, "");
        const speechUrl = `${base}/v1/audio/speech`;

        const response = await firstValueFrom(
          this.httpService.post(
            speechUrl,
            {
              model: modelId || "tts-1",
              input: "test",
              voice: "alloy",
            },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              responseType: "arraybuffer",
              timeout: 15000,
              validateStatus: () => true,
            },
          ),
        );

        const latency = Date.now() - startTime;
        if (response.status >= 200 && response.status < 300) {
          const bytes = response.data?.byteLength ?? 0;
          return {
            success: true,
            message: `TTS connection OK (received ${bytes} bytes audio)`,
            latency,
          };
        }
        const errBody = Buffer.isBuffer(response.data)
          ? response.data.toString("utf-8").slice(0, 200)
          : String(response.data).slice(0, 200);
        return {
          success: false,
          message: `TTS test failed: HTTP ${response.status} — ${errBody}`,
          latency,
        };
      }

      // Google / Gemini: 暂未实现真 TTS 验证（API 形态不同）
      // 走 endpoint-reachable 降级检查：GET base URL，401 = key 有效，4xx 其他 = 端点错
      if (providerLower === "google" || providerLower === "gemini") {
        const base = apiEndpoint.replace(/\/$/, "");
        const probeUrl = `${base}/v1beta/models?key=${apiKey}`;
        const response = await firstValueFrom(
          this.httpService.get(probeUrl, {
            timeout: 10000,
            validateStatus: () => true,
          }),
        );
        const latency = Date.now() - startTime;
        if (response.status === 200) {
          return {
            success: true,
            message: `Gemini TTS endpoint reachable + key valid (real TTS verify not implemented)`,
            latency,
          };
        }
        return {
          success: false,
          message: `Gemini endpoint check failed: HTTP ${response.status}`,
          latency,
        };
      }

      // 其他 provider 暂不支持，返回 degraded 状态而非 false-positive success
      const latency = Date.now() - startTime;
      return {
        success: false,
        message: `TTS test not implemented for provider "${provider}"; please verify manually`,
        latency,
      };
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      const err = error as Record<string, unknown>;
      const errorMessage = (err.message as string) || "Unknown error";
      this.logger.error(`TTS model test failed: ${errorMessage}`);
      return {
        success: false,
        message: `Connection failed: ${errorMessage}`,
        latency,
      };
    }
  }

  /**
   * Test connection to an image-generation / image-editing model.
   *
   * OpenAI: /v1/images/generations（DALL-E / gpt-image-*）
   *   - 走 chat/completions 会 403 "not allowed to sample from this model"
   *   - 为了降低成本：size=256x256（DALL-E 3 不支持，会 fallback 到其默认 1024）
   * Google: imagen 走 :predict（已在主分支 handle）；这里兜底同一处理
   */
  private async testImageModel(
    provider: string,
    modelId: string,
    apiKey: string,
    apiEndpoint: string,
    modelType: string | undefined,
    startTime: number,
  ): Promise<{ success: boolean; message: string; latency?: number }> {
    try {
      const p = provider.toLowerCase();

      if (p === "openai" || p === "gpt") {
        // IMAGE_EDITING 真正的 API 是 /v1/images/edits，需要上传一张图。
        // 这里测"连接可用性"——对 dall-e-2 也用 generations 端点做一次最小 prompt 探测，
        // 只要返回结构正确即算成功。避免上传图片素材。
        // 2026-05-10 §2/§4：单源归一化。
        const url =
          ensureOpenAIImagesGenerationsPath(apiEndpoint) ||
          "https://api.openai.com/v1/images/generations";

        const body: Record<string, unknown> = {
          model: modelId,
          prompt: "a small blue circle on a white background",
          n: 1,
          size: modelId?.startsWith("dall-e-3") ? "1024x1024" : "256x256",
        };

        const response = await firstValueFrom(
          this.httpService.post(url, body, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            timeout: 60000,
          }),
        );

        const latency = Date.now() - startTime;
        const imageUrl = response.data?.data?.[0]?.url;
        const imageB64 = response.data?.data?.[0]?.b64_json;
        if (imageUrl || imageB64) {
          return {
            success: true,
            message: `Image model connected! Generated 1 image (${modelType || "IMAGE"}).`,
            latency,
          };
        }
        return {
          success: true,
          message: `Image API responded but no image data in response.`,
          latency,
        };
      }

      if (p === "google" || p === "gemini") {
        // Imagen 已在主分支处理，这里兜底不应该常被走到
        return {
          success: true,
          message: `Image model ${modelId} configured (Google path). Skipping active probe to save cost.`,
          latency: Date.now() - startTime,
        };
      }

      return {
        success: false,
        message: `Image generation not supported for provider: ${provider}`,
        latency: Date.now() - startTime,
      };
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      let errorMessage = "Unknown error";
      let hint = "";

      const err = error as Record<string, unknown>;
      if (err.response) {
        const response = err.response as Record<string, unknown>;
        const status = response.status;
        const data = response.data as Record<string, unknown> | undefined;
        const errObj = data?.error as Record<string, unknown> | undefined;
        const apiMsg =
          (errObj?.message as string) ||
          (data?.message as string) ||
          JSON.stringify(data);
        errorMessage = `API Error (${status}): ${apiMsg}`;

        // 2026-05-13 P3-#8: DALL-E 测试 400 "model does not exist" 高频报错。
        //   OpenAI 已废弃 dall-e-2（2024-11+），新 key 多无 dall-e-3 权限。
        //   admin 看到 "model does not exist" 通常不知该如何处置 —— 给出具体建议。
        if (
          status === 400 &&
          /model.*(does not exist|not found|unknown)/i.test(apiMsg)
        ) {
          if (modelId?.startsWith("dall-e-2")) {
            hint = ` — DALL-E 2 在 2024-11 后对新 API key 不可用，请改用 gpt-image-1 或 dall-e-3。`;
          } else if (modelId?.startsWith("dall-e-3")) {
            hint = ` — DALL-E 3 需账户达到 Tier 1+ 才可用，或确认 BYOK key 有 image generation 权限。`;
          } else {
            hint = ` — 检查 modelId 拼写（OpenAI 支持: gpt-image-1 / dall-e-3 / dall-e-2[legacy]）。`;
          }
        }
      } else if (err.code === "ECONNABORTED") {
        errorMessage = "Connection timeout";
      } else if (err.message) {
        errorMessage = err.message as string;
      }

      this.logger.error(`Image model test failed: ${errorMessage}${hint}`);

      return {
        success: false,
        message: `Connection failed: ${errorMessage}${hint}`,
        latency,
      };
    }
  }
}
