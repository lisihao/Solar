/**
 * Slides Engine - Controller
 *
 * 幻灯片生成 API 控制器
 *
 * API 端点：
 * - POST /ai-office/slides/generate (SSE) - 流式生成
 * - GET /ai-office/slides/sessions/:sessionId/checkpoints - 获取检查点列表
 * - POST /ai-office/slides/restore/:checkpointId - 恢复检查点
 * - POST /ai-office/slides/sessions/:sessionId/rerender/:pageNumber - 重新渲染页面
 *
 * v4.0: 使用 AI Engine 的 TeamsService 进行编排
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Sse,
  Res,
  Req,
  HttpStatus,
  HttpException,
  Logger,
  MessageEvent,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  UseGuards,
  Optional,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Response } from "express";
import { Observable } from "rxjs";
import { SlidesEngineService } from "../services/slides-engine.service";
import { SlidesDataImportService } from "../services/data-import.service";
import {
  AIEditService,
  PolishOptions,
  ChatEditResult,
} from "../services/ai-edit.service";
import { SlidesCheckpointService } from "../checkpoint/checkpoint.service";
import {
  VoiceNarrationSkill,
  NarrationSlidePage,
  NarrationStyle,
} from "../skills/voice-narration.skill";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { GlobalStyles } from "../checkpoint/checkpoint.types";
import { getAllThemes } from "../templates/base/themes";
import {
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsBoolean,
  Min,
  Max,
  MaxLength,
} from "class-validator";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import {
  RateLimitGuard,
  RateLimit,
} from "../../../../../common/guards/rate-limit.guard";
import { Public } from "../../../../../common/decorators/public.decorator";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import { BillingContext } from "../../../../platform/facade";
import {
  MissionContext,
  MissionExecutorService,
} from "@/modules/ai-harness/facade";
import { Prisma } from "@prisma/client"; // needed for Prisma.JsonNull
import { PresetLoader } from "../skill-resolver";

// ============================================
// DTOs
// ============================================

class GenerateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100000) // 100KB limit
  sourceText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  userRequirement?: string;

  @IsOptional()
  @IsNumber()
  @Min(3)
  @Max(30)
  targetPages?: number;

  @IsOptional()
  @IsIn(["dark", "light", "custom"])
  stylePreference?: "dark" | "light" | "custom";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  targetAudience?: string;

  @IsOptional()
  customStyles?: Partial<GlobalStyles>;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  themeId?: string;

  @IsOptional()
  @IsObject()
  crossModuleSource?: {
    type: string;
    sourceId: string;
    sourceName?: string;
  };

  // ── Skills-driven extensibility ──
  @IsOptional()
  @IsString()
  @MaxLength(100)
  preset?: string;

  @IsOptional()
  @IsObject()
  skillOverrides?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  intent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;

  @IsOptional()
  @IsBoolean()
  autoRoute?: boolean;
}

class RerenderPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedback?: string;
}

class CreateCheckpointDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIn([
    "task_decomposition",
    "outline_confirmed",
    "page_rendered",
    "batch_rendered",
    "user_modified",
    "auto_save",
  ])
  type?: string;
}

class GenerateNarrationDto {
  @IsOptional()
  @IsIn(["formal", "casual", "professional", "storytelling"])
  style?: NarrationStyle;

  @IsOptional()
  @IsIn(["zh", "en"])
  language?: "zh" | "en";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  targetAudience?: string;

  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(300)
  wordsPerMinute?: number;
}

class ExportDto {
  @IsIn(["pptx", "pdf", "png", "html"])
  format!: "pptx" | "pdf" | "png" | "html";

  @IsOptional()
  includeNotes?: boolean;

  @IsOptional()
  @IsIn(["standard", "high"])
  quality?: "standard" | "high";
}

class UpdateSessionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;
}

class ImportFromLibraryDto {
  @IsArray()
  @IsString({ each: true })
  resourceIds!: string[];
}

class ChatEditDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  instruction!: string;

  @IsNumber()
  @Min(0)
  pageIndex!: number;
}

// export 使 TypeScript noUnusedLocals 不检查此 DTO（DTO 通常应导出供调用方使用）
export class UpdateSubscriptionDto {
  @IsIn(["refresh", "unsubscribe"])
  action!: "refresh" | "unsubscribe";
}

@ApiTags("AI Office - Slides")
@Controller("ai-office/slides")
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class SlidesController {
  private readonly logger = new Logger(SlidesController.name);

  constructor(
    private readonly slidesEngine: SlidesEngineService,
    private readonly checkpointService: SlidesCheckpointService,
    private readonly dataImportService: SlidesDataImportService,
    private readonly aiEditService: AIEditService,
    private readonly voiceNarrationSkill: VoiceNarrationSkill,
    private readonly prisma: PrismaService,
    @Optional() private readonly presetLoader?: PresetLoader,
    @Optional() private readonly missionExecutor?: MissionExecutorService,
  ) {}

  // ============================================
  // Presets API (Skills-driven extensibility)
  // ============================================

  /**
   * 获取可用的 Slides 预设（Preset）列表。
   * 前端在用户选择数据源后，可根据 sourceType 过滤推荐的 preset。
   */
  @Public()
  @Get("presets")
  getPresets() {
    const presets = this.presetLoader?.list() ?? [];
    return {
      presets: presets.map((p) => ({
        id: p.id,
        description: p.description,
        appliesTo: p.appliesTo,
      })),
    };
  }

  // ============================================
  // Themes API
  // ============================================

  /**
   * 获取可用主题列表（公开接口，不需要登录）
   */
  @Public()
  @Get("themes/list")
  async getThemesList() {
    this.logger.log("[getThemesList] Fetching available themes");
    const themes = getAllThemes();
    return {
      themes: themes.map((theme) => ({
        id: theme.id,
        name: theme.name,
        description: theme.description,
        preview: theme.preview,
        colors: {
          primary: theme.colors.background.primary,
          accent: theme.colors.accent.primary,
          text: theme.colors.text.primary,
        },
      })),
    };
  }

  // ============================================
  // 生成 API (使用 AI Engine)
  // ============================================

  /**
   * 流式生成幻灯片 (SSE) - GET 方式
   *
   * 通过 AI Engine 的 TeamsService 编排生成
   */
  @Sse("generate")
  @RateLimit({
    maxRequests: 10,
    windowSeconds: 60,
    message: "生成请求过于频繁，请稍后重试",
  })
  generateSlides(
    @Req() req: RequestWithUser,
    @Query("title") title: string,
    @Query("sourceText") sourceText: string,
    @Query("userRequirement") userRequirement?: string,
    @Query("targetPages") targetPages?: string,
    @Query("stylePreference") stylePreference?: string,
    @Query("targetAudience") targetAudience?: string,
    @Query("themeId") themeId?: string,
  ): Observable<MessageEvent> {
    const userId = req.user.id;
    this.logger.log(
      `[generateSlides] Starting generation: ${title?.slice(0, 50)}... for user ${userId}`,
    );

    const slidesEngine = this.slidesEngine;
    const logger = this.logger;
    const billingData = {
      userId,
      moduleType: "ai-office",
      operationType: "generate-ppt",
    };

    return new Observable<MessageEvent>((subscriber) => {
      void this.withMissionContext(userId, "slides-generate", async () => {
        await BillingContext.run(billingData, async () => {
          try {
            const generator = slidesEngine.generateSlides({
              userId,
              sourceText: sourceText || "",
              userRequirement,
              targetPages: targetPages ? parseInt(targetPages, 10) : undefined,
              stylePreference: stylePreference as "dark" | "light",
              targetAudience,
              themeId,
            });

            for await (const event of generator) {
              logger.debug(`[generateSlides] Sending SSE event: ${event.type}`);
              subscriber.next({ data: JSON.stringify(event) });
            }
            subscriber.complete();
          } catch (error) {
            logger.error("[generateSlides] Error:", error);
            subscriber.next({
              data: JSON.stringify({
                type: "error",
                timestamp: new Date().toISOString(),
                error:
                  error instanceof Error ? error.message : "Generation failed",
              }),
            });
            subscriber.complete();
          }
        });
      });
    });
  }

  /**
   * POST 方式生成幻灯片 (SSE)
   *
   * 支持 POST body 传递更复杂的参数
   * ★ 手动设置 SSE 响应头，确保 POST 请求也能正确流式传输
   */
  @Post("generate")
  @RateLimit({
    maxRequests: 10,
    windowSeconds: 60,
    message: "生成请求过于频繁，请稍后重试",
  })
  async generateSlidesPost(
    @Req() req: RequestWithUser,
    @Body() dto: GenerateDto,
    @Res() res?: Response,
  ): Promise<void> {
    if (!res) {
      throw new HttpException("Response object not available", 500);
    }

    const userId = req.user.id;
    this.logger.log(
      `[generateSlidesPost] Starting generation: ${dto.title?.slice(0, 50)}... for user ${userId}`,
    );

    // ★ 手动设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // 禁用 Nginx/代理缓冲
    res.flushHeaders(); // 立即发送响应头

    await this.withMissionContext(userId, "slides-generate-post", () =>
      BillingContext.run(
        { userId, moduleType: "ai-office", operationType: "generate-ppt" },
        async () => {
          const generator = this.slidesEngine.generateSlides({
            userId,
            sourceText: dto.sourceText,
            userRequirement: dto.userRequirement,
            targetPages: dto.targetPages,
            stylePreference: dto.stylePreference as "dark" | "light",
            targetAudience: dto.targetAudience,
            themeId: dto.themeId,
            preset: dto.preset,
            skillOverrides: dto.skillOverrides,
            intent: dto.intent,
            language: dto.language,
            autoRoute: dto.autoRoute,
          });

          try {
            for await (const event of generator) {
              const sseData = `data: ${JSON.stringify(event)}\n\n`;
              res.write(sseData);
              this.logger.debug(
                `[generateSlidesPost] Sent SSE event: ${event.type}`,
              );
            }
          } catch (error) {
            this.logger.error("[generateSlidesPost] Error:", error);
            const errorEvent = {
              type: "error",
              timestamp: new Date().toISOString(),
              error:
                error instanceof Error ? error.message : "Generation failed",
            };
            res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
          } finally {
            res.end();
          }
        },
      ),
    );
  }

  /**
   * Team 协作生成幻灯片 (SSE)
   *
   * 注：现在使用与普通生成相同的 AI Engine 编排
   * ★ 手动设置 SSE 响应头，确保 POST 请求也能正确流式传输
   */
  @Post("team/generate")
  @RateLimit({
    maxRequests: 10,
    windowSeconds: 60,
    message: "生成请求过于频繁，请稍后重试",
  })
  async generateTeam(
    @Req() req: RequestWithUser,
    @Body() dto: GenerateDto,
    @Res() res?: Response,
  ): Promise<void> {
    if (!res) {
      throw new HttpException("Response object not available", 500);
    }

    const userId = req.user.id;
    this.logger.log(
      `[generateTeam] Starting Team generation with ${dto.sourceText?.length || 0} chars for user ${userId}`,
    );

    // ★ 手动设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // 禁用 Nginx/代理缓冲
    res.flushHeaders(); // 立即发送响应头

    // 使用相同的引擎，AI Engine 会负责团队协作编排
    await this.withMissionContext(userId, "slides-team-generate", () =>
      BillingContext.run(
        { userId, moduleType: "ai-office", operationType: "generate-ppt" },
        async () => {
          const generator = this.slidesEngine.generateSlides({
            userId,
            sourceText: dto.sourceText,
            userRequirement: dto.userRequirement,
            targetPages: dto.targetPages,
            stylePreference: dto.stylePreference as "dark" | "light",
            targetAudience: dto.targetAudience,
            themeId: dto.themeId,
            crossModuleSource: dto.crossModuleSource as
              | {
                  type: "topic-insights" | "research-project";
                  sourceId: string;
                  sourceName?: string;
                }
              | undefined,
            preset: dto.preset,
            skillOverrides: dto.skillOverrides,
            intent: dto.intent,
            language: dto.language,
            autoRoute: dto.autoRoute,
          });

          try {
            for await (const event of generator) {
              const sseData = `data: ${JSON.stringify(event)}\n\n`;
              res.write(sseData);
              this.logger.log(`[generateTeam] Sent SSE event: ${event.type}`);
            }
            this.logger.log("[generateTeam] SSE stream completed");
          } catch (error) {
            this.logger.error("[generateTeam] Error:", error);
            const errorEvent = {
              type: "error",
              timestamp: new Date().toISOString(),
              error:
                error instanceof Error
                  ? error.message
                  : "Team generation failed",
            };
            res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
          } finally {
            res.end();
          }
        },
      ),
    );
  }

  // ============================================
  // Checkpoint API
  // ============================================

  /**
   * 获取会话的检查点列表
   */
  @Get("sessions/:sessionId/checkpoints")
  async getCheckpoints(
    @Param("sessionId") sessionId: string,
    @Query("limit") limit?: string,
  ): Promise<object> {
    this.logger.log(`[getCheckpoints] Session: ${sessionId}`);

    try {
      let checkpoints = await this.checkpointService.list({
        sessionId,
      });

      // Apply limit if specified
      const limitNum = limit ? parseInt(limit, 10) : 50;
      if (checkpoints.length > limitNum) {
        checkpoints = checkpoints.slice(0, limitNum);
      }

      return {
        checkpoints,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to get checkpoints";
      this.logger.error(`[getCheckpoints] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 手动创建检查点
   * 用于用户手动保存当前状态
   */
  @Post("sessions/:sessionId/checkpoints")
  async createCheckpoint(
    @Param("sessionId") sessionId: string,
    @Body() dto: CreateCheckpointDto,
  ): Promise<object> {
    this.logger.log(
      `[createCheckpoint] Session: ${sessionId}, Name: ${dto.name || "auto"}`,
    );

    try {
      // 获取最新检查点的状态
      const latestCheckpoint =
        await this.checkpointService.getLatestCheckpoint(sessionId);

      if (!latestCheckpoint) {
        throw new BadRequestException(
          "No existing checkpoint found. Cannot create a new checkpoint without state.",
        );
      }

      // 创建新检查点
      const checkpoint = await this.checkpointService.create({
        sessionId,
        name: dto.name,
        type:
          (dto.type as
            | "task_decomposition"
            | "outline_confirmed"
            | "page_rendered"
            | "batch_rendered"
            | "user_modified"
            | "auto_save") || "user_modified",
        state: latestCheckpoint.state,
        metadata: {
          trigger: "user",
          description: dto.name || "User created checkpoint",
        },
      });

      return {
        checkpoint: {
          id: checkpoint.id,
          name: checkpoint.name,
          type: checkpoint.type,
          version: checkpoint.version,
          timestamp: checkpoint.timestamp,
        },
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create checkpoint";
      this.logger.error(`[createCheckpoint] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 获取单个检查点详情
   */
  @Get("checkpoints/:checkpointId")
  async getCheckpoint(
    @Param("checkpointId") checkpointId: string,
  ): Promise<object> {
    this.logger.log(`[getCheckpoint] Checkpoint: ${checkpointId}`);

    try {
      // ★ Read-only: use get() instead of restore() to avoid side effects
      const checkpoint = await this.checkpointService.get(checkpointId);

      this.logger.log(
        `[getCheckpoint] pages=${checkpoint.state?.pages?.length || 0}, hasOutline=${!!checkpoint.state?.outlinePlan}`,
      );

      return {
        sessionId: checkpoint.sessionId,
        checkpointId,
        state: checkpoint.state,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Checkpoint not found";
      this.logger.error(`[getCheckpoint] Error: ${errorMessage}`);
      throw new NotFoundException(errorMessage);
    }
  }

  /**
   * 恢复到指定检查点
   */
  @Post("restore/:checkpointId")
  async restoreCheckpoint(
    @Param("checkpointId") checkpointId: string,
  ): Promise<object> {
    this.logger.log(`[restoreCheckpoint] Restoring to: ${checkpointId}`);

    try {
      const result = await this.slidesEngine.restoreCheckpoint(checkpointId);

      // Fetch session title for the frontend
      const session = await this.checkpointService.getSession(result.sessionId);

      return {
        message: "Checkpoint restored successfully",
        sessionId: result.sessionId,
        sessionTitle: session?.title || null,
        checkpointId,
        state: {
          pagesCount: result.state.pages?.length || 0,
          hasOutline: !!result.state.outlinePlan,
          hasTaskDecomposition: !!result.state.taskDecomposition,
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to restore checkpoint";
      this.logger.error(`[restoreCheckpoint] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 重新渲染指定页面
   */
  @Post("sessions/:sessionId/rerender/:pageNumber")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async rerenderPage(
    @Param("sessionId") sessionId: string,
    @Param("pageNumber") pageNumber: string,
    @Body() dto: RerenderPageDto,
  ): Promise<object> {
    this.logger.log(
      `[rerenderPage] Session: ${sessionId}, Page: ${pageNumber}`,
    );

    try {
      const pageNum = parseInt(pageNumber, 10);
      const events = await this.slidesEngine.regeneratePage(
        sessionId,
        pageNum,
        dto.feedback,
      );

      return {
        events,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to rerender page";
      this.logger.error(`[rerenderPage] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  // ============================================
  // Session API
  // ============================================

  /**
   * 获取会话列表
   */
  @Get("sessions")
  async getSessions(
    @Req() req: RequestWithUser,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ): Promise<object> {
    const userId = req.user.id;
    this.logger.log(`[getSessions] Getting sessions for user: ${userId}`);

    try {
      const sessions = await this.checkpointService.getSessions({
        userId,
        status: status as "active" | "completed" | "archived" | undefined,
        limit: limit ? parseInt(limit, 10) : 50,
      });

      // 获取每个会话的最新检查点信息
      const sessionsWithCheckpoints = await Promise.all(
        sessions.map(async (session) => {
          const latestCheckpoint =
            await this.checkpointService.getLatestCheckpoint(session.id);
          return {
            ...session,
            latestCheckpoint: latestCheckpoint
              ? {
                  id: latestCheckpoint.id,
                  type: latestCheckpoint.type,
                  timestamp: latestCheckpoint.timestamp,
                  pagesCount: latestCheckpoint.state?.pages?.length || 0,
                }
              : null,
          };
        }),
      );

      // 批量查询每个 session 最新 mission 的 sourceSubscription
      const sessionIds = sessionsWithCheckpoints.map((s) => s.id);
      const missionSubs = await this.prisma.slidesMission.findMany({
        where: { sessionId: { in: sessionIds } },
        orderBy: { createdAt: "desc" },
        select: { sessionId: true, sourceSubscription: true },
      });

      // 建立 sessionId -> 最新 sourceSubscription 的映射
      const subMap = new Map<string, unknown>();
      for (const m of missionSubs) {
        if (!subMap.has(m.sessionId)) {
          subMap.set(m.sessionId, m.sourceSubscription ?? null);
        }
      }

      const result = sessionsWithCheckpoints.map((s) => ({
        ...s,
        sourceSubscription: subMap.get(s.id) ?? null,
      }));

      return {
        sessions: result,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to get sessions";
      this.logger.error(`[getSessions] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 获取单个会话详情
   */
  @Get("sessions/:sessionId")
  async getSession(@Param("sessionId") sessionId: string): Promise<object> {
    this.logger.log(`[getSession] Session: ${sessionId}`);

    try {
      const session = await this.checkpointService.getSession(sessionId);

      if (!session) {
        throw new NotFoundException("Session not found");
      }

      // 获取最新检查点
      const latestCheckpoint =
        await this.checkpointService.getLatestCheckpoint(sessionId);

      // 获取最新 mission 的 sourceSubscription
      const latestMission = await this.prisma.slidesMission.findFirst({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        select: { sourceSubscription: true },
      });

      return {
        session,
        latestCheckpoint: latestCheckpoint
          ? {
              id: latestCheckpoint.id,
              type: latestCheckpoint.type,
              timestamp: latestCheckpoint.timestamp,
              pagesCount: latestCheckpoint.state?.pages?.length || 0,
            }
          : null,
        sourceSubscription: latestMission?.sourceSubscription ?? null,
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : "Failed to get session";
      this.logger.error(`[getSession] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  // ============================================
  // Export API
  // ============================================

  /**
   * 导出幻灯片
   */
  @Post("sessions/:sessionId/export")
  async exportSlides(
    @Param("sessionId") sessionId: string,
    @Body() dto: ExportDto,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(
      `[exportSlides] Session: ${sessionId}, Format: ${dto.format}`,
    );

    try {
      let buffer: Buffer;

      switch (dto.format) {
        case "pptx":
          buffer = await this.slidesEngine.exportPptx(sessionId);
          res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          );
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="presentation-${sessionId}.pptx"`,
          );
          break;
        case "pdf":
          buffer = await this.slidesEngine.exportPdf(sessionId);
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="presentation-${sessionId}.pdf"`,
          );
          break;
        default:
          throw new HttpException(
            `Export format '${dto.format}' not supported`,
            HttpStatus.BAD_REQUEST,
          );
      }

      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : "Export failed";
      this.logger.error(`[exportSlides] Error: ${errorMessage}`);
      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ============================================
  // Session Management API
  // ============================================

  /**
   * 归档会话
   */
  @Post("sessions/:sessionId/archive")
  async archiveSession(@Param("sessionId") sessionId: string): Promise<object> {
    this.logger.log(`[archiveSession] Session: ${sessionId}`);

    try {
      await this.checkpointService.updateSessionStatus(sessionId, "archived");

      return {
        message: "Session archived successfully",
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to archive session";
      this.logger.error(`[archiveSession] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 更新订阅状态（刷新或取消订阅）
   */
  @Patch("sessions/:sessionId/subscription")
  async updateSubscription(
    @Req() req: RequestWithUser,
    @Param("sessionId") sessionId: string,
    @Body() dto: UpdateSubscriptionDto,
  ): Promise<object> {
    const userId = req.user.id;
    this.logger.log(
      `[updateSubscription] Session: ${sessionId}, Action: ${dto.action}, User: ${userId}`,
    );

    try {
      if (dto.action === "unsubscribe") {
        await this.prisma.slidesMission.updateMany({
          where: { sessionId, userId },
          data: {
            sourceSubscription: Prisma.JsonNull,
          },
        });
        return { success: true };
      }

      // action === 'refresh'
      const latestMission = await this.prisma.slidesMission.findFirst({
        where: { sessionId, userId },
        orderBy: { createdAt: "desc" },
        select: { sourceSubscription: true, id: true },
      });

      const sub = latestMission?.sourceSubscription as {
        type?: string;
        sourceId?: string;
      } | null;

      if (!sub?.type || !sub?.sourceId) {
        throw new BadRequestException(
          "No source subscription found for this session",
        );
      }

      let sourceText = "";
      if (sub.type === "topic-insights") {
        const imported = await this.dataImportService.importFromResearch(
          sub.sourceId,
          userId,
        );
        sourceText = imported.sourceText;
      } else if (sub.type === "research-project") {
        const imported = await this.dataImportService.importFromResearchProject(
          sub.sourceId,
          userId,
        );
        sourceText = imported.sourceText;
      }

      const now = new Date().toISOString();
      const updatedSub = { ...sub, isStale: false, lastSourceUpdatedAt: now };

      if (latestMission?.id) {
        await this.prisma.slidesMission.update({
          where: { id: latestMission.id },
          data: {
            sourceSubscription: updatedSub as unknown as Prisma.InputJsonValue,
          },
        });
      }

      return {
        success: true,
        subscription: { isStale: false, lastSourceUpdatedAt: now },
        sourceText,
      };
    } catch (error: unknown) {
      if (
        error instanceof HttpException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to update subscription";
      this.logger.error(`[updateSubscription] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 更新会话标题
   */
  @Patch("sessions/:sessionId")
  async updateSession(
    @Param("sessionId") sessionId: string,
    @Body() dto: UpdateSessionDto,
  ): Promise<object> {
    this.logger.log(
      `[updateSession] Session: ${sessionId}, Title: ${dto.title}`,
    );

    try {
      const session = await this.checkpointService.updateSessionTitle(
        sessionId,
        dto.title,
      );

      return {
        session,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to update session";
      this.logger.error(`[updateSession] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 删除会话
   */
  @Delete("sessions/:sessionId")
  async deleteSession(@Param("sessionId") sessionId: string): Promise<object> {
    this.logger.log(`[deleteSession] Session: ${sessionId}`);

    try {
      await this.checkpointService.deleteSession(sessionId);

      return {
        message: "Session deleted successfully",
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to delete session";
      this.logger.error(`[deleteSession] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 清理旧检查点
   */
  @Post("sessions/:sessionId/prune")
  async pruneCheckpoints(
    @Param("sessionId") sessionId: string,
    @Query("keepCount") keepCount?: string,
  ): Promise<object> {
    this.logger.log(`[pruneCheckpoints] Session: ${sessionId}`);

    try {
      const keepLast = keepCount ? parseInt(keepCount, 10) : 10;
      const count = await this.checkpointService.prune(sessionId, keepLast);

      return {
        message: `Pruned ${count} checkpoints`,
        prunedCount: count,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to prune checkpoints";
      this.logger.error(`[pruneCheckpoints] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  // ============================================
  // Data Source API (v5.0)
  // ============================================

  /**
   * 获取可导入的 Research 专题列表
   */
  @Get("sources/research")
  async listResearchSources(@Req() req: RequestWithUser): Promise<object> {
    const userId = req.user.id;
    this.logger.log(`[listResearchSources] User: ${userId}`);

    try {
      const sources = await this.dataImportService.listResearchTopics(userId);
      return { sources };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to list research sources";
      this.logger.error(`[listResearchSources] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 获取可导入的 Writing 项目列表
   */
  @Get("sources/writing")
  async listWritingSources(@Req() req: RequestWithUser): Promise<object> {
    const userId = req.user.id;
    this.logger.log(`[listWritingSources] User: ${userId}`);

    try {
      const sources = await this.dataImportService.listWritingProjects(userId);
      return { sources };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to list writing sources";
      this.logger.error(`[listWritingSources] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 获取可导入的 Teams 话题列表
   */
  @Get("sources/teams")
  async listTeamsSources(@Req() req: RequestWithUser): Promise<object> {
    const userId = req.user.id;
    this.logger.log(`[listTeamsSources] User: ${userId}`);

    try {
      const sources = await this.dataImportService.listTeamsTopics(userId);
      return { sources };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to list teams sources";
      this.logger.error(`[listTeamsSources] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 获取可导入的 Library 资源列表
   */
  @Get("sources/library")
  async listLibrarySources(
    @Req() req: RequestWithUser,
    @Query("type") type?: string,
  ): Promise<object> {
    const userId = req.user.id;
    this.logger.log(`[listLibrarySources] User: ${userId}, Type: ${type}`);

    try {
      const sources = await this.dataImportService.listLibraryResources(
        userId,
        type,
      );
      return { sources };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to list library sources";
      this.logger.error(`[listLibrarySources] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 从 Research 专题导入数据
   */
  @Post("import/research/:topicId")
  async importFromResearch(
    @Req() req: RequestWithUser,
    @Param("topicId") topicId: string,
  ): Promise<object> {
    const userId = req.user.id;
    this.logger.log(`[importFromResearch] Topic: ${topicId}, User: ${userId}`);

    try {
      const data = await this.dataImportService.importFromResearch(
        topicId,
        userId,
      );
      return { data };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to import from research";
      this.logger.error(`[importFromResearch] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 获取可导入的 Research Project 列表
   */
  @Get("sources/research-project")
  async listResearchProjectSources(
    @Req() req: RequestWithUser,
  ): Promise<object> {
    const userId = req.user.id;
    this.logger.log(`[listResearchProjectSources] User: ${userId}`);

    try {
      const sources = await this.dataImportService.listResearchProjects(userId);
      return { sources };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to list research project sources";
      this.logger.error(`[listResearchProjectSources] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 从 Research Project 导入数据
   */
  @Post("import/research-project/:projectId")
  async importFromResearchProject(
    @Req() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ): Promise<object> {
    const userId = req.user.id;
    this.logger.log(
      `[importFromResearchProject] Project: ${projectId}, User: ${userId}`,
    );

    try {
      const data = await this.dataImportService.importFromResearchProject(
        projectId,
        userId,
      );
      return { data };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to import from research project";
      this.logger.error(`[importFromResearchProject] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 从 Writing 项目导入数据
   */
  @Post("import/writing/:projectId")
  async importFromWriting(
    @Req() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ): Promise<object> {
    const userId = req.user.id;
    this.logger.log(
      `[importFromWriting] Project: ${projectId}, User: ${userId}`,
    );

    try {
      const data = await this.dataImportService.importFromWriting(
        projectId,
        userId,
      );
      return { data };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to import from writing";
      this.logger.error(`[importFromWriting] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 从 Teams 话题导入数据
   */
  @Post("import/teams/:topicId")
  async importFromTeams(
    @Req() req: RequestWithUser,
    @Param("topicId") topicId: string,
  ): Promise<object> {
    const userId = req.user.id;
    this.logger.log(`[importFromTeams] Topic: ${topicId}, User: ${userId}`);

    try {
      const data = await this.dataImportService.importFromTeams(
        topicId,
        userId,
      );
      return { data };
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : "Failed to import from teams";
      this.logger.error(`[importFromTeams] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 从 Library 导入资源
   */
  @Post("import/library")
  async importFromLibrary(
    @Req() req: RequestWithUser,
    @Body() dto: ImportFromLibraryDto,
  ): Promise<object> {
    const userId = req.user.id;
    this.logger.log(
      `[importFromLibrary] Resources: ${dto.resourceIds.length}, User: ${userId}`,
    );

    if (!dto.resourceIds || dto.resourceIds.length === 0) {
      throw new BadRequestException("resourceIds is required");
    }

    try {
      const assets = await this.dataImportService.importFromLibrary(
        dto.resourceIds,
        userId,
      );
      return { assets };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to import from library";
      this.logger.error(`[importFromLibrary] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  // ============================================
  // AI Edit API (v5.0)
  // ============================================

  /**
   * 修复布局问题
   * POST /ai-office/slides/edit/fix-layout/:missionId/:pageIndex
   */
  @Post("edit/fix-layout/:missionId/:pageIndex")
  @RateLimit({
    maxRequests: 30,
    windowSeconds: 60,
    message: "编辑请求过于频繁，请稍后重试",
  })
  async fixLayout(
    @Req() req: RequestWithUser,
    @Param("missionId") missionId: string,
    @Param("pageIndex") pageIndex: string,
  ) {
    const userId = req.user.id;
    this.logger.log(
      `[fixLayout] Mission: ${missionId}, Page: ${pageIndex}, User: ${userId}`,
    );

    try {
      const result = await this.aiEditService.fixLayout(
        missionId,
        parseInt(pageIndex, 10),
        userId,
      );
      return { data: result };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to fix layout";
      this.logger.error(`[fixLayout] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 润色内容
   * POST /ai-office/slides/edit/polish/:missionId
   */
  @Post("edit/polish/:missionId")
  @RateLimit({
    maxRequests: 20,
    windowSeconds: 60,
    message: "编辑请求过于频繁，请稍后重试",
  })
  async polishContent(
    @Req() req: RequestWithUser,
    @Param("missionId") missionId: string,
    @Body() options: PolishOptions,
  ) {
    const userId = req.user.id;
    this.logger.log(`[polishContent] Mission: ${missionId}, User: ${userId}`);

    try {
      const result = await this.aiEditService.polishContent(
        missionId,
        options,
        userId,
      );
      return { data: result };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to polish content";
      this.logger.error(`[polishContent] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 事实核查
   * POST /ai-office/slides/edit/fact-check/:missionId
   */
  @Post("edit/fact-check/:missionId")
  @RateLimit({
    maxRequests: 10,
    windowSeconds: 60,
    message: "编辑请求过于频繁，请稍后重试",
  })
  async factCheck(
    @Req() req: RequestWithUser,
    @Param("missionId") missionId: string,
    @Query("strictMode") strictMode?: string,
  ) {
    const userId = req.user.id;
    this.logger.log(
      `[factCheck] Mission: ${missionId}, User: ${userId}, Strict: ${strictMode}`,
    );

    try {
      const result = await this.aiEditService.factCheck(
        missionId,
        strictMode === "true",
        userId,
      );
      return { data: result };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to fact check";
      this.logger.error(`[factCheck] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * AI 对话式编辑指定幻灯片页面
   * POST /ai-office/slides/sessions/:sessionId/chat-edit
   */
  @Post("sessions/:sessionId/chat-edit")
  @RateLimit({
    maxRequests: 30,
    windowSeconds: 60,
    message: "编辑请求过于频繁，请稍后重试",
  })
  async chatEdit(
    @Req() req: RequestWithUser,
    @Param("sessionId") sessionId: string,
    @Body() dto: ChatEditDto,
  ): Promise<{ data: ChatEditResult }> {
    const userId = req.user.id;
    this.logger.log(
      `[chatEdit] Session: ${sessionId}, Page: ${dto.pageIndex}, User: ${userId}`,
    );

    try {
      const result = await this.aiEditService.chatEdit(
        sessionId,
        dto.pageIndex,
        dto.instruction,
        userId,
      );
      return { data: result };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Chat edit failed";
      this.logger.error(`[chatEdit] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  // ============================================
  // Voice Narration API (V5.0)
  // ============================================

  /**
   * 生成语音旁白
   * POST /ai-office/slides/narrations/:missionId
   */
  @Post("narrations/:missionId")
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({
    maxRequests: 5,
    windowSeconds: 60,
    message: "旁白生成请求过于频繁，请稍后重试",
  })
  async generateNarrations(
    @Req() req: RequestWithUser,
    @Param("missionId") missionId: string,
    @Body() dto: GenerateNarrationDto,
  ) {
    const userId = req.user.id;
    this.logger.log(
      `[generateNarrations] Mission: ${missionId}, User: ${userId}`,
    );

    try {
      // Get mission with pages
      const mission = await this.prisma.slidesMission.findUnique({
        where: { id: missionId },
        select: {
          id: true,
          userId: true,
          sourceText: true,
          pages: true,
        },
      });

      if (!mission) {
        throw new NotFoundException("Mission not found");
      }

      if (mission.userId !== userId) {
        throw new BadRequestException("Unauthorized access to mission");
      }

      // Parse pages from JSON
      const pagesJson = mission.pages as unknown[];
      if (!Array.isArray(pagesJson) || pagesJson.length === 0) {
        throw new BadRequestException("No pages found in mission");
      }

      // Convert to NarrationSlidePage format
      const pages: NarrationSlidePage[] = pagesJson.map(
        (page: unknown, index: number) => {
          const p = page as {
            title?: string;
            html?: string;
            content?: string;
            keyPoints?: string[];
          };
          return {
            index: index + 1,
            title: p.title || `第 ${index + 1} 页`,
            content: p.html || p.content || "",
            keyPoints: p.keyPoints,
          };
        },
      );

      // Generate narrations
      const context = {
        executionId: `narration-${missionId}-${Date.now()}`,
        skillId: this.voiceNarrationSkill.id,
        userId,
        sessionId: missionId,
        createdAt: new Date(),
      };

      const result = await this.voiceNarrationSkill.execute(
        {
          pages,
          presentationTitle: (mission.sourceText || "").slice(0, 100),
          style: dto.style,
          language: dto.language,
          targetAudience: dto.targetAudience,
          wordsPerMinute: dto.wordsPerMinute,
        },
        context,
      );

      if (!result.success || !result.data) {
        throw new InternalServerErrorException(
          result.error?.message || "Failed to generate narrations",
        );
      }

      // Save narrations to database
      const { narrations, totalDuration, stats } = result.data;

      for (const narration of narrations) {
        await this.prisma.slidesNarration.upsert({
          where: {
            missionId_pageIndex: {
              missionId,
              pageIndex: narration.pageIndex,
            },
          },
          create: {
            missionId,
            pageIndex: narration.pageIndex,
            script: narration.script,
            duration: narration.estimatedDuration,
          },
          update: {
            script: narration.script,
            duration: narration.estimatedDuration,
          },
        });
      }

      return {
        data: {
          narrations: narrations.map((n) => ({
            pageIndex: n.pageIndex,
            script: n.script,
            estimatedDuration: n.estimatedDuration,
          })),
          totalDuration,
          stats,
        },
      };
    } catch (error: unknown) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to generate narrations";
      this.logger.error(`[generateNarrations] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /**
   * 获取语音旁白列表
   * GET /ai-office/slides/narrations/:missionId
   */
  @Get("narrations/:missionId")
  @UseGuards(JwtAuthGuard)
  async getNarrations(
    @Req() req: RequestWithUser,
    @Param("missionId") missionId: string,
  ) {
    const userId = req.user.id;
    this.logger.log(`[getNarrations] Mission: ${missionId}, User: ${userId}`);

    try {
      // Verify mission ownership
      const mission = await this.prisma.slidesMission.findUnique({
        where: { id: missionId },
        select: { userId: true },
      });

      if (!mission) {
        throw new NotFoundException("Mission not found");
      }

      if (mission.userId !== userId) {
        throw new BadRequestException("Unauthorized access to mission");
      }

      // Get narrations
      const narrations = await this.prisma.slidesNarration.findMany({
        where: { missionId },
        orderBy: { pageIndex: "asc" },
        select: {
          pageIndex: true,
          script: true,
          audioUrl: true,
          voiceId: true,
          duration: true,
        },
      });

      return {
        data: {
          narrations: narrations.map((n) => ({
            pageIndex: n.pageIndex,
            script: n.script,
            audioUrl: n.audioUrl,
            estimatedDuration: n.duration,
          })),
          totalDuration: narrations.reduce(
            (sum, n) => sum + (n.duration || 0),
            0,
          ),
        },
      };
    } catch (error: unknown) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : "Failed to get narrations";
      this.logger.error(`[getNarrations] Error: ${errorMessage}`);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  // ============================================
  // Kernel Context Helper
  // ============================================

  /**
   * Wrap an async operation in MissionContext for process tracking.
   * Creates a kernel process, runs the callback with processId in context,
   * and completes/fails the process when done.
   */
  private async withMissionContext<T>(
    userId: string,
    operationType: string,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    if (!this.missionExecutor) {
      return fn();
    }

    let processId: string | undefined;
    try {
      const kr = await this.missionExecutor.execute({
        userId,
        agentId: `slides:${operationType}`,
        input: { action: operationType },
      });
      processId = kr.processId;
    } catch {
      /* kernel optional */
    }

    if (!processId) {
      return fn();
    }

    try {
      const result = await MissionContext.run(
        { agentProcessId: processId, userId },
        async () => fn(),
      );
      void this.missionExecutor
        .complete(processId)
        .catch((err) =>
          this.logger.debug("Mission completion cleanup failed", err),
        );
      return result;
    } catch (error) {
      void this.missionExecutor
        .fail(processId, error instanceof Error ? error.message : String(error))
        .catch((err) =>
          this.logger.debug("Mission failure cleanup failed", err),
        );
      throw error;
    }
  }
}
