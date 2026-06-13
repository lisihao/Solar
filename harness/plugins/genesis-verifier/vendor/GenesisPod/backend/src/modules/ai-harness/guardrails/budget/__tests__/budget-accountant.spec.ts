import { BudgetAccountant } from "../budget-accountant";

describe("BudgetAccountant", () => {
  function make(maxTokens = 1000, maxCostUsd = 10) {
    return new BudgetAccountant({ maxTokens, maxCostUsd });
  }

  describe("exhausted()", () => {
    it("is false initially", () => {
      expect(make().exhausted()).toBe(false);
    });

    it("is true when tokens used >= maxTokens", () => {
      const acc = make(100, 99);
      acc.accountLLM(100, 0, 0);
      expect(acc.exhausted()).toBe(true);
    });

    it("is true when cost >= maxCostUsd", () => {
      const acc = make(99999, 5);
      acc.accountLLM(0, 0, 5);
      expect(acc.exhausted()).toBe(true);
    });
  });

  describe("shouldDowngrade()", () => {
    it("is false when under 70%", () => {
      const acc = make(1000, 100);
      acc.accountLLM(500, 0, 0);
      expect(acc.shouldDowngrade()).toBe(false);
    });

    it("is true when tokens exceed 70%", () => {
      const acc = make(1000, 100);
      acc.accountLLM(700, 0, 0);
      expect(acc.shouldDowngrade()).toBe(true);
    });

    it("is true when cost exceeds 70%", () => {
      const acc = make(99999, 10);
      acc.accountLLM(0, 0, 7.5);
      expect(acc.shouldDowngrade()).toBe(true);
    });
  });

  describe("nearLimit()", () => {
    it("is false well under the threshold", () => {
      const acc = make(1000, 100);
      acc.accountLLM(500, 0, 0); // 50%
      expect(acc.nearLimit()).toBe(false);
    });

    it("is true at/over the default 85% threshold (tokens)", () => {
      const acc = make(1000, 100);
      acc.accountLLM(900, 0, 0); // 90%
      expect(acc.nearLimit()).toBe(true);
    });

    it("is true near the cost limit", () => {
      const acc = make(99999, 10);
      acc.accountLLM(0, 0, 9); // 90% of cost
      expect(acc.nearLimit()).toBe(true);
    });

    it("respects a custom ratio", () => {
      const acc = make(1000, 100);
      acc.accountLLM(600, 0, 0); // 60%
      expect(acc.nearLimit(0.5)).toBe(true);
      expect(acc.nearLimit(0.9)).toBe(false);
    });

    it("is false once exhausted (that is a hard stop, not an early warning)", () => {
      const acc = make(1000, 100);
      acc.accountLLM(1000, 0, 0); // exhausted
      expect(acc.exhausted()).toBe(true);
      expect(acc.nearLimit()).toBe(false);
    });
  });

  describe("canDowngrade() / downgrade()", () => {
    it("can downgrade from strong", () => {
      const acc = make();
      expect(acc.canDowngrade()).toBe(true);
      expect(acc.downgrade()).toBe("standard");
    });

    it("can downgrade from standard to basic", () => {
      const acc = make();
      acc.downgrade(); // strong -> standard
      expect(acc.canDowngrade()).toBe(true);
      expect(acc.downgrade()).toBe("basic");
    });

    it("cannot downgrade from basic", () => {
      const acc = make();
      acc.downgrade(); // -> standard
      acc.downgrade(); // -> basic
      expect(acc.canDowngrade()).toBe(false);
    });
  });

  describe("accountLLM()", () => {
    it("accumulates tokens including cache reads", () => {
      const acc = make();
      acc.accountLLM(100, 50, 0.01, 20);
      const snap = acc.snapshot();
      expect(snap.tokensUsed).toBe(170); // 100+50+20
      expect(snap.costUsd).toBeCloseTo(0.01);
    });

    it("increments uncostedLLMCalls when costUsd is null", () => {
      const acc = make();
      acc.accountLLM(100, 50, null);
      expect(acc.snapshot().uncostedLLMCalls).toBe(1);
      acc.accountLLM(10, 5, null);
      expect(acc.snapshot().uncostedLLMCalls).toBe(2);
    });

    it("does not add cost when costUsd is null", () => {
      const acc = make();
      acc.accountLLM(100, 50, null);
      expect(acc.snapshot().costUsd).toBe(0);
    });
  });

  describe("accountTool()", () => {
    it("adds tool cost", () => {
      const acc = make();
      acc.accountTool(1.5);
      expect(acc.snapshot().costUsd).toBeCloseTo(1.5);
    });

    it("does nothing when costUsd is null", () => {
      const acc = make();
      acc.accountTool(null);
      expect(acc.snapshot().costUsd).toBe(0);
    });
  });

  describe("getCurrentTier()", () => {
    it("starts at strong", () => {
      expect(make().getCurrentTier()).toBe("strong");
    });
  });

  describe("snapshot() / restore()", () => {
    it("round-trips snapshot", () => {
      const acc = make();
      acc.accountLLM(300, 100, 2);
      acc.downgrade();
      const snap = acc.snapshot();

      const acc2 = make();
      acc2.restore(snap);
      const snap2 = acc2.snapshot();

      expect(snap2.tokensUsed).toBe(snap.tokensUsed);
      expect(snap2.costUsd).toBe(snap.costUsd);
      expect(snap2.currentTier).toBe(snap.currentTier);
    });

    it("restore handles missing uncostedLLMCalls", () => {
      const acc = make();
      acc.restore({
        tokensUsed: 100,
        costUsd: 1,
        currentTier: "basic",
        uncostedLLMCalls: undefined,
      });
      expect(acc.snapshot().uncostedLLMCalls).toBe(0);
    });
  });
});
