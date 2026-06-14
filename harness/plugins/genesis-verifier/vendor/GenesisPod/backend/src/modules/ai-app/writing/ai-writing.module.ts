import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AiWritingController } from "./ai-writing.controller";
import { WritingMissionReadController } from "./api/writing-mission-read.controller";
import { AiWritingService } from "./ai-writing.service";
import { WritingCoordinatorService } from "./writing-coordinator.service";
import { WritingRepository } from "./writing.repository";
import { PrismaModule } from "../../../common/prisma/prisma.module";
// 直接从文件导入，避免 barrel export 循环依赖
import { AiEngineModule } from "../../ai-engine/ai-engine.module";
import {
  PromptSkillBridge,
  MissionPipelineOrchestrator,
  MissionCheckpointService,
  InMemoryMissionCheckpointStore,
  type MissionCheckpointStore,
  EventRegistry,
} from "@/modules/ai-harness/facade";
import { WritingMissionGateway } from "./mission/writing-mission.gateway";
import { WRITING_EVENTS } from "./events/writing.events";
import { SkillLoaderService } from "@/modules/ai-engine/facade";
import { CreditsModule } from "../../platform/credits/credits.module";
import { LongContentModule } from "./content-engine/long-content.module";

// ★ B4 Writing Mission Pipeline — new providers (新旧并存，B5 单点切换)
import { WritingBusinessOrchestrator } from "./mission/pipeline/writing-business-orchestrator.service";
import { WritingPipelineDispatcher } from "./mission/pipeline/writing-pipeline-dispatcher.service";
import { WritingMissionStoreService } from "./mission/lifecycle/writing-mission-store.service";
import { WritingArtifactProjector } from "./mission/projectors/writing-artifact.projector";
// Role services (6)
import { AgentInvoker } from "./mission/roles/agent-invoker.service";
import { WriterService } from "./mission/roles/writer.service";
import { BibleKeeperService } from "./mission/roles/bible-keeper.service";
import { StoryArchitectService } from "./mission/roles/story-architect.service";
import { ConsistencyService } from "./mission/roles/consistency.service";
import { EditorService } from "./mission/roles/editor.service";

// Bible services
import { StoryBibleService } from "./services/bible/story-bible.service";
import { CharacterService } from "./services/bible/character.service";
import { WorldSettingService } from "./services/bible/world-setting.service";
import { TimelineService } from "./services/bible/timeline.service";
import { TerminologyService } from "./services/bible/terminology.service";
import { WorldBuildingEnhancerService } from "./services/bible/world-building-enhancer.service";

// Writing services
import { ProjectService } from "./services/writing/project.service";
import { ChapterWritingService } from "./services/writing/chapter-writing.service";
import { ChapterRevisionService } from "./services/writing/chapter-revision.service";
import { ChapterAnnotationService } from "./services/writing/chapter-annotation.service";
import { ChapterImportService } from "./services/writing/chapter-import.service";
import { ContextBuilderService } from "./services/writing/context-builder.service";
import { OutlineService } from "./services/writing/outline.service";
// v4-DOME: 新增层次摘要和动态大纲服务
import { HierarchicalSummaryService } from "./services/writing/hierarchical-summary.service";
import { DynamicOutlineService } from "./services/writing/dynamic-outline.service";

// Mission services
import { WritingMissionHealthCheckService } from "./services/mission/writing-mission-health-check.service";
import { WritingAgentCoordinator } from "./services/mission/writing-agent-coordinator.service";
import { WritingContextService } from "./services/mission/writing-context.service";
import { WritingStyleService } from "./services/mission/writing-style.service";
import { WritingQualityService } from "./services/mission/writing-quality.service";
import { WritingMissionCheckpointService } from "./services/mission/checkpoint.service";
import { WritingJsonParserService } from "./services/mission/writing-json-parser.service";
import { WritingModelManager } from "./services/mission/writing-model-manager.service";
import { WritingPersistence } from "./services/mission/writing-persistence.service";
// WritingExecutionService removed (replaced by WritingMissionExecutionService)
import { WritingContentGeneratorService } from "./services/mission/writing-content-generator.service";
// v4-DOME: Agent 共享便签板
import { SharedScratchpadService } from "./services/mission/shared-scratchpad.service";
import { WritingTextProcessorService } from "./services/mission/writing-text-processor.service";

// NEW: Refactored mission services (Phase 4)
import { WritingMissionLifecycleService } from "./services/mission/writing-mission-lifecycle.service";
import { WritingMissionQueryService } from "./services/mission/writing-mission-query.service";
import { WritingMissionExecutionService } from "./services/mission/writing-mission-execution.service";

// NEW: Quality Pipeline
import { WritingQualityPipelineService } from "./services/quality/writing-quality-pipeline.service";
import { WritingStructuralGateService } from "./services/quality/writing-structural-gate.service";
import { WritingContentGateService } from "./services/quality/writing-content-gate.service";
import { WritingCritiqueRefineService } from "./services/quality/writing-critique-refine.service";

// Consistency services
import { ConsistencyEngineService } from "./services/consistency/consistency-engine.service";
import { PreWriteInjectionService } from "./services/consistency/pre-write-injection.service";
import { PostWriteValidationService } from "./services/consistency/post-write-validation.service";
import { ConflictResolutionService } from "./services/consistency/conflict-resolution.service";
import { FactExtractorService } from "./services/consistency/fact-extractor.service";
import { ChapterCoherenceService } from "./services/consistency/chapter-coherence.service";
// v4-DOME: 时序冲突检测矩阵
import { TemporalConflictAnalyzerService } from "./services/consistency/temporal-conflict-analyzer.service";

// Parallel services
import { ParallelOrchestratorService } from "./services/parallel/parallel-orchestrator.service";
import { ChapterDependencyService } from "./services/parallel/chapter-dependency.service";
import { WriterPoolService } from "./services/parallel/writer-pool.service";
import { ParallelConflictDetectorService } from "./services/parallel/parallel-conflict-detector.service";

// Quality services (AI Writing Quality Enhancement System)
import {
  ExpressionMemoryService,
  CharacterPersonalityService,
  CharacterConsistencyService,
  WritingQualityGateService,
  HistoricalKnowledgeService,
  DialogueConstraintsService,
  NarrativePacingService,
  SemanticConsistencyService,
  ExpressionAlternativesService,
  ProfessionalVoiceService,
  SensoryImmersionService,
  OpeningHookService,
  ForeshadowingService,
  PacingControlService,
  ChapterQualityEvaluatorService,
  NarrativeCraftService,
  WritingQualityCheckerService,
  StoryCompletionDetectorService,
} from "./services/quality";

// Style services (Three-layer style configuration system)
import { StyleTemplateService } from "./services/style/style-template.service";
import { WritingDataExportService } from "./services/writing-data-export.service";
import { WritingDataExportAdapter } from "./services/writing-data-export.adapter";
import { WRITING_DATA_EXPORT } from "../contracts/interfaces/data-export.interface";
import { WritingContentSourceProvider } from "./integrations/writing-content-source.provider";

// Writing Agents (extending AI Engine BaseAgent)
import {
  StoryArchitectAgent,
  BibleKeeperAgent,
  WriterAgent,
  ConsistencyCheckerAgent,
  EditorAgent,
} from "./agents";

@Module({
  imports: [
    PrismaModule,
    AiEngineModule,
    ConfigModule,
    CreditsModule,
    LongContentModule,
    // ★ W1: JwtService needed by WritingMissionGateway for WS auth
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET"),
        signOptions: { expiresIn: "7d" },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AiWritingController, WritingMissionReadController],
  providers: [
    // Repository
    WritingRepository,

    AiWritingService,
    WritingDataExportService,
    WritingCoordinatorService,
    // ★ W1: new mission-scoped gateway (writing.* events via EventBus → socket room)
    WritingMissionGateway,
    // Bible services
    StoryBibleService,
    CharacterService,
    WorldSettingService,
    TimelineService,
    TerminologyService,
    WorldBuildingEnhancerService,
    // Writing services
    ProjectService,
    ChapterWritingService,
    ChapterRevisionService,
    ChapterAnnotationService,
    ChapterImportService,
    ContextBuilderService,
    OutlineService,
    // v4-DOME: 层次摘要和动态大纲
    HierarchicalSummaryService,
    DynamicOutlineService,
    // Mission services
    WritingMissionHealthCheckService,
    WritingAgentCoordinator,
    WritingContextService,
    WritingStyleService,
    WritingQualityService,
    WritingMissionCheckpointService,
    WritingJsonParserService,
    WritingModelManager,
    WritingPersistence,
    WritingContentGeneratorService,
    // v4-DOME: Agent 共享便签板
    SharedScratchpadService,
    WritingTextProcessorService,
    // NEW: Refactored mission services
    WritingMissionLifecycleService,
    WritingMissionQueryService,
    WritingMissionExecutionService,
    // NEW: Quality Pipeline
    WritingQualityPipelineService,
    WritingStructuralGateService,
    WritingContentGateService,
    WritingCritiqueRefineService,
    // Consistency services
    ConsistencyEngineService,
    PreWriteInjectionService,
    PostWriteValidationService,
    ConflictResolutionService,
    FactExtractorService,
    ChapterCoherenceService,
    // v4-DOME: 时序冲突检测矩阵
    TemporalConflictAnalyzerService,
    // Parallel services
    ParallelOrchestratorService,
    ChapterDependencyService,
    WriterPoolService,
    ParallelConflictDetectorService,
    // Quality services (AI Writing Quality Enhancement System)
    ExpressionMemoryService,
    CharacterPersonalityService,
    CharacterConsistencyService,
    WritingQualityGateService,
    HistoricalKnowledgeService,
    DialogueConstraintsService,
    NarrativePacingService,
    SemanticConsistencyService,
    ExpressionAlternativesService,
    ProfessionalVoiceService,
    SensoryImmersionService,
    OpeningHookService,
    ForeshadowingService,
    PacingControlService,
    ChapterQualityEvaluatorService,
    NarrativeCraftService,
    WritingQualityCheckerService,
    // v4-DOME: 智能故事完结检测
    StoryCompletionDetectorService,
    // Style services (Three-layer style configuration)
    StyleTemplateService,
    // Data export adapter (for Office module integration via DI token)
    WritingDataExportAdapter,
    {
      provide: WRITING_DATA_EXPORT,
      useExisting: WritingDataExportAdapter,
    },
    // Writing Agents (from BaseAgent)
    StoryArchitectAgent,
    BibleKeeperAgent,
    WriterAgent,
    ConsistencyCheckerAgent,
    EditorAgent,
    // Generic ContentSource provider (auto-discovered by engine ContentSourceRegistry)
    WritingContentSourceProvider,

    // ★ B4 Writing Mission Pipeline — new providers (新旧并存，不切换执行路径)
    // pipeline 基础设施（★ 2026-06-07: MissionPipelineRegistry 已 @Global，不再 local-provide）
    MissionPipelineOrchestrator,
    // checkpoint store + service（WritingMissionStoreService 依赖）
    // InMemoryMissionCheckpointStore: plain class（无 @Injectable），用 useValue 实例化
    {
      provide: InMemoryMissionCheckpointStore,
      useValue: new InMemoryMissionCheckpointStore(),
    },
    {
      provide: MissionCheckpointService,
      useFactory: (store: MissionCheckpointStore) =>
        new MissionCheckpointService(store),
      inject: [InMemoryMissionCheckpointStore],
    },
    // store + projector
    WritingMissionStoreService,
    // WritingArtifactProjector is a pure class (no @Injectable), registered via useValue
    {
      provide: WritingArtifactProjector,
      useValue: new WritingArtifactProjector(),
    },
    // business-orchestrator 必须在 dispatcher 之前注册（dispatcher.onModuleInit 调
    // businessOrch.bindSessionLookup 时 instance 已存在）
    WritingBusinessOrchestrator,
    WritingPipelineDispatcher,
    // Role services (6 = AgentInvoker + 5 writing roles)
    AgentInvoker,
    WriterService,
    BibleKeeperService,
    StoryArchitectService,
    ConsistencyService,
    EditorService,
  ],
  exports: [
    AiWritingService,
    WritingRepository,
    WritingDataExportService,
    WRITING_DATA_EXPORT,
  ],
})
export class AiWritingModule implements OnModuleInit {
  private readonly logger = new Logger(AiWritingModule.name);

  constructor(
    private readonly styleTemplateService: StyleTemplateService,
    private readonly promptSkillBridge: PromptSkillBridge,
    // R0-A5: 注册 writing skills 目录到 engine SkillLoader
    private readonly skillLoader: SkillLoaderService,
    // ★ W1: 事件类型注册（EventBus 未注册的 type 全部 drop+warn）
    private readonly eventRegistry: EventRegistry,
  ) {}

  async onModuleInit() {
    // ★ W1: 注册 writing.* 事件类型 — EventBus 校验未注册 type 会 drop+warn
    // 必须在 gateway afterInit 之前完成，但 DI 生命周期保证 onModuleInit 先于 afterInit
    this.eventRegistry.registerAll(WRITING_EVENTS);
    this.logger.log("  writing.* event types registered (21)");

    // R0-A5 (2026-05-04): writing 自己注册 skill 目录到 engine（替代 engine
    // 硬编码 ai-app/writing/skills 路径）
    const path = await import("path");
    await this.skillLoader.addSkillDirectory({
      path: path.resolve(__dirname, "skills"),
      domain: "writing",
      recursive: false,
    });

    // Writing Agents are managed internally by WritingMissionService
    // They don't need to be registered with the global AgentRegistry
    // because they use a different interface (BaseAgent/IAgent vs IPlanBasedAgent)
    this.logger.log(
      "AI Writing Module initialized successfully (v4-DOME-enhanced)",
    );
    this.logger.log("  Available Writing Agents (5):");
    this.logger.log("    - Story Architect (Leader)");
    this.logger.log("    - Bible Keeper");
    this.logger.log("    - Writer");
    this.logger.log("    - Consistency Checker");
    this.logger.log("    - Editor");

    // 初始化系统风格模板
    try {
      await this.styleTemplateService.initializeSystemTemplates();
      this.logger.log("  System style templates initialized");
    } catch (e) {
      this.logger.warn(
        `Failed to initialize system style templates: ${(e as Error).message}`,
      );
    }

    // Bridge prompt skills from SKILL.md → SkillRegistry
    const bridgeResult = await this.promptSkillBridge.registerDomain("writing");
    this.logger.log(
      `  Prompt skills bridged: registered=${bridgeResult.registered.length}, ` +
        `skipped=${bridgeResult.skipped.length}, errors=${bridgeResult.errors.length}`,
    );
  }
}
