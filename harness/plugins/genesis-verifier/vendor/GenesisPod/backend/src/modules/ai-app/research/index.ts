/**
 * AI Research Module - 导出入口
 *
 * 子模块:
 * - Discussion: 讨论驱动研究引擎
 * - Project: 研究项目管理
 * - Idea: 研究创意管理
 * - Demo: 研究演示管理
 */

// 统一模块
export { ResearchModule } from "./research.module";

// Discussion - 讨论驱动研究引擎
export { DiscussionModule } from "./discussion/discussion.module";
export { DiscussionResearchService } from "./discussion/discussion-research.service";
export { DiscussionController } from "./discussion/discussion.controller";
export { ResearchPlannerService } from "./discussion/research-planner.service";
export { IterativeSearchService } from "./discussion/iterative-search.service";
export { SelfReflectionService } from "./discussion/self-reflection.service";
export { ReportSynthesizerService } from "./discussion/report-synthesizer.service";

// Project - 研究项目管理 (原 AI Studio / Notebook Research)
export { ResearchProjectModule } from "./project/research-project.module";
export { ResearchProjectService } from "./project/research-project.service";
export { ResearchProjectController } from "./project/research-project.controller";
export { ResearchProjectSourceService } from "./project/research-project-source.service";
export { ResearchProjectChatService } from "./project/research-project-chat.service";
export { ResearchProjectOutputService } from "./project/research-project-output.service";
export { ResearchProjectTTSService } from "./project/research-project-tts.service";
