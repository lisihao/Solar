/**
 * verifier.service.spec.ts
 *
 * 当前唯一方法: auditCitation。
 * 历史预留方法（checkNumber/groundClaim/tierSource）已删
 * （2026-05-15 PR-E）：从未接入 orchestrator + agent 无对应 mode。
 */

import { VerifierService } from "../verifier.service";
import type { InvocationContext } from "../agent-invoker.service";

const baseCtx: InvocationContext = {
  missionId: "m1",
  userId: "u1",
  agentId: "verifier#0",
  role: "verifier",
};

function makeInvoker(
  state: "completed" | "failed" | "cancelled" = "completed",
) {
  return {
    invoke: jest.fn().mockResolvedValue({
      state,
      output:
        state === "completed" ? { verified: true, issues: [] } : undefined,
      events: [],
      iterations: 1,
      wallTimeMs: 250,
    }),
  };
}

describe("VerifierService", () => {
  describe("auditCitation", () => {
    it("adds mode=citation-audit to input and calls invoker", async () => {
      const invoker = makeInvoker();
      const svc = new VerifierService(invoker as never);
      const input = { findings: [] };
      const result = await svc.auditCitation(input, baseCtx);
      expect(result.state).toBe("completed");
      expect(invoker.invoke).toHaveBeenCalledTimes(1);
      const passedInput = invoker.invoke.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(passedInput.mode).toBe("citation-audit");
    });

    it("does not mutate the original input object", async () => {
      const invoker = makeInvoker();
      const svc = new VerifierService(invoker as never);
      const input = { findings: ["a"] };
      await svc.auditCitation(input, baseCtx);
      expect((input as Record<string, unknown>).mode).toBeUndefined();
    });

    it("maps failed state", async () => {
      const invoker = makeInvoker("failed");
      const svc = new VerifierService(invoker as never);
      const result = await svc.auditCitation({}, baseCtx);
      expect(result.state).toBe("failed");
    });

    it("maps cancelled state", async () => {
      const invoker = makeInvoker("cancelled");
      const svc = new VerifierService(invoker as never);
      const result = await svc.auditCitation({}, baseCtx);
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
    const svc = new VerifierService(invoker as never);
    const result = await svc.auditCitation({}, baseCtx);
    expect(result.events).toBe(events);
  });

  it("propagates iterations and wallTimeMs", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: {},
      events: [],
      iterations: 4,
      wallTimeMs: 2000,
    });
    const svc = new VerifierService(invoker as never);
    const result = await svc.auditCitation({}, baseCtx);
    expect(result.iterations).toBe(4);
    expect(result.wallTimeMs).toBe(2000);
  });

  it("throws when invoker rejects", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockRejectedValue(new Error("verifier crashed"));
    const svc = new VerifierService(invoker as never);
    await expect(svc.auditCitation({}, baseCtx)).rejects.toThrow(
      "verifier crashed",
    );
  });

  it("passes ctx to invoker", async () => {
    const invoker = makeInvoker();
    const svc = new VerifierService(invoker as never);
    await svc.auditCitation({}, baseCtx);
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
    const svc = new VerifierService(invoker as never);
    const result = await svc.auditCitation({}, baseCtx);
    expect(result.state).toBe("failed");
  });

  it("preserves existing properties in input alongside mode", async () => {
    const invoker = makeInvoker();
    const svc = new VerifierService(invoker as never);
    await svc.auditCitation({ existingProp: "hello" }, baseCtx);
    const passedInput = invoker.invoke.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(passedInput.existingProp).toBe("hello");
    expect(passedInput.mode).toBe("citation-audit");
  });
});
