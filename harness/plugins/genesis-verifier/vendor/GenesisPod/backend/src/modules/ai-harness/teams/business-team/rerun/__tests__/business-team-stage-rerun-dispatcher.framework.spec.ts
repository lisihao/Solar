/**
 * Framework spec：BusinessTeamStageRerunDispatcherFramework
 *
 * 验证 framework 真可被复用：fake MarsTeam 子类提供 handlers + chain + assertRerunable，
 * framework 应正确顺序执行 / emit lifecycle / best-effort partial / markStageProgress。
 */

import { BadRequestException } from "@nestjs/common";
import {
  FakeMarsStageDispatcher,
  makeFakeDispatcherHooks,
  type MarsCtx,
  type MarsEmit,
  type MarsStubs,
} from "./__fixtures__/p5-fake-team-mocks";

const newEmit = (): MarsEmit =>
  jest.fn().mockResolvedValue(undefined) as unknown as MarsEmit;

describe("BusinessTeamStageRerunDispatcherFramework (fake MarsTeam)", () => {
  it("assertRerunable=false → throws BadRequestException", async () => {
    const dispatcher = new FakeMarsStageDispatcher(
      makeFakeDispatcherHooks({
        chain: [],
        handlers: new Map(),
        assertResult: { rerunable: false, reason: "blacklisted" },
      }),
    );
    await expect(
      dispatcher.run({
        ctx: { missionId: "m1", userId: "u1" },
        fromStepId: "s1",
        emit: newEmit(),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("happy path: cascade runs all handlers in order + emits stage-started per step", async () => {
    const calls: string[] = [];
    const handlers = new Map<
      string,
      (ctx: MarsCtx, e: MarsEmit, s: MarsStubs) => Promise<MarsCtx>
    >([
      [
        "s1",
        async (ctx, _e, s) => {
          s.counter.value++;
          calls.push("s1");
          return { ...ctx, marsField: "after-s1" };
        },
      ],
      [
        "s2",
        async (ctx, _e, _s) => {
          calls.push(`s2:${ctx.marsField ?? ""}`);
          return ctx;
        },
      ],
      [
        "s3",
        async (ctx, _e, _s) => {
          calls.push("s3");
          return ctx;
        },
      ],
    ]);
    const hooks = makeFakeDispatcherHooks({
      chain: ["s1", "s2", "s3"],
      handlers,
    });
    const dispatcher = new FakeMarsStageDispatcher(hooks);
    const emit = newEmit();
    const result = await dispatcher.run({
      ctx: { missionId: "m1", userId: "u1" },
      fromStepId: "s1",
      emit,
    });
    expect(result).toEqual({ completed: ["s1", "s2", "s3"] });
    expect(calls).toEqual(["s1", "s2:after-s1", "s3"]);
    // emit stage-started for each step
    expect(emit).toHaveBeenCalledTimes(3);
    expect((emit as jest.Mock).mock.calls[0][0].type).toBe(
      "mars.rerun:stage-started",
    );
  });

  it("missing handler → cascade-aborted + remaining returned", async () => {
    const handlers = new Map<
      string,
      (c: MarsCtx, e: MarsEmit, s: MarsStubs) => Promise<MarsCtx | void>
    >();
    const hooks = makeFakeDispatcherHooks({ chain: ["s1", "s2"], handlers });
    const emit = newEmit();
    const result = await new FakeMarsStageDispatcher(hooks).run({
      ctx: { missionId: "m1", userId: "u1" },
      fromStepId: "s1",
      emit,
    });
    expect(result.abortedAt).toBe("s1");
    expect(result.remaining).toEqual(["s1", "s2"]);
    expect(result.errorMessage).toContain("未注册 rerun handler");
    // cascade-aborted emitted
    const types = (emit as jest.Mock).mock.calls.map((c) => c[0].type);
    expect(types).toContain("mars.rerun:cascade-aborted");
  });

  it("handler throws mid-chain → best-effort partial: previous completed kept", async () => {
    const handlers = new Map<
      string,
      (c: MarsCtx, e: MarsEmit, s: MarsStubs) => Promise<MarsCtx | void>
    >([
      ["s1", async () => undefined],
      [
        "s2",
        async () => {
          throw new Error("boom");
        },
      ],
      ["s3", async () => undefined],
    ]);
    const result = await new FakeMarsStageDispatcher(
      makeFakeDispatcherHooks({ chain: ["s1", "s2", "s3"], handlers }),
    ).run({
      ctx: { missionId: "m1", userId: "u1" },
      fromStepId: "s1",
      emit: newEmit(),
    });
    expect(result.completed).toEqual(["s1"]);
    expect(result.abortedAt).toBe("s2");
    expect(result.remaining).toEqual(["s3"]);
    expect(result.errorMessage).toBe("boom");
  });

  it("markStageProgress invoked after each successful step (non-fatal)", async () => {
    const markStageProgress = jest.fn().mockResolvedValue(undefined);
    const handlers = new Map<
      string,
      (c: MarsCtx, e: MarsEmit, s: MarsStubs) => Promise<MarsCtx | void>
    >([
      ["s1", async () => undefined],
      ["s2", async () => undefined],
    ]);
    await new FakeMarsStageDispatcher(
      makeFakeDispatcherHooks({
        chain: ["s1", "s2"],
        handlers,
        markStageProgress,
      }),
    ).run({
      ctx: { missionId: "m1", userId: "u1" },
      fromStepId: "s1",
      emit: newEmit(),
    });
    expect(markStageProgress).toHaveBeenCalledTimes(2);
    expect(markStageProgress.mock.calls[0][1]).toBe("s1");
    expect(markStageProgress.mock.calls[1][1]).toBe("s2");
  });

  it("withCascadeScope wraps execution (business MissionContext injection point)", async () => {
    let scopeEntered = false;
    const handlers = new Map<
      string,
      (c: MarsCtx, e: MarsEmit, s: MarsStubs) => Promise<MarsCtx | void>
    >([["s1", async () => undefined]]);
    await new FakeMarsStageDispatcher(
      makeFakeDispatcherHooks({
        chain: ["s1"],
        handlers,
        withCascadeScope: async <T>(
          _ctx: MarsCtx,
          fn: () => Promise<T>,
        ): Promise<T> => {
          scopeEntered = true;
          return fn();
        },
      }),
    ).run({
      ctx: { missionId: "m1", userId: "u1" },
      fromStepId: "s1",
      emit: newEmit(),
    });
    expect(scopeEntered).toBe(true);
  });
});
