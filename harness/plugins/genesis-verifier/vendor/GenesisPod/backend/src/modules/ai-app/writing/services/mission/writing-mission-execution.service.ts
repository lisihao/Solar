/**
 * Writing Mission Execution Service
 *
 * Delegates execution of writing missions to WritingPipelineDispatcher.
 * All requests are routed to the new mission-pipeline path (B5 cut-over).
 *
 * Legacy executorMap path removed in B6.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

import type { WritingMissionInput } from "./writing-mission.types";
import type { RoleModelAssignment } from "./writing-model-manager.service";
import { WritingMissionLifecycleService } from "./writing-mission-lifecycle.service";
import { WritingPipelineDispatcher } from "../../mission/pipeline/writing-pipeline-dispatcher.service";

@Injectable()
export class WritingMissionExecutionService {
  private readonly logger = new Logger(WritingMissionExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: WritingMissionLifecycleService,
    @Optional() private readonly nestEventEmitter?: EventEmitter2,
    @Optional()
    private readonly writingPipelineDispatcher?: WritingPipelineDispatcher,
  ) {
    // Wire up circular dependency
    this.lifecycleService.setExecutionService(this);
  }

  /**
   * Run a writing mission in background (called by LifecycleService).
   * Always delegates to WritingPipelineDispatcher (legacy path removed in B6).
   * modelAssignments kept in signature for interface compatibility with LifecycleService.
   */
  async runMissionInBackground(
    missionId: string,
    input: WritingMissionInput,
    userId: string,
    _modelAssignments: RoleModelAssignment[],
  ): Promise<void> {
    if (!this.writingPipelineDispatcher) {
      const errMsg = `[${missionId}] WritingPipelineDispatcher not injected; cannot run mission`;
      this.logger.error(errMsg);
      this.lifecycleService.failKernelProcess(missionId, errMsg);
      try {
        await this.lifecycleService.updateMissionRecord(missionId, {
          missionId,
          success: false,
          deliverables: [],
          summary: `写作任务失败: ${errMsg}`,
          tokensUsed: 0,
          costUsed: 0,
          duration: 0,
          error: {
            code: "DISPATCHER_NOT_AVAILABLE",
            message: errMsg,
            retryable: false,
          },
          statistics: {
            totalSteps: 0,
            completedSteps: 0,
            failedSteps: 1,
            skippedSteps: 0,
            reworkCount: 0,
            membersInvolved: 0,
            toolCalls: 0,
            skillCalls: 0,
            reviewCount: 0,
            reviewPassRate: 0,
          },
        });
      } catch (recordErr) {
        this.logger.error(
          `Mission ${missionId} CRITICAL: failed to mark as FAILED: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
        );
      }
      return;
    }

    this.logger.log(
      `[${missionId}] routing to WritingPipelineDispatcher (mission-pipeline v1)`,
    );
    try {
      await this.writingPipelineDispatcher.runMission(
        missionId,
        input,
        userId,
        input.projectId,
      );
    } catch (err) {
      this.logger.error(
        `[${missionId}] WritingPipelineDispatcher.runMission threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 派发"写作任务完成"持久化通知（NotificationEventListener 接收）。
   * fire-and-forget；通知失败不影响主流程。
   */
  async dispatchCompletionNotification(
    missionId: string,
    userId: string,
    input: WritingMissionInput,
    totalWords: number,
  ): Promise<void> {
    if (!this.nestEventEmitter || !userId) return;
    try {
      const project = await this.prisma.writingProject.findUnique({
        where: { id: input.projectId },
        select: { name: true },
      });
      this.nestEventEmitter.emit("notification.task-completed", {
        kind: "writing",
        userId,
        refId: missionId,
        parentId: input.projectId,
        title: project?.name || input.projectId,
        missionType: input.missionType,
        metrics: { totalWords },
      });
    } catch (err) {
      this.logger.debug(
        `[dispatchCompletionNotification] writing mission ${missionId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
