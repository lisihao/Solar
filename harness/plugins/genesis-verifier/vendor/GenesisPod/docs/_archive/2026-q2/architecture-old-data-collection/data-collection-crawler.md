# 爬虫技术

## 概述

Genesis 实现了多种数据采集服务，支持从不同来源获取内容：

- 网页爬虫 (Cheerio + Axios)
- RSS/Atom 订阅
- YouTube 视频与字幕
- arXiv 学术论文
- GitHub 仓库
- Hacker News

## 核心技术栈

```
┌─────────────────────────────────────────────────────────────┐
│                    数据采集架构                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              CrawlerModule                           │   │
│  │  • 统一采集接口                                       │   │
│  │  • 数据源管理                                         │   │
│  │  • 采集任务调度                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│    ┌─────────┬─────────┬─────────┬─────────┬─────────┐     │
│    ▼         ▼         ▼         ▼         ▼         ▼     │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐    │
│ │ Web  │ │ RSS  │ │YouTube│ │arXiv │ │GitHub│ │  HN  │    │
│ │Scraper│ │Parser│ │Scraper│ │Client│ │Client│ │Client│    │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘    │
│    │         │         │         │         │         │     │
│    ▼         ▼         ▼         ▼         ▼         ▼     │
│ ┌──────────────────────────────────────────────────────┐   │
│ │                DeduplicationService                   │   │
│ │  • 内容去重                                           │   │
│ │  • 相似度检测                                         │   │
│ └──────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│ ┌──────────────────────────────────────────────────────┐   │
│ │                   PostgreSQL                          │   │
│ │  • resources 表                                       │   │
│ │  • data_collection_raw_data 表                       │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Cheerio 网页解析

### 1. 核心原理

Cheerio 是服务端 jQuery 实现，用于解析和操作 HTML：

```typescript
import * as cheerio from "cheerio";
import axios from "axios";

// 加载 HTML
const response = await axios.get("https://example.com/article");
const $ = cheerio.load(response.data);

// jQuery 风格选择器
const title = $("h1").text();
const content = $("article").html();
const links = $("a")
  .map((i, el) => $(el).attr("href"))
  .get();
```

### 2. 网页爬虫服务

```typescript
// web-scraper.service.ts
@Injectable()
export class WebScraperService {
  constructor(private httpService: HttpService) {}

  async scrape(
    url: string,
    selectors: ScraperSelectors,
  ): Promise<ScrapedContent> {
    const response = await this.httpService.axiosRef.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Genesis/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      timeout: 30000,
    });

    const $ = cheerio.load(response.data);

    // 提取内容
    const title = this.extractText($, selectors.title);
    const content = this.extractContent($, selectors.content);
    const author = this.extractText($, selectors.author);
    const publishedAt = this.extractDate($, selectors.date);
    const images = this.extractImages($, selectors.images, url);

    // 清理内容
    const cleanContent = this.cleanHtml(content);

    return {
      url,
      title,
      content: cleanContent,
      author,
      publishedAt,
      images,
      scrapedAt: new Date(),
    };
  }

  private extractText($: CheerioAPI, selector?: string): string {
    if (!selector) return "";
    return $(selector).first().text().trim();
  }

  private extractContent($: CheerioAPI, selector?: string): string {
    if (!selector) return "";

    const element = $(selector).first();

    // 移除脚本和样式
    element.find("script, style, nav, footer, aside").remove();

    return element.html() || "";
  }

  private extractImages(
    $: CheerioAPI,
    selector: string | undefined,
    baseUrl: string,
  ): string[] {
    const images: string[] = [];
    const imgSelector = selector || "img";

    $(imgSelector).each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src");
      if (src) {
        // 转换相对路径为绝对路径
        const absoluteUrl = new URL(src, baseUrl).href;
        images.push(absoluteUrl);
      }
    });

    return images;
  }

  private cleanHtml(html: string): string {
    const $ = cheerio.load(html);

    // 移除广告和无关内容
    $("script, style, iframe, .ad, .advertisement").remove();

    // 转换为纯文本或 Markdown
    return this.htmlToMarkdown($.html());
  }

  private htmlToMarkdown(html: string): string {
    const turndownService = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });

    return turndownService.turndown(html);
  }
}
```

### 3. 可读性提取 (Readability)

```typescript
// readability.service.ts
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

@Injectable()
export class ReadabilityService {
  extractArticle(html: string, url: string): ArticleContent | null {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) return null;

    return {
      title: article.title,
      content: article.content,
      textContent: article.textContent,
      excerpt: article.excerpt,
      byline: article.byline,
      length: article.length,
      siteName: article.siteName,
    };
  }
}
```

## RSS/Atom 解析

### 1. RSS 服务

```typescript
// rss.service.ts
import Parser from "rss-parser";

@Injectable()
export class RssService {
  private parser: Parser;

  constructor() {
    this.parser = new Parser({
      customFields: {
        feed: ["language", "copyright"],
        item: [
          ["content:encoded", "fullContent"],
          ["dc:creator", "creator"],
          ["media:content", "media"],
        ],
      },
      timeout: 30000,
      headers: {
        "User-Agent": "Genesis RSS Reader/1.0",
      },
    });
  }

  async parseFeed(feedUrl: string): Promise<ParsedFeed> {
    const feed = await this.parser.parseURL(feedUrl);

    return {
      title: feed.title,
      description: feed.description,
      link: feed.link,
      language: feed.language,
      lastBuildDate: feed.lastBuildDate,
      items: feed.items.map((item) => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate ? new Date(item.pubDate) : null,
        author: item.creator || item.author,
        content: item.fullContent || item.content || item.contentSnippet,
        categories: item.categories || [],
        guid: item.guid || item.link,
      })),
    };
  }

  async fetchNewItems(
    feedUrl: string,
    lastFetchedGuid?: string,
  ): Promise<FeedItem[]> {
    const feed = await this.parseFeed(feedUrl);
    const items: FeedItem[] = [];

    for (const item of feed.items) {
      if (item.guid === lastFetchedGuid) break;
      items.push(item);
    }

    return items;
  }
}
```

### 2. 博客采集服务

```typescript
// blog-collection.service.ts
@Injectable()
export class BlogCollectionService {
  constructor(
    private rssService: RssService,
    private prisma: PrismaService,
    private deduplicationService: DeduplicationService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async collectBlogs() {
    const sources = await this.prisma.dataSource.findMany({
      where: { type: "rss", isActive: true },
    });

    for (const source of sources) {
      try {
        await this.collectFromSource(source);
      } catch (error) {
        console.error(`Failed to collect from ${source.url}:`, error);
      }
    }
  }

  private async collectFromSource(source: DataSource) {
    const items = await this.rssService.fetchNewItems(
      source.url,
      source.lastFetchedGuid,
    );

    for (const item of items) {
      // 检查重复
      const isDuplicate = await this.deduplicationService.isDuplicate(
        item.title,
        item.content,
      );

      if (isDuplicate) continue;

      // 创建资源
      await this.prisma.resource.create({
        data: {
          title: item.title,
          url: item.link,
          type: "article",
          content: item.content,
          metadata: {
            source: source.name,
            author: item.author,
            categories: item.categories,
          },
          publishedAt: item.pubDate,
        },
      });
    }

    // 更新最后获取的 GUID
    if (items.length > 0) {
      await this.prisma.dataSource.update({
        where: { id: source.id },
        data: { lastFetchedGuid: items[0].guid },
      });
    }
  }
}
```

## YouTube 采集

### 1. YouTube 服务

```typescript
// youtube.service.ts
import Innertube from "youtubei.js";
import { YoutubeTranscript } from "youtube-transcript";

@Injectable()
export class YouTubeService {
  private innertube: Innertube;

  async onModuleInit() {
    this.innertube = await Innertube.create();
  }

  async getVideoInfo(videoId: string): Promise<VideoInfo> {
    const video = await this.innertube.getInfo(videoId);

    return {
      id: videoId,
      title: video.basic_info.title,
      description: video.basic_info.short_description,
      author: video.basic_info.author,
      duration: video.basic_info.duration,
      viewCount: video.basic_info.view_count,
      publishedAt: video.primary_info?.published,
      thumbnails: video.basic_info.thumbnail,
      tags: video.basic_info.keywords,
    };
  }

  async getTranscript(
    videoId: string,
    lang: string = "en",
  ): Promise<TranscriptItem[]> {
    try {
      const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
        lang,
      });

      return transcript.map((item) => ({
        text: item.text,
        offset: item.offset,
        duration: item.duration,
      }));
    } catch (error) {
      console.warn(`No transcript available for ${videoId}`);
      return [];
    }
  }

  async getFullTranscriptText(videoId: string): Promise<string> {
    const transcript = await this.getTranscript(videoId);
    return transcript.map((item) => item.text).join(" ");
  }

  async searchVideos(query: string, limit: number = 10): Promise<VideoInfo[]> {
    const results = await this.innertube.search(query, { type: "video" });
    const videos: VideoInfo[] = [];

    for (const item of results.results.slice(0, limit)) {
      if (item.type === "Video") {
        videos.push({
          id: item.id,
          title: item.title.text,
          description: item.snippets?.[0]?.text || "",
          author: item.author?.name,
          duration: item.duration?.seconds,
          viewCount: item.view_count?.text,
          thumbnails: item.thumbnails,
        });
      }
    }

    return videos;
  }
}
```

## arXiv 论文采集

### 1. arXiv 服务

```typescript
// arxiv.service.ts
import * as xml2js from "xml2js";

@Injectable()
export class ArxivService {
  private readonly baseUrl = "http://export.arxiv.org/api/query";

  async search(params: ArxivSearchParams): Promise<ArxivPaper[]> {
    const query = this.buildQuery(params);

    const response = await axios.get(this.baseUrl, {
      params: {
        search_query: query,
        start: params.start || 0,
        max_results: params.maxResults || 10,
        sortBy: params.sortBy || "submittedDate",
        sortOrder: params.sortOrder || "descending",
      },
    });

    const result = await xml2js.parseStringPromise(response.data);
    return this.parseEntries(result.feed.entry || []);
  }

  private buildQuery(params: ArxivSearchParams): string {
    const conditions: string[] = [];

    if (params.title) {
      conditions.push(`ti:"${params.title}"`);
    }
    if (params.author) {
      conditions.push(`au:"${params.author}"`);
    }
    if (params.abstract) {
      conditions.push(`abs:"${params.abstract}"`);
    }
    if (params.category) {
      conditions.push(`cat:${params.category}`);
    }
    if (params.all) {
      conditions.push(`all:"${params.all}"`);
    }

    return conditions.join(" AND ") || "all:*";
  }

  private parseEntries(entries: any[]): ArxivPaper[] {
    return entries.map((entry) => ({
      id: this.extractArxivId(entry.id[0]),
      title: entry.title[0].trim(),
      summary: entry.summary[0].trim(),
      authors: entry.author?.map((a) => a.name[0]) || [],
      categories: entry.category?.map((c) => c.$.term) || [],
      publishedAt: new Date(entry.published[0]),
      updatedAt: new Date(entry.updated[0]),
      pdfUrl: entry.link?.find((l) => l.$.title === "pdf")?.$.href,
      doi: entry["arxiv:doi"]?.[0]?._ || null,
    }));
  }

  private extractArxivId(fullId: string): string {
    // http://arxiv.org/abs/2301.12345v1 -> 2301.12345
    const match = fullId.match(/\/abs\/([^v]+)/);
    return match ? match[1] : fullId;
  }

  async getPaperByArxivId(arxivId: string): Promise<ArxivPaper | null> {
    const results = await this.search({
      all: arxivId,
      maxResults: 1,
    });

    return results[0] || null;
  }
}
```

## 去重服务

### 1. 基于相似度的去重

```typescript
// deduplication.service.ts
import { compareTwoStrings } from "string-similarity-js";

@Injectable()
export class DeduplicationService {
  private readonly SIMILARITY_THRESHOLD = 0.85;

  constructor(private prisma: PrismaService) {}

  async isDuplicate(title: string, content?: string): Promise<boolean> {
    // 1. 精确 URL 匹配 (在调用前已检查)

    // 2. 标题相似度检查
    const similarByTitle = await this.findSimilarByTitle(title);
    if (similarByTitle.length > 0) {
      return true;
    }

    // 3. 内容相似度检查 (如果提供了内容)
    if (content) {
      const similarByContent = await this.findSimilarByContent(content);
      if (similarByContent.length > 0) {
        return true;
      }
    }

    return false;
  }

  private async findSimilarByTitle(title: string): Promise<Resource[]> {
    // 获取最近的资源进行比较
    const recentResources = await this.prisma.resource.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7天内
        },
      },
      select: { id: true, title: true },
      take: 1000,
    });

    return recentResources.filter((resource) => {
      const similarity = compareTwoStrings(
        this.normalizeText(title),
        this.normalizeText(resource.title),
      );
      return similarity >= this.SIMILARITY_THRESHOLD;
    });
  }

  private async findSimilarByContent(content: string): Promise<Resource[]> {
    // 提取内容摘要进行比较
    const contentHash = this.generateContentHash(content);

    const existingResource = await this.prisma.resource.findFirst({
      where: {
        metadata: {
          path: ["contentHash"],
          equals: contentHash,
        },
      },
    });

    return existingResource ? [existingResource] : [];
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private generateContentHash(content: string): string {
    // 简单的内容指纹
    const normalized = this.normalizeText(content.slice(0, 1000));
    return crypto.createHash("md5").update(normalized).digest("hex");
  }
}
```

## 定时任务

```typescript
// crawler.scheduler.ts
import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";

@Injectable()
export class CrawlerScheduler {
  constructor(
    private blogService: BlogCollectionService,
    private arxivService: ArxivCollectionService,
    private hnService: HackernewsService,
  ) {}

  // 每小时采集博客
  @Cron(CronExpression.EVERY_HOUR)
  async collectBlogs() {
    await this.blogService.collectBlogs();
  }

  // 每6小时采集 arXiv
  @Cron("0 */6 * * *")
  async collectArxiv() {
    const categories = ["cs.AI", "cs.LG", "cs.CL"];
    for (const category of categories) {
      await this.arxivService.collectByCategory(category);
    }
  }

  // 每30分钟采集 HN
  @Cron("*/30 * * * *")
  async collectHackerNews() {
    await this.hnService.collectTopStories();
  }
}
```

## 参考资源

- [Cheerio 文档](https://cheerio.js.org/)
- [rss-parser 文档](https://github.com/rbren/rss-parser)
- [Mozilla Readability](https://github.com/mozilla/readability)
- [arXiv API](https://arxiv.org/help/api/index)
