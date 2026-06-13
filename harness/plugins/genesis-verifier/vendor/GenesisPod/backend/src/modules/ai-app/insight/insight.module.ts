import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TopicInsightsContentSourceProvider } from "./integrations/topic-insights-content-source.provider";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { NotificationModule } from "../../platform/notifications/notification.module";
import { NotificationDispatcherModule } from "../../platform/notifications/dispatcher/notification-dispatcher.module";
// Import directly from source to avoid circular dependency via barrel export
import { AiEngineModule } from "../../ai-engine/ai-engine.module";
import {
  PromptSkillBridge,
  TeamRegistry,
  AgentRegistry,
  RoleRegistry,
} from "@/modules/ai-harness/facade";
import { SkillLoaderService } from "@/modules/ai-engine/facade";
import { RESEARCH_LEAD_ROLE_CONFIG } from "../research/teams";
import { CreditsModule } from "../../platform/credits/credits.module";
import { SecretsModule } from "../../platform/credentials/storage/secrets/secrets.module";
import { ToolKeyResolverModule } from "../../platform/credentials/resolution/tool-key-resolver/tool-key-resolver.module";
import { StorageModule } from "../../platform/storage/storage.module";
import { ExportModule } from "../../../common/export/export.module";
import { TOPIC_INSIGHTS_DATA_EXPORT } from "../contracts/interfaces/data-export.interface";
import { TopicInsightsAgent } from "./agents";
import { TOPIC_INSIGHTS_TEAM_CONFIG } from "./teams";
// TODO: 后续添加 CrawlersModule 以支持更多数据源
// import { CrawlersModule } from '../../ingestion/crawlers/crawlers.module';
// Note: EventEmitterModule is globally configured in AppModule
import {
  TopicController,
  MissionController,
  ReportController,
  CollaborationController,
  TodoController,
  ReportReviewController,
  LatencyController,
} from "./controllers";
import { TopicInsightsService } from "./topic-insights.service";
import { TopicInsightsGateway } from "./topic-insights.gateway";
import {
  DataSourceRouterService,
  ReportSynthesisService,
  TopicTeamOrchestratorService,
  TopicRefreshScheduler,
  EvidenceManagementService,
  ResearchReviewerService,
  ResearchLeaderService,
  // ★ Leader sub-services (God Service decomposition)
  LeaderPlanningService,
  LeaderIntentService,
  LeaderAgentSelectionService,
  LeaderReviewService,
  // ★ Task executors
  DimensionResearchExecutor,
  ReviewDimensionExecutor,
  SynthesisReportExecutor,
  GenericTaskExecutor,
  TopicCollaboratorService,
  ResearchEventEmitterService,
  DimensionMissionService,
  DimensionProgressService,
  SectionWriterService,
  ReportChangeService,
  ReportAnnotationService,
  ResearchStrategyService,
  AgentActivityService,
  CredibilityReportService,
  ReviewWorkflowService,
  ResearchTodoService,
  ResearchMissionHealthService,
  ResearchCheckpointService,
  DataEnrichmentService,
  LeaderToolService,
  ResearchReflectionService,
  DataSourcePlannerService,
  FigureExtractorService,
  FigureRelevanceService,
  ReportValidationService,
  ReportEditorService,
  // ★ Mission sub-services (God Service decomposition)
  MissionObservabilityService,
  MissionNotificationService,
  // ★ Facade sub-services
  TopicCrudService,
  EventSourceParsingService,
  TopicDimensionService,
  TopicExportService,
  TopicScheduleService,
  MissionQueryService,
  MissionLifecycleService,
  MissionExecutionService,
  // ★ Data sub-services
  DataSourceFetcherService,
  DataSourceStrategyService,
  // ★ Dimension sub-services
  DimensionSearchService,
  DimensionWritingService,
  // ★ Report sub-services
  ReportGeneratorService,
  ReportAssemblerService,
  ReportDataService,
  LatexRepairService,
  // ★ Cross-module data export (Slides/Office consumer)
  TopicInsightsDataExportService,
  // ★ Engine Adapters (P2 能力下沉集成)
  ResearchRealtimeAdapter,
  EvidenceSyncCompensationService,
  ResearchMemoryService,
  // ★ P0: 新增核心能力
  DataSourceConnectorRegistry,
  SemanticScholarConnector,
  PubMedConnector,
  FinanceApiConnector,
  WeatherApiConnector,
  TopicInsightsKnowledgeGraphService,
  MultiLanguageResearchService,
  // ★ P1: 新增增强能力
  CritiqueRefineService,
  ReportQualityGateService,
  ReportQualityTraceService,
  ReportEvaluationService,
  SectionSelfEvalService,
  SectionRemediationService,
  CitationFormatterService,
  ResearchExportService,
  ResearchTemplateService,
  RAGFusionService,
  // ★ Search Pipeline (modular search architecture)
  GlobalSourceThrottleService,
  QueryStrategyService,
  SearchExecutorService,
  ResultFusionService,
  SearchFusionQualityGateService,
  SearchOrchestratorService,
  LlmRerankerAdapter,
  WebSearchAdapter,
  AcademicSearchAdapter,
  GithubSearchAdapter,
  HackernewsSearchAdapter,
  SocialSearchAdapter,
  PolicySearchAdapter,
  FinanceSearchAdapter,
  WeatherSearchAdapter,
  LocalSearchAdapter,
  IndustryReportSearchAdapter,
} from "./services";
import { TopicAccessGuard } from "./guards";

const services = [
  TopicInsightsService,
  DataSourceRouterService,
  ReportSynthesisService,
  ResearchReviewerService,
  TopicTeamOrchestratorService,
  TopicRefreshScheduler,
  EvidenceManagementService,
  ResearchLeaderService,
  // ★ Leader sub-services (ResearchLeader decomposition)
  LeaderPlanningService,
  LeaderIntentService,
  LeaderAgentSelectionService,
  LeaderReviewService,
  MissionQueryService,
  MissionLifecycleService,
  MissionExecutionService,
  // ★ Task executors (MissionExecution decomposition)
  DimensionResearchExecutor,
  ReviewDimensionExecutor,
  SynthesisReportExecutor,
  GenericTaskExecutor,
  // ★ Mission sub-services (God Service decomposition)
  MissionObservabilityService,
  MissionNotificationService,
  TopicCollaboratorService,
  ResearchEventEmitterService,
  DimensionMissionService,
  DimensionProgressService,
  SectionWriterService,
  ReportChangeService,
  ReportAnnotationService,
  ResearchStrategyService,
  AgentActivityService,
  CredibilityReportService,
  ReviewWorkflowService,
  ResearchTodoService,
  ResearchMissionHealthService,
  ResearchCheckpointService,
  DataEnrichmentService,
  LeaderToolService,
  ResearchReflectionService,
  DataSourcePlannerService,
  FigureExtractorService,
  FigureRelevanceService,
  ReportValidationService,
  ReportEditorService,
  // ★ Facade sub-services
  TopicCrudService,
  EventSourceParsingService,
  TopicDimensionService,
  TopicExportService,
  TopicScheduleService,
  // ★ Data sub-services
  DataSourceFetcherService,
  DataSourceStrategyService,
  RAGFusionService,
  // ★ Dimension sub-services
  DimensionSearchService,
  DimensionWritingService,
  // ★ Report sub-services
  ReportGeneratorService,
  ReportAssemblerService,
  ReportDataService,
  LatexRepairService,
  // ★ Cross-module data export (Slides/Office consumer)
  TopicInsightsDataExportService,
  // ★ Engine Adapters (P2 能力下沉集成)
  ResearchRealtimeAdapter,
  EvidenceSyncCompensationService,
  // ★ Memory
  ResearchMemoryService,
  // ★ P0: 新增核心能力
  DataSourceConnectorRegistry,
  SemanticScholarConnector,
  PubMedConnector,
  FinanceApiConnector,
  WeatherApiConnector,
  TopicInsightsKnowledgeGraphService,
  MultiLanguageResearchService,
  // ★ P1: 新增增强能力
  CritiqueRefineService,
  // ★ v4: 代码强制质量门控
  ReportQualityGateService,
  // ★ v5: 全链路质量追踪
  ReportQualityTraceService,
  // ★ 10 维报告质量评审
  ReportEvaluationService,
  // ★ 写中自评 + 补救
  SectionSelfEvalService,
  SectionRemediationService,
  CitationFormatterService,
  ResearchExportService,
  ResearchTemplateService,
  // ★ Search Pipeline (modular search architecture)
  GlobalSourceThrottleService,
  QueryStrategyService,
  SearchExecutorService,
  ResultFusionService,
  SearchFusionQualityGateService,
  SearchOrchestratorService,
  LlmRerankerAdapter,
  WebSearchAdapter,
  AcademicSearchAdapter,
  GithubSearchAdapter,
  HackernewsSearchAdapter,
  SocialSearchAdapter,
  PolicySearchAdapter,
  FinanceSearchAdapter,
  WeatherSearchAdapter,
  LocalSearchAdapter,
  IndustryReportSearchAdapter,
  // ★ Gap 1: Agent 注册
  TopicInsightsAgent,
];

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    NotificationDispatcherModule,
    AiEngineModule,
    CreditsModule,
    ExportModule,
    ConfigModule,
    SecretsModule,
    ToolKeyResolverModule, // 2026-05-27 BYOK：finance connector 解析 user 工具 Key
    StorageModule, // ★ Phase 6: R2 报告云存储
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET"),
        signOptions: { expiresIn: "7d" },
      }),
      inject: [ConfigService],
    }),
    // EventEmitterModule is globally configured in AppModule
  ],
  controllers: [
    TopicController,
    MissionController,
    ReportController,
    CollaborationController,
    TodoController,
    ReportReviewController,
    LatencyController,
  ],
  providers: [
    ...services,
    TopicInsightsGateway,
    TopicAccessGuard,
    // Cross-module contract: Office/Slides consume this token.
    {
      provide: TOPIC_INSIGHTS_DATA_EXPORT,
      useExisting: TopicInsightsDataExportService,
    },
    // ★ PR-V2e / P17a (2026-05-24): Topic Insights as a generic ContentSource
    //   Auto-discovered by engine ContentSourceRegistry at runtime
    TopicInsightsContentSourceProvider,
  ],
  exports: [
    TopicInsightsService,
    TopicAccessGuard,
    TopicInsightsDataExportService,
    TOPIC_INSIGHTS_DATA_EXPORT,
    TopicInsightsContentSourceProvider,
  ],
})
export class InsightModule implements OnModuleInit {
  private readonly logger = new Logger(InsightModule.name);

  constructor(
    private readonly promptSkillBridge: PromptSkillBridge,
    private readonly connectorRegistry: DataSourceConnectorRegistry,
    private readonly semanticScholarConnector: SemanticScholarConnector,
    private readonly pubMedConnector: PubMedConnector,
    private readonly financeApiConnector: FinanceApiConnector,
    private readonly weatherApiConnector: WeatherApiConnector,
    private readonly topicInsightsAgent: TopicInsightsAgent,
    // ★ Registry 由 AiEngineModule 通过 AiEngineOrchestrationModule / TeamsModule
    // 导出，必须作为硬依赖注入；注册失败会导致 IntentRouter 不可发现本模块，
    // 是隐蔽的生产事故源。因此不使用 @Optional — 缺失即启动失败。
    private readonly agentRegistry: AgentRegistry,
    private readonly teamRegistry: TeamRegistry,
    private readonly roleRegistry: RoleRegistry,
    // R0-A5: 注册 insights skills 目录到 engine SkillLoader
    private readonly skillLoader: SkillLoaderService,
  ) {}

  async onModuleInit() {
    // R0-A5 (2026-05-04): 注册 insights skill 目录（替代 engine 硬编码）
    const path = await import("path");
    await this.skillLoader.addSkillDirectory({
      path: path.resolve(__dirname, "skills"),
      domain: "insights",
      recursive: true,
    });

    // Bridge prompt skills from SKILL.md → SkillRegistry
    const bridgeResult =
      await this.promptSkillBridge.registerDomain("insights");
    this.logger.log(
      `Prompt skills bridged: registered=${bridgeResult.registered.length}, ` +
        `skipped=${bridgeResult.skipped.length}, errors=${bridgeResult.errors.length}`,
    );

    // ★ P0: 注册数据源连接器
    this.connectorRegistry.register(this.semanticScholarConnector);
    this.connectorRegistry.register(this.pubMedConnector);
    this.connectorRegistry.register(this.financeApiConnector);
    this.connectorRegistry.register(this.weatherApiConnector);
    this.logger.log(
      `Data source connectors registered: ${this.connectorRegistry.getCount()}`,
    );

    // ★ Agent/Team 注册 → IntentRouter 可发现（硬依赖，失败即抛）
    this.agentRegistry.register(this.topicInsightsAgent);
    this.logger.log("Registered TopicInsightsAgent");
    // v3 R0-A1-d: 业务 leader 角色由 ai-app 自身注册（base layer 不再硬编码业务名）
    // RESEARCH_LEAD 跨 ai-app 复用（research / topic-insights / planning），register 自身幂等
    this.roleRegistry.registerFromConfig(RESEARCH_LEAD_ROLE_CONFIG);
    this.teamRegistry.registerConfig(TOPIC_INSIGHTS_TEAM_CONFIG);
    this.logger.log("Registered TOPIC_INSIGHTS team config");
  }
}
