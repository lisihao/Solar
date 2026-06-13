/**
 * AI Harness - Mission Execution Profile
 * 团队任务执行配置文件定义
 *
 * W5: 去重 — 规范版本在 guardrails/constraints/constraint-profile，
 * 此文件仅保留 re-export 兼容层，不含业务逻辑。
 *
 * R9: 与 guardrails 的 ConstraintProfile 撞名，teams 侧统一改名为
 * MissionExecutionProfile（语义不变，底层仍复用 guardrails 规范定义）。
 */

export type {
  CostConstraint,
  ModelPreference,
  QualityConstraint,
  QualityDepth,
  AccuracyRequirement,
  EfficiencyConstraint,
  Priority,
  ConstraintProfile as MissionExecutionProfile,
  ConstraintPreset,
} from "@/modules/ai-harness/guardrails/constraints/constraint-profile";

export {
  CONSTRAINT_PRESETS,
  createConstraintProfile,
  getDefaultConstraintProfile,
  mergeConstraintProfiles,
} from "@/modules/ai-harness/guardrails/constraints/constraint-profile";
