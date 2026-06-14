/**
 * Mission Execution Service
 *
 * 负责 Mission 的任务执行和调度
 */

import {
  Injectable,
  Logger,
  Inject,
  Optional,
  forwardRef,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { OnEvent, EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  ResearchMissionStatus,
  ResearchTaskStatus,
  AIModelType,
  Prisma,
} from "@prisma/client";
import type {
  ResearchTask,
  ResearchTopic,
  TopicDimension,
} from "@prisma/client";
import {
  ResearchEventEmitterService,
  RESEARCH_INTERNAL_EVENTS,
} from "../research/research-event-emitter.service";
import { MissionQueryService } from "./mission-query.service";
import { ReportSynthesisService } from "../../report/report-synthesis.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { SessionLatencyTrackerService } from "@/modules/ai-harness/facade";
import { MissionContext } from "@/modules/ai-harness/facade";
import type { DimensionAnalysisResult } from "../../../types/research.types";
import type { ResearchDepth } from "../../../types/research-depth.types";
import { resolveResearchDepthConfig } from "../../../types/research-depth.types";
import type { LeaderPlan } from "../../../types/leader.types";
import { getModelDisplayNameMap } from "../../../utils/model-display-name";
import { toPrismaJson } from "@/common/utils/prisma-json.utils";
import { ResearchMemoryService } from "../research/research-memory.service";
import {
  DimensionResearchExecutor,
  ReviewDimensionExecutor,
  SynthesisReportExecutor,
  GenericTaskExecutor,
  type ITaskExecutor,
  type TaskExecutionContext,
  type TaskExecutionResult,
} from "../task-executors";
import { InsufficientCreditsException } from "../../../types/research.exceptions";
import { BillingContext } from "@/modules/platform/facade";
import {
  USER_EVENT_NAME,
  MODULE,
  ACTION,
  type UserEventPayload,
} from "@/common/observability/user-event.types";

/** Alias for task result JSON shape */
type TaskResultJson = TaskExecutionResult;

type ResearchTopicWithDimensions = ResearchTopic & {
  dimensions: TopicDimension[];
};

@Injectable()
export class MissionExecutionService {
  private readonly logger = new Logger(MissionExecutionService.name);

  /** Maps task type to its executor */
  private readonly executorMap: Map<string, ITaskExecutor>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly researchEventEmitter: ResearchEventEmitterService,
    private readonly queryService: MissionQueryService,
    private readonly reportSynthesisService: ReportSynthesisService,
    private readonly chatFacade: ChatFacade,
    // forwardRef: MissionExecutionService <-> ResearchMemoryService
    // Execution stores research findings in Memory; Memory retrieval informs execution strategy decisions
    @Inject(forwardRef(() => ResearchMemoryService))
    private readonly researchMemory: ResearchMemoryService,
    private readonly dimensionResearchExecutor: DimensionResearchExecutor,
    private readonly reviewDimensionExecutor: ReviewDimensionExecutor,
    private readonly synthesisReportExecutor: SynthesisReportExecutor,
    private readonly genericTaskExecutor: GenericTaskExecutor,
    @Optional()
    private readonly latencyTracker?: SessionLatencyTrackerService,
    @Optional()
    private readonly eventEmitter?: EventEmitter2,
  ) {
    this.executorMap = new Map<string, ITaskExecutor>([
      ["dimension_research", this.dimensionResearchExecutor],
      ["quality_review", this.reviewDimensionExecutor],
      ["report_synthesis", this.synthesisReportExecutor],
    ]);
  }

  /**
   * 启动任务执行循环
   * 异步执行所有可执行的任务
   */
  async startExecution(missionId: string, topicId: string): Promise<void> {
    this.logger.log(
      `[startExecution] Starting execution for mission ${missionId}`,
    );

    // 获取专题信息
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      include: { dimensions: true },
    });

    // V5: 读取 mission 的 researchDepth 并解析深度配置
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      select: { researchDepth: true },
    });
    const researchDepth = (mission?.researchDepth ??
      "standard") as ResearchDepth;
    const depthConfig = resolveResearchDepthConfig(researchDepth);
    this.logger.log(
      `[startExecution] V5 depth: ${researchDepth} (cognitiveLoops=${depthConfig.maxCognitiveLoops}, revisions=${depthConfig.maxRevisionRounds}, literatureBaseline=${depthConfig.literatureBaselineEnabled})`,
    );

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    // ★ 时延跟踪：开始会话并在 MissionContext 中传播
    const latencySessionId = this.latencyTracker?.startSession({
      type: "topic_insights_refresh",
      entityId: topicId,
      userId: topic.userId,
      metadata: {
        topicName: topic.name,
        missionId,
        researchDepth,
      },
    });

    return MissionContext.run(
      {
        // 2026-05-11: agentProcessId left undefined — topic-insights doesn't
        // spawn a kernel AgentProcess, so EventJournal correctly skips the
        // journal write. (Previously this used `processId: ""` as a sentinel
        // workaround for the FK violation; the field is now optional and
        // properly named.)
        userId: topic.userId,
        latencySessionId,
      },
      () =>
        this.startExecutionBody(
          missionId,
          topicId,
          topic,
          depthConfig,
          latencySessionId,
        ),
    );
  }

  /** startExecution 的核心执行体（在 MissionContext 中运行） */
  private async startExecutionBody(
    missionId: string,
    topicId: string,
    topic: ResearchTopicWithDimensions,
    depthConfig: ReturnType<typeof resolveResearchDepthConfig>,
    latencySessionId: string | undefined,
  ): Promise<void> {
    // ★ 时延跟踪：initialization 阶段
    if (latencySessionId) {
      this.latencyTracker?.startStep(latencySessionId, {
        name: "initialization",
      });
    }

    // ★ 先创建草稿报告，以便关联证据
    const draftReport =
      await this.reportSynthesisService.createDraftReport(topicId);
    this.logger.log(
      `[startExecution] Created draft report: ${draftReport.id} for evidence association`,
    );

    // ★ 检查是否有继承的已完成任务（增量模式）
    // 如果有，需要将之前报告的证据复制到新报告
    const completedTasks = await this.prisma.researchTask.findMany({
      where: {
        missionId,
        taskType: "dimension_research",
        status: ResearchTaskStatus.COMPLETED,
      },
    });

    if (completedTasks.length > 0) {
      // ★ 找到最近的有证据的报告，复制证据到新报告
      const previousReport = await this.prisma.topicReport.findFirst({
        where: {
          topicId,
          id: { not: draftReport.id }, // 排除刚创建的草稿
          evidences: { some: {} }, // 必须有证据
        },
        orderBy: { generatedAt: "desc" },
        include: { evidences: true },
      });

      if (previousReport && previousReport.evidences.length > 0) {
        // 复制证据到新报告（保持 citationIndex）
        const evidencesCopyData = previousReport.evidences.map((e) => ({
          reportId: draftReport.id, // ★ 关联到新报告
          title: e.title,
          url: e.url,
          domain: e.domain,
          snippet: e.snippet,
          sourceType: e.sourceType,
          publishedAt: e.publishedAt,
          credibilityScore: e.credibilityScore,
          citationIndex: e.citationIndex,
          analysisId: e.analysisId, // 保持分析关联
        }));

        await this.prisma.topicEvidence.createMany({
          data: evidencesCopyData,
        });

        this.logger.log(
          `[startExecution] ★ Copied ${previousReport.evidences.length} evidences from report ${previousReport.id.slice(0, 8)} to new report ${draftReport.id.slice(0, 8)}`,
        );
      }
    }

    // ★ 时延跟踪：结束 initialization，开始 task_execution
    if (latencySessionId) {
      this.latencyTracker?.endStepByName(latencySessionId, "initialization");
      this.latencyTracker?.startStep(latencySessionId, {
        name: "task_execution",
        parallel: true,
      });
    }

    // ★ v7.5: 使用动态调度器替代批量执行
    const maxConcurrentTasks = await this.calculateDynamicConcurrency();
    this.logger.log(
      `[startExecution] Starting dynamic scheduler with max concurrency ${maxConcurrentTasks}`,
    );

    await this.executeDynamicScheduler(missionId, maxConcurrentTasks, (task) =>
      this.executeTask(task, topic, missionId, draftReport.id, depthConfig),
    );

    // ★ 时延跟踪：结束 task_execution，开始 finalization
    if (latencySessionId) {
      this.latencyTracker?.endStepByName(latencySessionId, "task_execution");
      this.latencyTracker?.startStep(latencySessionId, {
        name: "finalization",
      });
    }

    // 更新最终状态
    await this.finalizeMission(missionId, topicId);

    // ★ 时延跟踪：结束会话（summary 自动持久化到 DB）
    if (latencySessionId) {
      this.latencyTracker?.endStepByName(latencySessionId, "finalization");
      this.latencyTracker?.endSession(latencySessionId, "completed");
    }
  }

  /**
   * 恢复执行（重试场景）
   * 与 startExecution 不同，此方法复用已有的报告，不创建新草稿
   * 避免重试时已完成的维度分析和新重试的维度分析分散在不同报告中
   */
  async resumeExecution(missionId: string, topicId: string): Promise<void> {
    this.logger.log(
      `[resumeExecution] Resuming execution for mission ${missionId}`,
    );

    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      include: { dimensions: true },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      select: { researchDepth: true },
    });
    const researchDepth = (mission?.researchDepth ??
      "standard") as ResearchDepth;
    const depthConfig = resolveResearchDepthConfig(researchDepth);

    // ★ 复用已有报告，不创建新草稿
    const existingReport = await this.prisma.topicReport.findFirst({
      where: { topicId },
      orderBy: { generatedAt: "desc" },
      select: { id: true },
    });

    if (!existingReport) {
      // Fallback: 如果没有已有报告（不应该发生），走正常流程
      this.logger.warn(
        `[resumeExecution] No existing report found for topic ${topicId}, falling back to startExecution`,
      );
      return this.startExecution(missionId, topicId);
    }

    this.logger.log(
      `[resumeExecution] Reusing existing report: ${existingReport.id}`,
    );

    // ★ 时延跟踪：resume 路径也需要 session + MissionContext
    const latencySessionId = this.latencyTracker?.startSession({
      type: "topic_insights_refresh",
      entityId: topicId,
      userId: topic.userId,
      metadata: { topicName: topic.name, missionId, mode: "resume" },
    });

    await MissionContext.run(
      // 2026-05-11: agentProcessId omitted — see startExecution() comment.
      { userId: topic.userId, latencySessionId },
      async () => {
        if (latencySessionId) {
          this.latencyTracker?.startStep(latencySessionId, {
            name: "task_execution",
            parallel: true,
          });
        }

        const maxConcurrentTasks = await this.calculateDynamicConcurrency();
        await this.executeDynamicScheduler(
          missionId,
          maxConcurrentTasks,
          (task) =>
            this.executeTask(
              task,
              topic,
              missionId,
              existingReport.id,
              depthConfig,
            ),
        );

        if (latencySessionId) {
          this.latencyTracker?.endStepByName(
            latencySessionId,
            "task_execution",
          );
          this.latencyTracker?.startStep(latencySessionId, {
            name: "finalization",
          });
        }

        await this.finalizeMission(missionId, topicId);

        if (latencySessionId) {
          this.latencyTracker?.endStepByName(latencySessionId, "finalization");
          this.latencyTracker?.endSession(latencySessionId, "completed");
        }
      },
    );
  }

  /**
   * 执行单个任务
   */
  async executeTask(
    task: ResearchTask,
    topic: ResearchTopicWithDimensions,
    missionId: string,
    reportId: string,
    depthConfig?: import("../../../types/research-depth.types").ResearchDepthConfig,
  ): Promise<void> {
    this.logger.log(`[executeTask] Executing task: ${task.title} (${task.id})`);

    // ★ 前置检查：任务开始前检查是否已被取消（防止竞态条件覆盖 FAILED 状态）
    // ★ 同时获取 leaderPlan 以查找 Agent 分配的模型
    const [currentTask, currentMission] = await Promise.all([
      this.prisma.researchTask.findUnique({
        where: { id: task.id },
        select: { status: true, modelId: true, skills: true, tools: true },
      }),
      this.prisma.researchMission.findUnique({
        where: { id: missionId },
        select: { status: true, leaderPlan: true, researchDepth: true },
      }),
    ]);

    // 如果任务已被取消（状态为 FAILED）或任务不存在，直接返回
    if (!currentTask || currentTask.status === ResearchTaskStatus.FAILED) {
      this.logger.log(
        `[executeTask] Task ${task.id} was cancelled or not found, skipping execution`,
      );
      return;
    }

    // 如果 Mission 已被取消，直接返回
    if (
      !currentMission ||
      currentMission.status === ResearchMissionStatus.CANCELLED
    ) {
      this.logger.log(
        `[executeTask] Mission ${missionId} was cancelled, skipping task ${task.id}`,
      );
      return;
    }

    // ★ 修复竞态条件：使用原子 CAS 操作更新任务状态
    // 只有当任务状态为 PENDING 时才更新为 EXECUTING
    const updateResult = await this.prisma.researchTask.updateMany({
      where: {
        id: task.id,
        status: ResearchTaskStatus.PENDING,
      },
      data: { status: ResearchTaskStatus.EXECUTING },
    });

    if (updateResult.count === 0) {
      // 任务状态已改变（可能被取消或已在执行中）
      this.logger.log(
        `[executeTask] Task ${task.id} state changed (CAS failed), skipping execution`,
      );
      return;
    }

    // 确定 Agent 角色
    const agentRole = this.queryService.getAgentRoleFromTaskType(task.taskType);
    const agentName = this.queryService.getAgentNameFromTaskType(task.taskType);

    // ★ 优先使用任务记录中的 modelId，fallback 到 leaderPlan 查找
    // 任务创建时已保存 modelId，直接使用更可靠
    const leaderPlan = currentMission?.leaderPlan as LeaderPlan | null;
    const agentAssignment = leaderPlan?.agentAssignments?.find(
      (a) => a.agentId === task.assignedAgent,
    );
    const assignedModelId =
      currentTask.modelId || task.modelId || agentAssignment?.modelId;

    // ★ 提取 Leader 分配的 skills 和 tools（优先从任务记录，fallback 到 agentAssignment）
    const assignedSkills =
      currentTask.skills?.length > 0
        ? currentTask.skills
        : agentAssignment?.skills || [];
    const assignedTools =
      currentTask.tools?.length > 0
        ? currentTask.tools
        : agentAssignment?.tools || [];

    // ★ 时延跟踪：提前获取 context（需要在 catch 中使用）
    const parentCtx = MissionContext.get();
    let taskStepId: string | undefined;
    const taskStepName = task.dimensionName
      ? `${task.taskType}:${task.dimensionName}`
      : task.taskType;

    try {
      // ★ 任务状态已在上面通过 CAS 操作更新为 EXECUTING

      // ★ 发送任务开始事件
      await this.researchEventEmitter.emitTaskStarted(topic.id, {
        taskId: task.id,
        taskType: task.taskType,
        title: task.title,
        dimensionName: task.dimensionName ?? undefined,
        status: "executing",
        progress: 0,
        message: `开始执行: ${task.title}`,
      });

      // ★ 发送 Agent 工作状态事件（传递 missionId 以便持久化）
      await this.researchEventEmitter.emitAgentWorking(
        topic.id,
        {
          agentId: task.assignedAgent,
          agentName,
          agentRole,
          status: "working",
          taskDescription: task.title,
          dimensionId: task.dimensionId ?? undefined,
          dimensionName: task.dimensionName ?? undefined,
          progress: 0,
          modelId: assignedModelId, // ★ 传递模型 ID 用于显示
        },
        missionId,
      );

      // Determine executor
      const executor =
        this.executorMap.get(task.taskType) ?? this.genericTaskExecutor;

      // Build context
      const executionContext: TaskExecutionContext = {
        task,
        topic,
        missionId,
        reportId,
        depthConfig,
        assignedModelId,
        assignedSkills,
        assignedTools,
        agentName,
        agentRole,
      };

      // ★ 时延跟踪：每个 task 在自己的 MissionContext 中执行
      if (parentCtx?.latencySessionId && this.latencyTracker) {
        taskStepId = this.latencyTracker.startStep(parentCtx.latencySessionId, {
          name: taskStepName,
          metadata: {
            taskId: task.id,
            taskType: task.taskType,
            agent: task.assignedAgent,
            model: assignedModelId,
          },
        });
      }

      // Execute — 在带 latencyPhaseId 的 MissionContext 中运行
      // 这样 AiChatService.recordToLatencySession 会读到正确的 stepId
      const result: TaskResultJson = parentCtx?.latencySessionId
        ? await MissionContext.run(
            {
              ...parentCtx,
              latencyPhaseId: taskStepId,
            },
            () => executor.execute(executionContext),
          )
        : await executor.execute(executionContext);

      // ★ 时延跟踪：结束 task step
      if (parentCtx?.latencySessionId && taskStepId && this.latencyTracker) {
        this.latencyTracker.endStep(parentCtx.latencySessionId, taskStepId);
      }

      // ★ 发送 Agent 完成事件（传递 missionId 以便持久化）
      await this.researchEventEmitter.emitAgentCompleted(
        topic.id,
        task.assignedAgent,
        agentName,
        `${task.title} 完成`,
        missionId,
        {
          dimensionId: task.dimensionId ?? undefined,
          dimensionName: task.dimensionName ?? undefined,
          modelId: assignedModelId,
        },
      );

      // ★ 在更新状态前检查任务和 Mission 是否已被取消
      const [currentTaskStatus, currentMissionStatus] = await Promise.all([
        this.prisma.researchTask.findUnique({
          where: { id: task.id },
          select: { status: true },
        }),
        this.prisma.researchMission.findUnique({
          where: { id: missionId },
          select: { status: true },
        }),
      ]);

      // 如果任务已被取消（状态被设置为 FAILED），跳过更新
      if (
        currentTaskStatus?.status === ResearchTaskStatus.FAILED ||
        currentTaskStatus?.status === ResearchTaskStatus.COMPLETED
      ) {
        this.logger.log(
          `[executeTask] Task ${task.id} status already changed to ${currentTaskStatus.status}, skipping update`,
        );
        return;
      }

      // 如果 Mission 已被取消，跳过更新
      if (currentMissionStatus?.status === ResearchMissionStatus.CANCELLED) {
        this.logger.log(
          `[executeTask] Mission ${missionId} was cancelled during execution, skipping task ${task.id} completion`,
        );
        return;
      }

      // ★ 发送任务完成事件
      await this.researchEventEmitter.emitTaskCompleted(topic.id, {
        taskId: task.id,
        taskType: task.taskType,
        title: task.title,
        dimensionName: task.dimensionName ?? undefined,
        status: "completed",
        progress: 100,
        message: `完成: ${task.title}`,
      });

      // 更新任务状态为完成
      // ★ 修复：从 result 中提取人类可读的摘要，而不是 JSON.stringify
      let summary: string;
      if (typeof result === "string") {
        summary = (result as unknown as string).substring(0, 500);
      } else if (result?.summary) {
        // 优先使用 result.summary 字段
        summary = result.summary.substring(0, 500);
      } else if (result?.content) {
        // 其次使用 result.content 字段
        summary = result.content.substring(0, 500);
      } else {
        // 最后才使用简单描述
        summary = `研究完成`;
      }

      // ★ 提取实际使用的模型（从维度研究结果或审核结果中）
      const actualModelId = result?.actualModelId;

      if (actualModelId && actualModelId !== assignedModelId) {
        this.logger.warn(
          `[executeTask] Model fallback occurred for task ${task.id}: assigned=${assignedModelId} → actual=${actualModelId}`,
        );
      }

      await this.queryService.updateTaskStatus(
        task.id,
        ResearchTaskStatus.COMPLETED,
        {
          result: result as unknown as Prisma.InputJsonValue,
          resultSummary: summary,
          actualModelId,
        },
      );

      // ★ 质量审核完成后，检查是否有低分维度需要修订
      // 注意：此处同步 await，确保新的 PENDING 任务在 executeTask 返回前已写入 DB，
      // 避免 scheduler 在本任务完成后立即退出（因检测到 remainingPending=0）
      if (task.taskType === "quality_review") {
        const revisionTargets = result?.revisionTargets;
        const revisionRound = result?.revisionRound ?? 1;

        if (revisionTargets && revisionTargets.length > 0) {
          this.logger.log(
            `[executeTask] quality_review round ${revisionRound} triggered revision for ${revisionTargets.length} dimension(s)`,
          );
          try {
            await this.handleRevisionTargets(
              missionId,
              topic.id,
              revisionTargets,
              reportId,
              revisionRound,
            );
          } catch (err) {
            this.logger.error(
              `[executeTask] handleRevisionTargets failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      // ★ 当实际模型与分配模型不同时，更新该 agent 所有活动记录的 agentName
      // 包括 emitAgentWorking（带旧模型标签）和 emitAgentCompleted（无标签）的记录
      if (actualModelId && actualModelId !== assignedModelId) {
        try {
          const nameMap = await getModelDisplayNameMap(
            this.prisma,
            [actualModelId, assignedModelId].filter(Boolean) as string[],
          );
          const actualDisplayName = nameMap.get(actualModelId) || actualModelId;
          const newAgentName = `${agentName} [${actualDisplayName}]`;

          await this.prisma.researchAgentActivity.updateMany({
            where: {
              missionId,
              agentId: task.assignedAgent,
              ...(task.dimensionId ? { dimensionId: task.dimensionId } : {}),
            },
            data: {
              agentName: newAgentName,
            },
          });
        } catch (err) {
          this.logger.debug(
            `[executeTask] Failed to update activity model labels: ${err}`,
          );
        }
      }

      this.logger.log(`[executeTask] Task completed: ${task.title}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[executeTask] Task failed: ${task.title} - ${errorMsg}`,
      );

      // ★ 时延跟踪：失败时也结束 step（用 parentCtx 因为 catch 块不在 MissionContext.run 内）
      if (parentCtx?.latencySessionId && taskStepId && this.latencyTracker) {
        this.latencyTracker.endStep(parentCtx.latencySessionId, taskStepId);
      }

      // 更新任务状态为失败
      await this.queryService.updateTaskStatus(
        task.id,
        ResearchTaskStatus.FAILED,
        {
          result: { error: errorMsg },
          resultSummary: `执行失败: ${errorMsg}`,
        },
      );

      // ★ 积分不足快速失败：立即标记 Mission 为 FAILED，阻止后续任务启动
      if (error instanceof InsufficientCreditsException) {
        this.logger.error(
          `[executeTask] ★ Insufficient credits detected for task ${task.title}, failing mission ${missionId} immediately`,
        );
        try {
          await this.prisma.researchMission.updateMany({
            where: {
              id: missionId,
              status: { not: ResearchMissionStatus.FAILED },
            },
            data: {
              status: ResearchMissionStatus.FAILED,
            },
          });
          // ★ 同时取消所有 PENDING 任务，避免后续启动
          await this.prisma.researchTask.updateMany({
            where: {
              missionId,
              status: {
                in: [ResearchTaskStatus.PENDING, ResearchTaskStatus.ASSIGNED],
              },
            },
            data: {
              status: ResearchTaskStatus.FAILED,
              resultSummary: "积分不足，任务已终止",
            },
          });
        } catch (updateErr) {
          this.logger.error(
            `[executeTask] Failed to mark mission as FAILED: ${updateErr}`,
          );
        }
      }
    }
  }

  /**
   * ★ 处理修订目标
   *
   * 当质量审核发现低分维度时，此方法：
   * 1. 将低分维度的 dimension_research task 重置为 PENDING（标记 leaderReview 和 revisionCount）
   * 2. 创建新一轮 quality_review task（依赖被修订的维度 task IDs）
   * 3. 将 report_synthesis task 的 dependencies 更新为包含新 quality_review task ID
   * 4. 通知前端修订开始
   */
  private async handleRevisionTargets(
    missionId: string,
    topicId: string,
    targets: Array<{
      taskId: string;
      dimensionId: string;
      dimensionName: string;
      score: number;
      feedback: string;
    }>,
    _reportId: string,
    currentRound: number,
  ): Promise<void> {
    this.logger.log(
      `[handleRevisionTargets] Initiating revision round ${currentRound + 1} for ${targets.length} dimension(s) in mission ${missionId}`,
    );

    const revisedTaskIds: string[] = [];

    // 1. 对每个低分维度 task：存入 leaderReview，重置状态为 PENDING，递增 revisionCount
    for (const target of targets) {
      try {
        // 先读取当前 revisionCount
        const currentTask = await this.prisma.researchTask.findUnique({
          where: { id: target.taskId },
          select: { revisionCount: true, status: true },
        });

        if (!currentTask) {
          this.logger.warn(
            `[handleRevisionTargets] Task ${target.taskId} not found, skipping`,
          );
          continue;
        }

        // 写入审核反馈并重置为 PENDING
        await this.prisma.researchTask.update({
          where: { id: target.taskId },
          data: {
            status: ResearchTaskStatus.PENDING,
            revisionCount: currentTask.revisionCount + 1,
            leaderReview: toPrismaJson({
              round: currentRound,
              score: target.score,
              feedback: target.feedback,
              reviewedAt: new Date().toISOString(),
            }),
            reviewStatus: "needs_revision",
            // 清空上次结果，避免审核员拿旧结果打分
            result: Prisma.JsonNull,
            resultSummary: `修订中（第 ${currentRound + 1} 轮）：${target.feedback.substring(0, 100)}`,
          },
        });

        revisedTaskIds.push(target.taskId);

        this.logger.log(
          `[handleRevisionTargets] Reset task ${target.taskId} (${target.dimensionName}) to PENDING for revision`,
        );
      } catch (err) {
        this.logger.error(
          `[handleRevisionTargets] Failed to reset task ${target.taskId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (revisedTaskIds.length === 0) {
      this.logger.warn(
        `[handleRevisionTargets] No tasks were successfully reset, skipping new quality_review creation`,
      );
      return;
    }

    // 2. 创建新的 quality_review task（round+1），依赖被修订的维度 task IDs
    const nextRound = currentRound + 1;
    const newReviewTask = await this.prisma.researchTask.create({
      data: {
        missionId,
        title: `质量审核（第 ${nextRound} 轮）`,
        description: `审核修订后的维度研究质量，验证关键发现 [revision:${nextRound}]`,
        taskType: "quality_review",
        assignedAgent: "Reviewer",
        status: ResearchTaskStatus.PENDING,
        priority: 100,
        // ★ 依赖所有被修订的维度 task，确保它们完成后才执行
        dependencies: revisedTaskIds,
      },
    });

    this.logger.log(
      `[handleRevisionTargets] Created new quality_review task ${newReviewTask.id} (round ${nextRound}), depends on ${revisedTaskIds.length} task(s)`,
    );

    // 3. 更新 report_synthesis task 的 dependencies，添加新 quality_review task ID
    // 找到当前 mission 的 report_synthesis task
    const synthTask = await this.prisma.researchTask.findFirst({
      where: {
        missionId,
        taskType: "report_synthesis",
        // PENDING 或 ASSIGNED：synthesis 依赖未满足时一定是 PENDING
        status: {
          in: [ResearchTaskStatus.PENDING, ResearchTaskStatus.ASSIGNED],
        },
      },
      select: { id: true, dependencies: true },
    });

    if (synthTask) {
      const updatedDeps = Array.from(
        new Set([...synthTask.dependencies, newReviewTask.id]),
      );
      await this.prisma.researchTask.update({
        where: { id: synthTask.id },
        data: { dependencies: updatedDeps },
      });

      this.logger.log(
        `[handleRevisionTargets] Updated report_synthesis task ${synthTask.id} dependencies to include new review task`,
      );
    } else {
      this.logger.warn(
        `[handleRevisionTargets] No PENDING report_synthesis task found for mission ${missionId}`,
      );
    }

    // 4. 通知前端修订开始
    try {
      await this.researchEventEmitter.emitAgentWorking(
        topicId,
        {
          agentId: "Reviewer",
          agentName: "质量审核员",
          agentRole: "reviewer",
          status: "working",
          taskDescription: `发现 ${targets.length} 个维度质量不达标，启动第 ${nextRound} 轮修订研究`,
          progress: 0,
        },
        missionId,
      );
    } catch (emitErr) {
      this.logger.warn(
        `[handleRevisionTargets] Failed to emit revision event: ${emitErr}`,
      );
    }
  }

  /**
   * 执行通用维度研究（当没有预定义维度时）
   * Delegates to DimensionResearchExecutor
   */
  async executeGenericDimensionResearch(
    task: ResearchTask,
    topic: ResearchTopicWithDimensions,
    reportId: string,
  ): Promise<DimensionAnalysisResult> {
    return this.dimensionResearchExecutor.executeGenericDimensionResearch(
      task,
      topic,
      reportId,
    );
  }

  /**
   * ★ 动态计算并发度
   * 根据可用 Provider 数量调整，每个 Provider 有独立的限流配额
   *
   * 逻辑：
   * - 单 Provider: 5 并发
   * - 2 Providers: 7 并发
   * - 3+ Providers: 9 并发
   * - 最大 10 并发（避免过度占用资源）
   */
  async calculateDynamicConcurrency(): Promise<number> {
    const MIN_CONCURRENCY = 4;
    // ★ 修复：降低最大并发数以避免数据库连接池耗尽
    // Prisma 默认连接池约 10 个连接，每个任务可能使用 2 个连接
    // 设置最大并发 8，保留部分连接给其他操作
    const MAX_CONCURRENCY = 8;

    try {
      // 获取所有启用的 CHAT 模型
      const models = await this.chatFacade.getAvailableModels(AIModelType.CHAT);

      // 统计唯一 Provider 数量
      const uniqueProviders = new Set(models.map((m) => m.provider));
      const providerCount = uniqueProviders.size;

      // 根据 Provider 数量计算并发度
      // 公式：基础 4 + 每多一个 Provider 增加 2，上限 8
      const concurrency = Math.min(
        MAX_CONCURRENCY,
        Math.max(MIN_CONCURRENCY, MIN_CONCURRENCY + (providerCount - 1) * 2),
      );

      this.logger.log(
        `[calculateDynamicConcurrency] ${providerCount} providers (${Array.from(uniqueProviders).join(", ")}) → concurrency=${concurrency}`,
      );

      return concurrency;
    } catch (error) {
      this.logger.warn(
        `[calculateDynamicConcurrency] Failed to get models, using default: ${error}`,
      );
      return MIN_CONCURRENCY;
    }
  }

  /**
   * 完成 Mission，更新最终状态
   */
  async finalizeMission(missionId: string, topicId: string): Promise<void> {
    // ★ 先检查 Mission 当前状态，如果已被取消则不覆盖
    const currentMission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      select: { status: true, topic: { select: { userId: true } } },
    });

    if (currentMission?.status === ResearchMissionStatus.CANCELLED) {
      this.logger.log(
        `[finalizeMission] Mission ${missionId} was cancelled, skipping finalization`,
      );
      return;
    }

    const tasks = await this.prisma.researchTask.findMany({
      where: { missionId },
    });

    const completedTasks = tasks.filter(
      (t) => t.status === ResearchTaskStatus.COMPLETED,
    );
    const failedTasks = tasks.filter(
      (t) => t.status === ResearchTaskStatus.FAILED,
    );
    const pendingTasks = tasks.filter(
      (t) =>
        t.status === ResearchTaskStatus.PENDING ||
        t.status === ResearchTaskStatus.EXECUTING,
    );

    // ★ 改进的状态判断逻辑：
    // - 有未完成（PENDING/EXECUTING）的任务 → FAILED（调度异常，如死锁或重试后未被拾取）
    // - 所有任务已终结且有成功 → COMPLETED（部分成功也算成功）
    // - 所有任务已终结且全部失败 → FAILED
    const hasAnySuccess = completedTasks.length > 0;
    const hasAnyFailure = failedTasks.length > 0;
    const hasIncomplete = pendingTasks.length > 0;

    let finalStatus: ResearchMissionStatus;
    if (hasIncomplete) {
      // ★ Bug fix: PENDING/EXECUTING 任务仍存在 → 调度异常，不能标记为 COMPLETED
      finalStatus = ResearchMissionStatus.FAILED;
      this.logger.warn(
        `[finalizeMission] Mission ${missionId} has ${pendingTasks.length} incomplete tasks (PENDING/EXECUTING), marking as FAILED`,
      );
    } else if (hasAnySuccess) {
      finalStatus = ResearchMissionStatus.COMPLETED;
    } else {
      finalStatus = ResearchMissionStatus.FAILED;
    }

    const progressPercent = hasIncomplete
      ? Math.round((completedTasks.length / tasks.length) * 100)
      : 100;

    await this.prisma.researchMission.updateMany({
      where: {
        id: missionId,
        status: { not: ResearchMissionStatus.CANCELLED },
      },
      data: {
        status: finalStatus,
        completedTasks: completedTasks.length,
        progressPercent,
        completedAt: new Date(),
      },
    });

    // 运营看板埋点：COMPLETED / FAILED 跃迁
    const userId = currentMission?.topic?.userId;
    if (userId) {
      this.eventEmitter?.emit(USER_EVENT_NAME, {
        userId,
        module: MODULE.AI_RESEARCH,
        action:
          finalStatus === ResearchMissionStatus.COMPLETED
            ? ACTION.COMPLETED
            : ACTION.FAILED,
        resourceType: "ResearchMission",
        resourceId: missionId,
        topicKey: topicId,
      } satisfies UserEventPayload);
    }

    // ★ 只清理完全空的草稿报告（没有任何维度分析的）
    // 部分成功的报告应该保留，让用户看到已完成的研究
    if (!hasAnySuccess) {
      const emptyDraftReports = await this.prisma.topicReport.findMany({
        where: {
          topicId,
          dimensionAnalyses: { none: {} },
        },
        select: { id: true },
      });

      if (emptyDraftReports.length > 0) {
        const deleteIds = emptyDraftReports.map((r) => r.id);
        await this.prisma.topicReport.deleteMany({
          where: { id: { in: deleteIds } },
        });
        this.logger.log(
          `[finalizeMission] Cleaned up ${deleteIds.length} empty draft reports after complete failure`,
        );
      }
    }

    // ★ 构建更详细的状态消息
    let statusMessage: string;
    let phase: string;

    if (hasIncomplete) {
      // 调度异常（死锁/重试未拾取）
      phase = "failed";
      statusMessage = `研究未完成：${completedTasks.length} 个任务成功，${pendingTasks.length} 个任务未被调度，请重试`;
    } else if (hasAnySuccess && !hasAnyFailure) {
      // 完全成功
      phase = "completed";
      statusMessage = `研究完成，共完成 ${completedTasks.length} 个任务`;
    } else if (hasAnySuccess && hasAnyFailure) {
      // 部分成功
      phase = "completed";
      statusMessage = `研究部分完成：${completedTasks.length} 个任务成功，${failedTasks.length} 个任务失败`;
    } else {
      // 完全失败
      phase = "failed";
      statusMessage = `研究失败，${failedTasks.length} 个任务全部失败`;
    }

    // 发送进度事件
    this.queryService.emitProgress({
      missionId,
      topicId,
      status: finalStatus,
      progress: 100,
      phase,
      message: statusMessage,
      completedTasks: completedTasks.length,
      totalTasks: tasks.length,
    });

    // ★ 关键修复：发送完成事件通知前端状态变化
    // 之前只发送了 emitProgress，没有发送 emitMissionCompleted
    // 导致前端需要手动刷新才能看到状态从"研究中"变为"已完成"
    if (finalStatus === ResearchMissionStatus.COMPLETED) {
      await this.researchEventEmitter.emitMissionCompleted(
        topicId,
        missionId,
        completedTasks.length,
        tasks.length,
      );

      // 触发持久化通知（fire-and-forget；NotificationEventListener 监听）。
      // 失败不阻塞任务完成主流程。
      void this.dispatchCompletionNotification(missionId, topicId, {
        completedTasks: completedTasks.length,
        totalTasks: tasks.length,
      });

      // ★ 提取并存储研究发现（异步，不阻塞完成流程）
      void this.extractResearchMemories(missionId, topicId).catch((error) => {
        this.logger.error(
          `[finalizeMission] Failed to extract research memories: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      });
    }

    this.logger.log(
      `[finalizeMission] Mission ${missionId} finalized: ${statusMessage}`,
    );
  }

  /**
   * 派发"研究完成"持久化通知（fire-and-forget；listener 在 ai-app/notifications-bridge）。
   * 不在 finalize 主路径上 await — 通知失败绝不影响业务流。
   */
  private async dispatchCompletionNotification(
    missionId: string,
    topicId: string,
    metrics: { completedTasks: number; totalTasks: number },
  ): Promise<void> {
    if (!this.eventEmitter) return;
    try {
      const topic = await this.prisma.researchTopic.findUnique({
        where: { id: topicId },
        select: { userId: true, name: true },
      });
      if (!topic?.userId) return;
      this.eventEmitter.emit("notification.task-completed", {
        kind: "research",
        userId: topic.userId,
        refId: missionId,
        parentId: topicId,
        title: topic.name || missionId,
        metrics,
      });
    } catch (err) {
      this.logger.debug(
        `[dispatchCompletionNotification] failed for mission ${missionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 提取并存储研究记忆（异步后台任务）
   */
  private async extractResearchMemories(
    missionId: string,
    topicId: string,
  ): Promise<void> {
    this.logger.log(
      `[extractResearchMemories] Starting memory extraction for mission ${missionId}`,
    );

    try {
      const storedCount = await this.researchMemory.extractAndStoreFindings(
        missionId,
        topicId,
      );
      this.logger.log(
        `[extractResearchMemories] Successfully stored ${storedCount} findings from mission ${missionId}`,
      );
    } catch (error) {
      this.logger.error(
        `[extractResearchMemories] Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * ★ v7.5: 动态任务调度器
   *
   * 核心改进：每完成一个任务就立即检查是否有新的可执行任务
   * 不再等待当前批次全部完成，实现真正的动态调度
   *
   * @param missionId Mission ID
   * @param maxConcurrent 最大并发数
   * @param executor 任务执行函数
   */
  async executeDynamicScheduler(
    missionId: string,
    maxConcurrent: number,
    executor: (task: ResearchTask) => Promise<void>,
  ): Promise<void> {
    const executingTasks = new Map<string, Promise<void>>();
    const completedTaskIds = new Set<string>();
    let consecutiveWaits = 0;
    const MAX_CONSECUTIVE_WAITS = 30; // 30 × 2s = 60s deadlock timeout

    // ★ 主调度循环
    while (true) {
      // 0. 检查 Mission 是否被取消
      const mission = await this.prisma.researchMission.findUnique({
        where: { id: missionId },
        select: { status: true },
      });
      if (
        !mission ||
        mission.status === ResearchMissionStatus.CANCELLED ||
        mission.status === ResearchMissionStatus.FAILED
      ) {
        this.logger.log(
          `[dynamicScheduler] Mission ${missionId} cancelled/failed, stopping`,
        );
        break;
      }

      // 1. 获取当前可执行的任务（依赖已满足的 PENDING 任务）
      const executableTasks =
        await this.queryService.getExecutableTasks(missionId);

      // 过滤掉已完成或正在执行的任务
      const newTasks = executableTasks.filter(
        (t) => !completedTaskIds.has(t.id) && !executingTasks.has(t.id),
      );

      // 2. 如果有空闲槽位，启动新任务
      const availableSlots = maxConcurrent - executingTasks.size;
      const tasksToStart = newTasks.slice(0, availableSlots);

      if (tasksToStart.length > 0) {
        consecutiveWaits = 0; // Reset deadlock counter when dispatching
      }

      for (const task of tasksToStart) {
        this.logger.log(
          `[dynamicScheduler] Starting task: ${task.title} (${task.id}), ` +
            `active: ${executingTasks.size + 1}/${maxConcurrent}`,
        );

        // 创建任务执行 Promise
        const taskPromise = executor(task)
          .then(() => {
            this.logger.log(
              `[dynamicScheduler] Task completed: ${task.title} (${task.id})`,
            );
            // ★ Bug fix: 只在成功时标记为已完成
            // 失败的任务不加入 completedTaskIds，因为用户可能重试（重置为 PENDING）
            // 如果失败任务被加入 completedTaskIds，重试后 scheduler 的 newTasks 过滤会跳过它
            completedTaskIds.add(task.id);
          })
          .catch((error) => {
            this.logger.error(
              `[dynamicScheduler] Task failed: ${task.title} (${task.id}): ${error.message}`,
            );
          })
          .finally(() => {
            executingTasks.delete(task.id);
          });

        executingTasks.set(task.id, taskPromise);
      }

      // 3. 检查是否需要退出循环
      if (executingTasks.size === 0) {
        // 没有正在执行的任务，检查是否还有待处理的
        const remainingPending = await this.prisma.researchTask.count({
          where: {
            missionId,
            status: ResearchTaskStatus.PENDING,
          },
        });

        if (remainingPending === 0) {
          this.logger.log(
            `[dynamicScheduler] No more tasks to execute, exiting scheduler`,
          );
          break;
        }

        // 还有待处理任务但依赖未满足，等待一下再检查
        consecutiveWaits++;
        if (
          consecutiveWaits >= MAX_CONSECUTIVE_WAITS &&
          executingTasks.size === 0
        ) {
          this.logger.error(
            `[dynamicScheduler] Deadlock detected: ${remainingPending} tasks pending but no tasks executing after ${consecutiveWaits} waits`,
          );
          break;
        }
        this.logger.log(
          `[dynamicScheduler] Waiting for dependencies, ${remainingPending} tasks pending (wait ${consecutiveWaits}/${MAX_CONSECUTIVE_WAITS})`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      // 4. 等待任意一个任务完成，然后立即检查是否有新的可执行任务
      await Promise.race(executingTasks.values());

      // 短暂延迟，让数据库状态稳定
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // 5. 等待所有剩余任务完成
    if (executingTasks.size > 0) {
      this.logger.log(
        `[dynamicScheduler] Waiting for ${executingTasks.size} remaining tasks`,
      );
      await Promise.all(executingTasks.values());
    }
  }

  /**
   * ★ v7.3: 恢复执行新添加的任务
   *
   * 当用户在 Mission 完成后添加新任务时调用此方法
   * 会重新激活 Mission 并执行待处理的任务
   *
   * @param missionId Mission ID
   * @param topicId Topic ID
   * @returns 是否成功触发执行
   */
  async resumeExecutionForNewTask(
    missionId: string,
    topicId: string,
  ): Promise<boolean> {
    this.logger.log(
      `[resumeExecutionForNewTask] Checking mission ${missionId} for new task execution`,
    );

    // 1. 检查 Mission 状态
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      select: { status: true, topic: { select: { userId: true } } },
    });

    if (!mission) {
      this.logger.warn(
        `[resumeExecutionForNewTask] Mission ${missionId} not found`,
      );
      return false;
    }

    // 2. 如果 Mission 正在执行中，循环会自动拾取新任务，无需处理
    if (mission.status === ResearchMissionStatus.EXECUTING) {
      this.logger.log(
        `[resumeExecutionForNewTask] Mission ${missionId} is still executing, loop will pick up new task`,
      );
      return true;
    }

    // 3. 如果 Mission 已完成或失败，检查是否有待执行的任务
    if (
      mission.status === ResearchMissionStatus.COMPLETED ||
      mission.status === ResearchMissionStatus.FAILED
    ) {
      const pendingTasks = await this.prisma.researchTask.findMany({
        where: {
          missionId,
          status: ResearchTaskStatus.PENDING,
        },
        orderBy: { priority: "asc" },
      });

      if (pendingTasks.length === 0) {
        this.logger.log(
          `[resumeExecutionForNewTask] No pending tasks for mission ${missionId}`,
        );
        return false;
      }

      this.logger.log(
        `[resumeExecutionForNewTask] Found ${pendingTasks.length} pending tasks, restarting execution`,
      );

      // 4. 更新 Mission 状态为 EXECUTING
      await this.prisma.researchMission.update({
        where: { id: missionId },
        data: { status: ResearchMissionStatus.EXECUTING },
      });

      // 运营看板埋点：EXECUTING→started
      if (mission.topic?.userId) {
        this.eventEmitter?.emit(USER_EVENT_NAME, {
          userId: mission.topic.userId,
          module: MODULE.AI_RESEARCH,
          action: ACTION.STARTED,
          resourceType: "ResearchMission",
          resourceId: missionId,
          topicKey: topicId,
        } satisfies UserEventPayload);
      }

      // 5. 发送状态更新事件
      await this.researchEventEmitter.emitMissionProgress(topicId, {
        missionId,
        progress: 0,
        phase: "resuming",
        message: `恢复执行 ${pendingTasks.length} 个新任务`,
        completedTasks: 0,
        totalTasks: pendingTasks.length,
      });

      // 6. 异步启动执行循环（确保 BillingContext 传播）
      // ★ 使用 resumeExecution 复用已有报告，避免维度分析分散到不同报告
      const existingCtx = BillingContext.get();
      const startFn = () => this.resumeExecution(missionId, topicId);
      const wrappedStart = existingCtx
        ? () => BillingContext.run(existingCtx, startFn)
        : startFn;
      void wrappedStart().catch((err) => {
        this.logger.error(
          `[resumeExecutionForNewTask] Execution failed: ${err}`,
        );
      });

      return true;
    }

    // 其他状态（CANCELLED）不处理
    this.logger.log(
      `[resumeExecutionForNewTask] Mission ${missionId} status is ${mission.status}, not resuming`,
    );
    return false;
  }

  /**
   * 事件监听器 - 处理 Mission 恢复执行请求
   * 由 Leader/Todo 通过 ResearchEventEmitterService 发出（避免循环依赖）
   */
  @OnEvent(RESEARCH_INTERNAL_EVENTS.RESUME_MISSION_EXECUTION)
  async handleResumeMissionExecution(payload: {
    missionId: string;
    topicId: string;
  }): Promise<void> {
    // ★ Event handlers have no HTTP context — construct BillingContext from topic owner
    const startFn = () =>
      this.resumeExecutionForNewTask(payload.missionId, payload.topicId);

    const existingCtx = BillingContext.get();
    if (existingCtx) {
      void BillingContext.run(existingCtx, startFn).catch((err) => {
        this.logger.error(
          `[handleResumeMissionExecution] Failed to resume mission: ${err}`,
        );
      });
      return;
    }

    // No context — look up userId from topic
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: payload.topicId },
      select: { userId: true },
    });
    if (topic?.userId) {
      const billingCtx = {
        userId: topic.userId,
        moduleType: "topic-insights" as const,
        operationType: "research" as const,
        referenceId: payload.missionId,
      };
      void BillingContext.run(billingCtx, startFn).catch((err) => {
        this.logger.error(
          `[handleResumeMissionExecution] Failed to resume mission: ${err}`,
        );
      });
    } else {
      void startFn().catch((err) => {
        this.logger.error(
          `[handleResumeMissionExecution] Failed to resume mission: ${err}`,
        );
      });
    }
  }

  // ==================== Phase 5: Recovery Methods ====================

  /**
   * ★ Phase 5: 事件监听器 - 处理恢复事件
   * 当 HealthService 检测到需要恢复的任务时，会发出此事件
   */
  @OnEvent(RESEARCH_INTERNAL_EVENTS.RECOVERY_NEEDED)
  async handleRecoveryNeeded(payload: {
    missionId: string;
    topicId: string;
    resetTaskCount: number;
  }): Promise<void> {
    const { missionId, resetTaskCount } = payload;
    this.logger.log(
      `[handleRecoveryNeeded] Received recovery event for mission ${missionId}, ` +
        `${resetTaskCount} tasks were reset`,
    );

    try {
      await this.continueExecution(missionId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[handleRecoveryNeeded] Failed to continue execution: ${errorMessage}`,
      );
    }
  }

  /**
   * ★ Phase 5: 继续执行被中断的 Mission
   *
   * 用于服务重启后自动恢复被中断的任务：
   * 1. 验证 Mission 存在且状态为 EXECUTING
   * 2. 将 EXECUTING 状态的任务重置为 PENDING（它们可能在执行中被中断）
   * 3. 调用 startExecution 继续执行
   *
   * @param missionId 要恢复的 Mission ID
   * @returns Promise<void>
   * @throws Error 如果 Mission 不存在或状态不正确
   */
  async continueExecution(missionId: string): Promise<void> {
    this.logger.log(
      `[continueExecution] Attempting to continue mission ${missionId}`,
    );

    // 1. 查询 Mission 及其相关信息
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      include: {
        topic: true,
        tasks: {
          where: { status: ResearchTaskStatus.EXECUTING },
        },
      },
    });

    if (!mission) {
      throw new NotFoundException(`Mission ${missionId} not found`);
    }

    if (mission.status !== ResearchMissionStatus.EXECUTING) {
      throw new BadRequestException(
        `Mission ${missionId} is not in EXECUTING status (current: ${mission.status})`,
      );
    }

    // 2. 将 EXECUTING 状态的任务重置为 PENDING
    // 这些任务在服务重启前可能正在执行，需要重新执行
    if (mission.tasks.length > 0) {
      const taskIds = mission.tasks.map((t) => t.id);
      await this.prisma.researchTask.updateMany({
        where: { id: { in: taskIds } },
        data: {
          status: ResearchTaskStatus.PENDING,
          startedAt: null, // 重置开始时间
        },
      });
      this.logger.log(
        `[continueExecution] Reset ${taskIds.length} EXECUTING tasks to PENDING`,
      );
    }

    // 3. 发送恢复进度事件
    const completedCount = await this.prisma.researchTask.count({
      where: { missionId, status: ResearchTaskStatus.COMPLETED },
    });
    const totalCount = await this.prisma.researchTask.count({
      where: { missionId },
    });
    const progress =
      totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    await this.researchEventEmitter.emitMissionProgress(mission.topicId, {
      missionId,
      progress,
      phase: "executing",
      message: `任务已恢复，继续执行... (${completedCount}/${totalCount})`,
      completedTasks: completedCount,
      totalTasks: totalCount,
    });

    this.logger.log(
      `[continueExecution] Resuming mission ${missionId} for topic ${mission.topicId}, ` +
        `progress: ${completedCount}/${totalCount} (${progress}%)`,
    );

    // 4. 异步启动执行（不阻塞，确保 BillingContext 传播）
    const existingCtx2 = BillingContext.get();
    const startFn2 = () => this.startExecution(missionId, mission.topicId);
    const wrappedStart2 = existingCtx2
      ? () => BillingContext.run(existingCtx2, startFn2)
      : startFn2;
    void wrappedStart2().catch((err) => {
      this.logger.error(
        `[continueExecution] Failed to continue execution: ${err.message}`,
      );
      // 更新状态为失败
      void this.prisma.researchMission
        .update({
          where: { id: missionId },
          data: { status: ResearchMissionStatus.FAILED },
        })
        .catch((updateErr) => {
          this.logger.error(
            `[continueExecution] Failed to mark mission as FAILED: ${updateErr.message}`,
          );
        });
      // 运营看板埋点：执行启动失败→FAILED
      if (mission.topic?.userId) {
        this.eventEmitter?.emit(USER_EVENT_NAME, {
          userId: mission.topic.userId,
          module: MODULE.AI_RESEARCH,
          action: ACTION.FAILED,
          resourceType: "ResearchMission",
          resourceId: missionId,
          topicKey: mission.topicId,
        } satisfies UserEventPayload);
      }
    });
  }

  /**
   * ★ v8.1: 添加新 Agent 到 leaderPlan.agentAssignments
   *
   * 当通过 Leader 对话创建任务时，需要将新 Agent 的配置
   * （包括 skills、tools、modelId）添加到 leaderPlan 中，
   * 以便前端能够正确显示 Agent 的能力配置。
   *
   * @param missionId Mission ID
   * @param agentAssignment 新的 Agent 分配信息
   */
  async addAgentToLeaderPlan(
    missionId: string,
    agentAssignment: {
      agentId: string;
      agentName?: string;
      agentType: string;
      role?: string;
      modelId?: string;
      skills?: string[];
      tools?: string[];
    },
  ): Promise<void> {
    try {
      // 1. 获取当前 Mission 的 leaderPlan
      const mission = await this.prisma.researchMission.findUnique({
        where: { id: missionId },
        select: { leaderPlan: true },
      });

      if (!mission) {
        this.logger.warn(
          `[addAgentToLeaderPlan] Mission ${missionId} not found`,
        );
        return;
      }

      // 2. 解析现有的 leaderPlan
      const leaderPlan = (mission.leaderPlan as unknown as LeaderPlan) || {
        taskUnderstanding: { topic: "", scope: "", objectives: [] },
        dimensions: [],
        executionStrategy: { parallelism: 5, priorityOrder: [] },
        agentAssignments: [],
      };

      // 3. 检查是否已存在该 Agent
      const existingIndex = leaderPlan.agentAssignments?.findIndex(
        (a) => a.agentId === agentAssignment.agentId,
      );

      if (existingIndex !== undefined && existingIndex >= 0) {
        // 更新现有 Agent 的配置（保留原有的 agentType）
        const existingAgent = leaderPlan.agentAssignments[existingIndex];
        leaderPlan.agentAssignments[existingIndex] = {
          ...existingAgent,
          agentName: agentAssignment.agentName ?? existingAgent.agentName,
          role: agentAssignment.role ?? existingAgent.role,
          modelId: agentAssignment.modelId ?? existingAgent.modelId,
          skills: agentAssignment.skills ?? existingAgent.skills,
          tools: agentAssignment.tools ?? existingAgent.tools,
        };
        this.logger.log(
          `[addAgentToLeaderPlan] Updated existing agent ${agentAssignment.agentId} in leaderPlan`,
        );
      } else {
        // 添加新 Agent
        if (!leaderPlan.agentAssignments) {
          leaderPlan.agentAssignments = [];
        }
        leaderPlan.agentAssignments.push({
          agentId: agentAssignment.agentId,
          agentName: agentAssignment.agentName,
          agentType: agentAssignment.agentType as
            | "dimension_researcher"
            | "quality_reviewer"
            | "report_writer",
          role: agentAssignment.role || "用户请求研究员",
          modelId: agentAssignment.modelId,
          skills: agentAssignment.skills,
          tools: agentAssignment.tools,
        });
        this.logger.log(
          `[addAgentToLeaderPlan] Added new agent ${agentAssignment.agentId} to leaderPlan with skills: [${agentAssignment.skills?.join(", ")}], tools: [${agentAssignment.tools?.join(", ")}]`,
        );
      }

      // 4. 更新数据库
      await this.prisma.researchMission.update({
        where: { id: missionId },
        data: {
          leaderPlan: toPrismaJson(leaderPlan),
        },
      });
    } catch (error) {
      this.logger.error(
        `[addAgentToLeaderPlan] Failed to update leaderPlan: ${error}`,
      );
      // 不抛出异常，避免影响主流程
    }
  }
}
