/**
 * researcher.service.spec.ts
 */

import { ResearcherService } from "../researcher.service";
import type { InvocationContext } from "../agent-invoker.service";

const baseCtx: InvocationContext = {
  missionId: "m1",
  userId: "u1",
  agentId: "researcher#0",
  role: "researcher",
};

function makeInvoker(
  state: "completed" | "failed" | "cancelled" = "completed",
) {
  return {
    invoke: jest.fn().mockResolvedValue({
      state,
      output:
        state === "completed"
          ? {
              dimension: "Technology",
              findings: [
                {
                  claim: "AI is growing",
                  evidence: "paper",
                  source: "arxiv.org",
                },
              ],
              summary: "AI trends",
            }
          : undefined,
      events: [],
      iterations: 2,
      wallTimeMs: 1200,
    }),
    tickCost: jest.fn().mockResolvedValue(undefined),
  };
}

function makePool() {
  return {
    recordSpend: jest.fn(),
    snapshot: jest
      .fn()
      .mockReturnValue({ poolTokensUsed: 100, poolCostUsd: 0.0003 }),
  };
}

const baseArgs = {
  topic: "Artificial Intelligence",
  dimension: "Technology",
  language: "zh-CN" as const,
  ctx: baseCtx,
};

describe("ResearcherService", () => {
  it("calls invoker.invoke and returns completed result", async () => {
    const invoker = makeInvoker();
    const svc = new ResearcherService(invoker as never);
    const result = await svc.runDimension(baseArgs);
    expect(result.state).toBe("completed");
    expect(invoker.invoke).toHaveBeenCalledTimes(1);
  });

  it("returns output from invoker when completed", async () => {
    const invoker = makeInvoker();
    const svc = new ResearcherService(invoker as never);
    const result = await svc.runDimension(baseArgs);
    expect(result.output?.dimension).toBe("Technology");
    expect(result.output?.findings).toHaveLength(1);
  });

  it("maps failed state", async () => {
    const invoker = makeInvoker("failed");
    const svc = new ResearcherService(invoker as never);
    const result = await svc.runDimension(baseArgs);
    expect(result.state).toBe("failed");
    expect(result.output).toBeUndefined();
  });

  it("maps cancelled state", async () => {
    const invoker = makeInvoker("cancelled");
    const svc = new ResearcherService(invoker as never);
    const result = await svc.runDimension(baseArgs);
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
    const svc = new ResearcherService(invoker as never);
    const result = await svc.runDimension(baseArgs);
    expect(result.state).toBe("failed");
  });

  it("propagates events from invoker", async () => {
    const events = [
      { type: "thinking", payload: { text: "researching" }, timestamp: 1 },
    ];
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: { dimension: "Tech", findings: [], summary: "" },
      events,
      iterations: 1,
      wallTimeMs: 100,
    });
    const svc = new ResearcherService(invoker as never);
    const result = await svc.runDimension(baseArgs);
    expect(result.events).toBe(events);
  });

  it("propagates iterations and wallTimeMs", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: { dimension: "Tech", findings: [], summary: "" },
      events: [],
      iterations: 5,
      wallTimeMs: 3000,
    });
    const svc = new ResearcherService(invoker as never);
    const result = await svc.runDimension(baseArgs);
    expect(result.iterations).toBe(5);
    expect(result.wallTimeMs).toBe(3000);
  });

  it("calls tickCost when pool is provided", async () => {
    const invoker = makeInvoker();
    const pool = makePool();
    const svc = new ResearcherService(invoker as never);
    await svc.runDimension({ ...baseArgs, pool: pool as never });
    expect(invoker.tickCost).toHaveBeenCalledTimes(1);
    expect(invoker.tickCost).toHaveBeenCalledWith(
      "m1",
      "u1",
      "researchers",
      pool,
      expect.any(Number),
      expect.any(Array), // R2-#36: real events passed for costUsd extraction
    );
  });

  it("does not call tickCost when pool is not provided", async () => {
    const invoker = makeInvoker();
    const svc = new ResearcherService(invoker as never);
    await svc.runDimension(baseArgs);
    expect(invoker.tickCost).not.toHaveBeenCalled();
  });

  it("passes critique to invoker input when provided", async () => {
    const invoker = makeInvoker();
    const svc = new ResearcherService(invoker as never);
    await svc.runDimension({ ...baseArgs, critique: "Be more detailed" });
    const passedInput = invoker.invoke.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(passedInput.critique).toBe("Be more detailed");
  });

  it("passes topic, dimension, language to invoker input", async () => {
    const invoker = makeInvoker();
    const svc = new ResearcherService(invoker as never);
    await svc.runDimension(baseArgs);
    const passedInput = invoker.invoke.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(passedInput.topic).toBe("Artificial Intelligence");
    expect(passedInput.dimension).toBe("Technology");
    expect(passedInput.language).toBe("zh-CN");
  });

  it("passes ctx to invoker.invoke", async () => {
    const invoker = makeInvoker();
    const svc = new ResearcherService(invoker as never);
    await svc.runDimension(baseArgs);
    expect(invoker.invoke.mock.calls[0][2]).toBe(baseCtx);
  });

  it("throws when invoker.invoke rejects", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockRejectedValue(new Error("runner error"));
    const svc = new ResearcherService(invoker as never);
    await expect(svc.runDimension(baseArgs)).rejects.toThrow("runner error");
  });

  it("tickCost receives token count from action_executed events", async () => {
    const invoker = makeInvoker();
    const events = [
      { type: "action_executed", payload: { tokensUsed: 500 }, timestamp: 0 },
    ];
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: { dimension: "Tech", findings: [], summary: "" },
      events,
      iterations: 1,
      wallTimeMs: 100,
    });
    const pool = makePool();
    const svc = new ResearcherService(invoker as never);
    await svc.runDimension({ ...baseArgs, pool: pool as never });
    const tokenCount = invoker.tickCost.mock.calls[0][4];
    expect(tokenCount).toBe(500);
  });

  it("works with en-US language", async () => {
    const invoker = makeInvoker();
    const svc = new ResearcherService(invoker as never);
    const result = await svc.runDimension({ ...baseArgs, language: "en-US" });
    expect(result.state).toBe("completed");
  });

  it("tickCost uses budget_warning tokens when larger than action_executed total", async () => {
    const invoker = makeInvoker();
    const events = [
      { type: "action_executed", payload: { tokensUsed: 100 }, timestamp: 0 },
      { type: "budget_warning", payload: { tokensUsed: 800 }, timestamp: 0 },
    ];
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: { dimension: "Tech", findings: [], summary: "" },
      events,
      iterations: 1,
      wallTimeMs: 100,
    });
    const pool = makePool();
    const svc = new ResearcherService(invoker as never);
    await svc.runDimension({ ...baseArgs, pool: pool as never });
    // budget_warning(800) > action_executed(100) → tickCost called with 800
    const tokenCount = invoker.tickCost.mock.calls[0][4];
    expect(tokenCount).toBe(800);
  });
});
