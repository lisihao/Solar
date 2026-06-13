/**
 * ReconcilerAgent 单元测试
 *
 * 覆盖：inputSchema / outputSchema / validateBusinessRules / buildSystemPrompt
 */

import { ReconcilerAgent } from "../reconciler.agent";
import { readDefineAgentMeta } from "../../../../../../ai-harness/agents/dev-tools/agent-spec.base";

function getMeta() {
  const meta = readDefineAgentMeta(ReconcilerAgent);
  if (!meta) throw new Error("@DefineAgent metadata missing");
  return meta;
}

// ── Helpers ──────────────────────────────────────────────────────────

function validFact(
  id: string,
  entity = "GPT-4",
  attribute = "launch_date",
  value = "2023-03",
) {
  return {
    id,
    entity,
    attribute,
    value,
    sources: ["https://openai.com/blog/gpt-4"],
  };
}

function validConflict(
  factIds: string[],
  resolution:
    | "kept-both"
    | "preferred-one"
    | "flagged-unresolved" = "preferred-one",
) {
  return {
    factIds,
    resolutionType: resolution,
    preferredFactId: resolution === "preferred-one" ? factIds[0] : undefined,
    rationale:
      "Academic source has higher credibility than blog post for this data point",
  };
}

function validInput() {
  return {
    topic: "AI Market Trends 2025",
    language: "en-US" as const,
    plan: {
      themeSummary: "Comprehensive AI market analysis",
      dimensions: [
        {
          id: "dim-1",
          name: "Market Size",
          rationale: "Revenue and adoption numbers",
        },
        {
          id: "dim-2",
          name: "Key Players",
          rationale: "Competitive landscape",
        },
      ],
    },
    researcherResults: [
      {
        dimension: "Market Size",
        findings: [
          {
            claim: "AI market reached $200B in 2025",
            evidence: "IDC report",
            source: "https://idc.com",
          },
        ],
        summary: "Market growing rapidly",
        figureCandidates: [],
      },
    ],
  };
}

function validOutput() {
  return {
    factTable: [
      validFact("fact-1"),
      validFact("fact-2", "Claude", "launch_date", "2023-07"),
      validFact("fact-3", "Gemini", "launch_date", "2023-12"),
    ],
    conflicts: [],
    overlaps: [],
    gaps: [],
    figureCandidates: [],
    reconciliationReport:
      "# Reconciliation Overview\n## Fact Table\n3 facts extracted, no conflicts detected, all dimensions covered.",
    termGlossary: [],
  };
}

// ── InputSchema ──────────────────────────────────────────────────────

describe("ReconcilerAgent — inputSchema", () => {
  const { inputSchema } = getMeta();

  it("accepts valid minimal input", () => {
    const r = inputSchema.safeParse(validInput());
    expect(r.success).toBe(true);
  });

  it("accepts input with zh-CN language", () => {
    const r = inputSchema.safeParse({ ...validInput(), language: "zh-CN" });
    expect(r.success).toBe(true);
  });

  it("accepts researcherResults with figureCandidates", () => {
    const r = inputSchema.safeParse({
      ...validInput(),
      researcherResults: [
        {
          ...validInput().researcherResults[0],
          figureCandidates: [
            {
              sourceUrl: "https://mckinsey.com/report",
              caption: "Market share pie chart",
              relevanceHint: "high",
            },
          ],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts researcherResults with optional imageUrl and sourcePageOrSection", () => {
    const r = inputSchema.safeParse({
      ...validInput(),
      researcherResults: [
        {
          ...validInput().researcherResults[0],
          figureCandidates: [
            {
              sourceUrl: "https://arxiv.org/abs/2401.12345",
              imageUrl: "https://arxiv.org/fig1.png",
              caption: "Architecture diagram",
              sourcePageOrSection: "Figure 3",
              relevanceHint: "high",
            },
          ],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects input missing topic", () => {
    const { topic: _t, ...rest } = validInput();
    const r = inputSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects invalid language", () => {
    const r = inputSchema.safeParse({ ...validInput(), language: "de-DE" });
    expect(r.success).toBe(false);
  });

  it("rejects input missing plan", () => {
    const { plan: _p, ...rest } = validInput();
    const r = inputSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects missing researcherResults", () => {
    const { researcherResults: _r, ...rest } = validInput();
    const r = inputSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });
});

// ── OutputSchema ─────────────────────────────────────────────────────

describe("ReconcilerAgent — outputSchema", () => {
  const { outputSchema } = getMeta();

  it("accepts minimal valid output", () => {
    const r = outputSchema.safeParse(validOutput());
    expect(r.success).toBe(true);
  });

  it("accepts output with conflicts", () => {
    const r = outputSchema.safeParse({
      ...validOutput(),
      conflicts: [validConflict(["fact-1", "fact-2"])],
    });
    expect(r.success).toBe(true);
  });

  it("accepts output with overlaps", () => {
    const r = outputSchema.safeParse({
      ...validOutput(),
      overlaps: [
        {
          dimensionPair: ["dim-1", "dim-2"],
          similarityScore: 0.75,
          overlappingClaim: "AI market is growing fast",
          resolutionAction: "merge-into-cross-dim",
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts output with gaps", () => {
    const r = outputSchema.safeParse({
      ...validOutput(),
      gaps: [
        {
          dimensionId: "dim-2",
          expectedAspects: ["Market share data", "Revenue breakdown"],
          severity: "minor",
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts output with figureCandidates", () => {
    const r = outputSchema.safeParse({
      ...validOutput(),
      figureCandidates: [
        {
          id: "fig-1",
          type: "reference",
          evidenceCitationIndex: 1,
          sourceUrl: "https://arxiv.org/abs/2401.12345",
          caption: "AI architecture diagram",
          relevanceScore: 0.85,
          passedGarbageFilter: true,
          fromDimensionId: "dim-1",
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects figureCandidate with http sourceUrl (must be https)", () => {
    const r = outputSchema.safeParse({
      ...validOutput(),
      figureCandidates: [
        {
          id: "fig-1",
          type: "reference",
          evidenceCitationIndex: 1,
          sourceUrl: "http://example.com/figure", // must be https
          caption: "A chart",
          relevanceScore: 0.5,
          passedGarbageFilter: true,
          fromDimensionId: "dim-1",
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("accepts output with deduplicationStats", () => {
    const r = outputSchema.safeParse({
      ...validOutput(),
      deduplicationStats: {
        duplicatesRemoved: 3,
        termVariantsUnified: 2,
        dataInconsistenciesFlagged: 1,
      },
    });
    expect(r.success).toBe(true);
  });

  it("accepts output with termGlossary", () => {
    const r = outputSchema.safeParse({
      ...validOutput(),
      termGlossary: [
        { canonical: "人工智能", variants: ["AI", "Artificial Intelligence"] },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts output with figurePoolStats", () => {
    const r = outputSchema.safeParse({
      ...validOutput(),
      figurePoolStats: {
        totalCandidates: 10,
        filteredAsGarbage: 3,
        duplicates: 2,
        finalAccepted: 5,
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects output with short reconciliationReport (<20 chars)", () => {
    const r = outputSchema.safeParse({
      ...validOutput(),
      reconciliationReport: "Too short",
    });
    expect(r.success).toBe(false);
  });

  it("rejects output with reconciliationReport > 5000 chars", () => {
    const r = outputSchema.safeParse({
      ...validOutput(),
      reconciliationReport: "x".repeat(5001),
    });
    expect(r.success).toBe(false);
  });

  it("rejects conflict with resolutionType not in enum", () => {
    const r = outputSchema.safeParse({
      ...validOutput(),
      conflicts: [
        {
          factIds: ["fact-1", "fact-2"],
          resolutionType: "unknown-type",
          rationale: "Some rationale here",
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects fact missing sources array", () => {
    const r = outputSchema.safeParse({
      ...validOutput(),
      factTable: [
        {
          id: "fact-1",
          entity: "GPT-4",
          attribute: "launch_date",
          value: "2023-03",
          sources: [],
        }, // min 1
      ],
    });
    expect(r.success).toBe(false);
  });
});

// ── validateBusinessRules ─────────────────────────────────────────────

describe("ReconcilerAgent — validateBusinessRules", () => {
  const agent = new ReconcilerAgent();

  it("passes with valid output (3 facts, no conflicts)", () => {
    expect(() => agent.validateBusinessRules(validOutput())).not.toThrow();
  });

  it("fails when factTable has fewer than 3 entries", () => {
    const output = {
      ...validOutput(),
      factTable: [validFact("fact-1"), validFact("fact-2")],
    };
    expect(() => agent.validateBusinessRules(output)).toThrow(
      /factTable\.length=2/,
    );
  });

  it("fails when factTable is empty", () => {
    const output = { ...validOutput(), factTable: [] };
    expect(() => agent.validateBusinessRules(output)).toThrow(
      /factTable\.length=0/,
    );
  });

  it("fails on duplicate fact IDs in factTable", () => {
    const output = {
      ...validOutput(),
      factTable: [
        validFact("fact-1"),
        validFact("fact-1"), // duplicate
        validFact("fact-3"),
      ],
    };
    expect(() => agent.validateBusinessRules(output)).toThrow(/fact-1/);
  });

  it("fails when same (entity, attribute) appears without conflict entry", () => {
    const output = {
      ...validOutput(),
      factTable: [
        {
          id: "fact-1",
          entity: "GPT-4",
          attribute: "launch_date",
          value: "2023-03",
          sources: ["https://a.com"],
        },
        {
          id: "fact-2",
          entity: "GPT-4",
          attribute: "launch_date",
          value: "2023-04",
          sources: ["https://b.com"],
        },
        {
          id: "fact-3",
          entity: "Claude",
          attribute: "launch_date",
          value: "2023-07",
          sources: ["https://c.com"],
        },
      ],
      conflicts: [], // missing the conflict for GPT-4::launch_date
    };
    expect(() => agent.validateBusinessRules(output)).toThrow(
      /GPT-4::launch_date/,
    );
  });

  it("passes when same (entity, attribute) has matching conflict entry", () => {
    const output = {
      ...validOutput(),
      factTable: [
        {
          id: "fact-1",
          entity: "GPT-4",
          attribute: "launch_date",
          value: "2023-03",
          sources: ["https://a.com"],
        },
        {
          id: "fact-2",
          entity: "GPT-4",
          attribute: "launch_date",
          value: "2023-04",
          sources: ["https://b.com"],
        },
        validFact("fact-3", "Claude", "launch_date", "2023-07"),
      ],
      conflicts: [
        {
          factIds: ["fact-1", "fact-2"],
          resolutionType: "preferred-one" as const,
          preferredFactId: "fact-1",
          rationale:
            "OpenAI official blog has higher credibility than secondary source",
        },
      ],
    };
    expect(() => agent.validateBusinessRules(output)).not.toThrow();
  });

  it("fails when conflict references non-existent factId", () => {
    const output = {
      ...validOutput(),
      conflicts: [
        {
          factIds: ["fact-1", "fact-NONEXISTENT"],
          resolutionType: "preferred-one" as const,
          preferredFactId: "fact-1",
          rationale: "Academic source is more reliable for this data point",
        },
      ],
    };
    expect(() => agent.validateBusinessRules(output)).toThrow(
      /fact-NONEXISTENT/,
    );
  });

  it("fails when preferred-one conflict is missing preferredFactId", () => {
    const output = {
      ...validOutput(),
      factTable: [
        validFact("fact-1"),
        {
          id: "fact-2",
          entity: "GPT-4",
          attribute: "launch_date",
          value: "2023-04",
          sources: ["https://b.com"],
        },
        validFact("fact-3", "Claude", "launch_date", "2023-07"),
      ],
      conflicts: [
        {
          factIds: ["fact-1", "fact-2"],
          resolutionType: "preferred-one" as const,
          // preferredFactId missing
          rationale: "Academic source has higher credibility than blog post",
        },
      ],
    };
    expect(() => agent.validateBusinessRules(output)).toThrow(
      /preferredFactId/,
    );
  });

  it("fails when conflict rationale is too short (<20 chars)", () => {
    const output = {
      ...validOutput(),
      factTable: [
        validFact("fact-1"),
        {
          id: "fact-2",
          entity: "GPT-4",
          attribute: "launch_date",
          value: "2023-04",
          sources: ["https://b.com"],
        },
        validFact("fact-3", "Claude", "launch_date", "2023-07"),
      ],
      conflicts: [
        {
          factIds: ["fact-1", "fact-2"],
          resolutionType: "kept-both" as const,
          rationale: "Short", // < 20 chars
        },
      ],
    };
    expect(() => agent.validateBusinessRules(output)).toThrow(/rationale/);
  });

  it("fails when more than 30% of conflicts are flagged-unresolved", () => {
    const output = {
      ...validOutput(),
      factTable: [
        validFact("fact-1"),
        {
          id: "fact-2",
          entity: "GPT-4",
          attribute: "launch_date",
          value: "2023-04",
          sources: ["https://b.com"],
        },
        {
          id: "fact-3",
          entity: "Claude",
          attribute: "launch_date",
          value: "2023-07",
          sources: ["https://c.com"],
        },
        {
          id: "fact-4",
          entity: "Claude",
          attribute: "launch_date",
          value: "2023-08",
          sources: ["https://d.com"],
        },
        validFact("fact-5", "Gemini", "launch_date", "2023-12"),
      ],
      conflicts: [
        {
          factIds: ["fact-1", "fact-2"],
          resolutionType: "preferred-one" as const,
          preferredFactId: "fact-1",
          rationale:
            "Academic source has higher credibility for this specific claim",
        },
        {
          factIds: ["fact-3", "fact-4"],
          resolutionType: "flagged-unresolved" as const, // 1/2 = 50% > 30%
          rationale:
            "Cannot determine which source is more reliable for this data point",
        },
      ],
    };
    expect(() => agent.validateBusinessRules(output)).toThrow(/30%/);
  });

  it("passes when exactly 30% of conflicts are flagged-unresolved (boundary)", () => {
    // 1 out of 3 = 33.3% which is just over 30%, so let's use 0 out of 3
    const facts = [
      validFact("fact-1"),
      {
        id: "fact-2",
        entity: "GPT-4",
        attribute: "launch_date",
        value: "2023-04",
        sources: ["https://b.com"],
      },
      {
        id: "fact-3",
        entity: "Claude",
        attribute: "launch_date",
        value: "2023-07",
        sources: ["https://c.com"],
      },
      {
        id: "fact-4",
        entity: "Claude",
        attribute: "launch_date",
        value: "2023-08",
        sources: ["https://d.com"],
      },
      {
        id: "fact-5",
        entity: "Bard",
        attribute: "launch_date",
        value: "2023-05",
        sources: ["https://e.com"],
      },
      {
        id: "fact-6",
        entity: "Bard",
        attribute: "launch_date",
        value: "2023-06",
        sources: ["https://f.com"],
      },
      validFact("fact-7", "Gemini", "launch_date", "2023-12"),
    ];
    const conflicts = [
      {
        factIds: ["fact-1", "fact-2"],
        resolutionType: "preferred-one" as const,
        preferredFactId: "fact-1",
        rationale: "OpenAI blog post is more reliable for this specific data",
      },
      {
        factIds: ["fact-3", "fact-4"],
        resolutionType: "preferred-one" as const,
        preferredFactId: "fact-3",
        rationale: "Anthropic official source is more credible for this data",
      },
      {
        factIds: ["fact-5", "fact-6"],
        resolutionType: "preferred-one" as const,
        preferredFactId: "fact-5",
        rationale: "Primary source documentation beats secondary blog post",
      },
    ];
    const output = { ...validOutput(), factTable: facts, conflicts };
    expect(() => agent.validateBusinessRules(output)).not.toThrow();
  });

  it("fails when figureCandidates length > 20", () => {
    const figures = Array.from({ length: 21 }, (_, i) => ({
      id: `fig-${i + 1}`,
      type: "reference" as const,
      evidenceCitationIndex: i + 1,
      sourceUrl: `https://example.com/fig${i + 1}`,
      caption: `Figure ${i + 1}`,
      relevanceScore: 0.5,
      passedGarbageFilter: true,
      fromDimensionId: "dim-1",
    }));
    const output = { ...validOutput(), figureCandidates: figures };
    expect(() => agent.validateBusinessRules(output)).toThrow(/超上限 20/);
  });

  it("fails when a figureCandidate is missing evidenceCitationIndex", () => {
    const output = {
      ...validOutput(),
      figureCandidates: [
        {
          id: "fig-1",
          type: "reference" as const,
          evidenceCitationIndex: 0, // falsy value triggers the check
          sourceUrl: "https://example.com/fig1",
          caption: "A figure",
          relevanceScore: 0.8,
          passedGarbageFilter: true,
          fromDimensionId: "dim-1",
        },
      ],
    };
    expect(() => agent.validateBusinessRules(output)).toThrow(
      /evidenceCitationIndex/,
    );
  });
});

// ── buildSystemPrompt ─────────────────────────────────────────────────

describe("ReconcilerAgent — buildSystemPrompt", () => {
  const agent = new ReconcilerAgent();
  const identity = { role: "reconciler", description: "test" };

  it("returns non-empty string", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(50);
  });

  it("contains topic in prompt", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(result).toContain("AI Market Trends 2025");
  });

  it("includes zh-CN language instruction for zh-CN", () => {
    const result = agent.buildSystemPrompt({
      input: { ...validInput(), language: "zh-CN" },
      identity,
    });
    expect(result).toContain("中文");
  });

  it("includes English instruction for en-US", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(result).toContain("English");
  });

  it("mentions number of researcher outputs", () => {
    const inputWith2 = {
      ...validInput(),
      researcherResults: [
        ...validInput().researcherResults,
        {
          dimension: "Key Players",
          findings: [],
          summary: "Players analyzed",
          figureCandidates: [],
        },
      ],
    };
    const result = agent.buildSystemPrompt({ input: inputWith2, identity });
    expect(result).toContain("2");
  });

  it("contains reconciliation instructions (extract fact table)", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(result).toContain("fact table");
  });

  it("contains conflict detection instructions", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(result).toContain("conflict");
  });

  it("contains figure candidates instructions", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(result).toContain("figureCandidates");
  });

  it("contains reconciliationReport cap instruction", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(result).toContain("1500");
  });

  it("contains hard rules", () => {
    const result = agent.buildSystemPrompt({ input: validInput(), identity });
    expect(result).toContain("Hard rules");
  });
});

// ── taskProfile — nothink Layer B ────────────────────────────────────

describe("ReconcilerAgent — taskProfile", () => {
  it("declares reasoningDepth minimal for fast mechanical check", () => {
    const { taskProfile } = getMeta();
    expect(taskProfile?.reasoningDepth).toBe("minimal");
  });
});
