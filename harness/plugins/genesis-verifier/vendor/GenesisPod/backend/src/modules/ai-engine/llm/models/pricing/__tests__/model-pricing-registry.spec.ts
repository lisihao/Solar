import { ModelPricingRegistry } from "../model-pricing.registry";

describe("ModelPricingRegistry", () => {
  function make() {
    // Pass undefined prisma (optional) — test mode only
    return new ModelPricingRegistry(undefined);
  }

  describe("register / get", () => {
    it("registers and retrieves a model", () => {
      const reg = make();
      reg.register({
        modelId: "gpt-4o",
        tier: "strong",
        inputPricePerM: 5,
        outputPricePerM: 15,
      });
      const p = reg.get("gpt-4o");
      expect(p).not.toBeNull();
      expect(p!.tier).toBe("strong");
    });

    it("returns null for unregistered model", () => {
      expect(make().get("unknown")).toBeNull();
    });

    it("does not duplicate modelId in tier list", () => {
      const reg = make();
      reg.register({
        modelId: "gpt-4o",
        tier: "strong",
        inputPricePerM: 5,
        outputPricePerM: 15,
      });
      reg.register({
        modelId: "gpt-4o",
        tier: "strong",
        inputPricePerM: 6,
        outputPricePerM: 16,
      });
      const list = reg.list();
      expect(list.filter((m) => m.modelId === "gpt-4o").length).toBe(1);
    });
  });

  describe("estimateCost", () => {
    it("calculates cost correctly", () => {
      const reg = make();
      reg.register({
        modelId: "m1",
        tier: "standard",
        inputPricePerM: 1,
        outputPricePerM: 2,
      });
      // 500k input tokens + 200k output tokens
      const cost = reg.estimateCost("m1", 500_000, 200_000);
      expect(cost).toBeCloseTo(0.5 + 0.4); // 0.9
    });

    it("returns null for unknown model (no silent zero)", () => {
      const reg = make();
      const cost = reg.estimateCost("unknown", 1000, 500);
      expect(cost).toBeNull();
    });

    it("calculates with cacheRead tokens", () => {
      const reg = make();
      reg.register({
        modelId: "m1",
        tier: "strong",
        inputPricePerM: 10,
        outputPricePerM: 20,
        cacheReadPricePerM: 1,
      });
      // 1000 prompt, 100 cache-read, 500 completion
      const cost = reg.estimateCost("m1", 1000, 500, 100);
      // netInput = 900, output = 500, cacheRead = 100
      const expected = (900 / 1e6) * 10 + (500 / 1e6) * 20 + (100 / 1e6) * 1;
      expect(cost).toBeCloseTo(expected);
    });

    it("calculates with cacheWrite tokens", () => {
      const reg = make();
      reg.register({
        modelId: "claude-3-5",
        tier: "strong",
        inputPricePerM: 3,
        outputPricePerM: 15,
        cacheReadPricePerM: 0.3,
        cacheWritePricePerM: 3.75,
      });
      // 1000 prompt, 200 cache-read, 100 cache-write, 500 completion
      const cost = reg.estimateCost("claude-3-5", 1000, 500, 200, 100);
      // netInput = 1000 - 200 = 800
      const expected =
        (800 / 1e6) * 3 +
        (500 / 1e6) * 15 +
        (200 / 1e6) * 0.3 +
        (100 / 1e6) * 3.75;
      expect(cost).toBeCloseTo(expected);
    });

    it("excludes cacheWrite cost when cacheWritePricePerM is not set", () => {
      const reg = make();
      reg.register({
        modelId: "gpt-4o-no-write",
        tier: "strong",
        inputPricePerM: 5,
        outputPricePerM: 15,
      });
      // 1000 prompt, 0 cache-read, 100 cache-write — no write price configured
      const cost = reg.estimateCost("gpt-4o-no-write", 1000, 500, 0, 100);
      // cacheWriteTokens > 0 but no cacheWritePricePerM → write cost is 0
      const expected = (1000 / 1e6) * 5 + (500 / 1e6) * 15;
      expect(cost).toBeCloseTo(expected);
    });

    it("only warns once per unknown modelId", () => {
      const reg = make();
      reg.estimateCost("ghost", 100, 50);
      reg.estimateCost("ghost", 100, 50);
      // Should not throw — warning is de-duped internally
    });

    it("returns null for registered-but-unpriced model (tier set, prices missing in DB)", () => {
      const reg = make();
      // hydrateFromDb 对 priceInput/Output 均为 null 的行注册 unpriced:true（0 价占位）
      reg.register({
        modelId: "deepseek-v4-flash",
        tier: "standard",
        inputPricePerM: 0,
        outputPricePerM: 0,
        unpriced: true,
      });
      expect(reg.estimateCost("deepseek-v4-flash", 31_087, 3_381)).toBeNull();
      // unpriced 标记经 get() 暴露给 cost 面板（显示「未计价」而非 $0）
      expect(reg.get("deepseek-v4-flash")!.unpriced).toBe(true);
      // tier 仍可用于 downgrade 选型
      expect(reg.pickModelForTier("standard")).toBe("deepseek-v4-flash");
    });

    it("explicit zero price WITHOUT unpriced flag still computes $0 (genuinely free model)", () => {
      const reg = make();
      reg.register({
        modelId: "local-llama",
        tier: "basic",
        inputPricePerM: 0,
        outputPricePerM: 0,
      });
      expect(reg.estimateCost("local-llama", 1000, 500)).toBe(0);
    });
  });

  describe("pickModelForTier", () => {
    it("picks first model in tier", () => {
      const reg = make();
      reg.register({
        modelId: "a",
        tier: "basic",
        inputPricePerM: 0.5,
        outputPricePerM: 1,
      });
      reg.register({
        modelId: "b",
        tier: "basic",
        inputPricePerM: 0.5,
        outputPricePerM: 1,
      });
      expect(reg.pickModelForTier("basic")).toBe("a");
    });

    it("returns null when no models for tier", () => {
      expect(make().pickModelForTier("strong")).toBeNull();
    });
  });

  describe("promoteToPrimary", () => {
    it("promotes model to first in tier", () => {
      const reg = make();
      reg.register({
        modelId: "a",
        tier: "strong",
        inputPricePerM: 5,
        outputPricePerM: 15,
      });
      reg.register({
        modelId: "b",
        tier: "strong",
        inputPricePerM: 5,
        outputPricePerM: 15,
      });
      reg.promoteToPrimary("strong", "b");
      expect(reg.pickModelForTier("strong")).toBe("b");
    });

    it("throws if model not registered before promotion", () => {
      const reg = make();
      expect(() => reg.promoteToPrimary("strong", "ghost")).toThrow();
    });
  });

  describe("list()", () => {
    it("returns all registered models", () => {
      const reg = make();
      reg.register({
        modelId: "m1",
        tier: "strong",
        inputPricePerM: 5,
        outputPricePerM: 15,
      });
      reg.register({
        modelId: "m2",
        tier: "basic",
        inputPricePerM: 0.5,
        outputPricePerM: 1,
      });
      expect(reg.list().length).toBe(2);
    });
  });

  describe("onApplicationBootstrap", () => {
    it("warns and returns early when prisma is missing", async () => {
      const reg = make();
      // No prisma -> should complete without throwing
      await expect(reg.onApplicationBootstrap()).resolves.toBeUndefined();
    });

    it("hydrates from db with mock prisma", async () => {
      const mockPrisma = {
        aIModel: {
          findMany: jest.fn().mockResolvedValue([
            {
              modelId: "gpt-4o",
              costTier: "strong",
              priceInputPerMillion: "5",
              priceOutputPerMillion: "15",
              priceCacheReadPerMillion: null,
              priceCacheWritePerMillion: null,
            },
            {
              modelId: "gpt-3.5",
              costTier: null,
              priceInputPerMillion: "0.5",
              priceOutputPerMillion: "1",
              priceCacheReadPerMillion: null,
              priceCacheWritePerMillion: null,
            },
            {
              modelId: "bad-tier",
              costTier: "invalid",
              priceInputPerMillion: "1",
              priceOutputPerMillion: "2",
              priceCacheReadPerMillion: null,
              priceCacheWritePerMillion: null,
            },
          ]),
        },
      };
      const reg = new ModelPricingRegistry(mockPrisma as never);
      await reg.onApplicationBootstrap();
      expect(reg.get("gpt-4o")).not.toBeNull();
      // null costTier is skipped
      expect(reg.get("gpt-3.5")).toBeNull();
      // invalid tier is skipped
      expect(reg.get("bad-tier")).toBeNull();
    });

    it("hydrates cacheWrite price from db when set", async () => {
      const mockPrisma = {
        aIModel: {
          findMany: jest.fn().mockResolvedValue([
            {
              modelId: "claude-3-opus",
              costTier: "strong",
              priceInputPerMillion: "15",
              priceOutputPerMillion: "75",
              priceCacheReadPerMillion: "1.5",
              priceCacheWritePerMillion: "18.75",
            },
          ]),
        },
      };
      const reg = new ModelPricingRegistry(mockPrisma as never);
      await reg.onApplicationBootstrap();
      const entry = reg.get("claude-3-opus");
      expect(entry).not.toBeNull();
      expect(entry!.cacheWritePricePerM).toBeCloseTo(18.75);
      // 100 cache-write tokens should be costed
      const cost = reg.estimateCost("claude-3-opus", 1000, 500, 0, 100);
      expect(cost).not.toBeNull();
      expect(cost!).toBeGreaterThan(0);
      const expected =
        (1000 / 1e6) * 15 + (500 / 1e6) * 75 + (100 / 1e6) * 18.75;
      expect(cost).toBeCloseTo(expected);
    });

    it("handles db error gracefully", async () => {
      const mockPrisma = {
        aIModel: {
          findMany: jest.fn().mockRejectedValue(new Error("DB error")),
        },
      };
      const reg = new ModelPricingRegistry(mockPrisma as never);
      await expect(reg.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(reg.list().length).toBe(0);
    });
  });
});
