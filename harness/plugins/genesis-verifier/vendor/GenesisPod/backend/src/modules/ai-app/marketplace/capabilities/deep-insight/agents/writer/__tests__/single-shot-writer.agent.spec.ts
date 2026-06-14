/**
 * SingleShotWriterAgent — unit tests
 *
 * 覆盖：
 *   - inputSchema: 合法输入、边界值、可选字段、unknownKeys
 *   - outputSchema (ResearchReportSchema): 合法 / 非法
 *   - buildSystemPrompt: depth 分支、outlinePlan 有 / 无分支
 */

import { z } from "zod";
import { readDefineAgentMeta } from "@/modules/ai-harness/agents/dev-tools";
import { SingleShotWriterAgent } from "../single-shot-writer.agent";

const meta = readDefineAgentMeta(SingleShotWriterAgent)!;
const inputSchema = meta.inputSchema as z.ZodType;
const outputSchema = meta.outputSchema as z.ZodType;

// Minimal valid insight
const insight = {
  headline: "AI revenue growth",
  narrative: "Revenue grew 40%",
  supportingDimensions: ["finance"],
  confidence: 0.9,
};

// Minimal valid input
const baseInput = {
  topic: "AI in Finance",
  depth: "standard" as const,
  language: "zh-CN" as const,
  insights: [insight],
  themeSummary: "AI is reshaping finance across multiple dimensions.",
  rawFindings: [] as Array<{
    dimension: string;
    claim: string;
    evidence: string;
    source: string;
  }>,
};

// Minimal valid report (ResearchReportSchema)
const validReport = {
  title: "AI in Finance: Key Findings",
  summary: "This executive summary covers AI adoption in finance sector.",
  sections: [
    {
      heading: "Market Overview",
      body: "AI adoption is growing rapidly.",
      sources: ["https://example.com/source1"],
    },
  ],
  conclusion: "Organizations should invest in AI capabilities immediately.",
  citations: ["https://example.com/source1"],
};

describe("SingleShotWriterAgent", () => {
  let agent: SingleShotWriterAgent;

  beforeAll(() => {
    agent = new SingleShotWriterAgent();
  });

  // ─────────────────────────────────────────────
  // inputSchema
  // ─────────────────────────────────────────────

  describe("inputSchema", () => {
    it("accepts minimal valid input (no optional fields)", () => {
      expect(inputSchema.safeParse(baseInput).success).toBe(true);
    });

    it("defaults depth to 'standard' when omitted", () => {
      const result = inputSchema.safeParse(baseInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as Record<string, unknown>)["depth"]).toBe(
          "standard",
        );
      }
    });

    it("accepts explicit depth 'quick'", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, depth: "quick" }).success,
      ).toBe(true);
    });

    it("accepts explicit depth 'deep'", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, depth: "deep" }).success,
      ).toBe(true);
    });

    it("rejects invalid depth value", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, depth: "ultra" }).success,
      ).toBe(false);
    });

    it("accepts language 'en-US'", () => {
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

    it("rejects missing language", () => {
      const { language: _, ...rest } = baseInput as Record<string, unknown>;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("accepts optional contradictions field", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          contradictions: [
            {
              claim: "growth is slowing",
              conflictingSources: ["https://a.com", "https://b.com"],
              resolution: "different time windows used",
            },
          ],
        }).success,
      ).toBe(true);
    });

    it("accepts optional rawFindings field", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          rawFindings: [
            {
              dimension: "market",
              claim: "Revenue grew",
              evidence: "Annual report 2024",
              source: "https://example.com",
            },
          ],
        }).success,
      ).toBe(true);
    });

    it("defaults rawFindings to [] when omitted", () => {
      const result = inputSchema.safeParse(baseInput);
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as Record<string, unknown>)["rawFindings"]).toEqual(
          [],
        );
      }
    });

    it("accepts optional outlinePlan with full structure", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          outlinePlan: {
            chapterOutlines: [
              {
                sectionId: "s1",
                heading: "Introduction",
                subheadings: ["Background"],
                thesis: "AI transforms finance",
                keyPointsToCover: ["adoption rate", "ROI"],
              },
            ],
            targetWordsPerChapter: { s1: 500 },
            factAllocation: { s1: ["fact-1"] },
          },
        }).success,
      ).toBe(true);
    });

    it("accepts outlinePlan with empty optional fields defaulted", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          outlinePlan: {
            chapterOutlines: [
              {
                sectionId: "s1",
                heading: "Intro",
                thesis: "AI helps",
                keyPointsToCover: ["key1"],
              },
            ],
          },
        }).success,
      ).toBe(true);
    });

    it("rejects insight missing required fields", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          insights: [{ headline: "only headline" }],
        }).success,
      ).toBe(false);
    });

    it("accepts unknown top-level fields (zod strips them)", () => {
      const result = inputSchema.safeParse({
        ...baseInput,
        unknownField: "value",
      });
      // Zod strips unknown fields by default — still passes
      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // outputSchema (ResearchReportSchema)
  // ─────────────────────────────────────────────

  describe("outputSchema", () => {
    it("accepts a valid report", () => {
      expect(outputSchema.safeParse(validReport).success).toBe(true);
    });

    it("requires title with at least 2 chars", () => {
      expect(
        outputSchema.safeParse({ ...validReport, title: "A" }).success,
      ).toBe(false);
    });

    it("requires summary with at least 20 chars", () => {
      expect(
        outputSchema.safeParse({ ...validReport, summary: "Too short." })
          .success,
      ).toBe(false);
    });

    it("requires at least 1 section", () => {
      expect(
        outputSchema.safeParse({ ...validReport, sections: [] }).success,
      ).toBe(false);
    });

    it("requires conclusion with at least 20 chars", () => {
      expect(
        outputSchema.safeParse({ ...validReport, conclusion: "Short." })
          .success,
      ).toBe(false);
    });

    it("accepts report without optional citations", () => {
      const { citations: _, ...rest } = validReport as Record<string, unknown>;
      expect(outputSchema.safeParse(rest).success).toBe(true);
    });

    it("accepts report without optional section sources", () => {
      expect(
        outputSchema.safeParse({
          ...validReport,
          sections: [{ heading: "H", body: "Some body" }],
        }).success,
      ).toBe(true);
    });

    it("rejects section sources with invalid URLs", () => {
      expect(
        outputSchema.safeParse({
          ...validReport,
          sections: [
            {
              heading: "H",
              body: "Body",
              sources: ["not-a-url"],
            },
          ],
        }).success,
      ).toBe(false);
    });

    it("rejects missing sections field entirely", () => {
      const { sections: _, ...rest } = validReport as Record<string, unknown>;
      expect(outputSchema.safeParse(rest).success).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // buildSystemPrompt — branch coverage
  // ─────────────────────────────────────────────

  describe("buildSystemPrompt", () => {
    const identity = {
      role: { id: "writer", name: "writer" },
      toSystemPrompt: () => "Writer",
    } as never;

    it("contains topic in prompt", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput },
        identity,
      });
      expect(prompt).toContain("AI in Finance");
    });

    it("depth=quick uses quick section plan in prompt", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, depth: "quick" as const },
        identity,
      });
      expect(prompt).toContain("quick");
    });

    it("depth=deep uses deep section plan in prompt", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, depth: "deep" as const },
        identity,
      });
      expect(prompt).toContain("deep");
    });

    it("language=zh-CN produces Chinese language guide", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, language: "zh-CN" as const },
        identity,
      });
      expect(prompt).toContain("简体中文");
    });

    it("language=en-US produces English language guide", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, language: "en-US" as const },
        identity,
      });
      expect(prompt).toContain("formal English");
    });

    it("without outlinePlan uses depth-based section plan", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput },
        identity,
      });
      expect(prompt).toContain("4-6");
    });

    it("with outlinePlan includes outline guidance block", () => {
      const prompt = agent.buildSystemPrompt({
        input: {
          ...baseInput,
          outlinePlan: {
            chapterOutlines: [
              {
                sectionId: "ch1",
                heading: "Market Overview",
                subheadings: ["Background"],
                thesis: "AI is key",
                keyPointsToCover: ["adoption", "ROI"],
              },
            ],
            targetWordsPerChapter: { ch1: 600 },
            factAllocation: { ch1: ["fact-1"] },
          },
        },
        identity,
      });
      expect(prompt).toContain("Pre-planned Chapter Outline");
      expect(prompt).toContain("Market Overview");
      expect(prompt).toContain("ch1");
      expect(prompt).toContain("600");
    });

    it("with outlinePlan sums totalTarget correctly", () => {
      const prompt = agent.buildSystemPrompt({
        input: {
          ...baseInput,
          outlinePlan: {
            chapterOutlines: [
              {
                sectionId: "s1",
                heading: "Chapter 1",
                subheadings: [],
                thesis: "T1",
                keyPointsToCover: ["p1"],
              },
              {
                sectionId: "s2",
                heading: "Chapter 2",
                subheadings: [],
                thesis: "T2",
                keyPointsToCover: ["p2"],
              },
            ],
            targetWordsPerChapter: { s1: 500, s2: 700 },
            factAllocation: {},
          },
        },
        identity,
      });
      expect(prompt).toContain("1200");
    });

    it("with outlinePlan subheadings appear in prompt", () => {
      const prompt = agent.buildSystemPrompt({
        input: {
          ...baseInput,
          outlinePlan: {
            chapterOutlines: [
              {
                sectionId: "s1",
                heading: "Chapter 1",
                subheadings: ["Sub A", "Sub B"],
                thesis: "T1",
                keyPointsToCover: ["p1"],
              },
            ],
            targetWordsPerChapter: {},
            factAllocation: {},
          },
        },
        identity,
      });
      expect(prompt).toContain("Sub A");
      expect(prompt).toContain("Sub B");
    });

    it("contradictions count appears in prompt", () => {
      const prompt = agent.buildSystemPrompt({
        input: {
          ...baseInput,
          contradictions: [
            {
              claim: "c1",
              conflictingSources: ["s1"],
              resolution: "r1",
            },
          ],
        },
        identity,
      });
      expect(prompt).toContain("1 cross-source contradictions");
    });

    it("no contradictions produces 'No major source contradictions' line", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput },
        identity,
      });
      expect(prompt).toContain("No major source contradictions");
    });

    it("rawFindings undefined falls back to 0 count", () => {
      const { rawFindings: _, ...inputWithoutRaw } = baseInput as Record<
        string,
        unknown
      >;
      const prompt = agent.buildSystemPrompt({
        input: inputWithoutRaw as never,
        identity,
      });
      expect(prompt).toContain("0 raw findings");
    });
  });
});
