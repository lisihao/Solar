/**
 * Image Generation Tool
 * 图像生成工具 - 通过接口依赖 AiImageService
 *
 * ★ 架构重构: 使用依赖反转原则打破循环依赖
 * - 工具依赖 IImageGenerationService 接口
 * - AiImageModule 提供 IMAGE_GENERATION_SERVICE 实现
 * - 不再需要 forwardRef
 */

import { Injectable, Inject, Optional } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";
import {
  IMAGE_GENERATION_SERVICE,
  IImageGenerationService,
} from "../../abstractions/generation-services.interface";

// ============================================================================
// Types
// ============================================================================

export interface ImageGenerationInput {
  /**
   * 图像描述提示词
   */
  prompt: string;

  /**
   * 参考内容（可选）
   */
  content?: string;

  /**
   * 参考 URL 列表（可选）
   */
  urls?: string[];

  /**
   * 图像风格
   */
  style?: string;

  /**
   * 宽高比
   */
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

  /**
   * 模板布局
   */
  templateLayout?: string;
}

export interface ImageGenerationOutput {
  /**
   * 生成的图像 URL
   */
  imageUrl: string;

  /**
   * 图像宽度
   */
  width?: number;

  /**
   * 图像高度
   */
  height?: number;

  /**
   * 使用的模型
   */
  model?: string;

  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 错误信息
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class ImageGenerationTool extends BaseTool<
  ImageGenerationInput,
  ImageGenerationOutput
> {
  readonly id = "image-generation";
  readonly category: ToolCategory = "generation";
  readonly tags = ["generation", "image", "ai-image", "synthesis", "diffusion"];
  // ★ 图来源红线（mission-pipeline-baseline.md §7.4 D21）—— 标 destructive
  // 原因：图必须来自参考文献原始内容，禁止 AI 自创图。这里标 destructive 后：
  //   1) Tool Recall 五步流程里有 ToolACL 校验 → 没 image.generation entitlement 用户看不到
  //   2) L2 stage 重跑时自动跳过 destructive 调用历史
  readonly sideEffect = "destructive" as const;
  readonly requiredEntitlements = ["image.generation"] as const;
  readonly name = "图像生成";
  readonly description =
    "使用 AI 模型生成图像。支持文字描述生成图片、信息图、海报等。可指定风格、宽高比和模板布局。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "图像描述提示词，详细描述想要生成的图像内容",
      },
      content: {
        type: "string",
        description: "参考内容，用于生成信息图等需要数据的图像",
      },
      urls: {
        type: "array",
        description: "参考 URL 列表，从这些页面获取内容作为参考",
        items: { type: "string" },
      },
      style: {
        type: "string",
        description: "图像风格，如 realistic, cartoon, minimalist 等",
      },
      aspectRatio: {
        type: "string",
        description: "图像宽高比",
        enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
        default: "16:9",
      },
      templateLayout: {
        type: "string",
        description: "模板布局类型，用于信息图生成",
      },
    },
    required: ["prompt"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      imageUrl: {
        type: "string",
        description: "生成的图像 URL",
      },
      width: {
        type: "number",
        description: "图像宽度（像素）",
      },
      height: {
        type: "number",
        description: "图像高度（像素）",
      },
      model: {
        type: "string",
        description: "使用的模型名称",
      },
      success: {
        type: "boolean",
        description: "生成是否成功",
      },
      error: {
        type: "string",
        description: "错误信息（如果失败）",
      },
    },
  };

  constructor(
    @Optional()
    @Inject(IMAGE_GENERATION_SERVICE)
    private readonly imageService?: IImageGenerationService,
  ) {
    super();
    // defaultTimeout set in class property // 120 秒超时（图像生成较慢）
  }

  validateInput(input: ImageGenerationInput) {
    return (
      typeof input.prompt === "string" &&
      input.prompt.trim().length > 0 &&
      input.prompt.length <= 5000
    );
  }

  protected async doExecute(
    input: ImageGenerationInput,
    _context: ToolContext,
  ): Promise<ImageGenerationOutput> {
    // ★ 检查服务是否可用
    if (!this.imageService) {
      return {
        imageUrl: "",
        success: false,
        error:
          "Image generation service not available. AiImageModule may not be loaded.",
      };
    }

    const {
      prompt,
      content,
      urls,
      style,
      aspectRatio = "16:9",
      templateLayout,
    } = input;

    try {
      // 使用流式生成并等待完成
      // 将输入参数转换为服务期望的格式
      const validAspectRatios = ["1:1", "16:9", "9:16"];
      const safeAspectRatio = validAspectRatios.includes(aspectRatio)
        ? (aspectRatio as "1:1" | "16:9" | "9:16")
        : "16:9";

      const result = await this.generateImageAsync({
        prompt,
        content,
        urls,
        style,
        aspectRatio: safeAspectRatio,
        templateLayout,
      });

      return {
        imageUrl: result.imageUrl,
        width: result.width,
        height: result.height,
        model: result.model,
        success: true,
      };
    } catch (error) {
      return {
        imageUrl: "",
        success: false,
        error:
          error instanceof Error ? error.message : "Image generation failed",
      };
    }
  }

  /**
   * 异步生成图像（将流式 API 转换为 Promise）
   */
  private async generateImageAsync(options: {
    prompt: string;
    content?: string;
    urls?: string[];
    style?: string;
    aspectRatio?: "9:16" | "16:9" | "1:1";
    templateLayout?: string;
  }): Promise<{
    imageUrl: string;
    width?: number;
    height?: number;
    model?: string;
  }> {
    return new Promise((resolve, reject) => {
      // ★ 使用接口方法，服务已在 doExecute 中验证可用性
      const stream = this.imageService!.generateImageStream(options);

      let result: {
        imageUrl?: string;
        url?: string;
        width?: number;
        height?: number;
        model?: string;
      } | null = null;

      const subscription = stream.subscribe({
        next: (event) => {
          const data = JSON.parse(event.data) as {
            type: string;
            result?: typeof result;
            error?: string;
          };
          if (data.type === "complete" && data.result) {
            result = data.result;
          } else if (data.type === "error") {
            reject(new Error(data.error || "Image generation failed"));
          }
        },
        error: (error: Error) => {
          subscription.unsubscribe();
          reject(error);
        },
        complete: () => {
          subscription.unsubscribe();
          if (result) {
            resolve({
              imageUrl: result.imageUrl || result.url || "",
              width: result.width,
              height: result.height,
              model: result.model,
            });
          } else {
            reject(new Error("No image result received"));
          }
        },
      });

      // 超时处理
      setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error("Image generation timeout"));
      }, 120000);
    });
  }
}
