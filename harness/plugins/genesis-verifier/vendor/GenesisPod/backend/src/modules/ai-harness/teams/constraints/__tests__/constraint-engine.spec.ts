/**
 * Unit tests for ConstraintEngine
 */

import { ConstraintEngine } from "@/modules/ai-harness/facade";
import {
  createConstraintProfile,
  getDefaultConstraintProfile,
} from "../../profile/mission-execution-profile";
import {
  ResourceUsage,
  ConstraintViolation,
} from "../constraint-engine.interface";
import { CostController } from "@/modules/ai-harness/facade";

// ==================== Helpers ====================

function makeUsage(overrides: Partial<ResourceUsage> = {}): ResourceUsage {
  return {
    costUsed: 0,
    timeElapsed: 0,
    tokensUsed: 0,
    reviewCount: 0,
    reworkCount: 0,
    progress: 0,
    qualityScore: 8,
    ...overrides,
  };
}

function makeViolation(
  type: "cost" | "quality" | "efficiency",
  excess = 100,
): ConstraintViolation {
  return {
    type,
    code: "TEST_VIOLATION",
    message: "Test violation",
    currentValue: 200,
    limit: 100,
    excess,
    recoverable: true,
  };
}

// ==================== Validate ====================

describe("ConstraintEngine - validate", () => {
  const engine = new ConstraintEngine();

  it("should return valid for a correct constraint profile", () => {
    const profile = getDefaultConstraintProfile();
    const result = engine.validate(profile);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("should report violation when budget <= 0", () => {
    const profile = createConstraintProfile("balanced", {
      cost: {
        budget: 0,
        modelPreference: "balanced",
        allowOverBudget: false,
        warningThreshold: 0.7,
      },
    });
    const result = engine.validate(profile);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.type === "cost")).toBe(true);
  });

  it("should report violation when minReviewScore > 10", () => {
    const profile = createConstraintProfile("balanced", {
      quality: {
        depth: "standard",
        accuracy: "prefer_evidence",
        reviewRequired: true,
        minReviewScore: 11,
        maxReworks: 2,
      },
    });
    const result = engine.validate(profile);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.type === "quality")).toBe(true);
  });

  it("should report violation when minReviewScore < 0", () => {
    const profile = createConstraintProfile("balanced", {
      quality: {
        depth: "standard",
        accuracy: "prefer_evidence",
        reviewRequired: true,
        minReviewScore: -1,
        maxReworks: 2,
      },
    });
    const result = engine.validate(profile);
    expect(result.valid).toBe(false);
  });

  it("should report violation when maxDuration <= 0", () => {
    const profile = createConstraintProfile("fast", {
      efficiency: {
        maxDuration: 0,
        priority: "urgent",
        allowParallel: true,
        maxParallelism: 3,
      },
    });
    const result = engine.validate(profile);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.type === "efficiency")).toBe(true);
  });
});

// ==================== Evaluate - Cost ====================

describe("ConstraintEngine - evaluate - cost", () => {
  const engine = new ConstraintEngine();

  it("should return healthy status when cost is low", () => {
    const profile = getDefaultConstraintProfile();
    const usage = makeUsage({ costUsed: 50, progress: 0.2 }); // 10% of 500 budget
    const eval_ = engine.evaluate(profile, usage);

    expect(eval_.cost.status).toBe("healthy");
    expect(eval_.satisfied).toBe(true);
  });

  it("should return warning status when cost crosses warningThreshold", () => {
    const profile = getDefaultConstraintProfile(); // budget=500, warningThreshold=0.7
    const usage = makeUsage({ costUsed: 370, progress: 0.5 }); // 74%
    const eval_ = engine.evaluate(profile, usage);

    expect(eval_.cost.status).toBe("warning");
    expect(eval_.warnings.some((w) => w.code === "COST_WARNING")).toBe(true);
  });

  it("should return critical status when cost is >= 90%", () => {
    const profile = getDefaultConstraintProfile(); // budget=500
    const usage = makeUsage({ costUsed: 460, progress: 0.5 }); // 92%
    const eval_ = engine.evaluate(profile, usage);

    expect(eval_.cost.status).toBe("critical");
  });

  it("should return exceeded status and violation when over budget", () => {
    const profile = getDefaultConstraintProfile(); // budget=500
    const usage = makeUsage({ costUsed: 600 });
    const eval_ = engine.evaluate(profile, usage);

    expect(eval_.cost.status).toBe("exceeded");
    expect(eval_.violations.some((v) => v.code === "BUDGET_EXCEEDED")).toBe(
      true,
    );
    expect(eval_.satisfied).toBe(false);
  });
});

// ==================== Evaluate - Quality ====================

describe("ConstraintEngine - evaluate - quality", () => {
  const engine = new ConstraintEngine();

  it("should return excellent status for quality score >= 9", () => {
    const profile = getDefaultConstraintProfile();
    const usage = makeUsage({ qualityScore: 9.5 });
    const eval_ = engine.evaluate(profile, usage);
    expect(eval_.quality.status).toBe("excellent");
  });

  it("should return good status for quality score in [7, 9)", () => {
    const profile = getDefaultConstraintProfile();
    const usage = makeUsage({ qualityScore: 8 });
    const eval_ = engine.evaluate(profile, usage);
    expect(eval_.quality.status).toBe("good");
  });

  it("should return acceptable status for score >= minReviewScore", () => {
    const profile = getDefaultConstraintProfile(); // minReviewScore=7
    const usage = makeUsage({ qualityScore: 7 });
    const eval_ = engine.evaluate(profile, usage);
    expect(eval_.quality.status).toBe("good"); // 7 is in [7,9)
  });

  it("should return poor status and violation when quality below threshold", () => {
    const profile = getDefaultConstraintProfile(); // minReviewScore=7
    const usage = makeUsage({ qualityScore: 5 });
    const eval_ = engine.evaluate(profile, usage);
    expect(eval_.quality.status).toBe("poor");
    expect(
      eval_.violations.some((v) => v.code === "QUALITY_BELOW_THRESHOLD"),
    ).toBe(true);
  });

  it("should warn when max reworks reached", () => {
    const profile = getDefaultConstraintProfile(); // maxReworks=2
    const usage = makeUsage({ qualityScore: 8, reworkCount: 2 });
    const eval_ = engine.evaluate(profile, usage);
    expect(eval_.warnings.some((w) => w.code === "MAX_REWORKS_REACHED")).toBe(
      true,
    );
  });
});

// ==================== Evaluate - Efficiency ====================

describe("ConstraintEngine - evaluate - efficiency", () => {
  const engine = new ConstraintEngine();

  it("should return on_track when time usage is low", () => {
    const profile = getDefaultConstraintProfile(); // maxDuration=1800000ms
    const usage = makeUsage({ timeElapsed: 300000 }); // 16.7%
    const eval_ = engine.evaluate(profile, usage);
    expect(eval_.efficiency.status).toBe("on_track");
  });

  it("should return at_risk when time usage is >= 70%", () => {
    const profile = getDefaultConstraintProfile();
    const usage = makeUsage({ timeElapsed: 1300000, progress: 0.5 }); // ~72%
    const eval_ = engine.evaluate(profile, usage);
    expect(eval_.efficiency.status).toBe("at_risk");
    expect(eval_.warnings.some((w) => w.code === "TIME_WARNING")).toBe(true);
  });

  it("should return delayed when time usage is >= 90%", () => {
    const profile = getDefaultConstraintProfile();
    const usage = makeUsage({ timeElapsed: 1650000, progress: 0.5 }); // ~92%
    const eval_ = engine.evaluate(profile, usage);
    expect(eval_.efficiency.status).toBe("delayed");
  });

  it("should return timeout and violation when elapsed > maxDuration", () => {
    const profile = getDefaultConstraintProfile();
    const usage = makeUsage({ timeElapsed: 2000000 }); // > 1800000
    const eval_ = engine.evaluate(profile, usage);
    expect(eval_.efficiency.status).toBe("timeout");
    expect(eval_.violations.some((v) => v.code === "TIMEOUT")).toBe(true);
  });
});

// ==================== Evaluate - Health Score ====================

describe("ConstraintEngine - evaluate - healthScore", () => {
  const engine = new ConstraintEngine();

  it("should return high health score for all-healthy usage", () => {
    const profile = getDefaultConstraintProfile();
    const usage = makeUsage({
      costUsed: 50,
      timeElapsed: 100000,
      qualityScore: 9,
    });
    const eval_ = engine.evaluate(profile, usage);
    expect(eval_.healthScore).toBeGreaterThan(0.8);
  });

  it("should return low health score for exceeded budget and poor quality", () => {
    const profile = getDefaultConstraintProfile();
    const usage = makeUsage({
      costUsed: 600,
      timeElapsed: 2000000,
      qualityScore: 3,
    });
    const eval_ = engine.evaluate(profile, usage);
    expect(eval_.healthScore).toBeLessThan(0.5);
  });
});

// ==================== Allocate ====================

describe("ConstraintEngine - allocate", () => {
  const engine = new ConstraintEngine();

  it("should allocate with balanced tier for balanced profile", () => {
    const profile = getDefaultConstraintProfile();
    const alloc = engine.allocate(
      { estimatedTokens: 1000, estimatedDuration: 60000, parallelismNeeded: 2 },
      profile,
    );
    expect(alloc.modelTier).toBe("balanced");
    expect(alloc.model).toBe("default");
    expect(alloc.reviewEnabled).toBe(true);
  });

  it("should downgrade model tier when estimated cost is too high", () => {
    const profile = createConstraintProfile("balanced", {
      cost: {
        budget: 1,
        modelPreference: "premium",
        allowOverBudget: false,
        warningThreshold: 0.7,
      },
    });
    const alloc = engine.allocate(
      {
        estimatedTokens: 100000,
        estimatedDuration: 60000,
        parallelismNeeded: 1,
      },
      profile,
    );
    // Should downgrade from premium
    expect(["balanced", "cheap"]).toContain(alloc.modelTier);
  });

  it("should limit parallelism to constraint max", () => {
    const profile = createConstraintProfile("balanced", {
      efficiency: {
        maxDuration: 1800000,
        priority: "normal",
        allowParallel: true,
        maxParallelism: 2,
      },
    });
    const alloc = engine.allocate(
      { estimatedTokens: 1000, estimatedDuration: 60000, parallelismNeeded: 5 },
      profile,
    );
    expect(alloc.parallelism).toBeLessThanOrEqual(2);
  });

  it("should set parallelism to 1 when parallel is not allowed", () => {
    const profile = createConstraintProfile("balanced", {
      efficiency: {
        maxDuration: 1800000,
        priority: "normal",
        allowParallel: false,
        maxParallelism: 3,
      },
    });
    const alloc = engine.allocate(
      { estimatedTokens: 1000, estimatedDuration: 60000, parallelismNeeded: 3 },
      profile,
    );
    expect(alloc.parallelism).toBe(1);
  });
});

// ==================== EstimateCost ====================

describe("ConstraintEngine - estimateCost", () => {
  const engine = new ConstraintEngine();

  it("should estimate cost within budget for small token count", () => {
    const profile = getDefaultConstraintProfile();
    const estimate = engine.estimateCost(
      { estimatedTokens: 1000, estimatedDuration: 60000, parallelismNeeded: 1 },
      profile,
    );
    expect(estimate.withinBudget).toBe(true);
    expect(estimate.totalCost).toBeGreaterThan(0);
    expect(estimate.confidence).toBe(0.8);
  });

  it("should flag over budget for large token count", () => {
    const profile = createConstraintProfile("fast"); // budget=100
    const estimate = engine.estimateCost(
      {
        estimatedTokens: 10000000,
        estimatedDuration: 60000,
        parallelismNeeded: 1,
      },
      profile,
    );
    expect(estimate.withinBudget).toBe(false);
    expect(estimate.overBudgetAmount).toBeGreaterThan(0);
  });

  it("should add review cost when reviewRequired is true", () => {
    const profileWithReview = createConstraintProfile("balanced"); // reviewRequired=true
    const profileNoReview = createConstraintProfile("fast"); // reviewRequired=false

    const tokens = 5000;
    const req = {
      estimatedTokens: tokens,
      estimatedDuration: 60000,
      parallelismNeeded: 1,
    };

    const withReview = engine.estimateCost(req, profileWithReview);
    const noReview = engine.estimateCost(req, profileNoReview);

    // With review should have higher or equal cost due to review overhead
    expect(withReview.breakdown.some((b) => b.category === "质量审核")).toBe(
      true,
    );
    expect(noReview.breakdown.some((b) => b.category === "质量审核")).toBe(
      false,
    );
  });
});

// ==================== SuggestDegradation ====================

describe("ConstraintEngine - suggestDegradation", () => {
  const engine = new ConstraintEngine();

  it("should suggest model downgrade for cost violation", () => {
    const profile = createConstraintProfile("balanced"); // modelPreference=balanced
    const violation = makeViolation("cost");
    const strategies = engine.suggestDegradation(violation, profile);

    expect(strategies.some((s) => s.type === "model_downgrade")).toBe(true);
  });

  it("should not suggest model downgrade when already at cheap tier", () => {
    const profile = createConstraintProfile("fast"); // modelPreference=cheap
    const violation = makeViolation("cost");
    const strategies = engine.suggestDegradation(violation, profile);

    expect(strategies.some((s) => s.type === "model_downgrade")).toBe(false);
  });

  it("should suggest parallelism reduction for cost violation", () => {
    const profile = createConstraintProfile("balanced"); // maxParallelism=3
    const violation = makeViolation("cost");
    const strategies = engine.suggestDegradation(violation, profile);

    expect(strategies.some((s) => s.type === "reduce_parallelism")).toBe(true);
  });

  it("should suggest skip_review for efficiency violation when reviewRequired", () => {
    const profile = createConstraintProfile("balanced"); // reviewRequired=true
    const violation = makeViolation("efficiency");
    const strategies = engine.suggestDegradation(violation, profile);

    expect(strategies.some((s) => s.type === "skip_review")).toBe(true);
  });

  it("should suggest reduce_iterations for efficiency violation", () => {
    const profile = createConstraintProfile("thorough"); // depth=comprehensive
    const violation = makeViolation("efficiency");
    const strategies = engine.suggestDegradation(violation, profile);

    expect(strategies.some((s) => s.type === "reduce_iterations")).toBe(true);
  });

  it("strategy.apply should return modified constraint profile", () => {
    const profile = createConstraintProfile("balanced");
    const violation = makeViolation("cost");
    const strategies = engine.suggestDegradation(violation, profile);

    const downgradeStrategy = strategies.find(
      (s) => s.type === "model_downgrade",
    );
    expect(downgradeStrategy).toBeDefined();
    const result = downgradeStrategy!.apply();
    expect(result.cost?.modelPreference).toBe("cheap");
  });
});

// ==================== Rebalance ====================

describe("ConstraintEngine - rebalance", () => {
  const engine = new ConstraintEngine();

  it("should rebalance for cost priority using fast preset base", () => {
    const profile = getDefaultConstraintProfile();
    const rebalanced = engine.rebalance(profile, "cost");
    // rebalance("cost") calls createConstraintProfile("fast", { cost: constraints.cost })
    // The cost override carries the original profile's cost (balanced), not fast's cheap
    // So efficiency and quality are from "fast" preset
    expect(rebalanced.quality.depth).toBe("quick");
    expect(rebalanced.efficiency.maxParallelism).toBe(5);
  });

  it("should rebalance for quality priority using thorough preset base", () => {
    const profile = getDefaultConstraintProfile();
    const rebalanced = engine.rebalance(profile, "quality");
    // rebalance("quality") calls createConstraintProfile("thorough", { quality: constraints.quality })
    // Quality comes from original profile (balanced), cost/efficiency from thorough
    expect(rebalanced.cost.modelPreference).toBe("premium"); // from thorough preset
  });

  it("should rebalance for efficiency priority", () => {
    const profile = getDefaultConstraintProfile();
    const rebalanced = engine.rebalance(profile, "efficiency");
    expect(rebalanced.quality.reviewRequired).toBe(false);
    expect(rebalanced.quality.depth).toBe("quick");
    expect(rebalanced.efficiency.maxParallelism).toBe(5);
  });
});

// ==================== CanContinue ====================

describe("ConstraintEngine - canContinue", () => {
  const engine = new ConstraintEngine();

  it("should return canContinue=true when all within limits", () => {
    const profile = getDefaultConstraintProfile();
    const usage = makeUsage({
      costUsed: 100,
      timeElapsed: 500000,
      reworkCount: 1,
    });
    const result = engine.canContinue(profile, usage);
    expect(result.canContinue).toBe(true);
  });

  it("should stop when over budget and allowOverBudget=false", () => {
    const profile = createConstraintProfile("balanced"); // allowOverBudget=false, budget=500
    const usage = makeUsage({ costUsed: 600 });
    const result = engine.canContinue(profile, usage);
    expect(result.canContinue).toBe(false);
    expect(result.reason).toContain("超出预算");
  });

  it("should continue when over budget and allowOverBudget=true", () => {
    const profile = createConstraintProfile("thorough"); // allowOverBudget=true
    const usage = makeUsage({ costUsed: 3000 }); // over budget=2000 but allowed
    const result = engine.canContinue(profile, usage);
    expect(result.canContinue).toBe(true);
  });

  it("should stop when time elapsed exceeds maxDuration", () => {
    const profile = getDefaultConstraintProfile(); // maxDuration=1800000
    const usage = makeUsage({ timeElapsed: 2000000 });
    const result = engine.canContinue(profile, usage);
    expect(result.canContinue).toBe(false);
    expect(result.reason).toContain("超出时间");
  });

  it("should stop when rework count exceeds maxReworks", () => {
    const profile = getDefaultConstraintProfile(); // maxReworks=2
    const usage = makeUsage({ reworkCount: 3 });
    const result = engine.canContinue(profile, usage);
    expect(result.canContinue).toBe(false);
    expect(result.reason).toContain("最大返工");
  });
});

// ==================== RecordCost / CheckBudget ====================

describe("ConstraintEngine - recordCost and checkBudget", () => {
  it("should delegate recordCost to CostController when available", () => {
    const mockCostController = {
      calculateCost: jest.fn().mockReturnValue(1.5),
      recordCost: jest.fn(),
      checkBudget: jest.fn().mockReturnValue({ allowed: true }),
    } as unknown as CostController;

    const engine = new ConstraintEngine(mockCostController);
    const cost = engine.recordCost("llm-call", "gpt-4", 100, 200, "mission-1");

    expect(mockCostController.calculateCost).toHaveBeenCalledWith(
      "gpt-4",
      100,
      200,
    );
    expect(mockCostController.recordCost).toHaveBeenCalled();
    expect(cost).toBe(1.5);
  });

  it("should estimate cost without CostController", () => {
    const engine = new ConstraintEngine();
    const cost = engine.recordCost("llm-call", "default", 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  it("checkBudget should return true when no CostController", () => {
    const engine = new ConstraintEngine();
    expect(engine.checkBudget(999)).toBe(true);
  });

  it("checkBudget should delegate to CostController", () => {
    const mockCostController = {
      checkBudget: jest.fn().mockReturnValue({ allowed: false }),
    } as unknown as CostController;
    const engine = new ConstraintEngine(mockCostController);
    expect(engine.checkBudget(999)).toBe(false);
  });
});
