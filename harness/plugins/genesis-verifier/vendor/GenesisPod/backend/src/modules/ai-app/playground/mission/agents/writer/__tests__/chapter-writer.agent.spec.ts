/**
 * ChapterWriterAgent — unit tests
 *
 * 覆盖：
 *   - inputSchema: 合法 / 非法 / 边界值
 *   - outputSchema
 *   - buildSystemPrompt: targetWords 分支 (>=3000 / >=5000 / 普通)
 *     previousCritique / previousDraft / previousChapterHeadings 分支
 */

import { z } from "zod";
import {
  readDefineAgentMeta,
  assertNumberProducerWithinSchema,
} from "../../../../../../ai-harness/agents/dev-tools";
import { ChapterWriterAgent } from "../chapter-writer.agent";
import { CHAPTER_WORDS_PER_CHAPTER_RANGE } from "../../../../api/contracts/word-budget.contract";

const meta = readDefineAgentMeta(ChapterWriterAgent)!;
const inputSchema = meta.inputSchema as z.ZodType;
const outputSchema = meta.outputSchema as z.ZodType;

const baseChapter = {
  index: 1,
  heading: "Market Overview",
  thesis: "AI adoption is accelerating.",
  keyPoints: ["adoption rate", "cost reduction"],
};

const baseSource = {
  claim: "Revenue grew 40%",
  evidence: "Annual report 2024 shows 40% YoY",
  source: "https://example.com/annual-report",
};

const baseInput = {
  topic: "AI in Finance",
  dimension: "Market Growth",
  language: "zh-CN" as const,
  chapter: baseChapter,
  sources: [baseSource],
  targetWords: 1000,
};

const baseOutput = {
  index: 1,
  heading: "Market Overview",
  body: "This chapter covers the market overview in detail with evidence and analysis.",
  wordCount: 350,
  citationsUsed: ["https://example.com/annual-report"],
};

describe("ChapterWriterAgent", () => {
  let agent: ChapterWriterAgent;

  beforeAll(() => {
    agent = new ChapterWriterAgent();
  });

  // ★ 2026-05-22 契约单一源守护：生产方喂给 chapter-writer 的 targetWords 取值范围
  //   必须 ⊆ 本 agent inputSchema。生产方有两处 clamp：
  //     - per-dim-pipeline targetWordsPerChapter: Math.max(400, Math.min(8000, ...))
  //     - s7 normalizeTargetWords: [500, 12000]
  //   并集 = [400, 12000]。任一边漂移（如收紧 schema max）此测试即红。
  describe("contract: producer range ⊆ schema", () => {
    it("targetWords: pipeline producer range is within agent schema bounds", () => {
      const r = assertNumberProducerWithinSchema({
        agent: ChapterWriterAgent,
        field: "targetWords",
        producerMin: CHAPTER_WORDS_PER_CHAPTER_RANGE.min,
        producerMax: CHAPTER_WORDS_PER_CHAPTER_RANGE.max,
      });
      expect(r.ok ? "" : r.reason).toBe("");
      expect(r.ok).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // inputSchema
  // ─────────────────────────────────────────────

  describe("inputSchema", () => {
    it("accepts valid minimal input", () => {
      expect(inputSchema.safeParse(baseInput).success).toBe(true);
    });

    it("rejects targetWords below 200", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, targetWords: 199 }).success,
      ).toBe(false);
    });

    it("accepts targetWords = 200 (boundary min)", () => {
      const r = inputSchema.safeParse({ ...baseInput, targetWords: 200 });
      expect(r.success).toBe(true);
    });

    // ★ P0-R4-5 (round 4): targetWords 上限从 25000 降至 12000，避免 LLM
    // budget.maxTokens=22000 + 中文 1:1 token 永远写不到 ≥85% 字数门槛
    it("accepts targetWords = 12000 (boundary max round 4)", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, targetWords: 12000 }).success,
      ).toBe(true);
    });

    it("rejects targetWords above 12000", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, targetWords: 12001 }).success,
      ).toBe(false);
    });

    it("rejects non-integer targetWords", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, targetWords: 500.5 }).success,
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

    it("accepts optional previousChapterHeadings", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          previousChapterHeadings: ["Chapter 0: Intro"],
        }).success,
      ).toBe(true);
    });

    it("accepts optional previousCritique", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          previousCritique: "Needs more evidence",
        }).success,
      ).toBe(true);
    });

    it("accepts optional previousDraft", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          previousDraft: "Previous draft content here",
        }).success,
      ).toBe(true);
    });

    it("rejects missing topic", () => {
      const { topic: _, ...rest } = baseInput as Record<string, unknown>;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing chapter field", () => {
      const { chapter: _, ...rest } = baseInput as Record<string, unknown>;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects chapter with non-integer index", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          chapter: { ...baseChapter, index: 1.5 },
        }).success,
      ).toBe(false);
    });

    it("accepts empty sources array", () => {
      expect(inputSchema.safeParse({ ...baseInput, sources: [] }).success).toBe(
        true,
      );
    });
  });

  // ─────────────────────────────────────────────
  // outputSchema
  // ─────────────────────────────────────────────

  describe("outputSchema", () => {
    it("accepts valid output", () => {
      expect(outputSchema.safeParse(baseOutput).success).toBe(true);
    });

    it("rejects non-integer index", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, index: 1.5 }).success,
      ).toBe(false);
    });

    it("rejects non-integer wordCount", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, wordCount: 350.5 }).success,
      ).toBe(false);
    });

    it("rejects missing heading", () => {
      const { heading: _, ...rest } = baseOutput as Record<string, unknown>;
      expect(outputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing body", () => {
      const { body: _, ...rest } = baseOutput as Record<string, unknown>;
      expect(outputSchema.safeParse(rest).success).toBe(false);
    });

    it("accepts empty citationsUsed array", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, citationsUsed: [] }).success,
      ).toBe(true);
    });

    it("rejects citationsUsed as non-array", () => {
      expect(
        outputSchema.safeParse({ ...baseOutput, citationsUsed: "url" }).success,
      ).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // buildSystemPrompt
  // ─────────────────────────────────────────────

  describe("buildSystemPrompt", () => {
    const identity = {
      role: { id: "chapter-writer", name: "Writer" },
    } as never;

    it("contains chapter heading in prompt", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("Market Overview");
    });

    it("contains targetWords range in prompt (P2-728: 区间而非单一数字)", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      // targetWords=1000 → 区间 700–1400（避免 LLM 硬锚单一数字 → 章节恒为同字数）
      expect(prompt).toContain("700");
      expect(prompt).toContain("1400");
    });

    it("emits soft word-count guidance instead of hard threshold (2026-05-07)", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      // 字数软化后："建议字数: N 字（这是目标牵引，不是硬约束）" 取代 0.85/0.7 硬阈值
      expect(prompt).toContain("建议字数");
      expect(prompt).toContain("牵引");
      expect(prompt).toContain("不是硬约束");
    });

    it("explicitly tells LLM 不要为凑字数堆砌 (anti-padding)", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("不要为凑字数");
    });

    it("language zh-CN produces Chinese guide", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("简体中文");
    });

    it("language en-US produces English guide", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, language: "en-US" },
        identity,
      });
      expect(prompt).toContain("formal English");
    });

    it("targetWords >= 3000 adds paragraph count guide", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, targetWords: 3000 },
        identity,
      });
      expect(prompt).toContain("论述段落");
    });

    it("targetWords < 3000 does not add paragraph count guide", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, targetWords: 500 },
        identity,
      });
      expect(prompt).not.toContain("论述段落");
    });

    it("targetWords >= 5000 uses extended body structure", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, targetWords: 5000 },
        identity,
      });
      // Should show extended main body paragraph count
      expect(prompt).toContain("400-800 字");
    });

    it("targetWords < 5000 uses standard 3-5 paragraph structure", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, targetWords: 1500 },
        identity,
      });
      expect(prompt).toContain("3-5 段");
    });

    it("previousCritique is included when provided", () => {
      const prompt = agent.buildSystemPrompt({
        input: {
          ...baseInput,
          previousCritique: "Needs more data-backed evidence",
        },
        identity,
      });
      expect(prompt).toContain("Needs more data-backed evidence");
    });

    it("previousCritique section absent when not provided", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).not.toContain("Reviewer critique");
    });

    it("previousDraft is included when provided", () => {
      const prompt = agent.buildSystemPrompt({
        input: {
          ...baseInput,
          previousDraft: "DRAFT CONTENT HERE FOR REFERENCE",
        },
        identity,
      });
      expect(prompt).toContain("DRAFT CONTENT HERE FOR REFERENCE");
    });

    it("previousChapterHeadings appear in prompt", () => {
      const prompt = agent.buildSystemPrompt({
        input: {
          ...baseInput,
          previousChapterHeadings: ["Introduction", "Background"],
        },
        identity,
      });
      expect(prompt).toContain("Introduction");
      expect(prompt).toContain("Background");
    });

    it("sources appear in the source list", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("Revenue grew 40%");
      expect(prompt).toContain("https://example.com/annual-report");
    });

    it("dimension appears in prompt", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("Market Growth");
    });
  });
});
