import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import axios from "axios";
import * as cheerio from "cheerio";
import { URL } from "url";
import * as crypto from "crypto";

/**
 * ParsedUrlMetadata Interface
 * 从网页中提取的完整元数据
 */
export interface ParsedUrlMetadata {
  url: string;
  domain: string;
  title: string;
  description?: string;
  imageUrl?: string;
  authors?: string[];
  publishedDate?: Date;
  language: string;
  contentType: string;
  siteName?: string;
  canonicalUrl?: string;
  favicon?: string;
  wordCount?: number;
  contentHash?: string;
  pdfUrl?: string; // 论文PDF URL或PDF链接
}

export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
  warnings?: string[];
}

@Injectable()
export class MetadataExtractorService {
  private readonly logger = new Logger(MetadataExtractorService.name);
  private readonly REQUEST_TIMEOUT = 30000; // 30秒超时（大文件需要更长时间）
  private readonly MAX_CONTENT_LENGTH = 50 * 1024 * 1024; // 50MB最大内容大小（支持大型PDF报告）

  // 更真实的浏览器 Headers，减少被识别为机器人的概率
  private readonly browserHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "max-age=0",
    Connection: "keep-alive",
    "Sec-Ch-Ua":
      '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };

  constructor() {}

  /**
   * 从URL提取完整的元数据
   */
  async extractMetadata(url: string): Promise<ParsedUrlMetadata> {
    try {
      // 验证URL格式
      const urlObj = new URL(url);
      const domain = urlObj.hostname || "";

      // YouTube特殊处理
      if (this.isYouTubeUrl(url)) {
        return await this.extractYouTubeMetadata(url);
      }

      // 先用 HEAD 请求检查文件类型和大小（不下载内容）
      const headInfo = await this.fetchHeadInfo(url);

      // PDF 和其他二进制文件：只从 URL 提取元数据，不下载内容
      if (this.isBinaryFile(headInfo.contentType, url)) {
        this.logger.log(
          `Binary file detected (${headInfo.contentType}), extracting metadata from URL only`,
        );
        return this.extractMetadataFromUrl(url, domain, headInfo);
      }

      // HTML 页面：下载内容提取元数据
      const html = await this.fetchPageContent(url);
      const metadata = this.parseHtmlMetadata(html, url);
      const contentHash = this.calculateContentHash(html);

      return {
        ...metadata,
        domain,
        url,
        contentHash,
      };
    } catch (error) {
      this.logger.error(`Failed to extract metadata from ${url}:`, error);
      throw new BadRequestException(
        `无法解析URL: ${this.getErrorMessage(error)}`,
      );
    }
  }

  /**
   * 使用 HEAD 请求获取文件信息（不下载内容）
   */
  private async fetchHeadInfo(
    url: string,
  ): Promise<{ contentType: string; contentLength: number | null }> {
    try {
      const response = await axios.head(url, {
        timeout: 10000,
        headers: this.browserHeaders,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      const rawContentLength = response.headers["content-length"];
      return {
        contentType: String(response.headers["content-type"] ?? ""),
        contentLength: rawContentLength
          ? parseInt(String(rawContentLength), 10)
          : null,
      };
    } catch {
      // HEAD 请求失败时返回默认值，让后续逻辑继续
      return { contentType: "", contentLength: null };
    }
  }

  /**
   * 检查是否为二进制文件（PDF、图片等）
   */
  private isBinaryFile(contentType: string, url: string): boolean {
    const binaryTypes = [
      "application/pdf",
      "application/octet-stream",
      "application/zip",
      "application/x-pdf",
      "image/",
      "audio/",
      "video/",
    ];

    const binaryExtensions = [
      ".pdf",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",
      ".zip",
      ".rar",
    ];

    // 检查 Content-Type
    if (binaryTypes.some((type) => contentType.toLowerCase().includes(type))) {
      return true;
    }

    // 检查 URL 扩展名
    const urlLower = url.toLowerCase();
    if (binaryExtensions.some((ext) => urlLower.endsWith(ext))) {
      return true;
    }

    return false;
  }

  /**
   * 从 URL 提取元数据（不下载内容，用于 PDF 等二进制文件）
   */
  private extractMetadataFromUrl(
    url: string,
    domain: string,
    headInfo: { contentType: string; contentLength: number | null },
  ): ParsedUrlMetadata {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // 从 URL 路径提取文件名
    const filename = decodeURIComponent(pathname.split("/").pop() || "");

    // 清理文件名作为标题（移除扩展名和特殊字符）
    let title = filename
      .replace(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i, "")
      .replace(/[-_]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // 垃圾标题检测：如果提取出的标题是无意义的通用词（如 "pdf"、"download"、"file"），
    // 尝试从 query 参数中提取更有意义的标识符作为标题
    const junkTitles = [
      "pdf",
      "download",
      "file",
      "document",
      "view",
      "get",
      "fetch",
    ];
    if (!title || junkTitles.includes(title.toLowerCase())) {
      // 尝试从 query 参数提取标识符（如 openreview.net/pdf?id=xxx）
      const idParam =
        urlObj.searchParams.get("id") ||
        urlObj.searchParams.get("paperId") ||
        urlObj.searchParams.get("doi");
      if (idParam) {
        title = `${domain.replace("www.", "")} - ${idParam}`;
      } else {
        title = `${domain.replace("www.", "")} - ${pathname.replace(/\//g, "")}`;
      }
    }

    // 生成描述
    const fileSize = headInfo.contentLength
      ? this.formatFileSize(headInfo.contentLength)
      : "未知大小";
    const fileType = this.getFileTypeFromUrl(url);
    const description = `${fileType}文件 (${fileSize}) - 来源: ${domain}`;

    // 使用 URL 作为内容 hash（因为不下载内容）
    const contentHash = this.calculateContentHash(url);

    // 检测 PDF URL：除了 .pdf 结尾，还检查路径是否为 /pdf（如 openreview.net/pdf?id=xxx）
    const isPdfEndpoint =
      url.toLowerCase().endsWith(".pdf") ||
      pathname === "/pdf" ||
      pathname.endsWith("/pdf");

    return {
      title: title || filename || "未知文件",
      description,
      domain,
      url,
      contentHash,
      siteName: domain,
      language: "unknown",
      contentType: headInfo.contentType || this.getContentTypeFromUrl(url),
      pdfUrl: isPdfEndpoint ? url : undefined,
    };
  }

  /**
   * 格式化文件大小
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  /**
   * 从 URL 获取文件类型描述
   */
  private getFileTypeFromUrl(url: string): string {
    const urlLower = url.toLowerCase();
    if (urlLower.endsWith(".pdf")) return "PDF";
    if (urlLower.endsWith(".doc") || urlLower.endsWith(".docx")) return "Word";
    if (urlLower.endsWith(".xls") || urlLower.endsWith(".xlsx")) return "Excel";
    if (urlLower.endsWith(".ppt") || urlLower.endsWith(".pptx"))
      return "PowerPoint";
    return "文档";
  }

  /**
   * 从 URL 获取 Content-Type
   */
  private getContentTypeFromUrl(url: string): string {
    const urlLower = url.toLowerCase();
    if (urlLower.endsWith(".pdf")) return "application/pdf";
    if (urlLower.endsWith(".doc")) return "application/msword";
    if (urlLower.endsWith(".docx"))
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (urlLower.endsWith(".xls")) return "application/vnd.ms-excel";
    if (urlLower.endsWith(".xlsx"))
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (urlLower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
    if (urlLower.endsWith(".pptx"))
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    return "application/octet-stream";
  }

  /**
   * 获取页面内容
   */
  private async fetchPageContent(url: string): Promise<string> {
    try {
      const response = await axios.get(url, {
        timeout: this.REQUEST_TIMEOUT,
        maxContentLength: this.MAX_CONTENT_LENGTH,
        headers: this.browserHeaders,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === "ECONNABORTED") {
          throw new BadRequestException("URL连接超时");
        }
        if (error.response?.status === 404) {
          throw new BadRequestException("URL页面不存在（404）");
        }
        if (error.response?.status === 403) {
          throw new BadRequestException(
            "URL访问被拒绝（403）- 请手动填写标题和描述",
          );
        }
      }
      throw error;
    }
  }

  /**
   * 解析HTML元数据
   */
  private parseHtmlMetadata(
    html: string,
    url: string,
  ): Omit<ParsedUrlMetadata, "url" | "domain" | "contentHash"> {
    const $ = cheerio.load(html);

    // 提取标题 - 优先级：og:title > twitter:title > <title>
    const title =
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content") ||
      $("title").text() ||
      this.extractTitleFromUrl(url);

    // 提取描述 - 优先级：og:description > twitter:description > meta description
    const description =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="twitter:description"]').attr("content") ||
      $('meta[name="description"]').attr("content");

    // 提取图片
    const imageUrl =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      $('link[rel="shortcut icon"]').attr("href");

    // 提取发布日期
    const publishedDate = this.extractPublishedDate($);

    // 提取作者
    const authors = this.extractAuthors($);

    // 提取网站名称
    const siteName =
      $('meta[property="og:site_name"]').attr("content") ||
      $('meta[property="site_name"]').attr("content");

    // 提取规范URL
    const canonicalUrl = $('link[rel="canonical"]').attr("href");

    // 提取favicon
    const favicon = this.extractFavicon($, url);

    // 提取文字内容用于统计字数
    const textContent = $("body").text().trim();
    const wordCount = textContent.split(/\s+/).length;

    // 检测语言
    const language = $("html").attr("lang")?.toLowerCase() || "en";

    return {
      title: this.cleanText(title),
      description: description ? this.cleanText(description) : undefined,
      imageUrl,
      authors,
      publishedDate,
      language,
      contentType: "html",
      siteName,
      canonicalUrl,
      favicon,
      wordCount: wordCount > 100 ? wordCount : undefined,
    };
  }

  /**
   * 从URL中提取标题
   * 例如：https://arxiv.org/abs/2024.12345 -> 2024.12345
   */
  private extractTitleFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split("/").filter((p) => p);
      if (pathParts.length > 0) {
        return pathParts[pathParts.length - 1]
          .replace(/[-_]/g, " ")
          .replace(/[^a-zA-Z0-9\s]/g, "")
          .trim();
      }
      return urlObj.hostname || "";
    } catch {
      return "";
    }
  }

  /**
   * 提取发布日期
   */
  private extractPublishedDate($: cheerio.CheerioAPI): Date | undefined {
    const dateStr =
      $('meta[property="article:published_time"]').attr("content") ||
      $('meta[property="publish_date"]').attr("content") ||
      $('meta[name="publish_date"]').attr("content") ||
      $('meta[property="date"]').attr("content");

    if (dateStr) {
      try {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date;
        }
      } catch {}
    }
    return undefined;
  }

  /**
   * 提取作者
   */
  private extractAuthors($: cheerio.CheerioAPI): string[] | undefined {
    const authors = new Set<string>();

    // 从meta标签提取
    $('meta[property="article:author"]').each((_, el) => {
      const author = $(el).attr("content");
      if (author) authors.add(author);
    });

    $('meta[name="author"]').each((_, el) => {
      const author = $(el).attr("content");
      if (author) authors.add(author);
    });

    // 从JSON-LD提取
    try {
      const jsonLd = $('script[type="application/ld+json"]').html();
      if (jsonLd) {
        const parsed = JSON.parse(jsonLd);
        if (parsed.author) {
          if (Array.isArray(parsed.author)) {
            parsed.author.forEach((a: unknown) => {
              if (typeof a === "string") authors.add(a);
              else if (
                a &&
                typeof a === "object" &&
                "name" in a &&
                typeof (a as Record<string, unknown>).name === "string"
              )
                authors.add((a as Record<string, unknown>).name as string);
            });
          } else if (typeof parsed.author === "string") {
            authors.add(parsed.author);
          } else if (parsed.author.name) {
            authors.add(parsed.author.name);
          }
        }
      }
    } catch {}

    return authors.size > 0 ? Array.from(authors) : undefined;
  }

  /**
   * 提取favicon
   */
  private extractFavicon(
    $: cheerio.CheerioAPI,
    url: string,
  ): string | undefined {
    let favicon =
      $('link[rel="icon"]').attr("href") ||
      $('link[rel="shortcut icon"]').attr("href") ||
      $('link[rel="apple-touch-icon"]').attr("href");

    if (favicon) {
      // 如果是相对URL，转换为绝对URL
      try {
        const baseUrl = new URL(url);
        favicon = new URL(favicon, baseUrl.origin).toString();
      } catch {}
    }

    return favicon;
  }

  /**
   * 清理文本内容
   */
  private cleanText(text: string): string {
    return text.trim().replace(/\s+/g, " ").substring(0, 500); // 限制长度
  }

  /**
   * 计算内容hash用于重复检测
   */
  private calculateContentHash(html: string): string {
    const $ = cheerio.load(html);
    // 提取主要内容文本，排除脚本和样式
    $("script").remove();
    $("style").remove();
    const mainText = $("body").text().trim().toLowerCase();

    return crypto.createHash("sha256").update(mainText).digest("hex");
  }

  /**
   * 验证提取的元数据
   */
  validateMetadata(metadata: ParsedUrlMetadata): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 检查必填字段
    if (!metadata.title || metadata.title.length < 3) {
      errors.push("标题过短或为空");
    }

    if (!metadata.domain) {
      errors.push("无法提取域名");
    }

    if (!metadata.url) {
      errors.push("URL为空");
    }

    // 检查可选字段
    if (!metadata.description) {
      warnings.push("缺少页面描述");
    }

    if (!metadata.authors || metadata.authors.length === 0) {
      warnings.push("缺少作者信息");
    }

    if (!metadata.publishedDate) {
      warnings.push("缺少发布日期");
    }

    return {
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * 获取用户友好的错误消息
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      if (typeof response === "string") {
        return response;
      }
      if (typeof response === "object" && response !== null) {
        return (
          ((response as Record<string, unknown>).message as string) ||
          JSON.stringify(response)
        );
      }
      return "请求错误";
    }
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 404) return "页面不存在（404）";
      if (error.response?.status === 403) return "访问被拒绝（403）";
      if (error.response?.status === 500) return "服务器错误（500）";
      if (error.code === "ECONNABORTED") return "连接超时";
      if (error.code === "ENOTFOUND") return "DNS解析失败";
    }
    const err = error as { message?: string } | null | undefined;
    if (err?.message?.includes("Invalid URL")) return "URL格式无效";
    return err?.message || "未知错误";
  }

  /**
   * 检查是否为YouTube URL
   */
  private isYouTubeUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname || "";
      return hostname.includes("youtube.com") || hostname.includes("youtu.be");
    } catch {
      return false;
    }
  }

  /**
   * 提取YouTube视频ID
   */
  private extractYouTubeVideoId(url: string): string | null {
    try {
      const urlObj = new URL(url);

      // youtube.com/watch?v=xxxxx
      if (urlObj.hostname?.includes("youtube.com")) {
        const videoId = urlObj.searchParams.get("v");
        return videoId;
      }

      // youtu.be/xxxxx
      if (urlObj.hostname?.includes("youtu.be")) {
        const videoId = urlObj.pathname.substring(1);
        return videoId || null;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * YouTube元数据提取
   * 使用noembed API获取YouTube视频元数据（无需API密钥）
   */
  private async extractYouTubeMetadata(
    url: string,
  ): Promise<ParsedUrlMetadata> {
    try {
      const videoId = this.extractYouTubeVideoId(url);

      if (!videoId) {
        throw new Error("无法提取YouTube视频ID");
      }

      // 使用noembed API（免费，无需密钥）
      const response = await axios.get(
        `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
        {
          timeout: this.REQUEST_TIMEOUT,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
        },
      );

      const embedData = response.data;

      return {
        url,
        domain: "youtube.com",
        title: embedData.title || `YouTube Video - ${videoId}`,
        description:
          embedData.description ||
          `Enjoy this YouTube video. Video ID: ${videoId}`,
        imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        language: "en",
        contentType: "video",
        siteName: "YouTube",
        authors: embedData.author_name ? [embedData.author_name] : undefined,
        contentHash: crypto
          .createHash("sha256")
          .update(`youtube:${videoId}`)
          .digest("hex"),
      };
    } catch (error) {
      this.logger.error(
        `Failed to extract YouTube metadata from ${url}:`,
        error,
      );

      // Fallback: 使用正则表达式从HTML提取信息
      try {
        return await this.extractYouTubeMetadataFallback(url);
      } catch (fallbackError) {
        throw new BadRequestException(
          `无法提取YouTube视频元数据: ${this.getErrorMessage(fallbackError)}`,
        );
      }
    }
  }

  /**
   * YouTube元数据提取（备选方案）
   * 当noembed API失败时，尝试从HTML中提取og:tags
   */
  private async extractYouTubeMetadataFallback(
    url: string,
  ): Promise<ParsedUrlMetadata> {
    const videoId = this.extractYouTubeVideoId(url);

    if (!videoId) {
      throw new Error("无法提取YouTube视频ID");
    }

    try {
      const html = await this.fetchPageContent(url);
      const $ = cheerio.load(html);

      // 尝试从og:tags提取
      const title =
        $('meta[property="og:title"]').attr("content") ||
        $("title").text() ||
        `YouTube Video - ${videoId}`;

      const description =
        $('meta[property="og:description"]').attr("content") ||
        `Enjoy this YouTube video. Video ID: ${videoId}`;

      const imageUrl =
        $('meta[property="og:image"]').attr("content") ||
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      // 从script标签提取作者信息
      let author: string | undefined;
      try {
        const jsonLd = $('script[type="application/ld+json"]').html();
        if (jsonLd) {
          const parsed = JSON.parse(jsonLd);
          if (parsed.itemListElement && Array.isArray(parsed.itemListElement)) {
            const uploadedBy = parsed.itemListElement.find(
              (item: unknown) =>
                (item as Record<string, unknown>)["@type"] === "VideoObject",
            ) as Record<string, unknown> | undefined;
            if (uploadedBy?.uploadDate) {
              author = (uploadedBy.name as string | undefined) || undefined;
            }
          }
        }
      } catch {}

      return {
        url,
        domain: "youtube.com",
        title: this.cleanText(title),
        description: this.cleanText(description),
        imageUrl,
        language: "en",
        contentType: "video",
        siteName: "YouTube",
        authors: author ? [author] : undefined,
        contentHash: crypto
          .createHash("sha256")
          .update(`youtube:${videoId}`)
          .digest("hex"),
      };
    } catch (error) {
      throw error;
    }
  }
}
