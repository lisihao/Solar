import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from "@nestjs/swagger";
import { TopicInsightsService } from "../topic-insights.service";
import {
  AddCollaboratorDto,
  CollaboratorRole,
  UpdateCollaboratorRoleDto,
  UpdateTopicVisibilityDto,
  ApplyToJoinDto,
  ReviewApplicationDto,
} from "../dto/collaborator.dto";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { TopicCollaboratorService } from "../services";
import { TopicAccessGuard, RequireTopicAccess } from "../guards";
import type { RequestWithUser } from "../../../../common/types/express-request.types";

@ApiTags("Topic Research")
@ApiBearerAuth("access-token")
@Controller("insight")
@UseGuards(JwtAuthGuard)
export class CollaborationController {
  constructor(
    private readonly topicResearchService: TopicInsightsService,
    private readonly collaboratorService: TopicCollaboratorService,
  ) {}

  // ==================== Collaborators ====================

  /**
   * 获取协作者列表
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:id/collaborators")
  @ApiOperation({
    summary: "获取协作者列表",
    description: "获取专题的所有协作者",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回协作者列表" })
  async getCollaborators(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.collaboratorService.getCollaborators(id, userId);
  }

  /**
   * 添加协作者
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.ADMIN)
  @Post("topics/:id/collaborators")
  @ApiOperation({
    summary: "添加协作者",
    description: "通过邮箱添加协作者到专题",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 201, description: "协作者添加成功" })
  async addCollaborator(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: AddCollaboratorDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.collaboratorService.addCollaborator(
      id,
      userId,
      dto.email,
      dto.role,
    );
  }

  /**
   * 更新协作者角色
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.ADMIN)
  @Patch("topics/:topicId/collaborators/:collaboratorId")
  @ApiOperation({
    summary: "更新协作者角色",
    description: "更新协作者的权限角色",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "collaboratorId", description: "协作者ID" })
  @ApiResponse({ status: 200, description: "更新成功" })
  async updateCollaboratorRole(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("collaboratorId") collaboratorId: string,
    @Body() dto: UpdateCollaboratorRoleDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.collaboratorService.updateCollaboratorRole(
      topicId,
      collaboratorId,
      userId,
      dto.role,
    );
  }

  /**
   * 移除协作者
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.ADMIN)
  @Delete("topics/:topicId/collaborators/:collaboratorId")
  @ApiOperation({
    summary: "移除协作者",
    description: "从专题中移除协作者",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "collaboratorId", description: "协作者ID" })
  @ApiResponse({ status: 200, description: "移除成功" })
  async removeCollaborator(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("collaboratorId") collaboratorId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    await this.collaboratorService.removeCollaborator(
      topicId,
      collaboratorId,
      userId,
    );
    return;
  }

  /**
   * 离开专题
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post("topics/:id/leave")
  @ApiOperation({
    summary: "离开专题",
    description: "协作者主动退出专题",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "退出成功" })
  async leaveTopic(@Request() req: RequestWithUser, @Param("id") id: string) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    await this.collaboratorService.leaveProject(id, userId);
    return;
  }

  /**
   * 更新专题可见性
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Patch("topics/:id/visibility")
  @ApiOperation({
    summary: "更新专题可见性",
    description: "设置专题为私有、共享或公开",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "更新成功" })
  async updateVisibility(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateTopicVisibilityDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.updateVisibility(
      userId,
      id,
      dto.visibility,
    );
  }

  /**
   * 获取专题共享设置
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:id/sharing")
  @ApiOperation({
    summary: "获取共享设置",
    description: "获取专题的可见性和协作者信息",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回共享设置" })
  async getSharingSettings(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.getSharingSettings(userId, id);
  }

  // ==================== 申请审核机制 ====================

  /**
   * 用户申请加入专题
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post("topics/:id/apply")
  @ApiOperation({
    summary: "申请加入专题",
    description: "用户申请加入 SHARED 或 PUBLIC 专题，等待所有者审核",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 201, description: "申请已提交" })
  async applyToJoin(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: ApplyToJoinDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.collaboratorService.requestToJoin(id, userId, dto.message);
  }

  /**
   * 获取待审核的申请列表
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Get("topics/:id/applications")
  @ApiOperation({
    summary: "获取待审核申请",
    description: "获取专题的待审核申请列表（仅所有者或管理员可用）",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回待审核申请列表" })
  async getPendingApplications(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.collaboratorService.getPendingApplications(id, userId);
  }

  /**
   * 审核申请
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:topicId/applications/:applicationId/review")
  @ApiOperation({
    summary: "审核申请",
    description: "通过或拒绝加入申请（仅所有者或管理员可用）",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "applicationId", description: "申请ID" })
  @ApiResponse({ status: 200, description: "审核完成" })
  async reviewApplication(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("applicationId") applicationId: string,
    @Body() dto: ReviewApplicationDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.collaboratorService.reviewApplication(
      topicId,
      applicationId,
      userId,
      dto.decision,
      dto.reason,
    );
  }

  /**
   * 检查当前用户的申请状态
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:id/my-application")
  @ApiOperation({
    summary: "获取我的申请状态",
    description: "检查当前用户是否已申请该专题，以及申请状态",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回申请状态" })
  async getMyApplicationStatus(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.collaboratorService.getMyApplicationStatus(id, userId);
  }
}
