/**
 * ConcurrencyPlanner — branch coverage supplement
 *
 * Targets uncovered branches:
 *   b0  default-arg line=50  (opts={} → min/max/boost defaults)
 *   b1  binary-expr line=51  (opts.min ?? 4 — null path)
 *   b2  binary-expr line=52  (opts.max ?? 8 — null path)
 *   b3  binary-expr line=53  (opts.perProviderBoost ?? 2 — null path)
 *   b4  if line=57 (userOverride != null, valid)
 *   b5  if line=58 (userOverride invalid)
 *   b6  binary-expr line=58 (userOverride < 1 || !isFinite)
 *   b7  cond-expr line=92 (fallback branch when getAvailableModels throws)
 */

import { ConcurrencyPlanner } from "../resources/concurrency-planner.service";

function makeChatFacade(models: { provider: string }[] | Error): {
  getAvailableModels: jest.Mock;
} {
  const facade = { getAvailableModels: jest.fn() };
  if (models instanceof Error) {
    facade.getAvailableModels.mockRejectedValue(models);
  } else {
    facade.getAvailableModels.mockResolvedValue(models);
  }
  return facade;
}

describe("ConcurrencyPlanner", () => {
  describe("plan() — defaults", () => {
    it("uses default min=4, max=8, boost=2 when opts is empty", async () => {
      const facade = makeChatFacade([{ provider: "openai" }]);
      const planner = new ConcurrencyPlanner(facade as any);
      const plan = await planner.plan();
      expect(plan.source).toBe("matrix");
      expect(plan.concurrency).toBe(4);
    });

    it("uses explicit min/max/boost when provided", async () => {
      const facade = makeChatFacade([
        { provider: "openai" },
        { provider: "anthropic" },
      ]);
      const planner = new ConcurrencyPlanner(facade as any);
      const plan = await planner.plan({ min: 2, max: 10, perProviderBoost: 3 });
      expect(plan.concurrency).toBe(5);
      expect(plan.providerCount).toBe(2);
    });

    it("opts.min=null coalesces to 4", async () => {
      const facade = makeChatFacade([{ provider: "openai" }]);
      const planner = new ConcurrencyPlanner(facade as any);
      const plan = await planner.plan({
        min: undefined,
        max: undefined,
        perProviderBoost: undefined,
      });
      expect(plan.concurrency).toBe(4);
    });
  });

  describe("plan() — userOverride", () => {
    it("valid userOverride returns user-override source and clamped concurrency", async () => {
      const facade = makeChatFacade([]);
      const planner = new ConcurrencyPlanner(facade as any);
      const plan = await planner.plan({ userOverride: 5 });
      expect(plan.source).toBe("user-override");
      expect(plan.concurrency).toBe(5);
      expect(plan.providerCount).toBe(0);
      expect(facade.getAvailableModels).not.toHaveBeenCalled();
    });

    it("userOverride is clamped to max", async () => {
      const facade = makeChatFacade([]);
      const planner = new ConcurrencyPlanner(facade as any);
      const plan = await planner.plan({ userOverride: 100, max: 8 });
      expect(plan.concurrency).toBe(8);
    });

    it("userOverride=0 throws (< 1 branch)", async () => {
      const facade = makeChatFacade([]);
      const planner = new ConcurrencyPlanner(facade as any);
      await expect(planner.plan({ userOverride: 0 })).rejects.toThrow(
        "userOverride 必须 ≥ 1",
      );
    });

    it("userOverride=-1 throws", async () => {
      const facade = makeChatFacade([]);
      const planner = new ConcurrencyPlanner(facade as any);
      await expect(planner.plan({ userOverride: -1 })).rejects.toThrow();
    });

    it("userOverride=Infinity throws (!isFinite branch)", async () => {
      const facade = makeChatFacade([]);
      const planner = new ConcurrencyPlanner(facade as any);
      await expect(planner.plan({ userOverride: Infinity })).rejects.toThrow();
    });
  });

  describe("plan() — matrix", () => {
    it("3 unique providers → concurrency = min + (3-1)*boost", async () => {
      const facade = makeChatFacade([
        { provider: "openai" },
        { provider: "anthropic" },
        { provider: "google" },
      ]);
      const planner = new ConcurrencyPlanner(facade as any);
      const plan = await planner.plan();
      expect(plan.providerCount).toBe(3);
      expect(plan.concurrency).toBe(8);
      expect(plan.source).toBe("matrix");
    });

    it("duplicate providers counted once", async () => {
      const facade = makeChatFacade([
        { provider: "openai" },
        { provider: "openai" },
      ]);
      const planner = new ConcurrencyPlanner(facade as any);
      const plan = await planner.plan();
      expect(plan.providerCount).toBe(1);
      expect(plan.concurrency).toBe(4);
    });
  });

  describe("plan() — fallback on error", () => {
    it("getAvailableModels throws → fallback with min concurrency", async () => {
      const facade = makeChatFacade(new Error("service down"));
      const planner = new ConcurrencyPlanner(facade as any);
      const plan = await planner.plan({ min: 3 });
      expect(plan.source).toBe("fallback");
      expect(plan.concurrency).toBe(3);
      expect(plan.providerCount).toBe(0);
    });

    it("fallback error message is non-Error object string", async () => {
      const facade = {
        getAvailableModels: jest.fn().mockRejectedValue("plain string error"),
      };
      const planner = new ConcurrencyPlanner(facade as any);
      const plan = await planner.plan();
      expect(plan.source).toBe("fallback");
    });
  });
});
