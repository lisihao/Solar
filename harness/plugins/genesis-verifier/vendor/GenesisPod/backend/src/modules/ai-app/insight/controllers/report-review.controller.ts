import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from "@nestjs/swagger";
import { TopicInsightsService } from "../topic-insights.service";
import {
  AssignReviewTaskDto,
  CompleteReviewTaskDto,
  CreateAnnotationDto,
  UpdateAnnotationDto,
} from "../dto";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { ReviewWorkflowService } from "../services";
import type { RequestWithUser } from "../../../../common/types/express-request.types";
import { BillingContextInterceptor } from "../guards/billing-context.interceptor";
import { TopicAccessGuard, RequireTopicAccess } from "../guards";
import { CollaboratorRole } from "../dto/collaborator.dto";

@ApiTags("Topic Research")
@ApiBearerAuth("access-token")
@Controller("insight")
@UseGuards(JwtAuthGuard)
@UseInterceptors(BillingContextInterceptor)
export class ReportReviewController {
  constructor(
    private readonly topicResearchService: TopicInsightsService,
    private readonly reviewWorkflowService: ReviewWorkflowService,
  ) {}

  // ==================== Report Annotations ====================

  /**
   * 获取报告批注列表
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/reports/:reportId/annotations")
  @ApiOperation({
    summary: "获取报告批注",
    description: "获取报告的所有批注",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiQuery({
    name: "status",
    required: false,
    description: "批注状态 (OPEN, RESOLVED, DISMISSED)",
  })
  @ApiResponse({ status: 200, description: "返回批注列表" })
  async getReportAnnotations(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Query("status") status?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");
    return this.topicResearchService.getReportAnnotations(
      userId,
      topicId,
      reportId,
      status,
    );
  }

  /**
   * 创建批注
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:topicId/reports/:reportId/annotations")
  @ApiOperation({
    summary: "创建批注",
    description: "在报告中添加新批注",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 201, description: "批注创建成功" })
  async createAnnotation(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Body() dto: CreateAnnotationDto,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");
    return this.topicResearchService.createAnnotation(
      userId,
      topicId,
      reportId,
      dto,
    );
  }

  /**
   * 更新批注
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Patch("topics/:topicId/reports/:reportId/annotations/:annotationId")
  @ApiOperation({
    summary: "更新批注",
    description: "修改批注内容或状态",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiParam({ name: "annotationId", description: "批注ID" })
  @ApiResponse({ status: 200, description: "更新成功" })
  async updateAnnotation(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Param("annotationId") annotationId: string,
    @Body() dto: UpdateAnnotationDto,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");
    return this.topicResearchService.updateAnnotation(
      userId,
      topicId,
      reportId,
      annotationId,
      dto,
    );
  }

  /**
   * 删除批注
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Delete("topics/:topicId/reports/:reportId/annotations/:annotationId")
  @ApiOperation({
    summary: "删除批注",
    description: "从报告中删除批注",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiParam({ name: "annotationId", description: "批注ID" })
  @ApiResponse({ status: 200, description: "删除成功" })
  async deleteAnnotation(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Param("annotationId") annotationId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");
    return this.topicResearchService.deleteAnnotation(
      userId,
      topicId,
      reportId,
      annotationId,
    );
  }

  /**
   * 解决批注
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:topicId/reports/:reportId/annotations/:annotationId/resolve")
  @ApiOperation({
    summary: "解决批注",
    description: "将批注标记为已解决",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiParam({ name: "annotationId", description: "批注ID" })
  @ApiResponse({ status: 200, description: "解决成功" })
  async resolveAnnotation(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Param("annotationId") annotationId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");
    return this.topicResearchService.resolveAnnotation(
      userId,
      topicId,
      reportId,
      annotationId,
    );
  }

  /**
   * 批量解决批注
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:topicId/reports/:reportId/annotations/resolve-all")
  @ApiOperation({
    summary: "批量解决批注",
    description: "批量将批注标记为已解决",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "批量解决成功" })
  async resolveAllAnnotations(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Body() dto: { annotationIds?: string[] },
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");
    return this.topicResearchService.resolveAllAnnotations(
      userId,
      topicId,
      reportId,
      dto.annotationIds,
    );
  }

  // ==================== Review Workflow ====================

  /**
   * 获取报告的审核任务列表
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/reports/:reportId/review-tasks")
  @ApiOperation({
    summary: "获取审核任务列表",
    description: "获取报告的所有审核任务",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "返回审核任务列表" })
  async getReviewTasks(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.reviewWorkflowService.getReviewTasks(reportId);
  }

  /**
   * 创建审核任务
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:topicId/reports/:reportId/review-tasks")
  @ApiOperation({
    summary: "创建审核任务",
    description: "为报告的各章节自动创建审核任务",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 201, description: "审核任务创建成功" })
  async createReviewTasks(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.reviewWorkflowService.createReviewTasksForReport(
      reportId,
      userId,
    );
  }

  /**
   * 分配审核任务
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Patch("topics/:topicId/reports/:reportId/review-tasks/:taskId/assign")
  @ApiOperation({
    summary: "分配审核任务",
    description: "将审核任务分配给指定协作者",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiParam({ name: "taskId", description: "任务ID" })
  @ApiResponse({ status: 200, description: "分配成功" })
  async assignReviewTask(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("reportId") _reportId: string,
    @Param("taskId") taskId: string,
    @Body() dto: AssignReviewTaskDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.reviewWorkflowService.assignTask(
      {
        taskId,
        assigneeId: dto.assigneeId,
        assigneeName: dto.assigneeName,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
      userId,
    );
  }

  /**
   * 完成审核任务
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Patch("topics/:topicId/reports/:reportId/review-tasks/:taskId/complete")
  @ApiOperation({
    summary: "完成审核任务",
    description: "提交审核结果，标记任务为完成",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiParam({ name: "taskId", description: "任务ID" })
  @ApiResponse({ status: 200, description: "审核完成" })
  async completeReviewTask(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("reportId") _reportId: string,
    @Param("taskId") taskId: string,
    @Body() dto: CompleteReviewTaskDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.reviewWorkflowService.completeTask(
      {
        taskId,
        approved: dto.approved,
        comments: dto.comments,
        score: dto.score,
      },
      userId,
    );
  }

  /**
   * 获取审核任务统计
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/reports/:reportId/review-tasks/stats")
  @ApiOperation({
    summary: "获取审核任务统计",
    description: "获取报告审核任务的统计数据",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "返回审核任务统计" })
  async getReviewTaskStats(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.reviewWorkflowService.getTaskStats(reportId);
  }

  /**
   * 检查报告是否可发布
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/reports/:reportId/review-tasks/can-publish")
  @ApiOperation({
    summary: "检查报告是否可发布",
    description: "检查所有审核任务是否完成且通过",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "返回发布状态" })
  async canPublishReport(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.reviewWorkflowService.canPublishReport(reportId);
  }
}
