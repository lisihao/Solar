import {
  Logger,
  Module,
  OnApplicationBootstrap,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
// DiscoveryModule removed (P17a 2026-05-24): no longer needed — ContentSourceRegistry
// lives in engine and brings its own DiscoveryModule. ai-social is now a pure consumer.
import { JwtModule } from "@nestjs/jwt";
import { AiSocialController } from "../api/controller/ai-social.controller";
import { SocialDataSourceController } from "../api/controller/social-data-source.controller";
import { SocialTaskController } from "../api/controller/social-task.controller";
import { SocialTaskService } from "../mission/services/social-task.service";
// ★ B7-1 (thinning plan §B7-1): social canonical view
import { SocialMissionQueryService } from "../mission/query/social-mission-query.service";
// P17a (2026-05-24): SocialDataSourceRegistry → engine ContentSourceRegistry
//   (provided by @Global AiEngineModule; auto-injected, no registration needed)
import { AiSocialService } from "../mission/services/ai-social.service";
import { SocialConnectionsService } from "../mission/services/social-connections.service";
import { XhsMcpFacadeService } from "../mission/services/xhs-mcp-facade.service";
import { SocialImportSourcesService } from "../mission/services/social-import-sources.service";
import { SocialLeaderService } from "../mission/services/social-leader.service";
import { ContentFetcherService } from "../mission/services/content-fetcher.service";
import { ContentTransformerService } from "../mission/services/content-transformer.service";
import { ContentCheckerService } from "../mission/services/content-checker.service";
import { ContentVersionService } from "../mission/services/content-version.service";
import { ReviewService } from "../mission/services/review.service";
import { PublishExecutorService } from "../mission/services/publish-executor.service";
import { SocialBrowserService } from "../mission/services/social-browser.service";
import { SessionHealthCheckScheduler } from "../mission/services/session-health-check.scheduler";
import { PublishSchedulerService } from "../mission/services/publish-scheduler.service";
import { WechatAdapter } from "../integrations/wechat/wechat.adapter";
import { XhsMcpAdapter } from "../integrations/xiaohongshu/xiaohongshu.adapter";
import { MCPClientService } from "../runtime/mcp-client.service";
import { WechatArticleFormatterService } from "../mission/services/wechat-article-formatter.service";
import { WechatImageUploaderService } from "../mission/services/wechat-image-uploader.service";
import { SocialPublishAdapter } from "../runtime/social-publish.adapter";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { CacheModule } from "../../../../common/cache/cache.module";
import { BrowserModule } from "../../../../common/browser/browser.module";
import { AiEngineModule } from "../../../ai-engine/ai-engine.module";
import { ExploreModule } from "../../explore/explore.module";
import { NotificationModule } from "../../../platform/notifications/notification.module";
import { CreditsModule } from "../../../platform/credits/credits.module";
import { initSessionCrypto } from "../mission/services/session-crypto";

// ★ W4 PR-3b/3c/4: SocialPublishMission Agent Team
import {
  SocialAgentInvoker,
  LeaderService as MissionLeaderService,
  StewardService,
  PlatformProbeService,
  ContentTransformerAgentService,
  CoverArtistService,
  ComposerService,
  PolishReviewerService,
  PublishExecutorAgentService,
  PublishVerifierService,
} from "../mission/roles";
import { SocialPipelineDispatcher } from "../mission/pipeline/social-pipeline-dispatcher.service";
// ★ W4 PR-4b round-2: orchestrator + runtime-shell + gateway + buffer 接入
import { SocialBusinessOrchestrator } from "../mission/pipeline/social-business-orchestrator.service";
import { SocialRuntimeShellService } from "../mission/pipeline/social-runtime-shell.service";
import { SocialMissionStore } from "../mission/lifecycle/social-mission-store.service";
import { SocialEventBuffer } from "../mission/lifecycle/social-event-buffer.service";
import { SocialGateway } from "../runtime/social.gateway";
import { SOCIAL_EVENTS } from "../events/social.events";
import {
  EventBus,
  EventRegistry,
  MissionFailureCode,
  MissionLifecycleManager,
  MissionLivenessGuard,
  MissionPipelineOrchestrator,
} from "@/modules/ai-harness/facade";
import { PromptSkillRegistrationService } from "@/modules/ai-engine/facade";

@Module({
  imports: [
    PrismaModule,
    CacheModule,
    BrowserModule,
    AiEngineModule,
    ExploreModule,
    ConfigModule,
    NotificationModule,
    CreditsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET"),
        signOptions: { expiresIn: "7d" },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    AiSocialController,
    SocialDataSourceController,
    SocialTaskController,
  ],
  providers: [
    AiSocialService,
    // Phase 2.A.1/A.2/A.5 god class 拆分（2026-05-27）
    SocialConnectionsService,
    XhsMcpFacadeService,
    SocialImportSourcesService,
    SocialLeaderService,
    // ★ B7-1 canonical view (thinning plan §B7-1)
    SocialMissionQueryService,
    ContentFetcherService,
    ContentTransformerService,
    ContentCheckerService,
    ContentVersionService,
    ReviewService,
    PublishExecutorService,
    SocialBrowserService,
    SessionHealthCheckScheduler,
    PublishSchedulerService,
    WechatAdapter,
    XhsMcpAdapter,
    MCPClientService,
    WechatArticleFormatterService,
    WechatImageUploaderService,
    SocialPublishAdapter,

    // ★ W4 SocialPublishMission Agent Team (PR-3b/3c/4/4b) ——
    //   PR-4b round-2 接入 MissionPipelineOrchestrator + runtime-shell + gateway
    SocialAgentInvoker,
    MissionLeaderService,
    StewardService,
    PlatformProbeService,
    ContentTransformerAgentService,
    CoverArtistService,
    ComposerService,
    PolishReviewerService,
    PublishExecutorAgentService,
    PublishVerifierService,
    // pipeline 基础设施（★ 2026-06-07: MissionPipelineRegistry 已 @Global，不再 local-provide）
    MissionPipelineOrchestrator,
    // runtime / store / buffer
    SocialMissionStore,
    SocialEventBuffer,
    SocialRuntimeShellService,
    // business-orchestrator 必须在 dispatcher 之前注册，保证 dispatcher.onModuleInit
    // 调 businessOrch.bindSessionLookup 时 instance 已存在
    SocialBusinessOrchestrator,
    SocialPipelineDispatcher,
    SocialGateway,
    // P17a (2026-05-24): SocialDataSourceRegistry removed — ai-social is now
    //   a pure consumer of engine ContentSourceRegistry (auto-injected via @Global)
    SocialTaskService,
  ],
  exports: [
    AiSocialService,
    SocialPublishAdapter,
    SocialPipelineDispatcher,
    SocialMissionStore,
  ],
})
export class AiSocialModule implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(AiSocialModule.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly eventBus: EventBus,
    private readonly registry: EventRegistry,
    private readonly buffer: SocialEventBuffer,
    private readonly promptSkillBridge: PromptSkillRegistrationService,
    private readonly livenessGuard: MissionLivenessGuard,
    private readonly missionStore: SocialMissionStore,
    // ★ C0/G1：liveness 回收也经唯一终态写入口仲裁，不直写 store。
    private readonly lifecycleManager: MissionLifecycleManager,
  ) {}

  onModuleInit(): void {
    const key = this.configService.get<string>("SESSION_ENCRYPTION_KEY");
    if (key) {
      initSessionCrypto(key);
      this.logger.log("Session encryption initialized");
    } else if (process.env.NODE_ENV === "production") {
      this.logger.error(
        "SESSION_ENCRYPTION_KEY not set. " +
          "WeChat login sessions cannot be encrypted. " +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    } else {
      this.logger.warn(
        "SESSION_ENCRYPTION_KEY not set, using development fallback key",
      );
    }

    // ★ W4 PR-4b round-2 / Reviewer C P0-5+P0-7: EventRegistry 注册 social.*
    //   事件类型（未注册的 type 被 drop+warn）+ 注册 buffer adapter（截获 social.*
    //   入内存，给 /replay 用 + 缓冲 mission 启动期事件）
    this.registry.registerAll(SOCIAL_EVENTS);
    this.eventBus.registerAdapter(this.buffer);
    this.logger.log(
      `Registered ${SOCIAL_EVENTS.length} social.* event types + buffer adapter`,
    );

    // ★ 2026-05-22 C8：注册 MissionLivenessGuard adapter。
    //    social_missions 早有 heartbeatAt/podId + [status,heartbeatAt] 索引，但此前从未
    //    注册 adapter——心跳写了没人扫，孤儿 running 行永不回收。本注册补上扫描链。
    //    social 无 mission-event 表，getMostRecentEventTs 返回空，liveness 仅按 heartbeatAt 判活。
    //    markFailed 走 store.markFailedByLiveness（status='running' 条件写，避免抢写已完成 mission）。
    this.livenessGuard.registerAdapter("ai-social", {
      fetchRunningMissions: async () => {
        try {
          return await this.missionStore.fetchRunningForLiveness();
        } catch (err: unknown) {
          this.logger.warn(
            `[liveness] fetchRunningForLiveness failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [];
        }
      },
      getMostRecentEventTs: async () => new Map<string, number>(),
      markFailed: async (missionId, reason, errorMessage) => {
        // ★ C0/C2/MAJOR-4:liveness 回收经 finalize 仲裁(条件写首写赢,不覆盖已终态),
        //   落 canonical failureCode(超时→wall_time;失联→runtime_crashed)。
        const error = `[liveness:${reason}] ${errorMessage}`;
        await this.lifecycleManager.finalize({
          missionId,
          intent: {
            status: "failed",
            failureCode:
              reason === "wall-time-exceeded"
                ? MissionFailureCode.wall_time_exceeded
                : MissionFailureCode.runtime_crashed,
            errorMessage: error,
            extra: {
              kind: "failed",
              detail: {
                errorMessage: error,
                failureCode:
                  reason === "wall-time-exceeded"
                    ? MissionFailureCode.wall_time_exceeded
                    : MissionFailureCode.runtime_crashed,
              },
            },
          },
          arbiter: this.missionStore,
        });
        this.logger.warn(
          `[liveness] social mission ${missionId} reclaimed (${reason})`,
        );
      },
    });
    this.logger.log("Registered MissionLivenessGuard adapter (ai-social)");
  }

  /**
   * ★ W4 PR-4b round-2 / Reviewer A P0-10: PromptSkillBridge.registerDomain('social')
   *
   * 在 onApplicationBootstrap 阶段（保证 SkillLoader 已完成 localSkills 加载），
   * 把 social domain 下的 SKILL.md 桥接到 engine SkillRegistry，让 SkillActivator
   * resolveFromProviders 能查到 social.leader / social.steward / ... 9 个 SKILL。
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const result = await this.promptSkillBridge.registerDomain("social");
      this.logger.log(
        `Registered social skill domain: ${result.registered.length} skills bridged ` +
          `(skipped=${result.skipped.length}, errors=${result.errors.length})`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to register social skill domain: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
