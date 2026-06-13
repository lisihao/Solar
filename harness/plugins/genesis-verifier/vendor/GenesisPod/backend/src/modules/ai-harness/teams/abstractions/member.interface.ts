/**
 * AI Engine - Team Member Interface
 * 团队成员抽象接口定义
 */

import { ToolId, SkillId } from "@/modules/ai-harness/agents/abstractions/agent.types";
import { IRole, RoleId, WorkStyle } from "./role.interface";

// ==================== Member ID ====================

export type TeamMemberId = string;

// ==================== 成员状态 ====================

export type MemberStatus =
  | "idle"
  | "thinking"
  | "executing"
  | "waiting"
  | "completed"
  | "failed";

// ==================== 成员接口 ====================

/**
 * 团队成员接口
 */
export interface ITeamMember {
  /** 成员 ID */
  readonly id: TeamMemberId;

  /** 成员名称 */
  readonly name: string;

  /** 成员角色 */
  readonly role: IRole;

  /** 使用的 AI 模型 */
  readonly model: string;

  /** 可用技能 */
  readonly skills: SkillId[];

  /** 可用工具 */
  readonly tools: ToolId[];

  /** 角色人设（个性化提示词） */
  readonly persona: string;

  /** 工作风格 */
  readonly workStyle: WorkStyle;

  /** 当前状态 */
  status: MemberStatus;

  /** 元数据 */
  readonly metadata?: Record<string, unknown>;

  /**
   * 是否为 Leader
   */
  isLeader(): boolean;

  /**
   * 检查是否有某技能
   */
  hasSkill(skillId: SkillId): boolean;

  /**
   * 检查是否有某工具
   */
  hasTool(toolId: ToolId): boolean;

  /**
   * 获取系统提示词
   */
  getSystemPrompt(): string;
}

// ==================== 成员配置 ====================

/**
 * 成员配置（用于创建成员）
 */
export interface MemberConfig {
  /** 成员 ID（可选，自动生成） */
  id?: TeamMemberId;

  /** 成员名称（可选，从角色派生） */
  name?: string;

  /** 角色 ID */
  roleId: RoleId;

  /** 使用的 AI 模型 */
  model: string;

  /** 额外技能（追加到角色核心技能） */
  additionalSkills?: SkillId[];

  /** 额外工具（追加到角色核心工具） */
  additionalTools?: ToolId[];

  /** 角色人设（覆盖默认） */
  persona?: string;

  /** 工作风格（覆盖默认） */
  workStyle?: Partial<WorkStyle>;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ==================== Leader 扩展接口 ====================

/**
 * Leader 成员接口（扩展普通成员）
 */
export interface ILeader extends ITeamMember {
  /**
   * 分解任务
   */
  decomposeTask(task: TaskInput): Promise<SubTask[]>;

  /**
   * 分配任务给成员
   */
  assignTask(subTask: SubTask, member: ITeamMember): Promise<TaskAssignment>;

  /**
   * 审核成员输出
   */
  reviewOutput(output: MemberOutput): Promise<ReviewResult>;

  /**
   * 整合最终结果
   */
  integrateResults(results: MemberOutput[]): Promise<IntegratedResult>;

  /**
   * 决定是否需要返工
   */
  decideRework(review: ReviewResult): Promise<ReworkDecision>;
}

// ==================== 任务相关类型 ====================

/**
 * 任务输入
 */
export interface TaskInput {
  /** 任务 ID */
  id: string;

  /** 任务描述 */
  description: string;

  /** 任务要求 */
  requirements?: string[];

  /** 上下文信息 */
  context?: Record<string, unknown>;

  /** 附件 */
  attachments?: TaskAttachment[];
}

/**
 * 任务附件
 */
export interface TaskAttachment {
  id: string;
  name: string;
  type: string;
  url?: string;
  content?: unknown;
}

/**
 * 子任务
 */
export interface SubTask {
  /** 子任务 ID */
  id: string;

  /** 父任务 ID */
  parentTaskId: string;

  /** 子任务描述 */
  description: string;

  /** 建议角色 */
  suggestedRole: RoleId;

  /** 依赖的子任务 ID */
  dependencies: string[];

  /** 预估耗时（毫秒） */
  estimatedDuration: number;

  /** 优先级 */
  priority: number;

  /** 额外上下文 */
  context?: Record<string, unknown>;
}

/**
 * 任务分配
 */
export interface TaskAssignment {
  /** 分配 ID */
  id: string;

  /** 子任务 */
  subTask: SubTask;

  /** 被分配的成员 */
  assignee: TeamMemberId;

  /** 分配时间 */
  assignedAt: Date;

  /** 截止时间 */
  deadline?: Date;

  /** 分配说明 */
  instructions?: string;
}

/**
 * 成员输出
 */
export interface MemberOutput {
  /** 输出 ID */
  id: string;

  /** 任务分配 ID */
  assignmentId: string;

  /** 成员 ID */
  memberId: TeamMemberId;

  /** 输出内容 */
  content: unknown;

  /** 输出类型 */
  contentType: string;

  /** 完成时间 */
  completedAt: Date;

  /** 耗时（毫秒） */
  duration: number;

  /** Token 消耗 */
  tokensUsed: number;

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 审核结果
 */
export interface ReviewResult {
  /** 审核 ID */
  id: string;

  /** 被审核的输出 ID */
  outputId: string;

  /** 审核者 ID */
  reviewerId: TeamMemberId;

  /** 是否通过 */
  passed: boolean;

  /** 评分（1-10） */
  score: number;

  /** 反馈意见 */
  feedback: string;

  /** 问题列表 */
  issues?: ReviewIssue[];

  /** 审核时间 */
  reviewedAt: Date;
}

/**
 * 审核问题
 */
export interface ReviewIssue {
  /** 问题类型 */
  type: "error" | "warning" | "suggestion";

  /** 问题描述 */
  description: string;

  /** 建议修改 */
  suggestion?: string;
}

/**
 * 整合结果
 */
export interface IntegratedResult {
  /** 结果 ID */
  id: string;

  /** 整合的输出 ID 列表 */
  sourceOutputIds: string[];

  /** 整合后的内容 */
  content: unknown;

  /** 内容类型 */
  contentType: string;

  /** 摘要 */
  summary: string;

  /** 整合时间 */
  integratedAt: Date;
}

/**
 * 返工决定
 */
export interface ReworkDecision {
  /** 是否需要返工 */
  needsRework: boolean;

  /** 返工的输出 ID */
  outputId: string;

  /** 返工原因 */
  reason?: string;

  /** 返工指导 */
  guidance?: string;

  /** 最大返工次数 */
  maxRetries: number;

  /** 当前重试次数 */
  currentRetry: number;
}
