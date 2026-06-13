/**
 * P6 spec: BusinessTeamMissionStoreFramework via FakeMarsMissionStore.
 */
import {
  FakeMarsMissionStore,
  makeFakeMarsMissionStoreHooks,
} from "./__fixtures__/p6-fake-team-mocks";

describe("BusinessTeamMissionStoreFramework (FakeMars)", () => {
  it("create delegates to createMission hook", async () => {
    const hooks = makeFakeMarsMissionStoreHooks();
    const store = new FakeMarsMissionStore(hooks);
    await store.create({
      id: "m1",
      userId: "u1",
      mission: "mars",
    });
    expect(hooks.createMission).toHaveBeenCalledTimes(1);
  });

  it("refreshHeartbeat: row missing → emergencyAbort (once per mission)", async () => {
    const hooks = makeFakeMarsMissionStoreHooks();
    (hooks.writeHeartbeat as jest.Mock).mockRejectedValue({ code: "P2025" });
    const store = new FakeMarsMissionStore(hooks);
    await store.refreshHeartbeat("m1", "pod-1");
    await store.refreshHeartbeat("m1", "pod-1");
    expect(hooks.emergencyAbort).toHaveBeenCalledTimes(1);
    expect(hooks.emergencyAbort).toHaveBeenCalledWith(
      "m1",
      "heartbeat row missing",
    );
  });

  it("refreshHeartbeat: non-missing error → log, no abort", async () => {
    const hooks = makeFakeMarsMissionStoreHooks();
    (hooks.writeHeartbeat as jest.Mock).mockRejectedValue(new Error("timeout"));
    const store = new FakeMarsMissionStore(hooks);
    await store.refreshHeartbeat("m1", "pod-1");
    expect(hooks.emergencyAbort).not.toHaveBeenCalled();
  });

  it("clearHeartbeat: swallows error", async () => {
    const hooks = makeFakeMarsMissionStoreHooks();
    (hooks.resetHeartbeat as jest.Mock).mockRejectedValue(new Error("x"));
    const store = new FakeMarsMissionStore(hooks);
    await expect(store.clearHeartbeat("m1", "u1")).resolves.toBeUndefined();
  });

  it("markStageComplete: row missing → emergencyAbort", async () => {
    const hooks = makeFakeMarsMissionStoreHooks();
    (hooks.writeStageProgress as jest.Mock).mockRejectedValue({
      code: "P2003",
    });
    const store = new FakeMarsMissionStore(hooks);
    await store.markStageComplete("m1", 5);
    expect(hooks.emergencyAbort).toHaveBeenCalledWith(
      "m1",
      "markStageComplete s5",
    );
  });

  it("countRunningByUser delegates", async () => {
    const hooks = makeFakeMarsMissionStoreHooks();
    (hooks.countRunning as jest.Mock).mockResolvedValue(7);
    const store = new FakeMarsMissionStore(hooks);
    expect(await store.countRunningByUser("u1")).toBe(7);
  });

  // ── P-DUR2 (2026-05-30): atomic claim version ───────────────────────────────
  describe("cleanupOrphanRunningMissionsAtomic", () => {
    it("winners are only the orphans this pod atomically claimed (count===1)", async () => {
      // Simulate two pods racing on the same two orphans: this pod wins m1, loses m2.
      const claim = jest.fn(async (id: string) => id === "m1");
      const hooks = makeFakeMarsMissionStoreHooks({ claimOrphanFailed: claim });
      (hooks.findOrphanRunning as jest.Mock).mockResolvedValue([
        { id: "m1", userId: "u1" },
        { id: "m2", userId: "u2" },
      ]);
      const store = new FakeMarsMissionStore(hooks);
      const got = await store.cleanupOrphanRunningMissionsAtomic(60_000);

      expect(got.orphans).toHaveLength(2);
      expect(got.claimedWinners).toEqual([{ id: "m1", userId: "u1" }]);
      expect(claim).toHaveBeenCalledTimes(2);
    });

    it("concurrent two-pod sim on same orphan: exactly one pod claims it (winner), other gets count===0", async () => {
      // Shared DB state: first claim wins, all subsequent claims for same id lose.
      const claimedIds = new Set<string>();
      const makeClaim = () =>
        jest.fn(async (id: string) => {
          if (claimedIds.has(id)) return false; // another pod already claimed
          claimedIds.add(id);
          return true;
        });
      const orphan = [{ id: "shared", userId: "u1" }];

      const claimA = makeClaim();
      const claimB = makeClaim();
      const hooksA = makeFakeMarsMissionStoreHooks({
        claimOrphanFailed: claimA,
      });
      const hooksB = makeFakeMarsMissionStoreHooks({
        claimOrphanFailed: claimB,
      });
      (hooksA.findOrphanRunning as jest.Mock).mockResolvedValue(orphan);
      (hooksB.findOrphanRunning as jest.Mock).mockResolvedValue(orphan);
      const podA = new FakeMarsMissionStore(hooksA);
      const podB = new FakeMarsMissionStore(hooksB);

      const [resA, resB] = await Promise.all([
        podA.cleanupOrphanRunningMissionsAtomic(60_000),
        podB.cleanupOrphanRunningMissionsAtomic(60_000),
      ]);

      // Exactly one pod claimed the shared orphan → only one triggers rerun.
      const totalWinners =
        resA.claimedWinners.length + resB.claimedWinners.length;
      expect(totalWinners).toBe(1);
    });

    it("claimOrphanFailed throws for one orphan → treated as lost (not a winner), others unaffected", async () => {
      const claim = jest.fn(async (id: string) => {
        if (id === "boom") throw new Error("db");
        return true;
      });
      const hooks = makeFakeMarsMissionStoreHooks({ claimOrphanFailed: claim });
      (hooks.findOrphanRunning as jest.Mock).mockResolvedValue([
        { id: "boom", userId: "u1" },
        { id: "ok", userId: "u2" },
      ]);
      const store = new FakeMarsMissionStore(hooks);
      const got = await store.cleanupOrphanRunningMissionsAtomic(60_000);
      expect(got.claimedWinners).toEqual([{ id: "ok", userId: "u2" }]);
    });

    it("empty findOrphanRunning → empty orphans + winners, no claim calls", async () => {
      const claim = jest.fn(async () => true);
      const hooks = makeFakeMarsMissionStoreHooks({ claimOrphanFailed: claim });
      (hooks.findOrphanRunning as jest.Mock).mockResolvedValue([]);
      const store = new FakeMarsMissionStore(hooks);
      const got = await store.cleanupOrphanRunningMissionsAtomic(60_000);
      expect(got).toEqual({ orphans: [], claimedWinners: [] });
      expect(claim).not.toHaveBeenCalled();
    });

    it("findOrphanRunning DB error → empty result", async () => {
      const hooks = makeFakeMarsMissionStoreHooks();
      (hooks.findOrphanRunning as jest.Mock).mockRejectedValue(new Error("db"));
      const store = new FakeMarsMissionStore(hooks);
      expect(await store.cleanupOrphanRunningMissionsAtomic(60_000)).toEqual({
        orphans: [],
        claimedWinners: [],
      });
    });
  });
});
