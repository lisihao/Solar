import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { Prisma, Collection, CollectionItem } from "@prisma/client";

/**
 * Collections Repository
 *
 * 负责收藏集的数据访问层操作
 * - 仅处理数据库查询，不包含业务逻辑
 * - 可被 mock 用于测试
 */
@Injectable()
export class CollectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查找用户的所有收藏集
   */
  async findByUserId(
    userId: string,
    include?: Prisma.CollectionInclude,
  ): Promise<Collection[]> {
    return this.prisma.collection.findMany({
      where: { userId },
      include,
      orderBy: { sortOrder: "asc" },
    });
  }

  /**
   * 根据ID查找单个收藏集
   */
  async findById(
    id: string,
    include?: Prisma.CollectionInclude,
  ): Promise<Collection | null> {
    return this.prisma.collection.findUnique({
      where: { id },
      include,
    });
  }

  /**
   * 根据用户ID和名称查找收藏集
   */
  async findByUserAndName(
    userId: string,
    name: string,
  ): Promise<Collection | null> {
    return this.prisma.collection.findFirst({
      where: { userId, name },
    });
  }

  /**
   * 创建收藏集
   */
  async create(
    data: Prisma.CollectionCreateInput,
    include?: Prisma.CollectionInclude,
  ): Promise<Collection> {
    return this.prisma.collection.create({
      data,
      include,
    });
  }

  /**
   * 更新收藏集
   */
  async update(
    id: string,
    data: Prisma.CollectionUpdateInput,
    include?: Prisma.CollectionInclude,
  ): Promise<Collection> {
    return this.prisma.collection.update({
      where: { id },
      data,
      include,
    });
  }

  /**
   * 删除收藏集
   */
  async delete(id: string): Promise<Collection> {
    return this.prisma.collection.delete({
      where: { id },
    });
  }

  /**
   * 统计用户的收藏集数量
   */
  async countByUserId(userId: string): Promise<number> {
    return this.prisma.collection.count({
      where: { userId },
    });
  }

  // ==================== CollectionItem Operations ====================

  /**
   * 查找收藏集中的所有项目
   */
  async findItemsByCollectionId(
    collectionId: string,
    include?: Prisma.CollectionItemInclude,
  ): Promise<CollectionItem[]> {
    return this.prisma.collectionItem.findMany({
      where: { collectionId },
      include,
      orderBy: { position: "asc" },
    });
  }

  /**
   * 根据ID查找收藏项
   */
  async findItemById(
    id: string,
    include?: Prisma.CollectionItemInclude,
  ): Promise<CollectionItem | null> {
    return this.prisma.collectionItem.findUnique({
      where: { id },
      include,
    });
  }

  /**
   * 查找收藏集中的特定资源
   */
  async findItemByCollectionAndResource(
    collectionId: string,
    resourceId: string,
  ): Promise<CollectionItem | null> {
    return this.prisma.collectionItem.findFirst({
      where: { collectionId, resourceId },
    });
  }

  /**
   * 创建收藏项
   */
  async createItem(
    data: Prisma.CollectionItemCreateInput,
    include?: Prisma.CollectionItemInclude,
  ): Promise<CollectionItem> {
    return this.prisma.collectionItem.create({
      data,
      include,
    });
  }

  /**
   * 更新收藏项
   */
  async updateItem(
    id: string,
    data: Prisma.CollectionItemUpdateInput,
    include?: Prisma.CollectionItemInclude,
  ): Promise<CollectionItem> {
    return this.prisma.collectionItem.update({
      where: { id },
      data,
      include,
    });
  }

  /**
   * 删除收藏项
   */
  async deleteItem(id: string): Promise<CollectionItem> {
    return this.prisma.collectionItem.delete({
      where: { id },
    });
  }

  /**
   * 批量更新收藏项
   */
  async updateManyItems(
    where: Prisma.CollectionItemWhereInput,
    data: Prisma.CollectionItemUpdateInput,
  ): Promise<{ count: number }> {
    return this.prisma.collectionItem.updateMany({
      where,
      data,
    });
  }

  /**
   * 批量删除收藏项
   */
  async deleteManyItems(
    where: Prisma.CollectionItemWhereInput,
  ): Promise<{ count: number }> {
    return this.prisma.collectionItem.deleteMany({
      where,
    });
  }

  /**
   * 统计收藏项数量
   */
  async countItems(where: Prisma.CollectionItemWhereInput): Promise<number> {
    return this.prisma.collectionItem.count({ where });
  }

  /**
   * 查找符合条件的收藏项（用于统计和查询）
   */
  async findItems(params: {
    where: Prisma.CollectionItemWhereInput;
    select?: Prisma.CollectionItemSelect;
    include?: Prisma.CollectionItemInclude;
    skip?: number;
    take?: number;
    orderBy?: Prisma.CollectionItemOrderByWithRelationInput;
  }): Promise<CollectionItem[]> {
    return this.prisma.collectionItem.findMany(params);
  }

  /**
   * 按字段分组统计
   */
  async groupBy(params: {
    by: Prisma.CollectionItemScalarFieldEnum[];
    where?: Prisma.CollectionItemWhereInput;
    _count?: Prisma.CollectionItemCountAggregateInputType;
  }) {
    return this.prisma.collectionItem.groupBy(
      params as Parameters<typeof this.prisma.collectionItem.groupBy>[0],
    );
  }

  /**
   * 查找用户所有收藏项（跨收藏集）
   */
  async findUserItems(
    userId: string,
    params?: {
      where?: Prisma.CollectionItemWhereInput;
      include?: Prisma.CollectionItemInclude;
      skip?: number;
      take?: number;
      orderBy?: Prisma.CollectionItemOrderByWithRelationInput;
    },
  ): Promise<CollectionItem[]> {
    return this.prisma.collectionItem.findMany({
      where: {
        collection: { userId },
        ...params?.where,
      },
      include: params?.include,
      skip: params?.skip,
      take: params?.take,
      orderBy: params?.orderBy,
    });
  }

  /**
   * 查找资源在用户收藏集中的情况
   */
  async findResourceInUserCollections(
    userId: string,
    resourceId: string,
  ): Promise<CollectionItem[]> {
    return this.prisma.collectionItem.findMany({
      where: {
        resourceId,
        collection: { userId },
      },
      include: {
        collection: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }
}
