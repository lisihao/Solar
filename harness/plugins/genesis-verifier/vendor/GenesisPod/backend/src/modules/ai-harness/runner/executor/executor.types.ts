/**
 * AI Harness Execution Interfaces — Re-export Hub
 *
 * 2026-05-01 (PR-X-O): 原 ~1000 行单文件大杂烩拆分为 6 个领域 type 文件 +
 * 4 个 engine-owned 类型文件的 re-export。本文件仅维持既有 import 路径稳定。
 *
 * 拆分映射（按领域）:
 *   ./team.base-member.types        → TeamMemberInfo / TaskDefinition / TaskBreakdownData
 *   ./task-decomposer.types    → DecompositionInput/Result / ITaskDecomposerService
 *   ./agent-executor.types     → ExecutionContext / ExecutionConfig / ExecutionResult
 *                                / IAgentExecutorService
 *   ./output-reviewer.types    → ReviewRequest / ReviewCriteria / ReviewResult
 *                                / RevisionRequest / IOutputReviewerService
 *   ./iteration.types          → OutputSection / StructuredOutput / IterationRequest*
 *                                / IterationResult / ResearchContext / IIterationManagerService
 *   ./constraint-enforcement.types → ConstraintSeverity / ExtractedConstraint
 *                                    / ConstraintViolation / OutputValidationResult
 *                                    / IConstraintEnforcementService
 *
 * 跨层 re-export（engine-owned，PR-X-M / M-step3）:
 *   ai-engine/llm/types/ai-caller.types         → AiCallerFn
 *   ai-engine/llm/intent/intent.types           → UserIntent / ContextStrategy /
 *                                                 IntentDetectionConfig/Result/Service
 *   ai-engine/knowledge/extraction/...types     → ContextEvolutionConfig / EstablishedFact /
 *                                                 ContextState / FactExtraction* / IContextEvolutionService
 *   ai-engine/knowledge/world-building/...types → WorldSettings* / ContentType /
 *                                                 HardConstraint / CoreEntity /
 *                                                 WorldBuildingResult / IContextInitializationService
 *   ai-engine/llm/context/context-compression.types → DataChunk / SummaryChunk /
 *                                                     CompressionResult/Options / IContextCompressionService
 *
 * 新代码请直接 import 自源文件；本 hub 仅为向后兼容。
 */

// ─── 通用类型（同 module 内）─────────────────────────────────────────────
export * from "./team-member.types";
export * from "./task-decomposer.types";
export * from "./agent-executor.types";
export * from "./output-reviewer.types";
export * from "./iteration.types";
export * from "./constraint-enforcement.types";

// ─── 跨层 re-export（engine 自有类型）────────────────────────────────────
export type { AiCallerFn } from "../../../ai-engine/llm/types/ai-caller.types";

export {
  UserIntent,
  ContextStrategy,
} from "../../../ai-engine/planning/intent/intent.types";
export type {
  IntentDetectionConfig,
  IntentDetectionResult,
  IIntentDetectionService,
} from "../../../ai-engine/planning/intent/intent.types";

export {
  DEFAULT_CONTEXT_EVOLUTION_CONFIG,
  FACT_CATEGORIES,
  FACT_IMPORTANCE_LEVELS,
} from "../../../ai-engine/knowledge/extraction/context-evolution.types";
export type {
  ContextEvolutionConfig,
  EstablishedFact,
  ContextState,
  FactExtractionRequest,
  FactExtractionResult,
  IContextEvolutionService,
} from "../../../ai-engine/knowledge/extraction/context-evolution.types";

export type {
  WorldSettingsEra,
  WorldSettingsCharacter,
  WorldSettingsFaction,
  WorldSettings,
  ContentType,
  HardConstraint,
  CoreEntity,
  WorldBuildingResult,
  IContextInitializationService,
} from "../../../ai-engine/knowledge/world-building/world-building.types";

export type {
  DataChunk,
  SummaryChunk,
  CompressionResult,
  CompressionOptions,
  IContextCompressionService,
} from "../../../ai-engine/planning/context/context-compression.types";

