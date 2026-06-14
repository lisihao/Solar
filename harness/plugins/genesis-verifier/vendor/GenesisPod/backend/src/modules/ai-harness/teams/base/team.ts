/**
 * AI Engine - Team Implementation
 * 团队实现类
 */

import { v4 as uuidv4 } from "uuid";
import {
  ToolId,
  SkillId,
} from "@/modules/ai-harness/agents/abstractions/agent.types";
import { RoleId, IRole } from "../abstractions/role.interface";
import {
  ITeamMember,
  TeamMemberId,
  MemberConfig,
} from "../abstractions/member.interface";
import { IWorkflow } from "../abstractions/workflow.interface";
import {
  ITeam,
  TeamId,
  TeamType,
  TeamConfig,
} from "../abstractions/team.interface";
import {
  MissionExecutionProfile,
  getDefaultConstraintProfile,
} from "../profile/mission-execution-profile";
import { createMember, createLeader } from "./member";

/**
 * 团队实现类
 */
export class Team implements ITeam {
  readonly id: TeamId;
  readonly name: string;
  readonly description: string;
  readonly type: TeamType;
  readonly config: TeamConfig;
  readonly leader: ITeamMember;
  readonly members: ITeamMember[];
  readonly workflow: IWorkflow;
  readonly constraintProfile: MissionExecutionProfile;

  private readonly roleRegistry: Map<RoleId, IRole>;
  private readonly memberMap: Map<TeamMemberId, ITeamMember>;

  constructor(
    config: TeamConfig,
    roleRegistry: Map<RoleId, IRole>,
    workflow: IWorkflow,
    leader: ITeamMember,
    members: ITeamMember[],
  ) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.type = config.type;
    this.config = config;
    this.roleRegistry = roleRegistry;
    this.workflow = workflow;
    this.leader = leader;
    this.members = members;
    this.constraintProfile = config.constraintProfile;

    // 构建成员映射
    this.memberMap = new Map();
    this.memberMap.set(leader.id, leader);
    for (const member of members) {
      this.memberMap.set(member.id, member);
    }
  }

  /**
   * 获取所有成员（含 Leader）
   */
  getAllMembers(): ITeamMember[] {
    return [this.leader, ...this.members];
  }

  /**
   * 根据角色获取成员
   */
  getMembersByRole(roleId: RoleId): ITeamMember[] {
    return this.getAllMembers().filter((m) => m.role.id === roleId);
  }

  /**
   * 根据 ID 获取成员
   */
  getMemberById(memberId: TeamMemberId): ITeamMember | undefined {
    return this.memberMap.get(memberId);
  }

  /**
   * 检查是否有某角色
   */
  hasRole(roleId: RoleId): boolean {
    return this.getAllMembers().some((m) => m.role.id === roleId);
  }

  /**
   * 获取团队可用技能
   */
  getAvailableSkills(): SkillId[] {
    const skills = new Set<SkillId>();
    for (const member of this.getAllMembers()) {
      for (const skill of member.skills) {
        skills.add(skill);
      }
    }
    return Array.from(skills);
  }

  /**
   * 获取团队可用工具
   */
  getAvailableTools(): ToolId[] {
    const tools = new Set<ToolId>();
    for (const member of this.getAllMembers()) {
      for (const tool of member.tools) {
        tools.add(tool);
      }
    }
    return Array.from(tools);
  }

  /**
   * 获取角色
   */
  getRole(roleId: RoleId): IRole | undefined {
    return this.roleRegistry.get(roleId);
  }

  /**
   * 获取空闲成员
   */
  getIdleMembers(): ITeamMember[] {
    return this.members.filter((m) => m.status === "idle");
  }

  /**
   * 获取指定角色的空闲成员
   */
  getIdleMembersByRole(roleId: RoleId): ITeamMember[] {
    return this.getIdleMembers().filter((m) => m.role.id === roleId);
  }

  /**
   * 转换为 JSON
   */
  toJSON(): TeamConfig {
    return this.config;
  }
}

/**
 * 团队构建器
 */
export class TeamBuilder {
  private config: Partial<TeamConfig>;
  private roleRegistry: Map<RoleId, IRole> = new Map();
  private leader?: ITeamMember;
  private members: ITeamMember[] = [];
  private workflow?: IWorkflow;

  constructor() {
    this.config = {
      id: uuidv4(),
      type: "custom",
    };
  }

  /**
   * 设置 ID
   */
  setId(id: TeamId): this {
    this.config.id = id;
    return this;
  }

  /**
   * 设置名称
   */
  setName(name: string): this {
    this.config.name = name;
    return this;
  }

  /**
   * 设置描述
   */
  setDescription(description: string): this {
    this.config.description = description;
    return this;
  }

  /**
   * 设置类型
   */
  setType(type: TeamType): this {
    this.config.type = type;
    return this;
  }

  /**
   * 添加角色
   */
  addRole(role: IRole): this {
    this.roleRegistry.set(role.id, role);
    return this;
  }

  /**
   * 设置 Leader
   */
  setLeader(config: MemberConfig, role: IRole): this {
    this.roleRegistry.set(role.id, role);
    this.leader = createLeader(config, role);
    this.config.leaderRoleId = role.id;
    return this;
  }

  /**
   * 添加成员
   */
  addMember(config: MemberConfig, role: IRole): this {
    this.roleRegistry.set(role.id, role);
    this.members.push(createMember(config, role));
    return this;
  }

  /**
   * 设置工作流
   */
  setWorkflow(workflow: IWorkflow): this {
    this.workflow = workflow;
    return this;
  }

  /**
   * 设置约束配置
   */
  setConstraintProfile(profile: MissionExecutionProfile): this {
    this.config.constraintProfile = profile;
    return this;
  }

  /**
   * 设置可用技能
   */
  setAvailableSkills(skills: SkillId[]): this {
    this.config.availableSkills = skills;
    return this;
  }

  /**
   * 设置可用工具
   */
  setAvailableTools(tools: ToolId[]): this {
    this.config.availableTools = tools;
    return this;
  }

  /**
   * 设置交付物类型
   */
  setDeliverableTypes(types: string[]): this {
    this.config.deliverableTypes = types;
    return this;
  }

  /**
   * 构建团队
   */
  build(): Team {
    // 验证必填字段
    if (!this.config.name) {
      throw new Error("Team name is required");
    }
    if (!this.config.description) {
      throw new Error("Team description is required");
    }
    if (!this.leader) {
      throw new Error("Team leader is required");
    }
    if (!this.workflow) {
      throw new Error("Team workflow is required");
    }

    // 设置默认值
    const fullConfig: TeamConfig = {
      id: this.config.id!,
      name: this.config.name,
      description: this.config.description,
      type: this.config.type || "custom",
      leaderRoleId: this.config.leaderRoleId!,
      memberRoles: this.config.memberRoles || [],
      workflow: this.workflow,
      availableSkills: this.config.availableSkills || [],
      availableTools: this.config.availableTools || [],
      constraintProfile:
        this.config.constraintProfile || getDefaultConstraintProfile(),
      deliverableTypes: this.config.deliverableTypes || [],
      metadata: this.config.metadata,
    };

    return new Team(
      fullConfig,
      this.roleRegistry,
      this.workflow,
      this.leader,
      this.members,
    );
  }
}

/**
 * 创建团队构建器
 */
export function createTeamBuilder(): TeamBuilder {
  return new TeamBuilder();
}
