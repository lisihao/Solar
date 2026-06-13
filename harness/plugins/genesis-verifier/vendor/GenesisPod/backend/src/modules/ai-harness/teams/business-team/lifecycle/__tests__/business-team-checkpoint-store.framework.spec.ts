/**
 * P6 spec: BusinessTeamCheckpointStoreFramework via FakeMarsCheckpointStore.
 */
import {
  FakeMarsCheckpointStore,
  makeFakeMarsCheckpointHooks,
} from "./__fixtures__/p6-fake-team-mocks";
import { DEFAULT_CHECKPOINT_KEY } from "../abstractions/checkpoint-store.contract";

describe("BusinessTeamCheckpointStoreFramework (FakeMarsCheckpointStore)", () => {
  it("save persists snapshot under reserved key and resets failure counter", async () => {
    const hooks = makeFakeMarsCheckpointHooks();
    const store = new FakeMarsCheckpointStore(hooks, "fake-mars-checkpoint");

    await store.save({
      missionId: "m1",
      savedAt: new Date("2026-05-24T00:00:00.000Z"),
      payload: { mission: "mars", stage: 3 },
      completedKeys: ["s1", "s2"],
      status: "running",
    });

    expect(hooks.upsertJsonKey).toHaveBeenCalledTimes(1);
    const args = (hooks.upsertJsonKey as jest.Mock).mock.calls[0];
    expect(args[1]).toBe(DEFAULT_CHECKPOINT_KEY);
    expect(args[2].savedAt).toBe("2026-05-24T00:00:00.000Z");
    expect(store.getSaveFailures("m1")).toBe(0);
  });

  it("save accumulates failures and DEGRADED at threshold", async () => {
    const hooks = makeFakeMarsCheckpointHooks();
    (hooks.upsertJsonKey as jest.Mock).mockRejectedValue(new Error("db down"));
    const store = new FakeMarsCheckpointStore(hooks, "fake-mars-checkpoint");

    const snap = {
      missionId: "m1",
      savedAt: new Date(),
      payload: { mission: "mars", stage: 1 },
      completedKeys: [],
      status: "running" as const,
    };
    await store.save(snap);
    await store.save(snap);
    await store.save(snap);
    expect(store.getSaveFailures("m1")).toBe(3);
    expect(store.isDegraded("m1")).toBe(true);
  });

  it("load returns null when reserved key missing", async () => {
    const hooks = makeFakeMarsCheckpointHooks({ m1: {} });
    const store = new FakeMarsCheckpointStore(hooks, "fake-mars-checkpoint");
    expect(await store.load("m1")).toBeNull();
  });

  it("load rejects checkpoint with non-ISO savedAt (poisoned data)", async () => {
    const hooks = makeFakeMarsCheckpointHooks({
      m1: {
        __checkpoint: {
          savedAt: "not-a-date",
          payload: { mission: "mars", stage: 1 },
          completedKeys: [],
          status: "running",
        },
      },
    });
    const store = new FakeMarsCheckpointStore(hooks, "fake-mars-checkpoint");
    expect(await store.load("m1")).toBeNull();
  });

  it("clear no-ops when reserved key missing", async () => {
    const hooks = makeFakeMarsCheckpointHooks({ m1: {} });
    const store = new FakeMarsCheckpointStore(hooks, "fake-mars-checkpoint");
    await store.clear("m1");
    expect(hooks.removeJsonKey).not.toHaveBeenCalled();
  });

  it("listResumable filters by cutoff savedAt", async () => {
    const old = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const fresh = new Date("2026-05-24T00:00:00.000Z").toISOString();
    const hooks = makeFakeMarsCheckpointHooks({
      m_old: {
        __checkpoint: {
          savedAt: old,
          payload: { mission: "old", stage: 0 },
          completedKeys: [],
          status: "running",
        },
      },
      m_fresh: {
        __checkpoint: {
          savedAt: fresh,
          payload: { mission: "fresh", stage: 7 },
          completedKeys: ["s1"],
          status: "running",
        },
      },
    });
    const store = new FakeMarsCheckpointStore(hooks, "fake-mars-checkpoint");
    const got = await store.listResumable(
      "u1",
      new Date("2026-04-01T00:00:00.000Z"),
    );
    expect(got).toHaveLength(1);
    expect(got[0].missionId).toBe("m_fresh");
  });

  it("custom reservedKey/degradedThreshold honored", async () => {
    const hooks: ReturnType<typeof makeFakeMarsCheckpointHooks> = {
      ...makeFakeMarsCheckpointHooks(),
      reservedKey: "__mars_ckpt",
      degradedThreshold: 1,
    };
    (hooks.upsertJsonKey as jest.Mock).mockRejectedValue(new Error("oops"));
    const store = new FakeMarsCheckpointStore(hooks, "fake-mars-checkpoint");
    await store.save({
      missionId: "m1",
      savedAt: new Date(),
      payload: { mission: "mars", stage: 0 },
      completedKeys: [],
      status: "running",
    });
    expect(store.isDegraded("m1")).toBe(true);
  });
});
