/**
 * Topic Research Services
 *
 * 导出所有研究相关的服务（通过子目录 barrel re-export）
 */

// ==================== Core ====================
// Research
export { ResearchLeaderService } from "./core/research/research-leader.service";
export {
  ResearchEventEmitterService,
  RESEARCH_INTERNAL_EVENTS,
  type ResumeMissionExecutionPayload,
} from "./core/research/research-event-emitter.service";
export { ResearchRealtimeAdapter } from "./core/research/research-realtime.adapter";
export { ResearchStrategyService } from "./core/research/research-strategy.service";
export { ResearchMemoryService } from "./core/research/research-memory.service";
export { ResearchTemplateService } from "./core/research/research-template.service";

// Leader
export { LeaderPlanningService } from "./core/leader/leader-planning.service";
export { LeaderIntentService } from "./core/leader/leader-intent.service";
export { LeaderAgentSelectionService } from "./core/leader/leader-agent-selection.service";
export { LeaderReviewService } from "./core/leader/leader-review.service";

// Mission
export { MissionQueryService } from "./core/mission/mission-query.service";
export { MissionLifecycleService } from "./core/mission/mission-lifecycle.service";
export { MissionExecutionService } from "./core/mission/mission-execution.service";
export { MissionObservabilityService } from "./core/mission/mission-observability.service";
export { MissionNotificationService } from "./core/mission/mission-notification.service";

// Topic
export { TopicTeamOrchestratorService } from "./core/topic/topic-team-orchestrator.service";
export { TopicCrudService } from "./core/topic/topic-crud.service";
export { EventSourceParsingService } from "./core/topic/event-source-parsing.service";
export { TopicDimensionService } from "./core/topic/topic-dimension.service";
export { TopicExportService } from "./core/topic/topic-export.service";
export { TopicScheduleService } from "./core/topic/topic-schedule.service";

// Task executors
export { DimensionResearchExecutor } from "./core/task-executors/dimension-research.executor";
export { ReviewDimensionExecutor } from "./core/task-executors/review-dimension.executor";
export { SynthesisReportExecutor } from "./core/task-executors/synthesis-report.executor";
export { GenericTaskExecutor } from "./core/task-executors/generic-task.executor";

// ==================== Dimension ====================
export { DimensionMissionService } from "./dimension/dimension-mission.service";
export { DimensionProgressService } from "./dimension/dimension-progress.service";
export { SectionWriterService } from "./dimension/section-writer.service";
export { DimensionSearchService } from "./dimension/dimension-search.service";
export { DimensionWritingService } from "./dimension/dimension-writing.service";

// ==================== Report ====================
export { ReportSynthesisService } from "./report/report-synthesis.service";
export { ReportEditorService } from "./report/report-editor.service";
export { ReportValidationService } from "./report/report-validation.service";
export { ReportChangeService } from "./report/report-change.service";
export { ReportAnnotationService } from "./report/report-annotation.service";
export { CredibilityReportService } from "./report/credibility-report.service";
export { FigureExtractorService } from "./report/figure-extractor.service";
export { FigureRelevanceService } from "./report/figure-relevance.service";
export { ReportGeneratorService } from "./report/report-generator.service";
export { ReportAssemblerService } from "./report/report-assembler.service";
export { ReportDataService } from "./report/report-data.service";
export { LatexRepairService } from "./report/latex-repair.service";
export { CitationFormatterService } from "./report/citation-formatter.service";
export { ResearchExportService } from "./report/research-export.service";

// ==================== Cross-module Data Export ====================
export { TopicInsightsDataExportService } from "./topic-insights-data-export.service";

// ==================== Data ====================
export { DataSourceRouterService } from "./data/data-source-router.service";
export { DataSourcePlannerService } from "./data/data-source-planner.service";
export { DataEnrichmentService } from "./data/data-enrichment.service";
export { EvidenceManagementService } from "./data/evidence-management.service";
export { LeaderToolService } from "./data/leader-tool.service";
export { DataSourceFetcherService } from "./data/data-source-fetcher.service";
export { DataSourceStrategyService } from "./data/data-source-strategy.service";
export { EvidenceSyncCompensationService } from "./data/evidence-sync-compensation.service";
export { DataSourceConnectorRegistry } from "./data/connectors/data-source-connector.registry";
export { SemanticScholarConnector } from "./data/connectors/semantic-scholar.connector";
export { PubMedConnector } from "./data/connectors/pubmed.connector";
export { FinanceApiConnector } from "./data/connectors/finance-api.connector";
export { WeatherApiConnector } from "./data/connectors/weather-api.connector";
export { RAGFusionService } from "./data/rag-fusion.service";
export { TopicInsightsKnowledgeGraphService } from "./data/knowledge-graph.service";
export { MultiLanguageResearchService } from "./data/multi-language-research.service";

// ==================== Collaboration ====================
export { TopicCollaboratorService } from "./collaboration/topic-collaborator.service";
export { ReviewWorkflowService } from "./collaboration/review-workflow.service";
export { ResearchTodoService } from "./collaboration/research-todo.service";
export { ResearchReviewerService } from "./collaboration/research-reviewer.service";
export { ResearchReflectionService } from "./collaboration/research-reflection.service";

// ==================== Quality ====================
export { CritiqueRefineService } from "./quality/critique-refine.service";
export { ReportQualityGateService } from "./quality/report-quality-gate.service";
export { ReportQualityTraceService } from "./quality/report-quality-trace.service";
export { ReportEvaluationService } from "./quality/report-evaluation.service";
export { SectionSelfEvalService } from "./quality/section-self-eval.service";
export { SectionRemediationService } from "./quality/section-remediation.service";

// ==================== Monitoring ====================
export { AgentActivityService } from "./monitoring/agent-activity.service";
export { ResearchMissionHealthService } from "./monitoring/research-mission-health.service";
export { ResearchCheckpointService } from "./monitoring/research-checkpoint.service";
export { TopicRefreshScheduler } from "./monitoring/topic-refresh.scheduler";

// ==================== Search Pipeline ====================
export {
  SearchOrchestratorService,
  GlobalSourceThrottleService,
  SearchExecutorService,
  QueryStrategyService,
  ResultFusionService,
  SearchFusionQualityGateService,
  LlmRerankerAdapter,
  WebSearchAdapter,
  AcademicSearchAdapter,
  GithubSearchAdapter,
  HackernewsSearchAdapter,
  SocialSearchAdapter,
  PolicySearchAdapter,
  FinanceSearchAdapter,
  WeatherSearchAdapter,
  LocalSearchAdapter,
  IndustryReportSearchAdapter,
} from "./search";
