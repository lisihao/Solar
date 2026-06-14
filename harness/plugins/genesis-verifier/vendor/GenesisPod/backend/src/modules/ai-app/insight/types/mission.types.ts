/**
 * Mission Types
 *
 * Type definitions for research mission service
 */

import type {
  ResearchMissionStatus,
  ResearchTaskStatus,
  Prisma,
} from "@prisma/client";
import type { ResearchMode } from "../dto/leader.dto";
import type { DimensionAnalysisResult } from "./research.types";
import type { StateTransitionMap } from "@/modules/ai-harness/facade";

/**
 * Research Mission 状态转移规则
 *
 * PLANNING → PLAN_READY → EXECUTING → REVIEWING → COMPLETED
 *                                  ↘ FAILED ↗ (retry → EXECUTING)
 * Any active → CANCELLED
 */
export const RESEARCH_MISSION_TRANSITIONS: StateTransitionMap<ResearchMissionStatus> =
  {
    PLANNING: ["PLAN_READY", "EXECUTING", "FAILED", "CANCELLED"],
    PLAN_READY: ["EXECUTING", "CANCELLED"],
    EXECUTING: ["REVIEWING", "COMPLETED", "FAILED", "CANCELLED"],
    REVIEWING: ["COMPLETED", "EXECUTING", "FAILED", "CANCELLED"],
    COMPLETED: [],
    FAILED: ["EXECUTING"], // retry
    CANCELLED: [],
  };

/**
 * Research Task 状态转移规则
 */
export const RESEARCH_TASK_TRANSITIONS: StateTransitionMap<ResearchTaskStatus> =
  {
    PENDING: ["ASSIGNED", "EXECUTING", "FAILED"],
    ASSIGNED: ["EXECUTING", "FAILED"],
    EXECUTING: ["COMPLETED", "NEEDS_REVISION", "FAILED"],
    COMPLETED: [],
    NEEDS_REVISION: ["PENDING", "EXECUTING", "FAILED"],
    FAILED: ["PENDING"], // retry
  };

/**
 * 任务优先级常量
 * 数值越小优先级越高（先执行）
 */
export const TASK_PRIORITY = {
  /** 动态添加的维度研究任务 */
  DIMENSION_RESEARCH_DYNAMIC: 50,
  /** 质量审核任务 */
  QUALITY_REVIEW: 100,
  /** 报告撰写任务 */
  REPORT_SYNTHESIS: 200,
} as const;

export interface CreateMissionInput {
  topicId: string;
  userPrompt?: string;
  userContext?: Record<string, unknown>;
  /** ★ 研究模式：fresh=全新开始，incremental=增量更新（保留已完成任务） */
  mode?: ResearchMode;
  /** V5: 研究深度 */
  researchDepth?: string;
}

export interface MissionStatus {
  id: string;
  status: ResearchMissionStatus;
  progress: number;
  totalTasks: number;
  completedTasks: number;
  currentPhase: string;
  tasks: TaskStatus[];
  leaderPlan?: import("./leader.types").LeaderPlan;
  researchDepth?: string;
  leaderModelId?: string;
  leaderModelName?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt?: string;
}

export interface TaskStatus {
  id: string;
  title: string;
  description?: string;
  taskType: string;
  dimensionName?: string;
  assignedAgent: string;
  /** ★ Agent 使用的 AI 模型 ID */
  modelId?: string;
  /** ★ 模型展示名称（用于前端显示和图标匹配） */
  modelDisplayName?: string;
  status: ResearchTaskStatus;
  reviewStatus?: string;
  progress?: number;
  /** 任务结果（包含成功数据或错误信息） */
  result?: DimensionAnalysisResult | Prisma.JsonValue | null;
  /** 结果摘要 */
  resultSummary?: string;
  /** 开始时间 */
  startedAt?: Date;
  /** 完成时间 */
  completedAt?: Date;
}

export interface MissionProgressEvent {
  missionId: string;
  topicId: string;
  status: ResearchMissionStatus;
  progress: number;
  phase: string;
  message: string;
  currentTask?: string;
  completedTasks: number;
  totalTasks: number;
}

/**
 * 已完成的任务数据（用于增量模式复制）
 */
export interface CompletedTaskData {
  dimensionName: string;
  dimensionId: string | null;
  title: string;
  description: string;
  assignedAgent: string;
  assignedAgentType: string | null;
  modelId: string | null; // ★ 保存使用的模型 ID
  priority: number;
  result: Prisma.JsonValue | null;
  resultSummary: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface TeamInfo {
  leaderId: string | null;
  leaderModel: string | null;
  agents: AgentInfo[];
}

export interface AgentInfo {
  id: string;
  type: string;
  role: string;
  status: "idle" | "working" | "completed" | "failed";
  currentTask?: string;
  assignedDimensions?: string[];
  /** ★ Agent 使用的 AI 模型名称 */
  model?: string;
  /** ★ v8.0: Leader 分配给此 Agent 的技能 */
  skills?: string[];
  /** ★ v8.0: Leader 分配给此 Agent 的工具 */
  tools?: string[];
}
