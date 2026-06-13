/**
 * Chapter writer prompt builder.
 *
 * Extracted from writing-mission.service.ts L3579-3699 (`buildChapterWriterPrompt` method).
 * Pure function, no DI.
 */

export interface ChapterCharacter {
  name: string;
  role?: string;
  personality?: string[];
  appearance?: string;
  background?: string;
  motivation?: string;
  arc?: string;
  speechPattern?: string;
}

export interface ChapterInfo {
  title: string;
  plot: string;
  keyPoint: string;
}

export interface OutlineCore {
  summary: string;
  genre: string;
  theme: string;
}

export interface KeeperContext {
  relevantCharacters: string[];
  relevantLocations: string[];
  previousEvents: string[];
  warnings: string[];
  contextPrompt: string;
}

export interface ChapterWriterPromptParams {
  chapterNumber: number;
  /** Chinese ordinal name for the chapter number (e.g. "一", "二") */
  chapterNumberChinese: string;
  chapterInfo: ChapterInfo;
  outlineCore: OutlineCore;
  worldSettingsCharacters: ChapterCharacter[];
  previousSummary: string;
  userPrompt: string;
  keeperContext?: KeeperContext;
  stylePrompt: string;
  avoidancePrompt?: string;
  targetWordCount?: number;
}

export function buildChapterWriterPrompt(
  params: ChapterWriterPromptParams,
): string {
  const {
    chapterNumberChinese,
    chapterInfo,
    outlineCore,
    worldSettingsCharacters,
    previousSummary,
    userPrompt,
    keeperContext,
    stylePrompt,
    avoidancePrompt,
    targetWordCount,
  } = params;

  const characters = worldSettingsCharacters.slice(0, 5);

  // Generate detailed character info
  const characterInfo = characters
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

  // Generate character consistency constraints
  const characterConstraints =
    characters.length > 0
      ? `\n【角色一致性约束 - 必须严格遵守】
${characters
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

  const openingOrSummary = previousSummary
    ? `【前文摘要】\n${previousSummary}\n`
    : "【开篇说明】这是故事的开始，需要引人入胜，建立故事背景和主要人物。\n";

  const keeperContextSection = keeperContext?.contextPrompt
    ? `【守护者提醒】\n${keeperContext.contextPrompt}\n`
    : "";

  const keeperWarningsSection = keeperContext?.warnings?.length
    ? `\n⚠️ 注意事项：\n${keeperContext.warnings.map((w: string) => `- ${w}`).join("\n")}\n`
    : "";

  const avoidanceSection = avoidancePrompt
    ? `【表达约束 - 禁止使用以下表达】\n${avoidancePrompt}\n`
    : "";

  const wordTarget = targetWordCount ?? 2500;
  const wordSuggestionLow = targetWordCount
    ? Math.round(targetWordCount * 1.2)
    : 3000;
  const wordSuggestionHigh = targetWordCount
    ? Math.round(targetWordCount * 1.4)
    : 3500;

  return `【创作任务】第${chapterNumberChinese}章 ${chapterInfo.title}

【故事主题】${userPrompt}
【故事类型】${outlineCore.genre || "通用"}
【主题思想】${outlineCore.theme || "待定"}
${stylePrompt}
【本章情节要点】
${chapterInfo.plot}
${chapterInfo.keyPoint ? `关键转折：${chapterInfo.keyPoint}` : ""}

【主要角色】
${characterInfo || "待定"}
${characterConstraints}
${openingOrSummary}
${keeperContextSection}${keeperWarningsSection}
${avoidanceSection}
【创作要求 - 必须遵守】
1. ⚠️ 字数要求：本章必须达到 ${wordTarget} 字以上，建议 ${wordSuggestionLow}-${wordSuggestionHigh} 字
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

请直接输出章节内容，以"第${chapterNumberChinese}章 ${chapterInfo.title}"开头：`;
}
