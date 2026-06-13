import { MissionEventBuffer } from "../mission-event-buffer.service";
import type { DomainEvent } from "@/modules/ai-harness/facade";

function makeEvent(
  missionId: string,
  type = "playground.stage:started",
  payload: Record<string, unknown> = {},
): DomainEvent {
  return {
    type,
    scope: { missionId, userId: "u1" },
    payload,
    timestamp: Date.now(),
    agentId: "agent1",
    traceId: "trace1",
  } as unknown as DomainEvent;
}

function makePrisma() {
  return {
    agentPlaygroundMissionEvent: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe("MissionEventBuffer", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let buffer: MissionEventBuffer;

  beforeEach(() => {
    prisma = makePrisma();
    buffer = new MissionEventBuffer(prisma as never);
  });

  // accepts
  it("accepts: returns true for playground.* events", () => {
    const ev = makeEvent("m1");
    expect(buffer.accepts(ev)).toBe(true);
  });

  it("accepts: returns false for non-playground events", () => {
    const ev = makeEvent("m1", "some.other.event");
    expect(buffer.accepts(ev)).toBe(false);
  });

  // broadcast
  it("broadcast: stores event in memory buffer", async () => {
    const ev = makeEvent("m1");
    await buffer.broadcast(ev);
    const events = buffer.read("m1");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("playground.stage:started");
  });

  it("broadcast: no-op if missionId is missing", async () => {
    const ev = {
      type: "playground.test",
      scope: {},
      payload: {},
      timestamp: Date.now(),
    } as unknown as DomainEvent;
    await buffer.broadcast(ev);
    // No error thrown, buffer stays empty for any mission
    expect(buffer.read("any")).toHaveLength(0);
  });

  it("broadcast: fires DB persist (fire-and-forget)", async () => {
    const ev = makeEvent("m1");
    await buffer.broadcast(ev);
    // Give a tick for the void promise
    await Promise.resolve();
    expect(prisma.agentPlaygroundMissionEvent.create).toHaveBeenCalled();
  });

  it("broadcast: DB failure does not throw", async () => {
    prisma.agentPlaygroundMissionEvent.create.mockRejectedValue(
      new Error("DB down"),
    );
    const ev = makeEvent("m1");
    await expect(buffer.broadcast(ev)).resolves.toBeUndefined();
  });

  it("broadcast: caps buffer at MAX_PER_MISSION (5000)", async () => {
    // Broadcast 5002 events
    for (let i = 0; i < 5002; i++) {
      await buffer.broadcast(makeEvent("m1", "playground.test", { i }));
    }
    const events = buffer.read("m1");
    expect(events.length).toBeLessThanOrEqual(5000);
  });

  // read
  it("read: returns empty array for unknown missionId", () => {
    expect(buffer.read("unknown")).toEqual([]);
  });

  it("read: returns all events when sinceTs not provided", async () => {
    await buffer.broadcast(makeEvent("m1", "playground.a"));
    await buffer.broadcast(makeEvent("m1", "playground.b"));
    const events = buffer.read("m1");
    expect(events).toHaveLength(2);
  });

  it("read: filters by sinceTs", async () => {
    const ev1 = { ...makeEvent("m1", "playground.a"), timestamp: 1000 };
    const ev2 = { ...makeEvent("m1", "playground.b"), timestamp: 3000 };
    await buffer.broadcast(ev1 as DomainEvent);
    await buffer.broadcast(ev2 as DomainEvent);
    const events = buffer.read("m1", 2000);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("playground.b");
  });

  it("read: returns copy, not mutating internal buffer", async () => {
    await buffer.broadcast(makeEvent("m1"));
    const events = buffer.read("m1");
    events.length = 0; // mutate the copy
    expect(buffer.read("m1")).toHaveLength(1);
  });

  // readPersisted
  it("readPersisted: queries DB with missionId filter", async () => {
    await buffer.readPersisted("m1");
    expect(prisma.agentPlaygroundMissionEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ missionId: "m1" }),
      }),
    );
  });

  it("readPersisted: maps DB rows to BufferedEvent shape", async () => {
    prisma.agentPlaygroundMissionEvent.findMany.mockResolvedValue([
      {
        type: "playground.test",
        payload: { x: 1 },
        agentId: "a1",
        traceId: "t1",
        ts: BigInt(1234567890),
      },
    ]);
    const events = await buffer.readPersisted("m1");
    expect(events[0].type).toBe("playground.test");
    expect(events[0].timestamp).toBe(1234567890);
    expect(events[0].agentId).toBe("a1");
  });

  it("readPersisted: returns [] on DB error", async () => {
    prisma.agentPlaygroundMissionEvent.findMany.mockRejectedValue(
      new Error("DB down"),
    );
    const events = await buffer.readPersisted("m1");
    expect(events).toEqual([]);
  });

  it("readPersisted: applies sinceTs filter in DB query", async () => {
    await buffer.readPersisted("m1", 5000);
    const queryArg =
      prisma.agentPlaygroundMissionEvent.findMany.mock.calls[0][0];
    expect(queryArg.where.ts).toBeDefined();
  });

  it("different missions have independent buffers", async () => {
    await buffer.broadcast(makeEvent("m1", "playground.a"));
    await buffer.broadcast(makeEvent("m2", "playground.b"));
    expect(buffer.read("m1")).toHaveLength(1);
    expect(buffer.read("m2")).toHaveLength(1);
    expect(buffer.read("m1")[0].type).toBe("playground.a");
  });
});
