import { MissionCheckpointService } from "../mission-checkpoint.service";
import { InMemoryMissionCheckpointStore } from "../in-memory-checkpoint.store";

interface PayloadShape {
  stage: string;
  artifacts: string[];
}

describe("MissionCheckpointService", () => {
  let store: InMemoryMissionCheckpointStore<PayloadShape>;
  let svc: MissionCheckpointService<PayloadShape>;

  beforeEach(() => {
    store = new InMemoryMissionCheckpointStore();
    svc = new MissionCheckpointService(store);
  });

  it("save then load round-trips snapshot", async () => {
    await svc.save("m1", { stage: "s5", artifacts: ["a", "b"] }, ["s1", "s2"]);
    const snap = await svc.load("m1");
    expect(snap).not.toBeNull();
    expect(snap!.payload.stage).toBe("s5");
    expect(snap!.completedKeys).toEqual(["s1", "s2"]);
    expect(snap!.status).toBe("running");
  });

  it("canResume returns no-checkpoint when missing", async () => {
    const r = await svc.canResume("missing");
    expect(r.canResume).toBe(false);
    expect(r.reason).toBe("no-checkpoint");
  });

  it("canResume rejects completed status", async () => {
    await svc.save("m1", { stage: "x", artifacts: [] }, [], "completed");
    const r = await svc.canResume("m1");
    expect(r.canResume).toBe(false);
    expect(r.reason).toBe("wrong-status");
  });

  it("canResume rejects expired snapshot", async () => {
    const stale = new MissionCheckpointService(store, 1000); // 1s window
    await store.save({
      missionId: "m1",
      savedAt: new Date(Date.now() - 5000),
      payload: { stage: "s3", artifacts: [] },
      completedKeys: [],
      status: "running",
    });
    const r = await stale.canResume("m1");
    expect(r.canResume).toBe(false);
    expect(r.reason).toBe("expired");
  });

  it("canResume returns ok for fresh running snapshot", async () => {
    await svc.save("m1", { stage: "s2", artifacts: [] }, ["s1"]);
    const r = await svc.canResume("m1");
    expect(r.canResume).toBe(true);
    expect(r.completedKeys.has("s1")).toBe(true);
    expect(svc.isCompleted(r, "s1")).toBe(true);
    expect(svc.isCompleted(r, "s99")).toBe(false);
  });

  it("clear removes snapshot", async () => {
    await svc.save("m1", { stage: "s1", artifacts: [] }, []);
    await svc.clear("m1");
    expect(await svc.load("m1")).toBeNull();
  });

  it("listResumable filters by userId + status + age", async () => {
    store.setUserBinding("m-u1-running", "u1");
    store.setUserBinding("m-u1-completed", "u1");
    store.setUserBinding("m-u2", "u2");
    await svc.save("m-u1-running", { stage: "x", artifacts: [] }, []);
    await svc.save(
      "m-u1-completed",
      { stage: "x", artifacts: [] },
      [],
      "completed",
    );
    await svc.save("m-u2", { stage: "x", artifacts: [] }, []);

    const u1 = await svc.listResumable("u1");
    expect(u1.map((s) => s.missionId)).toEqual(["m-u1-running"]);
  });

  // P4: failed status should be resumable (not blocked as wrong-status)
  it("canResume allows failed status (not rejected like completed)", async () => {
    await svc.save("m-fail", { stage: "s5", artifacts: [] }, ["s1"], "failed");
    const r = await svc.canResume("m-fail");
    expect(r.canResume).toBe(true);
  });

  // P4: paused status should be resumable
  it("canResume allows paused status", async () => {
    await svc.save(
      "m-paused",
      { stage: "s3", artifacts: [] },
      ["s1", "s2"],
      "paused",
    );
    const r = await svc.canResume("m-paused");
    expect(r.canResume).toBe(true);
  });

  // P4: cloneCheckpoint works for failed source mission (analogous to quality-failed)
  it("cloneCheckpoint copies checkpoint from failed mission", async () => {
    await svc.save(
      "src-fail",
      { stage: "s9", artifacts: ["r1"] },
      ["s1", "s2"],
      "failed",
    );
    const ok = await svc.cloneCheckpoint("src-fail", "dest-new");
    expect(ok).toBe(true);
    const snap = await svc.load("dest-new");
    expect(snap).not.toBeNull();
    expect(snap!.status).toBe("running");
    expect(snap!.completedKeys).toEqual(["s1", "s2"]);
  });

  // P4: cloneCheckpoint skips completed source
  it("cloneCheckpoint skips completed source mission", async () => {
    await svc.save(
      "src-done",
      { stage: "s11", artifacts: [] },
      [],
      "completed",
    );
    const ok = await svc.cloneCheckpoint("src-done", "dest-new");
    expect(ok).toBe(false);
    expect(await svc.load("dest-new")).toBeNull();
  });

  it("save errors are swallowed (does not throw)", async () => {
    const crashStore: typeof store = {
      ...store,
      save: jest.fn().mockRejectedValue(new Error("DB down")),
      load: jest.fn().mockResolvedValue(null),
      clear: jest.fn().mockResolvedValue(undefined),
      listResumable: jest.fn().mockResolvedValue([]),
    } as unknown as typeof store;
    const crashSvc = new MissionCheckpointService(crashStore);
    await expect(
      crashSvc.save("m1", { stage: "x", artifacts: [] }, []),
    ).resolves.toBeUndefined();
  });
});
