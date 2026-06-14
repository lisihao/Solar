import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Res,
  UseGuards,
  Request,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";
import { randomUUID } from "crypto";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import {
  RateLimit,
  RateLimitGuard,
} from "../../../../common/guards/rate-limit.guard";
import {
  MissionAbortRegistry,
  MissionAbortReason,
  MissionOwnershipRegistry,
} from "@/modules/ai-harness/facade";
import { ObjectStorageService } from "@/modules/platform/storage/object-store/object-storage.service";
import { AskSelfDrivenMissionStore } from "./ask-self-driven-mission.store";
import { SelfDrivenMissionDispatcher } from "./self-driven-mission-dispatcher.service";
import { AskSelfDrivenApprovalService } from "./ask-self-driven-approval.service";
import { SELF_DRIVEN_NAMESPACE } from "./ask-self-driven.gateway";

/** Per-user cap on concurrently running self-driven missions. */
const MAX_CONCURRENT_RUNNING_MISSIONS = 3;

class RunSelfDrivenDto {
  @IsString()
  prompt!: string;

  @IsOptional()
  @IsObject()
  clarifications?: Record<string, string>;

  /** Analysis depth: quick | standard | deep (default standard). */
  @IsOptional()
  @IsIn(["quick", "standard", "deep"])
  analysisDepth?: "quick" | "standard" | "deep";

  /**
   * Target output language ('zh' | 'en' or any BCP-47 locale).
   * When set, every step and the final report are written in this language.
   * Absent = current behaviour (LLM picks the language).
   */
  @IsOptional()
  @IsString()
  language?: string;
}

class ApproveDto {
  @IsBoolean()
  approved!: boolean;

  @IsOptional()
  @IsString()
  feedback?: string;

  /**
   * Analysis depth chosen at the plan-confirm gate. When it differs from the
   * depth the plan was built with, the runner re-plans at this depth before
   * executing (step count adjusts). Ignored for the deliver gate.
   */
  @IsOptional()
  @IsIn(["quick", "standard", "deep"])
  analysisDepth?: "quick" | "standard" | "deep";

  /**
   * The id of the dynamic choice option the human selected from the
   * `choices` array carried by the `awaiting_approval` event.
   * "proceed" means execute as-is; any other value is a context-specific
   * refinement the runner applies (re-plan for plan gate, appendContext for
   * deliver gate). Ignored when absent.
   * @deprecated Use choices (array) for multi-select. Kept for back-compat.
   */
  @IsOptional()
  @IsString()
  choice?: string;

  /**
   * Multi-select: all choice ids the human ticked. When present, supersedes
   * the single `choice` field. The runner applies ALL non-"proceed" ids.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  choices?: string[];
}

/**
 * Self-Driven Agent Team transport (durable, connection-decoupled).
 *
 * POST /api/v1/ask/self-driven/run                  → fire-and-forget launch
 * POST /api/v1/ask/self-driven/missions/:id/approve → owner-scoped HITL approval
 * POST /api/v1/ask/self-driven/missions/:id/cancel  → cooperative abort
 *
 * Live events arrive over the `self-driven` Socket.IO namespace; history via
 * GET /ask/self-driven/replay/:missionId. The old long-held SSE /stream endpoint
 * is gone — it could not survive the 10-min HITL gate over an HTTP/2 edge.
 */
@ApiTags("AI Ask")
@Controller("ask/self-driven")
@UseGuards(JwtAuthGuard)
export class AskSelfDrivenController {
  private readonly logger = new Logger(AskSelfDrivenController.name);

  constructor(
    private readonly store: AskSelfDrivenMissionStore,
    private readonly dispatcher: SelfDrivenMissionDispatcher,
    private readonly approval: AskSelfDrivenApprovalService,
    private readonly ownership: MissionOwnershipRegistry,
    private readonly abortRegistry: MissionAbortRegistry,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  @Post("run")
  @UseGuards(RateLimitGuard)
  @RateLimit({ maxRequests: 30, windowSeconds: 60, keyType: "user" })
  @ApiOperation({ summary: "Launch a self-driven mission (fire-and-forget)" })
  @ApiResponse({ status: 201, description: "{ missionId, streamNamespace }" })
  async run(
    @Request() req: { user: { id: string } },
    @Body() dto: RunSelfDrivenDto,
  ): Promise<{ missionId: string; streamNamespace: string }> {
    const userId = req.user.id;

    const running = await this.store.countRunningByUser(userId);
    if (running >= MAX_CONCURRENT_RUNNING_MISSIONS) {
      throw new BadRequestException(
        `You already have ${running} self-driven missions running (max ${MAX_CONCURRENT_RUNNING_MISSIONS}). Wait for one to finish.`,
      );
    }

    const missionId = randomUUID();
    this.ownership.assign(missionId, userId);
    await this.store.create(missionId, userId, dto.prompt);

    // Fire-and-forget: the connection is released immediately; the mission runs
    // in the background and streams over the socket + replay channels.
    void this.dispatcher
      .runInBackground(
        missionId,
        {
          prompt: dto.prompt,
          userId,
          clarifications: dto.clarifications,
          analysisDepth: dto.analysisDepth,
          language: dto.language,
        },
        userId,
      )
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`mission ${missionId} dispatch threw: ${message}`);
        void this.store
          .applyTerminalIfRunning(missionId, {
            status: "failed",
            errorMessage: message,
          })
          .catch(() => undefined);
      });

    return { missionId, streamNamespace: SELF_DRIVEN_NAMESPACE };
  }

  @Post("missions/:missionId/approve")
  @ApiOperation({ summary: "Approve/reject the mission's open HITL gate" })
  async approve(
    @Request() req: { user: { id: string } },
    @Param("missionId") missionId: string,
    @Body() dto: ApproveDto,
  ): Promise<{ ok: true; requestId: string }> {
    await this.assertOwner(missionId, req.user.id);
    const { requestId } = await this.approval.approve(
      missionId,
      dto.approved,
      dto.feedback,
      dto.analysisDepth,
      dto.choice,
      dto.choices,
    );
    return { ok: true, requestId };
  }

  @Post("missions/:missionId/cancel")
  @ApiOperation({ summary: "Cancel a running self-driven mission" })
  async cancel(
    @Request() req: { user: { id: string } },
    @Param("missionId") missionId: string,
  ): Promise<{ ok: boolean }> {
    await this.assertOwner(missionId, req.user.id);
    const aborted = this.abortRegistry.abort(
      missionId,
      MissionAbortReason.user_cancelled,
    );
    return { ok: aborted };
  }

  @Get("missions")
  @ApiOperation({ summary: "List the caller's recent self-driven missions" })
  async listMissions(@Request() req: { user: { id: string } }): Promise<{
    missions: Array<{
      id: string;
      status: string;
      prompt: string;
      createdAt: string;
    }>;
  }> {
    const missions = await this.store.listRecentByUser(req.user.id);
    return { missions };
  }

  @Get("missions/:missionId/report.md")
  @ApiOperation({ summary: "Download the mission's final report (markdown)" })
  @ApiResponse({ status: 200, description: "text/markdown attachment" })
  async downloadReport(
    @Request() req: { user: { id: string } },
    @Param("missionId") missionId: string,
    @Res() res: Response,
  ): Promise<void> {
    const meta = await this.store.getReportMeta(missionId);
    if (!meta) throw new NotFoundException("Mission not found");
    if (meta.userId !== req.user.id) {
      throw new ForbiddenException("Not your mission");
    }

    // Prefer external object storage (durable, offloaded); fall back to the
    // deliverable content kept in the event journal when storage is disabled
    // or the offload had not completed.
    let content: string | null = null;
    if (meta.reportUri && this.objectStorage.isEnabled()) {
      content = await this.objectStorage
        .downloadText(meta.reportUri)
        .catch(() => null);
    }
    if (content == null) {
      content = await this.store.getLatestDeliverableContent(missionId);
    }
    if (content == null) {
      throw new NotFoundException("No report available for this mission yet");
    }

    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="self-driven-report-${missionId}.md"`,
    );
    res.send(content);
  }

  private async assertOwner(missionId: string, userId: string): Promise<void> {
    let owner = this.ownership.getOwner(missionId);
    if (!owner) {
      owner = (await this.store.getOwnerById(missionId)) ?? undefined;
      if (owner) this.ownership.assign(missionId, owner);
    }
    if (!owner || owner !== userId) {
      throw new ForbiddenException("Not your mission");
    }
  }
}
