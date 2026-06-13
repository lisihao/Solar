import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";
import { ConfigModule } from "@nestjs/config";
import { KeyHealthModule } from "@/modules/platform/credentials/governance/key-health/key-health.module";
import { UserApiKeysService } from "./user-api-keys.service";

// 2026-05-28 H6: 捐赠池退役后不再依赖 SecretsModule / CreditsModule。
@Module({
  imports: [PrismaModule, ConfigModule, KeyHealthModule],
  // PR-X17: HTTP Controllers moved to open-api/admin/byok or ai-app/byok
  controllers: [],
  providers: [UserApiKeysService],
  exports: [UserApiKeysService],
})
export class UserApiKeysModule {}
