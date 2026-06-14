/**
 * P6 spec: BusinessTeamLifecycleTransitionsFramework via FakeMarsLifecycleTransitions.
 */
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import {
  FakeMarsLifecycleTransitions,
  makeFakeMarsLifecycleHooks,
} from "./__fixtures__/p6-fake-team-mocks";

describe("BusinessTeamLifecycleTransitionsFramework (FakeMars)", () => {
  it("writeCompleted: condition write + clearCheckpoint; returns true when affected>0", async () => {
    const hooks = makeFakeMarsLifecycleHooks({ affected: 1 });
    const f = new FakeMarsLifecycleTransitions(hooks, "fake-mars-lifecycle");
    const ok = await f.writeCompleted("m1", { tokens: 42 }, "u1");
    expect(ok).toBe(true);
    expect(hooks.buildCompletedUpdate).toHaveBeenCalledWith({ tokens: 42 });
    expect(hooks.conditionalUpdate).toHaveBeenCalledWith(
      "m1",
      { userId: "u1" },
      { status: "completed", tokens: 42 },
    );
    expect(hooks.clearCheckpoint).toHaveBeenCalledWith("m1");
  });

  it("writeCompleted: returns false when no row updated (lost race)", async () => {
    const hooks = makeFakeMarsLifecycleHooks({ affected: 0 });
    const f = new FakeMarsLifecycleTransitions(hooks, "fake-mars-lifecycle");
    expect(await f.writeCompleted("m1", { tokens: 1 })).toBe(false);
  });

  it("writeCompleted: throws PayloadTooLargeException when report > 10MB", async () => {
    const hooks = makeFakeMarsLifecycleHooks();
    const f = new FakeMarsLifecycleTransitions(hooks, "fake-mars-lifecycle");
    // 11MB report
    const big = {
      content: { fullMarkdown: "x".repeat(11 * 1024 * 1024) },
    };
    await expect(
      f.writeCompleted("m1", { report: big }, "u1"),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it("writeCompleted: soft truncates fullMarkdown when 5MB<size<10MB", async () => {
    const hooks = makeFakeMarsLifecycleHooks();
    const f = new FakeMarsLifecycleTransitions(hooks, "fake-mars-lifecycle");
    const report = {
      content: {
        fullMarkdown: "x".repeat(6 * 1024 * 1024),
      },
    };
    await f.writeCompleted("m1", { report }, "u1");
    expect(report.content.fullMarkdown.length).toBeLessThan(200_000);
    expect((report.content as { truncated?: boolean }).truncated).toBe(true);
  });

  it("writeCancelled: builds cancelled update + clearCheckpoint", async () => {
    const hooks = makeFakeMarsLifecycleHooks({ affected: 1 });
    const f = new FakeMarsLifecycleTransitions(hooks, "fake-mars-lifecycle");
    const ok = await f.writeCancelled("m1", "u1");
    expect(ok).toBe(true);
    expect(hooks.buildCancelledUpdate).toHaveBeenCalled();
    expect(hooks.clearCheckpoint).toHaveBeenCalledWith("m1");
  });

  it("writeFailed: builds failed update + clearCheckpoint; returns boolean", async () => {
    const hooks = makeFakeMarsLifecycleHooks({ affected: 1 });
    const f = new FakeMarsLifecycleTransitions(hooks, "fake-mars-lifecycle");
    const ok = await f.writeFailed("m1", { errorMessage: "boom" }, "u1");
    expect(ok).toBe(true);
    expect(hooks.buildFailedUpdate).toHaveBeenCalledWith({
      errorMessage: "boom",
    });
  });

  it("writeFailed: swallows DB errors → returns false", async () => {
    const hooks = makeFakeMarsLifecycleHooks();
    (hooks.conditionalUpdate as jest.Mock).mockRejectedValue(new Error("db"));
    const f = new FakeMarsLifecycleTransitions(hooks, "fake-mars-lifecycle");
    expect(await f.writeFailed("m1", { errorMessage: "x" })).toBe(false);
  });

  it("markReopened: success → no throw", async () => {
    const hooks = makeFakeMarsLifecycleHooks();
    (hooks.reopenTransaction as jest.Mock).mockResolvedValue({
      affected: 1,
      currentStatus: "failed",
    });
    const f = new FakeMarsLifecycleTransitions(hooks, "fake-mars-lifecycle");
    await expect(f.markReopened("m1", "u1")).resolves.toBeUndefined();
  });

  it("markReopened: probe null status → NotFoundException", async () => {
    const hooks = makeFakeMarsLifecycleHooks();
    (hooks.reopenTransaction as jest.Mock).mockResolvedValue({
      affected: 0,
      currentStatus: null,
    });
    const f = new FakeMarsLifecycleTransitions(hooks, "fake-mars-lifecycle");
    await expect(f.markReopened("m1", "u1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("markReopened: wrong status → BadRequestException", async () => {
    const hooks = makeFakeMarsLifecycleHooks();
    (hooks.reopenTransaction as jest.Mock).mockResolvedValue({
      affected: 0,
      currentStatus: "completed",
    });
    const f = new FakeMarsLifecycleTransitions(hooks, "fake-mars-lifecycle");
    await expect(f.markReopened("m1", "u1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
