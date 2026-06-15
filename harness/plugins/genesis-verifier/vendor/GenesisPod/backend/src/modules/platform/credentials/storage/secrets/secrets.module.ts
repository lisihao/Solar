import { Module } from "@nestjs/common";
import { SecretsService } from "./secrets.service";
import { SecretKeysService } from "./secret-keys.service";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { ConfigModule } from "@nestjs/config";
import { KeyHealthModule } from "../../governance/key-health/key-health.module";

// HTTP 层（SecretsController / SecretKeysController，admin/secrets*）已上提到
// open-api/admin（System HTTP → L4），service 留 L1 platform 供跨层复用。
@Module({
  imports: [PrismaModule, ConfigModule, KeyHealthModule],
  providers: [SecretsService, SecretKeysService],
  exports: [SecretsService, SecretKeysService],
})
export class SecretsModule {}
