import { ConcurrencyLimiter } from "../concurrency-limiter";

describe("ConcurrencyLimiter", () => {
  it("rejects invalid maxConcurrent", () => {
    expect(() => new ConcurrencyLimiter(0)).toThrow();
    expect(() => new ConcurrencyLimiter(-1)).toThrow();
    expect(() => new ConcurrencyLimiter(NaN)).toThrow();
    expect(() => new ConcurrencyLimiter(Infinity)).toThrow();
  });

  it("acquires immediately when below capacity", async () => {
    const lim = new ConcurrencyLimiter(2);
    const r1 = await lim.acquire();
    expect(lim.activeCount).toBe(1);
    const r2 = await lim.acquire();
    expect(lim.activeCount).toBe(2);
    r1();
    r2();
  });

  it("queues acquires when at capacity", async () => {
    const lim = new ConcurrencyLimiter(1);
    const r1 = await lim.acquire();
    expect(lim.activeCount).toBe(1);
    let secondAcquired = false;
    const p2 = lim.acquire().then((r) => {
      secondAcquired = true;
      return r;
    });
    // microtask flush
    await Promise.resolve();
    expect(secondAcquired).toBe(false);
    expect(lim.pendingCount).toBe(1);

    r1(); // release first
    const r2 = await p2;
    expect(secondAcquired).toBe(true);
    r2();
  });

  it("run() auto releases on success", async () => {
    const lim = new ConcurrencyLimiter(1);
    const result = await lim.run(async () => 42);
    expect(result).toBe(42);
    expect(lim.activeCount).toBe(0);
  });

  it("run() auto releases on error", async () => {
    const lim = new ConcurrencyLimiter(1);
    await expect(
      lim.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(lim.activeCount).toBe(0);
  });

  it("release is idempotent", async () => {
    const lim = new ConcurrencyLimiter(1);
    const r = await lim.acquire();
    r();
    r();
    r();
    expect(lim.activeCount).toBe(0);
  });

  it("FIFO order under contention", async () => {
    const lim = new ConcurrencyLimiter(1);
    const order: number[] = [];
    const r0 = await lim.acquire();
    const promises = [1, 2, 3].map((id) =>
      lim.run(async () => {
        order.push(id);
      }),
    );
    // 确保 3 个都已 enqueue
    await Promise.resolve();
    expect(lim.pendingCount).toBe(3);
    r0();
    await Promise.all(promises);
    expect(order).toEqual([1, 2, 3]);
  });

  it("respects max concurrency under load", async () => {
    const lim = new ConcurrencyLimiter(2);
    let peak = 0;
    let active = 0;
    const tasks = Array.from({ length: 8 }).map(() =>
      lim.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      }),
    );
    await Promise.all(tasks);
    expect(peak).toBe(2);
    expect(lim.activeCount).toBe(0);
  });
});
