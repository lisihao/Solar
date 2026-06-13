/**
 * Content Fetch Service
 * AI Engine 核心能力 - 通用 URL 内容获取服务
 *
 * 提供：
 * - 普通 URL 内容提取（通过 WebContentExtractionService）
 * - YouTube 视频字幕提取（含数据库缓存）
 * - SSRF 防护（URL 安全验证）
 */

import {
  Injectable,
  Logger,
  InternalServerErrorException,
  ServiceUnavailableException,
  Optional,
  Inject,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { WebContentExtractionService } from "@/common/content-processing/web-content-extraction.service";
import {
  FetchedContent,
  sanitizeForDb,
  stripScrapedArtifacts,
} from "./content-fetch.types";
// SSRF 防护：项目唯一的统一出站闸门（字面校验 + DNS 解析复核）。
import { assertUrlSafe } from "../../safety/security/ssrf/ssrf-guard";

/**
 * YoutubeService injection token
 * 使用字符串 token 避免直接导入 ExploreModule（会引起循环依赖）
 */
export const YOUTUBE_SERVICE_TOKEN = "YOUTUBE_SERVICE";

interface YoutubeServiceLike {
  getTranscript(videoId: string): Promise<unknown>;
}

@Injectable()
export class ContentFetchService {
  private readonly logger = new Logger(ContentFetchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webExtractor: WebContentExtractionService,
    @Optional()
    @Inject(YOUTUBE_SERVICE_TOKEN)
    private readonly youtubeService?: YoutubeServiceLike,
  ) {}

  /**
   * 从外部 URL 获取内容
   * 支持：YouTube 视频（自动获取字幕）、普通网页（Jina/Firecrawl）
   *
   * 安全检查：
   * - SSRF 防护（阻止内网 IP、本地回环等）
   * - URL 格式和长度验证
   * - 协议限制（仅 HTTP/HTTPS）
   */
  async fetchFromUrl(url: string): Promise<FetchedContent> {
    // SSRF 防护：统一 SsrfGuard —— 字面校验 + DNS 解析后对所有 IP 复核（堵 rebinding）。
    await assertUrlSafe(url);

    this.logger.log(`Fetching content from URL: ${url}`);

    try {
      // 检测是否是 YouTube 视频（需要 YoutubeService 或 DB 缓存）
      const youtubeVideoId = this.extractYoutubeVideoId(url);
      if (youtubeVideoId) {
        try {
          return await this.fetchFromYoutubeUrl(youtubeVideoId, url);
        } catch (ytError) {
          this.logger.warn(
            `YouTube fetch failed for ${youtubeVideoId}, falling back to web extraction: ${ytError}`,
          );
          // 降级到普通网页提取
        }
      }

      // 使用 WebContentExtractionService 提取普通网页内容
      const extracted = await this.webExtractor.extractContent(url);

      if (extracted.error || !extracted.content) {
        throw new InternalServerErrorException(
          extracted.error || "无法提取内容",
        );
      }

      return {
        title: sanitizeForDb(extracted.title || "Untitled"),
        // strip scraped SSR-shell junk (RSC flight markers / <template> / leaked CSS)
        // before DB-safety sanitize, so it never reaches storage/readers
        content: sanitizeForDb(stripScrapedArtifacts(extracted.content)),
        coverImage: extracted.image,
        url,
        metadata: {
          source: extracted.source,
          siteName: extracted.siteName,
          author: extracted.author,
          publishedDate: extracted.publishedDate,
          fetchedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to fetch URL: ${url}`, err);
      throw new InternalServerErrorException(`无法获取URL内容: ${err.message}`);
    }
  }

  /**
   * 从 YouTube 视频获取字幕内容
   * 优先从数据库缓存获取，支持双语输出
   */
  async fetchFromYoutubeUrl(
    videoId: string,
    url: string,
  ): Promise<FetchedContent> {
    this.logger.log(`Fetching YouTube transcript for video: ${videoId}`);

    try {
      // 1. 先检查数据库缓存（和 AI Explore 一致的处理方式）
      const cached = await this.prisma.youTubeTranscriptCache.findUnique({
        where: { videoId },
      });

      if (cached && cached.expiresAt > new Date()) {
        this.logger.log(
          `[Cache Hit] Found cached transcript for ${videoId}, hasTranslation=${!!cached.translatedTranscript}`,
        );

        const originalSegments = cached.transcript as Array<{
          text: string;
          start: number;
          duration: number;
        }>;
        const translatedSegments = cached.translatedTranscript as Array<{
          text: string;
          translatedText?: string;
        }> | null;

        // 构建双语内容
        const originalContent = originalSegments.map((s) => s.text).join(" ");
        const translatedContent = translatedSegments
          ? translatedSegments.map((s) => s.translatedText || s.text).join(" ")
          : null;

        // 合并内容：如果有翻译，优先使用翻译版本作为主要内容
        const mainContent = translatedContent || originalContent;

        return {
          title: sanitizeForDb(cached.title || "YouTube Video"),
          content: sanitizeForDb(mainContent),
          originalContent: sanitizeForDb(originalContent),
          translatedContent: translatedContent
            ? sanitizeForDb(translatedContent)
            : undefined,
          isBilingual: !!translatedContent,
          url,
          metadata: {
            videoId,
            source: "youtube",
            hasTranslation: !!cached.translatedTranscript,
            targetLanguage: cached.targetLanguage || undefined,
            cachedAt: cached.createdAt?.toISOString(),
            fetchedAt: new Date().toISOString(),
          },
        };
      }

      // 2. 缓存不存在或已过期，使用 YoutubeService 获取（会自动缓存）
      if (!this.youtubeService) {
        throw new ServiceUnavailableException(
          "YoutubeService 未注入，无法获取视频字幕",
        );
      }
      this.logger.log(
        `[Cache Miss] Fetching transcript via YoutubeService for ${videoId}`,
      );
      const transcript = (await this.youtubeService.getTranscript(videoId)) as {
        title?: string;
        transcript: Array<{ text: string; translatedText?: string }>;
        hasTranslation?: boolean;
        targetLanguage?: string;
      } | null;

      if (!transcript?.transcript?.length) {
        throw new InternalServerErrorException("无法获取视频字幕");
      }

      // 构建内容
      const originalContent = transcript.transcript
        .map((seg: { text: string }) => seg.text)
        .join(" ");
      const translatedContent = transcript.hasTranslation
        ? transcript.transcript
            .map(
              (seg: { text: string; translatedText?: string }) =>
                seg.translatedText || seg.text,
            )
            .join(" ")
        : null;

      const mainContent = translatedContent || originalContent;

      return {
        title: sanitizeForDb(transcript.title || "YouTube Video"),
        content: sanitizeForDb(mainContent),
        originalContent: sanitizeForDb(originalContent),
        translatedContent: translatedContent
          ? sanitizeForDb(translatedContent)
          : undefined,
        isBilingual: !!translatedContent,
        url,
        metadata: {
          videoId,
          source: "youtube",
          hasTranslation: transcript.hasTranslation,
          targetLanguage: transcript.targetLanguage,
          fetchedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to fetch YouTube transcript: ${videoId}`, err);
      throw new InternalServerErrorException(
        `无法获取YouTube字幕: ${err.message}`,
      );
    }
  }

  /**
   * 提取 YouTube 视频 ID
   */
  extractYoutubeVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return null;
  }
}
