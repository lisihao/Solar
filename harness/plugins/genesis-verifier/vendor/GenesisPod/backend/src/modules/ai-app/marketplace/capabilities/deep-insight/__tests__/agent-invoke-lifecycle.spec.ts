/**
 * agent-invoke.helper lifecycle 双发 spec（审计 #11/#27）。
 *
 * 守护：
 *  1. invokeAgent 进入 runner.run 之前先发 agent:lifecycle phase=started
 *     （首事件即 started，且带 agentId/role/dimension/stepId）——基线 emitLifecycle
 *     双发语义；前端时间线『启动』行 / agent-view startedAt / roster running 依赖。
 *  2. 完成事件透传 RunResult.iterations（runner 缺省该字段则不造）。
 *  3. failed 路径同样有 started 前置事件。
 */
import type { AgentRunner, CrossStageState } from "@/modules/ai-harness/facade";
import type { CapabilityRunEvent } from "../../../capability/capability-runner.port";
import { invokeAgent } from "../pipeline/bindings/agent-invoke.helper";
import type { AgentInvocation } from "../pipeline/ports";

jest.mock("@/modules/ai-app/contracts/agent-spec-catalog", () => ({
  resolveAgentSpec: jest.fn(() => class FakeResearcherAgent {}),
}));

interface DomainEvent {
  event: string;
  data: Record<string, unknown>;
}

function collectDomainEvents() {
  const events: DomainEvent[] = [];
  const onEvent = (e: CapabilityRunEvent) => {
    const payload = e.payload as {
      event: string;
      data: Record<string, unknown>;
    };
    events.push({ event: payload.event, data: payload.data });
  };
  return { events, onEvent };
}

function makeRunner(result: Record<string, unknown>, onRunCalled?: () => void) {
  const run = jest.fn(async () => {
    onRunCalled?.();
    return result;
  });
  return { runner: { run } as unknown as AgentRunner, run };
}

// 完整镜像真实 CrossStageState 用到的方法（incr 计费 + get/append modelTrail 累积）。
const fakeCrossState = {
  incr: jest.fn(),
  get: jest.fn(() => undefined),
  append: jest.fn(),
} as unknown as CrossStageState;
const invocation: AgentInvocation = { userId: "u1" };

function baseArgs(
  runner: AgentRunner,
  onEvent: (e: CapabilityRunEvent) => void,
) {
  return {
    runner,
    specId: "playground.researcher",
    input: { topic: "t" },
    invocation,
    crossStageState: fakeCrossState,
    stepId: "s3-researcher-collect",
    role: "researcher",
    dimension: "市场规模",
    operationType: "research",
    onEvent,
  };
}

describe("invokeAgent lifecycle 双发", () => {
  beforeEach(() => jest.clearAllMocks());

  it("runner.run 之前先发 phase=started（首事件），完成后发 completed 带 iterations", async () => {
    const { events, onEvent } = collectDomainEvents();
    let eventsWhenRunCalled = -1;
    const { runner, run } = makeRunner(
      {
        output: { ok: true },
        state: "completed",
        iterations: 4,
        tokensUsed: { prompt: 10, completion: 20, total: 30 },
        costCents: 7,
        modelTrail: [
          {
            iter: 1,
            modelId: "m-x",
            promptTokens: 10,
            completionTokens: 20,
            latencyMs: 5,
          },
        ],
      },
      () => {
        eventsWhenRunCalled = events.length;
      },
    );

    const res = await invokeAgent(baseArgs(runner, onEvent));

    // 调用序列：started 必须先于 runner.run（首事件 phase==='started'）
    expect(eventsWhenRunCalled).toBeGreaterThanOrEqual(1);
    expect(events[0].event).toBe("agent:lifecycle");
    expect(events[0].data.phase).toBe("started");
    expect(events[0].data).toMatchObject({
      agentId: "researcher#市场规模",
      role: "researcher",
      dimension: "市场规模",
      stepId: "s3-researcher-collect",
    });
    // started 不带终态字段
    expect(events[0].data.tokensUsed).toBeUndefined();
    expect(events[0].data.iterations).toBeUndefined();

    const lifecycle = events.filter((e) => e.event === "agent:lifecycle");
    expect(lifecycle).toHaveLength(2);
    expect(lifecycle[1].data).toMatchObject({
      agentId: "researcher#市场规模",
      phase: "completed",
      iterations: 4,
      tokensUsed: 30,
      costCents: 7,
      modelId: "m-x",
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(res.state).toBe("completed");
  });

  it("runner 返回值缺 iterations 时完成事件不造该字段", async () => {
    const { events, onEvent } = collectDomainEvents();
    const { runner } = makeRunner({
      output: {},
      state: "completed",
      tokensUsed: { prompt: 0, completion: 0, total: 0 },
      costCents: 0,
    });

    await invokeAgent(baseArgs(runner, onEvent));

    const completed = events.find(
      (e) => e.event === "agent:lifecycle" && e.data.phase === "completed",
    );
    expect(completed).toBeDefined();
    expect(completed && "iterations" in completed.data).toBe(false);
  });

  it("failed 路径同样先发 started，再发 phase=failed", async () => {
    const { events, onEvent } = collectDomainEvents();
    const { runner } = makeRunner({
      output: undefined,
      state: "failed",
      iterations: 2,
      tokensUsed: { prompt: 1, completion: 0, total: 1 },
      costCents: 1,
    });

    await invokeAgent(baseArgs(runner, onEvent));

    const lifecycle = events.filter((e) => e.event === "agent:lifecycle");
    expect(lifecycle[0].data.phase).toBe("started");
    expect(lifecycle[1].data).toMatchObject({ phase: "failed", iterations: 2 });
  });

  it("无 dimension 时 started 的 agentId 剥 playground. 前缀且不带 dimension 字段", async () => {
    const { events, onEvent } = collectDomainEvents();
    const { runner } = makeRunner({
      output: {},
      state: "completed",
      tokensUsed: { prompt: 0, completion: 0, total: 0 },
      costCents: 0,
    });

    const args = baseArgs(runner, onEvent);
    await invokeAgent({
      ...args,
      specId: "playground.leader",
      role: "leader",
      dimension: undefined,
      stepId: "s2-leader-plan",
    });

    expect(events[0].data).toMatchObject({
      phase: "started",
      agentId: "leader",
      stepId: "s2-leader-plan",
    });
    expect("dimension" in events[0].data).toBe(false);
  });
});
