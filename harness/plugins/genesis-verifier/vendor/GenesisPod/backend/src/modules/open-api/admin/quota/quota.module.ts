/**
 * Quota Module
 * API 配额监控模块
 */

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { SecretsModule } from "../../../platform/credentials/storage/secrets/secrets.module";
import { QuotaController } from "./quota.controller";
import { QuotaService } from "./quota.service";
import {
  OpenAIQuotaProvider,
  AnthropicQuotaProvider,
  GoogleQuotaProvider,
  XAIQuotaProvider,
  CohereQuotaProvider,
  DeepSeekQuotaProvider,
  GroqQuotaProvider,
  OpenRouterQuotaProvider,
  MiniMaxQuotaProvider,
} from "./providers";

@Module({
  imports: [PrismaModule, SecretsModule],
  controllers: [QuotaController],
  providers: [
    QuotaService,
    OpenAIQuotaProvider,
    AnthropicQuotaProvider,
    GoogleQuotaProvider,
    XAIQuotaProvider,
    CohereQuotaProvider,
    DeepSeekQuotaProvider,
    GroqQuotaProvider,
    OpenRouterQuotaProvider,
    MiniMaxQuotaProvider,
  ],
  exports: [QuotaService],
})
export class QuotaModule {}
