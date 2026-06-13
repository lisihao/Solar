/**
 * deep-insight runner 的依赖出入口（集中 re-export，保持 runner 顶部 import 清爽）。
 *
 * W2（2026-06-09 能力即产品）：runner.run 改为 orchestrator + recipe 跑真 14 步，
 * 故除 AgentRunner（共享 agent 引擎）外，补 MissionPipelineOrchestrator /
 * MissionPipelineRegistry / CrossStageState / InMemoryMissionStore / StageRunArgs
 * 等 harness 编排原语 re-export（全部来自 ai-harness/facade，单向不穿透）。
 */
export {
  AgentRunner,
  ChatFacade,
  MissionPipelineOrchestrator,
  MissionPipelineRegistry,
  CrossStageState,
  InMemoryMissionStore,
  defineMissionPipeline,
  type IAgentEvent,
  type StageRunArgs,
  type MissionPipelineConfig,
  type PipelineMissionEvent,
  type PipelineMissionResult,
  type RunPipelineArgs,
} from "@/modules/ai-harness/facade";
// ★ W2.5（富增强到 playground 等价）：harness 评判 / 富组装原语（全 @Global HarnessModule
//   导出，runner 构造函数注入即可，无需 marketplace.module 额外 provider）。
export {
  ReportArtifactAssembler,
  SectionSelfEvalService,
  SectionRemediationService,
  ReportEvaluationService,
  QualityTraceComputeService,
  type ReportArtifact,
  type ChapterInput,
  type EvaluationResult,
  type RemediationAction,
  type SectionSelfEvalResult,
  type QualityTraceContext,
  type QualityTrace,
} from "@/modules/ai-harness/facade";
// ★ S12 自进化 postlude：postmortem 分类（harness 共享，全 @Global HarnessModule）。
export { PostmortemClassifierService } from "@/modules/ai-harness/facade";
// ★ figure re-home（2026-06-09）：FigureRelevance Stage-3 相关性精排（embedding）。
//   归位到 ai-engine/content/figure（零 app/harness 依赖），能力家经 ai-engine/facade 注入
//   （R1-safe，单向不穿透）。s8 reportArtifactAssembler 前对 figureCandidates 精排，
//   与 playground s3 的 filterRelevantFigures 等价。
//   注意：facade 导出 FigureRelevanceService + ExtractedFigure 由主 Agent 补（见交付清单）；
//   本 re-export 先按「假设 facade 已导出」落位。
export {
  FigureRelevanceService,
  type ExtractedFigure,
} from "@/modules/ai-engine/facade";
export { AIModelType } from "@prisma/client";
export {
  CapabilityRegistry,
  type CapabilityManifest,
  type ICapabilityRunner,
  type CapabilityRunInput,
  type CapabilityRunContext,
  type CapabilityRunResult,
} from "../../capability";
export type {
  MissionPersistencePort,
  MissionTerminalDetails,
} from "../../capability/capability-runner.port";
