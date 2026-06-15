/**
 * EventBus 单测 (PR-K / PR-E Phase 2 P0-4)
 *
 * CacheService 用进程内 Map mock 替代，语义与真实 Redis 等价：
 *   - get: 若 key 存在且未过期返回值，否则 undefined
 *   - set: 存值 + TTL（秒）
 */

import { z } from "zod";
import { EventRegistry } from "../event-registry";
import { EventBus } from "../event-bus";
import type { IBroadcastAdapter } from "../broadcast-adapter";
import type { DomainEvent } from "../domain-event.types";
import type { CacheService } from "@/common/cache/cache.service";

/** In-memory CacheService mock，行为与 Redis TTL 语义对齐 */
function mkCacheMock(): CacheService {
  const store = new Map<string, { value: string; expiresAt: number }>();

  return {
    get: jest.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    }),
    set: jest.fn(async (key: string, value: string, ttlSec: number) => {
      store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    // Other CacheService methods not exercised by EventBus
    getOrSet: jest.fn(),
    delByPrefix: jest.fn(),
    invalidateAIModelCache: jest.fn(),
    invalidateUserCache: jest.fn(),
    buildKey: jest.fn(),
  } as unknown as CacheService;
}

function mkAdapter(
  id: string,
  accepts: (e: DomainEvent) => boolean = () => true,
) {
  const calls: DomainEvent[] = [];
  const adapter: IBroadcastAdapter = {
    id,
    accepts,
    broadcast: async (e) => {
      calls.push(e);
    },
  };
  return { adapter, calls };
}

describe("EventBus (PR-K / PR-E P0-4)", () => {
  it("rejects unregistered event types", async () => {
    const bus = new EventBus(new EventRegistry(), mkCacheMock());
    const ok = await bus.emit({
      type: "unknown.event",
      scope: {},
      payload: {},
      timestamp: 0,
    });
    expect(ok).toBe(false);
  });

  it("validates payload against registered schema", async () => {
    const reg = new EventRegistry();
    reg.register({
      type: "test.event",
      schema: z.object({ count: z.number() }),
    });
    const bus = new EventBus(reg, mkCacheMock());
    const a = mkAdapter("t");
    bus.registerAdapter(a.adapter);

    expect(
      await bus.emit({
        type: "test.event",
        scope: {},
        payload: { count: "not a number" } as never,
        timestamp: 0,
      }),
    ).toBe(false);
    expect(a.calls).toHaveLength(0);

    expect(
      await bus.emit({
        type: "test.event",
        scope: {},
        payload: { count: 42 },
        timestamp: 0,
      }),
    ).toBe(true);
    expect(a.calls).toHaveLength(1);
  });

  it("dedupes by idempotencyKey within TTL (Redis-backed)", async () => {
    const reg = new EventRegistry();
    reg.register({ type: "x.evt" });
    const cache = mkCacheMock();
    const bus = new EventBus(reg, cache);
    const a = mkAdapter("t");
    bus.registerAdapter(a.adapter);

    const e: DomainEvent = {
      type: "x.evt",
      scope: {},
      payload: {},
      timestamp: 0,
      idempotencyKey: "same",
    };
    expect(await bus.emit(e)).toBe(true);
    expect(await bus.emit(e)).toBe(false);
    expect(a.calls).toHaveLength(1);

    // Verify Redis key was written with correct prefix
    expect(cache.set).toHaveBeenCalledWith(
      "harness:event-bus:idempotency:same",
      "1",
      60,
    );
  });

  it("allows distinct idempotencyKeys to both emit", async () => {
    const reg = new EventRegistry();
    reg.register({ type: "x.evt" });
    const bus = new EventBus(reg, mkCacheMock());
    const a = mkAdapter("t");
    bus.registerAdapter(a.adapter);

    expect(
      await bus.emit({
        type: "x.evt",
        scope: {},
        payload: {},
        timestamp: 0,
        idempotencyKey: "key-A",
      }),
    ).toBe(true);
    expect(
      await bus.emit({
        type: "x.evt",
        scope: {},
        payload: {},
        timestamp: 0,
        idempotencyKey: "key-B",
      }),
    ).toBe(true);
    expect(a.calls).toHaveLength(2);
  });

  it("throttles per agentId per window (Redis-backed)", async () => {
    const reg = new EventRegistry();
    reg.register({
      type: "fast.evt",
      throttle: { windowMs: 1000, maxEvents: 2 },
    });
    const bus = new EventBus(reg, mkCacheMock());
    const a = mkAdapter("t");
    bus.registerAdapter(a.adapter);

    const make = () => ({
      type: "fast.evt",
      scope: {},
      payload: {},
      agentId: "a1",
      timestamp: Date.now(),
    });
    expect(await bus.emit(make())).toBe(true);
    expect(await bus.emit(make())).toBe(true);
    expect(await bus.emit(make())).toBe(false); // throttled
    expect(a.calls).toHaveLength(2);
  });

  it("throttle counts are independent across different agentIds", async () => {
    const reg = new EventRegistry();
    reg.register({
      type: "fast.evt",
      throttle: { windowMs: 1000, maxEvents: 1 },
    });
    const bus = new EventBus(reg, mkCacheMock());
    const a = mkAdapter("t");
    bus.registerAdapter(a.adapter);

    expect(
      await bus.emit({
        type: "fast.evt",
        scope: {},
        payload: {},
        agentId: "agent-1",
        timestamp: Date.now(),
      }),
    ).toBe(true);
    // Different agentId — should not be throttled
    expect(
      await bus.emit({
        type: "fast.evt",
        scope: {},
        payload: {},
        agentId: "agent-2",
        timestamp: Date.now(),
      }),
    ).toBe(true);
    // Same agentId again — throttled
    expect(
      await bus.emit({
        type: "fast.evt",
        scope: {},
        payload: {},
        agentId: "agent-1",
        timestamp: Date.now(),
      }),
    ).toBe(false);
    expect(a.calls).toHaveLength(2);
  });

  it("only delivers to adapters that accept the event", async () => {
    const reg = new EventRegistry();
    reg.register({ type: "ws.evt" });
    const bus = new EventBus(reg, mkCacheMock());
    const wsAdapter = mkAdapter("ws", (e) => e.type.startsWith("ws."));
    const otherAdapter = mkAdapter("other", (e) => e.type.startsWith("rest."));
    bus.registerAdapter(wsAdapter.adapter);
    bus.registerAdapter(otherAdapter.adapter);

    await bus.emit({
      type: "ws.evt",
      scope: {},
      payload: {},
      timestamp: 0,
    });
    expect(wsAdapter.calls).toHaveLength(1);
    expect(otherAdapter.calls).toHaveLength(0);
  });

  it("throttle Redis key uses correct prefix and TTL", async () => {
    const reg = new EventRegistry();
    reg.register({
      type: "thr.evt",
      throttle: { windowMs: 5000, maxEvents: 10 },
    });
    const cache = mkCacheMock();
    const bus = new EventBus(reg, cache);
    bus.registerAdapter(mkAdapter("t").adapter);

    await bus.emit({
      type: "thr.evt",
      scope: {},
      payload: {},
      agentId: "ag1",
      timestamp: Date.now(),
    });

    const [key, _value, ttl] = (cache.set as jest.Mock).mock.calls[0] as [
      string,
      string,
      number,
    ];
    expect(key).toBe("harness:event-bus:throttle:thr.evt|ag1");
    expect(ttl).toBe(5); // ceil(5000 / 1000)
  });
});
