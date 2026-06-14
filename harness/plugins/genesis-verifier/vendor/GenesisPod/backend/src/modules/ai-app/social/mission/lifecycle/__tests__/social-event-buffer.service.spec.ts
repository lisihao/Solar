/**
 * social-event-buffer.service.spec.ts
 *
 * Tests: accepts predicate, broadcast push/overflow/no-missionId,
 * read (full/sinceTs), clear, GC (TTL expiry), Logger.debug spy.
 */

import { Logger } from "@nestjs/common";
import { SocialEventBuffer } from "../social-event-buffer.service";
import type { DomainEvent } from "@/modules/ai-harness/facade";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeEvent(
  type: string,
  missionId: string,
  timestamp: number,
  overrides: Partial<DomainEvent> = {},
): DomainEvent {
  return {
    type,
    payload: { data: `payload-for-${type}` },
    scope: { missionId },
    agentId: "agent-test",
    traceId: "trace-test",
    timestamp,
    ...overrides,
  } as DomainEvent;
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("SocialEventBuffer", () => {
  let buffer: SocialEventBuffer;

  beforeEach(() => {
    buffer = new SocialEventBuffer();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ── accepts ───────────────────────────────────────────────────────────────

  describe("accepts", () => {
    it("returns true for social.* events", () => {
      const ev = makeEvent("social.mission:started", "m-1", Date.now());
      expect(buffer.accepts(ev)).toBe(true);
    });

    it("returns true for social.stage:completed", () => {
      const ev = makeEvent("social.stage:completed", "m-1", Date.now());
      expect(buffer.accepts(ev)).toBe(true);
    });

    it("returns false for non-social events", () => {
      const ev = makeEvent(
        "playground.mission:started",
        "m-1",
        Date.now(),
      );
      expect(buffer.accepts(ev)).toBe(false);
    });

    it("returns false for empty-prefix event", () => {
      const ev = makeEvent("mission:started", "m-2", Date.now());
      expect(buffer.accepts(ev)).toBe(false);
    });
  });

  // ── broadcast ─────────────────────────────────────────────────────────────

  describe("broadcast", () => {
    it("stores an event and it is readable via read()", async () => {
      const now = 1700000000000;
      const ev = makeEvent("social.mission:started", "m-store", now);
      await buffer.broadcast(ev);
      const events = buffer.read("m-store");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("social.mission:started");
      expect(events[0].timestamp).toBe(now);
    });

    it("stores multiple events in FIFO order", async () => {
      await buffer.broadcast(makeEvent("social.stage:started", "m-order", 100));
      await buffer.broadcast(
        makeEvent("social.stage:completed", "m-order", 200),
      );
      await buffer.broadcast(makeEvent("social.cost:tick", "m-order", 300));
      const events = buffer.read("m-order");
      expect(events).toHaveLength(3);
      expect(events[0].type).toBe("social.stage:started");
      expect(events[2].type).toBe("social.cost:tick");
    });

    it("does not store event when missionId is missing", async () => {
      const ev = makeEvent("social.mission:started", "", Date.now(), {
        scope: { missionId: undefined },
      } as Partial<DomainEvent>);
      await buffer.broadcast(ev);
      expect(buffer.read("")).toHaveLength(0);
    });

    it("stores events for different missions independently", async () => {
      await buffer.broadcast(makeEvent("social.mission:started", "m-A", 100));
      await buffer.broadcast(makeEvent("social.mission:completed", "m-B", 200));
      expect(buffer.read("m-A")).toHaveLength(1);
      expect(buffer.read("m-B")).toHaveLength(1);
      expect(buffer.read("m-A")[0].type).toBe("social.mission:started");
    });

    it("returns a deep clone so mutations do not affect internal state", async () => {
      await buffer.broadcast(makeEvent("social.cost:tick", "m-clone", 500));
      const events = buffer.read("m-clone");
      events[0].type = "mutated";
      // internal state should be unchanged
      const events2 = buffer.read("m-clone");
      expect(events2[0].type).toBe("social.cost:tick");
    });
  });

  // ── overflow / MAX_PER_MISSION ────────────────────────────────────────────

  describe("overflow (MAX_PER_MISSION = 5000)", () => {
    // 2026-05-17 修复：原 structuredClone(5000 events) 在 Windows + jest worker
    // 默认堆下 OOM。read() 改顶层浅克隆（option a），unskip 此 test。
    it("keeps only the last 5000 events when overflow occurs", async () => {
      const LIMIT = 5000;
      const EXTRA = 10;
      // broadcast 5010 events
      for (let i = 0; i < LIMIT + EXTRA; i++) {
        await buffer.broadcast(
          makeEvent("social.stage:started", "m-overflow", i),
        );
      }
      const events = buffer.read("m-overflow");
      expect(events).toHaveLength(LIMIT);
      // The first EXTRA events should have been discarded; oldest kept = ts=EXTRA
      expect(events[0].timestamp).toBe(EXTRA);
      // The last event should be the final one
      expect(events[LIMIT - 1].timestamp).toBe(LIMIT + EXTRA - 1);
    });
  });

  // ── read ──────────────────────────────────────────────────────────────────

  describe("read", () => {
    it("returns empty array for unknown missionId", () => {
      expect(buffer.read("no-such-mission")).toEqual([]);
    });

    it("returns all events when sinceTs is undefined", async () => {
      await buffer.broadcast(makeEvent("social.cost:tick", "m-read", 100));
      await buffer.broadcast(makeEvent("social.cost:tick", "m-read", 200));
      const events = buffer.read("m-read");
      expect(events).toHaveLength(2);
    });

    it("filters events by sinceTs (inclusive)", async () => {
      await buffer.broadcast(
        makeEvent("social.agent:thought", "m-filter", 100),
      );
      await buffer.broadcast(
        makeEvent("social.agent:thought", "m-filter", 200),
      );
      await buffer.broadcast(
        makeEvent("social.agent:thought", "m-filter", 300),
      );
      const events = buffer.read("m-filter", 200);
      expect(events).toHaveLength(2);
      expect(events[0].timestamp).toBe(200);
      expect(events[1].timestamp).toBe(300);
    });

    it("returns empty array when sinceTs is after all events", async () => {
      await buffer.broadcast(makeEvent("social.cost:tick", "m-future", 100));
      expect(buffer.read("m-future", 9999)).toHaveLength(0);
    });
  });

  // ── clear ─────────────────────────────────────────────────────────────────

  describe("clear", () => {
    it("removes all buffered events for a mission", async () => {
      await buffer.broadcast(
        makeEvent("social.mission:started", "m-clear", 100),
      );
      await buffer.broadcast(
        makeEvent("social.mission:completed", "m-clear", 200),
      );
      expect(buffer.read("m-clear")).toHaveLength(2);
      buffer.clear("m-clear");
      expect(buffer.read("m-clear")).toHaveLength(0);
    });

    it("does not affect other missions when one is cleared", async () => {
      await buffer.broadcast(makeEvent("social.cost:tick", "m-keep", 100));
      await buffer.broadcast(makeEvent("social.cost:tick", "m-drop", 100));
      buffer.clear("m-drop");
      expect(buffer.read("m-keep")).toHaveLength(1);
      expect(buffer.read("m-drop")).toHaveLength(0);
    });

    it("is idempotent — clearing a missing mission does not throw", () => {
      expect(() => buffer.clear("non-existent-mission")).not.toThrow();
    });
  });

  // ── GC / TTL ──────────────────────────────────────────────────────────────

  describe("GC (gcIfNeeded)", () => {
    it("removes missions that have not been written for > 1h after GC trigger", async () => {
      const TTL_MS = 60 * 60 * 1000; // 1h
      const GC_INTERVAL = 60_000; // 1 min
      const START = 1_000_000;

      jest.setSystemTime(START);
      await buffer.broadcast(makeEvent("social.cost:tick", "m-stale", START));

      // Advance time past TTL so the mission is stale
      jest.setSystemTime(START + TTL_MS + 1);

      // Trigger GC by broadcasting to a different mission
      // (GC fires when now - lastGcAt > 60s, and we are well past that)
      await buffer.broadcast(
        makeEvent("social.cost:tick", "m-fresh", START + TTL_MS + 1),
      );

      // Advance enough to pass the 60-second GC interval guard
      jest.setSystemTime(START + TTL_MS + GC_INTERVAL + 2);
      await buffer.broadcast(
        makeEvent(
          "social.cost:tick",
          "m-trigger",
          START + TTL_MS + GC_INTERVAL + 2,
        ),
      );

      // m-stale should have been GC'd
      expect(buffer.read("m-stale")).toHaveLength(0);
    });

    it("does not GC missions written within TTL", async () => {
      const START = 2_000_000;
      jest.setSystemTime(START);
      await buffer.broadcast(makeEvent("social.cost:tick", "m-recent", START));

      // Only advance 30 minutes (within TTL of 1h)
      jest.setSystemTime(START + 30 * 60 * 1000);

      // Trigger GC check (advance past 60s GC interval)
      jest.setSystemTime(START + 30 * 60 * 1000 + 70_000);
      await buffer.broadcast(
        makeEvent(
          "social.cost:tick",
          "m-gccheck",
          START + 30 * 60 * 1000 + 70_000,
        ),
      );

      // m-recent should still be present
      expect(buffer.read("m-recent")).toHaveLength(1);
    });

    it("logs debug message when GC runs", async () => {
      const debugSpy = jest
        .spyOn(Logger.prototype, "debug")
        .mockImplementation(() => undefined);
      const START = 5_000_000;
      const GC_INTERVAL = 60_000;

      jest.setSystemTime(START);
      await buffer.broadcast(makeEvent("social.cost:tick", "m-gc-log", START));

      // Advance past GC interval to trigger GC
      jest.setSystemTime(START + GC_INTERVAL + 1);
      await buffer.broadcast(
        makeEvent("social.cost:tick", "m-gc-log2", START + GC_INTERVAL + 1),
      );

      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("gc"));
      debugSpy.mockRestore();
    });
  });

  // ── id constant ───────────────────────────────────────────────────────────

  describe("id", () => {
    it("has id = 'social.mission-buffer'", () => {
      expect(buffer.id).toBe("social.mission-buffer");
    });
  });
});
