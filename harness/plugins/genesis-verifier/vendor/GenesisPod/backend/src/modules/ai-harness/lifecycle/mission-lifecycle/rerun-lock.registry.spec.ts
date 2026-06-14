/**
 * RerunLockRegistry spec — Redis SET 分布式锁（PR-E Phase 2 P1-3）
 *
 * FakeCacheService：in-memory Map 模拟 Redis SET（sadd/srem/sismember/smembers/del/expire）。
 * 验证：
 *   1. acquire 首次返回 true，重复返回 false（原子 SADD 语义）
 *   2. release 后 acquire 可再次成功
 *   3. releaseAll 清空 mission 下所有锁
 *   4. isLocked 正确反映锁状态
 *   5. listLocked 返回所有被锁 todoId
 *   6. TTL expire 被调用（防 pod 重启泄漏）
 *   7. 并发场景：同一 todo 两次 acquire 只有一次成功
 */

import { Test } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { RerunLockRegistry } from "./rerun-lock.registry";
import { CacheService } from "@/common/cache/cache.service";

jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

// ── FakeCacheService ─────────────────────────────────────────────────────────
//
// in-memory 模拟 Redis SET 语义（SADD 原子性、SREM、SISMEMBER、SMEMBERS）。
// expire / del 也实现，供 TTL 验证用。

class FakeCacheService {
  private readonly sets = new Map<string, Set<string>>();
  readonly expireCalls: Array<{ key: string; seconds: number }> = [];

  async sadd(key: string, member: string): Promise<number> {
    let s = this.sets.get(key);
    if (!s) {
      s = new Set<string>();
      this.sets.set(key, s);
    }
    if (s.has(member)) return 0;
    s.add(member);
    return 1;
  }

  async srem(key: string, member: string): Promise<number> {
    const s = this.sets.get(key);
    if (!s || !s.has(member)) return 0;
    s.delete(member);
    if (s.size === 0) this.sets.delete(key);
    return 1;
  }

  async sismember(key: string, member: string): Promise<boolean> {
    return this.sets.get(key)?.has(member) ?? false;
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  async del(key: string): Promise<void> {
    this.sets.delete(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.expireCalls.push({ key, seconds });
  }

  // helpers for assertions
  hasKey(key: string): boolean {
    return this.sets.has(key);
  }

  clear(): void {
    this.sets.clear();
    this.expireCalls.length = 0;
  }
}

// ── Test helpers ─────────────────────────────────────────────────────────────

async function buildRegistry(): Promise<{
  registry: RerunLockRegistry;
  cache: FakeCacheService;
}> {
  const cache = new FakeCacheService();
  const module = await Test.createTestingModule({
    providers: [RerunLockRegistry, { provide: CacheService, useValue: cache }],
  }).compile();
  return { registry: module.get(RerunLockRegistry), cache };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RerunLockRegistry (Redis SET 分布式锁)", () => {
  let registry: RerunLockRegistry;
  let cache: FakeCacheService;

  beforeEach(async () => {
    ({ registry, cache } = await buildRegistry());
  });

  afterEach(() => {
    cache.clear();
  });

  // ── acquire ─────────────────────────────────────────────────────────────

  describe("acquire", () => {
    it("首次 acquire 返回 true（SADD 新加 = 1）", async () => {
      expect(await registry.acquire("m1", "todo-1")).toBe(true);
    });

    it("同一 todo 二次 acquire 返回 false（SADD 已存在 = 0）", async () => {
      await registry.acquire("m1", "todo-1");
      expect(await registry.acquire("m1", "todo-1")).toBe(false);
    });

    it("同 mission 不同 todo 各自独立加锁", async () => {
      expect(await registry.acquire("m1", "todo-1")).toBe(true);
      expect(await registry.acquire("m1", "todo-2")).toBe(true);
    });

    it("不同 mission 下同名 todo 互不影响", async () => {
      expect(await registry.acquire("m1", "todo-1")).toBe(true);
      expect(await registry.acquire("m2", "todo-1")).toBe(true);
    });

    it("acquire 成功后调用 expire 刷新 TTL（30min = 1800s）", async () => {
      await registry.acquire("m1", "todo-1");
      expect(cache.expireCalls).toContainEqual({
        key: "harness:rerun-lock:m1",
        seconds: 1800,
      });
    });

    it("acquire 失败（已存在）时不调用 expire", async () => {
      await registry.acquire("m1", "todo-1");
      cache.expireCalls.length = 0; // 清掉第一次的记录
      await registry.acquire("m1", "todo-1");
      expect(cache.expireCalls).toHaveLength(0);
    });
  });

  // ── release ─────────────────────────────────────────────────────────────

  describe("release", () => {
    it("release 后同一 todo 可以再次 acquire", async () => {
      await registry.acquire("m1", "todo-1");
      await registry.release("m1", "todo-1");
      expect(await registry.acquire("m1", "todo-1")).toBe(true);
    });

    it("release 不存在的 todo 不抛异常", async () => {
      await expect(
        registry.release("m1", "ghost-todo"),
      ).resolves.toBeUndefined();
    });

    it("release 一个 todo 不影响同 mission 下其他 todo", async () => {
      await registry.acquire("m1", "todo-1");
      await registry.acquire("m1", "todo-2");
      await registry.release("m1", "todo-1");
      expect(await registry.isLocked("m1", "todo-2")).toBe(true);
    });
  });

  // ── releaseAll ───────────────────────────────────────────────────────────

  describe("releaseAll", () => {
    it("releaseAll 清空 mission 下所有锁", async () => {
      await registry.acquire("m1", "todo-1");
      await registry.acquire("m1", "todo-2");
      await registry.releaseAll("m1");
      expect(await registry.isLocked("m1", "todo-1")).toBe(false);
      expect(await registry.isLocked("m1", "todo-2")).toBe(false);
    });

    it("releaseAll 不影响其他 mission", async () => {
      await registry.acquire("m1", "todo-1");
      await registry.acquire("m2", "todo-1");
      await registry.releaseAll("m1");
      expect(await registry.isLocked("m2", "todo-1")).toBe(true);
    });

    it("releaseAll 空 mission 不抛异常", async () => {
      await expect(
        registry.releaseAll("ghost-mission"),
      ).resolves.toBeUndefined();
    });
  });

  // ── isLocked ─────────────────────────────────────────────────────────────

  describe("isLocked", () => {
    it("acquire 后 isLocked 返回 true", async () => {
      await registry.acquire("m1", "todo-1");
      expect(await registry.isLocked("m1", "todo-1")).toBe(true);
    });

    it("未 acquire 时 isLocked 返回 false", async () => {
      expect(await registry.isLocked("m1", "todo-1")).toBe(false);
    });

    it("release 后 isLocked 返回 false", async () => {
      await registry.acquire("m1", "todo-1");
      await registry.release("m1", "todo-1");
      expect(await registry.isLocked("m1", "todo-1")).toBe(false);
    });
  });

  // ── listLocked ───────────────────────────────────────────────────────────

  describe("listLocked", () => {
    it("返回 mission 下所有被锁 todoId", async () => {
      await registry.acquire("m1", "todo-1");
      await registry.acquire("m1", "todo-2");
      const locked = await registry.listLocked("m1");
      expect(locked).toHaveLength(2);
      expect(locked).toContain("todo-1");
      expect(locked).toContain("todo-2");
    });

    it("空 mission 返回空数组", async () => {
      expect(await registry.listLocked("ghost")).toEqual([]);
    });

    it("releaseAll 后 listLocked 返回空数组", async () => {
      await registry.acquire("m1", "todo-1");
      await registry.releaseAll("m1");
      expect(await registry.listLocked("m1")).toEqual([]);
    });
  });

  // ── 并发场景 ─────────────────────────────────────────────────────────────

  describe("并发竞争（Promise.all 模拟）", () => {
    it("并发两次 acquire 同一 todo：只有一次成功", async () => {
      const [r1, r2] = await Promise.all([
        registry.acquire("m1", "todo-1"),
        registry.acquire("m1", "todo-1"),
      ]);
      // 一个成功（true），一个失败（false）
      expect(r1 !== r2).toBe(true);
      expect([r1, r2]).toContain(true);
      expect([r1, r2]).toContain(false);
    });

    it("并发 acquire 不同 todo：均成功", async () => {
      const results = await Promise.all([
        registry.acquire("m1", "todo-1"),
        registry.acquire("m1", "todo-2"),
        registry.acquire("m1", "todo-3"),
      ]);
      expect(results).toEqual([true, true, true]);
    });
  });

  // ── Redis key 格式 ───────────────────────────────────────────────────────

  describe("key 格式", () => {
    it("使用正确的 key 前缀 harness:rerun-lock:{missionId}", async () => {
      await registry.acquire("mission-abc", "todo-x");
      expect(cache.hasKey("harness:rerun-lock:mission-abc")).toBe(true);
    });
  });
});
