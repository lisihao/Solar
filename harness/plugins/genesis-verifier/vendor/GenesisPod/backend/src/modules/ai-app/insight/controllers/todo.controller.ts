import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
  NotFoundException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from "@nestjs/swagger";
import {
  GetTodosQueryDto,
  CancelTodoDto,
  PrioritizeTodoDto,
  UpdateTodoProgressDto,
  CreateUserRequestTodoDto,
} from "../dto";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import {
  ResearchTodoService,
  MissionLifecycleService,
  MissionQueryService,
} from "../services";
import type { RequestWithUser } from "../../../../common/types/express-request.types";
import { BillingContextInterceptor } from "../guards/billing-context.interceptor";

@ApiTags("Topic Research")
@ApiBearerAuth("access-token")
@Controller("insight")
@UseGuards(JwtAuthGuard)
@UseInterceptors(BillingContextInterceptor)
export class TodoController {
  constructor(
    private readonly todoService: ResearchTodoService,
    private readonly lifecycleService: MissionLifecycleService,
    private readonly queryService: MissionQueryService,
  ) {}

  // ==================== TODO Management ====================

  /**
   * 获取专题的 TODO 列表
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:topicId/todos")
  @ApiOperation({
    summary: "获取 TODO 列表",
    description: "获取专题的研究任务 TODO 列表",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiQuery({
    name: "missionId",
    required: false,
    description: "按 Mission 过滤",
  })
  @ApiResponse({ status: 200, description: "返回 TODO 列表和汇总" })
  async getTodos(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Query() query: GetTodosQueryDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.todoService.getTodos(topicId, {
      missionId: query.missionId,
      status: query.status,
      type: query.type,
    });
  }

  /**
   * 获取单个 TODO 详情
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:topicId/todos/:todoId")
  @ApiOperation({
    summary: "获取 TODO 详情",
    description: "获取单个 TODO 的详细信息",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "todoId", description: "TODO ID" })
  @ApiResponse({ status: 200, description: "返回 TODO 详情" })
  async getTodoById(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("todoId") todoId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    await this.todoService.verifyTodoBelongsToTopic(todoId, topicId);
    return this.todoService.getTodoById(todoId);
  }

  /**
   * 获取 TODO 详情（包含 Agent 活动）
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:topicId/todos/:todoId/details")
  @ApiOperation({
    summary: "获取 TODO 详情和活动",
    description: "获取 TODO 详情，包含关联的 Agent 活动记录",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "todoId", description: "TODO ID" })
  @ApiResponse({ status: 200, description: "返回 TODO 详情和活动" })
  async getTodoDetails(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("todoId") todoId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    await this.todoService.verifyTodoBelongsToTopic(todoId, topicId);
    return this.todoService.getTodoDetails(todoId);
  }

  /**
   * ★ 获取任务（ResearchTask）相关的活动记录
   * 注意：这个 endpoint 用于获取 missionStatus.tasks 中任务的活动
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("topics/:topicId/tasks/:taskId/activities")
  @ApiOperation({
    summary: "获取任务活动记录",
    description: "获取 ResearchTask 关联的 Agent 活动记录",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "taskId", description: "任务ID (ResearchTask.id)" })
  @ApiResponse({ status: 200, description: "返回任务信息和活动记录" })
  async getTaskActivities(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("taskId") taskId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    await this.queryService.verifyTaskBelongsToTopic(taskId, topicId);
    return this.queryService.getTaskActivities(taskId);
  }

  /**
   * 暂停 TODO
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post("topics/:topicId/todos/:todoId/pause")
  @HttpCode(200)
  @ApiOperation({
    summary: "暂停 TODO",
    description: "暂停正在进行的 TODO",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "todoId", description: "TODO ID" })
  @ApiResponse({ status: 200, description: "暂停成功" })
  async pauseTodo(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("todoId") todoId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    await this.todoService.verifyTodoBelongsToTopic(todoId, topicId);
    const todo = await this.todoService.pauseTodo(todoId);
    return todo;
  }

  /**
   * 恢复 TODO
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post("topics/:topicId/todos/:todoId/resume")
  @HttpCode(200)
  @ApiOperation({
    summary: "恢复 TODO",
    description: "恢复已暂停的 TODO",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "todoId", description: "TODO ID" })
  @ApiResponse({ status: 200, description: "恢复成功" })
  async resumeTodo(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("todoId") todoId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    await this.todoService.verifyTodoBelongsToTopic(todoId, topicId);
    const todo = await this.todoService.resumeTodo(todoId);
    return todo;
  }

  /**
   * 取消 TODO
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post("topics/:topicId/todos/:todoId/cancel")
  @HttpCode(200)
  @ApiOperation({
    summary: "取消 TODO",
    description: "取消待处理或已暂停的 TODO",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "todoId", description: "TODO ID" })
  @ApiResponse({ status: 200, description: "取消成功" })
  async cancelTodo(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("todoId") todoId: string,
    @Body() dto: CancelTodoDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    await this.todoService.verifyTodoBelongsToTopic(todoId, topicId);
    const todo = await this.todoService.cancelTodo(todoId, dto.reason);
    return todo;
  }

  /**
   * 重试 TODO
   * ★ 增强版：同时支持 ResearchTodo ID 和 ResearchTask ID
   * 前端显示的任务可能来自 missionStatus.tasks（ResearchTask）或 apiTodos（ResearchTodo）
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post("topics/:topicId/todos/:todoId/retry")
  @HttpCode(200)
  @ApiOperation({
    summary: "重试 TODO",
    description: "重试失败的 TODO 或任务",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "todoId", description: "TODO ID 或 Task ID" })
  @ApiResponse({ status: 200, description: "重试已排队" })
  async retryTodo(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("todoId") todoId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    // 验证归属（支持 TODO 或 Task，任意一种匹配即可）
    await this.todoService.verifyTodoOrTaskBelongsToTopic(todoId, topicId);

    // ★ 先尝试作为 ResearchTodo 处理
    try {
      const todo = await this.todoService.retryTodo(todoId);
      return todo;
    } catch (error) {
      // 如果是 NotFoundException，尝试作为 ResearchTask 处理
      if (error instanceof NotFoundException) {
        try {
          const task = await this.lifecycleService.retryTask(todoId);
          // 将 Task 转换为类似 TODO 的格式返回
          return {
            id: task.id,
            title: task.title,
            status: task.status === "PENDING" ? "QUEUED" : task.status,
            type: task.taskType,
            dimensionName: task.dimensionName,
            progress: 0,
            statusMessage: "等待重试",
          };
        } catch (taskError) {
          // 两个都失败，抛出原始错误
          throw error;
        }
      }
      throw error;
    }
  }

  /**
   * ★ 执行用户请求的 TODO
   * 解析 TODO 内容，执行相应操作（如新增维度并研究）
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("topics/:topicId/todos/:todoId/execute")
  @HttpCode(202)
  @ApiOperation({
    summary: "执行 TODO",
    description: "执行用户请求的 TODO，如新增维度、深入研究等",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "todoId", description: "TODO ID" })
  @ApiResponse({ status: 202, description: "执行已开始" })
  async executeTodo(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("todoId") todoId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    const result = await this.todoService.executeTodo(topicId, todoId);
    return result;
  }

  /**
   * 调整 TODO 优先级
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Patch("topics/:topicId/todos/:todoId/priority")
  @ApiOperation({
    summary: "调整优先级",
    description: "调整 TODO 的执行优先级",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "todoId", description: "TODO ID" })
  @ApiResponse({ status: 200, description: "优先级已调整" })
  async prioritizeTodo(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("todoId") todoId: string,
    @Body() dto: PrioritizeTodoDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    await this.todoService.verifyTodoBelongsToTopic(todoId, topicId);
    const todo = await this.todoService.prioritizeTodo(todoId, dto.priority);
    return todo;
  }

  /**
   * 更新 TODO 进度（内部使用）
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Patch("topics/:topicId/todos/:todoId/progress")
  @ApiOperation({
    summary: "更新进度",
    description: "更新 TODO 的执行进度",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "todoId", description: "TODO ID" })
  @ApiResponse({ status: 200, description: "进度已更新" })
  async updateTodoProgress(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("todoId") todoId: string,
    @Body() dto: UpdateTodoProgressDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    await this.todoService.verifyTodoBelongsToTopic(todoId, topicId);
    const todo = await this.todoService.updateTodoProgress(todoId, {
      progress: dto.progress,
      statusMessage: dto.statusMessage,
    });
    return todo;
  }

  /**
   * 创建用户请求 TODO
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post("topics/:topicId/missions/:missionId/todos")
  @ApiOperation({
    summary: "创建用户请求",
    description: "创建一个用户请求的 TODO",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "missionId", description: "Mission ID" })
  @ApiResponse({ status: 201, description: "TODO 创建成功" })
  async createUserRequestTodo(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("missionId") missionId: string,
    @Body() dto: CreateUserRequestTodoDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    const todo = await this.todoService.createUserRequestTodo(
      topicId,
      missionId,
      dto.title,
      dto.description,
    );
    return todo;
  }

  /**
   * ★ 更新 TODO（编辑标题和描述）
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Patch("topics/:topicId/todos/:todoId")
  @ApiOperation({
    summary: "更新 TODO",
    description: "更新 TODO 的标题和描述（仅限 USER_REQUEST 类型）",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "todoId", description: "TODO ID" })
  @ApiResponse({ status: 200, description: "更新成功" })
  async updateTodo(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("todoId") todoId: string,
    @Body() dto: { title?: string; description?: string },
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    await this.todoService.verifyTodoBelongsToTopic(todoId, topicId);
    const todo = await this.todoService.updateTodoContent(todoId, dto);
    return todo;
  }

  /**
   * ★ 删除 TODO
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Delete("topics/:topicId/todos/:todoId")
  @HttpCode(200)
  @ApiOperation({
    summary: "删除 TODO",
    description: "删除 TODO（仅限 USER_REQUEST 类型且状态为 PENDING）",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "todoId", description: "TODO ID" })
  @ApiResponse({ status: 200, description: "删除成功" })
  async deleteTodo(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("todoId") todoId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    await this.todoService.verifyTodoBelongsToTopic(todoId, topicId);
    await this.todoService.deleteTodo(todoId);
    return;
  }
}
