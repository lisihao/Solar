import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { ByokDashboardService } from "@/modules/platform/credentials/dashboard/byok-dashboard.service";

/**
 * 管理员 BYOK 仪表盘（薄 HTTP，逻辑在 platform/credentials/ByokDashboardService）。
 */
@ApiTags("Admin - BYOK Dashboard")
@Controller("admin/byok-dashboard")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminByokDashboardController {
  constructor(private readonly byokDashboardService: ByokDashboardService) {}

  @Get()
  getMetrics() {
    return this.byokDashboardService.getMetrics();
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post("maintenance/expire-assignments")
  expireAssignments() {
    return this.byokDashboardService.expireAssignments();
  }

  @Get("expiring-soon")
  expiringSoon() {
    return this.byokDashboardService.expiringSoon();
  }
}
