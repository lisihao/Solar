/**
 * relayAgentEvent / bridgeMissionEvent 富化回归 spec（2026-06-10 回归审计
 * #1/#2/#5/#7/#8/#9/#14 + fixPlan WF-1/WF-7）。
 *
 * 锁定的契约：
 *   1. output 走 truncatePayload 语义——对象 ≤32K 保形深等透传（不再
 *      JSON.stringify+slice(500) 摧毁结构），超限 results[] 裁前 10 条；
 *   2. parallel_tool_call subResults 逐 sub 扇出独立 agent-trace 事件，
 *      每条携带非空 toolId + number latencyMs（+ input/output/tokensUsed/error）；
 *   3. action_planned 透传 calls[]；thinking 透传 modelId；补 reflection case；
 *   4. text 语义化（含 query 摘要），废除 "Action executed" 兜底；
 *   5. mission:completed 桥发终态统计（costUsd/tokensUsed/elapsedWallTimeMs/
 *      reviewScore/leaderSigned/verifierVerdicts/missionTitle）；
 *      mission:started 桥发 topic + 档位；stage:stalled/degraded 透传 reason/elapsedMs。
 */
import { DeepInsightDefaultRunner } from "../deep-insight.runner";
import { CrossStageState } from "../runner-deps";
import { CS_KEY } from "../pipeline/ports";
import type {
  CapabilityRunContext,
  CapabilityRunEvent,
} from "../../../capability";

type RunnerPrivate = {
  relayAgentEvent(
    ctx: CapabilityRunContext,
    stepId: string,
    role: string,
    dimension: string | undefined,
    ev: {
      type: string;
      agentId: string;
      timestamp?: number;
      payload?: unknown;
    },
  ): void;
  bridgeMissionEvent(
    ctx: CapabilityRunContext,
    persistence: unknown,
    crossStageState: CrossStageState,
    ev: Record<string, unknown>,
    topic: string,
    input: Record<string, unknown>,
    pushBuffered?: (type: string) => void,
  ): void;
};

function makeRunner(): RunnerPrivate {
  // 仅触达 relayAgentEvent / bridgeMissionEvent（不跑 run()/onModuleInit），
  // 构造依赖全部用空 stub（bindings 构造函数只存引用）。
  const stub = {} as never;
  return new DeepInsightDefaultRunner(
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
  ) as unknown as RunnerPrivate;
}

function collectCtx(): {
  ctx: CapabilityRunContext;
  events: CapabilityRunEvent[];
} {
  const events: CapabilityRunEvent[] = [];
  const ctx = {
    userId: "u1",
    missionId: "m1",
    onEvent: (e: CapabilityRunEvent) => {
      events.push(e);
    },
  } as CapabilityRunContext;
  return { ctx, events };
}

describe("DeepInsightDefaultRunner.relayAgentEvent", () => {
  it("parallel_tool_call 3 subResults → 3 条独立 trace，各含非空 toolId + number latencyMs + 保形 output", () => {
    const runner = makeRunner();
    const { ctx, events } = collectCtx();
    const subOutput = (i: number) => ({
      results: [{ title: `t${i}`, url: `https://e.com/${i}` }],
    });
    runner.relayAgentEvent(
      ctx,
      "s3-researcher-collect",
      "researcher",
      "维度A",
      {
        type: "action_executed",
        agentId: "playground.researcher",
        timestamp: 1000,
        payload: {
          action: { kind: "parallel_tool_call", calls: [] },
          output: "aggregate-blob",
          latencyMs: 999,
          subResults: [0, 1, 2].map((i) => ({
            action: {
              kind: "tool_call",
              toolId: `web-search-${i}`,
              input: { query: `q${i}` },
            },
            output: subOutput(i),
            latencyMs: 100 + i,
            tokensUsed: 10 + i,
          })),
        },
      },
    );

    expect(events).toHaveLength(3);
    events.forEach((e, i) => {
      expect(e.type).toBe("agent-trace");
      const p = e.payload as Record<string, unknown>;
      expect(p.kind).toBe("action_executed");
      expect(typeof p.toolId).toBe("string");
      expect((p.toolId as string).length).toBeGreaterThan(0);
      expect(typeof p.latencyMs).toBe("number");
      expect(p.latencyMs).toBe(100 + i);
      expect(p.tokensUsed).toBe(10 + i);
      // 保形：output 不是转义字符串而是原对象（深等）
      expect(p.output).toEqual(subOutput(i));
      expect(p.input).toEqual({ query: `q${i}` });
      // text 语义化（含 query），不是 "Action executed"
      expect(p.text).toContain(`q${i}`);
      // 同 batch 时序微调（毫秒序号）
      expect(e.timestamp).toBe(1000 + i * 0.001);
    });
  });

  it("单工具 action_executed：≤32K 对象 output 保形深等透传 + error 透传", () => {
    const runner = makeRunner();
    const { ctx, events } = collectCtx();
    const output = {
      results: Array.from({ length: 5 }, (_, i) => ({
        title: `标题${i}`,
        snippet: "内容",
      })),
    };
    runner.relayAgentEvent(
      ctx,
      "s3-researcher-collect",
      "researcher",
      undefined,
      {
        type: "action_executed",
        agentId: "playground.researcher",
        timestamp: 2000,
        payload: {
          action: {
            kind: "tool_call",
            toolId: "web-search",
            input: { query: "AMD 财报" },
          },
          output,
          error: { message: "rate limited" },
          latencyMs: 50,
        },
      },
    );
    expect(events).toHaveLength(1);
    const p = events[0].payload as Record<string, unknown>;
    expect(p.output).toEqual(output);
    expect(p.output).not.toEqual(expect.any(String));
    expect(p.error).toBe("rate limited");
    expect(p.text).toContain("失败");
    expect(p.text).toContain("AMD 财报");
  });

  it("超 32K 且有 results[] 的 output → 结构化裁前 10 条（truncatePayload 语义）", () => {
    const runner = makeRunner();
    const { ctx, events } = collectCtx();
    const big = "x".repeat(3000);
    const output = {
      results: Array.from({ length: 20 }, (_, i) => ({
        title: `t${i}`,
        body: big,
      })),
    };
    runner.relayAgentEvent(
      ctx,
      "s3-researcher-collect",
      "researcher",
      undefined,
      {
        type: "action_executed",
        agentId: "playground.researcher",
        payload: {
          action: { kind: "tool_call", toolId: "web-search", input: {} },
          output,
          latencyMs: 1,
        },
      },
    );
    const out = (events[0].payload as Record<string, unknown>).output as {
      results: unknown[];
      _resultsTruncated: boolean;
      _originalResultsCount: number;
    };
    expect(out.results).toHaveLength(10);
    expect(out._resultsTruncated).toBe(true);
    expect(out._originalResultsCount).toBe(20);
  });

  it("thinking 透传 modelId；action_planned 透传 calls[] 且 text 报并发数；reflection 产出 score 文本", () => {
    const runner = makeRunner();
    const { ctx, events } = collectCtx();
    runner.relayAgentEvent(ctx, "s2-leader-plan", "leader", undefined, {
      type: "thinking",
      agentId: "playground.leader",
      payload: { text: "思考中", modelId: "test-model-1" },
    });
    const calls = [
      { kind: "tool_call", toolId: "web-search", input: { query: "a" } },
      {
        kind: "tool_call",
        toolId: "web-scraper",
        input: { url: "https://e.com" },
      },
    ];
    runner.relayAgentEvent(
      ctx,
      "s3-researcher-collect",
      "researcher",
      "维度A",
      {
        type: "action_planned",
        agentId: "playground.researcher",
        payload: { kind: "parallel_tool_call", calls },
      },
    );
    runner.relayAgentEvent(ctx, "s9-critic", "reviewer", undefined, {
      type: "reflection",
      agentId: "playground.reviewer",
      payload: { revision: 2, score: 78, note: "结构尚可" },
    });

    const [thinking, planned, reflection] = events.map(
      (e) => e.payload as Record<string, unknown>,
    );
    expect(thinking.kind).toBe("thinking");
    expect(thinking.modelId).toBe("test-model-1");
    expect(planned.kind).toBe("action_planned");
    expect(planned.calls).toEqual(calls);
    expect(planned.text).toContain("2 个工具");
    expect(reflection.kind).toBe("reflection");
    expect(reflection.score).toBe(78);
    expect(reflection.text).toContain("78");
    expect(reflection.text).toContain("结构尚可");
  });
});

describe("DeepInsightDefaultRunner.bridgeMissionEvent", () => {
  function makeState(): CrossStageState {
    const state = new CrossStageState();
    state.set(CS_KEY.tokensUsed, 12345);
    state.set(CS_KEY.costCents, 250); // 2.5 USD
    state.set(CS_KEY.finalScore, 87);
    state.set(CS_KEY.leaderSignOff, { signed: true });
    state.set(CS_KEY.verifierVerdicts, [
      { dimension: "市场", score: 80, comment: "ok" },
    ]);
    state.set(CS_KEY.startedAt, Date.now() - 60_000);
    state.set(CS_KEY.reportArtifact, { title: "AMD 深度研究" });
    return state;
  }

  it("mission:completed → completed 事件携带终态统计 + missionTitle", () => {
    const runner = makeRunner();
    const { ctx, events } = collectCtx();
    runner.bridgeMissionEvent(
      ctx,
      {},
      makeState(),
      { type: "mission:completed", missionId: "m1", timestamp: 9 },
      "AMD topic",
      {},
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("completed");
    const p = events[0].payload as Record<string, unknown>;
    expect(p.costUsd).toBe(2.5);
    expect(p.tokensUsed).toBe(12345);
    expect(p.reviewScore).toBe(87);
    expect(p.leaderSigned).toBe(true);
    expect(p.verifierVerdicts).toEqual([
      { dimension: "市场", score: 80, comment: "ok" },
    ]);
    expect(typeof p.elapsedWallTimeMs).toBe("number");
    expect(p.elapsedWallTimeMs as number).toBeGreaterThanOrEqual(60_000);
    expect(p.missionTitle).toBe("AMD 深度研究");
  });

  it("mission:started → started 事件携带 topic + 档位", () => {
    const runner = makeRunner();
    const { ctx, events } = collectCtx();
    runner.bridgeMissionEvent(
      ctx,
      {},
      new CrossStageState(),
      { type: "mission:started", missionId: "m1", timestamp: 1 },
      "AMD topic",
      { depth: "deep", language: "zh-CN", styleProfile: "executive" },
    );
    const p = events[0].payload as Record<string, unknown>;
    expect(events[0].type).toBe("started");
    expect(p.topic).toBe("AMD topic");
    expect(p.depth).toBe("deep");
    expect(p.styleProfile).toBe("executive");
  });

  it("stage:stalled / stage:degraded → payload 透传 reason + elapsedMs", () => {
    const runner = makeRunner();
    const { ctx, events } = collectCtx();
    runner.bridgeMissionEvent(
      ctx,
      {},
      new CrossStageState(),
      {
        type: "stage:stalled",
        missionId: "m1",
        stepId: "s3-researcher-collect",
        timestamp: 5,
        reason: "no heartbeat",
        elapsedMs: 300_000,
      },
      "t",
      {},
    );
    runner.bridgeMissionEvent(
      ctx,
      {},
      new CrossStageState(),
      {
        type: "stage:degraded",
        missionId: "m1",
        stepId: "s8b-quality-enhancement",
        timestamp: 6,
        reason: "section eval skipped",
      },
      "t",
      {},
    );
    expect(events[0].type).toBe("stage:stalled");
    expect(events[0].payload).toEqual({
      reason: "no heartbeat",
      elapsedMs: 300_000,
    });
    expect(events[1].type).toBe("stage:degraded");
    expect(events[1].payload).toEqual({ reason: "section eval skipped" });
  });
});
