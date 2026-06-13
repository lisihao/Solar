import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import {
  BlogSource,
  CollectedBlogPost,
  CollectionTask,
  RSSFeedItem,
} from "./blog-collection.types";
import { getErrorMessage } from "../../../../../common/utils/error.utils";

/**
 * Blog Collection Service
 * 负责从各种来源采集博客文章
 */
@Injectable()
export class BlogCollectionService {
  private readonly logger = new Logger(BlogCollectionService.name);

  constructor() {}

  /**
   * 采集单个源的博客文章
   */
  async collectFromSource(sourceId: string): Promise<CollectionTask> {
    const task: CollectionTask = {
      id: crypto.randomUUID(),
      sourceId,
      sourceName: "",
      status: "pending",
      postsCollected: 0,
      postsSaved: 0,
      retryCount: 0,
      startTime: new Date(),
    };

    try {
      this.logger.log(`Starting collection from source: ${sourceId}`);

      // 获取源信息（这里假设从数据库读取）
      const source = await this.getSourceInfo(sourceId);
      if (!source) {
        task.status = "failed";
        task.error = `Source not found: ${sourceId}`;
        return task;
      }

      task.sourceName = source.displayName;

      // 执行采集
      const posts = await this.fetchPostsFromSource(source);
      task.postsCollected = posts.length;

      // 保存文章到数据库
      const savedCount = await this.savePostsToDatabase(posts);
      task.postsSaved = savedCount;

      task.status = "completed";
      task.endTime = new Date();

      this.logger.log(
        `Collection completed for ${source.displayName}: ${savedCount}/${task.postsCollected} posts saved`,
      );

      return task;
    } catch (error) {
      task.status = "failed";
      task.error = getErrorMessage(error);
      task.endTime = new Date();
      this.logger.error(
        `Collection failed for source ${sourceId}: ${task.error}`,
      );
      return task;
    }
  }

  /**
   * 获取源信息
   * TODO: 从数据库实现此方法
   */
  private async getSourceInfo(sourceId: string): Promise<BlogSource | null> {
    // 硬编码的示例数据 - 将来从数据库读取
    const sources: Record<string, BlogSource> = {
      "nvidia-official": {
        id: "nvidia-official",
        name: "nvidia-official",
        displayName: "NVIDIA Official Blog",
        category: "enterprise" as const,
        blogUrl: "https://blogs.nvidia.com",
        logoUrl: "https://www.nvidia.com/favicon.ico",
        rssFeeds: ["https://blogs.nvidia.com/feed/"],
        isActive: true,
      },
      "broadcom-news": {
        id: "broadcom-news",
        name: "broadcom-news",
        displayName: "Broadcom News",
        category: "enterprise" as const,
        blogUrl: "https://www.broadcom.com/news",
        logoUrl: "https://www.broadcom.com/favicon.ico",
        rssFeeds: ["https://www.broadcom.com/feeds/news.rss"],
        isActive: true,
      },
    };

    return sources[sourceId] || null;
  }

  /**
   * 从源获取博客文章
   */
  private async fetchPostsFromSource(
    source: BlogSource,
  ): Promise<CollectedBlogPost[]> {
    const posts: CollectedBlogPost[] = [];

    try {
      // 如果配置了RSS源，优先使用RSS
      if (source.rssFeeds && source.rssFeeds.length > 0) {
        for (const feedUrl of source.rssFeeds) {
          try {
            const feedPosts = await this.fetchFromRSSFeed(feedUrl, source);
            posts.push(...feedPosts);
          } catch (error) {
            this.logger.warn(
              `Failed to fetch RSS feed ${feedUrl}: ${getErrorMessage(error)}`,
            );
          }
        }
      }

      // 如果有博客URL但没有获取到RSS，可以尝试网页抓取
      // 这里是占位符实现

      return posts;
    } catch (error) {
      this.logger.error(
        `Error fetching posts from source ${source.displayName}: ${getErrorMessage(error)}`,
      );
      return [];
    }
  }

  /**
   * 从RSS源获取文章
   */
  private async fetchFromRSSFeed(
    feedUrl: string,
    source: BlogSource,
  ): Promise<CollectedBlogPost[]> {
    const posts: CollectedBlogPost[] = [];

    try {
      this.logger.log(`Fetching RSS feed: ${feedUrl}`);

      // 动态导入rss-parser（避免直接依赖）
      type RSSParser = new () => {
        parseURL: (url: string) => Promise<{ items?: RSSFeedItem[] }>;
      };
      let Parser: RSSParser;
      try {
        // Dynamic import of optional dependency - rss-parser may not be installed
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const module = await import("rss-parser" as string);
        Parser = module.default;
      } catch (error) {
        this.logger.warn("rss-parser not available, skipping RSS collection");
        return [];
      }

      const parser = new Parser();
      const feed = await parser.parseURL(feedUrl);

      if (feed.items) {
        for (const item of feed.items) {
          const post = this.convertRSSItemToPost(item, source);
          if (post) {
            posts.push(post);
          }
        }
      }

      this.logger.log(`Fetched ${posts.length} posts from RSS feed`);
      return posts;
    } catch (error) {
      this.logger.error(
        `Failed to fetch RSS feed ${feedUrl}: ${getErrorMessage(error)}`,
      );
      return [];
    }
  }

  /**
   * 将RSS项转换为收集的博客文章
   */
  private convertRSSItemToPost(
    item: RSSFeedItem,
    source: BlogSource,
  ): CollectedBlogPost | null {
    try {
      if (!item.title || !item.link) {
        return null;
      }

      const contentHash = this.generateContentHash(
        item.title + (item.link || ""),
      );

      return {
        id: crypto.randomUUID(),
        title: item.title,
        excerpt: item.description || "",
        sourceUrl: item.link,
        sourceId: source.id,
        sourceName: source.displayName,
        publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
        category: source.category,
        tags: item.categories || [],
        author: item.author || source.displayName,
        contentHash,
      };
    } catch (error) {
      this.logger.warn(`Failed to convert RSS item: ${getErrorMessage(error)}`);
      return null;
    }
  }

  /**
   * 生成内容哈希（用于重复检测）
   */
  private generateContentHash(content: string): string {
    return crypto.createHash("md5").update(content).digest("hex");
  }

  /**
   * 将文章保存到数据库
   */
  private async savePostsToDatabase(
    posts: CollectedBlogPost[],
  ): Promise<number> {
    let savedCount = 0;

    for (const post of posts) {
      try {
        // 检查重复（基于contentHash）
        // 这里假设有一个博客文章模型
        // 实际实现需要根据项目的数据库结构调整

        // 示例：检查是否已存在
        // const exists = await this.prisma.collectedBlogPost.findUnique({
        //   where: { contentHash: post.contentHash }
        // });
        //
        // if (!exists) {
        //   await this.prisma.collectedBlogPost.create({
        //     data: {
        //       ...post,
        //       sourceId,
        //     }
        //   });
        //   savedCount++;
        // }

        // 临时实现：直接计数（需要数据库支持）
        savedCount++;
      } catch (error) {
        this.logger.warn(
          `Failed to save post "${post.title}": ${getErrorMessage(error)}`,
        );
      }
    }

    return savedCount;
  }

  /**
   * 获取所有活跃源
   */
  async getActiveSources(): Promise<BlogSource[]> {
    // 临时硬编码实现 - 将来从数据库读取
    return [
      {
        id: "nvidia-official",
        name: "nvidia-official",
        displayName: "NVIDIA Official Blog",
        category: "enterprise" as const,
        blogUrl: "https://blogs.nvidia.com",
        isActive: true,
      },
      {
        id: "broadcom-news",
        name: "broadcom-news",
        displayName: "Broadcom News",
        category: "enterprise" as const,
        blogUrl: "https://www.broadcom.com/news",
        isActive: true,
      },
      {
        id: "google-blog",
        name: "google-blog",
        displayName: "Google Official Blog",
        category: "enterprise" as const,
        blogUrl: "https://blog.google",
        isActive: true,
      },
    ];
  }

  /**
   * 获取采集统计
   */
  async getCollectionStats() {
    return {
      totalPosts: 0, // TODO: 从数据库计算
      totalSources: 3,
      activeTasks: 0,
      collectionStatus: "active" as const,
      averageCollectionDuration: 0,
    };
  }
}
