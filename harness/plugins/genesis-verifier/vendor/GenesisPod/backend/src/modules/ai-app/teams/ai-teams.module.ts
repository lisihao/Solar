/**
 * AI Teams Module
 * AI 团队协作模块
 *
 * 职责：
 * - Topic（话题）CRUD 和成员管理
 * - 消息发送和处理
 * - AI 辩论和任务编排
 * - WebSocket 实时通信
 * - 自定义团队管理（通过 AI Engine）
 *
 * 依赖 AI Engine 提供：
 * - TeamsService: 团队配置管理
 * - VotingManager: 共识投票
 * - HandoffCoordinator: 任务交接
 * - LLMFactory: LLM 调用
 */

import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import {
  AiTeamsController,
  UsersController,
  BookmarksController,
  CustomTeamsController,
  PublicReportsController,
  TeamsController,
  AITeamsAdminController,
  AITeamsTemplatesController,
} from "./controllers";
import { AiTeamsService } from "./ai-teams.service";
import { AITeamsAdminService } from "./ai-teams-admin.service";
import { TeamsRepository } from "./teams.repository";
import { AiTeamsGateway } from "./ai-teams.gateway";
import { PrismaModule } from "../../../common/prisma/prisma.module";
// 直接从文件导入，避免 barrel export 循环依赖
import { AiEngineModule } from "../../ai-engine/ai-engine.module";
import { CreditsModule } from "../../platform/credits/credits.module";
import { NotificationDispatcherModule } from "../../platform/notifications/dispatcher/notification-dispatcher.module";
import { LongContentModule } from "../writing/content-engine/long-content.module";
import {
  // AI 服务
  ContextRouterService,
  AiResponseService,
  TopicContextRetrievalService,
  TeamsLongContentService,
  LeaderModelService,
  // 协作服务
  DebateService,
  TeamMissionService,
  MissionExecutionService,
  MissionReviewService,
  // TaskBreakdownService 已删 (2026-04-30)
  TeamCollaborationService,
  MissionPromptService,
  MissionQueryService,
  MissionLifecycleService,
  MissionRetryService,
  MissionHealthCheckService,
  MissionAICallerService,
  TeamMessageService,
  TeamMemberService,
  // 长内容处理增强服务
  ConstraintEnforcementService,
  TokenBudgetCalculatorService,
  // Topic 领域服务
  TopicMembershipService,
  TopicPublicService,
  TopicForwardBookmarkService,
  // 事件服务
  TopicEventEmitterService,
  // 整合服务
  AiTeamsIntegrationService,
} from "./services";
// 注意：UrlParserService 和 WebContentExtractionService 由 @Global() ContentProcessingModule 提供
import { TeamMemberAgent, TeamCollaborationAgent } from "./agents";
import { TeamRegistry } from "@/modules/ai-harness/facade";
import { AgentRegistry } from "@/modules/ai-harness/facade";
import { DEBATE_TEAM_CONFIG } from "./teams";

@Module({
  imports: [
    PrismaModule,
    AiEngineModule,
    CreditsModule,
    NotificationDispatcherModule,
    LongContentModule,
    // BLK-7：gateway 握手 JWT 校验（不再信任客户端传的 userId）
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
    AiTeamsController,
    UsersController,
    BookmarksController,
    CustomTeamsController,
    PublicReportsController,
    // T3 sink: mission HTTP (route ai/teams) + admin team templates (route admin/ai-teams)
    TeamsController,
    AITeamsAdminController,
    AITeamsTemplatesController,
  ],
  providers: [
    // Repository
    TeamsRepository,

    // 核心业务服务
    AiTeamsService,
    AiTeamsGateway,
    AITeamsAdminService, // backs AITeamsAdminController (T3 sink)

    // AI 服务
    ContextRouterService,
    AiResponseService,
    TopicContextRetrievalService,
    TeamsLongContentService,
    LeaderModelService,
    TeamMemberAgent,
    TeamCollaborationAgent,

    // 协作服务
    DebateService,
    TeamMissionService,
    MissionExecutionService,
    MissionReviewService,
    // TaskBreakdownService 已删 (2026-04-30)
    TeamCollaborationService,
    MissionPromptService,
    MissionQueryService,
    MissionLifecycleService,
    MissionRetryService,
    MissionHealthCheckService,
    MissionAICallerService,
    TeamMessageService,
    TeamMemberService,

    // 长内容处理增强服务
    ConstraintEnforcementService,
    TokenBudgetCalculatorService,

    // Topic 领域服务
    TopicMembershipService,
    TopicPublicService,
    TopicForwardBookmarkService,
    TopicEventEmitterService,

    // AI Engine 整合服务
    AiTeamsIntegrationService,
    // 注意：UrlParserService 和 WebContentExtractionService 由 @Global() ContentProcessingModule 提供
  ],
  exports: [
    // Repository
    TeamsRepository,

    // 核心业务服务
    AiTeamsService,

    // AI 服务
    ContextRouterService,
    AiResponseService,
    TopicContextRetrievalService,
    TeamsLongContentService,

    // 协作服务
    DebateService,
    TeamMissionService,
    TeamCollaborationService,

    // 长内容处理增强服务
    ConstraintEnforcementService,
    TokenBudgetCalculatorService,

    // Topic 领域服务
    TopicMembershipService,
    TopicPublicService,
    TopicForwardBookmarkService,

    // AI Engine 整合服务
    AiTeamsIntegrationService,
    // 注意：UrlParserService 和 WebContentExtractionService 由 @Global() ContentProcessingModule 提供
  ],
})
export class AiTeamsModule implements OnModuleInit {
  private readonly logger = new Logger(AiTeamsModule.name);

  constructor(
    private readonly teamRegistry: TeamRegistry,
    private readonly agentRegistry: AgentRegistry,
    private readonly teamCollaborationAgent: TeamCollaborationAgent,
  ) {}

  onModuleInit() {
    this.teamRegistry.registerConfig(DEBATE_TEAM_CONFIG);
    this.agentRegistry.register(this.teamCollaborationAgent);
    this.logger.log("Registered DEBATE team config and TeamCollaborationAgent");
  }
}
