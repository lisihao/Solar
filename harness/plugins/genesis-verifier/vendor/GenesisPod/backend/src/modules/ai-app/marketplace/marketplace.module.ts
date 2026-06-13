/**
 * MarketplaceModule —— 平台共享市场模块（design.md §4.3「市场=平台共享」）。
 *
 * 中立、非某个 app：持有市场的平台级基础设施，供任意 app 消费。
 *   - 市场目录 API（catalog/）：把现有 registry 投影成货架（agent/skill/tool/workflow/team）。
 *     ★ P3 从 company 迁入——市场是平台共享，不该住私有 company（"市场→我的团队"对称）。
 *   - CapabilityRegistry：按 manifest.id 解析"可执行能力"端口（采用引用→执行的解析器）。
 *   - DeepInsightDefaultRunner：deep-insight 能力的默认进程内实现（自注册）。
 *
 * @Global：能力家在各自 onModuleInit 注册；消费方（company 等）无需 import 本模块即可
 * 注入 CapabilityRegistry / MarketplaceCatalogService。
 */
import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { MissionPipelineOrchestrator } from "@/modules/ai-harness/facade";
import { AiEngineModule } from "../../ai-engine/ai-engine.module";
import { CapabilityRegistry } from "./capability/capability-registry";
import { DeepInsightDefaultRunner } from "./capabilities/deep-insight/deep-insight.runner";
import { MissionGraphBuilderService } from "./graph/mission-graph-builder.service";
import { MarketplaceCatalogService } from "./catalog/marketplace-catalog.service";
import { MarketplaceController } from "./catalog/marketplace.controller";

@Global()
@Module({
  imports: [
    // ToolRegistry / SkillRegistry 由 AiEngineModule 提供；TeamRegistry /
    // BuiltinSkillCatalog / MissionPipelineRegistry 由 @Global HarnessModule 提供。
    AiEngineModule,
    ConfigModule,
    // 市场目录 controller 复用 JwtAuthGuard（JwtService）。
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET"),
        signOptions: { expiresIn: "7d" },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [MarketplaceController],
  providers: [
    CapabilityRegistry,
    // MissionPipelineOrchestrator 非 @Global（各 app module 各自注册，见 playground/
    // radar/social/writing module）；deep-insight 14 阶段 runner 经它跑 recipe，故在此注册。
    // 其依赖 MissionPipelineRegistry 由 @Global HarnessModule 提供。
    MissionPipelineOrchestrator,
    // 上架能力的默认执行实现（onModuleInit 自注册进 CapabilityRegistry）。
    DeepInsightDefaultRunner,
    // 市场目录投影服务（registry → 货架）。
    MarketplaceCatalogService,
    // 平台共享图谱构建器（报告正文 → 图谱）；playground / company 复用。
    MissionGraphBuilderService,
  ],
  exports: [
    CapabilityRegistry,
    MarketplaceCatalogService,
    MissionGraphBuilderService,
  ],
})
export class MarketplaceModule {}
