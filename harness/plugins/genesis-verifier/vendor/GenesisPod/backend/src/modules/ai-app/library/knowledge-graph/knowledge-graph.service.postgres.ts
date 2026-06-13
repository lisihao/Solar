import { Injectable, Logger } from "@nestjs/common";
import { GraphService } from "../../../../common/graph/graph.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";

/**
 * 知识图谱服务（PostgreSQL 实现）
 */
@Injectable()
export class LibraryKnowledgeGraphService {
  private readonly logger = new Logger(LibraryKnowledgeGraphService.name);

  constructor(
    private graphService: GraphService,
    private prisma: PrismaService,
  ) {}

  /**
   * 从资源构建知识图谱节点
   * PostgreSQL 模式下自动维护，无需显式构建
   */
  async buildGraphFromResource(resourceId: string): Promise<void> {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
    });

    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }

    // PostgreSQL 模式下，图谱数据已在 Resource 表的 JSON 字段中
    // 无需显式构建，直接使用 GraphService 查询即可
    await this.graphService.buildGraphFromResource(resourceId);

    this.logger.log(`Built knowledge graph for resource ${resourceId}`);
  }

  /**
   * 获取资源的知识图谱
   */
  async getResourceGraph(
    resourceId: string,
    depth: number = 2,
  ): Promise<unknown> {
    return this.graphService.getResourceGraph(resourceId, depth);
  }

  /**
   * 获取作者的知识图谱
   */
  async getAuthorGraph(authorUsername: string): Promise<unknown> {
    return this.graphService.getAuthorGraph(authorUsername);
  }

  /**
   * 获取主题的知识图谱
   */
  async getTopicGraph(topicName: string): Promise<unknown> {
    return this.graphService.getTopicGraph(topicName);
  }

  /**
   * 获取整个知识图谱概览
   */
  async getGraphOverview(): Promise<unknown> {
    return this.graphService.getGraphOverview();
  }

  /**
   * 获取用户个性化的知识图谱
   * 基于用户的 Library 收藏数据构建
   */
  async getUserGraphOverview(
    userId: string,
    options?: {
      collectionId?: string;
      includeNotes?: boolean;
    },
  ): Promise<unknown> {
    return this.graphService.getUserGraphOverview(userId, options);
  }

  /**
   * 查找相似资源（基于共享的主题和标签）
   */
  async findSimilarResources(
    resourceId: string,
    limit: number = 10,
  ): Promise<Array<{ resource: unknown; commonCount: number }>> {
    const results = await this.graphService.findSimilarResources(
      resourceId,
      limit,
    );

    return results.map((r) => ({
      resource: r.resource,
      commonCount: r.commonCount,
    }));
  }

  /**
   * 批量构建知识图谱
   */
  async buildGraphForAllResources(): Promise<{
    success: number;
    failed: number;
  }> {
    return this.graphService.buildGraphForAllResources();
  }

  /**
   * 从资源移除关联节点（标签、分类或作者）
   */
  async unlinkNode(
    resourceId: string,
    nodeType: "tag" | "category" | "author",
    nodeName: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.graphService.unlinkNode(resourceId, nodeType, nodeName);
    return {
      success: true,
      message: `Successfully unlinked ${nodeType} "${nodeName}" from resource ${resourceId}`,
    };
  }

  /**
   * 从资源移除标签
   */
  async unlinkTag(
    resourceId: string,
    tagName: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.unlinkNode(resourceId, "tag", tagName);
  }

  /**
   * 从资源移除分类
   */
  async unlinkCategory(
    resourceId: string,
    categoryName: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.unlinkNode(resourceId, "category", categoryName);
  }

  /**
   * 从资源移除作者
   */
  async unlinkAuthor(
    resourceId: string,
    authorName: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.unlinkNode(resourceId, "author", authorName);
  }
}
