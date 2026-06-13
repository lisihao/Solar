import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { SocialContentSourceType } from "@prisma/client";
import { RAGFacade } from "@/modules/ai-harness/facade";
import { sanitizeForDb, sanitizeJson } from "@/modules/ai-harness/facade";

export interface FetchedContent {
  title: string;
  content: string;
  /** 原文内容（英文或原始语言） */
  originalContent?: string;
  /** 翻译内容（中文） */
  translatedContent?: string;
  /** 是否为双语内容 */
  isBilingual?: boolean;
  coverImage?: string;
  images?: string[];
  url?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ContentFetcherService {
  private readonly logger = new Logger(ContentFetcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragFacade: RAGFacade,
  ) {}

  /**
   * 从外部URL获取内容
   * 委托给 AI Engine ContentFetchService 处理（含 SSRF 防护和 YouTube 字幕）
   */
  async fetchFromUrl(url: string): Promise<FetchedContent> {
    const result = await this.ragFacade.contentFetch!.fetchFromUrl(url);
    return {
      title: result.title || "Untitled",
      content: result.content,
      originalContent: result.originalContent,
      translatedContent: result.translatedContent,
      isBilingual: result.isBilingual,
      coverImage: result.coverImage,
      images: result.images,
      url: result.url,
      metadata: result.metadata,
    };
  }

  /**
   * 从内部来源获取内容
   */
  async fetchFromSource(
    sourceType: SocialContentSourceType,
    sourceId: string,
    userId: string,
  ): Promise<FetchedContent> {
    this.logger.log(`Fetching from source: ${sourceType}/${sourceId}`);

    switch (sourceType) {
      case SocialContentSourceType.AI_EXPLORE:
        return this.fetchFromExploreResource(sourceId, userId);

      case SocialContentSourceType.AI_RESEARCH:
        return this.fetchFromResearchReport(sourceId, userId);

      case SocialContentSourceType.AI_OFFICE:
        return this.fetchFromOfficeDocument(sourceId, userId);

      case SocialContentSourceType.AI_WRITING:
        return this.fetchFromWritingChapter(sourceId, userId);

      case SocialContentSourceType.AI_TOPIC_INSIGHTS:
        return this.fetchFromTopicInsightsReport(sourceId, userId);

      default:
        throw new Error(`不支持的来源类型: ${sourceType}`);
    }
  }

  private async fetchFromExploreResource(
    resourceId: string,
    userId: string,
  ): Promise<FetchedContent> {
    // ★ R5 P0 fix (2026-05-18): IDOR — Resource 表无 userId 字段，必须通过
    //   CollectionItem→Collection.userId 间接确认资源属于调用者。否则任何已知
    //   resourceId 都可被跨用户读取（直接进入 AI 生成上下文）。
    const resource = await this.prisma.resource.findFirst({
      where: {
        id: resourceId,
        collectionItems: {
          some: { collection: { userId } },
        },
      },
    });

    if (!resource) {
      throw new Error("资源不存在");
    }

    // ===== YouTube 视频：优先使用数据库缓存的字幕（和 AI Explore 一致） =====
    if (resource.type === "YOUTUBE_VIDEO") {
      const videoId = this.ragFacade.contentFetch!.extractYoutubeVideoId(
        resource.sourceUrl,
      );
      if (videoId) {
        this.logger.log(
          `Processing YouTube resource ${resourceId}, videoId: ${videoId}`,
        );

        // 直接使用 engine 的 fetchFromYoutubeUrl，它会先检查缓存
        try {
          const youtubeContent =
            await this.ragFacade.contentFetch!.fetchFromYoutubeUrl(
              videoId,
              resource.sourceUrl,
            );

          // 如果成功获取到字幕，返回（保留 Resource 的标题如果更好）
          if (
            youtubeContent.content &&
            youtubeContent.content.trim().length > 100
          ) {
            return {
              title: sanitizeForDb(resource.title || youtubeContent.title),
              content: youtubeContent.content,
              originalContent: youtubeContent.originalContent,
              translatedContent: youtubeContent.translatedContent,
              isBilingual: youtubeContent.isBilingual,
              coverImage: resource.thumbnailUrl || youtubeContent.coverImage,
              metadata: {
                ...youtubeContent.metadata,
                resourceId,
                resourceType: resource.type,
                authors: resource.authors,
              },
            };
          }
        } catch (err) {
          this.logger.warn(
            `Failed to fetch YouTube content for resource ${resourceId}: ${err}`,
          );
          // 继续尝试使用 Resource 本身的内容
        }
      }
    }

    // ===== 非 YouTube 资源或 YouTube 字幕获取失败 =====
    // Use the best available content: content > aiSummary > abstract
    let bestContent =
      resource.content || resource.aiSummary || resource.abstract || "";
    const isBilingual = false;

    // 如果是普通网页且内容不足，尝试从 URL 获取
    if (
      !bestContent ||
      (bestContent.trim().length < 100 && resource.sourceUrl)
    ) {
      this.logger.log(
        `Resource ${resourceId} has insufficient content (${bestContent?.length || 0} chars), fetching from URL...`,
      );
      try {
        const fetched = await this.ragFacade.contentFetch!.fetchFromUrl(
          resource.sourceUrl,
        );
        if (
          fetched.content &&
          fetched.content.length > (bestContent?.length || 0)
        ) {
          bestContent = fetched.content;
          this.logger.log(
            `Fetched content from URL: ${bestContent.length} chars`,
          );

          // 更新 Resource 的内容（异步，不阻塞）
          this.updateResourceContent(resourceId, bestContent).catch((err) => {
            this.logger.warn(`Failed to update resource content: ${err}`);
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch content from URL: ${err}`);
      }
    }

    if (!bestContent || bestContent.trim().length < 10) {
      this.logger.warn(
        `Resource ${resourceId} has insufficient content: length=${bestContent?.length || 0}`,
      );
      throw new Error(
        "该资源内容不足，无法生成社交媒体内容。请选择内容更丰富的资源。",
      );
    }

    // Sanitize all string fields to prevent PostgreSQL protocol errors
    return {
      title: sanitizeForDb(resource.title),
      content: sanitizeForDb(bestContent),
      isBilingual,
      coverImage: resource.thumbnailUrl || undefined,
      url: resource.sourceUrl || undefined,
      metadata: sanitizeJson({
        resourceId,
        type: resource.type,
        authors: resource.authors,
      }) as Record<string, unknown>,
    };
  }

  /**
   * 异步更新 Resource 的内容（用于缓存从 URL 获取的内容）
   */
  private async updateResourceContent(
    resourceId: string,
    content: string,
  ): Promise<void> {
    try {
      await this.prisma.resource.update({
        where: { id: resourceId },
        data: { content: sanitizeForDb(content) },
      });
      this.logger.log(`Updated resource ${resourceId} with fetched content`);
    } catch (error) {
      this.logger.warn(`Failed to update resource content: ${error}`);
    }
  }

  private async fetchFromResearchReport(
    topicId: string,
    userId: string,
  ): Promise<FetchedContent> {
    const topic = await this.prisma.researchTopic.findFirst({
      where: { id: topicId, userId },
      include: {
        reports: {
          orderBy: { version: "desc" },
          take: 1,
        },
      },
    });

    if (!topic) {
      throw new Error("研究主题不存在");
    }

    const latestReport = topic.reports[0];

    // Sanitize content to prevent PostgreSQL protocol errors
    return {
      title: sanitizeForDb(topic.name),
      content:
        sanitizeForDb(latestReport?.fullReport || topic.description) || "",
      metadata: {
        status: topic.status,
        reportVersion: latestReport?.version,
      },
    };
  }

  private async fetchFromOfficeDocument(
    documentId: string,
    userId: string,
  ): Promise<FetchedContent> {
    const document = await this.prisma.officeDocument.findFirst({
      where: { id: documentId, userId },
    });

    if (!document) {
      throw new Error("文档不存在");
    }

    // Sanitize user content to prevent PostgreSQL protocol errors
    const rawContent =
      typeof document.content === "string"
        ? document.content
        : JSON.stringify(document.content);

    return {
      title: sanitizeForDb(document.title),
      content: sanitizeForDb(rawContent),
      metadata: {
        documentType: document.type,
      },
    };
  }

  private async fetchFromWritingChapter(
    chapterId: string,
    userId: string,
  ): Promise<FetchedContent> {
    const chapter = await this.prisma.writingChapter.findFirst({
      where: { id: chapterId },
      include: {
        volume: {
          include: {
            project: {
              select: { ownerId: true, name: true },
            },
          },
        },
      },
    });

    if (!chapter || chapter.volume.project.ownerId !== userId) {
      throw new Error("章节不存在");
    }

    // Sanitize user content to prevent PostgreSQL protocol errors
    return {
      title: sanitizeForDb(chapter.title),
      content: sanitizeForDb(chapter.content) || "",
      metadata: {
        projectName: sanitizeForDb(chapter.volume.project.name),
        wordCount: chapter.wordCount,
      },
    };
  }

  private async fetchFromTopicInsightsReport(
    topicId: string,
    userId: string,
  ): Promise<FetchedContent> {
    const topic = await this.prisma.researchTopic.findFirst({
      where: { id: topicId, userId },
      include: {
        reports: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            id: true,
            version: true,
            fullReport: true,
            executiveSummary: true,
            charts: true,
            totalDimensions: true,
            totalSources: true,
          },
        },
      },
    });

    if (!topic) {
      throw new Error("话题不存在");
    }

    const latestReport = topic.reports[0];
    if (!latestReport?.fullReport) {
      throw new Error("该话题还没有生成报告，请先生成报告后再导入");
    }

    return {
      title: sanitizeForDb(topic.name),
      content: sanitizeForDb(latestReport.fullReport),
      metadata: {
        topicId,
        reportId: latestReport.id,
        reportVersion: latestReport.version,
        executiveSummary: latestReport.executiveSummary,
        charts: latestReport.charts,
        totalDimensions: latestReport.totalDimensions,
        totalSources: latestReport.totalSources,
      },
    };
  }
}
