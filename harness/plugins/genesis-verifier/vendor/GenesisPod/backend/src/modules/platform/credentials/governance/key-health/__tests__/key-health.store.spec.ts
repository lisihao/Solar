import { CacheService } from "@/common/cache";
import {
  KeyHealthStore,
  buildPersonalKeyId,
  parseKeyId,
} from "../key-health.store";
import { ClassifiedError } from "../key-error-classifier";

/**
 * In-memory CacheService stub — 模拟 nestjs cache-manager 行为，避免依赖 Redis。
 * 提供 store.keys 实现以测试 account-wide 429 启发式。
 */
function createStubCache(): CacheService & {
  __dump: () => Map<string, unknown>;
} {
  const map = new Map<string, { value: unknown; expiresAt: number }>();
  const expired = (k: string) => {
    const v = map.get(k);
    if (!v) return true;
    if (v.expiresAt > 0 && v.expiresAt < Date.now()) {
      map.delete(k);
      return true;
    }
    return false;
  };
  const stub: Record<string, unknown> = {
    get: jest.fn(async (k: string) => {
      if (expired(k)) return undefined;
      return map.get(k)?.value;
    }),
    set: jest.fn(async (k: string, v: unknown, ttlSeconds: number) => {
      map.set(k, {
        value: v,
        expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0,
      });
    }),
    del: jest.fn(async (k: string) => {
      map.delete(k);
    }),
    cacheManager: {
      stores: [
        {
          keys: async (pattern: string) => {
            const prefix = pattern.replace(/\*$/, "");
            return Array.from(map.keys()).filter(
              (k) => !expired(k) && k.startsWith(prefix),
            );
          },
        },
      ],
    },
    __dump: () => new Map([...map].map(([k, v]) => [k, v.value])),
  };
  return stub as unknown as CacheService & {
    __dump: () => Map<string, unknown>;
  };
}

const userId = "user-1";
const provider = "openai";

const authFailedClassified: ClassifiedError = {
  action: "NEXT_KEY",
  reason: "AUTH_FAILED",
  cooldownMs: Number.POSITIVE_INFINITY,
  markDead: true,
  shouldStopChain: false,
  originalMessage: "Unauthorized",
  httpStatus: 401,
};

const rateLimitClassified: ClassifiedError = {
  action: "NEXT_KEY",
  reason: "RATE_LIMIT_KEY",
  cooldownMs: 60_000,
  markDead: false,
  shouldStopChain: false,
  originalMessage: "rate limited",
  httpStatus: 429,
};

describe("KeyHealthStore", () => {
  let store: KeyHealthStore;
  let cache: ReturnType<typeof createStubCache>;

  beforeEach(() => {
    cache = createStubCache();
    store = new KeyHealthStore(cache);
  });

  describe("filterUsable", () => {
    it("returns all keyIds when no records", async () => {
      const out = await store.filterUsable([
        "personal:u1:openai:a",
        "personal:u1:openai:b",
      ]);
      expect(out).toEqual(["personal:u1:openai:a", "personal:u1:openai:b"]);
    });

    it("filters out DEAD keys (after AUTH_DEAD_THRESHOLD consecutive 401s)", async () => {
      // 单次 401 只是 COOLDOWN；连续 3 次才升级 DEAD（防偶发 401 误杀有效 key）
      for (let i = 0; i < 3; i++) {
        await store.markFailure("personal:u1:openai:a", authFailedClassified);
      }
      const out = await store.filterUsable([
        "personal:u1:openai:a",
        "personal:u1:openai:b",
      ]);
      expect(out).toEqual(["personal:u1:openai:b"]);
    });

    it("filters out COOLDOWN keys when other healthy keys exist", async () => {
      await store.markFailure("personal:u1:openai:a", rateLimitClassified);
      const out = await store.filterUsable([
        "personal:u1:openai:a",
        "personal:u1:openai:b",
      ]);
      expect(out).toEqual(["personal:u1:openai:b"]);
    });

    it("returns COOLDOWN key after cooldown expires", async () => {
      jest.useFakeTimers();
      const now = Date.now();
      jest.setSystemTime(now);
      await store.markFailure("personal:u1:openai:a", rateLimitClassified);
      // advance past 60s
      jest.setSystemTime(now + 61_000);
      const out = await store.filterUsable(["personal:u1:openai:a"]);
      // record state still says COOLDOWN until > now+60s; check post-expiry
      expect(out).toEqual(["personal:u1:openai:a"]);
      jest.useRealTimers();
    });

    // ★ 2026-05-13 P0-#2 degraded fallback：单 key 用户偶发 timeout/rate-limit
    // 不能让 cooldown 窗口把整 user 锁死。全 cooldown 时返回 cooldownUntil 最早
    // 结束的那个，让 caller retry（接 P0-#1 timeout 修复后大概率 retry 成功）。
    it("degraded fallback: single key + cooldown returns the key (avoid lockout)", async () => {
      await store.markFailure("personal:u1:openai:a", rateLimitClassified);
      const out = await store.filterUsable(["personal:u1:openai:a"]);
      expect(out).toEqual(["personal:u1:openai:a"]);
    });

    it("degraded fallback: all keys cooldown → returns earliest-expiry", async () => {
      jest.useFakeTimers();
      const now = Date.now();
      jest.setSystemTime(now);
      await store.markFailure(
        "personal:u1:openai:a",
        rateLimitClassified, // 60s cooldown
      );
      jest.setSystemTime(now + 30_000); // a 的 cooldown 还剩 30s
      const timeoutClassified: ClassifiedError = {
        action: "NEXT_KEY",
        reason: "TIMEOUT",
        cooldownMs: 30_000,
        markDead: false,
        shouldStopChain: false,
        originalMessage: "timeout",
      };
      await store.markFailure("personal:u1:openai:b", timeoutClassified);
      // a expires at now+60s, b expires at now+60s（30s+30s），实际两者相等
      // 但 a 的 record 是先写的, cooldownUntil 早 30s — a 应该被选中
      const out = await store.filterUsable([
        "personal:u1:openai:a",
        "personal:u1:openai:b",
      ]);
      expect(out).toHaveLength(1);
      expect(out[0]).toBe("personal:u1:openai:a");
      jest.useRealTimers();
    });

    it("single 401 → key stays usable via finite cooldown (not instant DEAD)", async () => {
      // ★ Fix1: 偶发 401 只给 60s finite cooldown → 单 key 用户仍能被 degraded fallback 兜底
      await store.markFailure("personal:u1:openai:a", authFailedClassified);
      const out = await store.filterUsable(["personal:u1:openai:a"]);
      expect(out).toEqual(["personal:u1:openai:a"]);
    });

    it("single DEAD key returned as last-resort fallback (avoid single-key lockout)", async () => {
      // ★ Fix3: 唯一一把 key 即便升级 DEAD，仍作为最后手段返回，避免无备用 key 用户被锁死
      for (let i = 0; i < 3; i++) {
        await store.markFailure("personal:u1:openai:a", authFailedClassified);
      }
      expect((await store.get("personal:u1:openai:a")).state).toBe("DEAD");
      const out = await store.filterUsable(["personal:u1:openai:a"]);
      expect(out).toEqual(["personal:u1:openai:a"]);
    });

    it("multi-key all DEAD → returns [] (last-resort only for single-key users)", async () => {
      for (let i = 0; i < 3; i++) {
        await store.markFailure("personal:u1:openai:a", authFailedClassified);
        await store.markFailure("personal:u1:openai:b", authFailedClassified);
      }
      const out = await store.filterUsable([
        "personal:u1:openai:a",
        "personal:u1:openai:b",
      ]);
      expect(out).toEqual([]);
    });

    it("degraded fallback: permanent cooldown (QUOTA_EXCEEDED) excluded", async () => {
      const quotaClassified: ClassifiedError = {
        action: "NEXT_KEY",
        reason: "QUOTA_EXCEEDED",
        cooldownMs: Number.POSITIVE_INFINITY,
        markDead: false,
        shouldStopChain: false,
        originalMessage: "insufficient quota",
        httpStatus: 402,
      };
      await store.markFailure("personal:u1:openai:a", quotaClassified);
      const out = await store.filterUsable(["personal:u1:openai:a"]);
      expect(out).toEqual([]);
    });
  });

  describe("markFailure / markSuccess state machine", () => {
    it("single 401 → COOLDOWN (transient, not DEAD) with finite ~60s cooldown", async () => {
      const keyId = buildPersonalKeyId(userId, provider, "default");
      const before = Date.now();
      await store.markFailure(keyId, authFailedClassified);
      const rec = await store.get(keyId);
      expect(rec.state).toBe("COOLDOWN");
      expect(rec.cooldownUntil).toBeGreaterThanOrEqual(before + 60_000 - 100);
      expect(rec.cooldownUntil).toBeLessThanOrEqual(before + 60_000 + 1000);
      expect(rec.failureCount).toBe(1);
      expect(rec.authFailureCount).toBe(1);
      expect(rec.lastReason).toBe("AUTH_FAILED");
    });

    it("3 consecutive 401s → DEAD with cooldownUntil = MAX_SAFE_INTEGER", async () => {
      const keyId = buildPersonalKeyId(userId, provider, "default");
      for (let i = 0; i < 3; i++) {
        await store.markFailure(keyId, authFailedClassified);
      }
      const rec = await store.get(keyId);
      expect(rec.state).toBe("DEAD");
      expect(rec.cooldownUntil).toBe(Number.MAX_SAFE_INTEGER);
      expect(rec.authFailureCount).toBe(3);
      expect(rec.lastReason).toBe("AUTH_FAILED");
    });

    it("a non-auth failure resets the auth-failure streak (no premature DEAD)", async () => {
      const keyId = buildPersonalKeyId(userId, provider, "default");
      await store.markFailure(keyId, authFailedClassified); // authStreak=1
      await store.markFailure(keyId, authFailedClassified); // authStreak=2
      await store.markFailure(keyId, rateLimitClassified); // resets streak → 0
      await store.markFailure(keyId, authFailedClassified); // authStreak=1 again
      const rec = await store.get(keyId);
      expect(rec.state).not.toBe("DEAD");
      expect(rec.authFailureCount).toBe(1);
    });

    it("429 → COOLDOWN with cooldownUntil ≈ now + 60s", async () => {
      const keyId = buildPersonalKeyId(userId, provider, "default");
      const before = Date.now();
      await store.markFailure(keyId, rateLimitClassified);
      const rec = await store.get(keyId);
      expect(rec.state).toBe("COOLDOWN");
      expect(rec.cooldownUntil).toBeGreaterThanOrEqual(before + 60_000 - 100);
      expect(rec.cooldownUntil).toBeLessThanOrEqual(before + 60_000 + 1000);
    });

    it("markSuccess resets state to HEALTHY + sets LastGood", async () => {
      const keyId = buildPersonalKeyId(userId, provider, "default");
      await store.markFailure(keyId, rateLimitClassified);
      await store.markSuccess(keyId);
      const rec = await store.get(keyId);
      expect(rec.state).toBe("HEALTHY");
      expect(rec.failureCount).toBe(0);
      expect(rec.lastSuccessAt).not.toBeNull();
      // LastGood should be set
      const last = await store.getLastGood(userId, provider);
      expect(last).toBe(keyId);
    });

    it("single 401 keeps LastGood; only DEAD escalation clears it", async () => {
      const keyId = buildPersonalKeyId(userId, provider, "default");
      await store.markSuccess(keyId);
      expect(await store.getLastGood(userId, provider)).toBe(keyId);

      // 单次 401 → COOLDOWN，LastGood 保留（key 可能很快自愈）
      await store.markFailure(keyId, authFailedClassified);
      expect(await store.getLastGood(userId, provider)).toBe(keyId);

      // 再 2 次（streak 累计到 3）→ 升级 DEAD → 清掉 LastGood
      await store.markFailure(keyId, authFailedClassified);
      await store.markFailure(keyId, authFailedClassified);
      expect((await store.get(keyId)).state).toBe("DEAD");
      expect(await store.getLastGood(userId, provider)).toBeNull();
    });

    it("forceHealthy resets DEAD → HEALTHY (simulates Test Connection success)", async () => {
      const keyId = buildPersonalKeyId(userId, provider, "default");
      for (let i = 0; i < 3; i++) {
        await store.markFailure(keyId, authFailedClassified);
      }
      expect((await store.get(keyId)).state).toBe("DEAD");

      await store.forceHealthy(keyId);
      const rec = await store.get(keyId);
      expect(rec.state).toBe("HEALTHY");
      expect(rec.authFailureCount).toBe(0);
    });
  });

  describe("LastGood TTL + manual ops", () => {
    it("setLastGood / getLastGood / clearLastGood roundtrip", async () => {
      await store.setLastGood(userId, provider, "personal:u1:openai:default");
      expect(await store.getLastGood(userId, provider)).toBe(
        "personal:u1:openai:default",
      );
      await store.clearLastGood(userId, provider);
      expect(await store.getLastGood(userId, provider)).toBeNull();
    });

    it("LastGood is per-(userId, provider) — separate users independent", async () => {
      await store.setLastGood("u1", "openai", "personal:u1:openai:a");
      await store.setLastGood("u2", "openai", "personal:u2:openai:b");
      expect(await store.getLastGood("u1", "openai")).toBe(
        "personal:u1:openai:a",
      );
      expect(await store.getLastGood("u2", "openai")).toBe(
        "personal:u2:openai:b",
      );
    });
  });

  describe("Provider-level cooldown", () => {
    it("isProviderCooldown false initially", async () => {
      expect(await store.isProviderCooldown(provider)).toBe(false);
    });

    it("setProviderCooldown → isProviderCooldown true", async () => {
      await store.setProviderCooldown(provider, 5 * 60_000);
      expect(await store.isProviderCooldown(provider)).toBe(true);
    });

    it("clearProviderCooldown removes flag", async () => {
      await store.setProviderCooldown(provider, 5 * 60_000);
      await store.clearProviderCooldown(provider);
      expect(await store.isProviderCooldown(provider)).toBe(false);
    });

    it("account-wide 429 heuristic: 2+ keys 429 in 30s → setProviderCooldown", async () => {
      await store.markFailure(
        "personal:u1:openai:a",
        rateLimitClassified,
        provider,
      );
      // single key 429 → no provider cooldown
      expect(await store.isProviderCooldown(provider)).toBe(false);

      await store.markFailure(
        "personal:u1:openai:b",
        rateLimitClassified,
        provider,
      );
      // two keys 429 → provider cooldown triggered
      expect(await store.isProviderCooldown(provider)).toBe(true);
    });
  });

  describe("parseKeyId", () => {
    it("parses personal keyId", () => {
      expect(parseKeyId("personal:user-1:openai:default")).toEqual({
        type: "personal",
        userId: "user-1",
        provider: "openai",
        label: "default",
      });
    });

    it("parses assigned keyId", () => {
      expect(parseKeyId("assigned:abc-123")).toEqual({
        type: "assigned",
        assignmentId: "abc-123",
      });
    });

    it("parses system keyId", () => {
      expect(parseKeyId("system:OPENAI_KEY")).toEqual({
        type: "system",
        secretName: "OPENAI_KEY",
      });
    });

    it("returns null for malformed keyId", () => {
      expect(parseKeyId("invalid")).toBeNull();
      expect(parseKeyId("personal:foo")).toBeNull();
    });
  });

  describe("delete", () => {
    it("delete removes the health record", async () => {
      const keyId = buildPersonalKeyId(userId, provider, "default");
      await store.markFailure(keyId, authFailedClassified);
      await store.delete(keyId);
      const rec = await store.get(keyId);
      expect(rec.state).toBe("HEALTHY"); // default record (no state)
    });
  });

  describe("graceful degradation (no cache)", () => {
    it("returns all keyIds when CacheService unavailable", async () => {
      const noCacheStore = new KeyHealthStore(undefined);
      const out = await noCacheStore.filterUsable(["a", "b"]);
      expect(out).toEqual(["a", "b"]);
    });

    it("markFailure / markSuccess no-op when cache unavailable", async () => {
      const noCacheStore = new KeyHealthStore(undefined);
      await expect(
        noCacheStore.markFailure("a", authFailedClassified),
      ).resolves.toBeUndefined();
      await expect(noCacheStore.markSuccess("a")).resolves.toBeUndefined();
    });
  });
});
