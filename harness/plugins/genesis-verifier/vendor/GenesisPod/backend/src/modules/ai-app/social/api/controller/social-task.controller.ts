import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import { SocialTaskService } from "../../mission/services/social-task.service";
// ★ B7-1 (thinning plan §B7-1): canonical mission detail view
import { SocialMissionQueryService } from "../../mission/query/social-mission-query.service";
import { projectSocialMissionView } from "../../mission/projectors/social-mission-view.projector";
import type { SocialMissionViewEnvelope } from "../contracts/view-state.contract";
import {
  CreateSocialTaskDto,
  RenameSocialTaskDto,
} from "../dto/create-social-task.dto";

interface AuthenticatedRequest {
  user?: { id?: string };
}

@Controller("ai-social/tasks")
@UseGuards(JwtAuthGuard)
export class SocialTaskController {
  constructor(
    private readonly taskService: SocialTaskService,
    // ★ B7-1: canonical view query service
    private readonly missionQuery: SocialMissionQueryService,
  ) {}

  /**
   * GET /api/v1/ai-social/tasks/:id/view — canonical mission detail view
   *
   * thinning plan §B7-1 / §B2-3 sibling-route semantics.
   * Mirror playground's GET /missions/:id/view. Existing /tasks/:id stays as
   * sibling backward-compat (§6.9 disposition pattern).
   */
  @Get(":id/view")
  async getMissionView(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<SocialMissionViewEnvelope> {
    const inputs = await this.missionQuery.loadInputs(id, req.user?.id);
    const view = projectSocialMissionView(inputs);
    return { view };
  }

  @Post()
  async createTask(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateSocialTaskDto,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return this.taskService.createTask(dto, userId);
  }

  @Get()
  async listTasks(
    @Req() req: AuthenticatedRequest,
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return this.taskService.listTasks(userId, {
      status,
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /** GET /ai-social/tasks/mission/:missionId/replay?since=<ts> — 累积事件水合（仿 playground replay） */
  @Get("mission/:missionId/replay")
  async replayMission(
    @Req() req: AuthenticatedRequest,
    @Param("missionId") missionId: string,
    @Query("since") since?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    const sinceTs = since ? Number(since) : undefined;
    return this.taskService.getMissionReplay(
      missionId,
      userId,
      Number.isFinite(sinceTs as number) ? (sinceTs as number) : undefined,
    );
  }

  /** GET /ai-social/tasks/:id/mission-snapshot — mission 持久化快照（算力+终态），事件 buffer 过期后回显历史 */
  @Get(":id/mission-snapshot")
  async getMissionSnapshot(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return this.taskService.getMissionSnapshot(id, userId);
  }

  @Get(":id")
  async getTask(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return this.taskService.getTask(id, userId);
  }

  @Delete(":id")
  async cancelTask(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    const result = await this.taskService.cancelTask(id, userId);
    return { success: true, ...result };
  }

  @Post(":id/retry")
  async retryTask(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return this.taskService.retryTask(id, userId);
  }

  /** POST /ai-social/tasks/:id/publish?platform=WECHAT_MP — 发布该平台草稿到草稿箱 */
  @Post(":id/publish")
  async publishTask(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("platform") platform?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    if (!platform) throw new BadRequestException("platform query required");
    return this.taskService.publishTaskVersion(id, platform, userId);
  }

  /** PATCH /ai-social/tasks/:id — 重命名任务（卡片「编辑」） */
  @Patch(":id")
  async renameTask(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: RenameSocialTaskDto,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return this.taskService.renameTask(id, userId, dto.title);
  }
}
