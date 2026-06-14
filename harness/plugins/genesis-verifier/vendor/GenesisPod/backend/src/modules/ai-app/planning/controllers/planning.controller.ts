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
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { Throttle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { PlanningOrchestratorService } from "../services/planning-orchestrator.service";
import { PlanningTemplateService } from "../services/planning-template.service";
import { CreatePlanDto } from "../dto/create-plan.dto";
import { UpdatePlanDto, UpdatePlanVisibilityDto } from "../dto/update-plan.dto";
import { ReplanDto } from "../dto/replan.dto";
import type { RequestWithUser } from "../../../../common/types/express-request.types";

@ApiTags("AI Planning")
@ApiBearerAuth()
@Controller("planning")
@UseGuards(JwtAuthGuard)
export class PlanningController {
  constructor(
    private readonly orchestrator: PlanningOrchestratorService,
    private readonly templateService: PlanningTemplateService,
  ) {}

  @Post()
  @ApiOperation({ summary: "创建策划" })
  @ApiResponse({ status: 201, description: "策划创建成功" })
  async createPlan(
    @Request() req: RequestWithUser,
    @Body() dto: CreatePlanDto,
  ) {
    return this.orchestrator.createPlan(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: "获取策划列表" })
  @ApiResponse({ status: 200, description: "策划列表" })
  async getPlans(
    @Request() req: RequestWithUser,
    @Query("search") search?: string,
  ) {
    return this.orchestrator.getPlans(req.user.id, search);
  }

  @Get("templates")
  @ApiOperation({ summary: "获取策划模板列表" })
  @ApiResponse({ status: 200, description: "模板列表" })
  async getTemplates() {
    return this.templateService.getTemplates();
  }

  @Get(":planId")
  @ApiOperation({ summary: "获取策划详情" })
  @ApiResponse({ status: 200, description: "策划详情" })
  async getPlanDetail(
    @Request() req: RequestWithUser,
    @Param("planId") planId: string,
  ) {
    return this.orchestrator.getPlanDetail(planId, req.user.id);
  }

  @Patch(":planId")
  @ApiOperation({ summary: "更新策划设置" })
  @ApiResponse({ status: 200, description: "策划更新成功" })
  async updatePlan(
    @Request() req: RequestWithUser,
    @Param("planId") planId: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.orchestrator.updatePlan(planId, req.user.id, dto);
  }

  @Patch(":planId/visibility")
  @ApiOperation({ summary: "更新策划可见性" })
  @ApiResponse({ status: 200, description: "可见性更新成功" })
  async updatePlanVisibility(
    @Request() req: RequestWithUser,
    @Param("planId") planId: string,
    @Body() dto: UpdatePlanVisibilityDto,
  ) {
    return this.orchestrator.updatePlanVisibility(
      planId,
      req.user.id,
      dto.visibility,
    );
  }

  @Post(":planId/advance")
  @ApiOperation({ summary: "推进到下一阶段" })
  @ApiResponse({ status: 200, description: "阶段推进成功" })
  async advancePhase(
    @Request() req: RequestWithUser,
    @Param("planId") planId: string,
  ) {
    return this.orchestrator.advancePhase(planId, req.user.id);
  }

  @Post(":planId/phase/:phase/retry")
  @ApiOperation({ summary: "重新执行某阶段" })
  @ApiResponse({ status: 200, description: "阶段重试成功" })
  async retryPhase(
    @Request() req: RequestWithUser,
    @Param("planId") planId: string,
    @Param("phase") phase: string,
  ) {
    return this.orchestrator.retryPhase(
      planId,
      parseInt(phase, 10),
      req.user.id,
    );
  }

  @Post(":planId/replan")
  @ApiOperation({ summary: "从指定阶段重新策划" })
  @ApiResponse({ status: 200, description: "重新策划已启动" })
  async replanFromPhase(
    @Request() req: RequestWithUser,
    @Param("planId") planId: string,
    @Body() dto: ReplanDto,
  ) {
    return this.orchestrator.replanFromPhase(
      planId,
      dto.startPhase,
      req.user.id,
    );
  }

  @Post(":planId/cancel")
  @ApiOperation({ summary: "取消当前阶段" })
  @ApiResponse({ status: 200, description: "阶段取消成功" })
  async cancelPhase(
    @Request() req: RequestWithUser,
    @Param("planId") planId: string,
  ) {
    await this.orchestrator.cancelPhase(planId, req.user.id);
    return { success: true };
  }

  @Get(":planId/export")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: "导出策划文档" })
  @ApiResponse({ status: 200, description: "Markdown" })
  async exportPlan(
    @Request() req: RequestWithUser,
    @Param("planId") planId: string,
    @Query("mode") mode: string,
    @Res() res: Response,
  ) {
    const exportMode = mode === "full" ? "full" : "report";
    const markdown = await this.orchestrator.exportPlan(
      planId,
      req.user.id,
      exportMode,
    );
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="plan-${planId}.md"`,
    );
    res.send(markdown);
  }

  @Delete(":planId")
  @ApiOperation({ summary: "删除策划" })
  @ApiResponse({ status: 200, description: "策划删除成功" })
  async deletePlan(
    @Request() req: RequestWithUser,
    @Param("planId") planId: string,
  ) {
    await this.orchestrator.deletePlan(planId, req.user.id);
    return { success: true };
  }
}
