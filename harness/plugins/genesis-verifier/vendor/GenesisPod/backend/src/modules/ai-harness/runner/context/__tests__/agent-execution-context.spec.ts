/**
 * AgentExecutionContext + classifyError + shouldRetry 单测 (PR-M)
 */

import {
  AgentExecutionContext,
  classifyError,
  shouldRetry,
} from "../agent-execution-context";
import type { IContextEnvelope } from "../../../agents/abstractions";

const fakeEnv = {
  id: "x",
  system: "",
  messages: [],
  reminders: [],
  tools: [],
  memory: { sessionId: "s" },
  budget: {
    tokensUsed: 0,
    tokensRemaining: 0,
    iterationsUsed: 0,
    iterationsRemaining: 0,
    wallTimeStartMs: 0,
  },
} as IContextEnvelope;

describe("AgentExecutionContext (PR-M)", () => {
  it("enqueueTask + getEnqueuedTasks round-trip", () => {
    const ctx = new AgentExecutionContext(fakeEnv);
    ctx.enqueueTask({ type: "x.research", input: { topic: "rag" } });
    ctx.enqueueTask({ type: "x.write", input: {}, dependsOn: ["s1"] });
    expect(ctx.getEnqueuedTasks()).toHaveLength(2);
  });

  it("drainEnqueued empties the buffer", () => {
    const ctx = new AgentExecutionContext(fakeEnv);
    ctx.enqueueTask({ type: "x.research", input: {} });
    expect(ctx.drainEnqueued()).toHaveLength(1);
    expect(ctx.getEnqueuedTasks()).toHaveLength(0);
  });

  it("reportFailure appended chronologically", () => {
    const ctx = new AgentExecutionContext(fakeEnv);
    ctx.reportFailure("rate_limit", "openai 429");
    ctx.reportFailure("schema_violation", "missing field x");
    expect(ctx.getReportedFailures()).toHaveLength(2);
    expect(ctx.getReportedFailures()[0].mode).toBe("rate_limit");
  });
});

describe("classifyError (PR-M)", () => {
  it("classifies rate_limit / timeout / context", () => {
    expect(classifyError(new Error("OpenAI 429 rate-limit"))).toBe(
      "rate_limit",
    );
    expect(classifyError(new Error("Request timeout"))).toBe("timeout");
    expect(classifyError(new Error("context too long"))).toBe(
      "context_too_long",
    );
    expect(classifyError(new Error("payment required, no credit"))).toBe(
      "no_credit",
    );
    expect(classifyError(new Error("503 service outage"))).toBe("model_outage");
    expect(classifyError(new Error("zod validation failed"))).toBe(
      "schema_violation",
    );
    expect(classifyError(new Error("???"))).toBe("unknown");
  });

  it("classifies tool_error / invalid_input / user_cancelled", () => {
    expect(classifyError(new Error("tool invocation failed"))).toBe(
      "tool_error",
    );
    expect(classifyError(new Error("invalid input: missing field x"))).toBe(
      "invalid_input",
    );
    expect(classifyError(new Error("Operation aborted by user"))).toBe(
      "user_cancelled",
    );
  });
});

describe("shouldRetry (PR-M)", () => {
  it("returns false when maxRetries reached", () => {
    const r = shouldRetry({ maxRetries: 2 }, "rate_limit", 2);
    expect(r.retry).toBe(false);
  });

  it("respects retryableModes filter", () => {
    const policy = { maxRetries: 3, retryableModes: ["rate_limit" as const] };
    expect(shouldRetry(policy, "rate_limit", 0).retry).toBe(true);
    expect(shouldRetry(policy, "schema_violation", 0).retry).toBe(false);
  });

  it("computes exponential backoff", () => {
    const policy = {
      maxRetries: 5,
      backoff: "exponential" as const,
      initialDelayMs: 100,
    };
    expect(shouldRetry(policy, "timeout", 0).delayMs).toBe(100);
    expect(shouldRetry(policy, "timeout", 1).delayMs).toBe(200);
    expect(shouldRetry(policy, "timeout", 2).delayMs).toBe(400);
  });

  it("clamps delay to 30s", () => {
    const policy = {
      maxRetries: 20,
      backoff: "exponential" as const,
      initialDelayMs: 1000,
    };
    expect(shouldRetry(policy, "timeout", 10).delayMs).toBe(30_000);
  });
});
