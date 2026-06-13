import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { DimensionStatus } from "@prisma/client";
import { ResearchEventEmitterService } from "../core/research/research-event-emitter.service";

export interface MissionProgress {
  stage:
    | "planning"
    | "writing"
    | "reviewing"
    | "integrating"
    | "completed"
    | "failed";
  sectionsTotal: number;
  sectionsCompleted: number;
  currentSection?: string;
  message: string;
}

@Injectable()
export class DimensionProgressService {
  private readonly logger = new Logger(DimensionProgressService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: ResearchEventEmitterService,
  ) {}

  async updateDimensionStatus(
    dimensionId: string,
    status: DimensionStatus,
    options?: { lastResearchedAt?: Date },
  ): Promise<void> {
    await this.prisma.topicDimension.update({
      where: { id: dimensionId },
      data: { status, ...options },
    });
  }

  async emitProgress(
    topicId: string,
    dimensionName: string,
    progress: MissionProgress,
    missionId?: string,
    stageProgress?: number,
    taskId?: string,
  ): Promise<void> {
    let calculatedProgress: number;
    if (stageProgress !== undefined) {
      calculatedProgress = stageProgress;
    } else {
      // Stage-aware progress ranges:
      // planning:     5-15%
      // writing:     15-75% (proportional to sections completed)
      // reviewing:   75-85% (proportional to sections completed)
      // integrating: 85-95%
      // completed:   100%
      // failed:      keep last value or 0
      const sectionRatio =
        progress.sectionsTotal > 0
          ? progress.sectionsCompleted / progress.sectionsTotal
          : 0;

      switch (progress.stage) {
        case "planning":
          calculatedProgress = Math.round(5 + sectionRatio * 10);
          break;
        case "writing":
          calculatedProgress = Math.round(15 + sectionRatio * 60);
          break;
        case "reviewing":
          calculatedProgress = Math.round(75 + sectionRatio * 10);
          break;
        case "integrating":
          calculatedProgress = Math.round(85 + sectionRatio * 10);
          break;
        case "completed":
          calculatedProgress = 100;
          break;
        case "failed":
          calculatedProgress = 0;
          break;
        default:
          calculatedProgress = 5;
          break;
      }
    }

    void this.eventEmitter.emitDimensionResearchProgress(
      topicId,
      dimensionName,
      calculatedProgress,
      progress.message,
      missionId,
      taskId,
    );

    if (missionId) {
      try {
        await this.prisma.researchMission.update({
          where: { id: missionId },
          data: { updatedAt: new Date() },
        });
      } catch (error) {
        this.logger.debug(
          `[emitProgress] Non-fatal: Failed to update mission heartbeat: ${error}`,
        );
      }
    }
  }
}
