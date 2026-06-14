/**
 * Agent catalog (ai-app/contracts 跨 app 注册表)
 *
 * 此文件聚合所有平台预置 ai-app 业务身份 + 文案，供 open-api / 前端 gallery 使用。
 *
 * 设计原则：
 *   • 各 ai-app 在自己 directory 拥有 `<app>.constants.ts`（业务名 + 文案）
 *   • 此 catalog 仅 reverse-import 各 ai-app constants 拼装，不重复定义文案
 *   • base layer (harness/engine/infra) 完全不知道业务名（v3 §0 基本原则）
 *
 * 历史：
 *   v3 R0-A1-a (2026-05-04) 从 harness/agents/domain/builtin-agent-catalog.ts
 *     下推到 ai-app 层，删除 base layer 业务硬编码。
 *   2026-05-05 从 ai-app/_meta/agent-catalog.ts 搬到 ai-app/contracts/，
 *     消除自造的 "L3.5 _meta" 层，与 contracts/skills + interfaces 同处。
 */
import type { AgentConfig } from "@/modules/ai-harness/facade";

import {
  RESEARCH_AGENT_ID,
  RESEARCH_AGENT_META,
} from "../research/research.constants";
import {
  TOPIC_INSIGHTS_AGENT_ID,
  TOPIC_INSIGHTS_AGENT_META,
} from "../insight/topic-insights.constants";
import {
  IMAGE_DESIGNER_AGENT_ID,
  IMAGE_DESIGNER_AGENT_META,
} from "../image/image.constants";
import {
  SIMULATOR_AGENT_ID,
  SIMULATOR_AGENT_META,
} from "../simulation/simulation.constants";
import {
  TEAM_COLLABORATION_AGENT_ID,
  TEAM_COLLABORATION_AGENT_META,
} from "../teams/teams.constants";
import {
  SLIDES_AGENT_ID,
  SLIDES_AGENT_META,
  DOCS_AGENT_ID,
  DOCS_AGENT_META,
  DESIGNER_AGENT_ID,
  DESIGNER_AGENT_META,
} from "../office/office.constants";

/** 所有平台预置 agent id（按字母序）*/
export const PLATFORM_AGENT_IDS = [
  DESIGNER_AGENT_ID,
  DOCS_AGENT_ID,
  IMAGE_DESIGNER_AGENT_ID,
  RESEARCH_AGENT_ID,
  SIMULATOR_AGENT_ID,
  SLIDES_AGENT_ID,
  TEAM_COLLABORATION_AGENT_ID,
  TOPIC_INSIGHTS_AGENT_ID,
] as const;

export type PlatformAgentId = (typeof PLATFORM_AGENT_IDS)[number];

/** 平台预置 agent meta record（gallery / open-api 用）*/
export const PLATFORM_AGENT_METAS: Record<PlatformAgentId, AgentConfig> = {
  [RESEARCH_AGENT_ID]: RESEARCH_AGENT_META,
  [TOPIC_INSIGHTS_AGENT_ID]: TOPIC_INSIGHTS_AGENT_META,
  [IMAGE_DESIGNER_AGENT_ID]: IMAGE_DESIGNER_AGENT_META,
  [SIMULATOR_AGENT_ID]: SIMULATOR_AGENT_META,
  [TEAM_COLLABORATION_AGENT_ID]: TEAM_COLLABORATION_AGENT_META,
  [SLIDES_AGENT_ID]: SLIDES_AGENT_META,
  [DOCS_AGENT_ID]: DOCS_AGENT_META,
  [DESIGNER_AGENT_ID]: DESIGNER_AGENT_META,
};

/** 检查 agentId 是否为平台预置 */
export function isPlatformAgentId(agentId: string): agentId is PlatformAgentId {
  return (PLATFORM_AGENT_IDS as readonly string[]).includes(agentId);
}

// re-export individual ids for ergonomic import in routing logic
export {
  RESEARCH_AGENT_ID,
  TOPIC_INSIGHTS_AGENT_ID,
  IMAGE_DESIGNER_AGENT_ID,
  SIMULATOR_AGENT_ID,
  TEAM_COLLABORATION_AGENT_ID,
  SLIDES_AGENT_ID,
  DOCS_AGENT_ID,
  DESIGNER_AGENT_ID,
};
