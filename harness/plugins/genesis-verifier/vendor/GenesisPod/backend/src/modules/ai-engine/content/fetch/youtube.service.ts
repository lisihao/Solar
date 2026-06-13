import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SystemSettingService } from "@/common/settings/system-setting.service";
import {
  ToolKeyResolverService,
  NoToolKeyError,
} from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";
import { RequestContext } from "@/common/context/request-context";
import { Prisma } from "@prisma/client";

type YoutubeModule = typeof import("youtubei.js");
type YoutubeClient = Awaited<ReturnType<YoutubeModule["Innertube"]["create"]>>;

export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
  translatedText?: string; // 翻译后的文本（可选）
}

export interface TranscriptResponse {
  videoId: string;
  title: string;
  transcript: TranscriptSegment[]; // 始终返回原始字幕（完整片段数组）
  translatedTranscript?: TranscriptSegment[]; // 已保存的翻译（可能稀疏，仅供 bilingual 通道使用）
  targetLanguage?: string; // 翻译目标语言（如果有翻译）
  hasTranslation?: boolean; // 是否已有翻译
}

// Supadata API response types
interface SupadataTranscriptChunk {
  text: string;
  offset: number;
  duration: number;
}

interface SupadataResponse {
  content: SupadataTranscriptChunk[] | string;
  lang: string;
  availableLangs: string[];
}

// Cache duration: 1 year (YouTube subtitles rarely change)
const CACHE_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);
  private youtube: YoutubeClient | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemSettingService: SystemSettingService,
    private readonly toolKeyResolver: ToolKeyResolverService,
  ) {}

  async onModuleInit() {
    try {
      await this.ensureClient();
      this.logger.log("YouTube client initialized successfully");

      // Check Supadata API key from database
      const supadataKey = await this.getSupadataApiKey();
      if (supadataKey) {
        this.logger.log(
          "Supadata API enabled as primary transcript provider (from database settings)",
        );
      } else {
        this.logger.warn(
          "Supadata API key not configured - using fallback transcript methods only. Configure in Settings > External API > YouTube",
        );
      }
    } catch (error) {
      this.logger.error("Failed to initialize YouTube client:", error);
    }
  }

  /**
   * Get Supadata API key.
   *
   * 2026-05-28 BYOK: when a userId is in the request context, resolve via
   * ToolKeyResolverService (user key → grant → strict/fallback).
   * Without userId (system/background tasks) fall back to admin paths:
   * SystemSettingService DB key → SUPADATA_API_KEY env var.
   */
  private async getSupadataApiKey(): Promise<string | null> {
    const userId = RequestContext.getUserId();
    if (userId) {
      try {
        const resolved = await this.toolKeyResolver.resolveToolKey(
          "supadata",
          userId,
        );
        return resolved?.value ?? null;
      } catch (error) {
        if (error instanceof NoToolKeyError) return null;
        throw error;
      }
    }

    // No userId — admin/system path
    try {
      const dbKey =
        await this.systemSettingService.getYoutubeApiKey("supadata");
      if (dbKey) {
        return dbKey;
      }
    } catch (error) {
      this.logger.debug(`Failed to get Supadata key from database: ${error}`);
    }

    return process.env.SUPADATA_API_KEY ?? null;
  }

  /**
   * Fetch YouTube video transcript
   * Uses Supadata API as primary provider (cloud-friendly, no IP blocking)
   * Falls back to other methods if Supadata is unavailable
   *
   * @param videoId YouTube video ID
   * @param lang Language code (default: 'en')
   * @returns Transcript data
   */
  async getTranscript(
    videoId: string,
    lang: string = "en",
  ): Promise<TranscriptResponse> {
    this.logger.log(
      `Fetching transcript for video: ${videoId} (lang: ${lang})`,
    );

    // Strategy 0: Check cache first
    try {
      const cached = await this.prisma.youTubeTranscriptCache.findUnique({
        where: { videoId },
      });

      if (cached && cached.expiresAt > new Date()) {
        // 始终返回原始完整字幕。已保存的翻译（可能是稀疏的，仅覆盖部分段落）通过
        // translatedTranscript 字段单独传出，由 bilingual 通道（getSubtitles）按时间戳拼接，
        // 绝不能用稀疏翻译覆盖主字幕——历史 bug：单段翻译把全量 2k 段字幕替换成 1 段。
        const originalTranscript =
          cached.transcript as unknown as TranscriptSegment[];
        const translatedTranscript = cached.translatedTranscript
          ? (cached.translatedTranscript as unknown as TranscriptSegment[])
          : undefined;
        const hasTranslation = !!translatedTranscript;

        this.logger.log(
          `Cache hit for ${videoId}, returning original transcript with ${originalTranscript.length} segments` +
            (hasTranslation
              ? ` (+${translatedTranscript.length} translated segments)`
              : ""),
        );
        return {
          videoId,
          title: cached.title ?? `YouTube Video ${videoId}`,
          transcript: originalTranscript,
          translatedTranscript,
          targetLanguage: cached.targetLanguage ?? undefined,
          hasTranslation,
        };
      }

      if (cached) {
        this.logger.debug(`Cache expired for ${videoId}, will refresh`);
      }
    } catch (cacheError) {
      this.logger.debug(`Cache lookup failed: ${cacheError}`);
    }

    // Strategy 1: Try FREE methods first (to minimize API costs)
    // Order: timedtext API > youtube-transcript npm > youtubei.js > external fallback
    let transcriptSegments: TranscriptSegment[] = [];
    let title: string | null = null;

    // 1a. Try YouTube's timedtext API (free, direct from YouTube)
    this.logger.debug(`Trying timedtext API for ${videoId}`);
    const timedTextTranscript = await this.fetchTranscriptTimedText(
      videoId,
      lang,
    );
    if (timedTextTranscript && timedTextTranscript.segments.length > 1) {
      transcriptSegments = timedTextTranscript.segments;
      title = timedTextTranscript.title;
      this.logger.log(
        `[FREE] Used YouTube timedtext API for ${videoId}, segments=${transcriptSegments.length}`,
      );
    }

    // 1b. Try youtube-transcript npm package (free)
    if (transcriptSegments.length === 0) {
      this.logger.debug(`Trying youtube-transcript npm for ${videoId}`);
      const npmTranscript = await this.fetchTranscriptNpm(videoId, lang);
      if (npmTranscript && npmTranscript.segments.length > 0) {
        transcriptSegments = npmTranscript.segments;
        title = npmTranscript.title;
        this.logger.log(
          `[FREE] Used youtube-transcript npm for ${videoId}, segments=${transcriptSegments.length}`,
        );
      }
    }

    // 1c. Try youtubei.js (free, but often blocked on cloud and has frequent parsing errors)
    // Skip in production/cloud environments due to IP blocking and API format changes
    const isCloudEnvironment =
      process.env.NODE_ENV === "production" ||
      process.env.RAILWAY_ENVIRONMENT ||
      process.env.VERCEL;

    if (
      transcriptSegments.length === 0 &&
      !lang.startsWith("zh") &&
      !isCloudEnvironment
    ) {
      this.logger.debug(`Trying youtubei.js for ${videoId}`);
      try {
        await this.ensureClient();
        const info = await this.youtube!.getInfo(videoId);
        if (info) {
          title = info.basic_info.title ?? null;
          const transcriptData = await info.getTranscript();
          if (transcriptData?.transcript?.content?.body) {
            const segments: TranscriptSegment[] =
              transcriptData.transcript.content.body.initial_segments
                .filter(
                  (segment: { snippet?: { text?: string } }) =>
                    segment.snippet?.text,
                )
                .map(
                  (segment: {
                    snippet: { text: string };
                    start_ms: number;
                    end_ms: number;
                  }) => ({
                    text: segment.snippet.text,
                    start: segment.start_ms / 1000,
                    duration: segment.end_ms / 1000 - segment.start_ms / 1000,
                  }),
                );
            if (segments.length > 0) {
              transcriptSegments = segments;
              this.logger.log(
                `[FREE] Used youtubei.js for ${videoId}, segments=${segments.length}`,
              );
            }
          }
        }
      } catch (error) {
        // youtubei.js has frequent parsing errors due to YouTube API changes
        // Log at debug level to reduce noise
        this.logger.debug(
          `youtubei.js failed for ${videoId} (this is normal in cloud environments): ${error}`,
        );
      }
    } else if (isCloudEnvironment && transcriptSegments.length === 0) {
      this.logger.debug(
        `Skipping youtubei.js for ${videoId} (cloud environment detected)`,
      );
    }

    // 1d. Try external fallback API (free)
    if (transcriptSegments.length === 0) {
      this.logger.debug(`Trying external fallback for ${videoId}`);
      const fallback = await this.fetchTranscriptFallback(videoId, lang);
      if (fallback && fallback.segments.length > 1) {
        transcriptSegments = fallback.segments;
        title = title ?? fallback.title;
        this.logger.log(
          `[FREE] Used fallback provider for ${videoId}, segments=${transcriptSegments.length}`,
        );
      }
    }

    // Strategy 2: If all FREE methods failed, try Supadata API (paid, but reliable)
    if (transcriptSegments.length === 0) {
      const supadataApiKey = await this.getSupadataApiKey();
      if (supadataApiKey) {
        this.logger.log(
          `All free methods failed for ${videoId}, trying Supadata API (paid)`,
        );
        const supadataResult = await this.fetchTranscriptSupadata(
          videoId,
          lang,
          supadataApiKey,
        );
        if (supadataResult) {
          this.logger.log(
            `[PAID] Successfully fetched transcript via Supadata API for ${videoId}`,
          );

          // Save to cache (async, don't block response)
          this.saveToCache(
            videoId,
            supadataResult.title,
            supadataResult.transcript,
            lang,
          ).catch((err) => {
            this.logger.warn(`Failed to save Supadata result to cache: ${err}`);
          });

          return supadataResult;
        }
      }

      // All methods failed
      throw new NotFoundException(
        "Transcript not available for this video. The video may not have captions, or YouTube is blocking requests.",
      );
    }

    const finalTitle =
      title ??
      (await this.fetchVideoTitle(videoId)) ??
      `YouTube Video ${videoId}`;

    // Save to cache (async, don't block response)
    this.saveToCache(videoId, finalTitle, transcriptSegments, lang).catch(
      (err) => {
        this.logger.warn(`Failed to save transcript to cache: ${err}`);
      },
    );

    return {
      videoId,
      title: finalTitle,
      transcript: transcriptSegments,
    };
  }

  /**
   * Public method to cache transcript from external source (e.g., frontend)
   */
  async cacheTranscript(
    videoId: string,
    title: string,
    transcript: TranscriptSegment[],
    language: string,
  ): Promise<void> {
    return this.saveToCache(videoId, title, transcript, language);
  }

  /**
   * 保存翻译结果到缓存 - 全局共享
   * 一个用户翻译后，所有用户都可以使用
   */
  async saveTranslation(
    videoId: string,
    translatedTranscript: TranscriptSegment[],
    targetLanguage: string,
  ): Promise<void> {
    try {
      // 检查是否存在原始字幕缓存
      const existing = await this.prisma.youTubeTranscriptCache.findUnique({
        where: { videoId },
      });

      if (!existing) {
        this.logger.warn(
          `Cannot save translation for ${videoId}: No original transcript cached`,
        );
        throw new Error(
          "Original transcript must be cached before saving translation",
        );
      }

      // 历史 bug：直接覆写 translatedTranscript 会让"按需翻译当前播放段"的客户端
      // 在 flush 时把已积累的全量翻译换成几段甚至 1 段。这里改成按 start 时间戳合并，
      // 新值覆盖同 start 的旧值，时间戳缺失的段则追加。
      const existingArr = Array.isArray(existing.translatedTranscript)
        ? (existing.translatedTranscript as unknown as TranscriptSegment[])
        : [];
      const targetChanged = existing.targetLanguage !== targetLanguage;
      const seedArr = targetChanged ? [] : existingArr;
      const byStart = new Map<number, TranscriptSegment>();
      for (const seg of seedArr) {
        if (typeof seg?.start === "number") byStart.set(seg.start, seg);
      }
      for (const seg of translatedTranscript) {
        if (typeof seg?.start === "number") byStart.set(seg.start, seg);
      }
      const merged = Array.from(byStart.values()).sort(
        (a, b) => a.start - b.start,
      );

      await this.prisma.youTubeTranscriptCache.update({
        where: { videoId },
        data: {
          translatedTranscript: merged as unknown as Prisma.InputJsonValue,
          targetLanguage,
          translatedAt: new Date(),
        },
      });

      this.logger.log(
        `Saved translation for ${videoId}: incoming=${translatedTranscript.length}, ` +
          `previous=${existingArr.length}, merged=${merged.length}, target=${targetLanguage}` +
          (targetChanged ? " (target changed, replaced)" : ""),
      );
    } catch (error) {
      this.logger.error(`Failed to save translation for ${videoId}: ${error}`);
      throw error;
    }
  }

  /**
   * 获取翻译状态
   */
  async getTranslationStatus(
    videoId: string,
  ): Promise<{ hasTranslation: boolean; targetLanguage?: string }> {
    try {
      const cached = await this.prisma.youTubeTranscriptCache.findUnique({
        where: { videoId },
        select: {
          translatedTranscript: true,
          targetLanguage: true,
        },
      });

      return {
        hasTranslation: !!cached?.translatedTranscript,
        targetLanguage: cached?.targetLanguage ?? undefined,
      };
    } catch (error) {
      this.logger.debug(`Failed to get translation status: ${error}`);
      return { hasTranslation: false };
    }
  }

  /**
   * Save transcript to global cache
   */
  private async saveToCache(
    videoId: string,
    title: string,
    transcript: TranscriptSegment[],
    language: string,
  ): Promise<void> {
    try {
      const expiresAt = new Date(Date.now() + CACHE_DURATION_MS);

      await this.prisma.youTubeTranscriptCache.upsert({
        where: { videoId },
        update: {
          title,
          transcript: transcript as unknown as Prisma.InputJsonValue,
          language,
          expiresAt,
        },
        create: {
          videoId,
          title,
          transcript: transcript as unknown as Prisma.InputJsonValue,
          language,
          expiresAt,
        },
      });

      this.logger.log(
        `Cached transcript for ${videoId} with ${transcript.length} segments, expires at ${expiresAt.toISOString()}`,
      );
    } catch (error) {
      this.logger.warn(`Failed to cache transcript for ${videoId}: ${error}`);
    }
  }

  /**
   * Fetch transcript using Supadata API (recommended for cloud deployments)
   * Supadata handles proxy/IP blocking issues automatically
   *
   * @see https://docs.supadata.ai/get-transcript
   */
  private async fetchTranscriptSupadata(
    videoId: string,
    preferredLang: string = "en",
    apiKey: string,
  ): Promise<TranscriptResponse | null> {
    try {
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const params = new URLSearchParams({
        url: videoUrl,
        text: "false", // Get timestamped chunks instead of plain text
        mode: "native", // Only fetch native transcripts (1 credit), not AI-generated
      });

      if (preferredLang) {
        params.set("lang", preferredLang);
      }

      const response = await fetch(
        `https://api.supadata.ai/v1/transcript?${params.toString()}`,
        {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
            Accept: "application/json",
          },
        },
      );

      // Handle async job (HTTP 202)
      if (response.status === 202) {
        const jobData = (await response.json()) as { jobId: string };
        this.logger.log(
          `Supadata returned job ID ${jobData.jobId}, polling for result...`,
        );
        return await this.pollSupadataJob(jobData.jobId, videoId, apiKey);
      }

      if (!response.ok) {
        this.logger.warn(
          `Supadata API returned ${response.status}: ${response.statusText}`,
        );
        return null;
      }

      const data = (await response.json()) as SupadataResponse;

      // Handle plain text response
      if (typeof data.content === "string") {
        // If we got plain text, create a single segment
        return {
          videoId,
          title:
            (await this.fetchVideoTitle(videoId)) ?? `YouTube Video ${videoId}`,
          transcript: [
            {
              text: data.content,
              start: 0,
              duration: 0,
            },
          ],
        };
      }

      // Handle chunked response
      if (!Array.isArray(data.content)) {
        this.logger.warn(
          `Supadata returned unexpected content type for ${videoId}: ${typeof data.content}`,
        );
        return null;
      }

      const segments: TranscriptSegment[] = data.content.map((chunk) => ({
        text: chunk.text,
        start: chunk.offset / 1000, // Convert ms to seconds
        duration: chunk.duration / 1000,
      }));

      const title =
        (await this.fetchVideoTitle(videoId)) ?? `YouTube Video ${videoId}`;

      this.logger.log(
        `Supadata returned ${segments.length} segments (lang: ${data.lang}) for ${videoId}`,
      );

      return {
        videoId,
        title,
        transcript: segments,
      };
    } catch (error) {
      this.logger.error(`Supadata API error: ${String(error)}`);
      return null;
    }
  }

  /**
   * Poll Supadata job until completion (for large videos)
   */
  private async pollSupadataJob(
    jobId: string,
    videoId: string,
    apiKey: string,
    maxAttempts: number = 30,
    intervalMs: number = 2000,
  ): Promise<TranscriptResponse | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));

      try {
        const response = await fetch(
          `https://api.supadata.ai/v1/transcript/${jobId}`,
          {
            method: "GET",
            headers: {
              "x-api-key": apiKey,
              Accept: "application/json",
            },
          },
        );

        if (response.status === 202) {
          // Still processing
          this.logger.debug(
            `Supadata job ${jobId} still processing (attempt ${attempt + 1}/${maxAttempts})`,
          );
          continue;
        }

        if (!response.ok) {
          this.logger.warn(`Supadata job ${jobId} failed: ${response.status}`);
          return null;
        }

        const data = (await response.json()) as SupadataResponse;

        if (typeof data.content === "string") {
          return {
            videoId,
            title:
              (await this.fetchVideoTitle(videoId)) ??
              `YouTube Video ${videoId}`,
            transcript: [{ text: data.content, start: 0, duration: 0 }],
          };
        }

        if (!Array.isArray(data.content)) {
          this.logger.warn(
            `Supadata job ${jobId} returned unexpected content type: ${typeof data.content}`,
          );
          return null;
        }

        const segments: TranscriptSegment[] = data.content.map((chunk) => ({
          text: chunk.text,
          start: chunk.offset / 1000,
          duration: chunk.duration / 1000,
        }));

        return {
          videoId,
          title:
            (await this.fetchVideoTitle(videoId)) ?? `YouTube Video ${videoId}`,
          transcript: segments,
        };
      } catch (error) {
        this.logger.warn(`Error polling Supadata job ${jobId}: ${error}`);
      }
    }

    this.logger.warn(
      `Supadata job ${jobId} timed out after ${maxAttempts} attempts`,
    );
    return null;
  }

  /**
   * Extract video ID from various YouTube URL formats
   * @param url YouTube URL
   * @returns Video ID
   */
  extractVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /^([a-zA-Z0-9_-]{11})$/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    return null;
  }

  private async ensureClient() {
    if (!this.youtube) {
      // Force true ESM dynamic import at runtime so TypeScript does not
      // compile import() to require() in CommonJS output.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const importDynamic = new Function(
        "modulePath",
        "return import(modulePath)",
      ) as (path: string) => Promise<YoutubeModule>;
      const youtubeModule = await importDynamic("youtubei.js");
      const { Innertube } = youtubeModule;
      this.youtube = await Innertube.create();
    }
  }

  private async fetchVideoTitle(videoId: string): Promise<string | null> {
    try {
      const response = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      );
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as { title?: string };
      return data.title ?? null;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch video title via oEmbed: ${String(error)}`,
      );
      return null;
    }
  }

  private async fetchTranscriptNpm(
    videoId: string,
    _preferredLang: string = "en", // Kept for API compatibility, but we try all languages
  ): Promise<{
    segments: TranscriptSegment[];
    title: string | null;
  } | null> {
    try {
      const { YoutubeTranscript } = await import("youtube-transcript");

      // Build comprehensive language list
      // English is always preferred, then fall back to other languages
      // zh-Hans is commonly used for Simplified Chinese on YouTube
      const languages = [
        "en", // English always first
        "zh-Hans", // Simplified Chinese - most common on YouTube
        "zh-Hant", // Traditional Chinese
        "zh-CN",
        "zh-TW",
        "zh",
        "ja",
        "ko",
        "es",
        "fr",
        "de",
        "pt",
        "ru",
      ];

      for (const lang of languages) {
        try {
          this.logger.debug(
            `Trying youtube-transcript for ${videoId} with lang: ${lang}`,
          );

          const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
            lang: lang,
          });

          this.logger.debug(
            `youtube-transcript returned ${transcript?.length ?? 0} items for lang ${lang}`,
          );

          if (transcript && transcript.length > 0) {
            const segments: TranscriptSegment[] = transcript.map(
              (item: { text?: string; offset: number; duration: number }) => ({
                text: item.text || "",
                start: item.offset / 1000, // Convert milliseconds to seconds
                duration: item.duration / 1000, // Convert milliseconds to seconds
              }),
            );

            this.logger.log(
              `Successfully fetched transcript using youtube-transcript (lang: ${lang}) for ${videoId}, ${segments.length} segments`,
            );
            return { segments, title: null };
          } else {
            this.logger.debug(
              `youtube-transcript returned empty result for lang ${lang}`,
            );
          }
        } catch (langError) {
          this.logger.debug(
            `youtube-transcript failed for lang ${lang}: ${String(langError)}`,
          );
          continue;
        }
      }

      this.logger.warn(
        `All youtube-transcript language attempts failed for ${videoId}`,
      );
      return null;
    } catch (error) {
      this.logger.warn(`youtube-transcript library failed: ${String(error)}`);
      return null;
    }
  }

  private async fetchTranscriptFallback(
    videoId: string,
    _preferredLang: string = "en", // Kept for API compatibility, but we try all languages
  ): Promise<{
    segments: TranscriptSegment[];
    title: string | null;
  } | null> {
    // Try multiple language codes - English first, then fall back to others
    // Include zh-Hans which is commonly used by YouTube for Simplified Chinese
    const languages = [
      "en", // English always first
      "zh-Hans", // Simplified Chinese - most common on YouTube
      "zh-Hant", // Traditional Chinese
      "zh",
      "zh-CN",
      "zh-TW",
      "ja",
      "ko",
      "es",
      "fr",
      "de",
      "pt",
      "ru",
    ];

    for (const lang of languages) {
      try {
        const endpoint = `https://youtubetranscript.com/?lang=${lang}&server_vid2=${videoId}`;
        const response = await fetch(endpoint, {
          headers: {
            Accept: "application/json, text/plain, */*",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
          },
        });

        if (!response.ok) {
          this.logger.debug(
            `Fallback transcript service responded with ${response.status} for video ${videoId} (lang: ${lang})`,
          );
          continue;
        }

        // Check first character to determine format
        const text = await response.text();

        // Skip if response is XML (starts with <?xml or <)
        if (text.trim().startsWith("<?xml") || text.trim().startsWith("<")) {
          this.logger.debug(
            `Fallback service returned XML instead of JSON for ${videoId} (lang: ${lang}), trying XML parse`,
          );

          // Log first 500 chars of XML for debugging
          this.logger.debug(
            `XML content preview: ${text.slice(0, 500).replace(/\n/g, "\\n")}`,
          );

          // Try to parse as transcript XML
          const xmlSegments = this.parseTranscriptXml(text);
          if (xmlSegments.length > 0) {
            this.logger.log(
              `Successfully parsed XML transcript from fallback (lang: ${lang}) for ${videoId}`,
            );
            return { segments: xmlSegments, title: null };
          }
          continue;
        }

        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          this.logger.debug(
            `Failed to parse JSON from fallback service for ${videoId} (lang: ${lang})`,
          );
          continue;
        }
        const items: Array<Record<string, unknown>> = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as { transcripts?: unknown })?.transcripts)
            ? (raw as { transcripts: Array<Record<string, unknown>> })
                .transcripts
            : Array.isArray((raw as { data?: unknown })?.data)
              ? (raw as { data: Array<Record<string, unknown>> }).data
              : [];

        const segments: TranscriptSegment[] = items
          .map((item) => {
            const text = (item.text ?? item.caption ?? "") as string | unknown;
            const startValue = Number.parseFloat(
              String(item.start ?? item.start_offset ?? item.offset ?? "0"),
            );
            const durationValue = Number.parseFloat(
              String(item.dur ?? item.duration ?? item.length ?? "0"),
            );

            return {
              text: typeof text === "string" ? text : "",
              start: Number.isFinite(startValue) ? startValue : 0,
              duration: Number.isFinite(durationValue) ? durationValue : 0,
            };
          })
          .filter((segment) => segment.text.trim().length > 0);

        if (segments.length === 0) {
          continue;
        }

        const rawObj = raw as Record<string, unknown>;
        const title =
          typeof rawObj?.title === "string"
            ? rawObj.title
            : typeof rawObj?.video_title === "string"
              ? rawObj.video_title
              : null;

        this.logger.log(
          `Successfully fetched transcript using fallback (lang: ${lang}) for ${videoId}`,
        );
        return { segments, title };
      } catch (error) {
        this.logger.debug(
          `Fallback transcript fetch failed for lang ${lang}: ${String(error)}`,
        );
        continue;
      }
    }

    this.logger.warn(`All fallback transcript attempts failed for ${videoId}`);

    // Note: timedtext API is now tried first in the main flow, no need to retry here
    return null;
  }

  /**
   * Fetch transcript using YouTube's timedtext API (XML format)
   */
  private async fetchTranscriptTimedText(
    videoId: string,
    _preferredLang: string = "en", // Kept for API compatibility
  ): Promise<{
    segments: TranscriptSegment[];
    title: string | null;
  } | null> {
    // English first, then comprehensive language fallback
    const languages = [
      "en",
      "zh-Hans",
      "zh-Hant",
      "zh-CN",
      "zh-TW",
      "zh",
      "ja",
      "ko",
      "es",
      "fr",
      "de",
      "pt",
      "ru",
    ];

    this.logger.debug(`Starting timedtext API fetch for ${videoId}`);

    // We only need to fetch the video page once to get all caption tracks
    try {
      const videoPageResponse = await fetch(
        `https://www.youtube.com/watch?v=${videoId}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
          },
        },
      );

      if (!videoPageResponse.ok) {
        this.logger.debug(
          `Failed to fetch video page for ${videoId}: ${videoPageResponse.status}`,
        );
        return null;
      }

      const html = await videoPageResponse.text();

      // Extract caption tracks from ytInitialPlayerResponse
      const captionMatch = html.match(/"captionTracks":\s*(\[.*?\])/);
      if (!captionMatch) {
        this.logger.debug(
          `No caption tracks found in video page for ${videoId}`,
        );
        return null;
      }

      let captionTracks: Array<{
        baseUrl?: string;
        languageCode: string;
        name?: { simpleText?: string };
      }>;
      try {
        captionTracks = JSON.parse(captionMatch[1]);
        this.logger.debug(
          `Found ${captionTracks.length} caption tracks for ${videoId}: ${captionTracks.map((t) => t.languageCode).join(", ")}`,
        );
      } catch {
        this.logger.debug(`Failed to parse caption tracks for ${videoId}`);
        return null;
      }

      // Try each language in order
      for (const lang of languages) {
        // Find matching language track
        const track = captionTracks.find(
          (t) =>
            t.languageCode === lang ||
            t.languageCode.startsWith(lang.split("-")[0]),
        );

        if (!track?.baseUrl) {
          continue;
        }

        this.logger.debug(
          `Found ${lang} caption track for ${videoId}, fetching...`,
        );

        // Fetch the caption XML
        const captionResponse = await fetch(track.baseUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (!captionResponse.ok) {
          this.logger.debug(
            `Failed to fetch caption for ${videoId} (${lang}): ${captionResponse.status}`,
          );
          continue;
        }

        const xml = await captionResponse.text();

        // Parse XML transcript
        const segments = this.parseTranscriptXml(xml);

        if (segments.length > 0) {
          this.logger.log(
            `Successfully fetched transcript using timedtext API (lang: ${lang}) for ${videoId}, segments=${segments.length}`,
          );
          return { segments, title: null };
        } else {
          this.logger.debug(
            `Parsed 0 segments from ${lang} caption XML for ${videoId}`,
          );
        }
      }
    } catch (error) {
      this.logger.debug(`Timedtext API error for ${videoId}: ${error}`);
    }

    this.logger.warn(`Timedtext API fallback failed for ${videoId}`);
    return null;
  }

  /**
   * Parse YouTube transcript XML format
   * Supports multiple XML formats from different YouTube APIs
   */
  private parseTranscriptXml(xml: string): TranscriptSegment[] {
    const segments: TranscriptSegment[] = [];

    // Check if this is an error page or HTML (not a transcript)
    if (
      xml.includes("<!DOCTYPE html") ||
      xml.includes("<html") ||
      xml.includes("<error>") ||
      xml.includes("We're sorry")
    ) {
      this.logger.debug("XML appears to be an error page or HTML, skipping");
      return segments;
    }

    // Try multiple regex patterns to handle different XML formats
    const patterns = [
      // Standard format: <text start="..." dur="...">content</text>
      /<text\s+start="([^"]+)"\s+dur="([^"]+)"[^>]*>([^<]*)<\/text>/g,
      // Alternative format with different attribute order
      /<text\s+dur="([^"]+)"\s+start="([^"]+)"[^>]*>([^<]*)<\/text>/g,
      // Format with CDATA or nested content
      /<text\s+start="([^"]+)"\s+dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g,
    ];

    for (const regex of patterns) {
      let match;
      regex.lastIndex = 0; // Reset regex state

      while ((match = regex.exec(xml)) !== null) {
        let start: number, duration: number, text: string;

        // Handle different capture group orders
        if (regex.source.includes('dur="([^"]+)"\\s+start=')) {
          // dur comes before start
          duration = parseFloat(match[1]);
          start = parseFloat(match[2]);
          text = match[3];
        } else {
          start = parseFloat(match[1]);
          duration = parseFloat(match[2]);
          text = match[3];
        }

        // Decode HTML entities
        const decodedText = text
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&#(\d+);/g, (_, code) =>
            String.fromCharCode(parseInt(code)),
          )
          .replace(/<[^>]+>/g, "") // Remove any nested HTML tags
          .replace(/\n/g, " ")
          .trim();

        if (decodedText && !isNaN(start) && !isNaN(duration)) {
          segments.push({ text: decodedText, start, duration });
        }
      }

      // If we found segments with this pattern, stop trying others
      if (segments.length > 0) {
        this.logger.debug(
          `XML parsed successfully with pattern, found ${segments.length} segments`,
        );
        break;
      }
    }

    // If no segments found, try a more lenient approach
    if (segments.length === 0) {
      this.logger.debug(`Standard patterns failed, trying lenient parsing`);

      // Try to extract any text with start/dur attributes (more flexible order)
      const lenientRegex =
        /<text[^>]*start=["']?([0-9.]+)["']?[^>]*dur=["']?([0-9.]+)["']?[^>]*>([\s\S]*?)<\/text>/gi;
      let match;

      while ((match = lenientRegex.exec(xml)) !== null) {
        const start = parseFloat(match[1]);
        const duration = parseFloat(match[2]);
        const text = match[3]
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/<[^>]+>/g, "")
          .replace(/\n/g, " ")
          .trim();

        if (text && !isNaN(start) && !isNaN(duration)) {
          segments.push({ text, start, duration });
        }
      }
    }

    // If still no segments, try reversed attribute order pattern
    if (segments.length === 0) {
      this.logger.debug(`Trying reversed attribute order pattern`);

      // Pattern where dur comes before start
      const reversedRegex =
        /<text[^>]*dur=["']?([0-9.]+)["']?[^>]*start=["']?([0-9.]+)["']?[^>]*>([\s\S]*?)<\/text>/gi;
      let match;

      while ((match = reversedRegex.exec(xml)) !== null) {
        const duration = parseFloat(match[1]);
        const start = parseFloat(match[2]);
        const text = match[3]
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/<[^>]+>/g, "")
          .replace(/\n/g, " ")
          .trim();

        if (text && !isNaN(start) && !isNaN(duration)) {
          segments.push({ text, start, duration });
        }
      }
    }

    this.logger.debug(`XML parsing result: ${segments.length} segments`);
    return segments;
  }
}
