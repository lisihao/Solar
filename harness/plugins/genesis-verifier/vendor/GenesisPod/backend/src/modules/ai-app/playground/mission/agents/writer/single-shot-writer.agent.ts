/**
 * Writer Agent —— ReActLoop + outputSchema 自愈（schema 失败自动 retry）
 *
 * 把 Analyst 的 insights 写成结构化 ResearchReport。
 * outputSchema 强约束 markdown 章节结构。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import { ResearchReportSchema } from "../../../api/dto/run-mission.dto";
// ★ 2026-04-30 (PR-F): 注入 TI report-writing-standards.constants (EN 版)，与
//   topic-insights/prompts/dimension-research.prompt.ts 同源。
import {
  HEADING_HIERARCHY_EN,
  NARRATIVE_STRUCTURE_EN,
  PROFESSIONAL_TONE_EN,
  FORMATTING_LIMITS_EN,
  EXECUTIVE_SUMMARY_FORMAT_EN,
} from "@/modules/ai-harness/facade";

const Input = z.object({
  topic: z.string(),
  depth: z.enum(["quick", "standard", "deep"]).default("standard"),
  language: z.enum(["zh-CN", "en-US"]),
  insights: z.array(
    z.object({
      headline: z.string(),
      narrative: z.string(),
      supportingDimensions: z.array(z.string()),
      confidence: z.number(),
    }),
  ),
  themeSummary: z.string(),
  contradictions: z
    .array(
      z.object({
        claim: z.string(),
        conflictingSources: z.array(z.string()),
        resolution: z.string(),
      }),
    )
    .optional(),
  // ★ Raw findings (per-dim): 让 Writer 能直接引用具体的 claim + source URL，
  //   避免只能用 Analyst cherry-picked insights 而漏掉部分 findings 的 source。
  rawFindings: z
    .array(
      z.object({
        dimension: z.string(),
        claim: z.string(),
        evidence: z.string(),
        source: z.string(),
      }),
    )
    .default([]),
  // ★ P1-E (2026-04-29): S7 outline 真消费
  // 当 auditLayers ∈ {thorough, paranoid} 时 S7 已产出 mission-level chapter outline，
  // Writer 应该按 outline 的 sectionId/heading/thesis/keyPointsToCover/targetWordsPerChapter
  // 起草，而不是从零规划。这样 epic/mega 长文兑现率才会真正提升。
  outlinePlan: z
    .object({
      chapterOutlines: z.array(
        z.object({
          sectionId: z.string(),
          heading: z.string(),
          subheadings: z.array(z.string()).default([]),
          thesis: z.string(),
          keyPointsToCover: z.array(z.string()),
        }),
      ),
      targetWordsPerChapter: z.record(z.string(), z.number()).default({}),
      factAllocation: z.record(z.string(), z.array(z.string())).default({}),
    })
    .optional(),
});

const DEPTH_SECTION_PLAN: Record<
  "quick" | "standard" | "deep",
  { sectionCount: string; wordsPerSection: string; totalWords: string }
> = {
  quick: {
    sectionCount: "3-4",
    wordsPerSection: "250-400",
    totalWords: "1,000-1,600",
  },
  standard: {
    sectionCount: "4-6",
    wordsPerSection: "350-650",
    totalWords: "1,800-3,200",
  },
  deep: {
    sectionCount: "5-8",
    wordsPerSection: "500-900",
    totalWords: "3,000-5,500",
  },
};

@DefineAgent({
  id: "playground.writer",
  identity: {
    role: "writer",
    description: "Write final research report in structured Markdown",
  },
  loop: "reflexion",
  skills: [],
  taskProfile: { creativity: "medium", outputLength: "extended" },
  inputSchema: Input,
  outputSchema: ResearchReportSchema,
  // 长报告 + outputSchema retry，给足空间。budgetProfile 倍率会在上面再 scale
  budget: { maxTokens: 80_000, maxIterations: 8 },
})
export class SingleShotWriterAgent extends AgentSpec<
  typeof Input,
  typeof ResearchReportSchema
> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const plan = DEPTH_SECTION_PLAN[input.depth];
    const langGuide =
      input.language === "zh-CN"
        ? "用简体中文撰写。文字风格要专业、严谨、引述准确，不要使用「相信」「或许」等弱化措辞。"
        : "Write in formal English with precise terminology. Avoid hedging language ('perhaps', 'may'). Prefer evidence-backed prose.";

    // ★ P1-E (2026-04-29): 如果 S7 已产出 outline，构建逐章详细指导
    // outline 提供：sectionId/heading/thesis/keyPointsToCover/targetWords/factIds
    // Writer 必须严格按 outline 写而不是从零规划，提升 epic/mega 长文兑现率
    const outlineGuide = input.outlinePlan
      ? this.buildOutlineGuidance(input.outlinePlan)
      : null;

    return [
      `You are a senior research analyst at a top-tier consulting firm (think McKinsey / BCG / Stanford HAI).`,
      `Produce a publication-quality research report on "${input.topic}".`,
      ``,
      `## Output requirements`,
      outlineGuide
        ? `- ★ MUST follow the pre-planned chapter outline below — section count, headings, theses, key points, and word targets are all PRESCRIBED. Do not invent new chapters.`
        : `- Depth tier: ${input.depth} → ${plan.sectionCount} sections, ${plan.wordsPerSection} words per section, total ~${plan.totalWords} words`,
      `- ${langGuide}`,
      // ★ PR-F: TI EN report-writing-standards.constants 注入
      HEADING_HIERARCHY_EN,
      ``,
      NARRATIVE_STRUCTURE_EN,
      ``,
      PROFESSIONAL_TONE_EN,
      ``,
      FORMATTING_LIMITS_EN,
      ``,
      EXECUTIVE_SUMMARY_FORMAT_EN,
      ``,
      `- Each section: 2-4 evidence-backed paragraphs with concrete numbers, dates, named entities, mechanisms`,
      `- Inline citations referencing specific sources where claims are made`,
      `- ★ Each paragraph must carry an INDEPENDENT thesis claim — not a template phrase.`,
      `  Acceptable openers: a substantive judgment ("This means..." / "The core reason is..." /`,
      `  "Crucially..." / "More precisely..."). Avoid every chapter starting the same way.`,
      `- ❌ DO NOT use the same fixed opener (e.g. \`> **Key Finding**:\` blockquote) for every section`,
      `  — that creates formulaic, eight-legged-essay output. Vary the cadence per section.`,
      `- ❌ DO NOT use a fixed \`**Implications**:\` prefix for the closing of every section.`,
      `  Write a direct actionable takeaway sentence instead.`,
      `- Use markdown bold (**...**) for critical terms inline; lists only when enumeration adds clarity`,
      `- AVOID generic filler ("In conclusion", "It is important to note", "随着 X 的发展") — every sentence adds info`,
      ``,
      ...(outlineGuide ? [outlineGuide, ``] : []),
      `## Available materials`,
      `- Theme synthesis (from Analyst): ${input.themeSummary}`,
      `- ${input.insights.length} validated insights (each with confidence + supporting dimensions) — see user message`,
      input.contradictions && input.contradictions.length > 0
        ? `- ${input.contradictions.length} cross-source contradictions to acknowledge transparently`
        : `- No major source contradictions detected`,
      `- ${input.rawFindings?.length ?? 0} raw findings (claim + evidence + source URL per dimension) —`,
      `  use these to back specific claims with [N] citations to the source URL. Don't write a section`,
      `  with only generic prose; ground every paragraph in 1-2 specific findings if possible.`,
      ``,
      `## Report shape (return EXACTLY this JSON; field names must match)`,
      `{`,
      `  "title": "<<= 80 chars, specific not generic — name the angle>",`,
      `  "summary": "<3-5 sentence executive summary leading with the single most important finding>",`,
      `  "sections": [`,
      `    {`,
      `      "heading": "<descriptive heading, NOT 'Introduction' / 'Background' / 'Conclusion'>",`,
      `      "body": "<full markdown body following structure above>",`,
      `      "sources": ["<https://...>", ...]  // 1-5 valid http(s) URLs that back this section`,
      `    }`,
      `    // produce ${plan.sectionCount} sections`,
      `  ],`,
      `  "conclusion": "<actionable takeaways: 3-5 bullet points starting with action verbs>",`,
      `  "citations": ["<https://...>", ...]  // unique union of all section sources, deduplicated`,
      `}`,
      ``,
      `Field names exactly as shown. All URLs must start with http(s):// and be sourced from the insights — do not fabricate.`,
    ].join("\n");
  }

  /**
   * ★ P1-E (2026-04-29): 构建 outline 指导段落，让 Writer 按章节大纲严格写作。
   *
   * S7 MissionOutlinePlannerAgent 已产出 chapterOutlines + targetWordsPerChapter
   * + factAllocation。Writer 必须按 outline 的 sectionId/heading/thesis/keyPoints
   * 起草，而不是边写边规划。这样 epic/mega 长文兑现率才会真正提升。
   */
  private buildOutlineGuidance(
    outline: NonNullable<z.infer<typeof Input>["outlinePlan"]>,
  ): string {
    const lines: string[] = [
      `## ★ Pre-planned Chapter Outline (MUST FOLLOW)`,
      ``,
      `The Outline Planner has already structured this report into ${outline.chapterOutlines.length} chapters.`,
      `Write each chapter EXACTLY as prescribed — do not merge, split, or invent new chapters.`,
      ``,
    ];
    let totalTarget = 0;
    for (let i = 0; i < outline.chapterOutlines.length; i++) {
      const ch = outline.chapterOutlines[i];
      const target = outline.targetWordsPerChapter[ch.sectionId];
      if (typeof target === "number") totalTarget += target;
      const facts = outline.factAllocation[ch.sectionId] ?? [];
      lines.push(`### Chapter ${i + 1}: "${ch.heading}"`);
      lines.push(`- **sectionId**: \`${ch.sectionId}\``);
      lines.push(`- **Thesis**: ${ch.thesis}`);
      if (typeof target === "number") {
        lines.push(
          `- **Target word count**: ~${target} words (must hit ≥80% of this)`,
        );
      }
      if (ch.keyPointsToCover.length > 0) {
        lines.push(
          `- **Key points to cover** (use these as paragraph anchors):`,
        );
        for (const kp of ch.keyPointsToCover) {
          lines.push(`  · ${kp}`);
        }
      }
      if (ch.subheadings.length > 0) {
        lines.push(
          `- **Subheadings** (use as ### sub-sections within the body):`,
        );
        for (const sh of ch.subheadings) {
          lines.push(`  · ${sh}`);
        }
      }
      if (facts.length > 0) {
        lines.push(
          `- **Pre-allocated facts** (cite these by id; full text in factTable below): ${facts.join(", ")}`,
        );
      }
      lines.push(``);
    }
    if (totalTarget > 0) {
      lines.push(
        `**Total target word count for the report**: ~${totalTarget} words. Aim for the prescribed length per chapter.`,
      );
    }
    return lines.join("\n");
  }
}
