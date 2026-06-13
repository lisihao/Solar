import { AiChatFailoverCallerService } from "../ai-chat-failover-caller.service";

/**
 * L4 回归：rpmCache / rpmNextSlotAt 两个 per-(user,model) Map 之前只 get/set、
 * 无界增长（rpmCache 连 null-rpm 也缓存）。sweepRpmMaps 周期性清扫 idle 条目。
 */
describe("AiChatFailoverCallerService — rpm map eviction (L4)", () => {
  function makeService(): Record<string, unknown> {
    return new AiChatFailoverCallerService(
      {} as never,
      {} as never,
      {} as never,
      undefined,
    ) as unknown as Record<string, unknown>;
  }

  it("sweepRpmMaps 删 TTL 过期 rpmCache + 已远过去时隙 rpmNextSlotAt，保留新鲜条目", () => {
    const svc = makeService();
    const rpmCache = svc.rpmCache as Map<
      string,
      { rpm: number | null; at: number }
    >;
    const rpmNextSlotAt = svc.rpmNextSlotAt as Map<string, number>;
    const now = 10_000_000;
    const TTL = 60_000;

    // 过期（含 null-rpm 条目，正是无界增长的来源）
    rpmCache.set("stale", { rpm: null, at: now - TTL - 1 });
    rpmNextSlotAt.set("stale", now - TTL - 1);
    // 新鲜
    rpmCache.set("fresh", { rpm: 60, at: now });
    rpmNextSlotAt.set("fresh", now + 5_000);

    (svc.sweepRpmMaps as (n: number) => void).call(svc, now);

    expect(rpmCache.has("stale")).toBe(false);
    expect(rpmNextSlotAt.has("stale")).toBe(false);
    expect(rpmCache.has("fresh")).toBe(true);
    expect(rpmNextSlotAt.has("fresh")).toBe(true);
  });
});
