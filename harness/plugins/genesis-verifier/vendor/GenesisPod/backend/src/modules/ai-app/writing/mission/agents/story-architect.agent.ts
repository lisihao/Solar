/**
 * StoryArchitectAgent (mission-pipeline 形态) —— 故事架构师
 *
 * B1 迁移：从 `agents/story-architect.agent.ts`（BaseAgent）迁到 AgentSpec + @DefineAgent。
 * 职责保留：整体规划 / 卷章分解 / 章节审核 / 一致性冲突解决。
 *
 * 与旧 BaseAgent 的差异：
 * - 不再注入 WritingQualityGateService —— 「审核前先跑质量门禁」的逻辑外移到 s3/s7 stage，
 *   把生成好的质量门禁文本作为 reviewData/payload 字段喂进来（设计文档 §2 迁移要点）。
 * - LLM 调用由 runner/invoker 接管，本类只负责 buildSystemPrompt + zod schema。
 * - zod schema 严格对齐旧 StoryArchitectInput / StoryArchitectOutput interface。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import type { WritingContextPackage } from "../../interfaces/writing-context.interface";

const Input = z.object({
  taskType: z.enum([
    "plan_story",
    "plan_volume",
    "decompose_chapters",
    "review_chapter",
    "resolve_conflict",
  ]),
  projectId: z.string(),
  contextPackage: z.custom<WritingContextPackage>(),
  payload: z.object({
    userRequirements: z.string().optional(),
    volumeInfo: z
      .object({
        volumeNumber: z.number(),
        synopsis: z.string().optional(),
        targetChapters: z.number().optional(),
      })
      .optional(),
    reviewData: z
      .object({
        chapterId: z.string(),
        content: z.string(),
        consistencyReport: z
          .object({
            issues: z.array(
              z.object({
                type: z.string(),
                description: z.string(),
                severity: z.string(),
              }),
            ),
          })
          .optional(),
      })
      .optional(),
    conflicts: z
      .array(
        z.object({
          type: z.string(),
          description: z.string(),
          options: z.array(z.string()),
        }),
      )
      .optional(),
  }),
});

const Output = z.object({
  taskType: z.string(),
  success: z.boolean(),
  result: z.object({
    storyOutline: z
      .object({
        premise: z.string(),
        theme: z.string(),
        structure: z.array(
          z.object({
            volumeNumber: z.number(),
            title: z.string(),
            synopsis: z.string(),
            keyEvents: z.array(z.string()),
          }),
        ),
      })
      .optional(),
    chapterBreakdown: z
      .array(
        z.object({
          chapterNumber: z.number(),
          title: z.string(),
          outline: z.string(),
          involvedCharacters: z.array(z.string()),
          keyEvents: z.array(z.string()),
          dependsOn: z.array(z.string()),
          canParallel: z.boolean(),
        }),
      )
      .optional(),
    reviewResult: z
      .object({
        approved: z.boolean(),
        feedback: z.string(),
        requiredChanges: z.array(z.string()).optional(),
        newEstablishedFacts: z
          .array(
            z.object({
              statement: z.string(),
              category: z.string(),
              relatedEntities: z.array(z.string()),
            }),
          )
          .optional(),
      })
      .optional(),
    conflictResolution: z
      .array(
        z.object({
          conflictId: z.string(),
          chosenOption: z.string(),
          reasoning: z.string(),
        }),
      )
      .optional(),
  }),
  nextSteps: z.array(z.string()).optional(),
});

export type StoryArchitectInput = z.infer<typeof Input>;
export type StoryArchitectOutput = z.infer<typeof Output>;

@DefineAgent({
  id: "writing.story-architect",
  identity: {
    role: "story-architect",
    description: "故事架构师 - 整体规划、卷章分解、章节审核、一致性冲突解决",
  },
  loop: "react",
  taskProfile: { creativity: "medium", outputLength: "extended" },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 16_000, maxIterations: 4, maxIterationsHardCap: 6 },
})
export class StoryArchitectAgent extends AgentSpec<
  typeof Input,
  typeof Output
> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const bible = input.contextPackage.extensions.storyBible;
    const characters = bible.characters
      .map((c) => `- ${c.name} (${c.role}): ${c.definition}`)
      .join("\n");

    const common = [
      `你是一位专业的故事架构师，负责整体规划和协调 AI 写作团队。`,
      ``,
      `## 核心职责`,
      `1. 项目规划：制定故事大纲、卷章结构、核心剧情线`,
      `2. 任务分配：将写作任务分解并分配给合适的角色`,
      `3. 质量把控：审核各角色产出，确保符合项目目标`,
      `4. 一致性监督：确保 Story Bible 被正确使用和更新`,
      ``,
      `## 工作原则`,
      `- 每个决策都要考虑对整体故事的影响`,
      `- 重大剧情变化必须更新 Story Bible`,
      `- 发现一致性问题时优先解决而非忽略`,
      `- 尽可能让章节可以并行写作以提高效率`,
      ``,
      `## 当前设定`,
      `- 前提：${bible.premise || "未设定"}`,
      `- 主题：${bible.theme || "未设定"}`,
      `- 基调：${bible.tone || "未设定"}`,
      `- 世界类型：${bible.worldType || "未设定"}`,
      ``,
      `## 主要角色`,
      characters || "（暂无）",
      ``,
    ];

    switch (input.taskType) {
      case "plan_story":
        return [
          ...common,
          `## 本次任务：规划故事整体结构`,
          input.payload.userRequirements
            ? `### 用户需求\n${input.payload.userRequirements}`
            : ``,
          `请规划故事的整体结构，包括核心前提、主题思想、卷章结构`,
          `（每卷的标题、概要、关键事件），输出到 result.storyOutline。`,
        ].join("\n");

      case "plan_volume":
        return [
          ...common,
          `## 本次任务：规划单卷章节`,
          `请为该卷的每个章节创建标题和大纲、标注涉及的主要角色和关键事件，`,
          `分析章节依赖关系并标注可并行写作的章节，输出到 result.chapterBreakdown。`,
          `**重要：如果故事已有明确结局标记（如「全书完」「大结局」「（完）」），不要继续规划新章节。**`,
        ].join("\n");

      case "decompose_chapters":
        return [
          ...common,
          `## 本次任务：分解章节依赖`,
          `## 依赖关系判断标准`,
          `- 如果章节 B 需要知道章节 A 中发生的事件结果，则 B 依赖 A`,
          `- 如果章节 B 的角色状态依赖于章节 A 的变化，则 B 依赖 A`,
          `- 如果两个章节发生在不同地点、涉及不同角色且时间上可以并行，则可以并行写作`,
          `请输出章节分解结果（含 dependsOn / canParallel）到 result.chapterBreakdown。`,
        ].join("\n");

      case "review_chapter":
        return [
          ...common,
          `## 本次任务：审核章节内容`,
          `## 审核维度`,
          `1. 角色一致性：外貌、性格、能力、说话方式是否与 Story Bible 一致`,
          `2. 时间线一致性：事件顺序、时间跨度是否合理`,
          `3. 世界观一致性：规则、地理、势力关系是否正确`,
          `4. 术语一致性：专有名词使用是否统一`,
          `5. 剧情逻辑：因果关系、动机是否合理`,
          ``,
          `## 审核原则`,
          `- CRITICAL 问题必须修改后才能通过；WARNING 问题建议修改`,
          `- 如果内容符合所有约束，应该批准通过`,
          `- 提取章节中确立的新事实（newEstablishedFacts），供后续章节一致性检查`,
          ``,
          `综合输入中的一致性检查报告与质量门禁结果（若提供），`,
          `输出审核结论到 result.reviewResult。`,
        ].join("\n");

      case "resolve_conflict":
        return [
          ...common,
          `## 本次任务：解决一致性冲突`,
          `## 解决原则`,
          `1. 优先保持与 Story Bible 的一致性`,
          `2. 优先保持与已确立事实的一致性`,
          `3. 选择对故事发展更有利的选项`,
          `4. 如果都可以，选择更简单的修改方案`,
          `请为每个冲突选择解决方案，输出到 result.conflictResolution。`,
        ].join("\n");
    }
  }
}
