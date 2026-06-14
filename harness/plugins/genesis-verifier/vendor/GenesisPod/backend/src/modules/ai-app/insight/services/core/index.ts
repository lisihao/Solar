// ★ Research sub-services
export { ResearchLeaderService } from "./research/research-leader.service";
export {
  ResearchEventEmitterService,
  RESEARCH_INTERNAL_EVENTS,
} from "./research/research-event-emitter.service";
export type { ResumeMissionExecutionPayload } from "./research/research-event-emitter.service";
export { ResearchStrategyService } from "./research/research-strategy.service";

// ★ Leader sub-services (ResearchLeader decomposition)
export { LeaderPlanningService } from "./leader/leader-planning.service";
export { LeaderIntentService } from "./leader/leader-intent.service";
export { LeaderAgentSelectionService } from "./leader/leader-agent-selection.service";
export { LeaderReviewService } from "./leader/leader-review.service";

// ★ Mission sub-services
export { MissionObservabilityService } from "./mission/mission-observability.service";
export { MissionNotificationService } from "./mission/mission-notification.service";

// ★ Topic sub-services
export { TopicTeamOrchestratorService } from "./topic/topic-team-orchestrator.service";
export { TopicCrudService } from "./topic/topic-crud.service";
export { TopicDimensionService } from "./topic/topic-dimension.service";
export { TopicExportService } from "./topic/topic-export.service";
export { TopicScheduleService } from "./topic/topic-schedule.service";

// ★ Task executors
export { DimensionResearchExecutor } from "./task-executors/dimension-research.executor";
export { ReviewDimensionExecutor } from "./task-executors/review-dimension.executor";
export { SynthesisReportExecutor } from "./task-executors/synthesis-report.executor";
export { GenericTaskExecutor } from "./task-executors/generic-task.executor";
