import { SelfDrivenMissionDispatcher } from "../self-driven-mission-dispatcher.service";
import { MissionFailureCode } from "@/modules/ai-harness/facade";

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeDeps(events: any[], throwAt?: number) {
  const relay = { emitMissionEvent: jest.fn().mockResolvedValue(undefined) };
  const abortRegistry = {
    register: jest.fn(() => ({ signal: {} })),
    unregister: jest.fn(),
  };
  const lifecycle = { finalize: jest.fn().mockResolvedValue({ won: true }) };
  const store = { markHeartbeat: jest.fn().mockResolvedValue(undefined) };
  const runner = {
    run: async function* () {
      for (let i = 0; i <= events.length; i++) {
        if (throwAt === i) throw new Error("boom");
        if (i < events.length) yield events[i];
      }
    },
  };
  const dispatcher = new SelfDrivenMissionDispatcher(
    runner as any,
    relay as any,
    store as any,
    abortRegistry as any,
    lifecycle as any,
  );
  return { dispatcher, relay, abortRegistry, lifecycle, store };
}

describe("SelfDrivenMissionDispatcher", () => {
  it("relays every event in order then finalizes completed", async () => {
    const events = [
      { type: "mission_started", missionId: "m1" },
      { type: "plan", missionId: "m1", plan: {} },
      { type: "done", missionId: "m1" },
    ];
    const { dispatcher, relay, abortRegistry, lifecycle, store } =
      makeDeps(events);

    await dispatcher.runInBackground("m1", { prompt: "p", userId: "u1" }, "u1");

    expect(abortRegistry.register).toHaveBeenCalledWith("m1");
    expect(relay.emitMissionEvent).toHaveBeenCalledTimes(3);
    expect(
      relay.emitMissionEvent.mock.calls.map((c: any[]) => c[0].type),
    ).toEqual(["mission_started", "plan", "done"]);
    expect(lifecycle.finalize).toHaveBeenCalledTimes(1);
    const arg = lifecycle.finalize.mock.calls[0][0];
    expect(arg.missionId).toBe("m1");
    expect(arg.intent.status).toBe("completed");
    expect(arg.arbiter).toBe(store);
    expect(abortRegistry.unregister).toHaveBeenCalledWith("m1");
  });

  it("finalizes failed when the runner yields an error event", async () => {
    const events = [
      { type: "mission_started", missionId: "m1" },
      { type: "error", missionId: "m1", message: "plan rejected by human" },
    ];
    const { dispatcher, lifecycle } = makeDeps(events);

    await dispatcher.runInBackground("m1", { prompt: "p", userId: "u1" }, "u1");

    const arg = lifecycle.finalize.mock.calls[0][0];
    expect(arg.intent.status).toBe("failed");
    expect(arg.intent.failureCode).toBe(MissionFailureCode.runtime_crashed);
    expect(arg.intent.errorMessage).toBe("plan rejected by human");
  });

  it("surfaces a terminal error event + finalizes failed when run() throws", async () => {
    const events = [{ type: "mission_started", missionId: "m1" }];
    const { dispatcher, relay, lifecycle, abortRegistry } = makeDeps(events, 1);

    await dispatcher.runInBackground("m1", { prompt: "p", userId: "u1" }, "u1");

    // mission_started relayed, then a synthetic error event after the throw
    const relayed = relay.emitMissionEvent.mock.calls.map((c: any[]) => c[0]);
    expect(relayed[relayed.length - 1]).toMatchObject({
      type: "error",
      missionId: "m1",
      message: "boom",
    });
    expect(lifecycle.finalize.mock.calls[0][0].intent.status).toBe("failed");
    expect(abortRegistry.unregister).toHaveBeenCalledWith("m1");
  });
});
