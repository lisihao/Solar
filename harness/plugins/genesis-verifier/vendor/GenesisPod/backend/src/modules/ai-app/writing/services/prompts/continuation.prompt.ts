/**
 * Continuation writing prompt builders.
 *
 * Extracted from writing-mission.service.ts L6864-6879 (continuation chapter prompt)
 * and L4420-4455 (simple content / missionType prompts).
 * Pure functions, no DI.
 */

// ── Continuation chapter ─────────────────────────────────────────────────────

export interface ContinuationPromptParams {
  chapterNumber: number;
  /** Chinese ordinal name for the chapter number (e.g. "一", "二") */
  chapterNumberChinese: string;
  chapterTitle: string;
  storyBackground: string;
  worldSettings?: Record<string, unknown> | null;
  previousSummary?: string;
}

export function buildContinuationPrompt(
  params: ContinuationPromptParams,
): string {
  const {
    chapterNumber,
    chapterNumberChinese,
    chapterTitle,
    storyBackground,
    worldSettings,
    previousSummary,
  } = params;

  const worldSection = worldSettings
    ? `【世界观设定】\n${JSON.stringify(worldSettings, null, 2)}\n`
    : "";

  const summarySection = previousSummary
    ? `【前文摘要】\n${previousSummary}\n`
    : "【开篇提示】\n这是故事的一个新章节。";

  return `你正在继续创作一部小说，请创作第${chapterNumber}章「${chapterTitle}」。

【故事背景】
${storyBackground}

${worldSection}
${summarySection}

【创作要求】
1. 字数约 3000 字
2. 语言流畅，富有文学性
3. 情节连贯，承接前文
4. 角色性格一致

请直接输出章节内容，以"第${chapterNumberChinese}章 ${chapterTitle}"开头。`;
}

// ── Simple content (full_story / outline mission types) ──────────────────────

export interface SimpleContentSystemPromptParams {
  targetWordCount?: number;
}

export function buildSimpleContentSystemPrompt(
  params: SimpleContentSystemPromptParams = {},
): string {
  const { targetWordCount } = params;

  const wordCountLine = targetWordCount
    ? `- 每章约 ${targetWordCount} 字`
    : "- 每章约 3000-5000 字";

  return `你是一位专业的小说作家。你的任务是根据用户的要求创作高质量的故事内容。

写作要求：
- 语言流畅自然，富有文学性
- 人物形象鲜明，对话生动
- 情节紧凑，引人入胜
- 场景描写细腻，画面感强
- 符合故事类型的风格特点

输出格式：
- 直接输出故事内容，不要添加任何解释或元数据
${wordCountLine}
- 使用中文写作`;
}

export function buildFullStoryUserPrompt(basePrompt: string): string {
  return `请创作一个完整的短篇故事：\n\n${basePrompt}\n\n要求：
1. 包含开头、发展、高潮、结局
2. 人物性格鲜明
3. 情节有起伏
4. 结尾有意义`;
}

export function buildOutlineUserPrompt(basePrompt: string): string {
  return `请为以下故事创作详细的大纲：\n\n${basePrompt}\n\n要求：
1. 列出主要章节
2. 每章简要描述主要情节
3. 标注关键转折点`;
}
