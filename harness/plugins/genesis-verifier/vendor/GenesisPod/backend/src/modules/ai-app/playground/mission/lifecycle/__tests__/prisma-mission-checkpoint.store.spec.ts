import { PrismaMissionCheckpointStore } from "../prisma-mission-checkpoint.store";

describe("PrismaMissionCheckpointStore", () => {
  function makeStore() {
    const prismaMock = {
      agentPlaygroundMission: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
      },
      // ★ P1-R5-A: save 现在用 $executeRaw + jsonb_set 原子 update
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const store = new PrismaMissionCheckpointStore(prismaMock as never);
    return { store, prisma: prismaMock };
  }

  it("save uses jsonb_set $executeRaw with checkpoint payload", async () => {
    const { store, prisma } = makeStore();
    await store.save({
      missionId: "m1",
      savedAt: new Date("2026-04-29T10:00:00Z"),
      payload: { stage: "s5" },
      completedKeys: ["s1", "s2"],
      status: "running",
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    // 第二段是 stringified persisted blob
    const call = prisma.$executeRaw.mock.calls[0];
    const valuesArr = call.slice(1) as unknown[];
    const persistedJson = valuesArr.find(
      (v): v is string =>
        typeof v === "string" &&
        v.includes("__checkpoint") === false &&
        v.startsWith("{"),
    );
    expect(persistedJson).toBeDefined();
    const persisted = JSON.parse(persistedJson!) as {
      savedAt: string;
      payload: { stage: string };
      completedKeys: string[];
      status: string;
    };
    expect(persisted.savedAt).toBe("2026-04-29T10:00:00.000Z");
    expect(persisted.payload).toEqual({ stage: "s5" });
    expect(persisted.completedKeys).toEqual(["s1", "s2"]);
    expect(persisted.status).toBe("running");
    expect(store.getSaveFailures("m1")).toBe(0);
  });

  it("save records consecutive failure count when DB throws", async () => {
    const { store, prisma } = makeStore();
    prisma.$executeRaw
      .mockRejectedValueOnce(new Error("DB down"))
      .mockRejectedValueOnce(new Error("DB down"))
      .mockRejectedValueOnce(new Error("DB down"));
    for (let i = 0; i < 3; i++) {
      await store.save({
        missionId: "m1",
        savedAt: new Date(),
        payload: {},
        completedKeys: [],
        status: "running",
      });
    }
    expect(store.getSaveFailures("m1")).toBe(3);
    expect(store.isDegraded("m1")).toBe(true);
  });

  it("load returns null when mission missing or no checkpoint", async () => {
    const { store, prisma } = makeStore();
    prisma.agentPlaygroundMission.findUnique.mockResolvedValue(null);
    expect(await store.load("m1")).toBeNull();

    prisma.agentPlaygroundMission.findUnique.mockResolvedValue({
      leaderJournal: { decisions: [] },
    });
    expect(await store.load("m1")).toBeNull();
  });

  it("load deserializes savedAt back to Date", async () => {
    const { store, prisma } = makeStore();
    prisma.agentPlaygroundMission.findUnique.mockResolvedValue({
      leaderJournal: {
        __checkpoint: {
          savedAt: "2026-04-29T10:00:00Z",
          payload: { stage: "s5" },
          completedKeys: ["s1"],
          status: "running",
        },
      },
    });
    const snap = await store.load("m1");
    expect(snap).not.toBeNull();
    expect(snap!.savedAt).toBeInstanceOf(Date);
    expect(snap!.savedAt.toISOString()).toBe("2026-04-29T10:00:00.000Z");
    expect(snap!.completedKeys).toEqual(["s1"]);
  });

  it("clear removes only __checkpoint key, keeps other journal data", async () => {
    const { store, prisma } = makeStore();
    prisma.agentPlaygroundMission.findUnique.mockResolvedValue({
      leaderJournal: {
        decisions: [{ phase: "plan" }],
        __checkpoint: {
          savedAt: "x",
          payload: {},
          completedKeys: [],
          status: "running",
        },
      },
    });
    await store.clear("m1");
    const call = prisma.agentPlaygroundMission.update.mock.calls[0][0];
    const journal = call.data.leaderJournal as Record<string, unknown>;
    expect(journal.decisions).toEqual([{ phase: "plan" }]);
    expect(journal.__checkpoint).toBeUndefined();
  });

  it("clear is no-op when no checkpoint present", async () => {
    const { store, prisma } = makeStore();
    prisma.agentPlaygroundMission.findUnique.mockResolvedValue({
      leaderJournal: { decisions: [] },
    });
    await store.clear("m1");
    expect(prisma.agentPlaygroundMission.update).not.toHaveBeenCalled();
  });

  it("listResumable filters userId + status=running, applies savedAt cutoff in memory", async () => {
    const { store, prisma } = makeStore();
    prisma.agentPlaygroundMission.findMany.mockResolvedValue([
      {
        id: "m1",
        startedAt: new Date("2026-04-29T09:00:00Z"),
        leaderJournal: {
          __checkpoint: {
            savedAt: "2026-04-29T10:00:00Z",
            payload: { x: 1 },
            completedKeys: ["s1"],
            status: "running",
          },
        },
      },
      // 没 checkpoint 的 mission 应被过滤
      { id: "m2", startedAt: new Date(), leaderJournal: {} },
    ]);
    const out = await store.listResumable("user-1");
    expect(out).toHaveLength(1);
    expect(out[0].missionId).toBe("m1");

    const findCall = prisma.agentPlaygroundMission.findMany.mock.calls[0][0];
    expect(findCall.where).toMatchObject({
      userId: "user-1",
      status: "running",
    });
    // ★ P0-R5-3: where 不再含 startedAt 过滤；改在应用层按 savedAt 比对
    expect(findCall.where.startedAt).toBeUndefined();
  });

  it("listResumable filters out checkpoints with savedAt older than cutoff", async () => {
    const { store, prisma } = makeStore();
    prisma.agentPlaygroundMission.findMany.mockResolvedValue([
      {
        id: "old",
        startedAt: new Date("2026-04-01T00:00:00Z"),
        leaderJournal: {
          __checkpoint: {
            savedAt: "2026-04-01T00:00:00Z",
            payload: {},
            completedKeys: [],
            status: "running",
          },
        },
      },
      {
        id: "fresh",
        startedAt: new Date("2026-04-01T00:00:00Z"),
        leaderJournal: {
          __checkpoint: {
            savedAt: "2026-04-29T12:00:00Z",
            payload: {},
            completedKeys: [],
            status: "running",
          },
        },
      },
    ]);
    const out = await store.listResumable(
      "user-1",
      new Date("2026-04-29T00:00:00Z"),
    );
    expect(out.map((s) => s.missionId)).toEqual(["fresh"]);
  });

  it("load returns null when savedAt is invalid (P1-R5-B)", async () => {
    const { store, prisma } = makeStore();
    prisma.agentPlaygroundMission.findUnique.mockResolvedValue({
      leaderJournal: {
        __checkpoint: {
          savedAt: "not-a-date",
          payload: {},
          completedKeys: [],
          status: "running",
        },
      },
    });
    expect(await store.load("m1")).toBeNull();
  });

  it("listResumable returns [] on prisma error (graceful)", async () => {
    const { store, prisma } = makeStore();
    prisma.agentPlaygroundMission.findMany.mockRejectedValue(
      new Error("DB down"),
    );
    const out = await store.listResumable("user-1");
    expect(out).toEqual([]);
  });
});
