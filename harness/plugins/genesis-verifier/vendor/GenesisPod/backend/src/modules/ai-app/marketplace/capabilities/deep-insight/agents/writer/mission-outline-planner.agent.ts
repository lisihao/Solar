/**
 * MissionOutlinePlannerAgent —— Writer W1：写作大纲规划
 *
 * 上游：mission-pipeline-baseline.md §3.7 W1 / mission-pipeline-writer-artifact.md §3.1
 *
 * 职责：在 W2 ChapterWriter 并行写章前，先做一次：
 *   - 章节骨架 chapterOutlines
 *   - 字数分配 targetWordsPerChapter
 *   - 事实分配 factAllocation（解决 TI 章节抢/漏事实的问题）
 *   - 图分配 figurePlan（仅 withFigures=true 时启用）
 *
 * 不调工具，纯规划。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import {
  resolveMissionTotalWords,
  CHAPTER_WORDS_PER_CHAPTER_RANGE,
} from "../../contract/word-budget.contract";

const Input = z.object({
  topic: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  // ★ 2026-05-22 ③L/M：总字数 = depthBase × lengthProfile 倍率，需 depth。
  depth: z.enum(["quick", "standard", "deep"]),
  audienceProfile: z.enum(["executive", "domain-expert", "general-public"]),
  styleProfile: z.enum(["academic", "executive", "journalistic", "technical"]),
  lengthProfile: z.enum([
    "brief",
    "standard",
    "deep",
    "extended",
    "epic",
    "mega",
  ]),
  withFigures: z.boolean(),
  plan: z.object({
    themeSummary: z.string(),
    dimensions: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        rationale: z.string(),
      }),
    ),
  }),
  factTable: z
    .array(
      z.object({
        id: z.string(),
        entity: z.string(),
        attribute: z.string(),
        value: z.string(),
      }),
    )
    .optional(),
  figureCandidates: z
    .array(
      z.object({
        id: z.string(),
        caption: z.string(),
        fromDimensionId: z.string().optional(),
      }),
    )
    .optional(),
});

const Output = z
  .object({
    chapterOutlines: z.array(
      z.object({
        sectionId: z.string(),
        heading: z.string(),
        subheadings: z.array(z.string()).default([]),
        thesis: z.string().min(10),
        keyPointsToCover: z.array(z.string()).min(1),
      }),
    ),
    // ★ 2026-05-22 follow-up：生产方侧 clamp（非 reject）—— LLM 产出的每章字数夹到
    //   CHAPTER_WORDS_PER_CHAPTER_RANGE[400,12000]，下游 single-shot-writer 拿到的
    //   永远在界内（消费方无需严格 reject，避免 LLM 超限触发重试 churn）。
    targetWordsPerChapter: z.record(
      z.string(),
      z
        .number()
        .transform((v) =>
          Math.min(
            CHAPTER_WORDS_PER_CHAPTER_RANGE.max,
            Math.max(CHAPTER_WORDS_PER_CHAPTER_RANGE.min, Math.round(v)),
          ),
        ),
    ),
    factAllocation: z.record(z.string(), z.array(z.string())).default({}),
    figurePlan: z.record(z.string(), z.array(z.string())).default({}),
  })
  // ★ P1-NEW-D (round 2): sectionId 唯一性 + key 集合一致性早期信号；
  // 若 LLM 返回违规，agent 会进入 RUNNER_OUTPUT_SCHEMA_MISMATCH 触发自愈重试。
  .superRefine((data, ctx) => {
    const ids = data.chapterOutlines.map((c) => c.sectionId);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `chapterOutlines.sectionId 重复: ${dup}`,
        path: ["chapterOutlines"],
      });
    }
    const idSet = new Set(ids);
    for (const k of Object.keys(data.targetWordsPerChapter)) {
      if (!idSet.has(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `targetWordsPerChapter key "${k}" 未出现在 chapterOutlines.sectionId`,
          path: ["targetWordsPerChapter"],
        });
      }
    }
    for (const k of Object.keys(data.factAllocation)) {
      if (!idSet.has(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `factAllocation key "${k}" 未出现在 chapterOutlines.sectionId`,
          path: ["factAllocation"],
        });
      }
    }
  });

@DefineAgent({
  id: "playground.writer.outline-planner",
  version: "1.0.0",
  identity: {
    role: "outline-planner",
    description:
      "W1 outline planner — pre-allocate facts/figures to chapters before parallel writing",
  },
  loop: "reflexion",
  toolCategories: [],
  taskProfile: {
    creativity: "low",
    outputLength: "medium",
    reasoningDepth: "moderate",
  },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 8_000, maxIterations: 2, maxWallTimeMs: 60_000 },
})
export class MissionOutlinePlannerAgent extends AgentSpec<
  typeof Input,
  typeof Output
> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const target = resolveMissionTotalWords(input.depth, input.lengthProfile);
    // ★ P0-R4-5 (round 4): ChapterWriter budget.maxTokens=22000 + 中文 1:1 token，
    // 25K 字单章永远写不到 ≥85% 字数门槛 → epic 死循环。降到 12000 与 chapter-writer
    // schema 上限对齐；epic 200K → 17 章 × 12K 安全可达。
    // ★ 2026-05-22 单一源：单章硬上限 = CHAPTER_WORDS_PER_CHAPTER_RANGE.max（与输出
    //   clamp + chapter-writer schema 同源），不再写死 12000。
    const PER_CHAPTER_HARD_CAP = CHAPTER_WORDS_PER_CHAPTER_RANGE.max;
    const naivePerChapter = Math.round(target / input.plan.dimensions.length);
    const perChapter = Math.min(naivePerChapter, PER_CHAPTER_HARD_CAP);
    const requiresMoreChaptersForCap = naivePerChapter > PER_CHAPTER_HARD_CAP;
    return [
      `You are the W1 outline planner for a ${input.lengthProfile} (~${target} words) report on "${input.topic}".`,
      `Audience: ${input.audienceProfile}. Style: ${input.styleProfile}.`,
      input.language === "zh-CN" ? "用中文输出。" : "Respond in English.",
      ``,
      `## Your job (no LLM creative writing yet — only plan)`,
      ``,
      `For each plan.dimension, output a chapterOutline with:`,
      `- sectionId: dim.id`,
      `- heading: 章节标题（可比 dim.name 更生动具体）`,
      `- subheadings: 2-4 个 h3 子节标题（可空，short report 不必有）`,
      `- thesis: 一句话章节核心论点（≥10 chars）`,
      `- keyPointsToCover: 该章必须覆盖的 3-5 个要点（用于 ChapterWriter 检查覆盖度）`,
      ``,
      `## Allocations`,
      `- targetWordsPerChapter: 给每个 sectionId 分配字数（合计 ≈ ${target}，每章约 ${perChapter}，单章硬上限 ${PER_CHAPTER_HARD_CAP}）`,
      requiresMoreChaptersForCap
        ? `  ⚠️ 当前总字数 ${target} ÷ ${input.plan.dimensions.length} 维度 = ${naivePerChapter} 字/维度，超出单章 ${PER_CHAPTER_HARD_CAP} 字硬上限。`
        : "",
      requiresMoreChaptersForCap
        ? `  → 必须把超出的维度拆分成多个 sectionId（例如 "<dim.id>-part1" / "<dim.id>-part2"），让每个 sectionId 字数 ≤ ${PER_CHAPTER_HARD_CAP}。`
        : "",
      `- factAllocation: { sectionId: [factId, ...] } 把 factTable 中的事实显式分配到章节，`,
      `  避免后续章节抢/漏事实。每事实只能分给 1 章。`,
      `- figurePlan: { sectionId: [figureId, ...] } 仅 withFigures=true 时填，每章 1-3 张。${input.withFigures ? "" : "本次 withFigures=false，figurePlan 给 {} 空对象即可。"}`,
      ``,
      `## Output JSON shape`,
      `{`,
      `  "chapterOutlines": [{ "sectionId": "...", "heading": "...", "subheadings": [...], "thesis": "...", "keyPointsToCover": [...] }],`,
      `  "targetWordsPerChapter": { "<sectionId>": ${perChapter}, ... },`,
      `  "factAllocation": { "<sectionId>": ["fact-1", "fact-3"] },`,
      `  "figurePlan": { "<sectionId>": ["fig-id-1"] }`,
      `}`,
    ].join("\n");
  }
}

// ★ 2026-05-22 ③L/M：原 lengthTarget(按 lengthProfile 写死、无视 depth 的第二信源)
//   已删除。总字数统一走 resolveMissionTotalWords(depth, lengthProfile) 单一源。
