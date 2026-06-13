/**
 * Mission Execution Service
 *
 * 负责任务执行相关的核心逻辑，从 TeamMissionService 中提取
 * - executeNextTasks: 协调执行下一批任务
 * - executeTask: 执行单个任务
 * - findAlternativeAgent: 查找替代 Agent
 * - handleTaskExecutionFailure: 处理任务执行失败
 * - autoRetryBlockedTasks / forceCompleteStuckTasks: 任务恢复
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import {
  AgentTaskStatus,
  TaskPriority,
  TaskType,
  MissionStatus,
  MissionLogType,
  MessageContentType,
} from "@prisma/client";
import {
  ChatFacade,
  AgentFacade,
  ToolFacade,
} from "@/modules/ai-harness/facade";
import type { ChatMessage } from "@/modules/ai-harness/facade";
import type { TaskProfile } from "@/modules/ai-harness/facade";
// ★ 架构重构：通过 ToolRegistry 调用工具
import { ToolRegistry } from "@/modules/ai-harness/facade";
import type { ToolContext } from "@/modules/ai-harness/facade";
// ★ IPC: Agent 间消息总线（Kernel L3）
import { MessageBusService } from "@/modules/ai-harness/facade";
import { TopicEventEmitterService } from "../../events";
import {
  mapWithConcurrency,
  ConcurrencyLimits,
} from "../../../../../../common/utils/concurrency.utils";
import { TeamsLongContentService } from "../../ai/teams-long-content.service";
import { LeaderModelService } from "../../ai/leader-model.service";
import { MissionStateManager } from "@/modules/ai-harness/facade";
import { RETRY_CONFIG, AGENT_SWITCH_CONFIG } from "../config";
import {
  isRetryableError,
  isRateLimitError,
  isPermanentError,
  isApiErrorContent,
  sleep,
  needsWebSearch,
  buildSearchQuery,
} from "../utils";
import {
  MissionWithRelations,
  TeamMemberBase,
  AgentTaskWithAssignee,
  TaskAssignee,
} from "../interfaces";
import { MissionContextPackage } from "@/modules/ai-harness/facade";
import type { AICapabilityContext } from "@/modules/ai-harness/facade";

/**
 * 执行服务回调接口
 * 用于解耦执行服务与主服务之间的循环依赖
 */
export interface ExecutionCallbacks {
  /** 完成 Mission */
  completeMission(missionId: string): Promise<void>;
  /** Leader 审核任务 */
  leaderReviewTask(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    taskResult: string,
  ): Promise<void>;
  /** 获取团队成员 */
  getTeamMembers(topicId: string): Promise<{
    leader: TeamMemberBase | null;
    members: TeamMemberBase[];
    all: TeamMemberBase[];
  }>;
  /** 创建日志 */
  createLog(
    missionId: string,
    data: {
      type: MissionLogType;
      agentId?: string | null;
      agentName?: string | null;
      taskId?: string | null;
      taskTitle?: string | null;
      content?: string;
      messageId?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void>;
  /** 发送消息到 Topic */
  sendMessageToTopic(
    topicId: string,
    senderId: string | null,
    content: string,
    contentType: MessageContentType,
  ): Promise<{ id: string } | null>;
  /** 更新 Mission 进度 */
  updateMissionProgress(missionId: string): Promise<void>;
  /** 构建任务执行提示词 */
  buildTaskExecutionPrompt(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    searchContext: string,
  ): string;
  /** 获取 Agent 系统提示词 */
  getAgentSystemPrompt(
    agent: TaskAssignee | TeamMemberBase,
    task: AgentTaskWithAssignee,
    contextPackage: MissionContextPackage | null,
    missionDescription?: string,
    mustConstraints?: unknown[],
  ): string;
  /** 获取 Leader 系统提示词 */
  getLeaderSystemPrompt(leader: TeamMemberBase): string;
}

@Injectable()
export class MissionExecutionService {
  private readonly logger = new Logger(MissionExecutionService.name);
  private callbacks: ExecutionCallbacks | null = null;

  /**
   * ★ 待执行标记：当嵌套的 executeNextTasks 调用被跳过时，记录下来
   * 在锁释放后自动重新执行，避免任务卡住
   */
  private pendingExecutions = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private chatFacade: ChatFacade,
    private agentFacade: AgentFacade,
    private toolFacade: ToolFacade,
    // ★ 架构重构：通过 ToolRegistry 调用工具
    private toolRegistry: ToolRegistry,
    private topicEventEmitter: TopicEventEmitterService,
    private longContentService: TeamsLongContentService,
    private stateManager: MissionStateManager,
    // ★ Leader 模型容错服务：支持重试和模型切换
    private leaderModelService: LeaderModelService,
    // ★ IPC: Agent 间消息总线（L2 Kernel）
    @Optional() private readonly messageBus?: MessageBusService,
  ) {
    this.logger.debug(
      `[MissionExecutionService] Services injected: LeaderModel=${!!this.leaderModelService}, MessageBus=${!!this.messageBus}`,
    );
  }

  /**
   * 设置回调接口（由 TeamMissionService 调用）
   */
  setCallbacks(callbacks: ExecutionCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * 确保回调已设置
   */
  private ensureCallbacks(): ExecutionCallbacks {
    if (!this.callbacks) {
      throw new Error("ExecutionCallbacks not set. Call setCallbacks() first.");
    }
    return this.callbacks;
  }

  // ==================== AI 调用方法 ====================

  /**
   * 创建工具执行上下文
   */
  private createToolContext(toolId: string): ToolContext {
    return {
      executionId: `${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolId,
      createdAt: new Date(),
      callerType: "orchestrator",
    };
  }

  /**
   * 获取模型配置
   * ★ 架构重构：使用 AIFacade 获取模型配置
   */
  private async getModelConfig(aiModel: string) {
    try {
      const modelConfig = await this.chatFacade.getModelById(aiModel);
      return modelConfig;
    } catch (error) {
      this.logger.warn(
        `Model config not found for: ${aiModel}, error: ${error}`,
      );
      return null;
    }
  }

  /**
   * 调用 AI（带数据库 API Key）
   *
   * 推荐使用 taskProfile 直接配置：
   * - taskProfile: { creativity: "medium", outputLength: "long" } ✅ 推荐
   * - maxTokens/temperature: 仍支持但会被自动映射 ⚠️ 兼容
   */
  async callAIWithConfig(
    aiModel: string,
    messages: { role: string; content: string }[],
    systemPrompt: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
      taskProfile?: TaskProfile;
      missionId?: string;
      enableSearch?: boolean;
    },
  ) {
    const modelConfig = await this.getModelConfig(aiModel);

    // ★ 内部调用默认关闭网页搜索，避免任务修订等场景误触发搜索
    // searchOptions 暂不支持，后续可扩展 Facade

    // 构建消息列表，包含系统提示
    const facadeMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...(messages as { role: "user" | "assistant"; content: string }[]).map(
        (m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }),
      ),
    ];

    // ★ 优先使用直接传入的 taskProfile，否则从 legacy 参数映射
    const taskProfile: TaskProfile = options?.taskProfile
      ? options.taskProfile
      : {
          creativity: this.mapTemperatureToCreativity(options?.temperature),
          outputLength: this.mapMaxTokensToOutputLength(options?.maxTokens),
        };

    const result = await this.chatFacade.chat({
      messages: facadeMessages,
      model: modelConfig?.modelId ?? aiModel,
      taskProfile,
    });

    // 追踪 Token 消耗
    if (options?.missionId && result.tokensUsed > 0) {
      this.trackMissionTokens(options.missionId, result.tokensUsed).catch(
        (err) => {
          this.logger.warn(
            `[callAIWithConfig] Failed to track tokens for mission ${options.missionId}: ${err}`,
          );
        },
      );
    }

    return result;
  }

  /**
   * 追踪 Mission Token 消耗
   */
  private async trackMissionTokens(
    missionId: string,
    tokensUsed: number,
  ): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE team_missions
        SET total_tokens_used = COALESCE(total_tokens_used, 0) + ${tokensUsed}
        WHERE id = ${missionId}
      `;
      this.logger.debug(
        `[trackMissionTokens] Added ${tokensUsed} tokens to mission ${missionId}`,
      );
    } catch (error) {
      this.logger.warn(
        `[trackMissionTokens] Failed to update tokens for mission ${missionId}: ${error}`,
      );
    }
  }

  /**
   * 从任务类型推断领域
   * ★ AI Tools & Skills Integration: 用于确定任务执行时的能力上下文
   */
  private inferDomainFromTask(task: AgentTaskWithAssignee): string {
    // 根据任务类型映射到领域
    const taskType = task.taskType;

    if (taskType === TaskType.RESEARCH) {
      return "research";
    }

    if (taskType === TaskType.DOCUMENTATION || taskType === TaskType.CREATIVE) {
      return "writing";
    }

    if (taskType === TaskType.DESIGN) {
      return "design";
    }

    if (taskType === TaskType.REVIEW || taskType === TaskType.SYNTHESIS) {
      return "analysis";
    }

    // 检查任务描述中的关键词
    const description = (task.description || "").toLowerCase();
    const title = (task.title || "").toLowerCase();
    const combined = `${title} ${description}`;

    if (
      combined.includes("研究") ||
      combined.includes("调研") ||
      combined.includes("分析")
    ) {
      return "research";
    }

    if (
      combined.includes("写作") ||
      combined.includes("撰写") ||
      combined.includes("编写")
    ) {
      return "writing";
    }

    if (
      combined.includes("设计") ||
      combined.includes("图片") ||
      combined.includes("PPT")
    ) {
      return "design";
    }

    // 默认领域
    return "general";
  }

  /**
   * 带重试的 AI 调用（支持心跳机制）
   */
  async callAIWithRetry(
    aiModel: string,
    messages: { role: string; content: string }[],
    systemPrompt: string,
    options: {
      maxTokens?: number;
      temperature?: number;
      taskProfile?: TaskProfile;
    },
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
          `[callAIWithRetry] Attempt ${attempt}/${maxRetries} for task "${taskContext.taskTitle}" with model ${aiModel}`,
        );

        startHeartbeat();

        const response = await this.callAIWithConfig(
          aiModel,
          messages,
          systemPrompt,
          {
            ...options,
            missionId: taskContext.missionId,
          },
        );

        stopHeartbeat();

        if (response && response.content) {
          return {
            success: true,
            content: response.content,
            attempts: attempt,
            finalModel: aiModel,
          };
        }

        lastError = "Empty response from AI";
      } catch (error) {
        stopHeartbeat();
        lastError = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[callAIWithRetry] Attempt ${attempt}/${maxRetries} failed: ${lastError}`,
        );

        if (attempt < maxRetries && isRetryableError(lastError)) {
          const delay = Math.min(
            initialDelayMs * Math.pow(backoffMultiplier, attempt - 1),
            maxDelayMs,
          );
          this.logger.log(
            `[callAIWithRetry] Waiting ${delay}ms before retry...`,
          );
          await sleep(delay);
        }
      }
    }

    return {
      success: false,
      error: lastError,
      attempts: maxRetries,
      finalModel: aiModel,
    };
  }

  // ==================== Agent 选择方法 ====================

  /**
   * 查找替代 Agent
   */
  async findAlternativeAgent(
    mission: MissionWithRelations,
    failedAgentIds: string[],
    _task: AgentTaskWithAssignee,
  ): Promise<TeamMemberBase | null> {
    const callbacks = this.ensureCallbacks();
    try {
      const teamMemberResult = await callbacks.getTeamMembers(mission.topicId);
      const allMembers = teamMemberResult.all || [];

      if (allMembers.length <= 1) {
        this.logger.warn(
          `[findAlternativeAgent] No alternative agents available (only ${allMembers.length} member)`,
        );
        return null;
      }

      const candidates = allMembers.filter(
        (m: TeamMemberBase) => !failedAgentIds.includes(m.id) && !m.isLeader,
      );

      this.logger.log(
        `[findAlternativeAgent] Found ${candidates.length} non-leader candidates`,
      );

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
   * 查找替代 Agent（结合 Circuit Breaker）
   */
  async findAlternativeAgentWithCircuitBreaker(
    mission: MissionWithRelations,
    failedAgentIds: string[],
    _task: AgentTaskWithAssignee,
  ): Promise<TeamMemberBase | null> {
    const callbacks = this.ensureCallbacks();
    try {
      const teamMemberResult = await callbacks.getTeamMembers(mission.topicId);
      const allMembers = teamMemberResult.all || [];

      if (allMembers.length <= 1) {
        this.logger.warn(
          `[findAlternativeAgentWithCircuitBreaker] No alternative agents available`,
        );
        return null;
      }

      const candidates = allMembers.filter((m: TeamMemberBase) => {
        if (failedAgentIds.includes(m.id)) return false;
        if (m.isLeader) return false;
        if (!this.agentFacade.circuitBreaker?.canExecute(m.id)) {
          this.logger.debug(
            `[findAlternativeAgentWithCircuitBreaker] Agent ${m.displayName} excluded (circuit breaker open)`,
          );
          return false;
        }
        return true;
      });

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
          `[findAlternativeAgentWithCircuitBreaker] No available agents after circuit breaker check`,
        );
        return null;
      }

      // 使用 Circuit Breaker 的健康评分选择最佳 Agent
      const bestAgentId = this.agentFacade.circuitBreaker?.selectBest(
        candidates.map((c: TeamMemberBase) => c.id),
      );

      if (bestAgentId) {
        const selected = candidates.find(
          (c: TeamMemberBase) => c.id === bestAgentId,
        );
        if (selected) {
          this.logger.log(
            `[findAlternativeAgentWithCircuitBreaker] Selected best agent: ${selected.displayName}`,
          );
          return selected;
        }
      }

      const selected = candidates[0];
      this.logger.log(
        `[findAlternativeAgentWithCircuitBreaker] Selected first available: ${selected.displayName}`,
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

  // ==================== 任务执行核心方法 ====================

  /**
   * 执行下一批任务
   */
  async executeNextTasks(missionId: string): Promise<void> {
    const callbacks = this.ensureCallbacks();

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

      // 找出所有可以开始的任务
      const pendingTasks = mission.tasks
        .filter(
          (t) =>
            t.status === AgentTaskStatus.PENDING &&
            !this.stateManager.isTaskExecuting(t.id),
        )
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );

      const tasksToStart: typeof pendingTasks = [];

      for (const task of pendingTasks) {
        const dependsOnIds = task.dependsOnIds || [];
        const allDependenciesCompleted = dependsOnIds.every((depId) => {
          const depTask = mission.tasks.find((t) => t.id === depId);
          return depTask?.status === AgentTaskStatus.COMPLETED;
        });

        if (allDependenciesCompleted) {
          tasksToStart.push(task);
        }
      }

      const finalTasksToStart = tasksToStart;

      if (finalTasksToStart.length === 0) {
        const completedTasks = mission.tasks.filter(
          (t) => t.status === AgentTaskStatus.COMPLETED,
        );
        const allCompleted = completedTasks.length === mission.tasks.length;

        if (allCompleted) {
          // ★ IPC: Mission 完成，清理消息总线会话
          this.messageBus?.clearSession(missionId);
          await callbacks.completeMission(missionId);
          return;
        }

        // 处理卡住情况
        await this.handleStuckMission(
          mission as MissionWithRelations,
          completedTasks,
          callbacks,
        );
        return;
      }

      // 标记所有任务为"执行中"
      for (const task of finalTasksToStart) {
        this.stateManager.startTask(task.id, task.title);
        this.logger.debug(
          `[executeNextTasks] Marked task ${task.id} (${task.title}) as executing`,
        );
      }

      // 批量发送任务分配消息
      const messagePromises = finalTasksToStart.map((task) =>
        callbacks
          .sendMessageToTopic(
            mission.topicId,
            null,
            `📋 [任务分配] 任务「${task.title}」已分配给 @${task.assignedTo.agentName || task.assignedTo.displayName}`,
            MessageContentType.SYSTEM,
          )
          .catch((e) =>
            this.logger.warn(
              `[executeNextTasks] Failed to send assignment message: ${e}`,
            ),
          ),
      );

      // 并行执行任务
      await Promise.all([
        Promise.all(messagePromises),
        mapWithConcurrency(
          finalTasksToStart,
          (task) => this.executeTask(mission as MissionWithRelations, task),
          ConcurrencyLimits.AI,
        ),
      ]);
    } finally {
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

  /**
   * 处理卡住的 Mission
   */
  private async handleStuckMission(
    mission: MissionWithRelations,
    completedTasks: { id: string; status: AgentTaskStatus }[],
    callbacks: ExecutionCallbacks,
  ): Promise<void> {
    const completionRate = completedTasks.length / mission.tasks!.length;
    const FORCE_COMPLETE_THRESHOLD = 0.95;
    const STUCK_TIMEOUT_MS = 15 * 60 * 1000;
    const now = Date.now();

    const blockedTasks = mission.tasks!.filter(
      (t) => t.status === AgentTaskStatus.BLOCKED,
    );
    const stuckTasks = mission.tasks!.filter(
      (t) =>
        t.status === AgentTaskStatus.REVISION_NEEDED ||
        t.status === AgentTaskStatus.AWAITING_REVIEW,
    );
    const inProgressTasks = mission.tasks!.filter(
      (t) => t.status === AgentTaskStatus.IN_PROGRESS,
    );

    this.logger.debug(
      `[Mission ${mission.id}] Task status: ${completedTasks.length} completed, ${blockedTasks.length} blocked, ${stuckTasks.length} stuck, ${inProgressTasks.length} in progress`,
    );

    // 优先级 1: 如果完成率 >= 95%，强制完成
    if (completionRate >= FORCE_COMPLETE_THRESHOLD) {
      const remainingTasks = mission.tasks!.filter(
        (t) => t.status !== AgentTaskStatus.COMPLETED,
      );
      this.logger.warn(
        `[Mission ${mission.id}] Completion rate ${(completionRate * 100).toFixed(1)}% >= 95%, force completing ${remainingTasks.length} remaining tasks`,
      );

      for (const task of remainingTasks) {
        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: {
            status: AgentTaskStatus.COMPLETED,
            completedAt: new Date(),
            result:
              task.result || `[自动完成] 任务在高完成率下被系统自动标记为完成`,
          },
        });
      }

      await callbacks.completeMission(mission.id);
      return;
    }

    // 优先级 2: 处理 BLOCKED 任务
    if (blockedTasks.length > 0) {
      const retriedCount = await this.autoRetryBlockedTasks(
        mission,
        blockedTasks,
        now,
        STUCK_TIMEOUT_MS,
      );

      if (retriedCount > 0) {
        this.logger.log(
          `[Mission ${mission.id}] Auto-retried ${retriedCount} blocked tasks`,
        );
        await this.executeNextTasks(mission.id);
        return;
      }
    }

    // 优先级 3: 处理卡住的任务
    if (stuckTasks.length > 0) {
      const forceCompletedCount = await this.forceCompleteStuckTasks(
        mission,
        stuckTasks,
        now,
        STUCK_TIMEOUT_MS,
      );

      if (forceCompletedCount > 0) {
        this.logger.log(
          `[Mission ${mission.id}] Force completed ${forceCompletedCount} stuck tasks`,
        );
        await this.executeNextTasks(mission.id);
        return;
      }

      this.logger.warn(
        `[Mission ${mission.id}] Found ${stuckTasks.length} stuck tasks`,
      );
    }

    // 处理长时间卡住的 IN_PROGRESS 任务
    if (inProgressTasks.length > 0) {
      const stuckInProgress = inProgressTasks.filter((t) => {
        if (!t.startedAt) return false;
        return now - new Date(t.startedAt).getTime() > STUCK_TIMEOUT_MS;
      });

      if (stuckInProgress.length > 0) {
        this.logger.warn(
          `[Mission ${mission.id}] Found ${stuckInProgress.length} tasks stuck in IN_PROGRESS for > 15 min`,
        );
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
        await this.executeNextTasks(mission.id);
        return;
      }
    }

    // 处理依赖阻塞
    await this.handleDependencyBlocking(mission, inProgressTasks, now);
  }

  /**
   * 处理依赖阻塞情况
   */
  private async handleDependencyBlocking(
    mission: MissionWithRelations,
    inProgressTasks: { id: string; status: AgentTaskStatus }[],
    now: number,
  ): Promise<void> {
    const pendingWithDeps = mission.tasks!.filter(
      (t) =>
        t.status === AgentTaskStatus.PENDING &&
        (t.dependsOnIds || []).length > 0,
    );

    if (pendingWithDeps.length === 0) return;

    const blockedByUnfinished: Array<{
      task: (typeof pendingWithDeps)[0];
      blockingTasks: Array<{
        id: string;
        title: string;
        status: AgentTaskStatus;
      }>;
    }> = [];

    for (const task of pendingWithDeps) {
      const dependsOnIds = task.dependsOnIds || [];
      const blockingTasks = dependsOnIds
        .map((depId) => mission.tasks!.find((t) => t.id === depId))
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
      this.logger.warn(
        `[Mission ${mission.id}] 🔗 Dependency Analysis: ${blockedByUnfinished.length} PENDING tasks blocked by unfinished dependencies`,
      );

      const DEPENDENCY_RELAX_TIMEOUT_MS = 30 * 60 * 1000;
      const missionAge = now - new Date(mission.createdAt).getTime();

      if (
        missionAge > DEPENDENCY_RELAX_TIMEOUT_MS &&
        inProgressTasks.length === 0
      ) {
        this.logger.warn(
          `[Mission ${mission.id}] ⚠️ Mission stuck for ${Math.round(missionAge / 60000)}min with no active tasks. Attempting dependency relaxation...`,
        );

        let relaxedCount = 0;
        for (const { task, blockingTasks } of blockedByUnfinished) {
          // ★ 修复：CANCELLED 状态的依赖也应该触发松弛
          const allBlockersStuck = blockingTasks.every(
            (b) =>
              b.status === AgentTaskStatus.BLOCKED ||
              b.status === AgentTaskStatus.REVISION_NEEDED ||
              b.status === AgentTaskStatus.CANCELLED,
          );

          // 调试日志：显示阻塞任务状态和判断结果
          this.logger.debug(
            `[Mission ${mission.id}] Dependency check for "${task.title}": ` +
              `blockers=[${blockingTasks.map((b) => `${b.title}(${b.status})`).join(", ")}], ` +
              `allBlockersStuck=${allBlockersStuck}`,
          );

          if (allBlockersStuck && relaxedCount < 3) {
            await this.prisma.agentTask.update({
              where: { id: task.id },
              data: { dependsOnIds: [] },
            });
            relaxedCount++;
            this.logger.log(
              `[Mission ${mission.id}] ✅ Relaxed dependencies for task "${task.title}"`,
            );
          }
        }

        if (relaxedCount > 0) {
          await this.executeNextTasks(mission.id);
        }
      }
    }
  }

  /**
   * 执行单个任务
   */
  async executeTask(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
  ): Promise<void> {
    const callbacks = this.ensureCallbacks();
    const { assignedTo } = task;

    try {
      // 原子状态更新
      const updateResult = await this.prisma.agentTask.updateMany({
        where: {
          id: task.id,
          status: AgentTaskStatus.PENDING,
        },
        data: {
          status: AgentTaskStatus.IN_PROGRESS,
          startedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        this.logger.warn(
          `[executeTask] Task "${task.title}" (${task.id}) is no longer PENDING, skipping execution`,
        );
        return;
      }

      this.logger.debug(
        `[executeTask] Successfully acquired task "${task.title}" (${task.id}) for execution`,
      );

      // ★ AI Tools & Skills Integration: 解析成员可用的工具和技能
      const capabilityContext: AICapabilityContext = {
        // teamId 从 Topic 获取（通过 topicId）
        memberId: assignedTo.id,
        agentId: assignedTo.id,
        userId: mission.createdBy?.id,
        domain: this.inferDomainFromTask(task),
      };

      const capabilities =
        await this.toolFacade.getAvailableCapabilities(capabilityContext);

      this.logger.log(
        `[executeTask] Agent ${assignedTo.displayName} capabilities: ` +
          `tools=[${capabilities.tools.join(", ")}], ` +
          `skills=[${capabilities.skills.join(", ")}], ` +
          `mcpTools=[${capabilities.mcpTools.map((t) => `${t.serverId}:${t.toolName}`).join(", ")}]`,
      );

      // 日志和消息发送（fire-and-forget）
      Promise.all([
        callbacks.createLog(mission.id, {
          type: MissionLogType.TASK_STARTED,
          agentId: assignedTo.id,
          agentName: assignedTo.agentName || assignedTo.displayName,
          taskId: task.id,
          taskTitle: task.title,
          content: `开始执行任务「${task.title}」`,
        }),
        callbacks.sendMessageToTopic(
          mission.topicId,
          assignedTo.id,
          `[开始工作]\n\n收到任务「${task.title}」，开始执行...`,
          MessageContentType.TEXT,
        ),
      ]).catch((e) =>
        this.logger.warn(`[executeTask] Log/message error: ${e}`),
      );

      // 广播 Agent 工作状态
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

      // ★ IPC: 广播任务开始状态到消息总线
      if (this.messageBus) {
        void this.messageBus
          .publish({
            sessionId: mission.id,
            fromAgentId: assignedTo.id,
            type: "status_update",
            payload: {
              taskId: task.id,
              taskTitle: task.title,
              status: "started",
            },
          })
          .catch((e) =>
            this.logger.warn(`[MessageBus] status_update publish failed: ${e}`),
          );
      }

      // 检查是否需要联网搜索
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
                `[executeTask] Found ${searchData.results.length} search results`,
              );
            }
          }
        }
      }

      // ★ IPC: 从消息总线获取同伴 Agent 的已完成任务结果作为上下文
      let peerContext = "";
      if (this.messageBus) {
        const history = this.messageBus.getHistory(mission.id);
        const peerResults = history.filter(
          (m) => m.type === "task_result" && m.fromAgentId !== assignedTo.id,
        );
        if (peerResults.length > 0) {
          const summaries = peerResults.slice(-5).map((m) => {
            const p = m.payload as {
              taskTitle?: string;
              result?: string;
            };
            return `- [${m.fromAgentId}] ${p.taskTitle ?? "Task"}: ${(p.result ?? "").substring(0, 500)}`;
          });
          peerContext =
            "\n\n[其他成员已完成的任务结果（仅供参考）]\n" +
            summaries.join("\n");
        }
      }

      // 构建任务执行提示词
      const taskPrompt = callbacks.buildTaskExecutionPrompt(
        mission,
        task,
        searchContext + peerContext,
      );

      // AI 调用（带重试和 Agent 切换）
      const aiResponse = await this.executeTaskWithAgentSwitching(
        mission,
        task,
        taskPrompt,
        assignedTo,
        callbacks,
      );

      if (!aiResponse) {
        return;
      }

      // 处理结果
      await this.processTaskResult(mission, task, aiResponse, callbacks);
    } catch (error) {
      this.logger.error(`Task execution failed: ${error}`);

      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: { status: AgentTaskStatus.BLOCKED },
      });

      // ★ 修复：任务失败时发送状态更新事件
      void this.topicEventEmitter.emitToTopic(mission.topicId, "task:status", {
        missionId: mission.id,
        taskId: task.id,
        status: AgentTaskStatus.BLOCKED,
      });

      // ★ 修复：任务失败时清除 Agent 工作状态
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:agent_done",
        {
          missionId: mission.id,
          taskId: task.id,
          agentId: assignedTo.id,
        },
      );

      await callbacks.sendMessageToTopic(
        mission.topicId,
        assignedTo.id,
        `❌ 任务执行出错：${error instanceof Error ? error.message : "未知错误"}`,
        MessageContentType.TEXT,
      );

      // ★ IPC: 广播任务失败到消息总线
      if (this.messageBus) {
        void this.messageBus
          .publish({
            sessionId: mission.id,
            fromAgentId: assignedTo.id,
            type: "task_result",
            payload: {
              taskId: task.id,
              taskTitle: task.title,
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
            },
          })
          .catch((e) =>
            this.logger.warn(
              `[MessageBus] task_result (failure) publish failed: ${e}`,
            ),
          );
      }
    } finally {
      this.stateManager.finishTask(task.id);
      this.agentFacade.circuitBreaker?.decrementLoad(assignedTo.id);
      this.logger.debug(
        `[executeTask] Released lock for task "${task.title}" (${task.id})`,
      );
    }
  }

  /**
   * 带 Agent 切换的任务执行
   */
  private async executeTaskWithAgentSwitching(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    taskPrompt: string,
    initialAgent: TaskAssignee,
    callbacks: ExecutionCallbacks,
  ): Promise<{ content: string; agent: TaskAssignee } | null> {
    let currentAgent: TaskAssignee | TeamMemberBase = initialAgent;
    const failedAgentIds: string[] = [];
    let aiResponse: { content: string } | null = null;
    let switchCount = 0;

    // 检查初始 Agent 是否可用
    if (!this.agentFacade.circuitBreaker?.canExecute(currentAgent.id)) {
      const cooldownRemaining =
        this.agentFacade.circuitBreaker?.getCooldownRemaining(
          currentAgent.id,
        ) ?? 0;
      const cooldownSeconds = Math.ceil(cooldownRemaining / 1000);
      this.logger.warn(
        `[executeTask] Agent ${currentAgent.displayName} is in cooldown for ${cooldownSeconds}s, finding alternative`,
      );

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
        await callbacks.sendMessageToTopic(
          mission.topicId,
          currentAgent.id,
          `[任务延迟]\n\n任务「${task.title}」的负责人 ${currentAgent.displayName} 当前不可用（正在冷却中，剩余 ${cooldownSeconds} 秒），且无其他可用成员。任务将被暂时阻塞。`,
          MessageContentType.TEXT,
        );

        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: { status: AgentTaskStatus.BLOCKED },
        });

        // ★ 修复：任务被阻塞时发送状态更新事件
        void this.topicEventEmitter.emitToTopic(
          mission.topicId,
          "task:status",
          {
            missionId: mission.id,
            taskId: task.id,
            status: AgentTaskStatus.BLOCKED,
          },
        );

        return null;
      }
    }

    this.agentFacade.circuitBreaker?.incrementLoad(currentAgent.id);
    const taskStartTime = Date.now();

    // Agent 切换循环
    while (switchCount <= AGENT_SWITCH_CONFIG.maxSwitches) {
      this.logger.log(
        `[executeTask] Attempting task "${task.title}" with agent ${currentAgent.displayName} (${currentAgent.aiModel})`,
      );

      if (switchCount > 0) {
        await callbacks.sendMessageToTopic(
          mission.topicId,
          currentAgent.id,
          `[任务接手]\n\n由于原负责人遇到技术问题，我将接手任务「${task.title}」的执行。`,
          MessageContentType.TEXT,
        );

        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: { assignedToId: currentAgent.id },
        });

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

      const result = await this.callAIWithRetry(
        currentAgent.aiModel,
        [{ role: "user", content: taskPrompt }],
        callbacks.getAgentSystemPrompt(
          currentAgent,
          task,
          mission.contextPackage as MissionContextPackage | null,
          mission.description || undefined,
          (mission.mustConstraints as unknown[]) || undefined,
        ),
        { taskProfile: { creativity: "medium", outputLength: "long" } },
        {
          taskId: task.id,
          taskTitle: task.title,
          missionId: mission.id,
        },
        {
          topicId: mission.topicId,
          agentId: currentAgent.id,
          agentName:
            ("agentName" in currentAgent ? currentAgent.agentName : null) ||
            currentAgent.displayName,
        },
      );

      if (result.success && result.content) {
        aiResponse = { content: result.content };

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

      // 记录失败
      failedAgentIds.push(currentAgent.id);
      const errorMsg = result.error || "Unknown error";

      const errorType =
        this.agentFacade.circuitBreaker?.parseErrorType(errorMsg);
      if (errorType !== undefined) {
        this.agentFacade.circuitBreaker?.recordFailure(
          currentAgent.id,
          errorType,
          errorMsg,
        );
      }

      this.logger.warn(
        `[executeTask] Agent ${currentAgent.displayName} failed after ${result.attempts} retries: ${errorMsg}`,
      );

      await callbacks.sendMessageToTopic(
        mission.topicId,
        currentAgent.id,
        `⚠️ **执行受阻**\n\n任务「${task.title}」执行过程中遇到问题（已重试 ${result.attempts} 次）：\n\n> ${errorMsg}\n\n正在尝试切换到其他团队成员...`,
        MessageContentType.TEXT,
      );

      if (isPermanentError(errorMsg)) {
        this.logger.log(
          `[executeTask] Permanent error detected, skipping agent switch and going to Leader replan`,
        );
        await this.handleTaskExecutionFailure(
          mission,
          task,
          currentAgent as TaskAssignee,
          errorMsg,
          callbacks,
        );
        return null;
      }

      if (isRateLimitError(errorMsg)) {
        this.logger.warn(
          `[executeTask] Rate limit detected for ${currentAgent.displayName}, switching to alternative agent immediately`,
        );
      }

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
          currentAgent as TaskAssignee,
          `${errorMsg} (已尝试 ${failedAgentIds.length} 个 Agent，均无法完成)`,
          callbacks,
        );
        return null;
      }

      this.agentFacade.circuitBreaker?.decrementLoad(currentAgent.id);
      this.agentFacade.circuitBreaker?.incrementLoad(alternativeAgent.id);

      this.logger.log(
        `[executeTask] Switching from ${currentAgent.displayName} to ${alternativeAgent.displayName}`,
      );
      currentAgent = alternativeAgent;
      switchCount++;
    }

    if (!aiResponse) {
      this.logger.error(
        `[executeTask] All agents failed for task "${task.title}"`,
      );
      await this.handleTaskExecutionFailure(
        mission,
        task,
        currentAgent as TaskAssignee,
        `所有可用 Agent 均无法完成此任务（已尝试 ${failedAgentIds.length + 1} 个 Agent）`,
        callbacks,
      );
      return null;
    }

    return { content: aiResponse.content, agent: currentAgent as TaskAssignee };
  }

  /**
   * 处理任务结果
   */
  private async processTaskResult(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    aiResult: { content: string; agent: TaskAssignee },
    callbacks: ExecutionCallbacks,
  ): Promise<void> {
    let finalContent = aiResult.content;
    const currentAgent = aiResult.agent;

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
          aiResult.content,
        );

      if (completionResult.needsContinuation) {
        finalContent = await this.handleContentContinuation(
          mission,
          task,
          currentAgent,
          completionResult,
          callbacks,
        );
      } else if (completionResult.finalContent) {
        finalContent = completionResult.finalContent;
      }

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
    }

    // 检查是否包含 API 错误
    const isApiError = isApiErrorContent(finalContent);
    if (isApiError) {
      this.logger.warn(
        `[executeTask] Task "${task.title}" result contains API error, treating as failure`,
      );
      await callbacks.sendMessageToTopic(
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
        callbacks,
      );
      return;
    }

    // 发送工作汇报
    const leaderName = mission.leader.agentName || mission.leader.displayName;
    const resultMessage = await callbacks.sendMessageToTopic(
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

    await callbacks.createLog(mission.id, {
      type: MissionLogType.TASK_COMPLETED,
      agentId: currentAgent.id,
      agentName: currentAgent.agentName || currentAgent.displayName,
      taskId: task.id,
      taskTitle: task.title,
      content: `任务「${task.title}」执行完成，等待 Leader 审核`,
      messageId: resultMessage?.id,
    });

    // 广播任务完成
    void this.topicEventEmitter.emitToTopic(mission.topicId, "task:completed", {
      missionId: mission.id,
      taskId: task.id,
      agentId: currentAgent.id,
    });

    void this.topicEventEmitter.emitToTopic(
      mission.topicId,
      "mission:agent_done",
      {
        missionId: mission.id,
        taskId: task.id,
        agentId: currentAgent.id,
      },
    );

    // ★ IPC: 广播任务结果到消息总线（供后续 Agent 作为上下文参考）
    if (this.messageBus) {
      void this.messageBus
        .publish({
          sessionId: mission.id,
          fromAgentId: currentAgent.id,
          type: "task_result",
          priority: "high",
          payload: {
            taskId: task.id,
            taskTitle: task.title,
            success: true,
            result: finalContent.substring(0, 2000),
          },
        })
        .catch((e) =>
          this.logger.warn(`[MessageBus] task_result publish failed: ${e}`),
        );
    }

    // Leader 审核
    await callbacks.leaderReviewTask(mission, task, finalContent);
  }

  /**
   * 处理内容续写
   */
  private async handleContentContinuation(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    currentAgent: TaskAssignee,
    completionResult: {
      needsContinuation: boolean;
      continuationState?: {
        continuationCount: number;
        maxContinuations: number;
      };
    },
    callbacks: ExecutionCallbacks,
  ): Promise<string> {
    this.logger.log(
      `[executeTask] Task "${task.title}" needs continuation, current: ${completionResult.continuationState?.continuationCount || 0}/${completionResult.continuationState?.maxContinuations || 3}`,
    );

    await callbacks.sendMessageToTopic(
      mission.topicId,
      currentAgent.id,
      `[续写中...]\n\n任务内容较长，正在继续生成...`,
      MessageContentType.TEXT,
    );

    let continuationState = completionResult.continuationState;
    while (
      continuationState &&
      continuationState.continuationCount < continuationState.maxContinuations
    ) {
      const continuationPrompt =
        this.longContentService.buildContinuationPrompt(
          task.id,
          task.title,
          task.description || task.title,
        );

      const continuationResult = await this.callAIWithRetry(
        currentAgent.aiModel,
        [{ role: "user", content: continuationPrompt }],
        callbacks.getAgentSystemPrompt(
          currentAgent,
          task,
          mission.contextPackage as MissionContextPackage | null,
          mission.description || undefined,
          (mission.mustConstraints as unknown[]) || undefined,
        ),
        { taskProfile: { creativity: "medium", outputLength: "long" } },
        {
          taskId: task.id,
          taskTitle: task.title,
          missionId: mission.id,
        },
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

      const nextResult = await this.longContentService.processTaskCompletion(
        mission.id,
        task.id,
        task.title,
        continuationResult.content,
      );

      if (!nextResult.needsContinuation) {
        return nextResult.finalContent || continuationResult.content;
      }

      continuationState = nextResult.continuationState;
    }

    const mergedContent = this.longContentService.getFinalResult(task.id);
    return mergedContent || "";
  }

  // ==================== 任务失败处理 ====================

  /**
   * 处理任务执行失败
   */
  async handleTaskExecutionFailure(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    assignedTo: TaskAssignee,
    errorMsg: string,
    callbacks: ExecutionCallbacks,
  ): Promise<void> {
    const { leader } = mission;

    // 标记任务为失败
    await this.prisma.agentTask.update({
      where: { id: task.id },
      data: { status: AgentTaskStatus.CANCELLED },
    });

    // 发送失败通知
    await callbacks.sendMessageToTopic(
      mission.topicId,
      assignedTo.id,
      `❌ **任务执行失败**\n\n任务「${task.title}」执行过程中出现错误：\n\n> ${errorMsg}\n\n正在请求 Leader @${leader.agentName || leader.displayName} 重新规划...`,
      MessageContentType.TEXT,
    );

    // Leader 重新规划（带模型容错）
    const replanPrompt = this.buildReplanPrompt(task, assignedTo, errorMsg);
    const systemPrompt = callbacks.getLeaderSystemPrompt(leader);

    try {
      // ★ 使用 LeaderModelService 执行，支持重试和模型切换
      const result = await this.leaderModelService.executeWithFallback(
        leader.aiModel,
        async (modelConfig) => {
          return this.callAIWithConfig(
            modelConfig.modelId,
            [{ role: "user", content: replanPrompt }],
            systemPrompt,
            {
              taskProfile: { creativity: "medium", outputLength: "medium" },
              missionId: mission.id,
            },
          );
        },
        {
          operation: "leader_replan",
          context: { missionId: mission.id, taskId: task.id },
        },
      );

      if (result.success && result.data) {
        if (result.fallbackUsed) {
          this.logger.log(
            `[handleTaskExecutionFailure] Used fallback model ${result.modelUsed} for replan (original: ${leader.aiModel})`,
          );
        }

        await callbacks.sendMessageToTopic(
          mission.topicId,
          leader.id,
          `[任务重新规划]\n\n${result.data.content}`,
          MessageContentType.TEXT,
        );

        // 解析并创建新任务
        await this.parseAndCreateReplanTasks(
          mission,
          result.data.content,
          callbacks,
        );
      } else {
        const errorDetail = result.error?.getUserMessage() || "未知错误";
        this.logger.error(
          `[handleTaskExecutionFailure] All replan model attempts failed: ${errorDetail}`,
        );
        await callbacks.sendMessageToTopic(
          mission.topicId,
          null,
          `⚠️ **需要人工干预**\n\n任务「${task.title}」执行失败，且自动重新规划也失败了（${errorDetail}）。\n\n请手动取消当前任务或创建新的任务。`,
          MessageContentType.SYSTEM,
        );
      }
    } catch (replanError) {
      this.logger.error(`Replan AI call failed unexpectedly: ${replanError}`);
      await callbacks.sendMessageToTopic(
        mission.topicId,
        null,
        `⚠️ **需要人工干预**\n\n任务「${task.title}」执行失败，且自动重新规划也失败了。\n\n请手动取消当前任务或创建新的任务。`,
        MessageContentType.SYSTEM,
      );
    }

    await callbacks.createLog(mission.id, {
      type: MissionLogType.TASK_FAILED,
      agentId: assignedTo.id,
      agentName: assignedTo.agentName || assignedTo.displayName,
      taskId: task.id,
      taskTitle: task.title,
      content: `任务执行失败: ${errorMsg}`,
    });
  }

  /**
   * 构建重新规划提示词
   */
  private buildReplanPrompt(
    task: AgentTaskWithAssignee,
    assignedTo: TaskAssignee,
    errorMsg: string,
  ): string {
    return `## 任务执行失败通知

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
  }

  /**
   * 解析并创建重新规划的任务
   */
  private async parseAndCreateReplanTasks(
    mission: MissionWithRelations,
    responseContent: string,
    callbacks: ExecutionCallbacks,
  ): Promise<void> {
    const jsonMatch = responseContent.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) return;

    try {
      const replanData = JSON.parse(jsonMatch[1]);
      if (!replanData.newTasks || !Array.isArray(replanData.newTasks)) return;

      const teamMemberResult = await callbacks.getTeamMembers(mission.topicId);
      const teamMembers = teamMemberResult.all || [];

      for (const newTask of replanData.newTasks) {
        const assignee = teamMembers.find(
          (m: TeamMemberBase) =>
            m.agentName === newTask.assignee ||
            m.displayName === newTask.assignee,
        );

        if (assignee) {
          await this.prisma.agentTask.create({
            data: {
              missionId: mission.id,
              title: newTask.title,
              description: newTask.description || newTask.title,
              assignedToId: assignee.id,
              status: AgentTaskStatus.PENDING,
              priority: TaskPriority.HIGH,
              taskType: TaskType.IMPLEMENTATION,
              revisionCount: 0,
              maxRevisions: 3,
            },
          });

          this.logger.log(
            `Created new task "${newTask.title}" assigned to ${assignee.displayName}`,
          );
        }
      }

      await this.executeNextTasks(mission.id);
    } catch (parseError) {
      this.logger.warn(
        `Failed to parse replan JSON: ${parseError}. Manual intervention may be needed.`,
      );
    }
  }

  // ==================== 任务恢复方法 ====================

  /**
   * 自动重试 BLOCKED 任务
   */
  async autoRetryBlockedTasks(
    mission: MissionWithRelations,
    blockedTasks: AgentTaskWithAssignee[],
    now: number,
    stuckTimeoutMs: number,
  ): Promise<number> {
    let retriedCount = 0;

    for (const task of blockedTasks) {
      const taskAge = task.updatedAt
        ? now - new Date(task.updatedAt).getTime()
        : stuckTimeoutMs + 1;

      const canRetry = this.agentFacade.circuitBreaker?.canExecute(
        task.assignedTo.id,
      );

      if (canRetry && taskAge < stuckTimeoutMs) {
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
        const cooldown =
          this.agentFacade.circuitBreaker?.getCooldownRemaining(
            task.assignedTo.id,
          ) ?? 0;
        this.logger.debug(
          `[Mission ${mission.id}] Cannot retry ${task.title}, agent in cooldown (${Math.round(cooldown / 1000)}s remaining)`,
        );
      }
    }

    return retriedCount;
  }

  /**
   * 强制完成卡住的任务
   */
  async forceCompleteStuckTasks(
    mission: MissionWithRelations,
    stuckTasks: {
      id: string;
      title: string;
      status: AgentTaskStatus;
      result: string | null;
      updatedAt: Date | null;
    }[],
    now: number,
    stuckTimeoutMs: number,
  ): Promise<number> {
    let forceCompletedCount = 0;

    for (const task of stuckTasks) {
      const taskAge = task.updatedAt
        ? now - new Date(task.updatedAt).getTime()
        : 0;

      if (taskAge >= stuckTimeoutMs) {
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

  // ==================== Helper Methods ====================

  /**
   * Map legacy temperature values to creativity levels
   */
  private mapTemperatureToCreativity(
    temperature?: number,
  ): "deterministic" | "low" | "medium" | "high" {
    if (temperature === undefined) return "medium";
    if (temperature <= 0.2) return "deterministic";
    if (temperature <= 0.3) return "low";
    if (temperature <= 0.7) return "medium";
    return "high";
  }

  /**
   * Map legacy maxTokens values to outputLength levels
   */
  private mapMaxTokensToOutputLength(
    maxTokens?: number,
  ): "minimal" | "short" | "medium" | "standard" | "long" | "extended" {
    if (maxTokens === undefined) return "standard";
    if (maxTokens <= 1000) return "minimal";
    if (maxTokens <= 2000) return "short";
    if (maxTokens <= 4000) return "medium";
    if (maxTokens <= 6000) return "standard";
    if (maxTokens <= 8000) return "long";
    return "extended";
  }
}
