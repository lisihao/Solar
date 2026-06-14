/**
 * reviewer.service.spec.ts
 */

import { ReviewerService } from "../reviewer.service";
import type { InvocationContext } from "../agent-invoker.service";

const baseCtx: InvocationContext = {
  missionId: "m1",
  userId: "u1",
  agentId: "reviewer#0",
  role: "reviewer",
};

function makeInvoker(
  state: "completed" | "failed" | "cancelled" = "completed",
) {
  return {
    invoke: jest.fn().mockResolvedValue({
      state,
      output:
        state === "completed" ? { score: 85, verdict: "pass" } : undefined,
      events: [],
      iterations: 1,
      wallTimeMs: 200,
    }),
  };
}

describe("ReviewerService", () => {
  describe("reviewMission", () => {
    it("calls invoker and returns completed result", async () => {
      const invoker = makeInvoker();
      const svc = new ReviewerService(invoker as never);
      const result = await svc.reviewMission({ report: "text" }, baseCtx);
      expect(result.state).toBe("completed");
      expect(invoker.invoke).toHaveBeenCalledTimes(1);
    });

    it("returns output", async () => {
      const invoker = makeInvoker();
      const svc = new ReviewerService(invoker as never);
      const result = await svc.reviewMission<
        { report: string },
        { score: number }
      >({ report: "text" }, baseCtx);
      expect(result.output?.score).toBe(85);
    });

    it("maps failed state", async () => {
      const invoker = makeInvoker("failed");
      const svc = new ReviewerService(invoker as never);
      const result = await svc.reviewMission({}, baseCtx);
      expect(result.state).toBe("failed");
      expect(result.output).toBeUndefined();
    });

    it("maps cancelled state", async () => {
      const invoker = makeInvoker("cancelled");
      const svc = new ReviewerService(invoker as never);
      const result = await svc.reviewMission({}, baseCtx);
      expect(result.state).toBe("cancelled");
    });
  });

  describe("criticL4", () => {
    it("calls invoker and returns result", async () => {
      const invoker = makeInvoker();
      const svc = new ReviewerService(invoker as never);
      const result = await svc.criticL4({ report: "text" }, baseCtx);
      expect(result.state).toBe("completed");
    });

    it("maps failed state", async () => {
      const invoker = makeInvoker("failed");
      const svc = new ReviewerService(invoker as never);
      const result = await svc.criticL4({}, baseCtx);
      expect(result.state).toBe("failed");
    });
  });

  describe("judgeDimension", () => {
    it("calls invoker and returns result", async () => {
      const invoker = makeInvoker();
      const svc = new ReviewerService(invoker as never);
      const result = await svc.judgeDimension({ dimension: "Tech" }, baseCtx);
      expect(result.state).toBe("completed");
    });

    it("maps cancelled state", async () => {
      const invoker = makeInvoker("cancelled");
      const svc = new ReviewerService(invoker as never);
      const result = await svc.judgeDimension({}, baseCtx);
      expect(result.state).toBe("cancelled");
    });
  });

  it("propagates events from invoker", async () => {
    const events = [
      { type: "reflection", payload: { score: 90 }, timestamp: 0 },
    ];
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: {},
      events,
      iterations: 1,
      wallTimeMs: 100,
    });
    const svc = new ReviewerService(invoker as never);
    const result = await svc.reviewMission({}, baseCtx);
    expect(result.events).toBe(events);
  });

  it("propagates iterations and wallTimeMs", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: {},
      events: [],
      iterations: 3,
      wallTimeMs: 1500,
    });
    const svc = new ReviewerService(invoker as never);
    const result = await svc.criticL4({}, baseCtx);
    expect(result.iterations).toBe(3);
    expect(result.wallTimeMs).toBe(1500);
  });

  it("throws when invoker rejects", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockRejectedValue(new Error("critic crashed"));
    const svc = new ReviewerService(invoker as never);
    await expect(svc.criticL4({}, baseCtx)).rejects.toThrow("critic crashed");
  });

  it("passes ctx to invoker", async () => {
    const invoker = makeInvoker();
    const svc = new ReviewerService(invoker as never);
    await svc.judgeDimension({}, baseCtx);
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
    const svc = new ReviewerService(invoker as never);
    const result = await svc.reviewMission({}, baseCtx);
    expect(result.state).toBe("failed");
  });
});
