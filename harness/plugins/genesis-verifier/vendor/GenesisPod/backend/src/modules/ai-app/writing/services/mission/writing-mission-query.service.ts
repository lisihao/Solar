/**
 * Writing Mission Query Service
 *
 * Handles all read-only queries for writing missions:
 * - Project missions list
 * - Mission status
 * - Latest mission
 * - Mission logs
 *
 * Extracted from WritingMissionService (god service).
 * Follows Topic Insights' MissionQueryService pattern.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { TeamFacade } from "@/modules/ai-harness/facade";

@Injectable()
export class WritingMissionQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamFacade: TeamFacade,
  ) {}

  /**
   * Get all missions for a project
   */
  async getProjectMissions(
    projectId: string,
    status?: string,
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const where: Record<string, unknown> = { projectId };
    if (status) {
      where.status = status.toUpperCase();
    }

    const [missions, total] = await Promise.all([
      this.prisma.writingMission.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      this.prisma.writingMission.count({ where }),
    ]);

    return {
      items: missions.map((m) => ({
        id: m.id,
        projectId: m.projectId,
        missionType: m.missionType,
        status: m.status,
        createdAt: m.createdAt,
        startedAt: m.startedAt,
        completedAt: m.completedAt,
        result: m.result,
        progress:
          (typeof (m.result as Record<string, unknown>)?.progress === "number"
            ? (m.result as Record<string, unknown>).progress
            : undefined) || 0,
        currentStep:
          (typeof (m.result as Record<string, unknown>)?.currentStep ===
          "string"
            ? (m.result as Record<string, unknown>).currentStep
            : undefined) || "",
      })),
      total,
    };
  }

  /**
   * Get mission status with orchestrator state
   */
  async getMissionStatus(missionId: string, userId: string) {
    const mission = await this.prisma.writingMission.findUnique({
      where: { id: missionId },
      include: {
        project: { select: { ownerId: true } },
      },
    });

    if (!mission) {
      throw new NotFoundException("Mission not found");
    }

    if (mission.project.ownerId !== userId) {
      throw new NotFoundException("Mission not found");
    }

    // Get orchestrator state
    const orchestratorState =
      this.teamFacade.missionOrchestrator?.getState(missionId);

    return {
      id: mission.id,
      status: mission.status,
      missionType: mission.missionType,
      startedAt: mission.startedAt,
      completedAt: mission.completedAt,
      result: mission.result,
      orchestratorState: orchestratorState
        ? {
            phase: orchestratorState.phase,
            completedSteps: orchestratorState.completedSteps,
            currentSteps: orchestratorState.currentSteps,
            progress: orchestratorState.resourceUsage.progress,
            tokensUsed: orchestratorState.resourceUsage.tokensUsed,
            costUsed: orchestratorState.resourceUsage.costUsed,
          }
        : null,
    };
  }

  /**
   * Get the latest mission for a project
   */
  async getLatestMission(projectId: string) {
    return this.prisma.writingMission.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        missionType: true,
        createdAt: true,
      },
    });
  }

  /**
   * Get mission logs (interaction messages)
   */
  async getMissionLogs(
    missionId: string,
    userId: string,
    limit?: number,
    offset?: number,
  ) {
    const mission = await this.prisma.writingMission.findUnique({
      where: { id: missionId },
      include: {
        project: { select: { ownerId: true } },
      },
    });

    if (!mission) {
      throw new NotFoundException("Mission not found");
    }

    if (mission.project.ownerId !== userId) {
      throw new NotFoundException("Mission not found");
    }

    const total = await this.prisma.writingMissionLog.count({
      where: { missionId },
    });

    const logs = await this.prisma.writingMissionLog.findMany({
      where: { missionId },
      orderBy: { createdAt: "asc" },
      take: limit || 500,
      skip: offset || 0,
    });

    return {
      items: logs.map((log) => ({
        id: log.id,
        eventType: log.eventType,
        agentId: log.agentId,
        agentName: log.agentName,
        content: log.content,
        detail: log.detail,
        createdAt: log.createdAt,
      })),
      total,
    };
  }
}
