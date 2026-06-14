/**
 * MissionOutlinePlannerAgent — unit tests
 *
 * 覆盖：
 *   - inputSchema: all lengthProfile values, audienceProfile, styleProfile, withFigures
 *   - outputSchema: chapterOutlines (thesis min 10), targetWordsPerChapter
 *   - buildSystemPrompt: lengthTarget mapping, perChapter cap 12000 (round 4),
 *     requiresMoreChaptersForCap branch, withFigures branch
 */

import { z } from "zod";
import { readDefineAgentMeta } from "@/modules/ai-harness/agents/dev-tools";
import { MissionOutlinePlannerAgent } from "../mission-outline-planner.agent";
import { resolveMissionTotalWords } from "@/modules/ai-app/playground/api/contracts/word-budget.contract";

const meta = readDefineAgentMeta(MissionOutlinePlannerAgent)!;
const inputSchema = meta.inputSchema as z.ZodType;
const outputSchema = meta.outputSchema as z.ZodType;

const basePlan = {
  themeSummary: "AI is reshaping every vertical of the finance industry.",
  dimensions: [
    { id: "dim1", name: "Market Growth", rationale: "Core revenue impact" },
    { id: "dim2", name: "Tech Adoption", rationale: "Infrastructure change" },
  ],
};

const baseInput = {
  topic: "AI in Finance",
  language: "zh-CN" as const,
  depth: "deep" as const,
  audienceProfile: "executive" as const,
  styleProfile: "executive" as const,
  lengthProfile: "standard" as const,
  withFigures: false,
  plan: basePlan,
};

const validChapterOutline = {
  sectionId: "dim1",
  heading: "Market Growth Overview",
  subheadings: ["Revenue Impact", "ROI Analysis"],
  thesis: "AI investments deliver measurable returns in financial services.",
  keyPointsToCover: ["adoption rate", "cost reduction", "revenue growth"],
};

const baseOutput = {
  chapterOutlines: [validChapterOutline],
  targetWordsPerChapter: { dim1: 4000 },
  factAllocation: { dim1: ["fact-1"] },
  figurePlan: {},
};

describe("MissionOutlinePlannerAgent", () => {
  let agent: MissionOutlinePlannerAgent;

  beforeAll(() => {
    agent = new MissionOutlinePlannerAgent();
  });

  // ─────────────────────────────────────────────
  // inputSchema
  // ─────────────────────────────────────────────

  describe("inputSchema", () => {
    it("accepts valid minimal input", () => {
      expect(inputSchema.safeParse(baseInput).success).toBe(true);
    });

    it("accepts all lengthProfile values", () => {
      const profiles = [
        "brief",
        "standard",
        "deep",
        "extended",
        "epic",
        "mega",
      ] as const;
      for (const p of profiles) {
        expect(
          inputSchema.safeParse({ ...baseInput, lengthProfile: p }).success,
        ).toBe(true);
      }
    });

    it("rejects invalid lengthProfile", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, lengthProfile: "ultra" }).success,
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
        inputSchema.safeParse({ ...baseInput, audienceProfile: "student" })
          .success,
      ).toBe(false);
    });

    it("accepts all styleProfile values", () => {
      for (const p of [
        "academic",
        "executive",
        "journalistic",
        "technical",
      ] as const) {
        expect(
          inputSchema.safeParse({ ...baseInput, styleProfile: p }).success,
        ).toBe(true);
      }
    });

    it("accepts withFigures true", () => {
      expect(
        inputSchema.safeParse({ ...baseInput, withFigures: true }).success,
      ).toBe(true);
    });

    it("accepts optional factTable", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          factTable: [
            {
              id: "fact-1",
              entity: "McKinsey",
              attribute: "revenue",
              value: "40%",
            },
          ],
        }).success,
      ).toBe(true);
    });

    it("accepts optional figureCandidates", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          figureCandidates: [{ id: "fig-1", caption: "AI Adoption Chart" }],
        }).success,
      ).toBe(true);
    });

    it("rejects missing topic", () => {
      const { topic: _, ...rest } = baseInput as Record<string, unknown>;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing plan", () => {
      const { plan: _, ...rest } = baseInput as Record<string, unknown>;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects plan dimension missing id", () => {
      expect(
        inputSchema.safeParse({
          ...baseInput,
          plan: {
            ...basePlan,
            dimensions: [{ name: "Test", rationale: "r" }],
          },
        }).success,
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

    it("rejects thesis shorter than 10 chars", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          chapterOutlines: [{ ...validChapterOutline, thesis: "Short" }],
        }).success,
      ).toBe(false);
    });

    it("accepts thesis at exactly 10 chars", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          chapterOutlines: [{ ...validChapterOutline, thesis: "1234567890" }],
        }).success,
      ).toBe(true);
    });

    it("rejects keyPointsToCover as empty array", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          chapterOutlines: [{ ...validChapterOutline, keyPointsToCover: [] }],
        }).success,
      ).toBe(false);
    });

    it("accepts keyPointsToCover with one item", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          chapterOutlines: [
            { ...validChapterOutline, keyPointsToCover: ["point1"] },
          ],
        }).success,
      ).toBe(true);
    });

    it("accepts empty chapterOutlines array with empty factAllocation", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          chapterOutlines: [],
          factAllocation: {},
          targetWordsPerChapter: {},
        }).success,
      ).toBe(true);
    });

    it("accepts factAllocation with multiple entries matching chapterOutlines sectionIds", () => {
      const dim2Chapter = {
        sectionId: "dim2",
        heading: "Tech Adoption Overview",
        subheadings: [],
        thesis: "Tech adoption drives revenue outcomes.",
        keyPointsToCover: ["infra", "cost"],
      };
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          chapterOutlines: [validChapterOutline, dim2Chapter],
          targetWordsPerChapter: { dim1: 4000, dim2: 4000 },
          factAllocation: { dim1: ["fact-1", "fact-2"], dim2: ["fact-3"] },
        }).success,
      ).toBe(true);
    });

    it("defaults factAllocation to {} when omitted", () => {
      const { factAllocation: _, ...rest } = baseOutput as Record<
        string,
        unknown
      >;
      const r = outputSchema.safeParse(rest);
      expect(r.success).toBe(true);
      if (r.success) {
        expect((r.data as Record<string, unknown>)["factAllocation"]).toEqual(
          {},
        );
      }
    });

    it("accepts figurePlan with entries", () => {
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          figurePlan: { dim1: ["fig-1"] },
        }).success,
      ).toBe(true);
    });

    it("rejects missing sectionId in chapterOutline", () => {
      const { sectionId: _, ...rest } = validChapterOutline as Record<
        string,
        unknown
      >;
      expect(
        outputSchema.safeParse({
          ...baseOutput,
          chapterOutlines: [rest],
        }).success,
      ).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // buildSystemPrompt
  // ─────────────────────────────────────────────

  describe("buildSystemPrompt", () => {
    const identity = {
      role: { id: "outline-planner", name: "Outline Planner" },
    } as never;

    // ★ 2026-05-22 ③L/M：总字数改为 resolveMissionTotalWords(depth, lengthProfile)
    //   单一源（depthBase × 密度倍率），不再是 lengthProfile 写死值。断言用契约函数
    //   计算期望值（而非硬编码 3000/8000/...），契约改了测试自动跟随、不再漂移。
    it.each(["brief", "standard", "deep", "extended", "epic", "mega"] as const)(
      "%s lengthProfile uses resolveMissionTotalWords(depth, lp) target",
      (lp) => {
        const prompt = agent.buildSystemPrompt({
          input: { ...baseInput, lengthProfile: lp },
          identity,
        });
        const expected = resolveMissionTotalWords(baseInput.depth, lp);
        expect(prompt).toContain(String(expected));
      },
    );

    it("contains topic in prompt", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("AI in Finance");
    });

    it("contains audienceProfile", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("executive");
    });

    it("contains styleProfile", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("executive");
    });

    it("withFigures=false produces figurePlan empty note", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, withFigures: false },
        identity,
      });
      expect(prompt).toContain("figurePlan 给 {} 空对象即可");
    });

    it("withFigures=true does not produce figurePlan empty note", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, withFigures: true },
        identity,
      });
      expect(prompt).not.toContain("figurePlan 给 {} 空对象即可");
    });

    it("epic with 2 dimensions: naive perChapter 40000 > cap 12000 → shows warning (round 4)", () => {
      // ★ round 4: cap 已从 25000 降到 12000；epic = 80000 / 2 = 40000 仍 > 12000
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, lengthProfile: "epic" },
        identity,
      });
      expect(prompt).toContain("12000");
      expect(prompt).toContain("超出单章");
    });

    // ★ 2026-05-22 ③L/M：总字数 = depthBase × 倍率，体量随 depth 变大。要触发"无警告"
    //   需小体量配置：quick(10K)×brief(0.7)=7K，分到 2 维度仍 ≤ 单章 cap 12000。
    it("quick+brief small total: perChapter <= cap, no warning", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, depth: "quick", lengthProfile: "brief" },
        identity,
      });
      expect(prompt).not.toContain("超出单章");
    });

    it("contains zh-CN language instruction", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      expect(prompt).toContain("用中文输出");
    });

    it("en-US language produces English instruction", () => {
      const prompt = agent.buildSystemPrompt({
        input: { ...baseInput, language: "en-US" },
        identity,
      });
      expect(prompt).toContain("Respond in English");
    });

    it("contains plan themeSummary reference", () => {
      const prompt = agent.buildSystemPrompt({ input: baseInput, identity });
      // The prompt mentions dimensions exist for planning
      expect(prompt).toContain("plan.dimension");
    });
  });
});
