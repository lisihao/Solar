import type { DomainEvent } from "@/common/events/domain-event.types";
import { SelfDrivenMissionEventBuffer } from "../self-driven-mission-event-buffer.service";

/** Minimal prisma double exposing only askSelfDrivenMissionEvent. */
function makePrisma() {
  return {
    askSelfDrivenMissionEvent: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

function ev(
  type: string,
  missionId: string,
  payload: unknown,
  timestamp: number,
): DomainEvent {
  return {
    type,
    scope: { missionId, userId: "u1" },
    payload,
    timestamp,
  } as DomainEvent;
}

describe("SelfDrivenMissionEventBuffer", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let buffer: SelfDrivenMissionEventBuffer;

  beforeEach(() => {
    prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buffer = new SelfDrivenMissionEventBuffer(prisma as any);
  });

  describe("acceptsEvent (chunk policy)", () => {
    it("accepts structural self-driven.* events", () => {
      expect(buffer.accepts(ev("self-driven.plan", "m1", {}, 1))).toBe(true);
      expect(buffer.accepts(ev("self-driven.deliverable", "m1", {}, 1))).toBe(
        true,
      );
    });

    it("rejects the ephemeral self-driven.chunk event (socket-only)", () => {
      expect(buffer.accepts(ev("self-driven.chunk", "m1", {}, 1))).toBe(false);
    });

    it("rejects foreign namespaces", () => {
      expect(buffer.accepts(ev("playground.plan", "m1", {}, 1))).toBe(false);
    });
  });

  it("buffers + persists a structural event, readable from memory", async () => {
    const plan = ev("self-driven.plan", "m1", { type: "plan", steps: 6 }, 100);
    await buffer.broadcast(plan);
    await flush();

    const mem = buffer.read("m1");
    expect(mem).toHaveLength(1);
    expect(mem[0].type).toBe("self-driven.plan");

    expect(prisma.askSelfDrivenMissionEvent.create).toHaveBeenCalledTimes(1);
    const arg = prisma.askSelfDrivenMissionEvent.create.mock.calls[0][0];
    expect(arg.data.missionId).toBe("m1");
    expect(arg.data.type).toBe("self-driven.plan");
    expect(arg.data.ts).toBe(BigInt(100));
  });

  it("honours the sinceTs cursor on in-memory read", async () => {
    await buffer.broadcast(ev("self-driven.step_started", "m1", {}, 100));
    await buffer.broadcast(ev("self-driven.step_completed", "m1", {}, 200));
    await flush();
    expect(buffer.read("m1", 150)).toHaveLength(1);
    expect(buffer.read("m1", 150)[0].timestamp).toBe(200);
  });

  it("readPersisted maps DB rows back to BufferedEvents (replay fallback)", async () => {
    prisma.askSelfDrivenMissionEvent.findMany.mockResolvedValueOnce([
      {
        type: "self-driven.plan",
        payload: { type: "plan" },
        agentId: null,
        traceId: null,
        ts: BigInt(100),
      },
    ]);
    const rows = await buffer.readPersisted("m1");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("self-driven.plan");
    expect(rows[0].timestamp).toBe(100);
  });
});
