import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { MissionTokenLedger } from "../runtime/token-budget.service";
import { CacheService } from "@/common/cache/cache.service";

jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

// ── In-memory CacheService mock ───────────────────────────────────────────

/**
 * Simple in-memory mock that mirrors CacheService get/set/del semantics.
 * Values are deep-cloned on write to prevent accidental mutation.
 */
class FakeCacheService {
  private readonly store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const v = this.store.get(key);
    return v !== undefined ? (JSON.parse(JSON.stringify(v)) as T) : undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, JSON.parse(JSON.stringify(value)));
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  /**
   * INCRBY — 2026-05-15 Round 1 P1 fix：原子累加 usedTokens 计数器
   * 真 Redis 是原子；FakeCacheService 这里是单 pod sync read-modify-write，
   * 等价于 single pod 无竞态（spec 不模拟跨 pod；多 pod 安全由 prod Redis 保证）
   */
  async incrby(key: string, delta: number): Promise<number> {
    const current = ((this.store.get(key) as number | undefined) ?? 0) + delta;
    this.store.set(key, current);
    return current;
  }

  /** Test helper: clear all entries between tests */
  clear(): void {
    this.store.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe("MissionTokenLedger", () => {
  let service: MissionTokenLedger;
  let fakeCache: FakeCacheService;

  beforeEach(async () => {
    fakeCache = new FakeCacheService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionTokenLedger,
        { provide: CacheService, useValue: fakeCache },
      ],
    }).compile();
    service = module.get<MissionTokenLedger>(MissionTokenLedger);
  });

  afterEach(() => {
    fakeCache.clear();
    jest.clearAllMocks();
  });

  // ==================== createBudget ====================

  describe("createBudget", () => {
    it("should create budget entry with correct fields", async () => {
      const entry = await service.createBudget("mission-1", 10000);
      expect(entry.id).toBe("mission-1");
      expect(entry.maxTokens).toBe(10000);
      expect(entry.usedTokens).toBe(0);
      expect(entry.createdAt).toBeInstanceOf(Date);
      expect(entry.updatedAt).toBeInstanceOf(Date);
    });

    it("should initialize empty usage history", async () => {
      await service.createBudget("mission-2", 5000);
      const history = await service.getUsageHistory("mission-2");
      expect(history).toEqual([]);
    });

    it("should overwrite existing budget with same id", async () => {
      await service.createBudget("mission-3", 1000);
      await service.consume("mission-3", "op1", 100, 50);
      await service.createBudget("mission-3", 9999);
      const budget = await service.getBudget("mission-3");
      expect(budget?.maxTokens).toBe(9999);
      expect(budget?.usedTokens).toBe(0);
    });

    it("should return the created entry", async () => {
      const entry = await service.createBudget("mission-ret", 5000);
      expect(entry).toBeDefined();
      expect(entry.maxTokens).toBe(5000);
    });
  });

  // ==================== check ====================

  describe("check", () => {
    it("should return allowed=true with Infinity remaining for unknown budgetId", async () => {
      const result = await service.check("nonexistent-budget", 1000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
      expect(result.usageRate).toBe(0);
    });

    it("should allow when estimated tokens are within remaining budget", async () => {
      await service.createBudget("check-1", 1000);
      const result = await service.check("check-1", 500);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1000);
      expect(result.usageRate).toBe(0);
    });

    it("should deny when estimated tokens would exceed budget", async () => {
      await service.createBudget("check-2", 1000);
      await service.consume("check-2", "op", 900, 0);
      const result = await service.check("check-2", 200);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(100);
      expect(result.reason).toContain("Token budget exceeded");
    });

    it("should return correct usageRate", async () => {
      await service.createBudget("check-3", 1000);
      await service.consume("check-3", "op", 250, 250);
      const result = await service.check("check-3", 1);
      expect(result.usageRate).toBeCloseTo(0.5, 4);
    });

    it("should return 0 usageRate when maxTokens is 0", async () => {
      await service.createBudget("check-zero", 0);
      const result = await service.check("check-zero", 0);
      expect(result.usageRate).toBe(0);
    });

    it("should allow exactly at budget boundary", async () => {
      await service.createBudget("check-boundary", 1000);
      await service.consume("check-boundary", "op", 500, 500);
      // usedTokens=1000, checking 0 additional -> allowed
      const result = await service.check("check-boundary", 0);
      expect(result.allowed).toBe(true);
    });

    it("should deny when exactly one over budget", async () => {
      await service.createBudget("check-over", 1000);
      await service.consume("check-over", "op", 1000, 0);
      const result = await service.check("check-over", 1);
      expect(result.allowed).toBe(false);
    });
  });

  // ==================== consume ====================

  describe("consume", () => {
    it("should update usedTokens by inputTokens + outputTokens", async () => {
      await service.createBudget("cons-1", 10000);
      await service.consume("cons-1", "chat", 300, 150);
      const budget = await service.getBudget("cons-1");
      expect(budget?.usedTokens).toBe(450);
    });

    it("should append usage history record", async () => {
      await service.createBudget("cons-2", 10000);
      await service.consume("cons-2", "embed", 100, 0);
      const history = await service.getUsageHistory("cons-2");
      expect(history).toHaveLength(1);
      expect(history[0].operation).toBe("embed");
      expect(history[0].inputTokens).toBe(100);
      expect(history[0].outputTokens).toBe(0);
      expect(history[0].totalTokens).toBe(100);
      expect(history[0].budgetId).toBe("cons-2");
      expect(history[0].timestamp).toBeInstanceOf(Date);
    });

    it("should accumulate multiple consume calls", async () => {
      await service.createBudget("cons-3", 10000);
      await service.consume("cons-3", "op1", 100, 50);
      await service.consume("cons-3", "op2", 200, 100);
      const budget = await service.getBudget("cons-3");
      expect(budget?.usedTokens).toBe(450);
    });

    it("should update updatedAt timestamp on consume", async () => {
      await service.createBudget("cons-ts", 10000);
      const before = (await service.getBudget("cons-ts"))!.updatedAt;
      await new Promise((r) => setTimeout(r, 10));
      await service.consume("cons-ts", "op", 100, 50);
      const after = (await service.getBudget("cons-ts"))!.updatedAt;
      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("should warn when usage reaches 90%", async () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      await service.createBudget("cons-warn", 1000);
      await service.consume("cons-warn", "op", 900, 0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("cons-warn"),
      );
    });

    it("should not warn below 90% usage", async () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      await service.createBudget("cons-no-warn", 1000);
      await service.consume("cons-no-warn", "op", 800, 0);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("should still record history even for unknown budgetId (no budget)", async () => {
      // No budget created, but consume still records history
      await service.consume("unknown-id", "op", 100, 50);
      const history = await service.getUsageHistory("unknown-id");
      expect(history).toHaveLength(1);
    });

    it("should create history entry for unknown budgetId", async () => {
      await service.consume("no-budget", "op", 10, 5);
      const history = await service.getUsageHistory("no-budget");
      expect(history[0].totalTokens).toBe(15);
    });

    it("should trim history to MAX_HISTORY (1000) entries", async () => {
      await service.createBudget("cons-trim", 999_999_999);
      // Push 1001 records
      for (let i = 0; i < 1001; i++) {
        await service.consume("cons-trim", `op-${i}`, 1, 0);
      }
      const history = await service.getUsageHistory("cons-trim");
      expect(history.length).toBe(1000);
      // Last record should be the most recent (op-1000)
      expect(history[history.length - 1].operation).toBe("op-1000");
    });
  });

  // ==================== getBudget ====================

  describe("getBudget", () => {
    it("should return null for unknown budgetId", async () => {
      expect(await service.getBudget("unknown")).toBeNull();
    });

    it("should return the budget entry for known budgetId", async () => {
      await service.createBudget("gb-1", 5000);
      const entry = await service.getBudget("gb-1");
      expect(entry).not.toBeNull();
      expect(entry?.id).toBe("gb-1");
      expect(entry?.maxTokens).toBe(5000);
    });

    it("should deserialize Date fields correctly after cache round-trip", async () => {
      await service.createBudget("gb-dates", 1000);
      const entry = await service.getBudget("gb-dates");
      expect(entry?.createdAt).toBeInstanceOf(Date);
      expect(entry?.updatedAt).toBeInstanceOf(Date);
    });
  });

  // ==================== getUsageHistory ====================

  describe("getUsageHistory", () => {
    it("should return empty array for unknown budgetId", async () => {
      expect(await service.getUsageHistory("unknown")).toEqual([]);
    });

    it("should return all usage records in order", async () => {
      await service.createBudget("gh-1", 10000);
      await service.consume("gh-1", "op1", 100, 50);
      await service.consume("gh-1", "op2", 200, 100);
      const history = await service.getUsageHistory("gh-1");
      expect(history).toHaveLength(2);
      expect(history[0].operation).toBe("op1");
      expect(history[1].operation).toBe("op2");
    });

    it("should deserialize timestamp as Date after cache round-trip", async () => {
      await service.createBudget("gh-dates", 1000);
      await service.consume("gh-dates", "op", 10, 5);
      const history = await service.getUsageHistory("gh-dates");
      expect(history[0].timestamp).toBeInstanceOf(Date);
    });
  });

  // ==================== getSummary ====================

  describe("getSummary", () => {
    it("should return null for unknown budgetId", async () => {
      expect(await service.getSummary("unknown")).toBeNull();
    });

    it("should return correct summary for fresh budget", async () => {
      await service.createBudget("sum-1", 1000);
      const summary = await service.getSummary("sum-1");
      expect(summary).not.toBeNull();
      expect(summary?.totalUsed).toBe(0);
      expect(summary?.maxTokens).toBe(1000);
      expect(summary?.remaining).toBe(1000);
      expect(summary?.usageRate).toBe(0);
      expect(summary?.operationCount).toBe(0);
    });

    it("should return correct summary after consuming", async () => {
      await service.createBudget("sum-2", 1000);
      await service.consume("sum-2", "op1", 300, 200);
      await service.consume("sum-2", "op2", 100, 50);
      const summary = await service.getSummary("sum-2");
      expect(summary?.totalUsed).toBe(650);
      expect(summary?.remaining).toBe(350);
      expect(summary?.usageRate).toBeCloseTo(0.65, 4);
      expect(summary?.operationCount).toBe(2);
    });

    it("should return 0 usageRate when maxTokens is 0", async () => {
      await service.createBudget("sum-zero", 0);
      const summary = await service.getSummary("sum-zero");
      expect(summary?.usageRate).toBe(0);
    });

    it("should clamp remaining to 0 when over budget", async () => {
      await service.createBudget("sum-over", 100);
      // Simulate overconsumption by consuming more than budget
      await service.consume("sum-over", "op", 60, 60); // 120 > 100
      const summary = await service.getSummary("sum-over");
      expect(summary?.remaining).toBe(0);
    });
  });

  // ==================== deleteBudget ====================

  describe("deleteBudget", () => {
    it("should remove budget and history", async () => {
      await service.createBudget("del-1", 5000);
      await service.consume("del-1", "op", 100, 50);
      await service.deleteBudget("del-1");
      expect(await service.getBudget("del-1")).toBeNull();
      expect(await service.getUsageHistory("del-1")).toEqual([]);
    });

    it("should not throw when deleting unknown budgetId", async () => {
      await expect(service.deleteBudget("nonexistent")).resolves.not.toThrow();
    });
  });

  // ==================== getActiveBudgetCount ====================

  describe("getActiveBudgetCount", () => {
    it("should return 0 (Redis mode does not track global count)", async () => {
      await service.createBudget("abc-1", 1000);
      await service.createBudget("abc-2", 2000);
      // In Redis mode, global count is not tracked — always returns 0
      expect(await service.getActiveBudgetCount()).toBe(0);
    });
  });

  // ==================== Edge cases ====================

  describe("edge cases", () => {
    it("should handle 0 token consumption", async () => {
      await service.createBudget("edge-1", 1000);
      await service.consume("edge-1", "noop", 0, 0);
      const budget = await service.getBudget("edge-1");
      expect(budget?.usedTokens).toBe(0);
    });

    it("should correctly show 100% usage rate", async () => {
      await service.createBudget("edge-full", 1000);
      await service.consume("edge-full", "op", 1000, 0);
      const result = await service.check("edge-full", 1);
      expect(result.usageRate).toBe(1.0);
      expect(result.allowed).toBe(false);
    });

    it("should allow check with 0 estimated tokens even when at budget", async () => {
      await service.createBudget("edge-zero-est", 100);
      await service.consume("edge-zero-est", "op", 100, 0);
      // 100 + 0 = 100 which is NOT > 100, so allowed
      const result = await service.check("edge-zero-est", 0);
      expect(result.allowed).toBe(true);
    });
  });

  // ── 2026-05-15 Round 1 P1 fix: 并发安全 (INCRBY 原子累加) ─────────────────
  describe("consume() concurrent atomicity (P1 race fix)", () => {
    it("10 个 Promise.all 真并发 consume 后 usedTokens 总和精确", async () => {
      await service.createBudget("race-1", 100_000);

      // 10 路并发，每路 consume 100 input + 50 output = 150 tokens
      // 旧的 read-modify-write 会因为读到同一旧值各加 150 然后覆盖，最终只剩 1 次的 150
      // 新的 INCRBY 原子累加，10 路并发后必须 = 1500
      const promises = Array.from({ length: 10 }, (_, i) =>
        service.consume("race-1", `op-${i}`, 100, 50),
      );
      await Promise.all(promises);

      const budget = await service.getBudget("race-1");
      expect(budget!.usedTokens).toBe(1500);
    });

    it("混合大小并发：1000 + 500 + 200 + 100 = 1800", async () => {
      await service.createBudget("race-2", 100_000);
      await Promise.all([
        service.consume("race-2", "op-1", 700, 300), // 1000
        service.consume("race-2", "op-2", 300, 200), // 500
        service.consume("race-2", "op-3", 150, 50), // 200
        service.consume("race-2", "op-4", 50, 50), // 100
      ]);
      const budget = await service.getBudget("race-2");
      expect(budget!.usedTokens).toBe(1800);
    });
  });
});
