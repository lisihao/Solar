/**
 * BusinessTeamMissionSpanFramework spec —— 验证：
 *   - mission/stage/agent 三级 span 嵌套（parent linkage 通过 currentStepId 解析）
 *   - tracer 缺省（undefined）时整 service no-op 不抛
 *   - stage 重入（crash-resume）旧 stage span 自动 end as aborted
 *   - endStageSpan 清空 currentStepId 让后续 startAgentSpan 取不到 parent
 *   - span name 用注入 namespace 前缀
 */

import { BusinessTeamMissionSpanFramework } from "../business-team-mission-span.framework";

interface FakeSpan {
  name: string;
  parent?: FakeSpan;
  attributes: Record<string, unknown>;
  ended: boolean;
  endStatus?: string;
  recordedExceptions: unknown[];
}

class FakeTracer {
  spans: FakeSpan[] = [];
  startSpan(
    name: string,
    opts?: { parent?: FakeSpan; attributes?: Record<string, unknown> },
  ): FakeSpan {
    const span: FakeSpan = {
      name,
      parent: opts?.parent,
      attributes: { ...(opts?.attributes ?? {}) },
      ended: false,
      recordedExceptions: [],
    };
    Object.defineProperty(span, "end", {
      value: (e?: { status?: string }) => {
        span.ended = true;
        span.endStatus = e?.status;
      },
    });
    Object.defineProperty(span, "recordException", {
      value: (err: unknown) => {
        span.recordedExceptions.push(err);
      },
    });
    this.spans.push(span);
    return span;
  }
}

class TestSpanService extends BusinessTeamMissionSpanFramework {}

describe("BusinessTeamMissionSpanFramework", () => {
  it("is a no-op when tracer is absent (constructor undefined)", () => {
    const svc = new TestSpanService(undefined, "myapp");
    expect(() => svc.startMissionSpan("m1", "topic")).not.toThrow();
    expect(() => svc.startStageSpan("m1", "s1", "primitive")).not.toThrow();
    expect(svc.startAgentSpan("m1", "agent1")).toBeUndefined();
    expect(() => svc.endStageSpan("m1", "s1", "completed")).not.toThrow();
    expect(() => svc.endMissionSpan("m1", "completed")).not.toThrow();
  });

  it("uses the injected namespace as span name prefix", () => {
    const tracer = new FakeTracer();
    const svc = new TestSpanService(tracer as never, "myapp");
    svc.startMissionSpan("m1", "topic-x");
    svc.startStageSpan("m1", "s2", "prim");
    svc.startAgentSpan("m1", "agentA");
    expect(tracer.spans.map((s) => s.name)).toEqual([
      "myapp.mission",
      "myapp.stage.s2",
      "myapp.agent",
    ]);
  });

  it("parents stage span under mission span and agent span under stage span", () => {
    const tracer = new FakeTracer();
    const svc = new TestSpanService(tracer as never, "myapp");
    svc.startMissionSpan("m1", "topic-x");
    svc.startStageSpan("m1", "s2", "prim");
    svc.startAgentSpan("m1", "agentA");
    const [mission, stage, agent] = tracer.spans;
    expect(stage.parent).toBe(mission);
    expect(agent.parent).toBe(stage);
  });

  it("startAgentSpan returns undefined when no active stage span", () => {
    const tracer = new FakeTracer();
    const svc = new TestSpanService(tracer as never, "myapp");
    svc.startMissionSpan("m1", "topic");
    // no startStageSpan called yet
    expect(svc.startAgentSpan("m1", "agentA")).toBeUndefined();
    // tracer was not invoked for the agent
    expect(tracer.spans.map((s) => s.name)).toEqual(["myapp.mission"]);
  });

  it("endStageSpan clears currentStepId so subsequent agent span has no parent", () => {
    const tracer = new FakeTracer();
    const svc = new TestSpanService(tracer as never, "myapp");
    svc.startMissionSpan("m1", "topic");
    svc.startStageSpan("m1", "s2", "prim");
    svc.endStageSpan("m1", "s2", "completed");
    expect(svc.startAgentSpan("m1", "agentA")).toBeUndefined();
  });

  it("ends the previous stage span as aborted on stage re-entry (crash-resume)", () => {
    const tracer = new FakeTracer();
    const svc = new TestSpanService(tracer as never, "myapp");
    svc.startMissionSpan("m1", "topic");
    svc.startStageSpan("m1", "s2", "prim");
    const firstStage = tracer.spans[1];
    expect(firstStage.ended).toBe(false);
    // Re-enter same stepId without ending prior
    svc.startStageSpan("m1", "s2", "prim-v2");
    expect(firstStage.ended).toBe(true);
    expect(firstStage.endStatus).toBe("aborted");
    expect(tracer.spans).toHaveLength(3); // mission + 2 stages
  });

  it("records exception on stage/mission/agent failed end", () => {
    const tracer = new FakeTracer();
    const svc = new TestSpanService(tracer as never, "myapp");
    svc.startMissionSpan("m1", "topic");
    svc.startStageSpan("m1", "s2", "prim");
    svc.startAgentSpan("m1", "agentA");
    const err = new Error("boom");
    svc.endAgentSpan("m1", "agentA", "failed", err);
    svc.endStageSpan("m1", "s2", "failed", err);
    svc.endMissionSpan("m1", "failed", err);
    const [, stage, agent] = tracer.spans;
    expect(agent.recordedExceptions).toEqual([err]);
    expect(stage.recordedExceptions).toEqual([err]);
    expect(tracer.spans[0].recordedExceptions).toEqual([err]);
  });
});
