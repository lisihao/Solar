/**
 * Tests for ToolResultCacheService
 */

import { ToolResultCacheService } from "../tool-result-cache.service";
import { CacheService } from "@/common/cache/cache.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCacheService(): jest.Mocked<CacheService> {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    getOrSet: jest.fn(),
    delByPrefix: jest.fn(),
    invalidateAIModelCache: jest.fn(),
    invalidateUserCache: jest.fn(),
    buildKey: jest.fn(),
  } as unknown as jest.Mocked<CacheService>;
}

// ---------------------------------------------------------------------------
// isCacheable()
// ---------------------------------------------------------------------------

describe("ToolResultCacheService.isCacheable()", () => {
  let service: ToolResultCacheService;

  beforeEach(() => {
    service = new ToolResultCacheService();
  });

  it("returns true when sideEffect is 'none'", () => {
    expect(service.isCacheable("none")).toBe(true);
  });

  it("returns true when sideEffect is undefined (defaults to none)", () => {
    expect(service.isCacheable(undefined)).toBe(true);
  });

  it("returns false when sideEffect is 'destructive'", () => {
    expect(service.isCacheable("destructive")).toBe(false);
  });

  it("returns false when sideEffect is 'idempotent'", () => {
    expect(service.isCacheable("idempotent")).toBe(false);
  });

  it("returns false for an unknown sideEffect string", () => {
    expect(service.isCacheable("write")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildKey()
// ---------------------------------------------------------------------------

describe("ToolResultCacheService.buildKey()", () => {
  let service: ToolResultCacheService;

  beforeEach(() => {
    service = new ToolResultCacheService();
  });

  it("different missionIds produce different keys", () => {
    const keyA = service.buildKey("mission-A", "web-search", { q: "test" });
    const keyB = service.buildKey("mission-B", "web-search", { q: "test" });
    expect(keyA).not.toBe(keyB);
  });

  it("same mission + same input produces the same key (idempotent)", () => {
    const key1 = service.buildKey("mission-X", "web-search", { q: "apple" });
    const key2 = service.buildKey("mission-X", "web-search", { q: "apple" });
    expect(key1).toBe(key2);
  });

  it("same mission + different input produces different keys", () => {
    const key1 = service.buildKey("mission-X", "web-search", { q: "apple" });
    const key2 = service.buildKey("mission-X", "web-search", { q: "orange" });
    expect(key1).not.toBe(key2);
  });

  it("uses 'global' scope when missionId is undefined", () => {
    const key = service.buildKey(undefined, "web-search", { q: "test" });
    expect(key).toMatch(/^tool:result:global:/);
  });

  it("includes toolId in the key", () => {
    const key = service.buildKey("mission-1", "rag-search", { q: "test" });
    expect(key).toContain("rag-search");
  });

  it("key has the expected prefix format", () => {
    const key = service.buildKey("mission-1", "web-search", { q: "test" });
    expect(key).toMatch(/^tool:result:mission-1:web-search:[a-f0-9]{16}$/);
  });

  it("handles null/undefined input gracefully (treated as {})", () => {
    const key1 = service.buildKey("m", "tool", null);
    const key2 = service.buildKey("m", "tool", undefined);
    expect(key1).toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// tryGet()
// ---------------------------------------------------------------------------

describe("ToolResultCacheService.tryGet()", () => {
  it("returns null when CacheService is not injected", async () => {
    const service = new ToolResultCacheService(); // no cache injected
    const result = await service.tryGet("some-key");
    expect(result).toBeNull();
  });

  it("returns cached value when CacheService.get resolves with a value", async () => {
    const mockCache = createMockCacheService();
    mockCache.get.mockResolvedValueOnce({ data: "cached" } as unknown);
    const service = new ToolResultCacheService(mockCache);

    const result = await service.tryGet<{ data: string }>("key-1");

    expect(result).toEqual({ data: "cached" });
    expect(mockCache.get).toHaveBeenCalledWith("key-1");
  });

  it("returns null when CacheService.get resolves with undefined (cache miss)", async () => {
    const mockCache = createMockCacheService();
    mockCache.get.mockResolvedValueOnce(undefined);
    const service = new ToolResultCacheService(mockCache);

    const result = await service.tryGet("key-miss");
    expect(result).toBeNull();
  });

  it("returns null and does not throw when CacheService.get rejects", async () => {
    const mockCache = createMockCacheService();
    mockCache.get.mockRejectedValueOnce(new Error("Redis unavailable"));
    const service = new ToolResultCacheService(mockCache);

    await expect(service.tryGet("key-err")).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// set()
// ---------------------------------------------------------------------------

describe("ToolResultCacheService.set()", () => {
  it("is a noop when CacheService is not injected", async () => {
    const service = new ToolResultCacheService(); // no cache
    await expect(service.set("key", { result: "ok" })).resolves.toBeUndefined();
  });

  it("calls CacheService.set with correct key, value and default TTL", async () => {
    const mockCache = createMockCacheService();
    mockCache.set.mockResolvedValueOnce(undefined);
    const service = new ToolResultCacheService(mockCache);

    await service.set("key-1", { answer: 42 });

    expect(mockCache.set).toHaveBeenCalledWith(
      "key-1",
      { answer: 42 },
      30 * 60, // DEFAULT_TTL_SECONDS
    );
  });

  it("calls CacheService.set with custom TTL when provided", async () => {
    const mockCache = createMockCacheService();
    mockCache.set.mockResolvedValueOnce(undefined);
    const service = new ToolResultCacheService(mockCache);

    await service.set("key-2", "value", 120);

    expect(mockCache.set).toHaveBeenCalledWith("key-2", "value", 120);
  });

  it("does not throw when CacheService.set rejects", async () => {
    const mockCache = createMockCacheService();
    mockCache.set.mockRejectedValueOnce(new Error("Write error"));
    const service = new ToolResultCacheService(mockCache);

    await expect(service.set("key-err", "val")).resolves.toBeUndefined();
  });

  it("emits cache:write-fail-streak event after threshold consecutive failures", async () => {
    const mockCache = createMockCacheService();
    const mockEmitter = { emit: jest.fn() };
    // Threshold = 5, so 5 consecutive failures trigger the event
    mockCache.set.mockRejectedValue(new Error("Redis down"));

    const service = new ToolResultCacheService(
      mockCache,
      mockEmitter as unknown as import("@nestjs/event-emitter").EventEmitter2,
    );

    // 4 failures — should NOT emit yet
    for (let i = 0; i < 4; i++) {
      await service.set(`key-${i}`, "v");
    }
    expect(mockEmitter.emit).not.toHaveBeenCalled();

    // 5th failure — should emit
    await service.set("key-5", "v");
    expect(mockEmitter.emit).toHaveBeenCalledWith(
      "cache:write-fail-streak",
      expect.objectContaining({
        streak: 5,
        service: "ToolResultCacheService",
      }),
    );
  });

  it("resets streak counter after a successful write", async () => {
    const mockCache = createMockCacheService();
    const mockEmitter = { emit: jest.fn() };
    const service = new ToolResultCacheService(
      mockCache,
      mockEmitter as unknown as import("@nestjs/event-emitter").EventEmitter2,
    );

    // 3 failures
    mockCache.set.mockRejectedValueOnce(new Error("err"));
    mockCache.set.mockRejectedValueOnce(new Error("err"));
    mockCache.set.mockRejectedValueOnce(new Error("err"));
    await service.set("k1", "v");
    await service.set("k2", "v");
    await service.set("k3", "v");

    // 1 success resets streak
    mockCache.set.mockResolvedValueOnce(undefined);
    await service.set("k4", "v");

    // 4 more failures — total streak is 4 (< 5), no event
    mockCache.set.mockRejectedValue(new Error("err"));
    for (let i = 0; i < 4; i++) {
      await service.set(`kx-${i}`, "v");
    }
    expect(mockEmitter.emit).not.toHaveBeenCalled();
  });
});
