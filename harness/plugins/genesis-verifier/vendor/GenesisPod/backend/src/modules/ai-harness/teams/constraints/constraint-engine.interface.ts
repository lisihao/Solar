/**
 * AI Engine - Constraint Engine Interface
 * 约束引擎接口定义
 *
 * W5: 接口源头已移到 guardrails/constraints/constraint-engine.interface（与实现同居）。
 * 此文件仅保留 re-export 兼容层，不含业务逻辑。
 */

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
} from "@/modules/ai-harness/guardrails/constraints/constraint-engine.interface";
