import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { TaskProfile } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

/**
 * AI 图像分析服务
 *
 * 提供图像的自动标签、风格分析和主题聚类功能
 * 从 AiImageService 拆分出来以降低代码复杂度
 */
@Injectable()
export class AiImageAnalyticsService {
  private readonly logger = new Logger(AiImageAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * 自动为图片打标签
   */
  async autoTagImages(userId: string) {
    this.logger.log(`Auto-tagging images for user ${userId}`);

    const images = await this.prisma.generatedImage.findMany({
      where: {
        userId,
        isBookmarked: true,
      },
      select: {
        id: true,
        prompt: true,
        enhancedPrompt: true,
        imageUrl: true,
      },
      take: 20,
    });

    if (images.length === 0) {
      return { taggedCount: 0, message: "No images found to tag" };
    }

    try {
      // ★ P3 迁移：模型选择由 AIFacade 内部处理，无需手动获取

      const imageDescriptions = images
        .map(
          (img) =>
            `[ID:${img.id}] Prompt: ${img.prompt || img.enhancedPrompt || "No prompt"}`,
        )
        .join("\n");

      // ★ P3 迁移：使用 AIFacade 统一入口
      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content:
              "You are an expert at categorizing and tagging images. Output JSON format only.",
          },
          {
            role: "user",
            content: `Analyze these image prompts and suggest tags for each. Return JSON: {"tags": [{"imageId": "id", "tags": ["tag1", "tag2", "tag3"]}]}\n\nImages:\n${imageDescriptions}`,
          },
        ],
        modelType: AIModelType.CHAT_FAST, // 使用快速模型进行标签生成
        taskProfile: {
          creativity: "low",
          outputLength: "minimal",
        } as TaskProfile,
      });

      try {
        const result = JSON.parse(response.content);
        this.logger.log(
          `Generated tags for ${result.tags?.length || 0} images for user ${userId}`,
        );
        return { taggedCount: result.tags?.length || 0, tags: result.tags };
      } catch {
        return { taggedCount: 0, rawResponse: response.content };
      }
    } catch (err) {
      this.logger.error(
        `Failed to auto-tag images: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  /**
   * 分析图片风格
   */
  async analyzeStyles(userId: string) {
    this.logger.log(`Analyzing image styles for user ${userId}`);

    const images = await this.prisma.generatedImage.findMany({
      where: {
        userId,
        isBookmarked: true,
      },
      select: {
        id: true,
        prompt: true,
        enhancedPrompt: true,
      },
      take: 30,
    });

    if (images.length === 0) {
      return { styles: [], message: "No images found to analyze" };
    }

    try {
      // ★ P3 迁移：模型选择由 AIFacade 内部处理，无需手动获取

      const imageDescriptions = images
        .map(
          (img) =>
            `[ID:${img.id}] ${img.prompt || img.enhancedPrompt || "No description"}`,
        )
        .join("\n");

      // ★ P3 迁移：使用 AIFacade 统一入口
      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content:
              "You are an expert at analyzing art styles and visual design. Output JSON format only.",
          },
          {
            role: "user",
            content: `Analyze the art styles and visual characteristics of these images based on their prompts. Return JSON: {"styles": [{"name": "style name", "description": "style characteristics", "count": number, "imageIds": ["id1"]}], "colorPalettes": [{"name": "palette name", "colors": ["color1"], "imageIds": ["id1"]}]}\n\nImages:\n${imageDescriptions}`,
          },
        ],
        modelType: AIModelType.CHAT_FAST,
        taskProfile: {
          creativity: "low",
          outputLength: "minimal",
        } as TaskProfile,
      });

      try {
        const result = JSON.parse(response.content);
        this.logger.log(
          `Identified ${result.styles?.length || 0} styles for user ${userId}`,
        );
        return result;
      } catch {
        return { styles: [], rawAnalysis: response.content };
      }
    } catch (err) {
      this.logger.error(
        `Failed to analyze styles: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  /**
   * 按视觉主题聚类图片
   */
  async clusterVisualThemes(userId: string) {
    this.logger.log(`Clustering visual themes for user ${userId}`);

    const images = await this.prisma.generatedImage.findMany({
      where: {
        userId,
        isBookmarked: true,
      },
      select: {
        id: true,
        prompt: true,
        enhancedPrompt: true,
      },
      take: 30,
    });

    if (images.length < 2) {
      return {
        clusters: [],
        message: "Need at least 2 images to create clusters",
      };
    }

    try {
      // ★ P3 迁移：模型选择由 AIFacade 内部处理，无需手动获取

      const imageDescriptions = images
        .map(
          (img) =>
            `[ID:${img.id}] ${img.prompt || img.enhancedPrompt || "No description"}`,
        )
        .join("\n");

      // ★ P3 迁移：使用 AIFacade 统一入口
      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content:
              "You are an expert at organizing and grouping visual content by themes. Output JSON format only.",
          },
          {
            role: "user",
            content: `Group these images into visual theme clusters based on their prompts. Return JSON: {"clusters": [{"name": "theme name", "description": "what unifies this cluster", "imageIds": ["id1", "id2"], "count": number}]}\n\nImages:\n${imageDescriptions}`,
          },
        ],
        modelType: AIModelType.CHAT_FAST,
        taskProfile: {
          creativity: "low",
          outputLength: "minimal",
        } as TaskProfile,
      });

      try {
        const result = JSON.parse(response.content);
        this.logger.log(
          `Found ${result.clusters?.length || 0} visual theme clusters for user ${userId}`,
        );
        return result;
      } catch {
        return { clusters: [], rawAnalysis: response.content };
      }
    } catch (err) {
      this.logger.error(
        `Failed to cluster themes: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
