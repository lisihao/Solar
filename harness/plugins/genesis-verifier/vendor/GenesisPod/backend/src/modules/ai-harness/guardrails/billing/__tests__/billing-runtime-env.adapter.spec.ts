import { BillingRuntimeEnvAdapter } from "../billing-adapter";
import { CREDITS_TO_TOKENS } from "../../budget/resolved-budget-caps";
import type { CacheService } from "../../../../../common/cache/cache.service";

function makeCredits(balance = 1000, todaySpent = 100) {
  return {
    getBalance: jest.fn().mockResolvedValue({ balance, todaySpent }),
  };
}

function makeRuntimeEnv(
  opts: {
    hasByok?: boolean;
    sharedKeyAvailable?: boolean;
    models?: Record<
      string,
      Array<{ modelId: string; healthy: string; costTier: string }>
    >;
  } = {},
) {
  const snap = {
    userKeys: {
      hasByok: opts.hasByok ?? false,
      sharedKeyAvailable: opts.sharedKeyAvailable ?? false,
    },
    models: opts.models ?? {},
  };
  return { snapshot: jest.fn().mockResolvedValue(snap) };
}

/**
 * In-memory CacheService mock that behaves like real get/set/del.
 * Used to verify the Redis-backed disabledModels path.
 */
function makeCacheService(): jest.Mocked<
  Pick<CacheService, "get" | "set" | "del">
> {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn().mockImplementation(async (key: string) => store.get(key)),
    set: jest.fn().mockImplementation(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: jest.fn().mockImplementation(async (key: string) => {
      store.delete(key);
    }),
  } as jest.Mocked<Pick<CacheService, "get" | "set" | "del">>;
}

describe("BillingRuntimeEnvAdapter", () => {
  describe("getByokStatus", () => {
    it("returns platform when no byok or shared key", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      expect(await adapter.getByokStatus()).toBe("platform");
    });

    it("returns personal when hasByok", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv({ hasByok: true }) as never,
      );
      expect(await adapter.getByokStatus()).toBe("personal");
    });

    it("returns assigned when sharedKeyAvailable", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv({ sharedKeyAvailable: true }) as never,
      );
      expect(await adapter.getByokStatus()).toBe("assigned");
    });
  });

  describe("getCreditState", () => {
    it("returns balance with thresholds", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits(800) as never,
        makeRuntimeEnv() as never,
      );
      const state = await adapter.getCreditState();
      expect(state.balance).toBe(800);
      expect(state.softLimit).toBe(500);
      expect(state.hardLimit).toBe(100);
      expect(state.currency).toBe("credit");
    });
  });

  describe("getUserEntitlements", () => {
    it("returns public entitlement by default", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      const ent = await adapter.getUserEntitlements();
      expect(ent.keys).toContain("public");
    });

    it("adds image.generation when hasByok", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv({ hasByok: true }) as never,
      );
      const ent = await adapter.getUserEntitlements();
      expect(ent.keys).toContain("image.generation");
    });

    it("fails closed when runtimeEnv throws", async () => {
      const failingEnv = {
        snapshot: jest.fn().mockRejectedValue(new Error("fail")),
      };
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        failingEnv as never,
      );
      const ent = await adapter.getUserEntitlements();
      expect(ent.keys).toEqual(["public"]);
    });
  });

  describe("getModelAvailability", () => {
    it("returns available=true for healthy model", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv({
          models: {
            pool: [
              { modelId: "gpt-4o", healthy: "healthy", costTier: "strong" },
            ],
          },
        }) as never,
      );
      const avail = await adapter.getModelAvailability("gpt-4o");
      expect(avail.available).toBe(true);
    });

    it("returns unavailable for unhealthy model with sibling fallback", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv({
          models: {
            pool: [
              { modelId: "gpt-4o", healthy: "unhealthy", costTier: "strong" },
              {
                modelId: "gpt-4-turbo",
                healthy: "healthy",
                costTier: "strong",
              },
            ],
          },
        }) as never,
      );
      const avail = await adapter.getModelAvailability("gpt-4o");
      expect(avail.available).toBe(false);
      expect(avail.fallbackTo).toContain("gpt-4-turbo");
    });

    it("returns not_subscribed for unknown model", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      const avail = await adapter.getModelAvailability("unknown-model");
      expect(avail.available).toBe(false);
      expect(avail.unavailableReason).toBe("not_subscribed");
    });

    it("returns disabled model from local disabledModels (no cache)", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      await adapter.markModelDisabled("gpt-4o", "claude-3");
      const avail = await adapter.getModelAvailability("gpt-4o");
      expect(avail.available).toBe(false);
      expect(avail.fallbackTo).toEqual(["claude-3"]);
    });

    it("returns disabled model from Redis disabledModels (with cache)", async () => {
      const cache = makeCacheService();
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
        cache as never,
      );
      await adapter.markModelDisabled("gpt-4o", "claude-3");
      // Verify data was written to Redis (set was called with the map)
      expect(cache.set).toHaveBeenCalled();
      const avail = await adapter.getModelAvailability("gpt-4o");
      expect(avail.available).toBe(false);
      expect(avail.fallbackTo).toEqual(["claude-3"]);
    });

    it("returns available for unknown health model (not unhealthy)", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv({
          models: {
            pool: [
              { modelId: "gpt-4o", healthy: "unknown", costTier: "strong" },
            ],
          },
        }) as never,
      );
      const avail = await adapter.getModelAvailability("gpt-4o");
      expect(avail.available).toBe(true);
    });
  });

  describe("markModelDisabled / getDisabledModels — local (no CacheService)", () => {
    it("tracks disabled models in local store", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      await adapter.markModelDisabled("m1", "m2");
      const map = await adapter.getDisabledModels();
      expect(map.get("m1")).toBe("m2");
    });

    it("overwrites existing entry with new fallback", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      await adapter.markModelDisabled("m1", "m2");
      await adapter.markModelDisabled("m1", "m3");
      const map = await adapter.getDisabledModels();
      expect(map.get("m1")).toBe("m3");
    });

    it("tracks multiple disabled models independently", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      await adapter.markModelDisabled("modelA", "fallbackA");
      await adapter.markModelDisabled("modelB", "fallbackB");
      const map = await adapter.getDisabledModels();
      expect(map.get("modelA")).toBe("fallbackA");
      expect(map.get("modelB")).toBe("fallbackB");
      expect(map.size).toBe(2);
    });
  });

  describe("markModelDisabled / getDisabledModels — Redis (with CacheService)", () => {
    it("persists disabled models to Redis", async () => {
      const cache = makeCacheService();
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
        cache as never,
      );
      await adapter.markModelDisabled("gpt-4o", "claude-3");
      // set must have been called (Redis write)
      expect(cache.set).toHaveBeenCalledTimes(1);
      const [key, value] = (cache.set as jest.Mock).mock.calls[0] as [
        string,
        Record<string, string>,
        number,
      ];
      expect(key).toMatch(/^harness:billing:disabled-models:/);
      expect(value["gpt-4o"]).toBe("claude-3");
    });

    it("reads back from Redis across calls", async () => {
      const cache = makeCacheService();
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
        cache as never,
      );
      await adapter.markModelDisabled("gpt-4o", "claude-3");
      const map = await adapter.getDisabledModels();
      // value comes from Redis store, not written by same mock call
      expect(map.get("gpt-4o")).toBe("claude-3");
    });

    it("two adapter instances use isolated Redis keys", async () => {
      const cache = makeCacheService();
      const adapterA = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
        cache as never,
      );
      const adapterB = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
        cache as never,
      );
      await adapterA.markModelDisabled("gpt-4o", "fallback-a");
      await adapterB.markModelDisabled("gpt-4o", "fallback-b");

      const mapA = await adapterA.getDisabledModels();
      const mapB = await adapterB.getDisabledModels();
      expect(mapA.get("gpt-4o")).toBe("fallback-a");
      expect(mapB.get("gpt-4o")).toBe("fallback-b");
    });

    it("applies TTL of 4h when writing to Redis", async () => {
      const cache = makeCacheService();
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
        cache as never,
      );
      await adapter.markModelDisabled("m1", "m2");
      const ttlArg = (cache.set as jest.Mock).mock.calls[0][2] as number;
      expect(ttlArg).toBe(4 * 3600);
    });
  });

  describe("invalidateBalanceCache", () => {
    it("invalidates cache so next call re-queries", async () => {
      const credits = makeCredits(1000);
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        credits as never,
        makeRuntimeEnv() as never,
      );
      await adapter.getCreditState();
      adapter.invalidateBalanceCache();
      await adapter.getCreditState();
      expect(credits.getBalance).toHaveBeenCalledTimes(2);
    });
  });

  describe("listAvailableModels", () => {
    it("lists all models from pools", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv({
          models: {
            pool: [
              { modelId: "gpt-4o", healthy: "healthy", costTier: "strong" },
              {
                modelId: "gpt-3.5-turbo",
                healthy: "unhealthy",
                costTier: "basic",
              },
            ],
          },
        }) as never,
      );
      const models = await adapter.listAvailableModels();
      expect(models.length).toBe(2);
      const healthy = models.find((m) => m.modelId === "gpt-4o");
      expect(healthy?.available).toBe(true);
      const unhealthy = models.find((m) => m.modelId === "gpt-3.5-turbo");
      expect(unhealthy?.available).toBe(false);
    });
  });

  describe("estimateAffordable", () => {
    it("returns proceed when balance is sufficient", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits(5000) as never,
        makeRuntimeEnv() as never,
      );
      const result = await adapter.estimateAffordable({ maxTokens: 1000 });
      expect(result.suggestion).toBe("proceed");
      expect(result.affordable).toBe(true);
    });

    it("returns downgrade when balance covers half", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits(3) as never,
        makeRuntimeEnv() as never,
      );
      // 5000 tokens = 5 credits, balance 3 >= 5/2=2.5
      const result = await adapter.estimateAffordable({ maxTokens: 5000 });
      expect(result.suggestion).toBe("downgrade");
      expect(result.affordable).toBe(false);
    });

    it("returns abort when balance is very low", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits(1) as never,
        makeRuntimeEnv() as never,
      );
      const result = await adapter.estimateAffordable({ maxTokens: 10000 });
      expect(result.suggestion).toBe("abort");
    });

    it("handles maxTokens=0", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits(100) as never,
        makeRuntimeEnv() as never,
      );
      const result = await adapter.estimateAffordable({ maxTokens: 0 });
      expect(result.suggestion).toBe("proceed");
    });

    it("BYOK (personal): affordable=true without consulting balance even at zero balance", async () => {
      const credits = makeCredits(0); // 平台余额为 0
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        credits as never,
        makeRuntimeEnv({ hasByok: true }) as never,
      );
      const result = await adapter.estimateAffordable({ maxTokens: 100_000 });
      expect(result.affordable).toBe(true);
      expect(result.suggestion).toBe("proceed");
      expect(result.shortfall).toBe(0);
      // 不该查 balance —— BYOK 花自己 key 的钱
      expect(credits.getBalance).not.toHaveBeenCalled();
      // estimatedCredits 仍正确计算供展示
      expect(result.estimatedCredits).toBe(100_000 / CREDITS_TO_TOKENS);
    });

    it("platform (no byok): still gated by balance (abort at zero balance)", async () => {
      const credits = makeCredits(0);
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        credits as never,
        makeRuntimeEnv({ hasByok: false }) as never,
      );
      const result = await adapter.estimateAffordable({ maxTokens: 100_000 });
      expect(result.affordable).toBe(false);
      expect(result.suggestion).toBe("abort");
      // 平台用户必须查 balance
      expect(credits.getBalance).toHaveBeenCalled();
    });

    it("assigned (shared key, not personal): still gated by balance", async () => {
      const credits = makeCredits(0);
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        credits as never,
        makeRuntimeEnv({ sharedKeyAvailable: true }) as never,
      );
      const result = await adapter.estimateAffordable({ maxTokens: 100_000 });
      // 'assigned' 不是 'personal'，仍走平台余额判定
      expect(result.affordable).toBe(false);
      expect(credits.getBalance).toHaveBeenCalled();
    });

    it("R2-#45: estimatedCredits uses CREDITS_TO_TOKENS constant (not raw /1000 literal)", async () => {
      // CREDITS_TO_TOKENS = 1000 currently, but the invariant we protect is that
      // estimatedCredits = ceil(maxTokens / CREDITS_TO_TOKENS) — if the constant
      // ever changes the arithmetic must stay consistent.
      const balance = 5;
      const maxTokens = 3 * CREDITS_TO_TOKENS; // exactly 3 credits
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits(balance) as never,
        makeRuntimeEnv() as never,
      );
      const result = await adapter.estimateAffordable({ maxTokens });
      expect(result.estimatedCredits).toBe(3);
      expect(result.affordable).toBe(true); // balance 5 >= 3
    });
  });

  describe("getQuotaSnapshot", () => {
    it("returns quota snapshot from balance", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits(500, 50) as never,
        makeRuntimeEnv() as never,
      );
      const snap = await adapter.getQuotaSnapshot();
      expect(snap.daily_credit?.used).toBe(50);
    });
  });

  describe("suggestFallback", () => {
    it("returns notify_user when no_credit and balance critical", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits(50) as never,
        makeRuntimeEnv() as never,
      );
      const hint = await adapter.suggestFallback({ reason: "no_credit" });
      expect(hint.action).toBe("notify_user");
    });

    it("returns downgrade when no_credit but balance above critical", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits(200) as never,
        makeRuntimeEnv() as never,
      );
      const hint = await adapter.suggestFallback({ reason: "no_credit" });
      expect(hint.action).toBe("downgrade");
    });

    it("returns retry for rate_limit", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      const hint = await adapter.suggestFallback({ reason: "rate_limit" });
      expect(hint.action).toBe("retry");
    });

    it("returns downgrade for outage with sibling model", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv({
          models: {
            pool: [
              { modelId: "gpt-4o", healthy: "unhealthy", costTier: "strong" },
              {
                modelId: "gpt-4-turbo",
                healthy: "healthy",
                costTier: "strong",
              },
            ],
          },
        }) as never,
      );
      const hint = await adapter.suggestFallback({
        reason: "outage",
        failedModelId: "gpt-4o",
      });
      expect(hint.action).toBe("downgrade");
      expect(hint.fallbackModelId).toBe("gpt-4-turbo");
    });

    it("returns abort for context_too_long", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      const hint = await adapter.suggestFallback({
        reason: "context_too_long",
      });
      expect(hint.action).toBe("abort");
    });

    it("returns abort for no_quota", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      const hint = await adapter.suggestFallback({ reason: "no_quota" });
      expect(hint.action).toBe("abort");
    });

    it("returns downgrade/abort for safety_refusal with non-reasoning candidate", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv({
          models: {
            pool: [
              { modelId: "gpt-4o", healthy: "healthy", costTier: "strong" },
            ],
          },
        }) as never,
      );
      const hint = await adapter.suggestFallback({
        reason: "safety_refusal",
        failedModelId: "o1-mini",
      });
      expect(["downgrade", "abort"]).toContain(hint.action);
    });

    it("returns abort for reasoning_exhaustion with no candidate", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      const hint = await adapter.suggestFallback({
        reason: "reasoning_exhaustion",
        failedModelId: "o1",
      });
      expect(hint.action).toBe("abort");
    });

    it("returns retry for truncated", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      const hint = await adapter.suggestFallback({ reason: "truncated" });
      expect(hint.action).toBe("retry");
    });

    it("returns retry for parse_failure", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      const hint = await adapter.suggestFallback({ reason: "parse_failure" });
      expect(hint.action).toBe("retry");
    });

    it("returns downgrade for model_not_found with sibling", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv({
          models: {
            pool: [
              { modelId: "gpt-4o", healthy: "healthy", costTier: "strong" },
              {
                modelId: "gpt-4-turbo",
                healthy: "healthy",
                costTier: "strong",
              },
            ],
          },
        }) as never,
      );
      const hint = await adapter.suggestFallback({
        reason: "model_not_found",
        failedModelId: "gpt-4o",
      });
      expect(hint.action).toBe("downgrade");
    });

    it("returns abort for model_not_found with no sibling", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      const hint = await adapter.suggestFallback({
        reason: "model_not_found",
        failedModelId: "gpt-4o",
      });
      expect(hint.action).toBe("abort");
    });

    it("returns retry for tool_failure", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      const hint = await adapter.suggestFallback({ reason: "tool_failure" });
      expect(hint.action).toBe("retry");
    });

    it("returns retry for verifier_low_score", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      const hint = await adapter.suggestFallback({
        reason: "verifier_low_score",
      });
      expect(hint.action).toBe("retry");
    });

    it("returns retry for schema_mismatch", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      const hint = await adapter.suggestFallback({ reason: "schema_mismatch" });
      expect(hint.action).toBe("retry");
    });

    it("returns abort for unknown reason", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      const hint = await adapter.suggestFallback({
        reason: "unknown_reason_xyz",
      });
      expect(hint.action).toBe("abort");
    });

    it("returns abort for empty_response with no non-reasoning model", async () => {
      const adapter = new BillingRuntimeEnvAdapter(
        "u1",
        undefined,
        makeCredits() as never,
        makeRuntimeEnv() as never,
      );
      const hint = await adapter.suggestFallback({ reason: "empty_response" });
      expect(hint.action).toBe("abort");
    });
  });
});
