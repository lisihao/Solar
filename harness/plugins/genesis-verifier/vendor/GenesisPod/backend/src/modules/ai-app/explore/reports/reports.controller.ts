import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import { ReportsService } from "./reports.service";
import { GenerateReportDto } from "./dto/generate-report.dto";

/**
 * 报告控制器 - 多素材AI综合报告生成
 */
@ApiTags("Reports")
@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * 生成报告
   * POST /api/v1/reports/generate
   */
  @Post("generate")
  @HttpCode(HttpStatus.CREATED)
  async generateReport(@Body() dto: GenerateReportDto) {
    return this.reportsService.generateReport(dto);
  }

  /**
   * 与资源对话 (AI Chat)
   * POST /api/v1/reports/chat
   */
  @Post("chat")
  @HttpCode(HttpStatus.OK)
  async chatWithResources(
    @Body() dto: Record<string, unknown>,
    @Res() res: Response,
  ) {
    return this.reportsService.chatWithResources(dto, res);
  }

  /**
   * 获取单个报告
   * GET /api/v1/reports/:id
   */
  @Get(":id")
  async getReport(@Param("id") id: string, @Query("userId") userId?: string) {
    return this.reportsService.findOne(id, userId);
  }

  /**
   * 获取用户的所有报告
   * GET /api/v1/reports?userId=xxx&page=1&limit=20
   */
  @Get()
  async getUserReports(
    @Query("userId") userId: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    return this.reportsService.findByUser(userId, pageNum, limitNum);
  }

  /**
   * 删除报告
   * DELETE /api/v1/reports/:id?userId=xxx
   */
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async deleteReport(@Param("id") id: string, @Query("userId") userId: string) {
    return this.reportsService.delete(id, userId);
  }

  /**
   * 导出文档 (Word, PPT, PDF, Markdown)
   * POST /api/v1/reports/export
   */
  @Post("export")
  @HttpCode(HttpStatus.OK)
  async exportDocument(
    @Body()
    dto: { format: string; content: string; title: string; userId?: string },
    @Res() res: Response,
  ) {
    const userId = dto.userId || "system";
    return this.reportsService.exportDocument(dto, res, userId);
  }
}
