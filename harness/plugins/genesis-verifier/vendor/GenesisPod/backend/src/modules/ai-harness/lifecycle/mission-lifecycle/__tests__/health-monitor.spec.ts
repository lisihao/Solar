import {
  MissionHealthMonitor,
  type MissionHealthSnapshot,
} from "../health-monitor";

const MIN = 60 * 1000;

function snap(
  partial: Partial<MissionHealthSnapshot> & { missionId: string },
): MissionHealthSnapshot {
  return {
    status: "running",
    startedAt: new Date(Date.now() - 5 * MIN),
    lastActivityAt: new Date(Date.now() - 1 * MIN),
    ...partial,
  };
}

describe("MissionHealthMonitor.evaluate", () => {
  it("returns null for healthy mission", () => {
    const m = new MissionHealthMonitor({
      fetchRunningMissions: jest.fn(),
      onTimeout: jest.fn(),
    });
    const v = m.evaluate(snap({ missionId: "m1" }));
    expect(v).toBeNull();
  });

  it("flags stale when inactiveMs > threshold", () => {
    const m = new MissionHealthMonitor({
      fetchRunningMissions: jest.fn(),
      onTimeout: jest.fn(),
      config: { staleThresholdMs: 5 * MIN },
    });
    const v = m.evaluate(
      snap({
        missionId: "stale-1",
        lastActivityAt: new Date(Date.now() - 10 * MIN),
      }),
    );
    expect(v?.reason).toBe("stale");
  });

  it("flags wall-time-exceeded over total max regardless of activity", () => {
    const m = new MissionHealthMonitor({
      fetchRunningMissions: jest.fn(),
      onTimeout: jest.fn(),
      config: { maxWallTimeMs: 30 * MIN, staleThresholdMs: 60 * MIN },
    });
    const v = m.evaluate(
      snap({
        missionId: "long-1",
        startedAt: new Date(Date.now() - 60 * MIN),
        lastActivityAt: new Date(Date.now() - 1 * MIN), // recent activity
      }),
    );
    expect(v?.reason).toBe("wall-time-exceeded");
  });

  it("falls back to startedAt when lastActivityAt missing", () => {
    const m = new MissionHealthMonitor({
      fetchRunningMissions: jest.fn(),
      onTimeout: jest.fn(),
      config: { staleThresholdMs: 5 * MIN },
    });
    const v = m.evaluate(
      snap({
        missionId: "no-activity",
        startedAt: new Date(Date.now() - 10 * MIN),
        lastActivityAt: undefined,
      }),
    );
    expect(v?.reason).toBe("stale");
  });
});

describe("MissionHealthMonitor.runOnce", () => {
  it("calls onTimeout for unhealthy missions only", async () => {
    const onTimeout = jest.fn().mockResolvedValue(undefined);
    const fetchRunningMissions = jest.fn().mockResolvedValue([
      snap({ missionId: "ok" }),
      snap({
        missionId: "stale",
        lastActivityAt: new Date(Date.now() - 100 * MIN),
      }),
    ]);
    const m = new MissionHealthMonitor({
      fetchRunningMissions,
      onTimeout,
      config: { staleThresholdMs: 30 * MIN },
    });
    const r = await m.runOnce();
    expect(r.totalChecked).toBe(2);
    expect(r.unhealthyCount).toBe(1);
    expect(r.verdicts[0].missionId).toBe("stale");
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("filters out missions not in includeStatuses", async () => {
    const onTimeout = jest.fn().mockResolvedValue(undefined);
    const m = new MissionHealthMonitor({
      fetchRunningMissions: async () => [
        snap({
          missionId: "stale-completed",
          status: "completed",
          lastActivityAt: new Date(Date.now() - 100 * MIN),
        }),
      ],
      onTimeout,
      config: { staleThresholdMs: 30 * MIN },
    });
    const r = await m.runOnce();
    expect(r.unhealthyCount).toBe(0);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("re-entrancy guard prevents overlapping runs", async () => {
    let resolveFirst: () => void = () => {};
    const m = new MissionHealthMonitor({
      fetchRunningMissions: () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve([]);
        }),
      onTimeout: jest.fn(),
    });
    const first = m.runOnce();
    const second = await m.runOnce(); // 立刻返回 0
    expect(second.totalChecked).toBe(0);
    resolveFirst();
    await first;
  });

  it("isolates onTimeout callback errors", async () => {
    const onTimeout = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const m = new MissionHealthMonitor({
      fetchRunningMissions: async () => [
        snap({
          missionId: "stale-1",
          lastActivityAt: new Date(Date.now() - 100 * MIN),
        }),
        snap({
          missionId: "stale-2",
          lastActivityAt: new Date(Date.now() - 100 * MIN),
        }),
      ],
      onTimeout,
      config: { staleThresholdMs: 30 * MIN },
    });
    const r = await m.runOnce();
    expect(r.unhealthyCount).toBe(2);
    expect(onTimeout).toHaveBeenCalledTimes(2);
  });
});
