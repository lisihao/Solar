/**
 * playground-specific shim 给 ai-engine SKILL.md loader。
 *
 * P9c (2026-05-24):loader 已上提到 ai-engine/skills/loader/skill-md/。
 * loader 通用化,callers 必须传 agentsRootDir。本 shim 用 __dirname 推算
 * playground 的 mission/agents/ 绝对路径,让 playground agent 代码继续用
 * 旧 buildPromptFromDuty(agentDir, dutyName, vars) 二元 API。
 *
 * 各 agent .ts 通过 `from "../_shared/skill-loader"` 导入,不再直接 import
 * engine 的 duty-loader。
 */

import * as path from "path";
import {
  buildPromptFromDuty as engineBuildPromptFromDuty,
  clearSkillCache,
} from "@/modules/ai-engine/facade";

// playground/mission/agents/ 绝对路径(_shared 在内,..回到 agents/)
const PLAYGROUND_AGENTS_ROOT = path.resolve(__dirname, "..");

export function buildPromptFromDuty(
  agentDir: string,
  dutyName: string,
  vars: Record<string, unknown>,
): string {
  return engineBuildPromptFromDuty(
    agentDir,
    dutyName,
    vars,
    PLAYGROUND_AGENTS_ROOT,
  );
}

export { clearSkillCache };

/** 历史别名:旧 duty-loader 名 clearDutyCache;新 SKILL.md loader 实际是 clearSkillCache,语义同。spec 兼容用。 */
export const clearDutyCache = clearSkillCache;
