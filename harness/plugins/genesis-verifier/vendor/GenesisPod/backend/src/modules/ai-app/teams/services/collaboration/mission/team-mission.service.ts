import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  emitUserEvent,
  MODULE,
  ACTION,
} from "@/common/observability/user-event.types";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { Prisma } from "@prisma/client";
import {
  MissionStatus,
  AgentTaskStatus,
  TaskPriority,
  TaskType,
  MissionLogType,
  MessageContentType,
} from "@prisma/client";
import { CreateMissionDto } from "../../../dto/create-mission.dto";
// ★ 架构重构：通过 ToolRegistry 调用工具
import { ToolRegistry } from "@/modules/ai-harness/facade";
import type { ToolContext } from "@/modules/ai-harness/facade";
import { TopicEventEmitterService } from "../../events";
import {
  mapWithConcurrency,
  ConcurrencyLimits,
} from "../../../../../../common/utils/concurrency.utils";
import { TeamsLongContentService } from "../../ai/teams-long-content.service";
import { LeaderModelService } from "../../ai/leader-model.service";
// ★ AI Engine 能力下沉：使用 AI Engine 的熔断器服务（通过 AIFacade 访问）
import { TaskCompletionType } from "@/modules/ai-harness/facade";
import { MissionCompletionPreset } from "../../../../../platform/facade";
import { ConfigService } from "@nestjs/config";
import {
  findMemberByNameEnhanced,
  createMatchStatistics,
  isMatchFailureRateExceeded,
  formatMatchFailureError,
  type MatchStatistics,
  type UnmatchedItem,
} from "../utils";
import { MissionContextService } from "@/modules/ai-harness/facade";
import {
  MissionContextPackage,
  HardConstraint,
} from "@/modules/ai-harness/facade";
import { ConstraintEnforcementService } from "@/modules/ai-harness/facade";
import { MissionStateManager } from "@/modules/ai-harness/facade";
import { MissionLifecycleService } from "./mission-lifecycle.service";
import { MissionRetryService } from "./mission-retry.service";
import { MissionHealthCheckService } from "./mission-health-check.service";
import {
  MissionAICallerService,
  AICallOptions,
} from "./mission-ai-caller.service";
import { TeamMessageService } from "./team-message.service";
import { TeamMemberService } from "./team-member.service";
// ★ AI Engine 能力下沉：使用 AI Engine 的上下文初始化服务（通过 AIFacade 访问）
import { RETRY_CONFIG, AGENT_SWITCH_CONFIG } from "../config";
import {
  isRetryableError,
  isRateLimitError,
  isPermanentError,
  isApiErrorContent,
  sleep,
  parseReviewResult,
  extractChapterKey,
  extractStructureHint,
  detectLargeContentTask,
  extractWordCount,
  mapTaskType,
  truncateDescription,
  needsWebSearch,
  buildSearchQuery,
  validateChapterSequence,
} from "../utils";
import {
  MissionWithRelations,
  MissionWithTopic,
  TeamMemberBase,
  AgentTaskWithAssignee,
  TaskBreakdownItem,
  TaskBreakdownData,
  TaskAssignee,
} from "../interfaces";
import { AgentFacade, TeamFacade } from "@/modules/ai-harness/facade";
import { ProgressTrackerService } from "@/modules/ai-harness/facade";
import {
  MissionExecutorService,
  EventJournalService,
  MissionContext,
} from "@/modules/ai-harness/facade";
import { LruMap } from "@/common/utils/lru-map";

// 注：ReviewResult 已迁移至 ./utils/parsing.utils.ts

@Injectable()
export class TeamMissionService implements OnModuleInit {
  private readonly logger = new Logger(TeamMissionService.name);

  // ==================== 并发控制锁 ====================
  // 注：并发状态管理已迁移至 MissionStateManager 服务
  // - executingTasks -> stateManager.isTaskExecuting/startTask/finishTask
  // - executingMissions -> stateManager.isMissionExecuting/startMissionExecution/finishMissionExecution
  // - revisingTasks -> stateManager.isRevisionInProgress/startRevision/finishRevision

  /**
   * ★ 待执行标记：当嵌套的 executeNextTasks 调用被跳过时，记录下来
   * 在锁释放后自动重新执行，避免任务卡住
   */
  private pendingExecutions = new Set<string>();

  // ★ AI Kernel: missionId → kernel processId 映射
  private readonly kernelProcessIds = new LruMap<string, string>(500);

  // ==================== 配置常量 ====================
  // 注：配置已迁移至 ./config/mission.config.ts
  // - RETRY_CONFIG: 重试配置
  // - AGENT_SWITCH_CONFIG: Agent 切换配置
  // - TASK_TIMEOUT_CONFIG: 任务超时配置
  // - LEADER_REVIEW_CONFIG: Leader 审核配置

  constructor(
    private prisma: PrismaService,
    // ★ 架构重构：通过 ToolRegistry 调用工具
    private toolRegistry: ToolRegistry,
    private topicEventEmitter: TopicEventEmitterService,
    private longContentService: TeamsLongContentService,
    private configService: ConfigService,
    private missionContextService: MissionContextService,
    private constraintEnforcementService: ConstraintEnforcementService,
    private stateManager: MissionStateManager,
    private lifecycleService: MissionLifecycleService,
    private retryService: MissionRetryService,
    private healthCheckService: MissionHealthCheckService,
    // ★ Leader 模型容错服务：支持重试和模型切换
    private leaderModelService: LeaderModelService,
    // ★ AI 调用服务：封装基础 AI 调用和 Token 追踪
    private aiCallerService: MissionAICallerService,
    // ★ 消息和日志服务：处理消息发送和日志记录
    private messageService: TeamMessageService,
    // ★ 团队成员服务：管理团队成员和 Leader
    private memberService: TeamMemberService,
    private agentFacade: AgentFacade,
    private teamFacade: TeamFacade,
    @Optional()
    // PR-DR1b R1 arch P0 整改：迁到 dispatcher 走偏好矩阵
    private missionCompletionPreset?: MissionCompletionPreset,
    // ★ AI Kernel: 进程生命周期追踪（可选依赖）
    @Optional() private readonly missionExecutor?: MissionExecutorService,
    @Optional() private readonly kernelJournal?: EventJournalService,
    @Optional() private readonly progressTracker?: ProgressTrackerService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * 创建工具执行上下文
   */
  private createToolContext(toolId: string): ToolContext {
    return {
      executionId: `${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolId,
      createdAt: new Date(),
      callerType: "agent",
    };
  }

  // ==================== 生命周期钩子 ====================

  /**
   * 服务启动时恢复卡住的任务
   * - 重置超过 30 分钟的 IN_PROGRESS 任务为 PENDING
   * - 重置超过 30 分钟的 IN_PROGRESS Mission 为 BLOCKED（等待人工干预）
   */
  async onModuleInit(): Promise<void> {
    this.logger.log(
      `[TeamMissionService] Initializing - checking for stuck tasks...`,
    );
    await this.recoverStuckTasks();

    // 注册健康检查回调
    this.healthCheckService.registerExecuteCallback((missionId: string) =>
      this.executeNextTasks(missionId),
    );

    // 注册修订恢复回调
    this.healthCheckService.registerRevisionCallback((missionId: string) =>
      this.recoverRevisionTasks(missionId),
    );
  }

  /**
   * 恢复卡住的修订任务
   * 查找 REVISION_NEEDED 状态的任务并重新触发修订
   */
  private async recoverRevisionTasks(missionId: string): Promise<void> {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
      include: {
        tasks: {
          where: { status: AgentTaskStatus.REVISION_NEEDED },
          include: { assignedTo: true },
        },
        leader: true,
      },
    });

    if (!mission || mission.status !== MissionStatus.IN_PROGRESS) {
      return;
    }

    this.logger.log(
      `[recoverRevisionTasks] Found ${mission.tasks.length} tasks needing revision for mission ${missionId}`,
    );

    // 依次触发修订（避免并发问题）
    for (const task of mission.tasks) {
      if (!task.leaderFeedback) {
        this.logger.warn(
          `[recoverRevisionTasks] Task ${task.id} has no leader feedback, skipping`,
        );
        continue;
      }

      this.logger.log(
        `[recoverRevisionTasks] Triggering revision for task "${task.title}" (${task.id})`,
      );

      try {
        await this.executeTaskRevision(
          mission as MissionWithRelations,
          task as AgentTaskWithAssignee,
          task.leaderFeedback,
        );
      } catch (error) {
        this.logger.error(
          `[recoverRevisionTasks] Failed to trigger revision for task ${task.id}: ${error}`,
        );
      }
    }
  }

  /**
   * 恢复卡住的任务和 Mission
   */
  private async recoverStuckTasks(): Promise<void> {
    const stuckThreshold = new Date(Date.now() - 30 * 60 * 1000); // 30 分钟前

    try {
      // 恢复卡住的 AgentTask（IN_PROGRESS 且 startedAt 超过 30 分钟）
      const stuckTasks = await this.prisma.agentTask.findMany({
        where: {
          status: AgentTaskStatus.IN_PROGRESS,
          startedAt: { lt: stuckThreshold },
        },
        include: {
          mission: true,
        },
      });

      if (stuckTasks.length > 0) {
        this.logger.warn(
          `[Recovery] Found ${stuckTasks.length} stuck tasks (IN_PROGRESS > 30min)`,
        );

        for (const task of stuckTasks) {
          await this.prisma.agentTask.update({
            where: { id: task.id },
            data: {
              status: AgentTaskStatus.PENDING,
              startedAt: null,
            },
          });
          this.logger.log(
            `[Recovery] Reset stuck task: ${task.id} (${task.title}) -> PENDING`,
          );
        }
      }

      // 恢复卡住的 Mission（IN_PROGRESS 超过 30 分钟但所有任务都不是 IN_PROGRESS）
      // 使用原始 SQL 查询获取带有 tasks 的 Mission
      const stuckMissions = await this.prisma.teamMission.findMany({
        where: {
          status: MissionStatus.IN_PROGRESS,
          createdAt: { lt: stuckThreshold }, // 使用 createdAt 作为替代
        },
        include: {
          tasks: true,
        },
      });

      // 过滤出没有正在执行任务的 Mission
      const filteredMissions = stuckMissions.filter(
        (mission) =>
          !mission.tasks.some(
            (t: { status: AgentTaskStatus }) =>
              t.status === AgentTaskStatus.IN_PROGRESS,
          ),
      );

      if (filteredMissions.length > 0) {
        this.logger.warn(
          `[Recovery] Found ${filteredMissions.length} stuck missions (IN_PROGRESS > 30min with no active tasks)`,
        );

        for (const mission of filteredMissions) {
          // 检查是否有 PENDING 任务可以继续执行
          const hasPendingTasks = mission.tasks.some(
            (t: { status: AgentTaskStatus }) =>
              t.status === AgentTaskStatus.PENDING,
          );

          if (hasPendingTasks) {
            // 有 PENDING 任务，尝试继续执行
            this.logger.log(
              `[Recovery] Mission ${mission.id} has pending tasks, triggering executeNextTasks`,
            );
            // 异步触发，不等待
            this.executeNextTasks(mission.id).catch((e) =>
              this.logger.error(
                `[Recovery] Failed to resume mission ${mission.id}: ${e}`,
              ),
            );
          } else {
            // 没有 PENDING 任务但仍是 IN_PROGRESS，标记为 PAUSED（需要人工干预）
            await this.prisma.teamMission.update({
              where: { id: mission.id },
              data: {
                status: MissionStatus.PAUSED,
              },
            });
            this.logger.warn(
              `[Recovery] Mission ${mission.id} marked as PAUSED (no pending tasks, stuck state)`,
            );
          }
        }
      }

      const totalRecovered = stuckTasks.length + filteredMissions.length;
      if (totalRecovered === 0) {
        this.logger.log(`[Recovery] No stuck tasks or missions found`);
      } else {
        this.logger.log(
          `[Recovery] Completed: ${stuckTasks.length} tasks reset, ${filteredMissions.length} missions handled`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[Recovery] Failed to recover stuck tasks: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // ==================== AI 模型配置 ====================
  // 注：AI 调用相关方法已迁移至 MissionAICallerService
  // - getModelConfig: 获取模型配置
  // - callAIWithConfig: 使用数据库配置调用 AI
  // - trackMissionTokens: 追踪 Token 消耗
  // - mapTemperatureToCreativity: 映射 temperature
  // - mapMaxTokensToOutputLength: 映射 maxTokens
  // 使用方式：this.aiCallerService.callAIWithConfig(...)

  // ==================== 重试与 Agent 切换辅助方法 ====================
  // 注：工具函数已迁移至 ./utils/retry.utils.ts
  // - isRetryableError, isRateLimitError, isPermanentError, isApiErrorContent, sleep

  /**
   * 查找替代 Agent
   * 优先选择：
   * 1. 当前负载最低的 Agent
   * 2. 非 Leader（除非没有其他选择）
   * 3. 未曾尝试过此任务的 Agent
   */
  private async findAlternativeAgent(
    mission: MissionWithRelations,
    failedAgentIds: string[],
    _task: AgentTaskWithAssignee, // 保留用于未来扩展（如按任务类型选择 Agent）
  ): Promise<TeamMemberBase | null> {
    try {
      // 获取所有团队成员
      const teamMemberResult = await this.getTeamMembers(mission.topicId);
      const allMembers = teamMemberResult.all || [];

      if (allMembers.length <= 1) {
        this.logger.warn(
          `[findAlternativeAgent] No alternative agents available (only ${allMembers.length} member)`,
        );
        return null;
      }

      // 过滤：排除已失败的 Agent 和 Leader（优先）
      const candidates = allMembers.filter(
        (m: TeamMemberBase) => !failedAgentIds.includes(m.id) && !m.isLeader,
      );

      this.logger.log(
        `[findAlternativeAgent] Found ${candidates.length} non-leader candidates (excluded: ${failedAgentIds.join(", ")})`,
      );

      // 如果没有非 Leader 候选，且配置允许，考虑 Leader 作为备选
      if (candidates.length === 0 && AGENT_SWITCH_CONFIG.allowLeaderFallback) {
        const leader = allMembers.find(
          (m: TeamMemberBase) => m.isLeader && !failedAgentIds.includes(m.id),
        );
        if (leader) {
          this.logger.log(
            `[findAlternativeAgent] Using Leader ${leader.displayName} as fallback`,
          );
          return leader;
        }
      }

      if (candidates.length === 0) {
        this.logger.warn(
          `[findAlternativeAgent] No alternative agents available after filtering`,
        );
        return null;
      }

      // 如果启用负载均衡，按当前任务数排序
      if (AGENT_SWITCH_CONFIG.loadBalancingEnabled && candidates.length > 1) {
        const agentTaskCounts = await this.prisma.agentTask.groupBy({
          by: ["assignedToId"],
          where: {
            missionId: mission.id,
            status: { in: ["PENDING", "IN_PROGRESS"] },
          },
          _count: { _all: true },
        });

        const taskCountMap = new Map(
          agentTaskCounts.map((a) => [a.assignedToId, a._count._all]),
        );

        candidates.sort((a: TeamMemberBase, b: TeamMemberBase) => {
          const countA = taskCountMap.get(a.id) || 0;
          const countB = taskCountMap.get(b.id) || 0;
          return countA - countB;
        });

        this.logger.log(
          `[findAlternativeAgent] Sorted by load: ${candidates.map((c: TeamMemberBase) => `${c.displayName}(${taskCountMap.get(c.id) || 0})`).join(", ")}`,
        );
      }

      const selected = candidates[0];
      this.logger.log(
        `[findAlternativeAgent] Selected: ${selected.displayName} (${selected.aiModel})`,
      );
      return selected;
    } catch (error) {
      this.logger.error(`[findAlternativeAgent] Error:`, error);
      return null;
    }
  }

  /**
   * 带重试的 AI 调用
   * 支持指数退避重试策略
   * ★ 支持心跳机制，让前端实时感知 Agent 正在工作
   */
  private async callAIWithRetry(
    aiModel: string,
    messages: { role: string; content: string }[],
    systemPrompt: string,
    options: Omit<AICallOptions, "missionId">,
    taskContext: { taskId: string; taskTitle: string; missionId: string },
    heartbeatContext?: {
      topicId: string;
      agentId: string;
      agentName: string;
    },
  ): Promise<{
    success: boolean;
    content?: string;
    error?: string;
    attempts: number;
    finalModel: string;
  }> {
    const { maxRetries, initialDelayMs, maxDelayMs, backoffMultiplier } =
      RETRY_CONFIG;
    let lastError = "";

    // ★ 心跳机制：每 3 秒发送一次状态更新，让前端知道 Agent 还活着
    const HEARTBEAT_INTERVAL_MS = 3000;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let heartbeatCount = 0;

    const startHeartbeat = () => {
      if (!heartbeatContext) return;
      heartbeatCount = 0;
      heartbeatTimer = setInterval(() => {
        heartbeatCount++;
        void this.topicEventEmitter.emitToTopic(
          heartbeatContext.topicId,
          "mission:agent_working",
          {
            missionId: taskContext.missionId,
            taskId: taskContext.taskId,
            agentId: heartbeatContext.agentId,
            agentName: heartbeatContext.agentName,
            status: "thinking",
            heartbeat: heartbeatCount,
            elapsedSeconds: heartbeatCount * 3,
          },
        );
      }, HEARTBEAT_INTERVAL_MS);
    };

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(
          `[callAIWithRetry] Task "${taskContext.taskTitle}" attempt ${attempt}/${maxRetries} with model ${aiModel}`,
        );

        // ★ 启动心跳
        startHeartbeat();

        const response = await this.aiCallerService.callAIWithConfig(
          aiModel,
          messages,
          systemPrompt,
          { ...options, missionId: taskContext.missionId },
        );

        // ★ 停止心跳
        stopHeartbeat();

        this.logger.log(
          `[callAIWithRetry] Task "${taskContext.taskTitle}" succeeded on attempt ${attempt}`,
        );

        return {
          success: true,
          content: response.content,
          attempts: attempt,
          finalModel: aiModel,
        };
      } catch (error) {
        // ★ 停止心跳
        stopHeartbeat();

        lastError = error instanceof Error ? error.message : String(error);

        this.logger.warn(
          `[callAIWithRetry] Task "${taskContext.taskTitle}" attempt ${attempt}/${maxRetries} failed: ${lastError}`,
        );

        // 检查是否应该重试
        if (attempt < maxRetries && isRetryableError(lastError)) {
          const delay = Math.min(
            initialDelayMs * Math.pow(backoffMultiplier, attempt - 1),
            maxDelayMs,
          );
          this.logger.log(
            `[callAIWithRetry] Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`,
          );
          await sleep(delay);
          continue;
        }

        // 不可重试或已达最大重试次数
        break;
      }
    }

    return {
      success: false,
      error: lastError,
      attempts: maxRetries,
      finalModel: aiModel,
    };
  }

  // ==================== 创建团队任务 ====================

  async createMission(topicId: string, userId: string, dto: CreateMissionDto) {
    this.logger.log(`Creating mission in topic ${topicId}: ${dto.title}`);

    // 验证 Leader 存在且是该 Topic 的成员
    const leader = await this.prisma.topicAIMember.findFirst({
      where: {
        id: dto.leaderId,
        topicId,
      },
    });

    if (!leader) {
      throw new NotFoundException("指定的 Leader 不存在于该讨论组");
    }

    // 创建任务
    const mission = await this.prisma.teamMission.create({
      data: {
        topicId,
        title: dto.title,
        description: dto.description,
        objectives: dto.objectives || [],
        constraints: dto.constraints || [],
        deliverables: dto.deliverables || [],
        leaderId: dto.leaderId,
        createdById: userId,
        status: MissionStatus.PENDING,
        notificationEmail: dto.notificationEmail || null, // 任务完成通知邮箱
      },
      include: {
        leader: true,
        createdBy: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    // 记录日志
    await this.createLog(mission.id, {
      type: MissionLogType.MISSION_CREATED,
      agentId: leader.id,
      agentName: leader.agentName || leader.displayName,
      content: `任务「${dto.title}」已创建，指定 ${leader.agentName || leader.displayName} 为 Leader`,
    });

    // 发送系统消息到群聊
    const systemMessage = await this.sendMessageToTopic(
      topicId,
      null,
      `🚀 **团队任务已创建**\n\n**任务**：${dto.title}\n**Leader**：@${leader.agentName || leader.displayName}\n\n任务即将开始规划...`,
      MessageContentType.SYSTEM,
    );

    // 广播任务创建事件
    void this.topicEventEmitter.emitToTopic(topicId, "mission:created", {
      mission,
      messageId: systemMessage?.id,
    });

    // 如果自动开始（默认），则启动任务
    if (dto.autoStart !== false) {
      // 异步启动，不阻塞返回
      this.startMission(mission.id, userId).catch((err) => {
        this.logger.error(`Failed to start mission ${mission.id}: ${err}`);
      });
    }

    return mission;
  }

  // ==================== 启动任务（Leader 规划） ====================

  async startMission(missionId: string, _userId: string) {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
      include: {
        leader: true,
        topic: {
          include: {
            aiMembers: true,
          },
        },
      },
    });

    if (!mission) {
      throw new NotFoundException("任务不存在");
    }

    if (mission.status !== MissionStatus.PENDING) {
      throw new BadRequestException("任务已经启动或已完成");
    }

    // 更新状态为规划中
    await this.prisma.teamMission.update({
      where: { id: missionId },
      data: {
        status: MissionStatus.PLANNING,
        startedAt: new Date(),
      },
    });

    await this.createLog(missionId, {
      type: MissionLogType.PLANNING_STARTED,
      agentId: mission.leader.id,
      agentName: mission.leader.agentName || mission.leader.displayName,
      content: "Leader 开始规划任务分解...",
    });

    // ★ AI Kernel: 创建进程记录
    if (this.missionExecutor) {
      try {
        const kernelResult = await this.missionExecutor.execute({
          userId: _userId,
          agentId: mission.leader.id,
          teamSessionId: missionId,
          input: {
            title: mission.title,
            description: mission.description,
            topicId: mission.topicId,
          },
        });
        this.kernelProcessIds.set(missionId, kernelResult.processId);
        this.logger.log(
          `[Kernel] Process ${kernelResult.processId} spawned for mission ${missionId}`,
        );
      } catch (err) {
        this.logger.warn(
          `[Kernel] Failed to spawn process: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // ★ AI Kernel: 初始化进度追踪（三阶段：planning / execution / synthesis）
    if (this.progressTracker) {
      this.progressTracker.create({
        id: missionId,
        type: "team-mission",
        name: `Team Mission: ${missionId}`,
        roomConfig: {
          roomId: `mission:${missionId}`,
          roomType: "mission",
          entityId: missionId,
        },
        phases: [
          { id: "planning", name: "Leader Planning", weight: 1 },
          { id: "execution", name: "Member Execution", weight: 3 },
          { id: "synthesis", name: "Leader Synthesis", weight: 2 },
        ],
      });
      this.progressTracker.start(missionId);
      this.progressTracker.startPhase(missionId, "planning");
    }

    const teamProcessId = this.kernelProcessIds.get(missionId);
    const runMission = async () => {
      // 广播状态变更
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:status_changed",
        {
          missionId,
          status: MissionStatus.PLANNING,
          previousStatus: MissionStatus.PENDING,
        },
      );

      // 广播 Leader 开始规划 (显示 thinking 状态)
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:agent_working",
        {
          missionId: mission.id,
          taskId: null,
          agentId: mission.leader.id,
          agentName: mission.leader.agentName || mission.leader.displayName,
          status: "planning",
        },
      );

      // 发送 Leader 正在思考的消息
      await this.sendMessageToTopic(
        mission.topicId,
        mission.leader.id,
        `[任务分解]\n\n收到任务！正在分析需求并进行任务分解...`,
        MessageContentType.TEXT,
      );

      // 初始化长内容处理服务
      try {
        await this.longContentService.initMission({
          missionId: mission.id,
          missionTitle: mission.title,
          missionDescription: mission.description || "",
          objectives: mission.objectives || [],
          constraints: mission.constraints || [],
          expectedTaskCount: mission.totalTasks || undefined,
          granularityLevel: "chapter", // 默认按章节粒度分解
        });
        this.logger.log(
          `[startMission] Long content service initialized for mission: ${mission.id}`,
        );
      } catch (error) {
        this.logger.warn(
          `[startMission] Failed to init long content service: ${error}`,
        );
        // 不阻塞任务执行，长内容服务初始化失败时继续执行
      }

      // ★ 从用户输入中提取约束（包括 MUST 约束如 "钟叔是哑巴"）
      try {
        const extractedConstraints =
          this.constraintEnforcementService.extractConstraints(
            mission.description || "",
          );

        if (extractedConstraints.length > 0) {
          // 转换为 HardConstraint 格式
          const hardConstraints =
            this.constraintEnforcementService.toHardConstraints(
              extractedConstraints,
            );

          // 存储到数据库
          await this.prisma.teamMission.update({
            where: { id: mission.id },
            data: {
              mustConstraints:
                hardConstraints as unknown as Prisma.InputJsonValue,
            },
          });

          // ★ 同时更新内存中的 mission 对象，确保后续流程可以访问
          mission.mustConstraints =
            hardConstraints as unknown as Prisma.JsonValue;

          this.logger.log(
            `[startMission] Extracted ${hardConstraints.length} constraints from mission description:`,
          );
          for (const c of hardConstraints) {
            this.logger.log(`  - [${c.id}] ${c.rule} (${c.severity})`);
          }
        }
      } catch (error) {
        this.logger.warn(
          `[startMission] Failed to extract constraints: ${error}`,
        );
        // 不阻塞任务执行
      }

      // ★ 世界观设定前置：对于大型内容创作任务，先生成核心设定
      // 解决问题：用户只写"写一部宫廷小说"，多个Agent各自发明设定导致不一致
      try {
        const worldBuildingResult =
          await this.teamFacade.contextInit?.buildWorldContext(
            mission.title,
            mission.description || "",
            async (_model, messages, options) => {
              // ★ 使用 LeaderModelService 支持重试和模型切换
              const result = await this.leaderModelService.executeWithFallback(
                mission.leader.aiModel,
                async (modelConfig) => {
                  const response = await this.aiCallerService.callAIWithConfig(
                    modelConfig.modelId,
                    messages.map((m) => ({ role: m.role, content: m.content })),
                    messages.find((m) => m.role === "system")?.content || "",
                    {
                      maxTokens: options?.maxTokens,
                      temperature: options?.temperature,
                      missionId: mission.id,
                    },
                  );
                  return {
                    content: response.content || "",
                    tokensUsed: response.tokensUsed || 0,
                  };
                },
                {
                  operation: "world_building",
                  context: { missionId: mission.id },
                },
              );
              if (!result.success || !result.data) {
                throw new Error(
                  `世界观构建失败: ${result.error?.message || "未知错误"}`,
                );
              }
              return result.data;
            },
            mission.leader.aiModel,
          );

        if (
          worldBuildingResult?.needed &&
          worldBuildingResult.hardConstraints
        ) {
          this.logger.log(
            `[startMission] World building completed: ${worldBuildingResult.hardConstraints.length} constraints, type: ${worldBuildingResult.contentType}`,
          );

          // 合并世界观约束到现有约束
          const existingConstraints = Array.isArray(mission.mustConstraints)
            ? (mission.mustConstraints as unknown as HardConstraint[])
            : [];
          const mergedConstraints = [
            ...existingConstraints,
            ...worldBuildingResult.hardConstraints,
          ];

          // 更新到数据库
          await this.prisma.teamMission.update({
            where: { id: mission.id },
            data: {
              mustConstraints:
                mergedConstraints as unknown as Prisma.InputJsonValue,
            },
          });

          // 更新内存中的 mission 对象
          mission.mustConstraints =
            mergedConstraints as unknown as Prisma.JsonValue;

          // 发送世界观设定消息到群聊
          if (worldBuildingResult?.settings) {
            const settingsMessage =
              this.teamFacade.contextInit?.formatWorldSettingsMessage(
                worldBuildingResult.settings,
              ) ?? "";
            await this.sendMessageToTopic(
              mission.topicId,
              mission.leader.id,
              settingsMessage,
              MessageContentType.TEXT,
            );
          }

          await this.createLog(mission.id, {
            type: MissionLogType.PLANNING_STARTED,
            agentId: mission.leader.id,
            agentName: mission.leader.agentName || mission.leader.displayName,
            content: `世界观设定完成，已确立 ${worldBuildingResult.hardConstraints.length} 条核心约束`,
          });
        }
      } catch (error) {
        this.logger.warn(
          `[startMission] Failed to build world context: ${error instanceof Error ? error.message : error}`,
        );
        // 不阻塞任务执行，世界观生成失败时继续用传统流程
      }

      // 执行 Leader 任务规划
      await this.executeLeaderPlanning(mission);
    }; // end runMission

    await (teamProcessId
      ? MissionContext.run(
          { agentProcessId: teamProcessId, userId: _userId },
          runMission,
        )
      : runMission());
  }

  // ==================== Leader 规划任务 ====================

  private async executeLeaderPlanning(mission: MissionWithTopic) {
    const { leader, topic } = mission;
    const teamMembers = topic.aiMembers;

    try {
      // 构建 Leader 规划提示词
      // 使用类型断言，因为 MissionWithTopic 包含所有必需字段
      let planningPrompt = this.buildLeaderPlanningPrompt(
        mission as MissionWithRelations,
        leader,
        teamMembers,
      );

      // 添加粒度约束（确保按用户要求的粒度分解任务）
      try {
        const granularityConstraint =
          this.longContentService.buildGranularityConstraintPrompt(mission.id);
        if (granularityConstraint) {
          planningPrompt += `\n\n${granularityConstraint}`;
          this.logger.debug(
            `[executeLeaderPlanning] Added granularity constraint for mission: ${mission.id}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `[executeLeaderPlanning] Failed to get granularity constraint: ${error}`,
        );
        // 继续执行，不阻塞
      }

      // 调用 AI 生成任务分解 (使用数据库 API Key)
      // ★ 带重试机制：如果上下文过大失败，自动用更短的描述重试
      let aiResponse;
      // ★ 更激进的截断级别，处理超长内容
      const descriptionLengthLevels = [8000, 4000, 2000, 1000, 500]; // 逐级缩短
      let lastError: Error | null = null;

      for (const maxDescLen of descriptionLengthLevels) {
        try {
          // 重新构建 prompt（可能使用更短的描述）
          const currentPrompt =
            maxDescLen === 8000
              ? planningPrompt
              : this.buildLeaderPlanningPrompt(
                  mission as MissionWithRelations,
                  leader,
                  teamMembers,
                  maxDescLen,
                );

          if (maxDescLen < 8000) {
            this.logger.warn(
              `[executeLeaderPlanning] Retrying with shorter description: maxDescLen=${maxDescLen}`,
            );
          }

          // ★ 诊断日志：记录实际 prompt 大小
          const promptLength = currentPrompt.length;
          const systemPromptLength = this.getLeaderSystemPrompt(leader).length;
          this.logger.log(
            `[executeLeaderPlanning] Prompt sizes: userPrompt=${promptLength} chars, systemPrompt=${systemPromptLength} chars, total=${promptLength + systemPromptLength} chars (~${Math.round((promptLength + systemPromptLength) / 4)} tokens), maxDescLen=${maxDescLen}`,
          );

          // ★ 增加 maxTokens 到 16000，以支持大量任务（如 96+ 章节）的规划输出
          // 原 8000 tokens 约能输出 12-15 个任务，对于长篇小说远远不够
          // ★ 使用 LeaderModelService 执行，支持重试和模型切换
          const systemPrompt = this.getLeaderSystemPrompt(leader);
          const result = await this.leaderModelService.executeWithFallback(
            leader.aiModel,
            async (modelConfig) => {
              return this.aiCallerService.callAIWithConfig(
                modelConfig.modelId,
                [{ role: "user", content: currentPrompt }],
                systemPrompt,
                {
                  taskProfile: { creativity: "medium", outputLength: "long" },
                  missionId: mission.id,
                },
              );
            },
            {
              operation: "leader_planning",
              context: { missionId: mission.id },
            },
          );

          if (result.success && result.data) {
            aiResponse = result.data;
            if (result.fallbackUsed) {
              this.logger.log(
                `[executeLeaderPlanning] Used fallback model ${result.modelUsed} (original: ${leader.aiModel})`,
              );
            }
          } else {
            // 模型切换失败，抛出错误让外层重试逻辑处理
            throw new Error(
              result.error?.getUserMessage() || "All leader models failed",
            );
          }

          // ★ 检查响应是否实际上是错误消息（以 "API Error:" 开头）
          if (aiResponse?.content?.startsWith("API Error:")) {
            const errorContent = aiResponse.content;
            this.logger.warn(
              `[executeLeaderPlanning] Received error as content: ${errorContent.substring(0, 200)}`,
            );
            // 检查是否是上下文相关错误
            if (
              errorContent.includes("截断") ||
              errorContent.includes("上下文") ||
              errorContent.includes("context") ||
              errorContent.includes("token") ||
              errorContent.includes("length")
            ) {
              lastError = new Error(errorContent);
              continue; // 重试
            }
            // 其他 API 错误，抛出
            throw new Error(errorContent);
          }

          // 成功则跳出循环
          if (maxDescLen < 8000) {
            this.logger.log(
              `[executeLeaderPlanning] Succeeded with maxDescLen=${maxDescLen}`,
            );
          }
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const errorMsg = lastError.message;

          // 只有上下文过大的错误才重试
          if (
            errorMsg.includes("截断") ||
            errorMsg.includes("上下文") ||
            errorMsg.includes("context") ||
            errorMsg.includes("token") ||
            errorMsg.includes("length") // ★ 添加 length 检查
          ) {
            this.logger.warn(
              `[executeLeaderPlanning] Context too large with maxDescLen=${maxDescLen}, will retry with shorter`,
            );
            continue; // 尝试更短的描述
          }

          // 其他错误直接抛出
          this.logger.error(
            `[executeLeaderPlanning] Planning AI call failed: ${errorMsg}`,
          );
          throw new Error(`任务规划失败: ${errorMsg}`);
        }
      }

      // 如果所有重试都失败
      if (!aiResponse) {
        const errorMsg = lastError?.message || "未知错误";
        this.logger.error(
          `[executeLeaderPlanning] All retries failed: ${errorMsg}`,
        );
        throw new Error(`任务规划失败（已尝试缩短描述但仍失败）: ${errorMsg}`);
      }

      // 解析任务分解结果
      const breakdown = this.parseTaskBreakdown(
        aiResponse.content,
        teamMembers,
      );

      // 提取 Mission Context Package (从 Leader 输出的 JSON 中)
      const contextPackage =
        this.missionContextService.extractContextFromLeaderOutput(
          aiResponse.content,
          leader.id,
        );
      if (contextPackage) {
        this.logger.log(
          `[startMission] Extracted context with ${contextPackage.entities.length} entities, ${contextPackage.hardConstraints.length} constraints`,
        );
      }

      // 验证任务分解数量是否符合预期
      try {
        const validation = this.longContentService.validateTaskCount(
          mission.id,
          breakdown.tasks.length,
        );
        if (!validation.isValid) {
          this.logger.warn(
            `[executeLeaderPlanning] Task count validation failed: ${validation.warning}`,
          );
          // 记录警告日志（使用 LEADER_FEEDBACK 类型），但不阻塞执行
          await this.createLog(mission.id, {
            type: MissionLogType.LEADER_FEEDBACK,
            agentId: leader.id,
            agentName: leader.agentName || leader.displayName,
            content: `⚠️ 任务数量校验警告\n${validation.warning}\n${validation.suggestion || ""}`,
          });
        } else if (validation.warning) {
          this.logger.log(
            `[executeLeaderPlanning] Task count info: ${validation.warning}`,
          );
        }
      } catch (error) {
        this.logger.debug(
          `[executeLeaderPlanning] Task count validation skipped: ${error}`,
        );
      }

      // 保存任务分解方案和上下文
      await this.prisma.teamMission.update({
        where: { id: mission.id },
        data: {
          taskBreakdown: breakdown as unknown as Prisma.InputJsonValue,
          contextPackage: contextPackage as unknown as Prisma.InputJsonValue,
        },
      });

      // 发送任务分解消息到群聊
      const planningMessage = await this.sendMessageToTopic(
        mission.topicId,
        leader.id,
        aiResponse.content,
        MessageContentType.TEXT,
      );

      await this.createLog(mission.id, {
        type: MissionLogType.PLANNING_COMPLETED,
        agentId: leader.id,
        agentName: leader.agentName || leader.displayName,
        content: `任务分解完成，共 ${breakdown.tasks.length} 个子任务`,
        messageId: planningMessage?.id,
      });

      // 创建子任务
      await this.createTasksFromBreakdown(mission.id, breakdown, teamMembers);

      // ★ 查询创建的任务，用于广播给前端
      const createdTasks = await this.prisma.agentTask.findMany({
        where: { missionId: mission.id },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          taskType: true,
          assignedToId: true,
          dependsOnIds: true,
        },
        orderBy: { createdAt: "asc" },
      });

      // 更新状态为执行中
      const startedMission = await this.prisma.teamMission.update({
        where: { id: mission.id },
        data: {
          status: MissionStatus.IN_PROGRESS,
          totalTasks: breakdown.tasks.length,
        },
        select: { createdById: true },
      });

      emitUserEvent(this.eventEmitter, {
        userId: startedMission.createdById,
        module: MODULE.AI_TEAMS,
        action: ACTION.STARTED,
        resourceType: "TeamMission",
        resourceId: mission.id,
        topicKey: mission.topicId,
      });

      // ★ 更新长内容服务的任务总数（修复统计数据错误）
      try {
        this.longContentService.updateTotalTasks(
          mission.id,
          breakdown.tasks.length,
        );
      } catch (error) {
        this.logger.warn(
          `[startMission] Failed to update long content totalTasks: ${error}`,
        );
      }

      // 广播状态变更（包含 tasks 数据用于前端渲染连线）
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:status_changed",
        {
          missionId: mission.id,
          status: MissionStatus.IN_PROGRESS,
          previousStatus: MissionStatus.PLANNING,
          totalTasks: breakdown.tasks.length,
          tasks: createdTasks, // ★ 新增：携带完整 tasks 数据
        },
      );

      // 清除 Leader 规划状态 (规划完成)
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:agent_done",
        {
          missionId: mission.id,
          taskId: null,
          agentId: leader.id,
        },
      );

      // ★ 进度追踪：规划阶段完成，切换到执行阶段
      if (this.progressTracker) {
        this.progressTracker.completePhase(mission.id, "planning");
        this.progressTracker.startPhase(mission.id, "execution");
      }

      // 开始执行任务
      await this.executeNextTasks(mission.id);
    } catch (error) {
      this.logger.error(`Leader planning failed: ${error}`);

      // 清除 Leader 规划状态 (规划失败)
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:agent_done",
        {
          missionId: mission.id,
          taskId: null,
          agentId: leader.id,
        },
      );

      const failedMission = await this.prisma.teamMission.update({
        where: { id: mission.id },
        data: { status: MissionStatus.FAILED },
        select: { createdById: true },
      });

      emitUserEvent(this.eventEmitter, {
        userId: failedMission.createdById,
        module: MODULE.AI_TEAMS,
        action: ACTION.FAILED,
        resourceType: "TeamMission",
        resourceId: mission.id,
        topicKey: mission.topicId,
      });

      // ★ AI Kernel: 标记进程失败
      this.failKernelProcess(
        mission.id,
        error instanceof Error ? error.message : "Planning failed",
      );

      // ★ 进度追踪：fail active phase, then mark task failed
      if (this.progressTracker) {
        const errMsg =
          error instanceof Error ? error.message : "Planning failed";
        const task = this.progressTracker.getTask(mission.id);
        if (task) {
          for (const phase of task.phases) {
            if (phase.status === "in_progress") {
              this.progressTracker.failPhase(mission.id, phase.id, errMsg);
            }
          }
        }
        this.progressTracker.fail(mission.id, errMsg);
      }

      await this.sendMessageToTopic(
        mission.topicId,
        leader.id,
        `❌ 任务规划失败：${error instanceof Error ? error.message : "未知错误"}`,
        MessageContentType.TEXT,
      );
    }
  }

  // ==================== 执行下一批任务 ====================

  private async executeNextTasks(missionId: string) {
    // 🔒 并发控制：防止同一 Mission 的 executeNextTasks 被并发调用
    if (!this.stateManager.startMissionExecution(missionId)) {
      // ★ 修复：记录待执行标记，而不是直接跳过
      // 当父级 executeNextTasks 释放锁后，会自动重新执行
      this.pendingExecutions.add(missionId);
      this.logger.debug(
        `[executeNextTasks] Mission ${missionId} is already being processed, marked for re-execution`,
      );
      return;
    }
    this.logger.debug(
      `[executeNextTasks] Acquired lock for mission ${missionId}`,
    );

    try {
      const mission = await this.prisma.teamMission.findUnique({
        where: { id: missionId },
        include: {
          tasks: {
            include: {
              assignedTo: true,
            },
          },
          leader: true,
        },
      });

      if (!mission || mission.status !== MissionStatus.IN_PROGRESS) {
        return;
      }

      // 找出所有可以开始的任务（依赖已完成，且不在执行中）
      // ★ 按创建时间排序，确保按顺序执行
      const pendingTasks = mission.tasks
        .filter(
          (t) =>
            t.status === AgentTaskStatus.PENDING &&
            !this.stateManager.isTaskExecuting(t.id), // 🔒 排除已在执行中的任务
        )
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );

      const tasksToStart: typeof pendingTasks = [];

      for (const task of pendingTasks) {
        const dependsOnIds = task.dependsOnIds || [];

        // 检查所有依赖是否已完成
        const allDependenciesCompleted = dependsOnIds.every((depId) => {
          const depTask = mission.tasks.find((t) => t.id === depId);
          return depTask?.status === AgentTaskStatus.COMPLETED;
        });

        if (allDependenciesCompleted) {
          tasksToStart.push(task);
        }
      }

      // 使用依赖检查后的任务列表
      // ★ 注意：如果 Leader 没有设置依赖关系，说明任务可以并行执行（有大纲参考）
      const finalTasksToStart = tasksToStart;

      if (finalTasksToStart.length === 0) {
        // 检查是否所有任务都已完成
        const completedTasks = mission.tasks.filter(
          (t) => t.status === AgentTaskStatus.COMPLETED,
        );
        const allCompleted = completedTasks.length === mission.tasks.length;

        if (allCompleted) {
          // ★ 进度追踪：执行阶段完成，切换到合成阶段
          if (this.progressTracker) {
            this.progressTracker.completePhase(missionId, "execution");
            this.progressTracker.startPhase(missionId, "synthesis");
          }
          await this.completeMission(missionId);
          return;
        }

        // ★ 计算完成率，检查是否达到强制完成阈值
        const completionRate = completedTasks.length / mission.tasks.length;
        const FORCE_COMPLETE_THRESHOLD = 0.95; // 95% 完成即可强制完成
        const STUCK_TIMEOUT_MS = 15 * 60 * 1000; // 15 分钟卡住超时
        const now = Date.now();

        // ★ 检查各种状态的任务
        const blockedTasks = mission.tasks.filter(
          (t) => t.status === AgentTaskStatus.BLOCKED,
        );
        const stuckTasks = mission.tasks.filter(
          (t) =>
            t.status === AgentTaskStatus.REVISION_NEEDED ||
            t.status === AgentTaskStatus.AWAITING_REVIEW,
        );
        const inProgressTasks = mission.tasks.filter(
          (t) => t.status === AgentTaskStatus.IN_PROGRESS,
        );

        this.logger.debug(
          `[Mission ${missionId}] Task status: ${completedTasks.length} completed, ${blockedTasks.length} blocked, ${stuckTasks.length} stuck, ${inProgressTasks.length} in progress`,
        );

        // ★ 优先级 1: 如果完成率 >= 95%，强制完成任务
        if (completionRate >= FORCE_COMPLETE_THRESHOLD) {
          const remainingTasks = mission.tasks.filter(
            (t) => t.status !== AgentTaskStatus.COMPLETED,
          );
          this.logger.warn(
            `[Mission ${missionId}] Completion rate ${(completionRate * 100).toFixed(1)}% >= 95%, force completing ${remainingTasks.length} remaining tasks`,
          );

          // 将所有未完成任务标记为已完成
          for (const task of remainingTasks) {
            await this.prisma.agentTask.update({
              where: { id: task.id },
              data: {
                status: AgentTaskStatus.COMPLETED,
                completedAt: new Date(),
                result:
                  task.result ||
                  `[自动完成] 任务在高完成率下被系统自动标记为完成`,
              },
            });
          }

          // ★ 进度追踪：执行阶段完成（强制完成路径），切换到合成阶段
          if (this.progressTracker) {
            this.progressTracker.completePhase(missionId, "execution");
            this.progressTracker.startPhase(missionId, "synthesis");
          }
          await this.completeMission(missionId);
          return;
        }

        // ★ 优先级 2: 处理 BLOCKED 任务 - 尝试自动重试或强制完成
        if (blockedTasks.length > 0) {
          const retriedCount = await this.autoRetryBlockedTasks(
            mission,
            blockedTasks,
            now,
            STUCK_TIMEOUT_MS,
          );

          if (retriedCount > 0) {
            this.logger.log(
              `[Mission ${missionId}] Auto-retried ${retriedCount} blocked tasks`,
            );
            // 递归调用以执行新的待执行任务
            await this.executeNextTasks(missionId);
            return;
          }
        }

        // ★ 优先级 3: 处理卡住的 REVISION_NEEDED / AWAITING_REVIEW 任务
        if (stuckTasks.length > 0) {
          const forceCompletedCount = await this.forceCompleteStuckTasks(
            mission,
            stuckTasks,
            now,
            STUCK_TIMEOUT_MS,
          );

          if (forceCompletedCount > 0) {
            this.logger.log(
              `[Mission ${missionId}] Force completed ${forceCompletedCount} stuck tasks`,
            );
            // 递归调用检查是否可以完成任务
            await this.executeNextTasks(missionId);
            return;
          }

          this.logger.warn(
            `[Mission ${missionId}] Found ${stuckTasks.length} stuck tasks: ${stuckTasks.map((t) => `${t.title}(${t.status})`).join(", ")}`,
          );
        }

        // ★ 检查是否有长时间卡住的 IN_PROGRESS 任务
        if (inProgressTasks.length > 0) {
          const stuckInProgress = inProgressTasks.filter((t) => {
            if (!t.startedAt) return false;
            return now - new Date(t.startedAt).getTime() > STUCK_TIMEOUT_MS;
          });

          if (stuckInProgress.length > 0) {
            this.logger.warn(
              `[Mission ${missionId}] Found ${stuckInProgress.length} tasks stuck in IN_PROGRESS for > 15 min`,
            );
            // 将卡住的 IN_PROGRESS 任务重置为 PENDING
            for (const task of stuckInProgress) {
              await this.prisma.agentTask.update({
                where: { id: task.id },
                data: {
                  status: AgentTaskStatus.PENDING,
                  startedAt: null,
                },
              });
              this.stateManager.finishTask(task.id);
            }
            // 递归调用以重新执行
            await this.executeNextTasks(missionId);
            return;
          }
        }

        // ★★★ 优先级 5: 检查依赖阻塞的 PENDING 任务 ★★★
        const pendingWithDeps = mission.tasks.filter(
          (t) =>
            t.status === AgentTaskStatus.PENDING &&
            (t.dependsOnIds || []).length > 0,
        );

        if (pendingWithDeps.length > 0) {
          // 分析依赖阻塞情况
          const blockedByUnfinished: Array<{
            task: (typeof mission.tasks)[0];
            blockingTasks: Array<{
              id: string;
              title: string;
              status: AgentTaskStatus;
            }>;
          }> = [];

          for (const task of pendingWithDeps) {
            const dependsOnIds = task.dependsOnIds || [];
            const blockingTasks = dependsOnIds
              .map((depId) => mission.tasks.find((t) => t.id === depId))
              .filter(
                (t): t is NonNullable<typeof t> =>
                  !!t && t.status !== AgentTaskStatus.COMPLETED,
              )
              .map((t) => ({ id: t.id, title: t.title, status: t.status }));

            if (blockingTasks.length > 0) {
              blockedByUnfinished.push({ task, blockingTasks });
            }
          }

          if (blockedByUnfinished.length > 0) {
            // 输出详细的依赖阻塞诊断
            this.logger.warn(
              `[Mission ${missionId}] 🔗 Dependency Analysis: ${blockedByUnfinished.length} PENDING tasks blocked by unfinished dependencies`,
            );

            // 只输出前 5 个阻塞任务的详情，避免日志过长
            const sampleBlocked = blockedByUnfinished.slice(0, 5);
            for (const { task, blockingTasks } of sampleBlocked) {
              this.logger.warn(
                `  - "${task.title}" blocked by: ${blockingTasks.map((b) => `"${b.title}"(${b.status})`).join(", ")}`,
              );
            }

            // ★ 依赖松弛策略：如果 Mission 创建时间超过 30 分钟且没有任何进展，考虑松弛依赖
            const DEPENDENCY_RELAX_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟
            const missionAge = now - new Date(mission.createdAt).getTime();

            if (
              missionAge > DEPENDENCY_RELAX_TIMEOUT_MS &&
              inProgressTasks.length === 0
            ) {
              this.logger.warn(
                `[Mission ${missionId}] ⚠️ Mission stuck for ${Math.round(missionAge / 60000)}min with no active tasks. Attempting dependency relaxation...`,
              );

              // 找到可以松弛依赖的任务（依赖任务已经失败或被阻塞超过阈值）
              let relaxedCount = 0;
              for (const { task, blockingTasks } of blockedByUnfinished) {
                // 检查阻塞任务是否都是"无法完成"状态
                // ★ 修复：CANCELLED 状态的依赖也应该触发松弛
                const allBlockersStuck = blockingTasks.every(
                  (b) =>
                    b.status === AgentTaskStatus.BLOCKED ||
                    b.status === AgentTaskStatus.REVISION_NEEDED ||
                    b.status === AgentTaskStatus.CANCELLED,
                );

                // 调试日志：显示阻塞任务状态和判断结果
                this.logger.debug(
                  `[Mission ${missionId}] Dependency check for "${task.title}": ` +
                    `blockers=[${blockingTasks.map((b) => `${b.title}(${b.status})`).join(", ")}], ` +
                    `allBlockersStuck=${allBlockersStuck}`,
                );

                if (allBlockersStuck && relaxedCount < 3) {
                  // 每次最多松弛 3 个任务
                  // 清除依赖，允许任务开始
                  await this.prisma.agentTask.update({
                    where: { id: task.id },
                    data: {
                      dependsOnIds: [], // 清除依赖
                    },
                  });
                  relaxedCount++;
                  this.logger.log(
                    `[Mission ${missionId}] ✅ Relaxed dependencies for task "${task.title}"`,
                  );
                }
              }

              if (relaxedCount > 0) {
                // 递归调用以执行松弛后的任务
                await this.executeNextTasks(missionId);
                return;
              }
            }
          }
        }

        return;
      }

      // 🔒 在执行前先标记所有任务为"执行中"（防止并发重复执行）
      for (const task of finalTasksToStart) {
        this.stateManager.startTask(task.id, task.title);
        this.logger.debug(
          `[executeNextTasks] Marked task ${task.id} (${task.title}) as executing`,
        );
      }

      // ★ 任务开始执行，重置健康检查的恢复计数
      this.healthCheckService.resetRecoveryAttempts(missionId);

      // ★ 优化：批量发送任务分配消息（不阻塞任务执行）
      // 使用 Promise.all 并行发送所有消息，但不等待完成
      const messagePromises = finalTasksToStart.map((task) =>
        this.sendMessageToTopic(
          mission.topicId,
          null,
          `📋 [任务分配] 任务「${task.title}」已分配给 @${task.assignedTo.agentName || task.assignedTo.displayName}`,
          MessageContentType.SYSTEM,
        ).catch((e) =>
          this.logger.warn(
            `[executeNextTasks] Failed to send assignment message: ${e}`,
          ),
        ),
      );

      // 并行执行所有可开始的任务（限制并发数，避免AI调用过载）
      // ★ 优化：消息发送和任务执行同时进行
      await Promise.all([
        Promise.all(messagePromises),
        mapWithConcurrency(
          finalTasksToStart,
          (task) => this.executeTask(mission, task),
          ConcurrencyLimits.AI,
        ),
      ]);
    } finally {
      // 🔒 释放 Mission 锁
      this.stateManager.finishMissionExecution(missionId);
      this.logger.debug(
        `[executeNextTasks] Released lock for mission ${missionId}`,
      );

      // ★ 修复：检查是否有待执行的请求
      // 如果在执行期间有嵌套调用被跳过，现在重新执行
      if (this.pendingExecutions.has(missionId)) {
        this.pendingExecutions.delete(missionId);
        this.logger.log(
          `[executeNextTasks] Re-executing for mission ${missionId} due to pending request`,
        );
        // 使用 setImmediate 避免无限递归调用栈
        setImmediate(() =>
          this.executeNextTasks(missionId).catch((e) =>
            this.logger.error(
              `[executeNextTasks] Re-execution failed for ${missionId}: ${e}`,
            ),
          ),
        );
      }
    }
  }

  // ==================== 执行单个任务 ====================

  private async executeTask(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
  ) {
    const { assignedTo } = task;

    try {
      // 🔒 原子状态更新：使用 CAS 模式，只有 PENDING 状态的任务才能开始执行
      // 这可以防止同一任务被多次执行
      const updateResult = await this.prisma.agentTask.updateMany({
        where: {
          id: task.id,
          status: AgentTaskStatus.PENDING, // 只更新 PENDING 状态的任务
        },
        data: {
          status: AgentTaskStatus.IN_PROGRESS,
          startedAt: new Date(),
        },
      });

      // 如果没有更新任何记录，说明任务已经不是 PENDING 状态（可能被其他调用抢先执行了）
      if (updateResult.count === 0) {
        this.logger.warn(
          `[executeTask] Task "${task.title}" (${task.id}) is no longer PENDING, skipping execution`,
        );
        return;
      }

      this.logger.debug(
        `[executeTask] Successfully acquired task "${task.title}" (${task.id}) for execution`,
      );

      // ★ AI Kernel: 记录任务开始事件
      this.recordKernelEvent(mission.id, "task:started", {
        taskId: task.id,
        taskTitle: task.title,
        assignedTo: assignedTo.agentName || assignedTo.displayName,
      });

      // ★ 优化：日志记录和消息发送并行执行，不阻塞 AI 调用
      // 使用 fire-and-forget 模式，失败时只记录警告
      void Promise.all([
        this.createLog(mission.id, {
          type: MissionLogType.TASK_STARTED,
          agentId: assignedTo.id,
          agentName: assignedTo.agentName || assignedTo.displayName,
          taskId: task.id,
          taskTitle: task.title,
          content: `开始执行任务「${task.title}」`,
        }).catch((e) =>
          this.logger.warn(`[executeTask] Failed to create log: ${e}`),
        ),
        this.sendMessageToTopic(
          mission.topicId,
          assignedTo.id,
          `[开始工作]\n\n收到任务「${task.title}」，开始执行...`,
          MessageContentType.TEXT,
        ).catch((e) =>
          this.logger.warn(`[executeTask] Failed to send start message: ${e}`),
        ),
      ]);

      // ★ 修复：发送任务状态更新事件，确保前端连线颜色正确
      void this.topicEventEmitter.emitToTopic(mission.topicId, "task:status", {
        missionId: mission.id,
        taskId: task.id,
        status: AgentTaskStatus.IN_PROGRESS,
      });

      // 广播 Agent 工作状态（WebSocket 本身是非阻塞的）
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:agent_working",
        {
          missionId: mission.id,
          taskId: task.id,
          agentId: assignedTo.id,
          agentName: assignedTo.agentName || assignedTo.displayName,
          status: "started",
        },
      );

      // 检查是否需要联网搜索（检测任务描述中的关键词）
      let searchContext = "";
      if (
        needsWebSearch(
          mission.title,
          mission.description,
          task.title,
          task.description,
        )
      ) {
        const searchQuery = buildSearchQuery(
          mission.title,
          task.title,
          task.description,
        );
        this.logger.log(
          `[executeTask] Performing web search for task "${task.title}": ${searchQuery}`,
        );

        // ★ 通过 ToolRegistry 调用 web-search 工具
        const webSearchTool = this.toolRegistry.tryGet("web-search");
        if (webSearchTool) {
          const toolResult = await webSearchTool.execute(
            { query: searchQuery, numResults: 5 },
            this.createToolContext("web-search"),
          );
          if (toolResult.success && toolResult.data) {
            const searchData = toolResult.data as {
              results: Array<{ title: string; url: string; content: string }>;
              success: boolean;
            };
            if (searchData.success && searchData.results?.length > 0) {
              searchContext = searchData.results
                .map(
                  (r, i) =>
                    `[${i + 1}] ${r.title}\n${r.content}\nSource: ${r.url}`,
                )
                .join("\n\n");
              this.logger.log(
                `[executeTask] Found ${searchData.results.length} search results for task "${task.title}"`,
              );
            }
          }
        }
      }

      // 构建任务执行提示词
      const taskPrompt = this.buildTaskExecutionPrompt(
        mission,
        task,
        searchContext,
      );

      // ==================== 带重试和 Agent 切换的 AI 调用 ====================
      // 使用更大的 max_tokens (8000) 确保有足够空间生成响应

      let currentAgent = assignedTo;
      const failedAgentIds: string[] = [];
      let aiResponse: { content: string } | null = null;
      let switchCount = 0;

      // 🔒 Circuit Breaker: 检查初始 Agent 是否可用
      if (!this.agentFacade.circuitBreaker?.canExecute(currentAgent.id)) {
        const cooldownRemaining =
          this.agentFacade.circuitBreaker?.getCooldownRemaining(
            currentAgent.id,
          ) ?? 0;
        const cooldownSeconds = Math.ceil(cooldownRemaining / 1000);
        this.logger.warn(
          `[executeTask] Agent ${currentAgent.displayName} is in cooldown for ${cooldownSeconds}s, finding alternative`,
        );

        // 尝试找到替代 Agent
        const alternativeAgent = await this.findAlternativeAgent(
          mission,
          [currentAgent.id],
          task,
        );

        if (alternativeAgent) {
          failedAgentIds.push(currentAgent.id);
          currentAgent = alternativeAgent;
          switchCount++;
          this.logger.log(
            `[executeTask] Switched to ${currentAgent.displayName} due to circuit breaker`,
          );
        } else {
          // 没有可用的替代 Agent，等待冷却或标记为阻塞
          await this.sendMessageToTopic(
            mission.topicId,
            currentAgent.id,
            `[任务延迟]\n\n任务「${task.title}」的负责人 ${currentAgent.displayName} 当前不可用（正在冷却中，剩余 ${cooldownSeconds} 秒），且无其他可用成员。任务将被暂时阻塞。`,
            MessageContentType.TEXT,
          );

          await this.prisma.agentTask.update({
            where: { id: task.id },
            data: { status: AgentTaskStatus.BLOCKED },
          });

          return;
        }
      }

      // 增加当前 Agent 负载计数
      this.agentFacade.circuitBreaker?.incrementLoad(currentAgent.id);
      const taskStartTime = Date.now();

      // 外层循环：Agent 切换
      while (switchCount <= AGENT_SWITCH_CONFIG.maxSwitches) {
        this.logger.log(
          `[executeTask] Attempting task "${task.title}" with agent ${currentAgent.displayName} (${currentAgent.aiModel})`,
        );

        // 如果切换了 Agent，发送通知
        if (switchCount > 0) {
          await this.sendMessageToTopic(
            mission.topicId,
            currentAgent.id,
            `[任务接手]\n\n由于原负责人遇到技术问题，我将接手任务「${task.title}」的执行。`,
            MessageContentType.TEXT,
          );

          // 更新任务的负责人
          await this.prisma.agentTask.update({
            where: { id: task.id },
            data: { assignedToId: currentAgent.id },
          });

          // 广播 Agent 切换
          void this.topicEventEmitter.emitToTopic(
            mission.topicId,
            "mission:agent_switched",
            {
              missionId: mission.id,
              taskId: task.id,
              previousAgentId: failedAgentIds[failedAgentIds.length - 1],
              newAgentId: currentAgent.id,
              newAgentName: currentAgent.displayName,
              reason: "retry_exhausted",
            },
          );
        }

        // 内层调用：带重试的 AI 调用（★ 带心跳机制）
        const result = await this.callAIWithRetry(
          currentAgent.aiModel,
          [{ role: "user", content: taskPrompt }],
          this.getAgentSystemPrompt(
            currentAgent,
            task,
            mission.contextPackage as MissionContextPackage | null,
            mission.description || undefined,
            Array.isArray(mission.mustConstraints)
              ? (mission.mustConstraints as unknown as HardConstraint[])
              : undefined,
          ),
          { taskProfile: { creativity: "medium", outputLength: "long" } },
          {
            taskId: task.id,
            taskTitle: task.title,
            missionId: mission.id,
          },
          // ★ 心跳上下文：让前端实时显示 Agent 正在思考
          {
            topicId: mission.topicId,
            agentId: currentAgent.id,
            agentName: currentAgent.agentName || currentAgent.displayName,
          },
        );

        if (result.success && result.content) {
          aiResponse = { content: result.content };

          // 🔒 Circuit Breaker: 记录成功
          const responseTime = Date.now() - taskStartTime;
          this.agentFacade.circuitBreaker?.recordSuccess(
            currentAgent.id,
            responseTime,
          );

          this.logger.log(
            `[executeTask] Task "${task.title}" completed successfully by ${currentAgent.displayName} after ${result.attempts} attempt(s) in ${responseTime}ms`,
          );
          break;
        }

        // 重试失败，记录失败的 Agent
        failedAgentIds.push(currentAgent.id);
        const errorMsg = result.error || "Unknown error";

        // 🔒 Circuit Breaker: 记录失败
        const cb = this.agentFacade.circuitBreaker;
        const errorType = cb?.parseErrorType(errorMsg);
        if (cb && errorType !== undefined) {
          cb.recordFailure(currentAgent.id, errorType, errorMsg);
        }

        this.logger.warn(
          `[executeTask] Agent ${currentAgent.displayName} failed after ${result.attempts} retries: ${errorMsg} (errorType: ${errorType})`,
        );

        // 发送失败通知
        await this.sendMessageToTopic(
          mission.topicId,
          currentAgent.id,
          `⚠️ **执行受阻**\n\n任务「${task.title}」执行过程中遇到问题（已重试 ${result.attempts} 次）：\n\n> ${errorMsg}\n\n正在尝试切换到其他团队成员...`,
          MessageContentType.TEXT,
        );

        // 检查错误类型决定是否切换 Agent
        // ★ 使用 isPermanentError 而不是 !isRetryableError
        // Rate Limit 错误虽然不应重试，但可以通过切换 Agent 解决
        if (isPermanentError(errorMsg)) {
          // 真正的永久性错误（如上下文过大），直接走 Leader 重新规划
          this.logger.log(
            `[executeTask] Permanent error detected, skipping agent switch and going to Leader replan`,
          );
          await this.handleTaskExecutionFailure(
            mission,
            task,
            currentAgent,
            errorMsg,
          );
          return;
        }

        // Rate Limit 错误：记录日志，然后尝试切换 Agent
        if (isRateLimitError(errorMsg)) {
          this.logger.warn(
            `[executeTask] Rate limit detected for ${currentAgent.displayName}, switching to alternative agent immediately`,
          );
        }

        // 🔒 Circuit Breaker: 检查替代 Agent 是否可用
        const alternativeAgent =
          await this.findAlternativeAgentWithCircuitBreaker(
            mission,
            failedAgentIds,
            task,
          );

        if (!alternativeAgent) {
          this.logger.warn(
            `[executeTask] No alternative agents available, going to Leader replan`,
          );
          await this.handleTaskExecutionFailure(
            mission,
            task,
            currentAgent,
            `${errorMsg} (已尝试 ${failedAgentIds.length} 个 Agent，均无法完成)`,
          );
          return;
        }

        // 切换到新 Agent，减少旧 Agent 负载，增加新 Agent 负载
        this.agentFacade.circuitBreaker?.decrementLoad(currentAgent.id);
        this.agentFacade.circuitBreaker?.incrementLoad(alternativeAgent.id);

        this.logger.log(
          `[executeTask] Switching from ${currentAgent.displayName} to ${alternativeAgent.displayName}`,
        );
        currentAgent = alternativeAgent;
        switchCount++;
      }

      // 如果所有 Agent 都失败了
      if (!aiResponse) {
        this.logger.error(
          `[executeTask] All agents failed for task "${task.title}"`,
        );
        await this.handleTaskExecutionFailure(
          mission,
          task,
          currentAgent,
          `所有可用 Agent 均无法完成此任务（已尝试 ${failedAgentIds.length + 1} 个 Agent）`,
        );
        return;
      }

      // ==================== AI 调用成功，继续处理结果 ====================

      // 检测是否需要续写（处理"未完待续"等中断情况）
      let finalContent = aiResponse.content;
      try {
        // ★ 确保长内容服务已初始化（修复服务重启后 projectConfigs 丢失的问题）
        await this.longContentService.ensureMissionInitialized({
          missionId: mission.id,
          missionTitle: mission.title,
          missionDescription: mission.description || "",
          objectives: mission.objectives || [],
          constraints: mission.constraints || [],
          expectedTaskCount: mission.totalTasks || undefined,
          granularityLevel: "chapter",
        });

        const completionResult =
          await this.longContentService.processTaskCompletion(
            mission.id,
            task.id,
            task.title,
            aiResponse.content,
          );

        if (completionResult.needsContinuation) {
          this.logger.log(
            `[executeTask] Task "${task.title}" needs continuation, current: ${completionResult.continuationState?.continuationCount || 0}/${completionResult.continuationState?.maxContinuations || 3}`,
          );

          // 发送续写中的消息
          await this.sendMessageToTopic(
            mission.topicId,
            currentAgent.id,
            `[续写中...]\n\n任务内容较长，正在继续生成...`,
            MessageContentType.TEXT,
          );

          // 执行续写循环
          let continuationState = completionResult.continuationState;
          while (
            continuationState &&
            continuationState.continuationCount <
              continuationState.maxContinuations
          ) {
            // 构建续写 Prompt
            const continuationPrompt =
              this.longContentService.buildContinuationPrompt(
                task.id,
                task.title,
                task.description || task.title,
              );

            // 调用 AI 续写（★ 带心跳机制）
            const continuationResult = await this.callAIWithRetry(
              currentAgent.aiModel,
              [{ role: "user", content: continuationPrompt }],
              this.getAgentSystemPrompt(
                currentAgent,
                task,
                mission.contextPackage as MissionContextPackage | null,
                mission.description || undefined,
                Array.isArray(mission.mustConstraints)
                  ? (mission.mustConstraints as unknown as HardConstraint[])
                  : undefined,
              ),
              { taskProfile: { creativity: "medium", outputLength: "long" } },
              {
                taskId: task.id,
                taskTitle: task.title,
                missionId: mission.id,
              },
              // ★ 心跳上下文：续写时也显示思考状态
              {
                topicId: mission.topicId,
                agentId: currentAgent.id,
                agentName: currentAgent.agentName || currentAgent.displayName,
              },
            );

            if (!continuationResult.success || !continuationResult.content) {
              this.logger.warn(
                `[executeTask] Continuation failed for task "${task.title}"`,
              );
              break;
            }

            // 处理续写结果
            const nextResult =
              await this.longContentService.processTaskCompletion(
                mission.id,
                task.id,
                task.title,
                continuationResult.content,
              );

            if (!nextResult.needsContinuation) {
              // 续写完成
              finalContent =
                nextResult.finalContent || continuationResult.content;
              this.logger.log(
                `[executeTask] Continuation completed for task "${task.title}"`,
              );
              break;
            }

            continuationState = nextResult.continuationState;
          }

          // 获取最终合并的结果
          const mergedContent = this.longContentService.getFinalResult(task.id);
          if (mergedContent) {
            finalContent = mergedContent;
          }
        } else if (completionResult.finalContent) {
          finalContent = completionResult.finalContent;
        }

        // 检查质量干预建议
        if (
          completionResult.intervention &&
          completionResult.intervention.level >= 2
        ) {
          this.logger.warn(
            `[executeTask] Quality intervention recommended for task "${task.title}": ${completionResult.intervention.reason}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `[executeTask] Long content processing failed: ${error}`,
        );
        // 继续使用原始结果
      }

      // 检查最终内容是否包含API错误（防止错误内容被当作成功结果）
      const isApiError = isApiErrorContent(finalContent);
      if (isApiError) {
        this.logger.warn(
          `[executeTask] Task "${task.title}" result contains API error, treating as failure`,
        );
        await this.sendMessageToTopic(
          mission.topicId,
          currentAgent.id,
          `[任务执行失败]\n\n任务「${task.title}」执行过程中遇到技术问题，需要重试：\n\n> ${finalContent.substring(0, 500)}`,
          MessageContentType.TEXT,
        );

        await this.handleTaskExecutionFailure(
          mission,
          task,
          currentAgent,
          "AI响应包含错误信息",
        );
        return;
      }

      // 发送工作汇报消息（使用实际完成任务的 Agent，包含任务标题便于追踪）
      const leaderName = mission.leader.agentName || mission.leader.displayName;
      const resultMessage = await this.sendMessageToTopic(
        mission.topicId,
        currentAgent.id,
        `[工作汇报]\n\n@${leaderName} 任务「${task.title}」已完成！\n\n${finalContent}`,
        MessageContentType.TEXT,
      );

      // 更新任务结果
      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: AgentTaskStatus.AWAITING_REVIEW,
          result: finalContent,
          resultMessageId: resultMessage?.id,
        },
      });

      await this.createLog(mission.id, {
        type: MissionLogType.TASK_COMPLETED,
        agentId: currentAgent.id,
        agentName: currentAgent.agentName || currentAgent.displayName,
        taskId: task.id,
        taskTitle: task.title,
        content: `任务「${task.title}」执行完成，等待 Leader 审核${failedAgentIds.length > 0 ? ` (经过 ${failedAgentIds.length} 次 Agent 切换)` : ""}`,
        messageId: resultMessage?.id,
      });

      // ★ 修复：发送任务状态更新事件，确保前端连线颜色正确更新
      void this.topicEventEmitter.emitToTopic(mission.topicId, "task:status", {
        missionId: mission.id,
        taskId: task.id,
        status: AgentTaskStatus.AWAITING_REVIEW,
        result: finalContent,
      });

      // 广播任务完成
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "task:completed",
        {
          missionId: mission.id,
          taskId: task.id,
          agentId: currentAgent.id,
        },
      );

      // 清除Agent工作状态 (任务执行完成)
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:agent_done",
        {
          missionId: mission.id,
          taskId: task.id,
          agentId: currentAgent.id,
        },
      );

      // Leader 审核
      await this.leaderReviewTask(mission, task, finalContent);
    } catch (error) {
      this.logger.error(`Task execution failed: ${error}`);

      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: { status: AgentTaskStatus.BLOCKED },
      });

      // ★ 修复：任务失败时也要发送状态更新事件，确保前端同步
      void this.topicEventEmitter.emitToTopic(mission.topicId, "task:status", {
        missionId: mission.id,
        taskId: task.id,
        status: AgentTaskStatus.BLOCKED,
      });

      // ★ 修复：任务失败时清除 Agent 工作状态，避免节点永远闪烁
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:agent_done",
        {
          missionId: mission.id,
          taskId: task.id,
          agentId: assignedTo.id,
        },
      );

      await this.sendMessageToTopic(
        mission.topicId,
        assignedTo.id,
        `❌ 任务执行出错：${error instanceof Error ? error.message : "未知错误"}`,
        MessageContentType.TEXT,
      );
    } finally {
      // 🔒 释放任务锁
      this.stateManager.finishTask(task.id);

      // 🔒 Circuit Breaker: 减少 Agent 负载计数
      this.agentFacade.circuitBreaker?.decrementLoad(assignedTo.id);

      this.logger.debug(
        `[executeTask] Released lock for task "${task.title}" (${task.id})`,
      );
    }
  }

  // ==================== Circuit Breaker 增强的 Agent 选择 ====================

  /**
   * 查找替代 Agent（结合 Circuit Breaker 健康状态）
   * 1. 排除已失败的 Agent
   * 2. 排除正在冷却中的 Agent
   * 3. 优先选择健康度高、负载低的 Agent
   */
  private async findAlternativeAgentWithCircuitBreaker(
    mission: MissionWithRelations,
    failedAgentIds: string[],
    _task: AgentTaskWithAssignee, // Reserved for future task-type based selection
  ): Promise<TeamMemberBase | null> {
    try {
      // 获取所有团队成员
      const teamMemberResult = await this.getTeamMembers(mission.topicId);
      const allMembers = teamMemberResult.all || [];

      if (allMembers.length <= 1) {
        this.logger.warn(
          `[findAlternativeAgentWithCircuitBreaker] No alternative agents available (only ${allMembers.length} member)`,
        );
        return null;
      }

      // 过滤：排除已失败的 Agent、Leader、和正在冷却中的 Agent
      const candidates = allMembers.filter((m: TeamMemberBase) => {
        // 排除已失败的
        if (failedAgentIds.includes(m.id)) return false;

        // 排除 Leader（优先）
        if (m.isLeader) return false;

        // 排除正在冷却中的 Agent
        if (!this.agentFacade.circuitBreaker?.canExecute(m.id)) {
          this.logger.debug(
            `[findAlternativeAgentWithCircuitBreaker] Excluding ${m.displayName} (in cooldown)`,
          );
          return false;
        }

        return true;
      });

      this.logger.log(
        `[findAlternativeAgentWithCircuitBreaker] Found ${candidates.length} healthy candidates (excluded: ${failedAgentIds.join(", ")})`,
      );

      // 如果没有健康的非 Leader 候选，考虑 Leader 作为备选
      if (candidates.length === 0 && AGENT_SWITCH_CONFIG.allowLeaderFallback) {
        const leader = allMembers.find(
          (m: TeamMemberBase) =>
            m.isLeader &&
            !failedAgentIds.includes(m.id) &&
            this.agentFacade.circuitBreaker?.canExecute(m.id),
        );
        if (leader) {
          this.logger.log(
            `[findAlternativeAgentWithCircuitBreaker] Using Leader ${leader.displayName} as fallback`,
          );
          return leader;
        }
      }

      if (candidates.length === 0) {
        this.logger.warn(
          `[findAlternativeAgentWithCircuitBreaker] No alternative agents available after filtering`,
        );
        return null;
      }

      // 使用 Circuit Breaker 选择最佳 Agent
      const candidateIds = candidates.map((c: TeamMemberBase) => c.id);
      const bestAgentId =
        this.agentFacade.circuitBreaker?.selectBest(candidateIds);

      if (bestAgentId) {
        const selected = candidates.find(
          (c: TeamMemberBase) => c.id === bestAgentId,
        );
        if (selected) {
          const metrics =
            this.agentFacade.circuitBreaker?.getHealthMetrics(bestAgentId);
          this.logger.log(
            `[findAlternativeAgentWithCircuitBreaker] Selected: ${selected.displayName} (successRate: ${metrics ? (metrics.successRate * 100).toFixed(0) : "N/A"}%, load: ${metrics?.currentLoad ?? "N/A"})`,
          );
          return selected;
        }
      }

      // 回退到第一个候选
      const selected = candidates[0];
      this.logger.log(
        `[findAlternativeAgentWithCircuitBreaker] Fallback selected: ${selected.displayName}`,
      );
      return selected;
    } catch (error) {
      this.logger.error(
        `[findAlternativeAgentWithCircuitBreaker] Error:`,
        error,
      );
      return null;
    }
  }

  // ==================== 处理任务执行失败 ====================

  /**
   * 处理任务执行失败，让 Leader 重新规划
   * 当 AI 调用失败（如上下文过大）时触发
   */
  private async handleTaskExecutionFailure(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    assignedTo: TaskAssignee,
    errorMsg: string,
  ) {
    const { leader } = mission;

    // 1. 标记当前任务为失败
    await this.prisma.agentTask.update({
      where: { id: task.id },
      data: { status: AgentTaskStatus.CANCELLED },
    });

    // 2. 发送失败通知到群聊
    await this.sendMessageToTopic(
      mission.topicId,
      assignedTo.id,
      `❌ **任务执行失败**\n\n任务「${task.title}」执行过程中出现错误：\n\n> ${errorMsg}\n\n正在请求 Leader @${leader.agentName || leader.displayName} 重新规划...`,
      MessageContentType.TEXT,
    );

    // 3. 让 Leader 分析失败原因并重新规划
    const replanPrompt = `## 任务执行失败通知

**失败的任务：** ${task.title}
**原负责人：** ${assignedTo.agentName || assignedTo.displayName}
**失败原因：** ${errorMsg}
**原任务描述：** ${task.description || task.title}

---

作为团队 Leader，请分析这个任务失败的原因，并进行以下操作之一：

1. **任务拆分**：如果任务太复杂或太大，将其拆分为2-3个更小的子任务
2. **任务简化**：重新定义任务范围，使其更具体、更可执行
3. **重新分配**：如果原负责人不适合，建议分配给其他团队成员

请以结构化格式回复：

### 分析
（分析失败原因）

### 解决方案
（选择: 拆分 / 简化 / 重新分配）

### 新任务
（用 JSON 格式描述新的任务，格式如下）
\`\`\`json
{
  "action": "split" | "simplify" | "reassign",
  "newTasks": [
    {
      "title": "任务标题",
      "description": "详细描述",
      "assignee": "成员名称"
    }
  ]
}
\`\`\``;

    try {
      // ★ 使用 LeaderModelService 支持重试和模型切换
      const result = await this.leaderModelService.executeWithFallback(
        leader.aiModel,
        async (modelConfig) => {
          return this.aiCallerService.callAIWithConfig(
            modelConfig.modelId,
            [{ role: "user", content: replanPrompt }],
            this.getLeaderSystemPrompt(leader),
            {
              taskProfile: { creativity: "medium", outputLength: "standard" },
              missionId: mission.id,
            },
          );
        },
        {
          operation: "task_replan",
          context: { missionId: mission.id, taskId: task.id },
        },
      );

      if (!result.success || !result.data) {
        throw new Error(`重新规划失败: ${result.error?.message || "未知错误"}`);
      }
      const aiResponse = result.data;

      // 发送 Leader 的重新规划消息
      await this.sendMessageToTopic(
        mission.topicId,
        leader.id,
        `[任务重新规划]\n\n${aiResponse.content}`,
        MessageContentType.TEXT,
      );

      // 尝试解析新任务并创建
      const jsonMatch = aiResponse.content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          const replanData = JSON.parse(jsonMatch[1]);
          if (replanData.newTasks && Array.isArray(replanData.newTasks)) {
            // 获取团队成员
            const teamMemberResult = await this.getTeamMembers(mission.topicId);
            const teamMembers = teamMemberResult.all || [];

            for (const newTask of replanData.newTasks) {
              // 找到分配的成员
              const assignee = teamMembers.find(
                (m: TeamMemberBase) =>
                  m.agentName === newTask.assignee ||
                  m.displayName === newTask.assignee,
              );

              if (assignee) {
                // 创建新任务
                await this.prisma.agentTask.create({
                  data: {
                    missionId: mission.id,
                    title: newTask.title,
                    description: newTask.description || newTask.title,
                    assignedToId: assignee.id,
                    status: AgentTaskStatus.PENDING,
                    priority: TaskPriority.HIGH,
                    taskType: TaskType.IMPLEMENTATION,
                    revisionCount: 0, // ★ 初始化修改次数
                    maxRevisions: 3, // ★ 初始化最大修改次数
                  },
                });

                this.logger.log(
                  `Created new task "${newTask.title}" assigned to ${assignee.displayName}`,
                );
              }
            }

            // 继续执行下一批任务
            await this.executeNextTasks(mission.id);
          }
        } catch (parseError) {
          this.logger.warn(
            `Failed to parse replan JSON: ${parseError}. Manual intervention may be needed.`,
          );
        }
      }
    } catch (replanError) {
      this.logger.error(`Replan AI call failed: ${replanError}`);
      // 重新规划也失败了，发送提示让用户手动处理
      await this.sendMessageToTopic(
        mission.topicId,
        null,
        `⚠️ **需要人工干预**\n\n任务「${task.title}」执行失败，且自动重新规划也失败了。\n\n请手动取消当前任务或创建新的任务。`,
        MessageContentType.SYSTEM,
      );
    }

    // 记录日志
    await this.createLog(mission.id, {
      type: MissionLogType.TASK_FAILED,
      agentId: assignedTo.id,
      agentName: assignedTo.agentName || assignedTo.displayName,
      taskId: task.id,
      taskTitle: task.title,
      content: `任务执行失败: ${errorMsg}`,
    });
  }

  // ==================== Leader 审核任务 ====================

  private async leaderReviewTask(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    taskResult: string,
  ) {
    const { leader } = mission;

    try {
      // 广播 Leader 开始审核 (显示 thinking 状态)
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:agent_working",
        {
          missionId: mission.id,
          taskId: task.id,
          agentId: leader.id,
          agentName: leader.agentName || leader.displayName,
          status: "reviewing",
        },
      );

      // 对长内容先生成 AI 摘要，确保 Leader 能全面了解内容质量
      let reviewContent = taskResult;
      if (taskResult.length > 3000) {
        this.logger.log(
          `[leaderReviewTask] 任务产出较长(${taskResult.length}字符)，生成摘要...`,
        );
        const { summary, keyExcerpts } = await this.summarizeForLeaderReview(
          taskResult,
          task.title,
          leader.aiModel,
          mission.id,
        );
        // 使用摘要 + 关键片段作为审核内容
        reviewContent = keyExcerpts
          ? `【AI 生成的内容摘要】\n${summary}\n\n【原文关键片段】\n${keyExcerpts}`
          : summary;
        this.logger.log(
          `[leaderReviewTask] 摘要生成完成，审核内容长度: ${reviewContent.length}字符`,
        );
      }

      // 获取质量趋势上下文（用于辅助 Leader 审核判断）
      let qualityContext = "";
      try {
        const qualityCheck = this.longContentService.checkQualityIntervention(
          mission.id,
        );
        if (qualityCheck.needed) {
          qualityContext = `\n\n【质量预警】${qualityCheck.reason}`;
          this.logger.log(
            `[leaderReviewTask] Quality warning: ${qualityCheck.reason}`,
          );
        }
      } catch (error) {
        // 质量检查失败不影响审核流程
      }

      // 构建审核提示词
      let reviewPrompt = this.buildLeaderReviewPrompt(
        mission,
        task,
        reviewContent,
      );

      // 添加质量上下文到审核提示词
      if (qualityContext) {
        reviewPrompt += qualityContext;
      }

      // 调用 AI 进行审核 (使用数据库 API Key)
      // ★ 添加心跳机制，让前端持续显示 Leader 正在审核
      let aiResponse: { content: string };
      let reviewHeartbeatTimer: NodeJS.Timeout | null = null;
      let reviewHeartbeatCount = 0;

      try {
        // 启动审核心跳
        reviewHeartbeatTimer = setInterval(() => {
          reviewHeartbeatCount++;
          void this.topicEventEmitter.emitToTopic(
            mission.topicId,
            "mission:agent_working",
            {
              missionId: mission.id,
              taskId: task.id,
              agentId: leader.id,
              agentName: leader.agentName || leader.displayName,
              status: "reviewing",
              heartbeat: reviewHeartbeatCount,
              elapsedSeconds: reviewHeartbeatCount * 3,
            },
          );
        }, 3000);

        // ★ 使用 LeaderModelService 支持重试和模型切换
        const result = await this.leaderModelService.executeWithFallback(
          leader.aiModel,
          async (modelConfig) => {
            return this.aiCallerService.callAIWithConfig(
              modelConfig.modelId,
              [{ role: "user", content: reviewPrompt }],
              this.getLeaderSystemPrompt(leader),
              {
                taskProfile: { creativity: "low", outputLength: "standard" },
                missionId: mission.id,
              },
            );
          },
          {
            operation: "leader_review",
            context: { missionId: mission.id, taskId: task.id },
          },
        );

        if (!result.success || !result.data) {
          throw new Error(`审核失败: ${result.error?.message || "未知错误"}`);
        }
        aiResponse = result.data;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[reviewTaskResult] Review AI call failed: ${errorMsg}`,
        );
        // 审核失败时默认不通过，要求重做
        aiResponse = {
          content: `审核失败: ${errorMsg}\n\n不通过。请重新执行任务。`,
        };
      } finally {
        // 停止审核心跳
        if (reviewHeartbeatTimer) {
          clearInterval(reviewHeartbeatTimer);
          reviewHeartbeatTimer = null;
        }
      }

      // 解析审核结果（增强版，带置信度）
      const reviewResult = parseReviewResult(aiResponse.content);
      const isApproved = reviewResult.isApproved;

      // 记录审核解析详情
      this.logger.log(
        `[leaderReviewTask] Review result: ${isApproved ? "APPROVED" : "REJECTED"} ` +
          `(confidence: ${reviewResult.confidence.toFixed(2)}, reason: ${reviewResult.reason})`,
      );

      // 发送 Leader 反馈消息
      const agentName =
        task.assignedTo.agentName || task.assignedTo.displayName;
      const feedbackMessage = await this.sendMessageToTopic(
        mission.topicId,
        leader.id,
        `[Leader反馈]\n\n@${agentName} ${aiResponse.content}`,
        MessageContentType.TEXT,
      );

      await this.createLog(mission.id, {
        type: MissionLogType.LEADER_FEEDBACK,
        agentId: leader.id,
        agentName: leader.agentName || leader.displayName,
        taskId: task.id,
        taskTitle: task.title,
        content: isApproved ? "任务审核通过" : "任务需要修改",
        messageId: feedbackMessage?.id,
      });

      // 清除 Leader 审核状态 (审核完成)
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:agent_done",
        {
          missionId: mission.id,
          taskId: task.id,
          agentId: leader.id,
        },
      );

      if (isApproved) {
        // 审核通过
        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: {
            status: AgentTaskStatus.COMPLETED,
            completedAt: new Date(),
            leaderFeedback: aiResponse.content,
            feedbackMessageId: feedbackMessage?.id,
          },
        });

        // ★ 修复：发送任务状态更新事件，确保前端连线颜色正确
        void this.topicEventEmitter.emitToTopic(
          mission.topicId,
          "task:status",
          {
            missionId: mission.id,
            taskId: task.id,
            status: AgentTaskStatus.COMPLETED,
            leaderFeedback: aiResponse.content,
          },
        );

        // 更新任务进度
        await this.updateMissionProgress(mission.id);

        // 执行下一批任务
        await this.executeNextTasks(mission.id);
      } else {
        // 需要修改
        const currentRevisions = task.revisionCount || 0;

        if (currentRevisions >= task.maxRevisions) {
          // 超过最大修改次数
          // ★ 检查是否有有效产出内容
          const hasValidContent =
            task.result &&
            task.result.trim().length > 100 &&
            !task.result.includes("[自动完成]") &&
            !task.result.includes("[错误]");

          if (hasValidContent) {
            // 有有效内容，强制通过但记录警告
            this.logger.warn(
              `[Leader Review] Task "${task.title}" force passed after ${currentRevisions} revisions (has content: ${task.result?.length ?? 0} chars)`,
            );

            await this.prisma.agentTask.update({
              where: { id: task.id },
              data: {
                status: AgentTaskStatus.COMPLETED,
                completedAt: new Date(),
                leaderFeedback:
                  aiResponse.content +
                  `\n\n⚠️ 【系统提示】已达最大修改次数(${currentRevisions}/${task.maxRevisions})，内容已保留。建议后续人工审核。`,
              },
            });

            // ★ 修复：发送任务状态更新事件
            void this.topicEventEmitter.emitToTopic(
              mission.topicId,
              "task:status",
              {
                missionId: mission.id,
                taskId: task.id,
                status: AgentTaskStatus.COMPLETED,
              },
            );

            // 发送提示消息
            await this.sendMessageToTopic(
              mission.topicId,
              null,
              `⚠️ 任务「${task.title}」已达最大修改次数，已保留当前内容。建议后续人工审核质量。`,
              MessageContentType.SYSTEM,
            );
          } else {
            // 没有有效内容，标记为 BLOCKED 而不是强制通过
            this.logger.warn(
              `[Leader Review] Task "${task.title}" blocked after ${currentRevisions} revisions (no valid content)`,
            );

            await this.prisma.agentTask.update({
              where: { id: task.id },
              data: {
                status: AgentTaskStatus.BLOCKED,
                leaderFeedback:
                  aiResponse.content +
                  `\n\n❌ 【系统提示】已达最大修改次数(${currentRevisions}/${task.maxRevisions})，但内容质量不足，任务已阻塞。`,
              },
            });

            // ★ 修复：发送任务状态更新事件
            void this.topicEventEmitter.emitToTopic(
              mission.topicId,
              "task:status",
              {
                missionId: mission.id,
                taskId: task.id,
                status: AgentTaskStatus.BLOCKED,
              },
            );

            // 记录到 Circuit Breaker
            this.agentFacade.circuitBreaker?.recordFailure(
              task.assignedTo.id,
              TaskCompletionType.CONTENT_ERROR,
              `Task "${task.title}" blocked after max revisions`,
            );

            // 发送提示消息
            await this.sendMessageToTopic(
              mission.topicId,
              null,
              `❌ 任务「${task.title}」已达最大修改次数但内容质量不足，已标记为阻塞。请考虑重新分配或调整任务。`,
              MessageContentType.SYSTEM,
            );
          }

          await this.updateMissionProgress(mission.id);
          await this.executeNextTasks(mission.id);
        } else {
          // 要求修改
          await this.prisma.agentTask.update({
            where: { id: task.id },
            data: {
              status: AgentTaskStatus.REVISION_NEEDED,
              needsRevision: true,
              revisionCount: currentRevisions + 1,
              leaderFeedback: aiResponse.content,
              feedbackMessageId: feedbackMessage?.id,
            },
          });

          // ★ 修复：发送任务状态更新事件
          void this.topicEventEmitter.emitToTopic(
            mission.topicId,
            "task:status",
            {
              missionId: mission.id,
              taskId: task.id,
              status: AgentTaskStatus.REVISION_NEEDED,
              leaderFeedback: aiResponse.content,
            },
          );

          // 触发修改
          await this.executeTaskRevision(mission, task, aiResponse.content);
        }
      }
    } catch (error) {
      this.logger.error(`Leader review failed: ${error}`);

      // 审核失败时直接通过
      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: AgentTaskStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      // ★ 修复：发送任务状态更新事件
      void this.topicEventEmitter.emitToTopic(mission.topicId, "task:status", {
        missionId: mission.id,
        taskId: task.id,
        status: AgentTaskStatus.COMPLETED,
      });

      await this.updateMissionProgress(mission.id);
      await this.executeNextTasks(mission.id);
    }
  }

  // ==================== 执行任务修改 ====================

  private async executeTaskRevision(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    feedback: string,
  ) {
    const { assignedTo } = task;

    // 🔒 并发控制：防止同一任务的修订被并发执行
    if (!this.stateManager.startRevision(task.id, task.title)) {
      this.logger.debug(
        `[executeTaskRevision] Task "${task.title}" (${task.id}) is already being revised, skipping`,
      );
      return;
    }
    this.logger.debug(
      `[executeTaskRevision] Acquired revision lock for task "${task.title}" (${task.id})`,
    );

    try {
      // 重新获取最新任务数据
      const latestTask = await this.prisma.agentTask.findUnique({
        where: { id: task.id },
        include: { assignedTo: true },
      });

      if (!latestTask) {
        this.logger.warn(
          `[executeTaskRevision] Task ${task.id} not found, skipping revision`,
        );
        // ★ 修复：早期返回前释放锁
        this.stateManager.finishRevision(task.id);
        return;
      }

      // 🔒 原子状态更新：只有 REVISION_NEEDED 状态的任务才能进入修订
      const updateResult = await this.prisma.agentTask.updateMany({
        where: {
          id: task.id,
          status: AgentTaskStatus.REVISION_NEEDED,
        },
        data: { status: AgentTaskStatus.IN_PROGRESS },
      });

      if (updateResult.count === 0) {
        this.logger.warn(
          `[executeTaskRevision] Task "${task.title}" (${task.id}) is no longer REVISION_NEEDED, skipping`,
        );
        // ★ 修复：早期返回前释放锁
        this.stateManager.finishRevision(task.id);
        return;
      }

      // 发送修改开始消息
      await this.sendMessageToTopic(
        mission.topicId,
        assignedTo.id,
        `[任务修改]\n\n收到 Leader 的反馈，正在修改...`,
        MessageContentType.TEXT,
      );

      // 构建修改提示词
      const revisionPrompt = this.buildTaskRevisionPrompt(
        mission,
        latestTask,
        feedback,
      );

      // 调用 AI 执行修改 (使用数据库 API Key)
      let aiResponse;
      try {
        aiResponse = await this.aiCallerService.callAIWithConfig(
          assignedTo.aiModel,
          [{ role: "user", content: revisionPrompt }],
          this.getAgentSystemPrompt(
            assignedTo,
            latestTask,
            mission.contextPackage as MissionContextPackage | null,
            mission.description || undefined,
            Array.isArray(mission.mustConstraints)
              ? (mission.mustConstraints as unknown as HardConstraint[])
              : undefined,
          ),
          {
            taskProfile: { creativity: "medium", outputLength: "long" },
            missionId: mission.id,
          },
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[handleTaskRevision] Revision AI call failed: ${errorMsg}`,
        );

        // 发送失败消息，而不是假装完成
        const leaderName =
          mission.leader.agentName || mission.leader.displayName;
        await this.sendMessageToTopic(
          mission.topicId,
          assignedTo.id,
          `[任务修改失败]\n\n@${leaderName} 任务「${task.title}」修改过程中遇到技术问题：\n\n> ${errorMsg}\n\n请稍后重试或由其他成员接手。`,
          MessageContentType.TEXT,
        );

        // ★ 恢复任务状态为 REVISION_NEEDED，避免卡住
        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: { status: AgentTaskStatus.REVISION_NEEDED },
        });

        await this.createLog(mission.id, {
          type: MissionLogType.TASK_FAILED,
          agentId: assignedTo.id,
          agentName: assignedTo.agentName || assignedTo.displayName,
          taskId: task.id,
          taskTitle: task.title,
          content: `任务「${task.title}」修改失败: ${errorMsg}`,
        });

        return; // 不继续执行后续的"完成"逻辑
      }

      // 检查 AI 响应是否包含错误信息（API 错误等）
      const isApiError =
        aiResponse.content.includes("API Error") ||
        aiResponse.content.includes("Rate limit") ||
        aiResponse.content.includes("请检查") ||
        aiResponse.content.includes("[修订失败]");

      if (isApiError) {
        const leaderName =
          mission.leader.agentName || mission.leader.displayName;
        await this.sendMessageToTopic(
          mission.topicId,
          assignedTo.id,
          `[任务修改失败]\n\n@${leaderName} 任务「${task.title}」修改过程中遇到技术问题：\n\n> ${aiResponse.content}\n\n请稍后重试。`,
          MessageContentType.TEXT,
        );

        // ★ 恢复任务状态为 REVISION_NEEDED，避免卡住
        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: { status: AgentTaskStatus.REVISION_NEEDED },
        });

        await this.createLog(mission.id, {
          type: MissionLogType.TASK_FAILED,
          agentId: assignedTo.id,
          agentName: assignedTo.agentName || assignedTo.displayName,
          taskId: task.id,
          taskTitle: task.title,
          content: `任务「${task.title}」修改失败: AI响应包含错误`,
        });

        return; // 不继续执行后续的"完成"逻辑
      }

      // 发送修改后的汇报（确保包含任务标题以便追踪）
      const leaderName = mission.leader.agentName || mission.leader.displayName;
      const resultMessage = await this.sendMessageToTopic(
        mission.topicId,
        assignedTo.id,
        `[工作汇报]\n\n@${leaderName} 任务「${task.title}」已根据反馈修改完成！\n\n${aiResponse.content}`,
        MessageContentType.TEXT,
      );

      // 更新任务
      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: AgentTaskStatus.AWAITING_REVIEW,
          result: aiResponse.content,
          resultMessageId: resultMessage?.id,
          needsRevision: false,
        },
      });

      await this.createLog(mission.id, {
        type: MissionLogType.TASK_REVISION,
        agentId: assignedTo.id,
        agentName: assignedTo.agentName || assignedTo.displayName,
        taskId: task.id,
        taskTitle: task.title,
        content: `任务修改完成（第 ${latestTask.revisionCount} 次修改）`,
        messageId: resultMessage?.id,
      });

      // 重新获取最新的任务数据（包含正确的 revisionCount）
      const updatedTask = await this.prisma.agentTask.findUnique({
        where: { id: task.id },
        include: { assignedTo: true },
      });

      if (!updatedTask) {
        this.logger.error(`Task ${task.id} not found after revision`);
        // ★ 修复：早期返回前释放锁
        this.stateManager.finishRevision(task.id);
        return;
      }

      // ★ 关键修复：在调用 leaderReviewTask 之前释放锁
      // 避免 leaderReviewTask -> handleRejection -> executeTaskRevision 的重入死锁
      this.stateManager.finishRevision(task.id);
      this.logger.debug(
        `[executeTaskRevision] Released revision lock BEFORE leader review for task "${task.title}" (${task.id})`,
      );

      // 再次审核（此时锁已释放，如果再次被拒绝可以正常触发新的修改）
      await this.leaderReviewTask(mission, updatedTask, aiResponse.content);

      // 标记锁已在上面释放，finally 中不再重复释放
      return;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Task revision failed: ${errorMsg}`);

      // 🔴 BUG FIX: 不要将失败的任务标记为完成！
      // 将任务标记为 BLOCKED 状态，等待人工干预或重试
      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: AgentTaskStatus.BLOCKED,
        },
      });

      // 记录到 Circuit Breaker
      const cb2 = this.agentFacade.circuitBreaker;
      const errorType = cb2?.parseErrorType(errorMsg);
      if (cb2 && errorType !== undefined) {
        cb2.recordFailure(assignedTo.id, errorType, errorMsg);
      }

      // 发送失败通知
      const leaderName =
        mission.leader?.agentName || mission.leader?.displayName || "Leader";
      await this.sendMessageToTopic(
        mission.topicId,
        assignedTo.id,
        `[任务修改失败]\n\n@${leaderName} 任务「${task.title}」修改过程中发生意外错误：\n\n> ${errorMsg}\n\n任务已被标记为阻塞状态，需要人工干预。`,
        MessageContentType.TEXT,
      );

      // 记录日志
      await this.createLog(mission.id, {
        type: MissionLogType.TASK_FAILED,
        agentId: assignedTo.id,
        agentName: assignedTo.agentName || assignedTo.displayName,
        taskId: task.id,
        taskTitle: task.title,
        content: `任务「${task.title}」修改失败（意外错误）: ${errorMsg}`,
      });

      // 不要调用 executeNextTasks，因为任务状态不是 COMPLETED
    } finally {
      // 🔒 仅在锁还未被释放时才释放（正常流程在 return 前已释放）
      if (this.stateManager.isRevisionInProgress(task.id)) {
        this.stateManager.finishRevision(task.id);
        this.logger.debug(
          `[executeTaskRevision] Released revision lock for task "${task.title}" (${task.id}) in finally block`,
        );
      }
    }
  }

  // ==================== 完成任务 ====================

  private async completeMission(missionId: string) {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
      include: {
        leader: true,
        tasks: {
          include: { assignedTo: true },
        },
      },
    });

    if (!mission) return;

    try {
      // 更新状态为审核中
      await this.prisma.teamMission.update({
        where: { id: missionId },
        data: { status: MissionStatus.REVIEW },
      });

      // 发送整合开始消息
      await this.sendMessageToTopic(
        mission.topicId,
        mission.leader.id,
        `[结果整合]\n\n所有子任务已完成，正在整合最终成果...`,
        MessageContentType.TEXT,
      );

      // ★ 始终从数据库获取完整的任务结果（确保内容完整性）
      // 长内容服务的内存存储在服务重启后会丢失，所以必须以数据库为准
      const { fullContent, summaryPrompt } =
        this.buildFinalReportWithFullContent(mission);

      // 尝试获取长内容服务的质量仪表盘（仅用于统计）
      let qualityDashboard = null;
      try {
        qualityDashboard =
          this.longContentService.getQualityDashboard(missionId);
        this.logger.log(
          `[completeMission] 质量评分: ${qualityDashboard.quality.overallScore.toFixed(1)}/10`,
        );
      } catch (error) {
        this.logger.debug(
          `[completeMission] 无法获取质量仪表盘（可能服务已重启）: ${error}`,
        );
      }

      // 生成执行总结（可选，失败不影响完整内容输出）
      // ★ 使用 LeaderModelService 支持重试和模型切换
      let executiveSummary = "";
      try {
        const result = await this.leaderModelService.executeWithFallback(
          mission.leader.aiModel,
          async (modelConfig) => {
            return this.aiCallerService.callAIWithConfig(
              modelConfig.modelId,
              [{ role: "user", content: summaryPrompt }],
              this.getLeaderSystemPrompt(mission.leader),
              {
                taskProfile: { creativity: "low", outputLength: "short" },
                missionId,
              },
            );
          },
          { operation: "mission_summary", context: { missionId } },
        );
        if (result.success && result.data) {
          executiveSummary = result.data.content;
        } else {
          throw new Error(result.error?.message || "总结生成失败");
        }
      } catch (summaryError) {
        const errorMsg =
          summaryError instanceof Error
            ? summaryError.message
            : String(summaryError);
        this.logger.warn(`[completeMission] 执行总结生成失败: ${errorMsg}`);
        // 生成基础总结
        const taskCount = (mission.tasks || []).filter(
          (t: AgentTaskWithAssignee) => t.status === AgentTaskStatus.COMPLETED,
        ).length;
        const totalWords = (mission.tasks || [])
          .filter(
            (t: AgentTaskWithAssignee) =>
              t.status === AgentTaskStatus.COMPLETED,
          )
          .reduce(
            (sum: number, t: AgentTaskWithAssignee) =>
              sum + (t.result || "").length,
            0,
          );
        executiveSummary = `## 执行总结\n\n| 指标 | 数据 |\n|------|------|\n| 总任务数 | ${taskCount}/${mission.tasks?.length || 0} |\n| 完成率 | ${mission.tasks?.length ? ((taskCount / mission.tasks.length) * 100).toFixed(1) : 0}% |\n| 总字数 | ${totalWords} 字 |${qualityDashboard ? `\n| 平均质量分 | ${qualityDashboard.quality.overallScore.toFixed(1)}/10 |\n| 质量趋势 | ${qualityDashboard.quality.trend.trend} |` : ""}`;
      }

      // 最终报告 = 执行总结 + 完整内容（所有章节）
      const finalReport = `${executiveSummary}\n\n---\n\n${fullContent}`;

      this.logger.log(
        `[completeMission] 最终报告生成完成，总长度: ${finalReport.length} 字符`,
      );

      // 清理长内容服务的任务状态
      try {
        this.longContentService.clearMission(missionId);
      } catch {
        // 清理失败不影响流程
      }

      // ★ 获取最新的 token 消耗统计（使用原始 SQL 避免 Prisma client 未 regenerate 的问题）
      let totalTokensUsed = 0;
      try {
        const tokenResult = await this.prisma.$queryRaw<
          { total_tokens_used: number | null }[]
        >`SELECT total_tokens_used FROM team_missions WHERE id = ${missionId}`;
        totalTokensUsed = tokenResult[0]?.total_tokens_used || 0;
      } catch (error) {
        this.logger.warn(
          `[completeMission] Failed to get token stats: ${error}`,
        );
      }

      // ★ 构建 Token 消耗报告
      const tokenReport =
        totalTokensUsed > 0
          ? `\n\n---\n\n## 📊 资源消耗统计\n\n| 指标 | 数值 |\n|------|------|\n| 总 Token 消耗 | ${totalTokensUsed.toLocaleString()} tokens |\n| 预估成本 | $${(totalTokensUsed * 0.00001).toFixed(4)} |`
          : "";

      // 发送最终交付消息
      const finalMessage = await this.sendMessageToTopic(
        mission.topicId,
        mission.leader.id,
        `[最终交付]\n\n🎉 任务完成！\n\n${finalReport}${tokenReport}`,
        MessageContentType.TEXT,
      );

      // ★ 进度追踪：合成阶段完成，整个任务完成
      if (this.progressTracker) {
        this.progressTracker.completePhase(missionId, "synthesis");
        this.progressTracker.complete(missionId);
      }

      // 更新任务为已完成（存储完整报告）
      await this.prisma.teamMission.update({
        where: { id: missionId },
        data: {
          status: MissionStatus.COMPLETED,
          completedAt: new Date(),
          finalResult: finalReport, // 存储完整报告，不截断
          progressPercent: 100,
        },
      });

      emitUserEvent(this.eventEmitter, {
        userId: mission.createdById,
        module: MODULE.AI_TEAMS,
        action: ACTION.COMPLETED,
        resourceType: "TeamMission",
        resourceId: missionId,
        topicKey: mission.topicId,
      });

      // ★ AI Kernel: 标记进程完成
      const processId = this.kernelProcessIds.get(missionId);
      if (processId && this.missionExecutor) {
        void this.missionExecutor
          .complete(processId, {
            tasksCompleted: mission.tasks.filter(
              (t) => t.status === AgentTaskStatus.COMPLETED,
            ).length,
            totalTasks: mission.tasks.length,
          })
          .catch((err) =>
            this.logger.warn(
              `[Kernel] Failed to complete process: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        this.kernelProcessIds.delete(missionId);
      }

      await this.createLog(missionId, {
        type: MissionLogType.MISSION_COMPLETED,
        agentId: mission.leader.id,
        agentName: mission.leader.agentName || mission.leader.displayName,
        content: "任务已完成，最终成果已交付",
        messageId: finalMessage?.id,
      });

      // ★ 清理健康检查的恢复计数
      this.healthCheckService.cleanupCompletedMission(missionId);

      // 反哺长期记忆（fire-and-forget，不阻塞主流程）
      this.agentFacade
        ?.coordinatorStore(
          {
            type: "knowledge",
            key: `teams:mission:${missionId}`,
            value: {
              title: mission.title,
              conclusion: (finalReport || mission.title).slice(0, 1500),
              membersCount: mission.tasks.length,
              completedAt: new Date().toISOString(),
            },
            importance: 0.75,
            tags: ["teams", "mission", "completed"],
          },
          mission.createdById,
        )
        ?.catch((err: unknown) => {
          this.logger.warn(
            `[memory] Failed to store teams memory for mission ${missionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });

      // 广播任务完成 - 包含参与者 AI ID 列表，用于前端清除 typing 状态
      const participantAIIds = [
        mission.leaderId,
        ...mission.tasks.map((t) => t.assignedToId),
      ].filter((id, index, arr) => arr.indexOf(id) === index); // 去重

      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:completed",
        {
          missionId,
          finalResult: finalReport, // 发送完整报告
          participantAIIds,
        },
      );

      // ★ PR-DR1b R1 arch P0 整改：mission 完成通知走 dispatcher
      // notificationEmail 字段已不需要 —— dispatcher 按 user.id 查 email
      // 若 mission.notificationEmail 与 user.email 不同（如代发场景），后续 PR
      // 引入 perTopic email override，PR-DR1b 不破坏此行为：notificationEmail 仍存
      // DB 但路由统一走 dispatcher
      const preset = this.missionCompletionPreset;
      const recipientUserId = mission.createdById;
      if (preset && recipientUserId) {
        const appUrl = this.configService.get(
          "APP_URL",
          "http://localhost:3000",
        );
        const reportUrl = `${appUrl}/ai-teams/topics/${mission.topicId}?mission=${missionId}`;

        void preset
          .notify({
            userId: recipientUserId,
            missionId,
            missionTitle: mission.title,
            reportUrl,
            summary: finalReport.slice(0, 1000),
            completedAt: new Date(),
          })
          .then(() => {
            this.logger.log(
              `[completeMission] Notification dispatched user=${recipientUserId} mission=${missionId}`,
            );
          })
          .catch((error: Error) => {
            this.logger.error(
              `[completeMission] Notification dispatch error: ${error}`,
            );
          });
      }
    } catch (error) {
      this.logger.error(`Mission completion failed: ${error}`);

      await this.prisma.teamMission.update({
        where: { id: missionId },
        data: { status: MissionStatus.FAILED },
      });

      emitUserEvent(this.eventEmitter, {
        userId: mission.createdById,
        module: MODULE.AI_TEAMS,
        action: ACTION.FAILED,
        resourceType: "TeamMission",
        resourceId: missionId,
        topicKey: mission.topicId,
      });

      // ★ AI Kernel: 标记进程失败
      this.failKernelProcess(
        missionId,
        error instanceof Error ? error.message : "Completion failed",
      );

      // ★ 进度追踪：fail active phase, then mark task failed
      if (this.progressTracker) {
        const errMsg =
          error instanceof Error ? error.message : "Completion failed";
        const task = this.progressTracker.getTask(missionId);
        if (task) {
          for (const phase of task.phases) {
            if (phase.status === "in_progress") {
              this.progressTracker.failPhase(missionId, phase.id, errMsg);
            }
          }
        }
        this.progressTracker.fail(missionId, errMsg);
      }
    }
  }

  // ==================== 辅助方法 ====================

  private async updateMissionProgress(missionId: string) {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
      include: { tasks: true },
    });

    if (!mission) return;

    const completedCount = mission.tasks.filter(
      (t) => t.status === AgentTaskStatus.COMPLETED,
    ).length;
    const totalCount = mission.tasks.length;
    const progressPercent =
      totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    await this.prisma.teamMission.update({
      where: { id: missionId },
      data: {
        completedTasks: completedCount,
        progressPercent,
      },
    });

    // 广播进度更新
    void this.topicEventEmitter.emitToTopic(
      mission.topicId,
      "mission:progress_updated",
      {
        missionId,
        completedTasks: completedCount,
        totalTasks: totalCount,
        progressPercent,
      },
    );
  }

  private async createLog(
    missionId: string,
    data: {
      type: MissionLogType;
      agentId?: string;
      agentName?: string;
      taskId?: string;
      taskTitle?: string;
      content: string;
      messageId?: string;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    return this.messageService.createLog(missionId, data);
  }

  private async sendMessageToTopic(
    topicId: string,
    aiMemberId: string | null,
    content: string,
    contentType: MessageContentType,
  ) {
    return this.messageService.sendMessageToTopic(
      topicId,
      aiMemberId,
      content,
      contentType,
    );
  }

  // ==================== 任务自动恢复 ====================

  /**
   * 自动重试 BLOCKED 状态的任务
   * 返回成功重试的任务数量
   */
  private async autoRetryBlockedTasks(
    mission: {
      id: string;
      topicId: string;
      tasks: Array<{
        id: string;
        title: string;
        status: string;
        result: string | null;
        updatedAt: Date | null;
        assignedToId: string;
        assignedTo: {
          id: string;
          agentName: string | null;
          displayName: string;
        };
      }>;
    },
    blockedTasks: Array<{
      id: string;
      title: string;
      status: string;
      result: string | null;
      updatedAt: Date | null;
      assignedToId: string;
      assignedTo: { id: string; agentName: string | null; displayName: string };
    }>,
    now: number,
    stuckTimeoutMs: number,
  ): Promise<number> {
    let retriedCount = 0;

    for (const task of blockedTasks) {
      const taskAge = task.updatedAt
        ? now - new Date(task.updatedAt).getTime()
        : stuckTimeoutMs + 1;

      // 检查 Circuit Breaker 是否允许重试
      const canRetry = this.agentFacade.circuitBreaker?.canExecute(
        task.assignedTo.id,
      );

      if (canRetry && taskAge < stuckTimeoutMs) {
        // 可以重试：重置为 PENDING
        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: {
            status: AgentTaskStatus.PENDING,
            startedAt: null,
          },
        });
        retriedCount++;
        this.logger.log(
          `[Mission ${mission.id}] Auto-retrying blocked task: ${task.title}`,
        );
      } else if (taskAge >= stuckTimeoutMs) {
        // 超时：强制完成
        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: {
            status: AgentTaskStatus.COMPLETED,
            completedAt: new Date(),
            result:
              task.result ||
              `[自动完成] 任务因阻塞超时（${Math.round(taskAge / 60000)} 分钟）被系统自动标记为完成`,
          },
        });
        retriedCount++;
        this.logger.warn(
          `[Mission ${mission.id}] Force completing blocked task after ${Math.round(taskAge / 60000)} min: ${task.title}`,
        );
      } else {
        // Circuit Breaker 不允许重试，记录日志
        const cooldown =
          this.agentFacade.circuitBreaker?.getCooldownRemaining(
            task.assignedTo.id,
          ) ?? 0;
        this.logger.debug(
          `[Mission ${mission.id}] Cannot retry ${task.title}, agent ${task.assignedTo.agentName || task.assignedTo.displayName} in cooldown (${Math.round(cooldown / 1000)}s remaining)`,
        );
      }
    }

    return retriedCount;
  }

  /**
   * 强制完成卡住的 REVISION_NEEDED / AWAITING_REVIEW 任务
   * 返回强制完成的任务数量
   */
  private async forceCompleteStuckTasks(
    mission: {
      id: string;
      topicId: string;
      tasks: Array<{
        id: string;
        title: string;
        status: string;
        result: string | null;
        updatedAt: Date | null;
      }>;
    },
    stuckTasks: Array<{
      id: string;
      title: string;
      status: string;
      result: string | null;
      updatedAt: Date | null;
    }>,
    now: number,
    stuckTimeoutMs: number,
  ): Promise<number> {
    let forceCompletedCount = 0;

    for (const task of stuckTasks) {
      const taskAge = task.updatedAt
        ? now - new Date(task.updatedAt).getTime()
        : 0;

      if (taskAge >= stuckTimeoutMs) {
        // 超时：强制完成
        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: {
            status: AgentTaskStatus.COMPLETED,
            completedAt: new Date(),
            result:
              task.result ||
              `[自动完成] 任务状态为 ${task.status}，因卡住超时（${Math.round(taskAge / 60000)} 分钟）被系统自动标记为完成`,
          },
        });
        forceCompletedCount++;
        this.logger.warn(
          `[Mission ${mission.id}] Force completing stuck (${task.status}) task after ${Math.round(taskAge / 60000)} min: ${task.title}`,
        );
      }
    }

    return forceCompletedCount;
  }

  // ==================== 章节唯一性验证 ====================
  // 注：extractChapterKey 已迁移至 ./utils/text-extraction.utils.ts

  /**
   * 验证章节唯一性
   * 返回重复的章节列表
   */
  private async validateChapterUniqueness(
    missionId: string,
    newTitles: string[],
  ): Promise<{ duplicatesInNew: string[]; duplicatesInDb: string[] }> {
    const duplicatesInNew: string[] = [];
    const duplicatesInDb: string[] = [];

    // 1. 检查新任务列表中的重复
    const chapterKeys = new Map<string, string>(); // key -> title
    for (const title of newTitles) {
      const key = extractChapterKey(title);
      if (key) {
        if (chapterKeys.has(key)) {
          duplicatesInNew.push(`${title} (与 ${chapterKeys.get(key)} 重复)`);
        } else {
          chapterKeys.set(key, title);
        }
      }
    }

    // 2. 检查数据库中已存在的任务
    if (chapterKeys.size > 0) {
      const existingTasks = await this.prisma.agentTask.findMany({
        where: {
          missionId,
          status: {
            not: AgentTaskStatus.CANCELLED,
          },
        },
        select: { title: true },
      });

      for (const existing of existingTasks) {
        const existingKey = extractChapterKey(existing.title);
        if (existingKey && chapterKeys.has(existingKey)) {
          duplicatesInDb.push(
            `${chapterKeys.get(existingKey)} (数据库中已存在: ${existing.title})`,
          );
        }
      }
    }

    return { duplicatesInNew, duplicatesInDb };
  }

  /**
   * 任务分配再平衡
   * 确保任务均匀分配给所有团队成员，避免某些成员过载而其他成员闲置
   */
  private rebalanceTaskAssignments(
    breakdown: TaskBreakdownData,
    teamMembers: TeamMemberBase[],
  ): void {
    if (breakdown.tasks.length === 0 || teamMembers.length === 0) {
      return;
    }

    // 排除 Leader（Leader 主要负责审核，不应承担过多执行任务）
    const executors = teamMembers.filter((m) => !m.isLeader);
    if (executors.length === 0) {
      this.logger.warn(
        `[rebalanceTaskAssignments] No non-leader members found, skipping rebalancing`,
      );
      return;
    }

    // 统计当前分配情况
    const assignmentCount = new Map<string, number>();
    for (const member of executors) {
      assignmentCount.set(member.id, 0);
    }

    for (const task of breakdown.tasks) {
      const assigneeId = task.assigneeId;
      if (assignmentCount.has(assigneeId)) {
        assignmentCount.set(
          assigneeId,
          (assignmentCount.get(assigneeId) || 0) + 1,
        );
      }
    }

    // 计算理想分配：每人应分配的任务数
    const totalTasks = breakdown.tasks.length;
    const idealTasksPerMember = Math.ceil(totalTasks / executors.length);
    const minTasksPerMember = Math.floor(totalTasks / executors.length);

    // 找出过载和闲置的成员
    const overloadedMembers: string[] = [];
    const idleMembers: string[] = [];

    for (const [memberId, count] of assignmentCount) {
      if (count > idealTasksPerMember * 1.5) {
        overloadedMembers.push(memberId);
      }
      if (count === 0) {
        idleMembers.push(memberId);
      }
    }

    // 如果有闲置成员，需要从过载成员那里转移任务
    if (idleMembers.length > 0 && overloadedMembers.length > 0) {
      this.logger.warn(
        `[rebalanceTaskAssignments] Detected imbalanced allocation: ${overloadedMembers.length} overloaded, ${idleMembers.length} idle members`,
      );

      // 创建成员 ID 到成员对象的映射
      const memberMap = new Map(executors.map((m) => [m.id, m]));

      // 获取闲置成员的队列
      const idleMemberQueue = [...idleMembers];
      let idleIndex = 0;

      // 遍历任务，将过载成员的任务转移给闲置成员
      for (const task of breakdown.tasks) {
        if (idleIndex >= idleMemberQueue.length) break;

        const currentCount = assignmentCount.get(task.assigneeId) || 0;

        // 如果当前分配者过载，将任务转移给闲置成员
        if (
          currentCount > idealTasksPerMember &&
          idleMembers.includes(idleMemberQueue[idleIndex]) === false
        ) {
          // 确保闲置成员还没有达到最小分配数
          const idleMemberId = idleMemberQueue[idleIndex];
          const idleMemberCount = assignmentCount.get(idleMemberId) || 0;

          if (idleMemberCount < minTasksPerMember) {
            const idleMember = memberMap.get(idleMemberId);
            if (idleMember) {
              const oldAssignee = task.assigneeName;
              task.assigneeId = idleMemberId;
              task.assigneeName =
                idleMember.agentName || idleMember.displayName;

              // 更新计数
              assignmentCount.set(task.assigneeId, idleMemberCount + 1);
              assignmentCount.set(
                executors.find(
                  (m) =>
                    m.agentName === oldAssignee ||
                    m.displayName === oldAssignee,
                )?.id || "",
                currentCount - 1,
              );

              this.logger.log(
                `[rebalanceTaskAssignments] Reassigned task "${task.title}" from ${oldAssignee} to ${task.assigneeName}`,
              );

              // 如果闲置成员已达到最小分配数，移动到下一个
              if (
                (assignmentCount.get(idleMemberId) || 0) >= minTasksPerMember
              ) {
                idleIndex++;
              }
            }
          }
        }
      }
    }

    // 输出最终分配统计
    const finalStats = executors.map((m) => {
      const count = assignmentCount.get(m.id) || 0;
      return `${m.agentName || m.displayName}: ${count}`;
    });
    this.logger.log(
      `[rebalanceTaskAssignments] Final allocation: ${finalStats.join(", ")}`,
    );

    // 检查是否仍有闲置成员
    const stillIdleCount = executors.filter(
      (m) => (assignmentCount.get(m.id) || 0) === 0,
    ).length;
    if (stillIdleCount > 0) {
      this.logger.warn(
        `[rebalanceTaskAssignments] Warning: ${stillIdleCount} members still have no tasks assigned`,
      );
    }
  }

  private async createTasksFromBreakdown(
    missionId: string,
    breakdown: TaskBreakdownData,
    teamMembers: TeamMemberBase[],
  ) {
    const taskIdMap = new Map<number, string>(); // 任务索引 -> 任务ID

    // 🔄 任务分配再平衡：确保所有成员都被分配到任务
    this.rebalanceTaskAssignments(breakdown, teamMembers);

    // 🔒 章节唯一性验证
    const titles = breakdown.tasks.map((t) => t.title);
    const { duplicatesInNew, duplicatesInDb } =
      await this.validateChapterUniqueness(missionId, titles);

    if (duplicatesInNew.length > 0) {
      this.logger.warn(
        `[createTasksFromBreakdown] Found ${duplicatesInNew.length} duplicate chapters in new tasks: ${duplicatesInNew.join(", ")}`,
      );
      // 去重：只保留第一个出现的章节
      const seenKeys = new Set<string>();
      breakdown.tasks = breakdown.tasks.filter((t) => {
        const key = extractChapterKey(t.title);
        if (key && seenKeys.has(key)) {
          this.logger.warn(
            `[createTasksFromBreakdown] Skipping duplicate chapter: ${t.title}`,
          );
          return false;
        }
        if (key) seenKeys.add(key);
        return true;
      });
    }

    if (duplicatesInDb.length > 0) {
      this.logger.warn(
        `[createTasksFromBreakdown] Found ${duplicatesInDb.length} chapters already exist in DB: ${duplicatesInDb.join(", ")}`,
      );
      // 跳过数据库中已存在的章节
      const existingKeys = new Set<string>();
      const existingTasks = await this.prisma.agentTask.findMany({
        where: {
          missionId,
          status: { not: AgentTaskStatus.CANCELLED },
        },
        select: { title: true },
      });
      for (const t of existingTasks) {
        const key = extractChapterKey(t.title);
        if (key) existingKeys.add(key);
      }

      breakdown.tasks = breakdown.tasks.filter((t) => {
        const key = extractChapterKey(t.title);
        if (key && existingKeys.has(key)) {
          this.logger.warn(
            `[createTasksFromBreakdown] Skipping already existing chapter: ${t.title}`,
          );
          return false;
        }
        return true;
      });
    }

    // 🔒 章节连续性验证：检查是否从第1章开始，且无跳跃
    const updatedTitles = breakdown.tasks.map((t) => t.title);
    const sequenceValidation = validateChapterSequence(updatedTitles);

    if (
      !sequenceValidation.isValid &&
      sequenceValidation.missingChapters.length > 0
    ) {
      // 记录警告，但不阻塞任务创建（可能是后续补充任务）
      this.logger.warn(
        `[createTasksFromBreakdown] ⚠️ 章节序列不完整！缺失章节: ${sequenceValidation.missingChapters.join(", ")}`,
      );
      this.logger.warn(
        `[createTasksFromBreakdown] 当前章节范围: 第${sequenceValidation.firstChapter}章 - 第${sequenceValidation.lastChapter}章，共 ${sequenceValidation.totalChapters} 章`,
      );

      // 如果缺失的是前几章（比如第1章），这是严重问题，需要通知
      if (sequenceValidation.missingChapters.includes(1)) {
        this.logger.error(
          `[createTasksFromBreakdown] ❌ 严重：第1章缺失！小说开头将断裂。`,
        );
      }
    } else if (sequenceValidation.totalChapters > 0) {
      this.logger.log(
        `[createTasksFromBreakdown] ✅ 章节序列验证通过: 第1章 - 第${sequenceValidation.lastChapter}章，共 ${sequenceValidation.totalChapters} 章`,
      );
    }

    // ★ 优化：分离独立任务和有依赖任务，批量创建独立任务
    const independentTasks: Array<{
      index: number;
      taskItem: TaskBreakdownItem;
      assignee: TeamMemberBase;
    }> = [];
    const dependentTasks: Array<{
      index: number;
      taskItem: TaskBreakdownItem;
      assignee: TeamMemberBase;
    }> = [];

    for (let i = 0; i < breakdown.tasks.length; i++) {
      const taskItem = breakdown.tasks[i];
      let assignee = teamMembers.find((m) => m.id === taskItem.assigneeId);
      if (!assignee) {
        assignee = teamMembers[0];
      }

      if (!taskItem.dependsOn || taskItem.dependsOn.length === 0) {
        independentTasks.push({ index: i, taskItem, assignee });
      } else {
        dependentTasks.push({ index: i, taskItem, assignee });
      }
    }

    this.logger.log(
      `[createTasksFromBreakdown] Task distribution: ${independentTasks.length} independent, ${dependentTasks.length} dependent`,
    );

    // 使用事务确保原子性
    await this.prisma.$transaction(async (tx) => {
      // Phase 1: 批量创建无依赖任务
      if (independentTasks.length > 0) {
        const independentTaskData = independentTasks.map(
          ({ taskItem, assignee }) => ({
            missionId,
            title: taskItem.title,
            description: taskItem.description,
            priority: taskItem.priority as TaskPriority,
            taskType: mapTaskType(taskItem.taskType),
            assignedToId: assignee.id,
            assignedReason: taskItem.reason,
            dependsOnIds: [] as string[],
            status: AgentTaskStatus.PENDING,
            revisionCount: 0,
            maxRevisions: 3,
          }),
        );

        // 使用 createManyAndReturn 批量创建并获取 ID
        const createdTasks = await tx.agentTask.createManyAndReturn({
          data: independentTaskData,
        });

        // 映射创建的任务 ID
        for (let i = 0; i < createdTasks.length; i++) {
          const originalIndex = independentTasks[i].index;
          taskIdMap.set(originalIndex, createdTasks[i].id);

          const chapterKey = extractChapterKey(
            independentTasks[i].taskItem.title,
          );
          if (chapterKey) {
            this.logger.debug(
              `[createTasksFromBreakdown] Created task for chapter ${chapterKey}: ${createdTasks[i].id}`,
            );
          }
        }

        this.logger.log(
          `[createTasksFromBreakdown] Batch created ${createdTasks.length} independent tasks`,
        );
      }

      // Phase 2: 顺序创建有依赖任务（需要依赖前面任务的 ID）
      for (const { index, taskItem, assignee } of dependentTasks) {
        const dependsOnIds = taskItem.dependsOn
          .map((idx) => taskIdMap.get(idx))
          .filter((id): id is string => !!id);

        const chapterKey = extractChapterKey(taskItem.title);

        const task = await tx.agentTask.create({
          data: {
            missionId,
            title: taskItem.title,
            description: taskItem.description,
            priority: taskItem.priority as TaskPriority,
            taskType: mapTaskType(taskItem.taskType),
            assignedToId: assignee.id,
            assignedReason: taskItem.reason,
            dependsOnIds,
            status: AgentTaskStatus.PENDING,
            revisionCount: 0,
            maxRevisions: 3,
          },
        });

        if (chapterKey) {
          this.logger.debug(
            `[createTasksFromBreakdown] Created task for chapter ${chapterKey}: ${task.id}`,
          );
        }

        taskIdMap.set(index, task.id);
      }
    });

    this.logger.log(
      `[createTasksFromBreakdown] Total created: ${taskIdMap.size} tasks`,
    );
  }

  // 注：mapTaskType, truncateDescription 已迁移至 ./utils/misc.utils.ts

  // ==================== 提示词构建 ====================

  private buildLeaderPlanningPrompt(
    mission: MissionWithRelations,
    leader: TeamMemberBase,
    teamMembers: TeamMemberBase[],
    maxDescriptionLength = 8000, // 默认限制描述长度为 8000 字符
  ): string {
    // ★ 构建精确的成员名称列表，用于强调必须使用这些名称
    const memberNames = teamMembers
      .map((m) => m.agentName || m.displayName)
      .filter(Boolean);
    const firstMemberExample = memberNames[0] || "成员名";
    const memberCount = memberNames.length;

    const membersInfo = teamMembers
      .map(
        (m) =>
          `- ${m.agentName || m.displayName}（${m.agentIdentity || m.roleDescription || "团队成员"}）
  擅长领域：${(m.expertiseAreas || []).join("、") || "通用"}
  工作风格：${m.workStyle || "自主型"}
  AI模型：${m.aiModel}`,
      )
      .join("\n");

    // 检测是否为大型内容创作任务，添加特殊约束
    const scopeGuidance = this.buildScopeGuidance(mission);

    // ★ 智能截断过长的描述，防止上下文溢出
    const truncatedDescription = truncateDescription(
      mission.description || "",
      maxDescriptionLength,
    );
    if (
      mission.description &&
      mission.description.length > maxDescriptionLength
    ) {
      this.logger.warn(
        `[buildLeaderPlanningPrompt] Description truncated: ${mission.description.length} -> ${truncatedDescription.length} chars`,
      );
    }

    // ★ 构建已提取的用户约束区块（如"钟叔是哑巴"）
    const mustConstraints = (mission.mustConstraints as HardConstraint[]) || [];
    const userConstraintsSection =
      mustConstraints.length > 0
        ? `
【⚠️ 用户输入中的硬性约束 - 规划时必须遵守】
以下约束是从用户输入中自动提取的，任务分解时所有任务都必须遵守：
${mustConstraints.map((c) => `- [${c.id}] ${c.rule} (${c.severity})`).join("\n")}

🚫 禁止分配任何与上述约束冲突的任务。例如：如果约束是"钟叔是哑巴"，则不能分配"钟叔说话/对话"的任务。
`
        : "";

    return `你是团队的 Leader「${leader.agentName || leader.displayName}」。

【你的团队成员】
${membersInfo}

【⚠️ 极其重要：成员名称必须精确匹配】
**在任务分解表格的"负责人"列，你必须使用以下精确名称之一（复制粘贴，不可修改）：**
${memberNames.map((name) => `- @${name}`).join("\n")}

🚫 **禁止行为：**
- 禁止使用别名、简称、缩写（如 @G4o-mini、@Gem-F1、@GPT5.1 都是无效的）
- 禁止自创名称或修改成员名称
- 禁止省略 @ 符号

✅ **正确示例：** @${firstMemberExample}
❌ **错误示例：** @G4o-mini、@Gem、@GPT（这些别名会导致任务分配失败！）
${userConstraintsSection}
【用户任务】
标题：${mission.title}
描述：${truncatedDescription}
${mission.objectives?.length ? `目标：${mission.objectives.join("、")}` : ""}
${mission.constraints?.length ? `约束：${mission.constraints.join("、")}` : ""}
${mission.deliverables?.length ? `期望交付物：${mission.deliverables.join("、")}` : ""}
${scopeGuidance}
【你的职责】
请分析任务并进行分解，输出格式如下：

## 任务理解
[2-3句话描述你对任务的理解]

## 任务分解
| # | 任务名称 | 负责人 | 分配理由 | 优先级 | 依赖 |
|---|----------|--------|----------|--------|------|
| 1 | ... | @${firstMemberExample} | ... | 高/中/低 | 无 |
| 2 | ... | @${firstMemberExample} | ... | 高/中/低 | 任务1 |
（继续添加更多任务...负责人必须从上面的成员列表中精确选择）

## 执行计划
- 第一阶段：[并行执行的任务]
- 第二阶段：[依赖完成后执行的任务]
（根据实际情况添加更多阶段）

## 风险提示
[可能的风险和应对方案]

【⚠️ 任务分配规则 - 必须严格遵守】
**团队共有 ${memberCount} 名成员，任务必须均匀分配：**

🚫 **绝对禁止：**
- 禁止任何成员分配 0 个任务（每个成员必须有任务！）
- 禁止某成员任务数超过平均值的 1.5 倍
- 禁止将大量任务集中给少数成员

✅ **分配原则：**
- 假设总任务数为 N，每个成员应分配约 N/${memberCount} 个任务（±20%）
- 例如：96 个任务，${memberCount} 名成员，每人约 ${Math.round(96 / Math.max(memberCount, 1))} 个任务
- **分配前请先计算**：总任务数 ÷ 成员数 = 每人基准任务数
- 根据成员擅长领域微调，但差异不超过 ±20%

📊 **分配检查清单（分配完成后自查）：**
- [ ] 每个成员都有任务吗？（不能为 0）
- [ ] 任务数最多的成员 ÷ 最少的成员 < 2 吗？
- [ ] 是否有成员被遗漏？

【其他注意事项】
- 根据每个成员的擅长领域进行最优分配
- 你自己（Leader）只承担协调和审核任务，具体执行任务尽量分配给其他成员
- 确保任务依赖关系合理
- 优先利用并行执行提高效率
- **再次强调：负责人名称必须与上方成员列表完全一致，不可使用任何别名**`;
  }

  /**
   * 构建任务范围指导
   * 针对大型内容创作任务，明确要求一次性分解全部任务
   */
  private buildScopeGuidance(mission: MissionWithRelations): string {
    const text = `${mission.title || ""} ${mission.description || ""}`;

    // 检测大型内容创作任务的特征
    const isLargeContentTask = detectLargeContentTask(text);

    if (!isLargeContentTask) {
      return "";
    }

    // 尝试从描述中提取具体的卷章结构
    const structureHint = extractStructureHint(text);

    return `
【⚠️ 极其重要：任务范围约束 - 必读】
这是一个大型内容创作任务。**你必须严格遵守以下规则，违反将导致任务失败：**

🚫 **绝对禁止的行为：**
- 禁止说"本轮只分解 X 个任务"
- 禁止说"作为起始批次"、"后续再补充"
- 禁止说"先写前几章看看效果"
- 禁止自行决定只执行部分任务

✅ **必须执行的行为：**
1. **一次性列出用户要求的所有任务** - 用户要 8 卷就分解 8 卷的全部章节
2. **完整覆盖用户需求** - 不得遗漏任何卷、章、节
3. **每个章节单独一个任务** - 不得合并多个章节为一个任务
${structureHint}
❌ 错误示例：
- "本轮预期拆出约 3-4 个章节级任务，作为后续全书连载的起始批次"
- "先完成卷一的前几章，后续再继续"

✅ 正确做法：
- 直接列出所有章节任务（如 8 卷 × 12 章 = 96 个任务）
- 任务表格必须包含用户要求的完整内容

`;
  }

  // 注：extractStructureHint, detectLargeContentTask 已迁移至 ./utils/text-extraction.utils.ts

  private buildTaskExecutionPrompt(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    searchContext: string = "",
  ): string {
    // 限制搜索上下文长度，防止上下文过大
    const MAX_SEARCH_CONTEXT_LENGTH = 4000;
    const truncatedSearchContext =
      searchContext.length > MAX_SEARCH_CONTEXT_LENGTH
        ? searchContext.substring(0, MAX_SEARCH_CONTEXT_LENGTH) +
          "\n\n...[搜索结果已截断，仅显示部分内容]"
        : searchContext;

    const searchSection = truncatedSearchContext
      ? `

【参考资料 - 联网搜索结果】
以下是通过网络搜索获取的最新相关信息，请参考这些资料完成任务：

${truncatedSearchContext}

---

`
      : "";

    // ★ 提取 Leader 的任务理解和执行计划作为大纲
    const taskBreakdown = mission.taskBreakdown as {
      understanding?: string;
      executionPlan?: string;
      risks?: string;
    } | null;

    const outlineSection = taskBreakdown?.understanding
      ? `

【⚠️ 重要：整体大纲与规划】
以下是 Leader 对整个任务的理解和规划，**你必须严格遵循这个大纲**，确保内容一致性：

${taskBreakdown.understanding}
${taskBreakdown.executionPlan ? `\n执行计划：${taskBreakdown.executionPlan}` : ""}

---

`
      : "";

    // ★ 新增：世界观设定（从 ContextInitializationService 生成，存储在 mustConstraints 中）
    const worldConstraints =
      (mission.mustConstraints as HardConstraint[]) || [];
    if (worldConstraints.length > 0) {
      this.logger.log(
        `[buildTaskExecutionPrompt] 📖 Injecting ${worldConstraints.length} world settings into task "${task.title}"`,
      );
    }
    const worldSettingsSection =
      worldConstraints.length > 0
        ? `

【🌍 世界观设定 - 必须严格遵守】
以下是本任务的世界观设定，所有创作内容必须与这些设定保持一致：
${worldConstraints.map((c) => `• [${c.id}] ${c.rule}`).join("\n")}

⚠️ 违反世界观设定将导致内容不一致，会被 Leader 打回修改。

---

`
        : "";

    // ★ 新增：强制约束条件（从 mission.constraints 提取）
    const constraintsSection =
      mission.constraints?.length > 0
        ? `

【🚫 强制约束 - 违反将导致审核不通过】
以下约束条件必须严格遵守，否则会被 Leader 打回修改：
${mission.constraints.map((c: string, i: number) => `${i + 1}. ${c}`).join("\n")}

---

`
        : "";

    // ★ 新增：从任务描述中提取关键约束（如字数要求、禁止事项）
    const extractedConstraints = this.extractTaskConstraints(
      mission.description || "",
      task.description || "",
    );

    const extractedConstraintsSection =
      extractedConstraints.length > 0
        ? `

【📋 任务关键要求（从描述中提取）】
${extractedConstraints.map((c, i) => `${i + 1}. ${c}`).join("\n")}

---

`
        : "";

    // ★ 新增：已完成任务摘要（保持一致性）
    const completedTasksSection = this.buildCompletedTasksSummary(
      mission.tasks || [],
      task.id,
    );

    // ★ 新增：明确输出格式要求
    const wordCountHint = extractWordCount(
      task.description || mission.description || "",
    );
    const outputRequirements = `

【✅ 输出要求】
- 字数要求：${wordCountHint || "内容充实，不少于1000字"}
- 格式要求：直接输出正文内容，不要包含"本章小结"、"未完待续"、"字数统计"等元信息
- 一致性：必须与已完成章节的人物设定、世界观、文风保持一致
- 完整性：确保内容完整，有头有尾，情节流畅`;

    return `你正在执行团队任务中的一个子任务。

【总任务背景】
标题：${mission.title}
描述：${mission.description}
${mission.objectives?.length ? `\n目标：${mission.objectives.join("、")}` : ""}
${worldSettingsSection}${constraintsSection}${extractedConstraintsSection}${outlineSection}${completedTasksSection}${searchSection}
【你的子任务】
任务名称：${task.title}
任务描述：${task.description}
任务类型：${task.taskType}
${outputRequirements}

【执行要求】
请认真完成这个任务，输出完整的工作成果。
- **⚠️ 务必遵循上面的整体大纲和规划**，保持与其他章节的一致性
- **⚠️ 严格遵守所有强制约束条件**
- 确保输出内容完整、专业
- 如果有参考资料，请充分利用并注明来源
- 完成后会由 Leader 审核`;
  }

  /**
   * 从任务描述中提取关键约束条件
   */
  private extractTaskConstraints(
    missionDescription: string,
    taskDescription: string,
  ): string[] {
    const constraints: string[] = [];
    const combinedText = `${missionDescription} ${taskDescription}`;

    // 提取字数要求
    const wordCountMatch = combinedText.match(
      /(\d+)\s*字[左右以上]?|每[章节篇][约不少于]*\s*(\d+)\s*字|字数[：:约]\s*(\d+)/,
    );
    if (wordCountMatch) {
      const count = wordCountMatch[1] || wordCountMatch[2] || wordCountMatch[3];
      constraints.push(`字数要求：${count}字左右`);
    }

    // 提取"不能"、"禁止"、"不要"等禁止条件
    const prohibitionPatterns = [
      /([^，。！？\n]{2,30})(不能|禁止|不要|切勿|严禁|不可以|不得)[^，。！？\n]{2,50}/g,
      /(禁止|不能|不要|切勿|严禁|不可以|不得)[^，。！？\n]{2,50}/g,
    ];

    for (const pattern of prohibitionPatterns) {
      const matches = combinedText.matchAll(pattern);
      for (const match of matches) {
        const constraint = match[0].trim();
        if (
          constraint.length > 5 &&
          constraint.length < 100 &&
          !constraints.includes(constraint)
        ) {
          constraints.push(constraint);
        }
      }
    }

    // 提取"必须"、"一定要"等强制条件
    const mandatoryPatterns = [
      /(必须|一定要|务必|确保|需要)[^，。！？\n]{2,50}/g,
    ];

    for (const pattern of mandatoryPatterns) {
      const matches = combinedText.matchAll(pattern);
      for (const match of matches) {
        const constraint = match[0].trim();
        if (
          constraint.length > 5 &&
          constraint.length < 100 &&
          !constraints.includes(constraint)
        ) {
          constraints.push(constraint);
        }
      }
    }

    return constraints.slice(0, 10); // 最多10条约束
  }

  // 注：extractWordCount 已迁移至 ./utils/text-extraction.utils.ts

  /**
   * 构建已完成任务摘要（用于保持一致性）
   */
  private buildCompletedTasksSummary(
    tasks: AgentTaskWithAssignee[],
    currentTaskId: string,
  ): string {
    const completedTasks = tasks.filter(
      (t) =>
        t.status === AgentTaskStatus.COMPLETED &&
        t.id !== currentTaskId &&
        t.result,
    );

    if (completedTasks.length === 0) {
      return "";
    }

    // 最多展示前3个已完成任务的摘要
    const summaries = completedTasks.slice(0, 3).map((t) => {
      const result = t.result || "";
      const resultPreview =
        result.length > 300 ? result.substring(0, 300) + "..." : result;
      const agentName =
        t.assignedTo?.agentName || t.assignedTo?.displayName || "未知";
      return `📖 **${t.title}**（${agentName}完成）\n${resultPreview}`;
    });

    return `

【📚 已完成任务参考 - 请保持一致性】
以下是其他成员已完成的任务摘要，请参考其风格、设定、术语，确保你的输出与之保持一致：

${summaries.join("\n\n---\n\n")}

---

`;
  }

  // 注：needsWebSearch, buildSearchQuery 已迁移至 ./utils/misc.utils.ts

  /**
   * 为长内容生成 AI 摘要，用于 Leader 审核
   * 对于小说等长文创作，生成包含情节梗概、角色、主题的结构化摘要
   */
  private async summarizeForLeaderReview(
    content: string,
    taskTitle: string,
    leaderModel: string,
    missionId?: string,
  ): Promise<{ summary: string; keyExcerpts: string }> {
    const SUMMARY_THRESHOLD = 3000; // 超过3000字符才需要摘要

    if (content.length <= SUMMARY_THRESHOLD) {
      return { summary: content, keyExcerpts: "" };
    }

    try {
      const prompt = `请为以下创作内容生成审核摘要，帮助 Leader 评估内容质量：

【任务】${taskTitle}

【原文内容】（共${content.length}字符）
${content.substring(0, 8000)}${content.length > 8000 ? "\n...[后续内容省略]" : ""}

请输出以下结构化摘要：

## 内容概要
[用200-300字概括主要内容、情节发展、核心观点]

## 关键要素
- 主题/立意：[简述]
- 结构/逻辑：[简述是否清晰完整]
- 风格/语言：[简述文风特点]

## 亮点摘录
[摘录2-3段精彩片段，每段不超过100字]

## 潜在问题
[如有发现，列出可能需要改进的地方]`;

      // ★ 使用 LeaderModelService 支持重试和模型切换
      const result = await this.leaderModelService.executeWithFallback(
        leaderModel,
        async (modelConfig) => {
          return this.aiCallerService.callAIWithConfig(
            modelConfig.modelId,
            [{ role: "user", content: prompt }],
            "你是一位专业的内容审核助手，擅长快速提炼长文精华。请客观、准确地生成摘要。",
            {
              taskProfile: {
                creativity: "deterministic",
                outputLength: "short",
              },
              missionId,
            },
          );
        },
        { operation: "content_summary", context: { missionId } },
      );

      if (!result.success || !result.data) {
        throw new Error(result.error?.message || "摘要生成失败");
      }

      // 提取开头和结尾的关键片段
      const headExcerpt = content.substring(0, 500);
      const tailExcerpt = content.substring(content.length - 500);
      const keyExcerpts = `【开篇】\n${headExcerpt}\n\n【结尾】\n${tailExcerpt}`;

      return {
        summary: result.data.content,
        keyExcerpts,
      };
    } catch (error) {
      this.logger.warn(
        `[summarizeForLeaderReview] 摘要生成失败，使用截断模式: ${error}`,
      );
      // 失败时回退到首尾截取
      const head = content.substring(0, 1500);
      const tail = content.substring(content.length - 800);
      return {
        summary: `${head}\n\n...[中间省略]...\n\n${tail}`,
        keyExcerpts: "",
      };
    }
  }

  private buildLeaderReviewPrompt(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    taskResult: string,
  ): string {
    // 截断任务产出，防止上下文过大导致 Gemini 等模型报错
    // 使用更保守的限制，并采用首尾截取策略保留关键信息
    const MAX_RESULT_LENGTH = 2500;
    let truncatedResult: string;

    if (taskResult.length > MAX_RESULT_LENGTH) {
      // 首尾截取：开头1500字符 + 结尾800字符，保留开篇和结局
      const headLength = 1500;
      const tailLength = 800;
      const head = taskResult.substring(0, headLength);
      const tail = taskResult.substring(taskResult.length - tailLength);
      truncatedResult = `${head}\n\n...[中间内容已省略，原文共${taskResult.length}字符]...\n\n${tail}`;
    } else {
      truncatedResult = taskResult;
    }

    // ★ 构建约束条件提示（用于审核时参考）
    const constraintsHint =
      mission.constraints?.length > 0
        ? `\n**强制约束条件：**\n${mission.constraints.map((c: string, i: number) => `${i + 1}. ${c}`).join("\n")}\n`
        : "";

    return `你是团队 Leader，请审核以下任务产出。

【整体任务背景】
任务主题：${mission.title || "未知"}
${mission.goals ? `任务目标：${mission.goals}` : ""}
${constraintsHint}
【本次审核任务】
任务名称：${task.title}
任务描述：${task.description}

【任务产出】
${truncatedResult}

【⚠️ 审核原则 - 宽进严出，鼓励创作】

**核心原则：质量达标即通过。完美是好的敌人。**

✅ **审核通过的标准（满足以下任一即可通过）：**
- 完成了任务的核心要求
- 内容质量达到可接受水平
- 无严重的设定冲突或事实错误

❌ **仅以下情况才需要修改（非常严格的标准）：**
- 完全偏离任务主题（写的内容与任务无关）
- 严重违反人物核心设定（如让哑巴说话、让死人复活）
- 字数严重不足（低于要求的 30%）
- 内容明显不完整（只有开头没有结尾）

**重要提醒：**
- 文笔风格、细节处理、情节安排等都属于"可接受的创作差异"，不是拒绝理由
- 与你期望的不完全一致 ≠ 需要修改
- 有改进空间 ≠ 需要修改
- 能够串联进整体故事即可通过

请按以下格式输出：

## 审核结果：通过

**内容亮点：**
- [列出1-2个内容亮点，如人物刻画生动、情节紧凑等]

**改进建议（可选）：**
- [如有轻微可改进之处，简要提及，但不影响通过]

---

或者如果存在严重问题：

## 审核结果：需要修改

**必须修复的问题：**
- [仅列出上述❌中的严重问题]`;
  }

  private buildTaskRevisionPrompt(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    feedback: string,
  ): string {
    // 截断之前的产出，防止上下文过大（使用首尾截取策略）
    const MAX_RESULT_LENGTH = 2500;
    const previousResult = task.result || "（无记录）";
    let truncatedPreviousResult: string;

    if (previousResult.length > MAX_RESULT_LENGTH) {
      const headLength = 1500;
      const tailLength = 800;
      const head = previousResult.substring(0, headLength);
      const tail = previousResult.substring(previousResult.length - tailLength);
      truncatedPreviousResult = `${head}\n\n...[中间内容已省略，原文共${previousResult.length}字符]...\n\n${tail}`;
    } else {
      truncatedPreviousResult = previousResult;
    }

    // ★ 合并约束：用户输入约束 + Leader 提取约束（去重）
    const mustConstraints = (mission.mustConstraints as HardConstraint[]) || [];
    const contextConstraints =
      (mission.contextPackage as MissionContextPackage | null)
        ?.hardConstraints || [];

    // 去重合并：以 id 为准，用户约束优先
    const constraintMap = new Map<string, HardConstraint>();
    mustConstraints.forEach((c) => constraintMap.set(c.id, c));
    contextConstraints.forEach((c) => {
      if (!constraintMap.has(c.id)) {
        constraintMap.set(c.id, c);
      }
    });
    const allConstraints = Array.from(constraintMap.values());

    // 构建约束提示区块
    const constraintsSection =
      allConstraints.length > 0
        ? `
【🚫 硬性约束 - 修改时必须遵守】
${allConstraints.map((c) => `• [${c.id}] ${c.rule}`).join("\n")}

⚠️ 违反任何硬性约束将导致再次被驳回。
`
        : "";

    return `你之前提交的任务需要修改。
${constraintsSection}
【任务信息】
任务名称：${task.title}
任务描述：${task.description}

【你之前的产出】
${truncatedPreviousResult}

【Leader 反馈】
${feedback}

【要求】
请根据 Leader 的反馈修改你的产出，确保遵守所有硬性约束，输出修改后的完整内容。`;
  }

  /**
   * 构建完整的最终报告（不截断任何内容）
   * 保证数据完整性：所有任务产出完整保留，按章节/卷结构展示
   */
  private buildFinalReportWithFullContent(mission: MissionWithRelations): {
    fullContent: string;
    summaryPrompt: string;
  } {
    // 获取所有已完成且有结果的任务
    const completedTasks = (mission.tasks || []).filter(
      (t: AgentTaskWithAssignee) => t.status === "COMPLETED" && t.result,
    );

    // ★ 关键：按创建时间排序，确保任务按规划顺序输出
    // 任务是按 Leader 规划顺序创建的，所以 createdAt 代表章节顺序
    completedTasks.sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      return timeA - timeB;
    });

    this.logger.log(
      `[buildFinalReportWithFullContent] 共 ${completedTasks.length} 个已完成任务，按创建时间排序`,
    );

    // 构建完整的分章节内容
    // 检测标题是否已包含章节信息（卷、第X章、Chapter等）
    const hasChapterPattern = (title: string): boolean => {
      return /卷[一二三四五六七八九十\d]+|第[一二三四五六七八九十百千\d]+[章节回]|Chapter\s*\d+/i.test(
        title,
      );
    };

    const chapters = completedTasks.map(
      (t: AgentTaskWithAssignee, index: number) => {
        const agentName =
          t.assignedTo?.agentName || t.assignedTo?.displayName || "未知";
        // 如果标题已包含章节信息，直接使用标题；否则添加序号
        const chapterTitle = hasChapterPattern(t.title)
          ? t.title
          : `第${index + 1}章：${t.title}`;
        return `## ${chapterTitle}
> 作者/负责人：${agentName}
> 字数：${(t.result || "").length} 字

${t.result || "（无内容）"}`;
      },
    );

    const fullContent = `# ${mission.title}

${mission.description || ""}

---

${chapters.join("\n\n---\n\n")}`;

    // 为 AI 生成执行总结准备的简化信息（不包含完整内容，只包含元数据）
    interface TaskMeta {
      title: string;
      agent: string;
      wordCount: number;
      preview: string;
    }
    const taskMeta: TaskMeta[] = completedTasks.map(
      (t: AgentTaskWithAssignee) => ({
        title: t.title,
        agent: t.assignedTo?.agentName || t.assignedTo?.displayName || "未知",
        wordCount: (t.result || "").length,
        preview: (t.result || "").substring(0, 200) + "...",
      }),
    );

    const taskList = taskMeta
      .map(
        (t: TaskMeta, i: number) =>
          `${i + 1}. ${t.title}（${t.agent}）- ${t.wordCount}字\n   预览：${t.preview}`,
      )
      .join("\n");
    const totalWords = taskMeta.reduce(
      (sum: number, t: TaskMeta) => sum + t.wordCount,
      0,
    );
    const participants = [
      ...new Set(taskMeta.map((t: TaskMeta) => t.agent)),
    ].join("、");

    const summaryPrompt = `你是团队 Leader，所有子任务已完成。请根据以下信息生成执行总结（注意：完整内容已单独保存，你只需生成总结）。

【任务信息】
标题：${mission.title}
描述：${mission.description}
${mission.deliverables?.length ? `期望交付物：${mission.deliverables.join("、")}` : ""}

【任务完成情况】
共完成 ${completedTasks.length} 个子任务：
${taskList}

【总字数】${totalWords} 字

请生成执行总结，包括：
1. 任务完成概述
2. 各成员贡献
3. 总体评价

格式：
## 执行总结

| 指标 | 数据 |
|------|------|
| 总任务数 | ${completedTasks.length} |
| 参与成员 | ${participants} |
| 总字数 | ${totalWords} |

[总结性评价]`;

    return { fullContent, summaryPrompt };
  }

  private getLeaderSystemPrompt(leader: TeamMemberBase): string {
    return `你是「${leader.agentName || leader.displayName}」，团队的 Leader。
身份：${leader.agentIdentity || leader.roleDescription || "团队领导"}
职责：负责任务分解、分配、协调和整合结果。
风格：专业、清晰、有建设性。`;
  }

  private getAgentSystemPrompt(
    agent: TaskAssignee | TeamMemberBase,
    task: AgentTaskWithAssignee,
    context?: MissionContextPackage | null,
    missionDescription?: string,
    mustConstraints?: HardConstraint[], // 从用户输入中提取的硬约束
  ): string {
    // ★ 合并从用户输入提取的约束到 context
    let effectiveContext = context;
    if (mustConstraints && mustConstraints.length > 0) {
      // 如果有用户提取的约束，需要合并到 context 中
      if (effectiveContext) {
        // 合并到现有 context
        effectiveContext = {
          ...effectiveContext,
          hardConstraints: [
            ...mustConstraints, // 用户约束优先
            ...effectiveContext.hardConstraints.filter(
              (c) => !mustConstraints.some((mc) => mc.id === c.id),
            ), // 去重
          ],
        };
      } else {
        // 创建新的 context 仅包含约束
        effectiveContext = {
          version: "1.0",
          generatedAt: new Date().toISOString(),
          generatedBy: "system",
          understanding: { summary: "", scope: "", expectedOutput: "" },
          hardConstraints: mustConstraints,
          entities: [],
          prohibitions: [],
          qualityStandards: [],
          glossary: {},
          extensions: {},
        };
      }
      this.logger.debug(
        `[getAgentSystemPrompt] Injected ${mustConstraints.length} user constraints for task "${task.title}"`,
      );
    }

    // Use MissionContextService to build prompt with context and/or mission description
    // This ensures agents receive both structured context AND mission background
    if (effectiveContext || missionDescription) {
      // 类型安全地访问可选属性（TaskAssignee 没有这些字段）
      const agentIdentity =
        "agentIdentity" in agent ? agent.agentIdentity : null;
      const roleDesc =
        "roleDescription" in agent ? agent.roleDescription : null;
      const expertAreas = "expertiseAreas" in agent ? agent.expertiseAreas : [];

      return this.missionContextService.buildAgentSystemPromptWithContext(
        {
          displayName: agent.displayName,
          agentName: agent.agentName ?? undefined,
          agentIdentity: agentIdentity ?? undefined,
          roleDescription: roleDesc ?? undefined,
          expertiseAreas: expertAreas ?? undefined,
        },
        {
          title: task.title,
          description: task.description,
        },
        effectiveContext || null,
        missionDescription,
      );
    }

    // Fallback to simple prompt if no context and no description
    // 类型安全地访问可选属性（TaskAssignee 没有这些字段）
    const agentIdentity = "agentIdentity" in agent ? agent.agentIdentity : null;
    const roleDescription =
      "roleDescription" in agent ? agent.roleDescription : null;
    const expertiseAreas =
      "expertiseAreas" in agent ? agent.expertiseAreas : [];

    return `你是「${agent.agentName || agent.displayName}」，团队成员。
身份：${agentIdentity || roleDescription || "专业人员"}
擅长：${(expertiseAreas || []).join("、") || "多个领域"}
当前任务：${task.title}`;
  }

  private parseTaskBreakdown(
    content: string,
    teamMembers: TeamMemberBase[],
  ): TaskBreakdownData {
    // 简单解析，提取任务信息
    const tasks: TaskBreakdownItem[] = [];

    // ★ 诊断日志：记录可用的成员名称列表
    const availableMemberNames = teamMembers.map((m) => ({
      id: m.id,
      agentName: m.agentName,
      displayName: m.displayName,
      matchKey: (m.agentName || m.displayName)?.toLowerCase(),
    }));
    this.logger.debug(
      `[parseTaskBreakdown] Available members (${teamMembers.length}): ${JSON.stringify(availableMemberNames.map((m) => m.agentName || m.displayName))}`,
    );

    // 使用增强的匹配统计
    const matchStats: MatchStatistics = createMatchStatistics();

    // 尝试解析表格
    const tableMatch = content.match(
      /\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|/g,
    );

    if (tableMatch) {
      for (const row of tableMatch) {
        const cells = row.split("|").filter((c) => c.trim());
        if (
          cells.length >= 6 &&
          !cells[0].includes("#") &&
          !cells[0].includes("-")
        ) {
          matchStats.totalRows++;
          const title = cells[1]?.trim() || "";
          const assigneeName = cells[2]?.trim().replace("@", "") || "";
          const reason = cells[3]?.trim() || "";
          const priorityStr = cells[4]?.trim().toLowerCase() || "medium";
          const dependsStr = cells[5]?.trim() || "";

          // 使用增强版成员匹配（支持模糊匹配）
          const matchResult = findMemberByNameEnhanced(
            assigneeName,
            teamMembers,
          );
          const assignee = matchResult.member;

          // ★ 诊断日志：根据匹配类型记录
          if (matchResult.matchInfo.type === "none" && assigneeName) {
            const unmatchedItem: UnmatchedItem = {
              taskTitle: title,
              inputName: assigneeName,
              availableMembers: availableMemberNames.map(
                (m) => m.agentName || m.displayName,
              ),
            };
            matchStats.unmatched.push(unmatchedItem);
            this.logger.warn(
              `[parseTaskBreakdown] ❌ Member match FAILED: "${assigneeName}" | Available: [${availableMemberNames.map((m) => m.agentName || m.displayName).join(", ")}]`,
            );
          } else if (matchResult.matchInfo.type === "fuzzy") {
            matchStats.fuzzyMatched++;
            this.logger.warn(
              `[parseTaskBreakdown] ⚠️ Fuzzy match: "${assigneeName}" → "${matchResult.matchInfo.suggestion}" (confidence: ${matchResult.matchInfo.confidence.toFixed(2)})`,
            );
          }

          // 解析依赖
          const dependsOn: number[] = [];
          const depMatches = dependsStr.match(/\d+/g);
          if (depMatches) {
            for (const dep of depMatches) {
              dependsOn.push(parseInt(dep, 10) - 1); // 转换为0索引
            }
          }

          // 解析优先级
          let priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" = "MEDIUM";
          if (
            priorityStr.includes("关键") ||
            priorityStr.includes("critical")
          ) {
            priority = "CRITICAL";
          } else if (
            priorityStr.includes("高") ||
            priorityStr.includes("high")
          ) {
            priority = "HIGH";
          } else if (
            priorityStr.includes("低") ||
            priorityStr.includes("low")
          ) {
            priority = "LOW";
          }

          if (title && assignee) {
            matchStats.matched++;
            const memberKey = assignee.agentName || assignee.displayName;
            matchStats.memberTaskCount.set(
              memberKey,
              (matchStats.memberTaskCount.get(memberKey) || 0) + 1,
            );

            tasks.push({
              title,
              description: title,
              assigneeId: assignee.id,
              assigneeName: assignee.agentName || assignee.displayName,
              reason,
              priority,
              taskType: "implementation",
              dependsOn,
            });
          }
        }
      }
    }

    // ★ 诊断日志：输出匹配统计摘要
    const taskDistribution = Object.fromEntries(matchStats.memberTaskCount);
    const membersWithNoTasks = teamMembers.filter(
      (m) => !matchStats.memberTaskCount.has(m.agentName || m.displayName),
    );

    this.logger.log(
      `[parseTaskBreakdown] 📊 Match Summary: ${matchStats.matched}/${matchStats.totalRows} tasks matched (fuzzy: ${matchStats.fuzzyMatched})`,
    );
    this.logger.log(
      `[parseTaskBreakdown] 📊 Task Distribution: ${JSON.stringify(taskDistribution)}`,
    );

    if (matchStats.unmatched.length > 0) {
      this.logger.warn(
        `[parseTaskBreakdown] ⚠️ Unmatched names (${matchStats.unmatched.length}): ${JSON.stringify(matchStats.unmatched.map((u) => u.inputName))}`,
      );
    }

    if (membersWithNoTasks.length > 0) {
      this.logger.warn(
        `[parseTaskBreakdown] ⚠️ Members with NO tasks (${membersWithNoTasks.length}): ${JSON.stringify(membersWithNoTasks.map((m) => m.agentName || m.displayName))}`,
      );
    }

    // ★ 失败率检测：超过 10% 视为规划失败
    if (isMatchFailureRateExceeded(matchStats, 0.1)) {
      const errorMsg = formatMatchFailureError(
        matchStats,
        availableMemberNames.map((m) => m.agentName || m.displayName),
      );
      this.logger.error(`[parseTaskBreakdown] ${errorMsg}`);
      throw new BadRequestException(errorMsg);
    }

    // 如果解析失败，创建一个默认任务
    if (tasks.length === 0 && teamMembers.length > 0) {
      this.logger.warn(
        `[parseTaskBreakdown] No tasks parsed, creating default task for first member`,
      );
      tasks.push({
        title: "执行任务",
        description: "完成用户请求的任务",
        assigneeId: teamMembers[0].id,
        assigneeName: teamMembers[0].agentName || teamMembers[0].displayName,
        reason: "作为团队成员执行任务",
        priority: "MEDIUM",
        taskType: "implementation",
        dependsOn: [],
      });
    }

    return {
      understanding: content.match(/## 任务理解\n([^#]+)/)?.[1]?.trim() || "",
      tasks,
      executionPlan: content.match(/## 执行计划\n([^#]+)/)?.[1]?.trim() || "",
      risks: content.match(/## 风险提示\n([^#]+)/)?.[1]?.trim() || "",
    };
  }

  // 注：parseReviewResult 已迁移至 ./utils/parsing.utils.ts

  // ==================== 查询方法 ====================

  async getMissions(topicId: string, options?: { status?: MissionStatus }) {
    return this.prisma.teamMission.findMany({
      where: {
        topicId,
        ...(options?.status && { status: options.status }),
      },
      include: {
        leader: {
          select: {
            id: true,
            displayName: true,
            agentName: true,
            avatar: true,
            aiModel: true,
          },
        },
        createdBy: {
          select: { id: true, username: true, fullName: true },
        },
        tasks: {
          include: {
            assignedTo: {
              select: {
                id: true,
                displayName: true,
                agentName: true,
                avatar: true,
                aiModel: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: { tasks: true, logs: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getMissionById(missionId: string) {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
      include: {
        leader: true,
        createdBy: {
          select: { id: true, username: true, fullName: true },
        },
        tasks: {
          include: {
            assignedTo: {
              select: {
                id: true,
                displayName: true,
                agentName: true,
                avatar: true,
                aiModel: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        logs: {
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    });

    if (!mission) {
      throw new NotFoundException("任务不存在");
    }

    return mission;
  }

  async getMissionLogs(
    missionId: string,
    options?: { limit?: number; cursor?: string },
  ) {
    const limit = options?.limit || 50;

    return this.prisma.missionLog.findMany({
      where: { missionId },
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(options?.cursor && {
        cursor: { id: options.cursor },
        skip: 1,
      }),
    });
  }

  /**
   * 获取完整报告内容（直接从任务数据构建，不依赖 finalResult 缓存）
   * 用于前端显示完整报告，确保内容始终完整
   */
  async getFullReport(missionId: string): Promise<{
    success: boolean;
    message: string;
    fullContent?: string;
    taskCount?: number;
    totalWords?: number;
  }> {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
      include: {
        leader: true,
        tasks: {
          include: { assignedTo: true },
        },
      },
    });

    if (!mission) {
      return { success: false, message: "任务不存在" };
    }

    try {
      const { fullContent } = this.buildFinalReportWithFullContent(mission);
      const completedTasks = (mission.tasks || []).filter(
        (t: AgentTaskWithAssignee) =>
          t.status === AgentTaskStatus.COMPLETED && t.result,
      );
      const totalWords = completedTasks.reduce(
        (sum: number, t: AgentTaskWithAssignee) =>
          sum + (t.result || "").length,
        0,
      );

      // 生成执行总结
      const executiveSummary = `## 执行总结\n\n| 指标 | 数据 |\n|------|------|\n| 总任务数 | ${completedTasks.length}/${mission.tasks?.length || 0} |\n| 完成率 | ${mission.tasks?.length ? ((completedTasks.length / mission.tasks.length) * 100).toFixed(1) : 0}% |\n| 总字数 | ${totalWords} 字 |`;

      const finalReport = `${executiveSummary}\n\n---\n\n${fullContent}`;

      return {
        success: true,
        message: `获取成功，包含 ${completedTasks.length} 个章节`,
        fullContent: finalReport,
        taskCount: completedTasks.length,
        totalWords,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, message: `获取失败: ${errorMsg}` };
    }
  }

  /**
   * 重新生成最终报告
   * 用于修复已完成任务的报告内容（例如排序问题、内容缺失等）
   */
  async regenerateFinalReport(missionId: string): Promise<{
    success: boolean;
    message: string;
    finalResult?: string;
    taskCount?: number;
  }> {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
      include: {
        leader: true,
        tasks: {
          include: { assignedTo: true },
        },
      },
    });

    if (!mission) {
      return { success: false, message: "任务不存在" };
    }

    if (mission.status !== MissionStatus.COMPLETED) {
      return { success: false, message: "只能重新生成已完成任务的报告" };
    }

    this.logger.log(
      `[regenerateFinalReport] 开始重新生成报告: ${missionId}, 任务数: ${mission.tasks?.length || 0}`,
    );

    try {
      // 重新构建完整报告（使用最新的排序逻辑）
      const { fullContent } = this.buildFinalReportWithFullContent(mission);

      // 生成新的执行总结
      const completedTasks = (mission.tasks || []).filter(
        (t: AgentTaskWithAssignee) =>
          t.status === AgentTaskStatus.COMPLETED && t.result,
      );
      const totalWords = completedTasks.reduce(
        (sum: number, t: AgentTaskWithAssignee) =>
          sum + (t.result || "").length,
        0,
      );

      const executiveSummary = `## 执行总结\n\n| 指标 | 数据 |\n|------|------|\n| 总任务数 | ${completedTasks.length}/${mission.tasks?.length || 0} |\n| 完成率 | ${mission.tasks?.length ? ((completedTasks.length / mission.tasks.length) * 100).toFixed(1) : 0}% |\n| 总字数 | ${totalWords} 字 |`;

      // 最终报告 = 执行总结 + 完整内容
      const finalReport = `${executiveSummary}\n\n---\n\n${fullContent}`;

      this.logger.log(
        `[regenerateFinalReport] 报告生成完成，包含 ${completedTasks.length} 个任务，总长度: ${finalReport.length} 字符`,
      );

      // 更新数据库
      await this.prisma.teamMission.update({
        where: { id: missionId },
        data: { finalResult: finalReport },
      });

      // 广播更新事件
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:updated",
        {
          missionId,
          finalResult: finalReport,
        },
      );

      return {
        success: true,
        message: `报告已重新生成，包含 ${completedTasks.length} 个章节`,
        finalResult: finalReport,
        taskCount: completedTasks.length,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[regenerateFinalReport] 重新生成报告失败: ${errorMsg}`,
      );
      return { success: false, message: `生成失败: ${errorMsg}` };
    }
  }

  /**
   * 获取公开报告（无需认证）
   * 用于分享链接的公开访问
   */
  async getPublicReport(missionId: string): Promise<{
    success: boolean;
    message: string;
    report?: {
      id: string;
      title: string;
      description: string;
      status: string;
      leader: string;
      createdAt: Date;
      completedAt: Date | null;
      fullContent: string;
      taskCount: number;
      totalWords: number;
    };
  }> {
    const mission = await this.prisma.teamMission.findUnique({
      where: { id: missionId },
      include: {
        leader: true,
        tasks: {
          include: { assignedTo: true },
        },
      },
    });

    if (!mission) {
      return { success: false, message: "报告不存在" };
    }

    if (mission.status !== MissionStatus.COMPLETED) {
      return { success: false, message: "报告尚未完成，无法查看" };
    }

    try {
      // Cast to MissionWithRelations for proper typing
      const missionWithRelations = mission as unknown as MissionWithRelations;

      // 构建完整报告内容
      const { fullContent } =
        this.buildFinalReportWithFullContent(missionWithRelations);
      const completedTasks = (missionWithRelations.tasks || []).filter(
        (t: AgentTaskWithAssignee) =>
          t.status === AgentTaskStatus.COMPLETED && t.result,
      );
      const totalWords = completedTasks.reduce(
        (sum: number, t: AgentTaskWithAssignee) =>
          sum + (t.result || "").length,
        0,
      );

      return {
        success: true,
        message: "获取成功",
        report: {
          id: mission.id,
          title: mission.title,
          description: mission.description || "",
          status: mission.status,
          leader:
            missionWithRelations.leader?.agentName ||
            missionWithRelations.leader?.displayName ||
            "未知",
          createdAt: mission.createdAt,
          completedAt: mission.completedAt,
          fullContent,
          taskCount: completedTasks.length,
          totalWords,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, message: `获取失败: ${errorMsg}` };
    }
  }

  async cancelMission(missionId: string, userId: string) {
    return this.lifecycleService.cancelMission(
      missionId,
      userId,
      this.createLog.bind(this),
    );
  }

  /**
   * 删除任务（仅限历史任务：已完成、失败或取消的任务）
   */
  async deleteMission(missionId: string, userId: string) {
    return this.lifecycleService.deleteMission(missionId, userId);
  }

  /**
   * 更新任务通知配置
   * 支持在任务创建后修改通知邮箱
   */
  async updateMissionNotification(
    missionId: string,
    userId: string,
    dto: { notificationEmail?: string | null },
  ) {
    return this.lifecycleService.updateMissionNotification(
      missionId,
      userId,
      dto,
      this.createLog.bind(this),
    );
  }

  /**
   * 暂停任务（可恢复）
   */
  async pauseMission(missionId: string, userId: string) {
    return this.lifecycleService.pauseMission(
      missionId,
      userId,
      this.sendMessageToTopic.bind(this),
      this.createLog.bind(this),
    );
  }

  /**
   * 恢复已暂停的任务
   */
  async resumeMission(missionId: string, userId: string) {
    return this.lifecycleService.resumeMission(
      missionId,
      userId,
      this.sendMessageToTopic.bind(this),
      this.createLog.bind(this),
      this.executeNextTasks.bind(this),
      this.startMission.bind(this),
    );
  }

  /**
   * 重试失败或已取消的任务
   * 委托给 MissionRetryService
   */
  async retryMission(
    missionId: string,
    userId: string,
    options?: { mode?: "full" | "continue"; reason?: string },
  ) {
    return this.retryService.retryMission(
      missionId,
      userId,
      options,
      this.sendMessageToTopic.bind(this),
      this.createLog.bind(this),
      this.startMission.bind(this),
      this.handleLeaderMentionCommand.bind(this),
      this.executeNextTasks.bind(this),
    );
  }

  /**
   * 处理 Leader @消息触发的任务控制命令
   * 支持的命令：继续执行、重试、重新开始、继续组织等
   */
  async handleLeaderMentionCommand(
    topicId: string,
    userId: string,
    content: string,
  ): Promise<{ handled: boolean; action?: string; missionId?: string }> {
    const contentLower = content.toLowerCase();

    // 检测重试/继续执行关键词
    const retryKeywords = [
      "继续执行",
      "继续",
      "重试",
      "再试",
      "再执行",
      "重新执行",
      "重新开始",
      "restart",
      "retry",
      "continue",
    ];

    // 检测继续组织/完成任务关键词（用于 IN_PROGRESS 状态的 Mission）
    const continueOrgKeywords = [
      "组织",
      "完成任务",
      "继续组织",
      "系统组织",
      "完成整个任务",
      "分配任务",
      "委派",
      "delegate",
      "organize",
    ];

    const hasRetryKeyword = retryKeywords.some((kw) =>
      contentLower.includes(kw.toLowerCase()),
    );

    const hasContinueOrgKeyword = continueOrgKeywords.some((kw) =>
      contentLower.includes(kw.toLowerCase()),
    );

    // 首先检查是否有正在执行的任务（IN_PROGRESS）
    const inProgressMission = await this.prisma.teamMission.findFirst({
      where: {
        topicId,
        status: MissionStatus.IN_PROGRESS,
      },
      orderBy: { createdAt: "desc" },
      include: { leader: true, tasks: true },
    });

    if (inProgressMission && (hasRetryKeyword || hasContinueOrgKeyword)) {
      // 有正在执行的任务，用户要求继续组织
      this.logger.log(
        `[Leader Command] Continuing in-progress mission ${inProgressMission.id}`,
      );

      // 检查是否有卡住的 IN_PROGRESS 任务（超过 5 分钟）
      const stuckThreshold = 5 * 60 * 1000; // 5 minutes
      const now = Date.now();
      const stuckInProgressTasks = inProgressMission.tasks.filter(
        (t) =>
          t.status === AgentTaskStatus.IN_PROGRESS &&
          t.startedAt &&
          now - new Date(t.startedAt).getTime() > stuckThreshold,
      );

      // 重置卡住的任务为 PENDING
      if (stuckInProgressTasks.length > 0) {
        this.logger.warn(
          `[Leader Command] Found ${stuckInProgressTasks.length} stuck IN_PROGRESS tasks, resetting to PENDING`,
        );
        for (const task of stuckInProgressTasks) {
          await this.prisma.agentTask.update({
            where: { id: task.id },
            data: {
              status: AgentTaskStatus.PENDING,
              startedAt: null,
            },
          });
        }
      }

      // 检查卡住的 AWAITING_REVIEW 任务（使用 updatedAt 判断）
      const stuckAwaitingReviewTasks = inProgressMission.tasks.filter(
        (t) =>
          t.status === AgentTaskStatus.AWAITING_REVIEW &&
          t.updatedAt &&
          now - new Date(t.updatedAt).getTime() > stuckThreshold,
      );

      // 检查卡住的 REVISION_NEEDED 任务
      const stuckRevisionNeededTasks = inProgressMission.tasks.filter(
        (t) =>
          t.status === AgentTaskStatus.REVISION_NEEDED &&
          t.updatedAt &&
          now - new Date(t.updatedAt).getTime() > stuckThreshold,
      );

      // 重新获取任务状态
      const updatedMission = await this.prisma.teamMission.findUnique({
        where: { id: inProgressMission.id },
        include: {
          leader: true,
          tasks: {
            include: {
              assignedTo: true,
            },
          },
        },
      });

      if (!updatedMission) {
        return { handled: false };
      }

      // 处理卡住的 AWAITING_REVIEW 任务：重新触发 Leader 审核
      if (stuckAwaitingReviewTasks.length > 0) {
        this.logger.warn(
          `[Leader Command] Found ${stuckAwaitingReviewTasks.length} stuck AWAITING_REVIEW tasks, re-triggering leader review`,
        );

        await this.sendMessageToTopic(
          topicId,
          updatedMission.leader?.id || null,
          `🔄 收到指令，正在重新审核 ${stuckAwaitingReviewTasks.length} 个卡住的待审核任务...`,
          MessageContentType.TEXT,
        );

        // 异步重新触发审核（不阻塞响应）
        for (const stuckTask of stuckAwaitingReviewTasks) {
          const fullTask = updatedMission.tasks.find(
            (t) => t.id === stuckTask.id,
          );
          if (fullTask && fullTask.result) {
            this.leaderReviewTask(
              updatedMission,
              fullTask,
              fullTask.result,
            ).catch((error) => {
              this.logger.error(
                `Failed to re-trigger leader review for task ${stuckTask.id}: ${error}`,
              );
            });
          }
        }

        return {
          handled: true,
          action: "re_review_tasks",
          missionId: inProgressMission.id,
        };
      }

      // 处理卡住的 REVISION_NEEDED 任务：重新触发修订
      if (stuckRevisionNeededTasks.length > 0) {
        this.logger.warn(
          `[Leader Command] Found ${stuckRevisionNeededTasks.length} stuck REVISION_NEEDED tasks, re-triggering revision`,
        );

        await this.sendMessageToTopic(
          topicId,
          updatedMission.leader?.id || null,
          `🔄 收到指令，正在重新触发 ${stuckRevisionNeededTasks.length} 个卡住的修订任务...`,
          MessageContentType.TEXT,
        );

        // 异步重新触发修订（不阻塞响应）
        for (const stuckTask of stuckRevisionNeededTasks) {
          const fullTask = updatedMission.tasks.find(
            (t) => t.id === stuckTask.id,
          );
          if (fullTask && fullTask.leaderFeedback) {
            this.executeTaskRevision(
              updatedMission,
              fullTask,
              fullTask.leaderFeedback,
            ).catch((error) => {
              this.logger.error(
                `Failed to re-trigger revision for task ${stuckTask.id}: ${error}`,
              );
            });
          }
        }

        return {
          handled: true,
          action: "re_revision_tasks",
          missionId: inProgressMission.id,
        };
      }

      // 检查是否有待执行的任务
      const pendingTasks = updatedMission.tasks.filter(
        (t) => t.status === AgentTaskStatus.PENDING,
      );

      if (pendingTasks.length > 0) {
        // 计算哪些任务可以真正开始（依赖已完成）
        const tasksCanStart = pendingTasks.filter((task) => {
          const dependsOnIds = task.dependsOnIds || [];
          return dependsOnIds.every((depId: string) => {
            const depTask = updatedMission.tasks.find((t) => t.id === depId);
            return depTask?.status === AgentTaskStatus.COMPLETED;
          });
        });

        // 找出阻塞的任务及其原因
        const blockedTasks = pendingTasks.filter((task) => {
          const dependsOnIds = task.dependsOnIds || [];
          return dependsOnIds.some((depId: string) => {
            const depTask = updatedMission.tasks.find((t) => t.id === depId);
            return depTask?.status !== AgentTaskStatus.COMPLETED;
          });
        });

        // 找出阻塞依赖中需要处理的任务
        const blockingTaskIds = new Set<string>();
        for (const task of blockedTasks) {
          const dependsOnIds = task.dependsOnIds || [];
          for (const depId of dependsOnIds) {
            const depTask = updatedMission.tasks.find((t) => t.id === depId);
            if (depTask && depTask.status !== AgentTaskStatus.COMPLETED) {
              blockingTaskIds.add(depId);
            }
          }
        }

        // 获取阻塞任务的详细信息
        const blockingTasks = updatedMission.tasks.filter((t) =>
          blockingTaskIds.has(t.id),
        );

        // 处理阻塞任务（无论是否超时，用户明确要求继续时应尝试恢复）
        const awaitingReviewBlocking = blockingTasks.filter(
          (t) => t.status === AgentTaskStatus.AWAITING_REVIEW,
        );
        const revisionNeededBlocking = blockingTasks.filter(
          (t) => t.status === AgentTaskStatus.REVISION_NEEDED,
        );
        const inProgressBlocking = blockingTasks.filter(
          (t) => t.status === AgentTaskStatus.IN_PROGRESS,
        );

        // 如果有可以开始的任务，执行它们
        if (tasksCanStart.length > 0) {
          this.executeNextTasks(inProgressMission.id).catch((error) => {
            this.logger.error(
              `Failed to continue mission execution: ${error instanceof Error ? error.message : error}`,
            );
          });

          // ★ 简化消息：不再显示详细的任务统计信息
          await this.sendMessageToTopic(
            topicId,
            updatedMission.leader?.id || null,
            `✅ 收到，继续执行任务...`,
            MessageContentType.TEXT,
          );

          return {
            handled: true,
            action: "continue_organizing",
            missionId: inProgressMission.id,
          };
        }

        // 所有 pending 任务都被阻塞，需要处理阻塞原因
        this.logger.warn(
          `[Leader Command] All ${pendingTasks.length} pending tasks are blocked by dependencies`,
        );

        // 处理阻塞的 AWAITING_REVIEW 任务
        if (awaitingReviewBlocking.length > 0) {
          this.logger.log(
            `[Leader Command] Re-triggering review for ${awaitingReviewBlocking.length} blocking AWAITING_REVIEW tasks`,
          );
          // ★ 简化消息
          await this.sendMessageToTopic(
            topicId,
            updatedMission.leader?.id || null,
            `✅ 收到，正在处理待审核任务...`,
            MessageContentType.TEXT,
          );

          for (const task of awaitingReviewBlocking) {
            if (task.result) {
              this.leaderReviewTask(updatedMission, task, task.result).catch(
                (error) => {
                  this.logger.error(
                    `Failed to re-trigger leader review for blocking task ${task.id}: ${error}`,
                  );
                },
              );
            }
          }

          return {
            handled: true,
            action: "re_review_blocking_tasks",
            missionId: inProgressMission.id,
          };
        }

        // 处理阻塞的 REVISION_NEEDED 任务
        if (revisionNeededBlocking.length > 0) {
          this.logger.log(
            `[Leader Command] Re-triggering revision for ${revisionNeededBlocking.length} blocking REVISION_NEEDED tasks`,
          );
          // ★ 简化消息
          await this.sendMessageToTopic(
            topicId,
            updatedMission.leader?.id || null,
            `✅ 收到，正在处理待修订任务...`,
            MessageContentType.TEXT,
          );

          for (const task of revisionNeededBlocking) {
            if (task.leaderFeedback) {
              this.executeTaskRevision(
                updatedMission,
                task,
                task.leaderFeedback,
              ).catch((error) => {
                this.logger.error(
                  `Failed to re-trigger revision for blocking task ${task.id}: ${error}`,
                );
              });
            }
          }

          return {
            handled: true,
            action: "re_revision_blocking_tasks",
            missionId: inProgressMission.id,
          };
        }

        // 处理阻塞的 IN_PROGRESS 任务（可能卡住）
        if (inProgressBlocking.length > 0) {
          // 检查是否真的卡住（超过阈值）
          const stuckBlocking = inProgressBlocking.filter(
            (t) =>
              t.startedAt &&
              now - new Date(t.startedAt).getTime() > stuckThreshold,
          );

          if (stuckBlocking.length > 0) {
            // 重置卡住的任务
            for (const task of stuckBlocking) {
              await this.prisma.agentTask.update({
                where: { id: task.id },
                data: {
                  status: AgentTaskStatus.PENDING,
                  startedAt: null,
                },
              });
            }

            await this.sendMessageToTopic(
              topicId,
              updatedMission.leader?.id || null,
              `🔄 检测到 ${stuckBlocking.length} 个阻塞的任务已卡住，已重置为待执行状态，正在重新执行...`,
              MessageContentType.TEXT,
            );

            // 重新执行
            this.executeNextTasks(inProgressMission.id).catch((error) => {
              this.logger.error(
                `Failed to restart blocked tasks: ${error instanceof Error ? error.message : error}`,
              );
            });

            return {
              handled: true,
              action: "reset_blocking_tasks",
              missionId: inProgressMission.id,
            };
          } else {
            // 正在执行中，还没卡住
            await this.sendMessageToTopic(
              topicId,
              updatedMission.leader?.id || null,
              `⏳ ${pendingTasks.length} 个待执行任务正在等待依赖完成\n\n依赖任务正在执行中：${inProgressBlocking.length} 个\n请耐心等待...`,
              MessageContentType.TEXT,
            );

            return {
              handled: true,
              action: "waiting_for_dependencies",
              missionId: inProgressMission.id,
            };
          }
        }

        // 其他情况（可能是依赖任务被取消或阻塞等）
        const cancelledBlocking = blockingTasks.filter(
          (t) =>
            t.status === AgentTaskStatus.CANCELLED ||
            t.status === AgentTaskStatus.BLOCKED,
        );
        if (cancelledBlocking.length > 0) {
          await this.sendMessageToTopic(
            topicId,
            updatedMission.leader?.id || null,
            `⚠️ ${pendingTasks.length} 个待执行任务被阻塞\n\n原因：${cancelledBlocking.length} 个依赖任务已取消或被阻塞\n请考虑重新创建任务或取消当前任务`,
            MessageContentType.TEXT,
          );

          return {
            handled: true,
            action: "blocked_by_cancelled",
            missionId: inProgressMission.id,
          };
        }

        // 未知阻塞原因
        await this.sendMessageToTopic(
          topicId,
          updatedMission.leader?.id || null,
          `⚠️ ${pendingTasks.length} 个待执行任务被阻塞，正在分析原因...`,
          MessageContentType.TEXT,
        );

        return {
          handled: true,
          action: "blocked_unknown",
          missionId: inProgressMission.id,
        };
      } else {
        // 检查是否有真正正在执行的任务（最近才开始的，未超时）
        const trulyActiveTasks = updatedMission.tasks.filter(
          (t) =>
            (t.status === AgentTaskStatus.IN_PROGRESS &&
              t.startedAt &&
              now - new Date(t.startedAt).getTime() <= stuckThreshold) ||
            (t.status === AgentTaskStatus.AWAITING_REVIEW &&
              t.updatedAt &&
              now - new Date(t.updatedAt).getTime() <= stuckThreshold) ||
            (t.status === AgentTaskStatus.REVISION_NEEDED &&
              t.updatedAt &&
              now - new Date(t.updatedAt).getTime() <= stuckThreshold),
        );

        if (trulyActiveTasks.length > 0) {
          await this.sendMessageToTopic(
            topicId,
            updatedMission.leader?.id || null,
            `⏳ 任务正在执行中...\n\n- 进行中/待审核任务：${trulyActiveTasks.length} 个\n- 请耐心等待任务完成`,
            MessageContentType.TEXT,
          );

          return {
            handled: true,
            action: "already_executing",
            missionId: inProgressMission.id,
          };
        }

        // ★ 计算完成率，检查是否可以强制完成
        const completedTasks = updatedMission.tasks.filter(
          (t) => t.status === AgentTaskStatus.COMPLETED,
        );
        const completionRate =
          completedTasks.length / updatedMission.tasks.length;
        const FORCE_COMPLETE_THRESHOLD = 0.85; // 85% 完成即可强制完成

        // 所有任务都已完成，或者达到强制完成阈值
        const allCompleted = updatedMission.tasks.every(
          (t) => t.status === AgentTaskStatus.COMPLETED,
        );

        if (allCompleted && updatedMission.tasks.length > 0) {
          this.completeMission(inProgressMission.id).catch((error) => {
            this.logger.error(
              `Failed to complete mission: ${error instanceof Error ? error.message : error}`,
            );
          });

          return {
            handled: true,
            action: "completing_mission",
            missionId: inProgressMission.id,
          };
        }

        // ★ 没有真正活跃的任务，且完成率 >= 85%，强制完成剩余任务
        if (completionRate >= FORCE_COMPLETE_THRESHOLD) {
          const remainingTasks = updatedMission.tasks.filter(
            (t) => t.status !== AgentTaskStatus.COMPLETED,
          );

          this.logger.warn(
            `[Leader Command] Completion rate ${(completionRate * 100).toFixed(1)}% >= 85%, force completing ${remainingTasks.length} remaining tasks`,
          );

          await this.sendMessageToTopic(
            topicId,
            updatedMission.leader?.id || null,
            `📊 检测到任务完成率已达 ${(completionRate * 100).toFixed(1)}%，正在强制完成剩余 ${remainingTasks.length} 个任务...`,
            MessageContentType.TEXT,
          );

          // 强制完成所有未完成任务
          for (const task of remainingTasks) {
            await this.prisma.agentTask.update({
              where: { id: task.id },
              data: {
                status: AgentTaskStatus.COMPLETED,
                completedAt: new Date(),
                result:
                  task.result ||
                  `[自动完成] 任务在高完成率下被系统自动标记为完成（完成率: ${(completionRate * 100).toFixed(1)}%）`,
              },
            });
          }

          // 触发 Mission 完成
          this.completeMission(inProgressMission.id).catch((error) => {
            this.logger.error(
              `Failed to complete mission after force completing tasks: ${error instanceof Error ? error.message : error}`,
            );
          });

          return {
            handled: true,
            action: "force_completing_mission",
            missionId: inProgressMission.id,
          };
        }

        // ★ 没有活跃任务，也没达到强制完成阈值，尝试触发 executeNextTasks
        this.logger.warn(
          `[Leader Command] No truly active tasks, completion rate ${(completionRate * 100).toFixed(1)}%, triggering executeNextTasks`,
        );

        await this.sendMessageToTopic(
          topicId,
          updatedMission.leader?.id || null,
          `🔄 检测到任务可能卡住，正在尝试恢复执行...`,
          MessageContentType.TEXT,
        );

        this.executeNextTasks(inProgressMission.id).catch((error) => {
          this.logger.error(
            `Failed to execute next tasks: ${error instanceof Error ? error.message : error}`,
          );
        });

        return {
          handled: true,
          action: "retry_execution",
          missionId: inProgressMission.id,
        };
      }
    }

    // 检查是否有卡住的 PLANNING 状态任务
    const planningMission = await this.prisma.teamMission.findFirst({
      where: {
        topicId,
        status: MissionStatus.PLANNING,
      },
      orderBy: { createdAt: "desc" },
      include: { leader: true },
    });

    if (planningMission && (hasRetryKeyword || hasContinueOrgKeyword)) {
      // PLANNING 状态卡住，重新触发规划
      this.logger.warn(
        `[Leader Command] Mission ${planningMission.id} stuck in PLANNING, restarting planning`,
      );

      // 重置为 PENDING 状态
      await this.prisma.teamMission.update({
        where: { id: planningMission.id },
        data: { status: MissionStatus.PENDING },
      });

      // 重新启动
      this.startMission(planningMission.id, userId).catch((error) => {
        this.logger.error(
          `Failed to restart planning: ${error instanceof Error ? error.message : error}`,
        );
      });

      await this.sendMessageToTopic(
        topicId,
        planningMission.leader?.id || null,
        `🔄 检测到任务规划中断，正在重新启动规划...`,
        MessageContentType.TEXT,
      );

      return {
        handled: true,
        action: "restart_planning",
        missionId: planningMission.id,
      };
    }

    // 如果没有重试关键词，返回未处理
    if (!hasRetryKeyword) {
      return { handled: false };
    }

    // 查找该 Topic 最近的失败/取消/暂停任务
    const recentMission = await this.prisma.teamMission.findFirst({
      where: {
        topicId,
        status: {
          in: [
            MissionStatus.FAILED,
            MissionStatus.CANCELLED,
            MissionStatus.PAUSED,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      include: { leader: true },
    });

    if (!recentMission) {
      // 没有可重试的任务，返回未处理
      return { handled: false };
    }

    // 判断是完全重试还是继续执行
    const fullRetryKeywords = ["重新开始", "重新执行", "restart", "重试"];
    const isFullRetry = fullRetryKeywords.some((kw) =>
      contentLower.includes(kw.toLowerCase()),
    );

    try {
      if (recentMission.status === MissionStatus.PAUSED) {
        // 暂停的任务，使用 resume
        await this.resumeMission(recentMission.id, userId);
        return {
          handled: true,
          action: "resume",
          missionId: recentMission.id,
        };
      } else {
        // 失败/取消的任务，使用 retry
        await this.retryMission(recentMission.id, userId, {
          mode: isFullRetry ? "full" : "continue",
          reason: "用户通过 @Leader 消息触发",
        });
        return {
          handled: true,
          action: isFullRetry ? "retry_full" : "retry_continue",
          missionId: recentMission.id,
        };
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle leader mention command: ${error instanceof Error ? error.message : error}`,
      );
      return { handled: false };
    }
  }

  // ==================== 设置 Leader ====================

  async setLeader(topicId: string, aiMemberId: string) {
    return this.memberService.setLeader(topicId, aiMemberId);
  }

  async getTeamMembers(topicId: string) {
    return this.memberService.getTeamMembers(topicId);
  }

  // ==================== Helper Methods ====================
  // 注：映射方法已迁移至 MissionAICallerService

  // ─── AI Kernel Helpers ───

  /**
   * ★ 记录 Kernel 事件（fire-and-forget）
   */
  private recordKernelEvent(
    missionId: string,
    type: string,
    payload?: Record<string, unknown>,
  ): void {
    const processId = this.kernelProcessIds.get(missionId);
    if (!processId || !this.kernelJournal) return;

    void this.kernelJournal
      .record(processId, type, payload)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to record event ${type}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  /**
   * ★ 标记 Kernel 进程失败（fire-and-forget）
   */
  private failKernelProcess(missionId: string, error: string): void {
    const processId = this.kernelProcessIds.get(missionId);
    if (!processId || !this.missionExecutor) return;

    void this.missionExecutor
      .fail(processId, error)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to mark process as failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    this.kernelProcessIds.delete(missionId);
  }
}
