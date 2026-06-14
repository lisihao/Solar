/**
 * ResearcherAgent 单元测试
 *
 * 覆盖：inputSchema / outputSchema / validateBusinessRules / buildSystemPrompt
 */

import { ResearcherAgent } from "../researcher.agent";
import { readDefineAgentMeta } from "@/modules/ai-harness/agents/dev-tools/agent-spec.base";

// ★ 2026-05-13: business-rule findings floor now comes from
// PlaygroundRuntimeConfig (PR2/PR3); isolate test env from host .env so
// asserted thresholds (default 4) hold regardless of local-model tuning.
const PLAYGROUND_ENV_KEYS = [
  "PLAYGROUND_TUNING_PROFILE",
  "MIN_FINDINGS_THRESHOLD",
] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of PLAYGROUND_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function getMeta() {
  const meta = readDefineAgentMeta(ResearcherAgent);
  if (!meta) throw new Error("@DefineAgent metadata missing");
  return meta;
}

// ── Helpers ──────────────────────────────────────────────────────────

function validFinding(
  overrides: Partial<{ claim: string; evidence: string; source: string }> = {},
) {
  return {
    claim:
      "AI adoption grew by 35% year-over-year in 2025, driven by enterprise demand",
    evidence:
      "According to Gartner 2025 report, enterprise AI adoption reached record levels",
    source: "https://gartner.com/reports/ai-2025",
    ...overrides,
  };
}

function validOutput(findingCount = 4) {
  return {
    dimension: "Market Trends",
    findings: Array.from({ length: findingCount }, (_, i) => ({
      claim: `AI claim ${i + 1} with specific data point 2025 growth ${i * 5}%`,
      evidence: `Evidence sentence ${i + 1} from primary source report`,
      source: `https://source${i + 1}.com/report`,
    })),
    summary:
      "AI adoption is accelerating across all enterprise sectors with significant growth in 2025.",
    figureCandidates: [],
  };
}

// ── InputSchema ──────────────────────────────────────────────────────

describe("ResearcherAgent — inputSchema", () => {
  const { inputSchema } = getMeta();

  it("accepts minimal valid input (withFigures defaults to true)", () => {
    const r = inputSchema.safeParse({
      topic: "AI Regulation",
      dimension: "Policy Analysis",
      language: "en-US",
    });
    expect(r.success).toBe(true);
  });

  it("accepts input with withFigures=false", () => {
    const r = inputSchema.safeParse({
      topic: "AI Regulation",
      dimension: "Policy Analysis",
      language: "en-US",
      withFigures: false,
    });
    expect(r.success).toBe(true);
  });

  it("accepts input with critique field", () => {
    const r = inputSchema.safeParse({
      topic: "AI Regulation",
      dimension: "Policy Analysis",
      language: "zh-CN",
      critique: "Missing quantitative data on enforcement rates",
    });
    expect(r.success).toBe(true);
  });

  it("accepts zh-CN language", () => {
    const r = inputSchema.safeParse({
      topic: "人工智能监管",
      dimension: "政策分析",
      language: "zh-CN",
    });
    expect(r.success).toBe(true);
  });

  it("accepts explicit searchTimeRange", () => {
    const r = inputSchema.safeParse({
      topic: "AI Regulation",
      dimension: "Policy Analysis",
      language: "en-US",
      searchTimeRange: "90d",
    });
    expect(r.success).toBe(true);
  });

  it("rejects input missing topic", () => {
    const r = inputSchema.safeParse({
      dimension: "Policy Analysis",
      language: "en-US",
    });
    expect(r.success).toBe(false);
  });

  it("rejects input missing dimension", () => {
    const r = inputSchema.safeParse({
      topic: "AI Regulation",
      language: "en-US",
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid language code", () => {
    const r = inputSchema.safeParse({
      topic: "AI Regulation",
      dimension: "Policy",
      language: "fr-FR",
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing language", () => {
    const r = inputSchema.safeParse({
      topic: "AI Regulation",
      dimension: "Policy",
    });
    expect(r.success).toBe(false);
  });
});

// ── OutputSchema ─────────────────────────────────────────────────────

describe("ResearcherAgent — outputSchema", () => {
  const { outputSchema } = getMeta();

  it("accepts valid output with 4 findings and empty figureCandidates", () => {
    const r = outputSchema.safeParse(validOutput(4));
    expect(r.success).toBe(true);
  });

  it("accepts output with figureCandidates", () => {
    const r = outputSchema.safeParse({
      ...validOutput(4),
      figureCandidates: [
        {
          sourceUrl: "https://arxiv.org/abs/2401.12345",
          imageUrl: "https://arxiv.org/figs/2401.12345/fig1.png",
          caption: "Architecture diagram",
          sourcePageOrSection: "Figure 1",
          relevanceHint: "high",
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts figureCandidate without optional imageUrl", () => {
    const r = outputSchema.safeParse({
      ...validOutput(4),
      figureCandidates: [
        {
          sourceUrl: "https://mckinsey.com/report/ai-2025",
          caption: "Market share chart",
          relevanceHint: "medium",
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects figureCandidate with sourceUrl not starting with http", () => {
    const r = outputSchema.safeParse({
      ...validOutput(4),
      figureCandidates: [
        {
          sourceUrl: "ftp://invalid.com/image",
          caption: "Bad source",
          relevanceHint: "low",
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects figureCandidate with imageUrl not https or data:image", () => {
    const r = outputSchema.safeParse({
      ...validOutput(4),
      figureCandidates: [
        {
          sourceUrl: "https://example.com/page",
          imageUrl: "http://example.com/image.png", // must be https
          caption: "Chart image",
          relevanceHint: "high",
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("accepts figureCandidate with data:image imageUrl", () => {
    const r = outputSchema.safeParse({
      ...validOutput(4),
      figureCandidates: [
        {
          sourceUrl: "https://example.com/page",
          imageUrl: "data:image/png;base64,abc123",
          caption: "Embedded image",
          relevanceHint: "low",
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects output with more than 5 figureCandidates (max 5)", () => {
    const r = outputSchema.safeParse({
      ...validOutput(4),
      figureCandidates: Array.from({ length: 6 }, (_, i) => ({
        sourceUrl: `https://example.com/fig${i}`,
        caption: `Figure ${i} with description`,
        relevanceHint: "low" as const,
      })),
    });
    expect(r.success).toBe(false);
  });

  it("rejects output missing summary", () => {
    const { summary: _s, ...rest } = validOutput(4);
    const r = outputSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects output missing findings", () => {
    const { findings: _f, ...rest } = validOutput(4);
    const r = outputSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects finding with empty source", () => {
    const r = outputSchema.safeParse({
      ...validOutput(4),
      findings: [
        ...validOutput(3).findings,
        {
          claim: "Some claim with data",
          evidence: "Some evidence here",
          source: "",
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});

// ── validateBusinessRules ─────────────────────────────────────────────

describe("ResearcherAgent — validateBusinessRules", () => {
  const agent = new ResearcherAgent();

  it("passes with 10 valid findings and good summary", () => {
    expect(() => agent.validateBusinessRules(validOutput(10))).not.toThrow();
  });

  it("passes with 12 findings", () => {
    expect(() => agent.validateBusinessRules(validOutput(12))).not.toThrow();
  });

  it("passes at the floor of 5 findings (★ 2026-05-23 成功线 10→5)", () => {
    expect(() => agent.validateBusinessRules(validOutput(5))).not.toThrow();
  });

  it("fails when findings count < 5 (★ 2026-05-23 成功线 10→5)", () => {
    expect(() => agent.validateBusinessRules(validOutput(4))).toThrow(
      /findings\.length=4/,
    );
  });

  it("fails when findings is empty", () => {
    expect(() => agent.validateBusinessRules(validOutput(0))).toThrow(
      /findings\.length=0/,
    );
  });

  it("fails when a finding's claim is too short (<10 chars)", () => {
    const output = {
      ...validOutput(4),
      findings: [
        validFinding({ claim: "Short" }), // < 10 chars
        ...validOutput(3).findings,
      ],
    };
    expect(() => agent.validateBusinessRules(output)).toThrow(/claim/);
  });

  it("fails when a finding's claim is empty", () => {
    const output = {
      ...validOutput(4),
      findings: [validFinding({ claim: "" }), ...validOutput(3).findings],
    };
    expect(() => agent.validateBusinessRules(output)).toThrow(/claim/);
  });

  it("fails when a finding's evidence is too short (<5 chars)", () => {
    const output = {
      ...validOutput(4),
      findings: [validFinding({ evidence: "Sht" }), ...validOutput(3).findings],
    };
    expect(() => agent.validateBusinessRules(output)).toThrow(/evidence/);
  });

  it("fails when a finding's source is missing", () => {
    const output = {
      ...validOutput(4),
      findings: [
        {
          claim: "Valid claim with specific data 2025",
          evidence: "Evidence here",
          source: "",
        },
        ...validOutput(3).findings,
      ],
    };
    expect(() => agent.validateBusinessRules(output)).toThrow(/source/);
  });

  it("fails when a finding's source looks like an invalid URL (no dot, no protocol)", () => {
    const output = {
      ...validOutput(4),
      findings: [
        validFinding({ source: "invalidNoProtocolOrDot" }),
        ...validOutput(3).findings,
      ],
    };
    expect(() => agent.validateBusinessRules(output)).toThrow(/source/);
  });

  it("passes when source is a doi: prefixed reference", () => {
    const output = {
      ...validOutput(4),
      findings: [
        validFinding({ source: "doi:10.1234/journal.abc.2025" }),
        ...validOutput(9).findings,
      ],
    };
    expect(() => agent.validateBusinessRules(output)).not.toThrow();
  });

  it("passes when source is an arxiv: prefixed reference", () => {
    const output = {
      ...validOutput(4),
      findings: [
        validFinding({ source: "arxiv:2401.12345" }),
        ...validOutput(9).findings,
      ],
    };
    expect(() => agent.validateBusinessRules(output)).not.toThrow();
  });

  it("passes when source contains a dot (domain-like)", () => {
    const output = {
      ...validOutput(4),
      findings: [
        validFinding({ source: "nytimes.com/article/ai-2025" }),
        ...validOutput(9).findings,
      ],
    };
    expect(() => agent.validateBusinessRules(output)).not.toThrow();
  });

  it("fails when summary is too short (<20 chars)", () => {
    expect(() =>
      agent.validateBusinessRules({ ...validOutput(4), summary: "Too short." }),
    ).toThrow(/summary/);
  });

  it("fails when summary is empty", () => {
    expect(() =>
      agent.validateBusinessRules({ ...validOutput(4), summary: "" }),
    ).toThrow(/summary/);
  });

  it("collects multiple issues and throws all at once", () => {
    const output = {
      dimension: "Test",
      findings: [validFinding({ claim: "Hi" })], // < 4 findings + bad claim
      summary: "OK",
      figureCandidates: [],
    };
    let errorMsg = "";
    try {
      agent.validateBusinessRules(output);
    } catch (e) {
      errorMsg = (e as Error).message;
    }
    expect(errorMsg).toContain("findings.length=1");
  });
});

// ── buildSystemPrompt ─────────────────────────────────────────────────

describe("ResearcherAgent — buildSystemPrompt", () => {
  const agent = new ResearcherAgent();
  const identity = { role: "researcher", description: "test" };

  it("returns non-empty string", () => {
    const result = agent.buildSystemPrompt({
      input: {
        topic: "AI",
        dimension: "Policy",
        language: "en-US",
        withFigures: true,
      },
      identity,
    });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(50);
  });

  it("contains topic and dimension in prompt", () => {
    const result = agent.buildSystemPrompt({
      input: {
        topic: "Quantum Computing",
        dimension: "Hardware Advances",
        language: "en-US",
        withFigures: true,
      },
      identity,
    });
    expect(result).toContain("Quantum Computing");
    expect(result).toContain("Hardware Advances");
  });

  it("contains language in prompt", () => {
    const result = agent.buildSystemPrompt({
      input: {
        topic: "AI",
        dimension: "Policy",
        language: "en-US",
        withFigures: true,
      },
      identity,
    });
    expect(result).toContain("en-US");
  });

  it("includes critique block when critique provided", () => {
    const result = agent.buildSystemPrompt({
      input: {
        topic: "AI",
        dimension: "Policy",
        language: "en-US",
        withFigures: false,
        critique: "Missing quantitative data on enforcement rates and fines",
      },
      identity,
    });
    expect(result).toContain("Missing quantitative data on enforcement rates");
    expect(result).toContain("critique");
  });

  it("omits critique block when critique not provided", () => {
    const result = agent.buildSystemPrompt({
      input: {
        topic: "AI",
        dimension: "Policy",
        language: "en-US",
        withFigures: false,
      },
      identity,
    });
    expect(result).not.toContain("Lead M1 critique");
  });

  it("contains web-scraper extractImages=true instruction when withFigures=true", () => {
    const result = agent.buildSystemPrompt({
      input: {
        topic: "AI",
        dimension: "Policy",
        language: "en-US",
        withFigures: true,
      },
      identity,
    });
    expect(result).toContain("extractImages=true");
  });

  it("does not mandate extractImages when withFigures=false", () => {
    const result = agent.buildSystemPrompt({
      input: {
        topic: "AI",
        dimension: "Policy",
        language: "en-US",
        withFigures: false,
      },
      identity,
    });
    // withFigures=false means the mandatory extracImages line is absent
    expect(result).not.toContain("withFigures=true");
  });

  it("contains current date in prompt", () => {
    const result = agent.buildSystemPrompt({
      input: {
        topic: "AI",
        dimension: "Policy",
        language: "en-US",
        withFigures: false,
      },
      identity,
    });
    const year = new Date().getFullYear().toString();
    expect(result).toContain(year);
  });

  it("contains structured freshness constraints for bounded timeRange", () => {
    const result = agent.buildSystemPrompt({
      input: {
        topic: "AI",
        dimension: "Policy",
        language: "en-US",
        withFigures: false,
        searchTimeRange: "90d",
      },
      identity,
    });
    expect(result).toContain("freshness");
    expect(result).toContain("selected searchTimeRange = 90d");
    expect(result).toContain('"timeRange": "90d"');
    expect(result).toContain("after:");
  });

  it("allows all-time missions but still mentions freshness expectations", () => {
    const result = agent.buildSystemPrompt({
      input: {
        topic: "AI",
        dimension: "Policy",
        language: "en-US",
        withFigures: false,
        searchTimeRange: "all",
      },
      identity,
    });
    expect(result).toContain("selected searchTimeRange = all");
    expect(result).toContain("all time");
  });
});
