/**
 * Custom Teams Controller
 * 自定义团队 API 控制器
 *
 * 提供自定义团队的 CRUD 操作
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AiTeamsIntegrationService } from "../services/integration";
import {
  CreateCustomTeamDto,
  UpdateCustomTeamDto,
} from "../dto/create-custom-team.dto";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

@ApiTags("AI Teams - Custom Teams")
@ApiBearerAuth()
@Controller("ai-teams/custom-teams")
@UseGuards(JwtAuthGuard)
export class CustomTeamsController {
  private readonly logger = new Logger(CustomTeamsController.name);

  constructor(private readonly integrationService: AiTeamsIntegrationService) {}

  // ==================== Team CRUD ====================

  @Get()
  @ApiOperation({
    summary: "获取所有团队",
    description: "获取所有可用团队（预定义 + 自定义）",
  })
  @ApiResponse({ status: 200, description: "团队列表" })
  async listAllTeams() {
    return this.integrationService.listAllTeams();
  }

  @Get("custom")
  @ApiOperation({
    summary: "获取自定义团队",
    description: "仅获取自定义团队列表",
  })
  @ApiResponse({ status: 200, description: "自定义团队列表" })
  async listCustomTeams() {
    return this.integrationService.listCustomTeams();
  }

  @Get("roles")
  @ApiOperation({
    summary: "获取可用角色",
    description: "获取所有可用于创建团队的角色",
  })
  @ApiResponse({ status: 200, description: "角色列表" })
  async listAvailableRoles() {
    return this.integrationService.listAvailableRoles();
  }

  @Get(":teamId")
  @ApiOperation({
    summary: "获取团队详情",
    description: "根据团队 ID 获取团队详情",
  })
  @ApiResponse({ status: 200, description: "团队详情" })
  @ApiResponse({ status: 404, description: "团队不存在" })
  async getTeamById(@Param("teamId") teamId: string) {
    const team = this.integrationService.getTeamById(teamId);
    if (!team) {
      throw new NotFoundException(`Team not found: ${teamId}`);
    }
    return team;
  }

  @Post()
  @ApiOperation({
    summary: "创建自定义团队",
    description: "创建新的自定义团队配置",
  })
  @ApiResponse({ status: 201, description: "团队创建成功" })
  @ApiResponse({ status: 400, description: "请求参数错误" })
  async createCustomTeam(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateCustomTeamDto,
  ) {
    this.logger.log(
      `[createCustomTeam] User ${req.user.id} creating team: ${dto.name}`,
    );
    return this.integrationService.createCustomTeam(dto);
  }

  @Patch(":teamId")
  @ApiOperation({
    summary: "更新自定义团队",
    description: "更新已有的自定义团队配置",
  })
  @ApiResponse({ status: 200, description: "团队更新成功" })
  @ApiResponse({ status: 400, description: "请求参数错误或不可修改" })
  @ApiResponse({ status: 404, description: "团队不存在" })
  async updateCustomTeam(
    @Request() req: AuthenticatedRequest,
    @Param("teamId") teamId: string,
    @Body() dto: UpdateCustomTeamDto,
  ) {
    this.logger.log(
      `[updateCustomTeam] User ${req.user.id} updating team: ${teamId}`,
    );
    return this.integrationService.updateCustomTeam(teamId, dto);
  }

  @Delete(":teamId")
  @ApiOperation({
    summary: "删除自定义团队",
    description: "删除自定义团队（预定义团队不可删除）",
  })
  @ApiResponse({ status: 200, description: "团队删除成功" })
  @ApiResponse({ status: 400, description: "不可删除预定义团队" })
  @ApiResponse({ status: 404, description: "团队不存在" })
  async deleteCustomTeam(
    @Request() req: AuthenticatedRequest,
    @Param("teamId") teamId: string,
  ) {
    this.logger.log(
      `[deleteCustomTeam] User ${req.user.id} deleting team: ${teamId}`,
    );
    this.integrationService.deleteCustomTeam(teamId);
    return { teamId };
  }
}
