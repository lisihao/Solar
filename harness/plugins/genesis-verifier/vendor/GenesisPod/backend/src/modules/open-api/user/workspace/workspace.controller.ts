import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  UnauthorizedException,
} from "@nestjs/common";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

import {
  CreateWorkspaceDto,
  CreateWorkspaceTaskDto,
  UpdateWorkspaceResourcesDto,
} from "./dto";
import { WorkspaceService } from "./workspace.service";
import { WorkspaceTaskService } from "./workspace-task.service";
import { ReportTemplateService } from "./report-template.service";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";

@ApiTags("Workspace")
@Controller("workspaces")
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceTaskService: WorkspaceTaskService,
    private readonly reportTemplateService: ReportTemplateService,
  ) {}

  /**
   * 创建新的工作区
   */
  @Post()
  async createWorkspace(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateWorkspaceDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.workspaceService.createWorkspace(userId, dto);
  }

  /**
   * 获取报告模板列表
   */
  @Get("templates")
  async listTemplates(@Query("category") category?: string) {
    return this.reportTemplateService.listTemplates(category);
  }

  /**
   * 获取工作区详情
   */
  @Get(":id")
  async getWorkspace(
    @Param("id") id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.workspaceService.getWorkspace(id, userId);
  }

  /**
   * 更新工作区资源
   */
  @Patch(":id")
  async updateWorkspaceResources(
    @Param("id") id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateWorkspaceResourcesDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.workspaceService.updateWorkspaceResources(id, userId, dto);
  }

  /**
   * 创建工作区任务（AI 任务）
   */
  @Post(":id/tasks")
  async createWorkspaceTask(
    @Param("id") id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateWorkspaceTaskDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.workspaceTaskService.createTask(userId, id, dto);
  }

  /**
   * 查询任务状态
   */
  @Get(":id/tasks/:taskId")
  async getWorkspaceTask(
    @Param("id") id: string,
    @Param("taskId") taskId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.workspaceTaskService.getTask(userId, id, taskId);
  }
}
