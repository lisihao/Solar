/**
 * Writing pipeline stages — barrel export
 *
 * Consumers (dispatcher / orchestrator) import stage functions from here
 * rather than reaching into individual stage files.
 */

export { runBudgetEvalStage } from "./s1-mission-budget-eval.stage";
export { runWorldBuildStage } from "./s2-world-build.stage";
export { runOutlinePlanStage } from "./s3-outline-plan.stage";
export { runChapterFanoutStage } from "./s4-chapter-fanout.stage";
export { runConsistencyCheckStage } from "./s5-consistency-check.stage";
export { runEditPolishStage } from "./s6-edit-polish.stage";
export { runQualityEvaluateStage } from "./s7-quality-evaluate.stage";
export { runMissionPersistStage } from "./s8-mission-persist.stage";
