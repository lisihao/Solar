/**
 * AI Planning Module
 * AI 策划模块 — 独立 AI App
 *
 * 依赖：
 * - AiEngineModule: TeamRegistry 注册策划团队配置
 * - AiTeamsModule: 复用 Topic/Mission/Debate 基础设施（受控的跨 App 依赖）
 *
 * ★ 架构说明 (PLANNING → TEAMS 跨 App 依赖):
 *   Planning 模块把 Teams 的 Topic/Mission/Debate 机制用作执行基础设施，
 *   本质上是 "Teams 基础设施的受控消费者"，而非普通的平级 App 依赖。
 *   待 AiEngineModule 将 Topic/Mission 抽象为引擎级能力时，可消除此依赖。
 *   当前将其列为已知 P3 技术债，由架构审计追踪。
 */

import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { AiEngineModule } from "../../ai-engine/ai-engine.module";
import { AiTeamsModule } from "../teams/ai-teams.module";
import { PlanningController } from "./controllers";
import {
  PlanningOrchestratorService,
  PlanningTemplateService,
} from "./services";
import { PLANNING_TEAM_CONFIG } from "./config";
import { TeamRegistry, RoleRegistry } from "@/modules/ai-harness/facade";
import { RESEARCH_LEAD_ROLE_CONFIG } from "../research/teams";

@Module({
  imports: [PrismaModule, AiEngineModule, AiTeamsModule],
  controllers: [PlanningController],
  providers: [PlanningOrchestratorService, PlanningTemplateService],
  exports: [PlanningOrchestratorService, PlanningTemplateService],
})
export class PlanningModule implements OnModuleInit {
  private readonly logger = new Logger(PlanningModule.name);

  constructor(
    private readonly teamRegistry: TeamRegistry,
    private readonly roleRegistry: RoleRegistry,
  ) {}

  onModuleInit() {
    // v3 R0-A1-d: 业务 leader 角色由 ai-app 自身注册（base layer 不再硬编码业务名）
    this.roleRegistry.registerFromConfig(RESEARCH_LEAD_ROLE_CONFIG);
    this.teamRegistry.registerConfig(PLANNING_TEAM_CONFIG);
    this.logger.log("Registered PLANNING team config");
  }
}
