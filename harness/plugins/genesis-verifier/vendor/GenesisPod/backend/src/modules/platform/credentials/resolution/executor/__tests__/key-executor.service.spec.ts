import { Test, TestingModule } from "@nestjs/testing";
import {
  KeyErrorClassifier,
  KeyHealthStore,
} from "@/modules/platform/credentials/governance/key-health";
import {
  KeyChain,
  KeyResolverService,
  ResolvedKey,
} from "../../key-resolver/key-resolver.service";
import { NoAvailableKeyError } from "../../key-resolver/key-resolver.errors";
import {
  AllKeysFailedError,
  ProviderCooldownError,
} from "../key-executor.errors";
import { KeyExecutorService } from "../key-executor.service";

function buildResolvedKey(
  label: string,
  source: "PERSONAL" | "ASSIGNED" = "PERSONAL",
): ResolvedKey {
  return {
    source,
    apiKey: `sk-${label}`,
    apiEndpoint: null,
    provider: "openai",
    userId: "u1",
    label,
    healthKeyId: `personal:u1:openai:${label}`,
  };
}

function buildChain(keys: ResolvedKey[]): KeyChain & {
  reportFailure: jest.Mock;
  reportSuccess: jest.Mock;
} {
  let cursor = 0;
  let tried = 0;
  return {
    get size() {
      return keys.length;
    },
    get triedCount() {
      return tried;
    },
    next: jest.fn(async () => {
      if (cursor >= keys.length) return null;
      tried++;
      return keys[cursor++];
    }),
    reportFailure: jest.fn().mockResolvedValue(undefined),
    reportSuccess: jest.fn().mockResolvedValue(undefined),
  };
}

describe("KeyExecutorService", () => {
  let executor: KeyExecutorService;
  let resolver: jest.Mocked<Partial<KeyResolverService>>;
  let healthStore: jest.Mocked<Partial<KeyHealthStore>>;

  beforeEach(async () => {
    resolver = {
      resolveKeyChain: jest.fn(),
    };
    healthStore = {
      isProviderCooldown: jest.fn().mockResolvedValue(false),
      getProviderCooldownMs: jest.fn().mockResolvedValue(0),
      setProviderCooldown: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeyExecutorService,
        KeyErrorClassifier,
        { provide: KeyResolverService, useValue: resolver },
        { provide: KeyHealthStore, useValue: healthStore },
      ],
    }).compile();
    executor = module.get(KeyExecutorService);
  });

  describe("happy path", () => {
    it("calls callFn with single healthy key and returns result", async () => {
      const k = buildResolvedKey("default");
      const chain = buildChain([k]);
      (resolver.resolveKeyChain as jest.Mock).mockResolvedValue(chain);
      const callFn = jest.fn().mockResolvedValue("OK");

      const result = await executor.execute("u1", "openai", callFn);

      expect(result).toBe("OK");
      expect(callFn).toHaveBeenCalledTimes(1);
      expect(callFn).toHaveBeenCalledWith(k);
      expect(chain.reportSuccess).toHaveBeenCalledWith(k);
      expect(chain.reportFailure).not.toHaveBeenCalled();
    });
  });

  describe("provider cooldown short-circuit", () => {
    it("throws ProviderCooldownError (with remainingMs) when in cooldown; never calls callFn", async () => {
      (healthStore.getProviderCooldownMs as jest.Mock).mockResolvedValue(
        60_000,
      );
      const callFn = jest.fn();

      await expect(
        executor.execute("u1", "openai", callFn),
      ).rejects.toMatchObject({ remainingMs: 60_000 });
      await expect(executor.execute("u1", "openai", callFn)).rejects.toThrow(
        ProviderCooldownError,
      );
      expect(callFn).not.toHaveBeenCalled();
      expect(resolver.resolveKeyChain).not.toHaveBeenCalled();
    });
  });

  describe("empty chain", () => {
    it("throws NoAvailableKeyError when chain.size === 0", async () => {
      const chain = buildChain([]);
      (resolver.resolveKeyChain as jest.Mock).mockResolvedValue(chain);
      const callFn = jest.fn();

      await expect(executor.execute("u1", "openai", callFn)).rejects.toThrow(
        NoAvailableKeyError,
      );
      expect(callFn).not.toHaveBeenCalled();
    });
  });

  describe("failover scenarios", () => {
    it("first key 401 → second key succeeds → reportFailure(first) + reportSuccess(second)", async () => {
      const k1 = buildResolvedKey("default");
      const k2 = buildResolvedKey("backup");
      const chain = buildChain([k1, k2]);
      (resolver.resolveKeyChain as jest.Mock).mockResolvedValue(chain);

      const callFn = jest
        .fn()
        .mockRejectedValueOnce({ status: 401, message: "Unauthorized" })
        .mockResolvedValueOnce("OK");

      const result = await executor.execute("u1", "openai", callFn);

      expect(result).toBe("OK");
      expect(callFn).toHaveBeenCalledTimes(2);
      expect(chain.reportFailure).toHaveBeenCalledWith(
        k1,
        expect.objectContaining({ reason: "AUTH_FAILED" }),
      );
      expect(chain.reportSuccess).toHaveBeenCalledWith(k2);
    });

    it("first 429 + second 401 → both reportFailure → AllKeysFailedError", async () => {
      const k1 = buildResolvedKey("a");
      const k2 = buildResolvedKey("b");
      const chain = buildChain([k1, k2]);
      (resolver.resolveKeyChain as jest.Mock).mockResolvedValue(chain);

      const callFn = jest
        .fn()
        .mockRejectedValueOnce({ status: 429, message: "rate limit" })
        .mockRejectedValueOnce({ status: 401, message: "Unauthorized" });

      await expect(executor.execute("u1", "openai", callFn)).rejects.toThrow(
        AllKeysFailedError,
      );
      expect(callFn).toHaveBeenCalledTimes(2);
      expect(chain.reportFailure).toHaveBeenCalledTimes(2);
      expect(chain.reportSuccess).not.toHaveBeenCalled();
    });

    it("5xx → shouldStopChain → break + setProviderCooldown + does not try next key", async () => {
      const k1 = buildResolvedKey("a");
      const k2 = buildResolvedKey("b");
      const chain = buildChain([k1, k2]);
      (resolver.resolveKeyChain as jest.Mock).mockResolvedValue(chain);

      const callFn = jest
        .fn()
        .mockRejectedValue({ status: 502, message: "Bad Gateway" });

      // 5xx is RETHROW + shouldStopChain — the original error is rethrown, NOT AllKeysFailedError
      await expect(
        executor.execute("u1", "openai", callFn),
      ).rejects.toMatchObject({ status: 502 });
      expect(callFn).toHaveBeenCalledTimes(1);
      expect(healthStore.setProviderCooldown).toHaveBeenCalledWith(
        "openai",
        5 * 60_000,
      );
    });

    it("ECONNRESET on first key → break + setProviderCooldown + rethrows original error", async () => {
      const k1 = buildResolvedKey("a");
      const chain = buildChain([k1]);
      (resolver.resolveKeyChain as jest.Mock).mockResolvedValue(chain);

      const callFn = jest.fn().mockRejectedValue(new Error("ECONNRESET"));

      await expect(executor.execute("u1", "openai", callFn)).rejects.toThrow(
        "ECONNRESET",
      );
      expect(callFn).toHaveBeenCalledTimes(1);
      expect(healthStore.setProviderCooldown).toHaveBeenCalled();
    });

    it("timeout on first key → tries second key (NEXT_KEY)", async () => {
      const k1 = buildResolvedKey("a");
      const k2 = buildResolvedKey("b");
      const chain = buildChain([k1, k2]);
      (resolver.resolveKeyChain as jest.Mock).mockResolvedValue(chain);

      const callFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("ETIMEDOUT"))
        .mockResolvedValueOnce("OK");

      const result = await executor.execute("u1", "openai", callFn);
      expect(result).toBe("OK");
      expect(callFn).toHaveBeenCalledTimes(2);
    });

    it("UNKNOWN error → RETHROW, original thrown directly (no wrapping)", async () => {
      const k1 = buildResolvedKey("a");
      const k2 = buildResolvedKey("b");
      const chain = buildChain([k1, k2]);
      (resolver.resolveKeyChain as jest.Mock).mockResolvedValue(chain);

      const weirdError = new Error("Something completely unexpected");
      const callFn = jest.fn().mockRejectedValue(weirdError);

      await expect(executor.execute("u1", "openai", callFn)).rejects.toThrow(
        "Something completely unexpected",
      );
      expect(callFn).toHaveBeenCalledTimes(1); // 不试第二把
    });

    it("quota exceeded on first → try second key (NEXT_KEY, no markDead)", async () => {
      const k1 = buildResolvedKey("a", "ASSIGNED");
      const k2 = buildResolvedKey("b");
      const chain = buildChain([k1, k2]);
      (resolver.resolveKeyChain as jest.Mock).mockResolvedValue(chain);

      const callFn = jest
        .fn()
        .mockRejectedValueOnce({
          status: 402,
          message: "insufficient_quota",
        })
        .mockResolvedValueOnce("OK");

      const result = await executor.execute("u1", "openai", callFn);
      expect(result).toBe("OK");
      expect(chain.reportFailure).toHaveBeenCalledWith(
        k1,
        expect.objectContaining({ reason: "QUOTA_EXCEEDED", markDead: false }),
      );
    });
  });

  describe("single-key cooldown relaxation (2026-05-22)", () => {
    it("caps a long provider cooldown to 30s when chain has a single key", async () => {
      const k1 = buildResolvedKey("only");
      const chain = buildChain([k1]); // size === 1
      (resolver.resolveKeyChain as jest.Mock).mockResolvedValue(chain);
      // 502 → shouldStopChain, classified cooldown 5min; single-key → capped to 30s
      const callFn = jest
        .fn()
        .mockRejectedValue({ status: 502, message: "Bad Gateway" });

      await expect(
        executor.execute("u1", "openai", callFn),
      ).rejects.toMatchObject({ status: 502 });
      expect(healthStore.setProviderCooldown).toHaveBeenCalledWith(
        "openai",
        30_000,
      );
    });
  });

  describe("per-provider concurrency throttle (2026-05-22)", () => {
    it("caps concurrent in-flight calls per provider but completes all", async () => {
      let inFlight = 0;
      let peak = 0;
      (resolver.resolveKeyChain as jest.Mock).mockImplementation(async () =>
        buildChain([buildResolvedKey("k")]),
      );
      const callFn = jest.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        return "OK";
      });

      const results = await Promise.all(
        Array.from({ length: 15 }, () =>
          executor.execute("u1", "openai", callFn),
        ),
      );

      expect(results).toHaveLength(15);
      expect(results.every((r) => r === "OK")).toBe(true);
      // default LLM_PROVIDER_MAX_CONCURRENCY = 6
      expect(peak).toBeLessThanOrEqual(6);
      // sanity: still actually concurrent, not serialized to 1
      expect(peak).toBeGreaterThan(1);
    });
  });

  describe("AllKeysFailedError details", () => {
    it("AllKeysFailedError contains lastError reason + triedCount", async () => {
      const k1 = buildResolvedKey("a");
      const k2 = buildResolvedKey("b");
      const chain = buildChain([k1, k2]);
      (resolver.resolveKeyChain as jest.Mock).mockResolvedValue(chain);

      const callFn = jest
        .fn()
        .mockRejectedValueOnce({ status: 429, message: "rate" })
        .mockRejectedValueOnce({ status: 401, message: "Unauthorized" });

      try {
        await executor.execute("u1", "openai", callFn);
        fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AllKeysFailedError);
        const meta = (e as AllKeysFailedError).meta;
        expect(meta.triedCount).toBe(2);
        expect(meta.lastReason).toBe("AUTH_FAILED");
        expect(meta.provider).toBe("openai");
      }
    });
  });
});
