import { Module, forwardRef, OnModuleInit, Logger } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../../../common/prisma/prisma.module";
// 直接从文件导入，避免 barrel export 循环依赖
import { AiEngineModule } from "../../ai-engine/ai-engine.module";
import { StorageModule } from "../../platform/storage/storage.module";
import { CreditsModule } from "../../platform/credits/credits.module";
import { ExportModule } from "../../../common/export/export.module";
import { BrowserModule } from "../../../common/browser/browser.module";

// Core (AIModelService 作为 Skills 后备，待迁移到 AI Engine)
import { AIModelController, AIModelService } from "./core";

// Slides (幻灯片生成) - v5.0: 使用 AI Teams Leader 协调模式
import {
  // Rendering (导出服务)
  SlidesExportService,
  ParameterizedRendererService,
  // Checkpoint
  SlidesCheckpointService,
  // Controller
  SlidesController,
  // Engine Service (v4.0: 核心服务)
  SlidesEngineService,
  // v5.0: Data Import Service
  SlidesDataImportService,
  // v5.0: AI Edit Service
  AIEditService,
  // v5.0: Health Check Service
  SlidesMissionHealthService,
  // v5.0: Metrics Service
  SlidesMetricsService,
  // Skills Module (v4.0: 技能注册模块)
  SlidesSkillsModule,
  // v5.0: Team-based Orchestrator
  SlidesLeader,
  SlidesTeamMember,
  SlidesTeamOrchestrator,
  SlidesRepository,
} from "./slides";
import { SourceSubscriptionService } from "./slides/services/source-subscription.service";
import {
  SkillResolver,
  PresetLoader,
  SkillPolicyRegistry,
  SlidesAutoRouterService,
} from "./slides/skill-resolver";

// Agents
import { AiOfficeAgentsController } from "./agents";

// Common (共享服务) - services are provided by AIOfficeCommonModule
import { AIOfficeCommonModule } from "./common";
import { TeamRegistry, RoleRegistry } from "@/modules/ai-harness/facade";
import {
  REPORT_TEAM_CONFIG,
  SLIDES_TEAM_CONFIG,
  VISUAL_DESIGN_TEAM_CONFIG,
  OFFICE_LEAD_ROLE_CONFIGS,
} from "./teams";
import { ResearchModule } from "../research/research.module";
import { AiWritingModule } from "../writing/ai-writing.module";
import { InsightModule } from "../insight/insight.module";
// Cross-module data export tokens are defined in
// ai-app/contracts/interfaces/data-export.interface.ts and used by
// SlidesDataImportService:
// - TOPIC_INSIGHTS_DATA_EXPORT   provided by InsightModule
// - RESEARCH_PROJECT_DATA_EXPORT provided by ResearchModule
// - WRITING_DATA_EXPORT          provided by AiWritingModule
import { OfficeContentSourceProvider } from "./integrations/office-content-source.provider";

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    PrismaModule,
    BrowserModule,
    forwardRef(() => AiEngineModule),
    StorageModule,
    CreditsModule,
    ExportModule,
    AIOfficeCommonModule,
    InsightModule,
    ResearchModule,
    AiWritingModule,
    // 使用 forwardRef: SlidesSkillsModule 也导入 AiEngineModule，形成循环
    forwardRef(() => SlidesSkillsModule),
  ],
  controllers: [AIModelController, SlidesController, AiOfficeAgentsController],
  providers: [
    AIModelService,
    // TOPIC_INSIGHTS_DATA_EXPORT / RESEARCH_PROJECT_DATA_EXPORT /
    // WRITING_DATA_EXPORT tokens are provided by their owner modules
    // (imported above); no need to re-provide here.
    // Slides Services (v5.0: Team-based Orchestrator)
    SlidesExportService,
    ParameterizedRendererService,
    SlidesCheckpointService,
    SlidesEngineService, // v4.0: 核心引擎服务
    SlidesDataImportService, // v5.0: 数据导入服务
    AIEditService, // v5.0: AI 编辑服务
    SlidesMissionHealthService, // v5.0: 健康检查服务
    SlidesMetricsService, // v5.0: 指标收集服务
    SlidesLeader, // v5.0: Leader 角色
    SlidesTeamMember, // v5.0: 成员基类
    SlidesTeamOrchestrator, // v5.0: 主编排器
    SlidesRepository, // v5.0: 持久化层
    SourceSubscriptionService, // Phase 3: 来源订阅服务
    // Skills-driven extensibility (Phase A)
    PresetLoader,
    SkillPolicyRegistry,
    SkillResolver,
    // Auto-router (Phase C3): opt-in LLM preset inference
    SlidesAutoRouterService,
    // Generic ContentSource — auto-discovered by engine ContentSourceRegistry
    OfficeContentSourceProvider,
  ],
  exports: [
    AIModelService,
    // Slides Services (v5.0: Team-based Orchestrator)
    SlidesExportService,
    ParameterizedRendererService,
    SlidesCheckpointService,
    SlidesEngineService,
    SlidesDataImportService, // v5.0: 数据导入服务
    AIEditService, // v5.0: AI 编辑服务
    SlidesMissionHealthService, // v5.0: 健康检查服务
    SlidesMetricsService, // v5.0: 指标收集服务
    SlidesLeader,
    SlidesTeamMember,
    SlidesTeamOrchestrator,
    SlidesRepository,
    // Common - re-export the module to make its services available
    AIOfficeCommonModule,
  ],
})
export class AiOfficeModule implements OnModuleInit {
  private readonly logger = new Logger(AiOfficeModule.name);

  constructor(
    private readonly teamRegistry: TeamRegistry,
    private readonly roleRegistry: RoleRegistry,
  ) {}

  onModuleInit() {
    // v3 R0-A1-d: 业务 leader 角色由 ai-app 自身注册（base layer 不再硬编码业务名）
    for (const cfg of OFFICE_LEAD_ROLE_CONFIGS) {
      this.roleRegistry.registerFromConfig(cfg);
    }
    this.teamRegistry.registerConfig(REPORT_TEAM_CONFIG);
    this.teamRegistry.registerConfig(SLIDES_TEAM_CONFIG);
    this.teamRegistry.registerConfig(VISUAL_DESIGN_TEAM_CONFIG);
    this.logger.log("Registered REPORT, SLIDES, VISUAL_DESIGN team configs");
  }
}
