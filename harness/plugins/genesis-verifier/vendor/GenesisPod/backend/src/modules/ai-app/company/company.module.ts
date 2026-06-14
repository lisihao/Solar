import { Module, type OnModuleInit } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";

import { AiEngineModule } from "../../ai-engine/ai-engine.module";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { EventRegistry, PrismaVectorStore } from "@/modules/ai-harness/facade";
import { EmbeddingService } from "@/modules/ai-engine/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import { CompanyController } from "./api/controller/company.controller";
import { CompanyMissionGateway } from "./api/controller/company-mission.gateway";
import { CompanyRepository } from "./services/company.repository";
import { CompanyService } from "./services/company.service";
import { CompanyMissionService } from "./services/company-mission.service";
import { CompanyMissionPersistenceAdapter } from "./services/company-mission-persistence.adapter";
import { CompanyMissionPostmortemHelper } from "./services/company-mission-postmortem.helper";
import { CompanyMissionGraphService } from "./services/company-mission-graph.service";
import { CompanyHeroService } from "./services/company-hero.service";
import { COMPANY_MISSION_EVENTS } from "./events/company.events";
import { SedimentModule } from "../library/sediment/sediment.module";

/**
 * CompanyModule —— 一人公司 OS（详见 docs/features/one-person-company-os/design.md §10）。
 *
 * W1a：市场目录只读 API（投影现有 registry 成四货架）。
 *   - ToolRegistry / SkillRegistry 由 AiEngineModule 提供
 *   - TeamRegistry / BuiltinSkillCatalog 由 @Global HarnessModule 提供（无需 import）
 * W2：持久化 CRUD（CompanyProfile / HiredAgent / Team / Workflow）。
 */
@Module({
  imports: [
    AiEngineModule,
    ConfigModule,
    PrismaModule,
    // ★ post-run 沉淀：mission 完成把报告落 library notes（MissionSedimentService）。
    SedimentModule,
    // JwtService for JwtAuthGuard（WS / 后续 gateway 复用）
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET"),
        signOptions: { expiresIn: "7d" },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [CompanyController],
  providers: [
    CompanyRepository,
    CompanyService,
    CompanyMissionService,
    // ★ S12 复盘 helper：plain class，通过 useFactory 注入 PrismaService + EmbeddingService + PrismaVectorStore。
    {
      provide: CompanyMissionPostmortemHelper,
      useFactory: (
        prisma: PrismaService,
        embedding?: EmbeddingService,
        vectorStore?: PrismaVectorStore,
      ) => new CompanyMissionPostmortemHelper(prisma, embedding, vectorStore),
      inject: [
        PrismaService,
        { token: EmbeddingService, optional: true },
        { token: PrismaVectorStore, optional: true },
      ],
    },
    // ★ 运行态持久化（枢纽）：company 消费侧 MissionPersistencePort 实现，
    //   注入 deep-insight 能力核 → 每阶段 checkpoint 落库 + 终态首写赢仲裁。
    //   同时承载 recordPlanDimensions / recordPostmortem / recallPostmortems（S12）。
    CompanyMissionPersistenceAdapter,
    CompanyMissionGraphService,
    CompanyHeroService,
    CompanyMissionGateway,
  ],
  exports: [],
})
export class CompanyModule implements OnModuleInit {
  constructor(private readonly eventRegistry: EventRegistry) {}

  onModuleInit(): void {
    // 注册 company.* mission 事件类型，否则 EventBus.emit 会 drop+warn、WS 收不到
    this.eventRegistry.registerAll(COMPANY_MISSION_EVENTS);
  }
}
