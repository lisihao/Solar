/**
 * DimensionOutlinePlannerAgent — unit tests
 *
 * 覆盖：
 *   - inputSchema: targetChapterCount min(1)/max(25)（CHAPTER_COUNT_RANGE 单一源）
 *   - outputSchema: chapters array min(1), nested fields
 *   - buildSystemPrompt: finding list, targetChapterCount in prompt
 *   - 契约: 管线产出范围 ⊆ schema（assertNumberProducerWithinSchema）
 */

import { z } from "zod";
import {
  readDefineAgentMeta,
  assertNumberProducerWithinSchema,
} from "../../../../../../ai-harness/agents/dev-tools";
import { DimensionOutlinePlannerAgent } from "../dimension-outline-planner.agent";
import { CHAPTER_COUNT_RANGE } from "../../../../api/contracts/chapter-count.contract";

const meta = readDefineAgentMeta(DimensionOutlinePlannerAgent)!;
const inputSchema = meta.inputSchema as z.ZodType;
const outputSchema = meta.outputSchema as z.ZodType;

const finding = {
  claim: "AI revenue grew 40% in 2024",
  evidence: "According to McKinsey annual report 2024, revenue growth was 40%.",
  source: "https://mckinsey.com/reports/ai-2024",
};

const baseInput = {
  topic: "AI in Finance",
  dimension: "Market Growth",
  language: "zh-CN" as const,
  dimensionSummary:
    "AI is rapidly transforming the financial landscape with measurable ROI.",
  findings: [finding],
  targetChapterCount: 4,
};

const baseChapterOutput = {
  index: 1,
  heading: "AI Revenue Growth Drivers",
  thesis: "AI investments are producing measurable financial returns.",
  keyPoints: ["ROI measurement", "adoption rate"],
  sourceIndices: [0],
};

const baseOutput = {
  dimension: "Market Growth",
  chapters: [baseChapterOutput],
};

describe("DimensionOutlinePlannerAgent", () => {
  let agent: DimensionOutlinePlannerAgent;

  beforeAll(() => {
    agent = new DimensionOutlinePlannerAgent();
  });

  // ─────────────────────────────────────────────
  // inputSchema
  // ─────────────────────────────────────────────

  // ★ 2026-05-22 契约单一源守护：管线 per-dim-pipeline 产出的 targetChapterCount
  //   范围（CHAPTER_COUNT_RANGE）必须 ⊆ 本 agent inputSchema 接受范围。任一边漂移
  //   此测试即红，漂移合不进主干（治 ORCH_CHAPTER_PIPELINE_FAILED 这类系统性 bug）。
  describe("contract: producer range ⊆ schema", () => {
    it("targetChapterCount: pipeline range is within agent schema bounds", () => {
      const r = assertNumberProducerWithinSchema({
        agent: DimensionOutlinePlannerAgent,
        field: "targetChapterCount",
        producerMin: CHAPTER_COUNT_RANGE.min,
        producerMax: CHAPTER_COUNT_RANGE.max,
      });
      expect(r.ok ? "" : r.reason).toBe("");
      expect(r.ok).toBe(true);
    });
  });

  describe("inputSchema", () => {
    it("accepts valid input", () => {
      expect(inputSchema.safeParse(baseInput).success).toBe(true);
    });

    // ★ 2026-05-22 契约单一源：min 由 3 改为 1（CHAPTER_COUNT_RANGE.min）。
    //   稀缺证据维度合法只开 1 章；旧 min(3) 与管线 [1,25] 漂移 → ORCH_CHAPTER_PIPELINE_FAILED。
    it("accepts targetChapterCount at min boundary 1", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, targetChapterCount: 1 }).success,
      ).toBe(true);
    });

    it("rejects targetChapterCount below 1 (0)", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, targetChapterCount: 0 }).success,
      ).toBe(false);
    });

    it("accepts targetChapterCount at max boundary 25", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, targetChapterCount: 25 }).success,
      ).toBe(true);
    });

    it("rejects targetChapterCount above 25", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, targetChapterCount: 26 }).success,
      ).toBe(false);
    });

    it("rejects non-integer targetChapterCount", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, targetChapterCount: 4.5 })
          .success,
      ).toBe(false);
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

    it("accepts empty findings array", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, findings: [] }).success,
      ).toBe(true);
    });

    it("accepts multiple findings", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          findings: [finding, finding],
        }).success,
      ).toBe(true);
    });

    it("rejects finding missing claim", () => {
      const { claim: _, ...restFinding } = finding as Record<string, unknown>;
      expect(
        inputSchema.safeParse({ ...baseInput, findings: [restFinding] })
          .success,
      ).toBe(false);
    });

    it("rejects finding missing evidence", () => {
      const { evidence: _, ...restFinding } = finding as Record<
        string,
        unknown
      >;
      expect(
        inputSchema.safeParse({ ...baseInput, findings: [restFinding] })
          .success,
      ).toBe(false);
    });

    it("rejects finding missing source", () => {
      const { source: _, ...restFinding } = finding as Record<string, unknown>;
      expect(
        inputSchema.safeParse({ ...baseInput, findings: [restFinding] })
          .success,
      ).toBe(false);
    });

    it("rejects missing dimensionSummary", () => {
      const { dimensionSummary: _, ...rest } = baseInput as Record<
        string,
        unknown
      >;
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

    it("rejects empty chapters array (min 1)", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, chapters: [] }).success,
      ).toBe(false);
    });

    it("accepts chapters array with min 1 item", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, chapters: [baseChapterOutput] })
          .success,
      ).toBe(true);
    });

    it("rejects chapter with index < 1", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          chapters: [{ ...baseChapterOutput, index: 0 }],
        }).success,
      ).toBe(false);
    });

    it("rejects chapter with non-integer index", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          chapters: [{ ...baseChapterOutput, index: 1.5 }],
        }).success,
      ).toBe(false);
    });

    it("rejects sourceIndices containing negative value", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          chapters: [{ ...baseChapterOutput, sourceIndices: [-1] }],
        }).success,
      ).toBe(false);
    });

    it("accepts sourceIndices starting from 0", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          chapters: [{ ...baseChapterOutput, sourceIndices: [0, 1, 2] }],
        }).success,
      ).toBe(true);
    });

    it("accepts empty sourceIndices", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          chapters: [{ ...baseChapterOutput, sourceIndices: [] }],
        }).success,
      ).toBe(true);
    });

    it("rejects missing heading in chapter", () => {
      const { heading: _, ...rest } = baseChapterOutput as Record<
        string,
        unknown
      >;
      expect(
        outputSchema.safeParse({ ...baseOutput, chapters: [rest] }).success,
      ).toBe(false);
    });

    it("rejects missing thesis in chapter", () => {
      const { thesis: _, ...rest } = baseChapterOutput as Record<
        string,
        unknown
      >;
      expect(
        outputSchema.safeParse({ ...baseOutput, chapters: [rest] }).success,
      ).toBe(false);
    });

    it("rejects missing dimension in output", () => {
      const { dimension: _, ...rest } = baseOutput as Record<string, unknown>;
      expect(outputSchema.safeParse(rest).success).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // buildSystemPrompt
  // ─────────────────────────────────────────────

  describe("buildSystemPrompt", () => {
    const identity = {
      role: { id: "outline", name: "Outline Planner" },
    } as never;

    it("contains dimension name", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("Market Growth");
    });

    it("contains topic name", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("AI in Finance");
    });

    it("contains targetChapterCount", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("4");
    });

    it("contains language instruction", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("zh-CN");
    });

    it("contains dimension summary", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("AI is rapidly transforming");
    });

    it("contains finding claim in source list", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("AI revenue grew 40% in 2024");
    });

    it("contains finding source URL in source list", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("https://mckinsey.com/reports/ai-2024");
    });

    it("contains output JSON shape guidance", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("sourceIndices");
      expect(prompt).toContain("keyPoints");
    });

    it("formats finding evidence truncated to 120 chars", () => {
      const longFinding = {
        ...finding,
        evidence: "E".repeat(200),
      };
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, findings: [longFinding] },
        identity,
      });
      // The prompt should contain the truncated version
      expect(prompt).toContain("E".repeat(120));
    });

    it("no findings produces empty source list", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, findings: [] },
        identity,
      });
      expect(prompt).toContain("Available findings");
    });
  });
});
