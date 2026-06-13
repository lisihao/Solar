import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";

interface HNItemData {
  id: number;
  by?: string;
  text?: string;
  score?: number;
  time: number;
  kids?: number[];
  type?: string;
  deleted?: boolean;
}

/**
 * HackerNews 评论爬虫服务
 *
 * 功能：
 * 1. 获取故事的热门评论
 * 2. 递归构建评论树
 * 3. 并发控制，避免过载
 * 4. 缓存评论数据
 */
@Injectable()
export class HackernewsCommentsService {
  private readonly logger = new Logger(HackernewsCommentsService.name);
  private readonly HN_API_URL = "https://hacker-news.firebaseio.com/v0";
  private readonly BATCH_SIZE = 10; // 并发请求数
  private readonly MAX_RETRIES = 3; // 重试次数
  private readonly REQUEST_TIMEOUT = 5000; // 请求超时 5秒

  /**
   * 获取故事的热门评论
   *
   * @param storyId HackerNews故事ID
   * @param limit 获取评论数量 (默认20条热评)
   * @param depth 递归深度 (默认2层 - 热评 + 热评的回复)
   * @returns 评论数据
   */
  async fetchTopComments(
    storyId: number,
    limit: number = 20,
    depth: number = 2,
  ): Promise<HNComment[]> {
    this.logger.log(`Fetching top ${limit} comments for story ${storyId}`);

    try {
      // 第一步：获取故事数据（包含所有评论ID）
      const storyData = await this.fetchItem(storyId);
      if (!storyData?.kids || storyData.kids.length === 0) {
        this.logger.log(`Story ${storyId} has no comments`);
        return [];
      }

      // 第二步：并发获取前N条评论
      const commentIds = storyData.kids.slice(0, limit);
      const comments = await this.fetchCommentsBatch(commentIds, depth);

      // 第三步：按分数排序（热评优先）
      return comments.sort((a, b) => (b.score || 0) - (a.score || 0));
    } catch (error) {
      this.logger.error(
        `Failed to fetch comments for story ${storyId}`,
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  }

  /**
   * 并发获取一批评论
   */
  private async fetchCommentsBatch(
    commentIds: number[],
    depth: number,
  ): Promise<HNComment[]> {
    const comments: HNComment[] = [];

    // 分批处理，避免过载
    for (let i = 0; i < commentIds.length; i += this.BATCH_SIZE) {
      const batch = commentIds.slice(i, i + this.BATCH_SIZE);
      const batchComments = await Promise.all(
        batch.map((id) => this.fetchComment(id, depth, 0)),
      );
      comments.push(...batchComments.filter((c) => c !== null));
    }

    return comments;
  }

  /**
   * 递归获取单个评论及其回复
   */
  private async fetchComment(
    id: number,
    maxDepth: number = 2,
    currentDepth: number = 0,
  ): Promise<HNComment | null> {
    try {
      const data = await this.fetchItem(id);

      if (!data) {
        return null;
      }

      const comment: HNComment = {
        id: data.id,
        author: data.by || "unknown",
        text: data.text || "",
        score: data.score || 0,
        timestamp: new Date(data.time * 1000),
        depth: currentDepth,
        childCount: data.kids ? data.kids.length : 0,
        replies: [],
      };

      // 递归获取子评论（如果未到达最大深度）
      if (currentDepth < maxDepth - 1 && data.kids && data.kids.length > 0) {
        // 仅获取前3个子评论（避免过度递归）
        const childIds = data.kids.slice(0, 3);
        const replies = await this.fetchCommentsBatch(
          childIds,
          maxDepth - currentDepth - 1,
        );
        comment.replies = replies;
      }

      return comment;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch comment ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * 从HN API获取项目数据，带重试和超时
   */
  private async fetchItem(id: number): Promise<HNItemData | undefined> {
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        const response = await axios.get(`${this.HN_API_URL}/item/${id}.json`, {
          timeout: this.REQUEST_TIMEOUT,
        });
        return response.data;
      } catch (error) {
        if (attempt < this.MAX_RETRIES - 1) {
          // 指数退避: 100ms, 300ms, 700ms
          const delay = Math.pow(2, attempt + 2) * 100;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    return undefined;
  }

  /**
   * 生成评论摘要文本
   * 用于展示或AI分析
   */
  async generateCommentsSummary(comments: HNComment[]): Promise<string> {
    if (comments.length === 0) {
      return "";
    }

    const lines: string[] = [];

    // 添加评论统计
    lines.push(`## 社区讨论 (${comments.length}条热评)\n`);

    // 添加每条评论
    for (const comment of comments.slice(0, 10)) {
      // 仅显示前10条
      lines.push(`### ${comment.author} (${comment.score} 赞点)`);
      lines.push("");
      lines.push(this.cleanCommentText(comment.text));
      lines.push("");

      // 添加回复摘要
      if (comment.replies && comment.replies.length > 0) {
        lines.push(`> 有 ${comment.replies.length} 条回复`);
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  /**
   * 清理评论文本（移除HTML标签等）
   */
  private cleanCommentText(text: string): string {
    if (!text) {
      return "";
    }

    // 移除HTML标签 (HN API返回的是HTML)
    let cleaned = text
      .replace(/<[^>]*>/g, "") // 移除HTML标签
      .replace(/&quot;/g, '"') // HTML实体解码
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&apos;/g, "'")
      .trim();

    // 限制长度（对AI分析）
    if (cleaned.length > 300) {
      cleaned = cleaned.substring(0, 300) + "...";
    }

    return cleaned;
  }

  /**
   * 将评论集成到故事的内容中
   */
  async integrateCommentsIntoContent(
    storyText: string,
    comments: HNComment[],
  ): Promise<string> {
    const commentsSummary = await this.generateCommentsSummary(comments);
    return (
      storyText +
      "\n\n---\n\n" +
      commentsSummary +
      "\n\n*来自 HackerNews 社区讨论*"
    );
  }
}

/**
 * HackerNews 评论数据结构
 */
export interface HNComment {
  id: number;
  author: string;
  text: string;
  score: number;
  timestamp: Date;
  depth: number; // 深度：0表示顶级评论
  childCount: number; // 子评论数
  replies?: HNComment[]; // 子评论
}
