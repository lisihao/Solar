/**
 * AI Research Module - 研究模块
 *
 * 子模块:
 * - Discussion: 讨论驱动研究引擎 (SSE 编排、Agent、搜索、报告合成)
 * - Project: 研究项目管理 (CRUD、Sources、Chat、Notes、Outputs)
 * - Idea: 研究创意管理
 * - Demo: 研究演示管理
 * - Iteration: 自迭代研究 (外层循环编排)
 * - Evaluation: Demo 评估 (DOM分析 + LLM评审)
 * - Memory: 研究记忆 (跨会话经验积累)
 */
import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { DiscussionModule } from "./discussion/discussion.module";
import { ResearchProjectModule } from "./project/research-project.module";
import {
  PromptSkillBridge,
  TeamRegistry,
  AgentRegistry,
  RoleRegistry,
} from "@/modules/ai-harness/facade";
import { SkillLoaderService } from "@/modules/ai-engine/facade";
import { ResearcherAgent } from "./agents";
import { RESEARCH_TEAM_CONFIG, RESEARCH_LEAD_ROLE_CONFIG } from "./teams";
import { ResearchIdeaService } from "./idea/research-idea.service";
import { ResearchIdeaController } from "./idea/research-idea.controller";
import { ResearchDemoService } from "./demo/research-demo.service";
import { ResearchDemoController } from "./demo/research-demo.controller";
import { ResearchController } from "./research-template.controller";
import { ResearchTemplateService } from "./services/research-template.service";
import { ResearchProjectExportService } from "./services/research-project-export.service";
import { ResearchProjectExportAdapter } from "./services/research-project-export.adapter";
import { RESEARCH_PROJECT_DATA_EXPORT } from "../contracts/interfaces/data-export.interface";
// Iterative research services
import {
  TopicClassifierService,
  DemoEvaluatorService,
  ExitDecisionService,
} from "./evaluation";
import {
  IterationRecordService,
  IterationFeedbackService,
  IterationEvaluatorService,
  IterationCoordinatorService,
  IterativeResearchService,
} from "./iteration";
import { ResearchMemoryService } from "./memory/research-memory.service";
import { StrategyLoaderService } from "./memory/strategy-loader.service";
import { DiscussionController } from "./discussion/discussion.controller";
import { ResearchContentSourceProvider } from "./integrations/research-content-source.provider";

@Module({
  imports: [DiscussionModule, ResearchProjectModule],
  controllers: [
    DiscussionController,
    ResearchIdeaController,
    ResearchDemoController,
    ResearchController, // /admin/research/templates/* (sunk from open-api/admin/research, T3)
  ],
  providers: [
    ResearcherAgent,
    ResearchTemplateService, // backs ResearchController (T3 sink)
    ResearchIdeaService,
    ResearchDemoService,
    ResearchProjectExportService,
    ResearchProjectExportAdapter,
    {
      provide: RESEARCH_PROJECT_DATA_EXPORT,
      useExisting: ResearchProjectExportAdapter,
    },
    // Iterative research
    TopicClassifierService,
    DemoEvaluatorService,
    ExitDecisionService,
    IterationRecordService,
    IterationFeedbackService,
    IterationEvaluatorService,
    IterationCoordinatorService,
    IterativeResearchService,
    ResearchMemoryService,
    StrategyLoaderService,
    // Generic ContentSource — auto-discovered by engine ContentSourceRegistry
    ResearchContentSourceProvider,
  ],
  exports: [
    DiscussionModule,
    ResearchProjectModule,
    ResearcherAgent,
    ResearchIdeaService,
    ResearchDemoService,
    ResearchProjectExportService,
    RESEARCH_PROJECT_DATA_EXPORT,
    IterativeResearchService,
  ],
})
export class ResearchModule implements OnModuleInit {
  private readonly logger = new Logger(ResearchModule.name);

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly teamRegistry: TeamRegistry,
    private readonly roleRegistry: RoleRegistry,
    private readonly researcherAgent: ResearcherAgent,
    private readonly promptSkillBridge: PromptSkillBridge,
    // R0-A5: 注册 research skills 目录到 engine SkillLoader
    private readonly skillLoader: SkillLoaderService,
  ) {}

  async onModuleInit() {
    // R0-A5 (2026-05-04): 注册 research skill 目录
    const path = await import("path");
    await this.skillLoader.addSkillDirectory({
      path: path.resolve(__dirname, "skills"),
      domain: "research",
      recursive: false,
    });

    this.agentRegistry.register(this.researcherAgent);
    // v3 R0-A1-d: 业务 leader 角色由 ai-app 自身注册（base layer 不再硬编码业务名）
    this.roleRegistry.registerFromConfig(RESEARCH_LEAD_ROLE_CONFIG);
    this.teamRegistry.registerConfig(RESEARCH_TEAM_CONFIG);

    try {
      const result = await this.promptSkillBridge.registerDomain("research");
      this.logger.log(
        `Registered research skill domain: ${result.registered.length} skills loaded`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to register research skill domain: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.logger.log("Registered ResearcherAgent and RESEARCH_TEAM_CONFIG");
  }
}
