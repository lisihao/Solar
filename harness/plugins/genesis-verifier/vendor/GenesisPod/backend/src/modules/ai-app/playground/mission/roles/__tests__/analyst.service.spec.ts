/**
 * analyst.service.spec.ts
 */

import { AnalystService } from "../analyst.service";
import type { InvocationContext } from "../agent-invoker.service";

const baseCtx: InvocationContext = {
  missionId: "m1",
  userId: "u1",
  agentId: "analyst#0",
  role: "analyst",
};

function makeInvoker() {
  return {
    invoke: jest.fn().mockResolvedValue({
      state: "completed",
      output: { insights: ["AI is growing"], strategicRecommendations: [] },
      events: [],
      iterations: 1,
      wallTimeMs: 400,
    }),
  };
}

describe("AnalystService", () => {
  it("calls invoker.invoke and returns completed state", async () => {
    const invoker = makeInvoker();
    const svc = new AnalystService(invoker as never);
    const result = await svc.analyze({ topic: "AI" }, baseCtx);
    expect(result.state).toBe("completed");
    expect(invoker.invoke).toHaveBeenCalledTimes(1);
  });

  it("returns output typed as TOut", async () => {
    const invoker = makeInvoker();
    const svc = new AnalystService(invoker as never);
    const result = await svc.analyze<{ topic: string }, { insights: string[] }>(
      { topic: "AI" },
      baseCtx,
    );
    expect(result.output?.insights).toContain("AI is growing");
  });

  it("maps failed state", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "failed",
      output: undefined,
      events: [],
      iterations: 1,
      wallTimeMs: 100,
    });
    const svc = new AnalystService(invoker as never);
    const result = await svc.analyze({}, baseCtx);
    expect(result.state).toBe("failed");
    expect(result.output).toBeUndefined();
  });

  it("maps cancelled state", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "cancelled",
      output: undefined,
      events: [],
      iterations: 0,
      wallTimeMs: 0,
    });
    const svc = new AnalystService(invoker as never);
    const result = await svc.analyze({}, baseCtx);
    expect(result.state).toBe("cancelled");
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
    const svc = new AnalystService(invoker as never);
    const result = await svc.analyze({}, baseCtx);
    expect(result.state).toBe("failed");
  });

  it("propagates events", async () => {
    const events = [{ type: "thinking", payload: {}, timestamp: 0 }];
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: {},
      events,
      iterations: 1,
      wallTimeMs: 100,
    });
    const svc = new AnalystService(invoker as never);
    const result = await svc.analyze({}, baseCtx);
    expect(result.events).toBe(events);
  });

  it("propagates iterations and wallTimeMs", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: {},
      events: [],
      iterations: 7,
      wallTimeMs: 2500,
    });
    const svc = new AnalystService(invoker as never);
    const result = await svc.analyze({}, baseCtx);
    expect(result.iterations).toBe(7);
    expect(result.wallTimeMs).toBe(2500);
  });

  it("passes input to invoker.invoke", async () => {
    const invoker = makeInvoker();
    const svc = new AnalystService(invoker as never);
    const input = { topic: "test", lang: "en" };
    await svc.analyze(input, baseCtx);
    expect(invoker.invoke.mock.calls[0][1]).toBe(input);
  });

  it("passes ctx to invoker.invoke", async () => {
    const invoker = makeInvoker();
    const svc = new AnalystService(invoker as never);
    await svc.analyze({}, baseCtx);
    expect(invoker.invoke.mock.calls[0][2]).toBe(baseCtx);
  });

  it("throws when invoker rejects", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockRejectedValue(new Error("engine down"));
    const svc = new AnalystService(invoker as never);
    await expect(svc.analyze({}, baseCtx)).rejects.toThrow("engine down");
  });

  it("accepts empty input object", async () => {
    const invoker = makeInvoker();
    const svc = new AnalystService(invoker as never);
    await expect(svc.analyze({}, baseCtx)).resolves.toBeDefined();
  });

  describe("synthesizeQuickView", () => {
    it("delegates to invoker.invoke and returns completed state", async () => {
      const invoker = makeInvoker();
      invoker.invoke.mockResolvedValue({
        state: "completed",
        output: { keyFindingsByDimension: [] },
        events: [],
        iterations: 1,
        wallTimeMs: 200,
      });
      const svc = new AnalystService(invoker as never);
      const result = await svc.synthesizeQuickView(
        { topic: "AI", researcherResults: [] },
        baseCtx,
      );
      expect(result.state).toBe("completed");
      expect(invoker.invoke).toHaveBeenCalledTimes(1);
    });

    it("maps failed state and undefined output", async () => {
      const invoker = makeInvoker();
      invoker.invoke.mockResolvedValue({
        state: "failed",
        output: undefined,
        events: [],
        iterations: 1,
        wallTimeMs: 50,
      });
      const svc = new AnalystService(invoker as never);
      const result = await svc.synthesizeQuickView({}, baseCtx);
      expect(result.state).toBe("failed");
      expect(result.output).toBeUndefined();
    });

    it("invokes a different agent spec than analyze", async () => {
      const invoker = makeInvoker();
      const svc = new AnalystService(invoker as never);
      await svc.analyze({}, baseCtx);
      await svc.synthesizeQuickView({}, baseCtx);
      // 两次调用应针对不同的 agent 类（analyst vs quick-view-synthesizer）
      expect(invoker.invoke.mock.calls[0][0]).not.toBe(
        invoker.invoke.mock.calls[1][0],
      );
    });
  });
});
