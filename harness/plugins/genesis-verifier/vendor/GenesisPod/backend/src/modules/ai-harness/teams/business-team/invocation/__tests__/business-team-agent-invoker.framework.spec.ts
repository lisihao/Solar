/**
 * BusinessTeamAgentInvokerFramework spec
 *
 * 覆盖 retry / abort / transient vs permanent / degrade hook / span lifecycle。
 */

import { BusinessTeamAgentInvokerFramework } from "../business-team-agent-invoker.framework";
import type {
  BusinessTeamAgentInvokerHooks,
  BusinessTeamInvocationContext,
} from "../abstractions/business-team-agent-invoker.interface";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeAbortRegistry(signal?: AbortSignal) {
  return {
    getSignal: jest.fn().mockReturnValue(signal),
  };
}

interface SpyHooks extends BusinessTeamAgentInvokerHooks<
  unknown,
  unknown,
  { ok: string }
> {
  invokeOnce: jest.Mock;
  onAgentEvent: jest.Mock;
  onAgentStart: jest.Mock;
  onAgentEnd: jest.Mock;
  onRetry: jest.Mock;
  onDegrade: jest.Mock;
}

function makeHooks(overrides?: Partial<SpyHooks>): SpyHooks {
  return {
    invokeOnce: jest.fn().mockResolvedValue({ ok: "result" }),
    onAgentEvent: jest.fn().mockResolvedValue(undefined),
    onAgentStart: jest.fn(),
    onAgentEnd: jest.fn(),
    onRetry: jest.fn(),
    onDegrade: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as SpyHooks;
}

const baseCtx: BusinessTeamInvocationContext = {
  missionId: "m1",
  userId: "u1",
  agentId: "researcher#0",
  role: "researcher",
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe("BusinessTeamAgentInvokerFramework", () => {
  // span lifecycle + happy path

  it("invokes hooks.invokeOnce once on first success and emits agent start/end", async () => {
    const hooks = makeHooks();
    const abortReg = makeAbortRegistry();
    const fw = new BusinessTeamAgentInvokerFramework(hooks, abortReg as never);
    const result = await fw.invoke({}, {}, baseCtx);

    expect(result).toEqual({ ok: "result" });
    expect(hooks.invokeOnce).toHaveBeenCalledTimes(1);
    expect(hooks.onAgentStart).toHaveBeenCalledWith(baseCtx);
    expect(hooks.onAgentEnd).toHaveBeenCalledWith(baseCtx, "completed");
    expect(hooks.onDegrade).not.toHaveBeenCalled();
  });

  // retry path

  it("retries up to maxRetries on transient error and succeeds", async () => {
    const hooks = makeHooks({
      invokeOnce: jest
        .fn()
        .mockRejectedValueOnce(new Error("network timeout — ECONNRESET"))
        .mockResolvedValueOnce({ ok: "ok-after-retry" }),
    });
    const abortReg = makeAbortRegistry();
    const fw = new BusinessTeamAgentInvokerFramework(hooks, abortReg as never);

    const result = await fw.invoke({}, {}, baseCtx);
    expect(result).toEqual({ ok: "ok-after-retry" });
    expect(hooks.invokeOnce).toHaveBeenCalledTimes(2);
    expect(hooks.onRetry).toHaveBeenCalledTimes(1);
    expect(hooks.onDegrade).not.toHaveBeenCalled();
    expect(hooks.onAgentEnd).toHaveBeenLastCalledWith(baseCtx, "completed");
  });

  // retry exhausted → degrade then throw

  it("exhausts retries on persistent transient error: 3 attempts + degrade + throw", async () => {
    const transient = new Error("503 Service Unavailable");
    const hooks = makeHooks({
      invokeOnce: jest.fn().mockRejectedValue(transient),
    });
    const abortReg = makeAbortRegistry();
    const fw = new BusinessTeamAgentInvokerFramework(hooks, abortReg as never);

    await expect(fw.invoke({}, {}, baseCtx)).rejects.toThrow(transient);
    expect(hooks.invokeOnce).toHaveBeenCalledTimes(3); // 1 + maxRetries=2
    expect(hooks.onDegrade).toHaveBeenCalledTimes(1);
    expect(hooks.onDegrade).toHaveBeenCalledWith(
      baseCtx,
      transient,
      expect.objectContaining({ attempts: 3, transient: true }),
    );
    expect(hooks.onAgentEnd).toHaveBeenLastCalledWith(
      baseCtx,
      "failed",
      transient,
    );
  });

  // permanent (non-transient) error path

  it("permanent error: no retry, degrade emitted with transient=false, throws immediately", async () => {
    const permanent = new Error("context_length_exceeded: token limit hit");
    const hooks = makeHooks({
      invokeOnce: jest.fn().mockRejectedValue(permanent),
    });
    const abortReg = makeAbortRegistry();
    const fw = new BusinessTeamAgentInvokerFramework(hooks, abortReg as never);

    await expect(fw.invoke({}, {}, baseCtx)).rejects.toThrow(permanent);
    expect(hooks.invokeOnce).toHaveBeenCalledTimes(1);
    expect(hooks.onDegrade).toHaveBeenCalledWith(
      baseCtx,
      permanent,
      expect.objectContaining({ attempts: 1, transient: false }),
    );
  });

  // abort short-circuit

  it("abort signal short-circuits retry: only 1 invokeOnce despite transient error", async () => {
    const controller = new AbortController();
    controller.abort();
    const transient = new Error("network timeout — ECONNRESET");
    const hooks = makeHooks({
      invokeOnce: jest.fn().mockRejectedValue(transient),
    });
    const abortReg = makeAbortRegistry(controller.signal);
    const fw = new BusinessTeamAgentInvokerFramework(hooks, abortReg as never);

    await expect(fw.invoke({}, {}, baseCtx)).rejects.toThrow(transient);
    expect(hooks.invokeOnce).toHaveBeenCalledTimes(1);
    // Abort 路径不走 degrade（与原 playground 行为一致：抛出即可，业务方不需 degraded 事件）
    expect(hooks.onDegrade).not.toHaveBeenCalled();
    expect(hooks.onAgentEnd).toHaveBeenLastCalledWith(
      baseCtx,
      "failed",
      transient,
    );
  });

  // optional hook robustness

  it("works without optional hooks (only invokeOnce required)", async () => {
    const fw = new BusinessTeamAgentInvokerFramework(
      { invokeOnce: jest.fn().mockResolvedValue({ ok: "minimal" }) },
      makeAbortRegistry() as never,
    );
    const result = await fw.invoke({}, {}, baseCtx);
    expect(result).toEqual({ ok: "minimal" });
  });

  it("does not throw when onDegrade hook itself rejects", async () => {
    const permanent = new Error("context_length_exceeded");
    const hooks = makeHooks({
      invokeOnce: jest.fn().mockRejectedValue(permanent),
      onDegrade: jest.fn().mockRejectedValue(new Error("emit-fail")),
    });
    const fw = new BusinessTeamAgentInvokerFramework(
      hooks,
      makeAbortRegistry() as never,
    );
    await expect(fw.invoke({}, {}, baseCtx)).rejects.toThrow(permanent);
  });

  // maxRetries config

  it("respects custom maxRetries=0 (no retries, single attempt only)", async () => {
    const transient = new Error("503");
    const hooks = makeHooks({
      invokeOnce: jest.fn().mockRejectedValue(transient),
    });
    const fw = new BusinessTeamAgentInvokerFramework(
      hooks,
      makeAbortRegistry() as never,
      { maxRetries: 0 },
    );
    await expect(fw.invoke({}, {}, baseCtx)).rejects.toThrow(transient);
    expect(hooks.invokeOnce).toHaveBeenCalledTimes(1);
  });
});
