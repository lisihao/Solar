/**
 * WritingMissionReadController — writing mission canonical view endpoint
 *
 * GET /api/v1/ai-writing/missions/:id/view
 *
 * Returns WritingArtifact + 3 views (chapterList / fullText / qualityReport)
 * projected from WritingMissionContext via WritingArtifactProjector.
 *
 * Auth: own-only (project.ownerId === userId), enforced via
 * WritingMissionQueryService.getMissionStatus() which throws NotFoundException
 * for not-found or wrong owner (matching the existing writing controller pattern).
 *
 * Context loading: checkpoint-based (MissionCheckpointService.load(missionId)).
 * If no checkpoint exists (mission not yet started), writingArtifact is null.
 * If no REVISED chapters (mission in progress), projection is skipped and
 * writingArtifact is null with appropriate status.
 */

import {
  Controller,
  Get,
  Logger,
  Param,
  Request,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import type { RequestWithUser } from "../../../../common/types/express-request.types";
import { WritingMissionQueryService } from "../services/mission/writing-mission-query.service";
import { WritingArtifactProjector } from "../mission/projectors/writing-artifact.projector";
import type {
  WritingArtifact,
  WritingChapterListView,
  WritingFullTextView,
  WritingQualityReportView,
} from "../mission/projectors/writing-artifact.projector";
import { MissionCheckpointService } from "@/modules/ai-harness/facade";
import type { WritingMissionContext } from "../mission/context/mission-context";

export interface WritingMissionViewEnvelope {
  missionId: string;
  status: string;
  writingArtifact: WritingArtifact | null;
  chapterList: WritingChapterListView | null;
  fullText: WritingFullTextView | null;
  qualityReport: WritingQualityReportView | null;
  /** refreshHints: terminal event types that signal the view should be re-fetched */
  refreshHints: string[];
}

@Controller("ai-writing")
@UseGuards(JwtAuthGuard)
export class WritingMissionReadController {
  private readonly log = new Logger(WritingMissionReadController.name);

  constructor(
    private readonly missionQuery: WritingMissionQueryService,
    private readonly projector: WritingArtifactProjector,
    private readonly checkpoint: MissionCheckpointService<
      Partial<WritingMissionContext>
    >,
  ) {}

  /**
   * GET /api/v1/ai-writing/missions/:id/view
   *
   * Canonical truth endpoint for writing mission detail.
   * - Auth: own-only (getMissionStatus throws NotFoundException for wrong owner)
   * - Context: loaded from MissionCheckpointService (in-memory, best-effort)
   * - Projection: WritingArtifactProjector.project(ctx) + 3 views
   * - writingArtifact is null when mission is not yet persisted (in progress or not started)
   */
  @Get("missions/:id/view")
  async getMissionView(
    @Param("id") id: string,
    @Request() req: RequestWithUser,
  ): Promise<WritingMissionViewEnvelope> {
    const userId = req.user?.id;

    // Auth: getMissionStatus throws NotFoundException if not found or wrong owner.
    // We use the returned status for the envelope status field.
    const missionStatus = await this.missionQuery.getMissionStatus(id, userId);

    // Load mission context from checkpoint (may be null if not yet started)
    const snap = await this.checkpoint.load(id);
    const ctx = snap?.payload ?? null;

    let writingArtifact: WritingArtifact | null = null;
    let chapterList: WritingChapterListView | null = null;
    let fullText: WritingFullTextView | null = null;
    let qualityReport: WritingQualityReportView | null = null;

    if (ctx) {
      // Cast to full WritingMissionContext for projector (ctx is Partial<>)
      const fullCtx = ctx as WritingMissionContext;
      try {
        writingArtifact = this.projector.project(fullCtx);
        chapterList = this.projector.toChapterList(writingArtifact);
        fullText = this.projector.toFullText(writingArtifact, fullCtx);
        qualityReport = this.projector.toQualityReport(
          writingArtifact,
          fullCtx,
        );
      } catch (err) {
        // No REVISED chapters yet (mission in progress) — return null artifact
        this.log.debug(
          `[view] mission=${id} projection skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      missionId: id,
      status: missionStatus.status as string,
      writingArtifact,
      chapterList,
      fullText,
      qualityReport,
      refreshHints: [
        "writing.mission:completed",
        "writing.mission:failed",
        "writing.mission:cancelled",
      ],
    };
  }
}
