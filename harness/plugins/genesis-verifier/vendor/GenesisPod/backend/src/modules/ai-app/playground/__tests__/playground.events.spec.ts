import { AGENT_PLAYGROUND_EVENTS } from "../events/playground.events";
import { AgentReflectionSchema } from "../events/playground.event-schemas";

describe("AGENT_PLAYGROUND_EVENTS", () => {
  it("registers production events consumed by the playground UI", () => {
    const registered = new Set(AGENT_PLAYGROUND_EVENTS.map((e) => e.type));

    for (const type of [
      "playground.mission:warning",
      "playground.mission:degraded",
      "playground.dimension:retry-failed",
      "playground.chapter:done",
    ]) {
      expect(registered.has(type)).toBe(true);
    }
  });
});

describe("AgentReflectionSchema", () => {
  // 回归：reflexion-loop.ts force-pass 分支在所有 verifier abstain 时 emit
  // { score: null, ... } 表示"显式无分可评"。schema 旧版本用 .optional() 只接受
  // undefined → prod log 反复打 "Expected number, received null"。schema 必须
  // 用 .nullish() 接 null。改回去会触发回归（reflexion 全 abstain 路径必炸）。
  it("accepts score=null (abstain force-pass signal)", () => {
    const result = AgentReflectionSchema.safeParse({
      revision: 1,
      score: null,
      verdicts: [],
      note: "all verifiers abstained",
    });
    expect(result.success).toBe(true);
  });

  it("accepts score as a real number", () => {
    const result = AgentReflectionSchema.safeParse({
      revision: 1,
      score: 0.85,
      verdicts: [{ judgeId: "j1", score: 0.85, critique: "ok" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts score being omitted", () => {
    const result = AgentReflectionSchema.safeParse({ revision: 1 });
    expect(result.success).toBe(true);
  });
});
