/**
 * JudgeService 单元测试 (PR-B)
 *
 * 验证：
 *   - createVerifier(id) 返回的 IVerifier 能调用 LLM 并解析 score/critique
 *   - 解析失败 fallback 到 score=50
 *   - judgeWithConsensus 单 verifier 直接返回；多 verifier 走 consensus
 */

import { JudgeService } from "../judge.service";
import { ContextEnvelope } from "../../../agents/core/context-envelope";

function makeEnv(): ContextEnvelope {
  return new ContextEnvelope({
    system: "",
    messages: [],
    reminders: [],
    tools: [],
    memory: { sessionId: "s1" },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 1000,
      iterationsUsed: 0,
      iterationsRemaining: 10,
      wallTimeStartMs: 0,
    },
  });
}

function mkChat(responses: string[]) {
  let i = 0;
  return {
    chat: jest.fn(async () => ({
      content: responses[i++] ?? responses[responses.length - 1],
      model: "mock",
      usage: { totalTokens: 10 },
    })),
  };
}

describe("JudgeService (PR-B)", () => {
  it("creates a verifier that returns parsed score + critique", async () => {
    const chat = mkChat([
      JSON.stringify({ score: 82, critique: "looks good but cite source" }),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new JudgeService(chat as any);
    const v = svc.createVerifier("self");
    const out = await v.evaluate({
      output: { headline: "x" },
      envelope: makeEnv(),
    });
    expect(out.score).toBe(82);
    expect(out.critique).toMatch(/cite source/);
  });

  it("clips score into 0..100 range", async () => {
    const chat = mkChat([JSON.stringify({ score: 999, critique: "" })]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = new JudgeService(chat as any).createVerifier("external");
    const out = await v.evaluate({ output: "x", envelope: makeEnv() });
    expect(out.score).toBe(100);
  });

  it("returns null (abstain) when LLM output is unparseable", async () => {
    // ★ 2026-04-30: 行为变更 — parse 失败不再用兜底 50，返回 null 让上层
    // reflexion-loop 跳过本 verdict，避免坏 verifier 永远拉低 composite。
    const chat = mkChat(["not json at all"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = new JudgeService(chat as any).createVerifier("critical");
    const out = await v.evaluate({ output: "x", envelope: makeEnv() });
    expect(out).toBeNull();
  });

  it("judgeWithConsensus aggregates multi-verifier verdicts", async () => {
    const chat = mkChat([
      JSON.stringify({ score: 80, critique: "ok" }),
      JSON.stringify({ score: 76, critique: "fine" }),
      JSON.stringify({ score: 84, critique: "good" }),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new JudgeService(chat as any);
    const result = await svc.judgeWithConsensus({
      output: "draft",
      envelope: makeEnv(),
      verifierIds: ["self", "external", "critical"],
      passThreshold: 70,
    });
    expect(result.verdicts).toHaveLength(3);
    expect(result.decision.verdict).toBe("pass");
    expect(result.decision.score).toBeGreaterThanOrEqual(70);
  });
});
