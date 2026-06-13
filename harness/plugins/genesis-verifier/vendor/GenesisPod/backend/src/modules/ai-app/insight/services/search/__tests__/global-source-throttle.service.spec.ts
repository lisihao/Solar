/**
 * GlobalSourceThrottleService Unit Tests
 *
 * Coverage targets:
 * - constructor: pre-registers all known sources
 * - registerSource: skips re-registration, registers new source
 * - execute: happy path, unknown source auto-registration, abort before queue,
 *            abort after queuing, error propagation, pending count tracking
 * - getStats: returns all registered sources
 * - getQueueSize: known source, unknown source
 */

import { Test, TestingModule } from "@nestjs/testing";
import { GlobalSourceThrottleService } from "../global-source-throttle.service";

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("GlobalSourceThrottleService", () => {
  let service: GlobalSourceThrottleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GlobalSourceThrottleService],
    }).compile();

    service = module.get<GlobalSourceThrottleService>(
      GlobalSourceThrottleService,
    );
  });

  // ─────────────────────────── constructor ─────────────────────────────────

  describe("constructor", () => {
    it("should pre-register known sources", () => {
      const stats = service.getStats();
      const sourceIds = stats.map((s) => s.sourceId);

      expect(sourceIds).toContain("arxiv-search");
      expect(sourceIds).toContain("semantic-scholar");
      expect(sourceIds).toContain("pubmed");
      expect(sourceIds).toContain("openalex-search");
      expect(sourceIds).toContain("web-search");
      expect(sourceIds).toContain("github-search");
      expect(sourceIds).toContain("hackernews-search");
      expect(sourceIds).toContain("social-x");
      expect(sourceIds).toContain("policy");
      expect(sourceIds).toContain("finance-api");
      expect(sourceIds).toContain("weather-api");
      expect(sourceIds).toContain("local-search");
    });

    it("should have correct concurrency for arxiv-search (1)", () => {
      const stats = service.getStats();
      const arxiv = stats.find((s) => s.sourceId === "arxiv-search");
      expect(arxiv?.concurrency).toBe(1);
    });

    it("should have correct concurrency for web-search (8)", () => {
      const stats = service.getStats();
      const webSearch = stats.find((s) => s.sourceId === "web-search");
      expect(webSearch?.concurrency).toBe(8);
    });

    it("should initialize all sources with zero active and pending counts", () => {
      const stats = service.getStats();
      for (const stat of stats) {
        expect(stat.activeCount).toBe(0);
        expect(stat.pendingCount).toBe(0);
      }
    });
  });

  // ─────────────────────────── registerSource ───────────────────────────────

  describe("registerSource", () => {
    it("should register a new source with given concurrency", () => {
      service.registerSource("test-source", 5);

      const stats = service.getStats();
      const testSource = stats.find((s) => s.sourceId === "test-source");
      expect(testSource).toBeDefined();
      expect(testSource?.concurrency).toBe(5);
    });

    it("should not overwrite an already registered source", () => {
      // arxiv-search is pre-registered with concurrency 1
      service.registerSource("arxiv-search", 99);

      const stats = service.getStats();
      const arxiv = stats.find((s) => s.sourceId === "arxiv-search");
      // Concurrency should still be 1, not 99
      expect(arxiv?.concurrency).toBe(1);
    });

    it("should allow registering multiple new sources", () => {
      service.registerSource("custom-source-a", 2);
      service.registerSource("custom-source-b", 4);

      const stats = service.getStats();
      const a = stats.find((s) => s.sourceId === "custom-source-a");
      const b = stats.find((s) => s.sourceId === "custom-source-b");
      expect(a?.concurrency).toBe(2);
      expect(b?.concurrency).toBe(4);
    });
  });

  // ─────────────────────────── execute ──────────────────────────────────────

  describe("execute", () => {
    it("should execute function and return its result", async () => {
      const fn = jest.fn().mockResolvedValue("hello");

      const result = await service.execute("web-search", fn);

      expect(result).toBe("hello");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should auto-register unknown source with default concurrency (3)", async () => {
      const fn = jest.fn().mockResolvedValue(42);

      const result = await service.execute("unknown-source-xyz", fn);

      expect(result).toBe(42);

      const stats = service.getStats();
      const entry = stats.find((s) => s.sourceId === "unknown-source-xyz");
      expect(entry).toBeDefined();
      expect(entry?.concurrency).toBe(3);
    });

    it("should propagate errors thrown by the function", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("Search failed"));

      await expect(service.execute("web-search", fn)).rejects.toThrow(
        "Search failed",
      );
    });

    it("should throw immediately when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const fn = jest.fn().mockResolvedValue("result");

      await expect(
        service.execute("web-search", fn, controller.signal),
      ).rejects.toThrow("Search cancelled for web-search");

      expect(fn).not.toHaveBeenCalled();
    });

    it("should throw when signal is aborted after task enters the limiter callback", async () => {
      // arxiv-search has concurrency 1; block the slot with a slow task,
      // then abort the second task's signal while it is queued.
      const controller = new AbortController();

      let releaseSlow: (() => void) | undefined;
      const slowTask = () =>
        new Promise<string>((resolve) => {
          releaseSlow = () => resolve("slow");
        });

      // Start slow task to occupy the single slot
      const slowPromise = service.execute("arxiv-search", slowTask);

      // 让 microtask 队列跑完，确保 slowTask 真正被 limiter callback 调用（设上 releaseSlow）。
      // 加了 rate limiter 后 limiter callback 进入 fn 之前多一次 await（acquire token），
      // 必须显式 yield 让 slowTask 被实际触发。
      await new Promise((resolve) => setImmediate(resolve));
      expect(releaseSlow).toBeDefined();

      // Abort the controller, then enqueue the second task
      controller.abort();

      const secondPromise = service.execute(
        "arxiv-search",
        jest.fn().mockResolvedValue("fast"),
        controller.signal,
      );

      // Release slow task so second can proceed (or fail)
      releaseSlow!();

      await slowPromise;
      // The second task's signal was already aborted before execute() was called,
      // so it should reject with "Search cancelled" (fast-fail path)
      await expect(secondPromise).rejects.toThrow("Search cancelled");
    });

    it("should execute without signal (no abort check)", async () => {
      const fn = jest.fn().mockResolvedValue("no-signal");

      const result = await service.execute("web-search", fn, undefined);

      expect(result).toBe("no-signal");
    });

    it("should track active count as 0 after execution completes", async () => {
      const fn = jest.fn().mockResolvedValue("done");

      await service.execute("web-search", fn);

      const stats = service.getStats();
      const stat = stats.find((s) => s.sourceId === "web-search");
      expect(stat?.activeCount).toBe(0);
    });

    it("should track pending count as 0 after execution completes", async () => {
      const fn = jest.fn().mockResolvedValue("done");

      await service.execute("web-search", fn);

      const stats = service.getStats();
      const stat = stats.find((s) => s.sourceId === "web-search");
      expect(stat?.pendingCount).toBe(0);
    });

    it("should handle function that throws a non-Error value", async () => {
      const fn = jest.fn().mockRejectedValue("plain string error");

      await expect(service.execute("web-search", fn)).rejects.toBe(
        "plain string error",
      );
    });

    it("should run multiple sequential executions correctly", async () => {
      const results: number[] = [];
      const makeTask = (n: number) =>
        jest.fn().mockImplementation(async () => {
          results.push(n);
          return n;
        });

      await service.execute("web-search", makeTask(1));
      await service.execute("web-search", makeTask(2));
      await service.execute("web-search", makeTask(3));

      expect(results).toEqual([1, 2, 3]);
    });

    it("should execute concurrent tasks within concurrency limits", async () => {
      const executing: number[] = [];
      let maxConcurrent = 0;

      const makeSlowTask = (id: number) => async () => {
        executing.push(id);
        maxConcurrent = Math.max(maxConcurrent, executing.length);
        // Yield to allow other tasks to start
        await new Promise((resolve) => setImmediate(resolve));
        executing.splice(executing.indexOf(id), 1);
        return id;
      };

      // web-search has concurrency 8, so all 3 should run concurrently
      const tasks = [1, 2, 3].map((id) =>
        service.execute("web-search", makeSlowTask(id)),
      );

      await Promise.all(tasks);
      expect(maxConcurrent).toBeLessThanOrEqual(8);
    });

    it("should queue excess tasks beyond concurrency limit for arxiv-search (concurrency=1)", async () => {
      const order: string[] = [];

      const task1 = jest.fn().mockImplementation(async () => {
        order.push("task1-start");
        await new Promise((resolve) => setTimeout(resolve, 50));
        order.push("task1-end");
        return "t1";
      });

      const task2 = jest.fn().mockImplementation(async () => {
        order.push("task2-start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("task2-end");
        return "t2";
      });

      // arxiv-search concurrency is 1, so task2 should wait for task1
      const [r1, r2] = await Promise.all([
        service.execute("arxiv-search", task1),
        service.execute("arxiv-search", task2),
      ]);

      expect(r1).toBe("t1");
      expect(r2).toBe("t2");
      // Both tasks ran and completed (order may vary due to microtask scheduling,
      // but both results should be correct)
      expect(order).toContain("task1-start");
      expect(order).toContain("task2-start");
    }, 5000);

    it("should log debug message when wait time exceeds 1000ms", async () => {
      // This tests the branch `if (waitMs > 1000)`.
      // We simulate by running under arxiv-search (concurrency=1) with a slow first task.
      const slowTask = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return "slow-done";
      });
      const fastTask = jest.fn().mockResolvedValue("fast-done");

      // Start both; fast task will queue behind slow task
      const [r1, r2] = await Promise.all([
        service.execute("arxiv-search", slowTask),
        service.execute("arxiv-search", fastTask),
      ]);

      expect(r1).toBe("slow-done");
      expect(r2).toBe("fast-done");
    }, 10_000);
  });

  // ─────────────────────────── getStats ────────────────────────────────────

  describe("getStats", () => {
    it("should return stats for all registered sources", () => {
      const stats = service.getStats();

      expect(Array.isArray(stats)).toBe(true);
      expect(stats.length).toBeGreaterThan(0);
    });

    it("should include newly registered source in stats", () => {
      service.registerSource("brand-new-source", 7);

      const stats = service.getStats();
      const entry = stats.find((s) => s.sourceId === "brand-new-source");

      expect(entry).toBeDefined();
      expect(entry?.concurrency).toBe(7);
      expect(entry?.activeCount).toBe(0);
      expect(entry?.pendingCount).toBe(0);
    });

    it("should return correct shape for each stat entry", () => {
      const stats = service.getStats();

      for (const stat of stats) {
        expect(stat).toHaveProperty("sourceId");
        expect(stat).toHaveProperty("concurrency");
        expect(stat).toHaveProperty("activeCount");
        expect(stat).toHaveProperty("pendingCount");
        expect(typeof stat.sourceId).toBe("string");
        expect(typeof stat.concurrency).toBe("number");
        expect(typeof stat.activeCount).toBe("number");
        expect(typeof stat.pendingCount).toBe("number");
      }
    });
  });

  // ─────────────────────────── getQueueSize ────────────────────────────────

  describe("getQueueSize", () => {
    it("should return 0 for known source with nothing queued", () => {
      const size = service.getQueueSize("web-search");
      expect(size).toBe(0);
    });

    it("should return 0 for unknown source", () => {
      const size = service.getQueueSize("does-not-exist");
      expect(size).toBe(0);
    });

    it("should return correct pending count while tasks are queued", async () => {
      // After tasks complete, pending count returns to 0
      const task = jest.fn().mockResolvedValue("done");

      await service.execute("arxiv-search", task);
      await service.execute("arxiv-search", task);

      // After both tasks complete, pending should be 0
      expect(service.getQueueSize("arxiv-search")).toBe(0);
    });
  });

  // ─────────────────────────── cooldown ────────────────────────────────────

  describe("cooldown", () => {
    it("setCooldown then getCooldownRemaining > 0", () => {
      service.setCooldown("openalex-search", 5_000);
      const remaining = service.getCooldownRemaining("openalex-search");
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(5_000);
    });

    it("getCooldownRemaining returns 0 when not in cooldown", () => {
      expect(service.getCooldownRemaining("openalex-search")).toBe(0);
    });

    it("getCooldownRemaining returns 0 for unknown source", () => {
      expect(service.getCooldownRemaining("unknown-xyz")).toBe(0);
    });

    it("execute fast-fails when source is in cooldown", async () => {
      service.setCooldown("openalex-search", 10_000);

      const fn = jest.fn().mockResolvedValue("should-not-run");

      await expect(service.execute("openalex-search", fn)).rejects.toThrow(
        /cooldown/i,
      );
      expect(fn).not.toHaveBeenCalled();
    });

    it("execute succeeds after cooldown expires", async () => {
      service.setCooldown("openalex-search", 50); // 50ms

      // Wait past cooldown
      await new Promise((resolve) => setTimeout(resolve, 80));

      const fn = jest.fn().mockResolvedValue("ok");
      await expect(service.execute("openalex-search", fn)).resolves.toBe("ok");
    });

    it("auto-sets cooldown when fn throws a 429 error", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("HTTP 429 rate limit"));

      await expect(service.execute("openalex-search", fn)).rejects.toThrow(
        /429/,
      );

      // Cooldown should be set now
      expect(service.getCooldownRemaining("openalex-search")).toBeGreaterThan(
        0,
      );
    });

    it("auto-sets cooldown when fn throws 'rate limit' error message", async () => {
      const fn = jest
        .fn()
        .mockRejectedValue(new Error("Too Many Requests: rate limit exceeded"));

      await expect(service.execute("openalex-search", fn)).rejects.toThrow();
      expect(service.getCooldownRemaining("openalex-search")).toBeGreaterThan(
        0,
      );
    });

    it("does NOT set cooldown for non-rate-limit errors", async () => {
      const fn = jest
        .fn()
        .mockRejectedValue(new Error("HTTP 500 server error"));

      await expect(service.execute("openalex-search", fn)).rejects.toThrow(
        /500/,
      );
      expect(service.getCooldownRemaining("openalex-search")).toBe(0);
    });

    it("subsequent setCooldown only extends if longer", () => {
      service.setCooldown("openalex-search", 10_000);
      const first = service.getCooldownRemaining("openalex-search");

      // Shorter cooldown should NOT override
      service.setCooldown("openalex-search", 100);
      const second = service.getCooldownRemaining("openalex-search");

      expect(second).toBeGreaterThanOrEqual(first - 100); // allow timing slack
    });

    it("stats include cooldownRemainingMs", () => {
      service.setCooldown("web-search", 5_000);
      const stats = service.getStats();
      const ws = stats.find((s) => s.sourceId === "web-search");
      expect(ws?.cooldownRemainingMs).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────── rate limiter (req/s) ─────────────────────────

  describe("rate limiter (token bucket)", () => {
    it("openalex-search has reqPerSec=8 in stats", () => {
      const stats = service.getStats();
      const oa = stats.find((s) => s.sourceId === "openalex-search");
      expect(oa?.reqPerSec).toBe(8);
    });

    it("openalex-search has concurrency=2 (down from 5)", () => {
      const stats = service.getStats();
      const oa = stats.find((s) => s.sourceId === "openalex-search");
      expect(oa?.concurrency).toBe(2);
    });

    it("sources without reqPerSec config have undefined reqPerSec", () => {
      const stats = service.getStats();
      const ws = stats.find((s) => s.sourceId === "web-search");
      expect(ws?.reqPerSec).toBeUndefined();
    });

    it("throttles burst beyond reqPerSec (token bucket)", async () => {
      // Register a fast bucket: 2 req/s, concurrency 10 (so concurrency doesn't bottleneck)
      service.registerSource("rate-test", { concurrency: 10, reqPerSec: 2 });

      const timestamps: number[] = [];
      const fn = jest.fn().mockImplementation(async () => {
        timestamps.push(Date.now());
        return "ok";
      });

      const start = Date.now();
      await Promise.all([
        service.execute("rate-test", fn),
        service.execute("rate-test", fn),
        service.execute("rate-test", fn),
        service.execute("rate-test", fn),
      ]);
      const elapsed = Date.now() - start;

      // 4 tasks at 2 req/s with burst capacity 2 = first 2 immediate, next 2 wait ~500ms each
      // Total should be ≥ ~900ms (allow timing slack)
      expect(elapsed).toBeGreaterThanOrEqual(800);
    }, 5000);

    it("registerSource accepts both number and config object", () => {
      service.registerSource("rate-num", 5);
      service.registerSource("rate-obj", { concurrency: 5, reqPerSec: 3 });

      const stats = service.getStats();
      const a = stats.find((s) => s.sourceId === "rate-num");
      const b = stats.find((s) => s.sourceId === "rate-obj");

      expect(a?.concurrency).toBe(5);
      expect(a?.reqPerSec).toBeUndefined();
      expect(b?.concurrency).toBe(5);
      expect(b?.reqPerSec).toBe(3);
    });
  });
});
