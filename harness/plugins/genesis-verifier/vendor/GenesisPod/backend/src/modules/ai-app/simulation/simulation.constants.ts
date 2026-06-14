/**
 * Simulation ai-app 业务常量（v3 R0-A1-a：从 harness BUILTIN_AGENTS 下推）
 */
import type { AgentConfig } from "@/modules/ai-harness/facade";

export const SIMULATOR_AGENT_ID = "simulator" as const;

export const SIMULATOR_AGENT_META: AgentConfig = {
  id: SIMULATOR_AGENT_ID,
  name: "AI Simulator",
  description: "智能推演专家，进行多方博弈和场景模拟",
  icon: "🎯",
  color: "#EF4444",
  capabilities: ["多方博弈模拟", "场景推演分析", "决策建议生成", "风险评估"],
  templates: [],
};
