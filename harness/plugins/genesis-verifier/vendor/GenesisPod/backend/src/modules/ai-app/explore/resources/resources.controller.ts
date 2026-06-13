import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Logger,
  ParseIntPipe,
  DefaultValuePipe,
  HttpException,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Req,
  Res,
  BadRequestException,
} from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import * as path from "path";
import { Request, Response } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiConsumes,
} from "@nestjs/swagger";
import { ResourcesService } from "./resources.service";
import { AIEnrichmentService } from "./ai-enrichment.service";
import { PdfThumbnailService } from "./pdf-thumbnail.service";
import { DynamicThumbnailService } from "./dynamic-thumbnail.service";
import { ResourceHealthCheckScheduler } from "./resource-health-check.scheduler";
import { ObjectStorageService } from "../../../platform/facade";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { Public } from "../../../../common/decorators/public.decorator";
import { Prisma } from "@prisma/client";
import {
  ResourceResponseDto,
  ResourceListResponseDto,
  ResourceStatsDto,
} from "./dto/resource-response.dto";
import { ImportUrlDto, ImportUrlResponseDto } from "./dto/import-url.dto";
import {
  UpvoteResponseDto,
  UserUpvotesResponseDto,
} from "./dto/upvote-response.dto";

// Extend Express Request to include user
interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

/**
 * 资源管理控制器
 */
@ApiTags("Resources")
@Controller("resources")
export class ResourcesController {
  private readonly logger = new Logger(ResourcesController.name);

  constructor(
    private resourcesService: ResourcesService,
    private aiEnrichmentService: AIEnrichmentService,
    private pdfThumbnailService: PdfThumbnailService,
    private dynamicThumbnailService: DynamicThumbnailService,
    private r2StorageService: ObjectStorageService,
    private healthScheduler: ResourceHealthCheckScheduler,
  ) {}

  /**
   * 获取资源列表
   * GET /api/v1/resources?skip=0&take=20&type=PAPER&category=AI&search=machine+learning&sortBy=publishedAt&sortOrder=desc
   */
  @Public()
  @Get()
  @ApiOperation({
    summary: "获取资源列表",
    description: "分页查询资源列表，支持类型、分类、搜索和排序",
  })
  @ApiQuery({
    name: "skip",
    required: false,
    type: Number,
    description: "跳过的记录数",
    example: 0,
  })
  @ApiQuery({
    name: "take",
    required: false,
    type: Number,
    description: "获取的记录数",
    example: 20,
  })
  @ApiQuery({
    name: "type",
    required: false,
    type: String,
    description: "资源类型过滤",
    enum: ["PAPER", "BLOG", "REPORT", "NEWS", "YOUTUBE_VIDEO", "POLICY"],
  })
  @ApiQuery({
    name: "category",
    required: false,
    type: String,
    description: "分类过滤",
  })
  @ApiQuery({
    name: "search",
    required: false,
    type: String,
    description: "搜索关键词",
  })
  @ApiQuery({
    name: "sortBy",
    required: false,
    type: String,
    description: "排序字段",
    enum: ["publishedAt", "qualityScore", "trendingScore"],
  })
  @ApiQuery({
    name: "sortOrder",
    required: false,
    type: String,
    description: "排序方向",
    enum: ["asc", "desc"],
  })
  @ApiResponse({
    status: 200,
    description: "成功获取资源列表",
    type: ResourceListResponseDto,
  })
  async findAll(
    @Query("skip", new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query("take", new DefaultValuePipe(20), ParseIntPipe) take: number,
    @Query("type") type?: string,
    @Query("category") category?: string,
    @Query("search") search?: string,
    @Query("sortBy") sortBy?: "publishedAt" | "qualityScore" | "trendingScore",
    @Query("sortOrder") sortOrder?: "asc" | "desc",
  ) {
    this.logger.log(`Fetching resources (skip: ${skip}, take: ${take})`);

    return this.resourcesService.findAll({
      skip,
      take,
      type,
      category,
      search,
      sortBy,
      sortOrder,
    });
  }

  /**
   * 搜索建议（实时）
   * GET /api/v1/resources/search/suggestions?q=AI&limit=5
   *
   * 注意：此路由必须在 @Get(':id') 之前，否则会被 :id 捕获
   */
  @Public()
  @Get("search/suggestions")
  @ApiOperation({
    summary: "获取搜索建议",
    description: "根据查询关键词获取实时搜索建议",
  })
  @ApiQuery({
    name: "q",
    required: true,
    type: String,
    description: "搜索关键词（至少2个字符）",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "最大建议数",
    example: 5,
  })
  @ApiResponse({ status: 200, description: "成功获取搜索建议" })
  async searchSuggestions(
    @Query("q") query: string,
    @Query("limit", new DefaultValuePipe(5), ParseIntPipe) limit: number,
  ) {
    if (!query || query.trim().length < 2) {
      return { suggestions: [] };
    }

    this.logger.log(`Searching suggestions for: ${query}`);

    const suggestions = await this.resourcesService.searchSuggestions(
      query,
      limit,
    );

    return { suggestions };
  }

  /**
   * 获取资源统计
   * GET /api/v1/resources/stats/summary
   *
   * 注意：此路由必须在 @Get(':id') 之前，否则会被 :id 捕获
   */
  @Get("stats/summary")
  @ApiOperation({
    summary: "获取资源统计",
    description: "获取资源的统计信息（总数、分类统计等）",
  })
  @ApiResponse({
    status: 200,
    description: "成功获取统计信息",
    type: ResourceStatsDto,
  })
  async getStats() {
    this.logger.log("Fetching resource statistics");

    return this.resourcesService.getStats();
  }

  /**
   * 检查 AI 服务健康状态
   * GET /api/v1/resources/ai/health
   *
   * 注意：此路由必须在 @Get(':id') 之前，否则会被 :id 捕获
   */
  @Get("ai/health")
  async checkAIHealth() {
    this.logger.log("Checking AI service health");

    const isHealthy = await this.aiEnrichmentService.checkHealth();

    return {
      status: isHealthy ? "ok" : "error",
      aiServiceAvailable: isHealthy,
    };
  }

  /**
   * 清理重复资源（管理员专用）
   * POST /api/v1/resources/cleanup/duplicates?type=YOUTUBE_VIDEO
   *
   * 识别并删除重复的资源（基于 sourceUrl 和 normalizedUrl）
   * 保留最早创建的记录，删除后续重复的记录
   */
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post("cleanup/duplicates")
  async cleanupDuplicates(@Query("type") type?: string) {
    this.logger.log(
      `Cleaning up duplicate resources for type: ${type || "all"}`,
    );

    const result = await this.resourcesService.cleanupDuplicates(type);

    return {
      message: `Cleaned up ${result.deleted} duplicate resources`,
      ...result,
    };
  }

  /**
   * 一键扫描并清理 BROKEN 资源（管理员专用）
   * POST /api/v1/resources/cleanup/broken
   *
   * 两步：
   *  1. 实时探活当前 UNKNOWN/超期 HEALTHY 资源，把已失效的标成 BROKEN
   *     —— 否则库里没有 BROKEN 行，删除永远是 0（"清理无效"的根因）。
   *  2. 删除 linkHealth=BROKEN 且无 notes/comments 的资源；有用户数据的改为 ARCHIVED。
   */
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post("cleanup/broken")
  async cleanupBroken() {
    this.logger.log("Manual broken-resource scan + cleanup triggered");
    const scan = await this.healthScheduler.scanAndMarkBroken();
    const result = await this.resourcesService.cleanupBrokenResources();
    return {
      message: `Scanned ${scan.scanned}, deleted ${result.deleted} broken resources`,
      scanned: scan.scanned,
      capped: scan.capped,
      ...result,
    };
  }

  /**
   * 获取当前用户已点赞的所有资源ID列表
   * GET /api/v1/resources/user/upvotes
   *
   * 用于前端初始化点赞状态
   * 注意：此路由必须在 @Get(':id') 之前
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get("user/upvotes")
  @ApiOperation({
    summary: "获取用户点赞列表",
    description: "获取当前用户已点赞的所有资源ID列表",
  })
  @ApiResponse({
    status: 200,
    description: "成功获取点赞列表",
    type: UserUpvotesResponseDto,
  })
  @ApiResponse({ status: 401, description: "未授权" })
  async getUserUpvotes(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;

    if (!userId) {
      throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
    }

    this.logger.log(`Fetching upvoted resources for user ${userId}`);

    const resourceIds =
      await this.resourcesService.getUserUpvotedResourceIds(userId);

    return { resourceIds };
  }

  /**
   * 动态获取资源缩略图URL
   * GET /api/v1/resources/thumbnail/extract?url=xxx&type=BLOG&resourceId=xxx
   *
   * 实时从网页提取og:image等缩略图
   * 注意：此路由必须在 @Get(':id') 之前
   *
   * 新增缓存机制：
   * - 如果提供 resourceId，成功提取后自动保存到数据库
   * - 后续访问直接使用数据库中的缓存值
   */
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @Get("thumbnail/extract")
  async extractThumbnail(
    @Query("url") url: string,
    @Query("type") type: string,
    @Query("resourceId") resourceId?: string,
  ) {
    if (!url) {
      throw new HttpException("URL is required", HttpStatus.BAD_REQUEST);
    }

    this.logger.log(
      `Extracting thumbnail for URL: ${url} (type: ${type}, resourceId: ${resourceId || "none"})`,
    );

    // For PAPER type with resourceId, try to get pdfUrl from database
    let pdfUrl: string | undefined;
    if (type === "PAPER" && resourceId) {
      try {
        const resource = await this.resourcesService.findOne(resourceId);
        if (resource?.pdfUrl) {
          pdfUrl = resource.pdfUrl;
          this.logger.log(`Found pdfUrl for resource ${resourceId}: ${pdfUrl}`);
        }
      } catch (error) {
        this.logger.debug(
          `Could not fetch resource for pdfUrl: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const thumbnailUrl = await this.dynamicThumbnailService.getThumbnailUrl(
      url,
      type || "BLOG",
      pdfUrl,
      resourceId,
    );

    // 如果成功提取且提供了 resourceId，缓存到数据库
    if (thumbnailUrl && resourceId) {
      try {
        await this.resourcesService.update(resourceId, {
          thumbnailUrl: thumbnailUrl,
        });
        this.logger.log(
          `Cached thumbnail for resource ${resourceId}: ${thumbnailUrl}`,
        );
      } catch (error) {
        // 缓存失败不影响返回结果
        this.logger.warn(
          `Failed to cache thumbnail for resource ${resourceId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      thumbnailUrl,
      sourceUrl: url,
      type,
    };
  }

  /**
   * 为arXiv论文生成PDF预览缩略图
   * GET /api/v1/resources/thumbnail/pdf-preview?arxivId=2301.07041
   *
   * 使用后端PDF渲染服务生成arXiv论文的第一页缩略图
   * 注意：此路由必须在 @Get(':id') 之前
   * 跳过速率限制，因为前端会批量请求缩略图
   */
  @SkipThrottle()
  @Get("thumbnail/pdf-preview")
  async generateArxivPdfPreview(@Query("arxivId") arxivId: string) {
    if (!arxivId) {
      throw new HttpException("arxivId is required", HttpStatus.BAD_REQUEST);
    }

    this.logger.log(`Generating PDF preview for arXiv paper: ${arxivId}`);

    // 构建arXiv PDF URL
    const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;

    // 使用 PdfThumbnailService 生成缩略图
    const thumbnailUrl = await this.pdfThumbnailService.generateThumbnail(
      pdfUrl,
      arxivId, // 使用 arxivId 作为资源ID（用于缓存文件名）
    );

    if (!thumbnailUrl) {
      this.logger.warn(`Failed to generate PDF preview for arXiv ${arxivId}`);
      throw new BadRequestException(
        `Failed to generate PDF preview for arXiv ${arxivId}`,
      );
    }

    this.logger.log(
      `PDF preview generated successfully for arXiv ${arxivId}: ${thumbnailUrl}`,
    );

    return {
      thumbnailUrl,
      arxivId,
    };
  }

  /**
   * 获取资源详情
   * GET /api/v1/resources/:id
   *
   * 注意：动态路由必须放在所有具体路由之后，以免捕获其他路径
   */
  @Public()
  @Get(":id")
  @ApiOperation({
    summary: "获取资源详情",
    description: "根据资源ID获取详细信息",
  })
  @ApiParam({ name: "id", description: "资源ID" })
  @ApiResponse({
    status: 200,
    description: "成功获取资源详情",
    type: ResourceResponseDto,
  })
  @ApiResponse({ status: 404, description: "资源不存在" })
  async findOne(@Param("id") id: string) {
    this.logger.log(`Fetching resource ${id}`);

    return this.resourcesService.findOne(id);
  }

  /**
   * 图片代理 - 解决微信等平台的图片防盗链
   * GET /api/v1/resources/proxy-image?url=https://mmbiz.qpic.cn/...
   *
   * 允许的图片域名白名单（防 SSRF）：
   * - mmbiz.qpic.cn (微信公众号图片)
   * - mmbiz.qlogo.cn (微信头像)
   */
  @Get("proxy-image")
  @Public()
  @SkipThrottle()
  @ApiOperation({
    summary: "图片代理",
    description: "代理获取有防盗链限制的外部图片（如微信公众号图片）",
  })
  @ApiQuery({ name: "url", description: "图片URL", required: true })
  @ApiResponse({ status: 200, description: "图片内容" })
  @ApiResponse({ status: 400, description: "非法URL" })
  async proxyImage(
    @Query("url") imageUrl: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!imageUrl) {
      res.status(400).json({ message: "url parameter is required" });
      return;
    }

    // 安全：仅允许白名单域名，防止 SSRF
    const allowedDomains = ["mmbiz.qpic.cn", "mmbiz.qlogo.cn"];

    try {
      const urlObj = new URL(imageUrl);
      if (!allowedDomains.includes(urlObj.hostname)) {
        res.status(400).json({
          message: `Domain ${urlObj.hostname} is not allowed for image proxy`,
        });
        return;
      }

      // 仅允许 HTTPS
      if (urlObj.protocol !== "https:") {
        res.status(400).json({ message: "Only HTTPS URLs are allowed" });
        return;
      }
    } catch {
      res.status(400).json({ message: "Invalid URL format" });
      return;
    }

    try {
      const response = await fetch(imageUrl, {
        headers: {
          Referer: "https://mp.weixin.qq.com/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        res.status(response.status).json({
          message: `Upstream returned ${response.status}`,
        });
        return;
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";

      // 验证返回的确实是图片
      if (!contentType.startsWith("image/")) {
        res.status(400).json({ message: "Response is not an image" });
        return;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // 设置缓存头，减少重复请求
      res.set({
        "Content-Type": contentType,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "public, max-age=86400", // 缓存 24 小时
        "Access-Control-Allow-Origin": "*",
      });
      res.send(buffer);
    } catch (error) {
      this.logger.warn(
        `Image proxy failed for ${imageUrl}: ${(error as Error).message}`,
      );
      res.status(502).json({ message: "Failed to fetch image" });
    }
  }

  /**
   * 从URL导入资源
   * POST /api/v1/resources/import-url
   * Body: { url: string, type: 'PAPER' | 'BLOG' | 'REPORT' | 'NEWS' | 'YOUTUBE_VIDEO' }
   *
   * 注意：此路由必须在 @Post() 之前，否则会被通用POST路由捕获
   */
  @Post("import-url")
  @ApiOperation({
    summary: "从URL导入资源",
    description: "从给定的URL自动提取并导入资源信息",
  })
  @ApiBody({ type: ImportUrlDto })
  @ApiResponse({
    status: 200,
    description: "导入成功",
    type: ImportUrlResponseDto,
  })
  @ApiResponse({ status: 400, description: "无效的URL或资源类型" })
  @ApiResponse({ status: 500, description: "导入失败" })
  async importFromUrl(@Body() body: { url: string; type: string }) {
    const { url, type } = body;

    if (!url || !type) {
      throw new HttpException(
        "URL and type are required",
        HttpStatus.BAD_REQUEST,
      );
    }

    const validTypes = [
      "PAPER",
      "BLOG",
      "REPORT",
      "NEWS",
      "YOUTUBE_VIDEO",
      "POLICY",
    ];
    if (!validTypes.includes(type)) {
      throw new HttpException(
        `Invalid resource type. Supported types are: PAPER, BLOG, REPORT, NEWS, YOUTUBE_VIDEO, POLICY. Received: ${type}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(`Importing resource from URL: ${url} (type: ${type})`);

    try {
      const resource = await this.resourcesService.importFromUrl(url, type);
      return {
        message: "URL imported successfully",
        resource,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to import URL: ${err.message}`, err.stack);
      throw new HttpException(
        `Failed to import URL: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 创建资源
   * POST /api/v1/resources
   */
  @Post()
  @ApiOperation({ summary: "创建资源", description: "手动创建新资源" })
  @ApiResponse({
    status: 201,
    description: "创建成功",
    type: ResourceResponseDto,
  })
  @ApiResponse({ status: 400, description: "无效的输入数据" })
  async create(@Body() createResourceDto: Prisma.ResourceCreateInput) {
    this.logger.log("Creating new resource");

    return this.resourcesService.create(createResourceDto);
  }

  /**
   * 更新资源
   * PATCH /api/v1/resources/:id
   */
  @Patch(":id")
  @ApiOperation({ summary: "更新资源", description: "更新指定资源的信息" })
  @ApiParam({ name: "id", description: "资源ID" })
  @ApiResponse({
    status: 200,
    description: "更新成功",
    type: ResourceResponseDto,
  })
  @ApiResponse({ status: 404, description: "资源不存在" })
  async update(
    @Param("id") id: string,
    @Body() updateResourceDto: Prisma.ResourceUpdateInput,
  ) {
    this.logger.log(`Updating resource ${id}`);

    return this.resourcesService.update(id, updateResourceDto);
  }

  /**
   * 删除资源
   * DELETE /api/v1/resources/:id
   */
  @Delete(":id")
  @ApiOperation({ summary: "删除资源", description: "删除指定的资源" })
  @ApiParam({ name: "id", description: "资源ID" })
  @ApiResponse({ status: 200, description: "删除成功" })
  @ApiResponse({ status: 404, description: "资源不存在" })
  async remove(@Param("id") id: string) {
    this.logger.log(`Deleting resource ${id}`);

    return this.resourcesService.remove(id);
  }

  /**
   * 切换资源点赞状态
   * POST /api/v1/resources/:id/upvote
   *
   * 需要登录，每次调用会切换用户对该资源的点赞状态
   */
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post(":id/upvote")
  @ApiOperation({
    summary: "切换点赞状态",
    description: "切换当前用户对指定资源的点赞状态",
  })
  @ApiParam({ name: "id", description: "资源ID" })
  @ApiResponse({
    status: 200,
    description: "操作成功",
    type: UpvoteResponseDto,
  })
  @ApiResponse({ status: 401, description: "未授权" })
  @ApiResponse({ status: 404, description: "资源不存在" })
  async toggleUpvote(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;

    if (!userId) {
      throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
    }

    this.logger.log(`Toggling upvote for resource ${id} by user ${userId}`);

    const result = await this.resourcesService.toggleUpvote(id, userId);

    return result;
  }

  /**
   * AI 增强资源（生成摘要、洞察、分类）
   * POST /api/v1/resources/:id/enrich
   */
  @Post(":id/enrich")
  @ApiOperation({
    summary: "AI增强资源",
    description: "使用AI生成资源摘要、洞察和分类信息",
  })
  @ApiParam({ name: "id", description: "资源ID" })
  @ApiResponse({
    status: 200,
    description: "增强成功",
    type: ResourceResponseDto,
  })
  @ApiResponse({ status: 404, description: "资源不存在" })
  @ApiResponse({ status: 500, description: "AI服务错误" })
  async enrichResource(@Param("id") id: string) {
    this.logger.log(`Enriching resource ${id} with AI`);

    // 获取资源
    const resource = await this.resourcesService.findOne(id);
    if (!resource) {
      throw new HttpException(`Resource ${id} not found`, HttpStatus.NOT_FOUND);
    }

    // 调用 AI 增强服务
    const enrichment = await this.aiEnrichmentService.enrichResource({
      title: resource.title,
      abstract: resource.abstract ?? undefined,
      content: resource.content ?? undefined,
      sourceUrl: resource.sourceUrl,
    });

    // 更新资源
    const updated = await this.resourcesService.update(id, {
      aiSummary: enrichment.aiSummary,
      keyInsights: enrichment.keyInsights as Prisma.InputJsonValue,
      primaryCategory: enrichment.primaryCategory,
      autoTags: enrichment.autoTags,
      difficultyLevel: enrichment.difficultyLevel,
    });

    this.logger.log(`Resource ${id} enriched successfully`);

    return updated;
  }

  /**
   * AI 增强资源 - 结构化版本（支持新版前端组件）
   * POST /api/v1/resources/:id/enrich-structured
   * 返回包含结构化 AI 摘要的完整数据
   */
  @Post(":id/enrich-structured")
  async enrichResourceStructured(@Param("id") id: string) {
    this.logger.log(`Enriching resource ${id} with structured AI data`);

    // 获取资源
    const resource = await this.resourcesService.findOne(id);
    if (!resource) {
      throw new HttpException(`Resource ${id} not found`, HttpStatus.NOT_FOUND);
    }

    // 调用结构化 AI 增强服务
    const enrichment =
      await this.aiEnrichmentService.enrichResourceWithStructured(
        {
          title: resource.title,
          abstract: resource.abstract ?? undefined,
          content: resource.content ?? undefined,
          sourceUrl: resource.sourceUrl,
          type: resource.type,
        },
        resource.type,
      );

    // 更新资源（包含结构化摘要）
    const updated = await this.resourcesService.update(id, {
      aiSummary: enrichment.aiSummary,
      keyInsights: enrichment.keyInsights as Prisma.InputJsonValue,
      primaryCategory: enrichment.primaryCategory,
      autoTags: enrichment.autoTags,
      difficultyLevel: enrichment.difficultyLevel,
      structuredAISummary:
        enrichment.structuredAISummary as unknown as Prisma.InputJsonValue,
    });

    this.logger.log(
      `Resource ${id} enriched with structured data successfully`,
    );

    return {
      ...updated,
      // 显式返回结构化摘要供前端使用
      _structuredAISummary: enrichment.structuredAISummary,
    };
  }

  /**
   * 翻译资源
   * POST /api/v1/resources/:id/translate
   */
  @Post(":id/translate")
  translate(
    @Param("id") id: string,
    @Body("language") language: string = "zh-CN",
  ) {
    this.logger.log(`Translating resource ${id} to ${language}`);
    return this.resourcesService.translateResource(id, language);
  }

  /**
   * 上传并保存资源缩略图
   * POST /api/v1/resources/:id/thumbnail
   *
   * 前端使用 PDF.js 客户端生成缩略图，然后上传到服务器 (S3/R2)
   */
  @Post(":id/thumbnail")
  @UseInterceptors(
    FileInterceptor("thumbnail", {
      storage: memoryStorage(), // Use memory storage to process file in controller
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max
      },
      fileFilter: (_req, file, cb) => {
        // 只接受图片文件
        if (file.mimetype.startsWith("image/")) {
          cb(null, true);
        } else {
          cb(new Error("Only image files are allowed"), false);
        }
      },
    }),
  )
  async uploadThumbnail(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    this.logger.log(`Uploading thumbnail for resource ${id}`);

    if (!file) {
      throw new HttpException("No file uploaded", HttpStatus.BAD_REQUEST);
    }

    // 检查资源是否存在
    const resource = await this.resourcesService.findOne(id);
    if (!resource) {
      throw new HttpException(`Resource ${id} not found`, HttpStatus.NOT_FOUND);
    }

    // Upload to S3/R2
    const uploadResult = await this.r2StorageService.uploadBuffer(
      file.buffer,
      "thumbnails",
      `${id}${path.extname(file.originalname)}`,
      file.mimetype,
    );

    if (!uploadResult.success || !uploadResult.url) {
      throw new HttpException(
        `Failed to upload thumbnail: ${uploadResult.error}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const thumbnailUrl = uploadResult.url;

    // 更新资源的缩略图 URL
    const updated = await this.resourcesService.update(id, {
      thumbnailUrl,
    });

    this.logger.log(`Thumbnail uploaded successfully for resource ${id}`);

    return {
      message: "Thumbnail uploaded successfully",
      thumbnailUrl,
      resource: updated,
    };
  }

  /**
   * 自动生成资源缩略图（从PDF）
   * POST /api/v1/resources/:id/generate-thumbnail
   *
   * 仅适用于有 pdfUrl 的资源（PAPER/REPORT/POLICY）
   */
  @Post(":id/generate-thumbnail")
  async generateThumbnail(@Param("id") id: string) {
    this.logger.log(`Generating thumbnail for resource ${id}`);

    // 检查资源是否存在
    const resource = await this.resourcesService.findOne(id);
    if (!resource) {
      throw new HttpException(`Resource ${id} not found`, HttpStatus.NOT_FOUND);
    }

    // 检查是否有 pdfUrl
    if (!resource.pdfUrl) {
      throw new HttpException(
        `Resource ${id} does not have a PDF URL`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // 检查是否已有缩略图
    if (resource.thumbnailUrl) {
      return {
        message: "Thumbnail already exists",
        thumbnailUrl: resource.thumbnailUrl,
        resource,
      };
    }

    // 生成缩略图
    const thumbnailUrl = await this.pdfThumbnailService.generateThumbnail(
      resource.pdfUrl,
      id,
    );

    if (!thumbnailUrl) {
      throw new HttpException(
        `Failed to generate thumbnail for resource ${id}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // 更新资源的缩略图 URL
    const updated = await this.resourcesService.update(id, {
      thumbnailUrl,
    });

    this.logger.log(
      `Thumbnail generated successfully for resource ${id}: ${thumbnailUrl}`,
    );

    return {
      message: "Thumbnail generated successfully",
      thumbnailUrl,
      resource: updated,
    };
  }

  /**
   * 上传文件并创建资源
   * POST /api/v1/resources/upload-file
   *
   * 根据resource type限制文件类型：
   * - PAPER: PDF文件（最大50MB）
   * - PROJECT: ZIP/TAR.GZ文件（最大100MB）
   * - NEWS: 图片文件（最大10MB）
   * - YOUTUBE_VIDEO: 字幕文件（最大5MB）
   *
   * Uses S3/R2 storage
   */
  @Post("upload-file")
  @ApiOperation({
    summary: "上传文件",
    description: "上传文件到云存储（S3/R2）并返回文件信息",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    description: "文件上传",
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
        type: {
          type: "string",
          enum: ["PAPER", "PROJECT", "NEWS", "YOUTUBE_VIDEO"],
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "上传成功" })
  @ApiResponse({ status: 400, description: "无效的文件类型或大小超限" })
  @ApiResponse({ status: 500, description: "上传失败" })
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(), // Use memory storage
      limits: {
        fileSize: 100 * 1024 * 1024, // Max 100MB (will be further validated based on type)
      },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body("type") type: string,
  ) {
    this.logger.log(`Uploading file: ${file.originalname} (type: ${type})`);

    if (!file) {
      throw new HttpException("No file uploaded", HttpStatus.BAD_REQUEST);
    }

    if (!type) {
      throw new HttpException(
        "Resource type is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate file type and size based on resource type
    const typeRestrictions: Record<
      string,
      { mimeTypes: string[]; maxSize: number; extensions: string[] }
    > = {
      PAPER: {
        mimeTypes: ["application/pdf"],
        maxSize: 50 * 1024 * 1024,
        extensions: [".pdf"],
      },
      PROJECT: {
        mimeTypes: [
          "application/zip",
          "application/x-gzip",
          "application/gzip",
          "application/x-tar",
        ],
        maxSize: 100 * 1024 * 1024,
        extensions: [".zip", ".tar.gz", ".tgz"],
      },
      NEWS: {
        mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
        maxSize: 10 * 1024 * 1024,
        extensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
      },
      YOUTUBE_VIDEO: {
        mimeTypes: ["text/plain", "application/x-subrip"],
        maxSize: 5 * 1024 * 1024,
        extensions: [".srt", ".vtt"],
      },
    };

    const restrictions = typeRestrictions[type];
    if (!restrictions) {
      throw new HttpException(
        `Invalid resource type. Must be one of: ${Object.keys(typeRestrictions).join(", ")}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check file size
    if (file.size > restrictions.maxSize) {
      const maxSizeMB = restrictions.maxSize / (1024 * 1024);
      throw new HttpException(
        `File size exceeds maximum allowed (${maxSizeMB}MB) for ${type}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check file extension
    const fileExt = path.extname(file.originalname).toLowerCase();
    const isValidExt = restrictions.extensions.includes(fileExt);

    if (!isValidExt) {
      throw new HttpException(
        `Invalid file type. Allowed extensions for ${type}: ${restrictions.extensions.join(", ")}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Check MIME type
    const isValidMime = restrictions.mimeTypes.some(
      (mime) =>
        file.mimetype === mime || file.mimetype.startsWith(mime.split("/")[0]),
    );

    if (!isValidMime) {
      throw new HttpException(
        `Invalid file MIME type. Allowed types for ${type}: ${restrictions.mimeTypes.join(", ")}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Upload to S3/R2
    const uploadResult = await this.r2StorageService.uploadBuffer(
      file.buffer,
      "uploads",
      file.originalname,
      file.mimetype,
    );

    if (!uploadResult.success || !uploadResult.url) {
      throw new HttpException(
        `Failed to upload file: ${uploadResult.error}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const fileUrl = uploadResult.url;

    this.logger.log(
      `File uploaded successfully: ${file.originalname} -> ${fileUrl}`,
    );

    // Return file info - frontend can decide whether to create resource or analyze
    return {
      message: "File uploaded successfully",
      file: {
        originalName: file.originalname,
        filename: uploadResult.key, // Use S3 key
        size: file.size,
        mimetype: file.mimetype,
        url: fileUrl,
        type,
      },
    };
  }
}
