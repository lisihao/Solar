/**
 * EditorAgent (mission-pipeline 形态) —— 编辑 Agent
 *
 * B1 迁移：从 `agents/editor.agent.ts`（BaseAgent + QualityGate/ChapterQualityEvaluator 注入）
 * 迁到 AgentSpec + @DefineAgent。
 * 职责保留：fix_issues / polish / unify_style / final_review 四操作。
 *
 * 与旧 BaseAgent 的差异：
 * - 不再注入 WritingQualityGateService / ChapterQualityEvaluatorService —— final_review 里
 *   「先跑质量门禁/快速评估再让 LLM 修正」的逻辑外移到 s6/s7 stage，stage 把评估出的
 *   问题列表作为 params（issues / leaderFeedback）喂进来（设计文档 §2 迁移要点）。
 * - 复用 consistency-checker.agent.ts 导出的 ConsistencyIssueSchema / ConsistencyIssue。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import type { WritingContextPackage } from "../../interfaces/writing-context.interface";
import {
  ConsistencyIssueSchema,
  type ConsistencyIssue,
} from "./consistency-checker.agent";

const Input = z.object({
  operation: z.enum(["fix_issues", "polish", "unify_style", "final_review"]),
  chapterId: z.string(),
  content: z.string().min(1),
  contextPackage: z.custom<WritingContextPackage>(),
  params: z.object({
    issues: z.array(ConsistencyIssueSchema).optional(),
    leaderFeedback: z.string().optional(),
    targetStyle: z
      .object({
        tone: z.string().optional(),
        vocabulary: z.string().optional(),
        sentenceLength: z.string().optional(),
      })
      .optional(),
    polishLevel: z.enum(["light", "moderate", "heavy"]).optional(),
  }),
});

const Output = z.object({
  chapterId: z.string(),
  operation: z.string(),
  success: z.boolean(),
  revisedContent: z.string().min(1),
  changes: z.array(
    z.object({
      type: z.string(),
      description: z.string(),
      before: z.string().optional(),
      after: z.string().optional(),
    }),
  ),
  stats: z.object({
    totalChanges: z.number(),
    fixedIssues: z.number(),
    wordCountBefore: z.number(),
    wordCountAfter: z.number(),
  }),
  notes: z.array(z.string()).optional(),
});

export type EditorInput = z.infer<typeof Input>;
export type EditorOutput = z.infer<typeof Output>;

// re-export 供 s6 stage / 其它消费方就近 import（避免穿透 consistency-checker 文件）
export type { ConsistencyIssue };

@DefineAgent({
  id: "writing.editor",
  identity: {
    role: "editor",
    description: "编辑 Agent - 修复问题、润色文字、统一风格、最终审核",
  },
  loop: "react",
  taskProfile: { creativity: "medium", outputLength: "long" },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 16_000, maxIterations: 4, maxIterationsHardCap: 6 },
})
export class EditorAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const bible = input.contextPackage.extensions.storyBible;

    const common = [
      `你是专业的文字编辑，负责修订和润色小说章节内容。`,
      ``,
      `## Story Bible 设定摘要`,
      `- 主要角色: ${bible.characters.map((c) => c.name).join(", ") || "（暂无）"}`,
      `- 世界类型: ${bible.worldType || "未指定"}`,
      `- 写作风格: ${JSON.stringify(bible.writingStyle || {})}`,
      ``,
      `## 硬性约束`,
      input.contextPackage.hardConstraints
        .map((c) => `- [${c.severity}] ${c.rule}`)
        .join("\n") || "（暂无）",
      ``,
      `## 输出要求`,
      `- 将修订后的完整章节正文写入 revisedContent；保持故事情节、角色性格、叙事视角不变`,
      `- changes[] 记录每处修改（type/description，必要时 before/after）`,
      `- stats 填 totalChanges / fixedIssues / wordCountBefore / wordCountAfter（中英文混合字数）`,
      ``,
    ];

    switch (input.operation) {
      case "fix_issues": {
        const issues = (input.params.issues || [])
          .slice()
          .sort((a, b) => severityRank(a) - severityRank(b));
        const issueText = issues
          .map(
            (it, i) =>
              `### 问题 ${i + 1} [${it.severity}]\n` +
              `- 类型: ${it.type}\n- 位置: ${it.location}\n- 描述: ${it.description}\n` +
              `- 期望: ${it.expected || "无"}\n- 实际: ${it.found || "无"}\n- 建议: ${it.suggestion || "无"}`,
          )
          .join("\n\n");
        return [
          ...common,
          `## 本次操作：修复一致性问题`,
          `## 修复原则`,
          `1. 优先解决 CRITICAL 问题`,
          `2. 修改时保持作者原意，重大改动需要自然过渡`,
          `3. 保持章节间的连贯性`,
          ``,
          `## 需要修复的问题（按优先级排序）`,
          issueText || "（无显式问题，按硬性约束做一致性复核即可）",
          input.params.leaderFeedback
            ? `\n## Leader 反馈\n${input.params.leaderFeedback}`
            : ``,
        ].join("\n");
      }

      case "polish": {
        const level = input.params.polishLevel || "moderate";
        const levelGuide =
          level === "light"
            ? "只修正明显的语法错误和错别字，保持原文风格不变"
            : level === "heavy"
              ? "全面优化文字质量，增强描写和对话，提升文学性"
              : "修正语法错误和错别字，优化不通顺的句子，适当增强描写";
        return [
          ...common,
          `## 本次操作：润色文字（级别：${level}）`,
          `- ${levelGuide}`,
          `## 润色原则`,
          `- 保持故事情节、角色性格、叙事视角不变，不改变关键情节和对话内容`,
        ].join("\n");
      }

      case "unify_style": {
        const target = input.params.targetStyle;
        const style = bible.writingStyle;
        const tone = target?.tone || "自然流畅";
        const vocabulary =
          target?.vocabulary || style?.vocabulary || "intermediate";
        const sentenceLength =
          target?.sentenceLength || style?.sentenceLength || "medium";
        return [
          ...common,
          `## 本次操作：统一写作风格`,
          `## 目标风格`,
          `- 基调: ${tone}`,
          `- 词汇水平: ${vocabulary}`,
          `- 句子长度: ${sentenceLength}`,
          `## 统一原则`,
          `- 保持情节内容不变，仅调整语言风格使全篇一致`,
        ].join("\n");
      }

      case "final_review":
        return [
          ...common,
          `## 本次操作：最终审核`,
          `## 检查清单`,
          `1. 语法和错别字  2. 标点符号  3. 段落分割  4. 对话格式  5. 叙事流畅性`,
          `6. 结尾质量（禁止总结式 / 预告式结尾，结尾应落在具体场景/动作/对话）`,
          ``,
          input.params.issues && input.params.issues.length > 0
            ? `## 质量评估发现的问题（来自上游 stage）\n` +
              input.params.issues
                .map((it) => `- [${it.severity}] ${it.type}: ${it.description}`)
                .join("\n")
            : `## 质量评估\n无明显问题，按检查清单做终审微调即可。`,
          ``,
          `若发现问题直接修正并输出完整内容；无问题则原样输出。`,
        ].join("\n");
    }
  }
}

function severityRank(issue: ConsistencyIssue): number {
  const order: Record<ConsistencyIssue["severity"], number> = {
    CRITICAL: 0,
    WARNING: 1,
    INFO: 2,
  };
  return order[issue.severity];
}
