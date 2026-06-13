/**
 * JudgeService — supplement branch coverage spec
 *
 * Targets uncovered branches:
 *   - createVerifier: output is string (not object) → used directly as draft
 *   - parseVerdict: response wrapped in ``` fenced block → fence extracted
 *   - parseVerdict: critique is not a string → returns "" for critique
 *   - createVerifier: chat throws → catch returns score=50
 *   - judgeWithConsensus: default passThreshold=70 when not specified
 */

import { JudgeService } from "../judge.service";
import { ContextEnvelope } from "../../../agents/core/context-envelope";
import { Logger } from "@nestjs/common";

jest.spyOn(Logger.prototype, "warn").mockImplementation();

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
    })),
  };
}

// ─── output is a string (not object) ─────────────────────────────────────────

describe("JudgeService supplement — string output draft", () => {
  it("uses output string directly when output is a string", async () => {
    const chat = mkChat([
      JSON.stringify({ score: 75, critique: "good draft" }),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new JudgeService(chat as any);
    const v = svc.createVerifier("self");

    // When output is a string, it's used directly (not JSON.stringified)
    const out = await v.evaluate({
      output: "This is a string output",
      envelope: makeEnv(),
    });
    expect(out.score).toBe(75);
    expect(chat.chat).toHaveBeenCalledTimes(1);
  });
});

// ─── parseVerdict: response in ``` fenced block ───────────────────────────────

describe("JudgeService supplement — fenced verdict response", () => {
  it("extracts JSON from ```json ... ``` fenced block", async () => {
    const fencedResponse =
      "```json\n" +
      JSON.stringify({ score: 68, critique: "needs work" }) +
      "\n```";
    const chat = mkChat([fencedResponse]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new JudgeService(chat as any);
    const v = svc.createVerifier("external");

    const out = await v.evaluate({
      output: { text: "draft" },
      envelope: makeEnv(),
    });
    expect(out.score).toBe(68);
    expect(out.critique).toContain("needs work");
  });

  it("extracts JSON from plain ``` ... ``` fenced block", async () => {
    const fencedResponse =
      "```\n" + JSON.stringify({ score: 55, critique: "incomplete" }) + "\n```";
    const chat = mkChat([fencedResponse]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new JudgeService(chat as any);
    const v = svc.createVerifier("critical");

    const out = await v.evaluate({ output: "content", envelope: makeEnv() });
    expect(out.score).toBe(55);
  });
});

// ─── parseVerdict: critique not a string ────────────────────────────────────

describe("JudgeService supplement — critique not string", () => {
  it("returns empty string for critique when critique is not a string", async () => {
    const chat = mkChat([JSON.stringify({ score: 70, critique: 12345 })]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new JudgeService(chat as any);
    const v = svc.createVerifier("self");

    const out = await v.evaluate({ output: "draft", envelope: makeEnv() });
    expect(out.score).toBe(70);
    expect(out.critique).toBe(""); // Non-string critique → ""
  });

  it("returns empty string for critique when critique field is absent", async () => {
    const chat = mkChat([JSON.stringify({ score: 85 })]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new JudgeService(chat as any);
    const v = svc.createVerifier("external");

    const out = await v.evaluate({ output: "draft", envelope: makeEnv() });
    expect(out.score).toBe(85);
    expect(out.critique).toBe("");
  });
});

// ─── chat throws → catch path ────────────────────────────────────────────────

describe("JudgeService supplement — chat throws", () => {
  it("returns null (abstain) when chat throws", async () => {
    // ★ 2026-04-30: 行为变更 — chat throw 不再用兜底 50 + "judge error"
    // critique，返回 null（abstain），让上层 reflexion-loop 跳过本 verdict。
    const chat = {
      chat: jest.fn(async () => {
        throw new Error("Rate limit exceeded");
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new JudgeService(chat as any);
    const v = svc.createVerifier("self");

    const out = await v.evaluate({ output: "draft", envelope: makeEnv() });
    expect(out).toBeNull();
  });
});

// ─── judgeWithConsensus: default passThreshold ───────────────────────────────

describe("JudgeService supplement — judgeWithConsensus default threshold", () => {
  it("uses default passThreshold=70 when not specified", async () => {
    const chat = mkChat([JSON.stringify({ score: 80, critique: "good" })]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new JudgeService(chat as any);

    const result = await svc.judgeWithConsensus({
      output: "draft",
      envelope: makeEnv(),
      verifierIds: ["self"],
      // passThreshold not specified → defaults to 70
    });

    expect(result.verdicts).toHaveLength(1);
    expect(result.decision.verdict).toBe("pass");
  });

  it("uses signal when provided to judgeWithConsensus", async () => {
    const chat = mkChat([JSON.stringify({ score: 75, critique: "ok" })]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new JudgeService(chat as any);
    const controller = new AbortController();

    const result = await svc.judgeWithConsensus({
      output: "draft",
      envelope: makeEnv(),
      verifierIds: ["critical"],
      signal: controller.signal,
    });

    expect(result.verdicts).toHaveLength(1);
  });
});
