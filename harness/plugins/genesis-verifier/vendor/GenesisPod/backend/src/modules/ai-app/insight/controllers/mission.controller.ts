import {
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Request,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
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
import { TopicInsightsService } from "../topic-insights.service";
import {
  LeaderPlanDto,
  LeaderMessageDto,
  MissionRetryDto,
  MissionAdjustDto,
  LeaderChatDto,
} from "../dto";
import { CollaboratorRole } from "../dto/collaborator.dto";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { TopicAccessGuard, RequireTopicAccess } from "../guards";
import {
  MissionLifecycleService,
  MissionQueryService,
  MissionExecutionService,
  ResearchLeaderService,
  ResearchEventEmitterService,
  ResearchTodoService,
  ResearchMissionHealthService,
  ResearchCheckpointService,
} from "../services";
import type { RequestWithUser } from "../../../../common/types/express-request.types";
import { BillingContext } from "../../../platform/facade";
import { BillingContextInterceptor } from "../guards/billing-context.interceptor";

@ApiTags("Topic Research")
@ApiBearerAuth("access-token")
@Controller("insight")
@UseGuards(JwtAuthGuard)
@UseInterceptors(BillingContextInterceptor)
export class MissionController {
  private readonly logger = new Logger(MissionController.name);

  constructor(
    private readonly topicResearchService: TopicInsightsService,
    private readonly lifecycleService: MissionLifecycleService,
    private readonly queryService: MissionQueryService,
    private readonly executionService: MissionExecutionService,
    private readonly leaderService: ResearchLeaderService,
    private readonly eventEmitterService: ResearchEventEmitterService,
    private readonly todoService: ResearchTodoService,
    private readonly healthService: ResearchMissionHealthService,
    private readonly checkpointService: ResearchCheckpointService,
  ) {}

  // ==================== Leader API ====================

  /**
   * Leader 生成研究规划
   * ★ Security: 速率限制 5次/分钟，AI 密集型操作
   * ★ Security: 使用 TopicAccessGuard 统一权限检查
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:id/leader/plan")
  @ApiOperation({
    summary: "Leader 生成研究规划",
    description: "调用 Leader（推理模型）规划研究维度和执行策略",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 201, description: "规划成功" })
  @ApiResponse({ status: 403, description: "无权限" })
  @ApiResponse({ status: 429, description: "请求过于频繁" })
  async leaderPlan(@Param("id") id: string, @Body() dto: LeaderPlanDto) {
    // ★ BillingContext auto-injected by BillingContextInterceptor
    return this.lifecycleService.createMission({
      topicId: id,
      userPrompt: dto.userPrompt,
      userContext: dto.userContext,
      mode: dto.mode || "fresh",
      researchDepth: dto.researchDepth,
    });
  }

  /**
   * 获取研究规划
   * 返回当前 Mission 的 LeaderPlan（用于规划透明度展示）
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:id/mission/plan")
  @ApiOperation({
    summary: "获取研究规划",
    description:
      "获取当前 Mission 的 Leader 规划详情，包含维度、Agent 分配和执行策略",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回规划详情" })
  async getMissionPlan(@Param("id") id: string) {
    const mission = await this.queryService.getMissionByTopicId(id);
    if (!mission) {
      throw new NotFoundException("No active mission for this topic");
    }
    return {
      missionId: mission.id,
      status: mission.status,
      leaderPlan: mission.leaderPlan,
    };
  }

  /**
   * 审批研究规划
   * 用户确认规划后，启动研究执行
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:id/mission/approve-plan")
  @ApiOperation({
    summary: "审批研究规划",
    description: "确认 Leader 规划，从 PLAN_READY 状态转为 EXECUTING",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "规划已审批，执行已启动" })
  async approveMissionPlan(@Param("id") id: string) {
    // ★ BillingContext auto-injected by BillingContextInterceptor
    const mission = await this.queryService.getMissionByTopicId(id);
    if (!mission) {
      throw new NotFoundException("No active mission for this topic");
    }
    if (mission.status !== "PLAN_READY") {
      throw new NotFoundException(
        `Mission is in ${mission.status} status, expected PLAN_READY`,
      );
    }
    await this.lifecycleService.approvePlanAndExecute(mission.id, id);
    return { success: true, message: "Plan approved, execution started" };
  }

  /**
   * 处理 @Leader 用户消息
   * ★ Security: 速率限制 5次/分钟，AI 密集型操作
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:id/leader/message")
  @ApiOperation({
    summary: "处理 @Leader 消息",
    description: "用户通过 @Leader 向 Leader 发送指令或补充提示",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "消息处理成功" })
  @ApiResponse({ status: 429, description: "请求过于频繁" })
  async leaderMessage(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: LeaderMessageDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    // 获取当前 Mission
    const mission = await this.queryService.getMissionByTopicId(id);
    if (!mission) {
      throw new NotFoundException("No active mission for this topic");
    }
    return this.leaderService.handleUserMessage(id, mission.id, dto.content);
  }

  /**
   * ★ Leader 解码用户输入（Claude Code CLI 风格）
   * 先理解用户意图，再决定如何响应
   * ★ Security: 速率限制 5次/分钟，AI 密集型操作
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:id/leader/chat")
  @ApiOperation({
    summary: "Leader 解码用户输入",
    description:
      "类似 Claude Code CLI：Leader 理解用户意图后决定是直接回答、创建TODO、还是请求澄清",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({
    status: 200,
    description: "返回 Leader 解码结果",
    schema: {
      type: "object",
      properties: {
        decisionType: {
          type: "string",
          enum: ["DIRECT_ANSWER", "CREATE_TODO", "CLARIFY", "ACKNOWLEDGE"],
        },
        understanding: { type: "string" },
        response: { type: "string" },
        todo: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
          },
        },
        clarifyQuestion: { type: "string" },
        clarifyOptions: { type: "array", items: { type: "string" } },
      },
    },
  })
  async leaderChat(
    @Request() req: RequestWithUser,
    @Param("id") topicId: string,
    @Body() dto: LeaderChatDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    return BillingContext.run(
      {
        userId,
        moduleType: "topic-insights",
        operationType: "research",
        referenceId: topicId,
      },
      async () => {
        // 1. 获取当前 Mission（如果有）
        let missionId = dto.missionId;
        if (!missionId) {
          const mission = await this.queryService.getMissionByTopicId(topicId);
          missionId = mission?.id;
        }

        // 2. Leader 解码用户输入
        const decodeResult = await this.leaderService.decodeUserInput(
          topicId,
          dto.message,
          missionId,
        );

        // 3. 如果决定创建 TODO，则创建并加入任务队列（不立即执行）
        let createdTodo = null;
        if (
          decodeResult.decisionType === "CREATE_TODO" &&
          decodeResult.todoTitle &&
          missionId
        ) {
          try {
            // ★ v7.2: Leader 先选择合适的 Agent，再创建 TODO
            const agentAssignment = await this.leaderService.selectAgentForTask(
              topicId,
              missionId,
              decodeResult.todoTitle,
              decodeResult.todoDescription,
            );

            // ★ v8.2: 确保 Leader 创建的任务标题以 "研究:" 开头
            // 这样 executeTodo 才能正确识别为研究任务并执行实际研究
            let taskTitle = decodeResult.todoTitle;
            if (
              !taskTitle.startsWith("研究:") &&
              !taskTitle.startsWith("研究：")
            ) {
              taskTitle = `研究: ${taskTitle}`;
            }

            const todo = await this.todoService.createTodo({
              topicId,
              missionId,
              type: "USER_REQUEST",
              title: taskTitle,
              description: decodeResult.todoDescription,
              // ★ 使用 Leader 分配的 Agent 信息
              agentId: agentAssignment.agentId,
              agentName: agentAssignment.agentName,
              agentRole: agentAssignment.role,
              modelId: agentAssignment.modelId,
            });
            createdTodo = {
              id: todo.id,
              title: todo.title,
              assignedAgent: agentAssignment.agentName,
            };

            // ★ v8.1: 将新 Agent 的 skills 和 tools 添加到 leaderPlan 中
            // 这样前端能够正确显示 Agent 的能力配置
            await this.executionService.addAgentToLeaderPlan(missionId, {
              agentId: agentAssignment.agentId,
              agentName: agentAssignment.agentName,
              agentType: agentAssignment.agentType,
              role: agentAssignment.role,
              modelId: agentAssignment.modelId,
              skills: agentAssignment.skills,
              tools: agentAssignment.tools,
            });

            // ★ v7.2: 不再立即执行，而是将任务加入队列
            // 任务将通过 Mission 的调度器统一处理
            // 异步调度新创建的 TODO（不阻塞响应）
            this.todoService
              .scheduleTodo(topicId, todo.id)
              .catch((err: Error) => {
                this.logger.error(
                  `[leaderChat] Schedule TODO failed: ${err.message}`,
                );
              });
          } catch (error) {
            // 继续返回响应，但标记 TODO 创建失败
            this.logger.error(`Failed to create TODO: ${error}`);
          }
        }

        // 4. 保存用户消息和 Leader 响应到数据库（用于对话历史）
        if (missionId) {
          await this.eventEmitterService.saveUserMessage(
            topicId,
            missionId,
            dto.message,
          );
          await this.eventEmitterService.emitLeaderResponse(
            topicId,
            missionId,
            decodeResult.response,
          );
        }

        // 5. 返回结果
        return {
          decisionType: decodeResult.decisionType,
          understanding: decodeResult.understanding,
          response: decodeResult.response,
          todo: createdTodo,
          clarifyQuestion: decodeResult.clarifyQuestion,
          clarifyOptions: decodeResult.clarifyOptions,
        };
      }, // end BillingContext.run callback
    ); // end BillingContext.run
  }

  /**
   * 获取 Leader 决策历史
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:id/leader/decisions")
  @ApiOperation({
    summary: "获取 Leader 决策历史",
    description: "获取 Leader 在研究过程中的所有决策记录",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回决策历史" })
  async getLeaderDecisions(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    const mission = await this.queryService.getMissionByTopicId(id);
    if (!mission) {
      return [];
    }
    return this.leaderService.getDecisionHistory(mission.id);
  }

  // ==================== Mission API ====================

  /**
   * 获取当前 Mission 状态
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:id/mission")
  @ApiOperation({
    summary: "获取 Mission 状态",
    description: "获取专题当前研究任务的状态和进度",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回 Mission 状态" })
  async getMission(@Request() req: RequestWithUser, @Param("id") id: string) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.queryService.getMissionByTopicId(id);
  }

  /**
   * 重试失败的任务
   * ★ Security: 使用 TopicAccessGuard 统一权限检查
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:id/mission/retry")
  @ApiOperation({
    summary: "重试失败任务",
    description: "重试 Mission 中失败的任务",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "重试成功" })
  @ApiResponse({ status: 403, description: "无权限" })
  async retryMission(@Param("id") id: string, @Body() dto: MissionRetryDto) {
    // ★ 权限检查已由 TopicAccessGuard 完成
    const mission = await this.queryService.getMissionByTopicId(id);
    if (!mission) {
      throw new NotFoundException("No mission found for this topic");
    }
    if (dto.taskIds?.length) {
      // 重试指定任务
      const results = await Promise.all(
        dto.taskIds.map((taskId) => this.lifecycleService.retryTask(taskId)),
      );

      // ★ Bug fix: 单个任务重试后，需要确保 scheduler 能拾取
      // 如果 mission 已经是终态（COMPLETED/FAILED），scheduler 已退出，
      // 需要调用 resumeExecutionForNewTask 重启 scheduler
      void this.executionService
        .resumeExecutionForNewTask(mission.id, id)
        .catch((error) => {
          this.logger.error(
            `[retryMission] Failed to resume execution after task retry: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        });

      return { retriedTasks: results.length };
    }
    // 重试整个 Mission
    const updatedMission = await this.lifecycleService.retryMission(mission.id);

    // ★ Bug fix: retryMission 只重置任务状态（→ EXECUTING），不启动 scheduler
    // 使用 resumeExecution 而非 startExecution — 复用已有报告，避免维度分析分散到不同报告
    // 注意：不能用 resumeExecutionForNewTask，因为它看到 EXECUTING 会以为 scheduler 还在跑
    void this.executionService
      .resumeExecution(mission.id, id)
      .catch((error) => {
        this.logger.error(
          `[retryMission] Failed to resume execution after mission retry: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      });

    return updatedMission;
  }

  /**
   * 获取当前团队组成
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:id/team")
  @ApiOperation({
    summary: "获取研究团队",
    description: "获取 Leader 动态创建的 Agent 列表",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回团队信息" })
  async getTeam(@Request() req: RequestWithUser, @Param("id") id: string) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    const mission = await this.queryService.getMissionByTopicId(id);
    if (!mission) {
      return { leaderId: null, leaderModel: null, agents: [] };
    }
    return this.queryService.getTeamInfo(mission.id);
  }

  /**
   * 获取团队互动消息
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:id/team-messages")
  @ApiOperation({
    summary: "获取团队互动消息",
    description: "获取专题的团队互动消息历史，包括 Leader 回复、用户消息等",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiQuery({ name: "limit", required: false, description: "返回数量限制" })
  @ApiQuery({
    name: "missionId",
    required: false,
    description: "按 Mission ID 过滤",
  })
  @ApiResponse({ status: 200, description: "返回团队消息列表" })
  async getTeamMessages(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Query("limit") limit?: string,
    @Query("missionId") missionId?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.eventEmitterService.getTeamMessages(id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      missionId,
    });
  }

  /**
   * 获取 Agent 活动记录
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:id/agent-activities")
  @ApiOperation({
    summary: "获取 Agent 活动记录",
    description: "获取专题的 Agent 思考和工作记录",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiQuery({ name: "limit", required: false, description: "返回数量限制" })
  @ApiQuery({
    name: "missionId",
    required: false,
    description: "按 Mission ID 过滤",
  })
  @ApiQuery({
    name: "agentRole",
    required: false,
    description: "按 Agent 角色过滤",
  })
  @ApiResponse({ status: 200, description: "返回 Agent 活动列表" })
  async getAgentActivities(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Query("limit") limit?: string,
    @Query("missionId") missionId?: string,
    @Query("agentRole") agentRole?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.eventEmitterService.getAgentActivities(id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      missionId,
      agentRole,
    });
  }

  /**
   * 获取按维度分组的 Agent 活动记录
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:id/agent-activities/by-dimension")
  @ApiOperation({
    summary: "获取按维度分组的 Agent 活动记录",
    description: "返回按维度分组的 Agent 思考过程和活动记录（增强版）",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiQuery({ name: "missionId", required: false, description: "任务ID" })
  @ApiResponse({ status: 200, description: "返回按维度分组的 Agent 活动记录" })
  async getAgentActivitiesByDimension(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Query("missionId") missionId?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.getAgentActivities(userId, id, missionId);
  }

  /**
   * 获取 Agent 活动统计
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:id/agent-activities/stats")
  @ApiOperation({
    summary: "获取 Agent 活动统计",
    description: "返回 Agent 活动的统计数据",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiQuery({ name: "missionId", required: false, description: "任务ID" })
  @ApiResponse({ status: 200, description: "返回活动统计" })
  async getAgentActivityStats(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Query("missionId") missionId?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.topicResearchService.getAgentActivityStats(
      userId,
      id,
      missionId,
    );
  }

  /**
   * 调整 Mission 执行策略
   * ★ Security: 使用 TopicAccessGuard 统一权限检查
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:id/mission/adjust")
  @ApiOperation({
    summary: "调整 Mission 执行策略",
    description: "添加/移除维度、调整聚焦领域等",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "调整成功" })
  async adjustMission(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: MissionAdjustDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    const mission = await this.queryService.getMissionByTopicId(id);
    if (!mission) {
      throw new NotFoundException("No active mission for this topic");
    }
    return this.lifecycleService.adjustMission(userId, mission.id, dto);
  }

  /**
   * 取消 Mission
   * ★ Security: 使用 TopicAccessGuard 统一权限检查
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:id/mission/cancel")
  @ApiOperation({
    summary: "取消 Mission",
    description: "取消正在执行的研究任务",
  })
  @ApiParam({ name: "id", description: "专题ID" })
  @ApiResponse({ status: 200, description: "取消成功" })
  @ApiResponse({ status: 403, description: "无权限" })
  async cancelMission(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    // ★ 权限检查已由 TopicAccessGuard 完成
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    const mission = await this.queryService.getMissionByTopicId(id);
    if (!mission) {
      throw new NotFoundException("No active mission for this topic");
    }
    return this.lifecycleService.cancelMission(userId, mission.id);
  }

  // ==================== Mission Detail Routes ====================

  /**
   * 获取指定 Mission 详情
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/missions/:missionId")
  @ApiOperation({
    summary: "获取 Mission 详情",
    description: "获取指定 Mission 的状态和详细信息",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "missionId", description: "Mission ID" })
  @ApiResponse({ status: 200, description: "返回 Mission 详情" })
  @ApiResponse({ status: 403, description: "无权限" })
  async getMissionDetail(
    @Param("topicId") _topicId: string,
    @Param("missionId") missionId: string,
  ) {
    return this.queryService.getMissionStatus(missionId);
  }

  /**
   * 获取指定 Mission 的团队消息
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/missions/:missionId/messages")
  @ApiOperation({
    summary: "获取 Mission 团队消息",
    description: "获取指定 Mission 的团队互动消息",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "missionId", description: "Mission ID" })
  @ApiResponse({ status: 200, description: "返回团队消息列表" })
  @ApiResponse({ status: 403, description: "无权限" })
  async getMissionMessages(
    @Param("topicId") topicId: string,
    @Param("missionId") missionId: string,
  ) {
    return this.eventEmitterService.getTeamMessages(topicId, { missionId });
  }

  /**
   * 获取指定 Mission 的 Agent 活动
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/missions/:missionId/activities")
  @ApiOperation({
    summary: "获取 Mission Agent 活动",
    description: "获取指定 Mission 的 Agent 活动记录",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "missionId", description: "Mission ID" })
  @ApiResponse({ status: 200, description: "返回 Agent 活动列表" })
  @ApiResponse({ status: 403, description: "无权限" })
  async getMissionActivities(
    @Param("topicId") topicId: string,
    @Param("missionId") missionId: string,
  ) {
    return this.eventEmitterService.getAgentActivities(topicId, { missionId });
  }

  // ==================== Health Check & Recovery ====================

  /**
   * 获取 Mission 健康状态
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/missions/:missionId/health")
  @ApiOperation({
    summary: "获取 Mission 健康状态",
    description: "检查研究任务的健康状态，包括是否卡死、执行时间等",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "missionId", description: "Mission ID" })
  @ApiResponse({ status: 200, description: "返回健康状态" })
  async getMissionHealth(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("missionId") missionId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    const health = await this.healthService.getMissionHealthStatus(missionId);
    return health;
  }

  /**
   * 获取专题当前 Mission 的健康状态
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/health")
  @ApiOperation({
    summary: "获取专题当前 Mission 的健康状态",
    description: "获取专题最新研究任务的健康状态",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiResponse({ status: 200, description: "返回健康状态" })
  async getTopicMissionHealth(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    // 获取当前 Mission
    const mission = await this.queryService.getMissionByTopicId(topicId);
    if (!mission) {
      return { health: null, message: "没有正在进行的研究任务" };
    }

    const health = await this.healthService.getMissionHealthStatus(mission.id);
    return health;
  }

  /**
   * 检查 Mission 是否可恢复
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.VIEWER)
  @Get("topics/:topicId/missions/:missionId/can-resume")
  @ApiOperation({
    summary: "检查 Mission 是否可恢复",
    description: "检查失败或取消的研究任务是否可以恢复继续执行",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "missionId", description: "Mission ID" })
  @ApiResponse({ status: 200, description: "返回是否可恢复" })
  async canResumeMission(
    @Request() req: RequestWithUser,
    @Param("topicId") _topicId: string,
    @Param("missionId") missionId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    const result = await this.checkpointService.canResume(missionId);
    return result;
  }

  /**
   * 恢复失败的 Mission
   * ★ Security: 使用 TopicAccessGuard 统一权限检查
   */
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UseGuards(TopicAccessGuard)
  @RequireTopicAccess(CollaboratorRole.EDITOR)
  @Post("topics/:topicId/missions/:missionId/resume")
  @ApiOperation({
    summary: "恢复失败的 Mission",
    description: "恢复失败或取消的研究任务，继续执行未完成的部分",
  })
  @ApiParam({ name: "topicId", description: "专题ID" })
  @ApiParam({ name: "missionId", description: "Mission ID" })
  @ApiResponse({ status: 200, description: "恢复成功" })
  @ApiResponse({ status: 403, description: "无权限" })
  async resumeMission(
    @Param("topicId") _topicId: string, // Used by TopicAccessGuard for permission check
    @Param("missionId") missionId: string,
  ) {
    // ★ 权限检查已由 TopicAccessGuard 完成（使用 _topicId 验证权限）
    const result = await this.checkpointService.resumeMission(missionId);
    return result;
  }

  /**
   * 获取可恢复的 Mission 列表
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("resumable-missions")
  @ApiOperation({
    summary: "获取可恢复的 Mission 列表",
    description: "获取当前用户所有可恢复的失败/取消研究任务",
  })
  @ApiResponse({ status: 200, description: "返回可恢复任务列表" })
  async getResumableMissions(@Request() req: RequestWithUser) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    const missions = await this.checkpointService.getResumableMissions(userId);
    return missions;
  }

  /**
   * 手动触发健康检查
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("admin/health-check")
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: "手动触发健康检查",
    description: "管理员手动触发所有活跃任务的健康检查",
  })
  @ApiResponse({ status: 200, description: "健康检查完成" })
  async triggerHealthCheck(@Request() req: RequestWithUser) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    const result = await this.healthService.forceHealthCheck();
    return result;
  }
}
