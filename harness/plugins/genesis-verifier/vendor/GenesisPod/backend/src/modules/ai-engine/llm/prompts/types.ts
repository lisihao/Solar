/**
 * Prompt tier-adaptation types (L2 cross-cutting).
 *
 * Goal: pick a small, tier-aware suffix to append to agent system prompts so
 * cheaper / weaker models get firmer constraints while strong models keep more
 * freedom. This restores behaviour deleted with `prompt-adaptation.config.ts`
 * (H6 step 11).
 */

import type { ModelTier } from "../types/model-tier.types";

export interface TierSuffix {
  readonly tier: ModelTier;
  /** Suffix appended to the system prompt for this tier. Empty = no-op. */
  readonly suffix: string;
}
