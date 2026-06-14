/**
 * AnalystAgent 单元测试
 *
 * 覆盖：inputSchema / outputSchema / buildSystemPrompt
 * (AnalystAgent 没有 validateBusinessRules)
 */

import { AnalystAgent } from "../analyst.agent";
import { readDefineAgentMeta } from "@/modules/ai-harness/agents/dev-tools/agent-spec.base";

function getMeta() {
  const meta = readDefineAgentMeta(AnalystAgent);
  if (!meta) throw new Error("@DefineAgent metadata missing");
  return meta;
}

// ── Helpers ──────────────────────────────────────────────────────────

function validResearcherFinding(dimension = "Policy Analysis") {
  return {
    dimension,
    findings: [
      {
        claim: "AI governance frameworks now required in EU from 2025",
        evidence: "EU AI Act enforcement began March 2025",
        source: "https://ec.europa.eu/ai-act",
      },
    ],
    summary:
      "Regulatory landscape increasingly stringent with hard enforcement deadlines.",
  };
}

function validInput() {
  return {
    topic: "AI Regulation Impact 2025",
    language: "en-US" as const,
    researcherResults: [validResearcherFinding()],
  };
}

function validInsight(
  overrides: Partial<{
    headline: string;
    narrative: string;
    supportingDimensions: string[];
    confidence: number;
  }> = {},
) {
  return {
    headline: "Regulatory pressure accelerating enterprise AI adoption",
    narrative:
      "The EU AI Act and similar frameworks are forcing enterprises to audit their AI systems. This creates both compliance costs and competitive opportunities for compliant vendors.",
    supportingDimensions: ["Policy Analysis", "Market Impact"],
    confidence: 0.85,
    ...overrides,
  };
}

function validOutput() {
  return {
    insights: [
      validInsight(),
      validInsight({ headline: "Second insight title", confidence: 0.7 }),
      validInsight({ headline: "Third insight title", confidence: 0.6 }),
    ],
    themeSummary:
      "AI regulation is reshaping enterprise technology strategies globally.",
    contradictions: [],
  };
}

// ── InputSchema ──────────────────────────────────────────────────────

describe("AnalystAgent — inputSchema", () => {
  const { inputSchema } = getMeta();

  it("accepts minimal valid input", () => {
    const r = inputSchema.safeParse(validInput());
    expect(r.success).toBe(true);
  });

  it("accepts zh-CN language", () => {
    const r = inputSchema.safeParse({ ...validInput(), language: "zh-CN" });
    expect(r.success).toBe(true);
  });

  it("accepts multiple researcherResults", () => {
    const r = inputSchema.safeParse({
      ...validInput(),
      researcherResults: [
        validResearcherFinding("Policy Analysis"),
        validResearcherFinding("Market Impact"),
        validResearcherFinding("Technical Capabilities"),
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts input with reconciliationReport (conflicts)", () => {
    const r = inputSchema.safeParse({
      ...validInput(),
      reconciliationReport: {
        conflicts: [
          {
            factIds: ["fact-1", "fact-2"],
            resolutionType: "preferred-one",
            preferredFactId: "fact-1",
            rationale: "OpenAI official source is more reliable",
          },
        ],
      },
    });
    expect(r.success).toBe(true);
  });

  it("accepts input with reconciliationReport (full)", () => {
    const r = inputSchema.safeParse({
      ...validInput(),
      reconciliationReport: {
        factTable: [
          {
            id: "fact-1",
            entity: "GPT-4",
            attribute: "launch",
            value: "2023-03",
            sources: [],
          },
        ],
        conflicts: [],
        overlaps: [],
        gaps: [],
        reconciliationReport: "# Overview\nAll facts reconciled successfully.",
        termGlossary: [
          {
            canonical: "AI",
            variants: ["Artificial Intelligence", "机器学习"],
          },
        ],
      },
    });
    expect(r.success).toBe(true);
  });

  it("accepts input with retryHint", () => {
    const r = inputSchema.safeParse({
      ...validInput(),
      retryHint:
        "Previous output was null — please return valid JSON matching the schema",
    });
    expect(r.success).toBe(true);
  });

  it("rejects input missing topic", () => {
    const { topic: _t, ...rest } = validInput();
    const r = inputSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects input with empty researcherResults", () => {
    const r = inputSchema.safeParse({ ...validInput(), researcherResults: [] });
    expect(r.success).toBe(false);
  });

  it("rejects invalid language", () => {
    const r = inputSchema.safeParse({ ...validInput(), language: "es-ES" });
    expect(r.success).toBe(false);
  });

  it("rejects missing language", () => {
    const { language: _l, ...rest } = validInput();
    const r = inputSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("accepts researcherFinding with source min length 1", () => {
    const r = inputSchema.safeParse({
      ...validInput(),
      researcherResults: [
        {
          dimension: "Policy",
          findings: [
            { claim: "Some claim", evidence: "Some evidence", source: "x" },
          ],
          summary: "Summary",
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects reconciliationReport with invalid conflict resolutionType", () => {
    const r = inputSchema.safeParse({
      ...validInput(),
      reconciliationReport: {
        conflicts: [
          {
            factIds: ["fact-1", "fact-2"],
            resolutionType: "invalid-type",
            rationale: "Some rationale",
          },
        ],
      },
    });
    expect(r.success).toBe(false);
  });
});

// ── OutputSchema ─────────────────────────────────────────────────────

describe("AnalystAgent — outputSchema", () => {
  const { outputSchema } = getMeta();

  it("accepts minimal valid output (insights + themeSummary)", () => {
    const r = outputSchema.safeParse({
      insights: [validInsight()],
      themeSummary: "AI regulation reshaping enterprise strategies.",
    });
    expect(r.success).toBe(true);
  });

  it("accepts output with contradictions", () => {
    const r = outputSchema.safeParse({
      ...validOutput(),
      contradictions: [
        {
          claim: "AI market size is $200B vs $150B",
          conflictingSources: ["https://idc.com", "https://gartner.com"],
          resolution:
            "Preferred IDC estimate as it uses consistent methodology",
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts output without contradictions field", () => {
    const { contradictions: _c, ...rest } = validOutput();
    const r = outputSchema.safeParse(rest);
    expect(r.success).toBe(true);
  });

  it("accepts insight with confidence=0 (boundary)", () => {
    const r = outputSchema.safeParse({
      insights: [validInsight({ confidence: 0 })],
      themeSummary: "Analysis complete.",
    });
    expect(r.success).toBe(true);
  });

  it("accepts insight with confidence=1 (boundary)", () => {
    const r = outputSchema.safeParse({
      insights: [validInsight({ confidence: 1 })],
      themeSummary: "Analysis complete.",
    });
    expect(r.success).toBe(true);
  });

  it("rejects insight with confidence > 1", () => {
    const r = outputSchema.safeParse({
      insights: [validInsight({ confidence: 1.5 })],
      themeSummary: "Analysis complete.",
    });
    expect(r.success).toBe(false);
  });

  it("rejects insight with confidence < 0", () => {
    const r = outputSchema.safeParse({
      insights: [validInsight({ confidence: -0.1 })],
      themeSummary: "Analysis complete.",
    });
    expect(r.success).toBe(false);
  });

  it("rejects output missing insights", () => {
    const r = outputSchema.safeParse({ themeSummary: "Summary" });
    expect(r.success).toBe(false);
  });

  it("rejects output missing themeSummary", () => {
    const r = outputSchema.safeParse({ insights: [validInsight()] });
    expect(r.success).toBe(false);
  });

  it("accepts multiple insights", () => {
    const r = outputSchema.safeParse({
      insights: Array.from({ length: 7 }, (_, i) =>
        validInsight({
          headline: `Insight ${i + 1}`,
          confidence: 0.5 + i * 0.05,
        }),
      ),
      themeSummary: "Comprehensive multi-dimension analysis of AI market.",
    });
    expect(r.success).toBe(true);
  });

  it("rejects insight with empty supportingDimensions (min not enforced but array must be present)", () => {
    // supportingDimensions is z.array(z.string()) — no min, so empty is allowed
    const r = outputSchema.safeParse({
      insights: [validInsight({ supportingDimensions: [] })],
      themeSummary: "Summary.",
    });
    expect(r.success).toBe(true);
  });
});

// ── buildSystemPrompt ─────────────────────────────────────────────────

describe("AnalystAgent — buildSystemPrompt", () => {
  const agent = new AnalystAgent();
  const identity = { role: "analyst", description: "test" };

  it("returns non-empty string for basic input", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(50);
  });

  it("contains topic in prompt", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(result).toContain("AI Regulation Impact 2025");
  });

  it("contains number of research dimensions", () => {
    const result = agent.buildSystemPrompt({
      input: {
        ...validInput(),
        researcherResults: [
          validResearcherFinding("Policy"),
          validResearcherFinding("Market"),
        ],
      },
      identity,
    });
    expect(result).toContain("2");
  });

  it("contains language in prompt", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(result).toContain("en-US");
  });

  it("includes conflict block when reconciliationReport has conflicts", () => {
    const inputWithConflicts = {
      ...validInput(),
      reconciliationReport: {
        conflicts: [
          {
            factIds: ["fact-1", "fact-2"],
            resolutionType: "preferred-one" as const,
            preferredFactId: "fact-1",
            rationale:
              "Primary source has higher credibility for this specific data point",
          },
        ],
      },
    };
    const result = agent.buildSystemPrompt({
      input: inputWithConflicts,
      identity,
    });
    expect(result).toContain("Reconciler");
    expect(result).toContain("preferred-one");
    expect(result).toContain("fact-1");
  });

  it("omits conflict block when reconciliationReport has no conflicts", () => {
    const inputNoConflicts = {
      ...validInput(),
      reconciliationReport: { conflicts: [] },
    };
    const result = agent.buildSystemPrompt({
      input: inputNoConflicts,
      identity,
    });
    expect(result).not.toContain("Reconciler 已识别冲突");
  });

  it("includes reconciliation report block when reconciliationReport string present", () => {
    const inputWithReport = {
      ...validInput(),
      reconciliationReport: {
        reconciliationReport:
          "# Overview\nAll facts from 3 dimensions reconciled, 1 conflict detected.",
      },
    };
    const result = agent.buildSystemPrompt({
      input: inputWithReport,
      identity,
    });
    expect(result).toContain("# Overview");
    expect(result).toContain("1 conflict detected");
  });

  it("omits reconciliation report block when no reconciliationReport string", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(result).not.toContain("Reconciler 总览");
  });

  it("includes term glossary block when termGlossary present", () => {
    const inputWithGlossary = {
      ...validInput(),
      reconciliationReport: {
        termGlossary: [
          {
            canonical: "人工智能",
            variants: ["AI", "Artificial Intelligence"],
          },
        ],
      },
    };
    const result = agent.buildSystemPrompt({
      input: inputWithGlossary,
      identity,
    });
    expect(result).toContain("人工智能");
    expect(result).toContain("AI");
  });

  it("omits term glossary block when termGlossary is empty", () => {
    const inputEmptyGlossary = {
      ...validInput(),
      reconciliationReport: { termGlossary: [] },
    };
    const result = agent.buildSystemPrompt({
      input: inputEmptyGlossary,
      identity,
    });
    expect(result).not.toContain("术语统一");
  });

  it("includes retryHint block when retryHint provided", () => {
    const inputWithHint = {
      ...validInput(),
      retryHint:
        "Previous output was null. Return valid JSON matching the output schema exactly.",
    };
    const result = agent.buildSystemPrompt({ input: inputWithHint, identity });
    expect(result).toContain("Previous output was null");
    expect(result).toContain("Retry");
  });

  it("omits retryHint block when retryHint not provided", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(result).not.toContain("Retry 提示");
  });

  it("contains instruction for 3-7 insights", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(result).toContain("3-7");
  });

  it("contains contradictions instruction", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(result).toContain("contradictions");
  });

  it("contains confidence score instruction", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(result).toContain("confidence");
  });

  it("reconciliationReport report is truncated to 1500 chars max in prompt", () => {
    // 头部 1500 字与尾部 600 字用唯一 marker 区分，避免重复字串带来的误判
    const head = "HEAD_KEEP_" + "x".repeat(1490); // 1500 chars
    const tail = "TAIL_TRUNCATE_" + "y".repeat(586); // 600 chars
    const longReport = head + tail;
    const inputWithLongReport = {
      ...validInput(),
      reconciliationReport: { reconciliationReport: longReport },
    };
    const result = agent.buildSystemPrompt({
      input: inputWithLongReport,
      identity,
    });
    expect(result).toContain("HEAD_KEEP_"); // 头部保留
    expect(result).not.toContain("TAIL_TRUNCATE_"); // 尾部被截
  });

  it("conflict block truncates rationale to 120 chars", () => {
    const longRationale =
      "A very detailed rationale explaining why one source is more reliable than another for this specific data point about AI market size in 2025.";
    const inputWithLongRationale = {
      ...validInput(),
      reconciliationReport: {
        conflicts: [
          {
            factIds: ["fact-1", "fact-2"],
            resolutionType: "preferred-one" as const,
            preferredFactId: "fact-1",
            rationale: longRationale,
          },
        ],
      },
    };
    const result = agent.buildSystemPrompt({
      input: inputWithLongRationale,
      identity,
    });
    // Should contain first 120 chars of rationale
    expect(result).toContain(longRationale.slice(0, 80));
  });
});
