/**
 * runDagConcurrency framework spec — 验证：
 *   - 拓扑顺序遵守（依赖完成后才调度）
 *   - 并发上限（任意时刻 ≤ concurrency）
 *   - cycle / missing deps → fallback flat
 *   - results 按 input 顺序填充（不按完成顺序）
 *   - firstError 后续不调度但 in-flight 跑完
 *   - empty input → []
 */

import { runDagConcurrency } from "../business-team-dag-concurrency";

describe("runDagConcurrency", () => {
  it("returns [] for empty input", async () => {
    const result = await runDagConcurrency<{ id: string }, number>(
      [],
      4,
      async () => 0,
    );
    expect(result).toEqual([]);
  });

  it("preserves input order in the results array (not completion order)", async () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    // c completes first, b second, a third — but results[0]=a's out, [2]=c's out
    const result = await runDagConcurrency<{ id: string }, string>(
      items,
      3,
      async (item, idx) => {
        const delays: Record<string, number> = { a: 30, b: 20, c: 10 };
        await new Promise((r) => setTimeout(r, delays[item.id] ?? 0));
        return `${item.id}@${idx}`;
      },
    );
    expect(result).toEqual(["a@0", "b@1", "c@2"]);
  });

  it("respects dependsOn (downstream waits for upstream completion)", async () => {
    const completedAt: Record<string, number> = {};
    const startedAt: Record<string, number> = {};
    const items = [
      { id: "root" },
      { id: "mid", dependsOn: ["root"] },
      { id: "leaf", dependsOn: ["mid"] },
    ];
    await runDagConcurrency(items, 4, async (item) => {
      startedAt[item.id] = Date.now();
      await new Promise((r) => setTimeout(r, 20));
      completedAt[item.id] = Date.now();
      return item.id;
    });
    // mid started after root completed; leaf started after mid completed
    expect(startedAt.mid).toBeGreaterThanOrEqual(completedAt.root);
    expect(startedAt.leaf).toBeGreaterThanOrEqual(completedAt.mid);
  });

  it("enforces concurrency cap (at most N in-flight at once)", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 8 }, (_, i) => ({ id: String(i) }));
    await runDagConcurrency(items, 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("falls back to flat concurrency on cycle", async () => {
    const items = [
      { id: "a", dependsOn: ["b"] },
      { id: "b", dependsOn: ["a"] },
    ];
    const result = await runDagConcurrency(items, 4, async (item) => item.id);
    // fallback still runs all items
    expect(result.sort()).toEqual(["a", "b"]);
  });

  it("ignores dependsOn entries that reference missing ids", async () => {
    // dependsOn=["ghost"] not in items → filtered out, indeg=0 → runs immediately
    const items = [{ id: "a", dependsOn: ["ghost"] }];
    const result = await runDagConcurrency(items, 1, async (item) => item.id);
    expect(result).toEqual(["a"]);
  });

  it("propagates first error and stops dispatching new tasks", async () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c", dependsOn: ["a"] }];
    let cCalled = false;
    await expect(
      runDagConcurrency(items, 1, async (item) => {
        if (item.id === "a") throw new Error("boom");
        if (item.id === "c") cCalled = true;
        return item.id;
      }),
    ).rejects.toThrow("boom");
    // c depends on a; a failed → c never runs
    expect(cCalled).toBe(false);
  });
});
