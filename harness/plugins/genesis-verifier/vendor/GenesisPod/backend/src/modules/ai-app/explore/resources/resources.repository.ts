import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { Prisma, Resource } from "@prisma/client";

/**
 * Resources Repository
 *
 * 负责资源的数据访问层操作
 * - 仅处理数据库查询，不包含业务逻辑
 * - 可被 mock 用于测试
 */
@Injectable()
export class ResourcesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查找资源列表（分页+过滤）
   */
  async findMany(params: {
    where: Prisma.ResourceWhereInput;
    skip?: number;
    take?: number;
    orderBy?: Prisma.ResourceOrderByWithRelationInput;
  }): Promise<Resource[]> {
    return this.prisma.resource.findMany({
      where: params.where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
    });
  }

  /**
   * 统计资源数量
   */
  async count(where: Prisma.ResourceWhereInput): Promise<number> {
    return this.prisma.resource.count({ where });
  }

  /**
   * 根据ID查找单个资源
   */
  async findById(id: string): Promise<Resource | null> {
    return this.prisma.resource.findUnique({
      where: { id },
    });
  }

  /**
   * 查找第一个匹配的资源
   */
  async findFirst(where: Prisma.ResourceWhereInput): Promise<Resource | null> {
    return this.prisma.resource.findFirst({ where });
  }

  /**
   * 创建资源
   */
  async create(data: Prisma.ResourceCreateInput): Promise<Resource> {
    return this.prisma.resource.create({ data });
  }

  /**
   * 更新资源
   */
  async update(
    id: string,
    data: Prisma.ResourceUpdateInput,
  ): Promise<Resource> {
    return this.prisma.resource.update({
      where: { id },
      data,
    });
  }

  /**
   * 删除资源
   */
  async delete(id: string): Promise<Resource> {
    return this.prisma.resource.delete({
      where: { id },
    });
  }

  /**
   * 按类型分组统计
   */
  async groupByType() {
    return this.prisma.resource.groupBy({
      by: ["type"],
      _count: {
        id: true,
      },
    });
  }

  /**
   * 查找资源翻译
   */
  async findTranslation(
    resourceId: string,
    language: string,
  ): Promise<unknown | null> {
    return this.prisma.resourceTranslation.findUnique({
      where: {
        resourceId_language: {
          resourceId,
          language,
        },
      },
    });
  }

  /**
   * 创建资源翻译
   */
  async createTranslation(data: {
    resourceId: string;
    language: string;
    content: string;
    modelUsed: string;
  }): Promise<unknown> {
    return this.prisma.resourceTranslation.create({
      data,
    });
  }

  /**
   * 按 sourceUrl 分组（用于查找重复）
   */
  async groupBySourceUrl(typeFilter?: Record<string, unknown>) {
    return this.prisma.resource.groupBy({
      by: ["sourceUrl"],
      where: {
        ...typeFilter,
        NOT: { sourceUrl: "" },
      },
      _count: { id: true },
      having: {
        id: { _count: { gt: 1 } },
      },
    });
  }

  /**
   * 按 normalizedUrl 分组（用于查找重复）
   */
  async groupByNormalizedUrl(typeFilter?: Record<string, unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.prisma.resource.groupBy({
      by: ["normalizedUrl"],
      where: {
        ...typeFilter,
        normalizedUrl: { not: "" },
      },
      _count: { id: true },
      having: {
        id: { _count: { gt: 1 } },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any) as Promise<
      Array<{ normalizedUrl: string; _count: { id: number } }>
    >;
  }

  /**
   * 批量删除资源
   */
  async deleteMany(ids: string[]): Promise<{ count: number }> {
    return this.prisma.resource.deleteMany({
      where: { id: { in: ids } },
    });
  }

  /**
   * 查找用户点赞记录
   */
  async findUpvote(
    userId: string,
    resourceId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.resourceUpvote.findUnique({
      where: {
        userId_resourceId: {
          userId,
          resourceId,
        },
      },
    });
  }

  /**
   * 创建点赞记录
   */
  async createUpvote(userId: string, resourceId: string): Promise<unknown> {
    return this.prisma.resourceUpvote.create({
      data: { userId, resourceId },
    });
  }

  /**
   * 删除点赞记录
   */
  async deleteUpvote(upvoteId: string): Promise<unknown> {
    return this.prisma.resourceUpvote.delete({
      where: { id: upvoteId },
    });
  }

  /**
   * 增加点赞数
   */
  async incrementUpvoteCount(resourceId: string): Promise<Resource> {
    return this.prisma.resource.update({
      where: { id: resourceId },
      data: { upvoteCount: { increment: 1 } },
    });
  }

  /**
   * 减少点赞数
   */
  async decrementUpvoteCount(resourceId: string): Promise<Resource> {
    return this.prisma.resource.update({
      where: { id: resourceId },
      data: { upvoteCount: { decrement: 1 } },
    });
  }

  /**
   * 事务操作：创建点赞并增加计数
   */
  async createUpvoteWithCount(
    userId: string,
    resourceId: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.resourceUpvote.create({
        data: { userId, resourceId },
      }),
      this.prisma.resource.update({
        where: { id: resourceId },
        data: { upvoteCount: { increment: 1 } },
      }),
    ]);
  }

  /**
   * 事务操作：删除点赞并减少计数
   */
  async deleteUpvoteWithCount(
    upvoteId: string,
    resourceId: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.resourceUpvote.delete({
        where: { id: upvoteId },
      }),
      this.prisma.resource.update({
        where: { id: resourceId },
        data: { upvoteCount: { decrement: 1 } },
      }),
    ]);
  }

  /**
   * 获取用户所有点赞的资源ID
   */
  async findUserUpvotedResourceIds(userId: string): Promise<string[]> {
    const upvotes = await this.prisma.resourceUpvote.findMany({
      where: { userId },
      select: { resourceId: true },
    });

    return upvotes.map((u) => u.resourceId);
  }
}
