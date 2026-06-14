import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Logger,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AITeamsAdminService } from "../ai-teams-admin.service";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import {
  CreateTeamDto,
  UpdateTeamDto,
  CreateTeamMemberDto,
  UpdateTeamMemberDto,
  ReorderMembersDto,
  QueryTeamsDto,
} from "../dto/ai-team.dto";
import { AITeamTemplateStatus } from "@prisma/client";

/**
 * AI 团队模板管理控制器
 * 所有接口都需要管理员权限
 */
@ApiTags("Admin - AI Teams")
@Controller("admin/ai-teams")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AITeamsAdminController {
  private readonly logger = new Logger(AITeamsAdminController.name);

  constructor(private readonly aiTeamsService: AITeamsAdminService) {}

  // ==================== Team CRUD ====================

  /**
   * 创建团队模板
   * POST /api/v1/admin/ai-teams
   */
  @Post()
  async createTeam(@Body() dto: CreateTeamDto) {
    this.logger.log(`Creating AI team template: ${dto.name}`);
    return this.aiTeamsService.createTeam(dto);
  }

  /**
   * 获取所有团队模板
   * GET /api/v1/admin/ai-teams
   */
  @Get()
  async getAllTeams(
    @Query("status") status?: AITeamTemplateStatus,
    @Query("category") category?: string,
    @Query("includeMembers") includeMembers?: string,
  ) {
    this.logger.log(
      `Fetching AI team templates (status=${status}, category=${category})`,
    );
    const query: QueryTeamsDto = {
      status,
      category,
      includeMembers: includeMembers !== "false",
    };
    return this.aiTeamsService.getAllTeams(query);
  }

  /**
   * 获取可用工具列表
   * GET /api/v1/admin/ai-teams/tools
   * NOTE: This route MUST come before :id route
   */
  @Get("tools")
  async getAvailableTools() {
    this.logger.log("Fetching available tools");
    return this.aiTeamsService.getAvailableTools();
  }

  /**
   * 获取预设技能列表
   * GET /api/v1/admin/ai-teams/skills
   * NOTE: This route MUST come before :id route
   */
  @Get("skills")
  async getAvailableSkills() {
    this.logger.log("Fetching available skills");
    return this.aiTeamsService.getAvailableSkills();
  }

  /**
   * 获取内置角色列表
   * GET /api/v1/admin/ai-teams/roles
   * NOTE: This route MUST come before :id route
   */
  @Get("roles")
  async getBuiltInRoles() {
    this.logger.log("Fetching built-in roles");
    return this.aiTeamsService.getBuiltInRoles();
  }

  /**
   * 获取工作风格列表
   * GET /api/v1/admin/ai-teams/work-styles
   * NOTE: This route MUST come before :id route
   */
  @Get("work-styles")
  async getWorkStyles() {
    this.logger.log("Fetching work styles");
    return this.aiTeamsService.getWorkStyles();
  }

  /**
   * AI 智能生成团队配置
   * POST /api/v1/admin/ai-teams/generate-config
   * NOTE: This route MUST come before :id route
   */
  @Post("generate-config")
  async generateTeamConfig(
    @Body()
    body: {
      teamName: string;
      teamDescription?: string;
      category?: string;
    },
  ) {
    this.logger.log(`Generating AI team config for: ${body.teamName}`);
    return this.aiTeamsService.generateTeamConfig(body);
  }

  /**
   * 获取单个团队模板详情
   * GET /api/v1/admin/ai-teams/:id
   */
  @Get(":id")
  async getTeamById(@Param("id") id: string) {
    this.logger.log(`Fetching AI team template: ${id}`);
    return this.aiTeamsService.getTeamById(id);
  }

  /**
   * 更新团队模板
   * PATCH /api/v1/admin/ai-teams/:id
   */
  @Patch(":id")
  async updateTeam(@Param("id") id: string, @Body() dto: UpdateTeamDto) {
    this.logger.log(`Updating AI team template: ${id}`);
    return this.aiTeamsService.updateTeam(id, dto);
  }

  /**
   * 删除团队模板
   * DELETE /api/v1/admin/ai-teams/:id
   */
  @Delete(":id")
  async deleteTeam(@Param("id") id: string) {
    this.logger.log(`Deleting AI team template: ${id}`);
    return this.aiTeamsService.deleteTeam(id);
  }

  // ==================== Member CRUD ====================

  /**
   * 添加团队成员
   * POST /api/v1/admin/ai-teams/:id/members
   */
  @Post(":id/members")
  async addMember(
    @Param("id") teamId: string,
    @Body() dto: CreateTeamMemberDto,
  ) {
    this.logger.log(`Adding member to team: ${teamId}`);
    return this.aiTeamsService.addMember(teamId, dto);
  }

  /**
   * 重新排序团队成员
   * POST /api/v1/admin/ai-teams/:id/reorder
   */
  @Post(":id/reorder")
  async reorderMembers(
    @Param("id") teamId: string,
    @Body() dto: ReorderMembersDto,
  ) {
    this.logger.log(`Reordering members for team: ${teamId}`);
    return this.aiTeamsService.reorderMembers(teamId, dto.memberIds);
  }

  /**
   * 更新团队成员
   * PATCH /api/v1/admin/ai-teams/members/:id
   */
  @Patch("members/:id")
  async updateMember(
    @Param("id") memberId: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    this.logger.log(`Updating team member: ${memberId}`);
    return this.aiTeamsService.updateMember(memberId, dto);
  }

  /**
   * 删除团队成员
   * DELETE /api/v1/admin/ai-teams/members/:id
   */
  @Delete("members/:id")
  async deleteMember(@Param("id") memberId: string) {
    this.logger.log(`Deleting team member: ${memberId}`);
    return this.aiTeamsService.deleteMember(memberId);
  }
}

/**
 * AI 团队模板公共控制器（不需要管理员权限）
 * 用于其他应用获取可用的团队模板
 */
@ApiTags("Admin - AI Teams")
@Controller("ai-teams/templates")
@UseGuards(JwtAuthGuard)
export class AITeamsTemplatesController {
  private readonly logger = new Logger(AITeamsTemplatesController.name);

  constructor(private readonly aiTeamsService: AITeamsAdminService) {}

  /**
   * 获取可用的团队模板列表
   * GET /api/v1/ai-teams/templates
   */
  @Get()
  async getActiveTemplates(@Query("category") category?: string) {
    this.logger.log(`Fetching active team templates (category=${category})`);
    return this.aiTeamsService.getActiveTeamTemplates(category);
  }

  /**
   * 获取团队模板详情
   * GET /api/v1/ai-teams/templates/:id
   */
  @Get(":id")
  async getTemplateById(@Param("id") id: string) {
    this.logger.log(`Fetching team template: ${id}`);
    return this.aiTeamsService.getTeamTemplateById(id);
  }

  /**
   * 获取可用工具列表
   * GET /api/v1/ai-teams/templates/tools
   */
  @Get("tools")
  async getAvailableTools() {
    return this.aiTeamsService.getAvailableTools();
  }

  /**
   * 获取预设技能列表
   * GET /api/v1/ai-teams/templates/skills
   */
  @Get("skills")
  async getAvailableSkills() {
    return this.aiTeamsService.getAvailableSkills();
  }
}
