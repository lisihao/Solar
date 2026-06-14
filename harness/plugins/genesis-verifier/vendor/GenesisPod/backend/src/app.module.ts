import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ResponseTransformInterceptor } from "./common/interceptors/response-transform.interceptor";
import { RequestLoggerInterceptor } from "./common/interceptors/request-logger.interceptor";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { CommonModule } from "./common/common.module";
import { PrismaModule } from "./common/prisma/prisma.module";
import { SeedModule } from "./common/seed/seed.module";
// ★ PR-A6 (2026-05-07): per-workspace 灰度 @Global service（无业务依赖，仅 Prisma）
import { FeatureFlagModule } from "./common/feature-flag/feature-flag.module";
import { RawDataModule } from "./modules/ai-app/explore/rawdata/rawdata.module";
import { GraphModule } from "./common/graph/graph.module";
// AiOrchestrationModule removed (PR-X28): only error-classifier was used; it
// is now at ai-engine/llm/abstractions/error-classifier.ts. Other services in
// the old module had zero production consumers.
import { StreamingModule } from "./common/streaming";
import { ContentProcessingModule } from "./common/content-processing";
import { AuditModule } from "./common/audit";
import { EventsModule } from "./common/events";
import { CacheModule } from "./common/cache";
// AI Infrastructure modules
import { AuthModule } from "./modules/platform/auth/auth.module";
import { AdminModule } from "./modules/open-api/admin/admin.module";
import { MonitoringModule } from "./modules/platform/monitoring";
import { EmailModule } from "./modules/platform/email/email.module";
import { FeedbackModule } from "./modules/ai-app/feedback/feedback.module";
import { NotificationModule } from "./modules/platform/notifications/notification.module";
import { NotificationDispatcherModule } from "./modules/platform/notifications/dispatcher/notification-dispatcher.module";
import { ReleaseModule } from "./modules/platform/release/release.module";
import { SettingsModule } from "./modules/platform/settings/settings.module";
import { StorageModule } from "./modules/platform/storage/storage.module";
import { DbOpsModule } from "./modules/platform/db-ops/db-ops.module";
import { CreditsModule } from "./modules/platform/credits/credits.module";
import { EncryptionModule } from "./modules/platform/credentials/storage/encryption/encryption.module";
import { UserApiKeysModule } from "./modules/platform/credentials/user-owned/user-api-keys/user-api-keys.module";
import { ByokModule } from "./modules/open-api/user/byok/byok.module";
import { KeyAssignmentsModule } from "./modules/platform/credentials/governance/key-assignments";
import { KeyRequestsModule } from "./modules/platform/credentials/governance/key-requests";
import { KeyResolverModule } from "./modules/platform/credentials/resolution/key-resolver";
import { UserModelConfigsModule } from "./modules/platform/credentials/user-owned/user-model-configs";
// AI modules
import { AiEngineModule } from "./modules/ai-engine/ai-engine.module";
// AI Harness â€” Agent kernel / execution / memory / process / protocol / governance / facade
// æ•´ä½“ç”± app.module.ts è£…é…ï¼ˆ@Globalï¼Œæä¾›å™¨å…¨å±€å¯æ³¨å…¥ï¼‰ï¼Œai-engine ä¸å†åå‘ä¾èµ–
import { HarnessModule } from "./modules/ai-harness/harness.module";
import { HarnessApiModule } from "./modules/ai-harness/facade/api/harness-api.module";
import { RealtimeModule } from "./modules/ai-harness/protocols/realtime/realtime.module";
import { AiAskModule } from "./modules/ai-app/ask/ai-ask.module";
import { AiImageModule } from "./modules/ai-app/image/ai-image.module";
import { AiOfficeModule } from "./modules/ai-app/office/ai-office.module";
import { AiSimulationModule } from "./modules/ai-app/simulation/ai-simulation.module";
import { AiTeamsModule } from "./modules/ai-app/teams/ai-teams.module";
import { PlanningModule } from "./modules/ai-app/planning/planning.module";
import { RAGModule } from "./modules/ai-app/library/rag/rag.module";
import { AiWritingModule } from "./modules/ai-app/writing/ai-writing.module";
import { ResearchModule } from "./modules/ai-app/research";
import { InsightModule } from "./modules/ai-app/insight";
import { PlaygroundModule } from "./modules/ai-app/playground/module/playground.module";
import { RadarModule } from "./modules/ai-app/radar/module/radar.module";
import { ForesightModule } from "./modules/ai-app/foresight/foresight.module";
import { CompanyModule } from "./modules/ai-app/company/company.module";
import { MarketplaceModule } from "./modules/ai-app/marketplace/marketplace.module";
import { AiSocialModule } from "./modules/ai-app/social/module/ai-social.module";
import { SocialEngineBridgeModule } from "./modules/ai-app/social/runtime/social-engine-bridge.module";
// Explore modules (content discovery)
import { ExploreModule } from "./modules/ai-app/explore/explore.module";
import { ResourcesModule } from "./modules/ai-app/explore/resources/resources.module";
import { FeedModule } from "./modules/ai-app/explore/feed/feed.module";
import { ReportsModule } from "./modules/ai-app/explore/reports/reports.module";
import { CommentsModule } from "./modules/ai-app/explore/comments/comments.module";
// Library modules (shared content)
import { LibraryModule } from "./modules/ai-app/library/library.module";
import { CollectionsModule } from "./modules/ai-app/library/collections/collections.module";
import { OrganizeChatModule } from "./modules/ai-app/library/organize-chat/organize-chat.module";
import { NotesModule } from "./modules/ai-app/library/notes/notes.module";
// ★ v1.5.3 LLM Wiki — Library 主形态（顶层 tab 第一位）
import { WikiModule } from "./modules/ai-app/library/wiki/wiki.module";
import { KnowledgeGraphModule } from "./modules/ai-app/library/knowledge-graph/knowledge-graph.module";
import { RecommendationsModule } from "./modules/ai-app/library/recommendations/recommendations.module";
// Admin modules (backend management)
import { WorkspaceModule } from "./modules/open-api/user/workspace/workspace.module";
import { CrawlersModule } from "./modules/ai-app/explore/ingestion/crawlers/crawlers.module";
import { SourcesModule } from "./modules/ai-app/explore/ingestion/sources/sources.module";
import { IngestionConfigModule } from "./modules/ai-app/explore/ingestion/config/config.module";
import { SchedulerModule } from "./modules/ai-app/explore/ingestion/scheduler/scheduler.module";
// Content modules (Phase 3: moved from ai-engine to ai-app)
import { LongContentModule } from "./modules/ai-app/writing/content-engine/long-content.module";
import { ContentAnalysisModule } from "./modules/ai-app/office/content-analysis/content-analysis.module";
import { SynthesisModule } from "./modules/ai-app/office/content-synthesis/synthesis.module";
// Integration modules
import { ProxyModule } from "./modules/ai-app/library/proxy/proxy.module";
import { FeishuModule } from "./modules/ai-app/library/integrations/feishu/feishu.module";
import { NotionModule } from "./modules/ai-app/library/integrations/notion/notion.module";
import { GoogleDriveModule } from "./modules/ai-app/library/integrations/google-drive/google-drive.module";
import { AiFileOrganizerModule } from "./modules/ai-app/library/ai-file-organizer/ai-file-organizer.module";
// Export module
import { ExportModule } from "./common/export";
// Open API modules (webhooks, public-api, mcp-server, ai-core, agents-api)
import { WebhooksModule } from "./modules/open-api/external/webhooks";
import { MCPServerModule } from "./modules/open-api/external/mcp";
import { PublicModule } from "./modules/open-api/external/rest/public.module";
import { OpenApiSystemModule } from "./modules/open-api/system/system.module";
import { OpenApiUserModule } from "./modules/open-api/user/user.module";
import { AiModule } from "./modules/open-api/user/ai/ai.module";
import { AgentsModule } from "./modules/open-api/user/agents/agents.module";
import { SkillsModule } from "./modules/open-api/user/skills/skills.module";
// A2A API module (open-api layer â€” PR-X17: controller moved from ai-harness/protocols/a2a)
import { A2AApiModule } from "./modules/open-api/external/a2a/a2a.module";
// BYOK Admin module (open-api layer â€” PR-X17: 4 admin controllers moved from platform/credentials)
import { ByokAdminModule } from "./modules/open-api/admin/byok/byok-admin.module";
// Request context middleware
import { RequestContextMiddleware } from "./common/context/request-context.middleware";
// Plugin system 内核（v5.1 R0.5）
// 修正后的分类原则：
//   - 真 plugin（可换 backend）：telemetry-otel / tool-cache-redis / sandbox /
//     vector-* / embedding-* / memory-* 等，由专门的 backend swap 需求驱动激活
//   - 核心能力（不该是 plugin）：timeout / validation / rate-limit / circuit-breaker
//     回归 ai-engine middleware / service 形态，不走 HookBus
// PluginCoreModule 仅注册内核（HookBus / Registry / Loader），不启用任何 plugin
// 实例（待 W2 起按"真 plugin"过滤后再单独激活）。
import { PluginCoreModule } from "./plugins/core";
// L1â†’L2 DI tokens (audit I-1/I-2: decouple L1 services from L2 concrete classes)
import {
  AI_CHAT_TOKEN,
  AI_OBSERVABILITY_TOKEN,
} from "./modules/platform/abstractions/ai-services.interface";
import { ChatFacade } from "./modules/ai-harness/facade";
import { AiObservabilityService } from "./modules/ai-harness/facade";

@Module({
  imports: [
    // é…ç½®æ¨¡å—
    ConfigModule.forRoot({
      isGlobal: true,
      // Load backend-specific .env first (highest precedence), then fall
      // back to the workspace root .env for shared values (DB, JWT, etc.).
      envFilePath: [".env", "../.env"],
    }),

    // å…¨å±€äº‹ä»¶æ¨¡å—ï¼ˆå¿…é¡»åœ¨ AppModule ä¸­åªè°ƒç”¨ä¸€æ¬¡ forRootï¼Œè®¾ç½® global: true ç¡®ä¿å…¨å±€å¯ç”¨ï¼‰
    EventEmitterModule.forRoot({
      global: true,
    }),

    // å…¨å±€å®šæ—¶ä»»åŠ¡æ¨¡å—ï¼ˆ@Cron è£…é¥°å™¨å¿…éœ€ï¼‰
    ScheduleModule.forRoot(),

    // APIé™æµä¿æŠ¤ - å…¨å±€é»˜è®¤60è¯·æ±‚/åˆ†é’Ÿ
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get("THROTTLE_TTL", 60000), // æ—¶é—´çª—å£ï¼š60ç§’
          limit: config.get("THROTTLE_LIMIT", 60), // é™åˆ¶ï¼š60æ¬¡è¯·æ±‚
        },
      ],
    }),
    // Plugin system 内核（仅注册 HookBus / Registry / Loader；无 plugin 实例）
    PluginCoreModule,

    // å…¬å…±åŸºç¡€æ¨¡å—
    CommonModule,

    // æ•°æ®åº“æ¨¡å—
    PrismaModule,
    SeedModule, // boot-time idempotent system-data sync (simulation providers / youtube sources)
    RawDataModule,
    GraphModule,

    // ★ PR-A6 (2026-05-07): per-workspace feature flag (@Global)
    FeatureFlagModule,

    // å…¬å…±æœåŠ¡æ¨¡å—
    CacheModule, // Redis/å†…å­˜ç¼“å­˜ï¼ˆå…¨å±€ï¼‰
    StreamingModule,
    ContentProcessingModule,
    AuditModule,
    EventsModule,

    // AI Infrastructure modules
    MonitoringModule, // Global module for AI metrics and error tracking
    AuthModule,
    AdminModule,
    EmailModule,
    FeedbackModule,
    NotificationModule,
    NotificationDispatcherModule,
    ReleaseModule,
    SettingsModule,
    StorageModule,
    DbOpsModule,
    CreditsModule,
    EncryptionModule, // å…¨å±€åŠ å¯†æœåŠ¡ï¼ˆå¿…é¡»å…ˆäºŽä¾èµ–å®ƒçš„æ¨¡å—æ³¨å†Œï¼‰
    UserApiKeysModule,
    ByokModule, // BYOK user-facing controllers (PR-X17: migrated from ai-engine/llm)
    // BYOK v2ï¼šå¯åˆ†å‘ Key æ±  + åˆ†é… + ç”³è¯· + ç»Ÿä¸€è§£æž
    KeyAssignmentsModule,
    KeyRequestsModule,
    KeyResolverModule,
    UserModelConfigsModule,

    // AI modules (ai-* prefix)
    // â˜… Harness å¿…é¡»å…ˆäºŽ AiEngineModule è£…é… â€” engine å­æ¨¡å—ï¼ˆå¦‚ RuntimeResourceModuleï¼‰
    // ä¾èµ– harness æ³¨å†Œçš„ DI tokenï¼ˆSPEC_AGENT_REGISTRY_PROBE / TOOL_CIRCUIT_BREAKER_PROBEï¼‰
    HarnessModule,
    HarnessApiModule,
    RealtimeModule,
    AiEngineModule,
    AiAskModule,
    AiImageModule,
    AiOfficeModule,
    AiSimulationModule,
    AiTeamsModule,
    PlanningModule,
    RAGModule,
    AiWritingModule,
    ResearchModule, // Deep Research æ¨¡å— (Deep Research + Notebook Research)
    InsightModule, // Topic Insights ä¸“é¢˜æ´žå¯Ÿæ¨¡å— (ä»Ž Research æ‹†åˆ†)
    PlaygroundModule,
    RadarModule, // AI 雷达：多源数据采集 + 多 Agent 看板 (PR-R1 起)
    ForesightModule, // AI 前瞻：判断资产 / 假设图谱（2026-06-12 P0）
    MarketplaceModule, // @Global 平台共享市场（能力 manifest + 可执行能力注册表）— design.md §4.3
    CompanyModule, // 一人公司 OS（W1a 市场目录 API）— design.md §10
    AiSocialModule,
    SocialEngineBridgeModule, // @Global 绑定 SOCIAL_PUBLISH_PORT → SocialPublishAdapter，给 engine 三个发布 tool 委托
    // Content engine modules (Phase 3: moved from ai-engine)
    LongContentModule,
    ContentAnalysisModule,
    SynthesisModule,
    // Content modules
    ResourcesModule,
    FeedModule,
    CollectionsModule,
    OrganizeChatModule,
    NotesModule,
    WikiModule, // ★ v1.5.3 LLM Wiki
    CommentsModule,
    ReportsModule,
    ExploreModule,
    LibraryModule, // R2 P1 fix (2026-05-18): registers LibrarySocialSourceProvider so DiscoveryService can find it
    WorkspaceModule,
    KnowledgeGraphModule,
    RecommendationsModule,

    // Ingestion modules
    CrawlersModule,
    SourcesModule,
    IngestionConfigModule,
    SchedulerModule,

    // Integration modules
    ProxyModule,
    FeishuModule,
    NotionModule,
    GoogleDriveModule,
    AiFileOrganizerModule,

    // Export module
    ExportModule,

    // Webhooks module
    WebhooksModule,

    // MCP Server module
    MCPServerModule,

    // Public API module
    PublicModule,
    // Open-API 系统基建面（standards/24: system = auth/metrics 平台握手，零业务）
    OpenApiSystemModule,
    // Open-API 用户自助面（standards/24: user = JWT 第一方跨域 credits/notifications）
    OpenApiUserModule,

    // A2A API module (PR-X17: controller moved to open-api/external/a2a)
    A2AApiModule,

    // AI Core API (PR-X6)
    AiModule,

    // Agents API (PR-X6)
    AgentsModule,

    // Skills API (PR-X16: moved from ai-engine/skills/api)
    SkillsModule,

    // BYOK Admin API (PR-X17: 4 admin controllers moved from platform/credentials)
    ByokAdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // L1â†’L2 DI bindings: map abstract tokens to concrete L2 services (audit I-1/I-2)
    { provide: AI_CHAT_TOKEN, useExisting: ChatFacade },
    { provide: AI_OBSERVABILITY_TOKEN, useExisting: AiObservabilityService },
    // å…¨å±€ JWT è®¤è¯å®ˆå«ï¼ˆ@Public() è£…é¥°å™¨è·³è¿‡ï¼‰
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // å…¨å±€å¯ç”¨é™æµå®ˆå«
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // å…¨å±€è¯·æ±‚æ—¥å¿— & æ€§èƒ½è¿½è¸ªæ‹¦æˆªå™¨ï¼ˆServer-Timing header + æŒ‡æ ‡æ”¶é›†ï¼‰
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggerInterceptor,
    },
    // å…¨å±€å“åº”æ ¼å¼è½¬æ¢æ‹¦æˆªå™¨
    // Ensures consistent API response format: { success, data, metadata }
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseTransformInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
