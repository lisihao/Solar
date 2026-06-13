/**
 * CompanyRepository — data-access layer for the 5 Company OS models.
 *
 * All queries are userId-scoped (no cross-user leakage).
 */

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import type {
  CompanyProfile,
  CompanyHiredAgent,
  CompanyTeam,
  CompanyTeamMember,
  CompanyWorkflow,
} from "@prisma/client";

// ─── re-export convenience types ─────────────────────────────────────────────

export type { CompanyProfile, CompanyHiredAgent, CompanyTeam, CompanyWorkflow };

export interface CompanyTeamWithMembers extends CompanyTeam {
  members: CompanyTeamMember[];
}

/** Member with hydrated agent record — for mission execution only. */
export interface CompanyTeamMemberWithAgent {
  memberId: string;
  hiredAgentId: string;
  hiredAgent: CompanyHiredAgent;
}

/** Team with fully-hydrated member agents + optional workflow — used by mission execution. */
export interface CompanyTeamForMission {
  id: string;
  userId: string;
  name: string;
  leaderId: string | null;
  workflowId: string | null;
  members: CompanyTeamMemberWithAgent[];
  workflow: CompanyWorkflow | null;
}

// ─── input shapes ─────────────────────────────────────────────────────────────

export interface CreateHiredAgentInput {
  userId: string;
  listingId: string;
  name: string;
  role: string;
  models: string[];
  autoFallback: boolean;
  skillIds: string[];
  toolIds: string[];
}

export interface UpdateHiredAgentInput {
  models?: string[];
  autoFallback?: boolean;
  skillIds?: string[];
  toolIds?: string[];
}

export interface CreateWorkflowInput {
  userId: string;
  name: string;
  category: string;
  stages: string[];
  teamSize: number;
  roles: string[];
  origin: string;
  sourceListingId?: string;
}

export interface UpdateWorkflowInput {
  name?: string;
  stages?: string[];
  teamSize?: number;
  roles?: string[];
  category?: string;
}

// ─── repository ───────────────────────────────────────────────────────────────

@Injectable()
export class CompanyRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── CompanyProfile ──────────────────────────────────────────────────────────

  async findProfile(userId: string): Promise<CompanyProfile | null> {
    return this.prisma.companyProfile.findUnique({ where: { userId } });
  }

  async upsertProfile(
    userId: string,
    data: Partial<Pick<CompanyProfile, "name" | "ceoHiredAgentId">>,
  ): Promise<CompanyProfile> {
    return this.prisma.companyProfile.upsert({
      where: { userId },
      create: { userId, name: data.name ?? "My Company", ...data },
      update: data,
    });
  }

  async setCeo(
    userId: string,
    ceoHiredAgentId: string | null,
  ): Promise<CompanyProfile> {
    return this.prisma.companyProfile.upsert({
      where: { userId },
      create: { userId, name: "My Company", ceoHiredAgentId },
      update: { ceoHiredAgentId },
    });
  }

  // ── CompanyHiredAgent ───────────────────────────────────────────────────────

  async findAllHired(userId: string): Promise<CompanyHiredAgent[]> {
    return this.prisma.companyHiredAgent.findMany({ where: { userId } });
  }

  async findHiredById(
    id: string,
    userId: string,
  ): Promise<CompanyHiredAgent | null> {
    return this.prisma.companyHiredAgent.findFirst({ where: { id, userId } });
  }

  async createHired(input: CreateHiredAgentInput): Promise<CompanyHiredAgent> {
    return this.prisma.companyHiredAgent.create({ data: input });
  }

  async updateHired(
    id: string,
    userId: string,
    data: UpdateHiredAgentInput,
  ): Promise<CompanyHiredAgent | null> {
    const existing = await this.findHiredById(id, userId);
    if (!existing) return null;
    return this.prisma.companyHiredAgent.update({ where: { id }, data });
  }

  async deleteHired(id: string, userId: string): Promise<boolean> {
    const existing = await this.findHiredById(id, userId);
    if (!existing) return false;
    // companyTeamMember.hiredAgentId 是松散字符串（无 FK 级联），必须手动清理，
    // 否则解雇 Agent 后团队留下孤儿成员行 → 成员数虚高、组织架构悬空。
    await this.prisma.$transaction([
      this.prisma.companyTeamMember.deleteMany({ where: { hiredAgentId: id } }),
      this.prisma.companyTeam.updateMany({
        where: { userId, leaderId: id },
        data: { leaderId: null },
      }),
      this.prisma.companyProfile.updateMany({
        where: { userId, ceoHiredAgentId: id },
        data: { ceoHiredAgentId: null },
      }),
      this.prisma.companyHiredAgent.delete({ where: { id } }),
    ]);
    return true;
  }

  // ── CompanyTeam ─────────────────────────────────────────────────────────────

  async findAllTeams(userId: string): Promise<CompanyTeamWithMembers[]> {
    return this.prisma.companyTeam.findMany({
      where: { userId },
      include: { members: true },
    });
  }

  async findTeamById(
    id: string,
    userId: string,
  ): Promise<CompanyTeamWithMembers | null> {
    return this.prisma.companyTeam.findFirst({
      where: { id, userId },
      include: { members: true },
    });
  }

  /**
   * findTeamForMission — read-only, hydrates each member's HiredAgent record + optional workflow.
   * Used exclusively by CompanyMissionService.runMission.
   */
  async findTeamForMission(
    teamId: string | null,
    userId: string,
  ): Promise<CompanyTeamForMission | null> {
    if (!teamId) return null;
    const team = await this.prisma.companyTeam.findFirst({
      where: { id: teamId, userId },
      include: { members: true },
    });
    if (!team) return null;

    // Hydrate each member's HiredAgent in one query
    const agentIds = team.members.map((m) => m.hiredAgentId);
    const agents = await this.prisma.companyHiredAgent.findMany({
      where: { id: { in: agentIds }, userId },
    });
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    const membersWithAgents: CompanyTeamMemberWithAgent[] = team.members
      .map((m) => {
        const agent = agentMap.get(m.hiredAgentId);
        if (!agent) return null;
        return {
          memberId: m.id,
          hiredAgentId: m.hiredAgentId,
          hiredAgent: agent,
        };
      })
      .filter((m): m is CompanyTeamMemberWithAgent => m !== null);

    const workflow = team.workflowId
      ? await this.prisma.companyWorkflow.findFirst({
          where: { id: team.workflowId, userId },
        })
      : null;

    return {
      id: team.id,
      userId: team.userId,
      name: team.name,
      leaderId: team.leaderId,
      workflowId: team.workflowId,
      members: membersWithAgents,
      workflow,
    };
  }

  async createTeam(
    userId: string,
    name: string,
  ): Promise<CompanyTeamWithMembers> {
    return this.prisma.companyTeam.create({
      data: { userId, name },
      include: { members: true },
    });
  }

  async updateTeam(
    id: string,
    userId: string,
    data: Partial<Pick<CompanyTeam, "name" | "leaderId" | "workflowId">>,
  ): Promise<CompanyTeamWithMembers | null> {
    const existing = await this.findTeamById(id, userId);
    if (!existing) return null;
    return this.prisma.companyTeam.update({
      where: { id },
      data,
      include: { members: true },
    });
  }

  async deleteTeam(id: string, userId: string): Promise<boolean> {
    const existing = await this.findTeamById(id, userId);
    if (!existing) return false;
    await this.prisma.companyTeam.delete({ where: { id } });
    return true;
  }

  // ── CompanyTeamMember ───────────────────────────────────────────────────────

  async addTeamMember(
    teamId: string,
    hiredAgentId: string,
  ): Promise<CompanyTeamMember> {
    return this.prisma.companyTeamMember.upsert({
      where: { teamId_hiredAgentId: { teamId, hiredAgentId } },
      create: { teamId, hiredAgentId },
      update: {},
    });
  }

  async removeTeamMember(
    teamId: string,
    hiredAgentId: string,
  ): Promise<boolean> {
    const existing = await this.prisma.companyTeamMember.findUnique({
      where: { teamId_hiredAgentId: { teamId, hiredAgentId } },
    });
    if (!existing) return false;
    await this.prisma.companyTeamMember.delete({
      where: { teamId_hiredAgentId: { teamId, hiredAgentId } },
    });
    return true;
  }

  // ── CompanyWorkflow ─────────────────────────────────────────────────────────

  async findAllWorkflows(userId: string): Promise<CompanyWorkflow[]> {
    return this.prisma.companyWorkflow.findMany({ where: { userId } });
  }

  async findWorkflowById(
    id: string,
    userId: string,
  ): Promise<CompanyWorkflow | null> {
    return this.prisma.companyWorkflow.findFirst({ where: { id, userId } });
  }

  /**
   * 按 (userId, sourceListingId) 查已有市场工作流副本（取最早一条），用于 acquire 去重。
   * sourceListingId 为空的自建工作流不走此路径。
   */
  async findWorkflowBySourceListing(
    userId: string,
    sourceListingId: string,
  ): Promise<CompanyWorkflow | null> {
    return this.prisma.companyWorkflow.findFirst({
      where: { userId, sourceListingId },
      orderBy: { createdAt: "asc" },
    });
  }

  async createWorkflow(input: CreateWorkflowInput): Promise<CompanyWorkflow> {
    return this.prisma.companyWorkflow.create({ data: input });
  }

  async updateWorkflow(
    id: string,
    userId: string,
    data: UpdateWorkflowInput,
  ): Promise<CompanyWorkflow | null> {
    const existing = await this.findWorkflowById(id, userId);
    if (!existing) return null;
    return this.prisma.companyWorkflow.update({ where: { id }, data });
  }

  async deleteWorkflow(id: string, userId: string): Promise<boolean> {
    const existing = await this.findWorkflowById(id, userId);
    if (!existing) return false;
    await this.prisma.companyWorkflow.delete({ where: { id } });
    return true;
  }
}
