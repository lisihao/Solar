/**
 * Image Generation Service
 *
 * This service handles all image generation APIs and provider integrations
 * ★ 使用 SecretsService 进行密钥管理，不直接使用数据库中的 apiKey
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { AIModelType } from "@prisma/client";
import { GEMINI_IMAGE_MODELS } from "../core/image.constants";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { SecretsService } from "../../../platform/facade";
import {
  KeyResolverService,
  NoAvailableKeyError,
} from "../../../ai-engine/facade";

interface ImageModelConfig {
  id: string;
  modelId: string;
  displayName: string;
  provider: string;
  apiEndpoint: string | null;
  apiKey: string | null | undefined;
  secretKey: string | null;
  maxTokens: number | null;
  temperature: number | null;
  isEnabled: boolean;
  isDefault: boolean;
  modelType: AIModelType;
  name: string;
  description: string | null;
  icon: string | null;
  isReasoning: boolean;
  apiFormat: string | null;
  supportsTemperature: boolean;
  supportsStreaming: boolean;
  supportsFunctionCalling: boolean;
  supportsVision: boolean;
  tokenParamName: string | null;
  defaultTimeoutMs: number | null;
  priceInputPerMillion: number | null;
  priceOutputPerMillion: number | null;
  priority: number | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly chatFacade: ChatFacade,
    private readonly secretsService: SecretsService,
    @Optional() private readonly keyResolver?: KeyResolverService,
  ) {}

  /**
   * 获取模型的 API Key（BYOK 单源，向后兼容）
   *
   * 顺序：
   * 1. 有 userId → KeyResolver.resolveKey(userId, provider) PERSONAL → ASSIGNED → throw
   *    BYOK 命中 → 返回；NoAvailableKeyError → fallthrough 到 SYSTEM Secret 兜底
   * 2. SecretsService 走 SYSTEM Secret（secretKey 已配置时）
   * 3. AIModel.apiKey 明文列回读（TODO: PR-4 双源收尾时删除）
   */
  async getApiKeyForModel(
    model: {
      provider?: string;
      secretKey?: string | null;
      apiKey?: string | null;
      displayName?: string;
    },
    userId?: string,
  ): Promise<string | null> {
    const provider = (model.provider || "").toLowerCase();
    if (userId && provider && this.keyResolver) {
      try {
        const resolved = await this.keyResolver.resolveKey(userId, provider);
        return resolved.apiKey;
      } catch (error) {
        if (error instanceof NoAvailableKeyError) {
          this.logger.warn(
            `[getApiKeyForModel] No BYOK for user=${userId} provider=${provider}, falling back to SYSTEM`,
          );
          // fallthrough to SYSTEM 兜底
        } else {
          throw error;
        }
      }
    }
    if (model.secretKey) {
      const secretValue = await this.secretsService.getValueInternal(
        model.secretKey,
      );
      if (secretValue) {
        return secretValue.trim();
      }
      this.logger.warn(
        `Secret '${model.secretKey}' not found for model ${model.displayName}, falling back to apiKey`,
      );
    }
    // 2026-05-12 PR-4: 删除 AIModel.apiKey 明文列 fallback
    return null;
  }

  /**
   * Get default text model (for prompt enhancement)
   * ★ 完全通过 AIFacade 获取，不再直接访问数据库
   */
  async getDefaultTextModel() {
    const defaultModel = await this.chatFacade.getDefaultTextModel();

    if (defaultModel) {
      this.logger.log(
        `[getDefaultTextModel] Found default CHAT model: ${defaultModel.displayName} (${defaultModel.modelId})`,
      );
      return defaultModel;
    }

    this.logger.warn("[getDefaultTextModel] No default text model found");
    return null;
  }

  /**
   * Get default image generation model
   *
   * ★ 通过 AIFacade 获取模型配置，不再直接访问数据库
   * ★ apiKey 通过 getApiKeyForModel + SecretsService 解析，不直接使用数据库中的 apiKey
   */
  async getDefaultImageModel() {
    // First try to find IMAGE_GENERATION model via AIFacade
    const imageModel = await this.chatFacade.getDefaultImageModel();

    if (imageModel) {
      this.logger.log(
        `[getDefaultImageModel] Found default IMAGE_GENERATION model: ${imageModel.displayName} (${imageModel.provider})`,
      );
      // Convert to full model config structure expected by caller
      return this.convertToFullModelConfig(imageModel);
    }

    // Fallback: Try to get any IMAGE_GENERATION model from available models
    const availableModels = await this.chatFacade.getAvailableModelsExtended(
      AIModelType.IMAGE_GENERATION,
    );

    if (availableModels.length > 0) {
      const firstModel = availableModels[0];
      this.logger.log(
        `[getDefaultImageModel] Found IMAGE_GENERATION model: ${firstModel.name}`,
      );
      return this.convertToFullModelConfig({
        id: firstModel.dbId || firstModel.id,
        modelId: firstModel.id,
        displayName: firstModel.name,
        provider: firstModel.provider,
        maxTokens: firstModel.maxTokens,
      });
    }

    // Fallback to MULTIMODAL model
    const multimodalModels = await this.chatFacade.getAvailableModelsExtended(
      AIModelType.MULTIMODAL,
    );

    if (multimodalModels.length > 0) {
      const firstModel = multimodalModels[0];
      this.logger.log(
        `[getDefaultImageModel] Found MULTIMODAL fallback model: ${firstModel.name}`,
      );
      return this.convertToFullModelConfig({
        id: firstModel.dbId || firstModel.id,
        modelId: firstModel.id,
        displayName: firstModel.name,
        provider: firstModel.provider,
        maxTokens: firstModel.maxTokens,
      });
    }

    this.logger.warn("[getDefaultImageModel] No image model found");
    return null;
  }

  /**
   * Convert facade model config to full model config structure
   * ★ Helper to maintain compatibility with existing code
   * ★ Uses AIFacade.getFullModelConfig() to get full config including secretKey
   */
  private async convertToFullModelConfig(facadeModel: {
    id: string;
    modelId: string;
    displayName: string;
    provider: string;
    maxTokens?: number;
    apiEndpoint?: string;
  }) {
    // Get full config via AIFacade (includes secretKey and all fields)
    const fullConfig = await this.chatFacade.getFullModelConfig(
      facadeModel.modelId,
    );

    if (!fullConfig) {
      throw new Error(`Model ${facadeModel.modelId} not found`);
    }

    // Convert to Prisma AIModel structure for compatibility with existing code
    return {
      id: fullConfig.id,
      modelId: fullConfig.modelId,
      displayName: fullConfig.displayName,
      provider: fullConfig.provider,
      apiEndpoint: fullConfig.apiEndpoint || null,
      apiKey: fullConfig.apiKey,
      secretKey: fullConfig.secretKey || null,
      maxTokens: fullConfig.maxTokens || null,
      temperature: fullConfig.temperature || null,
      isEnabled: fullConfig.isEnabled,
      isDefault: fullConfig.isDefault,
      modelType: AIModelType.IMAGE_GENERATION, // Default type
      name: fullConfig.name,
      description: null,
      icon: null,
      isReasoning: fullConfig.isReasoning || false,
      apiFormat: fullConfig.apiFormat || null,
      supportsTemperature: fullConfig.supportsTemperature ?? true,
      supportsStreaming: fullConfig.supportsStreaming ?? false,
      supportsFunctionCalling: fullConfig.supportsFunctionCalling ?? false,
      supportsVision: fullConfig.supportsVision ?? false,
      tokenParamName: fullConfig.tokenParamName || null,
      defaultTimeoutMs: fullConfig.defaultTimeoutMs || null,
      priceInputPerMillion: fullConfig.priceInputPerMillion || null,
      priceOutputPerMillion: fullConfig.priceOutputPerMillion || null,
      priority: fullConfig.priority || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Get model by ID
   *
   * ★ 通过 AIFacade 获取模型配置，不再直接访问数据库
   * ★ apiKey 通过 getApiKeyForModel 解析
   */
  async getModelById(id: string) {
    const facadeModel = await this.chatFacade.getModelById(id);
    if (!facadeModel) {
      this.logger.warn(`[getModelById] Model not found: ${id}`);
      return null;
    }

    // Convert to full model config structure expected by caller
    return this.convertToFullModelConfig(facadeModel);
  }

  /**
   * Call image generation API based on provider
   * ★ 使用 getApiKeyForModel 从 Secret Manager 解析 API Key
   */
  async callImageGenerationAPI(
    modelConfig: ImageModelConfig,
    prompt: string,
    dimensions: { width: number; height: number },
    negativePrompt?: string,
    referenceImageBase64?: string,
    userId?: string,
  ): Promise<string> {
    const provider = modelConfig.provider.toLowerCase();
    const modelId = modelConfig.modelId.toLowerCase();

    this.logger.log(
      `Calling image generation API: provider=${provider}, model=${modelConfig.modelId}, hasUserId=${!!userId}`,
    );

    // ★ BYOK 单源解析 API Key（有 userId → KeyResolver；无 → SYSTEM Secret）
    const apiKey = await this.getApiKeyForModel(modelConfig, userId);
    if (!apiKey) {
      throw new Error(
        `No API key found for model ${modelConfig.displayName || modelConfig.modelId}`,
      );
    }

    // If reference image is provided, use image-to-image API
    if (referenceImageBase64) {
      return this.callImageToImageAPI(
        modelConfig,
        apiKey,
        referenceImageBase64,
        prompt,
        dimensions,
      );
    }

    // Route to appropriate provider
    if (
      provider.includes("google") ||
      provider.includes("gemini") ||
      modelId.includes("gemini") ||
      modelId.includes("imagen")
    ) {
      return this.generateWithGemini(
        apiKey,
        modelConfig.modelId,
        prompt,
        dimensions,
      );
    } else if (provider.includes("openai")) {
      return this.generateWithOpenAI(
        apiKey,
        modelConfig.apiEndpoint,
        modelConfig.modelId, // ★ 使用配置的模型 ID，不再硬编码
        prompt,
        dimensions,
      );
    } else if (provider.includes("stability")) {
      return this.generateWithStability(
        apiKey,
        modelConfig.apiEndpoint,
        prompt,
        dimensions,
        negativePrompt,
      );
    } else if (provider.includes("replicate")) {
      return this.generateWithReplicate(
        apiKey,
        modelConfig.modelId,
        prompt,
        dimensions,
        negativePrompt,
      );
    } else if (provider.includes("together")) {
      return this.generateWithTogether(
        apiKey,
        modelConfig.modelId,
        prompt,
        dimensions,
      );
    } else {
      // Default to OpenAI-compatible API
      return this.generateWithOpenAICompatible(
        apiKey,
        modelConfig.apiEndpoint,
        modelConfig.modelId,
        prompt,
        dimensions,
      );
    }
  }

  /**
   * Image-to-Image API call
   * ★ apiKey 已在 callImageGenerationAPI 中通过 Secret Manager 解析
   */
  private async callImageToImageAPI(
    modelConfig: ImageModelConfig,
    apiKey: string,
    referenceImageBase64: string,
    modificationPrompt: string,
    _dimensions: { width: number; height: number },
  ): Promise<string> {
    const provider = modelConfig.provider.toLowerCase();

    this.logger.log(
      `Calling Image-to-Image API: provider=${provider}, model=${modelConfig.modelId}`,
    );

    if (
      provider.includes("google") ||
      provider.includes("gemini") ||
      modelConfig.modelId.toLowerCase().includes("gemini")
    ) {
      return this.imageToImageWithGemini(
        apiKey,
        modelConfig.modelId,
        referenceImageBase64,
        modificationPrompt,
      );
    }

    throw new Error(
      `Image-to-Image not yet supported for provider: ${provider}`,
    );
  }

  /**
   * Gemini Image-to-Image API
   */
  private async imageToImageWithGemini(
    apiKey: string,
    modelId: string,
    referenceImageBase64: string,
    modificationPrompt: string,
  ): Promise<string> {
    const model = modelId.includes("gemini") ? modelId : GEMINI_IMAGE_MODELS[0];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const base64Data = referenceImageBase64.replace(
      /^data:image\/[a-z]+;base64,/,
      "",
    );
    const mimeType =
      referenceImageBase64.match(/^data:(image\/[a-z]+);base64,/)?.[1] ||
      "image/jpeg";

    this.logger.log(
      `Calling Gemini Image-to-Image: ${model}, prompt="${modificationPrompt.slice(0, 100)}..."`,
    );

    const response = await firstValueFrom(
      this.httpService.post(
        url,
        {
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: base64Data,
                  },
                },
                { text: modificationPrompt },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["IMAGE"],
          },
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 120000,
        },
      ),
    );

    const candidates = response.data.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error("No candidates in Gemini response");
    }

    const parts = candidates[0].content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.inlineData?.data) {
          const responseMimeType = part.inlineData.mimeType || "image/png";
          return `data:${responseMimeType};base64,${part.inlineData.data}`;
        }
      }
    }

    throw new Error("No image data in Gemini response");
  }

  /**
   * Gemini/Imagen image generation
   */
  private async generateWithGemini(
    apiKey: string,
    modelId: string,
    prompt: string,
    dimensions: { width: number; height: number },
  ): Promise<string> {
    const modelLower = modelId.toLowerCase();

    // Check if Imagen model
    if (modelLower.includes("imagen")) {
      return this.generateWithImagen(apiKey, modelId, prompt, dimensions);
    }

    // Check if supported Gemini image model
    const isGeminiImageCapable = GEMINI_IMAGE_MODELS.some((m) =>
      modelLower.includes(m.toLowerCase()),
    );

    const model = isGeminiImageCapable ? modelId : GEMINI_IMAGE_MODELS[0];

    this.logger.log(
      `Using Gemini model for image generation: ${model} (original: ${modelId})`,
    );

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          url,
          {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
            },
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: 120000,
          },
        ),
      );

      const candidates = response.data.candidates;
      if (!candidates || candidates.length === 0) {
        // Check if there's a block reason
        const blockReason = response.data.promptFeedback?.blockReason;
        if (blockReason) {
          throw new Error(
            `Image generation blocked due to ${blockReason}. Try rephrasing your prompt.`,
          );
        }
        throw new Error("No candidates in Gemini response");
      }

      // Check for safety ratings that blocked the response
      const finishReason = candidates[0].finishReason;
      if (finishReason === "SAFETY" || finishReason === "BLOCKED") {
        throw new Error(
          "Image generation blocked by safety filters. Try rephrasing your prompt.",
        );
      }

      const parts = candidates[0].content?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.inlineData?.data) {
            const mimeType = part.inlineData.mimeType || "image/png";
            return `data:${mimeType};base64,${part.inlineData.data}`;
          }
        }
      }

      throw new Error("No image data in Gemini response");
    } catch (error: unknown) {
      // Extract error message from API response
      const e = error as {
        response?: {
          status?: number;
          data?: {
            error?: { message?: string };
            promptFeedback?: { blockReason?: string };
          };
        };
        message?: string;
      };
      if (e.response?.data) {
        const errorData = e.response.data;
        let errorMessage = "Gemini image generation failed";

        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        } else if (errorData.promptFeedback?.blockReason) {
          errorMessage = `Content blocked: ${errorData.promptFeedback.blockReason}`;
        }

        if (
          errorMessage.toLowerCase().includes("safety") ||
          errorMessage.toLowerCase().includes("blocked") ||
          errorMessage.toLowerCase().includes("policy")
        ) {
          throw new Error(
            `Image generation blocked: ${errorMessage}. Try rephrasing your prompt.`,
          );
        }

        throw new Error(`Gemini error: ${errorMessage}`);
      }
      throw error;
    }
  }

  /**
   * Imagen API (newer generateImages endpoint)
   */
  private async generateWithImagen(
    apiKey: string,
    modelId: string,
    prompt: string,
    dimensions: { width: number; height: number },
  ): Promise<string> {
    this.logger.log(`Using Imagen model for image generation: ${modelId}`);

    const aspectRatio =
      dimensions.width === dimensions.height
        ? "1:1"
        : dimensions.width > dimensions.height
          ? "16:9"
          : "9:16";

    // ★ 不在 URL 中包含 API Key，使用 header 认证
    const generateImagesUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateImages`;

    // ★ 安全：不在日志中打印 API Key
    this.logger.log(
      `Calling Imagen API: models/${modelId}:generateImages, aspectRatio=${aspectRatio}`,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          generateImagesUrl,
          {
            prompt,
            config: {
              aspectRatio,
              numberOfImages: 1,
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

      const images = response.data?.generatedImages;
      if (!images || images.length === 0) {
        throw new Error("No images in Imagen response");
      }

      const imageData = images[0]?.image;
      if (!imageData) {
        throw new Error("No image data in Imagen response");
      }

      const mimeType = imageData.imageType || "image/png";
      return `data:${mimeType};base64,${imageData.bytesBase64Encoded}`;
    } catch (error: unknown) {
      const e = error as {
        response?: {
          status?: number;
          data?: { error?: { message?: string }; message?: string };
        };
        message?: string;
      };
      const errorStatus = e.response?.status;
      const errorData = e.response?.data;

      // If 404, try predict endpoint
      if (errorStatus === 404) {
        this.logger.warn(
          `Imagen generateImages endpoint not found, trying predict...`,
        );
        return this.generateWithImagenPredict(
          apiKey,
          modelId,
          prompt,
          aspectRatio,
        );
      }

      this.logger.error(
        `Imagen generateImages error: status=${errorStatus}, data=${JSON.stringify(errorData).slice(0, 500)}`,
      );

      // Extract meaningful error message from Google API response
      let errorMessage = "Image generation failed";
      if (errorData?.error?.message) {
        errorMessage = errorData.error.message;
      } else if (errorData?.message) {
        errorMessage = errorData.message;
      } else if (typeof errorData === "string") {
        errorMessage = errorData;
      } else if (e.message) {
        errorMessage = e.message;
      }

      // Check for content moderation errors
      if (
        errorMessage.toLowerCase().includes("safety") ||
        errorMessage.toLowerCase().includes("policy") ||
        errorMessage.toLowerCase().includes("blocked") ||
        errorMessage.toLowerCase().includes("prohibited") ||
        errorStatus === 400
      ) {
        throw new Error(
          `Image generation blocked: ${errorMessage}. Try rephrasing your prompt.`,
        );
      }

      throw new Error(`Image generation failed: ${errorMessage}`);
    }
  }

  /**
   * Imagen predict endpoint (fallback)
   * ★ 使用 x-goog-api-key header 认证（与 admin 测试一致）
   */
  private async generateWithImagenPredict(
    apiKey: string,
    modelId: string,
    prompt: string,
    aspectRatio: string,
  ): Promise<string> {
    // ★ 不在 URL 中包含 API Key，使用 header 认证
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:predict`;

    // ★ 安全：不在日志中打印 API Key
    this.logger.log(
      `Calling Imagen predict API: models/${modelId}:predict, aspectRatio=${aspectRatio}`,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          url,
          {
            instances: [{ prompt }],
            parameters: {
              sampleCount: 1,
              aspectRatio: aspectRatio,
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

      const predictions = response.data?.predictions;
      if (!predictions || predictions.length === 0) {
        throw new Error("No predictions in Imagen response");
      }

      const imageData = predictions[0]?.bytesBase64Encoded;
      if (!imageData) {
        throw new Error("No image data in Imagen predict response");
      }

      return `data:image/png;base64,${imageData}`;
    } catch (error: unknown) {
      const e = error as { response?: { status?: number; data?: unknown } };
      this.logger.error(
        `Imagen predict error: ${e.response?.status} - ${JSON.stringify(e.response?.data).slice(0, 300)}`,
      );
      // Fallback to Gemini 2.0 Flash
      this.logger.warn(
        `Imagen predict failed, falling back to Gemini 2.0 Flash`,
      );
      return this.generateWithGeminiFlash(apiKey, prompt);
    }
  }

  /**
   * Gemini 2.0 Flash fallback
   */
  private async generateWithGeminiFlash(
    apiKey: string,
    prompt: string,
  ): Promise<string> {
    const model = GEMINI_IMAGE_MODELS[0];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    this.logger.log(`Falling back to Gemini 2.0 Flash for image generation`);

    const response = await firstValueFrom(
      this.httpService.post(
        url,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 120000,
        },
      ),
    );

    const candidates = response.data.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error("No candidates in Gemini response");
    }

    const parts = candidates[0].content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.inlineData?.data) {
          const mimeType = part.inlineData.mimeType || "image/png";
          this.logger.log(`Gemini 2.0 Flash image generated successfully`);
          return `data:${mimeType};base64,${part.inlineData.data}`;
        }
      }
    }

    throw new Error("No image data in Gemini 2.0 Flash response");
  }

  /**
   * OpenAI DALL-E API
   * ★ modelId 从配置读取，不再硬编码
   */
  private async generateWithOpenAI(
    apiKey: string,
    apiEndpoint: string | null,
    modelId: string,
    prompt: string,
    dimensions: { width: number; height: number },
  ): Promise<string> {
    const baseUrl = apiEndpoint || "https://api.openai.com/v1";
    const url = `${baseUrl}/images/generations`;

    const size =
      dimensions.width === dimensions.height
        ? "1024x1024"
        : dimensions.width > dimensions.height
          ? "1792x1024"
          : "1024x1792";

    const response = await firstValueFrom(
      this.httpService.post(
        url,
        {
          model: modelId, // ★ 使用配置的模型 ID
          prompt,
          n: 1,
          size,
          quality: "hd",
          response_format: "url",
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        },
      ),
    );

    return response.data.data[0].url;
  }

  /**
   * Stability AI API
   */
  private async generateWithStability(
    apiKey: string,
    apiEndpoint: string | null,
    prompt: string,
    dimensions: { width: number; height: number },
    negativePrompt?: string,
  ): Promise<string> {
    const url =
      apiEndpoint ||
      "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image";

    const response = await firstValueFrom(
      this.httpService.post(
        url,
        {
          text_prompts: [
            { text: prompt, weight: 1 },
            ...(negativePrompt ? [{ text: negativePrompt, weight: -1 }] : []),
          ],
          cfg_scale: 7,
          width: dimensions.width,
          height: dimensions.height,
          samples: 1,
          steps: 30,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        },
      ),
    );

    const base64Image = response.data.artifacts[0].base64;
    return `data:image/png;base64,${base64Image}`;
  }

  /**
   * Replicate API
   */
  private async generateWithReplicate(
    apiKey: string,
    modelId: string,
    prompt: string,
    dimensions: { width: number; height: number },
    negativePrompt?: string,
  ): Promise<string> {
    const createResponse = await firstValueFrom(
      this.httpService.post(
        "https://api.replicate.com/v1/predictions",
        {
          version: modelId.includes(":")
            ? modelId.split(":")[1]
            : "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
          input: {
            prompt,
            negative_prompt: negativePrompt || "",
            width: dimensions.width,
            height: dimensions.height,
            num_outputs: 1,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${apiKey}`,
          },
        },
      ),
    );

    const predictionId = createResponse.data.id;
    let result = createResponse.data;
    let attempts = 0;
    const maxAttempts = 60;

    while (
      result.status !== "succeeded" &&
      result.status !== "failed" &&
      attempts < maxAttempts
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const pollResponse = await firstValueFrom(
        this.httpService.get(
          `https://api.replicate.com/v1/predictions/${predictionId}`,
          {
            headers: { Authorization: `Token ${apiKey}` },
          },
        ),
      );
      result = pollResponse.data;
      attempts++;
    }

    if (result.status === "failed" || attempts >= maxAttempts) {
      throw new Error("Replicate generation failed or timed out");
    }

    return result.output[0];
  }

  /**
   * Together AI API
   */
  private async generateWithTogether(
    apiKey: string,
    modelId: string,
    prompt: string,
    dimensions: { width: number; height: number },
  ): Promise<string> {
    const response = await firstValueFrom(
      this.httpService.post(
        "https://api.together.xyz/v1/images/generations",
        {
          model: modelId || "",
          prompt,
          width: dimensions.width,
          height: dimensions.height,
          n: 1,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        },
      ),
    );

    return response.data.data[0].url || response.data.data[0].b64_json
      ? `data:image/png;base64,${response.data.data[0].b64_json}`
      : response.data.data[0].url;
  }

  /**
   * OpenAI-compatible API
   */
  private async generateWithOpenAICompatible(
    apiKey: string,
    apiEndpoint: string | null,
    modelId: string,
    prompt: string,
    dimensions: { width: number; height: number },
  ): Promise<string> {
    const baseUrl = apiEndpoint || "https://api.openai.com/v1";
    const url = `${baseUrl}/images/generations`;

    const response = await firstValueFrom(
      this.httpService.post(
        url,
        {
          model: modelId,
          prompt,
          n: 1,
          size: `${dimensions.width}x${dimensions.height}`,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        },
      ),
    );

    return (
      response.data.data[0].url ||
      (response.data.data[0].b64_json
        ? `data:image/png;base64,${response.data.data[0].b64_json}`
        : null)
    );
  }
}
