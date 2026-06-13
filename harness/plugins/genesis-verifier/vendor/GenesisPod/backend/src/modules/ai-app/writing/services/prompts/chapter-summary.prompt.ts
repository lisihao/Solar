/**
 * Chapter summary prompt builder.
 *
 * Extracted from writing-mission.service.ts L3757-3772 (`generateChapterSummaryWithAI`).
 * Pure function, no DI.
 */

export interface ChapterSummaryPromptParams {
  content: string;
  chapterNumber: number;
  chapterTitle: string;
  /** Maximum characters to include from content (defaults to 6000) */
  contentLimit?: number;
}

export function buildChapterSummaryPrompt(
  params: ChapterSummaryPromptParams,
): string {
  const { content, chapterNumber, chapterTitle, contentLimit = 6000 } = params;

  const truncated = content.length > contentLimit ? "...(内容截断)" : "";

  return `请为以下章节内容生成一个结构化摘要，用于后续章节创作的上下文参考。

【章节】第${chapterNumber}章 ${chapterTitle}

【内容】
${content.slice(0, contentLimit)}${truncated}

【摘要要求】
请生成 400-600 字的摘要，包含：
1. **情节概要**：本章发生了什么（2-3 句话）
2. **关键事件**：重要转折点、冲突、决定
3. **角色状态**：主要角色的情绪、关系变化
4. **悬念/伏笔**：需要后续呼应的内容
5. **场景信息**：主要场景和时间

直接输出摘要内容，不要添加额外格式标记。`;
}
