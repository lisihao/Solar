/**
 * AI Engine - Teams Constraints
 * 约束配置导出
 */

// Mission Execution Profile (R9: moved out of constraints/, renamed from ConstraintProfile)
export type {
  CostConstraint,
  ModelPreference,
  QualityConstraint,
  QualityDepth,
  AccuracyRequirement,
  EfficiencyConstraint,
  Priority,
  MissionExecutionProfile,
  ConstraintPreset,
} from "../profile/mission-execution-profile";
export {
  CONSTRAINT_PRESETS,
  createConstraintProfile,
  getDefaultConstraintProfile,
  mergeConstraintProfiles,
} from "../profile/mission-execution-profile";

// Constraint Engine Interface
export type {
  IConstraintEngine,
  ConstraintEvaluation,
  CostEvaluation,
  QualityEvaluation,
  EfficiencyEvaluation,
  ConstraintWarning,
  ConstraintViolation,
  ConstraintSuggestion,
  ResourceRequirement,
  ResourceAllocation,
  ResourceUsage,
  CostEstimate,
  CostBreakdown,
  DegradationStrategy,
} from "./constraint-engine.interface";

// Constraint Engine Implementation - owned by ai-harness/guardrails
// export { ConstraintEngine } from "./constraint-engine";
