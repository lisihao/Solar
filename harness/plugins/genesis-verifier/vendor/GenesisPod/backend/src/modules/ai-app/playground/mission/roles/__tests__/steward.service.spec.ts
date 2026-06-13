/**
 * steward.service.spec.ts
 *
 * 当前唯一方法: guardBudget。
 * 历史预留方法（checkCompliance/checkBoundary/checkSourceDiversity）已删
 * （2026-05-15 PR-E）：从未接入 orchestrator + agent 无对应 scope。
 */

import { StewardService } from "../steward.service";
import type { InvocationContext } from "../agent-invoker.service";

const baseCtx: InvocationContext = {
  missionId: "m1",
  userId: "u1",
  agentId: "steward#0",
  role: "steward",
};

function makeInvoker(
  state: "completed" | "failed" | "cancelled" = "completed",
) {
  return {
    invoke: jest.fn().mockResolvedValue({
      state,
      output:
        state === "completed" ? { approved: true, alerts: [] } : undefined,
      events: [],
      iterations: 1,
      wallTimeMs: 150,
    }),
  };
}

describe("StewardService", () => {
  describe("guardBudget", () => {
    it("adds scope=budget-guard and calls invoker", async () => {
      const invoker = makeInvoker();
      const svc = new StewardService(invoker as never);
      const result = await svc.guardBudget({ budget: 100 }, baseCtx);
      expect(result.state).toBe("completed");
      const passedInput = invoker.invoke.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(passedInput.scope).toBe("budget-guard");
    });

    it("preserves original input properties", async () => {
      const invoker = makeInvoker();
      const svc = new StewardService(invoker as never);
      await svc.guardBudget({ budget: 200, userId: "test" }, baseCtx);
      const passedInput = invoker.invoke.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(passedInput.budget).toBe(200);
      expect(passedInput.scope).toBe("budget-guard");
    });

    it("does not mutate original input", async () => {
      const invoker = makeInvoker();
      const svc = new StewardService(invoker as never);
      const input = { budget: 100 };
      await svc.guardBudget(input, baseCtx);
      expect((input as Record<string, unknown>).scope).toBeUndefined();
    });

    it("maps failed state", async () => {
      const invoker = makeInvoker("failed");
      const svc = new StewardService(invoker as never);
      const result = await svc.guardBudget({}, baseCtx);
      expect(result.state).toBe("failed");
      expect(result.output).toBeUndefined();
    });

    it("maps cancelled state", async () => {
      const invoker = makeInvoker("cancelled");
      const svc = new StewardService(invoker as never);
      const result = await svc.guardBudget({}, baseCtx);
      expect(result.state).toBe("cancelled");
    });
  });

  it("propagates events from invoker", async () => {
    const events = [{ type: "thinking", payload: {}, timestamp: 0 }];
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: {},
      events,
      iterations: 1,
      wallTimeMs: 100,
    });
    const svc = new StewardService(invoker as never);
    const result = await svc.guardBudget({}, baseCtx);
    expect(result.events).toBe(events);
  });

  it("propagates iterations and wallTimeMs", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: {},
      events: [],
      iterations: 2,
      wallTimeMs: 800,
    });
    const svc = new StewardService(invoker as never);
    const result = await svc.guardBudget({}, baseCtx);
    expect(result.iterations).toBe(2);
    expect(result.wallTimeMs).toBe(800);
  });

  it("throws when invoker rejects", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockRejectedValue(new Error("steward crashed"));
    const svc = new StewardService(invoker as never);
    await expect(svc.guardBudget({}, baseCtx)).rejects.toThrow(
      "steward crashed",
    );
  });

  it("passes ctx to invoker", async () => {
    const invoker = makeInvoker();
    const svc = new StewardService(invoker as never);
    await svc.guardBudget({}, baseCtx);
    expect(invoker.invoke.mock.calls[0][2]).toBe(baseCtx);
  });

  it("maps unknown state to failed", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "timeout" as "failed",
      output: undefined,
      events: [],
      iterations: 1,
      wallTimeMs: 100,
    });
    const svc = new StewardService(invoker as never);
    const result = await svc.guardBudget({}, baseCtx);
    expect(result.state).toBe("failed");
  });
});
