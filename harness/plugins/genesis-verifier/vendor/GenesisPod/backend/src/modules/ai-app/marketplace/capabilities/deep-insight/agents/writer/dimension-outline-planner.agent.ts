/**
 * DimensionOutlinePlannerAgent —— 维度规划为 N 个章节的 outline
 *
 * 接收 Researcher 收集的 sourceManifest（findings + summary）+ 维度名，
 * 产出 N 个章节标题 + 简短主旨 + 写作要点。
 * 每章后续会进入 ChapterWriter → ChapterReviewer 子循环。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import { CHAPTER_COUNT_RANGE } from "../../contract/chapter-count.contract";

const Input = z.object({
  topic: z.string(),
  dimension: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  /** Researcher 阶段的 dimension-level summary（高度概括的研究结论） */
  dimensionSummary: z.string(),
  /** Researcher 阶段产出的 findings（claim+evidence+source 三元组） */
  findings: z.array(
    z.object({
      claim: z.string(),
      evidence: z.string(),
      source: z.string(),
    }),
  ),
  /**
   * 期望章节数。范围是**不变量**，单一源自 CHAPTER_COUNT_RANGE（与管线 clamp 同源）。
   * min=1：稀缺证据维度合法只开 1 章（Evidence Contract）——绝不再写 min(3) 复界。
   */
  targetChapterCount: z
    .number()
    .int()
    .min(CHAPTER_COUNT_RANGE.min)
    .max(CHAPTER_COUNT_RANGE.max),
});

const Output = z.object({
  dimension: z.string(),
  chapters: z
    .array(
      z.object({
        index: z.number().int().min(1),
        heading: z.string(),
        thesis: z.string(),
        keyPoints: z.array(z.string()),
        /** 该章节将引用的 finding source 的下标（指向 input.findings） */
        sourceIndices: z.array(z.number().int().min(0)),
      }),
    )
    .min(1),
});

@DefineAgent({
  id: "playground.dimension-outline",
  identity: {
    role: "outline",
    description:
      "Plan N chapters for one dimension based on its source manifest",
  },
  loop: "reflexion",
  taskProfile: {
    creativity: "low",
    outputLength: "medium",
    taskKind: "summarize",
  },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 12_000, maxIterations: 4 },
})
export class DimensionOutlinePlannerAgent extends AgentSpec<
  typeof Input,
  typeof Output
> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const sourceList = input.findings
      .map(
        (f, i) =>
          `  [${i}] ${f.claim} — evidence: ${f.evidence.slice(0, 120)} | source: ${f.source}`,
      )
      .join("\n");
    return [
      `You are an outline planner for the dimension "${input.dimension}" of topic "${input.topic}".`,
      `Language: ${input.language}.`,
      ``,
      `## 任务`,
      `基于已收集的资料和 dimension summary，规划 ${input.targetChapterCount} 个章节，使整个维度报告:`,
      `- 结构清晰、章节互不重叠`,
      `- 每章 thesis 是一个可论证的具体观点（非泛泛标题）`,
      `- 每章 keyPoints 列出 2-4 个支撑要点`,
      `- 每章 sourceIndices 指向 findings 数组中将引用的下标`,
      ``,
      `## Dimension summary`,
      input.dimensionSummary,
      ``,
      `## Available findings (用于章节引用)`,
      sourceList,
      ``,
      `## 输出 JSON shape (字段名必须完全匹配)`,
      `{`,
      `  "dimension": "${input.dimension}",`,
      `  "chapters": [`,
      `    {`,
      `      "index": 1,`,
      `      "heading": "<章节标题，具体不空泛>",`,
      `      "thesis": "<1-2 句核心论点>",`,
      `      "keyPoints": ["<要点1>", "<要点2>", "<要点3>"],`,
      `      "sourceIndices": [0, 2, 5]`,
      `    }`,
      `    // 共 ${input.targetChapterCount} 个`,
      `  ]`,
      `}`,
    ].join("\n");
  }
}
