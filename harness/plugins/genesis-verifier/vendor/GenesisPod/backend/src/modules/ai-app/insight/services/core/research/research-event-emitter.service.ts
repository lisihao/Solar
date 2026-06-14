/**
 * Research Event Emitter Service
 *
 * 参考 AI Writing 的 WritingEventEmitterService 设计
 * 提供研究任务实时事件广播能力
 *
 * ★ 新增：同时持久化关键事件到数据库（团队消息、Agent活动）
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ResearchRealtimeAdapter } from "./research-realtime.adapter";

/**
 * 内部事件常量（用于 NestJS EventEmitter2 解耦循环依赖）
 */
export const RESEARCH_INTERNAL_EVENTS = {
  RESUME_MISSION_EXECUTION: "research.mission.resume-execution",
  RECOVERY_NEEDED: "research.mission.recovery_needed",
  TOPIC_RESEARCH_PROGRESS: "topic-insights.progress",
  MISSION_PROGRESS: "research-mission.progress",
  /** 时延跟踪会话完成事件 */
  LATENCY_SESSION_COMPLETED: "topic-insights.latency.completed",
} as const;

export interface ResumeMissionExecutionPayload {
  missionId: string;
  topicId: string;
}
import { getModelDisplayNameMap } from "../../../utils/model-display-name";

export type ResearchEmitHandler = (
  topicId: string,
  event: string,
  data: unknown,
) => Promise<void>;

/**
 * 研究任务事件类型
 */
export enum ResearchEventType {
  // Mission 状态事件
  MISSION_STARTED = "mission:started",
  MISSION_PROGRESS = "mission:progress",
  MISSION_COMPLETED = "mission:completed",
  MISSION_FAILED = "mission:failed",

  // Leader 事件
  LEADER_THINKING = "leader:thinking",
  LEADER_PLANNING = "leader:planning",
  LEADER_PLAN_READY = "leader:plan_ready",
  LEADER_RESPONSE = "leader:response",

  // Agent 工作事件
  AGENT_WORKING = "agent:working",
  AGENT_COMPLETED = "agent:completed",
  AGENT_FAILED = "agent:failed",

  // 任务事件
  TASK_STARTED = "task:started",
  TASK_PROGRESS = "task:progress",
  TASK_COMPLETED = "task:completed",
  TASK_FAILED = "task:failed",

  // 维度研究事件
  DIMENSION_CREATED = "dimension:created",
  DIMENSION_RESEARCH_STARTED = "dimension:research_started",
  DIMENSION_RESEARCH_PROGRESS = "dimension:research_progress",
  DIMENSION_RESEARCH_COMPLETED = "dimension:research_completed",

  // 报告撰写事件
  REPORT_SYNTHESIS_STARTED = "report:synthesis_started",
  REPORT_SYNTHESIS_PROGRESS = "report:synthesis_progress",
  REPORT_SYNTHESIS_COMPLETED = "report:synthesis_completed",

  // ★ P0: 交互式研究事件
  RESEARCH_PAUSED = "research:paused",
  RESEARCH_RESUMED = "research:resumed",
  RESEARCH_REDIRECTED = "research:redirected",
  RESEARCH_FOLLOW_UP = "research:follow_up",
  RESEARCH_CHECKPOINT = "research:checkpoint",
  DIMENSION_ADDED = "dimension:added",
  DIMENSION_REMOVED = "dimension:removed",
  DEPTH_ADJUSTED = "depth:adjusted",

  // ★ P0: 知识图谱事件
  ENTITY_EXTRACTED = "knowledge:entity_extracted",
  RELATION_DISCOVERED = "knowledge:relation_discovered",
  KNOWLEDGE_REUSED = "knowledge:reused",
}

/**
 * Leader 思考数据
 */
export interface LeaderThinkingData {
  missionId: string;
  phase: "understanding" | "analyzing" | "planning" | "assigning";
  content: string;
  progress?: number;
}

/**
 * Agent 工作状态
 */
export interface AgentWorkingData {
  agentId: string;
  agentName: string;
  agentRole: "leader" | "researcher" | "reviewer" | "synthesizer";
  status: "working" | "completed" | "failed";
  taskDescription?: string;
  dimensionId?: string; // ★ 新增：维度ID，用于精确关联任务活动
  dimensionName?: string;
  progress?: number;
  /** ★ Agent 使用的模型 ID（实现多元化显示） */
  modelId?: string;
  /** ★ 搜索结果元数据（用于工具使用透明度） */
  searchResults?: {
    total: number;
    filtered: number;
    searchTool?: string;
    query?: string;
    searchedAt?: string;
    freshnessInfo?: {
      newestDate?: string;
      oldestDate?: string;
      avgAgeInDays?: number;
    };
    knowledgeBaseInfo?: {
      enabled: boolean;
      knowledgeBaseIds?: string[];
      matchedCount: number;
      avgSimilarity?: number;
    };
    sources?: Array<{
      title: string;
      url: string;
      domain?: string;
      sourceType?: string;
      publishedDate?: string;
      isKnowledgeBase?: boolean;
      similarity?: number;
      documentId?: string;
    }>;
  };
  /** ★ 审核结果数据（用于展示质量审核详情） */
  reviewResult?: {
    type?: string;
    qualityLevel?: string;
    overallScore?: number;
    scores?: Record<string, number>;
    issueCount?: number;
    suggestions?: string[];
    needsReresearch?: boolean;
    dimensionCount?: number;
    recommendations?: string[];
    dimensionsToReresearch?: string[];
  };
}

/**
 * 任务进度数据
 */
export interface TaskProgressData {
  taskId: string;
  taskType: string;
  title: string;
  dimensionName?: string;
  status: string;
  progress: number;
  message?: string;
}

/**
 * Mission 进度数据
 */
export interface MissionProgressData {
  missionId: string;
  progress: number;
  phase: string;
  message: string;
  currentTask?: string;
  completedTasks: number;
  totalTasks: number;
  activeAgents?: string[];
}

@Injectable()
export class ResearchEventEmitterService {
  private readonly logger = new Logger(ResearchEventEmitterService.name);
  private emitHandler?: ResearchEmitHandler;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nestEventEmitter: EventEmitter2,
    @Optional() private readonly realtimeAdapter?: ResearchRealtimeAdapter,
  ) {
    if (this.realtimeAdapter) {
      this.logger.log(
        "ResearchEventEmitterService initialized with RealtimeAdapter integration",
      );
    }
  }

  /**
   * 发射 Mission 恢复执行事件（替代 forwardRef 循环依赖）
   */
  emitResumeMissionExecution(missionId: string, topicId: string): void {
    this.nestEventEmitter.emit(
      RESEARCH_INTERNAL_EVENTS.RESUME_MISSION_EXECUTION,
      { missionId, topicId } as ResumeMissionExecutionPayload,
    );
  }

  /**
   * 注册事件发射处理器（由 Gateway 调用）
   */
  registerEmitHandler(handler: ResearchEmitHandler): void {
    this.emitHandler = handler;
    this.logger.log("Research emit handler registered");
  }

  /**
   * 发射事件到专题
   * ★ 优先使用 RealtimeAdapter（如果可用），同时保持原有 handler 兼容
   */
  async emitToTopic(
    topicId: string,
    event: ResearchEventType | string,
    data: unknown,
  ): Promise<void> {
    const normalizedData = {
      timestamp: new Date().toISOString(),
      ...this.normalizeEventData(data),
    };

    // ★ 使用 RealtimeAdapter 发射事件（如果可用）
    if (this.realtimeAdapter) {
      try {
        this.realtimeAdapter.emitToTopic(topicId, event, normalizedData);
      } catch (error) {
        this.logger.error(
          `[RealtimeAdapter] Failed to emit event ${event}:`,
          error,
        );
      }
    }

    // ★ 保持原有 handler 兼容（Gateway 注册的处理器）
    if (this.emitHandler) {
      try {
        await this.emitHandler(topicId, event, normalizedData);
      } catch (error) {
        this.logger.error(
          `[EmitHandler] Failed to emit event ${event}:`,
          error,
        );
      }
    }

    if (!this.realtimeAdapter && !this.emitHandler) {
      this.logger.debug(`No emit handler registered, skipping event: ${event}`);
    }
  }

  // ==================== Mission 事件 ====================

  /**
   * 发送任务开始事件
   * ★ 同时启动进度追踪（如果 RealtimeAdapter 可用）
   */
  async emitMissionStarted(
    topicId: string,
    missionId: string,
    leaderModel?: string,
    isQuickMode: boolean = false,
  ): Promise<void> {
    // ★ 启动进度追踪
    if (this.realtimeAdapter) {
      this.realtimeAdapter.startMissionTracking(
        topicId,
        missionId,
        isQuickMode,
      );
      this.realtimeAdapter.startPhase(missionId, "planning", "Leader 开始规划");
    }

    await this.emitToTopic(topicId, ResearchEventType.MISSION_STARTED, {
      missionId,
      leaderModel,
      message: "研究任务已启动，Leader 正在分析...",
    });

    // ★ 持久化到数据库
    try {
      const topicExists = await this.prisma.researchTopic.findUnique({
        where: { id: topicId },
        select: { id: true },
      });
      if (!topicExists) return;

      await this.prisma.researchTeamMessage.create({
        data: {
          topicId,
          missionId,
          messageType: "SYSTEM_MESSAGE",
          senderRole: "system",
          senderName: "系统",
          content: "研究任务已启动，Leader 正在分析...",
          metadata: leaderModel ? { leaderModel } : undefined,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to persist mission started: ${error}`);
    }
  }

  /**
   * 发送进度更新事件
   */
  async emitMissionProgress(
    topicId: string,
    data: MissionProgressData,
  ): Promise<void> {
    await this.emitToTopic(topicId, ResearchEventType.MISSION_PROGRESS, data);
  }

  /**
   * 发送任务完成事件
   * ★ 同时完成进度追踪
   */
  async emitMissionCompleted(
    topicId: string,
    missionId: string,
    completedTasks: number,
    totalTasks: number,
  ): Promise<void> {
    // ★ 完成进度追踪
    if (this.realtimeAdapter) {
      this.realtimeAdapter.completeMissionTracking(missionId, "研究完成");
    }

    const completedMessage = `研究完成，共完成 ${completedTasks} 个任务`;
    await this.emitToTopic(topicId, ResearchEventType.MISSION_COMPLETED, {
      missionId,
      completedTasks,
      totalTasks,
      message: completedMessage,
    });

    // ★ 持久化到数据库
    try {
      const topicExists = await this.prisma.researchTopic.findUnique({
        where: { id: topicId },
        select: { id: true },
      });
      if (!topicExists) return;

      await this.prisma.researchTeamMessage.create({
        data: {
          topicId,
          missionId,
          messageType: "SYSTEM_MESSAGE",
          senderRole: "system",
          senderName: "系统",
          content: completedMessage,
          metadata: { completedTasks, totalTasks },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to persist mission completed: ${error}`);
    }
  }

  /**
   * 发送任务失败事件
   * ★ 同时标记进度追踪失败
   */
  async emitMissionFailed(
    topicId: string,
    missionId: string,
    error: string,
  ): Promise<void> {
    // ★ 标记进度追踪失败
    if (this.realtimeAdapter) {
      this.realtimeAdapter.failMissionTracking(missionId, error);
    }

    const failedMessage = `研究失败: ${error}`;
    await this.emitToTopic(topicId, ResearchEventType.MISSION_FAILED, {
      missionId,
      error,
      message: failedMessage,
    });

    // ★ 持久化到数据库
    try {
      const topicExists = await this.prisma.researchTopic.findUnique({
        where: { id: topicId },
        select: { id: true },
      });
      if (!topicExists) return;

      await this.prisma.researchTeamMessage.create({
        data: {
          topicId,
          missionId,
          messageType: "SYSTEM_MESSAGE",
          senderRole: "system",
          senderName: "系统",
          content: failedMessage,
          metadata: { error },
        },
      });
    } catch (dbError) {
      this.logger.error(`Failed to persist mission failed: ${dbError}`);
    }
  }

  // ==================== Leader 事件 ====================

  /**
   * 发送 Leader 思考事件
   * ★ 同时保存到数据库
   */
  async emitLeaderThinking(
    topicId: string,
    data: LeaderThinkingData,
  ): Promise<void> {
    await this.emitToTopic(topicId, ResearchEventType.LEADER_THINKING, data);

    // ★ 保存到数据库
    try {
      // ★ 先验证 topic 是否存在，避免 foreign key 错误
      const topicExists = await this.prisma.researchTopic.findUnique({
        where: { id: topicId },
        select: { id: true },
      });

      if (!topicExists) {
        this.logger.warn(
          `[emitLeaderThinking] Topic ${topicId} not found, skipping activity persistence`,
        );
        return;
      }

      await this.prisma.researchAgentActivity.create({
        data: {
          topicId,
          missionId: data.missionId,
          agentId: "leader",
          agentName: "研究协调员",
          agentRole: "leader",
          activityType: data.phase === "planning" ? "PLANNING" : "THINKING",
          phase: data.phase,
          content: data.content,
          progress: data.progress || 0,
        },
      });
    } catch (error) {
      // ★ 只在非 foreign key 错误时记录，避免日志刷屏
      const errorStr = String(error);
      if (errorStr.includes("Foreign key constraint")) {
        this.logger.debug(
          `[emitLeaderThinking] Skipping persistence - topic may have been deleted`,
        );
      } else {
        this.logger.error(`Failed to persist Leader thinking: ${error}`);
      }
    }
  }

  /**
   * 发送 Leader 规划中事件
   */
  async emitLeaderPlanning(
    topicId: string,
    missionId: string,
    content: string,
  ): Promise<void> {
    await this.emitToTopic(topicId, ResearchEventType.LEADER_PLANNING, {
      missionId,
      content,
      message: content,
    });
  }

  /**
   * 发送 Leader 规划完成事件
   * ★ 同时完成 planning 阶段，开始 researching 阶段
   */
  async emitLeaderPlanReady(
    topicId: string,
    missionId: string,
    dimensionCount: number,
    agentCount: number,
  ): Promise<void> {
    // ★ 阶段转换：planning → researching
    if (this.realtimeAdapter) {
      this.realtimeAdapter.completePhase(missionId, "planning", "规划完成");
      this.realtimeAdapter.startPhase(missionId, "researching", "开始维度研究");
    }

    const planReadyMessage = `规划完成：${dimensionCount} 个研究维度，分配 ${agentCount} 个研究员`;
    await this.emitToTopic(topicId, ResearchEventType.LEADER_PLAN_READY, {
      missionId,
      dimensionCount,
      agentCount,
      message: planReadyMessage,
    });

    // ★ 持久化到数据库
    try {
      const topicExists = await this.prisma.researchTopic.findUnique({
        where: { id: topicId },
        select: { id: true },
      });
      if (!topicExists) return;

      await this.prisma.researchTeamMessage.create({
        data: {
          topicId,
          missionId,
          messageType: "SYSTEM_MESSAGE",
          senderRole: "leader",
          senderName: "Leader",
          content: planReadyMessage,
          metadata: { dimensionCount, agentCount },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to persist leader plan ready: ${error}`);
    }
  }

  /**
   * 发送 Leader 响应事件（多轮对话）
   * ★ 同时保存到数据库
   */
  async emitLeaderResponse(
    topicId: string,
    missionId: string,
    response: string,
  ): Promise<void> {
    // 发送 WebSocket 事件
    await this.emitToTopic(topicId, ResearchEventType.LEADER_RESPONSE, {
      missionId,
      response,
      message: response,
    });

    // ★ 保存到数据库
    try {
      const topicExists = await this.prisma.researchTopic.findUnique({
        where: { id: topicId },
        select: { id: true },
      });
      if (!topicExists) return;

      await this.prisma.researchTeamMessage.create({
        data: {
          topicId,
          missionId,
          messageType: "LEADER_RESPONSE",
          senderRole: "leader",
          senderName: "研究协调员",
          content: response,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to persist Leader response: ${error}`);
    }
  }

  /**
   * 保存用户消息到数据库
   */
  async saveUserMessage(
    topicId: string,
    missionId: string,
    content: string,
    userName?: string,
  ): Promise<void> {
    try {
      await this.prisma.researchTeamMessage.create({
        data: {
          topicId,
          missionId,
          messageType: "USER_MESSAGE",
          senderRole: "user",
          senderName: userName || "用户",
          content,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to persist user message: ${error}`);
    }
  }

  // ==================== Agent 事件 ====================

  /**
   * 发送 Agent 工作状态事件
   * ★ 同时保存到数据库
   */
  async emitAgentWorking(
    topicId: string,
    data: AgentWorkingData,
    missionId?: string,
  ): Promise<void> {
    await this.emitToTopic(topicId, ResearchEventType.AGENT_WORKING, data);

    // ★ 保存到数据库
    if (missionId) {
      try {
        // ★ 先验证 topic 是否存在，避免 foreign key 错误
        const topicExists = await this.prisma.researchTopic.findUnique({
          where: { id: topicId },
          select: { id: true },
        });

        if (!topicExists) {
          this.logger.debug(
            `[emitAgentWorking] Topic ${topicId} not found, skipping activity persistence`,
          );
          return;
        }

        const activityType = this.mapAgentStatusToActivityType(data.status);
        // ★ 在 Agent 名称后显示模型展示名（如 "Doubao (豆包)" 而非 "ep-xxx"）
        let modelLabel = data.modelId;
        if (data.modelId) {
          const nameMap = await getModelDisplayNameMap(this.prisma, [
            data.modelId,
          ]);
          modelLabel = nameMap.get(data.modelId) || data.modelId;
        }
        const agentDisplayName =
          modelLabel && !data.agentName?.includes(`[${modelLabel}]`)
            ? `${data.agentName} [${modelLabel}]`
            : data.agentName;
        await this.prisma.researchAgentActivity.create({
          data: {
            topicId,
            missionId,
            agentId: data.agentId,
            agentName: agentDisplayName,
            agentRole: data.agentRole,
            activityType,
            content: data.taskDescription || `${agentDisplayName} 正在工作`,
            progress: data.progress || 0,
            dimensionId: data.dimensionId, // ★ 新增：保存维度ID以便精确查询
            dimensionName: data.dimensionName,
            // ★ 保存搜索结果（用于工具使用透明度）
            searchResults: data.searchResults
              ? JSON.parse(JSON.stringify(data.searchResults))
              : undefined,
          },
        });

        // ★ 同步更新 ResearchTask.progress 以便 Tasks 面板显示正确进度
        if (data.dimensionName && typeof data.progress === "number") {
          await this.prisma.researchTask
            .updateMany({
              where: {
                missionId,
                dimensionName: data.dimensionName,
                status: "EXECUTING",
              },
              data: { progress: data.progress },
            })
            .catch((err) => {
              this.logger.debug(
                `[emitAgentWorking] Failed to sync task progress: ${err}`,
              );
            });
        }
      } catch (error) {
        const errorStr = String(error);
        if (errorStr.includes("Foreign key constraint")) {
          this.logger.debug(
            `[emitAgentWorking] Skipping persistence - related record may have been deleted`,
          );
        } else {
          this.logger.error(`Failed to persist Agent working: ${error}`);
        }
      }
    }
  }

  /**
   * 发送 Agent 完成事件
   * ★ 同时保存到数据库
   */
  async emitAgentCompleted(
    topicId: string,
    agentId: string,
    agentName: string,
    result?: string,
    missionId?: string,
    options?: {
      dimensionId?: string;
      dimensionName?: string;
      modelId?: string;
    },
  ): Promise<void> {
    // ★ 解析模型展示名，与 emitAgentWorking 保持一致
    let displayAgentName = agentName;
    if (options?.modelId) {
      const nameMap = await getModelDisplayNameMap(this.prisma, [
        options.modelId,
      ]);
      const modelLabel = nameMap.get(options.modelId) || options.modelId;
      if (!agentName.includes(`[${modelLabel}]`)) {
        displayAgentName = `${agentName} [${modelLabel}]`;
      }
    }

    await this.emitToTopic(topicId, ResearchEventType.AGENT_COMPLETED, {
      agentId,
      agentName: displayAgentName,
      result,
      message: `${displayAgentName} 完成工作`,
    });

    // ★ 保存到数据库
    if (missionId) {
      try {
        // ★ 先验证 topic 是否存在，避免 foreign key 错误
        const topicExists = await this.prisma.researchTopic.findUnique({
          where: { id: topicId },
          select: { id: true },
        });

        if (!topicExists) {
          this.logger.debug(
            `[emitAgentCompleted] Topic ${topicId} not found, skipping activity persistence`,
          );
          return;
        }

        await this.prisma.researchAgentActivity.create({
          data: {
            topicId,
            missionId,
            agentId,
            agentName: displayAgentName,
            agentRole: "researcher",
            activityType: "COMPLETED",
            content: result || `${displayAgentName} 完成工作`,
            progress: 100,
            dimensionId: options?.dimensionId,
            dimensionName: options?.dimensionName,
          },
        });
      } catch (error) {
        const errorStr = String(error);
        if (errorStr.includes("Foreign key constraint")) {
          this.logger.debug(
            `[emitAgentCompleted] Skipping persistence - related record may have been deleted`,
          );
        } else {
          this.logger.error(`Failed to persist Agent completed: ${error}`);
        }
      }
    }
  }

  /**
   * 映射 Agent 状态到活动类型
   */
  private mapAgentStatusToActivityType(
    status: "working" | "completed" | "failed",
  ): "THINKING" | "RESEARCHING" | "COMPLETED" | "FAILED" {
    switch (status) {
      case "working":
        return "RESEARCHING";
      case "completed":
        return "COMPLETED";
      case "failed":
        return "FAILED";
      default:
        return "THINKING";
    }
  }

  // ==================== Task 事件 ====================

  /**
   * 发送任务开始事件
   */
  async emitTaskStarted(
    topicId: string,
    data: TaskProgressData,
  ): Promise<void> {
    await this.emitToTopic(topicId, ResearchEventType.TASK_STARTED, {
      ...data,
      message: `开始执行: ${data.title}`,
    });
  }

  /**
   * 发送任务进度事件
   */
  async emitTaskProgress(
    topicId: string,
    data: TaskProgressData,
  ): Promise<void> {
    await this.emitToTopic(topicId, ResearchEventType.TASK_PROGRESS, data);
  }

  /**
   * 发送任务完成事件
   */
  async emitTaskCompleted(
    topicId: string,
    data: TaskProgressData,
  ): Promise<void> {
    await this.emitToTopic(topicId, ResearchEventType.TASK_COMPLETED, {
      ...data,
      message: `完成: ${data.title}`,
    });
  }

  // ==================== 维度研究事件 ====================

  /**
   * 发送维度研究开始事件
   * ★ 同时保存到数据库
   */
  async emitDimensionResearchStarted(
    topicId: string,
    dimensionName: string,
    agentName: string,
    missionId?: string,
  ): Promise<void> {
    const message = `🔍 ${agentName} 开始研究「${dimensionName}」维度`;
    await this.emitToTopic(
      topicId,
      ResearchEventType.DIMENSION_RESEARCH_STARTED,
      {
        dimensionName,
        agentName,
        message,
      },
    );

    // ★ 保存到数据库
    if (missionId) {
      try {
        await this.prisma.researchTeamMessage.create({
          data: {
            topicId,
            missionId,
            messageType: "DIMENSION_STARTED",
            senderRole: "researcher",
            senderName: `${dimensionName}研究员`,
            content: message,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to persist dimension started: ${error}`);
      }
    }
  }

  /**
   * 发送维度研究进度事件
   * ★ 同时保存到数据库
   * @param taskId 可选的任务ID，用于前端匹配进度更新
   */
  async emitDimensionResearchProgress(
    topicId: string,
    dimensionName: string,
    progress: number,
    currentStep: string,
    missionId?: string,
    taskId?: string,
  ): Promise<void> {
    const message = `「${dimensionName}」研究进度 ${progress}%`;

    // ★ 更新 researching 阶段进度（如果 RealtimeAdapter 可用）
    let overallProgress: number | undefined;
    if (this.realtimeAdapter && missionId) {
      overallProgress = this.realtimeAdapter.updatePhaseProgress(
        missionId,
        "researching",
        progress,
        currentStep,
      );
    }

    await this.emitToTopic(
      topicId,
      ResearchEventType.DIMENSION_RESEARCH_PROGRESS,
      {
        dimensionName,
        progress,
        currentStep,
        message,
        taskId, // ★ 添加 taskId 用于前端精确匹配
        overallProgress, // ★ 添加整体进度
      },
    );

    // ★ 同步更新 ResearchTask.progress 以便任务栏显示正确进度
    if (missionId && dimensionName && typeof progress === "number") {
      await this.prisma.researchTask
        .updateMany({
          where: {
            missionId,
            dimensionName,
            status: "EXECUTING",
          },
          data: { progress },
        })
        .catch((err) => {
          this.logger.debug(
            `[emitDimensionResearchProgress] Failed to sync task progress: ${err}`,
          );
        });
    }

    // ★ 保存到数据库（只保存关键进度点：0%, 25%, 50%, 75%, 100%）
    if (
      missionId &&
      (progress === 0 || progress % 25 === 0 || progress === 100)
    ) {
      try {
        await this.prisma.researchTeamMessage.create({
          data: {
            topicId,
            missionId,
            messageType: "DIMENSION_PROGRESS",
            senderRole: "researcher",
            senderName: `${dimensionName}研究员`,
            content: `${message} - ${currentStep}`,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to persist dimension progress: ${error}`);
      }
    }
  }

  /**
   * 发送维度研究完成事件
   * ★ 同时保存到数据库
   */
  async emitDimensionResearchCompleted(
    topicId: string,
    dimensionName: string,
    findingsCount: number,
    wordCount: number,
    missionId?: string,
  ): Promise<void> {
    const message = `✅「${dimensionName}」研究完成，发现 ${findingsCount} 个要点，${wordCount} 字`;
    await this.emitToTopic(
      topicId,
      ResearchEventType.DIMENSION_RESEARCH_COMPLETED,
      {
        dimensionName,
        findingsCount,
        wordCount,
        message,
      },
    );

    // ★ 保存到数据库
    if (missionId) {
      try {
        await this.prisma.researchTeamMessage.create({
          data: {
            topicId,
            missionId,
            messageType: "DIMENSION_COMPLETED",
            senderRole: "researcher",
            senderName: `${dimensionName}研究员`,
            content: message,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to persist dimension completed: ${error}`);
      }
    }
  }

  // ==================== 报告撰写事件 ====================

  /**
   * 发送报告撰写进度事件
   */
  async emitReportSynthesisProgress(
    topicId: string,
    data: {
      progress: number;
      phase: string;
      message: string;
      missionId?: string;
    },
  ): Promise<void> {
    await this.emitToTopic(
      topicId,
      ResearchEventType.REPORT_SYNTHESIS_PROGRESS,
      {
        progress: data.progress,
        phase: data.phase,
        message: data.message,
        missionId: data.missionId,
      },
    );
  }

  /**
   * 发送报告撰写开始事件
   * ★ 同时完成 researching 阶段，开始 synthesizing 阶段
   */
  async emitReportSynthesisStarted(
    topicId: string,
    missionId?: string,
  ): Promise<void> {
    // ★ 阶段转换：researching → synthesizing
    // 注意：标准模式有 reviewing 阶段，但目前业务流程中直接跳到 synthesizing
    if (this.realtimeAdapter && missionId) {
      this.realtimeAdapter.completePhase(
        missionId,
        "researching",
        "维度研究完成",
      );
      this.realtimeAdapter.startPhase(
        missionId,
        "synthesizing",
        "开始报告撰写",
      );
    }

    const synthesisStartedMessage = "开始整合研究结果，撰写洞察报告...";
    await this.emitToTopic(
      topicId,
      ResearchEventType.REPORT_SYNTHESIS_STARTED,
      {
        missionId,
        message: synthesisStartedMessage,
      },
    );

    // ★ 持久化到数据库
    try {
      const topicExists = await this.prisma.researchTopic.findUnique({
        where: { id: topicId },
        select: { id: true },
      });
      if (!topicExists) return;
      if (!missionId) return;

      await this.prisma.researchTeamMessage.create({
        data: {
          topicId,
          missionId,
          messageType: "SYSTEM_MESSAGE",
          senderRole: "system",
          senderName: "撰写员",
          content: synthesisStartedMessage,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to persist report synthesis started: ${error}`);
    }
  }

  /**
   * 发送报告撰写完成事件
   * ★ 同时完成 synthesizing 阶段
   */
  async emitReportSynthesisCompleted(
    topicId: string,
    chapterCount: number,
    totalWordCount: number,
    missionId?: string,
  ): Promise<void> {
    // ★ 完成 synthesizing 阶段（如果 RealtimeAdapter 可用）
    if (this.realtimeAdapter && missionId) {
      this.realtimeAdapter.completePhase(
        missionId,
        "synthesizing",
        "报告撰写完成",
      );
    }

    const synthesisCompletedMessage = `报告撰写完成，共 ${chapterCount} 个章节，${totalWordCount} 字`;
    await this.emitToTopic(
      topicId,
      ResearchEventType.REPORT_SYNTHESIS_COMPLETED,
      {
        missionId,
        chapterCount,
        totalWordCount,
        message: synthesisCompletedMessage,
      },
    );

    // ★ 持久化到数据库
    try {
      const topicExists = await this.prisma.researchTopic.findUnique({
        where: { id: topicId },
        select: { id: true },
      });
      if (!topicExists) return;
      if (!missionId) return;

      await this.prisma.researchTeamMessage.create({
        data: {
          topicId,
          missionId,
          messageType: "SYSTEM_MESSAGE",
          senderRole: "synthesizer",
          senderName: "撰写员",
          content: synthesisCompletedMessage,
          metadata: { chapterCount, totalWordCount },
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to persist report synthesis completed: ${error}`,
      );
    }
  }

  // ==================== 数据查询方法 ====================

  /**
   * 获取专题的团队互动消息
   */
  async getTeamMessages(
    topicId: string,
    options?: { limit?: number; missionId?: string },
  ) {
    // ★ 先按 desc 获取最新的消息，然后反转顺序使其按时间正序排列
    const messages = await this.prisma.researchTeamMessage.findMany({
      where: {
        topicId,
        ...(options?.missionId ? { missionId: options.missionId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: options?.limit || 100,
    });
    // 反转为时间正序，便于前端显示
    return messages.reverse();
  }

  /**
   * 获取专题的 Agent 活动记录
   */
  async getAgentActivities(
    topicId: string,
    options?: { limit?: number; missionId?: string; agentRole?: string },
  ) {
    // ★ 先按 desc 获取最新的活动，然后反转顺序使其按时间正序排列
    const activities = await this.prisma.researchAgentActivity.findMany({
      where: {
        topicId,
        ...(options?.missionId ? { missionId: options.missionId } : {}),
        ...(options?.agentRole ? { agentRole: options.agentRole } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: options?.limit || 200,
    });
    // 反转为时间正序，便于前端显示
    return activities.reverse();
  }

  /**
   * 获取 Leader 对话历史（格式化为 AI 消息格式）
   *
   * 返回最近的对话历史，用于 Leader 多轮上下文
   *
   * @param topicId 专题 ID
   * @param missionId 任务 ID（可选）
   * @param maxTurns 最大对话轮数（默认 10 轮，每轮包含用户+助手消息）
   * @returns 格式化的消息数组，用于 AI chat
   */
  async getLeaderConversationHistory(
    topicId: string,
    missionId?: string,
    maxTurns: number = 10,
  ): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    // 获取最近的对话消息（用户消息 + Leader 响应）
    const messages = await this.prisma.researchTeamMessage.findMany({
      where: {
        topicId,
        ...(missionId ? { missionId } : {}),
        messageType: { in: ["USER_MESSAGE", "LEADER_RESPONSE"] },
      },
      orderBy: { createdAt: "desc" },
      take: maxTurns * 2, // 每轮对话包含用户+助手消息
    });

    // 反转为时间正序
    const sortedMessages = messages.reverse();

    // 转换为 AI 消息格式
    return sortedMessages.map((msg) => ({
      role: msg.messageType === "USER_MESSAGE" ? "user" : "assistant",
      content: msg.content,
    })) as Array<{ role: "user" | "assistant"; content: string }>;
  }

  /**
   * 标准化事件数据
   */
  private normalizeEventData(data: unknown): Record<string, unknown> {
    if (data === null || data === undefined) {
      return {};
    }
    if (typeof data === "object") {
      return data as Record<string, unknown>;
    }
    return { value: data };
  }
}
