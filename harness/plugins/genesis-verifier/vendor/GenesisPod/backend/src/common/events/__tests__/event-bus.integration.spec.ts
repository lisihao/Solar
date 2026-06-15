/**
 * EventBus — extra branch coverage (PR-K extra / PR-E Phase 2 P0-4 update)
 * Covers: unregisterAdapter, adapter failure handling, global throttle (no agentId),
 *         duplicate adapter skip, throttle reset, schema-less events, key-less idempotency,
 *         defaultAdapter constructor slot.
 *
 * Note: gcThrottle / gcIdempotency tests removed — those in-memory GC routines were
 * replaced by Redis TTL-based expiry in PR-E Phase 2 P0-4. No explicit GC needed.
 */

import { EventRegistry } from "../event-registry";
import { EventBus } from "../event-bus";
import type { IBroadcastAdapter } from "../broadcast-adapter";
import type { DomainEvent } from "../domain-event.types";
import type { CacheService } from "@/common/cache/cache.service";

/** In-memory CacheService mock with TTL semantics */
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
  throwOnBroadcast = false,
) {
  const calls: DomainEvent[] = [];
  const adapter: IBroadcastAdapter = {
    id,
    accepts,
    broadcast: async (e) => {
      if (throwOnBroadcast) throw new Error("adapter exploded");
      calls.push(e);
    },
  };
  return { adapter, calls };
}

function makeReg(
  type: string,
  opts?: {
    throttle?: { windowMs: number; maxEvents: number };
    schema?: unknown;
  },
) {
  const reg = new EventRegistry();
  reg.register({ type, ...(opts ?? {}) });
  return reg;
}

describe("EventBus — extra branches", () => {
  it("unregisterAdapter removes it from delivery", async () => {
    const reg = makeReg("u.evt");
    const bus = new EventBus(reg, mkCacheMock());
    const { adapter, calls } = mkAdapter("ua");
    bus.registerAdapter(adapter);

    // Emits once before unregister
    await bus.emit({ type: "u.evt", scope: {}, payload: {}, timestamp: 0 });
    expect(calls).toHaveLength(1);

    bus.unregisterAdapter("ua");
    await bus.emit({ type: "u.evt", scope: {}, payload: {}, timestamp: 0 });
    expect(calls).toHaveLength(1); // no new delivery
  });

  it("unregisterAdapter on unknown id is a no-op", () => {
    const bus = new EventBus(new EventRegistry(), mkCacheMock());
    expect(() => bus.unregisterAdapter("nonexistent")).not.toThrow();
  });

  it("adapter broadcast failure is swallowed — event returns true", async () => {
    const reg = makeReg("fail.evt");
    const bus = new EventBus(reg, mkCacheMock());
    const { adapter: failAdapter } = mkAdapter("fail", () => true, true);
    const { adapter: okAdapter, calls: okCalls } = mkAdapter("ok");
    bus.registerAdapter(failAdapter);
    bus.registerAdapter(okAdapter);

    const result = await bus.emit({
      type: "fail.evt",
      scope: {},
      payload: {},
      timestamp: 0,
    });
    expect(result).toBe(true);
    expect(okCalls).toHaveLength(1); // ok adapter still called
  });

  it("duplicate adapter id is not re-added", async () => {
    const reg = makeReg("dup.evt");
    const bus = new EventBus(reg, mkCacheMock());
    const { adapter, calls } = mkAdapter("dup");
    bus.registerAdapter(adapter);
    bus.registerAdapter(adapter); // second register with same id
    await bus.emit({ type: "dup.evt", scope: {}, payload: {}, timestamp: 0 });
    expect(calls).toHaveLength(1); // delivered once, not twice
  });

  it("global throttle applies when no agentId on event", async () => {
    const reg = new EventRegistry();
    reg.register({
      type: "global.evt",
      throttle: { windowMs: 10000, maxEvents: 1 },
    });
    const bus = new EventBus(reg, mkCacheMock());
    const { adapter, calls } = mkAdapter("t");
    bus.registerAdapter(adapter);

    const makeEvent = () => ({
      type: "global.evt" as const,
      scope: {} as Record<string, unknown>,
      payload: {},
      timestamp: Date.now(),
      // no agentId — uses __global__ key
    });

    expect(await bus.emit(makeEvent())).toBe(true);
    expect(await bus.emit(makeEvent())).toBe(false); // throttled globally
    expect(calls).toHaveLength(1);
  });

  it("throttle resets after windowMs elapses", async () => {
    jest.useFakeTimers();
    const reg = new EventRegistry();
    reg.register({
      type: "win.evt",
      throttle: { windowMs: 100, maxEvents: 1 },
    });
    const bus = new EventBus(reg, mkCacheMock());
    const { adapter, calls } = mkAdapter("t");
    bus.registerAdapter(adapter);

    const makeEvent = () => ({
      type: "win.evt" as const,
      scope: {} as Record<string, unknown>,
      payload: {},
      agentId: "a1",
      timestamp: Date.now(),
    });

    expect(await bus.emit(makeEvent())).toBe(true);
    expect(await bus.emit(makeEvent())).toBe(false); // throttled

    // Advance past window — cache mock uses Date.now() so fake timers affect TTL checks
    jest.advanceTimersByTime(200);
    expect(await bus.emit(makeEvent())).toBe(true); // new window
    expect(calls).toHaveLength(2);
    jest.useRealTimers();
  });

  it("many unique agentIds do not cause errors (Redis TTL handles expiry)", async () => {
    const reg = new EventRegistry();
    reg.register({ type: "gc.evt", throttle: { windowMs: 1, maxEvents: 999 } });
    const bus = new EventBus(reg, mkCacheMock());
    // Emit 200 times with unique agentIds — no GC counter needed, Redis TTL expires entries
    for (let i = 0; i < 200; i++) {
      await bus.emit({
        type: "gc.evt",
        scope: {},
        payload: {},
        agentId: `agent-${i}`,
        timestamp: Date.now(),
      });
    }
    // Verify no error thrown
  });

  it("many unique idempotencyKeys do not cause errors (Redis TTL handles expiry)", async () => {
    const reg = new EventRegistry();
    reg.register({ type: "idem.evt" });
    const bus = new EventBus(reg, mkCacheMock());
    // Emit 200 unique keys — no cap-based GC needed, Redis TTL expires entries
    for (let i = 0; i < 200; i++) {
      await bus.emit({
        type: "idem.evt",
        scope: {},
        payload: {},
        idempotencyKey: `key-${i}`,
        timestamp: Date.now(),
      });
    }
    // Verify no error thrown
  });

  it("schema validation allows events without schema", async () => {
    const reg = new EventRegistry();
    reg.register({ type: "no.schema.evt" }); // no schema
    const bus = new EventBus(reg, mkCacheMock());
    const { adapter, calls } = mkAdapter("t");
    bus.registerAdapter(adapter);

    const result = await bus.emit({
      type: "no.schema.evt",
      scope: {},
      payload: { anything: true },
      timestamp: 0,
    });
    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("idempotency key dedup does not affect events without key", async () => {
    const reg = makeReg("nokey.evt");
    const bus = new EventBus(reg, mkCacheMock());
    const { adapter, calls } = mkAdapter("t");
    bus.registerAdapter(adapter);

    const make = () => ({
      type: "nokey.evt" as const,
      scope: {} as Record<string, unknown>,
      payload: {},
      timestamp: 0,
    });
    await bus.emit(make());
    await bus.emit(make());
    expect(calls).toHaveLength(2); // both delivered, no dedup
  });

  it("defaultAdapter (LoggerBroadcastAdapter) passed via constructor is used", async () => {
    const reg = makeReg("def.evt");
    const { adapter: defaultAdapter, calls } = mkAdapter("logger");
    // Pass as optional third arg (LoggerBroadcastAdapter slot)
    const bus = new EventBus(reg, mkCacheMock(), defaultAdapter as never);
    await bus.emit({ type: "def.evt", scope: {}, payload: {}, timestamp: 0 });
    expect(calls).toHaveLength(1);
  });
});
