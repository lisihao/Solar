import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { GraphService } from "../../../../common/graph/graph.service";
import { getErrorMessage } from "../../../../common/utils/error.utils";
import { Resource, ResourceType } from "@prisma/client";

type ResourceRecommendation = Resource;

/**
 * 推荐系统服务（PostgreSQL 实现）
 */
@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private prisma: PrismaService,
    private graphService: GraphService,
  ) {}

  /**
   * 获取个性化推荐（混合推荐）
   */
  async getPersonalizedRecommendations(
    userId?: string,
    limit: number = 10,
  ): Promise<ResourceRecommendation[]> {
    if (userId) {
      // 基于用户历史的个性化推荐
      return this.getUserBasedRecommendations(userId, limit);
    } else {
      // 未登录用户：基于热门度和质量分的推荐
      return this.getPopularRecommendations(limit);
    }
  }

  /**
   * 基于用户行为的推荐（协同过滤）
   */
  private async getUserBasedRecommendations(
    userId: string,
    limit: number,
  ): Promise<ResourceRecommendation[]> {
    // 1. 获取用户浏览/收藏过的资源
    const userActivities = await this.prisma.userActivity.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        resourceId: true,
      },
    });

    if (userActivities.length === 0) {
      return this.getPopularRecommendations(limit);
    }

    // 2. 提取用户感兴趣的资源ID
    const interestedResourceIds = userActivities.map((a) => a.resourceId);

    // 3. 基于这些资源找相似资源
    const similarResources = await this.findSimilarResources(
      interestedResourceIds,
      limit * 2,
    );

    // 4. 过滤掉用户已经看过的
    const recommendations = similarResources.filter(
      (r) => !interestedResourceIds.includes(r.id),
    );

    // 5. 按质量分和趋势分排序
    return recommendations
      .sort((a, b) => {
        const scoreA =
          parseFloat(String(a.qualityScore || "0")) +
          parseFloat(String(a.trendingScore || "0"));
        const scoreB =
          parseFloat(String(b.qualityScore || "0")) +
          parseFloat(String(b.trendingScore || "0"));
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  /**
   * 基于热门度的推荐
   */
  private async getPopularRecommendations(
    limit: number,
  ): Promise<ResourceRecommendation[]> {
    const resources = await this.prisma.resource.findMany({
      take: limit,
      orderBy: [{ trendingScore: "desc" }, { qualityScore: "desc" }],
      where: {
        qualityScore: {
          gte: "50",
        },
      },
    });

    return resources;
  }

  /**
   * 基于内容的相似资源推荐
   */
  async getContentBasedRecommendations(
    resourceId: string,
    limit: number = 10,
  ): Promise<ResourceRecommendation[]> {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
      select: {
        type: true,
        categories: true,
        tags: true,
        primaryCategory: true,
      },
    });

    if (!resource) {
      return [];
    }

    // 查找相同类型、相似类别和标签的资源
    const similarResources = await this.prisma.resource.findMany({
      where: {
        id: { not: resourceId },
        type: resource.type,
        OR: [
          ...(Array.isArray(resource.categories)
            ? (resource.categories as string[]).map((cat) => ({
                categories: { array_contains: cat },
              }))
            : []),
          ...(Array.isArray(resource.tags)
            ? (resource.tags as string[]).map((tag) => ({
                tags: { array_contains: tag },
              }))
            : []),
          {
            primaryCategory: resource.primaryCategory,
          },
        ],
      },
      take: limit,
      orderBy: {
        qualityScore: "desc",
      },
    });

    return similarResources;
  }

  /**
   * 基于知识图谱的推荐（使用 PostgreSQL GraphService）
   */
  async getGraphBasedRecommendations(
    resourceId: string,
    limit: number = 10,
  ): Promise<ResourceRecommendation[]> {
    try {
      // 使用 PostgreSQL GraphService 找相似资源
      const results = await this.graphService.findSimilarResources(
        resourceId,
        limit,
      );

      return results.map(
        (r) => r.resource as unknown as ResourceRecommendation,
      );
    } catch (error) {
      this.logger.warn(
        `Graph-based recommendation failed: ${getErrorMessage(error)}`,
      );
      return this.getContentBasedRecommendations(resourceId, limit);
    }
  }

  /**
   * 混合推荐算法
   */
  async getHybridRecommendations(
    resourceId: string,
    _userId?: string,
    limit: number = 10,
  ): Promise<ResourceRecommendation[]> {
    // 1. 基于内容的推荐（权重40%）
    const contentBased = await this.getContentBasedRecommendations(
      resourceId,
      limit,
    );

    // 2. 基于图谱的推荐（权重40%）
    const graphBased = await this.getGraphBasedRecommendations(
      resourceId,
      limit,
    );

    // 3. 热门推荐（权重20%）
    const popular = await this.getPopularRecommendations(Math.floor(limit / 2));

    // 合并并去重
    const allRecommendations = new Map();

    // 添加基于内容的推荐（分数 = 质量分 * 0.4）
    contentBased.forEach((r) => {
      const score = parseFloat(String(r.qualityScore || "0")) * 0.4;
      allRecommendations.set(r.id, { resource: r, score });
    });

    // 添加基于图谱的推荐（分数 = 质量分 * 0.4）
    graphBased.forEach((r) => {
      if (allRecommendations.has(r.id)) {
        const existing = allRecommendations.get(r.id);
        existing.score += parseFloat(String(r.qualityScore || "0")) * 0.4;
      } else {
        const score = parseFloat(String(r.qualityScore || "0")) * 0.4;
        allRecommendations.set(r.id, { resource: r, score });
      }
    });

    // 添加热门推荐（分数 = 趋势分 * 0.2）
    popular.forEach((r) => {
      if (allRecommendations.has(r.id)) {
        const existing = allRecommendations.get(r.id);
        existing.score += parseFloat(String(r.trendingScore || "0")) * 0.2;
      } else {
        const score = parseFloat(String(r.trendingScore || "0")) * 0.2;
        allRecommendations.set(r.id, { resource: r, score });
      }
    });

    // 排除当前资源
    allRecommendations.delete(resourceId);

    // 排序并返回
    const sorted = Array.from(allRecommendations.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.resource);

    return sorted;
  }

  /**
   * 查找相似资源（辅助方法）
   */
  private async findSimilarResources(
    resourceIds: string[],
    limit: number,
  ): Promise<ResourceRecommendation[]> {
    // 获取这些资源的所有类别和标签
    const resources = await this.prisma.resource.findMany({
      where: { id: { in: resourceIds } },
      select: { categories: true, tags: true, type: true },
    });

    const allCategories = new Set<string>();
    const allTags = new Set<string>();
    const types = new Set<string>();

    resources.forEach((r) => {
      if (Array.isArray(r.categories)) {
        (r.categories as string[]).forEach((c) => allCategories.add(c));
      }
      if (Array.isArray(r.tags)) {
        (r.tags as string[]).forEach((t) => allTags.add(t));
      }
      types.add(r.type);
    });

    // 查找相似资源
    const typeConditions = Array.from(types).map((type) => ({
      type: type as ResourceType,
    }));

    const similar = await this.prisma.resource.findMany({
      where: {
        id: { notIn: resourceIds },
        OR: [
          ...typeConditions,
          ...Array.from(allCategories).map((cat) => ({
            categories: { array_contains: cat },
          })),
          ...Array.from(allTags).map((tag) => ({
            tags: { array_contains: tag },
          })),
        ],
      },
      take: limit,
      orderBy: {
        qualityScore: "desc",
      },
    });

    return similar;
  }

  /**
   * 冷启动推荐（新用户推荐）
   */
  async getColdStartRecommendations(
    limit: number = 10,
  ): Promise<ResourceRecommendation[]> {
    // 推荐高质量、热门的资源
    const resources = await this.prisma.resource.findMany({
      where: {
        qualityScore: {
          gte: "70",
        },
      },
      take: limit,
      orderBy: [
        { trendingScore: "desc" },
        { qualityScore: "desc" },
        { publishedAt: "desc" },
      ],
    });

    return resources;
  }

  /**
   * 按类别推荐
   */
  async getRecommendationsByCategory(
    category: string,
    limit: number = 10,
  ): Promise<ResourceRecommendation[]> {
    const resources = await this.prisma.resource.findMany({
      where: {
        OR: [
          { primaryCategory: category },
          { categories: { array_contains: category } },
        ],
      },
      take: limit,
      orderBy: [{ qualityScore: "desc" }, { trendingScore: "desc" }],
    });

    return resources;
  }

  /**
   * 探索发现（diverse recommendations）
   */
  async getExploreRecommendations(
    limit: number = 10,
  ): Promise<ResourceRecommendation[]> {
    // 从不同类别中各选一些高质量资源
    const categories = [
      "AI",
      "ML",
      "Web",
      "Backend",
      "Frontend",
      "DevOps",
      "Data",
      "Security",
    ];
    const perCategory = Math.ceil(limit / categories.length);

    const recommendations = [];

    for (const category of categories) {
      const resources = await this.prisma.resource.findMany({
        where: {
          OR: [
            { primaryCategory: category },
            { categories: { array_contains: category } },
          ],
        },
        take: perCategory,
        orderBy: {
          qualityScore: "desc",
        },
      });

      recommendations.push(...resources);
    }

    // 打乱顺序
    return recommendations.sort(() => Math.random() - 0.5).slice(0, limit);
  }
}
