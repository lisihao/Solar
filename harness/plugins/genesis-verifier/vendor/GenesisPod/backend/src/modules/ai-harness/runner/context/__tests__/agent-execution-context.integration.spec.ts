import {
  AgentExecutionContext,
  classifyError,
  shouldRetry,
} from "../agent-execution-context";

const mockEnvelope = {} as never;

describe("AgentExecutionContext", () => {
  it("enqueueTask and getEnqueuedTasks", () => {
    const ctx = new AgentExecutionContext(mockEnvelope);
    ctx.enqueueTask({ type: "analyze", input: { q: "test" } });
    ctx.enqueueTask({ type: "summarize", input: {}, dependsOn: ["t1"] });
    const tasks = ctx.getEnqueuedTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0].type).toBe("analyze");
    expect(tasks[1].dependsOn).toEqual(["t1"]);
  });

  it("reportFailure and getReportedFailures", () => {
    const ctx = new AgentExecutionContext(mockEnvelope);
    ctx.reportFailure("timeout", "connection timed out");
    ctx.reportFailure("rate_limit");
    const failures = ctx.getReportedFailures();
    expect(failures).toHaveLength(2);
    expect(failures[0].mode).toBe("timeout");
    expect(failures[0].detail).toBe("connection timed out");
    expect(failures[1].mode).toBe("rate_limit");
    expect(failures[1].detail).toBeUndefined();
  });

  it("drainEnqueued clears the queue", () => {
    const ctx = new AgentExecutionContext(mockEnvelope);
    ctx.enqueueTask({ type: "t1", input: {} });
    ctx.enqueueTask({ type: "t2", input: {} });
    const drained = ctx.drainEnqueued();
    expect(drained).toHaveLength(2);
    expect(ctx.getEnqueuedTasks()).toHaveLength(0);
  });

  it("envelope is exposed", () => {
    const envelope = { system: "hello" } as never;
    const ctx = new AgentExecutionContext(envelope);
    expect(ctx.envelope).toBe(envelope);
  });
});

describe("classifyError", () => {
  const cases: Array<[string, string]> = [
    ["abort requested by user", "user_cancelled"],
    ["request timeout after 30s", "timeout"],
    ["rate_limit exceeded (429)", "rate_limit"],
    ["context too long for model", "context_too_long"],
    ["context window exceeded by 100 tokens", "context_too_long"],
    ["credit limit reached", "no_credit"],
    ["outage detected on provider", "model_outage"],
    ["schema validation failed (zod)", "schema_violation"],
    ["tool invocation error", "tool_error"],
    ["invalid input: missing field", "invalid_input"],
    ["something completely unknown", "unknown"],
    ["503 service unavailable", "model_outage"],
    ["quota exceeded", "no_credit"],
    ["payment required", "no_credit"],
  ];

  test.each(cases)("classifies '%s' as '%s'", (message, expected) => {
    expect(classifyError(new Error(message))).toBe(expected);
  });
});

describe("shouldRetry", () => {
  it("returns no retry when policy is undefined", () => {
    const result = shouldRetry(undefined, "timeout", 0);
    expect(result.retry).toBe(false);
  });

  it("returns no retry when attempt >= maxRetries", () => {
    const result = shouldRetry({ maxRetries: 3 }, "timeout", 3);
    expect(result.retry).toBe(false);
  });

  it("returns no retry when mode not in retryableModes", () => {
    const result = shouldRetry(
      { maxRetries: 3, retryableModes: ["rate_limit"] },
      "timeout",
      0,
    );
    expect(result.retry).toBe(false);
  });

  it("returns retry with constant backoff", () => {
    const result = shouldRetry(
      { maxRetries: 3, backoff: "constant", initialDelayMs: 200 },
      "timeout",
      0,
    );
    expect(result.retry).toBe(true);
    expect(result.delayMs).toBe(200);
  });

  it("returns retry with linear backoff", () => {
    const result = shouldRetry(
      { maxRetries: 3, backoff: "linear", initialDelayMs: 100 },
      "timeout",
      2,
    );
    expect(result.retry).toBe(true);
    expect(result.delayMs).toBe(300); // 100 * (2+1)
  });

  it("returns retry with exponential backoff", () => {
    const result = shouldRetry(
      { maxRetries: 5, backoff: "exponential", initialDelayMs: 100 },
      "timeout",
      2,
    );
    expect(result.retry).toBe(true);
    expect(result.delayMs).toBe(400); // 100 * 2^2
  });

  it("caps delay at 30000ms", () => {
    const result = shouldRetry(
      { maxRetries: 10, backoff: "exponential", initialDelayMs: 1000 },
      "timeout",
      8,
    );
    expect(result.delayMs).toBe(30_000);
  });

  it("retries when mode in retryableModes", () => {
    const result = shouldRetry(
      { maxRetries: 3, retryableModes: ["rate_limit", "timeout"] },
      "rate_limit",
      0,
    );
    expect(result.retry).toBe(true);
  });

  it("uses default initialDelayMs of 500", () => {
    const result = shouldRetry({ maxRetries: 3 }, "timeout", 0);
    expect(result.retry).toBe(true);
    expect(result.delayMs).toBe(500);
  });
});
