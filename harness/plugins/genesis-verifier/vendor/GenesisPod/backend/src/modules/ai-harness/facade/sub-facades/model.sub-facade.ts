/**
 * ModelSubFacade
 * Handles model selection and configuration queries.
 * Plain TypeScript class — NOT @Injectable. Instantiated by AIFacade.
 */

import { Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import type { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import type { AiModelConfigService } from "../../../ai-engine/llm/models/config/ai-model-config.service";
import type { ModelFallbackService } from "../../../ai-engine/llm/models/selection/model-fallback.service";
import type { OrchestrationFeature } from "../facade.providers";
import type { ModelResolverService } from "../model-resolver.service";
import type { ModelInfo, ModelSelectionOptions } from "../types";

export class ModelSubFacade {
  private readonly logger = new Logger(ModelSubFacade.name);

  constructor(
    private readonly aiChatService: AiChatService,
    private readonly modelConfigService: AiModelConfigService,
    private readonly modelFallbackService?: ModelFallbackService,
    private readonly orchestration?: OrchestrationFeature,
    private readonly modelResolver?: ModelResolverService,
  ) {}

  async selectModel(
    options: ModelSelectionOptions = {},
  ): Promise<ModelInfo | null> {
    if (this.modelResolver) {
      return this.modelResolver.selectModel(options);
    }

    this.logger.log(
      `[selectModel] Starting selection with options=${JSON.stringify(options)}`,
    );

    const models = await this.getAvailableModelsExtended(
      options.modelType || AIModelType.CHAT,
    );

    this.logger.log(
      `[selectModel] Found ${models.length} models: ${models.map((m) => `${m.id}(reasoning=${m.isReasoning})`).join(", ")}`,
    );

    if (models.length === 0) {
      this.logger.error("[selectModel] No models available!");
      return null;
    }

    let candidates = models;

    // 1. Filter reasoning models
    if (options.requireReasoning) {
      const reasoningModels = candidates.filter((m) => m.isReasoning);
      this.logger.log(
        `[selectModel] Reasoning filter: found ${reasoningModels.length} reasoning models`,
      );
      if (reasoningModels.length === 0) {
        this.logger.warn(
          "[selectModel] No reasoning models found, falling back to all models",
        );
      } else {
        candidates = reasoningModels;
      }
    }

    // 2. Filter by provider
    if (options.preferredProvider) {
      const preferred = candidates.filter(
        (m) =>
          m.provider.toLowerCase() === options.preferredProvider?.toLowerCase(),
      );
      if (preferred.length > 0) {
        candidates = preferred;
        this.logger.debug(
          `[selectModel] Provider filter: ${candidates.length} candidates for ${options.preferredProvider}`,
        );
      }
    }

    // 2.5 Filter blocked models
    if (this.modelFallbackService) {
      const unblocked = candidates.filter(
        (m) => !this.modelFallbackService!.isModelBlocked(m.id),
      );
      if (unblocked.length > 0) {
        if (unblocked.length < candidates.length) {
          const blocked = candidates
            .filter((m) => this.modelFallbackService!.isModelBlocked(m.id))
            .map((m) => m.id);
          this.logger.warn(
            `[selectModel] Filtered blocked models: ${blocked.join(", ")}`,
          );
        }
        candidates = unblocked;
      } else {
        this.logger.warn(
          "[selectModel] All candidates blocked, keeping original list as fallback",
        );
      }
    }

    // 3. Filter by maxTokens
    if (options.minMaxTokens) {
      const filtered = candidates.filter(
        (m) => (m.maxTokens || 0) >= (options.minMaxTokens || 0),
      );
      if (filtered.length > 0) {
        candidates = filtered;
      }
    }

    // 4. Circuit breaker selection
    if (this.orchestration?.circuitBreaker) {
      const entityIds = candidates.map((m) => `chat:${m.id}`);
      const bestEntityId =
        this.orchestration.circuitBreaker.selectBest(entityIds);

      if (bestEntityId) {
        const modelId = bestEntityId.replace("chat:", "");
        const selected = candidates.find((m) => m.id === modelId);
        if (selected) {
          this.logger.log(
            `[selectModel] Selected ${modelId} via circuit breaker`,
          );
          return selected;
        }
      }
    }

    // 5. Return first available
    const selected = candidates[0] || null;
    this.logger.log(`[selectModel] Selected ${selected?.id || "NONE"}`);
    return selected;
  }

  async getReasoningModel(): Promise<ModelInfo | null> {
    return this.selectModel({ requireReasoning: true });
  }

  async getAvailableModelsExtended(
    modelType: AIModelType = AIModelType.CHAT,
  ): Promise<ModelInfo[]> {
    if (this.modelResolver) {
      return this.modelResolver.getAvailableModelsExtended(modelType);
    }

    this.logger.debug(
      `[getAvailableModelsExtended] Querying models with modelType=${modelType}`,
    );

    const models =
      await this.modelConfigService.getAllEnabledModelsByType(modelType);

    this.logger.log(
      `[getAvailableModelsExtended] Found ${models.length} models`,
    );

    return models.map((m) => {
      const isReasoning =
        m.isReasoning ?? this.aiChatService.isReasoningModel(m.modelId);
      const isBlocked =
        this.modelFallbackService?.isModelBlocked(m.modelId) ?? false;
      const isAvailable =
        !isBlocked &&
        (this.orchestration?.circuitBreaker?.canExecute(`chat:${m.modelId}`) ??
          true);

      return {
        id: m.modelId,
        dbId: m.id,
        name: m.displayName || m.modelId,
        provider: m.provider,
        isReasoning,
        isAvailable,
        maxTokens: m.maxTokens,
        icon: undefined,
        isDefault: m.isDefault,
      };
    });
  }

  async getAvailableModels(modelType: AIModelType = AIModelType.CHAT): Promise<
    Array<{
      id: string;
      dbId?: string;
      name: string;
      provider: string;
      icon?: string | null;
      isDefault?: boolean;
    }>
  > {
    if (this.modelResolver) {
      return this.modelResolver.getAvailableModels(modelType);
    }

    this.logger.debug(`[getAvailableModels] modelType=${modelType}`);

    const models =
      await this.modelConfigService.getEnabledModelsForFrontend(modelType);

    return models.map((m) => ({
      id: m.modelId,
      dbId: m.id,
      name: m.name,
      provider: m.provider,
      icon: m.icon,
      isDefault: m.isDefault,
    }));
  }

  async getDefaultTextModel(): Promise<{
    id: string;
    modelId: string;
    displayName: string;
    provider: string;
    maxTokens?: number;
  } | null> {
    if (this.modelResolver) {
      return this.modelResolver.getDefaultTextModel();
    }
    const config = await this.aiChatService.getDefaultModelByType(
      AIModelType.CHAT,
    );
    if (!config) return null;
    return {
      id: config.id || config.modelId,
      modelId: config.modelId,
      displayName: config.displayName || config.modelId,
      provider: config.provider,
      maxTokens: config.maxTokens,
    };
  }

  async getDefaultImageModel(): Promise<{
    id: string;
    modelId: string;
    displayName: string;
    provider: string;
    maxTokens?: number;
  } | null> {
    if (this.modelResolver) {
      return this.modelResolver.getDefaultImageModel();
    }
    const config = await this.aiChatService.getDefaultModelByType(
      AIModelType.IMAGE_GENERATION,
    );
    if (!config) return null;
    return {
      id: config.id || config.modelId,
      modelId: config.modelId,
      displayName: config.displayName || config.modelId,
      provider: config.provider,
      maxTokens: config.maxTokens,
    };
  }

  async getModelById(idOrModelId: string): Promise<{
    id: string;
    modelId: string;
    displayName: string;
    provider: string;
    maxTokens?: number;
    apiEndpoint?: string;
    isReasoning?: boolean;
    apiKey?: string | null;
    secretKey?: string | null;
    modelType?: string;
  } | null> {
    if (this.modelResolver) {
      return this.modelResolver.getModelById(idOrModelId);
    }
    const config = await this.modelConfigService.getModelById(idOrModelId);

    if (!config) return null;

    // ★ v3.1: 通过 Secret Manager 解析 apiKey
    const resolved = await this.modelConfigService.resolveApiKey(config);
    return {
      id: config.id,
      modelId: config.modelId,
      displayName: config.displayName || config.modelId,
      provider: config.provider,
      maxTokens: config.maxTokens,
      apiEndpoint: config.apiEndpoint,
      isReasoning: config.isReasoning ?? false,
      apiKey: resolved?.apiKey || null,
      secretKey: config.secretKey,
    };
  }

  async getFullModelConfig(modelId: string): Promise<{
    id: string;
    modelId: string;
    displayName: string;
    name: string;
    provider: string;
    apiKey: string;
    secretKey?: string | null;
    apiEndpoint?: string | null;
    maxTokens?: number | null;
    temperature?: number | null;
    isEnabled: boolean;
    isDefault: boolean;
    isReasoning?: boolean;
    apiFormat?: string | null;
    supportsTemperature?: boolean;
    supportsStreaming?: boolean;
    supportsFunctionCalling?: boolean;
    supportsVision?: boolean;
    tokenParamName?: string | null;
    defaultTimeoutMs?: number | null;
    priceInputPerMillion?: number | null;
    priceOutputPerMillion?: number | null;
    priority?: number | null;
  } | null> {
    if (this.modelResolver) {
      return this.modelResolver.getFullModelConfig(modelId);
    }
    const config = await this.modelConfigService.getModelById(modelId);

    if (!config) return null;

    // ★ v3.1: 通过 Secret Manager 解析 apiKey
    const resolved = await this.modelConfigService.resolveApiKey(config);
    this.logger.debug(
      `[getFullModelConfig] Found model ${config.modelId} via AiModelConfigService`,
    );
    return {
      id: config.id || config.modelId,
      modelId: config.modelId,
      displayName: config.displayName || config.modelId,
      name: config.name || config.modelId,
      provider: config.provider,
      apiKey: resolved?.apiKey || "",
      secretKey: config.secretKey || null,
      apiEndpoint: config.apiEndpoint || null,
      maxTokens: config.maxTokens || null,
      temperature: config.temperature || null,
      isEnabled: config.isEnabled ?? true,
      isDefault: config.isDefault ?? false,
      isReasoning: config.isReasoning ?? false,
      apiFormat: config.apiFormat || null,
      supportsTemperature: config.supportsTemperature ?? true,
      supportsStreaming: config.supportsStreaming ?? false,
      supportsFunctionCalling: config.supportsFunctionCalling ?? false,
      supportsVision: config.supportsVision ?? false,
      tokenParamName: config.tokenParamName || null,
      defaultTimeoutMs: config.defaultTimeoutMs || null,
      priceInputPerMillion: config.priceInputPerMillion || null,
      priceOutputPerMillion: config.priceOutputPerMillion || null,
      priority: config.priority || null,
    };
  }

  async getDefaultModelByType(modelType: AIModelType): Promise<{
    id: string;
    modelId: string;
    displayName: string;
    provider: string;
    maxTokens?: number;
  } | null> {
    if (this.modelResolver) {
      return this.modelResolver.getDefaultModelByType(modelType);
    }
    const config = await this.aiChatService.getDefaultModelByType(modelType);
    if (!config) return null;
    return {
      id: config.id || config.modelId,
      modelId: config.modelId,
      displayName: config.displayName || config.modelId,
      provider: config.provider,
      maxTokens: config.maxTokens,
    };
  }
}
