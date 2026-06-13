/**
 * AI Engine - Team Factory
 * 团队工厂 - 从配置实例化团队
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  ITeam,
  TeamConfig,
  MemberRoleConfig,
} from "../abstractions/team.interface";
import { IRole, RoleId } from "../abstractions/role.interface";
import { ITeamMember, MemberConfig } from "../abstractions/member.interface";
import { IWorkflow, WorkflowConfig } from "../abstractions/workflow.interface";
import { Team } from "../base/team";
import { createMember, createLeader, LeaderConfig } from "../base/member";
import { Workflow } from "../base/workflow";
import {
  ILeaderLLMAdapter,
  createLeaderLLMAdapter,
} from "../base/leader-llm-adapter";
import { RoleRegistry } from "../registry/role-registry";
import { TeamRegistry } from "../registry/team-registry";
import { LLMFactory } from "@/modules/ai-engine/llm/factory/llm.factory";
import type { IStepDecompositionService } from "@/modules/ai-engine/planning/decomposition/abstractions/step-decomposition.interface";

/**
 * 团队实例化选项
 */
export interface TeamInstantiationOptions {
  /** 默认模型（如果成员未指定） */
  defaultModel?: string;

  /** 约束覆盖 */
  constraintOverrides?: Record<string, unknown>;

  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 团队工厂服务
 */
@Injectable()
export class TeamFactory {
  private readonly logger = new Logger(TeamFactory.name);

  constructor(
    private readonly roleRegistry: RoleRegistry,
    private readonly teamRegistry: TeamRegistry,
    @Optional() private readonly llmFactory?: LLMFactory,
    @Optional() private readonly stepDecomposition?: IStepDecompositionService,
  ) {}

  /**
   * 从配置创建团队实例
   */
  createFromConfig(
    config: TeamConfig,
    options?: TeamInstantiationOptions,
  ): ITeam {
    this.logger.log(`Creating team instance: ${config.id} (${config.name})`);

    // Resolve the default model: caller-supplied first, else the LLMFactory's
    // configured default. NB getDefaultModel() THROWS when nothing is configured
    // (it does not return ""), so an empty caller model surfaces here as the
    // opaque "No default AI model configured" — log the resolution explicitly so
    // the root cause (caller passed no model) is obvious in the trace.
    let defaultModel = options?.defaultModel ?? "";
    if (!defaultModel) {
      this.logger.warn(
        `[TeamFactory] ${config.id}: no defaultModel from caller — falling back to LLMFactory.getDefaultModel() (throws if unconfigured)`,
      );
      defaultModel = (this.llmFactory?.getDefaultModel() as string) ?? "";
    }
    this.logger.log(
      `[TeamFactory] ${config.id} resolved defaultModel="${defaultModel || "EMPTY"}"`,
    );

    // 1. 解析角色
    const roleMap = this.resolveRoles(config);

    // 2. 创建工作流
    const workflow = this.createWorkflow(config.workflow);

    // 3. 创建 Leader
    const leaderRole = roleMap.get(config.leaderRoleId);
    if (!leaderRole) {
      throw new Error(`Leader role ${config.leaderRoleId} not found`);
    }
    const leader = this.createLeaderMember(leaderRole, defaultModel, config);

    // 4. 创建 Members
    const members = this.createMembers(
      config.memberRoles,
      roleMap,
      defaultModel,
      config,
    );

    // 5. 构建团队实例
    const team = new Team(config, roleMap, workflow, leader, members);

    // 6. 注册到 TeamRegistry（如果尚未注册）
    if (!this.teamRegistry.tryGet(config.id)) {
      this.teamRegistry.register(team);
    }

    this.logger.log(
      `Team ${config.id} created with 1 leader + ${members.length} members`,
    );

    return team;
  }

  /**
   * 从团队 ID 创建实例（使用已注册的配置）
   */
  createFromId(teamId: string, options?: TeamInstantiationOptions): ITeam {
    // 先尝试获取已实例化的团队
    const existingTeam = this.teamRegistry.tryGet(teamId);
    if (existingTeam) {
      return existingTeam;
    }

    // 获取配置并实例化
    const config = this.teamRegistry.getConfig(teamId);
    return this.createFromConfig(config, options);
  }

  /**
   * 解析角色
   */
  private resolveRoles(config: TeamConfig): Map<RoleId, IRole> {
    const roleMap = new Map<RoleId, IRole>();

    // Leader 角色
    const leaderRole = this.roleRegistry.get(config.leaderRoleId);
    roleMap.set(config.leaderRoleId, leaderRole);

    // Member 角色
    for (const memberRoleConfig of config.memberRoles) {
      if (!roleMap.has(memberRoleConfig.roleId)) {
        const role = this.roleRegistry.get(memberRoleConfig.roleId);
        roleMap.set(memberRoleConfig.roleId, role);
      }
    }

    return roleMap;
  }

  /**
   * 创建工作流
   */
  private createWorkflow(config: WorkflowConfig): IWorkflow {
    return Workflow.fromConfig(config);
  }

  /**
   * 创建 Leader 成员
   */
  private createLeaderMember(
    role: IRole,
    defaultModel: string,
    teamConfig: TeamConfig,
  ): ITeamMember {
    // 创建 LLM 适配器（如果 LLMFactory 可用）
    let llmAdapter: ILeaderLLMAdapter | undefined;
    if (this.llmFactory) {
      llmAdapter = createLeaderLLMAdapter(
        this.llmFactory,
        defaultModel,
        this.stepDecomposition,
      );
    }

    // 获取可用角色列表
    const availableRoles = teamConfig.memberRoles.map((mr) => mr.roleId);

    const leaderConfig: LeaderConfig = {
      id: `${teamConfig.id}-leader`,
      name: `${teamConfig.name}-${role.name}`,
      roleId: role.id,
      model: defaultModel,
      persona: this.generateLeaderPersona(role, teamConfig),
      llmAdapter,
      availableRoles,
      goal: teamConfig.description,
    };

    return createLeader(leaderConfig, role);
  }

  /**
   * 创建 Members
   */
  private createMembers(
    memberRoleConfigs: MemberRoleConfig[],
    roleMap: Map<RoleId, IRole>,
    defaultModel: string,
    teamConfig: TeamConfig,
  ): ITeamMember[] {
    const members: ITeamMember[] = [];

    for (const roleConfig of memberRoleConfigs) {
      const role = roleMap.get(roleConfig.roleId);
      if (!role) {
        this.logger.warn(`Role ${roleConfig.roleId} not found, skipping`);
        continue;
      }

      // 创建最小数量的成员
      const count = roleConfig.minCount;
      for (let i = 0; i < count; i++) {
        const memberConfig: MemberConfig = {
          id: `${teamConfig.id}-${roleConfig.roleId}-${i + 1}`,
          name: `${role.name}-${i + 1}`,
          roleId: role.id,
          model: this.selectModelForRole(role, defaultModel),
          persona: this.generateMemberPersona(role, teamConfig),
        };

        members.push(createMember(memberConfig, role));
      }
    }

    return members;
  }

  /**
   * 为角色选择模型
   * 严禁硬编码模型名称！使用数据库配置的默认模型
   */
  private selectModelForRole(_role: IRole, defaultModel: string): string {
    // 所有角色使用统一的默认模型，从数据库配置获取
    // 严禁硬编码特定模型名称
    return defaultModel;
  }

  /**
   * 生成 Leader 人设
   */
  private generateLeaderPersona(role: IRole, teamConfig: TeamConfig): string {
    return `你是「${teamConfig.name}」团队的${role.name}。

作为团队领导，你负责：
${role.responsibilities.map((r) => `- ${r}`).join("\n")}

你的团队专注于：${teamConfig.description}

请以专业、高效的态度领导团队完成任务。`;
  }

  /**
   * 生成 Member 人设
   */
  private generateMemberPersona(role: IRole, teamConfig: TeamConfig): string {
    return `你是「${teamConfig.name}」团队的${role.name}。

你的职责：
${role.responsibilities.map((r) => `- ${r}`).join("\n")}

请发挥你的专业能力，与团队协作完成任务。`;
  }

  /**
   * 验证团队配置
   */
  validateConfig(config: TeamConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 检查 Leader 角色
    if (!this.roleRegistry.has(config.leaderRoleId)) {
      errors.push(`Leader role ${config.leaderRoleId} not found`);
    }

    // 检查 Member 角色
    for (const memberRole of config.memberRoles) {
      if (!this.roleRegistry.has(memberRole.roleId)) {
        errors.push(`Member role ${memberRole.roleId} not found`);
      }
      if (memberRole.minCount < 0) {
        errors.push(`Invalid minCount for role ${memberRole.roleId}`);
      }
      if (memberRole.maxCount < memberRole.minCount) {
        errors.push(`maxCount < minCount for role ${memberRole.roleId}`);
      }
    }

    // 检查工作流
    if (!config.workflow?.steps || config.workflow.steps.length === 0) {
      errors.push("Workflow must have at least one step");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
