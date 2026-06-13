/**
 * P6 spec: BusinessTeamEventBufferFramework via FakeMarsEventBuffer.
 */
import {
  FakeMarsEventBuffer,
  makeFakeMarsEventBufferHooks,
} from "./__fixtures__/p6-fake-team-mocks";
import type { DomainEvent } from "@/common/events/domain-event.types";

function makeEvent(
  type: string,
  missionId: string | undefined,
  ts = Date.now(),
): DomainEvent {
  return {
    type,
    timestamp: ts,
    scope: missionId ? { missionId } : {},
    payload: { sample: type },
    agentId: "agentX",
    traceId: "trace1",
  } as DomainEvent;
}

describe("BusinessTeamEventBufferFramework (FakeMarsEventBuffer)", () => {
  it("accepts events by business prefix", () => {
    const hooks = makeFakeMarsEventBufferHooks();
    const buf = new FakeMarsEventBuffer(hooks, "fake-mars-buf");
    expect(buf.accepts(makeEvent("mars.stage:done", "m1"))).toBe(true);
    expect(buf.accepts(makeEvent("foo.bar:x", "m1"))).toBe(false);
  });

  it("broadcast skips events without missionId scope", async () => {
    const hooks = makeFakeMarsEventBufferHooks();
    const buf = new FakeMarsEventBuffer(hooks, "fake-mars-buf");
    await buf.broadcast(makeEvent("mars.stage:done", undefined));
    expect(hooks.persistEvent).not.toHaveBeenCalled();
  });

  it("broadcast appends in-memory + fire-and-forget persist", async () => {
    const hooks = makeFakeMarsEventBufferHooks();
    const buf = new FakeMarsEventBuffer(hooks, "fake-mars-buf");
    await buf.broadcast(makeEvent("mars.stage:done", "m1", 100));
    await buf.broadcast(makeEvent("mars.chapter:saved", "m1", 200));
    expect(hooks.persistEvent).toHaveBeenCalledTimes(2);
    const got = buf.read("m1");
    expect(got).toHaveLength(2);
    expect(got[0].timestamp).toBe(100);
  });

  it("read returns structured clone (mutation safe)", async () => {
    const hooks = makeFakeMarsEventBufferHooks();
    const buf = new FakeMarsEventBuffer(hooks, "fake-mars-buf");
    await buf.broadcast(makeEvent("mars.stage:done", "m1", 100));
    const a = buf.read("m1");
    (a[0] as { type: string }).type = "POLLUTED";
    const b = buf.read("m1");
    expect(b[0].type).toBe("mars.stage:done");
  });

  it("read filters by sinceTs", async () => {
    const hooks = makeFakeMarsEventBufferHooks();
    const buf = new FakeMarsEventBuffer(hooks, "fake-mars-buf");
    await buf.broadcast(makeEvent("mars.stage:done", "m1", 100));
    await buf.broadcast(makeEvent("mars.stage:done", "m1", 300));
    expect(buf.read("m1", 200)).toHaveLength(1);
  });

  it("enforces FIFO MAX_PER_MISSION cap", async () => {
    const hooks: ReturnType<typeof makeFakeMarsEventBufferHooks> = {
      ...makeFakeMarsEventBufferHooks(),
      maxPerMission: 3,
    };
    const buf = new FakeMarsEventBuffer(hooks, "fake-mars-buf");
    for (let i = 0; i < 5; i++) {
      await buf.broadcast(makeEvent("mars.stage:done", "m1", 100 + i));
    }
    const got = buf.read("m1");
    expect(got).toHaveLength(3);
    expect(got[0].timestamp).toBe(102);
  });

  it("readPersisted delegates to hooks", async () => {
    const hooks = makeFakeMarsEventBufferHooks();
    (hooks.fetchPersisted as jest.Mock).mockResolvedValue([
      {
        type: "mars.stage:done",
        payload: {},
        timestamp: 99,
      },
    ]);
    const buf = new FakeMarsEventBuffer(hooks, "fake-mars-buf");
    const got = await buf.readPersisted("m1", 0);
    expect(got).toHaveLength(1);
    expect(got[0].timestamp).toBe(99);
  });

  it("persistEvent error logged but not thrown", async () => {
    const hooks = makeFakeMarsEventBufferHooks();
    (hooks.persistEvent as jest.Mock).mockRejectedValue(new Error("db down"));
    const buf = new FakeMarsEventBuffer(hooks, "fake-mars-buf");
    await expect(
      buf.broadcast(makeEvent("mars.stage:done", "m1", 100)),
    ).resolves.toBeUndefined();
    // Need to flush microtasks so fire-and-forget catch handler runs
    await Promise.resolve();
    await Promise.resolve();
  });
});
