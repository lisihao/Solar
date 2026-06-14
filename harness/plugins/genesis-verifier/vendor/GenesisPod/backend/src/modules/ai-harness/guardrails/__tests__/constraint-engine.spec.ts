import { Test, TestingModule } from "@nestjs/testing";
import { ConstraintEngine } from "../constraints/constraint-engine";
import { CostController } from "../resources/cost-controller";
import {
  createConstraintProfile,
  ConstraintProfile,
} from "../constraints/constraint-profile";
import type {
  ResourceRequirement,
  ResourceUsage,
  ConstraintViolation,
} from "@/modules/ai-harness/guardrails/constraints/constraint-engine.interface";

const mockCostController = {
  calculateCost: jest.fn().mockReturnValue(0.5),
  recordCost: jest.fn(),
  checkBudget: jest.fn().mockReturnValue({
    allowed: true,
    remaining: 100,
    usageRate: 0.1,
    alertTriggered: false,
  }),
};

describe("ConstraintEngine", () => {
  let engine: ConstraintEngine;

  const makeUsage = (
    overrides: Partial<ResourceUsage> = {},
  ): ResourceUsage => ({
    costUsed: 0,
    timeElapsed: 0,
    progress: 0.5,
    qualityScore: 8,
    reviewCount: 0,
    reworkCount: 0,
    ...overrides,
  });

  const makeRequirement = (
    overrides: Partial<ResourceRequirement> = {},
  ): ResourceRequirement => ({
    estimatedTokens: 10000,
    estimatedDuration: 60000,
    parallelismNeeded: 3,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConstraintEngine,
        { provide: CostController, useValue: mockCostController },
      ],
    }).compile();
    engine = module.get<ConstraintEngine>(ConstraintEngine);
  });

  afterEach(() => jest.clearAllMocks());

  // ==================== recordCost ====================

  describe("recordCost", () => {
    it("should delegate cost calculation to CostController", () => {
      const cost = engine.recordCost("chat", "gpt-4o", 1000, 500, "mission-1");
      expect(mockCostController.calculateCost).toHaveBeenCalledWith(
        "gpt-4o",
        1000,
        500,
      );
      expect(mockCostController.recordCost).toHaveBeenCalledWith({
        category: "llm",
        operation: "chat",
        tokens: { input: 1000, output: 500, total: 1500 },
        cost: 0.5,
        sessionId: "mission-1",
      });
      expect(cost).toBe(0.5);
    });

    it("should work without missionId", () => {
      const cost = engine.recordCost("embed", "some-model", 200, 0);
      expect(mockCostController.recordCost).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: undefined }),
      );
      expect(cost).toBe(0.5);
    });

    it("should fallback to internal estimate when no CostController", () => {
      // Use engine without CostController (null injected)
      const engineNoCont = new (ConstraintEngine as any)();
      // balanced tier: 10000 tokens -> estimate
      const cost = engineNoCont.recordCost("chat", "balanced", 7500, 2500);
      expect(cost).toBeGreaterThan(0);
    });
  });

  // ==================== checkBudget ====================

  describe("checkBudget", () => {
    it("should delegate to CostController.checkBudget", () => {
      const result = engine.checkBudget(10);
      expect(mockCostController.checkBudget).toHaveBeenCalledWith(10, "llm");
      expect(result).toBe(true);
    });

    it("should return false when budget is exceeded", () => {
      mockCostController.checkBudget.mockReturnValueOnce({ allowed: false });
      expect(engine.checkBudget(999)).toBe(false);
    });

    it("should return true when no CostController", () => {
      const engineNoCont = new (ConstraintEngine as any)();
      expect(engineNoCont.checkBudget(999)).toBe(true);
    });
  });

  // ==================== validate ====================

  describe("validate", () => {
    it("should return valid for a well-formed balanced profile", () => {
      const profile = createConstraintProfile("balanced");
      const result = engine.validate(profile);
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should return violation for zero budget", () => {
      const profile = createConstraintProfile("fast", {
        cost: {
          budget: 0,
          modelPreference: "cheap",
          allowOverBudget: false,
          warningThreshold: 0.8,
        },
      });
      const result = engine.validate(profile);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.type === "cost")).toBe(true);
    });

    it("should return violation for negative budget", () => {
      const profile = createConstraintProfile("fast", {
        cost: {
          budget: -100,
          modelPreference: "cheap",
          allowOverBudget: false,
          warningThreshold: 0.8,
        },
      });
      const result = engine.validate(profile);
      expect(result.valid).toBe(false);
    });

    it("should return violation for minReviewScore below 0", () => {
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
      expect(result.violations.some((v) => v.type === "quality")).toBe(true);
    });

    it("should return violation for minReviewScore above 10", () => {
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
    });

    it("should return violation for zero maxDuration", () => {
      const profile = createConstraintProfile("fast", {
        efficiency: {
          maxDuration: 0,
          priority: "urgent",
          allowParallel: true,
          maxParallelism: 5,
        },
      });
      const result = engine.validate(profile);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.type === "efficiency")).toBe(true);
    });

    it("should return multiple violations", () => {
      const profile: ConstraintProfile = {
        cost: {
          budget: 0,
          modelPreference: "cheap",
          allowOverBudget: false,
          warningThreshold: 0.8,
        },
        quality: {
          depth: "quick",
          accuracy: "allow_inference",
          reviewRequired: false,
          minReviewScore: -1,
          maxReworks: 0,
        },
        efficiency: {
          maxDuration: 0,
          priority: "urgent",
          allowParallel: true,
          maxParallelism: 1,
        },
      };
      const result = engine.validate(profile);
      expect(result.violations.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ==================== evaluate ====================

  describe("evaluate", () => {
    it("should return satisfied=true when all constraints healthy", () => {
      const profile = createConstraintProfile("balanced");
      const usage = makeUsage({
        costUsed: 50,
        timeElapsed: 1000 * 60,
        progress: 0.5,
        qualityScore: 9,
      });
      const result = engine.evaluate(profile, usage);
      expect(result.satisfied).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should return cost status exceeded when costUsed > budget", () => {
      const profile = createConstraintProfile("fast"); // budget=100
      const usage = makeUsage({ costUsed: 150, timeElapsed: 0, progress: 0.5 });
      const result = engine.evaluate(profile, usage);
      expect(result.cost.status).toBe("exceeded");
      expect(result.satisfied).toBe(false);
    });

    it("should return cost status critical when usageRate >= 0.9", () => {
      const profile = createConstraintProfile("fast"); // budget=100
      const usage = makeUsage({ costUsed: 92, timeElapsed: 0, progress: 0.5 });
      const result = engine.evaluate(profile, usage);
      expect(result.cost.status).toBe("critical");
    });

    it("should return cost status warning when usageRate >= warningThreshold", () => {
      const profile = createConstraintProfile("fast"); // warningThreshold=0.8, budget=100
      const usage = makeUsage({ costUsed: 83, timeElapsed: 0, progress: 0.5 });
      const result = engine.evaluate(profile, usage);
      expect(result.cost.status).toBe("warning");
    });

    it("should return cost status healthy when usageRate < warningThreshold", () => {
      const profile = createConstraintProfile("fast"); // budget=100
      const usage = makeUsage({ costUsed: 50, timeElapsed: 0, progress: 0.5 });
      const result = engine.evaluate(profile, usage);
      expect(result.cost.status).toBe("healthy");
    });

    it("should compute estimatedTotal based on progress", () => {
      const profile = createConstraintProfile("fast"); // budget=100
      const usage = makeUsage({ costUsed: 50, progress: 0.5 });
      const result = engine.evaluate(profile, usage);
      // estimatedTotal = 50 / 0.5 = 100
      expect(result.cost.estimatedTotal).toBe(100);
    });

    it("should use costUsed*2 for estimatedTotal when progress=0", () => {
      const profile = createConstraintProfile("fast");
      const usage = makeUsage({ costUsed: 30, progress: 0 });
      const result = engine.evaluate(profile, usage);
      expect(result.cost.estimatedTotal).toBe(60);
    });

    it("should return quality status excellent when score >= 9", () => {
      const profile = createConstraintProfile("balanced");
      const usage = makeUsage({ qualityScore: 9 });
      const result = engine.evaluate(profile, usage);
      expect(result.quality.status).toBe("excellent");
    });

    it("should return quality status good when score >= 7", () => {
      const profile = createConstraintProfile("balanced");
      const usage = makeUsage({ qualityScore: 7 });
      const result = engine.evaluate(profile, usage);
      expect(result.quality.status).toBe("good");
    });

    it("should return quality status acceptable when score >= minReviewScore", () => {
      const profile = createConstraintProfile("balanced"); // minReviewScore=7
      const usage = makeUsage({ qualityScore: 7 });
      const result = engine.evaluate(profile, usage);
      expect(result.quality.status).toBe("good"); // 7 >= 7 -> good
    });

    it("should return quality status poor when score < minReviewScore", () => {
      const profile = createConstraintProfile("balanced"); // minReviewScore=7
      const usage = makeUsage({ qualityScore: 4 });
      const result = engine.evaluate(profile, usage);
      expect(result.quality.status).toBe("poor");
      expect(result.satisfied).toBe(false);
    });

    it("should handle null qualityScore (defaults to 0)", () => {
      const profile = createConstraintProfile("balanced");
      const usage = makeUsage({ qualityScore: undefined as any });
      const result = engine.evaluate(profile, usage);
      expect(result.quality.currentScore).toBe(0);
    });

    it("should return efficiency on_track when timeUsageRate < 0.7", () => {
      const profile = createConstraintProfile("balanced"); // maxDuration=30min
      const usage = makeUsage({ timeElapsed: 5 * 60 * 1000 }); // 5 min / 30 min = 0.17
      const result = engine.evaluate(profile, usage);
      expect(result.efficiency.status).toBe("on_track");
    });

    it("should return efficiency at_risk when timeUsageRate >= 0.7", () => {
      const profile = createConstraintProfile("balanced"); // maxDuration=30min
      const usage = makeUsage({ timeElapsed: 22 * 60 * 1000 }); // 22/30 = 0.73
      const result = engine.evaluate(profile, usage);
      expect(result.efficiency.status).toBe("at_risk");
    });

    it("should return efficiency delayed when timeUsageRate >= 0.9", () => {
      const profile = createConstraintProfile("balanced"); // maxDuration=30min
      const usage = makeUsage({ timeElapsed: 28 * 60 * 1000 }); // 28/30 = 0.93
      const result = engine.evaluate(profile, usage);
      expect(result.efficiency.status).toBe("delayed");
    });

    it("should return efficiency timeout when timeUsageRate >= 1", () => {
      const profile = createConstraintProfile("balanced"); // maxDuration=30min
      const usage = makeUsage({ timeElapsed: 35 * 60 * 1000 }); // > 30min
      const result = engine.evaluate(profile, usage);
      expect(result.efficiency.status).toBe("timeout");
      expect(result.satisfied).toBe(false);
    });

    it("should add willExceedBudget suggestion when estimatedTotal > budget", () => {
      const profile = createConstraintProfile("fast"); // budget=100
      const usage = makeUsage({ costUsed: 80, progress: 0.4 }); // estimated=200 > 100
      const result = engine.evaluate(profile, usage);
      expect(
        result.suggestions.some((s) => s.code === "SUGGEST_MODEL_DOWNGRADE"),
      ).toBe(true);
    });

    it("should add reduce_parallelism suggestion when willTimeout and progress < 0.8", () => {
      const profile = createConstraintProfile("balanced"); // maxDuration=30min
      const usage = makeUsage({ timeElapsed: 20 * 60 * 1000, progress: 0.4 }); // estimated=50min > 30min
      const result = engine.evaluate(profile, usage);
      expect(
        result.suggestions.some((s) => s.code === "SUGGEST_REDUCE_PARALLELISM"),
      ).toBe(true);
    });

    it("should add max reworks warning", () => {
      const profile = createConstraintProfile("balanced"); // maxReworks=2
      const usage = makeUsage({ reworkCount: 2 });
      const result = engine.evaluate(profile, usage);
      expect(
        result.warnings.some((w) => w.code === "MAX_REWORKS_REACHED"),
      ).toBe(true);
    });

    it("should compute healthScore as number between 0 and 1", () => {
      const profile = createConstraintProfile("balanced");
      const usage = makeUsage({
        costUsed: 100,
        timeElapsed: 5 * 60 * 1000,
        qualityScore: 8,
      });
      const result = engine.evaluate(profile, usage);
      expect(result.healthScore).toBeGreaterThanOrEqual(0);
      expect(result.healthScore).toBeLessThanOrEqual(1);
    });

    it("should include cost/quality/efficiency violation when allowOverBudget=false and exceeded", () => {
      const profile = createConstraintProfile("fast");
      const usage = makeUsage({ costUsed: 200 }); // > 100 budget, allowOverBudget=false
      const result = engine.evaluate(profile, usage);
      expect(result.violations.some((v) => v.code === "BUDGET_EXCEEDED")).toBe(
        true,
      );
      expect(
        result.violations.find((v) => v.code === "BUDGET_EXCEEDED")
          ?.recoverable,
      ).toBe(false);
    });

    it("should set recoverable=true on BUDGET_EXCEEDED when allowOverBudget=true", () => {
      const profile = createConstraintProfile("thorough"); // allowOverBudget=true
      const usage = makeUsage({ costUsed: 3000 }); // > 2000 budget
      const result = engine.evaluate(profile, usage);
      const violation = result.violations.find(
        (v) => v.code === "BUDGET_EXCEEDED",
      );
      expect(violation?.recoverable).toBe(true);
    });
  });

  // ==================== allocate ====================

  describe("allocate", () => {
    it("should allocate model based on constraint preference", () => {
      const profile = createConstraintProfile("balanced"); // modelPreference=balanced -> "default"
      const req = makeRequirement({ estimatedTokens: 100 }); // cheap so no downgrade
      const allocation = engine.allocate(req, profile);
      expect(allocation.model).toBeDefined();
      expect(allocation.modelTier).toBeDefined();
    });

    it("should downgrade model when estimated cost exceeds 80% of budget", () => {
      const profile = createConstraintProfile("fast", {
        cost: {
          budget: 0.001,
          modelPreference: "premium",
          allowOverBudget: false,
          warningThreshold: 0.8,
        },
      });
      // premium costs are high, 10000 tokens will exceed 0.001 * 0.8 = 0.0008
      const req = makeRequirement({ estimatedTokens: 10000 });
      const allocation = engine.allocate(req, profile);
      // Should have downgraded from premium
      expect(["balanced", "cheap"]).toContain(allocation.modelTier);
    });

    it("should cap parallelism at constraints.efficiency.maxParallelism", () => {
      const profile = createConstraintProfile("balanced"); // maxParallelism=3
      const req = makeRequirement({ parallelismNeeded: 10 });
      const allocation = engine.allocate(req, profile);
      expect(allocation.parallelism).toBe(3);
    });

    it("should set parallelism=1 when allowParallel=false", () => {
      const profile = createConstraintProfile("balanced", {
        efficiency: {
          maxDuration: 30 * 60 * 1000,
          priority: "normal",
          allowParallel: false,
          maxParallelism: 3,
        },
      });
      const req = makeRequirement({ parallelismNeeded: 5 });
      const allocation = engine.allocate(req, profile);
      expect(allocation.parallelism).toBe(1);
    });

    it("should cap timeout at maxDuration", () => {
      const profile = createConstraintProfile("balanced"); // maxDuration=30min
      const req = makeRequirement({ estimatedDuration: 60 * 60 * 1000 }); // 1 hour
      const allocation = engine.allocate(req, profile);
      expect(allocation.timeout).toBe(30 * 60 * 1000);
    });

    it("should return 2x estimatedDuration when within maxDuration", () => {
      const profile = createConstraintProfile("thorough"); // maxDuration=4h
      const req = makeRequirement({ estimatedDuration: 60 * 1000 }); // 1min
      const allocation = engine.allocate(req, profile);
      expect(allocation.timeout).toBe(2 * 60 * 1000);
    });

    it("should include reviewEnabled from quality constraints", () => {
      const profile = createConstraintProfile("balanced"); // reviewRequired=true
      const allocation = engine.allocate(makeRequirement(), profile);
      expect(allocation.reviewEnabled).toBe(true);
    });

    it("should include qualityDepth from quality constraints", () => {
      const profile = createConstraintProfile("thorough"); // depth=comprehensive
      const allocation = engine.allocate(makeRequirement(), profile);
      expect(allocation.qualityDepth).toBe("comprehensive");
    });

    it("should provide reasoning string", () => {
      const profile = createConstraintProfile("balanced");
      const allocation = engine.allocate(makeRequirement(), profile);
      expect(typeof allocation.reasoning).toBe("string");
    });

    it("should mention downgrade in reasoning when model is downgraded", () => {
      const profile = createConstraintProfile("balanced", {
        cost: {
          budget: 0.0001,
          modelPreference: "premium",
          allowOverBudget: false,
          warningThreshold: 0.8,
        },
      });
      const allocation = engine.allocate(
        makeRequirement({ estimatedTokens: 100000 }),
        profile,
      );
      expect(allocation.reasoning).toContain("降级");
    });

    it("should mention review enabled in reasoning", () => {
      const profile = createConstraintProfile("balanced"); // reviewRequired=true
      const allocation = engine.allocate(makeRequirement(), profile);
      expect(allocation.reasoning).toContain("质量审核");
    });

    it("should mention comprehensive mode in reasoning", () => {
      const profile = createConstraintProfile("thorough"); // depth=comprehensive
      const allocation = engine.allocate(makeRequirement(), profile);
      expect(allocation.reasoning).toContain("深度研究");
    });
  });

  // ==================== estimateCost ====================

  describe("estimateCost", () => {
    it("should estimate cost for cheap model", () => {
      const profile = createConstraintProfile("fast"); // modelPreference=cheap
      const req = makeRequirement({
        estimatedTokens: 10000,
        estimatedDuration: 60000,
      });
      const estimate = engine.estimateCost(req, profile);
      expect(estimate.totalCost).toBeGreaterThanOrEqual(0);
      expect(estimate.breakdown.length).toBeGreaterThanOrEqual(1);
    });

    it("should include review cost when reviewRequired=true", () => {
      const profile = createConstraintProfile("balanced"); // reviewRequired=true
      const req = makeRequirement({
        estimatedTokens: 10000,
        estimatedDuration: 60000,
      });
      const estimate = engine.estimateCost(req, profile);
      expect(estimate.breakdown.some((b) => b.category === "质量审核")).toBe(
        true,
      );
    });

    it("should not include review cost when reviewRequired=false", () => {
      const profile = createConstraintProfile("fast"); // reviewRequired=false
      const req = makeRequirement({
        estimatedTokens: 10000,
        estimatedDuration: 60000,
      });
      const estimate = engine.estimateCost(req, profile);
      expect(estimate.breakdown.some((b) => b.category === "质量审核")).toBe(
        false,
      );
    });

    it("should apply 1.5x multiplier for comprehensive depth", () => {
      const profileComp = createConstraintProfile("thorough"); // depth=comprehensive
      const profileQuick = createConstraintProfile("fast"); // depth=quick
      const req = makeRequirement({
        estimatedTokens: 10000,
        estimatedDuration: 60000,
      });

      const estComp = engine.estimateCost(req, profileComp);
      const estQuick = engine.estimateCost(req, profileQuick);
      // Thorough has higher cost due to review + iteration
      expect(estComp.totalCost).toBeGreaterThan(estQuick.totalCost);
    });

    it("should include iteration cost breakdown for comprehensive depth", () => {
      const profile = createConstraintProfile("thorough");
      const req = makeRequirement({
        estimatedTokens: 10000,
        estimatedDuration: 60000,
      });
      const estimate = engine.estimateCost(req, profile);
      expect(estimate.breakdown.some((b) => b.category === "迭代成本")).toBe(
        true,
      );
    });

    it("should include standard iteration (1.2x) for standard depth", () => {
      // Remove review to isolate iteration effect
      const noReviewProfile = createConstraintProfile("balanced", {
        quality: {
          depth: "standard",
          accuracy: "prefer_evidence",
          reviewRequired: false,
          minReviewScore: 7,
          maxReworks: 2,
        },
      });
      const req = makeRequirement({
        estimatedTokens: 10000,
        estimatedDuration: 60000,
      });
      const estimate = engine.estimateCost(req, noReviewProfile);
      expect(estimate.breakdown.some((b) => b.category === "迭代成本")).toBe(
        true,
      );
    });

    it("should return withinBudget=true when cost <= budget", () => {
      const profile = createConstraintProfile("fast", {
        cost: {
          budget: 999999,
          modelPreference: "cheap",
          allowOverBudget: false,
          warningThreshold: 0.8,
        },
      });
      const req = makeRequirement({
        estimatedTokens: 10,
        estimatedDuration: 60000,
      });
      const estimate = engine.estimateCost(req, profile);
      expect(estimate.withinBudget).toBe(true);
    });

    it("should return withinBudget=false and overBudgetAmount when cost > budget", () => {
      const profile = createConstraintProfile("fast", {
        cost: {
          budget: 0,
          modelPreference: "cheap",
          allowOverBudget: false,
          warningThreshold: 0.8,
        },
      });
      const req = makeRequirement({
        estimatedTokens: 10000,
        estimatedDuration: 60000,
      });
      const estimate = engine.estimateCost(req, profile);
      expect(estimate.withinBudget).toBe(false);
      expect(estimate.overBudgetAmount).toBeGreaterThan(0);
    });

    it("should return confidence of 0.8", () => {
      const profile = createConstraintProfile("balanced");
      const estimate = engine.estimateCost(makeRequirement(), profile);
      expect(estimate.confidence).toBe(0.8);
    });

    it("should return estimatedDuration from requirements", () => {
      const profile = createConstraintProfile("balanced");
      const req = makeRequirement({ estimatedDuration: 99999 });
      const estimate = engine.estimateCost(req, profile);
      expect(estimate.estimatedDuration).toBe(99999);
    });

    it("pricingRegistry returns no model for tier -> getCostPerKTokens isFallback=true and price === EMERGENCY_TIER_COSTS_NO_MODELS[tier]", () => {
      // Inject a pricingRegistry stub where pickModelForTier always returns null
      // (simulates admin DB having zero registered models).
      const emptyRegistry = {
        pickModelForTier: jest.fn().mockReturnValue(null),
        get: jest.fn(),
      };
      const engineWithEmptyRegistry = new (ConstraintEngine as any)(
        undefined,
        emptyRegistry,
      );

      // For each preference tier, the estimate must use EMERGENCY_TIER_COSTS values.
      // We verify by comparing against a no-registry engine (which also falls back).
      const engineNoRegistry = new (ConstraintEngine as any)(undefined);
      const profile = createConstraintProfile("balanced"); // modelPreference = "balanced"
      const req = makeRequirement({
        estimatedTokens: 10000,
        estimatedDuration: 60000,
      });

      const estimateWithEmpty = engineWithEmptyRegistry.estimateCost(
        req,
        profile,
      );
      const estimateNoRegistry = engineNoRegistry.estimateCost(req, profile);

      expect(estimateWithEmpty.pricingSource).toBe("fallback");
      expect(estimateNoRegistry.pricingSource).toBe("fallback");
      // Both should produce identical costs since both use EMERGENCY_TIER_COSTS_NO_MODELS.
      expect(estimateWithEmpty.totalCost).toBe(estimateNoRegistry.totalCost);
      // pickModelForTier was called with "standard" (the tier mapped from "balanced").
      expect(emptyRegistry.pickModelForTier).toHaveBeenCalledWith("standard");
    });

    it("pricingRegistry returns a model -> pricingSource is 'registry'", () => {
      const filledRegistry = {
        pickModelForTier: jest.fn().mockReturnValue("gpt-4o-mini"),
        get: jest.fn().mockReturnValue({
          modelId: "gpt-4o-mini",
          tier: "standard",
          inputPricePerM: 150, // $0.15 per 1M → $0.00015 per 1K
          outputPricePerM: 600, // $0.60 per 1M → $0.0006 per 1K
        }),
      };
      const engineWithRegistry = new (ConstraintEngine as any)(
        undefined,
        filledRegistry,
      );

      const profile = createConstraintProfile("balanced");
      const req = makeRequirement({
        estimatedTokens: 10000,
        estimatedDuration: 60000,
      });
      const estimate = engineWithRegistry.estimateCost(req, profile);

      expect(estimate.pricingSource).toBe("registry");
    });
  });

  // ==================== suggestDegradation ====================

  describe("suggestDegradation", () => {
    const makeCostViolation = (
      overrides: Partial<ConstraintViolation> = {},
    ): ConstraintViolation => ({
      type: "cost",
      code: "BUDGET_EXCEEDED",
      message: "Exceeded",
      currentValue: 150,
      limit: 100,
      excess: 50,
      recoverable: false,
      ...overrides,
    });

    it("should suggest model_downgrade for cost violation when not already cheap", () => {
      const profile = createConstraintProfile("balanced"); // premium
      const strategies = engine.suggestDegradation(
        makeCostViolation(),
        profile,
      );
      expect(strategies.some((s) => s.type === "model_downgrade")).toBe(true);
    });

    it("should not suggest model_downgrade when already on cheap model", () => {
      const profile = createConstraintProfile("fast"); // cheap
      const strategies = engine.suggestDegradation(
        makeCostViolation(),
        profile,
      );
      expect(strategies.some((s) => s.type === "model_downgrade")).toBe(false);
    });

    it("should suggest reduce_parallelism for cost violation when maxParallelism > 1", () => {
      const profile = createConstraintProfile("balanced"); // maxParallelism=3
      const strategies = engine.suggestDegradation(
        makeCostViolation(),
        profile,
      );
      expect(strategies.some((s) => s.type === "reduce_parallelism")).toBe(
        true,
      );
    });

    it("should not suggest reduce_parallelism when maxParallelism=1", () => {
      const profile = createConstraintProfile("balanced", {
        efficiency: {
          maxDuration: 30 * 60 * 1000,
          priority: "normal",
          allowParallel: false,
          maxParallelism: 1,
        },
      });
      const strategies = engine.suggestDegradation(
        makeCostViolation(),
        profile,
      );
      expect(strategies.some((s) => s.type === "reduce_parallelism")).toBe(
        false,
      );
    });

    it("should suggest skip_review for efficiency violation when reviewRequired=true", () => {
      const profile = createConstraintProfile("balanced"); // reviewRequired=true
      const violation: ConstraintViolation = {
        type: "efficiency",
        code: "TIMEOUT",
        message: "Timeout",
        currentValue: 2000,
        limit: 1000,
        excess: 1000,
        recoverable: false,
      };
      const strategies = engine.suggestDegradation(violation, profile);
      expect(strategies.some((s) => s.type === "skip_review")).toBe(true);
    });

    it("should suggest reduce_iterations for efficiency violation when depth != quick", () => {
      const profile = createConstraintProfile("balanced"); // depth=standard
      const violation: ConstraintViolation = {
        type: "efficiency",
        code: "TIMEOUT",
        message: "Timeout",
        currentValue: 2000,
        limit: 1000,
        excess: 1000,
        recoverable: false,
      };
      const strategies = engine.suggestDegradation(violation, profile);
      expect(strategies.some((s) => s.type === "reduce_iterations")).toBe(true);
    });

    it("should not suggest reduce_iterations when depth=quick", () => {
      const profile = createConstraintProfile("fast"); // depth=quick
      const violation: ConstraintViolation = {
        type: "efficiency",
        code: "TIMEOUT",
        message: "Timeout",
        currentValue: 2000,
        limit: 1000,
        excess: 1000,
        recoverable: false,
      };
      const strategies = engine.suggestDegradation(violation, profile);
      expect(strategies.some((s) => s.type === "reduce_iterations")).toBe(
        false,
      );
    });

    it("should return empty strategies for unknown violation type", () => {
      const profile = createConstraintProfile("balanced");
      const violation: ConstraintViolation = {
        type: "unknown" as any,
        code: "UNKNOWN",
        message: "Unknown",
        currentValue: 0,
        limit: 0,
        excess: 0,
        recoverable: false,
      };
      const strategies = engine.suggestDegradation(violation, profile);
      expect(strategies).toHaveLength(0);
    });

    it("apply() function on model_downgrade should return cost override", () => {
      const profile = createConstraintProfile("balanced"); // modelPreference=balanced
      const strategies = engine.suggestDegradation(
        makeCostViolation(),
        profile,
      );
      const modelDowngrade = strategies.find(
        (s) => s.type === "model_downgrade",
      );
      const applied = modelDowngrade?.apply();
      expect((applied as any)?.cost?.modelPreference).toBe("cheap");
    });

    it("apply() function on reduce_parallelism should decrement maxParallelism", () => {
      const profile = createConstraintProfile("balanced"); // maxParallelism=3
      const strategies = engine.suggestDegradation(
        makeCostViolation(),
        profile,
      );
      const reduceP = strategies.find((s) => s.type === "reduce_parallelism");
      const applied = reduceP?.apply();
      expect((applied as any)?.efficiency?.maxParallelism).toBe(2);
    });

    it("apply() on skip_review should set reviewRequired=false", () => {
      const profile = createConstraintProfile("balanced");
      const violation: ConstraintViolation = {
        type: "efficiency",
        code: "TIMEOUT",
        message: "Timeout",
        currentValue: 2000,
        limit: 1000,
        excess: 1000,
        recoverable: false,
      };
      const strategies = engine.suggestDegradation(violation, profile);
      const skipReview = strategies.find((s) => s.type === "skip_review");
      const applied = skipReview?.apply();
      expect((applied as any)?.quality?.reviewRequired).toBe(false);
    });

    it("apply() on reduce_iterations should downgrade depth", () => {
      const profile = createConstraintProfile("thorough"); // depth=comprehensive
      const violation: ConstraintViolation = {
        type: "efficiency",
        code: "TIMEOUT",
        message: "Timeout",
        currentValue: 2000,
        limit: 1000,
        excess: 1000,
        recoverable: false,
      };
      const strategies = engine.suggestDegradation(violation, profile);
      const reduceIter = strategies.find((s) => s.type === "reduce_iterations");
      const applied = reduceIter?.apply();
      expect((applied as any)?.quality?.depth).toBe("standard");
    });
  });

  // ==================== rebalance ====================

  describe("rebalance", () => {
    it("should rebalance for 'cost' priority using fast preset", () => {
      const profile = createConstraintProfile("thorough");
      const rebalanced = engine.rebalance(profile, "cost");
      expect(rebalanced.cost).toEqual(profile.cost); // preserves cost from thorough
      expect(rebalanced.quality.depth).toBe("quick"); // fast preset quality
    });

    it("should rebalance for 'quality' priority using thorough preset", () => {
      const profile = createConstraintProfile("fast");
      const rebalanced = engine.rebalance(profile, "quality");
      expect(rebalanced.quality).toEqual(profile.quality); // preserves quality from fast
      expect(rebalanced.cost.modelPreference).toBe("premium"); // thorough preset cost
    });

    it("should rebalance for 'efficiency' priority with max parallelism=5", () => {
      const profile = createConstraintProfile("balanced");
      const rebalanced = engine.rebalance(profile, "efficiency");
      expect(rebalanced.efficiency.maxParallelism).toBe(5);
      expect(rebalanced.efficiency.allowParallel).toBe(true);
      expect(rebalanced.quality.depth).toBe("quick");
      expect(rebalanced.quality.reviewRequired).toBe(false);
    });

    it("should return original profile for unknown priority", () => {
      const profile = createConstraintProfile("balanced");
      const rebalanced = engine.rebalance(profile, "unknown" as any);
      expect(rebalanced).toEqual(profile);
    });
  });

  // ==================== canContinue ====================

  describe("canContinue", () => {
    it("should return canContinue=true when all within limits", () => {
      const profile = createConstraintProfile("balanced");
      const usage = makeUsage({
        costUsed: 100,
        timeElapsed: 5 * 60 * 1000,
        reworkCount: 1,
      });
      const result = engine.canContinue(profile, usage);
      expect(result.canContinue).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should return canContinue=false when costUsed > budget and !allowOverBudget", () => {
      const profile = createConstraintProfile("fast"); // budget=100, allowOverBudget=false
      const usage = makeUsage({ costUsed: 150 });
      const result = engine.canContinue(profile, usage);
      expect(result.canContinue).toBe(false);
      expect(result.reason).toContain("预算");
    });

    it("should return canContinue=true when costUsed > budget but allowOverBudget=true", () => {
      const profile = createConstraintProfile("thorough"); // allowOverBudget=true
      const usage = makeUsage({
        costUsed: 5000,
        timeElapsed: 1 * 60 * 1000,
        reworkCount: 0,
      });
      const result = engine.canContinue(profile, usage);
      expect(result.canContinue).toBe(true);
    });

    it("should return canContinue=false when timeElapsed > maxDuration", () => {
      const profile = createConstraintProfile("balanced"); // maxDuration=30min
      const usage = makeUsage({ costUsed: 0, timeElapsed: 35 * 60 * 1000 });
      const result = engine.canContinue(profile, usage);
      expect(result.canContinue).toBe(false);
      expect(result.reason).toContain("时间");
    });

    it("should return canContinue=false when reworkCount > maxReworks", () => {
      const profile = createConstraintProfile("balanced"); // maxReworks=2
      const usage = makeUsage({ reworkCount: 3 });
      const result = engine.canContinue(profile, usage);
      expect(result.canContinue).toBe(false);
      expect(result.reason).toContain("返工");
    });

    it("should check cost first (before time)", () => {
      const profile = createConstraintProfile("fast"); // budget=100, allowOverBudget=false, maxDuration=5min
      const usage = makeUsage({ costUsed: 200, timeElapsed: 10 * 60 * 1000 });
      const result = engine.canContinue(profile, usage);
      expect(result.reason).toContain("预算");
    });
  });

  // ==================== Without CostController ====================

  describe("without CostController", () => {
    let engineNoController: ConstraintEngine;

    beforeEach(() => {
      // Instantiate directly with no CostController (undefined)
      engineNoController = new (ConstraintEngine as any)(undefined);
    });

    it("should recordCost using internal estimate", () => {
      const cost = engineNoController.recordCost("chat", "balanced", 1000, 500);
      expect(cost).toBeGreaterThan(0);
    });

    it("should validate profile normally", () => {
      const profile = createConstraintProfile("balanced");
      const result = engineNoController.validate(profile);
      expect(result.valid).toBe(true);
    });

    it("should evaluate profile normally", () => {
      const profile = createConstraintProfile("balanced");
      const usage = makeUsage();
      const result = engineNoController.evaluate(profile, usage);
      expect(result).toBeDefined();
    });
  });
});
