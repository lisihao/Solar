/**
 * 统一导出系统 - 导出控制器
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Res,
  Req,
  UseGuards,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Response, Request } from "express";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { ExportOrchestratorService } from "../services/export-orchestrator.service";
import { ExportRequest } from "../types/export-options";

// Extend Express Request to include user
interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

@Controller("export")
@UseGuards(JwtAuthGuard)
export class ExportController {
  private readonly logger = new Logger(ExportController.name);

  constructor(private readonly exportOrchestrator: ExportOrchestratorService) {}

  /**
   * 创建导出任务
   * POST /api/export
   */
  @Post()
  async createExportJob(
    @Req() req: AuthenticatedRequest,
    @Body() request: ExportRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error("User not authenticated");
    }
    this.logger.log(`Creating export job for user: ${userId}`);
    return this.exportOrchestrator.createExportJob(userId, request);
  }

  /**
   * 获取导出任务状态
   * GET /api/export/:jobId
   */
  @Get(":jobId")
  async getJobStatus(
    @Req() req: AuthenticatedRequest,
    @Param("jobId") jobId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error("User not authenticated");
    }
    return this.exportOrchestrator.getJobStatus(jobId, userId);
  }

  /**
   * 下载导出文件
   * GET /api/export/:jobId/download
   */
  @Get(":jobId/download")
  async downloadExport(
    @Req() req: AuthenticatedRequest,
    @Param("jobId") jobId: string,
    @Res() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      res.status(HttpStatus.UNAUTHORIZED).json({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: "User not authenticated",
      });
      return;
    }

    try {
      const { buffer, fileName, mimeType } =
        await this.exportOrchestrator.getExportFile(jobId, userId);

      res.set({
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Content-Length": buffer.length,
      });

      res.send(buffer);
    } catch (error) {
      this.logger.error(`Download failed for job ${jobId}: ${error}`);
      res.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: error instanceof Error ? error.message : "Download failed",
      });
    }
  }
}
