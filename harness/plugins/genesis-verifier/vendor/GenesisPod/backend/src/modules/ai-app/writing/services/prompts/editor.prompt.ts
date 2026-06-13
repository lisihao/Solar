/**
 * Editor / polish prompt builders.
 *
 * Extracted from writing-mission.service.ts L2858-2867 (edit polish prompt)
 * and L2938-2958 (opening rewrite prompt).
 * Pure functions, no DI.
 */

// ── Periodic polish ──────────────────────────────────────────────────────────

export interface EditorPromptParams {
  chapterContent: string;
}

export function buildEditorPrompt(params: EditorPromptParams): string {
  const { chapterContent } = params;

  return `作为编辑，请润色以下章节内容，改进文字表达：

${chapterContent}

要求：
1. 保持原意不变
2. 改进语句流畅度
3. 增强画面感
4. 润色对话
5. 输出完整润色后的内容`;
}

// ── Opening rewrite ──────────────────────────────────────────────────────────

export interface OpeningRewritePromptParams {
  opening: string;
  issueList: string[];
  firstChapterGuidance: string;
}

export function buildOpeningRewritePrompt(
  params: OpeningRewritePromptParams,
): string {
  const { opening, issueList, firstChapterGuidance } = params;

  return `请重写以下第一章的开篇部分（前3-5段），使其具有更强的吸引力。

【当前开篇】
${opening}

【问题诊断】
${issueList.map((i) => `- ${i}`).join("\n")}

【强化要求】
${firstChapterGuidance}

【示例开篇】
- "斗之力，三段！" —— 冲突对话，直接揭示困境
- 那种冷，不是空调房里的凉意，而是一种湿冷，像无数条冰冷的小蛇顺着骨缝往里钻 —— 感官沉浸
- 他睁开眼，看到的是一把架在脖子上的刀 —— 极端困境

【输出要求】
1. 只输出重写后的开篇（前3-5段），不要输出完整章节
2. 第一句必须有钩子：冲突对话、危机情境、或强烈感官体验
3. 不要以世界观介绍或环境描写开头
4. 让读者立刻关心主角的处境`;
}

// ── Chapter modification ─────────────────────────────────────────────────────

export interface ChapterModifyPromptParams {
  chapterNumber: number;
  chapterTitle: string;
  chapterOutline?: string;
  chapterContent?: string;
  instruction: string;
}

export function buildChapterModifyPrompt(
  params: ChapterModifyPromptParams,
): string {
  const {
    chapterNumber,
    chapterTitle,
    chapterOutline,
    chapterContent,
    instruction,
  } = params;

  return `请根据以下指令修改章节内容：

## 当前章节
**标题**：第${chapterNumber}章 ${chapterTitle}
**大纲**：${chapterOutline || "无"}

**原内容**：
${chapterContent || "（空）"}

## 修改指令
${instruction}

## 要求
1. 保持故事连贯性
2. 保留原有的精彩部分
3. 按照指令进行针对性修改
4. 输出完整的修改后内容

请输出修改后的完整章节内容：`;
}
