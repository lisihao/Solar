/**
 * Writing Content Generator Service
 *
 * 负责内容生成相关功能：
 * - generateFullStory() - 完整故事生成
 * - generateContentDirectly() - 直接内容生成
 * - buildChapterWriterPrompt() - 构建章节写作提示词
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  generateStylePrompt,
  recommendStyleByGenre,
} from "../../constants/writing-style-presets";
import type { WritingMissionInput } from "./writing-mission.types";

/**
 * 最小 prompt 长度常量（与前端保持一致）
 */
const MIN_USER_PROMPT_LENGTH = 5;

@Injectable()
export class WritingContentGeneratorService {
  private readonly logger = new Logger(WritingContentGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * 数字转中文
   */
  numberToChinese(num: number): string {
    const chineseNums = [
      "零",
      "一",
      "二",
      "三",
      "四",
      "五",
      "六",
      "七",
      "八",
      "九",
      "十",
    ];
    if (num <= 10) return chineseNums[num];
    if (num < 20) return "十" + (num === 10 ? "" : chineseNums[num - 10]);
    if (num < 100) {
      const tens = Math.floor(num / 10);
      const ones = num % 10;
      return chineseNums[tens] + "十" + (ones === 0 ? "" : chineseNums[ones]);
    }
    return num.toString();
  }

  /**
   * 构建章节创作提示词
   */
  buildChapterWriterPrompt(
    chapterNumber: number,
    chapterInfo: { title: string; plot: string; keyPoint: string },
    outline: { core: { summary: string; genre: string; theme: string } },
    worldSettings: Record<string, unknown>,
    previousSummary: string,
    userPrompt: string,
    keeperContext?: {
      relevantCharacters: string[];
      relevantLocations: string[];
      previousEvents: string[];
      warnings: string[];
      contextPrompt: string;
    },
    styleId?: string,
    avoidancePrompt?: string,
    templateStylePrompt?: string, // 来自数据库模板的风格提示词（优先级高于 styleId）
    targetWordCount?: number, // 用户指定的目标字数
  ): string {
    const characters =
      (worldSettings.characters as Array<{
        name: string;
        role?: string;
        personality?: string[];
        appearance?: string;
        background?: string;
        motivation?: string;
        arc?: string;
        speechPattern?: string;
      }>) || [];

    // 生成详细的角色约束信息
    const characterInfo = characters
      .slice(0, 5)
      .map((c) => {
        const parts = [`**${c.name}**`];
        if (c.role)
          parts.push(
            `[${c.role === "protagonist" ? "主角" : c.role === "antagonist" ? "反派" : "配角"}]`,
          );
        if (c.personality?.length)
          parts.push(`性格：${c.personality.join("、")}`);
        if (c.motivation) parts.push(`动机：${c.motivation}`);
        if (c.speechPattern) parts.push(`说话风格：${c.speechPattern}`);
        return parts.join(" | ");
      })
      .join("\n");

    // 生成角色一致性约束
    const characterConstraints =
      characters.length > 0
        ? `\n【角色一致性约束 - 必须严格遵守】
${characters
  .slice(0, 5)
  .map((c) => {
    const constraints: string[] = [];
    if (c.personality?.length) {
      constraints.push(
        `- ${c.name} 必须表现出 ${c.personality.slice(0, 3).join("、")} 的性格特点`,
      );
    }
    if (c.role === "protagonist") {
      constraints.push(`- ${c.name} 作为主角，需要有成长和变化`);
    }
    if (c.motivation) {
      constraints.push(`- ${c.name} 的行动应符合其动机：${c.motivation}`);
    }
    return constraints.join("\n");
  })
  .filter(Boolean)
  .join("\n")}`
        : "";

    // 获取写作风格指南（优先使用模板风格，否则使用预设风格）
    let stylePrompt: string;
    if (templateStylePrompt) {
      // 使用数据库模板生成的风格提示词
      stylePrompt = templateStylePrompt;
    } else {
      // 根据故事类型获取预设风格
      const effectiveStyleId =
        styleId ||
        recommendStyleByGenre(outline.core.genre || "")[0] ||
        "modern_realistic";
      stylePrompt = generateStylePrompt(effectiveStyleId);
    }

    return `【创作任务】第${this.numberToChinese(chapterNumber)}章 ${chapterInfo.title}

【故事主题】${userPrompt}
【故事类型】${outline.core.genre || "通用"}
【主题思想】${outline.core.theme || "待定"}
${stylePrompt}
【本章情节要点】
${chapterInfo.plot}
${chapterInfo.keyPoint ? `关键转折：${chapterInfo.keyPoint}` : ""}

【主要角色】
${characterInfo || "待定"}
${characterConstraints}
${previousSummary ? `【前文摘要】\n${previousSummary}\n` : "【开篇说明】这是故事的开始，需要引人入胜，建立故事背景和主要人物。\n"}
${keeperContext?.contextPrompt ? `【守护者提醒】\n${keeperContext.contextPrompt}\n` : ""}${keeperContext?.warnings?.length ? `\n⚠️ 注意事项：\n${keeperContext.warnings.map((w: string) => `- ${w}`).join("\n")}\n` : ""}
${avoidancePrompt ? `【表达约束 - 禁止使用以下表达】\n${avoidancePrompt}\n` : ""}
【创作要求 - 必须遵守】
1. ⚠️ 字数要求：本章必须达到 ${targetWordCount ? targetWordCount : 2500} 字以上，建议 ${targetWordCount ? Math.round(targetWordCount * 1.2) : 3000}-${targetWordCount ? Math.round(targetWordCount * 1.4) : 3500} 字
2. 📖 语言质量：语言流畅自然，富有文学性，句式多样化
3. 💬 对话要求：人物对话生动，符合角色性格和身份，避免千人一面
4. 🎨 场景描写：细腻有画面感，运用多种感官描写（视觉、听觉、嗅觉等）
5. ⚡ 节奏把控：情节紧凑，避免冗余的心理描写和重复的场景
6. 🎭 叙事技巧：善用伏笔、悬念、反转等技巧增加可读性
7. 🔄 避免重复：不要与前文使用相同的开场方式、对话模式或场景设置
8. 🚫 表达多样性：严禁使用上述【表达约束】中列出的冷却期表达
9. ⛔ 【严禁总结式结尾】章节结尾必须是具体的情节/动作/对话，严禁出现以下模式：
   - 角色"暗下决心"、"心中坚定"、"默默立下目标"等内心独白总结
   - "她知道，前方的路..."、"无论如何..."、"她将不再退缩"等展望式收尾
   - "这只是开始"、"新的挑战才刚刚开始"等预告式结尾
   - 任何形式的本章内容回顾或主题升华
   章节应在情节高潮或自然转折处戛然而止，留有悬念

请直接输出章节内容，以"第${this.numberToChinese(chapterNumber)}章 ${chapterInfo.title}"开头：`;
  }

  /**
   * 直接调用 LLM 生成内容（绕过 MissionOrchestrator）
   *
   * 注意：此方法需要依赖主服务的 executeLeaderCommand 方法
   * 暂时保留为占位符，实际实现需要主服务注入
   */
  async generateContentDirectly(
    input: WritingMissionInput,
    modelId: string,
    missionId: string,
    executeLeaderCommand?: (
      input: WritingMissionInput,
      userPrompt: string,
      modelId: string,
      missionId: string,
    ) => Promise<string | null>,
  ): Promise<string | null> {
    try {
      // 构建系统提示词
      const systemPrompt = `你是一位专业的小说作家。你的任务是根据用户的要求创作高质量的故事内容。

写作要求：
- 语言流畅自然，富有文学性
- 人物形象鲜明，对话生动
- 情节紧凑，引人入胜
- 场景描写细腻，画面感强
- 符合故事类型的风格特点

输出格式：
- 直接输出故事内容，不要添加任何解释或元数据
- 每章约 3000-5000 字
- 使用中文写作`;

      // 构建用户提示词
      let userPrompt = input.userPrompt;
      if (input.targetWordCount) {
        userPrompt += `\n\n目标字数：约 ${input.targetWordCount} 字`;
      }
      if (input.additionalInstructions) {
        userPrompt += `\n\n额外要求：${input.additionalInstructions}`;
      }

      // 根据任务类型调整提示词
      if (input.missionType === "full_story") {
        userPrompt = `请创作一个完整的短篇故事：\n\n${userPrompt}\n\n要求：
1. 包含开头、发展、高潮、结局
2. 人物性格鲜明
3. 情节有起伏
4. 结尾有意义`;
      } else if (input.missionType === "outline") {
        userPrompt = `请为以下故事创作详细的大纲：\n\n${userPrompt}\n\n要求：
1. 列出主要章节
2. 每章简要描述主要情节
3. 标注关键转折点`;
      } else if (input.missionType === "edit" && executeLeaderCommand) {
        // @Leader 编辑调整：智能分析用户指令并执行相应操作
        const leaderResponse = await executeLeaderCommand(
          input,
          userPrompt,
          modelId,
          missionId,
        );

        // 检查是否需要委托给 full_story 任务
        if (leaderResponse?.startsWith("[DELEGATE_TO_FULL_STORY]")) {
          this.logger.log(
            `[${missionId}] Leader delegating to full_story task`,
          );
          return "[DELEGATE_FULL_STORY_INTERNAL]";
        }

        return leaderResponse;
      }

      this.logger.log(`Calling LLM (${modelId}) for mission ${missionId}`);

      // 调用 AiChatService
      const response = await this.chatFacade.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        model: modelId,
        taskProfile: {
          creativity: "high",
          outputLength: "long",
        },
      });

      if (response.content) {
        this.logger.log(
          `LLM response received: ${response.content.length} chars`,
        );
        return response.content;
      }

      this.logger.warn(`LLM returned empty content`);
      return null;
    } catch (error) {
      this.logger.error(`LLM call failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * 一键生成完整长篇小说
   *
   * 注意：此方法极其复杂，需要大量依赖主服务的方法
   * 建议保留在主服务中，或者将其拆分为更小的子方法
   *
   * 暂时保留为占位符
   */
  async generateFullStory(
    input: WritingMissionInput,
    _modelId: string,
    missionId: string,
  ): Promise<string | null> {
    // 从项目获取信息
    const project = await this.prisma.writingProject.findUnique({
      where: { id: input.projectId },
      select: { targetWords: true, description: true, name: true },
    });

    if (!project) {
      throw new NotFoundException(`Project ${input.projectId} not found`);
    }

    // ★★★ 关键日志：记录原始 userPrompt
    this.logger.log(
      `[${missionId}] generateFullStory - original userPrompt: "${input.userPrompt?.slice(0, 100) || "(empty)"}" (length: ${input.userPrompt?.length || 0})`,
    );

    // ★★★ 安全的 prompt 获取（使用局部变量，不修改原始参数）
    const effectiveUserPrompt =
      input.userPrompt?.trim() || project.description?.trim() || project.name;

    if (
      !effectiveUserPrompt ||
      effectiveUserPrompt.length < MIN_USER_PROMPT_LENGTH
    ) {
      const errorMsg = `Invalid user prompt: "${effectiveUserPrompt}" (length: ${effectiveUserPrompt?.length || 0}). Minimum required: ${MIN_USER_PROMPT_LENGTH} chars`;
      this.logger.error(`[${missionId}] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    if (effectiveUserPrompt !== input.userPrompt) {
      this.logger.log(
        `[${missionId}] Using fallback prompt: "${effectiveUserPrompt.slice(0, 100)}" (source: ${input.userPrompt ? "trimmed" : project.description ? "project.description" : "project.name"})`,
      );
    }

    // 此方法故意为空：generateFullStory 的完整实现保留在 WritingMissionService 中。
    // WritingContentGeneratorService.generateFullStory 目前未被任何调用方注入使用，
    // 如需调用请通过 WritingMissionService.generateFullStory（private 方法）完成。
    this.logger.warn(
      `[${missionId}] generateFullStory called on WritingContentGeneratorService — this method is not implemented here. Use WritingMissionService instead.`,
    );

    throw new Error(
      "generateFullStory is not implemented in WritingContentGeneratorService. The implementation lives in WritingMissionService.",
    );
  }
}
