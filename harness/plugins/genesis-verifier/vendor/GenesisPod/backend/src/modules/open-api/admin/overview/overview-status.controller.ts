import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import {
  OverviewStatusService,
  type OverviewStatusDto,
} from "./overview-status.service";

/**
 * 架构图实时状态控制器
 * GET /admin/overview-status — 供 /admin/overview 架构图 30s 轮询
 */
@ApiTags("Admin - Overview Status")
@Controller("admin")
@UseGuards(JwtAuthGuard, AdminGuard)
export class OverviewStatusController {
  constructor(private readonly overviewStatusService: OverviewStatusService) {}

  @Get("overview-status")
  @ApiOperation({ summary: "架构图实时状态（卡片健康 + 全局健康分）" })
  @ApiResponse({ status: 200, description: "返回各卡片状态与全局健康分" })
  async getOverviewStatus(): Promise<OverviewStatusDto> {
    return this.overviewStatusService.getOverviewStatus();
  }
}
