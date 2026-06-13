import { createSelfJudge, callJudgeLLM } from "../self-judge";
import { createExternalJudge } from "../external-judge";
import { MetaJudge } from "../meta-judge";
import type { AgentTask } from "../../env/types";

function makeSpan() {
  return {
    traceId: "t1",
    spanId: "s1",
    parentSpanId: undefined,
    name: "test",
    attributes: {},
    startedAt: Date.now(),
    setAttributes: jest.fn(),
    end: jest.fn(),
    recordException: jest.fn(),
  };
}

function makeCtx(llm: { call: jest.Mock }) {
  return {
    task: {} as AgentTask,
    budget: {} as never,
    toolRegistry: {} as never,
    llm,
    tracer: {} as never,
    span: makeSpan() as never,
    messages: [],
    observations: [],
    scratchpad: { notes: [], keyFindings: [], pendingQuestions: [] },
    toolInvocations: [],
  };
}

function makeLLM(content: string, modelId = "test-model") {
  return {
    call: jest.fn().mockResolvedValue({
      content,
      promptTokens: 100,
      completionTokens: 50,
      costUsd: 0.01,
      modelId,
    }),
  };
}

describe("callJudgeLLM", () => {
  it("parses valid JSON verdict", async () => {
    const llm = makeLLM(
      JSON.stringify({
        score: 85,
        critique: "Good work",
        criteria: { accuracy: 9 },
      }),
    );
    const result = await callJudgeLLM(llm, [], makeSpan() as never);
    expect(result.score).toBe(85);
    expect(result.critique).toBe("Good work");
    expect(result.criteria).toEqual({ accuracy: 9 });
  });

  it("parses JSON wrapped in code fence", async () => {
    const content = '```json\n{"score": 72, "critique": "Decent"}\n```';
    const llm = makeLLM(content);
    const result = await callJudgeLLM(llm, [], makeSpan() as never);
    expect(result.score).toBe(72);
  });

  it("fallbacks to 50 when JSON is invalid", async () => {
    const llm = makeLLM("not valid json at all");
    const result = await callJudgeLLM(llm, [], makeSpan() as never);
    expect(result.score).toBe(50);
    expect(result.critique).toContain("fallback");
  });

  it("fallbacks when llm throws", async () => {
    const llm = { call: jest.fn().mockRejectedValue(new Error("LLM down")) };
    const result = await callJudgeLLM(llm, [], makeSpan() as never);
    expect(result.score).toBe(50);
  });

  it("clamps score to 0-100", async () => {
    const llm = makeLLM(JSON.stringify({ score: 150, critique: "Too high" }));
    const result = await callJudgeLLM(llm, [], makeSpan() as never);
    expect(result.score).toBe(100);
  });
});

describe("createSelfJudge", () => {
  it("uses default judgeId of self", () => {
    const judge = createSelfJudge();
    expect(judge.judgeId).toBe("self");
  });

  it("uses custom judgeId", () => {
    const judge = createSelfJudge({ judgeId: "my-self" });
    expect(judge.judgeId).toBe("my-self");
  });

  it("evaluates draft by calling LLM", async () => {
    const llm = makeLLM(JSON.stringify({ score: 78, critique: "Solid" }));
    const judge = createSelfJudge();
    const ctx = makeCtx(llm);
    const result = await judge.evaluate(
      { content: "draft" },
      {} as AgentTask,
      ctx as never,
    );
    expect(result.score).toBe(78);
    expect(llm.call).toHaveBeenCalled();
  });
});

describe("createExternalJudge", () => {
  it("uses default judgeId of external", () => {
    const judge = createExternalJudge();
    expect(judge.judgeId).toBe("external");
  });

  it("uses custom judgeId", () => {
    const judge = createExternalJudge({ judgeId: "cross-eval" });
    expect(judge.judgeId).toBe("cross-eval");
  });

  it("uses externalLLM when provided", async () => {
    const externalLLM = makeLLM(
      JSON.stringify({ score: 65, critique: "External eval" }),
    );
    const contextLLM = makeLLM(
      JSON.stringify({ score: 90, critique: "Should not be called" }),
    );
    const judge = createExternalJudge({ externalLLM });
    const ctx = makeCtx(contextLLM);
    const result = await judge.evaluate(
      { content: "draft" },
      {} as AgentTask,
      ctx as never,
    );
    expect(result.score).toBe(65);
    expect(externalLLM.call).toHaveBeenCalled();
    expect(contextLLM.call).not.toHaveBeenCalled();
  });

  it("falls back to ctx.llm when externalLLM not provided", async () => {
    const llm = makeLLM(JSON.stringify({ score: 72, critique: "Good" }));
    const judge = createExternalJudge();
    const ctx = makeCtx(llm);
    const result = await judge.evaluate(
      "some draft",
      {} as AgentTask,
      ctx as never,
    );
    expect(llm.call).toHaveBeenCalled();
    expect(result.score).toBe(72);
  });
});

describe("MetaJudge", () => {
  it("resolves to pass when score >= 70", async () => {
    const llm = makeLLM(
      JSON.stringify({ score: 75, critique: "Pass verdict" }),
    );
    const meta = new MetaJudge(llm);
    const decision = await meta.resolve([
      { judgeId: "j1", score: 60, critique: "Not great" },
      { judgeId: "j2", score: 90, critique: "Excellent" },
    ]);
    expect(decision.verdict).toBe("pass");
    expect(decision.score).toBe(75);
  });

  it("resolves to fail when score < 70", async () => {
    const llm = makeLLM(
      JSON.stringify({ score: 45, critique: "Fail verdict" }),
    );
    const meta = new MetaJudge(llm);
    const decision = await meta.resolve([
      { judgeId: "j1", score: 30, critique: "Bad" },
    ]);
    expect(decision.verdict).toBe("fail");
  });

  it("includes critique in note", async () => {
    const llm = makeLLM(
      JSON.stringify({ score: 80, critique: "Meta critique note" }),
    );
    const meta = new MetaJudge(llm);
    const decision = await meta.resolve([
      { judgeId: "j1", score: 80, critique: "Good" },
    ]);
    expect(decision.note).toContain("Meta critique");
  });

  it("fallbacks to 50 when LLM fails", async () => {
    const llm = { call: jest.fn().mockRejectedValue(new Error("LLM fail")) };
    const meta = new MetaJudge(llm);
    const decision = await meta.resolve([
      { judgeId: "j1", score: 40, critique: "Bad" },
    ]);
    // fallback score is 50, which is < 70 -> fail
    expect(decision.verdict).toBe("fail");
  });
});
