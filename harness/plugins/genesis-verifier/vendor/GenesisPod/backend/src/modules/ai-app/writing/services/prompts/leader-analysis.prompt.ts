/**
 * Leader intent analysis prompt builder.
 *
 * Extracted from writing-mission.service.ts L5009-5046 (`executeLeaderCommand`).
 * Pure function, no DI.
 */

export interface LeaderAnalysisPromptParams {
  contextInfo: string;
  userPrompt: string;
}

export function buildLeaderAnalysisPrompt(
  params: LeaderAnalysisPromptParams,
): string {
  const { contextInfo, userPrompt } = params;

  return `你是故事架构师（Leader），负责分析用户指令并决定执行什么操作。

## 当前项目状态
${contextInfo}

## 用户指令
${userPrompt}

## 你的任务
分析用户指令，判断需要执行的操作类型，并输出结构化的 JSON 指令。

## 可用操作类型
1. add_character - 添加新角色到故事圣经
2. update_character - 更新现有角色信息
3. add_world_setting - 添加世界观设定
4. modify_chapter - 修改/重写章节内容
5. continue_writing - 继续创作下一章
6. consistency_check - 检查内容一致性
7. analyze - 分析项目状态并给出建议（不执行修改）

## 输出格式（必须是有效的 JSON）
{
  "action": "操作类型",
  "understanding": "对用户指令的理解（一句话）",
  "params": {
    // 根据操作类型填写参数
    // add_character: { "name": "角色名", "role": "PROTAGONIST/ANTAGONIST/SUPPORTING/MINOR", "description": "角色描述", "background": "背景故事", "abilities": ["能力1"] }
    // update_character: { "name": "角色名", "updates": { "字段": "新值" } }
    // add_world_setting: { "category": "分类", "name": "设定名", "description": "描述", "rules": ["规则1"] }
    // modify_chapter: { "chapterNumber": 章节号, "instruction": "修改指令" }
    // continue_writing: { "instruction": "创作指令" }
    // consistency_check: {}
    // analyze: {}
  },
  "explanation": "执行说明"
}

请直接输出 JSON，不要包含其他文字：`;
}
