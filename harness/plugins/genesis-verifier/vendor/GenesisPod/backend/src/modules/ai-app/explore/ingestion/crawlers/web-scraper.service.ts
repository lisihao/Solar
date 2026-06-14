import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { RawDataService } from "@/modules/ai-app/explore/rawdata/rawdata.service";
import { DeduplicationService } from "./deduplication.service";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import axios from "axios";

/**
 * 通用网页爬虫服务
 * 支持通过CSS选择器从任意网页提取内容
 */
@Injectable()
export class WebScraperService {
  private readonly logger = new Logger(WebScraperService.name);

  constructor(
    private prisma: PrismaService,
    private rawData: RawDataService,
    private deduplication: DeduplicationService,
  ) {}

  /**
   * 从网页抓取内容
   * @param url 目标网址
   * @param maxItems 最大获取数量
   * @param category 资源类型
   * @param selector CSS选择器
   * @returns 成功采集的数量
   */
  async scrapeWebPage(
    url: string,
    maxItems: number = 10,
    category: string = "POLICY",
    selector: string = ".news-item",
  ): Promise<number> {
    try {
      this.logger.log(`Scraping ${url} with selector: ${selector}`);

      // 设置合理的请求头，模拟浏览器访问
      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        timeout: 30000, // 30 seconds timeout
      });

      if (!response.data) {
        this.logger.warn(`No data received from ${url}`);
        return 0;
      }

      // 使用cheerio解析HTML
      const $ = cheerio.load(response.data);

      // 根据选择器提取所有项目
      const items = $(selector);

      if (items.length === 0) {
        this.logger.warn(
          `No items found with selector "${selector}" at ${url}`,
        );

        // 尝试自动检测常见的新闻/文章结构
        const fallbackItems = this.autoDetectItems($, url);
        if (fallbackItems.length > 0) {
          return await this.processItems(
            fallbackItems.slice(0, maxItems),
            url,
            category,
          );
        }

        return 0;
      }

      this.logger.log(
        `Found ${items.length} items, processing top ${maxItems}`,
      );

      // 提取和处理项目
      const extractedItems: Array<{
        title: string;
        link: string;
        summary: string;
        publishedAt: Date;
        author: string;
        rawHtml: string;
      }> = [];
      items.slice(0, maxItems).each((_index: number, element: AnyNode) => {
        const item = this.extractItemData($, $(element), url);
        if (item) {
          extractedItems.push(item);
        }
      });

      return await this.processItems(extractedItems, url, category);
    } catch (error) {
      // 提供更友好的错误信息
      let errorMessage = `Failed to scrape ${url}`;

      if (axios.isAxiosError(error)) {
        if (error.response?.status === 403) {
          errorMessage = `Access forbidden (403) to ${url}. The site may be blocking automated requests or require authentication.`;
        } else if (error.response?.status === 404) {
          errorMessage = `Page not found (404): ${url}. Please verify the URL is correct.`;
        } else if (error.response?.status === 429) {
          errorMessage = `Rate limited (429) by ${url}. Too many requests - please try again later.`;
        } else if (error.code === "ECONNREFUSED") {
          errorMessage = `Connection refused to ${url}. The server may be down.`;
        } else {
          errorMessage = `${errorMessage}: ${error.message}`;
        }
        this.logger.error(errorMessage, error.stack);
      } else {
        this.logger.error(
          errorMessage,
          error instanceof Error ? error.stack : String(error),
        );
      }

      throw new Error(errorMessage);
    }
  }

  /**
   * 从HTML元素中提取数据
   */
  private extractItemData(
    _$: cheerio.CheerioAPI,
    element: cheerio.Cheerio<AnyNode>,
    baseUrl: string,
  ): {
    title: string;
    link: string;
    summary: string;
    publishedAt: Date;
    author: string;
    rawHtml: string;
  } | null {
    try {
      // 提取标题 - 尝试多种选择器
      const title =
        element.find("h1").first().text().trim() ||
        element.find("h2").first().text().trim() ||
        element.find("h3").first().text().trim() ||
        element.find(".title").first().text().trim() ||
        element.find(".headline").first().text().trim() ||
        element.find("a").first().text().trim();

      if (!title) {
        this.logger.debug("No title found, skipping item");
        return null;
      }

      // 提取链接 - 尝试多种选择器
      let link =
        element.find("a").first().attr("href") || element.attr("href") || "";

      // 处理相对链接
      if (link && !link.startsWith("http")) {
        const urlObj = new URL(baseUrl);
        if (link.startsWith("/")) {
          link = `${urlObj.origin}${link}`;
        } else {
          link = `${urlObj.origin}/${link}`;
        }
      }

      if (!link) {
        this.logger.debug(`No link found for: ${title}`);
        return null;
      }

      // 提取摘要/描述
      let summary =
        element.find("p").first().text().trim() ||
        element.find(".description").first().text().trim() ||
        element.find(".summary").first().text().trim() ||
        element.find(".excerpt").first().text().trim() ||
        "";

      // 限制摘要长度
      if (summary.length > 500) {
        summary = summary.substring(0, 497) + "...";
      }

      // 提取日期
      let publishedAt = new Date();
      const dateText =
        element.find("time").first().attr("datetime") ||
        element.find(".date").first().text().trim() ||
        element.find(".published").first().text().trim() ||
        "";

      if (dateText) {
        const parsedDate = new Date(dateText);
        if (!isNaN(parsedDate.getTime())) {
          publishedAt = parsedDate;
        }
      }

      // 提取作者
      const author =
        element.find(".author").first().text().trim() ||
        element.find(".byline").first().text().trim() ||
        "Unknown";

      return {
        title,
        link,
        summary,
        publishedAt,
        author,
        rawHtml: element.html() || "",
      };
    } catch (error) {
      this.logger.error("Error extracting item data:", error);
      return null;
    }
  }

  /**
   * 自动检测常见的新闻/文章结构
   */
  private autoDetectItems(
    $: cheerio.CheerioAPI,
    url: string,
  ): Array<{
    title: string;
    link: string;
    summary: string;
    publishedAt: Date;
    author: string;
    rawHtml: string;
  }> {
    this.logger.log("Auto-detecting content structure...");

    const items: Array<{
      title: string;
      link: string;
      summary: string;
      publishedAt: Date;
      author: string;
      rawHtml: string;
    }> = [];

    // 尝试常见的新闻/文章选择器
    const commonSelectors = [
      "article",
      ".article",
      ".post",
      ".news-item",
      ".item",
      ".card",
      ".entry",
      ".publication",
      ".resource",
      "[class*='news']",
      "[class*='article']",
      "[class*='post']",
    ];

    for (const selector of commonSelectors) {
      const elements = $(selector);
      if (elements.length > 0) {
        this.logger.log(
          `Auto-detected ${elements.length} items with selector: ${selector}`,
        );

        elements.each((_index: number, element: AnyNode) => {
          const item = this.extractItemData($, $(element), url);
          if (item) {
            items.push(item);
          }
        });

        if (items.length > 0) {
          break; // 找到有效内容就停止
        }
      }
    }

    return items;
  }

  /**
   * 处理和存储提取的项目
   */
  private async processItems(
    items: Array<{
      title: string;
      link: string;
      summary: string;
      publishedAt: Date;
      author: string;
      rawHtml: string;
    }>,
    sourceUrl: string,
    category: string,
  ): Promise<number> {
    let successCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;

    for (const item of items) {
      try {
        if (!item.title || !item.link) {
          this.logger.warn("Skipping item without title or link");
          failedCount++;
          continue;
        }

        // URL去重检查（使用MongoDB）
        const normalizedUrl = this.deduplication.normalizeUrl(item.link);
        const urlDuplicate =
          await this.rawData.findRawDataByUrlAcrossAllSources(normalizedUrl);

        if (urlDuplicate) {
          const source = (urlDuplicate as { source?: string }).source;
          this.logger.debug(
            `Web scraped item already exists: ${item.title} (source: ${source})`,
          );
          duplicateCount++;
          continue;
        }

        // 准备完整原始数据（存储到 MongoDB）
        const rawData = {
          // 外部 ID (使用 URL 作为去重标识)
          externalId: item.link,

          // 完整的原始数据
          ...item,
          sourceUrl: sourceUrl,
          fetchedAt: new Date().toISOString(),

          // 保存完整URL信息（用于去重）
          url: item.link,
        };

        // 1. 存储完整原始数据到 MongoDB
        const rawDataId = await this.rawData.insertRawData(
          "web_scraper",
          rawData,
        );

        this.logger.log(
          `Stored raw data in MongoDB: ${item.title} -> ${rawDataId}`,
        );

        // 2. 创建 PostgreSQL Resource 记录
        const resource = await this.prisma.resource.create({
          data: {
            type: category as unknown as
              | "PAPER"
              | "BLOG"
              | "REPORT"
              | "YOUTUBE_VIDEO"
              | "NEWS"
              | "PROJECT"
              | "EVENT"
              | "RSS"
              | "POLICY",

            // 基础信息
            title: item.title,
            abstract: item.summary || "",
            sourceUrl: item.link,

            // 作者信息
            authors: item.author
              ? [{ name: item.author }]
              : [{ name: "Unknown" }],

            // 发布时间
            publishedAt: item.publishedAt,

            // 分类和标签
            tags: [],

            // 元数据
            metadata: {
              scrapedFrom: sourceUrl,
              originalHtml: item.rawHtml,
            },

            // ⚠️ 关键！MongoDB 原始数据引用
            rawDataId: rawDataId,

            // 初始评分
            qualityScore: 8.0, // 政府/官方来源质量较高
            trendingScore: 0,
          },
        });

        this.logger.log(
          `Created resource in PostgreSQL: ${resource.id} with rawDataId: ${rawDataId}`,
        );

        // 3. ⚠️ 关键：建立双向引用 MongoDB → PostgreSQL
        await this.rawData.linkResourceToRawData(rawDataId, resource.id);

        // 4. 验证引用同步成功
        const linkedRawData = await this.rawData.findRawDataById(rawDataId);
        const linkedResourceId = (linkedRawData as { resourceId?: string })
          ?.resourceId;
        if (linkedResourceId !== resource.id) {
          this.logger.error(
            `Reference sync failed for scraped item ${item.title}: MongoDB resourceId=${linkedResourceId}, expected ${resource.id}`,
          );
          throw new Error(
            `Failed to establish bi-directional reference for resource ${resource.id}`,
          );
        }

        this.logger.log(
          `✅ Reference sync completed: MongoDB(${rawDataId}) ↔ PostgreSQL(${resource.id})`,
        );

        successCount++;
      } catch (error) {
        this.logger.error(
          `Failed to process item: ${item.title}`,
          error instanceof Error ? error.stack : String(error),
        );
        failedCount++;
      }
    }

    this.logger.log(
      `Web scraping completed: ${successCount} success, ${duplicateCount} duplicates, ${failedCount} failed`,
    );

    return successCount;
  }

  /**
   * 批量抓取多个网页
   */
  async scrapeMultiplePages(
    pages: Array<{ url: string; selector: string; category: string }>,
    maxItemsPerPage: number = 10,
  ): Promise<{ total: number; successful: number; failed: number }> {
    let total = 0;
    let successful = 0;
    let failed = 0;

    for (const page of pages) {
      try {
        const count = await this.scrapeWebPage(
          page.url,
          maxItemsPerPage,
          page.category,
          page.selector,
        );
        total += count;
        if (count > 0) successful++;
      } catch (error) {
        this.logger.error(`Failed to scrape page ${page.url}`, error);
        failed++;
      }
    }

    return { total, successful, failed };
  }
}
