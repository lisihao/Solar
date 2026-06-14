import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  CollectionTask,
  CollectionTaskStatus,
  CollectionTaskType,
  Prisma,
} from "@prisma/client";
import { ArxivService } from "../crawlers/arxiv.service";
import { GithubService } from "../crawlers/github.service";
import { HackernewsService } from "../crawlers/hackernews.service";
import { RssService, CollectionResult } from "../crawlers/rss.service";
import { WebScraperService } from "../crawlers/web-scraper.service";
import { getErrorStack } from "../../../../../common/utils/error.utils";

export interface CreateCollectionTaskDto {
  name: string;
  description?: string;
  type: CollectionTaskType;
  sourceId: string;
  sourceConfig: Record<string, unknown>;
  schedule?: string;
  priority?: number;
  maxConcurrency?: number;
  timeout?: number;
  retryCount?: number;
  deduplicationRules?: Record<string, unknown>;
  createdBy?: string;
}

export interface UpdateCollectionTaskDto {
  name?: string;
  description?: string;
  status?: CollectionTaskStatus;
  schedule?: string;
  priority?: number;
  maxConcurrency?: number;
  timeout?: number;
  retryCount?: number;
  deduplicationRules?: Record<string, unknown>;
}

@Injectable()
export class CollectionTaskService {
  private readonly logger = new Logger(CollectionTaskService.name);

  constructor(
    private prisma: PrismaService,
    private arxivService: ArxivService,
    private githubService: GithubService,
    private hackernewsService: HackernewsService,
    private rssService: RssService,
    private webScraperService: WebScraperService,
  ) {
    // Keep reference to arxivService for future arXiv API queries
    void this.arxivService;
  }

  /**
   * 创建采集任务
   */
  async create(dto: CreateCollectionTaskDto): Promise<CollectionTask> {
    this.logger.log(`Creating collection task: ${dto.name}`);

    const task = await this.prisma.collectionTask.create({
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type,
        sourceId: dto.sourceId,
        sourceConfig: (dto.sourceConfig || {}) as Prisma.InputJsonValue,
        schedule: dto.schedule,
        priority: dto.priority || 5,
        maxConcurrency: dto.maxConcurrency || 5,
        timeout: dto.timeout || 300,
        retryCount: dto.retryCount || 3,
        deduplicationRules: (dto.deduplicationRules ||
          {}) as Prisma.InputJsonValue,
        status: "PENDING",
        progress: 0,
        createdBy: dto.createdBy,
      },
      include: {
        source: true,
      },
    });

    this.logger.log(`Collection task created: ${task.id}`);
    return task;
  }

  /**
   * 获取所有任务
   */
  async findAll(filters?: {
    status?: CollectionTaskStatus;
    type?: CollectionTaskType;
    sourceId?: string;
    limit?: number;
  }): Promise<CollectionTask[]> {
    const where: Record<string, unknown> = {};

    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.type) {
      where.type = filters.type;
    }
    if (filters?.sourceId) {
      where.sourceId = filters.sourceId;
    }

    return this.prisma.collectionTask.findMany({
      where,
      include: {
        source: true,
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: filters?.limit || 100,
    });
  }

  /**
   * 获取单个任务
   */
  async findOne(id: string): Promise<CollectionTask> {
    const task = await this.prisma.collectionTask.findUnique({
      where: { id },
      include: {
        source: true,
        resources: {
          take: 10,
          orderBy: { createdAt: "desc" },
        },
        deduplicationRecords: {
          take: 10,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(`Collection task ${id} not found`);
    }

    return task;
  }

  /**
   * 更新任务
   */
  async update(
    id: string,
    dto: UpdateCollectionTaskDto,
  ): Promise<CollectionTask> {
    this.logger.log(`Updating collection task: ${id}`);

    await this.findOne(id);

    const task = await this.prisma.collectionTask.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        status: dto.status,
        schedule: dto.schedule,
        priority: dto.priority,
        maxConcurrency: dto.maxConcurrency,
        timeout: dto.timeout,
        retryCount: dto.retryCount,
        deduplicationRules: dto.deduplicationRules as Prisma.InputJsonValue,
      },
      include: {
        source: true,
      },
    });

    this.logger.log(`Collection task updated: ${id}`);
    return task;
  }

  /**
   * 删除任务
   */
  async remove(id: string): Promise<void> {
    this.logger.log(`Deleting collection task: ${id}`);

    await this.findOne(id);

    await this.prisma.collectionTask.delete({
      where: { id },
    });

    this.logger.log(`Collection task deleted: ${id}`);
  }

  /**
   * 执行任务 - 实际采集数据
   */
  async execute(id: string): Promise<void> {
    this.logger.log(`Executing collection task: ${id}`);

    try {
      // 获取任务详情
      const task = await this.findOne(id);

      // 更新状态为运行中
      await this.prisma.collectionTask.update({
        where: { id },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          progress: 0,
          currentStep: "Initializing collection",
        },
      });

      // 开始实际采集工作
      // 1. 根据数据源类型调用相应的爬虫服务
      let collectedCount: number | CollectionResult = 0;

      // 从数据源获取类型
      const dataSource = await this.prisma.dataSource.findUnique({
        where: { id: task.sourceId },
      });

      if (!dataSource) {
        throw new Error(`Data source ${task.sourceId} not found`);
      }

      const sourceType = dataSource.type;
      const sourceConfig = task.sourceConfig as Record<string, unknown>;
      const maxResults =
        (typeof sourceConfig?.maxResults === "number"
          ? sourceConfig.maxResults
          : undefined) || 10;
      // Category from source config or data source (used for filtering)
      void (sourceConfig?.category || dataSource.category);

      this.logger.log(
        `Starting collection from ${sourceType} (max: ${maxResults})`,
      );

      // 更新进度
      await this.updateProgress(id, 10, `Fetching from ${sourceType}`);

      // 调用对应的爬虫服务
      // 注意：这些服务已经实现了完整的数据存储逻辑：
      // - 存储完整原始数据到 MongoDB
      // - 创建 Resource 到 PostgreSQL
      // - 建立双向引用关系
      // - 执行去重检查
      switch (sourceType) {
        case "ARXIV":
          // arXiv 使用 RSS feed (https://rss.arxiv.org/rss/cs.AI 等)
          const arxivRssUrl = dataSource.baseUrl;
          this.logger.log(`Fetching arXiv RSS feed from: ${arxivRssUrl}`);
          collectedCount = await this.rssService.fetchRssFeed(
            arxivRssUrl,
            maxResults,
            dataSource.category,
          );
          break;

        case "GITHUB":
          collectedCount = await this.githubService.fetchTrendingRepos(
            typeof sourceConfig?.language === "string"
              ? sourceConfig.language
              : undefined,
            typeof sourceConfig?.since === "string" &&
              ["daily", "weekly", "monthly"].includes(sourceConfig.since)
              ? (sourceConfig.since as "daily" | "weekly" | "monthly")
              : "daily",
          );
          break;

        case "HACKERNEWS":
          collectedCount =
            await this.hackernewsService.fetchTopStories(maxResults);
          break;

        case "RSS":
        case "YOUTUBE":
        case "SUBSTACK":
        case "MEDIUM":
        case "DEVTO":
        case "HASHNODE":
        case "TECHCRUNCH":
        case "THE_VERGE":
          // RSS/Atom订阅源采集 (包括YouTube频道、Substack、各类博客)
          // YouTube RSS格式: https://www.youtube.com/feeds/videos.xml?channel_id=XXX
          const crawlerConfigRss = dataSource.crawlerConfig as Record<
            string,
            unknown
          >;
          const rssUrl =
            (typeof crawlerConfigRss?.rssUrl === "string"
              ? crawlerConfigRss.rssUrl
              : undefined) || dataSource.baseUrl;
          this.logger.log(`Fetching RSS feed from: ${rssUrl}`);

          // 构建过滤选项（YouTube视频时长过滤等）
          const filterOptions: {
            minDurationSeconds?: number;
            skipUnknownDuration?: boolean;
          } = {};

          // 判断是否为 YouTube RSS 源（基于 URL 检测，与 rss.service.ts 保持一致）
          // 注意：不能单靠 sourceType === "YOUTUBE"，因为 YouTube 频道也可能被添加为 RSS 类型
          const isYouTubeRssUrl = rssUrl.includes(
            "youtube.com/feeds/videos.xml",
          );
          const configuredMinDuration =
            typeof crawlerConfigRss?.minDurationSeconds === "number"
              ? crawlerConfigRss.minDurationSeconds
              : null;

          if (isYouTubeRssUrl) {
            // 如果数据源配置了 minDurationSeconds 就用配置值；
            // 否则对所有 YouTube RSS 应用 15 分钟兜底最小时长，只采集有深度的长视频
            const DEFAULT_YOUTUBE_MIN_DURATION = 15 * 60; // 900s
            filterOptions.minDurationSeconds =
              configuredMinDuration ?? DEFAULT_YOUTUBE_MIN_DURATION;
            // 无法获取时长时默认跳过（避免无法验证的视频漏网）
            filterOptions.skipUnknownDuration = true;
            this.logger.log(
              `YouTube filter: min duration ${filterOptions.minDurationSeconds}s (${Math.floor(filterOptions.minDurationSeconds / 60)}m)${configuredMinDuration === null ? " [default]" : ""}, skip unknown duration: true`,
            );
          }

          // 更新进度 - 开始采集
          await this.updateProgress(
            id,
            20,
            `Connecting to RSS feed: ${rssUrl}`,
          );

          collectedCount = await this.rssService.fetchRssFeed(
            rssUrl,
            maxResults,
            dataSource.category,
            Object.keys(filterOptions).length > 0 ? filterOptions : undefined,
          );

          // 更新进度 - RSS 解析完成
          const rssCount =
            typeof collectedCount === "object"
              ? collectedCount.success
              : collectedCount;
          await this.updateProgress(
            id,
            80,
            `RSS feed processed: ${rssCount} items collected`,
          );
          break;

        case "CUSTOM":
          // 通用网页爬虫采集
          const pageUrl = dataSource.baseUrl + dataSource.apiEndpoint;
          const crawlerConfigCustom = dataSource.crawlerConfig as Record<
            string,
            unknown
          >;
          const selector =
            (typeof crawlerConfigCustom?.selector === "string"
              ? crawlerConfigCustom.selector
              : undefined) || ".news-item";
          collectedCount = await this.webScraperService.scrapeWebPage(
            pageUrl,
            maxResults,
            dataSource.category,
            selector,
          );
          break;

        case "PUBMED":
        case "IEEE":
        case "ACL_ANTHOLOGY":
        case "BILIBILI":
        case "PRODUCTHUNT":
        case "POLICY_US":
        case "POLICY_EU":
        case "POLICY_CN":
        case "GARTNER":
        case "MCKINSEY":
        case "IDC":
          // 这些数据源类型暂未实现具体的采集逻辑
          // 标记任务为已完成，但收集数量为0
          this.logger.warn(
            `Data source type ${sourceType} is not yet implemented. Task marked as completed with 0 items.`,
          );
          collectedCount = 0;
          break;

        default:
          throw new Error(`Unsupported source type: ${sourceType}`);
      }

      const logCount =
        typeof collectedCount === "object"
          ? collectedCount.success
          : collectedCount;
      this.logger.log(`Collected ${logCount} items from ${sourceType}`);

      // 更新任务统计
      await this.updateStats(id, {
        totalItems:
          typeof collectedCount === "object"
            ? collectedCount.success
            : collectedCount,
        processedItems:
          typeof collectedCount === "object"
            ? collectedCount.success
            : collectedCount,
        successItems:
          typeof collectedCount === "object"
            ? collectedCount.success
            : collectedCount,
        failedItems:
          typeof collectedCount === "object" ? collectedCount.failed : 0,
        duplicateItems:
          typeof collectedCount === "object" ? collectedCount.duplicates : 0,
        skippedItems: 0,
      });

      // 完成任务
      await this.prisma.collectionTask.update({
        where: { id },
        data: {
          status: "COMPLETED",
          progress: 100,
          completedAt: new Date(),
          currentStep: `Completed - collected ${typeof collectedCount === "object" ? collectedCount.success : collectedCount} items`,
        },
      });

      // 更新数据源的统计信息
      await this.prisma.dataSource.update({
        where: { id: task.sourceId },
        data: {
          totalCollected: {
            increment:
              typeof collectedCount === "object"
                ? collectedCount.success
                : collectedCount,
          },
          lastSuccessAt: new Date(),
        },
      });

      this.logger.log(`Task ${id} completed successfully`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = getErrorStack(error);

      this.logger.error(`Task ${id} failed: ${errorMessage}`, errorStack);

      // 尝试更新任务状态为失败
      try {
        await this.prisma.collectionTask.update({
          where: { id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            errorMessage,
            errorStack,
          },
        });

        // 更新数据源状态
        const task = await this.prisma.collectionTask.findUnique({
          where: { id },
          include: { source: true },
        });

        if (task?.sourceId) {
          await this.prisma.dataSource.update({
            where: { id: task.sourceId },
            data: {
              status: "FAILED",
              lastErrorMessage: errorMessage,
            },
          });
        }
      } catch (updateError) {
        this.logger.error(
          `Failed to update task/source status: ${updateError}`,
        );
      }

      // ⚠️ 注意：不要重新抛出错误！
      // 错误已记录在任务中，前端可以通过查询任务状态获取错误信息
    }
  }

  /**
   * 暂停任务
   */
  async pause(id: string): Promise<CollectionTask> {
    return this.update(id, { status: "PAUSED" });
  }

  /**
   * 恢复任务
   */
  async resume(id: string): Promise<CollectionTask> {
    return this.update(id, { status: "PENDING" });
  }

  /**
   * 取消任务
   */
  async cancel(id: string): Promise<CollectionTask> {
    return this.update(id, { status: "CANCELLED" });
  }

  /**
   * 更新任务进度
   */
  async updateProgress(
    id: string,
    progress: number,
    currentStep?: string,
  ): Promise<void> {
    await this.prisma.collectionTask.update({
      where: { id },
      data: {
        progress,
        currentStep,
      },
    });
  }

  /**
   * 更新任务统计
   */
  async updateStats(
    id: string,
    stats: {
      totalItems?: number;
      processedItems?: number;
      successItems?: number;
      failedItems?: number;
      duplicateItems?: number;
      skippedItems?: number;
    },
  ): Promise<void> {
    const task = await this.findOne(id);

    await this.prisma.collectionTask.update({
      where: { id },
      data: {
        totalItems: stats.totalItems ?? task.totalItems,
        processedItems: stats.processedItems ?? task.processedItems,
        successItems: stats.successItems ?? task.successItems,
        failedItems: stats.failedItems ?? task.failedItems,
        duplicateItems: stats.duplicateItems ?? task.duplicateItems,
        skippedItems: stats.skippedItems ?? task.skippedItems,
      },
    });
  }

  /**
   * 获取运行中的任务
   */
  async getRunningTasks(): Promise<CollectionTask[]> {
    return this.findAll({ status: "RUNNING" });
  }

  /**
   * 获取待执行的任务
   */
  async getPendingTasks(): Promise<CollectionTask[]> {
    return this.findAll({ status: "PENDING" });
  }
}
