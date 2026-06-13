/**
 * token-spend.utils.spec.ts
 * Pure-function tests for extractTokenSpend and estimateUsdFromTokens.
 */

import {
  extractTokenSpend,
  estimateUsdFromTokens,
  extractRealCostUsd,
} from "../observability/token-spend.utils";
import type { IAgentEvent } from "@/modules/ai-harness/facade";

function makeEvent(type: string, payload: unknown): IAgentEvent {
  return { type, payload, timestamp: 0 } as unknown as IAgentEvent;
}

// ─── extractTokenSpend ───────────────────────────────────────────────────────

describe("extractTokenSpend", () => {
  it("returns 0 for empty events", () => {
    expect(extractTokenSpend([])).toBe(0);
  });

  it("sums tokensUsed from action_executed events", () => {
    const events = [
      makeEvent("action_executed", { tokensUsed: 100 }),
      makeEvent("action_executed", { tokensUsed: 200 }),
    ];
    expect(extractTokenSpend(events)).toBe(300);
  });

  it("ignores action_executed events without tokensUsed", () => {
    const events = [
      makeEvent("action_executed", { output: "something" }),
      makeEvent("action_executed", { tokensUsed: 50 }),
    ];
    expect(extractTokenSpend(events)).toBe(50);
  });

  it("returns budget_warning value when larger than action_executed total", () => {
    const events = [
      makeEvent("action_executed", { tokensUsed: 100 }),
      makeEvent("budget_warning", { tokensUsed: 500 }),
    ];
    expect(extractTokenSpend(events)).toBe(500);
  });

  it("returns action_executed total when larger than budget_warning", () => {
    const events = [
      makeEvent("action_executed", { tokensUsed: 300 }),
      makeEvent("action_executed", { tokensUsed: 400 }),
      makeEvent("budget_warning", { tokensUsed: 100 }),
    ];
    expect(extractTokenSpend(events)).toBe(700);
  });

  it("takes max of multiple budget_warning events", () => {
    const events = [
      makeEvent("budget_warning", { tokensUsed: 200 }),
      makeEvent("budget_warning", { tokensUsed: 400 }),
      makeEvent("budget_warning", { tokensUsed: 300 }),
    ];
    expect(extractTokenSpend(events)).toBe(400);
  });

  it("ignores non-relevant event types", () => {
    const events = [
      makeEvent("thinking", { text: "hmm", tokenCount: 999 }),
      makeEvent("action_planned", { kind: "tool" }),
      makeEvent("action_executed", { tokensUsed: 50 }),
    ];
    expect(extractTokenSpend(events)).toBe(50);
  });

  it("ignores action_executed with null payload", () => {
    const events = [makeEvent("action_executed", null)];
    expect(extractTokenSpend(events)).toBe(0);
  });

  it("ignores action_executed with tokensUsed as non-numeric string", () => {
    const events = [
      makeEvent("action_executed", { tokensUsed: "not-a-number" }),
    ];
    expect(extractTokenSpend(events)).toBe(0);
  });

  // ★ P1-NEW-B (round 2): 兼容字符串数字
  it("accepts numeric string tokensUsed (round 2)", () => {
    const events = [
      makeEvent("action_executed", { tokensUsed: "100" }),
      makeEvent("action_executed", { tokensUsed: "250" }),
    ];
    expect(extractTokenSpend(events)).toBe(350);
  });

  // ★ P1-R3-A (round 3) + P2-R4-1 (round 4): 大数攻击防护，上限 5M 留 Sonnet 余量
  it("rejects exponential big numbers (>5M tokens) — anti-overflow guard", () => {
    const events = [
      makeEvent("action_executed", { tokensUsed: "9e99" }),
      makeEvent("action_executed", { tokensUsed: 5_000_001 }),
      makeEvent("action_executed", { tokensUsed: 50 }),
    ];
    expect(extractTokenSpend(events)).toBe(50);
  });

  it("rejects negative tokensUsed (round 3)", () => {
    const events = [
      makeEvent("action_executed", { tokensUsed: -100 }),
      makeEvent("action_executed", { tokensUsed: 50 }),
    ];
    expect(extractTokenSpend(events)).toBe(50);
  });

  it("rejects Infinity / NaN (round 3)", () => {
    const events = [
      makeEvent("action_executed", { tokensUsed: Infinity }),
      makeEvent("action_executed", { tokensUsed: NaN }),
      makeEvent("action_executed", { tokensUsed: 50 }),
    ];
    expect(extractTokenSpend(events)).toBe(50);
  });

  it("accepts max boundary 5_000_000 tokens (round 4)", () => {
    const events = [makeEvent("action_executed", { tokensUsed: 5_000_000 })];
    expect(extractTokenSpend(events)).toBe(5_000_000);
  });

  it("ignores budget_warning with null payload", () => {
    const events = [makeEvent("budget_warning", null)];
    expect(extractTokenSpend(events)).toBe(0);
  });

  it("handles mix of valid and invalid events correctly", () => {
    const events = [
      makeEvent("action_executed", null),
      makeEvent("action_executed", { tokensUsed: 150 }),
      makeEvent("budget_warning", { tokensUsed: 100 }),
      makeEvent("thinking", { text: "ok" }),
    ];
    expect(extractTokenSpend(events)).toBe(150);
  });

  it("falls back to thinking prompt/completion tokens when action totals are absent", () => {
    const events = [
      makeEvent("thinking", {
        promptTokens: 600,
        completionTokens: 400,
        modelId: "grok-4-1-fast-reasoning",
      }),
      makeEvent("action_executed", {
        output: "finalized without explicit usage",
      }),
    ];
    expect(extractTokenSpend(events)).toBe(1000);
  });

  it("prefers explicit action/budget totals when larger than thinking fallback", () => {
    const events = [
      makeEvent("thinking", {
        promptTokens: 300,
        completionTokens: 200,
      }),
      makeEvent("action_executed", { tokensUsed: 1200 }),
      makeEvent("budget_warning", { tokensUsed: 900 }),
    ];
    expect(extractTokenSpend(events)).toBe(1200);
  });
});

// ─── estimateUsdFromTokens ────────────────────────────────────────────────────

describe("estimateUsdFromTokens", () => {
  it("returns 0 for 0 tokens", () => {
    expect(estimateUsdFromTokens(0)).toBe(0);
  });

  it("calculates correct USD for 1M tokens (~$3)", () => {
    expect(estimateUsdFromTokens(1_000_000)).toBeCloseTo(3.0);
  });

  it("calculates correct USD for 1000 tokens", () => {
    expect(estimateUsdFromTokens(1000)).toBeCloseTo(0.003);
  });

  it("scales linearly", () => {
    const half = estimateUsdFromTokens(500_000);
    const full = estimateUsdFromTokens(1_000_000);
    expect(full).toBeCloseTo(half * 2);
  });
});

// ─── extractRealCostUsd ───────────────────────────────────────────────────────

describe("extractRealCostUsd (R2-#36)", () => {
  it("returns 0 for empty events", () => {
    expect(extractRealCostUsd([])).toBe(0);
  });

  it("sums costUsd from thinking events", () => {
    const events = [
      makeEvent("thinking", {
        text: "ok",
        costUsd: 0.0012,
        modelId: "claude-3-5-sonnet",
      }),
      makeEvent("thinking", {
        text: "ok",
        costUsd: 0.0008,
        modelId: "claude-3-5-haiku",
      }),
    ];
    expect(extractRealCostUsd(events)).toBeCloseTo(0.002);
  });

  it("ignores non-thinking events", () => {
    const events = [
      makeEvent("action_executed", { tokensUsed: 100, costUsd: 99 }),
      makeEvent("thinking", { text: "ok", costUsd: 0.005 }),
    ];
    expect(extractRealCostUsd(events)).toBeCloseTo(0.005);
  });

  it("returns 0 when thinking events have no costUsd", () => {
    const events = [
      makeEvent("thinking", { text: "reasoning", tokenCount: 500 }),
    ];
    expect(extractRealCostUsd(events)).toBe(0);
  });

  it("returns 0 when costUsd is null", () => {
    const events = [makeEvent("thinking", { text: "ok", costUsd: null })];
    expect(extractRealCostUsd(events)).toBe(0);
  });

  it("rejects negative costUsd", () => {
    const events = [
      makeEvent("thinking", { costUsd: -5 }),
      makeEvent("thinking", { costUsd: 0.001 }),
    ];
    expect(extractRealCostUsd(events)).toBeCloseTo(0.001);
  });

  it("rejects implausibly large costUsd (> $1000)", () => {
    const events = [
      makeEvent("thinking", { costUsd: 9999 }),
      makeEvent("thinking", { costUsd: 0.002 }),
    ];
    expect(extractRealCostUsd(events)).toBeCloseTo(0.002);
  });

  it("accepts numeric-string costUsd", () => {
    const events = [makeEvent("thinking", { costUsd: "0.003" })];
    expect(extractRealCostUsd(events)).toBeCloseTo(0.003);
  });

  /**
   * ★ R2-#36 integration: multi-tier model mix → pool/persisted cost ≈ sum of
   * per-model real costs, NOT the flat $3/1M-token heuristic.
   *
   * Scenario: 3 agents with different model tiers each emit thinking events
   * with real costUsd values.  We verify that extractRealCostUsd sums them
   * precisely and the flat heuristic would differ by more than 2% (confirming
   * that the fix is necessary, not trivially equivalent).
   */
  it("multi-tier model mix: real cost ≈ sum of per-model costs within ±2%", () => {
    // Simulated thinking events from three agents running different models
    const agentAEvents = [
      // strong-tier: claude-3-5-sonnet, ~$3 input / $15 output per 1M
      makeEvent("thinking", {
        costUsd: (50_000 / 1e6) * 3 + (20_000 / 1e6) * 15, // $0.15 + $0.30 = $0.45
        promptTokens: 50_000,
        completionTokens: 20_000,
        modelId: "claude-3-5-sonnet",
      }),
    ];
    const agentBEvents = [
      // standard-tier: claude-3-5-haiku, ~$0.25 input / $1.25 output per 1M
      makeEvent("thinking", {
        costUsd: (80_000 / 1e6) * 0.25 + (10_000 / 1e6) * 1.25, // $0.02 + $0.0125 = $0.0325
        promptTokens: 80_000,
        completionTokens: 10_000,
        modelId: "claude-3-5-haiku",
      }),
    ];
    const agentCEvents = [
      // basic-tier: deepseek-chat, ~$0.14 input / $0.28 output per 1M
      makeEvent("thinking", {
        costUsd: (100_000 / 1e6) * 0.14 + (15_000 / 1e6) * 0.28, // $0.014 + $0.0042 = $0.0182
        promptTokens: 100_000,
        completionTokens: 15_000,
        modelId: "deepseek-chat",
      }),
    ];

    const allEvents = [...agentAEvents, ...agentBEvents, ...agentCEvents];
    const totalTokens = 50_000 + 20_000 + 80_000 + 10_000 + 100_000 + 15_000; // 275_000

    const realCost = extractRealCostUsd(allEvents);
    const expectedRealCost = 0.45 + 0.0325 + 0.0182; // ≈ $0.5007
    const flatHeuristicCost = estimateUsdFromTokens(totalTokens); // 275_000 * $3/1M = $0.825

    // Real cost matches the sum of per-model ModelPricingRegistry values within ±2%
    const relativeError =
      Math.abs(realCost - expectedRealCost) / expectedRealCost;
    expect(relativeError).toBeLessThan(0.02);

    // Flat heuristic would diverge by > 2% for this multi-tier mix
    const heuristicDiff =
      Math.abs(flatHeuristicCost - expectedRealCost) / expectedRealCost;
    expect(heuristicDiff).toBeGreaterThan(0.02);
  });
});
