/**
 * reconciler.service.spec.ts
 */

import { ReconcilerService } from "../reconciler.service";
import type { InvocationContext } from "../agent-invoker.service";

const baseCtx: InvocationContext = {
  missionId: "m1",
  userId: "u1",
  agentId: "reconciler#0",
  role: "reconciler",
};

const baseInput = {
  topic: "AI",
  language: "zh-CN" as const,
  plan: {
    themeSummary: "AI trends",
    dimensions: [{ id: "d1", name: "Technology", rationale: "core" }],
  },
  researcherResults: [
    {
      dimension: "Technology",
      findings: [
        { claim: "GPT is big", evidence: "paper", source: "arxiv.org" },
      ],
      summary: "AI is evolving",
    },
  ],
};

function makeInvoker(overrides: Partial<ReturnType<typeof makeInvoker>> = {}) {
  return {
    invoke: jest.fn().mockResolvedValue({
      state: "completed",
      output: {
        factTable: [],
        conflicts: [],
        overlaps: [],
        gaps: [],
        figureCandidates: [],
        reconciliationReport: "All reconciled",
      },
      events: [],
      iterations: 1,
      wallTimeMs: 500,
    }),
    ...overrides,
  };
}

describe("ReconcilerService", () => {
  it("calls invoker.invoke and returns completed result", async () => {
    const invoker = makeInvoker();
    const svc = new ReconcilerService(invoker as never);
    const result = await svc.reconcile(baseInput, baseCtx);
    expect(result.state).toBe("completed");
    expect(invoker.invoke).toHaveBeenCalledTimes(1);
  });

  it("returns output from invoker", async () => {
    const invoker = makeInvoker();
    const svc = new ReconcilerService(invoker as never);
    const result = await svc.reconcile(baseInput, baseCtx);
    expect(result.output).toMatchObject({
      reconciliationReport: "All reconciled",
    });
  });

  it("maps failed state correctly", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "failed",
      output: undefined,
      events: [],
      iterations: 2,
      wallTimeMs: 1000,
    });
    const svc = new ReconcilerService(invoker as never);
    const result = await svc.reconcile(baseInput, baseCtx);
    expect(result.state).toBe("failed");
    expect(result.output).toBeUndefined();
  });

  it("maps cancelled state correctly", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "cancelled",
      output: undefined,
      events: [],
      iterations: 0,
      wallTimeMs: 0,
    });
    const svc = new ReconcilerService(invoker as never);
    const result = await svc.reconcile(baseInput, baseCtx);
    expect(result.state).toBe("cancelled");
  });

  it("propagates events from invoker", async () => {
    const events = [
      { type: "thinking", payload: { text: "thinking" }, timestamp: 1 },
    ];
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: {
        factTable: [],
        conflicts: [],
        overlaps: [],
        gaps: [],
        figureCandidates: [],
        reconciliationReport: "ok",
      },
      events,
      iterations: 1,
      wallTimeMs: 100,
    });
    const svc = new ReconcilerService(invoker as never);
    const result = await svc.reconcile(baseInput, baseCtx);
    expect(result.events).toBe(events);
  });

  it("propagates iterations and wallTimeMs", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: {},
      events: [],
      iterations: 5,
      wallTimeMs: 3000,
    });
    const svc = new ReconcilerService(invoker as never);
    const result = await svc.reconcile(baseInput, baseCtx);
    expect(result.iterations).toBe(5);
    expect(result.wallTimeMs).toBe(3000);
  });

  it("throws when invoker.invoke rejects", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockRejectedValue(new Error("runner crashed"));
    const svc = new ReconcilerService(invoker as never);
    await expect(svc.reconcile(baseInput, baseCtx)).rejects.toThrow(
      "runner crashed",
    );
  });

  it("passes the input directly to invoker.invoke", async () => {
    const invoker = makeInvoker();
    const svc = new ReconcilerService(invoker as never);
    await svc.reconcile(baseInput, baseCtx);
    expect(invoker.invoke.mock.calls[0][1]).toBe(baseInput);
  });

  it("passes ctx to invoker.invoke", async () => {
    const invoker = makeInvoker();
    const svc = new ReconcilerService(invoker as never);
    await svc.reconcile(baseInput, baseCtx);
    expect(invoker.invoke.mock.calls[0][2]).toBe(baseCtx);
  });

  it("returns empty events array when invoker returns empty events", async () => {
    const invoker = makeInvoker();
    invoker.invoke.mockResolvedValue({
      state: "completed",
      output: {},
      events: [],
      iterations: 1,
      wallTimeMs: 100,
    });
    const svc = new ReconcilerService(invoker as never);
    const result = await svc.reconcile(baseInput, baseCtx);
    expect(result.events).toHaveLength(0);
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
    const svc = new ReconcilerService(invoker as never);
    const result = await svc.reconcile(baseInput, baseCtx);
    expect(result.state).toBe("failed");
  });
});
