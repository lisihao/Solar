import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiQuery } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { OpsDashboardService } from "./ops-dashboard.service";
import type {
  OpsFunnelDto,
  OpsCohortDto,
  OpsUserCostDto,
  OpsOverviewDto,
} from "./dto/ops-dashboard.dto";

/**
 * 运营看板控制器
 * 统一路由前缀: /admin/dashboard
 *
 * 端点：
 * - GET /overview     总览（含 arpuCredits / payingRate / stickiness / guardrail）
 * - GET /modules      按模块事件聚合
 * - GET /topics       按 topic_key 事件聚合
 * - GET /funnel       注册→激活→留存→付费代理 漏斗
 * - GET /cohort       注册周同期群留存矩阵
 * - GET /userCost     单用户成本/积分聚合（成本 desc top）
 */
@ApiTags("Admin - Ops Dashboard")
@Controller("admin/dashboard")
@UseGuards(JwtAuthGuard, AdminGuard)
export class OpsDashboardController {
  constructor(private readonly opsDashboardService: OpsDashboardService) {}

  @Get("overview")
  @ApiOperation({ summary: "运营总览（活跃/成本/付费率/粘性/守护栏）" })
  @ApiQuery({ name: "days", required: false, type: Number })
  async getOverview(@Query("days") days?: string): Promise<OpsOverviewDto> {
    return this.opsDashboardService.getOverview(this.parseDays(days));
  }

  @Get("modules")
  @ApiOperation({ summary: "按模块聚合事件量" })
  @ApiQuery({ name: "days", required: false, type: Number })
  async getModules(@Query("days") days?: string) {
    return this.opsDashboardService.getModules(this.parseDays(days));
  }

  @Get("topics")
  @ApiOperation({ summary: "按 topic_key 聚合事件量" })
  @ApiQuery({ name: "days", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getTopics(
    @Query("days") days?: string,
    @Query("limit") limit?: string,
  ) {
    return this.opsDashboardService.getTopics(
      this.parseDays(days),
      this.parseInt(limit, 50),
    );
  }

  @Get("funnel")
  @ApiOperation({ summary: "漏斗：注册→激活→留存→付费代理" })
  @ApiQuery({ name: "days", required: false, type: Number })
  async getFunnel(@Query("days") days?: string): Promise<OpsFunnelDto> {
    return this.opsDashboardService.getFunnel(this.parseDays(days));
  }

  @Get("cohort")
  @ApiOperation({ summary: "注册周同期群留存矩阵" })
  @ApiQuery({ name: "weeks", required: false, type: Number })
  async getCohort(@Query("weeks") weeks?: string): Promise<OpsCohortDto[]> {
    return this.opsDashboardService.getCohort(this.parseInt(weeks, 8));
  }

  @Get("userCost")
  @ApiOperation({ summary: "单用户成本/积分聚合（成本 desc top）" })
  @ApiQuery({ name: "days", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getUserCost(
    @Query("days") days?: string,
    @Query("limit") limit?: string,
  ): Promise<OpsUserCostDto[]> {
    return this.opsDashboardService.getUserCost(
      this.parseDays(days),
      this.parseInt(limit, 20),
    );
  }

  /** 解析 days 查询参数，默认 30，限制 1..365 */
  private parseDays(value?: string): number {
    const n = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(n) || n <= 0) return 30;
    return Math.min(n, 365);
  }

  /** 解析整数查询参数，非法回退 fallback */
  private parseInt(value: string | undefined, fallback: number): number {
    const n = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
  }
}
