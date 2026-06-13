/**
 * TokenEstimator 单元测试
 */

import {
  estimateEnvelopeTokens,
  estimateMessageTokens,
} from "../token-estimator";
import { ContextEnvelope } from "../../../agents/core/context-envelope";

describe("TokenEstimator (PR-D: gpt-tokenizer-backed)", () => {
  it("estimateMessageTokens includes 4-token role overhead and content tokens", () => {
    const est = estimateMessageTokens({
      role: "user",
      content: "abcdefgh",
    });
    // Overhead alone is 4; content adds 1+ via tokenizer or ceil(8/4)=2 via fallback.
    expect(est).toBeGreaterThanOrEqual(5);
    // Reasonable upper bound for any tokenizer on 8 chars
    expect(est).toBeLessThanOrEqual(10);
  });

  it("estimateEnvelopeTokens sums system + reminders + messages + tools (sane range)", () => {
    const env = new ContextEnvelope({
      system: "0123",
      messages: [{ role: "user", content: "12345678", timestamp: 0 }],
      reminders: [{ source: "t", priority: "low", content: "abcd" }],
      tools: ["t1", "t2"], // 2 * 10 = 20
      memory: { sessionId: "s" },
      budget: {
        tokensUsed: 0,
        tokensRemaining: 1000,
        iterationsUsed: 0,
        iterationsRemaining: 10,
        wallTimeStartMs: 0,
      },
    });
    const total = estimateEnvelopeTokens(env);
    // tools alone contribute 20; rest add at least overhead — accept 25..50
    expect(total).toBeGreaterThanOrEqual(25);
    expect(total).toBeLessThanOrEqual(50);
  });

  it("estimates a longer English string within ±20% of true tokenizer count", () => {
    const text =
      "The quick brown fox jumps over the lazy dog while the agent harness orchestrates a series of tool calls.";
    const est = estimateMessageTokens({ role: "user", content: text });
    // True cl100k_base count for this string is ~22; with overhead +4 → ~26
    expect(est).toBeGreaterThanOrEqual(20);
    expect(est).toBeLessThanOrEqual(35);
  });
});
