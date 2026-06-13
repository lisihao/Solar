/**
 * ConsistencyCheckerAgent (mission-pipeline 形态) —— 一致性检查 Agent
 *
 * B1 迁移：从 `agents/consistency-checker.agent.ts`（BaseAgent）迁到 AgentSpec + @DefineAgent。
 * 职责保留：角色 / 时间线 / 世界观 / 术语 / 剧情 五维一致性检查 + 新事实提取。
 *
 * 与旧 BaseAgent 的差异：
 * - 旧实现把 5 个维度拆成 5 次 LLM 调用 + 1 次语义校验 + 1 次事实提取（共 7 次），
 *   迁移后单 Agent 一次产出全部 issues + extractedFacts；SemanticConsistencyService /
 *   FactExtractorService 等领域 dep 由 s5 stage 注入并把补充信号喂进 input
 *   （设计文档 §1.2 s5 行）。
 * - 本文件导出 ConsistencyCheckTypeSchema / IssueSeveritySchema / ConsistencyIssueSchema
 *   及对应 type，供 editor agent 复用 import（设计文档 §2 迁移要点）。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import type { WritingContextPackage } from "../../interfaces/writing-context.interface";

// ==================== 共享 schema / type（供 editor 复用）====================

export const ConsistencyCheckTypeSchema = z.enum([
  "CHARACTER",
  "TIMELINE",
  "WORLD",
  "TERMINOLOGY",
  "PLOT",
]);
export type ConsistencyCheckType = z.infer<typeof ConsistencyCheckTypeSchema>;

export const IssueSeveritySchema = z.enum(["CRITICAL", "WARNING", "INFO"]);
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>;

export const ConsistencyIssueSchema = z.object({
  type: ConsistencyCheckTypeSchema,
  severity: IssueSeveritySchema,
  location: z.string(),
  description: z.string(),
  expected: z.string().optional(),
  found: z.string().optional(),
  suggestion: z.string().optional(),
  relatedEntities: z.array(z.string()).optional(),
});
export type ConsistencyIssue = z.infer<typeof ConsistencyIssueSchema>;

// ==================== Input / Output ====================

const Input = z.object({
  chapterId: z.string(),
  content: z.string().min(1),
  contextPackage: z.custom<WritingContextPackage>(),
  checkTypes: z.array(ConsistencyCheckTypeSchema).optional(),
  checkerInstanceId: z.number().optional(),
});

const Output = z.object({
  chapterId: z.string(),
  status: z.enum(["PASSED", "ISSUES_FOUND"]),
  issues: z.array(ConsistencyIssueSchema),
  summary: z.object({
    total: z.number(),
    byType: z.record(ConsistencyCheckTypeSchema, z.number()),
    bySeverity: z.record(IssueSeveritySchema, z.number()),
  }),
  suggestions: z.array(z.string()),
  extractedFacts: z
    .array(
      z.object({
        statement: z.string(),
        category: z.string(),
        relatedEntities: z.array(z.string()),
        importance: z.enum(["high", "medium", "low"]),
      }),
    )
    .optional(),
});

export type ConsistencyCheckerInput = z.infer<typeof Input>;
export type ConsistencyCheckerOutput = z.infer<typeof Output>;

@DefineAgent({
  id: "writing.consistency-checker",
  identity: {
    role: "consistency-checker",
    description: "一致性检查 Agent - 确保写作内容与 Story Bible 保持一致",
  },
  loop: "react",
  taskProfile: { creativity: "deterministic", outputLength: "medium" },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 4_000, maxIterations: 3, maxIterationsHardCap: 4 },
})
export class ConsistencyCheckerAgent extends AgentSpec<
  typeof Input,
  typeof Output
> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const bible = input.contextPackage.extensions.storyBible;
    const types =
      input.checkTypes && input.checkTypes.length > 0
        ? input.checkTypes
        : ["CHARACTER", "TIMELINE", "WORLD", "TERMINOLOGY", "PLOT"];

    const characterSettings = bible.characters
      .map(
        (c) =>
          `### ${c.name} (${c.role})\n` +
          `${c.aliases?.length ? `别名: ${c.aliases.join(", ")}\n` : ""}` +
          `外貌: ${JSON.stringify(c.appearance || {})}\n` +
          `性格: ${JSON.stringify(c.personality || {})}\n` +
          `能力: ${c.abilities?.join(", ") || "无特殊能力"}`,
      )
      .join("\n\n");

    const timeline = bible.timelineEvents
      .map((e) => `- ${e.storyTime}: ${e.eventName} - ${e.description}`)
      .join("\n");

    const worldRules = bible.worldSettings
      .filter((s) => s.rules && s.rules.length > 0)
      .map(
        (s) =>
          `### ${s.name} (${s.category})\n${s.rules!.map((r) => `- ${r}`).join("\n")}`,
      )
      .join("\n\n");

    const terminologies = bible.terminologies
      .map(
        (t) =>
          `- ${t.term}${t.variants?.length ? `（变体: ${t.variants.join(", ")}）` : ""}: ${t.definition}`,
      )
      .join("\n");

    const highFacts = (input.contextPackage.establishedFacts || [])
      .filter((f) => f.importance === "high")
      .map((f) => `- [${f.category}] ${f.statement}`)
      .join("\n");

    return [
      `你是专业的一致性检查专家，负责检查小说章节内容是否与 Story Bible 设定一致。`,
      ``,
      `## 本次需要检查的维度`,
      types.join(" / "),
      ``,
      `## 各维度检查要点`,
      `- CHARACTER：外貌（发色/眼色/特征）、性格表现、能力范围、说话方式、关系是否符合设定`,
      `- TIMELINE：事件顺序、时间跨度是否与已确立时间线一致；已死亡角色不得复活，状态需延续`,
      `- WORLD：是否违反世界观规则（地理、势力、规则体系）`,
      `- TERMINOLOGY：专有名词是否统一，是否混用变体而非标准术语`,
      `- PLOT：因果关系、角色动机、前后逻辑是否与已确立重要事实矛盾`,
      ``,
      `## 角色设定`,
      characterSettings || "（暂无）",
      ``,
      `## 时间线事件`,
      timeline || "（暂无）",
      ``,
      `## 世界观规则`,
      worldRules || "（暂无）",
      ``,
      `## 术语表`,
      terminologies || "（暂无）",
      ``,
      `## 已确立的重要事实`,
      highFacts || "（暂无）",
      ``,
      `## 输出要求`,
      `1. 将所有发现的问题填入 issues[]，每条含 type/severity/location/description，`,
      `   并尽量给出 expected（设定值）/ found（文中值）/ suggestion（修改建议）/ relatedEntities。`,
      `2. summary 按 type 与 severity 统计问题数量（total / byType / bySeverity）。`,
      `3. status：发现任何问题为 "ISSUES_FOUND"，否则 "PASSED"。`,
      `4. suggestions[] 汇总所有修改建议。`,
      `5. extractedFacts[]：提取本章确立的、会影响后续剧情的新事实`,
      `   （category: entity_state | sequence_point | decision | relationship；importance: high|medium|low）。`,
    ].join("\n");
  }
}
