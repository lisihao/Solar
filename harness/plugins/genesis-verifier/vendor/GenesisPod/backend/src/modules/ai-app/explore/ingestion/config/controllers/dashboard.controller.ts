import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { DashboardService } from "../services/dashboard.service";

@ApiTags("Data Management - Dashboard")
@Controller("data-management/dashboard")
export class IngestionConfigDashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get("summary")
  async getSummary() {
    return this.dashboardService.getDashboardSummary();
  }

  @Get("recent-tasks")
  async getRecentTasks() {
    return this.dashboardService.getRecentTasks();
  }
}
