import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  BadRequestException,
  Logger,
  Res,
  HttpStatus,
} from "@nestjs/common";
import { Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import { YoutubeService } from "@/modules/ai-harness/facade";
import {
  PdfGeneratorService,
  SubtitleExportOptions,
} from "./pdf-generator.service";
import { Public } from "../../../common/decorators/public.decorator";

interface SubtitlesRequestDto {
  videoId: string;
  englishLang?: string;
  chineseLang?: string;
}

interface CacheTranscriptDto {
  videoId: string;
  title: string;
  transcript: Array<{ text: string; start: number; duration: number }>;
  language: string;
}

interface SaveTranslationDto {
  videoId: string;
  translatedTranscript: Array<{
    text: string;
    start: number;
    duration: number;
    translatedText: string;
  }>;
  targetLanguage: string; // 翻译目标语言，如 "zh", "en"
}

interface ExportPdfRequestDto {
  videoId: string;
  title?: string;
  englishSubtitles: Array<{ text: string; start: number; duration: number }>;
  chineseSubtitles: Array<{ text: string; start: number; duration: number }>;
  options: SubtitleExportOptions;
}

@Public()
@ApiTags("YouTube")
@Controller("youtube")
export class YoutubeController {
  private readonly logger = new Logger(YoutubeController.name);

  constructor(
    private readonly youtubeService: YoutubeService,
    private readonly pdfGeneratorService: PdfGeneratorService,
  ) {}

  @Get("transcript/:videoId")
  async getTranscript(@Param("videoId") videoId: string) {
    this.logger.log(`Received request for video transcript: ${videoId}`);

    if (!videoId || videoId.trim().length === 0) {
      throw new BadRequestException("Video ID is required");
    }

    const cleanVideoId = videoId.trim();
    return await this.youtubeService.getTranscript(cleanVideoId);
  }

  /**
   * Get bilingual subtitles (English + Chinese aligned)
   * First tries to get native Chinese subtitles, then falls back to saved AI translations
   */
  @Post("subtitles")
  async getSubtitles(@Body() body: SubtitlesRequestDto) {
    const { videoId } = body;

    this.logger.log(`Fetching bilingual subtitles for video: ${videoId}`);

    if (!videoId || videoId.trim().length === 0) {
      throw new BadRequestException("Video ID is required");
    }

    const cleanVideoId = videoId.trim();

    try {
      // Fetch English subtitles
      const englishTranscript = await this.youtubeService.getTranscript(
        cleanVideoId,
        "en",
      );

      // Try to get Chinese subtitles - first try native, then saved translations
      let chineseTranscript: {
        videoId: string;
        title: string;
        transcript: Array<{ text: string; start: number; duration: number }>;
      };

      // Strategy 1: Try native Chinese subtitles from YouTube
      try {
        chineseTranscript = await this.youtubeService.getTranscript(
          cleanVideoId,
          "zh",
        );
        if (chineseTranscript.transcript.length > 0) {
          this.logger.log(
            `Found native Chinese subtitles for ${cleanVideoId} (${chineseTranscript.transcript.length} segments)`,
          );
        }
      } catch (error) {
        this.logger.debug(
          `Native Chinese subtitles not available for ${cleanVideoId}: ${error}`,
        );
        chineseTranscript = {
          videoId: cleanVideoId,
          title: englishTranscript.title,
          transcript: [],
        };
      }

      // Strategy 2: If no native Chinese, check for saved AI translations
      if (chineseTranscript.transcript.length === 0) {
        this.logger.log(
          `No native Chinese subtitles, checking for saved translations for ${cleanVideoId}`,
        );
        const translationStatus =
          await this.youtubeService.getTranslationStatus(cleanVideoId);

        if (translationStatus.hasTranslation) {
          // Fetch the full transcript with translations。getTranscript 现在 transcript 始终
          // 是原始英文字幕（完整），翻译数据在 translatedTranscript 字段里（可能稀疏）。
          const cachedTranscript = await this.youtubeService.getTranscript(
            cleanVideoId,
            "en",
          );

          if (
            cachedTranscript.hasTranslation &&
            cachedTranscript.translatedTranscript
          ) {
            // Build Chinese transcript from translatedText fields in the translation array
            chineseTranscript = {
              videoId: cleanVideoId,
              title: cachedTranscript.title,
              transcript: cachedTranscript.translatedTranscript
                .filter((seg) => seg.translatedText)
                .map((seg) => ({
                  text: seg.translatedText!,
                  start: seg.start,
                  duration: seg.duration,
                })),
            };

            this.logger.log(
              `Using saved AI translations for ${cleanVideoId} (${chineseTranscript.transcript.length} segments)`,
            );
          }
        } else {
          this.logger.warn(
            `No Chinese subtitles or saved translations available for ${cleanVideoId}. ` +
              `User needs to translate the content in the viewer first.`,
          );
        }
      }

      // Align transcripts
      const aligned = this.pdfGeneratorService.alignTranscripts(
        englishTranscript.transcript,
        chineseTranscript.transcript,
      );

      return {
        videoId: cleanVideoId,
        title: englishTranscript.title,
        url: `https://www.youtube.com/watch?v=${cleanVideoId}`,
        english: aligned.english,
        chinese: aligned.chinese,
        hasTranslation:
          chineseTranscript.transcript.length > 0 ||
          (await this.youtubeService.getTranslationStatus(cleanVideoId))
            .hasTranslation,
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch bilingual subtitles for ${cleanVideoId}:`,
        error,
      );
      throw new BadRequestException(
        `Failed to fetch subtitles: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Export subtitles as PDF
   */
  @Post("export-pdf")
  async exportPdf(@Body() body: ExportPdfRequestDto, @Res() res: Response) {
    const { videoId, title, englishSubtitles, chineseSubtitles, options } =
      body;

    this.logger.log(`Exporting PDF for video: ${videoId}`);

    if (!videoId || videoId.trim().length === 0) {
      throw new BadRequestException("Video ID is required");
    }

    if (!englishSubtitles && !chineseSubtitles) {
      throw new BadRequestException(
        "At least one subtitle language is required",
      );
    }

    try {
      const metadata = {
        videoId,
        title: title || `YouTube Video ${videoId}`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        exportDate: new Date(),
      };

      const transcript = {
        english: englishSubtitles || [],
        chinese: chineseSubtitles || [],
      };

      const pdfStream = await this.pdfGeneratorService.generatePdf(
        transcript,
        metadata,
        options,
      );

      // Set response headers
      const filename = `youtube-subtitles-${videoId}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.status(HttpStatus.OK);

      // Pipe the PDF stream to response
      pdfStream.pipe(res);

      pdfStream.on("end", () => {
        this.logger.log(`PDF export completed for video: ${videoId}`);
      });

      pdfStream.on("error", (error) => {
        this.logger.error(`PDF generation error for video ${videoId}:`, error);
        if (!res.headersSent) {
          res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            message: "Failed to generate PDF",
            error: error.message,
          });
        }
      });
    } catch (error) {
      this.logger.error(`Failed to export PDF for ${videoId}:`, error);
      throw new BadRequestException(
        `Failed to export PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * 客户端辅助获取字幕
   * 当服务端无法获取时，通过此接口尝试其他方式获取
   * 主要用于触发服务端的备用获取策略
   */
  @Post("client-fetch/:videoId")
  async clientFetch(
    @Param("videoId") videoId: string,
    @Query("lang") lang: string = "en",
  ) {
    this.logger.log(`Client-assisted fetch request for video: ${videoId}`);

    if (!videoId || videoId.trim().length === 0) {
      throw new BadRequestException("Video ID is required");
    }

    const cleanVideoId = videoId.trim();

    try {
      // 尝试所有可用的获取方式
      const result = await this.youtubeService.getTranscript(
        cleanVideoId,
        lang,
      );

      return {
        videoId: cleanVideoId,
        title: result.title,
        transcript: result.transcript,
        language: lang,
        source: "server",
      };
    } catch (error) {
      this.logger.warn(
        `Client-assisted fetch failed for ${cleanVideoId}: ${error instanceof Error ? error.message : error}`,
      );

      // 返回空结果而不是抛出错误，让前端知道需要其他方式
      return {
        videoId: cleanVideoId,
        title: null,
        transcript: [],
        language: lang,
        source: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 接收前端上传的字幕并缓存到数据库
   * 用于前端成功获取字幕后上传到服务器
   */
  @Post("cache-transcript")
  async cacheTranscript(@Body() body: CacheTranscriptDto) {
    const { videoId, title, transcript, language } = body;

    this.logger.log(
      `Receiving transcript upload for video: ${videoId} (${transcript?.length || 0} segments)`,
    );

    if (!videoId || videoId.trim().length === 0) {
      throw new BadRequestException("Video ID is required");
    }

    if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
      throw new BadRequestException(
        "Transcript is required and must not be empty",
      );
    }

    const cleanVideoId = videoId.trim();

    try {
      await this.youtubeService.cacheTranscript(
        cleanVideoId,
        title || `YouTube Video ${cleanVideoId}`,
        transcript,
        language || "en",
      );

      this.logger.log(
        `Successfully cached transcript for ${cleanVideoId} with ${transcript.length} segments`,
      );

      return {
        videoId: cleanVideoId,
        segmentCount: transcript.length,
      };
    } catch (error) {
      this.logger.error(
        `Failed to cache transcript for ${cleanVideoId}:`,
        error,
      );
      throw new BadRequestException(
        `Failed to cache transcript: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * 保存翻译结果到缓存 - 全局共享
   * 一个用户翻译后，所有用户都可以使用
   */
  @Post("save-translation")
  async saveTranslation(@Body() body: SaveTranslationDto) {
    const { videoId, translatedTranscript, targetLanguage } = body;

    this.logger.log(
      `Receiving translation upload for video: ${videoId} (${translatedTranscript?.length || 0} segments, target: ${targetLanguage})`,
    );

    if (!videoId || videoId.trim().length === 0) {
      throw new BadRequestException("Video ID is required");
    }

    if (
      !translatedTranscript ||
      !Array.isArray(translatedTranscript) ||
      translatedTranscript.length === 0
    ) {
      throw new BadRequestException(
        "Translated transcript is required and must not be empty",
      );
    }

    if (!targetLanguage) {
      throw new BadRequestException("Target language is required");
    }

    const cleanVideoId = videoId.trim();

    try {
      await this.youtubeService.saveTranslation(
        cleanVideoId,
        translatedTranscript,
        targetLanguage,
      );

      this.logger.log(
        `Successfully saved translation for ${cleanVideoId} with ${translatedTranscript.length} segments (target: ${targetLanguage})`,
      );

      return {
        videoId: cleanVideoId,
        segmentCount: translatedTranscript.length,
        targetLanguage,
      };
    } catch (error) {
      this.logger.error(
        `Failed to save translation for ${cleanVideoId}:`,
        error,
      );
      throw new BadRequestException(
        `Failed to save translation: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * 获取翻译状态
   */
  @Get("translation-status/:videoId")
  async getTranslationStatus(@Param("videoId") videoId: string) {
    if (!videoId || videoId.trim().length === 0) {
      throw new BadRequestException("Video ID is required");
    }

    const cleanVideoId = videoId.trim();
    return await this.youtubeService.getTranslationStatus(cleanVideoId);
  }
}
