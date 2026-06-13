/**
 * AI Engine - LLM Model Selection
 *
 * 2026-05-01 (PR-X-Q): 整合 election + recommendations + model-fallback 三个原本
 * 分散的"选哪个 model"语义到本目录。
 */

export { ModelElectionService } from "./model-election.service";
// MissionElectionTracker + MissionElectionReservation relocated to
// ai-harness/guardrails/runtime/mission-election-tracker.service (2026-06-02 P0-1).
export type {
  ElectionRoleHint,
  ElectionCostBias,
  ElectionCandidate,
  ElectionRequest,
  ElectionScore,
  ElectionResult,
} from "./model-election.types";
export { NoEligibleModelError } from "./model-election.types";

export { ModelRecommendationsService } from "./model-recommendations.service";
export type { ResolvedRecommendation } from "./model-recommendations.service";
export {
  MODEL_TYPE_ALIASES,
  PROVIDER_PREFERENCE_BY_TYPE,
  EXCLUDED_MODEL_SUBSTRINGS,
  DEFAULT_RECOMMENDATIONS,
} from "./default-recommendations.config";
export type {
  DefaultRecommendation,
  ModelTypeAlias,
} from "./default-recommendations.config";

export { ModelFallbackService } from "./model-fallback.service";
export type {
  ModelFallbackOptions,
  ModelFallbackResult,
  ModelPriorityConfig,
} from "./model-fallback.service";
