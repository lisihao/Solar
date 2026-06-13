import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  Req,
  Logger,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import { Public } from "../../../../../common/decorators/public.decorator";
import { NotionAuthService } from "./services/notion-auth.service";
import { NotionSyncService } from "./services/notion-sync.service";
import { NotionPageService } from "./services/notion-page.service";
import {
  ConnectNotionDto,
  UpdateConnectionDto,
  TriggerSyncDto,
  ListPagesDto,
  LinkResourceDto,
} from "./dto/notion.dto";

// Extend Express Request to include user
interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

@ApiTags("Notion Integration")
@Controller("notion")
@ApiBearerAuth()
export class NotionController {
  private readonly logger = new Logger(NotionController.name);

  constructor(
    private readonly authService: NotionAuthService,
    private readonly syncService: NotionSyncService,
    private readonly pageService: NotionPageService,
  ) {}

  private getUserId(req: AuthenticatedRequest): string {
    const userId = req.user?.id;
    if (!userId) {
      throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
    }
    return userId;
  }

  // ============ OAuth & Connection ============

  @Get("connect")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取 Notion OAuth 授权 URL" })
  @ApiResponse({ status: 200, description: "返回授权 URL" })
  async getConnectUrl(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    const state = Buffer.from(JSON.stringify({ userId })).toString("base64");
    const url = this.authService.getAuthorizationUrl(state);
    return { url };
  }

  @Post("connect")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "完成 Notion OAuth 连接" })
  @ApiResponse({ status: 201, description: "连接成功" })
  async connect(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ConnectNotionDto,
  ) {
    const userId = this.getUserId(req);
    const result = await this.authService.exchangeCodeForToken(
      userId,
      dto.code,
      dto.redirectUri,
    );

    // 自动触发首次同步
    try {
      await this.syncService.triggerSync(userId, result.connectionId, true);
    } catch (error) {
      this.logger.warn(`Initial sync failed: ${error}`);
    }

    return {
      connectionId: result.connectionId,
      workspaceName: result.workspaceName,
      message: "Notion workspace connected successfully",
    };
  }

  @Get("callback")
  @Public()
  @ApiOperation({ summary: "Notion OAuth 回调（用于浏览器重定向流程）" })
  async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") error: string,
    @Res() res: Response,
  ) {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    if (error) {
      return res.redirect(
        `${frontendUrl}/library?tab=notion&error=${encodeURIComponent(error)}`,
      );
    }

    try {
      // 解析 state 获取 userId
      const stateData = JSON.parse(Buffer.from(state, "base64").toString());
      const userId = stateData.userId;

      const result = await this.authService.exchangeCodeForToken(userId, code);

      // 触发首次同步
      this.syncService
        .triggerSync(userId, result.connectionId, true)
        .catch((err) => {
          this.logger.warn(`Initial sync failed: ${err}`);
        });

      return res.redirect(
        `${frontendUrl}/library?tab=notion&success=true&workspace=${encodeURIComponent(result.workspaceName)}`,
      );
    } catch (err) {
      this.logger.error(`OAuth callback error: ${err}`);
      return res.redirect(
        `${frontendUrl}/library?tab=notion&error=${encodeURIComponent("Failed to connect Notion")}`,
      );
    }
  }

  @Delete("disconnect/:connectionId")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "断开 Notion 连接" })
  @ApiResponse({ status: 200, description: "断开成功" })
  async disconnect(
    @Req() req: AuthenticatedRequest,
    @Param("connectionId") connectionId: string,
  ) {
    const userId = this.getUserId(req);
    await this.authService.disconnect(userId, connectionId);
    return { message: "Notion workspace disconnected" };
  }

  // ============ Connections ============

  @Get("connections")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取用户的所有 Notion 连接" })
  @ApiResponse({ status: 200, description: "返回连接列表" })
  async getConnections(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    const connections = await this.authService.getConnections(userId);
    return { connections };
  }

  @Get("connections/:connectionId")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取连接详情" })
  @ApiResponse({ status: 200, description: "返回连接详情" })
  async getConnection(
    @Req() req: AuthenticatedRequest,
    @Param("connectionId") connectionId: string,
  ) {
    const userId = this.getUserId(req);
    const connection = await this.authService.getConnection(
      userId,
      connectionId,
    );
    return { connection };
  }

  @Patch("connections/:connectionId")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "更新连接配置" })
  @ApiResponse({ status: 200, description: "更新成功" })
  async updateConnection(
    @Req() req: AuthenticatedRequest,
    @Param("connectionId") connectionId: string,
    @Body() dto: UpdateConnectionDto,
  ) {
    const userId = this.getUserId(req);
    const connection = await this.authService.updateConnection(
      userId,
      connectionId,
      dto as { syncConfig?: Record<string, unknown> },
    );
    return { connection };
  }

  // ============ Sync ============

  @Post("sync")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "手动触发同步" })
  @ApiResponse({ status: 200, description: "同步已触发" })
  async triggerSync(
    @Req() req: AuthenticatedRequest,
    @Body() dto: TriggerSyncDto,
  ) {
    const userId = this.getUserId(req);
    const result = await this.syncService.triggerSync(
      userId,
      dto.connectionId,
      dto.fullSync,
    );
    return {
      message: "Sync started",
      ...result,
    };
  }

  @Get("sync/status")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取同步状态" })
  @ApiResponse({ status: 200, description: "返回同步状态" })
  async getSyncStatus(
    @Req() req: AuthenticatedRequest,
    @Query("connectionId") connectionId?: string,
  ) {
    const userId = this.getUserId(req);
    const status = await this.syncService.getSyncStatus(userId, connectionId);
    return { status };
  }

  @Get("sync/history/:connectionId")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取同步历史" })
  @ApiResponse({ status: 200, description: "返回同步历史" })
  async getSyncHistory(
    @Req() req: AuthenticatedRequest,
    @Param("connectionId") connectionId: string,
    @Query("limit") limit?: number,
  ) {
    const userId = this.getUserId(req);
    const history = await this.syncService.getSyncHistory(
      userId,
      connectionId,
      limit || 10,
    );
    return { history };
  }

  @Get("sync/pending")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取待同步的变更" })
  @ApiResponse({ status: 200, description: "返回待同步变更" })
  async getPendingChanges(
    @Req() req: AuthenticatedRequest,
    @Query("connectionId") connectionId?: string,
  ) {
    const userId = this.getUserId(req);
    const pendingChanges = await this.syncService.detectPendingChanges(
      userId,
      connectionId,
    );
    return { pendingChanges };
  }

  @Post("sync/bidirectional")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "执行双向同步" })
  @ApiResponse({ status: 200, description: "同步结果" })
  async syncBidirectional(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: { connectionId?: string; direction?: "push" | "pull" | "both" },
  ) {
    const userId = this.getUserId(req);
    const result = await this.syncService.syncBidirectional(
      userId,
      body.connectionId,
      { direction: body.direction },
    );
    return {
      ...result,
      message: `Sync complete: ${result.pagesPushed} pushed, ${result.pagesCreated + result.pagesUpdated} pulled`,
    };
  }

  @Post("sync/resolve")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "解决同步冲突" })
  @ApiResponse({ status: 200, description: "冲突已解决" })
  async resolveConflict(
    @Req() req: AuthenticatedRequest,
    @Body() body: { pageId: string; resolution: "keep_local" | "keep_remote" },
  ) {
    const userId = this.getUserId(req);
    await this.syncService.resolveConflict(
      userId,
      body.pageId,
      body.resolution,
    );
    return { message: "Conflict resolved" };
  }

  // ============ Pages ============

  @Get("pages")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取同步的页面列表" })
  @ApiResponse({ status: 200, description: "返回页面列表" })
  async listPages(
    @Req() req: AuthenticatedRequest,
    @Query() dto: ListPagesDto,
  ) {
    const userId = this.getUserId(req);
    const result = await this.pageService.listPages(userId, dto);
    return result;
  }

  @Get("pages/:pageId")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取页面详情" })
  @ApiResponse({ status: 200, description: "返回页面详情" })
  async getPage(
    @Req() req: AuthenticatedRequest,
    @Param("pageId") pageId: string,
  ) {
    const userId = this.getUserId(req);
    const page = await this.pageService.getPage(userId, pageId);
    return { page };
  }

  @Patch("pages/:pageId")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "更新页面内容（本地修改）" })
  @ApiResponse({ status: 200, description: "更新成功" })
  async updatePage(
    @Req() req: AuthenticatedRequest,
    @Param("pageId") pageId: string,
    @Body() body: { blocks: Record<string, unknown>[] },
  ) {
    const userId = this.getUserId(req);
    const page = await this.pageService.updatePageLocally(
      userId,
      pageId,
      body.blocks,
    );
    return { page };
  }

  @Post("pages/:pageId/push")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "推送本地修改到 Notion" })
  @ApiResponse({ status: 200, description: "推送成功" })
  async pushPage(
    @Req() req: AuthenticatedRequest,
    @Param("pageId") pageId: string,
  ) {
    const userId = this.getUserId(req);
    await this.pageService.pushToNotion(userId, pageId);
    return { message: "Changes pushed to Notion" };
  }

  @Post("pages/:pageId/link")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "链接页面到 Library 资源" })
  @ApiResponse({ status: 200, description: "链接成功" })
  async linkResource(
    @Req() req: AuthenticatedRequest,
    @Param("pageId") pageId: string,
    @Body() dto: LinkResourceDto,
  ) {
    const userId = this.getUserId(req);
    await this.pageService.linkToResource(userId, pageId, dto.resourceId);
    return { message: "Page linked to resource" };
  }

  @Delete("pages/:pageId/link")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "取消链接" })
  @ApiResponse({ status: 200, description: "取消成功" })
  async unlinkResource(
    @Req() req: AuthenticatedRequest,
    @Param("pageId") pageId: string,
  ) {
    const userId = this.getUserId(req);
    await this.pageService.unlinkFromResource(userId, pageId);
    return { message: "Page unlinked from resource" };
  }

  // ============ Databases ============

  @Get("databases")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取同步的数据库列表" })
  @ApiResponse({ status: 200, description: "返回数据库列表" })
  async listDatabases(
    @Req() req: AuthenticatedRequest,
    @Query("connectionId") connectionId?: string,
  ) {
    const userId = this.getUserId(req);
    const databases = await this.pageService.listDatabases(
      userId,
      connectionId,
    );
    return { databases };
  }

  @Get("databases/:databaseId")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取数据库详情" })
  @ApiResponse({ status: 200, description: "返回数据库详情" })
  async getDatabase(
    @Req() req: AuthenticatedRequest,
    @Param("databaseId") databaseId: string,
  ) {
    const userId = this.getUserId(req);
    const database = await this.pageService.getDatabase(userId, databaseId);
    return { database };
  }

  // ============ Config ============

  @Get("config")
  @Public()
  @ApiOperation({ summary: "获取 Notion 集成配置状态" })
  @ApiResponse({ status: 200, description: "返回配置状态" })
  async getConfig() {
    return {
      configured: this.authService.isConfigured(),
      callbackUrl: process.env.NOTION_CALLBACK_URL || "",
    };
  }
}
