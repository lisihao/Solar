import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { CreditsService } from "./credits.service";
import { CreditRulesService } from "./policies/credit-rules.service";
import { CheckinService } from "./rewards/checkin.service";

/**
 * 积分模块
 * 管理用户积分账户、积分消耗、签到奖励等功能
 *
 * HTTP 层（CreditsController `credits` + AdminCreditsController `admin/credits`）
 * 已上提到 open-api/system（System HTTP → L4）；service/业务逻辑留 L1 platform 并导出。
 */
@Module({
  imports: [PrismaModule],
  providers: [CreditsService, CreditRulesService, CheckinService],
  exports: [CreditsService, CreditRulesService, CheckinService],
})
export class CreditsModule {}
