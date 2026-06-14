/**
 * Outline planning prompt builder.
 *
 * Extracted from writing-mission.service.ts ~L1988-2051.
 * Pure function, no DI.
 */

export interface WorldSummary {
  core: { summary?: string; genre?: string; theme?: string; tone?: string };
  world?: Record<string, unknown>;
  characters?: Array<{
    name: unknown;
    role: unknown;
    motivation: unknown;
  }>;
}

export interface OutlinePlanningPromptParams {
  effectiveUserPrompt: string;
  worldSummary: WorldSummary;
  targetWordCount: number;
  totalVolumes: number;
  totalChapters: number;
  chaptersPerVolume: number;
  /** Converts a number to Chinese ordinal text (e.g. 1 → "一") */
  numberToChinese: (n: number) => string;
}

export function buildOutlinePlanningPrompt(
  params: OutlinePlanningPromptParams,
): string {
  const {
    effectiveUserPrompt,
    worldSummary,
    targetWordCount,
    totalVolumes,
    totalChapters,
    chaptersPerVolume,
    numberToChinese,
  } = params;

  const volumeStructure = Array.from(
    { length: totalVolumes },
    (_, i) => `
### 第${numberToChinese(i + 1)}卷
- 卷名：
- 核心冲突：
- 主要情节：
- 情感走向：`,
  ).join("\n");

  return `作为故事架构师，请基于以下【已建立的世界观】规划详细的章节结构。

【重要】你的章节规划必须严格遵守世界观设定，不能违反已建立的规则！

【故事创意】
${effectiveUserPrompt}

【已建立的世界观（摘要）】
${JSON.stringify(worldSummary, null, 2)}

【规模要求】
- 总字数：约 ${targetWordCount.toLocaleString()} 字
- 分卷数：${totalVolumes} 卷
- 每卷章节数：约 ${chaptersPerVolume} 章
- 总章节数：${totalChapters} 章

【节奏与质量要求 - 极其重要】
1. ⚡ 快速进入核心冲突：第1-3章必须建立核心矛盾，不要过度铺垫
2. 🎭 场景多样性：连续2章不能在同一场景发生相同类型事件
3. 📈 节奏起伏：每5章左右需要有一个小高潮，每卷末尾需要有大高潮
4. 🔄 避免重复：不同章节的情节类型要多样化（对话、行动、冲突、发现、转折等）
5. 👥 角色轮换：避免连续多章只有相同角色组合出场

【请输出以下内容】

## 零、书名
请根据故事主题和世界观创作一个精炼、有吸引力的书名（2-8个字），如：《琅琊榜》《甄嬛传》《庆余年》《三体》

## 一、卷结构
${volumeStructure}

## 二、章节大纲
请为全部 ${totalChapters} 章列出以下内容（必须符合世界观设定）：
- 章节标题：必须是有意义的标题（如"暗流涌动"、"命运交汇"），不是"第X章"这样的序号
- 主要情节：50字内概括本章核心剧情
- 关键转折：本章的关键情节点
- 涉及角色：本章出场的主要角色（必须是世界观中已定义的角色）
- 场景类型：本章主要场景（如：宫殿、街市、战场、密室等）

【重要 - 必须遵守】
1. 必须输出完整的 ${totalChapters} 个章节，一个都不能少！
2. 每个章节的 title 字段必须是具体的章节名（不含"第X章"前缀），不能为空！
3. 情节发展必须符合世界观中的规则设定
4. 角色行为必须符合其性格和动机设定
5. 章节数量不足将被拒绝，请确保输出完整的 ${totalChapters} 章
6. 连续章节不能使用相同场景发生相似事件（如连续两章都是"被召见"）

输出格式：JSON
{
  "bookTitle": "书名（2-8字，不含书名号）",
  "volumes": [{ "title": "卷名（如：风云际会）", "conflict": "核心冲突", "plot": "主要情节", "emotion": "情感走向" }],
  "chapters": [
    { "volumeIndex": 0, "title": "暗流涌动", "plot": "主角初入江湖，遭遇神秘势力", "keyPoint": "发现隐藏身世", "characters": ["主角名", "配角名"], "sceneType": "江湖客栈" },
    { "volumeIndex": 0, "title": "命运交汇", "plot": "与未来盟友相遇", "keyPoint": "获得关键线索", "characters": ["主角名", "新角色"], "sceneType": "山间小路" }
  ]
}`;
}
