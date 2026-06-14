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
import { GoogleDriveAuthService } from "./services/google-drive-auth.service";
import { GoogleDriveFileService } from "./services/google-drive-file.service";
import { GoogleDriveImportService } from "./services/google-drive-import.service";
import { GoogleDriveExportService } from "./services/google-drive-export.service";
import { GoogleDriveSyncService } from "./services/google-drive-sync.service";
import {
  ListFilesDto,
  ImportFilesDto,
  ExportResourcesDto,
  UpdateConnectionDto,
} from "./dto/google-drive.dto";

// Extend Express Request to include user
interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

@ApiTags("Google Drive Integration")
@Controller("google-drive")
@ApiBearerAuth()
export class GoogleDriveController {
  private readonly logger = new Logger(GoogleDriveController.name);

  constructor(
    private readonly authService: GoogleDriveAuthService,
    private readonly fileService: GoogleDriveFileService,
    private readonly importService: GoogleDriveImportService,
    private readonly exportService: GoogleDriveExportService,
    private readonly syncService: GoogleDriveSyncService,
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
  @ApiOperation({ summary: "获取 Google Drive OAuth 授权 URL" })
  @ApiResponse({ status: 200, description: "返回授权 URL" })
  async getConnectUrl(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);

    // 检查用户是否已有连接
    const existingConnection = await this.authService.getConnection(userId);
    // 只有首次连接才需要 consent prompt 以获取 refresh_token
    const forceConsent = !existingConnection;

    const state = Buffer.from(JSON.stringify({ userId })).toString("base64");
    const url = this.authService.getAuthorizationUrl(state, forceConsent);
    return { url };
  }

  @Get("callback")
  @Public()
  @ApiOperation({ summary: "Google Drive OAuth 回调（用于浏览器重定向流程）" })
  async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") error: string,
    @Res() res: Response,
  ) {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    if (error) {
      return res.redirect(
        `${frontendUrl}/library?tab=google-drive&error=${encodeURIComponent(error)}`,
      );
    }

    try {
      // 解析 state 获取 userId
      const stateData = JSON.parse(Buffer.from(state, "base64").toString());
      const userId = stateData.userId;

      const result = await this.authService.exchangeCodeForToken(userId, code);

      return res.redirect(
        `${frontendUrl}/library?tab=google-drive&success=true&email=${encodeURIComponent(result.email)}`,
      );
    } catch (err) {
      this.logger.error(`OAuth callback error: ${err}`);
      return res.redirect(
        `${frontendUrl}/library?tab=google-drive&error=${encodeURIComponent("Failed to connect Google Drive")}`,
      );
    }
  }

  @Delete("disconnect")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "断开 Google Drive 连接" })
  @ApiResponse({ status: 200, description: "断开成功" })
  async disconnect(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    await this.authService.disconnect(userId);
    return { message: "Google Drive disconnected" };
  }

  @Delete("disconnect/:connectionId")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "断开 Google Drive 连接（通过 ID）" })
  @ApiResponse({ status: 200, description: "断开成功" })
  async disconnectById(
    @Req() req: AuthenticatedRequest,
    @Param("connectionId") connectionId: string,
  ) {
    const userId = this.getUserId(req);
    // 验证 connectionId 属于当前用户
    const connection = await this.authService.getConnection(userId);
    if (!connection || connection.id !== connectionId) {
      throw new HttpException("Connection not found", HttpStatus.NOT_FOUND);
    }
    await this.authService.disconnect(userId);
    return { message: "Google Drive disconnected" };
  }

  @Get("connection")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取连接信息" })
  @ApiResponse({ status: 200, description: "返回连接信息" })
  async getConnection(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    const connection = await this.authService.getConnection(userId);
    return { connection };
  }

  @Patch("connection")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "更新连接配置" })
  @ApiResponse({ status: 200, description: "更新成功" })
  async updateConnection(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateConnectionDto,
  ) {
    const userId = this.getUserId(req);
    const connection = await this.authService.updateConnection(userId, dto);
    return { connection };
  }

  // ============ Connections (复数路由，兼容前端) ============

  @Get("connections")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取用户的所有连接（兼容前端）" })
  @ApiResponse({ status: 200, description: "返回连接列表" })
  async getConnections(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    const connection = await this.authService.getConnection(userId);
    // 返回数组格式，兼容前端期望的 connections 列表
    return { connections: connection ? [connection] : [] };
  }

  @Get("connections/:id")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取单个连接详情" })
  @ApiResponse({ status: 200, description: "返回连接信息" })
  async getConnectionById(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    const userId = this.getUserId(req);
    const connection = await this.authService.getConnection(userId);
    if (!connection || connection.id !== id) {
      throw new HttpException("Connection not found", HttpStatus.NOT_FOUND);
    }
    return { connection };
  }

  @Patch("connections/:id")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "更新连接配置（通过 ID）" })
  @ApiResponse({ status: 200, description: "更新成功" })
  async updateConnectionById(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateConnectionDto,
  ) {
    const userId = this.getUserId(req);
    const connection = await this.authService.getConnection(userId);
    if (!connection || connection.id !== id) {
      throw new HttpException("Connection not found", HttpStatus.NOT_FOUND);
    }
    const updated = await this.authService.updateConnection(userId, dto);
    return { connection: updated };
  }

  // ============ Files ============

  @Get("files")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "列出文件" })
  @ApiResponse({ status: 200, description: "返回文件列表" })
  async listFiles(
    @Req() req: AuthenticatedRequest,
    @Query() dto: ListFilesDto,
  ) {
    const userId = this.getUserId(req);
    const result = await this.fileService.listFiles(userId, dto);
    return result;
  }

  @Get("files/:id")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取单个文件信息" })
  @ApiResponse({ status: 200, description: "返回文件信息" })
  async getFile(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const userId = this.getUserId(req);
    const file = await this.fileService.getFile(userId, id);
    return { file };
  }

  // ============ Import/Export ============

  @Post("import")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "导入文件到 Library" })
  @ApiResponse({ status: 200, description: "导入成功" })
  async importFiles(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ImportFilesDto,
  ) {
    const userId = this.getUserId(req);
    const result = await this.importService.importFiles(userId, dto);
    return {
      message: `Imported ${result.imported} of ${result.totalFiles} files`,
      ...result,
    };
  }

  @Post("export")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "导出资源到 Google Drive" })
  @ApiResponse({ status: 200, description: "导出成功" })
  async exportResources(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ExportResourcesDto,
  ) {
    const userId = this.getUserId(req);
    const result = await this.exportService.exportResources(userId, dto);
    return {
      message: `Exported ${result.exported} of ${result.totalResources} resources`,
      ...result,
    };
  }

  // ============ Sync ============

  @Get("sync/status")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取同步状态" })
  @ApiResponse({ status: 200, description: "返回同步状态" })
  async getSyncStatus(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);

    try {
      const status = await this.syncService.getSyncStatus(userId);
      return status;
    } catch {
      return { status: "not_connected" };
    }
  }

  @Post("sync")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "触发双向同步" })
  @ApiResponse({ status: 200, description: "同步结果" })
  async triggerSync(
    @Req() req: AuthenticatedRequest,
    @Body() body: { direction?: "import" | "export" },
  ) {
    const userId = this.getUserId(req);
    const result = await this.syncService.sync(userId, {
      forceDirection: body.direction,
    });
    return {
      ...result,
      message: `Synced: ${result.imported} imported, ${result.exported} exported`,
    };
  }

  @Post("sync/resolve")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "解决同步冲突" })
  @ApiResponse({ status: 200, description: "冲突已解决" })
  async resolveConflict(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: { conflictId: string; resolution: "keep_local" | "keep_remote" },
  ) {
    const userId = this.getUserId(req);
    await this.syncService.resolveConflict(
      userId,
      body.conflictId,
      body.resolution,
    );
    return { message: "Conflict resolved" };
  }

  @Post("sync/link")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "链接本地资源到 Google Drive 文件" })
  @ApiResponse({ status: 200, description: "链接成功" })
  async linkResource(
    @Req() req: AuthenticatedRequest,
    @Body() body: { resourceId: string; googleFileId: string },
  ) {
    const userId = this.getUserId(req);
    await this.syncService.linkResource(
      userId,
      body.resourceId,
      body.googleFileId,
    );
    return { message: "Resource linked" };
  }

  @Delete("sync/link/:resourceId")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "取消资源与 Google Drive 的链接" })
  @ApiResponse({ status: 200, description: "取消链接成功" })
  async unlinkResource(
    @Req() req: AuthenticatedRequest,
    @Param("resourceId") resourceId: string,
  ) {
    const userId = this.getUserId(req);
    await this.syncService.unlinkResource(userId, resourceId);
    return { message: "Resource unlinked" };
  }

  @Get("sync/history")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "获取同步历史" })
  @ApiResponse({ status: 200, description: "返回同步历史" })
  async getSyncHistory(
    @Req() req: AuthenticatedRequest,
    @Query("limit") limit?: number,
  ) {
    const userId = this.getUserId(req);

    const connection = await this.authService.getConnection(userId);
    if (!connection) {
      throw new HttpException(
        "Google Drive not connected",
        HttpStatus.BAD_REQUEST,
      );
    }

    const history = await this.syncService.getSyncHistory(
      connection.id,
      limit || 10,
    );

    return { history };
  }

  // ============ Config ============

  @Get("config")
  @Public()
  @ApiOperation({ summary: "获取 Google Drive 集成配置状态" })
  @ApiResponse({ status: 200, description: "返回配置状态" })
  async getConfig() {
    return {
      configured: this.authService.isConfigured(),
      redirectUri: process.env.GOOGLE_DRIVE_REDIRECT_URI || "",
    };
  }
}
