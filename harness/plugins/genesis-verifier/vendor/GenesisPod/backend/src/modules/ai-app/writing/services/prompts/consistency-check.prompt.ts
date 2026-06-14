/**
 * Consistency check and Bible update prompt builders.
 *
 * Extracted from writing-mission.service.ts:
 *   - `buildBibleUpdatePrompt`:   L3953-3996 (`updateStoryBibleAfterChapter`)
 *   - `buildConsistencyCheckPrompt`: L2568-2593
 * Pure functions, no DI.
 */

// ── Bible update ────────────────────────────────────────────────────────────

export interface BibleUpdatePromptParams {
  chapterContent: string;
  chapterNumber: number;
  worldSettings: Record<string, unknown>;
  /** Maximum characters to include from chapterContent (defaults to 4000) */
  contentLimit?: number;
  /** Maximum characters to include from worldSettings JSON (defaults to 1500) */
  settingsLimit?: number;
}

export function buildBibleUpdatePrompt(
  params: BibleUpdatePromptParams,
): string {
  const {
    chapterContent,
    chapterNumber,
    worldSettings,
    contentLimit = 4000,
    settingsLimit = 1500,
  } = params;

  return `作为设定守护者，请分析这一章节并提取需要记录到故事圣经的新信息。

【章节内容】
${chapterContent.slice(0, contentLimit)}

【当前世界观设定摘要】
${JSON.stringify(worldSettings, null, 2).slice(0, settingsLimit)}

请识别本章中出现的：
1. 新角色（所有有名有姓的角色，包括配角、龙套，只要有名字就要记录）
2. 角色状态变化（受伤、死亡、关系变化、获得新能力等）
3. 角色关系（角色之间的关系，如"XX是XX的丫鬟"、"XX与XX是敌人"等）
4. 时间线事件（重要事件及其时间）
5. 新的地点/组织/物品等设定

【重要】新角色必须详细记录：
- name: 角色名字
- role: 角色定位（PROTAGONIST主角/ANTAGONIST反派/SUPPORTING配角/MINOR龙套）
- description: 角色描述（外貌、身份、职业等）
- firstAppearance: 首次出现章节
- relationships: 与其他角色的关系

输出 JSON：
{
  "newCharacters": [
    {
      "name": "角色名",
      "role": "SUPPORTING",
      "description": "角色的身份和特征描述",
      "firstAppearance": ${chapterNumber},
      "relationships": [{"target": "另一角色名", "relation": "关系描述"}]
    }
  ],
  "characterUpdates": [
    {"name": "角色名", "change": "发生了什么变化"}
  ],
  "newRelationships": [
    {"character1": "角色A", "character2": "角色B", "relation": "关系描述"}
  ],
  "timelineEvents": ["第X天：发生了某事件"],
  "newSettings": ["新地点/组织/物品等"]
}

务必提取所有出现的有名角色，即使只是一笔带过的角色也要记录！`;
}

// ── Consistency check ────────────────────────────────────────────────────────

export interface ConsistencyCheckPromptParams {
  chapterContent: string;
  worldSettings: Record<string, unknown>;
  previousChapterSummary?: string;
  /** Maximum characters to include from chapterContent (defaults to 4000) */
  contentLimit?: number;
  /** Maximum characters to include from worldSettings JSON (defaults to 2000) */
  settingsLimit?: number;
}

export function buildConsistencyCheckPrompt(
  params: ConsistencyCheckPromptParams,
): string {
  const {
    chapterContent,
    worldSettings,
    previousChapterSummary,
    contentLimit = 4000,
    settingsLimit = 2000,
  } = params;

  return `作为一致性检查员，请检查以下章节内容与世界观设定的一致性：

【章节内容】
${chapterContent.slice(0, contentLimit)}

【世界观设定】
${JSON.stringify(worldSettings, null, 2).slice(0, settingsLimit)}

【前文摘要】
${previousChapterSummary || "这是第一章"}

请严格检查：
1. 角色名称是否一致（不能出现同一角色不同称呼混用）
2. 角色性格行为是否符合设定
3. 场景地点是否符合世界观
4. 时间线是否合理（不能出现逻辑矛盾）
5. 专有名词是否使用一致

输出 JSON 格式：
{
  "passed": true/false,
  "score": 0-100,
  "issues": [
    { "type": "character/setting/timeline/terminology", "severity": "error/warning", "description": "问题描述", "location": "问题位置", "fix": "修复建议" }
  ]
}`;
}

// ── Consistency fix ──────────────────────────────────────────────────────────

export interface ConsistencyFixIssue {
  severity: string;
  description: string;
  location: string;
  fix: string;
}

export interface ConsistencyFixPromptParams {
  chapterContent: string;
  issues: ConsistencyFixIssue[];
  worldSettings: Record<string, unknown>;
  /** Maximum characters to include from worldSettings JSON (defaults to 1500) */
  settingsLimit?: number;
}

export function buildConsistencyFixPrompt(
  params: ConsistencyFixPromptParams,
): string {
  const {
    chapterContent,
    issues,
    worldSettings,
    settingsLimit = 1500,
  } = params;

  const issueList = issues
    .map(
      (issue, i) =>
        `${i + 1}. [${issue.severity}] ${issue.description}\n   位置：${issue.location}\n   建议修复方式：${issue.fix}`,
    )
    .join("\n\n");

  return `请修复以下章节内容中的一致性问题：

【原始内容】
${chapterContent}

【需要修复的问题】（共${issues.length}个）
${issueList}

【世界观设定参考】
${JSON.stringify(worldSettings, null, 2).slice(0, settingsLimit)}

【修复要求】
1. 必须修复上述所有问题，每个问题都要处理
2. 保持故事的流畅性和可读性
3. 不改变主要情节和人物关系
4. 直接输出修复后的完整内容，不要加任何解释`;
}
