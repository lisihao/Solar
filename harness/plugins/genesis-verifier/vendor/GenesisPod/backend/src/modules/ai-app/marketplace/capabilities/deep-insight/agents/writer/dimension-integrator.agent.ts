/**
 * DimensionIntegratorAgent —— 整合多个章节为完整维度报告
 *
 * 接收所有 pass 的 chapter，按 outline 顺序拼接 +
 * 写一段维度级 abstract（200 字）+ 抽出 keyFindings (≤ 5 条)。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";

const Input = z.object({
  topic: z.string(),
  dimension: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  chapters: z.array(
    z.object({
      index: z.number().int(),
      heading: z.string(),
      body: z.string(),
      wordCount: z.number().int(),
    }),
  ),
  /** Researcher 阶段的 dimension summary（作为辅助参考） */
  dimensionSummary: z.string(),
});

const Output = z.object({
  dimension: z.string(),
  abstract: z.string(),
  keyFindings: z.array(z.string()).min(3).max(7),
  totalWordCount: z.number().int(),
  /** 完整 markdown 报告（含 chapter headings） */
  fullMarkdown: z.string(),
});

@DefineAgent({
  id: "playground.dimension-integrator",
  identity: {
    role: "integrator",
    description:
      "Integrate multiple chapters into a coherent dimension report + abstract + key findings",
  },
  // ★ 2026-05-01 真因修复 (mission da6e2af7 实证 5/8 dim 卡死):
  //   原 loop="reflexion" → verifier 阈值 60，对纯整合任务（章节已逐个 review 过）
  //   是冗余二次判分。prod 实测 verifier 给 53-58 分常态，使 5 个 dim integrator
  //   全部 degraded/failed 但 output 已"强制接受次优产物"。
  //   chapter quality 已由 chapter reviewer 担保（threshold 75/100），integrator
  //   只做"拼装 + 抽 abstract/keyFindings"，不需要再判 LLM 文学性分数。
  //   切 react loop → 直接 finalize 不再 reflexion，省 token 省时间。
  //   5-axis quality-judge 仍是 dim 唯一权威评分（整合后跑）。
  loop: "react",
  skills: ["dim-chapter-integration"],
  // ★ Round 3 真问题修复 (2026-04-29):
  //   原 outputLength="long" → 8000 maxTokens，远小于多章拼接后字数 (epic 一个 dim 可能 30K+)。
  //   配合 commit fd78b3480 (assembler 优先用 chapter 拼) 已治标，但 integrator 输出本身仍被截。
  //   切到 "extended" → 16000 maxTokens，让 integrator 真能产出完整的 dim fullMarkdown。
  taskProfile: { creativity: "low", outputLength: "extended" },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 22_000, maxIterations: 3 },
})
export class DimensionIntegratorAgent extends AgentSpec<
  typeof Input,
  typeof Output
> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    // ★ 2026-05-08 PR-3 (mission 843f6958 实证修): 给 LLM 看 chapter.body 而非
    //   仅 heading + 字数。原版只让 LLM 看 "## 1. xxx (5000字)" 列表，导致 abstract
    //   和 keyFindings 凭骨架编造（quality 63 分但说不出哪差）。fullMarkdown 字段
    //   实际不被使用（per-dim-pipeline.util.ts:1304 强制 stitch），但保留契约。
    //   body 摘要到前 600 字，避免 prompt 过长（上限 22K maxTokens）。
    const chapterList = input.chapters
      .map(
        (c) =>
          `### 章节 ${c.index}: ${c.heading} (${c.wordCount}字)\n\n${c.body.slice(0, 600)}${c.body.length > 600 ? "...[节选]" : ""}`,
      )
      .join("\n\n---\n\n");
    const totalWords = input.chapters.reduce((s, c) => s + c.wordCount, 0);
    return [
      `You integrate the chapters of dimension "${input.dimension}" into a coherent report.`,
      `Language: ${input.language}.`,
      ``,
      `## 章节内容节选（${input.chapters.length} 个，总字数 ${totalWords}）`,
      chapterList,
      ``,
      `## Dimension summary 参考`,
      input.dimensionSummary,
      ``,
      `## 任务（仅 abstract + keyFindings 为权威输出，fullMarkdown 字段保留契约）`,
      `1. abstract: 基于上方章节内容**综合提炼** 200 字维度级摘要（非简单复制单章）`,
      `2. keyFindings: 提炼 3-7 条**跨章节**关键结论（每条 1 句，可独立成立）`,
      `3. fullMarkdown: 按章节顺序占位拼接（实际渲染由 per-dim-pipeline 代码确定性拼接，此字段保留契约）`,
      ``,
      `## 输出 JSON shape (字段名必须完全匹配)`,
      `{`,
      `  "dimension": "${input.dimension}",`,
      `  "abstract": "<200 字综合摘要>",`,
      `  "keyFindings": ["<跨章节关键结论1>", "<跨章节关键结论2>", ...],`,
      `  "totalWordCount": ${totalWords},`,
      `  "fullMarkdown": "<占位即可，实际不被使用>"`,
      `}`,
    ].join("\n");
  }
}
