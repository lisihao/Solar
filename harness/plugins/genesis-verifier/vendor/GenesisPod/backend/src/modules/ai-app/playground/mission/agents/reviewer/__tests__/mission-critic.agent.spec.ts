/**
 * MissionCriticAgent — unit tests
 *
 * 覆盖：
 *   - inputSchema: artifactSummary structure, optional fields
 *   - outputSchema: overallVerdict enum, rationale min(20)
 *   - buildSystemPrompt: verdict rules, optional fields branches,
 *     executiveSummary slice 500, upstreamReviewerVerdict presence/absence
 */

import { z } from "zod";
import { readDefineAgentMeta } from "../../../../../../ai-harness/agents/dev-tools";
import { MissionCriticAgent } from "../mission-critic.agent";

const meta = readDefineAgentMeta(MissionCriticAgent)!;
const inputSchema = meta.inputSchema as z.ZodType;
const outputSchema = meta.outputSchema as z.ZodType;

const baseArtifactSummary = {
  title: "AI in Finance: Comprehensive Analysis",
  executiveSummary:
    "This report examines AI adoption patterns in financial services.",
  sectionCount: 5,
  sectionTitles: [
    "Market Overview",
    "Tech Trends",
    "Risk Analysis",
    "ROI",
    "Outlook",
  ],
  citationCount: 12,
  factCount: 8,
  figureCount: 3,
  overallQuality: 78,
  qualityDimensions: { breadth: 80, depth: 75, evidence: 85 },
};

const baseInput = {
  topic: "AI in Finance",
  language: "zh-CN" as const,
  audienceProfile: "executive" as const,
  artifactSummary: baseArtifactSummary,
};

const baseOutput = {
  overallVerdict: "concerns" as const,
  blindspots: ["Missing regulatory compliance section"],
  biasFlags: [],
  suggestions: ["Add regulatory analysis"],
  rationale:
    "The report lacks coverage of regulatory implications which are critical for executive audience.",
};

describe("MissionCriticAgent", () => {
  let agent: MissionCriticAgent;

  beforeAll(() => {
    agent = new MissionCriticAgent();
  });

  // ─────────────────────────────────────────────
  // inputSchema
  // ─────────────────────────────────────────────

  describe("inputSchema", () => {
    it("accepts valid minimal input", () => {
      expect(inputSchema.safeParse(baseInput).success).toBe(true);
    });

    it("accepts language en-US", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, language: "en-US" }).success,
      ).toBe(true);
    });

    it("rejects invalid language", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, language: "de-DE" }).success,
      ).toBe(false);
    });

    it("accepts all audienceProfile values", () => {
      for (const p of [
        "executive",
        "domain-expert",
        "general-public",
      ] as const) {
        expect(
          inputSchema.safeParse({ ...baseInput, audienceProfile: p }).success,
        ).toBe(true);
      }
    });

    it("rejects invalid audienceProfile", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, audienceProfile: "kids" })
          .success,
      ).toBe(false);
    });

    it("accepts optional styleProfile", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, styleProfile: "academic" })
          .success,
      ).toBe(true);
    });

    it("accepts optional lengthProfile", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, lengthProfile: "deep" }).success,
      ).toBe(true);
    });

    it("accepts optional upstreamReviewerVerdict", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          upstreamReviewerVerdict: {
            score: 75,
            critique: "Good but needs work",
          },
        }).success,
      ).toBe(true);
    });

    it("accepts upstreamReviewerVerdict without critique", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          upstreamReviewerVerdict: { score: 80 },
        }).success,
      ).toBe(true);
    });

    it("rejects missing topic", () => {
      const { topic: _, ...rest } = baseInput as Record<string, unknown>;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing artifactSummary", () => {
      const { artifactSummary: _, ...rest } = baseInput as Record<
        string,
        unknown
      >;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects artifactSummary missing title", () => {
      const { title: _, ...artRest } = baseArtifactSummary as Record<
        string,
        unknown
      >;
      expect(
        inputSchema.safeParse({ ...baseInput, artifactSummary: artRest })
          .success,
      ).toBe(false);
    });

    it("rejects artifactSummary missing sectionCount", () => {
      const { sectionCount: _, ...artRest } = baseArtifactSummary as Record<
        string,
        unknown
      >;
      expect(
        inputSchema.safeParse({ ...baseInput, artifactSummary: artRest })
          .success,
      ).toBe(false);
    });

    it("accepts artifactSummary with empty sectionTitles", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          artifactSummary: { ...baseArtifactSummary, sectionTitles: [] },
        }).success,
      ).toBe(true);
    });

    it("accepts artifactSummary with empty qualityDimensions", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          artifactSummary: { ...baseArtifactSummary, qualityDimensions: {} },
        }).success,
      ).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // outputSchema
  // ─────────────────────────────────────────────

  describe("outputSchema", () => {
    it("accepts valid output", () => {
      expect(outputSchema.safeParse(baseOutput).success).toBe(true);
    });

    it("accepts all overallVerdict values", () => {
      for (const v of ["pass", "concerns", "fail"] as const) {
        expect(
          outputSchema.safeParse({ ...baseOutput, overallVerdict: v }).success,
        ).toBe(true);
      }
    });

    it("rejects invalid overallVerdict", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, overallVerdict: "warning" })
          .success,
      ).toBe(false);
    });

    it("rejects rationale shorter than 20 chars", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          rationale: "Short.",
        }).success,
      ).toBe(false);
    });

    it("accepts rationale at exactly 20 chars", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          rationale: "12345678901234567890",
        }).success,
      ).toBe(true);
    });

    it("defaults blindspots to [] when omitted", () => {
      const { blindspots: _, ...rest } = baseOutput as Record<string, unknown>;
      const r = outputSchema.safeParse(rest);
      expect(r.success).toBe(true);
      if (r.success) {
        expect((r.data as Record<string, unknown>)["blindspots"]).toEqual([]);
      }
    });

    it("defaults biasFlags to [] when omitted", () => {
      const { biasFlags: _, ...rest } = baseOutput as Record<string, unknown>;
      const r = outputSchema.safeParse(rest);
      expect(r.success).toBe(true);
      if (r.success) {
        expect((r.data as Record<string, unknown>)["biasFlags"]).toEqual([]);
      }
    });

    it("defaults suggestions to [] when omitted", () => {
      const { suggestions: _, ...rest } = baseOutput as Record<string, unknown>;
      const r = outputSchema.safeParse(rest);
      expect(r.success).toBe(true);
      if (r.success) {
        expect((r.data as Record<string, unknown>)["suggestions"]).toEqual([]);
      }
    });

    it("accepts pass verdict with empty blindspots/biasFlags", () => {
      expect(
        outputSchema.safeParse({
          overallVerdict: "pass",
          blindspots: [],
          biasFlags: [],
          suggestions: [],
          rationale:
            "The report is comprehensive and well-evidenced with no major gaps.",
        }).success,
      ).toBe(true);
    });

    it("accepts fail verdict with multiple blindspots and biasFlags", () => {
      expect(
        outputSchema.safeParse({
          overallVerdict: "fail",
          blindspots: ["Missing regulatory section", "No risk analysis"],
          biasFlags: ["Pro-vendor bias detected"],
          suggestions: ["Add neutral sources"],
          rationale:
            "Critical sections are missing and bias renders the report unsuitable.",
        }).success,
      ).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // buildSystemPrompt
  // ─────────────────────────────────────────────

  describe("buildSystemPrompt", () => {
    const identity = {
      role: { id: "critic", name: "Critic" },
    } as never;

    it("contains topic in prompt", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("AI in Finance");
    });

    it("contains audienceProfile in prompt", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("executive");
    });

    it("contains artifact title", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("AI in Finance: Comprehensive Analysis");
    });

    it("contains section count and titles", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("5");
      expect(prompt).toContain("Market Overview");
    });

    it("contains citation count", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("12");
    });

    it("contains factCount and figureCount", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("8");
      expect(prompt).toContain("3");
    });

    it("contains overallQuality score", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("78");
    });

    it("contains verdict rules", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain('"pass"');
      expect(prompt).toContain('"concerns"');
      expect(prompt).toContain('"fail"');
    });

    it("language zh-CN produces Chinese output instruction", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("用中文输出");
    });

    it("language en-US produces English output instruction", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, language: "en-US" },
        identity,
      });
      expect(prompt).toContain("Respond in English");
    });

    it("optional styleProfile appears in prompt when provided", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, styleProfile: "academic" },
        identity,
      });
      expect(prompt).toContain("academic");
    });

    it("optional lengthProfile appears in prompt when provided", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, lengthProfile: "deep" },
        identity,
      });
      expect(prompt).toContain("deep");
    });

    it("upstreamReviewerVerdict appears in prompt when provided", () => {
      const prompt = agent.buildSystemPrompt({
        input: {
          ...baseInput,
          upstreamReviewerVerdict: {
            score: 75,
            critique: "Needs better evidence",
          },
        },
        identity,
      });
      expect(prompt).toContain("75");
      expect(prompt).toContain("Needs better evidence");
    });

    it("no upstreamReviewerVerdict section when omitted", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).not.toContain("Upstream reviewer score");
    });

    it("upstreamReviewerVerdict without critique shows em dash fallback", () => {
      const prompt = agent.buildSystemPrompt({
        input: {
          ...baseInput,
          upstreamReviewerVerdict: { score: 82 },
        },
        identity,
      });
      expect(prompt).toContain("82");
      expect(prompt).toContain("—");
    });

    it("executiveSummary sliced to 500 chars", () => {
      const longSummary = "S".repeat(600);
      const prompt = agent.buildSystemPrompt({
        input: {
          ...baseInput,
          artifactSummary: {
            ...baseArtifactSummary,
            executiveSummary: longSummary,
          },
        },
        identity,
      });
      expect(prompt).toContain("…");
      // Should not include all 600 chars
      expect(prompt.includes("S".repeat(600))).toBe(false);
    });

    it("qualityDimensions shown in prompt", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("breadth=80");
    });
  });
});
