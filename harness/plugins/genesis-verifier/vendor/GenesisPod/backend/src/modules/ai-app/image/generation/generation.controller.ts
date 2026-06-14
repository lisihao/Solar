import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Delete,
  UseGuards,
  Request,
  Logger,
  UseInterceptors,
  UploadedFiles,
  Sse,
  Query,
  MessageEvent,
  Res,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { FilesInterceptor } from "@nestjs/platform-express";
import { Observable } from "rxjs";
import { Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "crypto";
import { AiImageService } from "./generation.service";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";

interface AuthenticatedRequest {
  user?: {
    id: string;
    email: string;
  };
}

interface GenerateImageDto {
  // 输入内容 - 支持多种来源
  prompt?: string; // 直接输入的提示词或文本
  urls?: string[]; // 多个URL (文章、视频等)
  content?: string; // 大块文本 (论文、字幕等)
  imageBase64?: string; // 参考图片的 Base64
  referenceImageUrl?: string; // 参考图片的 URL (后端代理获取)

  // 模型选择
  textModelId?: string; // 文本模型ID (用于分析内容生成提示词)
  imageModelId?: string; // 图片模型ID (用于生成图片)

  // 生成选项
  style?: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3";
  negativePrompt?: string;

  // 是否跳过提示词优化 (直接使用用户输入)
  skipEnhancement?: boolean;
}

@ApiTags("AI Image")
@Controller("ai-image")
export class AiImageController {
  private readonly logger = new Logger(AiImageController.name);

  constructor(
    private readonly aiImageService: AiImageService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * S3 audit fix（2026-05-04）：admin key 改 ENV + timing-safe 比对
   * - 必须设置 IMAGE_ADMIN_CLEANUP_KEY ENV，否则 endpoint 直接 503
   * - timingSafeEqual 防 timing attack
   */
  private assertAdminKey(provided: string): void {
    const expected = this.configService.get<string>("IMAGE_ADMIN_CLEANUP_KEY");
    if (!expected) {
      throw new ForbiddenException("Admin endpoint not configured");
    }
    const a = Buffer.from(provided ?? "");
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException("Invalid key");
    }
  }

  @Get("models")
  @UseGuards(JwtAuthGuard)
  async getAvailableModels() {
    return this.aiImageService.getAvailableModels();
  }

  @Post("generate")
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async generateImage(
    @Body() dto: GenerateImageDto,
    @Request() req: AuthenticatedRequest,
  ) {
    this.logger.log(`Generating image for user ${req.user?.id}`);

    // 如果提供了 referenceImageUrl，后端代理获取并转换为 base64
    let imageBase64 = dto.imageBase64;
    if (!imageBase64 && dto.referenceImageUrl) {
      try {
        this.logger.log(
          `Fetching reference image from: ${dto.referenceImageUrl}`,
        );
        const response = await fetch(dto.referenceImageUrl);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          imageBase64 = Buffer.from(buffer).toString("base64");
          this.logger.log(
            `Reference image fetched, size: ${buffer.byteLength}`,
          );
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch reference image: ${error}`);
      }
    }

    return this.aiImageService.generateImage({
      prompt: dto.prompt,
      urls: dto.urls,
      content: dto.content,
      imageBase64,
      textModelId: dto.textModelId,
      imageModelId: dto.imageModelId,
      style: dto.style,
      aspectRatio: dto.aspectRatio,
      negativePrompt: dto.negativePrompt,
      skipEnhancement: dto.skipEnhancement,
      userId: req.user?.id,
    });
  }

  /**
   * SSE 流式生成图片 - 实时推送处理进度 (GET方式，适用于短prompt)
   * 前端使用 EventSource 连接此端点
   */
  @Sse("generate/stream")
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  generateImageStream(
    @Query("prompt") prompt: string,
    @Query("urls") urls: string,
    @Query("content") content: string,
    @Query("imageModelId") imageModelId: string,
    @Query("textModelId") textModelId: string,
    @Query("style") style: string,
    @Query("aspectRatio") aspectRatio: string,
    @Query("negativePrompt") negativePrompt: string,
    @Query("skipEnhancement") skipEnhancement: string,
    @Query("templateLayout") templateLayout: string,
    @Request() req: AuthenticatedRequest,
  ): Observable<MessageEvent> {
    return this.handleStreamGeneration({
      prompt,
      urls,
      content,
      imageModelId,
      textModelId,
      style,
      aspectRatio,
      negativePrompt,
      skipEnhancement,
      templateLayout,
      userId: req.user?.id,
    });
  }

  /**
   * SSE 流式生成图片 - POST方式，支持长prompt
   * 解决GET请求URL长度限制问题
   * 手动设置SSE响应头，因为@Sse装饰器只支持GET
   */
  @Post("generate/stream")
  @UseGuards(JwtAuthGuard)
  generateImageStreamPost(
    @Body()
    body: {
      prompt?: string;
      urls?: string;
      content?: string;
      imageModelId?: string;
      textModelId?: string;
      style?: string;
      aspectRatio?: string;
      negativePrompt?: string;
      skipEnhancement?: string;
      templateLayout?: string;
    },
    @Request() req: AuthenticatedRequest,
    @Res() res: Response,
  ): void {
    // 设置SSE响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    // 禁用Nagle算法，确保数据立即发送
    if (res.socket) {
      res.socket.setNoDelay(true);
    }
    res.flushHeaders();

    this.logger.log(`SSE POST: Starting stream for user ${req.user?.id}`);

    const observable = this.handleStreamGeneration({
      ...body,
      userId: req.user?.id,
    });

    // 订阅Observable并发送SSE事件
    const subscription = observable.subscribe({
      next: (event: MessageEvent) => {
        const data = `data: ${event.data}\n\n`;
        res.write(data);
        // 尝试立即flush（如果可用）
        const resWithFlush = res as Response & { flush?: () => void };
        if (typeof resWithFlush.flush === "function") {
          resWithFlush.flush();
        }
      },
      error: (err) => {
        this.logger.error(`SSE POST error: ${err.message}`);
        res.write(
          `data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`,
        );
        res.end();
      },
      complete: () => {
        this.logger.log(`SSE POST: Stream completed`);
        res.end();
      },
    });

    // 客户端断开时取消订阅
    res.on("close", () => {
      this.logger.log(`SSE POST: Client disconnected`);
      subscription.unsubscribe();
    });
  }

  /**
   * 统一处理流式生成的内部方法
   */
  private handleStreamGeneration(params: {
    prompt?: string;
    urls?: string;
    content?: string;
    imageModelId?: string;
    textModelId?: string;
    style?: string;
    aspectRatio?: string;
    negativePrompt?: string;
    skipEnhancement?: string;
    templateLayout?: string;
    userId?: string;
  }): Observable<MessageEvent> {
    const {
      prompt,
      urls,
      content,
      imageModelId,
      textModelId,
      style,
      aspectRatio,
      negativePrompt,
      skipEnhancement,
      templateLayout,
      userId,
    } = params;

    this.logger.log(`SSE: Starting stream generation for user ${userId}`);

    const parsedUrls = urls
      ? urls.split(",").filter((u) => u.trim())
      : undefined;
    const validAspectRatio = ["1:1", "16:9", "9:16", "4:3"].includes(
      aspectRatio || "",
    )
      ? (aspectRatio as "1:1" | "16:9" | "9:16" | "4:3")
      : undefined;
    const validTemplateLayouts = [
      "cards",
      "center_visual",
      "timeline",
      "comparison",
      "pyramid",
      "radial",
    ];
    const validTemplateLayout = validTemplateLayouts.includes(
      templateLayout || "",
    )
      ? (templateLayout as
          | "cards"
          | "center_visual"
          | "timeline"
          | "comparison"
          | "pyramid"
          | "radial")
      : undefined;

    return this.aiImageService.generateImageStream({
      prompt: prompt || undefined,
      urls: parsedUrls,
      content: content || undefined,
      imageModelId: imageModelId || undefined,
      textModelId: textModelId || undefined,
      style: style || undefined,
      aspectRatio: validAspectRatio,
      negativePrompt: negativePrompt || undefined,
      skipEnhancement: skipEnhancement === "true",
      templateLayout: validTemplateLayout,
      userId,
    });
  }

  @Post("generate-with-files")
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor("files", 10, {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max per file
    }),
  )
  async generateImageWithFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: GenerateImageDto,
    @Request() req: AuthenticatedRequest,
  ) {
    this.logger.log(
      `Generating image with ${files?.length || 0} files for user ${req.user?.id}`,
    );

    // 处理上传的文件
    const fileContents: Array<{
      buffer: Buffer;
      mimeType: string;
      filename: string;
    }> = [];

    if (files && files.length > 0) {
      for (const file of files) {
        fileContents.push({
          buffer: file.buffer,
          mimeType: file.mimetype,
          filename: file.originalname,
        });
      }
    }

    return this.aiImageService.generateImage({
      prompt: dto.prompt,
      urls: dto.urls
        ? Array.isArray(dto.urls)
          ? dto.urls
          : [dto.urls]
        : undefined,
      content: dto.content,
      imageBase64: dto.imageBase64,
      files: fileContents,
      textModelId: dto.textModelId,
      imageModelId: dto.imageModelId,
      style: dto.style,
      aspectRatio: dto.aspectRatio,
      negativePrompt: dto.negativePrompt,
      skipEnhancement: dto.skipEnhancement,
      userId: req.user?.id,
    });
  }

  @Get("history")
  @UseGuards(JwtAuthGuard)
  async getHistory(@Request() req: AuthenticatedRequest) {
    return this.aiImageService.getHistory(req.user?.id);
  }

  @Get("bookmarks")
  @UseGuards(JwtAuthGuard)
  async getBookmarkedImages(@Request() req: AuthenticatedRequest) {
    return this.aiImageService.getBookmarkedImages(req.user?.id);
  }

  /**
   * Get public image for sharing (no auth required)
   * Only returns PUBLIC visibility images
   */
  @Get("public/:id")
  async getPublicImage(@Param("id") id: string) {
    const image = await this.aiImageService.getPublicImage(id);
    if (!image) {
      throw new NotFoundException("Image not found or not public");
    }
    return image;
  }

  /**
   * 管理员查看图片统计（必须放在 :id 路由之前）
   */
  @Get("stats")
  async getImageStats(@Query("key") key: string) {
    this.assertAdminKey(key);
    return this.aiImageService.getImageStats();
  }

  /**
   * 管理员删除所有图片（必须放在 :id 路由之前）
   * 使用密钥验证，不需要登录
   */
  @Delete("delete-all")
  async adminDeleteAllImages(@Query("key") key: string) {
    this.assertAdminKey(key);
    this.logger.log("Admin delete all images triggered");
    const result = await this.aiImageService.deleteAllImages();
    return {
      deletedCount: result,
      message: `Deleted ${result} images`,
    };
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  async getImage(@Param("id") id: string) {
    return this.aiImageService.getImage(id);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  async deleteImage(
    @Param("id") id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    this.logger.log(`Deleting image ${id} for user ${req.user?.id}`);
    return this.aiImageService.deleteImage(id, req.user?.id);
  }

  @Post(":id/bookmark")
  @UseGuards(JwtAuthGuard)
  async addBookmark(
    @Param("id") id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    this.logger.log(`Adding bookmark for image ${id} by user ${req.user?.id}`);
    return this.aiImageService.addBookmark(id, req.user?.id);
  }

  @Delete(":id/bookmark")
  @UseGuards(JwtAuthGuard)
  async removeBookmark(
    @Param("id") id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    this.logger.log(
      `Removing bookmark for image ${id} by user ${req.user?.id}`,
    );
    return this.aiImageService.removeBookmark(id, req.user?.id);
  }

  @Post(":id/visibility")
  @UseGuards(JwtAuthGuard)
  async updateVisibility(
    @Param("id") id: string,
    @Body("visibility") visibility: "PRIVATE" | "PUBLIC",
    @Request() req: AuthenticatedRequest,
  ) {
    this.logger.log(
      `Updating visibility for image ${id} to ${visibility} by user ${req.user?.id}`,
    );
    return this.aiImageService.updateVisibility(id, visibility, req.user?.id);
  }

  /**
   * 手动触发清理旧图片
   * 保留最新的20张未收藏图片，删除其余的
   */
  @Post("cleanup")
  @UseGuards(JwtAuthGuard)
  async cleanupOldImages(@Request() req: AuthenticatedRequest) {
    this.logger.log(`Manual cleanup triggered by user ${req.user?.id}`);
    const deletedCount = await this.aiImageService.cleanupOldImages(
      req.user?.id ?? null,
    );
    return {
      deletedCount,
      message: `Cleaned up ${deletedCount} old images`,
    };
  }

  /**
   * 管理员清理所有用户的旧图片
   * 使用密钥验证，不需要登录
   */
  @Post("cleanup-all")
  async adminCleanupAllImages(@Query("key") key: string) {
    this.assertAdminKey(key);
    this.logger.log("Admin cleanup all users images triggered");
    const result = await this.aiImageService.cleanupAllUsersImages();
    return {
      ...result,
      message: `Cleaned up ${result.totalDeleted} images from ${result.usersCleaned} users`,
    };
  }

  // ===== AI Organization Endpoints =====

  /**
   * 自动为图片打标签
   * POST /api/v1/ai-image/ai/auto-tag
   */
  @Post("ai/auto-tag")
  @UseGuards(JwtAuthGuard)
  async autoTagImages(@Request() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.aiImageService.autoTagImages(userId);
  }

  /**
   * 分析图片风格
   * POST /api/v1/ai-image/ai/analyze-styles
   */
  @Post("ai/analyze-styles")
  @UseGuards(JwtAuthGuard)
  async analyzeStyles(@Request() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.aiImageService.analyzeStyles(userId);
  }

  /**
   * 按视觉主题聚类图片
   * POST /api/v1/ai-image/ai/cluster-themes
   */
  @Post("ai/cluster-themes")
  @UseGuards(JwtAuthGuard)
  async clusterVisualThemes(@Request() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.aiImageService.clusterVisualThemes(userId);
  }
}
