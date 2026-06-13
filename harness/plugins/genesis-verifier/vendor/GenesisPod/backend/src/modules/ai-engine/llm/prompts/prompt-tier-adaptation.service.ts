import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

import { classifyModelTier, ModelTier } from "../types/model-tier.types";

import { TIER_SUFFIX_DEFAULTS } from "./tier-suffix-defaults.config";
import type { TierSuffix } from "./types";

export const TIER_SUFFIX_SEED = Symbol("TIER_SUFFIX_SEED");

/** Env flag controlling whether adaptation is applied. Default: off. */
export const TIER_ADAPT_ENABLED_ENV = "PROMPT_TIER_ADAPT_ENABLED";

/**
 * PromptTierAdaptationService (L2, cross-cutting)
 *
 * Appends a small tier-specific suffix to a system prompt so weaker models get
 * firmer constraints. Disabled by default; flip `PROMPT_TIER_ADAPT_ENABLED=1`
 * to turn on. Consumers call `.adapt(prompt, modelId)` — it is a no-op when
 * disabled or when the model resolves to STRONG.
 */
@Injectable()
export class PromptTierAdaptationService {
  private readonly logger = new Logger(PromptTierAdaptationService.name);
  private readonly suffixByTier: Map<ModelTier, string>;
  private readonly enabled: boolean;

  constructor(
    @Optional()
    @Inject(TIER_SUFFIX_SEED)
    seed?: readonly TierSuffix[],
  ) {
    const source = seed ?? TIER_SUFFIX_DEFAULTS;
    this.suffixByTier = new Map(source.map((s) => [s.tier, s.suffix]));
    this.enabled = process.env[TIER_ADAPT_ENABLED_ENV] === "1";
    if (this.enabled) {
      this.logger.log(
        `Enabled; ${this.suffixByTier.size} tier suffixes registered`,
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Raw suffix lookup by tier. Returns empty string for unknown / STRONG. */
  getSuffix(tier: ModelTier): string {
    return this.suffixByTier.get(tier) ?? "";
  }

  /**
   * Append the tier-specific suffix for `modelId` to `prompt`. When disabled
   * or no suffix is configured, returns the prompt unchanged (reference
   * equality preserved in that path).
   */
  adapt(prompt: string, modelId: string): string {
    if (!this.enabled) return prompt;
    const tier = classifyModelTier(modelId);
    const suffix = this.getSuffix(tier);
    if (!suffix) return prompt;
    return prompt + suffix;
  }
}
