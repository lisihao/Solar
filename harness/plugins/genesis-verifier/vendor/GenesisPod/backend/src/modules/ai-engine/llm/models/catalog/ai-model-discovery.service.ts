import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { UserApiKeysService } from "../../../../platform/credentials/user-owned/user-api-keys/user-api-keys.service";
import { sortByRecencyDesc } from "./model-recency.util";

export interface DiscoveredModel {
  id: string;
  name: string;
  description?: string;
  /** provider 返回的创建时间（OpenAI /v1/models 的 epoch 秒）；用于 newest-first 排序 */
  created?: number;
}

export interface FetchModelsResult {
  success: boolean;
  models?: DiscoveredModel[];
  error?: string;
}

/**
 * AI Model Discovery Service
 * 职责：从各 Provider API 获取可用模型列表
 *
 * 从 AiChatService 提取，处理：
 * - 各 Provider 的模型列表 API 调用
 * - 模型过滤（按 modelType）
 * - 静态模型列表（无 API 的 provider）
 */
@Injectable()
export class AiModelDiscoveryService {
  private readonly logger = new Logger(AiModelDiscoveryService.name);

  constructor(
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => UserApiKeysService))
    private readonly userApiKeysService: UserApiKeysService,
  ) {}

  /**
   * Format a model ID into a user-friendly display name
   */
  formatModelDisplayName(model: string): string {
    const modelLower = model.toLowerCase();

    if (modelLower.includes("gemini")) {
      if (modelLower.includes("flash")) return "Gemini Flash";
      if (modelLower.includes("pro")) return "Gemini Pro";
      if (modelLower.includes("imagen")) return "Gemini Imagen";
      return "Gemini";
    }
    if (modelLower.includes("grok")) return "Grok";
    if (modelLower.includes("gpt-4")) return "GPT-4";
    if (modelLower.includes("gpt-5")) return "GPT-5";
    if (modelLower.startsWith("o1")) return "OpenAI o1";
    if (modelLower.startsWith("o3")) return "OpenAI o3";
    if (modelLower.includes("claude")) {
      if (modelLower.includes("opus")) return "Claude Opus";
      if (modelLower.includes("sonnet")) return "Claude Sonnet";
      if (modelLower.includes("haiku")) return "Claude Haiku";
      return "Claude";
    }
    if (modelLower.includes("dall-e")) return "DALL-E";

    return model;
  }

  /**
   * Get the environment variable name for a provider's API key
   */
  getEnvVarNameForProvider(provider: string): string {
    const providerLower = provider.toLowerCase();
    if (providerLower === "minimax") return "MINIMAX_API_KEY";
    if (providerLower === "openrouter") return "OPENROUTER_API_KEY";
    if (providerLower === "groq") return "GROQ_API_KEY";
    if (providerLower === "xai" || providerLower === "grok")
      return "XAI_API_KEY";
    if (providerLower === "openai" || providerLower === "gpt")
      return "OPENAI_API_KEY";
    if (providerLower === "anthropic" || providerLower === "claude")
      return "ANTHROPIC_API_KEY";
    if (providerLower === "google" || providerLower === "gemini")
      return "GOOGLE_AI_API_KEY";
    return `${provider.toUpperCase()}_API_KEY`;
  }

  /**
   * Fetch available models from a provider's API
   * Returns list of model IDs and their metadata
   * @param modelType - Filter by model type: CHAT, CHAT_FAST, EMBEDDING, IMAGE_GENERATION, RERANK, etc.
   */
  async fetchAvailableModels(
    provider: string,
    apiKey: string,
    apiEndpoint?: string,
    modelType?: string,
  ): Promise<FetchModelsResult> {
    if (!apiKey) {
      return { success: false, error: "API key is required" };
    }

    try {
      // ★ 2026-05-27 数据驱动重构 (用户实证: 硬编码 provider 名字反模式):
      //   1. 从 DB ai_providers 查 (slug → apiFormat + 默认 endpoint)
      //   2. effective endpoint = 用户传入 > DB > 报错
      //   3. 按 apiFormat (openai/anthropic/google/cohere) 路由到 4 个协议处理器
      //   完全没有硬编码 provider 名字; 新增 provider 只需在 ai_providers 表加行。
      const defaults = await this.userApiKeysService.resolveProviderDefaults(
        provider.toLowerCase(),
      );
      const endpointResolved = (
        apiEndpoint?.trim() ||
        defaults?.endpoint ||
        ""
      ).replace(/\/+$/, "");
      const apiFormat = (defaults?.apiFormat || "openai").toLowerCase();

      if (!endpointResolved) {
        return {
          success: false,
          error: `Provider "${provider}" not in catalog and no endpoint provided. Please add the provider in API Keys tab or pass apiEndpoint explicitly.`,
        };
      }

      switch (apiFormat) {
        case "anthropic":
          return await this.fetchAnthropicModels(
            apiKey,
            modelType,
            endpointResolved,
          );
        case "google":
          return await this.fetchGeminiModelsAt(
            endpointResolved,
            apiKey,
            modelType,
          );
        case "cohere":
          return await this.fetchCohereModels(
            apiKey,
            modelType,
            endpointResolved,
          );
        case "openai":
        default: {
          // OpenAI-compatible /models — 覆盖 OpenAI / xAI / DeepSeek / Qwen /
          // Doubao / Zhipu / Kimi / MiniMax / OpenRouter / Groq / 自建 vLLM 等。
          // 幂等：用户把 endpoint 误填成 .../v1/models 时不再二次追加成 .../models/models。
          const url = endpointResolved.endsWith("/models")
            ? endpointResolved
            : endpointResolved + "/models";
          return await this.fetchOpenAICompatibleModels(
            url,
            apiKey,
            provider,
            modelType,
          );
        }
      }
    } catch (error: unknown) {
      const errorResponse = (
        error as {
          response?: {
            data?: { error?: { message?: string } | string; message?: string };
            status?: number;
          };
        }
      ).response;
      const errorData = errorResponse?.data;
      const apiError =
        (typeof errorData?.error === "object" && errorData.error !== null
          ? (errorData.error as { message?: string }).message
          : null) ||
        errorData?.message ||
        (typeof errorData?.error === "string" ? errorData.error : null) ||
        null;
      const statusCode = errorResponse?.status;

      this.logger.error(
        `Failed to fetch models for ${provider}: status=${statusCode}, apiError=${JSON.stringify(apiError)}, message=${error instanceof Error ? error.message : String(error)}`,
      );

      const errorMessage =
        (typeof apiError === "string"
          ? apiError
          : (apiError as { message?: string } | null)?.message) ||
        (error instanceof Error ? error.message : null) ||
        "Unknown error";
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Fetch models from Google Gemini API
   * ★ 2026-05-27: 默认 endpoint hardcoded fallback 用 official URL (与原行为兼容);
   *   fetchGeminiModelsAt 接受自定义 endpoint (走数据驱动路径)。
   */
  private async fetchGeminiModelsAt(
    endpointBase: string,
    apiKey: string,
    modelType?: string,
  ): Promise<FetchModelsResult> {
    // endpointBase 是 provider base (如 .../v1beta), 需拼 /models 才是 list 端点。
    // 不补 /models 会打到 GET /v1beta → Google 返 404。
    const base = endpointBase.replace(/\/+$/, "");
    const withModels = base.endsWith("/models") ? base : `${base}/models`;
    const sep = withModels.includes("?") ? "&" : "?";
    return this.fetchGeminiImpl(`${withModels}${sep}key=${apiKey}`, modelType);
  }
  private async fetchGeminiImpl(
    fullUrl: string,
    modelType?: string,
  ): Promise<FetchModelsResult> {
    const response = await firstValueFrom(
      this.httpService.get(fullUrl, {
        timeout: 30000,
      }),
    );

    const allModels = response.data?.models || [];
    let filteredModels: Array<{
      name: string;
      displayName?: string;
      description?: string;
      supportedGenerationMethods?: string[];
    }>;

    if (modelType === "EMBEDDING") {
      filteredModels = allModels.filter(
        (m: { name: string; supportedGenerationMethods?: string[] }) => {
          const name = m.name.toLowerCase();
          return (
            name.includes("embedding") ||
            name.includes("text-embedding") ||
            m.supportedGenerationMethods?.includes("embedContent")
          );
        },
      );
    } else if (
      modelType === "IMAGE_GENERATION" ||
      modelType === "IMAGE_EDITING"
    ) {
      filteredModels = allModels.filter((m: { name: string }) => {
        const name = m.name.toLowerCase();
        return name.includes("imagen");
      });
    } else if (modelType === "MULTIMODAL") {
      filteredModels = allModels.filter(
        (m: { name: string; supportedGenerationMethods?: string[] }) => {
          const name = m.name.toLowerCase();
          return (
            name.includes("gemini") &&
            m.supportedGenerationMethods?.includes("generateContent")
          );
        },
      );
    } else {
      filteredModels = allModels.filter(
        (m: { name: string; supportedGenerationMethods?: string[] }) => {
          const name = m.name.toLowerCase();
          return (
            name.includes("gemini") &&
            m.supportedGenerationMethods?.includes("generateContent") &&
            !name.includes("embedding")
          );
        },
      );
    }

    // ★ Gemini /v1beta/models 无 `created` 字段；旧实现按字母升序排，导致
    //   gemini-1.5-pro 排在 gemini-2.5-pro 前面 → auto-configure 选到旧代。
    //   改为版本号降序（newest-first），让代际通配 pattern 命中最新代。
    const mapped = filteredModels.map((m) => {
      const modelId = m.name.replace("models/", "");
      return {
        id: modelId,
        name: m.displayName || modelId,
        description: m.description || `Google ${m.displayName}`,
      };
    });

    return {
      success: true,
      models: sortByRecencyDesc(mapped),
    };
  }

  /**
   * Fetch models from OpenAI-compatible API (DeepSeek, Qwen, Moonshot, etc.)
   */
  private async fetchOpenAICompatibleModels(
    endpoint: string,
    apiKey: string,
    providerName: string,
    modelType?: string,
  ): Promise<FetchModelsResult> {
    if (
      modelType === "IMAGE_GENERATION" ||
      modelType === "IMAGE_EDITING" ||
      modelType === "RERANK"
    ) {
      return { success: true, models: [] };
    }

    const response = await firstValueFrom(
      this.httpService.get<{
        data?: Array<{ id: string; description?: string; created?: number }>;
      }>(endpoint, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 30000,
      }),
    );

    let models = response.data?.data || [];

    if (modelType === "EMBEDDING") {
      models = models.filter(
        (m) => m.id.includes("embed") || m.id.includes("embedding"),
      );
    }

    // ★ newest-first：OpenAI /v1/models 返回带 `created` epoch 但顺序随机，
    //   不排序会让 auto-configure 的代际通配 pattern 命中列表里第一个匹配项
    //   （可能是旧版 gpt-4o 而非 gpt-5.4）。统一过 sortByRecencyDesc：
    //   有 created 按时间降序，无 created（部分 OpenAI 兼容 provider）按版本号兜底。
    return {
      success: true,
      models: sortByRecencyDesc(
        models.map((m) => ({
          id: m.id,
          name: m.id,
          description: m.description || `${providerName} ${m.id}`,
          created: m.created,
        })),
      ),
    };
  }

  // ─── 2026-05-05 动态发现（替代 hardcoded）─────────────────────────
  // anthropic / cohere /v1/models 均 best-effort：拿到模型 → 返；
  // 网络/解析失败 → throw 让 caller 兜底（本次请求内一次性返，不缓存）。

  /**
   * Anthropic GET /v1/models（自家协议，2024-11 起官方支持）
   *   header: x-api-key + anthropic-version: 2023-06-01
   *   response: { data: [{id, display_name, capabilities, ...}] }
   */
  private async fetchAnthropicModels(
    apiKey: string,
    modelType?: string,
    endpointBase?: string,
  ): Promise<FetchModelsResult> {
    // endpointBase 是 provider base (默认 https://api.anthropic.com), 拼 /v1/models
    const base = (endpointBase || "https://api.anthropic.com").replace(
      /\/+$/,
      "",
    );
    const url = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
    try {
      const response = await firstValueFrom(
        this.httpService.get<{
          data: Array<{
            id: string;
            display_name?: string;
            type: string;
          }>;
        }>(url, {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          timeout: 30000,
          params: { limit: 1000 },
        }),
      );
      let models = (response.data?.data ?? []).map((m) => ({
        id: m.id,
        name: m.display_name || m.id,
        description: m.display_name || m.id,
      }));
      // Anthropic 只提供 chat 模型，EMBEDDING / RERANK 类型直接返空
      if (modelType === "EMBEDDING" || modelType === "RERANK") {
        models = [];
      }
      // ★ Anthropic /v1/models 默认 newest-first，但不作保证；统一过版本号降序
      //   让代际通配（claude-opus-4-x / claude-sonnet-4-x）稳定命中最新代。
      return { success: true, models: sortByRecencyDesc(models) };
    } catch (err) {
      this.logger.warn(
        `[fetchAnthropicModels] failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        success: false,
        error: "Anthropic /v1/models call failed — check API key and network.",
      };
    }
  }

  /**
   * Cohere GET /v1/models?endpoint=embed|rerank|chat（官方支持 endpoint 过滤）
   */
  private async fetchCohereModels(
    apiKey: string,
    modelType?: string,
    endpointBase?: string,
  ): Promise<FetchModelsResult> {
    const endpointFilter =
      modelType === "EMBEDDING"
        ? "embed"
        : modelType === "RERANK"
          ? "rerank"
          : "chat";
    // Cohere 模型列表端点固定在 /v1/models（embed/chat 在 v2，但 listing 是 v1）。
    // DB ai_providers.endpoint 存 `https://api.cohere.com/v2` → 必须剥掉尾部版本段
    // 再拼 /v1/models，否则得到 `/v2/v1/models`（404，cohere 获取按钮一直坏）。
    const base = (endpointBase || "https://api.cohere.com")
      .replace(/\/+$/, "")
      .replace(/\/v[12]$/, "");
    const url = `${base}/v1/models`;
    try {
      const response = await firstValueFrom(
        this.httpService.get<{
          models: Array<{
            name: string;
            is_deprecated?: boolean;
            endpoints?: string[];
            context_length?: number;
          }>;
        }>(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 30000,
          params: { endpoint: endpointFilter, page_size: 1000 },
        }),
      );
      const models = (response.data?.models ?? [])
        .filter((m) => !m.is_deprecated)
        .map((m) => ({
          id: m.name,
          name: m.name,
          description: m.context_length
            ? `Cohere ${m.name} (ctx=${m.context_length})`
            : `Cohere ${m.name}`,
        }));
      return { success: true, models };
    } catch (err) {
      this.logger.warn(
        `[fetchCohereModels] failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        success: false,
        error: "Cohere /v1/models call failed — check API key and network.",
      };
    }
  }
}
