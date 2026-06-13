/**
 * Mission Execution Profile Utility Tests
 *
 * Covers:
 * 1. CONSTRAINT_PRESETS – shape and values
 * 2. createConstraintProfile – preset + overrides
 * 3. getDefaultConstraintProfile – 'balanced' preset
 * 4. mergeConstraintProfiles – deep merging
 */

import {
  CONSTRAINT_PRESETS,
  createConstraintProfile,
  getDefaultConstraintProfile,
  mergeConstraintProfiles,
  MissionExecutionProfile,
} from "../mission-execution-profile";

describe("mission-execution-profile utilities", () => {
  // ============================================================
  // CONSTRAINT_PRESETS
  // ============================================================

  describe("CONSTRAINT_PRESETS", () => {
    it("should have fast, balanced, and thorough presets", () => {
      expect(CONSTRAINT_PRESETS.fast).toBeDefined();
      expect(CONSTRAINT_PRESETS.balanced).toBeDefined();
      expect(CONSTRAINT_PRESETS.thorough).toBeDefined();
    });

    describe("fast preset", () => {
      const fast = CONSTRAINT_PRESETS.fast;

      it("should use 'cheap' model preference", () => {
        expect(fast.cost.modelPreference).toBe("cheap");
      });

      it("should have reviewRequired = false", () => {
        expect(fast.quality.reviewRequired).toBe(false);
      });

      it("should have maxReworks = 0", () => {
        expect(fast.quality.maxReworks).toBe(0);
      });

      it("should have maxDuration of 5 minutes", () => {
        expect(fast.efficiency.maxDuration).toBe(5 * 60 * 1000);
      });

      it("should have urgent priority", () => {
        expect(fast.efficiency.priority).toBe("urgent");
      });

      it("should allow parallel execution", () => {
        expect(fast.efficiency.allowParallel).toBe(true);
      });

      it("should have maxParallelism = 5", () => {
        expect(fast.efficiency.maxParallelism).toBe(5);
      });

      it("should not allow over budget", () => {
        expect(fast.cost.allowOverBudget).toBe(false);
      });
    });

    describe("balanced preset", () => {
      const balanced = CONSTRAINT_PRESETS.balanced;

      it("should use 'balanced' model preference", () => {
        expect(balanced.cost.modelPreference).toBe("balanced");
      });

      it("should have reviewRequired = true", () => {
        expect(balanced.quality.reviewRequired).toBe(true);
      });

      it("should have maxReworks = 2", () => {
        expect(balanced.quality.maxReworks).toBe(2);
      });

      it("should have minReviewScore = 7", () => {
        expect(balanced.quality.minReviewScore).toBe(7);
      });

      it("should have maxDuration of 30 minutes", () => {
        expect(balanced.efficiency.maxDuration).toBe(30 * 60 * 1000);
      });

      it("should have normal priority", () => {
        expect(balanced.efficiency.priority).toBe("normal");
      });

      it("should have maxParallelism = 3", () => {
        expect(balanced.efficiency.maxParallelism).toBe(3);
      });
    });

    describe("thorough preset", () => {
      const thorough = CONSTRAINT_PRESETS.thorough;

      it("should use 'premium' model preference", () => {
        expect(thorough.cost.modelPreference).toBe("premium");
      });

      it("should allow over budget", () => {
        expect(thorough.cost.allowOverBudget).toBe(true);
      });

      it("should have maxReworks = 3", () => {
        expect(thorough.quality.maxReworks).toBe(3);
      });

      it("should require evidence accuracy", () => {
        expect(thorough.quality.accuracy).toBe("require_evidence");
      });

      it("should have minReviewScore = 8", () => {
        expect(thorough.quality.minReviewScore).toBe(8);
      });

      it("should have maxDuration of 4 hours", () => {
        expect(thorough.efficiency.maxDuration).toBe(4 * 60 * 60 * 1000);
      });

      it("should have maxParallelism = 2", () => {
        expect(thorough.efficiency.maxParallelism).toBe(2);
      });

      it("should have comprehensive depth", () => {
        expect(thorough.quality.depth).toBe("comprehensive");
      });
    });
  });

  // ============================================================
  // createConstraintProfile
  // ============================================================

  describe("createConstraintProfile", () => {
    it("should create a profile from 'fast' preset", () => {
      const profile = createConstraintProfile("fast");
      expect(profile.preset).toBe("fast");
      expect(profile.cost.modelPreference).toBe("cheap");
    });

    it("should create a profile from 'balanced' preset", () => {
      const profile = createConstraintProfile("balanced");
      expect(profile.preset).toBe("balanced");
      expect(profile.quality.depth).toBe("standard");
    });

    it("should create a profile from 'thorough' preset", () => {
      const profile = createConstraintProfile("thorough");
      expect(profile.preset).toBe("thorough");
      expect(profile.quality.depth).toBe("comprehensive");
    });

    it("should apply top-level overrides", () => {
      const profile = createConstraintProfile("fast", {
        metadata: { source: "test" },
      });
      expect(profile.metadata?.source).toBe("test");
    });

    it("should deep-merge cost overrides", () => {
      const profile = createConstraintProfile("fast", {
        cost: { budget: 999 },
      });
      expect(profile.cost.budget).toBe(999);
      // Other cost fields from fast preset should be preserved
      expect(profile.cost.modelPreference).toBe("cheap");
    });

    it("should deep-merge quality overrides", () => {
      const profile = createConstraintProfile("balanced", {
        quality: { maxReworks: 5 },
      });
      expect(profile.quality.maxReworks).toBe(5);
      // Other quality fields from balanced preset preserved
      expect(profile.quality.reviewRequired).toBe(true);
    });

    it("should deep-merge efficiency overrides", () => {
      const profile = createConstraintProfile("balanced", {
        efficiency: { maxDuration: 60000 },
      });
      expect(profile.efficiency.maxDuration).toBe(60000);
      expect(profile.efficiency.priority).toBe("normal");
    });
  });

  // ============================================================
  // getDefaultConstraintProfile
  // ============================================================

  describe("getDefaultConstraintProfile", () => {
    it("should return the 'balanced' preset profile", () => {
      const profile = getDefaultConstraintProfile();
      expect(profile.preset).toBe("balanced");
    });

    it("should have all required fields", () => {
      const profile = getDefaultConstraintProfile();
      expect(profile.cost).toBeDefined();
      expect(profile.quality).toBeDefined();
      expect(profile.efficiency).toBeDefined();
    });

    it("should have reviewRequired = true", () => {
      const profile = getDefaultConstraintProfile();
      expect(profile.quality.reviewRequired).toBe(true);
    });

    it("should return a new object each call (no shared reference)", () => {
      const p1 = getDefaultConstraintProfile();
      const p2 = getDefaultConstraintProfile();
      p1.cost.budget = 99999;
      expect(p2.cost.budget).not.toBe(99999);
    });
  });

  // ============================================================
  // mergeConstraintProfiles
  // ============================================================

  describe("mergeConstraintProfiles", () => {
    const base: MissionExecutionProfile = {
      cost: {
        budget: 500,
        modelPreference: "balanced",
        allowOverBudget: false,
        warningThreshold: 0.7,
      },
      quality: {
        depth: "standard",
        accuracy: "prefer_evidence",
        reviewRequired: true,
        minReviewScore: 7,
        maxReworks: 2,
      },
      efficiency: {
        maxDuration: 30 * 60 * 1000,
        priority: "normal",
        allowParallel: true,
        maxParallelism: 3,
      },
      preset: "balanced",
    };

    it("should return base profile unchanged when no overrides", () => {
      const merged = mergeConstraintProfiles(base, {});
      expect(merged.cost.budget).toBe(500);
      expect(merged.quality.depth).toBe("standard");
    });

    it("should override cost fields", () => {
      const merged = mergeConstraintProfiles(base, {
        cost: { budget: 1000 },
      });
      expect(merged.cost.budget).toBe(1000);
      expect(merged.cost.modelPreference).toBe("balanced"); // preserved
    });

    it("should override quality fields", () => {
      const merged = mergeConstraintProfiles(base, {
        quality: { maxReworks: 0, reviewRequired: false },
      });
      expect(merged.quality.maxReworks).toBe(0);
      expect(merged.quality.reviewRequired).toBe(false);
      expect(merged.quality.minReviewScore).toBe(7); // preserved
    });

    it("should override efficiency fields", () => {
      const merged = mergeConstraintProfiles(base, {
        efficiency: { maxDuration: 10000, priority: "urgent" },
      });
      expect(merged.efficiency.maxDuration).toBe(10000);
      expect(merged.efficiency.priority).toBe("urgent");
      expect(merged.efficiency.allowParallel).toBe(true); // preserved
    });

    it("should override preset", () => {
      const merged = mergeConstraintProfiles(base, { preset: "thorough" });
      expect(merged.preset).toBe("thorough");
    });

    it("should not mutate the base profile", () => {
      mergeConstraintProfiles(base, { cost: { budget: 99999 } });
      expect(base.cost.budget).toBe(500);
    });

    it("should support adding metadata", () => {
      const merged = mergeConstraintProfiles(base, {
        metadata: { userId: "user-1" },
      });
      expect(merged.metadata?.userId).toBe("user-1");
    });

    it("should handle merging with all three dimension overrides simultaneously", () => {
      const merged = mergeConstraintProfiles(base, {
        cost: { budget: 2000, modelPreference: "premium" },
        quality: { depth: "comprehensive", maxReworks: 3 },
        efficiency: { priority: "high", maxParallelism: 5 },
      });
      expect(merged.cost.budget).toBe(2000);
      expect(merged.cost.modelPreference).toBe("premium");
      expect(merged.quality.depth).toBe("comprehensive");
      expect(merged.quality.maxReworks).toBe(3);
      expect(merged.efficiency.priority).toBe("high");
      expect(merged.efficiency.maxParallelism).toBe(5);
    });
  });
});
