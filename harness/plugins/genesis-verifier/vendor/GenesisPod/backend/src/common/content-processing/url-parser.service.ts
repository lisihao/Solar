/**
 * URL Parser Service
 *
 * 通用 URL 解析服务，提供：
 * - URL 检测和验证
 * - URL 类型识别（网页、图片、视频、代码仓库等）
 * - 元数据提取
 * - SSRF 防护
 * - 缓存管理
 *
 * 从 ai-teams/utils 迁移至 common 模块
 */

import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { WebContentExtractionService } from "./web-content-extraction.service";
import { APP_CONFIG } from "../config/app.config";

/**
 * URL 解析类型
 */
export type ParsedUrlType =
  | "WEBPAGE"
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT"
  | "CODE_REPO"
  | "SOCIAL";

/**
 * 解析状态
 */
export type ParseStatus = "pending" | "parsing" | "success" | "failed";

/**
 * 链接预览数据
 */
export interface LinkPreview {
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
  author?: string;
  publishedAt?: string;
}

/**
 * 提取的内容
 */
export interface ExtractedUrlContent {
  fullText?: string;
  summary?: string;
  keyPoints?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * 解析结果
 */
export interface ParsedUrl {
  type: ParsedUrlType;
  originalText: string;
  url: string;
  platform?: string;
  preview: LinkPreview;
  extractedContent?: ExtractedUrlContent;
  status: ParseStatus;
  error?: string;
}

/**
 * URL 检测结果
 */
export interface DetectedUrl {
  url: string;
  startIndex: number;
  endIndex: number;
  type: ParsedUrlType;
  platform?: string;
}

/**
 * URL 解析服务
 * 负责检测、解析和提取 URL 内容
 */
@Injectable()
export class UrlParserService {
  private readonly logger = new Logger(UrlParserService.name);

  // URL 缓存（内存缓存，生产环境建议使用 Redis）
  private urlCache = new Map<string, { data: ParsedUrl; expiresAt: number }>();
  private readonly CACHE_TTL = 3600 * 1000; // 1 小时

  // URL 正则表达式 - 匹配嵌入在文本中的 URL
  private readonly URL_REGEX =
    /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

  // 特殊平台识别
  private readonly PLATFORM_PATTERNS: Record<string, RegExp> = {
    youtube: /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/i,
    bilibili: /bilibili\.com\/video\/(BV[\w]+)/i,
    github: /github\.com\/([\w-]+\/[\w-]+)/i,
    twitter: /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i,
    notion: /notion\.(?:so|site)\/([\w-]+)/i,
    googleDocs: /docs\.google\.com\/document\/d\/([\w-]+)/i,
    figma: /figma\.com\/(file|design)\/([\w-]+)/i,
  };

  // 媒体文件扩展名
  private readonly MEDIA_EXTENSIONS = {
    image: /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp|tiff)(\?.*)?$/i,
    video: /\.(mp4|webm|mov|avi|mkv|flv)(\?.*)?$/i,
    audio: /\.(mp3|wav|ogg|m4a|flac|aac)(\?.*)?$/i,
    document: /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md)(\?.*)?$/i,
  };

  // 内网地址黑名单（SSRF 防护）
  private readonly BLOCKED_HOSTS = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^0\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i,
  ];

  constructor(
    @Inject(forwardRef(() => WebContentExtractionService))
    private webContentExtractionService: WebContentExtractionService,
  ) {}

  /**
   * 从文本中检测所有 URL
   */
  detectUrls(text: string): DetectedUrl[] {
    const detectedUrls: DetectedUrl[] = [];
    let match: RegExpExecArray | null;

    // 重置正则表达式的 lastIndex
    this.URL_REGEX.lastIndex = 0;

    while ((match = this.URL_REGEX.exec(text)) !== null) {
      const url = match[0];
      const startIndex = match.index;
      const endIndex = startIndex + url.length;

      // 跳过被阻止的主机
      if (this.isBlockedHost(url)) {
        this.logger.warn(`Blocked internal URL: ${url}`);
        continue;
      }

      const { type, platform } = this.identifyUrlType(url);

      detectedUrls.push({
        url,
        startIndex,
        endIndex,
        type,
        platform,
      });
    }

    return detectedUrls;
  }

  /**
   * 识别 URL 类型
   */
  identifyUrlType(url: string): { type: ParsedUrlType; platform?: string } {
    // 检查媒体扩展名
    if (this.MEDIA_EXTENSIONS.image.test(url)) {
      return { type: "IMAGE" };
    }
    if (this.MEDIA_EXTENSIONS.video.test(url)) {
      return { type: "VIDEO" };
    }
    if (this.MEDIA_EXTENSIONS.document.test(url)) {
      return { type: "DOCUMENT" };
    }

    // 检查特殊平台
    for (const [platform, pattern] of Object.entries(this.PLATFORM_PATTERNS)) {
      if (pattern.test(url)) {
        if (platform === "youtube" || platform === "bilibili") {
          return { type: "VIDEO", platform };
        }
        if (platform === "github") {
          return { type: "CODE_REPO", platform };
        }
        if (platform === "twitter") {
          return { type: "SOCIAL", platform };
        }
        return { type: "WEBPAGE", platform };
      }
    }

    return { type: "WEBPAGE" };
  }

  /**
   * 检查是否为被阻止的内网地址
   */
  isBlockedHost(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const host = urlObj.hostname;
      return this.BLOCKED_HOSTS.some((pattern) => pattern.test(host));
    } catch {
      return true; // 无效 URL 默认阻止
    }
  }

  /**
   * 解析单个 URL
   */
  async parseUrl(url: string): Promise<ParsedUrl> {
    // 检查缓存
    const cached = this.getFromCache(url);
    if (cached) {
      this.logger.debug(`Cache hit for URL: ${url}`);
      return cached;
    }

    const { type, platform } = this.identifyUrlType(url);

    const result: ParsedUrl = {
      type,
      originalText: url,
      url,
      platform,
      preview: {},
      status: "parsing",
    };

    try {
      // 根据类型选择解析器
      switch (type) {
        case "IMAGE":
          await this.parseImage(url, result);
          break;
        case "VIDEO":
          await this.parseVideo(url, result, platform);
          break;
        case "CODE_REPO":
          await this.parseGitHub(url, result);
          break;
        case "SOCIAL":
          await this.parseSocial(url, result, platform);
          break;
        default:
          await this.parseWebpage(url, result);
      }

      result.status = "success";
    } catch (error) {
      this.logger.error(`Failed to parse URL ${url}: ${error}`);
      result.status = "failed";
      result.error = error instanceof Error ? error.message : "Unknown error";
    }

    // 缓存结果
    this.setCache(url, result);

    return result;
  }

  /**
   * 批量解析 URL
   */
  async parseUrls(urls: string[]): Promise<ParsedUrl[]> {
    // 去重
    const uniqueUrls = [...new Set(urls)];

    // 并行解析（限制并发数为 5）
    const results: ParsedUrl[] = [];
    const batchSize = 5;

    for (let i = 0; i < uniqueUrls.length; i += batchSize) {
      const batch = uniqueUrls.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((url) => this.parseUrl(url)),
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * 从文本中检测并解析所有 URL
   */
  async detectAndParseUrls(text: string): Promise<{
    detectedUrls: DetectedUrl[];
    parsedUrls: ParsedUrl[];
  }> {
    const detectedUrls = this.detectUrls(text);

    if (detectedUrls.length === 0) {
      return { detectedUrls: [], parsedUrls: [] };
    }

    const urls = detectedUrls.map((d) => d.url);
    const parsedUrls = await this.parseUrls(urls);

    return { detectedUrls, parsedUrls };
  }

  /**
   * 解析普通网页
   * 优先使用 WebContentExtractionService 提取高质量内容
   */
  private async parseWebpage(url: string, result: ParsedUrl): Promise<void> {
    try {
      // 使用 WebContentExtractionService（Jina AI / Firecrawl）
      const extracted =
        await this.webContentExtractionService.extractContent(url);

      if (!extracted.error && extracted.content) {
        // 使用高质量提取结果
        result.preview.title = extracted.title;
        result.preview.description = extracted.description;
        result.preview.siteName = extracted.siteName;
        result.preview.author = extracted.author;
        result.preview.publishedAt = extracted.publishedDate;
        result.preview.favicon = extracted.favicon;
        result.preview.image = extracted.image;

        // 内容摘要（取前 2000 字作为摘要，完整内容用于 AI 上下文）
        const contentSummary =
          extracted.content.length > 2000
            ? extracted.content.slice(0, 2000) + "..."
            : extracted.content;

        result.extractedContent = {
          fullText: extracted.content, // 完整内容
          summary: contentSummary,
          metadata: {
            source: extracted.source,
            contentLength: extracted.contentLength,
            links: extracted.links,
          },
        };

        this.logger.log(
          `[${extracted.source}] Extracted ${extracted.contentLength} chars from ${url}`,
        );
        return;
      }

      // 回退到基本解析
      this.logger.warn(
        `Content extraction failed, falling back to basic parsing: ${extracted.error}`,
      );
      await this.parseWebpageFallback(url, result);
    } catch (error) {
      this.logger.warn(`parseWebpage error, using fallback: ${error}`);
      await this.parseWebpageFallback(url, result);
    }
  }

  /**
   * 原始网页解析方法（回退用）
   */
  private async parseWebpageFallback(
    url: string,
    result: ParsedUrl,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 秒超时

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": APP_CONFIG.brand.botUserAgent,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "";

      // 如果是 HTML，解析 OG 元数据
      if (contentType.includes("text/html")) {
        const html = await response.text();
        this.extractOgMetadata(html, result);
        this.extractMainContent(html, result);
      } else {
        // 非 HTML 内容
        result.preview.title = this.extractFilenameFromUrl(url);
      }

      // 提取 favicon
      result.preview.favicon = this.extractFaviconUrl(url);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * 解析图片 URL
   */
  private async parseImage(url: string, result: ParsedUrl): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      // 只获取头信息，不下载完整图片
      const response = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        headers: {
          "User-Agent": APP_CONFIG.brand.botUserAgent,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "";
      const contentLength = response.headers.get("content-length");

      result.preview.title = this.extractFilenameFromUrl(url);
      result.preview.image = url;
      result.extractedContent = {
        metadata: {
          mimeType: contentType,
          size: contentLength ? parseInt(contentLength) : undefined,
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * 解析视频 URL
   */
  private async parseVideo(
    url: string,
    result: ParsedUrl,
    platform?: string,
  ): Promise<void> {
    if (platform === "youtube") {
      await this.parseYouTube(url, result);
    } else if (platform === "bilibili") {
      await this.parseBilibili(url, result);
    } else {
      // 通用视频处理
      result.preview.title = this.extractFilenameFromUrl(url);
      result.preview.siteName = "Video";
    }
  }

  /**
   * 解析 YouTube 视频
   */
  private async parseYouTube(url: string, result: ParsedUrl): Promise<void> {
    // 提取视频 ID
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/i);
    const videoId = match?.[1];

    if (!videoId) {
      throw new Error("Invalid YouTube URL");
    }

    // 使用 oEmbed API 获取视频信息（不需要 API Key）
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

    try {
      const response = await fetch(oembedUrl, {
        headers: {
          "User-Agent": APP_CONFIG.brand.botUserAgent,
        },
      });

      if (response.ok) {
        const data = await response.json();
        result.preview.title = data.title;
        result.preview.author = data.author_name;
        result.preview.siteName = "YouTube";
        result.preview.image = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      } else {
        // oEmbed 失败时使用默认值
        result.preview.title = `YouTube Video (${videoId})`;
        result.preview.siteName = "YouTube";
        result.preview.image = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      }
    } catch {
      result.preview.title = `YouTube Video (${videoId})`;
      result.preview.siteName = "YouTube";
      result.preview.image = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    }

    result.extractedContent = {
      metadata: {
        videoId,
        platform: "youtube",
      },
    };
  }

  /**
   * 解析 Bilibili 视频
   */
  private async parseBilibili(url: string, result: ParsedUrl): Promise<void> {
    const match = url.match(/bilibili\.com\/video\/(BV[\w]+)/i);
    const bvid = match?.[1];

    if (!bvid) {
      throw new Error("Invalid Bilibili URL");
    }

    // 使用 Bilibili API 获取视频信息
    try {
      const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
      const response = await fetch(apiUrl, {
        headers: {
          "User-Agent": APP_CONFIG.brand.botUserAgent,
          Referer: "https://www.bilibili.com/",
        },
      });

      if (response.ok) {
        const json = await response.json();
        if (json.code === 0 && json.data) {
          const data = json.data;
          result.preview.title = data.title;
          result.preview.description = data.desc;
          result.preview.author = data.owner?.name;
          result.preview.image = data.pic;
          result.preview.siteName = "Bilibili";
          result.extractedContent = {
            metadata: {
              bvid,
              duration: data.duration,
              view: data.stat?.view,
              platform: "bilibili",
            },
          };
          return;
        }
      }
    } catch {
      // API 失败时使用默认值
    }

    result.preview.title = `Bilibili Video (${bvid})`;
    result.preview.siteName = "Bilibili";
    result.extractedContent = {
      metadata: {
        bvid,
        platform: "bilibili",
      },
    };
  }

  /**
   * 解析 GitHub 仓库
   */
  private async parseGitHub(url: string, result: ParsedUrl): Promise<void> {
    const match = url.match(/github\.com\/([\w-]+\/[\w-]+)/i);
    const repoPath = match?.[1];

    if (!repoPath) {
      throw new Error("Invalid GitHub URL");
    }

    try {
      const apiUrl = `https://api.github.com/repos/${repoPath}`;
      const response = await fetch(apiUrl, {
        headers: {
          "User-Agent": APP_CONFIG.brand.botUserAgent,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        result.preview.title = data.full_name;
        result.preview.description = data.description;
        result.preview.author = data.owner?.login;
        result.preview.image = data.owner?.avatar_url;
        result.preview.siteName = "GitHub";
        result.extractedContent = {
          metadata: {
            stars: data.stargazers_count,
            forks: data.forks_count,
            language: data.language,
            topics: data.topics,
            platform: "github",
          },
        };
        return;
      }
    } catch {
      // API 失败时使用默认值
    }

    result.preview.title = repoPath;
    result.preview.siteName = "GitHub";
    result.preview.favicon = "https://github.com/favicon.ico";
  }

  /**
   * 解析社交媒体
   */
  private async parseSocial(
    url: string,
    result: ParsedUrl,
    platform?: string,
  ): Promise<void> {
    // 社交媒体通常需要认证才能获取详细信息
    // 这里只做基本解析
    if (platform === "twitter") {
      result.preview.siteName = "X (Twitter)";
      result.preview.favicon = "https://abs.twimg.com/favicons/twitter.2.ico";

      // 尝试通过 oEmbed 获取信息
      try {
        const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`;
        const response = await fetch(oembedUrl);
        if (response.ok) {
          const data = await response.json();
          result.preview.author = data.author_name;
          result.extractedContent = {
            fullText: data.html ? this.stripHtml(data.html) : undefined,
          };
        }
      } catch {
        // oEmbed 失败
      }
    }

    // 回退到通用网页解析
    if (!result.preview.title) {
      await this.parseWebpage(url, result);
    }
  }

  /**
   * 从 HTML 中提取 OG 元数据
   */
  private extractOgMetadata(html: string, result: ParsedUrl): void {
    // 提取 og:title
    const titleMatch =
      html.match(
        /<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i,
      ) ||
      html.match(
        /<meta[^>]*content="([^"]*)"[^>]*property="og:title"[^>]*>/i,
      ) ||
      html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch) {
      result.preview.title = this.decodeHtmlEntities(titleMatch[1]);
    }

    // 提取 og:description
    const descMatch =
      html.match(
        /<meta[^>]*property="og:description"[^>]*content="([^"]*)"[^>]*>/i,
      ) ||
      html.match(
        /<meta[^>]*content="([^"]*)"[^>]*property="og:description"[^>]*>/i,
      ) ||
      html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i) ||
      html.match(/<meta[^>]*content="([^"]*)"[^>]*name="description"[^>]*>/i);
    if (descMatch) {
      result.preview.description = this.decodeHtmlEntities(descMatch[1]);
    }

    // 提取 og:image
    const imageMatch =
      html.match(
        /<meta[^>]*property="og:image"[^>]*content="([^"]*)"[^>]*>/i,
      ) ||
      html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:image"[^>]*>/i);
    if (imageMatch) {
      result.preview.image = imageMatch[1];
    }

    // 提取 og:site_name
    const siteNameMatch =
      html.match(
        /<meta[^>]*property="og:site_name"[^>]*content="([^"]*)"[^>]*>/i,
      ) ||
      html.match(
        /<meta[^>]*content="([^"]*)"[^>]*property="og:site_name"[^>]*>/i,
      );
    if (siteNameMatch) {
      result.preview.siteName = this.decodeHtmlEntities(siteNameMatch[1]);
    }

    // 提取 author
    const authorMatch =
      html.match(/<meta[^>]*name="author"[^>]*content="([^"]*)"[^>]*>/i) ||
      html.match(/<meta[^>]*content="([^"]*)"[^>]*name="author"[^>]*>/i);
    if (authorMatch) {
      result.preview.author = this.decodeHtmlEntities(authorMatch[1]);
    }
  }

  /**
   * 提取网页主要内容（简化版）
   */
  private extractMainContent(html: string, result: ParsedUrl): void {
    // 移除 script 和 style 标签
    const content = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");

    // 尝试找到主要内容区域
    const articleMatch = content.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    const mainMatch = content.match(/<main[^>]*>([\s\S]*?)<\/main>/i);

    const targetContent = articleMatch?.[1] || mainMatch?.[1] || content;

    // 移除 HTML 标签
    const text = this.stripHtml(targetContent);

    // 清理多余空白
    const cleanText = text.replace(/\s+/g, " ").trim().slice(0, 5000); // 限制长度

    if (cleanText.length > 100) {
      result.extractedContent = {
        summary:
          cleanText.slice(0, 500) + (cleanText.length > 500 ? "..." : ""),
      };
    }
  }

  /**
   * 移除 HTML 标签
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * 解码 HTML 实体
   */
  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&#39;": "'",
      "&apos;": "'",
      "&nbsp;": " ",
    };

    return text.replace(/&[^;]+;/g, (entity) => entities[entity] || entity);
  }

  /**
   * 从 URL 提取文件名
   */
  private extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split("/").pop() || "";
      return decodeURIComponent(filename) || urlObj.hostname;
    } catch {
      return url;
    }
  }

  /**
   * 提取 favicon URL
   */
  private extractFaviconUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.host}/favicon.ico`;
    } catch {
      return "";
    }
  }

  /**
   * 从缓存获取
   */
  private getFromCache(url: string): ParsedUrl | null {
    const cached = this.urlCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    if (cached) {
      this.urlCache.delete(url);
    }
    return null;
  }

  /**
   * 设置缓存
   */
  private setCache(url: string, data: ParsedUrl): void {
    this.urlCache.set(url, {
      data,
      expiresAt: Date.now() + this.CACHE_TTL,
    });

    // 清理过期缓存（简单策略：缓存超过 1000 条时清理）
    if (this.urlCache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of this.urlCache.entries()) {
        if (value.expiresAt < now) {
          this.urlCache.delete(key);
        }
      }
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.urlCache.clear();
  }

  /**
   * 为 AI 生成上下文增强文本
   */
  generateAiContextFromParsedUrls(parsedUrls: ParsedUrl[]): string {
    if (parsedUrls.length === 0) return "";

    const successfulUrls = parsedUrls.filter((u) => u.status === "success");
    if (successfulUrls.length === 0) return "";

    let context = "\n\n--- 链接内容解析 ---\n";

    for (const parsed of successfulUrls) {
      context += `\n[${this.getTypeLabel(parsed.type)}] ${parsed.url}\n`;

      if (parsed.preview.siteName) {
        context += `来源: ${parsed.preview.siteName}\n`;
      }
      if (parsed.preview.title) {
        context += `标题: ${parsed.preview.title}\n`;
      }
      if (parsed.preview.author) {
        context += `作者: ${parsed.preview.author}\n`;
      }
      if (parsed.preview.description) {
        context += `摘要: ${parsed.preview.description}\n`;
      }
      if (parsed.extractedContent?.summary) {
        context += `内容预览:\n${parsed.extractedContent.summary}\n`;
      }
      if (parsed.extractedContent?.metadata) {
        const meta = parsed.extractedContent.metadata;
        if (meta.stars !== undefined) {
          context += `GitHub Stars: ${meta.stars}, Forks: ${meta.forks}\n`;
        }
        if (meta.language) {
          context += `主要语言: ${meta.language}\n`;
        }
        if (meta.duration !== undefined) {
          context += `时长: ${this.formatDuration(meta.duration as number)}\n`;
        }
      }
      context += "\n";
    }

    context += "--- 解析结束 ---\n";

    return context;
  }

  /**
   * 获取类型标签
   */
  private getTypeLabel(type: ParsedUrlType): string {
    const labels: Record<ParsedUrlType, string> = {
      WEBPAGE: "网页",
      IMAGE: "图片",
      VIDEO: "视频",
      DOCUMENT: "文档",
      CODE_REPO: "代码仓库",
      SOCIAL: "社交媒体",
    };
    return labels[type] || type;
  }

  /**
   * 格式化时长（秒 -> mm:ss）
   */
  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }
}
