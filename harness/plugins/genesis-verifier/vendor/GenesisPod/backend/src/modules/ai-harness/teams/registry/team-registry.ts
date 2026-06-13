/**
 * AI Engine - Team Registry
 * 团队注册表
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  TeamId,
  TeamConfig,
  ITeam,
  TeamType,
} from "../abstractions/team.interface";

/**
 * 团队注册表服务
 */
@Injectable()
export class TeamRegistry {
  private readonly logger = new Logger(TeamRegistry.name);
  private readonly teams = new Map<TeamId, ITeam>();
  private readonly teamConfigs = new Map<TeamId, TeamConfig>();

  /**
   * 注册团队
   */
  register(team: ITeam): void {
    if (this.teams.has(team.id)) {
      this.logger.warn(
        `Team already registered, skipping: ${team.id} (${team.name})`,
      );
      return;
    }
    this.teams.set(team.id, team);
    this.teamConfigs.set(team.id, team.config);
    this.logger.log(`Registered team: ${team.id} (${team.name})`);
  }

  /**
   * 注册团队配置（延迟实例化）
   */
  registerConfig(config: TeamConfig): void {
    if (this.teamConfigs.has(config.id)) {
      this.logger.warn(
        `Team config already registered, skipping: ${config.id} (${config.name})`,
      );
      return;
    }
    this.teamConfigs.set(config.id, config);
    this.logger.log(`Registered team config: ${config.id} (${config.name})`);
  }

  /**
   * 获取团队
   */
  get(teamId: TeamId): ITeam {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }
    return team;
  }

  /**
   * 尝试获取团队
   */
  tryGet(teamId: TeamId): ITeam | undefined {
    return this.teams.get(teamId);
  }

  /**
   * 获取团队配置
   */
  getConfig(teamId: TeamId): TeamConfig {
    const config = this.teamConfigs.get(teamId);
    if (!config) {
      throw new Error(`Team config ${teamId} not found`);
    }
    return config;
  }

  /**
   * 尝试获取团队配置
   */
  tryGetConfig(teamId: TeamId): TeamConfig | undefined {
    return this.teamConfigs.get(teamId);
  }

  /**
   * 检查团队是否存在
   */
  has(teamId: TeamId): boolean {
    return this.teams.has(teamId) || this.teamConfigs.has(teamId);
  }

  /**
   * 获取所有团队
   */
  getAll(): ITeam[] {
    return Array.from(this.teams.values());
  }

  /**
   * 获取所有团队配置
   */
  getAllConfigs(): TeamConfig[] {
    return Array.from(this.teamConfigs.values());
  }

  /**
   * 按类型获取团队
   */
  getByType(type: TeamType): ITeam[] {
    return this.getAll().filter((t) => t.type === type);
  }

  /**
   * 获取预定义团队
   */
  getPredefinedTeams(): ITeam[] {
    return this.getByType("predefined");
  }

  /**
   * 获取自定义团队
   */
  getCustomTeams(): ITeam[] {
    return this.getByType("custom");
  }

  /**
   * 注销团队
   */
  unregister(teamId: TeamId): boolean {
    const teamResult = this.teams.delete(teamId);
    const configResult = this.teamConfigs.delete(teamId);
    const result = teamResult || configResult;
    if (result) {
      this.logger.log(`Unregistered team: ${teamId}`);
    }
    return result;
  }

  /**
   * 获取注册数量
   */
  size(): number {
    return this.teamConfigs.size;
  }

  /**
   * 获取已实例化的团队数量
   */
  instanceCount(): number {
    return this.teams.size;
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.teams.clear();
    this.teamConfigs.clear();
    this.logger.log("Team registry cleared");
  }

  /**
   * 搜索团队
   */
  search(query: {
    name?: string;
    type?: TeamType;
    capability?: string;
  }): TeamConfig[] {
    return this.getAllConfigs().filter((config) => {
      if (
        query.name &&
        !config.name.toLowerCase().includes(query.name.toLowerCase())
      ) {
        return false;
      }
      if (query.type && config.type !== query.type) {
        return false;
      }
      // capability 搜索可以扩展
      return true;
    });
  }

  /**
   * 获取团队摘要
   */
  getSummary(): TeamRegistrySummary {
    const all = this.getAllConfigs();
    return {
      total: all.length,
      predefined: all.filter((t) => t.type === "predefined").length,
      custom: all.filter((t) => t.type === "custom").length,
      instantiated: this.teams.size,
    };
  }
}

/**
 * 团队注册表摘要
 */
export interface TeamRegistrySummary {
  total: number;
  predefined: number;
  custom: number;
  instantiated: number;
}
