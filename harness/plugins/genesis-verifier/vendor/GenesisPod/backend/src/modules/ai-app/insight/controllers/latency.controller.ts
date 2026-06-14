import {
  Controller,
  Get,
  Optional,
  Param,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import {
  SessionLatencyTrackerService,
  type LatencySessionSummary,
} from "@/modules/ai-harness/facade";

/**
 * Latency Controller
 *
 * 提供时延跟踪数据查询 API。
 */
@ApiTags("Topic Insights - Latency")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("api/insight/latency")
export class LatencyController {
  constructor(
    @Optional()
    private readonly latencyTracker?: SessionLatencyTrackerService,
  ) {}

  /**
   * 获取指定主题的最新时延摘要
   */
  @Get("topics/:topicId/latest")
  @ApiOperation({ summary: "获取主题最新时延摘要" })
  @ApiParam({ name: "topicId", description: "主题 ID" })
  @ApiResponse({ status: 200, description: "时延摘要" })
  async getLatestSummary(
    @Request() req: { user?: { id?: string } },
    @Param("topicId") topicId: string,
  ): Promise<{ summary: LatencySessionSummary | null }> {
    if (!this.latencyTracker) return { summary: null };
    // 通过 userId 过滤确保只返回当前用户自己的数据
    const sessions = await this.latencyTracker.listSessions({
      entityId: topicId,
      type: "topic_insights_refresh",
      userId: req.user?.id,
      limit: 1,
    });
    return { summary: sessions[0] ?? null };
  }

  /**
   * 查询时延会话历史
   */
  @Get("sessions")
  @ApiOperation({ summary: "查询时延会话历史" })
  @ApiQuery({ name: "type", required: false })
  @ApiQuery({ name: "entityId", required: false })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiResponse({ status: 200, description: "时延会话列表" })
  async listSessions(
    @Request() req: { user?: { id?: string } },
    @Query("type") type?: string,
    @Query("entityId") entityId?: string,
    @Query("limit") limit?: string,
  ): Promise<{ sessions: LatencySessionSummary[] }> {
    if (!this.latencyTracker) return { sessions: [] };
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const sessions = await this.latencyTracker.listSessions({
      type,
      entityId,
      userId: req.user?.id, // 只返回当前用户的会话
      limit: Number.isNaN(parsedLimit) ? 20 : parsedLimit,
    });
    return { sessions };
  }
}
