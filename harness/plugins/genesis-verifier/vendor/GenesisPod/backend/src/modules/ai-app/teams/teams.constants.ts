/**
 * Teams ai-app 业务常量（v3 R0-A1-a：从 harness BUILTIN_AGENTS 下推）
 */
import type { AgentConfig } from "@/modules/ai-harness/facade";

export const TEAM_COLLABORATION_AGENT_ID = "team-collaboration" as const;
// Team id（v3 R0-A1-c）
export const DEBATE_TEAM_ID = "debate" as const;

export const TEAM_COLLABORATION_AGENT_META: AgentConfig = {
  id: TEAM_COLLABORATION_AGENT_ID,
  name: "AI Team Collaboration",
  description: "智能团队协作专家，管理多 AI 成员协作",
  icon: "👥",
  color: "#8B5CF6",
  capabilities: [
    "团队任务协调",
    "智能任务分配",
    "共识投票决策",
    "任务编排执行",
  ],
  templates: [],
};
