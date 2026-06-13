/**
 * Framework spec：BusinessTeamRerunGuardFramework
 *
 * 验证 framework 真可被复用：fake MarsTeam 子类提供 dummy hook，framework 应正确编排
 * 9-cell 决策 + zombie cleanup + fail-closed + ownership 校验。
 */

import { BadRequestException } from "@nestjs/common";
import {
  FakeMarsRerunGuard,
  makeFakeMarsGuardHooks,
  makeFakeLifecycleManager,
  type MarsDetail,
} from "./__fixtures__/p5-fake-team-mocks";

const NOW = 1_700_000_000_000;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});
afterEach(() => {
  jest.useRealTimers();
});

const detailRunning = (heartbeatAgo: number | null): MarsDetail => ({
  id: "m1",
  status: "running",
  heartbeatAt: heartbeatAgo == null ? null : new Date(NOW - heartbeatAgo),
  mission: "fake-mars",
});

describe("BusinessTeamRerunGuardFramework (fake MarsTeam)", () => {
  it("checkInFlight: detail=null → not inFlight (ownership tolerant)", async () => {
    const lm = makeFakeLifecycleManager();
    const hooks = makeFakeMarsGuardHooks({ detail: null });
    const guard = new FakeMarsRerunGuard(lm, hooks);
    const r = await guard.checkInFlight("m1", "u1");
    expect(r.inFlight).toBe(false);
    expect(r.zombieDetected).toBe(false);
  });

  it("checkInFlight: non-running status short-circuit", async () => {
    const lm = makeFakeLifecycleManager();
    const hooks = makeFakeMarsGuardHooks({
      detail: { id: "m1", status: "failed", heartbeatAt: null, mission: "x" },
    });
    const r = await new FakeMarsRerunGuard(lm, hooks).checkInFlight("m1", "u1");
    expect(r.inFlight).toBe(false);
    expect(r.status).toBe("failed");
    expect(hooks.latestBusinessEventTsReader).not.toHaveBeenCalled();
  });

  it("checkInFlight: HB fresh + BE fresh → inFlight=true with reason", async () => {
    const hooks = makeFakeMarsGuardHooks({
      detail: detailRunning(5_000),
      latestEventTs: NOW - 3_000,
    });
    const r = await new FakeMarsRerunGuard(
      makeFakeLifecycleManager(),
      hooks,
    ).checkInFlight("m1", "u1");
    expect(r.inFlight).toBe(true);
    expect(r.reason).toContain("5s");
    expect(r.reason).toContain("3s");
  });

  it("checkInFlight: HB fresh + BE stale → zombieDetected", async () => {
    const hooks = makeFakeMarsGuardHooks({
      detail: detailRunning(5_000),
      latestEventTs: NOW - 600_000,
    });
    const r = await new FakeMarsRerunGuard(
      makeFakeLifecycleManager(),
      hooks,
    ).checkInFlight("m1", "u1");
    expect(r.zombieDetected).toBe(true);
    expect(r.inFlight).toBe(false);
  });

  it("ensureRerunable: inFlight=true → BadRequestException", async () => {
    const hooks = makeFakeMarsGuardHooks({
      detail: detailRunning(5_000),
      latestEventTs: NOW - 1_000,
    });
    const guard = new FakeMarsRerunGuard(makeFakeLifecycleManager(), hooks);
    await expect(guard.ensureRerunable("m1", "u1")).rejects.toThrow(
      BadRequestException,
    );
  });

  it("ensureRerunable: zombieDetected → finalize + clearHeartbeat + emit", async () => {
    const lm = makeFakeLifecycleManager();
    const hooks = makeFakeMarsGuardHooks({
      detail: detailRunning(5_000),
      latestEventTs: NOW - 600_000,
    });
    await new FakeMarsRerunGuard(lm, hooks).ensureRerunable("m1", "u1");
    expect(lm.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: "m1",
        intent: expect.objectContaining({ status: "failed" }),
      }),
    );
    expect(hooks.clearHeartbeat).toHaveBeenCalledWith("m1", "u1");
    expect(hooks.emitZombieCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ missionId: "m1", userId: "u1" }),
    );
  });

  it("ensureRerunable: checkInFlight throws → fail-closed BadRequest", async () => {
    const hooks = makeFakeMarsGuardHooks({});
    (hooks.detailReader as jest.Mock).mockRejectedValue(new Error("db down"));
    await expect(
      new FakeMarsRerunGuard(makeFakeLifecycleManager(), hooks).ensureRerunable(
        "m1",
        "u1",
      ),
    ).rejects.toThrow(/rerun guard 服务异常/);
  });

  it("zombieCleanup race: status flipped to failed before second read → skip", async () => {
    const lm = makeFakeLifecycleManager();
    const hooks = makeFakeMarsGuardHooks({
      detail: detailRunning(5_000),
      latestEventTs: NOW - 600_000,
    });
    (hooks.detailReader as jest.Mock)
      .mockResolvedValueOnce(detailRunning(5_000))
      .mockResolvedValueOnce({
        id: "m1",
        status: "failed",
        heartbeatAt: null,
        mission: "x",
      });
    await new FakeMarsRerunGuard(lm, hooks).ensureRerunable("m1", "u1");
    expect(lm.finalize).not.toHaveBeenCalled();
  });

  it("emitZombieCleanup is best-effort: throw not propagated", async () => {
    const lm = makeFakeLifecycleManager();
    const hooks = makeFakeMarsGuardHooks({
      detail: detailRunning(5_000),
      latestEventTs: NOW - 600_000,
      emitZombie: jest.fn().mockRejectedValue(new Error("emit boom")),
    });
    await expect(
      new FakeMarsRerunGuard(lm, hooks).ensureRerunable("m1", "u1"),
    ).resolves.toBeUndefined();
  });

  it("custom runningStatuses respected", async () => {
    const hooks = makeFakeMarsGuardHooks({
      detail: {
        id: "m1",
        status: "active",
        heartbeatAt: new Date(NOW - 1),
        mission: "x",
      },
      latestEventTs: NOW - 1,
    });
    hooks.runningStatuses = ["active"] as const;
    const r = await new FakeMarsRerunGuard(
      makeFakeLifecycleManager(),
      hooks,
    ).checkInFlight("m1", "u1");
    expect(r.inFlight).toBe(true);
  });
});
