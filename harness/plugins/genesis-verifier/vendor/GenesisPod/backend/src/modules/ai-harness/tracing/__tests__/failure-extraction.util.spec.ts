/**
 * failure-extraction.utils.spec.ts
 * Pure-function tests for extractAgentFailureDiagnostic and extractFailureMessage.
 */

import {
  extractAgentFailureDiagnostic,
  extractFailureMessage,
} from "../observability/failure-extraction.utils";
import type { IAgentEvent } from "@/modules/ai-harness/facade";

function makeEvent(type: string, payload: unknown, timestamp = 0): IAgentEvent {
  return { type, payload, timestamp } as unknown as IAgentEvent;
}

// ─── extractAgentFailureDiagnostic ───────────────────────────────────────────

describe("extractAgentFailureDiagnostic", () => {
  it("returns undefined for empty events array", () => {
    expect(extractAgentFailureDiagnostic([])).toBeUndefined();
  });

  it("returns undefined when no error or terminated events", () => {
    const events = [makeEvent("thinking", { text: "ok" })];
    expect(extractAgentFailureDiagnostic(events)).toBeUndefined();
  });

  it("picks last error event with failureCode", () => {
    const events = [
      makeEvent("error", { failureCode: "FIRST", message: "first" }),
      makeEvent("error", { failureCode: "LAST", message: "last" }),
    ];
    const result = extractAgentFailureDiagnostic(events);
    expect(result?.failureCode).toBe("LAST");
  });

  it("skips error events without failureCode", () => {
    const events = [
      makeEvent("error", { message: "no code" }),
      makeEvent("error", { failureCode: "REAL_CODE", message: "has code" }),
    ];
    const result = extractAgentFailureDiagnostic(events);
    expect(result?.failureCode).toBe("REAL_CODE");
  });

  it("includes diagnostic and recoveryHint from error event", () => {
    const events = [
      makeEvent("error", {
        failureCode: "PARSE_MALFORMED_JSON",
        message: "bad json",
        diagnostic: { modelId: "gpt-x" },
        recoveryHint: { retryWith: "gpt-4o" },
      }),
    ];
    const result = extractAgentFailureDiagnostic(events);
    expect(result?.diagnostic).toEqual({ modelId: "gpt-x" });
    expect(result?.recoveryHint).toEqual({ retryWith: "gpt-4o" });
  });

  it("falls back to terminated event when no error event has failureCode", () => {
    const events = [
      makeEvent("error", { message: "no code" }),
      makeEvent("terminated", { reason: "budget" }),
    ];
    const result = extractAgentFailureDiagnostic(events);
    expect(result?.failureCode).toBe("LOOP_BUDGET_EXHAUSTED");
  });

  it("maps terminated reason=cancelled to UNKNOWN", () => {
    const events = [makeEvent("terminated", { reason: "cancelled" })];
    const result = extractAgentFailureDiagnostic(events);
    expect(result?.failureCode).toBe("UNKNOWN");
  });

  it("maps terminated reason=empty_llm_response to LOOP_EMPTY_RESPONSE_IMMEDIATE", () => {
    const events = [makeEvent("terminated", { reason: "empty_llm_response" })];
    const result = extractAgentFailureDiagnostic(events);
    expect(result?.failureCode).toBe("LOOP_EMPTY_RESPONSE_IMMEDIATE");
  });

  it("maps terminated reason=error to PROVIDER_API_ERROR", () => {
    const events = [makeEvent("terminated", { reason: "error" })];
    const result = extractAgentFailureDiagnostic(events);
    expect(result?.failureCode).toBe("PROVIDER_API_ERROR");
  });

  it("maps unknown terminated reason to UNKNOWN", () => {
    const events = [makeEvent("terminated", { reason: "something_weird" })];
    const result = extractAgentFailureDiagnostic(events);
    expect(result?.failureCode).toBe("UNKNOWN");
  });

  it("ignores terminated reason=completed", () => {
    const events = [makeEvent("terminated", { reason: "completed" })];
    expect(extractAgentFailureDiagnostic(events)).toBeUndefined();
  });

  it("error event takes precedence over terminated event", () => {
    const events = [
      makeEvent("terminated", { reason: "budget" }),
      makeEvent("error", { failureCode: "PARSE_MISSING_ACTION" }),
    ];
    const result = extractAgentFailureDiagnostic(events);
    expect(result?.failureCode).toBe("PARSE_MISSING_ACTION");
  });

  it("returns undefined when terminated has null payload", () => {
    const events = [makeEvent("terminated", null)];
    expect(extractAgentFailureDiagnostic(events)).toBeUndefined();
  });
});

// ─── extractFailureMessage ────────────────────────────────────────────────────

describe("extractFailureMessage", () => {
  it("returns undefined when state=completed", () => {
    expect(extractFailureMessage([], "completed", true)).toBeUndefined();
  });

  it("returns 'Agent 被取消' when state=cancelled with no events", () => {
    expect(extractFailureMessage([], "cancelled", false)).toBe("Agent 被取消");
  });

  it("returns error message from failureCode event", () => {
    const events = [
      makeEvent("error", {
        failureCode: "PARSE_MALFORMED_JSON",
        message: "bad",
      }),
    ];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("PARSE_MALFORMED_JSON");
    expect(msg).toContain("bad");
  });

  it("includes diagnostic snippet in message", () => {
    const events = [
      makeEvent("error", {
        failureCode: "RUNNER_OUTPUT_SCHEMA_MISMATCH",
        message: "schema bad",
        diagnostic: { modelId: "test-model", completionTokens: 100 },
      }),
    ];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("test-model");
  });

  it("returns tool call failure message from action_executed error", () => {
    const events = [
      makeEvent("action_executed", { error: { message: "timeout" } }),
    ];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("工具调用失败");
    expect(msg).toContain("timeout");
  });

  it("returns terminated message if present", () => {
    const events = [
      makeEvent("terminated", { reason: "budget", message: "用完了" }),
    ];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toBe("用完了");
  });

  it("returns terminated detail if message absent", () => {
    const events = [
      makeEvent("terminated", { reason: "wall_time", detail: "wall detail" }),
    ];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toBe("wall detail");
  });

  it("explains budget terminated reason", () => {
    const events = [makeEvent("terminated", { reason: "budget" })];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("预算耗尽");
  });

  it("explains iteration_limit terminated reason", () => {
    const events = [makeEvent("terminated", { reason: "iteration_limit" })];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("最大迭代次数");
  });

  it("explains wall_time terminated reason", () => {
    const events = [makeEvent("terminated", { reason: "wall_time" })];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("超时");
  });

  it("fallback when state=failed and hasOutput=false with no events", () => {
    const msg = extractFailureMessage([], "failed", false);
    expect(msg).toContain("未产出有效输出");
  });

  it("fallback when state=failed and hasOutput=true with no events", () => {
    const msg = extractFailureMessage([], "failed", true);
    expect(msg).toContain("outputSchema 校验失败");
  });

  it("detects all-empty observations and returns BYOK hint", () => {
    const events = [
      makeEvent("action_executed", { output: null }),
      makeEvent("action_executed", { output: "" }),
    ];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("空响应");
  });

  it("uses runStats.tokensUsed in context if provided", () => {
    const events = [makeEvent("terminated", { reason: "budget" })];
    const msg = extractFailureMessage(events, "failed", false, {
      tokensUsed: 12345,
      iterations: 5,
    });
    expect(msg).toContain("12345");
  });

  it("handles empty_llm_response terminated reason", () => {
    const events = [makeEvent("terminated", { reason: "empty_llm_response" })];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("立即 finalize 空结果");
  });

  it("uses usedModelId from thinking event in empty_llm_response context", () => {
    const events = [
      makeEvent("thinking", { text: "thinking", modelId: "my-model" }),
      makeEvent("terminated", { reason: "empty_llm_response" }),
    ];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("my-model");
  });

  it("returns reflexion exhaustion message when all verdicts < 70", () => {
    const events = [
      makeEvent("reflection", { score: 50, critique: "not good" }),
      makeEvent("reflection", { score: 55 }),
      makeEvent("terminated", { reason: "budget" }),
    ];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("Reflexion");
  });

  it("handles error event with plain message (no failureCode)", () => {
    const events = [makeEvent("error", { message: "plain error msg" })];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toBe("plain error msg");
  });

  it("explains context_too_long terminated reason", () => {
    const events = [makeEvent("terminated", { reason: "context_too_long" })];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("上下文超长");
  });

  it("state=cancelled → returns Agent 被取消", () => {
    const msg = extractFailureMessage([], "cancelled", false);
    expect(msg).toContain("取消");
  });

  it("reflection event with verdicts array → scores pushed from verdicts array", () => {
    const events = [
      makeEvent("reflection", {
        verdicts: [
          { score: 45, critique: "too short" },
          { score: 50, critique: "no depth" },
        ],
      }),
      makeEvent("terminated", { reason: "budget" }),
    ];
    const msg = extractFailureMessage(events, "failed", false);
    // Verifier exhaustion path should trigger
    expect(msg).toContain("Reflexion");
  });

  it("terminated budget + llmReturnedEmpty → LLM 持续返回空 finalize message", () => {
    // Need finalize events with empty output to trigger llmReturnedEmpty=true
    const events = [
      makeEvent("action_executed", {
        action: { kind: "finalize" },
        output: "",
      }),
      makeEvent("action_executed", {
        action: { kind: "finalize" },
        output: "",
      }),
      makeEvent("terminated", { reason: "budget" }),
    ];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("LLM 持续返回空");
  });

  it("terminated reason=cancelled → includes 取消 message", () => {
    const events = [makeEvent("terminated", { reason: "cancelled" })];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("取消");
  });

  it("terminated reason=error → includes 内部错误", () => {
    const events = [makeEvent("terminated", { reason: "error" })];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("内部错误");
  });

  it("terminated reason=unknown-type → includes 异常终止 default message", () => {
    const events = [makeEvent("terminated", { reason: "some-unknown-reason" })];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("异常终止");
  });

  it("terminated reason=budget with wallTimeMs in runStats → includes 耗时 in detail", () => {
    const events = [makeEvent("terminated", { reason: "budget" })];
    const msg = extractFailureMessage(events, "failed", false, {
      wallTimeMs: 30000,
      iterations: 5,
    });
    expect(msg).toContain("30.0s");
  });

  it("finalize action with null output → counted as empty finalize", () => {
    const events = [
      makeEvent("action_executed", {
        action: { kind: "finalize" },
        output: null,
      }),
      makeEvent("action_executed", {
        action: { kind: "finalize" },
        output: null,
      }),
      makeEvent("terminated", { reason: "budget" }),
    ];
    const msg = extractFailureMessage(events, "failed", false);
    expect(msg).toContain("LLM 持续返回空");
  });
});
