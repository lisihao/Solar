import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { Prisma, ResourceType } from "@prisma/client";
import { EXCLUDE_DEAD_LINKS } from "../resources/link-health.constants";

/**
 * Feed 流服务
 */
@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 获取 Feed 流（时间倒序）
   */
  async getFeed(params: {
    skip?: number;
    take?: number;
    type?: string;
    category?: string;
    minQualityScore?: number;
    sortBy?: "publishedAt" | "qualityScore" | "trendingScore";
  }) {
    const {
      skip = 0,
      take = 20,
      type,
      category,
      minQualityScore,
      sortBy = "publishedAt",
    } = params;

    // 始终过滤掉空标题的资源 + 隐藏失效链接（BROKEN/ARCHIVED）
    const where: Prisma.ResourceWhereInput = {
      NOT: {
        title: "",
      },
      ...EXCLUDE_DEAD_LINKS,
    };

    if (type) {
      where.type = type as ResourceType;
    }

    if (category) {
      where.categories = {
        array_contains: category,
      };
    }

    if (minQualityScore) {
      where.qualityScore = {
        gte: minQualityScore.toString(),
      };
    }

    const [resources, total] = await Promise.all([
      this.prisma.resource.findMany({
        where,
        skip,
        take,
        orderBy: {
          [sortBy]: "desc",
        },
        select: {
          id: true,
          type: true,
          title: true,
          abstract: true,
          sourceUrl: true,
          pdfUrl: true,
          codeUrl: true,
          authors: true,
          publishedAt: true,
          aiSummary: true,
          primaryCategory: true,
          categories: true,
          tags: true,
          qualityScore: true,
          trendingScore: true,
          viewCount: true,
          upvoteCount: true,
          commentCount: true,
          createdAt: true,
        },
      }),
      this.prisma.resource.count({ where }),
    ]);

    return {
      data: resources,
      pagination: {
        total,
        skip,
        take,
        hasMore: skip + take < total,
      },
    };
  }

  /**
   * 搜索资源
   */
  async search(params: {
    query: string;
    skip?: number;
    take?: number;
    type?: string;
    category?: string;
  }) {
    const { query, skip = 0, take = 20, type, category } = params;

    const where: Prisma.ResourceWhereInput = {
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { abstract: { contains: query, mode: "insensitive" } },
        { content: { contains: query, mode: "insensitive" } },
      ],
      ...EXCLUDE_DEAD_LINKS,
    };

    if (type) {
      where.type = type as ResourceType;
    }

    if (category) {
      where.categories = {
        array_contains: category,
      };
    }

    const [resources, total] = await Promise.all([
      this.prisma.resource.findMany({
        where,
        skip,
        take,
        orderBy: {
          publishedAt: "desc",
        },
      }),
      this.prisma.resource.count({ where }),
    ]);

    this.logger.log(
      `Search query "${query}" returned ${resources.length} results`,
    );

    return {
      query,
      data: resources,
      pagination: {
        total,
        skip,
        take,
        hasMore: skip + take < total,
      },
    };
  }

  /**
   * 获取热门资源
   */
  async getTrending(take = 10) {
    const resources = await this.prisma.resource.findMany({
      take,
      orderBy: {
        trendingScore: "desc",
      },
      where: {
        trendingScore: {
          not: "0",
        },
        ...EXCLUDE_DEAD_LINKS,
      },
    });

    return resources;
  }

  /**
   * 获取相关资源 - 多策略混合推荐
   *
   * 策略优先级：
   * 1. 分类+标签匹配（高相关性）
   * 2. 标题关键词匹配（语义相关）
   * 3. 同类型资源（类型相关）
   * 4. 同主分类资源（领域相关）
   * 5. 热门资源回退（保底推荐）
   */
  async getRelated(resourceId: string, take = 6) {
    this.logger.log(
      `Finding related resources for ${resourceId}, take=${take}`,
    );

    // 获取目标资源的完整信息
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
      select: {
        id: true,
        type: true,
        title: true,
        abstract: true,
        categories: true,
        tags: true,
        primaryCategory: true,
        autoTags: true,
      },
    });

    if (!resource) {
      this.logger.warn(`Resource ${resourceId} not found`);
      return [];
    }

    // 收集所有推荐结果，使用 Map 去重并记录匹配分数
    const recommendationMap = new Map<
      string,
      { resource: Record<string, unknown>; score: number; matchType: string }
    >();

    // 策略1: 分类+标签精确匹配（权重最高）
    const categoryTagMatches = await this.findByCategoryAndTags(
      resource,
      resourceId,
      take * 2,
    );
    categoryTagMatches.forEach((r) => {
      if (!recommendationMap.has(r.id)) {
        recommendationMap.set(r.id, {
          resource: r,
          score: 100,
          matchType: "category_tag",
        });
      }
    });
    this.logger.debug(
      `Strategy 1 (category+tag): found ${categoryTagMatches.length} matches`,
    );

    // 策略2: 标题关键词匹配（语义相关）
    if (recommendationMap.size < take) {
      const titleKeywords = this.extractKeywords(resource.title);
      if (titleKeywords.length > 0) {
        const titleMatches = await this.findByTitleKeywords(
          titleKeywords,
          resource.type,
          resourceId,
          take,
        );
        titleMatches.forEach((r) => {
          if (!recommendationMap.has(r.id)) {
            recommendationMap.set(r.id, {
              resource: r,
              score: 80,
              matchType: "title_keyword",
            });
          } else {
            // 如果已存在，增加分数
            const existing = recommendationMap.get(r.id)!;
            existing.score += 30;
          }
        });
        this.logger.debug(
          `Strategy 2 (title keywords): found ${titleMatches.length} matches`,
        );
      }
    }

    // 策略3: 同类型资源（按质量分排序）
    if (recommendationMap.size < take) {
      const sameTypeResources = await this.findByType(
        resource.type,
        resourceId,
        take,
      );
      sameTypeResources.forEach((r) => {
        if (!recommendationMap.has(r.id)) {
          recommendationMap.set(r.id, {
            resource: r,
            score: 60,
            matchType: "same_type",
          });
        }
      });
      this.logger.debug(
        `Strategy 3 (same type): found ${sameTypeResources.length} matches`,
      );
    }

    // 策略4: 同主分类资源（跨类型）
    if (recommendationMap.size < take && resource.primaryCategory) {
      const sameCategoryResources = await this.findByPrimaryCategory(
        resource.primaryCategory,
        resourceId,
        take,
      );
      sameCategoryResources.forEach((r) => {
        if (!recommendationMap.has(r.id)) {
          recommendationMap.set(r.id, {
            resource: r,
            score: 40,
            matchType: "same_category",
          });
        }
      });
      this.logger.debug(
        `Strategy 4 (same primary category): found ${sameCategoryResources.length} matches`,
      );
    }

    // 策略5: 热门资源回退（保底）
    if (recommendationMap.size < take) {
      const popularResources = await this.findPopularResources(
        resourceId,
        take,
      );
      popularResources.forEach((r) => {
        if (!recommendationMap.has(r.id)) {
          recommendationMap.set(r.id, {
            resource: r,
            score: 20,
            matchType: "popular",
          });
        }
      });
      this.logger.debug(
        `Strategy 5 (popular fallback): found ${popularResources.length} matches`,
      );
    }

    // 按分数排序并返回前 N 个
    const sortedResults = Array.from(recommendationMap.values())
      .sort((a, b) => {
        // 首先按分数排序
        if (b.score !== a.score) return b.score - a.score;
        // 分数相同时，按质量分排序
        const qualityA = parseFloat(String(a.resource.qualityScore || "0"));
        const qualityB = parseFloat(String(b.resource.qualityScore || "0"));
        return qualityB - qualityA;
      })
      .slice(0, take)
      .map((item) => item.resource);

    this.logger.log(
      `Returning ${sortedResults.length} related resources for ${resourceId}`,
    );
    return sortedResults;
  }

  /**
   * 策略1: 基于分类和标签匹配
   */
  private async findByCategoryAndTags(
    resource: {
      categories: unknown;
      tags: unknown;
      autoTags: unknown;
      type: ResourceType;
    },
    excludeId: string,
    take: number,
  ) {
    const categories = Array.isArray(resource.categories)
      ? (resource.categories as string[])
      : [];
    const tags = Array.isArray(resource.tags)
      ? (resource.tags as string[])
      : [];
    const autoTags = Array.isArray(resource.autoTags)
      ? (resource.autoTags as string[])
      : [];
    const allTags = [...new Set([...tags, ...autoTags])];

    // 如果没有分类和标签，返回空
    if (categories.length === 0 && allTags.length === 0) {
      return [];
    }

    const orConditions: Array<{
      categories?: { array_contains: string };
      tags?: { array_contains: string };
      autoTags?: { array_contains: string };
    }> = [];

    // 分类匹配
    categories.forEach((cat) => {
      orConditions.push({ categories: { array_contains: cat } });
    });

    // 标签匹配
    allTags.forEach((tag) => {
      orConditions.push({ tags: { array_contains: tag } });
      orConditions.push({ autoTags: { array_contains: tag } });
    });

    if (orConditions.length === 0) {
      return [];
    }

    return this.prisma.resource.findMany({
      where: {
        id: { not: excludeId },
        type: resource.type,
        OR: orConditions,
        ...EXCLUDE_DEAD_LINKS,
      },
      take,
      orderBy: [{ qualityScore: "desc" }, { publishedAt: "desc" }],
      select: this.getResourceSelectFields(),
    });
  }

  /**
   * 策略2: 基于标题关键词匹配
   */
  private async findByTitleKeywords(
    keywords: string[],
    type: ResourceType,
    excludeId: string,
    take: number,
  ) {
    if (keywords.length === 0) return [];

    // 构建 OR 条件，每个关键词匹配标题或摘要
    const orConditions = keywords.flatMap((keyword) => [
      { title: { contains: keyword, mode: "insensitive" as const } },
      { abstract: { contains: keyword, mode: "insensitive" as const } },
    ]);

    return this.prisma.resource.findMany({
      where: {
        id: { not: excludeId },
        type: type,
        OR: orConditions,
        ...EXCLUDE_DEAD_LINKS,
      },
      take,
      orderBy: [{ qualityScore: "desc" }, { publishedAt: "desc" }],
      select: this.getResourceSelectFields(),
    });
  }

  /**
   * 策略3: 基于类型匹配
   */
  private async findByType(
    type: ResourceType,
    excludeId: string,
    take: number,
  ) {
    return this.prisma.resource.findMany({
      where: {
        id: { not: excludeId },
        type: type,
        ...EXCLUDE_DEAD_LINKS,
      },
      take,
      orderBy: [
        { qualityScore: "desc" },
        { trendingScore: "desc" },
        { publishedAt: "desc" },
      ],
      select: this.getResourceSelectFields(),
    });
  }

  /**
   * 策略4: 基于主分类匹配（跨类型）
   */
  private async findByPrimaryCategory(
    primaryCategory: string,
    excludeId: string,
    take: number,
  ) {
    return this.prisma.resource.findMany({
      where: {
        id: { not: excludeId },
        OR: [
          { primaryCategory: primaryCategory },
          { categories: { array_contains: primaryCategory } },
        ],
        ...EXCLUDE_DEAD_LINKS,
      },
      take,
      orderBy: [{ qualityScore: "desc" }, { publishedAt: "desc" }],
      select: this.getResourceSelectFields(),
    });
  }

  /**
   * 策略5: 热门资源回退
   */
  private async findPopularResources(excludeId: string, take: number) {
    return this.prisma.resource.findMany({
      where: {
        id: { not: excludeId },
        qualityScore: { gte: "50" },
      },
      take,
      orderBy: [
        { trendingScore: "desc" },
        { viewCount: "desc" },
        { qualityScore: "desc" },
      ],
      select: this.getResourceSelectFields(),
    });
  }

  /**
   * 从标题中提取关键词
   * - 移除常见停用词
   * - 提取有意义的词组
   */
  private extractKeywords(title: string): string[] {
    if (!title) return [];

    // 英文停用词
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "from",
      "as",
      "is",
      "was",
      "are",
      "were",
      "been",
      "be",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "must",
      "shall",
      "can",
      "need",
      "it",
      "its",
      "this",
      "that",
      "these",
      "those",
      "i",
      "you",
      "he",
      "she",
      "we",
      "they",
      "what",
      "which",
      "who",
      "whom",
      "how",
      "when",
      "where",
      "why",
      "all",
      "each",
      "every",
      "both",
      "few",
      "more",
      "most",
      "other",
      "some",
      "such",
      "no",
      "nor",
      "not",
      "only",
      "own",
      "same",
      "so",
      "than",
      "too",
      "very",
      "just",
      "also",
      "new",
      "first",
      "last",
      "one",
      "two",
      "into",
      "over",
      "after",
      "before",
      "between",
      "under",
      "again",
      "further",
      "then",
      "once",
    ]);

    // 中文停用词
    const chineseStopWords = new Set([
      "的",
      "了",
      "和",
      "是",
      "就",
      "都",
      "而",
      "及",
      "与",
      "着",
      "或",
      "一个",
      "没有",
      "我们",
      "你们",
      "他们",
      "这个",
      "那个",
      "之",
      "在",
      "等",
      "能",
      "会",
      "可以",
      "可能",
      "应该",
      "需要",
    ]);

    // 分词：支持英文和中文
    const words = title
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5-]/g, " ") // 保留字母、数字、中文、连字符
      .split(/\s+/)
      .filter((word) => {
        if (!word || word.length < 2) return false;
        if (stopWords.has(word)) return false;
        if (chineseStopWords.has(word)) return false;
        // 过滤纯数字
        if (/^\d+$/.test(word)) return false;
        return true;
      });

    // 提取重要的关键词（前5个）
    const uniqueWords = [...new Set(words)];
    return uniqueWords.slice(0, 5);
  }

  /**
   * 获取资源查询的标准字段
   */
  private getResourceSelectFields() {
    return {
      id: true,
      type: true,
      title: true,
      abstract: true,
      aiSummary: true,
      sourceUrl: true,
      thumbnailUrl: true,
      publishedAt: true,
      categories: true,
      tags: true,
      primaryCategory: true,
      qualityScore: true,
      trendingScore: true,
      viewCount: true,
    };
  }
}
