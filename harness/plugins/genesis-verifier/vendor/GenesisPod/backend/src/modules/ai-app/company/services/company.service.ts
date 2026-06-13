/**
 * CompanyService — business logic for the "一人公司 OS".
 *
 * Responsibilities:
 *   - getCompany(): aggregate snapshot (profile + hired + teams + workflows);
 *                   auto-creates an empty CompanyProfile if one doesn't exist yet.
 *   - hire():       look up a marketplace listing via MarketplaceCatalogService
 *                   then persist a CompanyHiredAgent row.
 *   - All other operations delegate to CompanyRepository after ownership checks.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { CompanyRepository } from "./company.repository";
import { MarketplaceCatalogService } from "@/modules/ai-app/marketplace/catalog/marketplace-catalog.service";
import type {
  CompanyProfile,
  CompanyHiredAgent,
  CompanyTeamWithMembers,
  CompanyWorkflow,
} from "./company.repository";
import type {
  UpdateHiredAgentDto,
  UpdateTeamDto,
  UpdateWorkflowDto,
} from "../api/dto/company.dto";

// ─── snapshot shape ────────────────────────────────────────────────────────────

export interface CompanySnapshot {
  profile: CompanyProfile;
  hired: CompanyHiredAgent[];
  teams: CompanyTeamWithMembers[];
  workflows: CompanyWorkflow[];
}

// ─── service ──────────────────────────────────────────────────────────────────

@Injectable()
export class CompanyService {
  constructor(
    private readonly repo: CompanyRepository,
    private readonly catalogService: MarketplaceCatalogService,
  ) {}

  // ── snapshot ────────────────────────────────────────────────────────────────

  async getCompany(userId: string): Promise<CompanySnapshot> {
    let profile = await this.repo.findProfile(userId);
    if (!profile) {
      profile = await this.repo.upsertProfile(userId, { name: "My Company" });
    }

    const [hired, teams, workflows] = await Promise.all([
      this.repo.findAllHired(userId),
      this.repo.findAllTeams(userId),
      this.repo.findAllWorkflows(userId),
    ]);

    return { profile, hired, teams, workflows };
  }

  // ── hire ────────────────────────────────────────────────────────────────────

  async hire(userId: string, listingId: string): Promise<CompanyHiredAgent> {
    const agents = this.catalogService.getAgents();
    const listing = agents.find((a) => a.id === listingId);
    if (!listing) {
      throw new NotFoundException(
        `Agent listing "${listingId}" not found in marketplace catalog`,
      );
    }

    return this.repo.createHired({
      userId,
      listingId,
      name: listing.name,
      role: listing.role,
      models: [],
      autoFallback: true,
      skillIds: listing.skillIds ?? [],
      toolIds: listing.toolIds ?? [],
    });
  }

  // ── hired agent CRUD ────────────────────────────────────────────────────────

  async updateHired(
    userId: string,
    id: string,
    dto: UpdateHiredAgentDto,
  ): Promise<CompanyHiredAgent> {
    const updated = await this.repo.updateHired(id, userId, dto);
    if (!updated) {
      throw new NotFoundException(`HiredAgent "${id}" not found`);
    }
    return updated;
  }

  async deleteHired(userId: string, id: string): Promise<void> {
    const deleted = await this.repo.deleteHired(id, userId);
    if (!deleted) {
      throw new NotFoundException(`HiredAgent "${id}" not found`);
    }
  }

  // ── CEO ─────────────────────────────────────────────────────────────────────

  async setCeo(
    userId: string,
    hiredAgentId: string | null,
  ): Promise<CompanyProfile> {
    if (hiredAgentId !== null) {
      const agent = await this.repo.findHiredById(hiredAgentId, userId);
      if (!agent) {
        throw new NotFoundException(`HiredAgent "${hiredAgentId}" not found`);
      }
    }
    return this.repo.setCeo(userId, hiredAgentId);
  }

  // ── teams ────────────────────────────────────────────────────────────────────

  async createTeam(
    userId: string,
    name: string,
  ): Promise<CompanyTeamWithMembers> {
    return this.repo.createTeam(userId, name);
  }

  async updateTeam(
    userId: string,
    id: string,
    dto: UpdateTeamDto,
  ): Promise<CompanyTeamWithMembers> {
    const updated = await this.repo.updateTeam(id, userId, dto);
    if (!updated) {
      throw new NotFoundException(`Team "${id}" not found`);
    }
    return updated;
  }

  async deleteTeam(userId: string, id: string): Promise<void> {
    const deleted = await this.repo.deleteTeam(id, userId);
    if (!deleted) {
      throw new NotFoundException(`Team "${id}" not found`);
    }
  }

  async addTeamMember(
    userId: string,
    teamId: string,
    hiredAgentId: string,
  ): Promise<CompanyTeamWithMembers> {
    const team = await this.repo.findTeamById(teamId, userId);
    if (!team) {
      throw new NotFoundException(`Team "${teamId}" not found`);
    }
    const agent = await this.repo.findHiredById(hiredAgentId, userId);
    if (!agent) {
      throw new NotFoundException(`HiredAgent "${hiredAgentId}" not found`);
    }
    await this.repo.addTeamMember(teamId, hiredAgentId);
    const refreshed = await this.repo.findTeamById(teamId, userId);
    return refreshed!;
  }

  async removeTeamMember(
    userId: string,
    teamId: string,
    hiredAgentId: string,
  ): Promise<CompanyTeamWithMembers> {
    const team = await this.repo.findTeamById(teamId, userId);
    if (!team) {
      throw new NotFoundException(`Team "${teamId}" not found`);
    }
    await this.repo.removeTeamMember(teamId, hiredAgentId);
    const refreshed = await this.repo.findTeamById(teamId, userId);
    return refreshed!;
  }

  async setTeamLeader(
    userId: string,
    teamId: string,
    hiredAgentId: string,
  ): Promise<CompanyTeamWithMembers> {
    const team = await this.repo.findTeamById(teamId, userId);
    if (!team) {
      throw new NotFoundException(`Team "${teamId}" not found`);
    }
    const agent = await this.repo.findHiredById(hiredAgentId, userId);
    if (!agent) {
      throw new NotFoundException(`HiredAgent "${hiredAgentId}" not found`);
    }
    const updated = await this.repo.updateTeam(teamId, userId, {
      leaderId: hiredAgentId,
    });
    return updated!;
  }

  async setTeamWorkflow(
    userId: string,
    teamId: string,
    workflowId: string | null,
  ): Promise<CompanyTeamWithMembers> {
    const team = await this.repo.findTeamById(teamId, userId);
    if (!team) {
      throw new NotFoundException(`Team "${teamId}" not found`);
    }
    if (workflowId !== null) {
      const wf = await this.repo.findWorkflowById(workflowId, userId);
      if (!wf) {
        throw new NotFoundException(`Workflow "${workflowId}" not found`);
      }
    }
    const updated = await this.repo.updateTeam(teamId, userId, {
      workflowId,
    });
    return updated!;
  }

  // ── workflows ────────────────────────────────────────────────────────────────

  async createCustomWorkflow(userId: string): Promise<CompanyWorkflow> {
    return this.repo.createWorkflow({
      userId,
      name: "新工作流",
      category: "自建",
      stages: ["规划", "执行", "评审"],
      teamSize: 3,
      roles: ["Leader", "成员"],
      origin: "custom",
    });
  }

  /**
   * 一键成军：从工作流模板（如「深度研究」）实例化一个**满编**团队。
   *
   * 一队一工作流模型：建队 → 获取并挂上该工作流 → 按工作流角色名册雇齐对应的沉淀
   * Agent（自带 skills/tools）→ 加为成员 → 点一个 Leader。落到「我的团队」，可个性化。
   *
   * 角色名册解析：把工作流的 roles 与沉淀 Agent（category=「深度研究团队」）按 role 匹配；
   * Leader 角色当前无独立沉淀 Agent → 取首个成员兜底为 Leader。
   */
  async instantiateTeamFromWorkflow(
    userId: string,
    workflowListingId: string,
    name?: string,
  ): Promise<CompanyTeamWithMembers> {
    const workflows = this.catalogService.getWorkflows();
    const wfListing = workflows.find((w) => w.id === workflowListingId);
    if (!wfListing) {
      throw new NotFoundException(
        `Workflow listing "${workflowListingId}" not found in marketplace catalog`,
      );
    }

    // 名册：工作流 roles → 沉淀 Agent（按 role 匹配，去重保序）
    const sedimented = this.catalogService
      .getAgents()
      .filter((a) => a.category === "深度研究团队");
    const byRole = new Map(sedimented.map((a) => [a.role, a]));
    const roster: typeof sedimented = [];
    const seen = new Set<string>();
    for (const role of wfListing.roles) {
      const ag = byRole.get(role);
      if (ag && !seen.has(ag.id)) {
        roster.push(ag);
        seen.add(ag.id);
      }
    }
    // 名册解析不出（角色名不匹配等）→ 兜底用全部沉淀 Agent
    if (roster.length === 0) roster.push(...sedimented);

    // 1. 建队
    const team = await this.repo.createTeam(
      userId,
      name?.trim() || `${wfListing.name}小组`,
    );

    // 2. 获取工作流到公司库 + 挂到团队
    const wf = await this.acquireWorkflow(userId, workflowListingId);
    await this.repo.updateTeam(team.id, userId, { workflowId: wf.id });

    // 3. 雇齐名册 + 加为成员（Agent 自带 skills/tools）
    let leaderHiredId: string | null = null;
    for (const ag of roster) {
      const hired = await this.hire(userId, ag.id);
      await this.repo.addTeamMember(team.id, hired.id);
      if (!leaderHiredId) leaderHiredId = hired.id;
    }

    // 4. 点将 Leader（首个成员兜底）
    if (leaderHiredId) {
      await this.repo.updateTeam(team.id, userId, { leaderId: leaderHiredId });
    }

    const refreshed = await this.repo.findTeamById(team.id, userId);
    return refreshed!;
  }

  async acquireWorkflow(
    userId: string,
    sourceListingId: string,
  ): Promise<CompanyWorkflow> {
    const workflows = this.catalogService.getWorkflows();
    const listing = workflows.find((w) => w.id === sourceListingId);
    if (!listing) {
      throw new NotFoundException(
        `Workflow listing "${sourceListingId}" not found in marketplace catalog`,
      );
    }

    // 去重：同一用户对同一市场工作流只保留一条副本。原先无条件 create，
    // instantiateTeam / 重复点击会反复堆积（线上出现 10 条同名「深度洞察研究」）。
    const existing = await this.repo.findWorkflowBySourceListing(
      userId,
      sourceListingId,
    );
    if (existing) return existing;

    return this.repo.createWorkflow({
      userId,
      name: listing.name,
      category: listing.category,
      stages: listing.stages,
      teamSize: listing.teamSize,
      roles: listing.roles,
      origin: "marketplace",
      sourceListingId,
    });
  }

  async updateWorkflow(
    userId: string,
    id: string,
    dto: UpdateWorkflowDto,
  ): Promise<CompanyWorkflow> {
    const updated = await this.repo.updateWorkflow(id, userId, dto);
    if (!updated) {
      throw new NotFoundException(`Workflow "${id}" not found`);
    }
    return updated;
  }

  async deleteWorkflow(userId: string, id: string): Promise<void> {
    const deleted = await this.repo.deleteWorkflow(id, userId);
    if (!deleted) {
      throw new NotFoundException(`Workflow "${id}" not found`);
    }
  }
}
