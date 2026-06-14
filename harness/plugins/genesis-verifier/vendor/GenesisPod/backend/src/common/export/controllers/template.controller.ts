/**
 * 统一导出系统 - 模板控制器
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Logger,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { TemplateManagerService } from "../services/template-manager.service";
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  TemplateQueryDto,
} from "../types/export-options";

// Extend Express Request to include user
interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

@Controller("templates")
@UseGuards(JwtAuthGuard)
export class TemplateController {
  private readonly logger = new Logger(TemplateController.name);

  constructor(private readonly templateManager: TemplateManagerService) {}

  private getUserId(req: AuthenticatedRequest): string {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error("User not authenticated");
    }
    return userId;
  }

  /**
   * 获取模板列表
   * GET /api/templates
   */
  @Get()
  async getTemplates(
    @Req() req: AuthenticatedRequest,
    @Query() query: TemplateQueryDto,
  ) {
    return this.templateManager.getTemplates(this.getUserId(req), query);
  }

  /**
   * 获取单个模板
   * GET /api/templates/:id
   */
  @Get(":id")
  async getTemplate(
    @Req() req: AuthenticatedRequest,
    @Param("id") templateId: string,
  ) {
    return this.templateManager.getTemplate(templateId, this.getUserId(req));
  }

  /**
   * 创建模板
   * POST /api/templates
   */
  @Post()
  async createTemplate(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateTemplateDto,
  ) {
    const userId = this.getUserId(req);
    this.logger.log(`Creating template for user: ${userId}`);
    return this.templateManager.createTemplate(userId, dto);
  }

  /**
   * 更新模板
   * PUT /api/templates/:id
   */
  @Put(":id")
  async updateTemplate(
    @Req() req: AuthenticatedRequest,
    @Param("id") templateId: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templateManager.updateTemplate(
      templateId,
      this.getUserId(req),
      dto,
    );
  }

  /**
   * 删除模板
   * DELETE /api/templates/:id
   */
  @Delete(":id")
  async deleteTemplate(
    @Req() req: AuthenticatedRequest,
    @Param("id") templateId: string,
  ) {
    await this.templateManager.deleteTemplate(templateId, this.getUserId(req));
    return { success: true };
  }

  /**
   * 复制模板
   * POST /api/templates/:id/duplicate
   */
  @Post(":id/duplicate")
  async duplicateTemplate(
    @Req() req: AuthenticatedRequest,
    @Param("id") templateId: string,
    @Body() body: { name?: string },
  ) {
    return this.templateManager.duplicateTemplate(
      templateId,
      this.getUserId(req),
      body.name,
    );
  }
}
