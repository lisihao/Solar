/**
 * DimensionQualityJudgeAgent — unit tests
 *
 * 覆盖：
 *   - inputSchema
 *   - outputSchema: 6-axis scores (added sources_sufficiency), grade enum, overall bounds
 *   - buildSystemPrompt: axis descriptions, weighted formula, grade mapping,
 *     source list (sliced to 30), fullMarkdown slice
 */

import { z } from "zod";
import { readDefineAgentMeta } from "@/modules/ai-harness/agents/dev-tools";
import { DimensionQualityJudgeAgent } from "../dimension-quality-judge.agent";

const meta = readDefineAgentMeta(DimensionQualityJudgeAgent)!;
const inputSchema = meta.inputSchema as z.ZodType;
const outputSchema = meta.outputSchema as z.ZodType;

const baseInput = {
  topic: "AI in Finance",
  dimension: "Market Growth",
  language: "zh-CN" as const,
  abstract:
    "AI is transforming financial markets with measurable revenue impacts.",
  fullMarkdown: "# Market Growth\n\nAI adoption grew 40% in 2024...",
  totalWordCount: 1500,
  sources: [
    { url: "https://example.com/source1", publishedDate: "2024-01-15" },
    { url: "https://example.com/source2" },
  ],
};

const axisScore = { score: 80, comment: "Good coverage" };

const baseOutput = {
  dimension: "Market Growth",
  overall: 78,
  grade: "good" as const,
  axes: {
    breadth: axisScore,
    depth: axisScore,
    evidence: axisScore,
    coherence: axisScore,
    freshness: axisScore,
    // ★ B-axis (2026-05-06): 6th axis added
    sources_sufficiency: axisScore,
  },
  summary: "Overall a strong dimension report with good evidence coverage.",
};

describe("DimensionQualityJudgeAgent", () => {
  let agent: DimensionQualityJudgeAgent;

  beforeAll(() => {
    agent = new DimensionQualityJudgeAgent();
  });

  // ─────────────────────────────────────────────
  // inputSchema
  // ─────────────────────────────────────────────

  describe("inputSchema", () => {
    it("accepts valid minimal input", () => {
      expect(inputSchema.safeParse(baseInput).success).toBe(true);
    });

    it("accepts source without publishedDate", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          sources: [{ url: "https://example.com" }],
        }).success,
      ).toBe(true);
    });

    it("accepts empty sources array", () => {
      expect(inputSchema.safeParse({ ...baseInput, sources: [] }).success).toBe(
        true,
      );
    });

    it("accepts language en-US", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, language: "en-US" }).success,
      ).toBe(true);
    });

    it("rejects invalid language", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, language: "es-ES" }).success,
      ).toBe(false);
    });

    it("rejects non-integer totalWordCount", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, totalWordCount: 1500.5 }).success,
      ).toBe(false);
    });

    it("rejects missing abstract", () => {
      const { abstract: _, ...rest } = baseInput as Record<string, unknown>;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing fullMarkdown", () => {
      const { fullMarkdown: _, ...rest } = baseInput as Record<string, unknown>;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing topic", () => {
      const { topic: _, ...rest } = baseInput as Record<string, unknown>;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing dimension", () => {
      const { dimension: _, ...rest } = baseInput as Record<string, unknown>;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // outputSchema
  // ─────────────────────────────────────────────

  describe("outputSchema", () => {
    it("accepts valid output", () => {
      expect(outputSchema.safeParse(baseOutput).success).toBe(true);
    });

    it("accepts all grade values", () => {
      for (const grade of ["excellent", "good", "fair", "poor"] as const) {
        expect(outputSchema.safeParse({ ...baseOutput, grade }).success).toBe(
          true,
        );
      }
    });

    // ★ 2026-05-13 #65: schema 改 coercedEnum/coercedScore + axis fallback default
    //   后，下列原本"严格拒绝"的输入现在都会被吸收（clamp / fall-back），让 LLM
    //   输出漂移不再导致整张 grade 丢。spec 更新对应预期。
    it("coerces invalid grade to fail-closed default 'fair'", () => {
      const r = outputSchema.safeParse({ ...baseOutput, grade: "average" });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.grade).toBe("fair");
    });

    it("clamps overall score below 0 to 0", () => {
      const r = outputSchema.safeParse({ ...baseOutput, overall: -1 });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.overall).toBe(0);
    });

    it("clamps overall score above 100 to 100", () => {
      const r = outputSchema.safeParse({ ...baseOutput, overall: 101 });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.overall).toBe(100);
    });

    it("accepts overall score at boundary 0", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, overall: 0 }).success,
      ).toBe(true);
    });

    it("accepts overall score at boundary 100", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, overall: 100 }).success,
      ).toBe(true);
    });

    it("accepts non-integer overall (coerced, not rejected)", () => {
      const r = outputSchema.safeParse({ ...baseOutput, overall: 78.5 });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.overall).toBe(78.5);
    });

    it("clamps axis score below 0 to 0", () => {
      const r = outputSchema.safeParse({
        ...baseOutput,
        axes: {
          ...baseOutput.axes,
          breadth: { score: -1, comment: "bad" },
        },
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.axes.breadth.score).toBe(0);
    });

    it("clamps axis score above 100 to 100", () => {
      const r = outputSchema.safeParse({
        ...baseOutput,
        axes: {
          ...baseOutput.axes,
          depth: { score: 101, comment: "too high" },
        },
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.axes.depth.score).toBe(100);
    });

    it("accepts non-integer axis score (coerced, not rejected)", () => {
      const r = outputSchema.safeParse({
        ...baseOutput,
        axes: {
          ...baseOutput.axes,
          evidence: { score: 75.5, comment: "decimal" },
        },
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.axes.evidence.score).toBe(75.5);
    });

    it("rejects missing axes", () => {
      const { axes: _, ...rest } = baseOutput as Record<string, unknown>;
      expect(outputSchema.safeParse(rest).success).toBe(false);
    });

    it("fills missing breadth axis with default fallback", () => {
      const { breadth: _, ...axesRest } = baseOutput.axes as Record<
        string,
        unknown
      >;
      const r = outputSchema.safeParse({ ...baseOutput, axes: axesRest });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.axes.breadth.score).toBe(60);
        expect(r.data.axes.breadth.comment).toBe("");
      }
    });

    it("fills missing summary with empty string default", () => {
      const { summary: _, ...rest } = baseOutput as Record<string, unknown>;
      const r = outputSchema.safeParse(rest);
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.summary).toBe("");
    });

    it("accepts output with excellent grade (score ≥ 85)", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          overall: 90,
          grade: "excellent",
        }).success,
      ).toBe(true);
    });

    it("accepts output with poor grade (score < 55)", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          overall: 45,
          grade: "poor",
        }).success,
      ).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // buildSystemPrompt
  // ─────────────────────────────────────────────

  describe("buildSystemPrompt", () => {
    const identity = {
      role: { id: "quality-judge", name: "Quality Judge" },
    } as never;

    it("contains dimension name", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("Market Growth");
    });

    it("contains topic", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("AI in Finance");
    });

    it("contains 6 axis descriptions", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("breadth");
      expect(prompt).toContain("depth");
      expect(prompt).toContain("evidence");
      expect(prompt).toContain("coherence");
      expect(prompt).toContain("freshness");
      expect(prompt).toContain("sources_sufficiency");
    });

    it("contains updated weighted formula with sources_sufficiency 12%", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("18%");
      expect(prompt).toContain("22%");
      expect(prompt).toContain("12%");
    });

    it("contains grade mapping thresholds", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("85");
      expect(prompt).toContain("70-84");
      expect(prompt).toContain("55-69");
    });

    it("contains source list entries", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("https://example.com/source1");
      expect(prompt).toContain("2024-01-15");
    });

    it("source without publishedDate shows no date", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("https://example.com/source2");
    });

    it("shows source count in prompt", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("2 条");
    });

    it("slices fullMarkdown to 4000 chars", () => {
      const longMarkdown = "A".repeat(5000);
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, fullMarkdown: longMarkdown },
        identity,
      });
      // The sliced version (4000 A's) should be in the prompt
      expect(prompt).toContain("A".repeat(100));
      // Full 5000 chars should NOT be in prompt
      expect(prompt.includes("A".repeat(5000))).toBe(false);
    });

    it("slices sources to 30 entries max", () => {
      const manySources = Array.from({ length: 35 }, (_, i) => ({
        url: `https://example.com/source${i}`,
        publishedDate: "2024-01-01",
      }));
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, sources: manySources },
        identity,
      });
      // Source 30 (index 30) should NOT appear
      expect(prompt).not.toContain("source34");
    });

    it("contains abstract in prompt", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain(
        "AI is transforming financial markets with measurable revenue impacts.",
      );
    });

    it("contains language in prompt", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("zh-CN");
    });
  });

  // ── B-axis regression spec (2026-05-06) ─────────────────────────────────

  describe("sources_sufficiency axis (B-alignment)", () => {
    // 2026-05-13 #65: schema 改 axis-fallback default 后，缺 sources_sufficiency
    // 不再 hard-fail，而是填默认值（避免 LLM 偶发漏一个轴就整张评分丢）。
    it("[B-regression] fills missing sources_sufficiency axis with default", () => {
      const outputMissingSuffix = {
        ...baseOutput,
        axes: {
          breadth: axisScore,
          depth: axisScore,
          evidence: axisScore,
          coherence: axisScore,
          freshness: axisScore,
          // sources_sufficiency intentionally omitted
        },
      };
      const r = outputSchema.safeParse(outputMissingSuffix);
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.axes.sources_sufficiency.score).toBe(60);
        expect(r.data.axes.sources_sufficiency.comment).toBe("");
      }
    });

    it("[B-regression] outputSchema accepts valid 6-axis output with sources_sufficiency", () => {
      const fullOutput = {
        ...baseOutput,
        axes: {
          ...baseOutput.axes,
          sources_sufficiency: {
            score: 75,
            comment: "5 unique domains present",
          },
        },
      };
      expect(outputSchema.safeParse(fullOutput).success).toBe(true);
    });

    // ★ 2026-05-21 P2 Evidence Contract：sources_sufficiency 改为「相对评分」，
    //   废除绝对 ≥5 悬崖（采得少但充分利用也可满分）。断言随之更新。
    it("[B-regression] prompt includes sources_sufficiency as relative scoring (no absolute >=5 cliff)", () => {
      const id = {
        role: { id: "quality-judge", name: "Quality Judge" },
      } as never;
      const prompt = agent.buildSystemPrompt({
        input: baseInput,
        identity: id,
      });
      expect(prompt).toContain("sources_sufficiency");
      expect(prompt).toContain("相对评分");
      // 绝对 ≥5 悬崖必须已移除
      expect(prompt).not.toContain("≥ 5 个唯一 source");
      expect(prompt).toContain("12%"); // weight in formula
    });

    it("[B-regression] prompt shows current sources count for sources_sufficiency", () => {
      const id = {
        role: { id: "quality-judge", name: "Quality Judge" },
      } as never;
      const prompt = agent.buildSystemPrompt({
        input: baseInput,
        identity: id,
      });
      // baseInput has 2 sources → prompt should mention the count
      expect(prompt).toContain("当前已收集 sources 数量: 2");
    });
  });
});
