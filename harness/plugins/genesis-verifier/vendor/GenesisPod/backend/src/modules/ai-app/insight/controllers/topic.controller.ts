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
  Sse,
  MessageEvent,
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
import { Observable } from "rxjs";
import { TopicInsightsService } from "../topic-insights.service";
import {
  CreateTopicDto,
  UpdateTopicDto,
  ListTopicsDto,
  TriggerRefreshDto,
  CancelRefreshDto,
  RefreshDimensionDto,
  AddDimensionDto,
  UpdateDimensionDto,
  ReorderDimensionsDto,
  GetTemplatesDto,
  CreateFromTemplateDto,
  UpdateScheduleDto,
  ListLogsDto,
} from "../dto";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { Public } from "../../../../common/decorators/public.decorator";
import type { RequestWithUser } from "../../../../common/types/express-request.types";
import { BillingContextInterceptor } from "../guards/billing-context.interceptor";

@ApiTags("Topic Research")
@ApiBearerAuth("access-token")
@Controller("insight")
@UseGuards(JwtAuthGuard)
@UseInterceptors(BillingContextInterceptor)
export class TopicController {
  private readonly logger = new Logger(TopicController.name);

  constructor(private readonly topicResearchService: TopicInsightsService) {}

  // ==================== Public Endpoints ====================

  /**
   * 获取公开专题（无需认证）
   * ★ Security: 速率限制 30次/分钟，防止滥用
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("shared/topics/:id")
  @ApiOperation({
    summary: "获取公开专题",
    description: "获取设置为公开可见的研究专题详情（无需登录）",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回专题详情" })
  @ApiResponse({ status: 404, description: "专题不存在或不公开" })
  @ApiResponse({ status: 429, description: "请求过于频繁" })
  async getSharedTopic(@Param("id") id: string) {
    return this.topicResearchService.getSharedTopic(id);
  }

  /**
   * 获取公开专题的最新报告（无需认证）
   * ★ Security: 速率限制 30次/分钟，防止滥用
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("shared/topics/:id/reports/latest")
  @ApiOperation({
    summary: "获取公开专题最新报告",
    description: "获取设置为公开可见的研究专题的最新报告（无需登录）",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回最新报告" })
  @ApiResponse({ status: 404, description: "专题不存在或不公开" })
  @ApiResponse({ status: 429, description: "请求过于频繁" })
  async getSharedTopicLatestReport(@Param("id") id: string) {
    return this.topicResearchService.getSharedTopicLatestReport(id);
  }

  // ==================== Topics CRUD ====================

  /**
   * 创建专题
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post("topics")
  @ApiOperation({
    summary: "创建专题",
    description: "创建一个新的研究专题",
  })
  @ApiResponse({ status: 201, description: "专题创建成功" })
  @ApiResponse({ status: 401, description: "未认证" })
  async createTopic(
    @Request() req: RequestWithUser,
    @Body() dto: CreateTopicDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    this.logger.log(
      `[createTopic] Received DTO: ${JSON.stringify({
        name: dto.name,
        type: dto.type,
        hasTopicConfig: !!dto.topicConfig,
        topicConfigKeys: dto.topicConfig ? Object.keys(dto.topicConfig) : [],
      })}`,
    );
    return this.topicResearchService.createTopic(userId, dto);
  }

  /**
   * 获取专题列表
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics")
  @ApiOperation({
    summary: "获取专题列表",
    description: "获取当前用户的所有研究专题",
  })
  @ApiQuery({ name: "type", required: false, description: "专题类型" })
  @ApiQuery({ name: "status", required: false, description: "专题状态" })
  @ApiQuery({ name: "search", required: false, description: "搜索关键词" })
  @ApiQuery({ name: "skip", required: false, description: "跳过数量" })
  @ApiQuery({ name: "take", required: false, description: "返回数量" })
  @ApiResponse({ status: 200, description: "返回专题列表" })
  async listTopics(
    @Request() req: RequestWithUser,
    @Query() query: ListTopicsDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.listTopics(userId, query);
  }

  /**
   * 获取专题详情
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:id")
  @ApiOperation({ summary: "获取专题详情" })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回专题详情" })
  @ApiResponse({ status: 404, description: "专题不存在" })
  async getTopic(@Request() req: RequestWithUser, @Param("id") id: string) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.getTopic(userId, id);
  }

  /**
   * 更新专题
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Patch("topics/:id")
  @ApiOperation({ summary: "更新专题" })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "更新成功" })
  @ApiResponse({ status: 404, description: "专题不存在" })
  async updateTopic(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateTopicDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.updateTopic(userId, id, dto);
  }

  /**
   * 删除专题
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Delete("topics/:id")
  @ApiOperation({ summary: "删除专题" })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "删除成功" })
  @ApiResponse({ status: 404, description: "专题不存在" })
  async deleteTopic(@Request() req: RequestWithUser, @Param("id") id: string) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.deleteTopic(userId, id);
  }

  // ==================== Refresh Operations ====================

  /**
   * 触发刷新
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("topics/:id/refresh")
  @ApiOperation({
    summary: "触发刷新",
    description: "手动触发专题刷新（全量或增量）",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 202, description: "刷新任务已创建" })
  async triggerRefresh(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: TriggerRefreshDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.triggerRefresh(userId, id, dto);
  }

  /**
   * 获取研究策略建议
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:id/research/strategy")
  @ApiOperation({
    summary: "获取研究策略建议",
    description: "智能分析主题状态，推荐最佳研究策略（全新/增量/全量刷新）",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回研究策略建议" })
  async getResearchStrategy(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.getResearchStrategy(userId, id);
  }

  /**
   * 快速检查研究状态（用于前端按钮）
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:id/research/quick-check")
  @ApiOperation({
    summary: "快速检查研究状态",
    description: "返回研究状态摘要，用于前端按钮显示",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回研究状态摘要" })
  async quickCheckResearchStatus(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.quickCheckResearchStatus(userId, id);
  }

  /**
   * 智能开始研究
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("topics/:id/research/smart-start")
  @HttpCode(202)
  @ApiOperation({
    summary: "智能开始研究",
    description:
      "根据主题状态自动决定研究策略：从未研究→全新研究，有部分过期→增量更新，全部过期→全量刷新",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 202, description: "研究任务已创建" })
  async smartStartResearch(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.smartStartResearch(userId, id);
  }

  /**
   * 获取刷新状态
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:id/refresh/status")
  @ApiOperation({ summary: "获取当前刷新状态" })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回刷新状态" })
  async getRefreshStatus(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.getRefreshStatus(userId, id);
  }

  /**
   * 监听刷新进度 (SSE)
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Sse("topics/:id/refresh/progress")
  @ApiOperation({
    summary: "监听刷新进度",
    description: "Server-Sent Events 实时推送刷新进度",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  streamRefreshProgress(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ): Observable<MessageEvent> {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.streamRefreshProgress(userId, id);
  }

  /**
   * 取消刷新
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post("topics/:id/refresh/cancel")
  @ApiOperation({ summary: "取消正在进行的刷新" })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "取消成功" })
  async cancelRefresh(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: CancelRefreshDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.cancelRefresh(userId, id, dto);
  }

  // ==================== Dimensions ====================

  /**
   * 获取维度列表
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:id/dimensions")
  @ApiOperation({ summary: "获取专题的所有维度" })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回维度列表" })
  async listDimensions(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.listDimensions(userId, id);
  }

  /**
   * 添加维度
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post("topics/:id/dimensions")
  @ApiOperation({ summary: "添加新维度" })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 201, description: "维度创建成功" })
  async addDimension(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: AddDimensionDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.addDimension(userId, id, dto);
  }

  /**
   * 更新维度
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Patch("topics/:topicId/dimensions/:dimensionId")
  @ApiOperation({ summary: "更新维度配置" })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "dimensionId", description: "维度ID" })
  @ApiResponse({ status: 200, description: "更新成功" })
  async updateDimension(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("dimensionId") dimensionId: string,
    @Body() dto: UpdateDimensionDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.updateDimension(
      userId,
      topicId,
      dimensionId,
      dto,
    );
  }

  /**
   * 删除维度
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Delete("topics/:topicId/dimensions/:dimensionId")
  @ApiOperation({ summary: "删除维度" })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "dimensionId", description: "维度ID" })
  @ApiResponse({ status: 200, description: "删除成功" })
  async deleteDimension(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("dimensionId") dimensionId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.deleteDimension(
      userId,
      topicId,
      dimensionId,
    );
  }

  /**
   * 刷新单个维度
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("topics/:topicId/dimensions/:dimensionId/refresh")
  @ApiOperation({ summary: "刷新单个维度" })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "dimensionId", description: "维度ID" })
  @ApiResponse({ status: 202, description: "刷新任务已创建" })
  async refreshDimension(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("dimensionId") dimensionId: string,
    @Body() dto: RefreshDimensionDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.refreshDimension(
      userId,
      topicId,
      dimensionId,
      dto,
    );
  }

  /**
   * 调整维度顺序
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post("topics/:id/dimensions/reorder")
  @ApiOperation({ summary: "调整维度顺序" })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "顺序调整成功" })
  async reorderDimensions(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: ReorderDimensionsDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.reorderDimensions(userId, id, dto);
  }

  // ==================== Templates ====================

  /**
   * 获取模板列表
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("templates")
  @ApiOperation({ summary: "获取专题模板列表" })
  @ApiQuery({ name: "type", required: true, description: "专题类型" })
  @ApiResponse({ status: 200, description: "返回模板列表" })
  async getTemplates(
    @Request() req: RequestWithUser,
    @Query() query: GetTemplatesDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.getTemplates(query);
  }

  /**
   * 从模板创建专题
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post("topics/from-template")
  @ApiOperation({ summary: "从模板创建专题" })
  @ApiResponse({ status: 201, description: "专题创建成功" })
  async createFromTemplate(
    @Request() req: RequestWithUser,
    @Body() dto: CreateFromTemplateDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.createFromTemplate(userId, dto);
  }

  // ==================== Schedule ====================

  /**
   * 获取刷新计划
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:id/schedule")
  @ApiOperation({ summary: "获取专题的刷新计划" })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回刷新计划" })
  async getSchedule(@Request() req: RequestWithUser, @Param("id") id: string) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.getSchedule(userId, id);
  }

  /**
   * 更新刷新计划
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Patch("topics/:id/schedule")
  @ApiOperation({ summary: "更新刷新计划" })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "更新成功" })
  async updateSchedule(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.updateSchedule(userId, id, dto);
  }

  // ==================== Logs ====================

  /**
   * 获取刷新日志
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:id/logs")
  @ApiOperation({ summary: "获取专题的刷新日志" })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiQuery({ name: "limit", required: false, description: "返回数量" })
  @ApiQuery({ name: "status", required: false, description: "日志状态" })
  @ApiResponse({ status: 200, description: "返回日志列表" })
  async getLogs(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Query() query: ListLogsDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.getLogs(userId, id, query);
  }

  // ==================== Compute Usage ====================

  /**
   * 获取专题算力消耗数据
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:topicId/compute-usage")
  @ApiOperation({
    summary: "获取专题算力消耗",
    description: "返回专题的 Token 消耗、模型分布、Credit 历史和研究任务信息",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiQuery({
    name: "missionId",
    required: false,
    description: "按研究任务 ID 筛选（不传则返回最新一次）",
  })
  @ApiResponse({ status: 200, description: "返回算力消耗数据" })
  @ApiResponse({ status: 401, description: "未认证" })
  async getComputeUsage(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Query("missionId") missionId?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.getComputeUsage(
      userId,
      topicId,
      missionId,
    );
  }

  // ==================== Stats ====================

  /**
   * 获取专题统计
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:id/stats")
  @ApiOperation({ summary: "获取专题统计数据" })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回统计数据" })
  async getStats(@Request() req: RequestWithUser, @Param("id") id: string) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return this.topicResearchService.getStats(userId, id);
  }

  /**
   * ★ 重新计算专题统计数据
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post("topics/:topicId/recalculate-stats")
  @ApiOperation({
    summary: "重新计算专题统计数据",
    description:
      "重新计算专题的 totalReports、totalSources 和 lastRefreshAt，用于修复历史数据问题",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回更新后的专题" })
  async recalculateTopicStats(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.recalculateTopicStats(userId, topicId);
  }

  /**
   * 获取研究历史时间线
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:id/research-history")
  @ApiOperation({
    summary: "获取研究历史时间线",
    description: "获取专题的所有研究历史记录，包括每次研究的目标、策略和成果",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiQuery({ name: "limit", required: false, description: "返回数量" })
  @ApiResponse({ status: 200, description: "返回研究历史列表" })
  async getResearchHistory(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Query("limit") limit?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.getResearchHistory(
      userId,
      id,
      limit ? parseInt(limit, 10) : undefined,
    );
  }
}
