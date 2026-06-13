import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";
import { UserApiKeysModule } from "../user-api-keys/user-api-keys.module";
import { SecretsModule } from "@/modules/platform/credentials/storage/secrets/secrets.module";
import { UserSecretsService } from "./user-secrets.service";

/**
 * 2026-05-27 BYOK 全量化：用户私有 Secret 统一 CRUD 服务模块。
 * EncryptionService 来自全局 EncryptionModule，无需在此 import。
 * 2026-05-29 W5：工具/其它类 BYOK 收敛到 user-scoped secrets（user_credentials 已退役）。
 */
@Module({
  imports: [PrismaModule, UserApiKeysModule, SecretsModule],
  providers: [UserSecretsService],
  exports: [UserSecretsService],
})
export class UserSecretsModule {}
