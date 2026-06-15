import { EventRelayFramework } from "../event-relay.framework";
import { MissionBudgetPool } from "@/modules/ai-harness/guardrails/budget/mission-budget-pool";
import type { EventBus } from "@/common/events/domain-event-bus";
import type { MissionAbortRegistry } from "@/modules/ai-harness/facade";
import type { IAgentEvent } from "@/modules/ai-harness/facade";

function makeBus() {
  return {
    emit: jest.fn().mockResolvedValue(undefined),
  } as unknown as EventBus;
}

function makeRegistry() {
  return { abort: jest.fn() } as unknown as MissionAbortRegistry;
}

function makePool(maxTokens = 1_000_000) {
  return new MissionBudgetPool({ maxTokens, maxCostUsd: 100 });
}

const CTX = {
  missionId: "m1",
  userId: "u1",
  agentId: "a1",
  role: "researcher",
};

describe("EventRelayFramework", () => {
  describe("emitEvent", () => {
    it("emits with namespace-prefixed type", async () => {
      const bus = makeBus();
      const relay = new EventRelayFramework(bus, "my-ns");
      await relay.emitEvent({
        type: "my-ns.cost:tick",
        missionId: "m1",
        userId: "u1",
        payload: { x: 1 },
      });
      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "my-ns.cost:tick" }),
      );
    });

    it("swallows non-critical emit errors silently", async () => {
      const bus = {
        emit: jest.fn().mockRejectedValue(new Error("bus down")),
      } as unknown as EventBus;
      const relay = new EventRelayFramework(bus, "my-ns");
      await expect(
        relay.emitEvent({
          type: "my-ns.other",
          missionId: "m1",
          userId: "u1",
          payload: {},
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("tickCost", () => {
    it("emits cost:tick with correct payload", async () => {
      const bus = makeBus();
      const relay = new EventRelayFramework(bus, "my-ns");
      const pool = makePool();
      await relay.tickCost("m1", "u1", "stage-1", pool, 1000);
      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "my-ns.cost:tick",
          payload: expect.objectContaining({
            stage: "stage-1",
            deltaTokens: 1000,
          }),
        }),
      );
    });

    it("emits budget:exhausted + calls abort on first exhaustion", async () => {
      const bus = makeBus();
      const registry = makeRegistry();
      const relay = new EventRelayFramework(bus, "my-ns");
      relay.setAbortRegistry(registry);
      const pool = makePool(100);

      // spend enough to exhaust pool (maxTokens=100)
      await relay.tickCost("m1", "u1", "stage-1", pool, 200);

      const calls = (bus.emit as jest.Mock).mock.calls.map(
        (c: [{ type: string }]) => c[0].type,
      );
      expect(calls).toContain("my-ns.cost:tick");
      expect(calls).toContain("my-ns.budget:exhausted");
      expect(registry.abort).toHaveBeenCalledWith("m1", "budget_exhausted");
    });

    it("does NOT emit budget:exhausted twice for same mission", async () => {
      const bus = makeBus();
      const relay = new EventRelayFramework(bus, "my-ns");
      relay.setAbortRegistry(makeRegistry());
      const pool = makePool(100);

      await relay.tickCost("m1", "u1", "s", pool, 200);
      await relay.tickCost("m1", "u1", "s", pool, 200);

      const exhausted = (bus.emit as jest.Mock).mock.calls.filter(
        (c: [{ type: string }]) => c[0].type === "my-ns.budget:exhausted",
      );
      expect(exhausted).toHaveLength(1);
    });

    it("clearMission resets exhaustion guard so second exhaustion emits again", async () => {
      const bus = makeBus();
      const relay = new EventRelayFramework(bus, "my-ns");
      relay.setAbortRegistry(makeRegistry());
      const pool = makePool(100);

      await relay.tickCost("m1", "u1", "s", pool, 200);
      relay.clearMission("m1");
      await relay.tickCost("m1", "u1", "s", pool, 200);

      const exhausted = (bus.emit as jest.Mock).mock.calls.filter(
        (c: [{ type: string }]) => c[0].type === "my-ns.budget:exhausted",
      );
      expect(exhausted).toHaveLength(2);
    });
  });

  describe("relayAgentEvents — 8 IAgentEvent branches", () => {
    async function relayOne(ev: IAgentEvent) {
      const bus = makeBus();
      const relay = new EventRelayFramework(bus, "ns");
      await relay.relayAgentEvents([ev], CTX);
      return (bus.emit as jest.Mock).mock.calls.map(
        (c: [{ type: string; payload: unknown }]) => c[0],
      );
    }

    it("thinking → ns.agent:thought", async () => {
      const events = await relayOne({
        type: "thinking",
        payload: { text: "hello", tokenCount: 5, modelId: "m" },
        timestamp: 1000,
      });
      expect(events[0].type).toBe("ns.agent:thought");
      expect((events[0].payload as Record<string, unknown>)["text"]).toBe(
        "hello",
      );
    });

    it("action_planned → ns.agent:action", async () => {
      const events = await relayOne({
        type: "action_planned",
        payload: { kind: "tool", toolId: "web_search", input: {} },
        timestamp: 1000,
      });
      expect(events[0].type).toBe("ns.agent:action");
      expect((events[0].payload as Record<string, unknown>)["kind"]).toBe(
        "tool",
      );
    });

    it("action_executed → ns.agent:observation", async () => {
      const events = await relayOne({
        type: "action_executed",
        payload: {
          action: { kind: "tool", toolId: "web_search" },
          output: "result",
          latencyMs: 200,
          tokensUsed: 50,
        },
        timestamp: 1000,
      });
      expect(events[0].type).toBe("ns.agent:observation");
      expect((events[0].payload as Record<string, unknown>)["output"]).toBe(
        "result",
      );
    });

    // ★ Screenshot_47 / #91 regression: parallel_tool_call 必须扇出成 N 个独立
    //   observation，每个携带 sub.toolId + sub.latencyMs，否则前端 buildToolStats
    //   看 toolId=undefined 跳过 → 5+ 工具行 callCount 全归零、"无观测"。
    it("parallel_tool_call action_executed → N separate observations", async () => {
      const events = await relayOne({
        type: "action_executed",
        payload: {
          action: { kind: "parallel_tool_call", toolId: undefined },
          output: undefined,
          latencyMs: 500,
          subResults: [
            {
              action: { kind: "tool_call", toolId: "web-search" },
              output: "result-1",
              latencyMs: 200,
              tokensUsed: 50,
            },
            {
              action: { kind: "tool_call", toolId: "arxiv-search" },
              output: "result-2",
              latencyMs: 300,
              tokensUsed: 75,
            },
            {
              action: { kind: "tool_call", toolId: "industry-report-search" },
              output: undefined,
              error: { message: "timeout" },
              latencyMs: 50,
            },
          ],
        },
        timestamp: 1000,
      });
      // 3 个 sub-result → 3 个 agent:observation event
      expect(events).toHaveLength(3);
      events.forEach((ev) => {
        expect(ev.type).toBe("ns.agent:observation");
      });
      // 各 sub 携带独立 toolId + latencyMs
      const payloads = events.map(
        (ev) => ev.payload as Record<string, unknown>,
      );
      expect(payloads[0].toolId).toBe("web-search");
      expect(payloads[0].latencyMs).toBe(200);
      expect(payloads[0].tokensUsed).toBe(50);
      expect(payloads[1].toolId).toBe("arxiv-search");
      expect(payloads[1].latencyMs).toBe(300);
      expect(payloads[2].toolId).toBe("industry-report-search");
      expect(payloads[2].error).toBe("timeout");
      // originalTs 微调避免 timestamp 撞车 (projector dedupe key)
      const tsArr = payloads.map((p) => p.originalTs as number);
      expect(new Set(tsArr).size).toBe(3);
    });

    it("parallel_tool_call without subResults → single observation (fallback)", async () => {
      const events = await relayOne({
        type: "action_executed",
        payload: {
          action: { kind: "parallel_tool_call", toolId: undefined },
          output: undefined,
          latencyMs: 500,
          // subResults absent → 退化路径走单 event
        },
        timestamp: 1000,
      });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("ns.agent:observation");
    });

    it("reflection → ns.agent:reflection", async () => {
      const events = await relayOne({
        type: "reflection",
        payload: { revision: 1, score: 0.8, text: "looks good" },
        timestamp: 1000,
      });
      expect(events[0].type).toBe("ns.agent:reflection");
      expect((events[0].payload as Record<string, unknown>)["score"]).toBe(0.8);
    });

    it("error → ns.agent:error", async () => {
      const events = await relayOne({
        type: "error",
        payload: { message: "oops" },
        timestamp: 1000,
      });
      expect(events[0].type).toBe("ns.agent:error");
      expect((events[0].payload as Record<string, unknown>)["message"]).toBe(
        "oops",
      );
    });

    it("tools_recalled → ns.tools:recalled", async () => {
      const events = await relayOne({
        type: "tools_recalled",
        payload: { recalledIds: ["t1"], categories: ["web"], source: "spec" },
        timestamp: 1000,
      });
      expect(events[0].type).toBe("ns.tools:recalled");
    });

    it("iteration_progress → ns.iteration:progress", async () => {
      const events = await relayOne({
        type: "iteration_progress",
        payload: { iteration: 3, maxIterations: 10, progress: 0.3 },
        timestamp: 1000,
      });
      expect(events[0].type).toBe("ns.iteration:progress");
      expect((events[0].payload as Record<string, unknown>)["iteration"]).toBe(
        3,
      );
    });

    it("validation_failed → ns.agent:validation-rejected", async () => {
      const events = await relayOne({
        type: "validation_failed",
        payload: { rejectCount: 2, maxRejects: 3, issues: "too short" },
        timestamp: 1000,
      });
      expect(events[0].type).toBe("ns.agent:validation-rejected");
      expect(
        (events[0].payload as Record<string, unknown>)["rejectCount"],
      ).toBe(2);
    });

    it("unknown event type → no emit", async () => {
      const bus = makeBus();
      const relay = new EventRelayFramework(bus, "ns");
      await relay.relayAgentEvents(
        [{ type: "unknown_future_type" as never, payload: {}, timestamp: 0 }],
        CTX,
      );
      expect(bus.emit).not.toHaveBeenCalled();
    });
  });

  describe("truncatePayload (via action_executed output)", () => {
    async function getObservationOutput(output: unknown) {
      const bus = makeBus();
      const relay = new EventRelayFramework(bus, "ns");
      await relay.relayAgentEvents(
        [
          {
            type: "action_executed",
            payload: {
              action: { kind: "tool" },
              output,
              latencyMs: 1,
            },
            timestamp: 0,
          },
        ],
        CTX,
      );
      const emitted = (bus.emit as jest.Mock).mock.calls[0][0] as {
        payload: Record<string, unknown>;
      };
      return emitted.payload["output"];
    }

    it("short string passes through unchanged", async () => {
      const r = await getObservationOutput("hello");
      expect(r).toBe("hello");
    });

    it("string > 8000 chars is truncated with ...", async () => {
      const long = "x".repeat(9000);
      const r = await getObservationOutput(long);
      expect(typeof r).toBe("string");
      expect((r as string).length).toBeLessThanOrEqual(8004);
      expect((r as string).endsWith("...")).toBe(true);
    });

    it("small object passes through unchanged", async () => {
      const obj = { a: 1, b: "hello" };
      const r = await getObservationOutput(obj);
      expect(r).toEqual(obj);
    });

    it("large object with results array → truncated to first 10 results", async () => {
      const results = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        data: "x".repeat(1000),
      }));
      const bigObj = { results, meta: "test" };
      const r = (await getObservationOutput(bigObj)) as Record<string, unknown>;
      expect(Array.isArray(r["results"])).toBe(true);
      expect((r["results"] as unknown[]).length).toBe(10);
      expect(r["_resultsTruncated"]).toBe(true);
      expect(r["_originalResultsCount"]).toBe(50);
    });

    it("null payload passes through as null", async () => {
      const r = await getObservationOutput(null);
      expect(r).toBeNull();
    });
  });

  describe("emitLifecycle", () => {
    it("emits agent:lifecycle with phase", async () => {
      const bus = makeBus();
      const relay = new EventRelayFramework(bus, "ns");
      await relay.emitLifecycle("m1", "u1", "a1", "researcher", "started");
      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ns.agent:lifecycle",
          payload: expect.objectContaining({ phase: "started" }),
        }),
      );
    });
  });
});
