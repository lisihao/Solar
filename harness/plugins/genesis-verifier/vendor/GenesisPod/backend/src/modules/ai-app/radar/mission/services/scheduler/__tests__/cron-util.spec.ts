import { computeNextCronTick } from "../cron-util";

describe("radar/scheduler/cron-util", () => {
  it("computes next tick for hourly cron", () => {
    const from = new Date("2026-05-16T10:00:00Z");
    const next = computeNextCronTick("0 */6 * * *", from);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
    // 6 小时内
    expect(next!.getTime() - from.getTime()).toBeLessThanOrEqual(
      6 * 60 * 60 * 1000,
    );
  });

  it("computes daily cron (local-time 0 hour)", () => {
    const from = new Date("2026-05-16T10:00:00Z");
    const next = computeNextCronTick("0 0 * * *", from);
    expect(next).not.toBeNull();
    // cron-parser 默认 local time，0 0 * * * 表示 local 0 点
    expect(next!.getHours()).toBe(0);
    expect(next!.getMinutes()).toBe(0);
  });

  it("returns null for invalid cron", () => {
    expect(computeNextCronTick("not a cron")).toBeNull();
    expect(computeNextCronTick("99 99 99 99 99")).toBeNull();
  });

  it("two consecutive ticks for */N hours = N hours apart", () => {
    const t0 = new Date("2026-05-16T00:00:00Z");
    const t1 = computeNextCronTick("0 */6 * * *", t0)!;
    const t2 = computeNextCronTick("0 */6 * * *", t1)!;
    expect(t2.getTime() - t1.getTime()).toBe(6 * 60 * 60 * 1000);
  });
});
