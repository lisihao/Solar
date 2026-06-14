import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { RawDataService } from "@/modules/ai-app/explore/rawdata/rawdata.service";
import { DeduplicationService } from "./deduplication.service";
import { AIEnrichmentService } from "../../../explore/resources/ai-enrichment.service";
import { HackernewsCommentsService } from "./hackernews-comments.service";
import {
  getErrorStack,
  getErrorMessage,
} from "../../../../../common/utils/error.utils";
import { Prisma } from "@prisma/client";
import axios from "axios";

/**
 * HackerNews 采集器
 *
 * 关键功能：
 * 1. 存储完整信息到 MongoDB raw_data 集合
 * 2. 建立 raw_data ↔ resource 的引用关系
 * 3. 实现去重逻辑（基于 HN item ID）
 * 4. 解析所有字段（标题、作者、评论、URL等）
 * 5. 获取并整合热门评论
 */
@Injectable()
export class HackernewsService {
  private readonly logger = new Logger(HackernewsService.name);
  private readonly HN_API_URL = "https://hacker-news.firebaseio.com/v0";

  constructor(
    private prisma: PrismaService,
    private rawData: RawDataService,
    private dedup: DeduplicationService,
    private aiEnrichment: AIEnrichmentService,
    private commentsService: HackernewsCommentsService,
  ) {}

  /**
   * 采集首页热门新闻
   * @param maxResults 最大结果数
   */
  async fetchTopStories(maxResults = 30): Promise<number> {
    this.logger.log(`Fetching HackerNews top stories (max: ${maxResults})`);

    try {
      // 获取热门故事 ID 列表
      const response = await axios.get(`${this.HN_API_URL}/topstories.json`, {
        timeout: 30000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      const storyIds: number[] = response.data || [];

      // 限制数量
      const selectedIds = storyIds.slice(0, maxResults);
      this.logger.log(`Found ${selectedIds.length} top stories`);

      // 处理每个故事
      let successCount = 0;
      for (const id of selectedIds) {
        try {
          await this.processStory(id);
          successCount++;
        } catch (error) {
          this.logger.error(
            `Failed to process story ${id}`,
            getErrorStack(error),
          );
        }
      }

      this.logger.log(
        `Successfully processed ${successCount}/${selectedIds.length} stories`,
      );
      return successCount;
    } catch (error) {
      this.logger.error(
        "Failed to fetch HackerNews stories",
        getErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * 采集最新故事
   */
  async fetchNewStories(maxResults = 30): Promise<number> {
    this.logger.log(`Fetching HackerNews new stories (max: ${maxResults})`);

    try {
      const response = await axios.get(`${this.HN_API_URL}/newstories.json`, {
        timeout: 30000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      const storyIds: number[] = response.data || [];

      const selectedIds = storyIds.slice(0, maxResults);

      let successCount = 0;
      for (const id of selectedIds) {
        try {
          await this.processStory(id);
          successCount++;
        } catch (error) {
          this.logger.error(
            `Failed to process story ${id}`,
            getErrorStack(error),
          );
        }
      }

      return successCount;
    } catch (error) {
      this.logger.error("Failed to fetch new stories", getErrorStack(error));
      throw error;
    }
  }

  /**
   * 采集最佳故事
   */
  async fetchBestStories(maxResults = 30): Promise<number> {
    this.logger.log(`Fetching HackerNews best stories (max: ${maxResults})`);

    try {
      const response = await axios.get(`${this.HN_API_URL}/beststories.json`, {
        timeout: 30000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      const storyIds: number[] = response.data || [];

      const selectedIds = storyIds.slice(0, maxResults);

      let successCount = 0;
      for (const id of selectedIds) {
        try {
          await this.processStory(id);
          successCount++;
        } catch (error) {
          this.logger.error(
            `Failed to process story ${id}`,
            getErrorStack(error),
          );
        }
      }

      return successCount;
    } catch (error) {
      this.logger.error("Failed to fetch best stories", getErrorStack(error));
      throw error;
    }
  }

  /**
   * 处理单个故事
   */
  private async processStory(itemId: number): Promise<void> {
    const externalId = itemId.toString();

    // 层级1去重：检查同源是否已存在（HackerNews 内部去重）
    const existingRawData = await this.rawData.findRawDataByExternalId(
      "hackernews",
      externalId,
    );

    if (existingRawData) {
      this.logger.debug(`Story already exists in HackerNews source: ${itemId}`);
      return;
    }

    // 层级2去重：跨源检查 - 使用 externalId（防止同一故事从不同源采集）
    const crossSourceDuplicate =
      await this.rawData.findRawDataByExternalIdAcrossAllSources(externalId);

    if (crossSourceDuplicate) {
      const source = (crossSourceDuplicate as { source?: string }).source;
      this.logger.debug(
        `Story already exists from another source: ${itemId} (source: ${source})`,
      );
      return;
    }

    // 获取故事详情
    const storyData = await this.fetchItem(itemId);

    if (!storyData || storyData.type !== "story") {
      this.logger.debug(`Item ${itemId} is not a story`);
      return;
    }

    // 层级3去重：URL 去重（防止同一链接从不同源采集）
    const storyUrl = typeof storyData.url === "string" ? storyData.url : "";

    if (storyUrl) {
      const normalizedUrl = this.dedup.normalizeUrl(storyUrl);
      const urlDuplicate =
        await this.rawData.findRawDataByUrlAcrossAllSources(normalizedUrl);

      if (urlDuplicate) {
        const source = (urlDuplicate as { source?: string }).source;
        this.logger.debug(
          `Story already exists with same URL: ${normalizedUrl} (source: ${source})`,
        );
        return;
      }
    }

    // 层级4去重：标题相似度检查
    const storyTitle =
      typeof storyData.title === "string" ? storyData.title : "";

    if (storyTitle) {
      const similarTitles =
        await this.rawData.findRawDataByTitleAcrossAllSources(storyTitle);

      for (const similar of similarTitles) {
        const similarData = similar as {
          data?: { title?: string };
          source?: string;
        };
        const similarTitle =
          typeof similarData.data?.title === "string"
            ? similarData.data.title
            : "";
        if (this.dedup.areTitlesSimilar(storyTitle, similarTitle, 0.9)) {
          this.logger.debug(
            `Story already exists with similar title: "${similarTitle}" (source: ${similarData.source}, similarity threshold: 0.9)`,
          );
          return;
        }
      }
    }

    // 层级5验证：URL 可访问性检查（只对有外部 URL 的故事检查）
    if (storyUrl) {
      const isAccessible = await this.checkUrlAccessibility(storyUrl);
      if (!isAccessible) {
        this.logger.warn(
          `Skipping story ${itemId}: URL is not accessible (${storyUrl})`,
        );
        return;
      }
    }

    // 解析完整的原始数据
    const rawData = this.parseRawData(storyData, externalId);

    // 获取热门评论（非阻塞，如果失败不影响主流程）
    try {
      const kids = rawData.kids;
      if (kids && Array.isArray(kids) && kids.length > 0) {
        this.logger.log(`Fetching top comments for story ${itemId}`);
        const comments = await this.commentsService.fetchTopComments(
          itemId,
          20, // 获取前20条热评
          2, // 递归深度2层
        );

        if (comments && comments.length > 0) {
          // 生成评论摘要并添加到rawData
          const commentsSummary =
            await this.commentsService.generateCommentsSummary(comments);
          rawData.commentsSummary = commentsSummary;
          rawData.topComments = comments;
          this.logger.log(
            `Fetched ${comments.length} comments for story ${itemId}`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch comments for story ${itemId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // 继续处理故事，不中断流程
    }

    // 1. 存储完整原始数据到 MongoDB
    const rawDataId = await this.rawData.insertRawData("hackernews", rawData);

    this.logger.log(`Stored raw data in MongoDB: HN-${itemId} -> ${rawDataId}`);

    // 2. 提取结构化数据并存储到 PostgreSQL
    const resourceData = this.extractResourceData(rawData, rawDataId);

    const resource = await this.prisma.resource.create({
      data: resourceData as Prisma.ResourceCreateInput,
    });

    this.logger.log(
      `Created resource in PostgreSQL: ${resource.id} with rawDataId: ${rawDataId}`,
    );

    // 3. ⚠️ 关键：建立双向引用
    // 3.1 MongoDB → PostgreSQL (resourceId)
    await this.rawData.linkResourceToRawData(rawDataId, resource.id);

    // 3.2 验证引用同步成功
    const linkedRawData = await this.rawData.findRawDataById(rawDataId);
    const linkedResourceId = (linkedRawData as { resourceId?: string })
      ?.resourceId;
    if (linkedResourceId !== resource.id) {
      this.logger.error(
        `Reference sync failed for story ${itemId}: MongoDB resourceId=${linkedResourceId}, expected ${resource.id}`,
      );
      throw new Error(
        `Failed to establish bi-directional reference for resource ${resource.id}`,
      );
    }

    this.logger.log(
      `✅ Reference sync completed: MongoDB(${rawDataId}) ↔ PostgreSQL(${resource.id})`,
    );

    // 4. AI 增强处理（异步，不阻塞主流程）
    this.enrichResourceWithAI(
      resource.id,
      resource.title,
      resource.sourceUrl,
    ).catch((error) => {
      this.logger.error(
        `Failed to enrich resource ${resource.id} with AI:`,
        error.message,
      );
    });
  }

  /**
   * 获取单个 item 详情
   */
  private async fetchItem(id: number): Promise<Record<string, unknown> | null> {
    try {
      const response = await axios.get(`${this.HN_API_URL}/item/${id}.json`, {
        timeout: 15000, // 单个项目15秒超时
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch item ${id}`, getErrorStack(error));
      return null;
    }
  }

  /**
   * 解析完整的原始数据（存储到 MongoDB）
   *
   * ⚠️ 关键：存储所有字段！
   */
  private parseRawData(
    storyData: Record<string, unknown>,
    externalId: string,
  ): Record<string, unknown> {
    const timeValue = typeof storyData.time === "number" ? storyData.time : 0;
    return {
      // 外部 ID（用于去重）
      externalId: externalId,

      // 基础信息
      id: storyData.id,
      type: storyData.type,
      title: this.dedup.cleanText(
        typeof storyData.title === "string" ? storyData.title : "",
      ),
      text: storyData.text
        ? this.dedup.cleanText(
            typeof storyData.text === "string" ? storyData.text : "",
          )
        : null,
      url: storyData.url || null,

      // 作者信息
      by: storyData.by,

      // 时间信息（Unix timestamp）
      time: timeValue,
      timeFormatted: new Date(timeValue * 1000).toISOString(),

      // 统计数据
      score: storyData.score || 0,
      descendants: storyData.descendants || 0, // 评论总数

      // 评论 ID 列表（完整）
      kids: storyData.kids || [],

      // HackerNews URL
      hnUrl: `https://news.ycombinator.com/item?id=${storyData.id}`,

      // 是否已删除
      deleted: storyData.deleted || false,
      dead: storyData.dead || false,

      // 原始数据（完整保存）
      _raw: storyData,

      // 采集时间
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * 从原始数据提取结构化数据（存储到 PostgreSQL）
   *
   * ⚠️ 关键：建立 rawDataId 引用关系！
   */
  private extractResourceData(
    rawData: Record<string, unknown>,
    rawDataId: string,
  ): Record<string, unknown> {
    // 确定资源 URL
    const sourceUrl = rawData.url || rawData.hnUrl;

    // 提取域名作为分类
    const domain =
      rawData.url && typeof rawData.url === "string"
        ? this.dedup.extractDomain(rawData.url)
        : "news.ycombinator.com";

    const title = typeof rawData.title === "string" ? rawData.title : "";
    const text = typeof rawData.text === "string" ? rawData.text : "";
    const timeFormatted =
      typeof rawData.timeFormatted === "string"
        ? rawData.timeFormatted
        : new Date().toISOString();
    const kids = Array.isArray(rawData.kids) ? rawData.kids : [];

    return {
      type: "NEWS",

      // 基础信息
      title: title,
      abstract: text || "",
      content: text || "",
      sourceUrl: sourceUrl,

      // 作者
      authors: [
        {
          username: rawData.by,
          platform: "hackernews",
        },
      ],

      // 发布时间
      publishedAt: new Date(timeFormatted),

      // 分类
      primaryCategory: "Tech News",
      categories: domain ? [domain] : ["Tech News"],
      tags: this.extractTags(title),

      // 统计数据
      upvoteCount: rawData.score,
      commentCount: rawData.descendants,

      // 评分
      qualityScore: this.calculateQualityScore(rawData),
      trendingScore: this.calculateTrendingScore(rawData),

      // 元数据
      metadata: {
        hnId: rawData.id,
        hnUrl: rawData.hnUrl,
        domain: domain,
        author: rawData.by,
        commentsCount: rawData.descendants,
        kidIds: kids.slice(0, 10), // 保存前10个评论ID
        timestamp: rawData.time,
      },

      // ⚠️ 关键！MongoDB 原始数据引用
      rawDataId: rawDataId,
    };
  }

  /**
   * 从标题提取标签
   */
  private extractTags(title: unknown): string[] {
    const tags: string[] = [];

    if (typeof title !== "string") return tags;

    // 常见技术关键词
    const keywords = [
      "AI",
      "ML",
      "Python",
      "JavaScript",
      "TypeScript",
      "React",
      "Vue",
      "Node",
      "Docker",
      "Kubernetes",
      "AWS",
      "Google",
      "Microsoft",
      "Apple",
      "Security",
      "Privacy",
      "Crypto",
      "Blockchain",
      "Web3",
      "API",
      "Database",
      "Cloud",
    ];

    const titleLower = title.toLowerCase();
    for (const keyword of keywords) {
      if (titleLower.includes(keyword.toLowerCase())) {
        tags.push(keyword);
      }
    }

    // 检查是否是 Show HN 或 Ask HN
    if (title.startsWith("Show HN:")) {
      tags.push("Show HN");
    }
    if (title.startsWith("Ask HN:")) {
      tags.push("Ask HN");
    }

    return tags;
  }

  /**
   * 计算质量评分（0-100）
   */
  private calculateQualityScore(rawData: Record<string, unknown>): number {
    const score = typeof rawData.score === "number" ? rawData.score : 0;
    const comments =
      typeof rawData.descendants === "number" ? rawData.descendants : 0;

    // 加权计算
    let quality = 0;
    quality += Math.min(score / 10, 70); // 最多70分
    quality += Math.min(comments / 5, 30); // 最多30分

    return Math.min(Math.round(quality), 100);
  }

  /**
   * 计算趋势评分
   */
  private calculateTrendingScore(rawData: Record<string, unknown>): number {
    const score = typeof rawData.score === "number" ? rawData.score : 0;
    const timeValue = typeof rawData.time === "number" ? rawData.time : 0;
    const ageInHours = (Date.now() - timeValue * 1000) / (1000 * 60 * 60);

    // HackerNews 算法：分数 / (年龄 + 2)^1.8
    const gravity = 1.8;
    const trendingScore = score / Math.pow(ageInHours + 2, gravity);

    return trendingScore * 100;
  }

  /**
   * AI 增强资源
   * 异步调用，不阻塞主流程
   */
  private async enrichResourceWithAI(
    resourceId: string,
    title: string,
    sourceUrl: string,
  ): Promise<void> {
    try {
      this.logger.log(`Starting AI enrichment for resource ${resourceId}`);

      // 调用 AI 增强服务
      const enrichment = await this.aiEnrichment.enrichResource({
        title,
        sourceUrl,
      });

      // 更新资源
      await this.prisma.resource.update({
        where: { id: resourceId },
        data: {
          aiSummary: enrichment.aiSummary,
          keyInsights: enrichment.keyInsights as unknown as string[],
          primaryCategory: enrichment.primaryCategory || "Tech News",
          autoTags: enrichment.autoTags,
          difficultyLevel: enrichment.difficultyLevel,
        },
      });

      this.logger.log(
        `AI enrichment completed for resource ${resourceId}: ` +
          `summary=${!!enrichment.aiSummary}, insights=${enrichment.keyInsights.length}, tags=${enrichment.autoTags.length}`,
      );
    } catch (error) {
      // 失败不影响主流程，只记录日志
      this.logger.warn(
        `AI enrichment failed for resource ${resourceId}: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * 检查 URL 是否可访问
   *
   * 使用 HEAD 请求检查 URL 是否返回成功状态码
   * 这可以过滤掉被 Cloudflare 等保护的网站
   *
   * @param url 要检查的 URL
   * @returns true 如果可访问，false 如果不可访问
   */
  private async checkUrlAccessibility(url: string): Promise<boolean> {
    try {
      // 使用 HEAD 请求，比 GET 更快更轻量
      const response = await axios.head(url, {
        timeout: 10000, // 10 秒超时
        maxRedirects: 5,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        // 不验证 SSL（某些网站可能有证书问题）
        httpsAgent: new (require("https").Agent)({
          rejectUnauthorized: false,
        }),
      });

      // 200-399 都视为可访问
      const isAccessible = response.status >= 200 && response.status < 400;

      if (isAccessible) {
        this.logger.debug(
          `URL accessible: ${url} (status: ${response.status})`,
        );
      } else {
        this.logger.debug(
          `URL not accessible: ${url} (status: ${response.status})`,
        );
      }

      return isAccessible;
    } catch (error: unknown) {
      const axiosError = error as {
        response?: { status?: number };
        message?: string;
      };
      // 如果 HEAD 请求被拒绝，尝试 GET 请求（某些服务器不支持 HEAD）
      if (axiosError.response?.status === 405) {
        try {
          const getResponse = await axios.get(url, {
            timeout: 10000,
            maxRedirects: 5,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            },
            // 只获取头部信息，不下载全部内容
            responseType: "stream",
            httpsAgent: new (require("https").Agent)({
              rejectUnauthorized: false,
            }),
          });

          // 立即关闭流
          getResponse.data.destroy();

          return getResponse.status >= 200 && getResponse.status < 400;
        } catch {
          // GET 也失败了
        }
      }

      // 记录失败原因
      const status = axiosError.response?.status;
      const message = axiosError.message || "Unknown error";

      this.logger.debug(
        `URL accessibility check failed: ${url} (status: ${status}, error: ${message})`,
      );

      return false;
    }
  }
}
