import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";
import { SecretsModule } from "@/modules/platform/credentials/storage/secrets/secrets.module";
import { UserSecretsModule } from "../../user-owned/user-secrets/user-secrets.module";
import { ToolKeyResolverService } from "./tool-key-resolver.service";

/**
 * 2026-05-27 BYOK：工具 Key 运行时解析模块（用户 Key 优先 → 授权 → strict/fallback）。
 */
@Module({
  imports: [PrismaModule, SecretsModule, UserSecretsModule],
  providers: [ToolKeyResolverService],
  exports: [ToolKeyResolverService],
})
export class ToolKeyResolverModule {}
