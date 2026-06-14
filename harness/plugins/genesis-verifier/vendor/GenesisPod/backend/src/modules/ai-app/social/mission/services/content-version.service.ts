import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType, Prisma, SocialPlatformType } from "@prisma/client";
import {
  PLATFORM_LIMITS,
  getPlatformLimits,
  PlatformLimits,
} from "../../runtime/platform-limits.config";
import {
  WECHAT_ADAPTATION_SYSTEM_PROMPT,
  XIAOHONGSHU_ADAPTATION_SYSTEM_PROMPT,
} from "../skills/social-version.prompt";

export interface ContentVersionData {
  title: string;
  content: string;
  digest?: string | null;
}

// Use Prisma's generated model type to ensure type compatibility
export type SocialContentVersion =
  Prisma.SocialContentVersionGetPayload<object>;

@Injectable()
export class ContentVersionService {
  private readonly logger = new Logger(ContentVersionService.name);

  // 内容超出限制阈值，超过此比例需要 AI 重写而非简单截断
  private static readonly CONTENT_OVERFLOW_THRESHOLD = 1.2; // 正文超出 20% 需要 AI 重写
  private static readonly TITLE_OVERFLOW_THRESHOLD = 1.5; // 标题超出 50% 需要 AI 重写

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * 为内容生成指定平台的适配版本
   */
  async generateVersion(
    contentId: string,
    platformType: SocialPlatformType,
    userId?: string,
  ): Promise<SocialContentVersion> {
    this.logger.log(
      `Generating ${platformType} version for content ${contentId}`,
    );

    // 获取原始内容
    const content = await this.prisma.socialContent.findUnique({
      where: { id: contentId },
    });

    if (!content) {
      throw new NotFoundException(`Content ${contentId} not found`);
    }

    // 获取平台限制 (cast needed: both enums share same string values but differ nominally)
    const limits = getPlatformLimits(
      platformType as Parameters<typeof getPlatformLimits>[0],
    );

    // 使用 AI 生成适配版本
    const adaptedContent = await this.adaptContentForPlatform(
      {
        title: content.title,
        content: content.content,
        digest: content.digest,
      },
      platformType,
      limits,
      userId,
      contentId,
    );

    // 使用 upsert 创建或更新版本
    const version = await this.prisma.socialContentVersion.upsert({
      where: {
        contentId_platformType: {
          contentId,
          platformType,
        },
      },
      update: {
        title: adaptedContent.title,
        content: adaptedContent.content,
        digest: adaptedContent.digest || null,
        generatedBy: "AI",
        updatedAt: new Date(),
      },
      create: {
        contentId,
        platformType,
        title: adaptedContent.title,
        content: adaptedContent.content,
        digest: adaptedContent.digest || null,
        isDefault: false,
        generatedBy: "AI",
      },
    });

    this.logger.log(
      `Generated ${platformType} version: title=${version.title.length} chars, content=${version.content.length} chars`,
    );

    return version;
  }

  /**
   * 为内容生成所有平台的适配版本（并发执行）
   */
  async generateAllVersions(
    contentId: string,
    userId?: string,
  ): Promise<SocialContentVersion[]> {
    this.logger.log(
      `Generating all platform versions for content ${contentId}`,
    );

    const platforms = Object.keys(PLATFORM_LIMITS) as SocialPlatformType[];

    // 并发生成所有版本，提升性能
    const results = await Promise.allSettled(
      platforms.map((platformType) =>
        this.generateVersion(contentId, platformType, userId),
      ),
    );

    const versions: SocialContentVersion[] = [];
    const errors: string[] = [];

    results.forEach((result, index) => {
      const platformType = platforms[index];
      if (result.status === "fulfilled") {
        versions.push(result.value);
      } else {
        const errorMsg = `${platformType}: ${result.reason?.message || "Unknown error"}`;
        errors.push(errorMsg);
        this.logger.error(
          `Failed to generate ${platformType} version: ${result.reason?.message}`,
          result.reason?.stack,
        );
      }
    });

    if (errors.length > 0) {
      this.logger.warn(
        `Version generation completed with ${errors.length} failures: ${errors.join("; ")}`,
      );
    }

    return versions;
  }

  /**
   * 获取内容的所有版本
   */
  async getVersions(contentId: string): Promise<SocialContentVersion[]> {
    return this.prisma.socialContentVersion.findMany({
      where: { contentId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * 获取指定平台的版本
   */
  async getVersion(
    contentId: string,
    platformType: SocialPlatformType,
  ): Promise<SocialContentVersion | null> {
    return this.prisma.socialContentVersion.findUnique({
      where: {
        contentId_platformType: {
          contentId,
          platformType,
        },
      },
    });
  }

  /**
   * 获取用于发布的版本内容
   * 优先使用平台专属版本，如果没有则回退到默认版本或原始内容
   */
  async getVersionForPublish(
    contentId: string,
    platformType: SocialPlatformType,
  ): Promise<ContentVersionData | null> {
    // 1. 尝试获取平台专属版本
    const version = await this.getVersion(contentId, platformType);
    if (version) {
      this.logger.log(
        `Using ${platformType} version for publish (id: ${version.id})`,
      );
      return {
        title: version.title,
        content: version.content,
        digest: version.digest ?? null, // 统一处理 undefined -> null
      };
    }

    // 2. 尝试获取默认版本
    const defaultVersion = await this.prisma.socialContentVersion.findFirst({
      where: { contentId, isDefault: true },
    });
    if (defaultVersion) {
      this.logger.log(
        `Using default version for publish (id: ${defaultVersion.id})`,
      );
      return {
        title: defaultVersion.title,
        content: defaultVersion.content,
        digest: defaultVersion.digest ?? null, // 统一处理 undefined -> null
      };
    }

    // 3. 没有版本，返回 null，让调用方使用原始内容
    this.logger.log(
      `No version found for ${platformType}, will use original content`,
    );
    return null;
  }

  /**
   * 手动更新版本内容
   */
  async updateVersion(
    contentId: string,
    platformType: SocialPlatformType,
    data: Partial<ContentVersionData>,
  ): Promise<SocialContentVersion> {
    const existing = await this.getVersion(contentId, platformType);

    if (!existing) {
      // 如果版本不存在，先创建
      const content = await this.prisma.socialContent.findUnique({
        where: { id: contentId },
      });

      if (!content) {
        throw new NotFoundException(`Content ${contentId} not found`);
      }

      return this.prisma.socialContentVersion.create({
        data: {
          contentId,
          platformType,
          title: data.title || content.title,
          content: data.content || content.content,
          digest: data.digest ?? content.digest ?? null,
          isDefault: false,
          generatedBy: "MANUAL",
        },
      });
    }

    // 更新现有版本
    return this.prisma.socialContentVersion.update({
      where: { id: existing.id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.content !== undefined && { content: data.content }),
        ...(data.digest !== undefined && { digest: data.digest }),
        generatedBy: "MANUAL",
        updatedAt: new Date(),
      },
    });
  }

  /**
   * 删除版本
   */
  async deleteVersion(
    contentId: string,
    platformType: SocialPlatformType,
  ): Promise<void> {
    await this.prisma.socialContentVersion.deleteMany({
      where: { contentId, platformType },
    });
  }

  /**
   * 设置默认版本
   */
  async setDefaultVersion(
    contentId: string,
    platformType: SocialPlatformType,
  ): Promise<SocialContentVersion> {
    // 先取消所有默认版本
    await this.prisma.socialContentVersion.updateMany({
      where: { contentId },
      data: { isDefault: false },
    });

    // 设置新的默认版本
    return this.prisma.socialContentVersion.update({
      where: {
        contentId_platformType: {
          contentId,
          platformType,
        },
      },
      data: { isDefault: true },
    });
  }

  /**
   * 使用 AI 将内容适配到指定平台
   */
  private async adaptContentForPlatform(
    content: ContentVersionData,
    platformType: SocialPlatformType,
    limits: PlatformLimits,
    userId?: string,
    contentId?: string,
  ): Promise<ContentVersionData> {
    // 检查是否需要 AI 适配
    const needsAdaptation = this.needsAdaptation(content, limits);

    if (!needsAdaptation) {
      // 内容已符合限制，直接截断即可
      return this.truncateContent(content, limits);
    }

    // 使用 AI 进行智能适配
    const prompt = this.buildAdaptationPrompt(content, platformType, limits);

    try {
      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: this.getAdaptationSystemPrompt(platformType),
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
        // ★ 自动积分扣除
        billing: userId
          ? {
              userId,
              moduleType: "ai-social",
              operationType: "adapt-version",
              referenceId: contentId,
              description: `适配 ${platformType} 版本`,
            }
          : undefined,
      });

      if (response.isError) {
        this.logger.warn(`AI adaptation failed, using truncation fallback`);
        return this.truncateContent(content, limits);
      }

      const adapted = this.parseAdaptationResponse(response.content);
      if (adapted) {
        // 确保适配后的内容符合限制
        return this.truncateContent(adapted, limits);
      }
    } catch (error) {
      this.logger.error(`AI adaptation error: ${(error as Error).message}`);
    }

    // 回退到简单截断
    return this.truncateContent(content, limits);
  }

  /**
   * 检查内容是否需要 AI 适配
   * - 如果超出限制较多，简单截断会严重影响质量，需要 AI 重新组织
   * - 如果超出不多，简单截断即可
   */
  private needsAdaptation(
    content: ContentVersionData,
    limits: PlatformLimits,
  ): boolean {
    // 如果正文超出限制 20% 以上，需要 AI 重新组织
    if (
      limits.maxContent > 0 &&
      content.content.length >
        limits.maxContent * ContentVersionService.CONTENT_OVERFLOW_THRESHOLD
    ) {
      return true;
    }

    // 如果标题超出限制 50% 以上，需要 AI 重写
    if (
      content.title.length >
      limits.maxTitle * ContentVersionService.TITLE_OVERFLOW_THRESHOLD
    ) {
      return true;
    }

    return false;
  }

  /**
   * 简单截断内容
   */
  private truncateContent(
    content: ContentVersionData,
    limits: PlatformLimits,
  ): ContentVersionData {
    const result = { ...content };

    // 截断标题
    if (result.title.length > limits.maxTitle) {
      result.title = result.title.slice(0, limits.maxTitle - 1) + "…";
    }

    // 截断摘要
    if (limits.maxDigest > 0 && result.digest) {
      if (result.digest.length > limits.maxDigest) {
        result.digest = result.digest.slice(0, limits.maxDigest - 1) + "…";
      }
    } else if (limits.maxDigest === 0) {
      // 平台不支持摘要
      result.digest = null;
    }

    // 截断正文
    if (limits.maxContent > 0 && result.content.length > limits.maxContent) {
      result.content = result.content.slice(0, limits.maxContent - 1) + "…";
    }

    return result;
  }

  /**
   * 构建 AI 适配提示
   */
  private buildAdaptationPrompt(
    content: ContentVersionData,
    platformType: SocialPlatformType,
    limits: PlatformLimits,
  ): string {
    const platformName = platformType === "WECHAT_MP" ? "微信公众号" : "小红书";

    return `请将以下内容适配到${platformName}平台的字数限制：

【字数限制】
- 标题：最多 ${limits.maxTitle} 字
${limits.maxDigest > 0 ? `- 摘要：最多 ${limits.maxDigest} 字` : "- 摘要：不需要"}
${limits.maxContent > 0 ? `- 正文：最多 ${limits.maxContent} 字` : "- 正文：无限制"}

【原始内容】
标题（${content.title.length} 字）：${content.title}

${content.digest ? `摘要（${content.digest.length} 字）：${content.digest}` : ""}

正文（${content.content.length} 字）：
${content.content}

【要求】
1. 保留核心信息和关键观点
2. 语言简洁有力
3. 确保内容完整性和可读性
4. 严格遵守字数限制

请以 JSON 格式返回：
{
  "title": "适配后的标题",
  "content": "适配后的正文",
  ${limits.maxDigest > 0 ? '"digest": "适配后的摘要"' : ""}
}`;
  }

  /**
   * 获取 AI 适配系统提示
   */
  private getAdaptationSystemPrompt(platformType: SocialPlatformType): string {
    if (platformType === "WECHAT_MP") {
      return WECHAT_ADAPTATION_SYSTEM_PROMPT;
    }

    return XIAOHONGSHU_ADAPTATION_SYSTEM_PROMPT;
  }

  /**
   * 解析 AI 适配响应
   */
  private parseAdaptationResponse(
    responseContent: string,
  ): ContentVersionData | null {
    try {
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.title && parsed.content) {
          return {
            title: parsed.title,
            content: parsed.content,
            digest: parsed.digest || null,
          };
        }
      }
    } catch (error) {
      this.logger.warn("Failed to parse adaptation response", error);
    }
    return null;
  }
}
