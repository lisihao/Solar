/**
 * RadarModule —— AI 雷达
 *
 * 彻底重构后（2026-05-16）：
 *   - 完全用 ai-harness mission pipeline 框架（MissionPipelineOrchestrator /
 *     SkillLoaderService / EventBus / MissionAbortRegistry /
 *     MissionRuntimeShellFramework / SocketBroadcastAdapter）
 *   - 9 个 stage adapter（s1-s8 + discovery）+ BusinessOrchestrator + Dispatcher
 *   - 5 个 SKILL.md 通过 SkillLoaderService 加载（替代 5 个旧 @Injectable agent service）
 *   - radar.events.ts 注册到 EventRegistry
 *   - RadarGateway 在 afterInit 注册 SocketBroadcastAdapter
 */
import { Logger, Module, OnModuleInit } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { BullModule } from "@nestjs/bullmq";
import * as path from "path";

import {
  EventRegistry,
  MissionFailureCode,
  MissionLifecycleManager,
  MissionLivenessGuard,
  MissionPipelineOrchestrator,
  ToolRegistry,
} from "@/modules/ai-harness/facade";
import { SkillLoaderService } from "@/modules/ai-engine/facade";
import { NotificationModule } from "../../../platform/notifications/notification.module";
import { NotificationDispatcherModule } from "../../../platform/notifications/dispatcher/notification-dispatcher.module";
import { MonitoringModule } from "../../../platform/monitoring/monitoring.module";

import { RadarTopicController } from "../api/controller/radar-topic.controller";
import { RadarSourceController } from "../api/controller/radar-source.controller";
import { RadarFeedController } from "../api/controller/radar-feed.controller";
import { RadarInsightController } from "../api/controller/radar-insight.controller";
import { RadarRunController } from "../api/controller/radar-run.controller";
import { NarrativeController } from "../api/controller/narrative.controller";
import { FavoriteController } from "../api/controller/favorite.controller";
import { DailyBriefingController } from "../api/controller/daily-briefing.controller";
import { WeeklyBriefingController } from "../api/controller/weekly-briefing.controller";

import { RadarDailyBriefingRepo } from "../mission/services/briefing/radar-daily-briefing.repo";
import { NarrativeService } from "../mission/services/briefing/narrative.service";
import { FavoriteService } from "../mission/services/briefing/favorite.service";
import { RadarWeeklyBriefingService } from "../mission/services/briefing/radar-weekly-briefing.service";
import { SignalEditorService } from "../mission/services/briefing/signal-editor.service";
import { RadarS9DailyTopNStage } from "../mission/pipeline/stages/s9-daily-top-n.stage";
import { RadarTopicService } from "../mission/services/topic/radar-topic.service";
import { RadarSourceService } from "../mission/services/source/radar-source.service";
import { SourceHealthService } from "../mission/services/source/source-health.service";
import { CollectorRouter } from "../mission/services/collectors/collector-router.service";
import { RssCollector } from "../mission/services/collectors/rss-collector.service";
import { YoutubeCollector } from "../mission/services/collectors/youtube-collector.service";
import { XCollector } from "../mission/services/collectors/x-collector.service";
import { CustomCollector } from "../mission/services/collectors/custom-collector.service";

import { RadarRefreshScheduler } from "../mission/services/scheduler/radar-refresh.scheduler";
import { RadarBriefingQueueService } from "../mission/services/scheduler/radar-briefing-queue.service";
import { RadarBriefingProcessor } from "../mission/services/scheduler/radar-briefing.processor";
import { DailyBriefingGeneratorService } from "../mission/services/briefing/daily-briefing-generator.service";

// ── 新框架接入 ───────────────────────────────────────────────────────────
import { RadarMissionStore } from "../mission/lifecycle/radar-mission-store.service";
// ★ B7-2 (thinning plan §B7-2): radar canonical view
import { RadarMissionQueryService } from "../mission/query/radar-mission-query.service";
import { RadarMissionEventBuffer } from "../mission/lifecycle/radar-mission-event-buffer.service";
import { RadarMissionRuntimeShell } from "../mission/pipeline/radar-mission-runtime-shell.service";
import { RadarBusinessOrchestrator } from "../mission/pipeline/radar-business-orchestrator.service";
import { RadarPipelineDispatcher } from "../mission/pipeline/radar-pipeline-dispatcher.service";
import { RadarS1SourceResolveStage } from "../mission/pipeline/stages/s1-source-resolve.stage";
import { RadarS2CollectStage } from "../mission/pipeline/stages/s2-collect.stage";
import { RadarS3DedupeStage } from "../mission/pipeline/stages/s3-dedupe.stage";
import { RadarS4RelevanceStage } from "../mission/pipeline/stages/s4-relevance.stage";
import { RadarS5QualityStage } from "../mission/pipeline/stages/s5-quality.stage";
import { RadarS6EntityStage } from "../mission/pipeline/stages/s6-entity.stage";
import { RadarS7InsightStage } from "../mission/pipeline/stages/s7-insight.stage";
import { RadarS8PersistStage } from "../mission/pipeline/stages/s8-persist.stage";
import { RadarDiscoveryStage } from "../mission/pipeline/stages/radar-discovery.stage";
import { RadarGateway } from "../runtime/radar.gateway";
import { RADAR_DOMAIN_EVENTS } from "../events/radar.events";

// ── 对外供料（2026-06-12 雷达 → 洞察/前瞻 集成） ─────────────────────────
import { RadarContentSourceProvider } from "../integrations/radar-content-source.provider";
import { RadarSignalSearchTool } from "../integrations/radar-signal-search.tool";

@Module({
  imports: [
    // P0 production fix — BullMQ 必须显式配 Redis connection；
    // 无 forRootAsync 时 fallback 到 127.0.0.1:6379（生产容器内不可用）
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const url =
          config.get<string>("REDIS_URL") ??
          config.get<string>("REDIS_PUBLIC_URL");
        if (!url) {
          // 本地 dev 无 Redis：仍走 default localhost；生产由 REDIS_URL 提供
          return { connection: { host: "127.0.0.1", port: 6379 } };
        }
        const parsed = new URL(url);
        return {
          connection: {
            host: parsed.hostname,
            port: Number(parsed.port || 6379),
            username: parsed.username || undefined,
            password: parsed.password || undefined,
            db:
              parsed.pathname && parsed.pathname.length > 1
                ? Number(parsed.pathname.slice(1))
                : 0,
            // BullMQ 推荐：避免阻塞主 event loop（maxRetriesPerRequest null 让 worker 自管重试）
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: RadarBriefingQueueService.QUEUE_NAME }),
    NotificationModule,
    NotificationDispatcherModule,
    MonitoringModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_SECRET"),
        signOptions: { expiresIn: "7d" },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    RadarTopicController,
    RadarSourceController,
    RadarFeedController,
    RadarInsightController,
    RadarRunController,
    NarrativeController,
    FavoriteController,
    DailyBriefingController,
    WeeklyBriefingController,
  ],
  providers: [
    // briefing 层（B5/B6/B15/B16/B2/B1+B10+B20 stage）
    RadarDailyBriefingRepo,
    RadarWeeklyBriefingService,
    NarrativeService,
    FavoriteService,
    SignalEditorService,
    RadarS9DailyTopNStage,
    // 顶层业务 service
    RadarTopicService,
    RadarSourceService,
    SourceHealthService,
    // collector helper（s2-collect stage 内部使用，不直接对外）
    CollectorRouter,
    RssCollector,
    YoutubeCollector,
    XCollector,
    CustomCollector,
    // 调度（走 dispatcher.runRefreshMission + briefing sweep + BullMQ processor）
    RadarRefreshScheduler,
    RadarBriefingQueueService,
    RadarBriefingProcessor,
    DailyBriefingGeneratorService,
    // 新框架接入 —— orchestrator 由消费模块本地 register
    // （MissionRuntimeShellFramework / EventBus 由 @Global HarnessModule 提供）
    // ★ 2026-06-07: MissionPipelineRegistry 已提升为 @Global（teams.module），
    //   不再 local-provide；dispatcher.onModuleInit 仍向同一全局单例注册本 app pipeline。
    MissionPipelineOrchestrator,
    RadarMissionStore,
    // ★ B7-2 canonical view (thinning plan §B7-2)
    RadarMissionQueryService,
    RadarMissionEventBuffer,
    RadarMissionRuntimeShell,
    RadarBusinessOrchestrator,
    RadarPipelineDispatcher,
    RadarS1SourceResolveStage,
    RadarS2CollectStage,
    RadarS3DedupeStage,
    RadarS4RelevanceStage,
    RadarS5QualityStage,
    RadarS6EntityStage,
    RadarS7InsightStage,
    RadarS8PersistStage,
    RadarDiscoveryStage,
    RadarGateway,
    // 对外供料：雷达信号 → ContentSourceRegistry（社交/前瞻等）+ ToolRegistry（洞察 researcher）
    RadarContentSourceProvider,
    RadarSignalSearchTool,
  ],
  exports: [
    RadarTopicService,
    RadarSourceService,
    RadarPipelineDispatcher,
    RadarMissionStore,
    RadarBriefingQueueService,
  ],
})
export class RadarModule implements OnModuleInit {
  private readonly log = new Logger(RadarModule.name);

  constructor(
    private readonly eventRegistry: EventRegistry,
    private readonly skillLoader: SkillLoaderService,
    private readonly livenessGuard: MissionLivenessGuard,
    private readonly missionStore: RadarMissionStore,
    // ★ C0/G1：liveness 回收也经唯一终态写入口仲裁，不直写 store。
    private readonly lifecycleManager: MissionLifecycleManager,
    // 雷达 → 洞察供料：信号检索工具注册进全局 ToolRegistry
    private readonly toolRegistry: ToolRegistry,
    private readonly signalSearchTool: RadarSignalSearchTool,
  ) {}

  async onModuleInit(): Promise<void> {
    // 0. 注册 radar-signal-search 到全局 ToolRegistry（information 类目）——
    //    playground / 洞察 researcher 采证时可检索用户雷达信号（register 幂等）
    this.toolRegistry.register(this.signalSearchTool);

    // 1. 注册业务事件 schema —— EventBus 校验未注册的 type 一律 drop+warn
    this.eventRegistry.registerAll(RADAR_DOMAIN_EVENTS);
    this.log.log(
      `RadarModule: registered ${RADAR_DOMAIN_EVENTS.length} domain event types`,
    );

    // 2. 加载 5 个 SKILL.md（替代旧 5 个 @Injectable agent service 的 prompt 字符串）
    await this.skillLoader.addSkillDirectory({
      path: path.resolve(__dirname, "..", "mission", "agents"),
      domain: "ai-radar",
      recursive: false,
    });
    this.log.log(
      "RadarModule: SKILL.md directory registered (5 agents under ai-radar/agents/)",
    );

    // 3. ★ 2026-05-22 C8：注册 MissionLivenessGuard adapter。
    //    radar_runs 早有 heartbeatAt/podId + [status,heartbeatAt] 索引，但此前从未注册
    //    adapter——心跳写了没人扫，pod 重启/卡死的孤儿 running 行永不回收。本注册补上
    //    扫描链：guard 周期扫 running 行，心跳停滞超阈值即 markFailed 回收。
    //    radar 无 mission-event 表，故 getMostRecentEventTs 返回空，liveness 仅按 heartbeatAt 判活。
    this.livenessGuard.registerAdapter("ai-radar", {
      fetchRunningMissions: async () => {
        try {
          return await this.missionStore.fetchRunningForLiveness();
        } catch (err: unknown) {
          this.log.warn(
            `[liveness] fetchRunningForLiveness failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [];
        }
      },
      getMostRecentEventTs: async () => new Map<string, number>(),
      markFailed: async (missionId, reason, errorMessage) => {
        // ★ C0/C2/MAJOR-4:liveness 回收经 finalize 仲裁(条件写首写赢,不覆盖已终态),
        //   落 canonical failureCode(超时→wall_time;失联/孤儿→runtime_crashed)。
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
            extra: { kind: "failed", error },
          },
          arbiter: this.missionStore,
        });
        this.log.warn(
          `[liveness] radar mission ${missionId} reclaimed (${reason})`,
        );
      },
    });
    this.log.log(
      "RadarModule: MissionLivenessGuard adapter registered (ai-radar)",
    );
  }
}
