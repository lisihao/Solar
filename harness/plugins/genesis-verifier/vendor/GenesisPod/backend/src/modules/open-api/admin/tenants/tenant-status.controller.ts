import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import {
  TenantStatusService,
  type TenantStatusResponseDto,
} from "./tenant-status.service";

/**
 * 租户状态控制器
 * GET /admin/tenants/status — 管理员视角的所有租户（用户）实时状态总览
 */
@ApiTags("Admin - Tenant Status")
@Controller("admin/tenants")
@UseGuards(JwtAuthGuard, AdminGuard)
export class TenantStatusController {
  constructor(private readonly tenantStatusService: TenantStatusService) {}

  @Get("status")
  @ApiOperation({ summary: "所有租户实时状态（运行任务/LLM 调用/积分/错误）" })
  @ApiQuery({ name: "hours", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "offset", required: false, type: Number })
  @ApiQuery({ name: "search", required: false, type: String })
  @ApiResponse({ status: 200, description: "返回租户状态列表与汇总" })
  async getTenantStatus(
    @Query("hours") hours?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("search") search?: string,
  ): Promise<TenantStatusResponseDto> {
    return this.tenantStatusService.getTenantStatus({
      hours: this.parseIntParam(hours, 24, 1, 168),
      limit: this.parseIntParam(limit, 50, 1, 200),
      offset: this.parseIntParam(offset, 0, 0, Number.MAX_SAFE_INTEGER),
      search: search?.trim() || undefined,
    });
  }

  private parseIntParam(
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const n = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(n) || n < min) return fallback;
    return Math.min(n, max);
  }
}
