import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";
import { AuthorizationService } from "./authorization.service";

/**
 * 2026-05-27 BYOK：用户授权申请 / 授予服务模块（工具/技能授权工单流）。
 */
@Module({
  imports: [PrismaModule],
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
