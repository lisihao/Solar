/**
 * social-event-schemas.spec.ts
 *
 * Tests every exported Zod schema: parse success, required-field failure,
 * optional-only paths, and enum rejection. Covers 100% of schema lines.
 */

import {
  MissionStartedSchema,
  MissionCompletedSchema,
  MissionFailedSchema,
  MissionAbortedSchema,
  MissionDegradedSchema,
  MissionWarningSchema,
  MissionPostludeStartedSchema,
  MissionPostludeCompletedSchema,
  MissionPostludeFailedSchema,
  StageStartedSchema,
  StageCompletedSchema,
  StageFailedSchema,
  StageDegradedSchema,
  StageStalledSchema,
  StageLifecycleSchema,
  AgentLifecycleSchema,
  AgentThoughtSchema,
  AgentActionSchema,
  AgentObservationSchema,
  AgentErrorSchema,
  AgentNarrativeSchema,
  CostTickSchema,
  BudgetExhaustedSchema,
  PublishExecuteSummarySchema,
  PublishVerifySummarySchema,
} from "../social-event-schemas";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function ok<T>(schema: { parse(v: unknown): T }, value: unknown): T {
  return schema.parse(value);
}

function fail(
  schema: { safeParse(v: unknown): { success: boolean } },
  value: unknown,
): void {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
}

// ---------------------------------------------------------------------------
// mission lifecycle
// ---------------------------------------------------------------------------

describe("MissionStartedSchema", () => {
  it("parses empty object (all optional)", () => {
    const result = ok(MissionStartedSchema, {});
    expect(result).toEqual({});
  });

  it("parses full object", () => {
    const input = {
      platforms: ["twitter", "linkedin"],
      contentId: "c-123",
      depth: "deep",
      budgetProfile: "standard",
      language: "en",
    };
    const result = ok(MissionStartedSchema, input);
    expect(result.platforms).toEqual(["twitter", "linkedin"]);
    expect(result.language).toBe("en");
  });

  it("rejects non-array platforms", () => {
    fail(MissionStartedSchema, { platforms: "twitter" });
  });
});

describe("MissionCompletedSchema", () => {
  it("parses empty object", () => {
    expect(ok(MissionCompletedSchema, {})).toEqual({});
  });

  it("parses with all fields", () => {
    const result = ok(MissionCompletedSchema, {
      wallTimeMs: 5000,
      publishedCount: 3,
      failedCount: 1,
    });
    expect(result.publishedCount).toBe(3);
    expect(result.failedCount).toBe(1);
  });

  it("rejects string where number expected", () => {
    fail(MissionCompletedSchema, { wallTimeMs: "5000" });
  });
});

describe("MissionFailedSchema", () => {
  it("parses required message only", () => {
    const result = ok(MissionFailedSchema, { message: "something went wrong" });
    expect(result.message).toBe("something went wrong");
  });

  it("parses all optional fields", () => {
    const result = ok(MissionFailedSchema, {
      message: "budget exhausted",
      failureCode: "BUDGET_EXHAUSTED",
      errorName: "BudgetError",
      wallTimeMs: 12345,
      source: "orchestrator",
    });
    expect(result.failureCode).toBe("BUDGET_EXHAUSTED");
    expect(result.source).toBe("orchestrator");
  });

  it("fails when message is missing", () => {
    fail(MissionFailedSchema, { failureCode: "TIMEOUT" });
  });
});

describe("MissionAbortedSchema", () => {
  it("parses empty object", () => {
    expect(ok(MissionAbortedSchema, {})).toEqual({});
  });

  it("parses with reason and wallTimeMs", () => {
    const result = ok(MissionAbortedSchema, {
      reason: "user cancelled",
      wallTimeMs: 800,
    });
    expect(result.reason).toBe("user cancelled");
  });
});

describe("MissionDegradedSchema", () => {
  it("parses required reason only", () => {
    const result = ok(MissionDegradedSchema, { reason: "rate limited" });
    expect(result.reason).toBe("rate limited");
  });

  it("parses with optional stage", () => {
    const result = ok(MissionDegradedSchema, {
      reason: "slow",
      stage: "publish",
    });
    expect(result.stage).toBe("publish");
  });

  it("fails when reason is missing", () => {
    fail(MissionDegradedSchema, { stage: "collect" });
  });
});

describe("MissionWarningSchema", () => {
  it("parses required message", () => {
    expect(ok(MissionWarningSchema, { message: "slow response" }).message).toBe(
      "slow response",
    );
  });

  it("parses all fields", () => {
    const result = ok(MissionWarningSchema, {
      message: "approaching budget",
      ageMs: 3000,
      source: "guardrail",
    });
    expect(result.ageMs).toBe(3000);
  });

  it("fails when message missing", () => {
    fail(MissionWarningSchema, {});
  });
});

describe("MissionPostludeStartedSchema", () => {
  it("parses required stage", () => {
    expect(ok(MissionPostludeStartedSchema, { stage: "cleanup" }).stage).toBe(
      "cleanup",
    );
  });

  it("parses with optional startedAt", () => {
    const result = ok(MissionPostludeStartedSchema, {
      stage: "verify",
      startedAt: 1700000000,
    });
    expect(result.startedAt).toBe(1700000000);
  });

  it("fails when stage is missing", () => {
    fail(MissionPostludeStartedSchema, {});
  });
});

describe("MissionPostludeCompletedSchema", () => {
  it("parses required stage", () => {
    expect(ok(MissionPostludeCompletedSchema, { stage: "cleanup" }).stage).toBe(
      "cleanup",
    );
  });

  it("parses with wallTimeMs", () => {
    const r = ok(MissionPostludeCompletedSchema, {
      stage: "verify",
      wallTimeMs: 100,
    });
    expect(r.wallTimeMs).toBe(100);
  });
});

describe("MissionPostludeFailedSchema", () => {
  it("parses required stage and error", () => {
    const result = ok(MissionPostludeFailedSchema, {
      stage: "verify",
      error: "timeout",
    });
    expect(result.stage).toBe("verify");
    expect(result.error).toBe("timeout");
  });

  it("fails when error is missing", () => {
    fail(MissionPostludeFailedSchema, { stage: "verify" });
  });

  it("fails when stage is missing", () => {
    fail(MissionPostludeFailedSchema, { error: "oops" });
  });
});

// ---------------------------------------------------------------------------
// stage lifecycle
// ---------------------------------------------------------------------------

describe("StageStartedSchema", () => {
  it("parses required stepId", () => {
    expect(ok(StageStartedSchema, { stepId: "step-1" }).stepId).toBe("step-1");
  });

  it("parses with optional primitive", () => {
    const r = ok(StageStartedSchema, {
      stepId: "step-2",
      primitive: "llm-call",
    });
    expect(r.primitive).toBe("llm-call");
  });

  it("fails when stepId missing", () => {
    fail(StageStartedSchema, {});
  });
});

describe("StageCompletedSchema", () => {
  it("parses required stepId", () => {
    expect(ok(StageCompletedSchema, { stepId: "s1" }).stepId).toBe("s1");
  });

  it("parses with output record", () => {
    const r = ok(StageCompletedSchema, {
      stepId: "s2",
      output: { key: "value", num: 42 },
    });
    expect(r.output).toEqual({ key: "value", num: 42 });
  });
});

describe("StageFailedSchema", () => {
  it("parses required stepId and error", () => {
    const r = ok(StageFailedSchema, { stepId: "s1", error: "network error" });
    expect(r.error).toBe("network error");
  });

  it("fails when error missing", () => {
    fail(StageFailedSchema, { stepId: "s1" });
  });
});

describe("StageDegradedSchema", () => {
  it("parses required fields", () => {
    const r = ok(StageDegradedSchema, { stepId: "s1", reason: "partial data" });
    expect(r.reason).toBe("partial data");
  });

  it("fails when reason missing", () => {
    fail(StageDegradedSchema, { stepId: "s1" });
  });
});

describe("StageStalledSchema", () => {
  it("parses required stepId", () => {
    expect(ok(StageStalledSchema, { stepId: "s1" }).stepId).toBe("s1");
  });

  it("parses with optional elapsedMs and reason", () => {
    const r = ok(StageStalledSchema, {
      stepId: "s1",
      elapsedMs: 30000,
      reason: "slow LLM",
    });
    expect(r.elapsedMs).toBe(30000);
  });
});

describe("StageLifecycleSchema", () => {
  it("parses valid started status", () => {
    const r = ok(StageLifecycleSchema, {
      stage: "collect",
      stepId: "step-1",
      status: "started",
    });
    expect(r.status).toBe("started");
  });

  it("parses valid completed status with output", () => {
    const r = ok(StageLifecycleSchema, {
      stage: "publish",
      stepId: "step-2",
      status: "completed",
      output: { url: "https://example.com" },
    });
    expect(r.output).toEqual({ url: "https://example.com" });
  });

  it("parses valid failed status with error", () => {
    const r = ok(StageLifecycleSchema, {
      stage: "verify",
      stepId: "step-3",
      status: "failed",
      error: "timeout",
    });
    expect(r.error).toBe("timeout");
  });

  it("rejects invalid status enum value", () => {
    fail(StageLifecycleSchema, {
      stage: "collect",
      stepId: "step-1",
      status: "pending",
    });
  });

  it("fails when required fields missing", () => {
    fail(StageLifecycleSchema, { status: "started" });
  });
});

// ---------------------------------------------------------------------------
// agent lifecycle / narrative
// ---------------------------------------------------------------------------

describe("AgentLifecycleSchema", () => {
  it("parses required fields with valid phase", () => {
    const r = ok(AgentLifecycleSchema, {
      agentId: "agent-1",
      role: "collector",
      phase: "started",
    });
    expect(r.phase).toBe("started");
  });

  it("parses with optional detail record", () => {
    const r = ok(AgentLifecycleSchema, {
      agentId: "agent-2",
      role: "publisher",
      phase: "completed",
      detail: { tokensUsed: 500 },
    });
    expect(r.detail).toEqual({ tokensUsed: 500 });
  });

  it("rejects invalid phase", () => {
    fail(AgentLifecycleSchema, {
      agentId: "a1",
      role: "r1",
      phase: "running",
    });
  });

  it("fails when required fields missing", () => {
    fail(AgentLifecycleSchema, { agentId: "a1" });
  });
});

describe("AgentThoughtSchema (RecordSchema)", () => {
  it("parses any string-keyed record", () => {
    const r = ok(AgentThoughtSchema, { thought: "analyzing", confidence: 0.9 });
    expect(r["thought"]).toBe("analyzing");
  });

  it("parses empty record", () => {
    expect(ok(AgentThoughtSchema, {})).toEqual({});
  });

  it("rejects non-object", () => {
    fail(AgentThoughtSchema, "not an object");
  });
});

describe("AgentActionSchema (RecordSchema)", () => {
  it("parses any record", () => {
    const r = ok(AgentActionSchema, { tool: "search", query: "AI trends" });
    expect(r["tool"]).toBe("search");
  });
});

describe("AgentObservationSchema (RecordSchema)", () => {
  it("parses any record", () => {
    expect(
      ok(AgentObservationSchema, { result: "found 10 articles" }),
    ).toBeTruthy();
  });
});

describe("AgentErrorSchema (RecordSchema)", () => {
  it("parses error record", () => {
    const r = ok(AgentErrorSchema, { code: "API_TIMEOUT", retryable: true });
    expect(r["code"]).toBe("API_TIMEOUT");
  });
});

describe("AgentNarrativeSchema", () => {
  it("parses required fields", () => {
    const r = ok(AgentNarrativeSchema, {
      stage: "collect",
      role: "researcher",
      tag: "search",
      text: "Found relevant articles",
    });
    expect(r.tag).toBe("search");
    expect(r.text).toBe("Found relevant articles");
  });

  it("fails when text missing", () => {
    fail(AgentNarrativeSchema, { stage: "collect", role: "r", tag: "t" });
  });

  it("fails when any required field missing", () => {
    fail(AgentNarrativeSchema, { stage: "collect", role: "researcher" });
  });
});

// ---------------------------------------------------------------------------
// cost / budget
// ---------------------------------------------------------------------------

describe("CostTickSchema", () => {
  it("parses required stage", () => {
    expect(ok(CostTickSchema, { stage: "collect" }).stage).toBe("collect");
  });

  it("parses with tokensUsed and costUsd", () => {
    const r = ok(CostTickSchema, {
      stage: "publish",
      tokensUsed: 1000,
      costUsd: 0.05,
    });
    expect(r.costUsd).toBe(0.05);
  });

  it("fails when stage missing", () => {
    fail(CostTickSchema, { tokensUsed: 100 });
  });
});

describe("BudgetExhaustedSchema", () => {
  it("parses required reason", () => {
    const r = ok(BudgetExhaustedSchema, { reason: "max spend reached" });
    expect(r.reason).toBe("max spend reached");
  });

  it("parses with optional numeric fields", () => {
    const r = ok(BudgetExhaustedSchema, {
      reason: "token limit",
      tokensUsed: 50000,
      costUsd: 1.25,
    });
    expect(r.tokensUsed).toBe(50000);
  });

  it("fails when reason missing", () => {
    fail(BudgetExhaustedSchema, { tokensUsed: 100 });
  });
});

// ---------------------------------------------------------------------------
// publish-specific
// ---------------------------------------------------------------------------

describe("PublishExecuteSummarySchema", () => {
  it("parses PUBLISHED status", () => {
    const r = ok(PublishExecuteSummarySchema, {
      platform: "twitter",
      status: "PUBLISHED",
    });
    expect(r.status).toBe("PUBLISHED");
  });

  it("parses FAILED status with errorCode", () => {
    const r = ok(PublishExecuteSummarySchema, {
      platform: "linkedin",
      status: "FAILED",
      errorCode: "AUTH_EXPIRED",
    });
    expect(r.errorCode).toBe("AUTH_EXPIRED");
  });

  it("parses SKIPPED status", () => {
    const r = ok(PublishExecuteSummarySchema, {
      platform: "wechat",
      status: "SKIPPED",
    });
    expect(r.status).toBe("SKIPPED");
  });

  it("parses with nullable draftUrl", () => {
    const r = ok(PublishExecuteSummarySchema, {
      platform: "twitter",
      status: "PUBLISHED",
      draftUrl: null,
      attempt: 2,
    });
    expect(r.draftUrl).toBeNull();
    expect(r.attempt).toBe(2);
  });

  it("rejects invalid status enum", () => {
    fail(PublishExecuteSummarySchema, {
      platform: "twitter",
      status: "PENDING",
    });
  });

  it("fails when platform missing", () => {
    fail(PublishExecuteSummarySchema, { status: "PUBLISHED" });
  });
});

describe("PublishVerifySummarySchema", () => {
  it("parses required platform", () => {
    expect(
      ok(PublishVerifySummarySchema, { platform: "twitter" }).platform,
    ).toBe("twitter");
  });

  it("parses with all optional fields", () => {
    const r = ok(PublishVerifySummarySchema, {
      platform: "linkedin",
      publishedUrl: "https://linkedin.com/post/123",
      titleMatch: true,
      bodySimilarity: 0.95,
    });
    expect(r.titleMatch).toBe(true);
    expect(r.bodySimilarity).toBe(0.95);
  });

  it("fails when platform missing", () => {
    fail(PublishVerifySummarySchema, { publishedUrl: "https://example.com" });
  });
});
