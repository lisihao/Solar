import { Injectable, Logger, Optional } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { YoutubeService } from "../../modules/ai-engine/content/fetch/youtube.service";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { MinerUService } from "./mineru.service";
import { AdvancedExtractorService } from "./advanced-extractor.service";
import { APP_CONFIG } from "../config/app.config";

/**
 * PDF 提取选项
 */
export interface PdfExtractionOptions {
  /** 使用 MinerU 深度解析（默认自动检测） */
  useMinerU?: boolean;
  /** 是否提取表格（仅 MinerU 支持） */
  extractTables?: boolean;
  /** 是否提取图片（仅 MinerU 支持） */
  extractImages?: boolean;
  /** 最大页数限制 */
  maxPages?: number;
}

/**
 * PDF 提取结果（增强版）
 */
export interface PdfExtractionResult {
  /** 提取的文本内容（Markdown 格式） */
  content: string;
  /** 使用的解析方法 */
  method: "mineru" | "pdfjs" | "simple";
  /** 元数据 */
  metadata: {
    pageCount: number;
    wordCount: number;
    hasImages: boolean;
    hasTables: boolean;
    hasFormulas: boolean;
  };
  /** 提取的图片（base64，仅 MinerU） */
  images?: Array<{ index: number; base64?: string; caption?: string }>;
  /** 提取的表格（HTML，仅 MinerU） */
  tables?: Array<{ index: number; html: string; caption?: string }>;
}

/**
 * 内容提取服务
 * 支持从多种来源提取文本内容：
 * - URL（网页、文章）
 * - 文件（PDF、Word、TXT、Markdown）
 * - 视频（YouTube、Bilibili 字幕）
 * - 图片（OCR 文字识别）
 *
 * PDF 解析支持两种模式：
 * - MinerU：深度解析（保留结构、表格、公式）- 推荐用于复杂文档
 * - pdfjs-dist：轻量级解析 - 用于简单文档或 MinerU 不可用时
 */
@Injectable()
export class ContentExtractorService {
  private readonly logger = new Logger(ContentExtractorService.name);
  private minerUAvailable: boolean | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly youtubeService: YoutubeService,
    private readonly advancedExtractor: AdvancedExtractorService,
    @Optional() private readonly minerUService?: MinerUService,
  ) {}

  /**
   * 从URL提取内容
   */
  async extractFromUrl(url: string): Promise<string> {
    this.logger.log(`Extracting content from URL: ${url}`);

    // 检测URL类型
    if (this.isYouTubeUrl(url)) {
      return this.extractYouTubeSubtitles(url);
    }

    if (this.isBilibiliUrl(url)) {
      return this.extractBilibiliSubtitles(url);
    }

    // 检查是否是 PDF URL
    if (url.toLowerCase().endsWith(".pdf")) {
      return this.extractPdfFromUrl(url);
    }

    // 普通网页内容提取
    return this.extractWebPageContent(url);
  }

  /**
   * 从文件内容提取文本
   */
  async extractFromFile(
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<string> {
    this.logger.log(`Extracting content from file: ${filename} (${mimeType})`);

    // 文本文件
    if (
      mimeType === "text/plain" ||
      mimeType === "text/markdown" ||
      filename.endsWith(".txt") ||
      filename.endsWith(".md")
    ) {
      return buffer.toString("utf-8");
    }

    // JSON 文件
    if (mimeType === "application/json" || filename.endsWith(".json")) {
      try {
        const json = JSON.parse(buffer.toString("utf-8"));
        return this.flattenJson(json);
      } catch {
        return buffer.toString("utf-8");
      }
    }

    // HTML 文件
    if (mimeType === "text/html" || filename.endsWith(".html")) {
      return await this.extractHtmlContent(buffer.toString("utf-8"), filename);
    }

    // PDF 文件 - 简单文本提取
    if (mimeType === "application/pdf" || filename.endsWith(".pdf")) {
      return this.extractPdfText(buffer);
    }

    // 字幕文件 (SRT, VTT)
    if (
      filename.endsWith(".srt") ||
      filename.endsWith(".vtt") ||
      mimeType === "text/vtt"
    ) {
      return this.extractSubtitleText(buffer.toString("utf-8"));
    }

    // 默认尝试作为文本处理
    try {
      return buffer.toString("utf-8");
    } catch {
      return `[Binary file: ${filename}]`;
    }
  }

  /**
   * 从 Base64 图片提取文字（使用 AI 模型进行 OCR）
   */
  async extractFromImage(base64Image: string, apiKey: string): Promise<string> {
    this.logger.log("Extracting text from image using AI model");

    try {
      // 使用 Gemini Vision API 进行图片理解
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

      const response = await firstValueFrom(
        this.httpService.post(
          url,
          {
            contents: [
              {
                parts: [
                  {
                    text: "Describe this image in detail. Extract any text visible in the image. Identify the main subjects, colors, mood, and style.",
                  },
                  {
                    inlineData: {
                      mimeType: "image/jpeg",
                      data: base64Image.replace(/^data:image\/\w+;base64,/, ""),
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              maxOutputTokens: 1000,
              temperature: 0.3, // Direct Gemini API call, not using AiChatService
            },
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: 30000,
          },
        ),
      );

      const candidates = response.data.candidates;
      if (candidates?.[0]?.content?.parts?.[0]?.text) {
        return candidates[0].content.parts[0].text;
      }

      return "[Unable to extract content from image]";
    } catch (error) {
      this.logger.error("Image content extraction failed:", error);
      return "[Image analysis failed]";
    }
  }

  // ============ 私有方法 ============

  /**
   * 检测是否为 YouTube URL
   */
  private isYouTubeUrl(url: string): boolean {
    return (
      url.includes("youtube.com") ||
      url.includes("youtu.be") ||
      url.includes("youtube-nocookie.com")
    );
  }

  /**
   * 检测是否为 Bilibili URL
   */
  private isBilibiliUrl(url: string): boolean {
    return url.includes("bilibili.com") || url.includes("b23.tv");
  }

  /**
   * 提取 YouTube 视频字幕
   * 复用 YoutubeService 的成熟实现（支持 youtubei.js 和 youtube-transcript）
   */
  private async extractYouTubeSubtitles(url: string): Promise<string> {
    try {
      // 使用 YoutubeService 提取视频 ID
      const videoId = this.youtubeService.extractVideoId(url);
      if (!videoId) {
        this.logger.warn(`Could not extract video ID from URL: ${url}`);
        return `[YouTube video: ${url}]`;
      }

      this.logger.log(
        `Extracting YouTube subtitles for video: ${videoId} using YoutubeService`,
      );

      // 调用 YoutubeService 获取字幕（它有完整的多层回退机制）
      const transcriptResponse = await this.youtubeService.getTranscript(
        videoId,
        "en",
      );

      // 将字幕段落合并为文本
      const subtitleText = transcriptResponse.transcript
        .map((segment) => segment.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      this.logger.log(
        `Successfully extracted ${subtitleText.length} chars of subtitles for "${transcriptResponse.title}"`,
      );

      return `[YouTube Video]\nTitle: ${transcriptResponse.title}\n\n[Subtitles]\n${subtitleText}`;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to extract YouTube subtitles via YoutubeService: ${errorMessage}`,
      );

      // 回退：尝试获取视频基本信息
      try {
        const videoId = this.extractYouTubeVideoId(url);
        if (videoId) {
          const infoUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
          const infoResponse = await firstValueFrom(
            this.httpService.get(infoUrl, { timeout: 10000 }),
          );
          if (infoResponse.data) {
            return `[YouTube Video]\nTitle: ${infoResponse.data.title || "Unknown"}\nAuthor: ${infoResponse.data.author_name || "Unknown"}\nURL: ${url}\n\nNote: Could not extract subtitles. Please generate an image based on the video title.`;
          }
        }
      } catch {
        // 忽略回退错误
      }

      return `[YouTube video: ${url}]`;
    }
  }

  /**
   * 提取 YouTube 视频 ID（作为回退使用）
   */
  private extractYouTubeVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    return null;
  }

  /**
   * 提取 Bilibili 视频字幕
   */
  private async extractBilibiliSubtitles(url: string): Promise<string> {
    try {
      // 提取视频 BV 号
      const bvMatch = url.match(/BV[a-zA-Z0-9]+/);
      const bvId = bvMatch ? bvMatch[0] : null;

      if (!bvId) {
        return `[Bilibili video: ${url}]`;
      }

      // 获取视频信息
      const infoUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvId}`;
      const infoResponse = await firstValueFrom(
        this.httpService.get(infoUrl, {
          timeout: 10000,
          headers: {
            "User-Agent": APP_CONFIG.brand.botUserAgent,
            Referer: "https://www.bilibili.com/",
          },
        }),
      );

      if (infoResponse.data?.data) {
        const videoInfo = infoResponse.data.data;
        let content = `[Bilibili Video]\nTitle: ${videoInfo.title}\nDescription: ${videoInfo.desc || "N/A"}\nAuthor: ${videoInfo.owner?.name || "N/A"}`;

        // 尝试获取字幕
        if (videoInfo.subtitle?.list?.length > 0) {
          const subtitleUrl = videoInfo.subtitle.list[0].subtitle_url;
          if (subtitleUrl) {
            try {
              const subtitleResponse = await firstValueFrom(
                this.httpService.get(
                  subtitleUrl.startsWith("//")
                    ? `https:${subtitleUrl}`
                    : subtitleUrl,
                  { timeout: 10000 },
                ),
              );

              if (subtitleResponse.data?.body) {
                const subtitleText = (
                  subtitleResponse.data.body as Array<{ content: string }>
                )
                  .map((item) => item.content)
                  .join(" ");
                content += `\n\nSubtitles:\n${subtitleText}`;
              }
            } catch {
              // 字幕获取失败
            }
          }
        }

        return content;
      }

      return `[Bilibili video: ${url}]`;
    } catch (error) {
      this.logger.warn(`Failed to extract Bilibili content: ${url}`, error);
      return `[Bilibili video: ${url}]`;
    }
  }

  /**
   * 提取网页内容（使用 Readability）
   */
  private async extractWebPageContent(url: string): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
          timeout: 15000,
          maxRedirects: 5,
          responseType: "arraybuffer",
        }),
      );

      const contentType = String(response.headers["content-type"] ?? "");

      // Handle PDF content
      if (contentType.toLowerCase().includes("application/pdf")) {
        this.logger.log(`Detected PDF content from URL: ${url}`);
        return this.extractPdfText(Buffer.from(response.data));
      }

      // Handle HTML content
      const html = Buffer.from(response.data).toString("utf-8");
      return await this.extractHtmlContent(html, url);
    } catch (error) {
      this.logger.warn(`Failed to fetch URL content: ${url}`, error);
      return `[Unable to fetch content from: ${url}]`;
    }
  }

  /**
   * 从 HTML 内容中提取正文
   * 委托给 AdvancedExtractorService（4 层容错：Readability → DOM → Regex → Fallback）
   */
  private async extractHtmlContent(
    html: string,
    sourceUrl: string,
  ): Promise<string> {
    try {
      const result = await this.advancedExtractor.extract(html, sourceUrl);
      if (result.success && result.textContent) {
        let text = "";
        if (result.title) text += `Title: ${result.title}\n`;
        if (result.byline) text += `Author: ${result.byline}\n`;
        if (result.siteName) text += `Site: ${result.siteName}\n`;
        text += `\nContent:\n${result.textContent}`;
        return text.slice(0, 15000);
      }
      return this.stripHtmlTags(html).slice(0, 10000);
    } catch (error) {
      this.logger.error(`Failed to parse HTML from ${sourceUrl}:`, error);
      return this.stripHtmlTags(html).slice(0, 5000);
    }
  }

  /**
   * 从 URL 下载并提取 PDF 内容
   */
  private async extractPdfFromUrl(url: string): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          responseType: "arraybuffer",
          timeout: 30000,
        }),
      );

      return this.extractPdfText(Buffer.from(response.data));
    } catch (error) {
      this.logger.error(`Failed to download PDF from ${url}:`, error);
      return `[Failed to download PDF from: ${url}]`;
    }
  }

  /**
   * 移除 HTML 标签
   */
  private stripHtmlTags(html: string): string {
    return (
      html
        // 移除 script 和 style
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
        // 移除注释
        .replace(/<!--[\s\S]*?-->/g, "")
        // 移除所有标签
        .replace(/<[^>]+>/g, " ")
        // 解码 HTML 实体
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        // 清理多余空白
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  /**
   * 提取 PDF 文本（使用 pdfjs-dist）
   * 这是内部简单方法，用于兼容现有调用
   */
  private async extractPdfText(buffer: Buffer): Promise<string> {
    // 尝试使用增强版提取
    const result = await this.extractPdfEnhanced(buffer);
    return result.content;
  }

  /**
   * 增强版 PDF 提取
   * 优先使用 MinerU（如果可用），否则回退到 pdfjs-dist
   */
  async extractPdfEnhanced(
    buffer: Buffer,
    options: PdfExtractionOptions = {},
  ): Promise<PdfExtractionResult> {
    const useMinerU = options.useMinerU ?? true;

    // 如果明确要求使用 MinerU 或者自动模式
    if (useMinerU && this.minerUService) {
      const isAvailable = await this.checkMinerUAvailability();

      if (isAvailable) {
        this.logger.log("[extractPdfEnhanced] Using MinerU for deep parsing");

        try {
          const minerUResult = await this.minerUService.parsePdf(buffer, {
            maxPages: options.maxPages,
          });

          if (minerUResult.success) {
            return {
              content: minerUResult.content,
              method: "mineru",
              metadata: {
                pageCount: minerUResult.metadata.pageCount,
                wordCount: minerUResult.metadata.wordCount,
                hasImages: minerUResult.metadata.hasImages,
                hasTables: minerUResult.metadata.hasTables,
                hasFormulas: minerUResult.metadata.hasFormulas,
              },
              images: minerUResult.images?.map((img) => ({
                index: img.index,
                base64: img.base64,
                caption: img.caption,
              })),
              tables: minerUResult.tables?.map((tbl) => ({
                index: tbl.index,
                html: tbl.html,
                caption: tbl.caption,
              })),
            };
          }

          this.logger.warn(
            `[extractPdfEnhanced] MinerU parsing failed: ${minerUResult.error}`,
          );
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `[extractPdfEnhanced] MinerU error: ${errorMessage}`,
          );
        }
      }
    }

    // 回退到 pdfjs-dist
    this.logger.log("[extractPdfEnhanced] Using pdfjs-dist for parsing");
    return this.extractPdfWithPdfjs(buffer, options.maxPages);
  }

  /**
   * 检查 MinerU 是否可用（带缓存）
   */
  private async checkMinerUAvailability(): Promise<boolean> {
    if (this.minerUAvailable !== null) {
      return this.minerUAvailable;
    }

    if (!this.minerUService) {
      this.minerUAvailable = false;
      return false;
    }

    try {
      const result = await this.minerUService.checkAvailability();
      this.minerUAvailable = result.available;
      this.logger.log(
        `[checkMinerUAvailability] MinerU status: ${result.message}`,
      );
      return result.available;
    } catch {
      this.minerUAvailable = false;
      return false;
    }
  }

  /**
   * 使用 pdfjs-dist 提取 PDF
   */
  private async extractPdfWithPdfjs(
    buffer: Buffer,
    maxPagesLimit?: number,
  ): Promise<PdfExtractionResult> {
    try {
      const uint8Array = new Uint8Array(buffer);

      const loadingTask = pdfjsLib.getDocument({
        data: uint8Array,
        useSystemFonts: true,
        disableFontFace: true,
      });

      const pdfDocument = await loadingTask.promise;
      const numPages = pdfDocument.numPages;
      const maxPages = Math.min(numPages, maxPagesLimit || 20);

      let fullText = `[PDF Document - ${numPages} pages]\n\n`;
      let wordCount = 0;

      for (let i = 1; i <= maxPages; i++) {
        const page = await pdfDocument.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item) => (item as { str?: string }).str)
          .join(" ");

        fullText += `--- Page ${i} ---\n${pageText}\n\n`;
        wordCount += this.countWords(pageText);
      }

      if (numPages > maxPages) {
        fullText += `\n... (Remaining ${numPages - maxPages} pages omitted)`;
      }

      return {
        content: fullText,
        method: "pdfjs",
        metadata: {
          pageCount: numPages,
          wordCount,
          hasImages: false, // pdfjs 不提取图片
          hasTables: false, // pdfjs 不识别表格
          hasFormulas: false, // pdfjs 不识别公式
        },
      };
    } catch (error) {
      this.logger.error("Failed to extract PDF with pdfjs-dist:", error);
      return this.extractPdfSimpleFallback(buffer);
    }
  }

  /**
   * 简单 PDF 提取（最终回退）
   */
  private extractPdfSimpleFallback(buffer: Buffer): PdfExtractionResult {
    try {
      const content = buffer.toString("binary");
      const textMatches: string[] = [];

      const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g;
      let match;

      while ((match = streamRegex.exec(content)) !== null) {
        const stream = match[1];
        const text = stream
          .replace(/[^\x20-\x7E\n\r]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (text.length > 10) {
          textMatches.push(text);
        }
      }

      const extractedText =
        textMatches.length > 0
          ? `[PDF Content (Simple Extraction)]\n${textMatches.join("\n").slice(0, 5000)}`
          : "[PDF file - text extraction failed]";

      return {
        content: extractedText,
        method: "simple",
        metadata: {
          pageCount: 0,
          wordCount: this.countWords(extractedText),
          hasImages: false,
          hasTables: false,
          hasFormulas: false,
        },
      };
    } catch {
      return {
        content: "[PDF file - unable to extract text]",
        method: "simple",
        metadata: {
          pageCount: 0,
          wordCount: 0,
          hasImages: false,
          hasTables: false,
          hasFormulas: false,
        },
      };
    }
  }

  /**
   * 计算字数（中英文混合）
   */
  private countWords(text: string): number {
    if (!text) return 0;

    const chineseMatch = text.match(/[\u4e00-\u9fa5]/g);
    const chineseCount = chineseMatch ? chineseMatch.length : 0;

    const englishWords = text
      .replace(/[\u4e00-\u9fa5]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const englishCount = englishWords.length;

    return chineseCount + englishCount;
  }

  /**
   * 提取字幕文件文本
   */
  private extractSubtitleText(content: string): string {
    // 移除 SRT/VTT 时间戳和序号
    return content
      .replace(/^\d+\s*$/gm, "") // 序号
      .replace(
        /\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/g,
        "",
      ) // 时间戳
      .replace(/WEBVTT/g, "")
      .replace(/<[^>]+>/g, "") // HTML 标签
      .replace(/\{[^}]+\}/g, "") // 样式标签
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * 扁平化 JSON 对象为文本
   */
  private flattenJson(obj: unknown, prefix = ""): string {
    const result: string[] = [];

    if (typeof obj === "string") {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj
        .map((item, i) => this.flattenJson(item, `${prefix}[${i}]`))
        .join("\n");
    }

    if (typeof obj === "object" && obj !== null) {
      const record = obj as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        const value = record[key];
        const newPrefix = prefix ? `${prefix}.${key}` : key;

        if (typeof value === "object") {
          result.push(this.flattenJson(value, newPrefix));
        } else {
          result.push(`${newPrefix}: ${value}`);
        }
      }
    }

    return result.join("\n");
  }
}
