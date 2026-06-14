import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from "@nestjs/common";

interface ImagenGeneratedImage {
  image?: { imageBytes?: string };
  imageBytes?: string;
}

interface ImagenPrediction {
  bytesBase64Encoded?: string;
  image?: { imageBytes?: string };
}

import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { AIErrorClassifier } from "../abstractions/error-classifier";

export interface ImageGenerationResult {
  content: string;
  model: string;
  tokensUsed: number;
}

/**
 * AI Image Generation Service
 * 职责：图片生成（DALL-E 3 / Imagen API）
 *
 * 从 AiChatService 提取，处理：
 * - 图片生成请求检测
 * - DALL-E 3 API 调用
 * - Google Imagen API 调用
 */
@Injectable()
export class AiImageGenerationService {
  private readonly logger = new Logger(AiImageGenerationService.name);
  private readonly errorClassifier = new AIErrorClassifier();
  private readonly MAX_RETRIES = 3;

  constructor(private readonly httpService: HttpService) {}

  /**
   * Check if the user message is requesting image generation
   */
  isImageGenerationRequest(content: string): boolean {
    const imageKeywords = [
      // Chinese
      "生成图",
      "画图",
      "画一",
      "画个",
      "画张",
      "创建图",
      "制作图",
      "生成一张",
      "生成一个图",
      "帮我画",
      "给我画",
      "图片",
      "图像",
      "插图",
      "绘制",
      "设计图",
      "信息图",
      "流程图",
      "示意图",
      // English
      "generate image",
      "create image",
      "draw",
      "make image",
      "generate picture",
      "create picture",
      "illustration",
      "infographic",
      "diagram",
      "visualize",
      "picture of",
      "image of",
    ];

    const lowerContent = content.toLowerCase();
    return imageKeywords.some((keyword) => lowerContent.includes(keyword));
  }

  /**
   * Call OpenAI DALL-E 3 API for image generation with automatic retry
   */
  async callDallE3(
    apiKey: string,
    prompt: string,
  ): Promise<ImageGenerationResult> {
    const url = "https://api.openai.com/v1/images/generations";

    this.logger.log(`Calling DALL-E 3 API for image generation`);

    try {
      const response = await this.withRetry(
        async () =>
          firstValueFrom(
            this.httpService.post(
              url,
              {
                model: "dall-e-3",
                prompt: prompt,
                n: 1,
                size: "1024x1024",
                quality: "hd",
                response_format: "b64_json",
              },
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                timeout: 120000,
              },
            ),
          ),
        "DALL-E-3-API",
        "dall-e-3",
      );

      const data = response.data;
      const imageData = data.data?.[0];

      if (imageData?.b64_json) {
        const imageMarkdown = `![Generated Image](data:image/png;base64,${imageData.b64_json})`;
        const revisedPrompt = imageData.revised_prompt
          ? `\n\n*Prompt used: ${imageData.revised_prompt}*`
          : "";

        this.logger.log("DALL-E 3 image generated successfully");

        return {
          content: imageMarkdown + revisedPrompt,
          model: "dall-e-3",
          tokensUsed: 0,
        };
      } else if (imageData?.url) {
        const imageMarkdown = `![Generated Image](${imageData.url})`;
        return {
          content: imageMarkdown,
          model: "dall-e-3",
          tokensUsed: 0,
        };
      }

      throw new InternalServerErrorException("No image data in response");
    } catch (error: unknown) {
      const e = error as {
        response?: { data?: { error?: { message?: string } } };
        message?: string;
      };
      const errMsg = e.response?.data?.error?.message || e.message;
      this.logger.error(`DALL-E 3 API error: ${errMsg}`);

      return {
        content: `抱歉，图像生成失败: ${errMsg}\n\n请检查 OpenAI API Key 是否有 DALL-E 3 的访问权限。`,
        model: "dall-e-3",
        tokensUsed: 0,
      };
    }
  }

  /**
   * Call Google Imagen API for image generation
   */
  async callImagenApi(
    apiKey: string,
    modelId: string,
    prompt: string,
  ): Promise<ImageGenerationResult> {
    const imagenModel = modelId.includes("imagen-4")
      ? modelId
      : "imagen-4.0-generate-001";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${imagenModel}:predict`;

    this.logger.log(`[Imagen] Calling API: ${url}`);
    this.logger.log(
      `[Imagen] Model: ${imagenModel}, Prompt length: ${prompt.length}`,
    );
    this.logger.log(
      `[Imagen] Prompt content: "${prompt.substring(0, 500)}${prompt.length > 500 ? "..." : ""}"`,
    );

    try {
      const response = await this.withRetry(
        async () =>
          firstValueFrom(
            this.httpService.post(
              url,
              {
                instances: [
                  {
                    prompt: prompt,
                  },
                ],
                parameters: {
                  sampleCount: 1,
                  aspectRatio: "16:9",
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
          ),
        "Imagen-API",
        "imagen",
      );

      const data = response.data;
      this.logger.log(
        `[Imagen] Response received, keys: ${Object.keys(data).join(", ")}`,
      );

      let images: string[] = [];

      // Try SDK format first (generatedImages)
      if (data.generatedImages && data.generatedImages.length > 0) {
        images = data.generatedImages
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw API response item
          .map((img: ImagenGeneratedImage, index: number) => {
            const imageBytes = img.image?.imageBytes || img.imageBytes;
            if (imageBytes) {
              const cleanBase64 = imageBytes.replace(/\s/g, "");
              return `![Generated Image ${index + 1}](data:image/png;base64,${cleanBase64})`;
            }
            return null;
          })
          .filter(Boolean);
      }

      // Try REST format (predictions)
      if (
        images.length === 0 &&
        data.predictions &&
        data.predictions.length > 0
      ) {
        images = data.predictions
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw API response item
          .map((pred: ImagenPrediction, index: number) => {
            const imageBytes =
              pred.bytesBase64Encoded || pred.image?.imageBytes;
            if (imageBytes) {
              const cleanBase64 = imageBytes.replace(/\s/g, "");
              return `![Generated Image ${index + 1}](data:image/png;base64,${cleanBase64})`;
            }
            return null;
          })
          .filter(Boolean);
      }

      if (images.length > 0) {
        this.logger.log(
          `[Imagen] Successfully generated ${images.length} image(s)`,
        );
        return {
          content: images.join("\n\n"),
          model: imagenModel,
          tokensUsed: 0,
        };
      }

      this.logger.warn(
        `[Imagen] No images found in response: ${JSON.stringify(data).substring(0, 1000)}`,
      );
      throw new InternalServerErrorException(
        "No images generated - check response format",
      );
    } catch (error: unknown) {
      const e = error as {
        response?: { data?: { error?: { message?: string } } };
        message?: string;
      };
      const errorMsg = e.response?.data?.error?.message || e.message;
      this.logger.error(`[Imagen] API error: ${errorMsg}`);
      this.logger.error(
        `[Imagen] Full error: ${JSON.stringify(e.response?.data || {}).substring(0, 1000)}`,
      );

      return {
        content: `抱歉，Imagen 图像生成失败: ${errorMsg}\n\n请确认:\n1. Google API Key 具有 Imagen API 访问权限\n2. 模型 imagen-4.0-generate-001 已可用\n3. Imagen API 已在 Google Cloud 项目中启用`,
        model: imagenModel,
        tokensUsed: 0,
      };
    }
  }

  /**
   * Execute an async operation with retry logic
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    provider?: string,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const aiError = this.errorClassifier.classify(error, provider);
        lastError = aiError;

        this.logger.warn(
          `[${operationName}] Attempt ${attempt}/${this.MAX_RETRIES} failed: ${aiError.message} (type: ${aiError.type})`,
        );

        if (aiError.isRetryable() && attempt < this.MAX_RETRIES) {
          const delay =
            aiError.getRetryDelay() * Math.pow(2, attempt - 1) +
            Math.random() * 500;
          this.logger.debug(
            `[${operationName}] Retrying in ${Math.round(delay)}ms...`,
          );
          await this.sleep(delay);
          continue;
        }

        this.logger.error(
          `[${operationName}] ${aiError.isRetryable() ? "Max retries exceeded" : "Non-retryable error"}: ${aiError.message}`,
        );
        throw aiError;
      }
    }

    throw lastError || new Error(`${operationName} failed after all retries`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
