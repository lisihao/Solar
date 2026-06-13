import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
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
  ListReportsDto,
  ExportReportDto,
  CompareReportsDto,
  ListEvidenceDto,
  UpdateReportContentDto,
  AIEditReportDto,
  RollbackReportDto,
} from "../dto";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import type { RequestWithUser } from "../../../../common/types/express-request.types";
import { BillingContextInterceptor } from "../guards/billing-context.interceptor";
import { TopicAccessGuard, RequireTopicAccess } from "../guards";
import { CollaboratorRole } from "../dto/collaborator.dto";

@ApiTags("Topic Research")
@ApiBearerAuth("access-token")
@Controller("insight")
@UseGuards(JwtAuthGuard)
@UseInterceptors(BillingContextInterceptor)
export class ReportController {
  private readonly logger = new Logger(ReportController.name);

  constructor(private readonly topicResearchService: TopicInsightsService) {}

  // ==================== Reports ====================

  /**
   * 获取报告列表
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:id/reports")
  @ApiOperation({
    summary: "获取报告列表",
    description: "获取专题的历史报告（按版本倒序）",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiQuery({ name: "limit", required: false, description: "返回数量" })
  @ApiQuery({ name: "cursor", required: false, description: "游标" })
  @ApiResponse({ status: 200, description: "返回报告列表" })
  async listReports(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Query() query: ListReportsDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    // TODO: Implement listReports
    return this.topicResearchService.listReports(userId, id, query);
  }

  /**
   * 获取最新报告
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:id/reports/latest")
  @ApiOperation({ summary: "获取最新报告" })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回最新报告" })
  @ApiResponse({ status: 404, description: "报告不存在" })
  async getLatestReport(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    // TODO: Implement getLatestReport
    return this.topicResearchService.getLatestReport(userId, id);
  }

  /**
   * 获取指定版本报告
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/reports/:reportId")
  @ApiOperation({ summary: "获取指定版本报告" })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "返回报告详情" })
  async getReport(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    // TODO: Implement getReport
    return this.topicResearchService.getReport(userId, topicId, reportId);
  }

  /**
   * 删除报告
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Delete("topics/:topicId/reports/:reportId")
  @ApiOperation({
    summary: "删除报告",
    description: "删除指定报告及其所有关联数据（维度分析、修订历史、批注等）",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "删除成功" })
  @ApiResponse({ status: 404, description: "报告不存在" })
  async deleteReport(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.deleteReport(userId, topicId, reportId);
  }

  /**
   * 导出报告
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Post("topics/:topicId/reports/:reportId/export")
  @ApiOperation({ summary: "导出报告为 PDF 或 DOCX" })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "返回下载链接" })
  async exportReport(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Body() dto: ExportReportDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    // TODO: Implement exportReport
    return this.topicResearchService.exportReport(
      userId,
      topicId,
      reportId,
      dto,
    );
  }

  /**
   * 比较报告版本
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Post("topics/:id/reports/compare")
  @ApiOperation({ summary: "比较两个版本的报告差异" })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回差异对比" })
  async compareReports(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: CompareReportsDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    // TODO: Implement compareReports
    return this.topicResearchService.compareReports(userId, id, dto);
  }

  /**
   * 更新报告内容
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Patch("topics/:topicId/reports/:reportId")
  @ApiOperation({
    summary: "更新报告内容",
    description: "手动编辑报告内容，自动创建修订历史",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "更新成功" })
  @ApiResponse({ status: 404, description: "报告不存在" })
  async updateReportContent(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Body() dto: UpdateReportContentDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.updateReportContent(
      userId,
      topicId,
      reportId,
      dto,
    );
  }

  /**
   * AI 编辑报告
   * ★ Security: 速率限制 5次/分钟，AI 密集型操作
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:topicId/reports/:reportId/ai-edit")
  @ApiOperation({
    summary: "AI 编辑报告",
    description: "使用 AI 对报告进行重写、润色、扩写、压缩或风格调整",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "编辑成功" })
  @ApiResponse({ status: 404, description: "报告不存在" })
  @ApiResponse({ status: 429, description: "请求过于频繁" })
  async aiEditReport(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Body() dto: AIEditReportDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.aiEditReport(
      userId,
      topicId,
      reportId,
      dto,
    );
  }

  /**
   * 获取报告修订历史
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/reports/:reportId/revisions")
  @ApiOperation({
    summary: "获取修订历史",
    description: "获取报告的所有修订版本记录",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "返回修订历史列表" })
  @ApiResponse({ status: 404, description: "报告不存在" })
  async getReportRevisions(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.getReportRevisions(
      userId,
      topicId,
      reportId,
    );
  }

  /**
   * 回滚报告版本
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:topicId/reports/:reportId/rollback")
  @ApiOperation({
    summary: "回滚报告版本",
    description: "将报告回滚到指定的历史版本",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "回滚成功" })
  @ApiResponse({ status: 404, description: "报告或修订版本不存在" })
  async rollbackReport(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Body() dto: RollbackReportDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.rollbackReport(
      userId,
      topicId,
      reportId,
      dto.revisionNumber,
    );
  }

  // ==================== Report Changes ====================

  /**
   * 获取报告变更列表
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/reports/:reportId/changes")
  @ApiOperation({
    summary: "获取报告变更列表",
    description: "获取报告的所有增量更新变更记录",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "返回变更列表" })
  async getReportChanges(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");
    return this.topicResearchService.getReportChanges(
      userId,
      topicId,
      reportId,
    );
  }

  /**
   * Checkin 单条变更
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:topicId/reports/:reportId/changes/:changeId/checkin")
  @ApiOperation({
    summary: "Checkin 单条变更",
    description: "将单条变更标记为已确认",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiParam({ name: "changeId", description: "变更ID" })
  @ApiResponse({ status: 200, description: "Checkin 成功" })
  async checkinChange(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Param("changeId") changeId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");
    return this.topicResearchService.checkinChange(
      userId,
      topicId,
      reportId,
      changeId,
    );
  }

  /**
   * 批量 Checkin 变更
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:topicId/reports/:reportId/changes/checkin")
  @ApiOperation({
    summary: "批量 Checkin 变更",
    description: "批量确认报告变更",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "Checkin 成功" })
  async checkinAllChanges(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Body() dto: { changeIds?: string[] },
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");
    return this.topicResearchService.checkinAllChanges(
      userId,
      topicId,
      reportId,
      dto.changeIds,
    );
  }

  // ==================== Evidence ====================

  /**
   * 获取证据列表
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/reports/:reportId/evidence")
  @ApiOperation({ summary: "获取报告的引用证据" })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiQuery({ name: "dimensionId", required: false, description: "维度ID" })
  @ApiQuery({ name: "sourceType", required: false, description: "来源类型" })
  @ApiQuery({
    name: "minCredibility",
    required: false,
    description: "最低可信度",
  })
  @ApiQuery({ name: "sortBy", required: false, description: "排序方式" })
  @ApiQuery({ name: "pageSize", required: false, description: "每页数量" })
  @ApiQuery({ name: "page", required: false, description: "页码" })
  @ApiResponse({ status: 200, description: "返回证据列表" })
  async listEvidence(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Query() query: ListEvidenceDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    // TODO: Implement listEvidence
    return this.topicResearchService.listEvidence(
      userId,
      topicId,
      reportId,
      query,
    );
  }

  /**
   * 获取证据详情
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/reports/:reportId/evidence/:evidenceId")
  @ApiOperation({ summary: "获取证据详情" })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiParam({ name: "evidenceId", description: "证据ID" })
  @ApiResponse({ status: 200, description: "返回证据详情" })
  async getEvidence(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Param("evidenceId") evidenceId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    // TODO: Implement getEvidence
    return this.topicResearchService.getEvidence(
      userId,
      topicId,
      reportId,
      evidenceId,
    );
  }

  // ==================== Credibility Report ====================

  /**
   * 获取报告可信度评估
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/reports/:reportId/credibility")
  @ApiOperation({
    summary: "获取可信度报告",
    description: "获取报告的可信度评估，包括来源分布、时效性、覆盖度等指标",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "返回可信度评估" })
  async getCredibilityReport(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.getCredibilityReport(userId, reportId);
  }

  /**
   * ★ 重新处理报告格式（不调 LLM，只跑后处理管道）
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:topicId/reports/:reportId/reprocess")
  @ApiOperation({
    summary: "重新处理报告格式",
    description:
      "对已存储的报告重新跑最新的后处理管道（不调用 LLM），修复格式问题",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "处理完成" })
  async reprocessReportFormatting(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.reprocessReportFormatting(
      userId,
      reportId,
    );
  }

  /**
   * ★ Batch LaTeX repair: scan + repair EVERY report owned by the caller.
   * Sequential (one report at a time) to bound LLM cost and rate limits.
   * Pass `?dryRun=true` to validate without writing back to DB.
   */
  @Throttle({ default: { limit: 2, ttl: 60000 } })
  @Post("admin/repair-all-latex")
  @ApiOperation({
    summary: "批量修复所有报告的 LaTeX",
    description:
      "遍历当前用户所有 topic 的所有 report，检测并修复 LaTeX 定界符问题。顺序执行，严格限流。",
  })
  @ApiQuery({
    name: "dryRun",
    required: false,
    description: "true 表示只检测不落库",
  })
  @ApiResponse({
    status: 200,
    description:
      "返回 { totalReports, repaired, skipped, failed, dryRun, details[] }",
  })
  async repairAllReportsLatex(
    @Request() req: RequestWithUser,
    @Query("dryRun") dryRun?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.repairAllReportsLatex(userId, {
      dryRun: dryRun === "true",
    });
  }

  /**
   * ★ LaTeX-only repair for historical reports (calls LLM once, keeps prose).
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("topics/:topicId/reports/:reportId/repair-latex")
  @ApiOperation({
    summary: "修复报告中的 LaTeX 定界符",
    description:
      "仅对已存储报告的 LaTeX 公式做定界符修复（加 $ 包裹、闭合未闭合、去除错位的 $），不改动任何正文内容",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({
    status: 200,
    description: "返回 { changed, issuesBefore, issuesAfter }",
  })
  async repairReportLatex(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.repairReportLatex(userId, reportId);
  }

  /**
   * ★ v5: 获取报告质量追踪数据
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/reports/:reportId/quality-trace")
  @ApiOperation({
    summary: "获取报告质量追踪",
    description: "返回报告生成全链路的质量探针数据",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "质量追踪数据" })
  async getQualityTrace(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.getReportQualityTrace(
      userId,
      topicId,
      reportId,
    );
  }

  /**
   * ★ v5: 获取报告质量概览
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/reports/:reportId/quality-summary")
  @ApiOperation({
    summary: "获取报告质量概览",
    description: "返回简化的质量评分和主要问题",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "质量概览" })
  async getQualitySummary(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.getReportQualitySummary(
      userId,
      topicId,
      reportId,
    );
  }

  /**
   * ★ v5.1: 获取报告质量缺陷详情（具体行内容）
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/reports/:reportId/quality-details")
  @ApiOperation({
    summary: "获取报告质量缺陷详情",
    description: "按需扫描报告内容，返回具体缺陷行",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "缺陷详情" })
  async getQualityDetails(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
    @Query("rule") rule?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.getReportQualityDetails(
      userId,
      topicId,
      reportId,
      rule,
    );
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:topicId/reports/:reportId/regenerate")
  @ApiOperation({
    summary: "重新合成报告内容",
    description: "重新合成报告的 Markdown 内容，用于修复格式问题",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 202, description: "已接受，后台处理中" })
  @HttpCode(202)
  async regenerateReportContent(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("reportId") reportId: string,
    @Body() body?: { feedback?: string }, // 可选的用户反馈，最长500字
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    // 异步执行，立即返回 202
    this.topicResearchService
      .regenerateReportContent(userId, reportId, body?.feedback?.slice(0, 500))
      .catch((err) => {
        this.logger.error(
          `[regenerateReportContent] Background regeneration failed: ${err.message}`,
          err.stack,
        );
      });
    return { status: "processing", message: "报告正在重新生成中，请稍候" };
  }

  /**
   * 重新生成可信度报告
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:topicId/reports/:reportId/credibility/regenerate")
  @ApiOperation({
    summary: "重新生成可信度报告",
    description: "强制重新计算报告的可信度评估",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "返回新的可信度评估" })
  async regenerateCredibilityReport(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.regenerateCredibilityReport(
      userId,
      reportId,
    );
  }

  /**
   * ★ 重新计算证据可信度评分
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:topicId/reports/:reportId/evidence/recalculate-credibility")
  @ApiOperation({
    summary: "重新计算证据可信度",
    description: "重新计算报告中所有证据的可信度评分，用于修复历史数据问题",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "reportId", description: "报告ID" })
  @ApiResponse({ status: 200, description: "返回更新统计" })
  async recalculateEvidenceCredibility(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("reportId") reportId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.recalculateEvidenceCredibility(
      userId,
      topicId,
      reportId,
    );
  }
}
