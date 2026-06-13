/**
 * Discussion-driven Research Types
 * 讨论驱动型研究团队的类型定义
 */

import { SearchSource } from "./types";

// ==================== 讨论阶段 ====================

export type DiscussionPhase =
  | "ideation" // 头脑风暴
  | "execution" // 分头调研
  | "findings" // 汇报讨论
  | "synthesis" // 报告生成
  | "completed" // 完成
  | "error"; // 错误

// ==================== Agent 角色 ====================

export type DiscussionRole =
  | "director" // 总监
  | "researcher" // 研究员
  | "analyst" // 分析师
  | "writer" // 撰稿人
  | "reviewer"; // 审稿人

/** Agent 角色配置 */
export interface AgentConfig {
  role: DiscussionRole;
  name: string;
  icon: string; // Lucide icon name
  systemPrompt: string;
}

/** Agent 运行时状态 */
export interface AgentState {
  config: AgentConfig;
  conversationHistory: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  status: "idle" | "speaking" | "searching" | "writing";
}

// ==================== 讨论消息 ====================

export type DiscussionMessageType =
  | "proposal" // 提案
  | "idea" // 想法
  | "critique" // 批评/质疑
  | "status" // 状态更新
  | "findings" // 汇报发现
  | "cross_check" // 交叉验证
  | "synthesis" // 综合洞察
  | "draft" // 草稿
  | "review" // 审核
  | "system"; // 系统消息

export interface DiscussionMessage {
  id: string;
  agentRole: DiscussionRole;
  agentName: string;
  agentIcon: string;
  content: string;
  phase: DiscussionPhase;
  messageType: DiscussionMessageType;
  metadata?: {
    searchResults?: SearchSource[];
    directions?: string[];
    citations?: number[];
  };
  timestamp: Date;
}

// ==================== 研究方向 ====================

export interface ResearchDirection {
  title: string;
  description: string;
  assignedTo: string; // agent name
  searchQueries: string[];
}

// ==================== SSE 事件 ====================

export interface DiscussionMessageEvent {
  type: "discussion.message";
  data: DiscussionMessage;
}

export interface DiscussionPhaseEvent {
  type: "discussion.phase";
  data: {
    phase: DiscussionPhase;
    summary: string;
    directions?: string[];
  };
}

export interface DiscussionTypingEvent {
  type: "discussion.typing";
  data: {
    agentRole: DiscussionRole;
    agentName: string;
  };
}

// ==================== Agent 团队配置 ====================

/** 讨论团队的默认角色图标映射 */
export const AGENT_ICONS: Record<DiscussionRole, string> = {
  director: "crown",
  researcher: "search",
  analyst: "bar-chart-3",
  writer: "pen-line",
  reviewer: "shield-check",
};

/**
 * 讨论团队的默认角色名称（中文）
 * @deprecated Use `AGENT_NAMES` from `./prompt-locale` instead for bilingual support
 */
export const AGENT_NAMES_ZH: Record<string, string> = {
  director: "研究总监",
  "researcher-a": "研究员 A",
  "researcher-b": "研究员 B",
  "researcher-c": "研究员 C",
  analyst: "分析师",
  writer: "撰稿人",
  reviewer: "审稿人",
};

// ==================== Ideation 阶段输出 ====================

/** Ideation 阶段 LLM 响应结构 */
export interface IdeationResponse {
  ideas?: string[];
  directions?: string[];
  critique?: string;
  blindSpots?: string[];
  consensus?: ResearchDirection[];
}
