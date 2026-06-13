/**
 * Mission Types - 任务协作系统类型定义
 *
 * 定义 Mission、Task、TeamMember 等核心类型
 * 用于替换 team-mission.service.ts 中的 any 类型
 */

import {
  MissionStatus,
  AgentTaskStatus,
  TaskPriority,
  TaskType,
  AgentWorkStyle,
} from "@prisma/client";
import {
  MissionContextPackage,
  HardConstraint,
} from "@/modules/ai-harness/facade";

// ==================== Team Member Types ====================

/**
 * 团队成员基础信息
 */
export interface TeamMemberBase {
  id: string;
  displayName: string;
  agentName: string | null;
  avatar: string | null;
  aiModel: string;
  isLeader: boolean;
  roleDescription: string | null;
  agentIdentity: string | null;
  expertiseAreas: string[];
  workStyle: AgentWorkStyle | null;
  systemPrompt: string | null;
}

/**
 * 团队成员（用于任务分配）
 */
export interface TeamMember extends TeamMemberBase {
  topicId: string;
}

/**
 * Leader 信息（包含额外字段）
 */
export interface LeaderInfo extends TeamMemberBase {
  // Leader 特有的能力配置可在此扩展
}

// ==================== Agent Task Types ====================

/**
 * 任务分配者信息（简化版）
 */
export interface TaskAssignee {
  id: string;
  displayName: string;
  agentName: string | null;
  avatar: string | null;
  aiModel: string;
}

/**
 * Agent 任务基础信息
 */
export interface AgentTaskBase {
  id: string;
  missionId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  taskType: TaskType;
  status: AgentTaskStatus;
  assignedToId: string;
  dependsOnIds: string[];
  result: string | null;
  leaderFeedback: string | null;
  needsRevision: boolean;
  revisionCount: number;
  maxRevisions: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 带分配者信息的任务
 */
export interface AgentTaskWithAssignee extends AgentTaskBase {
  assignedTo: TaskAssignee;
  assignedReason: string | null;
}

/**
 * 完整任务信息（包含审核历史）
 */
export interface AgentTaskFull extends AgentTaskWithAssignee {
  reviewHistory: ReviewHistoryItem[] | null;
  constraintViolations: ConstraintViolation[] | null;
}

/**
 * 审核历史条目
 */
export interface ReviewHistoryItem {
  time: string;
  result: "approved" | "rejected";
  feedback: string;
  confidence: number;
}

/**
 * 约束违规记录
 */
export interface ConstraintViolation {
  constraintId: string;
  text: string;
  position?: number;
}

// ==================== Mission Types ====================

/**
 * Mission 创建者信息
 */
export interface MissionCreator {
  id: string;
  username: string;
  fullName: string | null;
}

/**
 * Mission 基础信息
 */
export interface MissionBase {
  id: string;
  topicId: string;
  title: string;
  description: string;
  objectives: string[];
  constraints: string[];
  deliverables: string[];
  status: MissionStatus;
  leaderId: string;
  totalTasks: number;
  completedTasks: number;
  progressPercent: number;
  totalTokensUsed: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  finalResult: string | null;
  summary: string | null;
  notificationEmail: string | null;
  goals?: string; // 任务目标（可选）
}

/**
 * 带关联数据的 Mission
 * 注意：部分字段为可选，因为不同查询场景包含的关联不同
 * JSON 字段使用 unknown 类型以兼容 Prisma 的 JsonValue
 */
export interface MissionWithRelations extends MissionBase {
  leader: TeamMemberBase;
  createdBy?: MissionCreator; // 可选，部分查询不包含
  tasks?: AgentTaskWithAssignee[]; // 可选，部分查询不包含
  contextPackage?: MissionContextPackage | unknown | null; // Prisma JSON 字段
  mustConstraints?: HardConstraint[] | unknown | null; // Prisma JSON 字段
  taskBreakdown?: TaskBreakdownData | unknown | null; // Prisma JSON 字段
  _count?: {
    tasks: number;
    logs: number;
  };
}

/**
 * 完整 Mission（包含所有字段）
 * JSON 字段使用 unknown 以兼容 Prisma
 */
export interface MissionFull extends MissionWithRelations {
  inputBackground?: string | null;
  inputConstraints?: unknown; // Prisma JSON 字段
  inputEntities?: unknown; // Prisma JSON 字段
  inputExamples?: unknown; // Prisma JSON 字段
  inputProcessed?: boolean;
  inputSummary?: string | null;
  constraintViolations?: unknown; // Prisma JSON 字段
}

/**
 * Topic 基础信息
 */
export interface TopicBase {
  id: string;
  name: string;
  aiMembers: TeamMemberBase[];
}

/**
 * 带 Topic 关系的 Mission（用于规划阶段）
 * 注意：继承时部分字段可能不存在，因此使用 Partial
 */
export interface MissionWithTopic extends Partial<MissionFull> {
  id: string;
  topicId: string;
  title: string;
  description: string;
  leader: TeamMemberBase;
  topic: TopicBase;
}

// ==================== Task Breakdown Types ====================

/**
 * 任务分解项
 */
export interface TaskBreakdownItem {
  title: string;
  description: string;
  assigneeId: string;
  assigneeName: string;
  reason: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  taskType: string;
  dependsOn: number[];
}

/**
 * 任务分解结果
 */
export interface TaskBreakdownData {
  understanding: string;
  tasks: TaskBreakdownItem[];
  executionPlan: string;
  risks: string;
}

// ==================== Execution Context Types ====================

/**
 * 任务执行上下文
 */
export interface TaskExecutionContext {
  mission: MissionWithRelations;
  task: AgentTaskWithAssignee;
  searchContext?: string;
  previousResults?: string[];
}

/**
 * 审核上下文
 */
export interface ReviewContext {
  mission: MissionWithRelations;
  task: AgentTaskWithAssignee;
  taskResult: string;
  reviewContent?: string;
}

/**
 * 修订上下文
 */
export interface RevisionContext {
  mission: MissionWithRelations;
  task: AgentTaskWithAssignee;
  feedback: string;
  previousResult: string;
}

// ==================== AI Response Types ====================

/**
 * AI 调用响应
 */
export interface AIResponse {
  content: string;
  tokensUsed: number;
  model?: string;
  finishReason?: string;
}

/**
 * 搜索结果
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
}

// ==================== Team Members Result ====================

/**
 * getTeamMembers 返回结果
 */
export interface TeamMembersResult {
  leader: TeamMemberBase | null;
  members: TeamMemberBase[];
  all: TeamMemberBase[];
}

// ==================== Callback Types ====================

import { MissionLogType, MessageContentType } from "@prisma/client";

/**
 * 创建日志的回调函数类型
 */
export type CreateLogFn = (
  missionId: string,
  data: {
    type: MissionLogType;
    content: string;
    agentId?: string;
    agentName?: string;
    taskId?: string;
    taskTitle?: string;
  },
) => Promise<unknown>;

/**
 * 发送消息到 Topic 的回调函数类型
 */
export type SendMessageToTopicFn = (
  topicId: string,
  aiMemberId: string | null,
  content: string,
  type: MessageContentType,
) => Promise<unknown>;

/**
 * 执行下一批任务的回调函数类型
 */
export type ExecuteNextTasksFn = (missionId: string) => Promise<unknown>;

/**
 * 启动任务的回调函数类型
 */
export type StartMissionFn = (
  missionId: string,
  userId: string,
) => Promise<unknown>;

/**
 * MissionLifecycleService 回调集合
 */
export interface LifecycleCallbacks {
  createLog: CreateLogFn;
  sendMessageToTopic: SendMessageToTopicFn;
  executeNextTasks: ExecuteNextTasksFn;
  startMission: StartMissionFn;
}

/**
 * handleLeaderMentionCommand 的回调函数类型
 */
export type HandleLeaderMentionCommandFn = (
  topicId: string,
  userId: string,
  content: string,
) => Promise<{ handled: boolean; action?: string; missionId?: string }>;

/**
 * MissionRetryService 回调集合
 */
export interface RetryCallbacks {
  createLog: CreateLogFn;
  sendMessageToTopic: SendMessageToTopicFn;
  startMission: StartMissionFn;
  handleLeaderMentionCommand: HandleLeaderMentionCommandFn;
  executeNextTasks: ExecuteNextTasksFn;
}

// ==================== Utility Types ====================

/**
 * 分页参数
 */
export interface PaginationOptions {
  page?: number;
  pageSize?: number;
}

/**
 * Mission 查询选项
 */
export interface MissionQueryOptions {
  status?: MissionStatus;
  includeCompleted?: boolean;
}

/**
 * 任务统计
 */
export interface TaskStatistics {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  needsRevision: number;
}
