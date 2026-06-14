/**
 * World building system prompt builder.
 *
 * Extracted from writing-mission.service.ts L1522-1571.
 * Pure function, no DI.
 */

export interface WorldBuildingPromptParams {
  /** Story creativity section (may include historical knowledge enhancement) */
  storyCreativitySection: string;
  targetWordCount: number;
  totalVolumes: number;
  totalChapters: number;
}

export function buildWorldBuildingPrompt(
  params: WorldBuildingPromptParams,
): string {
  const {
    storyCreativitySection,
    targetWordCount,
    totalVolumes,
    totalChapters,
  } = params;

  return `作为设定守护者，请根据以下故事创意独立建立完整的世界观设定。

【重要】世界观是故事的"游戏规则"，后续的章节大纲和内容创作都必须遵守这些规则。

${storyCreativitySection}

【规模信息】
- 目标字数：约 ${targetWordCount.toLocaleString()} 字
- 预计分卷：${totalVolumes} 卷
- 预计章节：${totalChapters} 章

请建立以下设定（JSON 格式）：
{
  "core": {
    "summary": "一句话概括故事核心",
    "genre": "故事类型（如：架空历史/玄幻/都市/科幻）",
    "theme": "主题思想（故事要传达的核心理念）",
    "tone": "基调风格（如：轻松幽默/严肃深沉/热血励志）"
  },
  "world": {
    "type": "世界类型",
    "era": "时代背景（具体到朝代/年代/时期）",
    "geography": "地理环境（主要场景和地点）",
    "society": "社会结构（阶层、制度、文化特点）",
    "rules": ["世界规则1（如：魔法/科技/政治规则）", "规则2", "规则3"]
  },
  "characters": [
    {
      "name": "角色名（含字号等）",
      "role": "protagonist/antagonist/supporting",
      "appearance": "外貌描述",
      "personality": ["性格特点1", "性格特点2"],
      "background": "背景故事",
      "motivation": "行动动机",
      "arc": "角色发展弧（从开始到结束的变化）"
    }
  ],
  "factions": [
    { "name": "势力/组织名", "description": "描述", "relations": "与其他势力的关系" }
  ],
  "terminology": [
    { "term": "专有名词/术语", "definition": "定义和解释" }
  ]
}

【要求】
1. 世界观设定要自洽、有内在逻辑
2. 角色设定要立体、有成长空间
3. 规则设定要明确，便于后续故事遵守
4. 至少创建 3 个主要角色和 2 个势力`;
}
