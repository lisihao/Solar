/**
 * AI Engine - Team Interface
 * 团队抽象接口定义
 */

import {
  ToolId,
  SkillId,
} from "@/modules/ai-harness/agents/abstractions/agent.types";
import { RoleId } from "./role.interface";
import { ITeamMember, TeamMemberId } from "./member.interface";
import { IWorkflow, WorkflowConfig } from "./workflow.interface";
import { MissionExecutionProfile } from "../profile/mission-execution-profile";

// ==================== Team ID ====================

export type TeamId = string;

export type TeamType = "predefined" | "custom";

// v3 R0-A1-c: BUILTIN_TEAMS / BuiltinTeamId 已删除（业务名下推到各 ai-app *.constants.ts）

// ==================== Team 配置 ====================

/**
 * 团队配置
 */
export interface TeamConfig {
  /** 团队 ID */
  id: TeamId;

  /** 团队名称 */
  name: string;

  /** 团队描述 */
  description: string;

  /** 团队类型 */
  type: TeamType;

  /** 团队图标 */
  icon?: string;

  /** 团队颜色 */
  color?: string;

  /** Leader 角色 ID */
  leaderRoleId: RoleId;

  /** 成员角色配置 */
  memberRoles: MemberRoleConfig[];

  /** 工作流定义 */
  workflow: WorkflowConfig;

  /** 可用技能列表 */
  availableSkills: SkillId[];

  /** 可用工具列表 */
  availableTools: ToolId[];

  /** 约束配置 */
  constraintProfile: MissionExecutionProfile;

  /** 交付物类型 */
  deliverableTypes: string[];

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 成员角色配置
 */
export interface MemberRoleConfig {
  /** 角色 ID */
  roleId: RoleId;

  /** 最小数量 */
  minCount: number;

  /** 最大数量 */
  maxCount: number;

  /** 是否必须 */
  required: boolean;
}

// ==================== Team 实例 ====================

/**
 * 团队实例（运行时）
 */
export interface ITeam {
  /** 团队 ID */
  readonly id: TeamId;

  /** 团队名称 */
  readonly name: string;

  /** 团队描述 */
  readonly description: string;

  /** 团队类型 */
  readonly type: TeamType;

  /** 团队配置 */
  readonly config: TeamConfig;

  /** Leader 成员 */
  readonly leader: ITeamMember;

  /** 所有成员（不含 Leader） */
  readonly members: ITeamMember[];

  /** 工作流 */
  readonly workflow: IWorkflow;

  /** 约束配置 */
  readonly constraintProfile: MissionExecutionProfile;

  /**
   * 获取所有成员（含 Leader）
   */
  getAllMembers(): ITeamMember[];

  /**
   * 根据角色获取成员
   */
  getMembersByRole(roleId: RoleId): ITeamMember[];

  /**
   * 根据 ID 获取成员
   */
  getMemberById(memberId: TeamMemberId): ITeamMember | undefined;

  /**
   * 检查是否有某角色
   */
  hasRole(roleId: RoleId): boolean;

  /**
   * 获取团队可用技能
   */
  getAvailableSkills(): SkillId[];

  /**
   * 获取团队可用工具
   */
  getAvailableTools(): ToolId[];
}

// ==================== Team 能力 ====================

/**
 * 团队能力描述
 */
export interface TeamCapability {
  /** 能力 ID */
  id: string;

  /** 能力名称 */
  name: string;

  /** 能力描述 */
  description: string;

  /** 能力分类 */
  category: string;

  /** 所需角色 */
  requiredRoles: RoleId[];

  /** 所需技能 */
  requiredSkills: SkillId[];
}

// ==================== Team 状态 ====================

/**
 * 团队执行状态
 */
export type TeamExecutionStatus =
  | "idle"
  | "planning"
  | "executing"
  | "reviewing"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * 团队执行上下文
 */
export interface TeamExecutionContext {
  /** 执行 ID */
  executionId: string;

  /** 团队 ID */
  teamId: TeamId;

  /** 用户 ID */
  userId?: string;

  /** 会话 ID */
  sessionId?: string;

  /** 当前状态 */
  status: TeamExecutionStatus;

  /** 开始时间 */
  startTime: Date;

  /** 结束时间 */
  endTime?: Date;

  /** 约束条件 */
  constraints: MissionExecutionProfile;

  /** 共享状态 */
  sharedState: Record<string, unknown>;

  /** 取消信号 */
  signal?: AbortSignal;
}
