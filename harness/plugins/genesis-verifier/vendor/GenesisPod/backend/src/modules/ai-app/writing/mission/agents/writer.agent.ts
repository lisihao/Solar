/**
 * WriterAgent (mission-pipeline 形态) —— 写作 Agent
 *
 * B1 迁移：从 `agents/writer.agent.ts`（BaseAgent + 11 个 quality service 注入）
 * 迁到 AgentSpec + @DefineAgent。
 *
 * ★ 关键迁移决策（设计文档 §2 迁移要点 + §4.7）：
 * - 旧 WriterAgent 在 buildQualityConstraints() 里串了 **12 类质量约束**
 *   （叙事工艺 / 表达冷却 / 角色人格 / 历史知识 / 专业声音 / 五感沉浸 / 开篇钩子 /
 *   伏笔 / 节奏 / 时间线 / 对话约束 / 角色行为一致性），全部依赖注入的 quality service。
 * - 这些约束的生成逻辑**不再属于 Agent**——它们由 s4 stage 调对应领域 dep 生成约束文本，
 *   作为 input 字段（chapterContext / 约束文本）喂进来。本 Agent 只保留**通用写作指令**。
 * - 「字数不足续写 ≤2 次」「叙事工艺重写」也留在 s4 stage（依赖 narrativeCraft 校验），不在本 Agent。
 *
 * TODO(s4): 12 类质量约束由 s4-chapter-fanout stage 注入。stage 调
 *   narrativeCraft / expressionMemory / characterPersonality / historicalKnowledge /
 *   professionalVoice / sensoryImmersion / openingHook / foreshadowing / pacingControl /
 *   dialogueConstraints / characterConsistency 生成约束文本后，拼到喂给 writer 的上下文中。
 *   逐条清单见旧 writer.agent.ts buildQualityConstraints() L457-740（§4.7 防漏迁 checklist）。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import type {
  WritingContextPackage,
  ChapterWritingContext,
} from "../../interfaces/writing-context.interface";

const Input = z.object({
  chapterId: z.string(),
  contextPackage: z.custom<WritingContextPackage>(),
  chapterContext: z.custom<ChapterWritingContext>(),
  writerInstanceId: z.number().optional(),
});

const Output = z.object({
  chapterId: z.string(),
  content: z.string().min(1),
  wordCount: z.number(),
  metadata: z.object({
    involvedCharacters: z.array(z.string()),
    locations: z.array(z.string()),
    storyTime: z.string().optional(),
    settingUpdates: z
      .array(
        z.object({
          type: z.enum(["character_state", "new_term", "timeline_event"]),
          data: z.record(z.string(), z.unknown()),
        }),
      )
      .optional(),
  }),
  checkpoints: z.array(
    z.object({
      type: z.string(),
      description: z.string(),
      location: z.string(),
    }),
  ),
});

export type WriterInput = z.infer<typeof Input>;
export type WriterOutput = z.infer<typeof Output>;

@DefineAgent({
  id: "writing.writer",
  identity: {
    role: "writer",
    description: "专业写作 Agent - 基于大纲和 Story Bible 完成章节创作",
  },
  loop: "react",
  taskProfile: { creativity: "high", outputLength: "long" },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 16_000, maxIterations: 4, maxIterationsHardCap: 6 },
})
export class WriterAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const bible = input.contextPackage.extensions.storyBible;
    const style = bible.writingStyle;
    const { chapter, writingInstructions } = input.chapterContext;
    const targetWordCount = writingInstructions?.targetWordCount || 3000;
    const minWordCount = Math.floor(targetWordCount * 0.9);

    // 通用写作指令（不内联 12 类质量约束 —— 那是 s4 stage 注入的活，见文件头 TODO）。
    return [
      `你是一位专业的创意写作 Agent，负责执行具体的章节写作任务。`,
      ``,
      `## 核心职责`,
      `1. 章节写作：基于大纲和设定完成章节创作`,
      `2. 风格一致：保持与项目整体风格一致`,
      `3. 设定遵循：严格遵循 Story Bible 中的设定`,
      `4. 多样性：避免重复使用相同的表达和情节模式`,
      ``,
      `## 创作原则（正向引导）`,
      `- 具象化：用具体细节代替抽象描述，让读者「看到」而非「被告知」`,
      `- 动作化：用动作展现情绪，而非直接陈述内心`,
      `- 感官化：调动五感（视觉/听觉/嗅觉/触觉/味觉）创造沉浸体验`,
      `- 对话即性格：每个人物有独特的用词、句式、语气`,
      `- 场景即情绪：环境描写服务于情绪基调`,
      ``,
      `## 写作风格`,
      `- 视角：${style?.pov || "第三人称限定"}`,
      `- 时态：${style?.tense || "过去时"}`,
      `- 词汇水平：${style?.vocabulary || "intermediate"}`,
      `- 对话风格：${style?.dialogueStyle || "自然流畅"}`,
      `- 描写风格：${style?.descriptionStyle || "细腻生动"}`,
      ``,
      `## 硬性约束（必须遵守）`,
      input.contextPackage.hardConstraints
        .map((c) => `- [${c.severity}] ${c.rule}`)
        .join("\n") || "（暂无）",
      ``,
      `## 输出格式要求（严格执行）`,
      `- 禁止在正文开头添加章节标题（如「第X章 XXX」「## 第X章」）或 Markdown 标题标记`,
      `- 直接从第一段正文开始，以场景或动作切入`,
      `- 保持叙事流畅、情节连贯`,
      ``,
      `## 本章任务`,
      `### 第${chapter.chapterNumber}章：${chapter.title}`,
      `### 章节大纲`,
      chapter.outline || "无具体大纲，请根据上下文自由发挥",
      ``,
      `### 字数要求（必须严格遵守）`,
      `- 目标字数：${targetWordCount}字（允许范围：${minWordCount}-${targetWordCount + 500}字）`,
      `- 字数不足将被退回重写；情节不够时请丰富细节描写、对话、心理活动、环境氛围`,
      ``,
      `请将正文写入 content，并填好 wordCount（中英文混合字数）、metadata（涉及角色/地点/故事内时间/设定更新）、`,
      `checkpoints（需要一致性检查的点）。`,
    ].join("\n");
  }
}
