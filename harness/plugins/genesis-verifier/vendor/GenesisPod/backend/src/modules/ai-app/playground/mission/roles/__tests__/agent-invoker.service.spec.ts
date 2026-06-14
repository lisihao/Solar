/**
 * agent-invoker.service.spec.ts
 *
 * Tests for AgentInvoker — the shared invoke/relay/billing/concurrency base.
 */

import { AgentInvoker } from "../agent-invoker.service";
import type { InvocationContext } from "../agent-invoker.service";

// ─── helper factories ─────────────────────────────────────────────────────────

function makeRunner() {
  return {
    run: jest.fn().mockResolvedValue({
      state: "completed",
      output: { result: "ok" },
      events: [],
      iterations: 1,
      wallTimeMs: 100,
    }),
  };
}

function makeEventBus() {
  return { emit: jest.fn().mockResolvedValue(undefined) };
}

function makeAbortRegistry(signal?: AbortSignal) {
  return { getSignal: jest.fn().mockReturnValue(signal) };
}

function makeFailureLearner() {
  return {
    lookup: jest.fn().mockResolvedValue([]),
    // E57: 权威阈值判定由 FailureLearnerService 自身 spec 覆盖；此处 mock 默认
    //   false（这些用例 lookup 返空，从不调用），具体场景在各自用例显式覆写。
    shouldAutoDisable: jest.fn().mockReturnValue(false),
  };
}

function makeBilling() {
  return { markModelDisabled: jest.fn() };
}

function makePool() {
  return {
    recordSpend: jest.fn(),
    snapshot: jest
      .fn()
      .mockReturnValue({ poolTokensUsed: 100, poolCostUsd: 0.0003 }),
    // ★ 业务链修2: tickCost 后立即检查 isExhausted，spec mock 必须实现
    isExhausted: jest.fn().mockReturnValue(false),
  };
}

const baseCtx: InvocationContext = {
  missionId: "m1",
  userId: "u1",
  agentId: "researcher#0",
  role: "researcher",
};

function makeSvc() {
  const runner = makeRunner();
  const eventBus = makeEventBus();
  const abortRegistry = makeAbortRegistry();
  const failureLearner = makeFailureLearner();
  const svc = new AgentInvoker(
    runner as never,
    eventBus as never,
    abortRegistry as never,
    failureLearner as never,
  );
  return { svc, runner, eventBus, abortRegistry, failureLearner };
}

// ─── invoke ───────────────────────────────────────────────────────────────────

describe("AgentInvoker.invoke", () => {
  it("delegates to runner.run and returns its result", async () => {
    const { svc, runner } = makeSvc();
    const fakeSpec = {} as never;
    const result = await svc.invoke(fakeSpec, { topic: "AI" }, baseCtx);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe("completed");
  });

  it("passes userId to runner.run", async () => {
    const { svc, runner } = makeSvc();
    await svc.invoke({} as never, {}, baseCtx);
    const opts = runner.run.mock.calls[0][2];
    expect(opts.userId).toBe("u1");
  });

  it("passes billingMeta with missionId and role", async () => {
    const { svc, runner } = makeSvc();
    await svc.invoke({} as never, {}, baseCtx);
    const opts = runner.run.mock.calls[0][2];
    expect(opts.billingMeta.referenceId).toBe("m1");
    expect(opts.billingMeta.operationType).toBe("researcher");
    expect(opts.billingMeta.moduleType).toBe("playground");
  });

  it("passes abort signal from registry", async () => {
    const controller = new AbortController();
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const abortRegistry = makeAbortRegistry(controller.signal);
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      abortRegistry as never,
      makeFailureLearner() as never,
    );
    await svc.invoke({} as never, {}, baseCtx);
    const opts = runner.run.mock.calls[0][2];
    expect(opts.signal).toBe(controller.signal);
  });

  it("passes envAdapter, budgetMultiplier, toolRecallHint, loopOverride", async () => {
    const { svc, runner } = makeSvc();
    const billing = makeBilling();
    const ctx: InvocationContext = {
      ...baseCtx,
      envAdapter: billing as never,
      budgetMultiplier: 1.5,
      toolRecallHint: { categories: ["web"] },
      loopOverride: "reflexion",
    };
    await svc.invoke({} as never, {}, ctx);
    const opts = runner.run.mock.calls[0][2];
    expect(opts.environment).toBe(billing);
    expect(opts.budgetMultiplier).toBe(1.5);
    expect(opts.toolRecallHint).toEqual({ categories: ["web"] });
    expect(opts.loopOverride).toBe("reflexion");
  });
});

// ─── emitEvent ────────────────────────────────────────────────────────────────

describe("AgentInvoker.emitEvent", () => {
  it("emits a domain event via eventBus", async () => {
    const { svc, eventBus } = makeSvc();
    await svc.emitEvent({
      type: "test:event",
      missionId: "m1",
      userId: "u1",
      payload: { x: 1 },
    });
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    const event = eventBus.emit.mock.calls[0][0];
    expect(event.type).toBe("test:event");
    expect(event.payload).toEqual({ x: 1 });
  });

  it("does not throw when eventBus.emit rejects", async () => {
    const runner = makeRunner();
    const eventBus = {
      emit: jest.fn().mockRejectedValue(new Error("bus down")),
    };
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
    );
    await expect(
      svc.emitEvent({ type: "x", missionId: "m1", userId: "u1", payload: {} }),
    ).resolves.toBeUndefined();
  });

  it("includes timestamp in emitted event", async () => {
    const { svc, eventBus } = makeSvc();
    const before = Date.now();
    await svc.emitEvent({
      type: "t",
      missionId: "m1",
      userId: "u1",
      payload: {},
    });
    const after = Date.now();
    const event = eventBus.emit.mock.calls[0][0];
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(after);
  });
});

// ─── emitLifecycle ────────────────────────────────────────────────────────────

describe("AgentInvoker.emitLifecycle", () => {
  it("emits agent:lifecycle event with correct fields", async () => {
    const { svc, eventBus } = makeSvc();
    await svc.emitLifecycle(
      "m1",
      "u1",
      "researcher#0",
      "researcher",
      "started",
    );
    const event = eventBus.emit.mock.calls[0][0];
    expect(event.type).toBe("playground.agent:lifecycle");
    expect(event.payload).toMatchObject({
      agentId: "researcher#0",
      role: "researcher",
      phase: "started",
    });
  });

  it("merges detail into payload", async () => {
    const { svc, eventBus } = makeSvc();
    await svc.emitLifecycle("m1", "u1", "a#0", "analyst", "completed", {
      wallTimeMs: 500,
    });
    const event = eventBus.emit.mock.calls[0][0];
    expect(event.payload).toMatchObject({ wallTimeMs: 500 });
  });
});

// ─── tickCost ─────────────────────────────────────────────────────────────────

describe("AgentInvoker.tickCost", () => {
  it("calls pool.recordSpend and emits cost:tick event", async () => {
    const { svc, eventBus } = makeSvc();
    const pool = makePool();
    await svc.tickCost("m1", "u1", "researchers", pool as never, 1000);
    expect(pool.recordSpend).toHaveBeenCalledTimes(1);
    const event = eventBus.emit.mock.calls[0][0];
    expect(event.type).toBe("playground.cost:tick");
    expect(event.payload).toMatchObject({
      stage: "researchers",
      deltaTokens: 1000,
    });
  });

  it("estimates USD from tokens at ~$3/1M", async () => {
    const { svc } = makeSvc();
    const pool = makePool();
    await svc.tickCost("m1", "u1", "researchers", pool as never, 1_000_000);
    expect(pool.recordSpend.mock.calls[0][2]).toBeCloseTo(3.0);
  });
});

// ─── resolveLoopOverride ──────────────────────────────────────────────────────

describe("AgentInvoker.resolveLoopOverride", () => {
  it("returns undefined for minimal auditLayers", () => {
    const { svc } = makeSvc();
    expect(svc.resolveLoopOverride("minimal", "analyst")).toBeUndefined();
  });

  it("returns undefined for standard auditLayers", () => {
    const { svc } = makeSvc();
    expect(svc.resolveLoopOverride("standard", "analyst")).toBeUndefined();
  });

  it("returns reflexion for thorough/analyst", () => {
    const { svc } = makeSvc();
    expect(svc.resolveLoopOverride("thorough", "analyst")).toBe("reflexion");
  });

  it("returns reflexion for paranoid/writer", () => {
    const { svc } = makeSvc();
    expect(svc.resolveLoopOverride("thorough+", "writer")).toBe("reflexion");
  });

  it("returns undefined for thorough/researcher (exception)", () => {
    const { svc } = makeSvc();
    expect(svc.resolveLoopOverride("thorough", "researcher")).toBeUndefined();
  });

  it("returns undefined for paranoid/reconciler (exception)", () => {
    const { svc } = makeSvc();
    expect(svc.resolveLoopOverride("thorough+", "reconciler")).toBeUndefined();
  });

  it("returns reflexion for thorough/leader", () => {
    const { svc } = makeSvc();
    expect(svc.resolveLoopOverride("thorough", "leader")).toBe("reflexion");
  });

  it("returns reflexion for paranoid/reviewer", () => {
    const { svc } = makeSvc();
    expect(svc.resolveLoopOverride("thorough+", "reviewer")).toBe("reflexion");
  });
});

// ─── preDisableKnownFailingModels ─────────────────────────────────────────────

describe("AgentInvoker.preDisableKnownFailingModels", () => {
  it("returns empty array when no known failures", async () => {
    const { svc } = makeSvc();
    const billing = makeBilling();
    const result = await svc.preDisableKnownFailingModels(
      billing as never,
      "researcher",
      "prompt-key",
    );
    expect(result).toEqual([]);
  });

  it("marks model disabled and returns record when count >= 2 with fallback", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const abortRegistry = makeAbortRegistry();
    const failureLearner = {
      lookup: jest.fn().mockResolvedValue([
        {
          modelId: "bad-model",
          failureCode: "PARSE_MALFORMED_JSON",
          count: 3,
          lastFallbackModel: "claude-3-sonnet",
          resolved: false,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
      ]),
      shouldAutoDisable: jest.fn().mockReturnValue(true),
    };
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      abortRegistry as never,
      failureLearner as never,
    );
    const billing = makeBilling();
    const result = await svc.preDisableKnownFailingModels(
      billing as never,
      "researcher",
      "prompt-key",
    );
    expect(billing.markModelDisabled).toHaveBeenCalledWith(
      "bad-model",
      "claude-3-sonnet",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      failed: "bad-model",
      fallback: "claude-3-sonnet",
    });
  });

  it("skips record with count < 2", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const abortRegistry = makeAbortRegistry();
    const failureLearner = {
      lookup: jest.fn().mockResolvedValue([
        {
          modelId: "new-model",
          count: 1,
          lastFallbackModel: "fallback",
          resolved: false,
        },
      ]),
      shouldAutoDisable: jest.fn().mockReturnValue(false),
    };
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      abortRegistry as never,
      failureLearner as never,
    );
    const billing = makeBilling();
    const result = await svc.preDisableKnownFailingModels(
      billing as never,
      "researcher",
      "p",
    );
    expect(billing.markModelDisabled).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("skips record with no lastFallbackModel", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const abortRegistry = makeAbortRegistry();
    const failureLearner = {
      lookup: jest.fn().mockResolvedValue([
        {
          modelId: "bad-model",
          count: 5,
          lastFallbackModel: undefined,
          resolved: false,
        },
      ]),
      shouldAutoDisable: jest.fn().mockReturnValue(true),
    };
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      abortRegistry as never,
      failureLearner as never,
    );
    const billing = makeBilling();
    const result = await svc.preDisableKnownFailingModels(
      billing as never,
      "researcher",
      "p",
    );
    expect(billing.markModelDisabled).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("returns empty array when failureLearner.lookup throws", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const abortRegistry = makeAbortRegistry();
    const failureLearner = {
      lookup: jest.fn().mockRejectedValue(new Error("DB error")),
    };
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      abortRegistry as never,
      failureLearner as never,
    );
    const billing = makeBilling();
    const result = await svc.preDisableKnownFailingModels(
      billing as never,
      "r",
      "p",
    );
    expect(result).toEqual([]);
  });
});

// ─── runDagConcurrency ────────────────────────────────────────────────────────

describe("AgentInvoker.runDagConcurrency", () => {
  it("processes independent items (no deps) in parallel", async () => {
    const { svc } = makeSvc();
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const results = await svc.runDagConcurrency(items, 3, async (it, i) => ({
      id: it.id,
      idx: i,
    }));
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("respects dependsOn ordering", async () => {
    const { svc } = makeSvc();
    const order: string[] = [];
    const items = [{ id: "b", dependsOn: ["a"] }, { id: "a" }];
    await svc.runDagConcurrency(items, 2, async (it) => {
      order.push(it.id);
      return it.id;
    });
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
  });

  it("returns results in items array order", async () => {
    const { svc } = makeSvc();
    const items = [{ id: "c", dependsOn: ["a"] }, { id: "a" }, { id: "b" }];
    const results = await svc.runDagConcurrency(items, 3, async (it) => it.id);
    // results indices match items array positions
    expect(results[0]).toBe("c");
    expect(results[1]).toBe("a");
    expect(results[2]).toBe("b");
  });

  it("falls back to flat when cycle detected", async () => {
    const { svc } = makeSvc();
    const items = [
      { id: "a", dependsOn: ["b"] },
      { id: "b", dependsOn: ["a"] },
    ];
    // Should not throw, should fall back to flat
    const results = await svc.runDagConcurrency(items, 2, async (it) => it.id);
    expect(results).toHaveLength(2);
    expect(results.sort()).toEqual(["a", "b"]);
  });

  it("handles empty items", async () => {
    const { svc } = makeSvc();
    const results = await svc.runDagConcurrency([], 2, async () => "x");
    expect(results).toEqual([]);
  });
});

// ─── relay events (via invoke onEvent) ───────────────────────────────────────

describe("AgentInvoker relay via invoke.onEvent", () => {
  it("relays thinking events as agent:thought", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
    );

    // Capture the onEvent callback
    let capturedOnEvent: ((ev: unknown) => Promise<void>) | undefined;
    runner.run.mockImplementation(
      async (
        _spec: unknown,
        _input: unknown,
        opts: { onEvent: (ev: unknown) => Promise<void> },
      ) => {
        capturedOnEvent = opts.onEvent;
        return {
          state: "completed",
          output: {},
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        };
      },
    );

    await svc.invoke({} as never, {}, baseCtx);

    // Now fire a thinking event
    await capturedOnEvent!({
      type: "thinking",
      payload: { text: "I am thinking", tokenCount: 50, modelId: "gpt-4o" },
      timestamp: 123,
    });

    const emitCalls = eventBus.emit.mock.calls;
    const thoughtCall = emitCalls.find(
      (c) => c[0].type === "playground.agent:thought",
    );
    expect(thoughtCall).toBeDefined();
    expect(thoughtCall![0].payload.text).toBe("I am thinking");
  });

  it("relays action_planned events as agent:action", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
    );

    let capturedOnEvent: ((ev: unknown) => Promise<void>) | undefined;
    runner.run.mockImplementation(
      async (
        _spec: unknown,
        _input: unknown,
        opts: { onEvent: (ev: unknown) => Promise<void> },
      ) => {
        capturedOnEvent = opts.onEvent;
        return {
          state: "completed",
          output: {},
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        };
      },
    );

    await svc.invoke({} as never, {}, baseCtx);
    await capturedOnEvent!({
      type: "action_planned",
      payload: { kind: "tool_call", toolId: "web_search" },
      timestamp: 0,
    });

    const actionCall = eventBus.emit.mock.calls.find(
      (c) => c[0].type === "playground.agent:action",
    );
    expect(actionCall).toBeDefined();
    expect(actionCall![0].payload.kind).toBe("tool_call");
    expect(actionCall![0].payload.toolId).toBe("web_search");
  });

  it("relays error events as agent:error", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
    );

    let capturedOnEvent: ((ev: unknown) => Promise<void>) | undefined;
    runner.run.mockImplementation(
      async (
        _spec: unknown,
        _input: unknown,
        opts: { onEvent: (ev: unknown) => Promise<void> },
      ) => {
        capturedOnEvent = opts.onEvent;
        return {
          state: "completed",
          output: {},
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        };
      },
    );

    await svc.invoke({} as never, {}, baseCtx);
    await capturedOnEvent!({
      type: "error",
      payload: { message: "something broke" },
      timestamp: 0,
    });

    const errCall = eventBus.emit.mock.calls.find(
      (c) => c[0].type === "playground.agent:error",
    );
    expect(errCall).toBeDefined();
    expect(errCall![0].payload.message).toBe("something broke");
  });

  it("relays action_executed events as agent:observation", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
    );

    let capturedOnEvent: ((ev: unknown) => Promise<void>) | undefined;
    runner.run.mockImplementation(
      async (
        _spec: unknown,
        _input: unknown,
        opts: { onEvent: (ev: unknown) => Promise<void> },
      ) => {
        capturedOnEvent = opts.onEvent;
        return {
          state: "completed",
          output: {},
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        };
      },
    );

    await svc.invoke({} as never, {}, baseCtx);
    await capturedOnEvent!({
      type: "action_executed",
      payload: {
        action: { kind: "tool_call", toolId: "web_search" },
        output: "result text",
        latencyMs: 300,
        tokensUsed: 50,
      },
      timestamp: 0,
    });

    const obsCall = eventBus.emit.mock.calls.find(
      (c) => c[0].type === "playground.agent:observation",
    );
    expect(obsCall).toBeDefined();
    expect(obsCall![0].payload.kind).toBe("tool_call");
    expect(obsCall![0].payload.latencyMs).toBe(300);
  });

  it("relays reflection events as agent:reflection", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
    );

    let capturedOnEvent: ((ev: unknown) => Promise<void>) | undefined;
    runner.run.mockImplementation(
      async (
        _spec: unknown,
        _input: unknown,
        opts: { onEvent: (ev: unknown) => Promise<void> },
      ) => {
        capturedOnEvent = opts.onEvent;
        return {
          state: "completed",
          output: {},
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        };
      },
    );

    await svc.invoke({} as never, {}, baseCtx);
    await capturedOnEvent!({
      type: "reflection",
      payload: { text: "I need to improve", verdict: "revise" },
      timestamp: 0,
    });

    const reflCall = eventBus.emit.mock.calls.find(
      (c) => c[0].type === "playground.agent:reflection",
    );
    expect(reflCall).toBeDefined();
    expect(reflCall![0].payload.verdict).toBe("revise");
  });

  it("relays tools_recalled events as tools:recalled", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
    );

    let capturedOnEvent: ((ev: unknown) => Promise<void>) | undefined;
    runner.run.mockImplementation(
      async (
        _spec: unknown,
        _input: unknown,
        opts: { onEvent: (ev: unknown) => Promise<void> },
      ) => {
        capturedOnEvent = opts.onEvent;
        return {
          state: "completed",
          output: {},
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        };
      },
    );

    await svc.invoke({} as never, {}, baseCtx);
    await capturedOnEvent!({
      type: "tools_recalled",
      payload: {
        recalledIds: ["web_search", "scraper"],
        categories: ["web"],
        source: "spec",
        preferIds: [],
      },
      timestamp: 0,
    });

    const toolsCall = eventBus.emit.mock.calls.find(
      (c) => c[0].type === "playground.tools:recalled",
    );
    expect(toolsCall).toBeDefined();
    expect(toolsCall![0].payload.recalledIds).toEqual([
      "web_search",
      "scraper",
    ]);
  });

  it("relays validation_failed events as agent:validation-rejected", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
    );

    let capturedOnEvent: ((ev: unknown) => Promise<void>) | undefined;
    runner.run.mockImplementation(
      async (
        _spec: unknown,
        _input: unknown,
        opts: { onEvent: (ev: unknown) => Promise<void> },
      ) => {
        capturedOnEvent = opts.onEvent;
        return {
          state: "completed",
          output: {},
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        };
      },
    );

    await svc.invoke({} as never, {}, baseCtx);
    await capturedOnEvent!({
      type: "validation_failed",
      payload: { rejectCount: 2, maxRejects: 3, issues: "schema mismatch" },
      timestamp: 0,
    });

    const valCall = eventBus.emit.mock.calls.find(
      (c) => c[0].type === "playground.agent:validation-rejected",
    );
    expect(valCall).toBeDefined();
    expect(valCall![0].payload.rejectCount).toBe(2);
    expect(valCall![0].payload.issues).toBe("schema mismatch");
  });

  it("ignores unknown event types without emitting", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
    );

    let capturedOnEvent: ((ev: unknown) => Promise<void>) | undefined;
    runner.run.mockImplementation(
      async (
        _spec: unknown,
        _input: unknown,
        opts: { onEvent: (ev: unknown) => Promise<void> },
      ) => {
        capturedOnEvent = opts.onEvent;
        return {
          state: "completed",
          output: {},
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        };
      },
    );

    await svc.invoke({} as never, {}, baseCtx);
    const emitsBefore = eventBus.emit.mock.calls.length;
    await capturedOnEvent!({
      type: "unknown_event_type",
      payload: {},
      timestamp: 0,
    });
    // No additional emit for unknown event types
    expect(eventBus.emit.mock.calls.length).toBe(emitsBefore);
  });

  it("iteration_progress event → emits iteration:progress", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
    );

    let capturedOnEvent: ((ev: unknown) => Promise<void>) | undefined;
    runner.run.mockImplementation(
      async (
        _spec: unknown,
        _input: unknown,
        opts: { onEvent: (ev: unknown) => Promise<void> },
      ) => {
        capturedOnEvent = opts.onEvent;
        return {
          state: "completed",
          output: {},
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        };
      },
    );

    await svc.invoke({} as never, {}, baseCtx);
    await capturedOnEvent!({
      type: "iteration_progress",
      payload: {
        iteration: 5,
        maxIterations: 15,
        progress: 0.33,
        approachingLimit: false,
        lastActionKind: "tool_call",
      },
      timestamp: Date.now(),
    });

    const progressCall = eventBus.emit.mock.calls.find(
      (c) => c[0].type === "playground.iteration:progress",
    );
    expect(progressCall).toBeDefined();
    expect(progressCall![0].payload.iteration).toBe(5);
  });

  it("truncatePayload: large JSON object > 32000 chars → _truncated preview", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
    );

    let capturedOnEvent: ((ev: unknown) => Promise<void>) | undefined;
    runner.run.mockImplementation(
      async (
        _spec: unknown,
        _input: unknown,
        opts: { onEvent: (ev: unknown) => Promise<void> },
      ) => {
        capturedOnEvent = opts.onEvent;
        return {
          state: "completed",
          output: {},
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        };
      },
    );

    await svc.invoke({} as never, {}, baseCtx);
    const largeOutput = { data: "x".repeat(35_000) };
    await capturedOnEvent!({
      type: "action_executed",
      payload: {
        action: { kind: "tool_call", toolId: "scraper" },
        output: largeOutput,
        latencyMs: 100,
      },
      timestamp: Date.now(),
    });

    const obsCall = eventBus.emit.mock.calls.find(
      (c) => c[0].type === "playground.agent:observation",
    );
    expect(obsCall).toBeDefined();
    expect(
      (obsCall![0].payload.output as { _truncated?: boolean })._truncated,
    ).toBe(true);
  });

  it("truncatePayload: circular reference object → String(payload) branch", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
    );

    let capturedOnEvent: ((ev: unknown) => Promise<void>) | undefined;
    runner.run.mockImplementation(
      async (
        _spec: unknown,
        _input: unknown,
        opts: { onEvent: (ev: unknown) => Promise<void> },
      ) => {
        capturedOnEvent = opts.onEvent;
        return {
          state: "completed",
          output: {},
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        };
      },
    );

    await svc.invoke({} as never, {}, baseCtx);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await capturedOnEvent!({
      type: "action_executed",
      payload: {
        action: { kind: "tool_call", toolId: "scraper" },
        output: circular,
        latencyMs: 50,
      },
      timestamp: Date.now(),
    });

    const obsCall = eventBus.emit.mock.calls.find(
      (c) => c[0].type === "playground.agent:observation",
    );
    expect(obsCall).toBeDefined();
    expect(typeof obsCall![0].payload.output).toBe("string");
  });

  it("emitEvent with critical type + eventBus throws → logs warn (line 164)", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      makeAbortRegistry() as never,
      makeFailureLearner() as never,
    );

    // Make eventBus.emit throw for the next call
    eventBus.emit.mockRejectedValueOnce(new Error("bus error"));

    // emitEvent with a type containing "lifecycle" → isCritical = true
    await svc.emitEvent({
      type: "playground.lifecycle:test",
      missionId: "m1",
      userId: "u1",
      payload: {},
    });

    // Should not throw, but should log a warn
    expect(eventBus.emit).toHaveBeenCalled();
  });
});

// ─── R2-#46: invoke retry + degradation ──────────────────────────────────────

describe("AgentInvoker.invoke — R2-#46 retry + degradation", () => {
  it("retries on transient error and succeeds on second attempt", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const abortRegistry = makeAbortRegistry();
    const failureLearner = makeFailureLearner();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      abortRegistry as never,
      failureLearner as never,
    );

    // First call throws a transient error (network failure), second succeeds
    runner.run
      .mockRejectedValueOnce(new Error("network timeout — ECONNRESET"))
      .mockResolvedValueOnce({
        state: "completed",
        output: { result: "ok" },
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      });

    const result = await svc.invoke({} as never, {}, baseCtx);
    expect(result.state).toBe("completed");
    expect(runner.run).toHaveBeenCalledTimes(2);
    // no degraded event emitted (succeeded before exhausting retries)
    const degradedCall = eventBus.emit.mock.calls.find(
      (c) => c[0].type === "playground.stage:degraded",
    );
    expect(degradedCall).toBeUndefined();
  });

  it("permanently-failing role: exhausts retries, emits degraded event, then throws", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const abortRegistry = makeAbortRegistry();
    const failureLearner = makeFailureLearner();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      abortRegistry as never,
      failureLearner as never,
    );

    // All 3 attempts (1 + 2 retries) throw a transient error → degraded after exhausting
    const transientErr = new Error("503 Service Unavailable");
    runner.run.mockRejectedValue(transientErr);

    await expect(svc.invoke({} as never, {}, baseCtx)).rejects.toThrow(
      transientErr,
    );
    // 1 original + 2 retries = 3 total
    expect(runner.run).toHaveBeenCalledTimes(3);
    // degraded event must be emitted
    const degradedCall = eventBus.emit.mock.calls.find(
      (c) => c[0].type === "playground.stage:degraded",
    );
    expect(degradedCall).toBeDefined();
    expect(degradedCall![0].payload.transient).toBe(true);
    expect(degradedCall![0].payload.attempts).toBe(3);
    expect(degradedCall![0].payload.role).toBe("researcher");
  });

  it("permanent (non-transient) error: does not retry, emits degraded immediately, then throws", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const abortRegistry = makeAbortRegistry();
    const failureLearner = makeFailureLearner();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      abortRegistry as never,
      failureLearner as never,
    );

    // context_length_exceeded is a non-retryable error
    const permanentErr = new Error("context_length_exceeded: token limit hit");
    runner.run.mockRejectedValue(permanentErr);

    await expect(svc.invoke({} as never, {}, baseCtx)).rejects.toThrow(
      permanentErr,
    );
    // Non-transient: only 1 attempt, no retry
    expect(runner.run).toHaveBeenCalledTimes(1);
    // degraded event still emitted (non-transient=false)
    const degradedCall = eventBus.emit.mock.calls.find(
      (c) => c[0].type === "playground.stage:degraded",
    );
    expect(degradedCall).toBeDefined();
    expect(degradedCall![0].payload.transient).toBe(false);
    expect(degradedCall![0].payload.attempts).toBe(1);
  });

  it("aborted signal skips retry immediately", async () => {
    const controller = new AbortController();
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const abortRegistry = makeAbortRegistry(controller.signal);
    const failureLearner = makeFailureLearner();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      abortRegistry as never,
      failureLearner as never,
    );

    // Abort before the invocation throws
    controller.abort();
    const transientErr = new Error("network timeout — ECONNRESET");
    runner.run.mockRejectedValue(transientErr);

    await expect(svc.invoke({} as never, {}, baseCtx)).rejects.toThrow(
      transientErr,
    );
    // Aborted: only 1 attempt despite transient error
    expect(runner.run).toHaveBeenCalledTimes(1);
  });
});

// ─── clearMissionRelayState ───────────────────────────────────────────────────

describe("AgentInvoker.clearMissionRelayState", () => {
  it("does not throw for an unknown missionId", () => {
    const { svc } = makeSvc();
    expect(() => svc.clearMissionRelayState("nonexistent")).not.toThrow();
  });

  it("clears exhaustedMissions entry so relay no longer considers it exhausted", async () => {
    const runner = makeRunner();
    const eventBus = makeEventBus();
    const abortRegistry = makeAbortRegistry();
    const svc = new AgentInvoker(
      runner as never,
      eventBus as never,
      abortRegistry as never,
      makeFailureLearner() as never,
    );
    // First call: should not throw
    expect(() => svc.clearMissionRelayState("mission-abc")).not.toThrow();
    // Idempotent: calling again is safe
    expect(() => svc.clearMissionRelayState("mission-abc")).not.toThrow();
  });
});
