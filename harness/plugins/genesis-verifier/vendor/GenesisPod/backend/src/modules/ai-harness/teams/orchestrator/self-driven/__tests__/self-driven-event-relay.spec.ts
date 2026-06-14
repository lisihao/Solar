import { SelfDrivenEventRelay } from "../self-driven-event-relay";
import type { EventBus } from "@/common/events/event-bus";

describe("SelfDrivenEventRelay", () => {
  function makeBus() {
    return { emit: jest.fn().mockResolvedValue(true) };
  }

  it("namespaces the event type and carries the full event as payload", async () => {
    const bus = makeBus();
    const relay = new SelfDrivenEventRelay(bus as unknown as EventBus);

    const planEvent = { type: "plan", missionId: "m1", plan: { steps: 6 } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await relay.emitMissionEvent(planEvent as any, "u1");

    expect(bus.emit).toHaveBeenCalledTimes(1);
    const emitted = bus.emit.mock.calls[0][0];
    expect(emitted.type).toBe("self-driven.plan");
    expect(emitted.scope).toEqual({ missionId: "m1", userId: "u1" });
    expect(emitted.payload).toBe(planEvent);
    expect(typeof emitted.timestamp).toBe("number");
  });

  it("relays chunk events too (buffer, not relay, enforces ephemerality)", async () => {
    const bus = makeBus();
    const relay = new SelfDrivenEventRelay(bus as unknown as EventBus);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await relay.emitMissionEvent(
      { type: "chunk", missionId: "m1", content: "hi" } as any,
      "u1",
    );
    expect(bus.emit.mock.calls[0][0].type).toBe("self-driven.chunk");
  });
});
