import {
  InMemoryTokenBucketStore,
  RedisTokenBucketStore,
} from "../token-bucket";
import type { CacheService } from "@/common/cache/cache.service";

describe("InMemoryTokenBucketStore", () => {
  let store: InMemoryTokenBucketStore;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    store = new InMemoryTokenBucketStore();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts a fresh key full at capacity", async () => {
    // capacity 2 → two consumes succeed, third fails (no time elapsed)
    expect(await store.tryConsume("k", 2, 1)).toBe(true);
    expect(await store.tryConsume("k", 2, 1)).toBe(true);
    expect(await store.tryConsume("k", 2, 1)).toBe(false);
  });

  it("refills tokens over elapsed time up to capacity", async () => {
    await store.tryConsume("k", 2, 1); // 2 -> 1
    await store.tryConsume("k", 2, 1); // 1 -> 0
    expect(await store.tryConsume("k", 2, 1)).toBe(false);
    jest.setSystemTime(1_000); // +1s @ 1/sec → +1 token
    expect(await store.tryConsume("k", 2, 1)).toBe(true);
  });

  it("never refills beyond capacity", async () => {
    await store.tryConsume("k", 2, 1); // drain to 1
    jest.setSystemTime(100_000); // huge gap
    // capacity is 2, so only 2 consumes should be possible
    expect(await store.tryConsume("k", 2, 1)).toBe(true);
    expect(await store.tryConsume("k", 2, 1)).toBe(true);
    expect(await store.tryConsume("k", 2, 1)).toBe(false);
  });

  it("supports consuming n>1 atomically", async () => {
    expect(await store.tryConsume("k", 5, 1, 3)).toBe(true); // 5 -> 2
    expect(await store.tryConsume("k", 5, 1, 3)).toBe(false); // only 2 left
    expect(await store.tryConsume("k", 5, 1, 2)).toBe(true); // 2 -> 0
  });

  it("isolates buckets per key", async () => {
    await store.tryConsume("a", 1, 1); // drain a
    expect(await store.tryConsume("a", 1, 1)).toBe(false);
    expect(await store.tryConsume("b", 1, 1)).toBe(true); // b untouched
  });

  it("setForTest overrides token count", async () => {
    store.setForTest("k", 0);
    expect(await store.tryConsume("k", 10, 0)).toBe(false);
    store.setForTest("k", 10);
    expect(await store.tryConsume("k", 10, 0)).toBe(true);
  });

  it("clearForTest empties all buckets (fresh keys go back to full)", async () => {
    await store.tryConsume("k", 1, 0); // drain
    expect(await store.tryConsume("k", 1, 0)).toBe(false);
    store.clearForTest();
    expect(await store.tryConsume("k", 1, 0)).toBe(true); // fresh again
  });

  it("sweeps idle buckets after the sweep interval", async () => {
    // Prime a key, then let it go idle past MAX_IDLE_MS (5min) and trigger
    // a sweep (every 500 ops). The swept key behaves like a brand-new full bucket.
    store.setForTest("idle", 0); // an empty, soon-to-be-idle bucket
    jest.setSystemTime(6 * 60_000); // > 5min idle
    // 500 ops on a different key to trigger sweepIdle
    for (let i = 0; i < 500; i++) {
      await store.tryConsume("driver", 1_000_000, 0);
    }
    // 'idle' should have been evicted → fresh full bucket again
    expect(await store.tryConsume("idle", 5, 0)).toBe(true);
  });
});

describe("RedisTokenBucketStore", () => {
  let cache: jest.Mocked<Pick<CacheService, "get" | "set">>;
  let store: RedisTokenBucketStore;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    store = new RedisTokenBucketStore(cache as unknown as CacheService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("treats a missing key as full capacity and persists remaining tokens", async () => {
    const ok = await store.tryConsume("k", 5, 1, 2);
    expect(ok).toBe(true);
    expect(cache.set).toHaveBeenCalledWith(
      "engine:rate-limit:bucket:k",
      expect.objectContaining({ tokens: 3 }),
      expect.any(Number),
    );
  });

  it("uses the engine: cache key prefix (zero-downtime migration)", async () => {
    await store.tryConsume("user-1", 5, 1);
    expect(cache.get).toHaveBeenCalledWith("engine:rate-limit:bucket:user-1");
  });

  it("rejects but still persists refill progress when tokens insufficient", async () => {
    cache.get.mockResolvedValue({ tokens: 0, lastRefill: 0 });
    const ok = await store.tryConsume("k", 5, 1, 3);
    expect(ok).toBe(false);
    // even on reject it writes back the (refilled) progress
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  it("refills based on elapsed time from stored lastRefill", async () => {
    cache.get.mockResolvedValue({ tokens: 0, lastRefill: 0 });
    jest.setSystemTime(3_000); // +3s @ 1/sec → +3 tokens
    const ok = await store.tryConsume("k", 5, 1, 3);
    expect(ok).toBe(true);
  });

  it("caps refill at capacity from stored state", async () => {
    cache.get.mockResolvedValue({ tokens: 4, lastRefill: 0 });
    jest.setSystemTime(100_000); // would overflow without cap
    await store.tryConsume("k", 5, 1, 5);
    // tokens went 4 -> capped 5 -> minus 5 = 0
    expect(cache.set).toHaveBeenCalledWith(
      "engine:rate-limit:bucket:k",
      expect.objectContaining({ tokens: 0 }),
      expect.any(Number),
    );
  });

  it("computes a TTL of at least 60 seconds", async () => {
    await store.tryConsume("k", 1, 1000); // capacity/refill tiny → floor at 60
    const ttl = cache.set.mock.calls[0][2];
    expect(ttl).toBeGreaterThanOrEqual(60);
  });
});
