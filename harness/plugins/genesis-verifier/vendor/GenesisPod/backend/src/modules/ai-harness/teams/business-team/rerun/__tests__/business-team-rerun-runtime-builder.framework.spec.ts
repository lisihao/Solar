/**
 * Framework spec：BusinessTeamRerunRuntimeBuilderFramework
 *
 * 验证 framework 真可被复用：fake MarsTeam 子类调 protectStale / makeCleanup helper +
 * 透传 buildSession / composeMissionContext / writeBackToHydrated hooks。
 */

import {
  FakeMarsRuntimeBuilder,
  makeAbortRegistry,
  makeFakeRuntimeHooks,
  type MarsHydratedCtx,
  type MarsSession,
} from "./__fixtures__/p5-fake-team-mocks";
import { MissionAbortReason } from "../../../../lifecycle/mission-lifecycle/abort-registry";

const baseCtx: MarsHydratedCtx = {
  missionId: "m1",
  userId: "u1",
  marsTopic: "t",
  __hydrated: true,
};

describe("BusinessTeamRerunRuntimeBuilderFramework (fake MarsTeam)", () => {
  it("protectStaleAbortController: stale controller present → abort + unregister", () => {
    const registry = makeAbortRegistry();
    const abortSpy = jest.spyOn(registry, "abort");
    const unregisterSpy = jest.spyOn(registry, "unregister");
    registry.register("m1"); // creates a stale controller
    const builder = new FakeMarsRuntimeBuilder(
      registry,
      makeFakeRuntimeHooks({
        buildSession: (): MarsSession => ({
          missionId: "m1",
          userId: "u1",
          cleanup: () => undefined,
          extras: {},
        }),
      }),
      "mars",
    );
    builder.testProtectStale("m1");
    expect(abortSpy).toHaveBeenCalledWith(
      "m1",
      MissionAbortReason.rerun_replacing_stale,
    );
    expect(unregisterSpy).toHaveBeenCalledWith("m1");
  });

  it("protectStaleAbortController: no stale → no-op", () => {
    const registry = makeAbortRegistry();
    const abortSpy = jest.spyOn(registry, "abort");
    const builder = new FakeMarsRuntimeBuilder(
      registry,
      makeFakeRuntimeHooks({
        buildSession: (): MarsSession => ({
          missionId: "m1",
          userId: "u1",
          cleanup: () => undefined,
          extras: {},
        }),
      }),
      "mars",
    );
    builder.testProtectStale("m1");
    expect(abortSpy).not.toHaveBeenCalled();
  });

  it("makeCleanup: idempotent — second call no-op", () => {
    const registry = makeAbortRegistry();
    const unregisterSpy = jest.spyOn(registry, "unregister");
    const after = jest.fn();
    const builder = new FakeMarsRuntimeBuilder(
      registry,
      makeFakeRuntimeHooks({
        buildSession: (): MarsSession => ({
          missionId: "m1",
          userId: "u1",
          cleanup: () => undefined,
          extras: {},
        }),
      }),
      "mars",
    );
    const cleanup = builder.testMakeCleanup("m1", after);
    cleanup();
    cleanup();
    cleanup();
    expect(unregisterSpy).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("makeCleanup: after-hook throw does not propagate", () => {
    const registry = makeAbortRegistry();
    const builder = new FakeMarsRuntimeBuilder(
      registry,
      makeFakeRuntimeHooks({
        buildSession: (): MarsSession => ({
          missionId: "m1",
          userId: "u1",
          cleanup: () => undefined,
          extras: {},
        }),
      }),
      "mars",
    );
    const cleanup = builder.testMakeCleanup("m1", () => {
      throw new Error("after boom");
    });
    expect(() => cleanup()).not.toThrow();
  });

  it("startSession delegates to hooks.buildSession", () => {
    const session: MarsSession = {
      missionId: "m1",
      userId: "u1",
      cleanup: jest.fn(),
      extras: { tag: "mars" },
    };
    const hooks = makeFakeRuntimeHooks({ buildSession: () => session });
    const builder = new FakeMarsRuntimeBuilder(
      makeAbortRegistry(),
      hooks,
      "mars",
    );
    const r = builder.startSession(baseCtx, "ws-1");
    expect(r).toBe(session);
    expect(hooks.buildSession).toHaveBeenCalledWith({
      ctx: baseCtx,
      workspaceId: "ws-1",
    });
  });

  it("composeMissionContext delegates to hooks", () => {
    const hooks = makeFakeRuntimeHooks({
      buildSession: (): MarsSession => ({
        missionId: "m1",
        userId: "u1",
        cleanup: () => undefined,
        extras: {},
      }),
    });
    const builder = new FakeMarsRuntimeBuilder(
      makeAbortRegistry(),
      hooks,
      "mars",
    );
    const session: MarsSession = {
      missionId: "m1",
      userId: "u1",
      cleanup: () => undefined,
      extras: {},
    };
    const composed = builder.composeMissionContext(baseCtx, session);
    expect(composed.billingTag).toBe("mars-billing");
    expect(hooks.composeMissionContext).toHaveBeenCalledWith(baseCtx, session);
  });

  it("writeBackToHydrated delegates to hooks (business 决定字段映射)", () => {
    const writeBack = jest.fn(
      (_c: { marsTopic: string }, h: MarsHydratedCtx): MarsHydratedCtx => ({
        ...h,
        marsTopic: "updated",
      }),
    );
    const hooks = makeFakeRuntimeHooks({
      buildSession: (): MarsSession => ({
        missionId: "m1",
        userId: "u1",
        cleanup: () => undefined,
        extras: {},
      }),
      writeBackToHydrated: writeBack,
    });
    const builder = new FakeMarsRuntimeBuilder(
      makeAbortRegistry(),
      hooks,
      "mars",
    );
    const r = builder.writeBackToHydrated(
      { missionId: "m1", userId: "u1", marsTopic: "x", billingTag: "b" },
      baseCtx,
    );
    expect(r.marsTopic).toBe("updated");
    expect(writeBack).toHaveBeenCalled();
  });
});
