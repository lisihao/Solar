import { Test } from "@nestjs/testing";

import { ModelTier } from "../../types/model-tier.types";
import {
  PromptTierAdaptationService,
  TIER_ADAPT_ENABLED_ENV,
  TIER_SUFFIX_SEED,
} from "../prompt-tier-adaptation.service";
import type { TierSuffix } from "../types";

const BASE_PROMPT = "你是研究员。输出 JSON。";

function stubSeed(): readonly TierSuffix[] {
  return [
    { tier: ModelTier.STRONG, suffix: "" },
    { tier: ModelTier.STANDARD, suffix: "\nSTANDARD-SUFFIX" },
    { tier: ModelTier.BASIC, suffix: "\nBASIC-SUFFIX" },
  ];
}

async function buildService(opts: {
  enabled: boolean;
  seed?: readonly TierSuffix[];
}): Promise<PromptTierAdaptationService> {
  if (opts.enabled) {
    process.env[TIER_ADAPT_ENABLED_ENV] = "1";
  } else {
    delete process.env[TIER_ADAPT_ENABLED_ENV];
  }
  const providers: Array<unknown> = [PromptTierAdaptationService];
  if (opts.seed) {
    providers.push({ provide: TIER_SUFFIX_SEED, useValue: opts.seed });
  }
  const mod = await Test.createTestingModule({
    providers: providers as never,
  }).compile();
  return mod.get(PromptTierAdaptationService);
}

describe("PromptTierAdaptationService", () => {
  afterEach(() => {
    delete process.env[TIER_ADAPT_ENABLED_ENV];
  });

  describe("feature flag", () => {
    it("defaults to disabled", async () => {
      const svc = await buildService({ enabled: false });
      expect(svc.isEnabled()).toBe(false);
    });

    it("enables when PROMPT_TIER_ADAPT_ENABLED=1", async () => {
      const svc = await buildService({ enabled: true });
      expect(svc.isEnabled()).toBe(true);
    });
  });

  describe("adapt", () => {
    it("returns prompt unchanged when disabled", async () => {
      const svc = await buildService({ enabled: false, seed: stubSeed() });
      expect(svc.adapt(BASE_PROMPT, "gpt-4.1-nano")).toBe(BASE_PROMPT);
    });

    it("appends STANDARD suffix for STANDARD tier when enabled", async () => {
      const svc = await buildService({ enabled: true, seed: stubSeed() });
      const out = svc.adapt(BASE_PROMPT, "gpt-4o-mini");
      expect(out).toBe(`${BASE_PROMPT}\nSTANDARD-SUFFIX`);
    });

    it("appends BASIC suffix for BASIC tier when enabled", async () => {
      const svc = await buildService({ enabled: true, seed: stubSeed() });
      const out = svc.adapt(BASE_PROMPT, "gpt-4.1-nano");
      expect(out).toBe(`${BASE_PROMPT}\nBASIC-SUFFIX`);
    });

    it("no-ops for STRONG tier (empty suffix)", async () => {
      const svc = await buildService({ enabled: true, seed: stubSeed() });
      const out = svc.adapt(BASE_PROMPT, "gpt-4o");
      expect(out).toBe(BASE_PROMPT);
    });

    it("no-ops on unknown model (falls back to BASIC but only if configured)", async () => {
      const svc = await buildService({
        enabled: true,
        seed: [
          { tier: ModelTier.STRONG, suffix: "" },
          { tier: ModelTier.STANDARD, suffix: "" },
          { tier: ModelTier.BASIC, suffix: "" },
        ],
      });
      expect(svc.adapt(BASE_PROMPT, "unknown-model")).toBe(BASE_PROMPT);
    });
  });

  describe("built-in TIER_SUFFIX_DEFAULTS", () => {
    it("applies real defaults when no seed is injected", async () => {
      const svc = await buildService({ enabled: true });
      const basic = svc.adapt(BASE_PROMPT, "gpt-4.1-nano");
      expect(basic).not.toBe(BASE_PROMPT);
      expect(basic).toContain("BASIC tier");

      const strong = svc.adapt(BASE_PROMPT, "gpt-4o");
      expect(strong).toBe(BASE_PROMPT);
    });
  });
});
