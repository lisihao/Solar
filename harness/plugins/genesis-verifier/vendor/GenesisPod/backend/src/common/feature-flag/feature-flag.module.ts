/**
 * FeatureFlagModule — PR-A6 (2026-05-07)
 *
 * 上游：design v1.4 §5.2 per-workspace 灰度
 *
 * @Global 让所有模块（ai-app / ai-engine / ai-harness / open-api）注入。
 * 不依赖任何业务模块（仅 PrismaService），单向依赖根。
 */

import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { FeatureFlagService } from "./feature-flag.service";

@Global()
@Module({
  imports: [PrismaModule],
  providers: [FeatureFlagService],
  exports: [FeatureFlagService],
})
export class FeatureFlagModule {}
