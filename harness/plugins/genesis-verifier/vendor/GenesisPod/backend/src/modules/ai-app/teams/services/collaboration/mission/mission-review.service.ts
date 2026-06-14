/**
 * Mission Review Service
 *
 * 负责任务审核和修订相关的核心逻辑，从 TeamMissionService 中提取
 * - leaderReviewTask: Leader 审核任务
 * - executeTaskRevision: 执行任务修订
 * - summarizeForLeaderReview: 为长内容生成摘要
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import {
  AgentTaskStatus,
  MissionLogType,
  MessageContentType,
} from "@prisma/client";
import { TopicEventEmitterService } from "../../events";
import { TeamsLongContentService } from "../../ai/teams-long-content.service";
import { LeaderModelService } from "../../ai/leader-model.service";
// ★ AI Engine 能力下沉：使用 AIFacade 访问熔断器服务
import { AgentFacade } from "@/modules/ai-harness/facade";
import { TaskCompletionType } from "@/modules/ai-harness/facade";
import { MissionStateManager } from "@/modules/ai-harness/facade";
import { parseReviewResult } from "../utils";
import {
  MissionWithRelations,
  TeamMemberBase,
  AgentTaskWithAssignee,
  TaskAssignee,
} from "../interfaces";
import {
  MissionContextPackage,
  HardConstraint,
} from "@/modules/ai-harness/facade";
// AiCallerFn 是 L2.5 ai-harness/runner 类型（2026-05-01 PR-X-L 从 engine 下移）
import type { AiCallerFn } from "@/modules/ai-harness/facade";

/**
 * 审核服务回调接口
 */
export interface ReviewCallbacks {
  /** 发送消息到 Topic */
  sendMessageToTopic(
    topicId: string,
    senderId: string | null,
    content: string,
    contentType: MessageContentType,
  ): Promise<{ id: string } | null>;
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
  /** 更新 Mission 进度 */
  updateMissionProgress(missionId: string): Promise<void>;
  /** 执行下一批任务 */
  executeNextTasks(missionId: string): Promise<void>;
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
  /** 调用 AI */
  callAIWithConfig(
    aiModel: string,
    messages: { role: string; content: string }[],
    systemPrompt: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
      missionId?: string;
    },
  ): Promise<{ content: string; tokensUsed: number }>;
}

@Injectable()
export class MissionReviewService {
  private readonly logger = new Logger(MissionReviewService.name);
  private callbacks: ReviewCallbacks | null = null;

  constructor(
    private prisma: PrismaService,
    private topicEventEmitter: TopicEventEmitterService,
    private longContentService: TeamsLongContentService,
    private agentFacade: AgentFacade,
    private stateManager: MissionStateManager,
    // ★ Leader 模型容错服务：支持重试和模型切换
    private leaderModelService: LeaderModelService,
  ) {
    // 验证 AI Engine 服务可用
    this.logger.debug(
      `[MissionReviewService] AI Engine services injected: OutputReviewer=${!!this.agentFacade.outputReviewer}, ContextEvolution=${!!this.agentFacade.contextEvolution}, LeaderModel=${!!this.leaderModelService}`,
    );
  }

  // ==================== 参数映射说明 ====================
  // 本服务的 AI 调用通过 callbacks.callAIWithConfig 进行
  // 参数映射（maxTokens/temperature → taskProfile）在 TeamMissionService 中处理
  // 详见: team-mission.service.ts 的 mapTemperatureToCreativity / mapMaxTokensToOutputLength

  /**
   * 设置回调接口
   */
  setCallbacks(callbacks: ReviewCallbacks): void {
    this.callbacks = callbacks;
  }

  private ensureCallbacks(): ReviewCallbacks {
    if (!this.callbacks) {
      throw new Error("ReviewCallbacks not set. Call setCallbacks() first.");
    }
    return this.callbacks;
  }

  /**
   * 创建 AI 调用函数包装器
   * 将 callbacks.callAIWithConfig 适配为 AiCallerFn 接口
   * 保留执行上下文（心跳、token 追踪、missionId 关联等）
   */
  private createAiCaller(
    callbacks: ReviewCallbacks,
    missionId: string,
  ): AiCallerFn {
    return async (model, messages, options) => {
      // 从 messages 中提取 system prompt
      const systemMsg = messages.find((m) => m.role === "system");
      const otherMsgs = messages.filter((m) => m.role !== "system");

      return callbacks.callAIWithConfig(
        model,
        otherMsgs as { role: string; content: string }[],
        systemMsg?.content || "",
        {
          maxTokens: options?.maxTokens,
          temperature: options?.temperature,
          missionId,
        },
      );
    };
  }

  // ==================== Leader 审核任务 ====================

  /**
   * Leader 审核任务
   */
  async leaderReviewTask(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    taskResult: string,
  ): Promise<void> {
    const callbacks = this.ensureCallbacks();
    const { leader } = mission;

    try {
      // 广播 Leader 开始审核
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

      // 对长内容先生成摘要
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
          callbacks,
        );
        reviewContent = keyExcerpts
          ? `【AI 生成的内容摘要】\n${summary}\n\n【原文关键片段】\n${keyExcerpts}`
          : summary;
        this.logger.log(
          `[leaderReviewTask] 摘要生成完成，审核内容长度: ${reviewContent.length}字符`,
        );
      }

      // 获取质量上下文
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

      if (qualityContext) {
        reviewPrompt += qualityContext;
      }

      // 调用 AI 审核（带心跳 + 模型容错）
      // ★ Leader 模型容错：支持重试和自动切换到其他推理模型
      let aiResponse: { content: string; tokensUsed: number };
      let reviewHeartbeatTimer: NodeJS.Timeout | null = null;
      let reviewHeartbeatCount = 0;

      try {
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

        // 创建 aiCaller 包装器，保留执行上下文
        const aiCaller = this.createAiCaller(callbacks, mission.id);
        const systemPrompt = callbacks.getLeaderSystemPrompt(leader);

        // ★ 使用 LeaderModelService 执行，支持重试和模型切换
        const result = await this.leaderModelService.executeWithFallback(
          leader.aiModel,
          async (modelConfig) => {
            return this.agentFacade.outputReviewer!.executeAICall(
              modelConfig.modelId,
              [
                { role: "system", content: systemPrompt },
                { role: "user", content: reviewPrompt },
              ],
              {
                taskProfile: { creativity: "low", outputLength: "medium" },
              },
              aiCaller,
            );
          },
          {
            operation: "leader_review",
            context: { missionId: mission.id, taskId: task.id },
          },
        );

        if (result.success && result.data) {
          aiResponse = result.data;
          if (result.fallbackUsed) {
            this.logger.log(
              `[leaderReviewTask] Used fallback model ${result.modelUsed} (original: ${leader.aiModel})`,
            );
          }
        } else {
          const errorMsg = result.error?.getUserMessage() || "未知错误";
          this.logger.error(
            `[leaderReviewTask] All model attempts failed: ${errorMsg}`,
          );
          aiResponse = {
            content: `审核失败: ${errorMsg}\n\n不通过。请重新执行任务。`,
            tokensUsed: 0,
          };
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[leaderReviewTask] Review AI call failed unexpectedly: ${errorMsg}`,
        );
        aiResponse = {
          content: `审核失败: ${errorMsg}\n\n不通过。请重新执行任务。`,
          tokensUsed: 0,
        };
      } finally {
        if (reviewHeartbeatTimer) {
          clearInterval(reviewHeartbeatTimer);
          reviewHeartbeatTimer = null;
        }
      }

      // 解析审核结果
      const reviewResult = parseReviewResult(aiResponse.content);
      const isApproved = reviewResult.isApproved;

      this.logger.log(
        `[leaderReviewTask] Review result: ${isApproved ? "APPROVED" : "REJECTED"} ` +
          `(confidence: ${reviewResult.confidence.toFixed(2)}, reason: ${reviewResult.reason})`,
      );

      // 发送 Leader 反馈消息
      const agentName =
        task.assignedTo.agentName || task.assignedTo.displayName;
      const feedbackMessage = await callbacks.sendMessageToTopic(
        mission.topicId,
        leader.id,
        `[Leader反馈]\n\n@${agentName} ${aiResponse.content}`,
        MessageContentType.TEXT,
      );

      await callbacks.createLog(mission.id, {
        type: MissionLogType.LEADER_FEEDBACK,
        agentId: leader.id,
        agentName: leader.agentName || leader.displayName,
        taskId: task.id,
        taskTitle: task.title,
        content: isApproved ? "任务审核通过" : "任务需要修改",
        messageId: feedbackMessage?.id,
      });

      // 清除 Leader 审核状态
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
        await this.handleApproval(
          mission,
          task,
          aiResponse.content,
          feedbackMessage?.id,
          callbacks,
        );
      } else {
        await this.handleRejection(
          mission,
          task,
          aiResponse.content,
          feedbackMessage?.id,
          callbacks,
        );
      }
    } catch (error) {
      this.logger.error(`Leader review failed: ${error}`);

      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: AgentTaskStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      await callbacks.updateMissionProgress(mission.id);
      await callbacks.executeNextTasks(mission.id);
    }
  }

  /**
   * 处理审核通过
   *
   * ★ 增强：任务通过后提取已确立事实，更新上下文
   */
  private async handleApproval(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    feedback: string,
    feedbackMessageId: string | undefined,
    callbacks: ReviewCallbacks,
  ): Promise<void> {
    await this.prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status: AgentTaskStatus.COMPLETED,
        completedAt: new Date(),
        leaderFeedback: feedback,
        feedbackMessageId: feedbackMessageId,
      },
    });

    // ★ 上下文演进：从完成的任务中提取已确立事实
    await this.evolveContextAfterTaskCompletion(mission, task, callbacks);

    await callbacks.updateMissionProgress(mission.id);
    await callbacks.executeNextTasks(mission.id);
  }

  /**
   * 任务完成后演进上下文
   *
   * 从完成的任务输出中提取关键事实，更新 mission 的 contextPackage
   *
   * ★ AI Engine 能力下沉：使用 ContextEvolutionService
   * ★ 修复数据竞争：使用事务确保原子性更新
   * ★ 修复事务超时：AI 调用移到事务外，避免长时间持有锁
   */
  private async evolveContextAfterTaskCompletion(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    callbacks: ReviewCallbacks,
  ): Promise<void> {
    const taskOutput = task.result;
    // 使用配置常量
    const MIN_OUTPUT_LENGTH = 200;
    if (!taskOutput || taskOutput.length < MIN_OUTPUT_LENGTH) {
      this.logger.debug(
        `[evolveContext] Task "${task.title}" output too short (${taskOutput?.length || 0} < ${MIN_OUTPUT_LENGTH}), skipping`,
      );
      return;
    }

    try {
      // 创建符合 AiCallerFn 接口的 AI 调用函数
      const aiCaller: AiCallerFn = async (model, messages, options) => {
        const systemMsg = messages.find((m) => m.role === "system");
        const otherMsgs = messages.filter((m) => m.role !== "system");
        return callbacks.callAIWithConfig(
          model,
          otherMsgs as { role: string; content: string }[],
          systemMsg?.content || "",
          {
            maxTokens: options?.maxTokens,
            temperature: options?.temperature,
            missionId: mission.id,
          },
        );
      };

      // ==================== 阶段1：读取当前上下文（事务外） ====================
      const currentMission = await this.prisma.teamMission.findUnique({
        where: { id: mission.id },
        select: { contextPackage: true },
      });

      if (!currentMission) {
        this.logger.warn(`[evolveContext] Mission ${mission.id} not found`);
        return;
      }

      const currentContext =
        currentMission.contextPackage as MissionContextPackage | null;
      const currentFacts = currentContext?.establishedFacts || [];
      const currentEntities =
        currentContext?.entities?.map((e) => e.name) || [];

      // ==================== 阶段2：AI 提取新事实（事务外，避免长时间持锁） ====================
      const extractionResult =
        await this.agentFacade.contextEvolution!.extractFacts(
          {
            taskId: task.id,
            taskTitle: task.title,
            taskOutput,
            existingFacts: currentFacts,
            existingEntities: currentEntities,
          },
          aiCaller,
        );

      if (extractionResult.facts.length === 0) {
        this.logger.debug(
          `[evolveContext] No new facts extracted from task "${task.title}"`,
        );
        return;
      }

      // ==================== 阶段3：事务内合并并写入（短事务） ====================
      const result = await this.prisma.$transaction(async (tx) => {
        // 重新读取最新上下文（避免并发覆盖）
        const latestMission = await tx.teamMission.findUnique({
          where: { id: mission.id },
          select: { contextPackage: true },
        });

        if (!latestMission) {
          throw new Error(`Mission ${mission.id} not found in transaction`);
        }

        const latestContext =
          latestMission.contextPackage as MissionContextPackage | null;
        const latestFacts = latestContext?.establishedFacts || [];

        // 合并事实（带数量限制）
        const mergedFacts = this.agentFacade.contextEvolution!.mergeFacts(
          latestFacts,
          extractionResult.facts,
        );

        // 构建更新后的上下文
        const updatedContext: MissionContextPackage = {
          ...(latestContext || {
            version: "1.0",
            understanding: { summary: "", scope: "", expectedOutput: "" },
            hardConstraints: [],
            entities: [],
            prohibitions: [],
            qualityStandards: [],
            generatedBy: "system",
            generatedAt: new Date().toISOString(),
          }),
          establishedFacts: mergedFacts,
        };

        // 写入数据库
        await tx.teamMission.update({
          where: { id: mission.id },
          data: { contextPackage: updatedContext as object },
        });

        return {
          newFactsCount: extractionResult.facts.length,
          totalFactsCount: mergedFacts.length,
        };
      });

      this.logger.log(
        `[evolveContext] Updated context with ${result.newFactsCount} new facts from task "${task.title}" (total: ${result.totalFactsCount})`,
      );

      // 通知前端上下文已更新
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:context_updated",
        {
          missionId: mission.id,
          newFactsCount: result.newFactsCount,
          totalFactsCount: result.totalFactsCount,
        },
      );
    } catch (error) {
      // 上下文演进失败不阻塞任务流程
      this.logger.warn(
        `[evolveContext] Failed to evolve context: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * 处理审核不通过
   */
  private async handleRejection(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    feedback: string,
    feedbackMessageId: string | undefined,
    callbacks: ReviewCallbacks,
  ): Promise<void> {
    const currentRevisions = task.revisionCount || 0;

    if (currentRevisions >= task.maxRevisions) {
      // 超过最大修改次数
      const hasValidContent =
        task.result &&
        task.result.trim().length > 100 &&
        !task.result.includes("[自动完成]") &&
        !task.result.includes("[错误]");

      if (hasValidContent) {
        this.logger.warn(
          `[Leader Review] Task "${task.title}" force passed after ${currentRevisions} revisions`,
        );

        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: {
            status: AgentTaskStatus.COMPLETED,
            completedAt: new Date(),
            leaderFeedback:
              feedback +
              `\n\n⚠️ 【系统提示】已达最大修改次数(${currentRevisions}/${task.maxRevisions})，内容已保留。建议后续人工审核。`,
          },
        });

        await callbacks.sendMessageToTopic(
          mission.topicId,
          null,
          `⚠️ 任务「${task.title}」已达最大修改次数，已保留当前内容。建议后续人工审核质量。`,
          MessageContentType.SYSTEM,
        );
      } else {
        this.logger.warn(
          `[Leader Review] Task "${task.title}" blocked after ${currentRevisions} revisions (no valid content)`,
        );

        await this.prisma.agentTask.update({
          where: { id: task.id },
          data: {
            status: AgentTaskStatus.BLOCKED,
            leaderFeedback:
              feedback +
              `\n\n❌ 【系统提示】已达最大修改次数(${currentRevisions}/${task.maxRevisions})，但内容质量不足，任务已阻塞。`,
          },
        });

        this.agentFacade.circuitBreaker?.recordFailure(
          task.assignedTo.id,
          TaskCompletionType.CONTENT_ERROR,
          `Task "${task.title}" blocked after max revisions`,
        );

        await callbacks.sendMessageToTopic(
          mission.topicId,
          null,
          `❌ 任务「${task.title}」已达最大修改次数但内容质量不足，已标记为阻塞。请考虑重新分配或调整任务。`,
          MessageContentType.SYSTEM,
        );
      }

      await callbacks.updateMissionProgress(mission.id);
      await callbacks.executeNextTasks(mission.id);
    } else {
      // 要求修改
      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: AgentTaskStatus.REVISION_NEEDED,
          needsRevision: true,
          revisionCount: currentRevisions + 1,
          leaderFeedback: feedback,
          feedbackMessageId: feedbackMessageId,
        },
      });

      // 触发修改
      await this.executeTaskRevision(mission, task, feedback);
    }
  }

  // ==================== 任务修订 ====================

  /**
   * 执行任务修订
   */
  async executeTaskRevision(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    feedback: string,
  ): Promise<void> {
    const callbacks = this.ensureCallbacks();
    const { assignedTo } = task;

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

      // 原子状态更新
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

      // ★ 修复：发送任务状态更新事件
      void this.topicEventEmitter.emitToTopic(mission.topicId, "task:status", {
        missionId: mission.id,
        taskId: task.id,
        status: AgentTaskStatus.IN_PROGRESS,
      });

      // ★ 修复：广播 Agent 开始修订工作
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:agent_working",
        {
          missionId: mission.id,
          taskId: task.id,
          agentId: assignedTo.id,
          agentName: assignedTo.agentName || assignedTo.displayName,
          status: "revising",
        },
      );

      await callbacks.sendMessageToTopic(
        mission.topicId,
        assignedTo.id,
        `[任务修改]\n\n收到 Leader 的反馈，正在修改...`,
        MessageContentType.TEXT,
      );

      // 构建修订提示词
      const revisionPrompt = this.buildTaskRevisionPrompt(
        mission,
        latestTask,
        feedback,
      );

      // 获取 Agent 系统提示词
      const systemPrompt = callbacks.getAgentSystemPrompt(
        assignedTo,
        latestTask,
        mission.contextPackage as MissionContextPackage | null,
        mission.description || undefined,
        (mission.mustConstraints as unknown[]) || undefined,
      );

      // 调用 AI 执行修订
      // ★ AI Engine 能力下沉：通过 aiCaller 注入执行上下文
      let aiResponse: { content: string; tokensUsed: number };
      try {
        // 创建 aiCaller 包装器，保留执行上下文
        const aiCaller = this.createAiCaller(callbacks, mission.id);

        // 委托给 AI Engine 执行
        aiResponse = await this.agentFacade.outputReviewer!.executeAICall(
          assignedTo.aiModel,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: revisionPrompt },
          ],
          {
            taskProfile: { creativity: "medium", outputLength: "long" },
          },
          aiCaller,
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[handleTaskRevision] Revision AI call failed: ${errorMsg}`,
        );

        const leaderName =
          mission.leader.agentName || mission.leader.displayName;
        await callbacks.sendMessageToTopic(
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

        // ★ 修复：发送任务状态更新事件
        void this.topicEventEmitter.emitToTopic(
          mission.topicId,
          "task:status",
          {
            missionId: mission.id,
            taskId: task.id,
            status: AgentTaskStatus.REVISION_NEEDED,
          },
        );

        // ★ 修复：清除 Agent 工作状态
        void this.topicEventEmitter.emitToTopic(
          mission.topicId,
          "mission:agent_done",
          {
            missionId: mission.id,
            taskId: task.id,
            agentId: assignedTo.id,
          },
        );

        await callbacks.createLog(mission.id, {
          type: MissionLogType.TASK_FAILED,
          agentId: assignedTo.id,
          agentName: assignedTo.agentName || assignedTo.displayName,
          taskId: task.id,
          taskTitle: task.title,
          content: `任务「${task.title}」修改失败: ${errorMsg}`,
        });

        return;
      }

      // 检查 API 错误
      const isApiError =
        aiResponse.content.includes("API Error") ||
        aiResponse.content.includes("Rate limit") ||
        aiResponse.content.includes("请检查") ||
        aiResponse.content.includes("[修订失败]");

      if (isApiError) {
        const leaderName =
          mission.leader.agentName || mission.leader.displayName;
        await callbacks.sendMessageToTopic(
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

        // ★ 修复：发送任务状态更新事件
        void this.topicEventEmitter.emitToTopic(
          mission.topicId,
          "task:status",
          {
            missionId: mission.id,
            taskId: task.id,
            status: AgentTaskStatus.REVISION_NEEDED,
          },
        );

        // ★ 修复：清除 Agent 工作状态
        void this.topicEventEmitter.emitToTopic(
          mission.topicId,
          "mission:agent_done",
          {
            missionId: mission.id,
            taskId: task.id,
            agentId: assignedTo.id,
          },
        );

        await callbacks.createLog(mission.id, {
          type: MissionLogType.TASK_FAILED,
          agentId: assignedTo.id,
          agentName: assignedTo.agentName || assignedTo.displayName,
          taskId: task.id,
          taskTitle: task.title,
          content: `任务「${task.title}」修改失败: AI响应包含错误`,
        });

        return;
      }

      // 发送修改汇报
      const leaderName = mission.leader.agentName || mission.leader.displayName;
      const resultMessage = await callbacks.sendMessageToTopic(
        mission.topicId,
        assignedTo.id,
        `[工作汇报]\n\n@${leaderName} 任务「${task.title}」已根据反馈修改完成！\n\n${aiResponse.content}`,
        MessageContentType.TEXT,
      );

      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: {
          status: AgentTaskStatus.AWAITING_REVIEW,
          result: aiResponse.content,
          resultMessageId: resultMessage?.id,
          needsRevision: false,
        },
      });

      // ★ 修复：发送任务状态更新事件
      void this.topicEventEmitter.emitToTopic(mission.topicId, "task:status", {
        missionId: mission.id,
        taskId: task.id,
        status: AgentTaskStatus.AWAITING_REVIEW,
        result: aiResponse.content,
      });

      // ★ 修复：清除 Agent 工作状态（修订完成，等待 Leader 审核）
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:agent_done",
        {
          missionId: mission.id,
          taskId: task.id,
          agentId: assignedTo.id,
        },
      );

      await callbacks.createLog(mission.id, {
        type: MissionLogType.TASK_REVISION,
        agentId: assignedTo.id,
        agentName: assignedTo.agentName || assignedTo.displayName,
        taskId: task.id,
        taskTitle: task.title,
        content: `任务修改完成（第 ${latestTask.revisionCount} 次修改）`,
        messageId: resultMessage?.id,
      });

      // 重新获取最新任务数据
      const updatedTask = await this.prisma.agentTask.findUnique({
        where: { id: task.id },
        include: { assignedTo: true },
      });

      if (!updatedTask) {
        this.logger.error(`Task ${task.id} not found after revision`);
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

      await this.prisma.agentTask.update({
        where: { id: task.id },
        data: { status: AgentTaskStatus.BLOCKED },
      });

      // ★ 修复：发送任务状态更新事件
      void this.topicEventEmitter.emitToTopic(mission.topicId, "task:status", {
        missionId: mission.id,
        taskId: task.id,
        status: AgentTaskStatus.BLOCKED,
      });

      // ★ 修复：清除 Agent 工作状态
      void this.topicEventEmitter.emitToTopic(
        mission.topicId,
        "mission:agent_done",
        {
          missionId: mission.id,
          taskId: task.id,
          agentId: assignedTo.id,
        },
      );

      const errorType =
        this.agentFacade.circuitBreaker?.parseErrorType(errorMsg) ??
        TaskCompletionType.API_ERROR;
      this.agentFacade.circuitBreaker?.recordFailure(
        assignedTo.id,
        errorType,
        errorMsg,
      );

      const leaderName =
        mission.leader?.agentName || mission.leader?.displayName || "Leader";
      await callbacks.sendMessageToTopic(
        mission.topicId,
        assignedTo.id,
        `[任务修改失败]\n\n@${leaderName} 任务「${task.title}」修改过程中发生意外错误：\n\n> ${errorMsg}\n\n任务已被标记为阻塞状态，需要人工干预。`,
        MessageContentType.TEXT,
      );

      await callbacks.createLog(mission.id, {
        type: MissionLogType.TASK_FAILED,
        agentId: assignedTo.id,
        agentName: assignedTo.agentName || assignedTo.displayName,
        taskId: task.id,
        taskTitle: task.title,
        content: `任务「${task.title}」修改失败（意外错误）: ${errorMsg}`,
      });
    } finally {
      // 仅在锁还未被释放时才释放（正常流程在 return 前已释放）
      if (this.stateManager.isRevisionInProgress(task.id)) {
        this.stateManager.finishRevision(task.id);
        this.logger.debug(
          `[executeTaskRevision] Released revision lock for task "${task.title}" (${task.id}) in finally block`,
        );
      }
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 为长内容生成摘要
   */
  private async summarizeForLeaderReview(
    content: string,
    taskTitle: string,
    leaderModel: string,
    missionId: string | undefined,
    callbacks: ReviewCallbacks,
  ): Promise<{ summary: string; keyExcerpts: string }> {
    const SUMMARY_THRESHOLD = 3000;

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

      // ★ AI Engine 能力下沉：通过 aiCaller 注入执行上下文
      const aiCaller = this.createAiCaller(callbacks, missionId || "");
      const systemPrompt =
        "你是一位专业的内容审核助手，擅长快速提炼长文精华。请客观、准确地生成摘要。";

      // 委托给 AI Engine 执行
      const response = await this.agentFacade.outputReviewer!.executeAICall(
        leaderModel,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        {
          taskProfile: { creativity: "low", outputLength: "short" },
        },
        aiCaller,
      );

      const headExcerpt = content.substring(0, 500);
      const tailExcerpt = content.substring(content.length - 500);
      const keyExcerpts = `【开篇】\n${headExcerpt}\n\n【结尾】\n${tailExcerpt}`;

      return {
        summary: response.content,
        keyExcerpts,
      };
    } catch (error) {
      this.logger.warn(
        `[summarizeForLeaderReview] 摘要生成失败，使用截断模式: ${error}`,
      );
      const head = content.substring(0, 1500);
      const tail = content.substring(content.length - 800);
      return {
        summary: `${head}\n\n...[中间省略]...\n\n${tail}`,
        keyExcerpts: "",
      };
    }
  }

  /**
   * 构建 Leader 审核提示词
   *
   * ★ 增强：加入跨任务一致性校验
   * - 从 contextPackage 中提取已确立的事实
   * - 要求 Leader 审核时检查与已确立事实的一致性
   */
  private buildLeaderReviewPrompt(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    taskResult: string,
  ): string {
    const MAX_RESULT_LENGTH = 2500;
    let truncatedResult: string;

    if (taskResult.length > MAX_RESULT_LENGTH) {
      const headLength = 1500;
      const tailLength = 800;
      const head = taskResult.substring(0, headLength);
      const tail = taskResult.substring(taskResult.length - tailLength);
      truncatedResult = `${head}\n\n...[中间内容已省略，原文共${taskResult.length}字符]...\n\n${tail}`;
    } else {
      truncatedResult = taskResult;
    }

    const constraintsHint =
      mission.constraints?.length > 0
        ? `\n**强制约束条件：**\n${mission.constraints.map((c: string, i: number) => `${i + 1}. ${c}`).join("\n")}\n`
        : "";

    // ★ AI Engine 能力下沉：使用 ContextEvolutionService 构建已确立事实的审核提示
    const contextPackage =
      mission.contextPackage as MissionContextPackage | null;
    const establishedFacts = contextPackage?.establishedFacts || [];
    const establishedFactsSection =
      this.agentFacade.contextEvolution!.buildFactsPromptSection(
        establishedFacts,
      );

    return `你是团队 Leader，请审核以下任务产出。

【整体任务背景】
任务主题：${mission.title || "未知"}
${mission.goals ? `任务目标：${mission.goals}` : ""}
${constraintsHint}
${establishedFactsSection}
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
- 与已确立的事实保持一致（无矛盾）

❌ **仅以下情况才需要修改（非常严格的标准）：**
- 完全偏离任务主题（写的内容与任务无关）
- 严重违反人物核心设定（如让哑巴说话、让死人复活）
- 字数严重不足（低于要求的 30%）
- 内容明显不完整（只有开头没有结尾）
- **与已确立事实严重矛盾**（如时间线冲突、人物身份冲突）

**重要提醒：**
- 文笔风格、细节处理、情节安排等都属于"可接受的创作差异"，不是拒绝理由
- 与你期望的不完全一致 ≠ 需要修改
- 有改进空间 ≠ 需要修改
- 能够串联进整体故事即可通过
- 细节的微小差异可以接受，但核心事实必须一致

请按以下格式输出：

## 审核结果：通过

**内容亮点：**
- [列出1-2个内容亮点，如人物刻画生动、情节紧凑等]

**一致性检查：** ✅ 与已确立事实无矛盾

**改进建议（可选）：**
- [如有轻微可改进之处，简要提及，但不影响通过]

---

或者如果存在严重问题：

## 审核结果：需要修改

**必须修复的问题：**
- [仅列出上述❌中的严重问题]

**一致性冲突（如有）：**
- [列出与哪个已确立事实矛盾，以及如何修正]`;
  }

  /**
   * 构建任务修订提示词
   */
  private buildTaskRevisionPrompt(
    mission: MissionWithRelations,
    task: AgentTaskWithAssignee,
    feedback: string,
  ): string {
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

    // 合并约束
    const mustConstraints = (mission.mustConstraints as HardConstraint[]) || [];
    const contextConstraints =
      (mission.contextPackage as MissionContextPackage | null)
        ?.hardConstraints || [];

    const constraintMap = new Map<string, HardConstraint>();
    mustConstraints.forEach((c) => constraintMap.set(c.id, c));
    contextConstraints.forEach((c) => {
      if (!constraintMap.has(c.id)) {
        constraintMap.set(c.id, c);
      }
    });
    const allConstraints = Array.from(constraintMap.values());

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
任务主题：${mission.title || "未知"}
任务名称：${task.title}
任务描述：${task.description || task.title}

【之前的产出】
${truncatedPreviousResult}

【Leader的反馈】
${feedback}

【修改要求】
1. 仔细阅读 Leader 的反馈
2. 根据反馈对内容进行针对性修改
3. 保留原有的优点和亮点
4. 确保修改后的内容完整、连贯

请直接输出修改后的完整内容，无需解释修改了什么。`;
  }
}
