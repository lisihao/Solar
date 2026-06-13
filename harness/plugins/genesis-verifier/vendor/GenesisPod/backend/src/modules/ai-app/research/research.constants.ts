/**
 * Research ai-app 业务常量（v3 R0-A1-a：从 harness BUILTIN_AGENTS 下推）
 *
 * 业务身份 + 产品文案，仅 ai-app 层持有；harness 不再硬编码业务名。
 */
import type { AgentConfig } from "@/modules/ai-harness/facade";

export const RESEARCH_AGENT_ID = "researcher" as const;
// Team id（v3 R0-A1-c）—— mission-style team id, agent id 不同
export const RESEARCH_TEAM_ID = "research" as const;

export const RESEARCH_AGENT_META: AgentConfig = {
  id: RESEARCH_AGENT_ID,
  name: "AI Researcher",
  description: "智能研究助手，进行资料调研和知识整理",
  icon: "🔬",
  color: "#EC4899",
  capabilities: [
    "自动调研资料",
    "知识图谱构建",
    "内容摘要生成",
    "研究报告撰写",
  ],
  templates: [],
};
