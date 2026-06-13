import { MissionElectionTracker } from "../mission-election-tracker.service";

describe("MissionElectionTracker", () => {
  let tracker: MissionElectionTracker;

  beforeEach(() => {
    tracker = new MissionElectionTracker();
  });

  it("records elections and returns them in order", async () => {
    await tracker.recordElection("mission-1", "grok-4-1-fast-reasoning");
    await tracker.recordElection("mission-1", "deepseek-v4-pro");

    await expect(tracker.getElected("mission-1")).resolves.toEqual([
      "grok-4-1-fast-reasoning",
      "deepseek-v4-pro",
    ]);
  });

  it("serializes concurrent elections within the same mission", async () => {
    const seenHistories: string[][] = [];

    await Promise.all([
      tracker.runSerializedElection("mission-1", async (previouslyElected) => {
        seenHistories.push([...previouslyElected]);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { result: "first", electedModelId: "model-a" };
      }),
      tracker.runSerializedElection("mission-1", async (previouslyElected) => {
        seenHistories.push([...previouslyElected]);
        return { result: "second", electedModelId: "model-b" };
      }),
      tracker.runSerializedElection("mission-1", async (previouslyElected) => {
        seenHistories.push([...previouslyElected]);
        return { result: "third", electedModelId: "model-c" };
      }),
    ]);

    expect(seenHistories).toEqual([[], ["model-a"], ["model-a", "model-b"]]);
    await expect(tracker.getElected("mission-1")).resolves.toEqual([
      "model-a",
      "model-b",
      "model-c",
    ]);
  });

  it("does not serialize across different missions", async () => {
    const results = await Promise.all([
      tracker.runSerializedElection("mission-1", async (previouslyElected) => ({
        result: previouslyElected.length,
        electedModelId: "model-a",
      })),
      tracker.runSerializedElection("mission-2", async (previouslyElected) => ({
        result: previouslyElected.length,
        electedModelId: "model-b",
      })),
    ]);

    expect(results).toEqual([0, 0]);
  });

  it("reserves before commit and releases failed reservations", async () => {
    const reserved = await tracker.reserveSerializedElection(
      "mission-1",
      async (previouslyElected) => {
        expect(previouslyElected).toEqual([]);
        return {
          result: "reserved",
          electedModelId: "deepseek-v4-pro",
        };
      },
    );

    expect(reserved.reservation?.modelId).toBe("deepseek-v4-pro");
    await expect(tracker.getElected("mission-1")).resolves.toEqual([
      "deepseek-v4-pro",
    ]);

    await tracker.releaseReservation("mission-1", reserved.reservation?.token);
    await expect(tracker.getElected("mission-1")).resolves.toEqual([]);
  });

  it("commits successful reservations into durable election history", async () => {
    const reserved = await tracker.reserveSerializedElection(
      "mission-1",
      async () => ({
        result: "reserved",
        electedModelId: "grok-4-1-fast-reasoning",
      }),
    );

    await tracker.commitReservation("mission-1", reserved.reservation?.token);

    await expect(tracker.getElected("mission-1")).resolves.toEqual([
      "grok-4-1-fast-reasoning",
    ]);
  });

  it("shares reservation history across tracker instances via cache", async () => {
    const shared = new Map<string, unknown>();
    const cache = {
      get: jest.fn(async (key: string) => shared.get(key)),
      set: jest.fn(async (key: string, value: unknown) => {
        shared.set(key, value);
      }),
      del: jest.fn(async (key: string) => {
        shared.delete(key);
      }),
    } as never;
    const trackerA = new MissionElectionTracker(cache);
    const trackerB = new MissionElectionTracker(cache);

    const first = await trackerA.reserveSerializedElection(
      "mission-x",
      async (previouslyElected) => {
        expect(previouslyElected).toEqual([]);
        return { result: "first", electedModelId: "deepseek-v4-pro" };
      },
    );

    const second = await trackerB.reserveSerializedElection(
      "mission-x",
      async (previouslyElected) => {
        expect(previouslyElected).toEqual(["deepseek-v4-pro"]);
        return {
          result: "second",
          electedModelId: "grok-4-1-fast-reasoning",
        };
      },
    );

    await trackerA.commitReservation("mission-x", first.reservation?.token);
    await trackerB.commitReservation("mission-x", second.reservation?.token);

    await expect(trackerB.getElected("mission-x")).resolves.toEqual([
      "deepseek-v4-pro",
      "grok-4-1-fast-reasoning",
    ]);
  });

  it("serializes reservations across tracker instances with prisma advisory lock", async () => {
    const shared = new Map<string, unknown>();
    const cache = {
      get: jest.fn(async (key: string) => shared.get(key)),
      set: jest.fn(async (key: string, value: unknown) => {
        shared.set(key, value);
      }),
      del: jest.fn(async (key: string) => {
        shared.delete(key);
      }),
    } as never;
    const prisma = createSerializedPrismaMock();
    const trackerA = new MissionElectionTracker(cache, prisma as never);
    const trackerB = new MissionElectionTracker(cache, prisma as never);
    const seenHistories: string[][] = [];

    await Promise.all([
      trackerA.reserveSerializedElection(
        "mission-z",
        async (previouslyElected) => {
          seenHistories.push([...previouslyElected]);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { result: "first", electedModelId: "deepseek-v4-pro" };
        },
      ),
      trackerB.reserveSerializedElection(
        "mission-z",
        async (previouslyElected) => {
          seenHistories.push([...previouslyElected]);
          return {
            result: "second",
            electedModelId: "grok-4-1-fast-reasoning",
          };
        },
      ),
    ]);

    expect(seenHistories).toEqual([[], ["deepseek-v4-pro"]]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent commits across tracker instances with prisma advisory lock", async () => {
    const shared = new Map<string, unknown>();
    const cache = {
      get: jest.fn(async (key: string) => shared.get(key)),
      set: jest.fn(async (key: string, value: unknown) => {
        shared.set(key, value);
      }),
      del: jest.fn(async (key: string) => {
        shared.delete(key);
      }),
    } as never;
    const prisma = createSerializedPrismaMock();
    const trackerA = new MissionElectionTracker(cache, prisma as never);
    const trackerB = new MissionElectionTracker(cache, prisma as never);

    const first = await trackerA.reserveSerializedElection(
      "mission-y",
      async () => ({
        result: "first",
        electedModelId: "deepseek-v4-pro",
      }),
    );
    const second = await trackerB.reserveSerializedElection(
      "mission-y",
      async () => ({
        result: "second",
        electedModelId: "grok-4-1-fast-reasoning",
      }),
    );

    await Promise.all([
      trackerA.commitReservation("mission-y", first.reservation?.token),
      trackerB.commitReservation("mission-y", second.reservation?.token),
    ]);

    await expect(trackerA.getElected("mission-y")).resolves.toEqual([
      "deepseek-v4-pro",
      "grok-4-1-fast-reasoning",
    ]);
  });

  it("does not recreate empty state when commit arrives after clear", async () => {
    const shared = new Map<string, unknown>();
    const cache = {
      get: jest.fn(async (key: string) => shared.get(key)),
      set: jest.fn(async (key: string, value: unknown) => {
        shared.set(key, value);
      }),
      del: jest.fn(async (key: string) => {
        shared.delete(key);
      }),
    } as never;
    const prisma = createSerializedPrismaMock();
    const trackerA = new MissionElectionTracker(cache, prisma as never);
    const trackerB = new MissionElectionTracker(cache, prisma as never);

    const first = await trackerA.reserveSerializedElection(
      "mission-clear",
      async () => ({
        result: "first",
        electedModelId: "deepseek-v4-pro",
      }),
    );

    trackerA.clear("mission-clear");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await trackerB.commitReservation("mission-clear", first.reservation?.token);

    await expect(trackerB.getElected("mission-clear")).resolves.toEqual([]);
  });

  it("keeps committed history intact when a reservation token is released after commit", async () => {
    const reserved = await tracker.reserveSerializedElection(
      "mission-commit-release",
      async () => ({
        result: "reserved",
        electedModelId: "deepseek-v4-pro",
      }),
    );

    await tracker.commitReservation(
      "mission-commit-release",
      reserved.reservation?.token,
    );
    await tracker.releaseReservation(
      "mission-commit-release",
      reserved.reservation?.token,
    );

    await expect(tracker.getElected("mission-commit-release")).resolves.toEqual(
      ["deepseek-v4-pro"],
    );
  });

  it("prunes expired reservations from visible history", async () => {
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);

    const reserved = await tracker.reserveSerializedElection(
      "mission-expire",
      async () => ({
        result: "reserved",
        electedModelId: "deepseek-v4-pro",
      }),
    );

    expect(reserved.reservation).toBeDefined();
    await expect(tracker.getElected("mission-expire")).resolves.toEqual([
      "deepseek-v4-pro",
    ]);

    nowSpy.mockReturnValue(1_000 + 11 * 60 * 1000);
    await expect(tracker.getElected("mission-expire")).resolves.toEqual([]);
    nowSpy.mockRestore();
  });
});

function createSerializedPrismaMock() {
  let tail = Promise.resolve();
  const rows = new Map<
    string,
    {
      missionId: string;
      committedModelIds: string[];
      reservations: unknown;
    }
  >();
  return {
    missionElectionState: {
      findUnique: jest.fn(
        async ({ where: { missionId } }: { where: { missionId: string } }) =>
          rows.get(missionId) ?? null,
      ),
      delete: jest.fn(
        async ({ where: { missionId } }: { where: { missionId: string } }) => {
          rows.delete(missionId);
        },
      ),
      deleteMany: jest.fn(
        async ({ where: { missionId } }: { where: { missionId: string } }) => {
          rows.delete(missionId);
          return { count: 1 };
        },
      ),
    },
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback({
          $queryRaw: jest.fn(async () => [{ pg_advisory_xact_lock: null }]),
          missionElectionState: {
            findUnique: jest.fn(
              async ({
                where: { missionId },
              }: {
                where: { missionId: string };
              }) => rows.get(missionId) ?? null,
            ),
            deleteMany: jest.fn(
              async ({
                where: { missionId },
              }: {
                where: { missionId: string };
              }) => {
                rows.delete(missionId);
                return { count: 1 };
              },
            ),
            upsert: jest.fn(
              async ({
                where: { missionId },
                create,
                update,
              }: {
                where: { missionId: string };
                create: {
                  missionId: string;
                  committedModelIds: string[];
                  reservations: unknown;
                };
                update: {
                  committedModelIds: string[];
                  reservations: unknown;
                };
              }) => {
                const next = rows.has(missionId)
                  ? { missionId, ...update }
                  : create;
                rows.set(missionId, next);
                return next;
              },
            ),
          },
        });
      } finally {
        release();
      }
    }),
  };
}
