/**
 * Quota Controller
 * API 配额管理控制器
 */

import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { QuotaService } from "./quota.service";
import { ProviderQuota } from "./quota.types";

@ApiTags("Admin - Quota")
@Controller("admin/quota")
@UseGuards(JwtAuthGuard, AdminGuard)
export class QuotaController {
  constructor(private readonly quotaService: QuotaService) {}

  /**
   * 获取所有 Provider 的配额信息
   * GET /admin/quota/providers
   */
  @Get("providers")
  async getAllQuotas(): Promise<{
    quotas: ProviderQuota[];
    lastUpdated: Date | null;
  }> {
    const [quotas, lastUpdated] = await Promise.all([
      this.quotaService.getAllQuotas(),
      this.quotaService.getLastGlobalUpdate(),
    ]);

    return {
      quotas,
      lastUpdated,
    };
  }

  /**
   * 刷新所有 Provider 的配额
   * POST /admin/quota/refresh
   */
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refreshAllQuotas(): Promise<{
    quotas: ProviderQuota[];
    lastUpdated: Date;
  }> {
    const quotas = await this.quotaService.refreshAllQuotas();

    return {
      quotas,
      lastUpdated: new Date(),
    };
  }

  /**
   * 刷新单个 Provider 的配额
   * POST /admin/quota/refresh/:provider
   */
  @Post("refresh/:provider")
  @HttpCode(HttpStatus.OK)
  async refreshProviderQuota(
    @Param("provider") provider: string,
  ): Promise<ProviderQuota> {
    return this.quotaService.refreshProviderQuota(provider);
  }
}
