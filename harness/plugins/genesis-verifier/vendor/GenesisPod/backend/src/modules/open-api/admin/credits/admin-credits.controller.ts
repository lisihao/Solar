import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Param,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { AdminGuard } from "@/common/guards/admin.guard";
import { CreditTransactionType } from "@prisma/client";
import { CreditsService } from "@/modules/platform/credits/credits.service";
import { CreditRulesService } from "@/modules/platform/credits/policies/credit-rules.service";
import {
  AdminGrantCreditsDto,
  BatchGrantCreditsDto,
} from "./dto/grant-credits.dto";
import {
  FreezeAccountDto,
  UnfreezeAccountDto,
  UpdateCreditRuleDto,
} from "./dto/admin-credits.dto";

/**
 * 管理员积分控制器（standards/24：admin 面唯一收在 open-api/admin/，从 system/credits 拆出）
 */
@ApiTags("Credits")
@Controller("admin/credits")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminCreditsController {
  constructor(
    private creditsService: CreditsService,
    private creditRulesService: CreditRulesService,
  ) {}

  /** 管理员发放积分 */
  @Post("grant")
  @HttpCode(HttpStatus.OK)
  async grantCredits(@Body() dto: AdminGrantCreditsDto) {
    return this.creditsService.grantCredits(
      dto.userId,
      dto.amount,
      dto.type!,
      dto.description,
    );
  }

  /** 批量发放积分 */
  @Post("grant/batch")
  @HttpCode(HttpStatus.OK)
  async batchGrantCredits(@Body() dto: BatchGrantCreditsDto) {
    const results = await Promise.all(
      dto.userIds.map((userId) =>
        this.creditsService
          .grantCredits(
            userId,
            dto.amount,
            CreditTransactionType.ADMIN_GRANT,
            dto.description,
          )
          .then((result) => ({ ...result, userId, success: true }))
          .catch((error) => ({ userId, success: false, error: error.message })),
      ),
    );
    const successCount = results.filter((r) => r.success).length;
    return {
      total: dto.userIds.length,
      successCount,
      failedCount: dto.userIds.length - successCount,
      results,
    };
  }

  /** 冻结账户 */
  @Post("freeze")
  @HttpCode(HttpStatus.OK)
  async freezeAccount(@Body() dto: FreezeAccountDto) {
    await this.creditsService.freezeAccount(dto.userId, dto.reason);
    return { message: "Account frozen successfully" };
  }

  /** 解冻账户 */
  @Post("unfreeze")
  @HttpCode(HttpStatus.OK)
  async unfreezeAccount(@Body() dto: UnfreezeAccountDto) {
    await this.creditsService.unfreezeAccount(dto.userId);
    return { message: "Account unfrozen successfully" };
  }

  /** 获取用户账户详情 */
  @Get("account/:userId")
  async getUserAccount(@Param("userId") userId: string) {
    const account = await this.creditsService.getAccount(userId);
    const stats = await this.creditsService.getCreditsStats(userId);
    return { account, stats };
  }

  /** 更新积分规则 */
  @Post("rules/update")
  @HttpCode(HttpStatus.OK)
  async updateRule(@Body() dto: UpdateCreditRuleDto) {
    const { moduleType, operationType, ...data } = dto;
    return this.creditRulesService.updateRule(moduleType, operationType, data);
  }

  /** 刷新规则缓存 */
  @Post("rules/refresh")
  @HttpCode(HttpStatus.OK)
  async refreshRulesCache() {
    await this.creditRulesService.refreshCache();
    return { message: "Rules cache refreshed" };
  }

  /** 为所有现有用户初始化积分账户 */
  @Post("init-all")
  @HttpCode(HttpStatus.OK)
  async initAllUserAccounts() {
    return this.creditsService.initializeAllUserAccounts();
  }
}
