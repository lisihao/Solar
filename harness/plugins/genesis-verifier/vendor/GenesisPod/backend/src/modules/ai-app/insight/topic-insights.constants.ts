/**
 * Topic Insights ai-app 业务常量（v3 R0-A1-a：从 harness BUILTIN_AGENTS 下推）
 */
import type { AgentConfig } from "@/modules/ai-harness/facade";

export const TOPIC_INSIGHTS_AGENT_ID = "topic-insights" as const;
// Team id（v3 R0-A1-c）—— 与 agent id 同值
export const TOPIC_INSIGHTS_TEAM_ID = "topic-insights" as const;

export const TOPIC_INSIGHTS_AGENT_META: AgentConfig = {
  id: TOPIC_INSIGHTS_AGENT_ID,
  name: "Topic Insights Researcher",
  description: "多维度深度研究与专业报告生成",
  icon: "💡",
  color: "#8B5CF6",
  capabilities: [
    "多维度深度研究",
    "自动化报告生成",
    "事实核查",
    "多Agent辩论分析",
    "跨维度关联分析",
  ],
  templates: [],
};
