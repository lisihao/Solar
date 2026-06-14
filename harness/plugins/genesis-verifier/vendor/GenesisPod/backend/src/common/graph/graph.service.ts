import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * PostgreSQL 知识图谱服务
 * 使用 Recursive CTEs + JSONB 替代 Neo4j
 */
@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 查找相似资源（基于共享的主题和标签）
   * 替代 Neo4j 的图遍历查询
   */
  async findSimilarResources(
    resourceId: string,
    limit: number = 10,
  ): Promise<
    Array<{
      resource: {
        id: string;
        type: string;
        title: string;
        abstract: string | null;
        publishedAt: Date | null;
        qualityScore: number | null;
        trendingScore: number | null;
        categories: unknown;
        tags: unknown;
        primaryCategory: string | null;
        authors: unknown;
        sourceUrl: string;
        thumbnailUrl: string | null;
        commonCount: number;
      };
      commonCount: number;
    }>
  > {
    // 1. 获取目标资源的分类和标签
    const targetResource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
      select: {
        categories: true,
        tags: true,
        primaryCategory: true,
      },
    });

    if (!targetResource) {
      return [];
    }

    // PostgreSQL 自动通过 JSON 字段处理分类和标签
    // const categories = (targetResource.categories as string[]) || [];
    // const tags = (targetResource.tags as string[]) || [];
    // const primaryCategory = targetResource.primaryCategory;

    // 2. 使用 PostgreSQL 数组操作找相似资源
    // 使用 raw SQL 提高性能
    const results = await this.prisma.$queryRaw<
      Array<{
        id: string;
        type: string;
        title: string;
        abstract: string | null;
        publishedAt: Date | null;
        qualityScore: number | null;
        trendingScore: number | null;
        categories: unknown;
        tags: unknown;
        primaryCategory: string | null;
        authors: unknown;
        sourceUrl: string;
        thumbnailUrl: string | null;
        commonCount: number;
      }>
    >`
      WITH target AS (
        SELECT
          COALESCE(categories::jsonb, '[]'::jsonb) AS categories,
          COALESCE(tags::jsonb, '[]'::jsonb) AS tags,
          primary_category
        FROM resources
        WHERE id = ${resourceId}
      )
      SELECT
        r.*,
        (
          -- 计算共同分类数量
          (
            SELECT COUNT(*)
            FROM jsonb_array_elements_text(COALESCE(r.categories::jsonb, '[]'::jsonb)) AS cat
            WHERE cat IN (
              SELECT jsonb_array_elements_text(target.categories)
              FROM target
            )
          )
          +
          -- 计算共同标签数量
          (
            SELECT COUNT(*)
            FROM jsonb_array_elements_text(COALESCE(r.tags::jsonb, '[]'::jsonb)) AS tag
            WHERE tag IN (
              SELECT jsonb_array_elements_text(target.tags)
              FROM target
            )
          )
          +
          -- 主分类匹配加权
          CASE
            WHEN r.primary_category = (SELECT primary_category FROM target) THEN 2
            ELSE 0
          END
        )::integer AS "commonCount"
      FROM resources r, target
      WHERE r.id != ${resourceId}
        AND (
          -- 至少有一个共同分类或标签
          EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(r.categories::jsonb, '[]'::jsonb)) AS cat
            WHERE cat IN (
              SELECT jsonb_array_elements_text(target.categories)
            )
          )
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(r.tags::jsonb, '[]'::jsonb)) AS tag
            WHERE tag IN (
              SELECT jsonb_array_elements_text(target.tags)
            )
          )
          OR r.primary_category = (SELECT primary_category FROM target)
        )
      ORDER BY "commonCount" DESC, r.quality_score DESC NULLS LAST
      LIMIT ${limit}
    `;

    return results.map((r) => ({
      resource: r,
      commonCount: r.commonCount,
    }));
  }

  /**
   * 获取资源的知识图谱数据
   * 包括：关联的作者、主题、标签
   */
  async getResourceGraph(
    resourceId: string,
    depth: number = 2,
  ): Promise<{
    nodes: Array<{
      id: string;
      label: string;
      properties: Record<string, unknown>;
    }>;
    edges: Array<{
      source: string;
      target: string;
      type: string;
    }>;
  }> {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
    });

    if (!resource) {
      return { nodes: [], edges: [] };
    }

    const nodes: Array<{
      id: string;
      label: string;
      properties: Record<string, unknown>;
    }> = [];
    const edges: Array<{ source: string; target: string; type: string }> = [];

    // 1. 添加资源节点
    nodes.push({
      id: resource.id,
      label: "Resource",
      properties: {
        id: resource.id,
        type: resource.type,
        title: resource.title,
        abstract: resource.abstract?.substring(0, 500),
        qualityScore: resource.qualityScore?.toString(),
      },
    });

    // 2. 添加作者节点和关系
    const authors = (resource.authors as Array<Record<string, unknown>>) || [];
    authors.forEach((author) => {
      const authorId = author.name || author.username;
      if (authorId) {
        nodes.push({
          id: `author:${authorId}`,
          label: "Author",
          properties: {
            username: authorId,
            platform: author.platform || author.affiliation || "Unknown",
          },
        });

        edges.push({
          source: `author:${authorId}`,
          target: resource.id,
          type: "AUTHORED",
        });
      }
    });

    // 3. 添加主题节点和关系
    const categories = (resource.categories as string[]) || [];
    if (resource.primaryCategory) {
      categories.unshift(resource.primaryCategory);
    }

    [...new Set(categories)].forEach((category) => {
      nodes.push({
        id: `topic:${category}`,
        label: "Topic",
        properties: { name: category },
      });

      edges.push({
        source: resource.id,
        target: `topic:${category}`,
        type: "BELONGS_TO",
      });
    });

    // 4. 添加标签节点和关系
    const tags = (resource.tags as string[]) || [];
    tags.forEach((tag) => {
      nodes.push({
        id: `tag:${tag}`,
        label: "Tag",
        properties: { name: tag },
      });

      edges.push({
        source: resource.id,
        target: `tag:${tag}`,
        type: "TAGGED_WITH",
      });
    });

    // 5. 如果 depth > 1，添加相关资源
    if (depth > 1) {
      const similar = await this.findSimilarResources(resourceId, 5);
      similar.forEach(({ resource: r }) => {
        nodes.push({
          id: r.id,
          label: "Resource",
          properties: {
            id: r.id,
            type: r.type,
            title: r.title,
            abstract: r.abstract?.substring(0, 200),
            qualityScore: r.qualityScore?.toString(),
          },
        });

        // 通过共享主题连接
        const sharedCategories = (r.categories as string[]) || [];
        sharedCategories.forEach((cat: string) => {
          if (categories.includes(cat)) {
            edges.push({
              source: r.id,
              target: `topic:${cat}`,
              type: "BELONGS_TO",
            });
          }
        });
      });
    }

    return { nodes, edges };
  }

  /**
   * 获取作者的知识图谱
   */
  async getAuthorGraph(authorUsername: string): Promise<{
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  }> {
    // 查找该作者的所有资源
    const resources = await this.prisma.$queryRaw<
      Array<Record<string, unknown>>
    >`
      SELECT *
      FROM resources
      WHERE jsonb_path_exists(
        COALESCE(authors::jsonb, '[]'::jsonb),
        ('$[*] ? (@.name == "' || ${authorUsername} || '" || @.username == "' || ${authorUsername} || '")')::jsonpath
      )
      ORDER BY quality_score DESC NULLS LAST
      LIMIT 100
    `;

    const nodes: Array<Record<string, unknown>> = [];
    const edges: Array<Record<string, unknown>> = [];

    // 添加作者节点
    nodes.push({
      id: `author:${authorUsername}`,
      label: "Author",
      properties: { username: authorUsername },
    });

    // 添加资源节点和关系
    resources.forEach((resource) => {
      nodes.push({
        id: resource.id,
        label: "Resource",
        properties: {
          id: resource.id,
          type: resource.type,
          title: resource.title,
          abstract:
            typeof resource.abstract === "string"
              ? resource.abstract.substring(0, 200)
              : null,
        },
      });

      edges.push({
        source: `author:${authorUsername}`,
        target: resource.id,
        type: "AUTHORED",
      });

      // 添加主题节点
      const categories = (resource.categories as string[]) || [];
      categories.forEach((cat: string) => {
        const topicId = `topic:${cat}`;
        if (!nodes.find((n) => n.id === topicId)) {
          nodes.push({
            id: topicId,
            label: "Topic",
            properties: { name: cat },
          });
        }

        edges.push({
          source: resource.id,
          target: topicId,
          type: "BELONGS_TO",
        });
      });
    });

    return { nodes, edges };
  }

  /**
   * 获取主题的知识图谱
   */
  async getTopicGraph(topicName: string): Promise<{
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  }> {
    // 查找该主题下的所有资源
    const resources = await this.prisma.$queryRaw<
      Array<Record<string, unknown>>
    >`
      SELECT *
      FROM resources
      WHERE
        primary_category = ${topicName}
        OR jsonb_path_exists(
          COALESCE(categories::jsonb, '[]'::jsonb),
          ('$[*] ? (@ == "' || ${topicName} || '")')::jsonpath
        )
      ORDER BY quality_score DESC NULLS LAST
      LIMIT 100
    `;

    const nodes: Array<Record<string, unknown>> = [];
    const edges: Array<Record<string, unknown>> = [];

    // 添加主题节点
    nodes.push({
      id: `topic:${topicName}`,
      label: "Topic",
      properties: { name: topicName },
    });

    const authorSet = new Set<string>();

    // 添加资源节点和关系
    resources.forEach((resource) => {
      nodes.push({
        id: resource.id,
        label: "Resource",
        properties: {
          id: resource.id,
          type: resource.type,
          title: resource.title,
          abstract:
            typeof resource.abstract === "string"
              ? resource.abstract.substring(0, 200)
              : null,
        },
      });

      edges.push({
        source: resource.id,
        target: `topic:${topicName}`,
        type: "BELONGS_TO",
      });

      // 收集作者
      const authors =
        (resource.authors as Array<Record<string, unknown>>) || [];
      authors.forEach((author) => {
        const authorId = (author.name || author.username) as string;
        if (authorId) {
          authorSet.add(authorId);
        }
      });
    });

    // 添加作者节点（限制数量）
    Array.from(authorSet)
      .slice(0, 20)
      .forEach((authorId) => {
        nodes.push({
          id: `author:${authorId}`,
          label: "Author",
          properties: { username: authorId },
        });

        // 找该作者的资源并建立关系
        resources.forEach((resource) => {
          const authors =
            (resource.authors as Array<Record<string, unknown>>) || [];
          const hasAuthor = authors.some(
            (a: Record<string, unknown>) =>
              a.name === authorId || a.username === authorId,
          );
          if (hasAuthor) {
            edges.push({
              source: `author:${authorId}`,
              target: resource.id,
              type: "AUTHORED",
            });
          }
        });
      });

    return { nodes, edges };
  }

  /**
   * 获取用户个人知识图谱（基于 Library 收藏）
   * P0 改进：整合 Library 数据，展示用户的个人知识体系
   */
  async getUserGraphOverview(
    userId: string,
    options?: {
      collectionId?: string;
      includeNotes?: boolean;
    },
  ): Promise<{
    nodes: Array<{
      id: string;
      label: string;
      type:
        | "User"
        | "Collection"
        | "Resource"
        | "Note"
        | "Author"
        | "Topic"
        | "Tag";
      properties: Record<string, unknown>;
    }>;
    edges: Array<{
      source: string;
      target: string;
      type: string;
      weight?: number;
    }>;
    stats: {
      totalCollections: number;
      totalResources: number;
      totalNotes: number;
      totalAuthors: number;
      totalTopics: number;
      totalTags: number;
      totalEdges: number;
    };
  }> {
    const nodes: Array<{
      id: string;
      label: string;
      type:
        | "User"
        | "Collection"
        | "Resource"
        | "Note"
        | "Author"
        | "Topic"
        | "Tag";
      properties: Record<string, unknown>;
    }> = [];
    const edges: Array<{
      source: string;
      target: string;
      type: string;
      weight?: number;
    }> = [];

    // 用于去重
    const authorSet = new Set<string>();
    const topicSet = new Set<string>();
    const tagSet = new Set<string>();
    const resourceIds = new Set<string>();

    // 1. 获取用户信息
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, email: true },
    });

    if (!user) {
      this.logger.warn(`User ${userId} not found for graph overview`);
      return {
        nodes: [],
        edges: [],
        stats: {
          totalCollections: 0,
          totalResources: 0,
          totalNotes: 0,
          totalAuthors: 0,
          totalTopics: 0,
          totalTags: 0,
          totalEdges: 0,
        },
      };
    }

    // 添加用户节点（作为图谱中心）
    nodes.push({
      id: `user-${userId}`,
      label: user.username || "Me",
      type: "User",
      properties: {
        username: user.username,
        email: user.email,
      },
    });

    // 2. 获取用户的收藏集
    const collectionsQuery: { userId: string; id?: string } = { userId };
    if (options?.collectionId) {
      collectionsQuery.id = options.collectionId;
    }

    const collections = await this.prisma.collection.findMany({
      where: collectionsQuery,
      include: {
        items: {
          include: {
            resource: {
              select: {
                id: true,
                title: true,
                type: true,
                authors: true,
                categories: true,
                tags: true,
                primaryCategory: true,
              },
            },
          },
        },
      },
    });

    // 3. 处理每个收藏集
    for (const collection of collections) {
      // 添加收藏集节点
      nodes.push({
        id: `collection-${collection.id}`,
        label: collection.name,
        type: "Collection",
        properties: {
          name: collection.name,
          description: collection.description,
          icon: collection.icon,
          color: collection.color,
          itemCount: collection.items.length,
        },
      });

      // 用户 -> 收藏集
      edges.push({
        source: `user-${userId}`,
        target: `collection-${collection.id}`,
        type: "OWNS",
      });

      // 4. 处理收藏集中的资源
      for (const item of collection.items) {
        const resource = item.resource;
        if (!resource) continue;

        // 添加资源节点（去重）
        if (!resourceIds.has(resource.id)) {
          resourceIds.add(resource.id);
          nodes.push({
            id: resource.id,
            label: resource.title || "Untitled",
            type: "Resource",
            properties: {
              title: resource.title,
              resourceType: resource.type,
              // 用户个性化数据
              readStatus: item.readStatus,
              readProgress: item.readProgress,
              userNote: item.note,
              userTags: item.tags,
              addedAt: item.addedAt,
            },
          });
        }

        // 收藏集 -> 资源
        edges.push({
          source: `collection-${collection.id}`,
          target: resource.id,
          type: "CONTAINS",
        });

        // 处理作者
        const authors =
          (resource.authors as Array<Record<string, unknown>>) || [];
        for (const author of authors) {
          const authorName = (author?.name ||
            author?.username ||
            author?.displayName) as string;
          if (authorName && !authorSet.has(authorName)) {
            authorSet.add(authorName);
            nodes.push({
              id: `author-${authorName}`,
              label: authorName,
              type: "Author",
              properties: { name: authorName },
            });
          }
          if (authorName) {
            edges.push({
              source: `author-${authorName}`,
              target: resource.id,
              type: "AUTHORED",
            });
          }
        }

        // 处理主分类
        if (
          resource.primaryCategory &&
          !topicSet.has(resource.primaryCategory)
        ) {
          topicSet.add(resource.primaryCategory);
          nodes.push({
            id: `topic-${resource.primaryCategory}`,
            label: resource.primaryCategory,
            type: "Topic",
            properties: { name: resource.primaryCategory },
          });
        }
        if (resource.primaryCategory) {
          edges.push({
            source: resource.id,
            target: `topic-${resource.primaryCategory}`,
            type: "BELONGS_TO",
          });
        }

        // 处理分类
        const categories = (resource.categories as string[]) || [];
        for (const category of categories) {
          if (category && !topicSet.has(category)) {
            topicSet.add(category);
            nodes.push({
              id: `topic-${category}`,
              label: category,
              type: "Topic",
              properties: { name: category },
            });
          }
          if (category) {
            edges.push({
              source: resource.id,
              target: `topic-${category}`,
              type: "BELONGS_TO",
            });
          }
        }

        // 处理标签
        const tags = (resource.tags as string[]) || [];
        for (const tag of tags) {
          if (tag && !tagSet.has(tag)) {
            tagSet.add(tag);
            nodes.push({
              id: `tag-${tag}`,
              label: tag,
              type: "Tag",
              properties: { name: tag },
            });
          }
          if (tag) {
            edges.push({
              source: resource.id,
              target: `tag-${tag}`,
              type: "TAGGED_WITH",
            });
          }
        }
      }
    }

    // 5. 获取用户的笔记（如果启用）
    let notesCount = 0;
    if (options?.includeNotes !== false) {
      const notes = await this.prisma.note.findMany({
        where: { userId },
        select: {
          id: true,
          title: true,
          content: true,
          resourceId: true,
          tags: true,
          createdAt: true,
        },
        take: 50, // 限制笔记数量
      });

      notesCount = notes.length;

      for (const note of notes) {
        // 添加笔记节点
        nodes.push({
          id: `note-${note.id}`,
          label: note.title || note.content?.substring(0, 50) || "Note",
          type: "Note",
          properties: {
            title: note.title,
            contentPreview: note.content?.substring(0, 200),
            tags: note.tags,
            createdAt: note.createdAt,
          },
        });

        // 用户 -> 笔记
        edges.push({
          source: `user-${userId}`,
          target: `note-${note.id}`,
          type: "CREATED",
        });

        // 笔记 -> 资源（如果有关联）
        if (note.resourceId && resourceIds.has(note.resourceId)) {
          edges.push({
            source: `note-${note.id}`,
            target: note.resourceId,
            type: "ANNOTATES",
          });
        }
      }
    }

    // 6. 添加资源间的相似关系（基于共同主题/标签）
    const resourceArray = Array.from(resourceIds);
    for (let i = 0; i < resourceArray.length; i++) {
      for (let j = i + 1; j < resourceArray.length; j++) {
        const r1 = nodes.find((n) => n.id === resourceArray[i]);
        const r2 = nodes.find((n) => n.id === resourceArray[j]);

        if (r1 && r2) {
          // 简单的相似度计算：检查共同边
          const r1Topics = edges
            .filter((e) => e.source === r1.id && e.type === "BELONGS_TO")
            .map((e) => e.target);
          const r2Topics = edges
            .filter((e) => e.source === r2.id && e.type === "BELONGS_TO")
            .map((e) => e.target);

          const commonTopics = r1Topics.filter((t) => r2Topics.includes(t));

          if (commonTopics.length >= 2) {
            edges.push({
              source: r1.id,
              target: r2.id,
              type: "SIMILAR_TO",
              weight: commonTopics.length,
            });
          }
        }
      }
    }

    return {
      nodes,
      edges,
      stats: {
        totalCollections: collections.length,
        totalResources: resourceIds.size,
        totalNotes: notesCount,
        totalAuthors: authorSet.size,
        totalTopics: topicSet.size,
        totalTags: tagSet.size,
        totalEdges: edges.length,
      },
    };
  }

  /**
   * 获取图谱概览（包含实际节点和边用于可视化）
   * 支持用户个性化：传入 userId 时返回用户的知识图谱
   */
  async getGraphOverview(userId?: string): Promise<{
    nodes: Array<{
      id: string;
      label: string;
      type:
        | "User"
        | "Collection"
        | "Resource"
        | "Note"
        | "Author"
        | "Topic"
        | "Tag";
      properties: Record<string, unknown>;
    }>;
    edges: Array<{
      source: string;
      target: string;
      type: string;
      weight?: number;
    }>;
    stats: {
      totalResources: number;
      totalAuthors: number;
      totalTopics: number;
      totalTags: number;
      totalEdges: number;
      totalCollections?: number;
      totalNotes?: number;
    };
  }> {
    // 如果提供了 userId，返回用户个性化的知识图谱
    if (userId) {
      return this.getUserGraphOverview(userId);
    }

    // 否则返回全局概览（向后兼容）
    // 限制查询数量以提高性能
    const MAX_RESOURCES = 100;

    // 获取资源（限制数量）
    const resources = await this.prisma.resource.findMany({
      take: MAX_RESOURCES,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        type: true,
        authors: true,
        categories: true,
        tags: true,
        primaryCategory: true,
      },
    });

    const nodes: Array<{
      id: string;
      label: string;
      type:
        | "User"
        | "Collection"
        | "Resource"
        | "Note"
        | "Author"
        | "Topic"
        | "Tag";
      properties: Record<string, unknown>;
    }> = [];
    const edges: Array<{
      source: string;
      target: string;
      type: string;
      weight?: number;
    }> = [];

    // 用于去重
    const authorSet = new Set<string>();
    const topicSet = new Set<string>();
    const tagSet = new Set<string>();

    // 处理每个资源
    for (const resource of resources) {
      // 添加资源节点
      nodes.push({
        id: resource.id,
        label: resource.title || "Untitled",
        type: "Resource",
        properties: {
          title: resource.title,
          resourceType: resource.type,
        },
      });

      // 处理作者
      const authors = (resource.authors as Record<string, unknown>[]) || [];
      for (const author of authors) {
        const authorName = (author?.name ||
          author?.username ||
          author?.displayName) as string | undefined;
        if (authorName && !authorSet.has(authorName)) {
          authorSet.add(authorName);
          nodes.push({
            id: `author-${authorName}`,
            label: authorName,
            type: "Author",
            properties: { name: authorName },
          });
        }
        if (authorName) {
          edges.push({
            source: `author-${authorName}`,
            target: resource.id,
            type: "AUTHORED",
          });
        }
      }

      // 处理主分类
      if (resource.primaryCategory && !topicSet.has(resource.primaryCategory)) {
        topicSet.add(resource.primaryCategory);
        nodes.push({
          id: `topic-${resource.primaryCategory}`,
          label: resource.primaryCategory,
          type: "Topic",
          properties: { name: resource.primaryCategory },
        });
      }
      if (resource.primaryCategory) {
        edges.push({
          source: resource.id,
          target: `topic-${resource.primaryCategory}`,
          type: "BELONGS_TO",
        });
      }

      // 处理分类
      const categories = (resource.categories as string[]) || [];
      for (const category of categories) {
        if (category && !topicSet.has(category)) {
          topicSet.add(category);
          nodes.push({
            id: `topic-${category}`,
            label: category,
            type: "Topic",
            properties: { name: category },
          });
        }
        if (category) {
          edges.push({
            source: resource.id,
            target: `topic-${category}`,
            type: "BELONGS_TO",
          });
        }
      }

      // 处理标签
      const tags = (resource.tags as string[]) || [];
      for (const tag of tags) {
        if (tag && !tagSet.has(tag)) {
          tagSet.add(tag);
          nodes.push({
            id: `tag-${tag}`,
            label: tag,
            type: "Tag",
            properties: { name: tag },
          });
        }
        if (tag) {
          edges.push({
            source: resource.id,
            target: `tag-${tag}`,
            type: "TAGGED_WITH",
          });
        }
      }
    }

    // 获取总计数
    const totalResources = await this.prisma.resource.count();

    return {
      nodes,
      edges,
      stats: {
        totalResources,
        totalAuthors: authorSet.size,
        totalTopics: topicSet.size,
        totalTags: tagSet.size,
        totalEdges: edges.length,
      },
    };
  }

  /**
   * 批量构建知识图谱（兼容接口，PostgreSQL 自动维护）
   */
  async buildGraphFromResource(_resourceId: string): Promise<void> {
    // PostgreSQL 方案不需要显式构建图谱
    // 数据已经在 Resource 表的 JSON 字段中
    this.logger.log(
      `[Graph] PostgreSQL graph: No explicit build needed, data already indexed`,
    );
  }

  /**
   * 批量构建所有资源的图谱（兼容接口）
   */
  async buildGraphForAllResources(): Promise<{
    success: number;
    failed: number;
  }> {
    const resourceCount = await this.prisma.resource.count();
    this.logger.log(
      `[Graph] PostgreSQL graph: ${resourceCount} resources already indexed`,
    );
    return { success: resourceCount, failed: 0 };
  }

  /**
   * 从资源移除标签
   */
  async unlinkTag(resourceId: string, tagName: string): Promise<void> {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
      select: { tags: true },
    });

    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }

    const tags = (resource.tags as string[]) || [];
    const updatedTags = tags.filter((t) => t !== tagName);

    await this.prisma.resource.update({
      where: { id: resourceId },
      data: { tags: updatedTags },
    });

    this.logger.log(`Unlinked tag "${tagName}" from resource ${resourceId}`);
  }

  /**
   * 从资源移除分类
   */
  async unlinkCategory(
    resourceId: string,
    categoryName: string,
  ): Promise<void> {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
      select: { categories: true, primaryCategory: true },
    });

    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }

    const categories = (resource.categories as string[]) || [];
    const updatedCategories = categories.filter((c) => c !== categoryName);

    // If removing primary category, set to first remaining category or null
    const updateData: {
      categories: string[];
      primaryCategory?: string | null;
    } = {
      categories: updatedCategories,
    };

    if (resource.primaryCategory === categoryName) {
      updateData.primaryCategory = updatedCategories[0] || null;
    }

    await this.prisma.resource.update({
      where: { id: resourceId },
      data: updateData,
    });

    this.logger.log(
      `Unlinked category "${categoryName}" from resource ${resourceId}`,
    );
  }

  /**
   * 从资源移除作者
   */
  async unlinkAuthor(resourceId: string, authorName: string): Promise<void> {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
      select: { authors: true },
    });

    if (!resource) {
      throw new Error(`Resource ${resourceId} not found`);
    }

    const authors =
      (resource.authors as Array<{ name?: string; username?: string }>) || [];
    const updatedAuthors = authors.filter(
      (a) => a.name !== authorName && a.username !== authorName,
    );

    await this.prisma.resource.update({
      where: { id: resourceId },
      data: { authors: updatedAuthors },
    });

    this.logger.log(
      `Unlinked author "${authorName}" from resource ${resourceId}`,
    );
  }

  /**
   * 批量移除关系
   */
  async unlinkNode(
    resourceId: string,
    nodeType: "tag" | "category" | "author",
    nodeName: string,
  ): Promise<void> {
    switch (nodeType) {
      case "tag":
        return this.unlinkTag(resourceId, nodeName);
      case "category":
        return this.unlinkCategory(resourceId, nodeName);
      case "author":
        return this.unlinkAuthor(resourceId, nodeName);
      default:
        throw new Error(`Unknown node type: ${nodeType}`);
    }
  }

  // ==========================================================================
  // N-hop 多跳遍历（首个通用 Recursive CTE / 边表遍历）
  //   - 参数化边表，标识符走白名单防注入（值仍用 $n 占位参数）。
  //   - 无向可达：从 rootId 出发，N 跳内可达的全部节点 + 经过的边。
  //   - 环路检测：path 数组 + NOT (neighbor = ANY(path))，防产业链互供环死循环。
  // ==========================================================================

  /** 允许遍历的边表白名单（防 SQL 标识符注入）。新增边表在此登记。 */
  private static readonly EDGE_TABLE_REGISTRY: Record<
    string,
    { source: string; target: string; relType: string; scope: string }
  > = {
    // Add edge tables here as new graph features are added.
    // Format: tableName: { source, target, relType, scope }
  };

  /**
   * 从 rootId 出发做 N 跳无向遍历，返回可达节点 id 与经过的边。
   * @param params.edgeTable 必须是 EDGE_TABLE_REGISTRY 登记的表名
   * @param params.scopeValue 限定范围（如 chainId），仅遍历同范围的边
   */
  async nHopNeighbors(params: {
    rootId: string;
    depth: number;
    edgeTable: string;
    relationTypes?: string[];
    scopeValue?: string;
  }): Promise<{
    nodeIds: string[];
    edges: Array<{ source: string; target: string; relationType: string }>;
  }> {
    const cfg = GraphService.EDGE_TABLE_REGISTRY[params.edgeTable];
    if (!cfg) {
      throw new Error(
        `nHopNeighbors: edge table not allow-listed: ${params.edgeTable}`,
      );
    }
    const depth = Math.max(1, Math.min(Math.floor(params.depth), 10));

    // 标识符来自白名单（非用户输入），值用 $n 占位参数。
    const tbl = `"${params.edgeTable}"`;
    const src = `"${cfg.source}"`;
    const tgt = `"${cfg.target}"`;
    const rel = `"${cfg.relType}"`;
    const scope = `"${cfg.scope}"`;

    const values: Array<string | number | string[]> = [params.rootId, depth];
    let scopeClause = "";
    if (params.scopeValue) {
      values.push(params.scopeValue);
      scopeClause = `AND e.${scope} = $${values.length}`;
    }
    let relClause = "";
    if (params.relationTypes?.length) {
      values.push(params.relationTypes);
      relClause = `AND e.${rel} = ANY($${values.length}::text[])`;
    }

    const sql = `
      WITH RECURSIVE traverse AS (
        SELECT $1::text AS node_id, 0 AS depth, ARRAY[$1::text] AS path
        UNION ALL
        SELECT nb.neighbor, t.depth + 1, t.path || nb.neighbor
        FROM traverse t
        JOIN LATERAL (
          SELECT CASE WHEN e.${src} = t.node_id THEN e.${tgt} ELSE e.${src} END AS neighbor
          FROM ${tbl} e
          WHERE (e.${src} = t.node_id OR e.${tgt} = t.node_id)
            ${scopeClause}
            ${relClause}
        ) nb ON true
        WHERE t.depth < $2 AND NOT (nb.neighbor = ANY(t.path))
      )
      SELECT DISTINCT node_id FROM traverse WHERE node_id <> $1;
    `;

    const rows = await this.prisma.$queryRawUnsafe<Array<{ node_id: string }>>(
      sql,
      ...values,
    );
    const nodeIds = rows.map((r) => r.node_id);

    // 收集这些节点（含 root）之间的边
    const allIds = [params.rootId, ...nodeIds];
    const edgeValues: Array<string | string[]> = [allIds];
    let edgeScope = "";
    if (params.scopeValue) {
      edgeValues.push(params.scopeValue);
      edgeScope = `AND e.${scope} = $${edgeValues.length}`;
    }
    let edgeRel = "";
    if (params.relationTypes?.length) {
      edgeValues.push(params.relationTypes);
      edgeRel = `AND e.${rel} = ANY($${edgeValues.length}::text[])`;
    }
    const edgeSql = `
      SELECT e.${src} AS source, e.${tgt} AS target, e.${rel} AS "relationType"
      FROM ${tbl} e
      WHERE e.${src} = ANY($1::text[]) AND e.${tgt} = ANY($1::text[])
        ${edgeScope} ${edgeRel};
    `;
    const edges = await this.prisma.$queryRawUnsafe<
      Array<{ source: string; target: string; relationType: string }>
    >(edgeSql, ...edgeValues);

    return { nodeIds, edges };
  }
}
