import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  DataSource,
  DataSourceStatus,
  DataSourceType,
  Prisma,
} from "@prisma/client";

export interface CreateDataSourceDto {
  name: string;
  description?: string;
  type: DataSourceType;
  category: string;
  baseUrl: string;
  apiEndpoint?: string;
  authType?: string;
  credentials?: string;
  crawlerType: string;
  crawlerConfig: Prisma.InputJsonValue;
  rateLimit?: number;
  keywords?: string[];
  categories?: string[];
  languages?: string[];
  minQualityScore?: number;
  deduplicationConfig?: Prisma.InputJsonValue;
  status?: DataSourceStatus;
  createdBy?: string;
}

export interface UpdateDataSourceDto {
  name?: string;
  description?: string;
  status?: DataSourceStatus;
  baseUrl?: string;
  apiEndpoint?: string;
  authType?: string;
  credentials?: string;
  crawlerType?: string;
  crawlerConfig?: Prisma.InputJsonValue;
  rateLimit?: number;
  keywords?: string[];
  categories?: string[];
  languages?: string[];
  minQualityScore?: number;
  deduplicationConfig?: Prisma.InputJsonValue;
}

@Injectable()
export class DataSourceService {
  private readonly logger = new Logger(DataSourceService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 创建数据源 (with deduplication check)
   */
  async create(dto: CreateDataSourceDto): Promise<DataSource> {
    this.logger.log(`Creating data source: ${dto.name}`);

    // Check for duplicate by name + category or baseUrl
    const existing = await this.prisma.dataSource.findFirst({
      where: {
        OR: [
          { name: dto.name, category: dto.category as never },
          ...(dto.baseUrl ? [{ baseUrl: dto.baseUrl }] : []),
        ],
      },
    });

    if (existing) {
      this.logger.log(
        `Data source already exists: ${existing.name} (${existing.id}), returning existing`,
      );
      return existing;
    }

    const dataSource = await this.prisma.dataSource.create({
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type,
        category: dto.category as never, // ResourceType
        baseUrl: dto.baseUrl,
        apiEndpoint: dto.apiEndpoint,
        authType: dto.authType || "NONE",
        credentials: dto.credentials,
        crawlerType: dto.crawlerType,
        crawlerConfig: dto.crawlerConfig || {},
        rateLimit: dto.rateLimit,
        keywords: dto.keywords || [],
        categories: dto.categories || [],
        languages: dto.languages || ["en"],
        minQualityScore: dto.minQualityScore || 0,
        deduplicationConfig: dto.deduplicationConfig || {},
        status: dto.status || "ACTIVE",
        isVerified: false,
        createdBy: dto.createdBy,
      },
    });

    this.logger.log(`Data source created: ${dataSource.id}`);
    return dataSource;
  }

  /**
   * 获取所有数据源
   */
  async findAll(filters?: {
    type?: DataSourceType;
    status?: DataSourceStatus;
    category?: string;
  }): Promise<DataSource[]> {
    const where: Prisma.DataSourceWhereInput = {};

    if (filters?.type) {
      where.type = filters.type;
    }
    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.category) {
      where.category = filters.category as never;
    }

    return this.prisma.dataSource.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
  }

  /**
   * 获取单个数据源
   */
  async findOne(id: string): Promise<DataSource> {
    const dataSource = await this.prisma.dataSource.findUnique({
      where: { id },
      include: {
        tasks: {
          take: 10,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!dataSource) {
      throw new NotFoundException(`Data source ${id} not found`);
    }

    return dataSource;
  }

  /**
   * 更新数据源
   */
  async update(id: string, dto: UpdateDataSourceDto): Promise<DataSource> {
    this.logger.log(`Updating data source: ${id}`);

    // 确保数据源存在
    await this.findOne(id);

    const dataSource = await this.prisma.dataSource.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        status: dto.status,
        baseUrl: dto.baseUrl,
        apiEndpoint: dto.apiEndpoint,
        authType: dto.authType,
        credentials: dto.credentials,
        crawlerType: dto.crawlerType,
        crawlerConfig: dto.crawlerConfig,
        rateLimit: dto.rateLimit,
        keywords: dto.keywords,
        categories: dto.categories,
        languages: dto.languages,
        minQualityScore: dto.minQualityScore,
        deduplicationConfig: dto.deduplicationConfig,
      },
    });

    this.logger.log(`Data source updated: ${id}`);
    return dataSource;
  }

  /**
   * 删除数据源
   */
  async remove(id: string): Promise<void> {
    this.logger.log(`Deleting data source: ${id}`);

    // 确保数据源存在
    await this.findOne(id);

    await this.prisma.dataSource.delete({
      where: { id },
    });

    this.logger.log(`Data source deleted: ${id}`);
  }

  /**
   * 测试数据源连接
   */
  async test(id: string): Promise<{ success: boolean; message: string }> {
    // Verify data source exists
    await this.findOne(id);

    try {
      // TODO: 实现实际的连接测试逻辑
      // 根据 crawlerType 调用不同的测试方法

      await this.prisma.dataSource.update({
        where: { id },
        data: {
          lastTestedAt: new Date(),
          lastSuccessAt: new Date(),
          lastErrorMessage: null,
          isVerified: true,
        },
      });

      return { success: true, message: "Connection successful" };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await this.prisma.dataSource.update({
        where: { id },
        data: {
          lastTestedAt: new Date(),
          lastErrorMessage: errorMessage,
          status: "FAILED",
          isVerified: false,
        },
      });

      return { success: false, message: errorMessage };
    }
  }

  /**
   * 更新数据源统计
   */
  async updateStats(
    id: string,
    stats: {
      collected?: number;
      success?: number;
      failed?: number;
      duplicates?: number;
    },
  ): Promise<void> {
    const dataSource = await this.findOne(id);

    const totalCollected = dataSource.totalCollected + (stats.collected || 0);
    const totalSuccess = dataSource.totalSuccess + (stats.success || 0);
    const totalFailed = dataSource.totalFailed + (stats.failed || 0);
    const totalDuplicates =
      dataSource.totalDuplicates + (stats.duplicates || 0);

    const successRate =
      totalCollected > 0 ? (totalSuccess / totalCollected) * 100 : 0;

    await this.prisma.dataSource.update({
      where: { id },
      data: {
        totalCollected,
        totalSuccess,
        totalFailed,
        totalDuplicates,
        successRate,
        lastSuccessAt: stats.success ? new Date() : undefined,
      },
    });
  }

  /**
   * 获取数据源统计摘要
   */
  async getStatsSummary(): Promise<{
    total: number;
    active: number;
    paused: number;
    failed: number;
    byType: Record<string, number>;
  }> {
    const sources = await this.prisma.dataSource.findMany();

    const summary = {
      total: sources.length,
      active: sources.filter((s) => s.status === "ACTIVE").length,
      paused: sources.filter((s) => s.status === "PAUSED").length,
      failed: sources.filter((s) => s.status === "FAILED").length,
      byType: {} as Record<string, number>,
    };

    // 按类型统计
    sources.forEach((source) => {
      summary.byType[source.type] = (summary.byType[source.type] || 0) + 1;
    });

    return summary;
  }

  /**
   * 批量创建数据源
   */
  async bulkCreate(dtos: CreateDataSourceDto[]): Promise<{
    created: number;
    skipped: number;
    failed: number;
    errors: Array<{ name: string; error: string }>;
  }> {
    this.logger.log(`Bulk creating ${dtos.length} data sources`);

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ name: string; error: string }> = [];

    for (const dto of dtos) {
      try {
        // 检查数据源是否已存在
        const existing = await this.prisma.dataSource.findFirst({
          where: {
            name: dto.name,
            category: dto.category as never,
          },
        });

        if (existing) {
          this.logger.log(`Skipping ${dto.name} - already exists`);
          skipped++;
          continue;
        }

        // 创建数据源
        await this.create(dto);
        this.logger.log(`Created: ${dto.name} (${dto.category})`);
        created++;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(`Error creating ${dto.name}:`, errorMessage);
        errors.push({ name: dto.name, error: errorMessage });
        failed++;
      }
    }

    this.logger.log(
      `Bulk create completed: ${created} created, ${skipped} skipped, ${failed} failed`,
    );

    return { created, skipped, failed, errors };
  }

  /**
   * 修复已知的RSS URL问题
   * 修复社区反馈的常见RSS URL错误
   */
  async fixKnownRssUrls(): Promise<{
    fixed: string[];
    failed: string[];
    skipped: string[];
  }> {
    this.logger.log("Starting RSS URL fixes...");

    const fixes = [
      {
        name: "OpenAI Blog",
        baseUrl: "https://openai.com",
        apiEndpoint: "/news/rss.xml",
        rssUrl: "https://openai.com/news/rss.xml",
      },
      {
        name: "DeepMind Blog",
        baseUrl: "https://blog.google",
        apiEndpoint: "/technology/google-deepmind/rss/",
        rssUrl: "https://blog.google/technology/google-deepmind/rss/",
      },
      {
        name: "Meta AI Blog",
        baseUrl: "https://engineering.fb.com",
        apiEndpoint: "/feed",
        rssUrl: "https://engineering.fb.com/feed/",
        description: "AI research and innovations from Meta Engineering",
      },
      {
        name: "Anthropic Blog",
        baseUrl: "https://raw.githubusercontent.com",
        apiEndpoint:
          "/Olshansk/rss-feeds/refs/heads/main/feeds/feed_anthropic_news.xml",
        rssUrl:
          "https://raw.githubusercontent.com/Olshansk/rss-feeds/refs/heads/main/feeds/feed_anthropic_news.xml",
        description: "AI safety and research from Anthropic (Community RSS)",
        status: "ACTIVE" as DataSourceStatus,
      },
    ];

    const fixed: string[] = [];
    const failed: string[] = [];
    const skipped: string[] = [];

    for (const fix of fixes) {
      try {
        // 查找数据源
        const source = await this.prisma.dataSource.findFirst({
          where: { name: fix.name },
        });

        if (!source) {
          this.logger.warn(`Data source not found: ${fix.name}`);
          skipped.push(fix.name);
          continue;
        }

        // 更新URL
        await this.prisma.dataSource.update({
          where: { id: source.id },
          data: {
            baseUrl: fix.baseUrl,
            apiEndpoint: fix.apiEndpoint,
            crawlerConfig: {
              ...(typeof source.crawlerConfig === "object" &&
              source.crawlerConfig !== null
                ? (source.crawlerConfig as Prisma.JsonObject)
                : {}),
              rssUrl: fix.rssUrl,
            } as Prisma.InputJsonValue,
            ...(fix.description && { description: fix.description }),
            ...(fix.status && { status: fix.status }),
          },
        });

        this.logger.log(`Fixed RSS URL for: ${fix.name}`);
        fixed.push(fix.name);
      } catch (error) {
        this.logger.error(
          `Failed to fix RSS URL for ${fix.name}`,
          error instanceof Error ? error.stack : String(error),
        );
        failed.push(fix.name);
      }
    }

    this.logger.log(
      `RSS URL fixes completed: ${fixed.length} fixed, ${failed.length} failed, ${skipped.length} skipped`,
    );

    return { fixed, failed, skipped };
  }
}
