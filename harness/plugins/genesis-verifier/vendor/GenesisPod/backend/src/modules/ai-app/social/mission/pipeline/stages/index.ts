/**
 * 13 stage adapters barrel for social SocialPublishMission.
 *
 * Each adapter is an exported async function: runXxxStage(ctx, deps): Promise<void>
 *   reads from ctx, calls role service, writes back to ctx, emits narrative.
 *
 * Pipeline order:
 *   s1 budget-eval → s2 platform-probe → s3 content-transform → s4 leader-assess →
 *   s5 cover-craft → s6 body-compose → s7 polish-review → s8 publish-execute →
 *   s8b publish-retry → s9 publish-verify → s10 leader-signoff → s11 mission-persist
 *   s12 self-evolution (postlude, fire-and-forget, 非 pipeline.steps)
 */
export { runMissionBudgetEvalStage } from "./s1-mission-budget-eval.stage";
export { runPlatformProbeStage } from "./s2-platform-probe.stage";
export { runContentTransformStage } from "./s3-content-transform.stage";
export { runLeaderAssessTransformStage } from "./s4-leader-assess-transform.stage";
export { runCoverCraftStage } from "./s5-cover-craft.stage";
export { runBodyComposeStage } from "./s6-body-compose.stage";
export { runPolishReviewStage } from "./s7-polish-review.stage";
export { runPublishExecuteStage } from "./s8-publish-execute.stage";
export { runPublishRetryStage } from "./s8b-publish-retry.stage";
export { runPublishVerifyStage } from "./s9-publish-verify.stage";
export { runLeaderSignoffStage } from "./s10-leader-signoff.stage";
export { runMissionPersistStage } from "./s11-mission-persist.stage";
export { runSelfEvolutionStage } from "./s12-self-evolution.stage";
