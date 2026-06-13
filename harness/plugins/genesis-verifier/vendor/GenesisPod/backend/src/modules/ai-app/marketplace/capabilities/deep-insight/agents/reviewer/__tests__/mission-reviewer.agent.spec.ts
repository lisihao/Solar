/**
 * MissionReviewerAgent — unit tests
 *
 * 覆盖：
 *   - inputSchema: draftReport (ResearchReportSchema nested)
 *   - outputSchema: score bounds, verdict enum
 *   - buildSystemPrompt: topic and language branches, verdict thresholds
 */

import { z } from "zod";
import { readDefineAgentMeta } from "@/modules/ai-harness/agents/dev-tools";
import { MissionReviewerAgent } from "../mission-reviewer.agent";

const meta = readDefineAgentMeta(MissionReviewerAgent)!;
const inputSchema = meta.inputSchema as z.ZodType;
const outputSchema = meta.outputSchema as z.ZodType;

const validReport = {
  title: "AI in Finance: Key Findings",
  summary:
    "This executive summary covers AI adoption in finance sector comprehensively.",
  sections: [
    {
      heading: "Market Overview",
      body: "AI adoption grew by 40% in 2024.",
      sources: ["https://example.com/source1"],
    },
  ],
  conclusion: "Organizations should invest in AI capabilities immediately.",
  citations: ["https://example.com/source1"],
};

const baseInput = {
  topic: "AI in Finance",
  language: "zh-CN" as const,
  draftReport: validReport,
};

const baseOutput = {
  score: 85,
  verdict: "approve" as const,
  notes: ["Strong evidence throughout", "Conclusion is actionable"],
};

describe("MissionReviewerAgent", () => {
  let agent: MissionReviewerAgent;

  beforeAll(() => {
    agent = new MissionReviewerAgent();
  });

  // ─────────────────────────────────────────────
  // inputSchema
  // ─────────────────────────────────────────────

  describe("inputSchema", () => {
    it("accepts valid input", () => {
      expect(inputSchema.safeParse(baseInput).success).toBe(true);
    });

    it("accepts language en-US", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, language: "en-US" }).success,
      ).toBe(true);
    });

    it("rejects invalid language", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, language: "fr-FR" }).success,
      ).toBe(false);
    });

    it("rejects missing topic", () => {
      const { topic: _, ...rest } = baseInput as Record<string, unknown>;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing draftReport", () => {
      const { draftReport: _, ...rest } = baseInput as Record<string, unknown>;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects draftReport with title < 2 chars", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          draftReport: { ...validReport, title: "A" },
        }).success,
      ).toBe(false);
    });

    it("rejects draftReport with summary < 20 chars", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          draftReport: { ...validReport, summary: "Too short." },
        }).success,
      ).toBe(false);
    });

    it("rejects draftReport with empty sections array", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          draftReport: { ...validReport, sections: [] },
        }).success,
      ).toBe(false);
    });

    it("rejects draftReport with conclusion < 20 chars", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          draftReport: { ...validReport, conclusion: "Short." },
        }).success,
      ).toBe(false);
    });

    it("accepts draftReport without optional citations", () => {
      const { citations: _, ...reportRest } = validReport as Record<
        string,
        unknown
      >;
      expect(
        inputSchema.safeParse({ ...baseInput, draftReport: reportRest })
          .success,
      ).toBe(true);
    });

    it("rejects draftReport citations with invalid URLs", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          draftReport: { ...validReport, citations: ["not-a-url"] },
        }).success,
      ).toBe(false);
    });

    it("accepts multiple sections", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          draftReport: {
            ...validReport,
            sections: [
              { heading: "Section 1", body: "Content A" },
              { heading: "Section 2", body: "Content B" },
            ],
          },
        }).success,
      ).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // outputSchema
  // ─────────────────────────────────────────────

  describe("outputSchema", () => {
    it("accepts valid approve output", () => {
      expect(outputSchema.safeParse(baseOutput).success).toBe(true);
    });

    it("accepts verdict revise", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, verdict: "revise", score: 70 })
          .success,
      ).toBe(true);
    });

    it("accepts verdict reject", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, verdict: "reject", score: 45 })
          .success,
      ).toBe(true);
    });

    it("rejects invalid verdict", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, verdict: "pending" }).success,
      ).toBe(false);
    });

    it("rejects score below 0", () => {
      expect(outputSchema.safeParse({ ...baseOutput, score: -1 }).success).toBe(
        false,
      );
    });

    it("rejects score above 100", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, score: 101 }).success,
      ).toBe(false);
    });

    it("accepts score at boundary 0", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, score: 0, verdict: "reject" })
          .success,
      ).toBe(true);
    });

    it("accepts score at boundary 100", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, score: 100 }).success,
      ).toBe(true);
    });

    it("accepts empty notes array", () => {
      expect(outputSchema.safeParse({ ...baseOutput, notes: [] }).success).toBe(
        true,
      );
    });

    it("rejects notes as non-array", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, notes: "some note" }).success,
      ).toBe(false);
    });

    it("rejects missing score", () => {
      const { score: _, ...rest } = baseOutput as Record<string, unknown>;
      expect(outputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing verdict", () => {
      const { verdict: _, ...rest } = baseOutput as Record<string, unknown>;
      expect(outputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects score as non-number", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, score: "85" }).success,
      ).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // buildSystemPrompt
  // ─────────────────────────────────────────────

  describe("buildSystemPrompt", () => {
    const identity = {
      role: { id: "reviewer", name: "Reviewer" },
    } as never;

    it("contains topic in prompt", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("AI in Finance");
    });

    it("contains language in prompt", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("zh-CN");
    });

    it("contains scoring dimensions", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("Accuracy");
      expect(prompt).toContain("Coverage");
      expect(prompt).toContain("Logical structure");
      expect(prompt).toContain("Clarity");
    });

    it("contains verdict thresholds", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("80");
      expect(prompt).toContain("60-79");
      expect(prompt).toContain("60");
    });

    it("contains approve/revise/reject labels", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("approve");
      expect(prompt).toContain("revise");
      expect(prompt).toContain("reject");
    });

    it("en-US language reflected in prompt", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, language: "en-US" },
        identity,
      });
      expect(prompt).toContain("en-US");
    });
  });
});
