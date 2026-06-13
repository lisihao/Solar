/**
 * Discussion Module - 讨论式研究模块
 *
 * 提供深度迭代研究能力:
 * - 讨论驱动型研究 (Discussion-driven Research)
 * - 迭代搜索 (Iterative Search)
 * - 报告合成 (Report Synthesis)
 *
 * 保留旧服务用于向后兼容旧 session 和 MCP Server 调用
 */
import { Module, forwardRef, OnModuleInit } from "@nestjs/common";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { AiEngineModule } from "../../../ai-engine/ai-engine.module";
import { AIFacade } from "@/modules/ai-harness/facade";
import { CreditsModule } from "../../../platform/credits/credits.module";

import { DiscussionResearchService } from "./discussion-research.service";
import { ResearchPlannerService } from "./research-planner.service";
import { IterativeSearchService } from "./iterative-search.service";
import { SelfReflectionService } from "./self-reflection.service";
import { ReportSynthesizerService } from "./report-synthesizer.service";
import { DiscussionAgentService } from "./discussion-agent.service";
import { DiscussionOrchestratorService } from "./discussion-orchestrator.service";
import { DiscussionSessionService } from "./discussion-session.service";
import { DiscussionStreamService } from "./discussion-stream.service";
import { DiscussionPhaseCoordinatorService } from "./discussion-phase-coordinator.service";
import { ResearchIdeaService } from "../idea/research-idea.service";
import { ResearchReplannerService } from "./research-replanner.service";
import { ResearchToolRouterService } from "../search/research-tool-router.service";
import { ResearchQualityGateService } from "../quality/research-quality-gate.service";
import { ResearchFactCheckerService } from "../quality/research-fact-checker.service";
import { ResearchContentScorerService } from "../quality/research-content-scorer.service";
import { ResearchCritiqueService } from "../quality/research-critique.service";

const services = [
  DiscussionResearchService,
  ResearchPlannerService,
  IterativeSearchService,
  SelfReflectionService,
  ReportSynthesizerService,
  DiscussionAgentService,
  DiscussionSessionService,
  DiscussionStreamService,
  DiscussionPhaseCoordinatorService,
  DiscussionOrchestratorService,
  ResearchIdeaService,
  ResearchReplannerService,
  ResearchToolRouterService,
  ResearchQualityGateService,
  ResearchFactCheckerService,
  ResearchContentScorerService,
  ResearchCritiqueService,
];

@Module({
  imports: [PrismaModule, forwardRef(() => AiEngineModule), CreditsModule],
  controllers: [],
  providers: services,
  exports: services,
})
export class DiscussionModule implements OnModuleInit {
  constructor(
    private readonly aiFacade: AIFacade,
    private readonly researchService: DiscussionResearchService,
  ) {}

  onModuleInit() {
    this.aiFacade.registerResearchExecutor(this.researchService);
  }
}
