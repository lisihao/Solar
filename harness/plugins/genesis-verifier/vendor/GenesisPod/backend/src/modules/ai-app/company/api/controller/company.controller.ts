/**
 * CompanyController — REST endpoints for "一人公司 OS" persistent CRUD
 *
 * Base path: /company
 * Auth:      JwtAuthGuard (userId from req.user.id)
 *
 * Endpoints (W2 contract):
 *   GET    /company                           → snapshot
 *   POST   /company/hire                      → hire agent
 *   PATCH  /company/hired/:id                 → update hired agent
 *   DELETE /company/hired/:id                 → dismiss hired agent
 *   POST   /company/ceo                       → set / unset CEO
 *   POST   /company/teams                     → create team
 *   PATCH  /company/teams/:id                 → rename team
 *   DELETE /company/teams/:id                 → delete team
 *   POST   /company/teams/:id/members         → add member
 *   DELETE /company/teams/:id/members/:hiredAgentId → remove member
 *   POST   /company/teams/:id/leader          → set leader
 *   POST   /company/teams/:id/workflow        → assign / unset workflow
 *   POST   /company/workflows/custom          → create custom workflow
 *   POST   /company/workflows/acquire         → acquire from marketplace
 *   PATCH  /company/workflows/:id             → update workflow
 *   DELETE /company/workflows/:id             → delete workflow
 */

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import type { RequestWithUser } from "@/common/types/express-request.types";
import type {
  MissionGraphArtifact,
  NodeEnrichment,
} from "@/modules/ai-app/marketplace/graph";
import { CompanyService } from "../../services/company.service";
import { CompanyMissionService } from "../../services/company-mission.service";
import { CompanyMissionGraphService } from "../../services/company-mission-graph.service";
import { CompanyHeroService } from "../../services/company-hero.service";
import {
  AcquireWorkflowDto,
  AdoptHeroDto,
  InstantiateTeamFromWorkflowDto,
  AddTeamMemberDto,
  CreateMissionDto,
  RenameMissionDto,
  CreateTeamDto,
  HireAgentDto,
  SetCeoDto,
  SetTeamLeaderDto,
  SetTeamWorkflowDto,
  UpdateHeroDto,
  UpdateHiredAgentDto,
  UpdateTeamDto,
  UpdateWorkflowDto,
} from "../dto/company.dto";

@ApiTags("Company")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("company")
export class CompanyController {
  constructor(
    private readonly companyService: CompanyService,
    private readonly missionService: CompanyMissionService,
    private readonly graphService: CompanyMissionGraphService,
    private readonly heroService: CompanyHeroService,
  ) {}

  // ── helpers ─────────────────────────────────────────────────────────────────

  private getUserId(req: RequestWithUser): string {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authenticated user required");
    return userId;
  }

  // ── snapshot ─────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: "获取公司快照（profile + teams + hired + workflows）",
  })
  async getCompany(@Request() req: RequestWithUser) {
    return this.companyService.getCompany(this.getUserId(req));
  }

  // ── hire ─────────────────────────────────────────────────────────────────────

  @Post("hire")
  @ApiOperation({ summary: "从市场招募一个 Agent" })
  async hire(@Request() req: RequestWithUser, @Body() dto: HireAgentDto) {
    return this.companyService.hire(this.getUserId(req), dto.listingId);
  }

  // ── hired agent ───────────────────────────────────────────────────────────────

  @Patch("hired/:id")
  @ApiOperation({ summary: "更新雇员 Agent 配置" })
  async updateHired(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateHiredAgentDto,
  ) {
    return this.companyService.updateHired(this.getUserId(req), id, dto);
  }

  @Delete("hired/:id")
  @HttpCode(204)
  @ApiOperation({ summary: "解雇 Agent" })
  async deleteHired(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ): Promise<void> {
    await this.companyService.deleteHired(this.getUserId(req), id);
  }

  // ── CEO ───────────────────────────────────────────────────────────────────────

  @Post("ceo")
  @ApiOperation({ summary: "设置/取消 CEO" })
  async setCeo(@Request() req: RequestWithUser, @Body() dto: SetCeoDto) {
    return this.companyService.setCeo(
      this.getUserId(req),
      dto.hiredAgentId ?? null,
    );
  }

  // ── teams ─────────────────────────────────────────────────────────────────────

  @Post("teams")
  @ApiOperation({ summary: "创建团队" })
  async createTeam(
    @Request() req: RequestWithUser,
    @Body() dto: CreateTeamDto,
  ) {
    return this.companyService.createTeam(this.getUserId(req), dto.name);
  }

  @Post("teams/from-workflow")
  @ApiOperation({ summary: "一键成军：从工作流模板实例化满编团队" })
  async instantiateTeamFromWorkflow(
    @Request() req: RequestWithUser,
    @Body() dto: InstantiateTeamFromWorkflowDto,
  ) {
    return this.companyService.instantiateTeamFromWorkflow(
      this.getUserId(req),
      dto.workflowListingId,
      dto.name,
    );
  }

  @Patch("teams/:id")
  @ApiOperation({ summary: "更新团队名称" })
  async updateTeam(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.companyService.updateTeam(this.getUserId(req), id, dto);
  }

  @Delete("teams/:id")
  @HttpCode(204)
  @ApiOperation({ summary: "删除团队" })
  async deleteTeam(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ): Promise<void> {
    await this.companyService.deleteTeam(this.getUserId(req), id);
  }

  // ── team members ──────────────────────────────────────────────────────────────

  @Post("teams/:id/members")
  @ApiOperation({ summary: "向团队添加成员" })
  async addTeamMember(
    @Request() req: RequestWithUser,
    @Param("id") teamId: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.companyService.addTeamMember(
      this.getUserId(req),
      teamId,
      dto.hiredAgentId,
    );
  }

  @Delete("teams/:id/members/:hiredAgentId")
  @HttpCode(204)
  @ApiOperation({ summary: "从团队移除成员" })
  async removeTeamMember(
    @Request() req: RequestWithUser,
    @Param("id") teamId: string,
    @Param("hiredAgentId") hiredAgentId: string,
  ): Promise<void> {
    await this.companyService.removeTeamMember(
      this.getUserId(req),
      teamId,
      hiredAgentId,
    );
  }

  // ── team leader ───────────────────────────────────────────────────────────────

  @Post("teams/:id/leader")
  @ApiOperation({ summary: "设置团队 Leader" })
  async setTeamLeader(
    @Request() req: RequestWithUser,
    @Param("id") teamId: string,
    @Body() dto: SetTeamLeaderDto,
  ) {
    return this.companyService.setTeamLeader(
      this.getUserId(req),
      teamId,
      dto.hiredAgentId,
    );
  }

  // ── team workflow ─────────────────────────────────────────────────────────────

  @Post("teams/:id/workflow")
  @ApiOperation({ summary: "为团队分配工作流" })
  async setTeamWorkflow(
    @Request() req: RequestWithUser,
    @Param("id") teamId: string,
    @Body() dto: SetTeamWorkflowDto,
  ) {
    return this.companyService.setTeamWorkflow(
      this.getUserId(req),
      teamId,
      dto.workflowId ?? null,
    );
  }

  // ── workflows ─────────────────────────────────────────────────────────────────

  @Post("workflows/custom")
  @ApiOperation({ summary: "创建自定义工作流" })
  async createCustomWorkflow(@Request() req: RequestWithUser) {
    return this.companyService.createCustomWorkflow(this.getUserId(req));
  }

  @Post("workflows/acquire")
  @ApiOperation({ summary: "从市场获取工作流" })
  async acquireWorkflow(
    @Request() req: RequestWithUser,
    @Body() dto: AcquireWorkflowDto,
  ) {
    return this.companyService.acquireWorkflow(
      this.getUserId(req),
      dto.sourceListingId,
    );
  }

  @Patch("workflows/:id")
  @ApiOperation({ summary: "更新工作流配置" })
  async updateWorkflow(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateWorkflowDto,
  ) {
    return this.companyService.updateWorkflow(this.getUserId(req), id, dto);
  }

  @Delete("workflows/:id")
  @HttpCode(204)
  @ApiOperation({ summary: "删除工作流" })
  async deleteWorkflow(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ): Promise<void> {
    await this.companyService.deleteWorkflow(this.getUserId(req), id);
  }

  // ── heroes ───────────────────────────────────────────────────────────────────

  @Get("heroes")
  @ApiOperation({
    summary: "获取 Hero 列表（零 hero 时自动配置一个默认 deep-insight hero）",
  })
  async listHeroes(@Request() req: RequestWithUser) {
    return this.heroService.listHeroes(this.getUserId(req));
  }

  @Post("heroes")
  @ApiOperation({ summary: "采用一个市场能力为 Hero" })
  async adoptHero(@Request() req: RequestWithUser, @Body() dto: AdoptHeroDto) {
    return this.heroService.adoptHero(this.getUserId(req), dto.capabilityId);
  }

  @Patch("heroes/:id")
  @ApiOperation({ summary: "更新 Hero 配置（名称 / 模型槽 / autoFallback）" })
  async updateHero(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateHeroDto,
  ) {
    return this.heroService.updateHero(this.getUserId(req), id, dto);
  }

  @Delete("heroes/:id")
  @ApiOperation({ summary: "删除 Hero" })
  async deleteHero(@Request() req: RequestWithUser, @Param("id") id: string) {
    await this.heroService.deleteHero(this.getUserId(req), id);
    return { success: true };
  }

  @Post("heroes/:id/missions")
  @ApiOperation({ summary: "向 Hero 派发 Mission（运行其采用的能力）" })
  async createHeroMission(
    @Request() req: RequestWithUser,
    @Param("id") heroId: string,
    @Body() dto: CreateMissionDto,
  ) {
    return this.heroService.createHeroMission(
      this.getUserId(req),
      heroId,
      dto.title,
      {
        description: dto.description,
        depth: dto.depth,
        language: dto.language,
        withFigures: dto.withFigures,
        knowledgeBaseIds: dto.knowledgeBaseIds,
        searchTimeRange: dto.searchTimeRange,
        styleProfile: dto.styleProfile,
        lengthProfile: dto.lengthProfile,
        audienceProfile: dto.audienceProfile,
        auditLayers: dto.auditLayers,
      },
    );
  }

  // ── missions ───────────────────────────────────────────────────────────────

  @Post("teams/:id/missions")
  @ApiOperation({ summary: "为团队创建并启动 Mission" })
  async createMission(
    @Request() req: RequestWithUser,
    @Param("id") teamId: string,
    @Body() dto: CreateMissionDto,
  ) {
    return this.missionService.createMission(
      this.getUserId(req),
      teamId,
      dto.title,
    );
  }

  @Get("missions")
  @ApiOperation({ summary: "获取 Mission 列表（可按 teamId 过滤）" })
  @ApiQuery({ name: "teamId", required: false, description: "按团队 ID 过滤" })
  async listMissions(
    @Request() req: RequestWithUser,
    @Query("teamId") teamId?: string,
  ) {
    return this.missionService.listMissions(this.getUserId(req), teamId);
  }

  @Patch("missions/:id")
  @ApiOperation({ summary: "重命名 Mission" })
  async renameMission(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: RenameMissionDto,
  ) {
    await this.missionService.renameMission(this.getUserId(req), id, dto.title);
    return { success: true };
  }

  @Delete("missions/:id")
  @ApiOperation({ summary: "删除 Mission" })
  async deleteMission(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    await this.missionService.deleteMission(this.getUserId(req), id);
    return { success: true };
  }

  @Post("missions/:id/cancel")
  @ApiOperation({ summary: "取消运行中的 Mission" })
  async cancelMission(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    await this.missionService.cancelMission(this.getUserId(req), id);
    return { success: true };
  }

  @Post("missions/:id/rerun")
  @ApiOperation({ summary: "复跑 Mission（用原派发参数创建全新任务重跑）" })
  async rerunMission(@Request() req: RequestWithUser, @Param("id") id: string) {
    // 返回完整 mission 行（与 heroes/:id/missions 同形），前端 adaptMission 直接入列表。
    return this.missionService.rerunHeroMission(this.getUserId(req), id);
  }

  // ── mission graph（知识图谱，平台共享构建器）────────────────────────────────

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get("missions/:id/graph")
  @ApiOperation({ summary: "获取 Mission 知识图谱（未构建则 status=NONE）" })
  async getMissionGraph(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ): Promise<MissionGraphArtifact> {
    return this.graphService.getArtifact(this.getUserId(req), id);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post("missions/:id/graph")
  @ApiOperation({
    summary: "构建/重建 Mission 知识图谱（同步，2 次 LLM 调用）",
  })
  async buildMissionGraph(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ): Promise<MissionGraphArtifact> {
    return this.graphService.build(this.getUserId(req), id);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("missions/:id/graph/node/:nodeId/enrich")
  @ApiOperation({
    summary: "按需综合单个图谱节点的实体画像（web-search + LLM）",
  })
  async enrichMissionGraphNode(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Param("nodeId") nodeId: string,
  ): Promise<NodeEnrichment> {
    return this.graphService.enrichNode(this.getUserId(req), id, nodeId);
  }
}
