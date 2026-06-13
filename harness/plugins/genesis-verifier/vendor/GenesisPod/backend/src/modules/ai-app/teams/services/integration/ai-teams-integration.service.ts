/**
 * AI Teams Integration Service
 * AI Teams 与 AI Engine 整合服务
 *
 * 职责：
 * - 自定义团队管理（通过 AI Engine TeamsService）
 * - 角色管理（通过 AI Engine RoleRegistry）
 * - 团队配置管理（通过 AI Engine TeamRegistry）
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  TeamFacade,
  TeamRegistry,
  RoleRegistry,
} from "@/modules/ai-harness/facade";
import type {
  TeamInfo,
  TeamConfig,
  ConstraintProfile,
  WorkflowConfig,
} from "@/modules/ai-harness/facade";
import {
  CreateCustomTeamDto,
  UpdateCustomTeamDto,
  ConstraintConfigDto,
} from "../../dto/create-custom-team.dto";

@Injectable()
export class AiTeamsIntegrationService {
  private readonly logger = new Logger(AiTeamsIntegrationService.name);

  /** 自定义团队 ID 前缀 */
  private static readonly CUSTOM_TEAM_PREFIX = "custom-";

  constructor(
    @Optional() private readonly teamFacade?: TeamFacade,
    @Optional() private readonly teamRegistry?: TeamRegistry,
    @Optional() private readonly roleRegistry?: RoleRegistry,
  ) {}

  // ==================== Custom Team Management ====================

  /**
   * 获取所有可用团队（预定义 + 自定义）
   */
  listAllTeams(): TeamInfo[] {
    if (!this.teamFacade?.teams) {
      this.logger.warn("[listAllTeams] TeamsService not available");
      return [];
    }
    return this.teamFacade.teams.listTeams();
  }

  /**
   * 获取可用的角色列表
   */
  listAvailableRoles(): Array<{
    id: string;
    name: string;
    type: string;
    description: string;
  }> {
    if (!this.roleRegistry) {
      this.logger.warn("[listAvailableRoles] RoleRegistry not available");
      return [];
    }

    return this.roleRegistry.getAll().map((role) => ({
      id: role.id,
      name: role.name,
      type: role.type,
      description: role.description,
    }));
  }

  /**
   * 创建自定义团队
   */
  createCustomTeam(dto: CreateCustomTeamDto): TeamInfo {
    if (!this.teamRegistry || !this.roleRegistry || !this.teamFacade?.teams) {
      throw new Error(
        "TeamsService not available - AI Engine Teams module not loaded",
      );
    }

    // 验证 Leader 角色存在
    if (!this.roleRegistry.has(dto.leaderRoleId)) {
      throw new Error(`Leader role "${dto.leaderRoleId}" not found`);
    }

    // 验证 Member 角色存在
    for (const memberRole of dto.memberRoles) {
      if (!this.roleRegistry.has(memberRole.roleId)) {
        throw new Error(`Member role "${memberRole.roleId}" not found`);
      }
    }

    // 生成唯一 ID
    const teamId = `${AiTeamsIntegrationService.CUSTOM_TEAM_PREFIX}${Date.now()}`;

    // 构建工作流配置
    const workflow: WorkflowConfig = dto.workflow
      ? {
          id: dto.workflow.id || `${teamId}-workflow`,
          name: dto.workflow.name || `${dto.name} Workflow`,
          type: dto.workflow.type || "sequential",
          steps: dto.workflow.steps.map((step) => ({
            id: step.id,
            name: step.name,
            description: step.description,
            type: step.type,
            executorRoles: step.executorRoles,
            parallel: step.parallel,
            dependsOn: step.dependsOn,
            timeout: step.timeout,
          })),
        }
      : this.createDefaultWorkflow(teamId, dto.name, dto.memberRoles);

    // 构建约束配置
    const constraintProfile = this.buildConstraintProfile(dto.constraints);

    // 构建团队配置
    const teamConfig: TeamConfig = {
      id: teamId,
      name: dto.name,
      description: dto.description || "",
      type: "custom",
      icon: dto.icon,
      color: dto.color,
      leaderRoleId: dto.leaderRoleId,
      memberRoles: dto.memberRoles.map((mr) => ({
        roleId: mr.roleId,
        minCount: mr.minCount,
        maxCount: mr.maxCount,
        required: mr.required ?? true,
      })),
      workflow,
      availableSkills: dto.availableSkills || [],
      availableTools: dto.availableTools || [],
      constraintProfile,
      deliverableTypes: dto.deliverableTypes || ["report", "analysis"],
    };

    // 注册团队配置
    this.teamRegistry.registerConfig(teamConfig);

    this.logger.log(
      `[createCustomTeam] Created custom team: ${teamId} (${dto.name})`,
    );

    return this.teamFacade.teams.getTeam(teamId);
  }

  /**
   * 更新自定义团队
   */
  updateCustomTeam(teamId: string, dto: UpdateCustomTeamDto): TeamInfo {
    if (!this.teamRegistry || !this.teamFacade?.teams) {
      throw new Error("TeamsService not available");
    }

    // 验证是自定义团队
    if (!teamId.startsWith(AiTeamsIntegrationService.CUSTOM_TEAM_PREFIX)) {
      throw new Error("Cannot update predefined teams");
    }

    // 获取现有配置
    const existingConfig = this.teamRegistry.getConfig(teamId);
    if (!existingConfig) {
      throw new Error(`Team "${teamId}" not found`);
    }

    // 合并更新
    const updatedConfig: TeamConfig = {
      ...existingConfig,
      name: dto.name ?? existingConfig.name,
      description: dto.description ?? existingConfig.description,
      icon: dto.icon ?? existingConfig.icon,
      color: dto.color ?? existingConfig.color,
      memberRoles: dto.memberRoles
        ? dto.memberRoles.map((mr) => ({
            roleId: mr.roleId,
            minCount: mr.minCount,
            maxCount: mr.maxCount,
            required: mr.required ?? true,
          }))
        : existingConfig.memberRoles,
      workflow: dto.workflow
        ? {
            id: dto.workflow.id || existingConfig.workflow.id,
            name: dto.workflow.name || existingConfig.workflow.name,
            type: dto.workflow.type || existingConfig.workflow.type,
            steps: dto.workflow.steps.map((step) => ({
              id: step.id,
              name: step.name,
              description: step.description,
              type: step.type,
              executorRoles: step.executorRoles,
              parallel: step.parallel,
              dependsOn: step.dependsOn,
              timeout: step.timeout,
            })),
          }
        : existingConfig.workflow,
      availableSkills: dto.availableSkills ?? existingConfig.availableSkills,
      availableTools: dto.availableTools ?? existingConfig.availableTools,
      constraintProfile: dto.constraints
        ? this.buildConstraintProfile(dto.constraints)
        : existingConfig.constraintProfile,
    };

    // 更新配置（需要先删除再注册）
    this.teamRegistry.unregister(teamId);
    this.teamRegistry.registerConfig(updatedConfig);

    this.logger.log(`[updateCustomTeam] Updated custom team: ${teamId}`);

    return this.teamFacade.teams.getTeam(teamId);
  }

  /**
   * 删除自定义团队
   */
  deleteCustomTeam(teamId: string): boolean {
    if (!this.teamRegistry) {
      throw new Error("TeamsService not available");
    }

    // 验证是自定义团队
    if (!teamId.startsWith(AiTeamsIntegrationService.CUSTOM_TEAM_PREFIX)) {
      throw new Error("Cannot delete predefined teams");
    }

    // 检查团队是否存在
    if (!this.teamRegistry.has(teamId)) {
      throw new Error(`Team "${teamId}" not found`);
    }

    this.teamRegistry.unregister(teamId);

    this.logger.log(`[deleteCustomTeam] Deleted custom team: ${teamId}`);

    return true;
  }

  /**
   * 获取自定义团队列表
   */
  listCustomTeams(): TeamInfo[] {
    if (!this.teamFacade?.teams) {
      return [];
    }

    return this.teamFacade.teams
      .listTeams()
      .filter((team) => team.type === "custom");
  }

  /**
   * 获取团队详情
   */
  getTeamById(teamId: string): TeamInfo | null {
    if (!this.teamFacade?.teams) {
      return null;
    }

    try {
      return this.teamFacade.teams.getTeam(teamId);
    } catch {
      return null;
    }
  }

  /**
   * 创建默认工作流
   */
  private createDefaultWorkflow(
    teamId: string,
    teamName: string,
    memberRoles: Array<{ roleId: string }>,
  ): WorkflowConfig {
    // 提取角色用于执行
    const executorRoles = memberRoles.map((mr) => mr.roleId);

    return {
      id: `${teamId}-workflow`,
      name: `${teamName} Default Workflow`,
      type: "sequential",
      steps: [
        {
          id: "analyze",
          name: "分析任务",
          type: "task",
          executorRoles: executorRoles.slice(0, 1),
        },
        {
          id: "execute",
          name: "执行任务",
          type: "task",
          executorRoles,
          dependsOn: ["analyze"],
        },
        {
          id: "review",
          name: "审核结果",
          type: "review",
          executorRoles: executorRoles.slice(0, 1),
          dependsOn: ["execute"],
        },
      ],
    };
  }

  /**
   * 构建约束配置
   */
  private buildConstraintProfile(
    constraints?: ConstraintConfigDto,
  ): ConstraintProfile {
    const depthDurationMap: Record<string, number> = {
      quick: 60000,
      standard: 300000,
      comprehensive: 900000,
    };

    const depth = constraints?.depth || "standard";

    return {
      cost: {
        budget: constraints?.budget ?? 10,
        modelPreference:
          (constraints?.modelPreference as "cheap" | "balanced" | "premium") ||
          "balanced",
        allowOverBudget: false,
        warningThreshold: 0.8,
      },
      quality: {
        depth: depth as "quick" | "standard" | "comprehensive",
        accuracy: "prefer_evidence",
        reviewRequired: constraints?.reviewRequired ?? true,
        minReviewScore: 7,
        maxReworks: constraints?.maxReworks ?? 2,
      },
      efficiency: {
        maxDuration:
          constraints?.maxDuration ?? depthDurationMap[depth] ?? 300000,
        priority: "normal",
        allowParallel: true,
        maxParallelism: 3,
      },
    };
  }
}
