import { Logger, Module, OnModuleInit } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import {
  EventBus,
  EventRegistry,
  HumanApprovalAdminService,
} from "@/modules/ai-harness/facade";
import { AiAskController } from "./ai-ask.controller";
import { AiAskService } from "./ai-ask.service";
import { PrismaModule } from "../../../common/prisma/prisma.module";
// 直接从文件导入，避免 barrel export 循环依赖
import { AiEngineModule } from "../../ai-engine/ai-engine.module";
import { CreditsModule } from "../../platform/credits/credits.module";
// External object storage for the downloadable self-driven report deliverable.
import { StorageModule } from "../../platform/storage/storage.module";
// PR-2: KbQueryService — wiki-aware unified KB facade. Replaces the direct
// RAGPipelineService injection in ai-ask.service.ts so wiki augmentation is
// transparent to the consumer.
import { KbQueryModule } from "@/modules/ai-app/library/kb-query/kb-query.module";
// Sanctioned cross-app facade for saving deliverables to user cloud storage.
import { LibraryExportModule } from "@/modules/ai-app/library/export/library-export.module";
// W3: harness CollaborationModule 提供 DebatePattern / VotingManager / HandoffCoordinator
import { CollaborationModule } from "../../ai-harness/teams/collaboration/collaboration.module";
// Self-Driven Agent Team isolated dispatch
import { SelfDrivenTeamModule } from "../../ai-harness/teams/orchestrator/self-driven/self-driven-team.module";
import { AskSelfDrivenController } from "./self-driven/ask-self-driven.controller";
// Stage 1: durable event journal for self-driven missions (mirrors playground).
import { SelfDrivenMissionEventBuffer } from "./self-driven/self-driven-mission-event-buffer.service";
import { SELF_DRIVEN_EVENTS } from "./self-driven/self-driven.events";
// Stage 2: durable mission store + detached background dispatcher.
import { AskSelfDrivenMissionStore } from "./self-driven/ask-self-driven-mission.store";
import { SelfDrivenMissionDispatcher } from "./self-driven/self-driven-mission-dispatcher.service";
// Stage 3: socket gateway + replay controller + owner-scoped approval.
import { AskSelfDrivenReplayController } from "./self-driven/ask-self-driven-replay.controller";
import { AskSelfDrivenGateway } from "./self-driven/ask-self-driven.gateway";
import { AskSelfDrivenApprovalService } from "./self-driven/ask-self-driven-approval.service";
// Stage 5: dead-pod orphan detection.
import { SelfDrivenLivenessAdapter } from "./self-driven/self-driven-liveness.adapter";
// Teams 模式（W2 PR3）
import { AskRoomController } from "./ai-ask-room.controller";
import { AskRoomService } from "./ai-ask-room.service";
import { AskRoomRuntimeService } from "./ai-ask-room-runtime.service";
import { AskRoomRuntimeStateStore } from "./ai-ask-room-runtime-state.store";
import { AskRoomGateway } from "./ai-ask-room.gateway";
import { FreechatAdapter } from "./adapters/freechat.adapter";
import { ParallelMergeAdapter } from "./adapters/parallel-merge.adapter";
import { DebateAdapter } from "./adapters/debate.adapter";
import { VoteAdapter } from "./adapters/vote.adapter";
import { ReviewAdapter } from "./adapters/review.adapter";
import { HandoffAdapter } from "./adapters/handoff.adapter";

@Module({
  imports: [
    PrismaModule,
    AiEngineModule,
    KbQueryModule,
    LibraryExportModule,
    CreditsModule,
    CollaborationModule,
    SelfDrivenTeamModule,
    StorageModule,
    // Gateway JWT 校验（与 NotificationGateway / TopicResearchGateway 同模式）
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
    AiAskController,
    AskRoomController,
    AskSelfDrivenController,
    AskSelfDrivenReplayController,
  ],
  providers: [
    AiAskService,
    AskRoomService,
    AskRoomRuntimeService,
    AskRoomRuntimeStateStore,
    AskRoomGateway,
    FreechatAdapter,
    ParallelMergeAdapter,
    DebateAdapter,
    VoteAdapter,
    ReviewAdapter,
    HandoffAdapter,
    SelfDrivenMissionEventBuffer,
    AskSelfDrivenMissionStore,
    SelfDrivenMissionDispatcher,
    AskSelfDrivenApprovalService,
    AskSelfDrivenGateway,
    SelfDrivenLivenessAdapter,
    // Single class definition lives in ai-harness/lifecycle; provided here so
    // AskSelfDrivenApprovalService can delegate the response write to it (same
    // pattern open-api/admin already uses). Stateless, idempotent onModuleInit.
    HumanApprovalAdminService,
  ],
  exports: [AiAskService, AskRoomService],
})
export class AiAskModule implements OnModuleInit {
  private readonly logger = new Logger(AiAskModule.name);

  constructor(
    private readonly eventBus: EventBus,
    private readonly eventRegistry: EventRegistry,
    private readonly selfDrivenBuffer: SelfDrivenMissionEventBuffer,
  ) {}

  onModuleInit(): void {
    // Register self-driven event types (EventBus drops unregistered types) and
    // wire the durable buffer as a broadcast adapter so every structural
    // self-driven.* event is captured in-memory + persisted for /replay.
    this.eventRegistry.registerAll(SELF_DRIVEN_EVENTS);
    this.eventBus.registerAdapter(this.selfDrivenBuffer);
    this.logger.log(
      `Self-Driven event journal wired: ${SELF_DRIVEN_EVENTS.length} event types registered`,
    );
  }
}
