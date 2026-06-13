import {
  CONSTRAINT_PRESETS,
  createConstraintProfile,
  getDefaultConstraintProfile,
  mergeConstraintProfiles,
  ConstraintProfile,
  ConstraintPreset,
} from "../constraints/constraint-profile";

describe("CONSTRAINT_PRESETS", () => {
  it("should define 'fast' preset with cheap model and short duration", () => {
    const fast = CONSTRAINT_PRESETS.fast;
    expect(fast.cost.modelPreference).toBe("cheap");
    expect(fast.cost.budget).toBe(100);
    expect(fast.cost.allowOverBudget).toBe(false);
    expect(fast.quality.depth).toBe("quick");
    expect(fast.quality.reviewRequired).toBe(false);
    expect(fast.quality.maxReworks).toBe(0);
    expect(fast.efficiency.maxDuration).toBe(5 * 60 * 1000);
    expect(fast.efficiency.priority).toBe("urgent");
    expect(fast.efficiency.allowParallel).toBe(true);
    expect(fast.efficiency.maxParallelism).toBe(5);
  });

  it("should define 'balanced' preset with balanced model and moderate duration", () => {
    const balanced = CONSTRAINT_PRESETS.balanced;
    expect(balanced.cost.modelPreference).toBe("balanced");
    expect(balanced.cost.budget).toBe(500);
    expect(balanced.cost.allowOverBudget).toBe(false);
    expect(balanced.quality.depth).toBe("standard");
    expect(balanced.quality.reviewRequired).toBe(true);
    expect(balanced.quality.minReviewScore).toBe(7);
    expect(balanced.quality.maxReworks).toBe(2);
    expect(balanced.efficiency.maxDuration).toBe(30 * 60 * 1000);
    expect(balanced.efficiency.priority).toBe("normal");
    expect(balanced.efficiency.maxParallelism).toBe(3);
  });

  it("should define 'thorough' preset with premium model and long duration", () => {
    const thorough = CONSTRAINT_PRESETS.thorough;
    expect(thorough.cost.modelPreference).toBe("premium");
    expect(thorough.cost.budget).toBe(2000);
    expect(thorough.cost.allowOverBudget).toBe(true);
    expect(thorough.quality.depth).toBe("comprehensive");
    expect(thorough.quality.accuracy).toBe("require_evidence");
    expect(thorough.quality.reviewRequired).toBe(true);
    expect(thorough.quality.minReviewScore).toBe(8);
    expect(thorough.quality.maxReworks).toBe(3);
    expect(thorough.efficiency.maxDuration).toBe(4 * 60 * 60 * 1000);
    expect(thorough.efficiency.maxParallelism).toBe(2);
  });

  it("should have warningThreshold defined for all presets", () => {
    expect(CONSTRAINT_PRESETS.fast.cost.warningThreshold).toBe(0.8);
    expect(CONSTRAINT_PRESETS.balanced.cost.warningThreshold).toBe(0.7);
    expect(CONSTRAINT_PRESETS.thorough.cost.warningThreshold).toBe(0.9);
  });
});

describe("createConstraintProfile", () => {
  it("should create a profile from 'fast' preset without overrides", () => {
    const profile = createConstraintProfile("fast");
    expect(profile.preset).toBe("fast");
    expect(profile.cost.modelPreference).toBe("cheap");
    expect(profile.quality.depth).toBe("quick");
    expect(profile.efficiency.maxDuration).toBe(5 * 60 * 1000);
  });

  it("should create a profile from 'balanced' preset without overrides", () => {
    const profile = createConstraintProfile("balanced");
    expect(profile.preset).toBe("balanced");
    expect(profile.cost.budget).toBe(500);
  });

  it("should create a profile from 'thorough' preset without overrides", () => {
    const profile = createConstraintProfile("thorough");
    expect(profile.preset).toBe("thorough");
    expect(profile.cost.budget).toBe(2000);
  });

  it("should apply cost overrides", () => {
    const profile = createConstraintProfile("fast", {
      cost: {
        budget: 999,
        modelPreference: "balanced",
        allowOverBudget: true,
        warningThreshold: 0.5,
      },
    });
    expect(profile.cost.budget).toBe(999);
    expect(profile.cost.modelPreference).toBe("balanced");
    expect(profile.cost.allowOverBudget).toBe(true);
    expect(profile.cost.warningThreshold).toBe(0.5);
  });

  it("should apply quality overrides", () => {
    const profile = createConstraintProfile("fast", {
      quality: {
        depth: "comprehensive",
        accuracy: "require_evidence",
        reviewRequired: true,
        minReviewScore: 9,
        maxReworks: 5,
      },
    });
    expect(profile.quality.depth).toBe("comprehensive");
    expect(profile.quality.reviewRequired).toBe(true);
    expect(profile.quality.minReviewScore).toBe(9);
  });

  it("should apply efficiency overrides", () => {
    const profile = createConstraintProfile("fast", {
      efficiency: {
        maxDuration: 15 * 60 * 1000,
        priority: "low",
        allowParallel: false,
        maxParallelism: 1,
      },
    });
    expect(profile.efficiency.maxDuration).toBe(15 * 60 * 1000);
    expect(profile.efficiency.priority).toBe("low");
    expect(profile.efficiency.allowParallel).toBe(false);
  });

  it("should apply metadata overrides", () => {
    const profile = createConstraintProfile("balanced", {
      metadata: { source: "test" },
    });
    expect(profile.metadata).toEqual({ source: "test" });
  });

  it("should set preset field correctly on the returned profile", () => {
    const presets: ConstraintPreset[] = ["fast", "balanced", "thorough"];
    for (const preset of presets) {
      const profile = createConstraintProfile(preset);
      expect(profile.preset).toBe(preset);
    }
  });

  it("should not mutate the original preset", () => {
    const original = CONSTRAINT_PRESETS.fast.cost.budget;
    createConstraintProfile("fast", {
      cost: {
        budget: 9999,
        modelPreference: "premium",
        allowOverBudget: true,
        warningThreshold: 0.9,
      },
    });
    expect(CONSTRAINT_PRESETS.fast.cost.budget).toBe(original);
  });
});

describe("getDefaultConstraintProfile", () => {
  it("should return balanced preset profile", () => {
    const profile = getDefaultConstraintProfile();
    expect(profile.preset).toBe("balanced");
    expect(profile.cost.modelPreference).toBe("balanced");
    expect(profile.quality.depth).toBe("standard");
  });

  it("should return a new object each time", () => {
    const p1 = getDefaultConstraintProfile();
    const p2 = getDefaultConstraintProfile();
    expect(p1).not.toBe(p2);
  });
});

describe("mergeConstraintProfiles", () => {
  it("should merge cost fields from override", () => {
    const base = createConstraintProfile("fast");
    const override: Partial<ConstraintProfile> = {
      cost: {
        budget: 777,
        modelPreference: "premium",
        allowOverBudget: true,
        warningThreshold: 0.6,
      },
    };
    const merged = mergeConstraintProfiles(base, override);
    expect(merged.cost.budget).toBe(777);
    expect(merged.cost.modelPreference).toBe("premium");
  });

  it("should merge quality fields from override", () => {
    const base = createConstraintProfile("fast");
    const override: Partial<ConstraintProfile> = {
      quality: {
        depth: "standard",
        accuracy: "prefer_evidence",
        reviewRequired: true,
        minReviewScore: 8,
        maxReworks: 3,
      },
    };
    const merged = mergeConstraintProfiles(base, override);
    expect(merged.quality.depth).toBe("standard");
    expect(merged.quality.reviewRequired).toBe(true);
  });

  it("should merge efficiency fields from override", () => {
    const base = createConstraintProfile("fast");
    const override: Partial<ConstraintProfile> = {
      efficiency: {
        maxDuration: 60 * 60 * 1000,
        priority: "high",
        allowParallel: true,
        maxParallelism: 4,
      },
    };
    const merged = mergeConstraintProfiles(base, override);
    expect(merged.efficiency.maxDuration).toBe(60 * 60 * 1000);
    expect(merged.efficiency.priority).toBe("high");
  });

  it("should preserve base fields not in override", () => {
    const base = createConstraintProfile("thorough");
    const override: Partial<ConstraintProfile> = {
      cost: {
        budget: 100,
        modelPreference: "cheap",
        allowOverBudget: false,
        warningThreshold: 0.8,
      },
    };
    const merged = mergeConstraintProfiles(base, override);
    // quality and efficiency should come from thorough
    expect(merged.quality.depth).toBe("comprehensive");
    expect(merged.efficiency.maxDuration).toBe(4 * 60 * 60 * 1000);
  });

  it("should not mutate the base profile", () => {
    const base = createConstraintProfile("fast");
    const originalBudget = base.cost.budget;
    mergeConstraintProfiles(base, {
      cost: {
        budget: 9999,
        modelPreference: "premium",
        allowOverBudget: true,
        warningThreshold: 0.9,
      },
    });
    expect(base.cost.budget).toBe(originalBudget);
  });

  it("should handle empty override", () => {
    const base = createConstraintProfile("balanced");
    const merged = mergeConstraintProfiles(base, {});
    expect(merged.cost).toEqual(base.cost);
    expect(merged.quality).toEqual(base.quality);
    expect(merged.efficiency).toEqual(base.efficiency);
  });
});
