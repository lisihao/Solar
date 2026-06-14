/**
 * DimensionIntegratorAgent — unit tests
 *
 * 覆盖：
 *   - inputSchema
 *   - outputSchema: keyFindings min(3)/max(7), totalWordCount
 *   - buildSystemPrompt: chapter list, totalWords计算, dimension name
 */

import { z } from "zod";
import { readDefineAgentMeta } from "../../../../../../ai-harness/agents/dev-tools";
import { DimensionIntegratorAgent } from "../dimension-integrator.agent";

const meta = readDefineAgentMeta(DimensionIntegratorAgent)!;
const inputSchema = meta.inputSchema as z.ZodType;
const outputSchema = meta.outputSchema as z.ZodType;

const chapter1 = {
  index: 1,
  heading: "Market Overview",
  body: "AI adoption is accelerating across all sectors.",
  wordCount: 600,
};

const chapter2 = {
  index: 2,
  heading: "Technology Trends",
  body: "Large language models are driving major breakthroughs.",
  wordCount: 700,
};

const baseInput = {
  topic: "AI in Finance",
  dimension: "Market Growth",
  language: "zh-CN" as const,
  chapters: [chapter1, chapter2],
  dimensionSummary:
    "AI is reshaping the financial sector with significant revenue impacts.",
};

const baseOutput = {
  dimension: "Market Growth",
  abstract:
    "A comprehensive overview of AI's impact on market growth in finance.",
  keyFindings: [
    "Revenue grew 40% YoY",
    "Adoption rate doubled",
    "Cost reduction of 25%",
  ],
  totalWordCount: 1300,
  fullMarkdown:
    "# Market Growth\n\n## 1. Market Overview\nAI adoption...\n\n## 2. Technology Trends\nLLMs...",
};

describe("DimensionIntegratorAgent", () => {
  let agent: DimensionIntegratorAgent;

  beforeAll(() => {
    agent = new DimensionIntegratorAgent();
  });

  // ─────────────────────────────────────────────
  // inputSchema
  // ─────────────────────────────────────────────

  describe("inputSchema", () => {
    it("accepts valid minimal input with 2 chapters", () => {
      expect(inputSchema.safeParse(baseInput).success).toBe(true);
    });

    it("accepts single chapter", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, chapters: [chapter1] }).success,
      ).toBe(true);
    });

    it("accepts empty chapters array", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, chapters: [] }).success,
      ).toBe(true);
    });

    it("accepts language en-US", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, language: "en-US" }).success,
      ).toBe(true);
    });

    it("rejects invalid language", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, language: "ko-KR" }).success,
      ).toBe(false);
    });

    it("rejects missing topic", () => {
      const { topic: _, ...rest } = baseInput as Record<string, unknown>;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing dimension", () => {
      const { dimension: _, ...rest } = baseInput as Record<string, unknown>;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing dimensionSummary", () => {
      const { dimensionSummary: _, ...rest } = baseInput as Record<
        string,
        unknown
      >;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects chapter with non-integer index", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          chapters: [{ ...chapter1, index: 1.5 }],
        }).success,
      ).toBe(false);
    });

    it("rejects chapter with non-integer wordCount", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          chapters: [{ ...chapter1, wordCount: 600.7 }],
        }).success,
      ).toBe(false);
    });

    it("rejects chapter missing heading", () => {
      const { heading: _, ...chapterRest } = chapter1 as Record<
        string,
        unknown
      >;
      expect(
        inputSchema.safeParse({ ...baseInput, chapters: [chapterRest] })
          .success,
      ).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // outputSchema
  // ─────────────────────────────────────────────

  describe("outputSchema", () => {
    it("accepts valid output", () => {
      expect(outputSchema.safeParse(baseOutput).success).toBe(true);
    });

    it("rejects keyFindings below min 3", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          keyFindings: ["Finding 1", "Finding 2"],
        }).success,
      ).toBe(false);
    });

    it("accepts keyFindings at exactly 3 (min boundary)", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          keyFindings: ["Finding 1", "Finding 2", "Finding 3"],
        }).success,
      ).toBe(true);
    });

    it("accepts keyFindings at exactly 7 (max boundary)", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          keyFindings: Array.from({ length: 7 }, (_, i) => `Finding ${i + 1}`),
        }).success,
      ).toBe(true);
    });

    it("rejects keyFindings above max 7", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          keyFindings: Array.from({ length: 8 }, (_, i) => `Finding ${i + 1}`),
        }).success,
      ).toBe(false);
    });

    it("rejects non-integer totalWordCount", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, totalWordCount: 1300.5 })
          .success,
      ).toBe(false);
    });

    it("rejects missing dimension in output", () => {
      const { dimension: _, ...rest } = baseOutput as Record<string, unknown>;
      expect(outputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing abstract", () => {
      const { abstract: _, ...rest } = baseOutput as Record<string, unknown>;
      expect(outputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing fullMarkdown", () => {
      const { fullMarkdown: _, ...rest } = baseOutput as Record<
        string,
        unknown
      >;
      expect(outputSchema.safeParse(rest).success).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // buildSystemPrompt
  // ─────────────────────────────────────────────

  describe("buildSystemPrompt", () => {
    const identity = {
      role: { id: "integrator", name: "Integrator" },
    } as never;

    it("contains dimension name", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("Market Growth");
    });

    it("contains chapter count", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("2");
    });

    it("contains total word count (sum of chapters)", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      // 600 + 700 = 1300
      expect(prompt).toContain("1300");
    });

    it("contains chapter headings in list", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("Market Overview");
      expect(prompt).toContain("Technology Trends");
    });

    it("contains chapter word counts in list", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("600");
      expect(prompt).toContain("700");
    });

    it("contains dimension summary", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("AI is reshaping the financial sector");
    });

    it("contains language instruction", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("zh-CN");
    });

    it("contains task instructions", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("abstract");
      expect(prompt).toContain("keyFindings");
      expect(prompt).toContain("fullMarkdown");
    });

    it("total words 0 when chapters is empty", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, chapters: [] },
        identity,
      });
      expect(prompt).toContain("总字数 0");
    });

    it("contains output JSON shape in prompt", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("totalWordCount");
    });
  });
});
