/**
 * TeamSubFacade
 * Handles team mission orchestration.
 * Plain TypeScript class — NOT @Injectable. Instantiated by AIFacade.
 */

import { Logger } from "@nestjs/common";
import type {
  TeamsService,
  CreateMissionDto,
  MissionStatus,
} from "../../teams/services/teams.service";
import type { TeamId } from "../../teams/abstractions/team.interface";
import type { MissionEvent } from "../../agents/abstractions/mission.types";
import type {
  MissionInput,
  MissionResult,
  ProgressCallback,
  TeamType,
  TeamConfig,
} from "../types";

export class TeamSubFacade {
  private readonly logger = new Logger(TeamSubFacade.name);

  constructor(private readonly teamsService?: TeamsService) {}

  async startTeamMission(request: {
    teamType: TeamType | string;
    teamConfig?: TeamConfig;
    missionInput: MissionInput;
    progressCallback?: ProgressCallback;
  }): Promise<MissionResult> {
    if (!this.teamsService) {
      this.logger.warn("[startTeamMission] TeamsService not available");
      return {
        success: false,
        output: null,
        error: "TeamsService not available",
      };
    }

    this.logger.debug(
      `[startTeamMission] teamType=${request.teamType}, goal="${request.missionInput.goal}"`,
    );

    const teamId = this.mapTeamTypeToId(request.teamType);

    const createDto: CreateMissionDto = {
      teamId,
      goal: request.missionInput.goal,
      context: request.missionInput.context,
      userId: request.missionInput.userId,
      sessionId: request.missionInput.sessionId,
      metadata: request.missionInput.metadata,
    };

    try {
      const missionId = await this.teamsService.executeMission(createDto);

      const result = await this.waitForMissionCompletion(
        missionId,
        request.progressCallback,
      );

      return result;
    } catch (error) {
      this.logger.error(`[startTeamMission] Failed: ${error}`);
      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async *executeMissionStream(
    dto: CreateMissionDto,
  ): AsyncGenerator<MissionEvent> {
    if (!this.teamsService) {
      this.logger.warn("[executeMissionStream] TeamsService not available");
      return;
    }
    yield* this.teamsService.executeMissionStream(dto);
  }

  cancelMission(missionId: string): boolean {
    if (!this.teamsService) {
      this.logger.warn("[cancelMission] TeamsService not available");
      return false;
    }

    this.logger.debug(`[cancelMission] missionId=${missionId}`);
    return this.teamsService.cancelMission(missionId);
  }

  getMissionStatus(missionId: string): MissionStatus | null {
    if (!this.teamsService) {
      return null;
    }

    return this.teamsService.getMissionStatus(missionId);
  }

  private async waitForMissionCompletion(
    missionId: string,
    progressCallback?: ProgressCallback,
    timeoutMs: number = 300000,
    pollIntervalMs: number = 1000,
  ): Promise<MissionResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = this.getMissionStatus(missionId);

      if (!status) {
        return {
          success: false,
          output: null,
          error: `Mission ${missionId} not found`,
        };
      }

      if (progressCallback) {
        progressCallback({
          missionId,
          phase: status.currentPhase || status.status,
          progress: status.progress,
          message: `Status: ${status.status}`,
        });
      }

      if (status.status === "completed") {
        return {
          success: true,
          output: { missionId, status: "completed" },
          summary: "Mission completed successfully",
          executionTime: Date.now() - startTime,
        };
      }

      if (status.status === "failed") {
        return {
          success: false,
          output: null,
          error: status.error || "Mission failed",
          executionTime: Date.now() - startTime,
        };
      }

      if (status.status === "cancelled") {
        return {
          success: false,
          output: null,
          error: "Mission was cancelled",
          executionTime: Date.now() - startTime,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return {
      success: false,
      output: null,
      error: `Mission ${missionId} timed out after ${timeoutMs}ms`,
      executionTime: timeoutMs,
    };
  }

  private mapTeamTypeToId(teamType: TeamType | string): TeamId {
    const mapping: Record<string, TeamId> = {
      research: "research-team",
      debate: "debate-team",
      review: "review-team",
      report: "report-team",
    };
    return mapping[teamType] || teamType;
  }
}
