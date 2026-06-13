import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AiSocialService } from "../../mission/services/ai-social.service";
import { SocialConnectionsService } from "../../mission/services/social-connections.service";
import { XhsMcpFacadeService } from "../../mission/services/xhs-mcp-facade.service";
import { SocialImportSourcesService } from "../../mission/services/social-import-sources.service";
import { SocialLeaderService } from "../../mission/services/social-leader.service";
import { ReviewService } from "../../mission/services/review.service";
import { ContentVersionService } from "../../mission/services/content-version.service";
import { BillingContext } from "../../../../platform/facade";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../../common/guards/admin.guard";
import { CreateContentDto } from "../dto/create-content.dto";
import { UpdateContentDto } from "../dto/update-content.dto";
import { ProcessUrlDto } from "../dto/process-url.dto";
import { ProcessSourceDto } from "../dto/process-source.dto";
import { PublishContentDto } from "../dto/publish-content.dto";
import { BatchDeleteDto, BatchPublishDto } from "../dto/batch-operation.dto";
import {
  GenerateVersionDto,
  UpdateVersionDto,
} from "../dto/content-version.dto";
import { RunSocialMissionDto } from "../dto/run-mission.dto";
import { SocialPlatformType } from "../../mission/types";
import { SocialPipelineDispatcher } from "../../mission/pipeline/social-pipeline-dispatcher.service";

interface AuthenticatedRequest {
  user: { id: string };
}

@ApiTags("AI Social")
@Controller("ai-social")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AiSocialController {
  private readonly logger = new Logger(AiSocialController.name);

  constructor(
    private readonly aiSocialService: AiSocialService,
    private readonly connections: SocialConnectionsService,
    private readonly xhsMcp: XhsMcpFacadeService,
    private readonly importSources: SocialImportSourcesService,
    private readonly socialLeaderService: SocialLeaderService,
    private readonly reviewService: ReviewService,
    private readonly contentVersionService: ContentVersionService,
    private readonly missionDispatcher: SocialPipelineDispatcher,
  ) {}

  // ==================== W4 Agent Team Mission Entry ====================

  /**
   * 启动 SocialPublishMission（W4 Agent Team 新轨；旧 publish-executor 同步链式
   * 路径并存到 PR-5 真发回归通过后切流量）。
   *
   * Fire-and-forget：立即返回 missionId，mission 异步跑；前端订阅 WebSocket
   * `social.mission:*` 事件流跟进度。
   */
  @Post("mission/run")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async runMission(
    @Request() req: AuthenticatedRequest,
    @Body() dto: RunSocialMissionDto,
  ): Promise<{ missionId: string; status: "started" | "in-flight" }> {
    const userId = req.user.id;
    if (!dto.platforms || dto.platforms.length === 0) {
      throw new HttpException("platforms is required", HttpStatus.BAD_REQUEST);
    }
    // ★ W4 PR-4b round-2 / Reviewer C P0-9: server-side dedup window 5s
    //   防 StrictMode 双调用 / 用户双击 / 网络重试触发多个 mission
    const { missionId, reused } = this.missionDispatcher.tryReserveInFlight(
      userId,
      dto.contentId,
      dto.platforms,
    );
    if (reused) {
      this.logger.log(
        `[mission/run] dedup hit user=${userId} contentId=${dto.contentId} → reuse missionId=${missionId}`,
      );
      return { missionId, status: "in-flight" };
    }

    this.logger.log(
      `[mission/run] user=${userId} contentId=${dto.contentId} platforms=${dto.platforms.join(",")} → missionId=${missionId}`,
    );

    void this.missionDispatcher
      .runMission(
        missionId,
        {
          contentId: dto.contentId,
          platforms: dto.platforms,
          connectionIds: dto.connectionIds,
          depth: dto.depth,
          budgetProfile: dto.budgetProfile ?? "standard",
          language: dto.language ?? "zh-CN",
        },
        userId,
      )
      .catch((err: unknown) => {
        this.logger.error(
          `[mission/run] mission ${missionId} threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    return { missionId, status: "started" };
  }

  // ==================== 平台连接 ====================

  @Get("connections")
  async getConnections(@Request() req: AuthenticatedRequest) {
    return this.connections.getConnections(req.user.id);
  }

  @Post("connections/:type/init")
  async initConnection(
    @Request() req: AuthenticatedRequest,
    @Param("type") type: string,
  ) {
    return this.connections.initConnection(req.user.id, type);
  }

  @Post("connections/:type/verify")
  async verifyConnection(
    @Request() req: AuthenticatedRequest,
    @Param("type") type: string,
  ) {
    return this.connections.verifyConnection(req.user.id, type);
  }

  @Delete("connections/:type")
  async deleteConnection(
    @Request() req: AuthenticatedRequest,
    @Param("type") type: string,
  ) {
    return this.connections.deleteConnection(req.user.id, type);
  }

  @Post("connections/:id/test")
  async testConnection(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.connections.testConnection(req.user.id, id);
  }

  @Post("connections/:id/refresh")
  async refreshConnection(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.connections.refreshConnection(req.user.id, id);
  }

  // ==================== 内容管理 ====================

  @Get("contents")
  async getContents(
    @Request() req: AuthenticatedRequest,
    @Query("status") status?: string,
    @Query("contentType") contentType?: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.aiSocialService.getContents(req.user.id, {
      status,
      contentType,
      page: page ?? 1,
      limit: limit ?? 20,
    });
  }

  @Post("contents")
  async createContent(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateContentDto,
  ) {
    return this.aiSocialService.createContent(req.user.id, dto);
  }

  // Note: This specific route MUST come before @Get("contents/:id") to avoid route conflict
  @Get("contents/pending-review")
  async getPendingReviewContents(@Request() req: AuthenticatedRequest) {
    return this.reviewService.getPendingReviewContents(req.user.id);
  }

  // Note: This specific route MUST come before @Get("contents/:id") to avoid route conflict
  @Get("series/:seriesId/contents")
  async getSeriesContents(
    @Request() req: AuthenticatedRequest,
    @Param("seriesId") seriesId: string,
  ) {
    return this.aiSocialService.getSeriesContents(req.user.id, seriesId);
  }

  @Get("contents/:id")
  async getContent(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.aiSocialService.getContent(req.user.id, id);
  }

  @Patch("contents/:id")
  async updateContent(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateContentDto,
  ) {
    return this.aiSocialService.updateContent(req.user.id, id, dto);
  }

  @Delete("contents/:id")
  async deleteContent(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.aiSocialService.deleteContent(req.user.id, id);
  }

  // ==================== 平台适配版本 ====================

  @Get("contents/:id/versions")
  async getContentVersions(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    // 验证内容所有权
    await this.aiSocialService.getContent(req.user.id, id);
    const versions = await this.contentVersionService.getVersions(id);
    return { versions };
  }

  @Post("contents/:id/versions/generate")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async generateVersion(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: GenerateVersionDto,
  ) {
    // 验证内容所有权
    await this.aiSocialService.getContent(req.user.id, id);
    try {
      const version = await BillingContext.run(
        {
          userId: req.user.id,
          moduleType: "ai-social",
          operationType: "adapt-version",
          description: "AI Social - Generate Version",
        },
        () =>
          this.contentVersionService.generateVersion(
            id,
            dto.platformType,
            req.user.id,
          ),
      );
      return { version };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "版本生成失败，请重试";
      this.logger.error(`generateVersion failed: ${message}`);
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post("contents/:id/versions/generate-all")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async generateAllVersions(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    // 验证内容所有权
    await this.aiSocialService.getContent(req.user.id, id);
    try {
      const versions = await BillingContext.run(
        {
          userId: req.user.id,
          moduleType: "ai-social",
          operationType: "adapt-version",
          description: "AI Social - Generate All Versions",
        },
        () => this.contentVersionService.generateAllVersions(id, req.user.id),
      );
      return { versions };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "版本生成失败，请重试";
      this.logger.error(`generateAllVersions failed: ${message}`);
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  @Patch("contents/:id/versions/:platform")
  async updateVersion(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("platform") platform: string,
    @Body() dto: UpdateVersionDto,
  ) {
    // 验证内容所有权
    await this.aiSocialService.getContent(req.user.id, id);
    const platformType = platform.toUpperCase() as SocialPlatformType;
    const version = await this.contentVersionService.updateVersion(
      id,
      platformType,
      dto,
    );
    return { version };
  }

  @Delete("contents/:id/versions/:platform")
  async deleteVersion(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("platform") platform: string,
  ) {
    // 验证内容所有权
    await this.aiSocialService.getContent(req.user.id, id);
    const platformType = platform.toUpperCase() as SocialPlatformType;
    await this.contentVersionService.deleteVersion(id, platformType);
    return { success: true };
  }

  // ==================== 批量操作 ====================

  @Post("contents/batch-delete")
  async batchDeleteContents(
    @Request() req: AuthenticatedRequest,
    @Body() dto: BatchDeleteDto,
  ) {
    return this.aiSocialService.batchDeleteContents(req.user.id, dto.ids);
  }

  @Post("contents/batch-publish")
  async batchPublishContents(
    @Request() req: AuthenticatedRequest,
    @Body() dto: BatchPublishDto,
  ) {
    return this.aiSocialService.batchPublishContents(
      req.user.id,
      dto.ids,
      dto.connectionId,
    );
  }

  // ==================== 内容检测 ====================

  @Post("contents/:id/check")
  async checkContent(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.aiSocialService.checkContent(req.user.id, id);
  }

  // ==================== 发布管理 ====================

  @Post("contents/:id/publish")
  async publishContent(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: PublishContentDto,
  ) {
    return this.aiSocialService.publishContent(req.user.id, id, dto);
  }

  @Post("contents/:id/schedule")
  async scheduleContent(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: { scheduledAt: string },
  ) {
    return this.aiSocialService.scheduleContent(
      req.user.id,
      id,
      new Date(dto.scheduledAt),
    );
  }

  @Post("contents/:id/cancel")
  async cancelPublish(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.aiSocialService.cancelPublish(req.user.id, id);
  }

  @Get("contents/:id/logs")
  async getPublishLogs(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.aiSocialService.getPublishLogs(req.user.id, id);
  }

  // ==================== 导入来源 ====================

  @Get("sources/explore")
  async getExploreSources(
    @Request() req: AuthenticatedRequest,
    @Query("type") type?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("since") since?: string,
  ) {
    return this.importSources.getExploreSources(req.user.id, {
      type,
      page: Number(page) || 1,
      limit: limit ? Number(limit) : undefined,
      since,
    });
  }

  @Get("sources/research")
  async getResearchSources(@Request() req: AuthenticatedRequest) {
    return this.importSources.getResearchSources(req.user.id);
  }

  @Get("sources/office")
  async getOfficeSources(@Request() req: AuthenticatedRequest) {
    return this.importSources.getOfficeSources(req.user.id);
  }

  @Get("sources/writing")
  async getWritingSources(@Request() req: AuthenticatedRequest) {
    return this.importSources.getWritingSources(req.user.id);
  }

  @Get("sources/topic-insights")
  async getTopicInsightsSources(@Request() req: AuthenticatedRequest) {
    return this.importSources.getTopicInsightsSources(req.user.id);
  }

  // ==================== AI Engine ====================

  @Post("ai/process-url")
  async processUrl(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ProcessUrlDto,
  ) {
    try {
      return await BillingContext.run(
        {
          userId: req.user.id,
          moduleType: "ai-social",
          operationType: "generate-post",
          description: "AI Social - Process URL",
        },
        () => this.socialLeaderService.processUrl(req.user.id, dto),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "内容处理失败，请重试";
      this.logger.error(`processUrl failed: ${message}`);
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post("ai/process-source")
  async processSource(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ProcessSourceDto,
  ) {
    // Log at entry point to verify request reaches backend
    this.logger.log(
      `[process-source] Request received: sourceType=${dto.sourceType}, ` +
        `sourceId=${dto.sourceId?.substring(0, 8)}..., targetType=${dto.targetType}, keepFormat=${dto.keepFormat}`,
    );
    const startTime = Date.now();

    try {
      const result = await BillingContext.run(
        {
          userId: req.user.id,
          moduleType: "ai-social",
          operationType: "generate-post",
          description: "AI Social - Process Source",
        },
        () => this.socialLeaderService.processSource(req.user.id, dto),
      );
      this.logger.log(
        `[process-source] Success in ${Date.now() - startTime}ms`,
      );
      return result;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const message =
        error instanceof Error ? error.message : "内容处理失败，请重试";
      this.logger.error(
        `[process-source] Failed after ${elapsed}ms: ${message}`,
      );
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post("ai/regenerate/:id")
  async regenerateContent(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    try {
      return await BillingContext.run(
        {
          userId: req.user.id,
          moduleType: "ai-social",
          operationType: "generate-post",
          description: "AI Social - Regenerate Content",
        },
        () => this.socialLeaderService.regenerateContent(req.user.id, id),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "内容重新生成失败，请重试";
      this.logger.error(`regenerateContent failed: ${message}`);
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  // ==================== 小红书 MCP 功能 ====================

  @Get("xhs/login-status")
  async xhsLoginStatus(@Request() _req: AuthenticatedRequest) {
    return this.xhsMcp.getLoginStatus();
  }

  @Get("xhs/feeds")
  async xhsListFeeds(@Request() _req: AuthenticatedRequest) {
    return this.xhsMcp.listFeeds();
  }

  @Get("xhs/search")
  async xhsSearchFeeds(
    @Request() _req: AuthenticatedRequest,
    @Query("keyword") keyword: string,
  ) {
    if (!keyword) {
      throw new HttpException("keyword is required", HttpStatus.BAD_REQUEST);
    }
    return this.xhsMcp.searchFeeds(keyword);
  }

  @Get("xhs/feeds/:feedId")
  async xhsGetFeedDetail(
    @Request() _req: AuthenticatedRequest,
    @Param("feedId") feedId: string,
    @Query("xsecToken") xsecToken: string,
  ) {
    if (!xsecToken) {
      throw new HttpException("xsecToken is required", HttpStatus.BAD_REQUEST);
    }
    return this.xhsMcp.getFeedDetail(feedId, xsecToken);
  }

  @Post("xhs/feeds/:feedId/comment")
  async xhsPostComment(
    @Request() _req: AuthenticatedRequest,
    @Param("feedId") feedId: string,
    @Body() dto: { xsecToken: string; content: string },
  ) {
    if (!dto.xsecToken || !dto.content) {
      throw new HttpException(
        "xsecToken and content are required",
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.xhsMcp.postComment(feedId, dto.xsecToken, dto.content);
  }

  @Get("xhs/users/:userId")
  async xhsGetUserProfile(
    @Request() _req: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Query("xsecToken") xsecToken: string,
  ) {
    if (!xsecToken) {
      throw new HttpException("xsecToken is required", HttpStatus.BAD_REQUEST);
    }
    return this.xhsMcp.getUserProfile(userId, xsecToken);
  }

  // ==================== 审核管理 ====================

  @Post("contents/:id/approve")
  async approveContent(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: { note?: string },
  ) {
    return this.reviewService.approveContent(req.user.id, id, dto.note);
  }

  @Post("contents/:id/reject")
  async rejectContent(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: { note: string },
  ) {
    return this.reviewService.rejectContent(req.user.id, id, dto.note);
  }

  @Post("contents/:id/resubmit")
  async resubmitForReview(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.reviewService.resubmitForReview(req.user.id, id);
  }
}
