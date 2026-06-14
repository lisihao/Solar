import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { DashboardService } from "./dashboard.service";

@ApiTags("Data Collection - Sources Dashboard")
@Controller("data-collection")
export class IngestionSourcesDashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * 获取仪表盘统计
   * GET /data-collection/dashboard
   */
  @Get("dashboard")
  async getStats() {
    const stats = await this.dashboardService.getStats();
    return stats;
  }

  /**
   * 获取时间序列数据
   * GET /data-collection/dashboard/timeseries?days=7
   */
  @Get("dashboard/timeseries")
  async getTimeSeries(@Query("days") days?: string) {
    const data = await this.dashboardService.getTimeSeries(
      days ? parseInt(days) : 7,
    );
    return data;
  }
}
