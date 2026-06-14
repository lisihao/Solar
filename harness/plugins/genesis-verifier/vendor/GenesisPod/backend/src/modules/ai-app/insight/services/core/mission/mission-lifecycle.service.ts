/**
 * Mission Lifecycle Service
 *
 * 负责 Mission 的创建、规划、调整、取消、重试等生命周期管理
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { withTimeout } from "@/common/utils/timeout.utils";
import { RequestContext } from "@/common/context/request-context";
import { StateTransitionValidator } from "@/modules/ai-harness/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  ResearchMissionStatus,
  ResearchTaskStatus,
  ResearchTodoStatus,
  LeaderDecisionType,
} from "@prisma/client";
import type { ResearchMission, ResearchTask } from "@prisma/client";
import { LeaderPlanningService } from "../leader/leader-planning.service";
import { LeaderIntentService } from "../leader/leader-intent.service";
import type { LeaderPlan } from "../../../types/leader.types";
import { ResearchEventEmitterService } from "../research/research-event-emitter.service";
import { TopicCollaboratorService } from "../../collaboration/topic-collaborator.service";
import { AgentActivityService } from "../../monitoring/agent-activity.service";
import { CollaboratorRole } from "../../../dto/collaborator.dto";
import { toPrismaJson } from "@/common/utils/prisma-json.utils";
import {
  TASK_PRIORITY,
  RESEARCH_MISSION_TRANSITIONS,
  type CreateMissionInput,
  type CompletedTaskData,
} from "../../../types/mission.types";
import { AgentActivityType } from "@prisma/client";
import { MissionQueryService } from "./mission-query.service";
import { MissionExecutionService } from "./mission-execution.service";
import { BillingContext } from "@/modules/platform/facade";
import {
  USER_EVENT_NAME,
  MODULE,
  ACTION,
  type UserEventPayload,
} from "@/common/observability/user-event.types";

@Injectable()
export class MissionLifecycleService {
  private readonly logger = new Logger(MissionLifecycleService.name);
  private readonly missionStateValidator = new StateTransitionValidator(
    RESEARCH_MISSION_TRANSITIONS,
    [
      ResearchMissionStatus.COMPLETED,
      ResearchMissionStatus.FAILED,
      ResearchMissionStatus.CANCELLED,
    ],
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderPlanning: LeaderPlanningService,
    private readonly leaderIntent: LeaderIntentService,
    private readonly researchEventEmitter: ResearchEventEmitterService,
    private readonly collaboratorService: TopicCollaboratorService,
    private readonly agentActivity: AgentActivityService,
    // forwardRef: MissionLifecycleService <-> MissionQueryService
    // Lifecycle emits progress events via QueryService; QueryService reads task states that Lifecycle updates
    @Inject(forwardRef(() => MissionQueryService))
    private readonly queryService: MissionQueryService,
    // forwardRef: MissionLifecycleService <-> MissionExecutionService
    // Lifecycle triggers Execution after planning; Execution updates Mission state managed by Lifecycle
    @Inject(forwardRef(() => MissionExecutionService))
    private readonly executionService: MissionExecutionService,
    @Optional()
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * 创建新的研究 Mission
   * 调用 Leader 进行规划，创建任务列表
   */
  async createMission(input: CreateMissionInput): Promise<ResearchMission> {
    const {
      topicId,
      userPrompt,
      userContext,
      mode = "fresh",
      researchDepth = "standard",
    } = input;
    const isIncremental = mode === "incremental";
    this.logger.log(
      `[createMission] Creating mission for topic ${topicId}, mode: ${mode}, depth: ${researchDepth}`,
    );

    // 1. 验证专题存在
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    // ★ 增量模式：查找已完成的维度任务（用于继承）
    // 需要收集完整的任务数据，以便复制到新 Mission
    let completedTasks: CompletedTaskData[] = [];
    let completedDimensionNames: string[] = [];

    if (isIncremental) {
      // 查找此 Topic 最近的 Mission，获取已完成的维度任务（完整数据）
      const latestMission = await this.prisma.researchMission.findFirst({
        where: { topicId },
        orderBy: { createdAt: "desc" },
        include: {
          tasks: {
            where: {
              taskType: "dimension_research",
              status: ResearchTaskStatus.COMPLETED,
            },
          },
        },
      });

      if (latestMission?.tasks) {
        completedTasks = latestMission.tasks
          .filter((t) => t.dimensionName)
          .map((t) => ({
            dimensionName: t.dimensionName!,
            dimensionId: t.dimensionId,
            title: t.title,
            description: t.description,
            assignedAgent: t.assignedAgent,
            assignedAgentType: t.assignedAgentType,
            modelId: t.modelId, // ★ 保存使用的模型 ID
            priority: t.priority,
            result: t.result,
            resultSummary: t.resultSummary,
            startedAt: t.startedAt,
            completedAt: t.completedAt,
          }));
        completedDimensionNames = completedTasks.map((t) => t.dimensionName);
        this.logger.log(
          `[createMission] Incremental mode: found ${completedTasks.length} completed tasks: ${completedDimensionNames.join(", ")}`,
        );
      }
    }

    // 2. 检查是否有正在进行的 Mission
    const existingMission = await this.prisma.researchMission.findFirst({
      where: {
        topicId,
        status: {
          in: [
            ResearchMissionStatus.PLANNING,
            ResearchMissionStatus.EXECUTING,
            ResearchMissionStatus.REVIEWING,
          ],
        },
      },
      include: {
        tasks: {
          where: {
            taskType: "dimension_research",
          },
        },
      },
    });

    if (existingMission) {
      // ★ 2026-05-13 P0-#3 dedup window: 短时间内的重复 POST（frontend React
      //   StrictMode 双调用 / 用户双击 / 多组件并发 useEffect）会让上一次刚
      //   启动的 mission 被立刻 cancel-and-recreate, 白烧 LLM token 还让用户
      //   看到 mission id 在变。10s 内的重复请求视作幂等，直接返回 existing。
      //   超过窗口（用户明确想重启）才走 cancel-and-recreate。
      const DEDUP_WINDOW_MS = 10_000;
      const ageMs = Date.now() - existingMission.createdAt.getTime();
      if (ageMs < DEDUP_WINDOW_MS) {
        this.logger.log(
          `[createMission] dedup hit: existing mission ${existingMission.id} ` +
            `created ${ageMs}ms ago (< ${DEDUP_WINDOW_MS}ms window), status=${existingMission.status} ` +
            `— returning existing instead of cancel-and-recreate (likely frontend double-invoke)`,
        );
        return existingMission;
      }

      // ★ 根据模式决定如何处理旧 Mission
      if (isIncremental) {
        // 增量模式：收集已完成的任务（完整数据）
        const existingCompletedTasks = existingMission.tasks
          .filter(
            (t) => t.status === ResearchTaskStatus.COMPLETED && t.dimensionName,
          )
          .map((t) => ({
            dimensionName: t.dimensionName!,
            dimensionId: t.dimensionId,
            title: t.title,
            description: t.description,
            assignedAgent: t.assignedAgent,
            assignedAgentType: t.assignedAgentType,
            modelId: t.modelId, // ★ 保存使用的模型 ID
            priority: t.priority,
            result: t.result,
            resultSummary: t.resultSummary,
            startedAt: t.startedAt,
            completedAt: t.completedAt,
          }));

        // 合并已完成的任务（去重：以 dimensionName 为键）
        const existingNames = new Set(
          completedTasks.map((t) => t.dimensionName),
        );
        for (const task of existingCompletedTasks) {
          if (!existingNames.has(task.dimensionName)) {
            completedTasks.push(task);
            existingNames.add(task.dimensionName);
          }
        }
        completedDimensionNames = completedTasks.map((t) => t.dimensionName);
        this.logger.log(
          `[createMission] Incremental: merged ${existingCompletedTasks.length} completed from active mission, total: ${completedTasks.length}`,
        );
      }

      this.logger.warn(
        `[createMission] Found existing mission ${existingMission.id} (status: ${existingMission.status}), ` +
          `cancelling to start ${isIncremental ? "incremental update" : "fresh"}...`,
      );

      // 取消旧 Mission
      await this.prisma.researchMission.update({
        where: { id: existingMission.id },
        data: { status: ResearchMissionStatus.CANCELLED },
      });

      // 取消旧 Mission 的所有未完成 Task
      await this.prisma.researchTask.updateMany({
        where: {
          missionId: existingMission.id,
          status: {
            notIn: [ResearchTaskStatus.COMPLETED, ResearchTaskStatus.FAILED],
          },
        },
        data: { status: ResearchTaskStatus.FAILED },
      });

      // 取消旧 Mission 的所有待处理 Todo
      await this.prisma.researchTodo.updateMany({
        where: {
          missionId: existingMission.id,
          status: {
            notIn: [ResearchTodoStatus.COMPLETED, ResearchTodoStatus.CANCELLED],
          },
        },
        data: {
          status: ResearchTodoStatus.CANCELLED,
          statusMessage: isIncremental
            ? "用户启动了增量更新"
            : "用户启动了新研究",
          completedAt: new Date(),
        },
      });

      this.logger.log(
        `[createMission] Cancelled old mission ${existingMission.id}`,
      );
    }

    // 3. 获取 Leader 模型信息
    const leaderModel = await this.leaderPlanning.getReasoningModel();
    this.logger.log(
      `[createMission] Leader model: ${leaderModel?.modelId || "null"} / ${leaderModel?.modelName || "null"}`,
    );

    // 4. 创建 Mission 记录（状态为 PLANNING）
    const mission = await this.prisma.researchMission.create({
      data: {
        topicId,
        status: ResearchMissionStatus.PLANNING,
        leaderModelId: leaderModel?.modelId,
        leaderModelName: leaderModel?.modelName,
        userPrompt,
        userContext: userContext ? toPrismaJson(userContext) : undefined,
        researchDepth,
      },
    });

    // 5. 发送进度事件
    this.queryService.emitProgress({
      missionId: mission.id,
      topicId,
      status: ResearchMissionStatus.PLANNING,
      progress: 5,
      phase: "planning",
      message: "Leader 正在规划研究方案...",
      completedTasks: 0,
      totalTasks: 0,
    });

    // ★ 关键修复：立即返回 mission，异步执行规划
    // 原因：AI 推理可能需要 2-5 分钟，而 Next.js rewrite 代理默认 30 秒超时
    // 前端会通过轮询 getMission 和 WebSocket 获取规划进度
    const PLANNING_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟超时

    // ★ 2026-05-12 BYOK fix: 显式 snapshot HTTP 请求时的 RequestContext，
    //   再用 RequestContext.run 包 executePlanningAsync。原因：fire-and-forget
    //   `void withTimeout(...)` 的 async 链路依赖 AsyncLocalStorage 隐式传播，
    //   实测某些场景（如 setTimeout 跨 tick）会丢失，下游 ModelResolverService
    //   .selectModel 的 BYOK auto-resolve 拿不到 userId → 退化到 admin pool →
    //   被选中的 admin 模型 provider(openai) 用户没 key → planResearch 报
    //   "No API Key available for provider openai"。
    //   显式包裹相当于"重新进入"AsyncLocalStorage 域，async 路径保证可见。
    const requestCtx = RequestContext.get();

    // ★ 修复：添加超时控制，防止 AI 调用无限挂起
    void withTimeout(
      RequestContext.run(requestCtx ?? {}, () =>
        this.executePlanningAsync(
          mission.id,
          topicId,
          topic.name,
          userPrompt,
          completedTasks, // ★ 增量模式：传递已完成的任务（完整数据）
        ),
      ),
      PLANNING_TIMEOUT_MS,
      "Planning timeout after 10 minutes",
    ).catch(async (err) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[createMission] Async planning failed: ${errorMessage}`,
      );

      // ★ 更新 Mission 状态为失败
      try {
        await this.prisma.researchMission.update({
          where: { id: mission.id },
          data: {
            status: ResearchMissionStatus.FAILED,
          },
        });
      } catch (updateErr) {
        this.logger.error(
          `[createMission] Failed to update mission status: ${updateErr}`,
        );
      }
      // 运营看板埋点：规划超时/失败→FAILED
      if (topic.userId) {
        this.eventEmitter?.emit(USER_EVENT_NAME, {
          userId: topic.userId,
          module: MODULE.AI_RESEARCH,
          action: ACTION.FAILED,
          resourceType: "ResearchMission",
          resourceId: mission.id,
          topicKey: topicId,
        } satisfies UserEventPayload);
      }
    });

    this.logger.log(
      `[createMission] Mission ${mission.id} created, planning started asynchronously`,
    );

    return mission;
  }

  /**
   * 异步执行 Leader 规划
   * ★ 关键：从 createMission 中分离出来，避免阻塞 HTTP 响应
   */
  async executePlanningAsync(
    missionId: string,
    topicId: string,
    topicName: string,
    userPrompt?: string,
    completedTasks: CompletedTaskData[] = [], // ★ 增量模式：已完成的任务（完整数据）
  ): Promise<void> {
    this.logger.log(
      `[executePlanningAsync] Starting planning for mission ${missionId}` +
        (completedTasks.length > 0
          ? `, incremental mode with ${completedTasks.length} completed tasks`
          : ""),
    );

    // ★ 发送 Leader 思考事件：理解任务
    await this.researchEventEmitter.emitLeaderThinking(topicId, {
      missionId,
      phase: "understanding",
      content: `正在理解研究主题「${topicName}」的需求...`,
      progress: 10,
    });

    try {
      // ★ 发送 Leader 思考事件：分析
      await this.researchEventEmitter.emitLeaderThinking(topicId, {
        missionId,
        phase: "analyzing",
        content: "正在分析研究范围和关键维度...",
        progress: 20,
      });

      // ★ 发送 Leader 规划中事件
      await this.researchEventEmitter.emitLeaderPlanning(
        topicId,
        missionId,
        "Leader 正在制定研究计划，确定研究维度和任务分配...",
      );

      const leaderPlan = await this.leaderPlanning.planResearch(
        topicId,
        userPrompt,
      );

      // ★ 发送 Leader 思考事件：规划完成
      await this.researchEventEmitter.emitLeaderThinking(topicId, {
        missionId,
        phase: "planning",
        content: `已规划 ${leaderPlan.dimensions.length} 个研究维度：${leaderPlan.dimensions.map((d) => d.name).join("、")}`,
        progress: 40,
      });

      // 记录 Leader 决策
      await this.prisma.leaderDecision.create({
        data: {
          missionId,
          type: LeaderDecisionType.PLAN,
          input: { topicId, userPrompt },
          decision: toPrismaJson(leaderPlan),
          reasoning: `规划了 ${leaderPlan.dimensions.length} 个研究维度，分配了 ${leaderPlan.agentAssignments.length} 个 Agent`,
        },
      });

      // ★ 记录 Leader 团队组建活动到 Activity（持久化）
      await this.agentActivity.recordActivity({
        topicId,
        missionId,
        agentId: "leader",
        agentName: "研究组长",
        agentRole: "leader",
        activityType: AgentActivityType.PLANNING,
        phase: "team_building",
        content: `组建研究团队：规划了 ${leaderPlan.dimensions.length} 个研究维度，分配了 ${leaderPlan.agentAssignments.length} 个研究员`,
        progress: 50,
        thinkingPhase: "understanding",
        thinkingContent: `研究维度：${leaderPlan.dimensions.map((d) => d.name).join("、")}\n研究员分配：${leaderPlan.agentAssignments.map((a) => `${a.agentName || a.agentId}${a.modelId ? ` [${a.modelId}]` : ""}`).join("、")}`,
      });

      // ★ 发送 Leader 思考事件：分配任务（结构化显示模型分配）
      const researcherAssignments = leaderPlan.agentAssignments.filter(
        (a) => a.agentType === "dimension_researcher",
      );
      // 按模型分组统计
      const modelGroups = new Map<string, string[]>();
      for (const a of researcherAssignments) {
        const modelId = a.modelId || "默认模型";
        if (!modelGroups.has(modelId)) {
          modelGroups.set(modelId, []);
        }
        modelGroups.get(modelId)!.push(a.agentName || a.agentId);
      }
      // 格式化输出：按模型分组
      const groupedAssignments = Array.from(modelGroups.entries())
        .map(([model, agents]) => `【${model}】${agents.join("、")}`)
        .join("\n");
      await this.researchEventEmitter.emitLeaderThinking(topicId, {
        missionId,
        phase: "assigning",
        content: `团队组建完成（${researcherAssignments.length}人）：\n${groupedAssignments}`,
        progress: 50,
      });

      // 将 Leader 规划的维度同步到数据库，并创建任务
      // ★ 增量模式：先复制已完成的任务，再创建新任务
      const tasks = await this.createTasksFromPlan(
        missionId,
        topicId,
        leaderPlan,
        completedTasks,
      );

      // ★ 发送 Leader 规划完成事件
      await this.researchEventEmitter.emitLeaderPlanReady(
        topicId,
        missionId,
        leaderPlan.dimensions.length,
        leaderPlan.agentAssignments.length,
      );

      // 更新 Mission
      const updatedMission = await this.prisma.researchMission.update({
        where: { id: missionId },
        data: {
          leaderPlan: toPrismaJson(leaderPlan),
          totalTasks: tasks.length,
          status: ResearchMissionStatus.EXECUTING,
          startedAt: new Date(),
        },
        include: { topic: { select: { userId: true } } },
      });

      // 运营看板埋点：EXECUTING→started
      if (updatedMission.topic?.userId) {
        this.eventEmitter?.emit(USER_EVENT_NAME, {
          userId: updatedMission.topic.userId,
          module: MODULE.AI_RESEARCH,
          action: ACTION.STARTED,
          resourceType: "ResearchMission",
          resourceId: missionId,
          topicKey: topicId,
        } satisfies UserEventPayload);
      }

      // 发送进度事件
      this.queryService.emitProgress({
        missionId,
        topicId,
        status: ResearchMissionStatus.EXECUTING,
        progress: 10,
        phase: "executing",
        message: `规划完成，开始执行 ${tasks.length} 个任务`,
        completedTasks: 0,
        totalTasks: tasks.length,
      });

      this.logger.log(
        `[executePlanningAsync] Mission ${missionId} planning completed with ${tasks.length} tasks`,
      );

      // ★ 启动异步任务执行（确保 BillingContext 传播）
      const existingCtx = BillingContext.get();
      const startFn = () =>
        this.executionService.startExecution(missionId, topicId);
      const wrappedStart = existingCtx
        ? () => BillingContext.run(existingCtx, startFn)
        : startFn;
      void wrappedStart().catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[executePlanningAsync] Execution failed: ${errMsg}`);
        // 孤儿清理：标记 mission FAILED + 未完成的任务/todo
        void this.prisma.researchMission
          .update({
            where: { id: missionId },
            data: { status: ResearchMissionStatus.FAILED },
          })
          .catch((err: unknown) => {
            this.logger.warn(
              `[executePlanningAsync] Non-critical operation failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        void this.prisma.researchTask
          .updateMany({
            where: {
              missionId,
              status: {
                notIn: [
                  ResearchTaskStatus.COMPLETED,
                  ResearchTaskStatus.FAILED,
                ],
              },
            },
            data: { status: ResearchTaskStatus.FAILED },
          })
          .catch((err: unknown) => {
            this.logger.warn(
              `[executePlanningAsync] Non-critical operation failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        void this.prisma.researchTodo
          .updateMany({
            where: {
              missionId,
              status: {
                notIn: [
                  ResearchTodoStatus.COMPLETED,
                  ResearchTodoStatus.CANCELLED,
                ],
              },
            },
            data: {
              status: ResearchTodoStatus.CANCELLED,
              statusMessage: "执行启动失败",
              completedAt: new Date(),
            },
          })
          .catch((err: unknown) => {
            this.logger.warn(
              `[executePlanningAsync] Non-critical operation failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      });
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "规划失败：未知错误";

      // 规划失败，更新状态
      // ★ 使用 try-catch 包裹更新操作，避免 mission 已被删除时报错
      let failedMissionUserId: string | undefined;
      try {
        // ★ 先检查 mission 是否仍存在
        const missionExists = await this.prisma.researchMission.findUnique({
          where: { id: missionId },
          select: { id: true, topic: { select: { userId: true } } },
        });

        if (missionExists) {
          failedMissionUserId = missionExists.topic?.userId;
          await this.prisma.researchMission.update({
            where: { id: missionId },
            data: {
              status: ResearchMissionStatus.FAILED,
            },
          });
        } else {
          this.logger.debug(
            `[executePlanningAsync] Mission ${missionId} no longer exists, skipping status update`,
          );
        }
      } catch (updateError) {
        this.logger.debug(
          `[executePlanningAsync] Could not update mission status: ${updateError}`,
        );
      }

      // 运营看板埋点：规划失败→FAILED
      if (failedMissionUserId) {
        this.eventEmitter?.emit(USER_EVENT_NAME, {
          userId: failedMissionUserId,
          module: MODULE.AI_RESEARCH,
          action: ACTION.FAILED,
          resourceType: "ResearchMission",
          resourceId: missionId,
          topicKey: topicId,
        } satisfies UserEventPayload);
      }

      // ★ 发送失败事件，让前端知道规划失败
      // 使用 emitMissionFailed 发送正确的 mission:failed 事件
      await this.researchEventEmitter.emitMissionFailed(
        topicId,
        missionId,
        errorMsg,
      );

      this.logger.error(`[executePlanningAsync] Planning failed: ${errorMsg}`);
    }
  }

  /**
   * 审批研究规划并启动执行
   * 从 PLAN_READY 状态转为 EXECUTING，然后 fire-and-forget 启动执行
   *
   * ★ 并发安全：使用 updateMany + status CAS 作为乐观锁。
   * 两次并发审批只会有一次赢得转换，另一次会被 idempotently 跳过，
   * 避免重复创建任务 / 重复启动调度器 / 重复消耗积分。
   */
  async approvePlanAndExecute(
    missionId: string,
    topicId: string,
    completedTasks: CompletedTaskData[] = [],
  ): Promise<void> {
    // ★ CAS 第一步：原子地把 PLAN_READY → EXECUTING。只有赢家才继续。
    const claim = await this.prisma.researchMission.updateMany({
      where: { id: missionId, status: ResearchMissionStatus.PLAN_READY },
      data: {
        status: ResearchMissionStatus.EXECUTING,
        startedAt: new Date(),
      },
    });

    if (claim.count === 0) {
      // 要么 mission 不存在，要么已被另一并发调用占用，要么状态不是 PLAN_READY
      const existing = await this.prisma.researchMission.findUnique({
        where: { id: missionId },
        select: { status: true, leaderPlan: true },
      });
      if (!existing) {
        throw new NotFoundException(`Mission ${missionId} not found`);
      }
      if (!existing.leaderPlan) {
        throw new NotFoundException(`Mission ${missionId} has no plan`);
      }
      this.logger.warn(
        `[approvePlanAndExecute] Skipped duplicate approve for mission ${missionId} ` +
          `(current status=${existing.status}, expected PLAN_READY). ` +
          `Another concurrent call already owns execution.`,
      );
      return;
    }

    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      select: { leaderPlan: true },
    });

    if (!mission?.leaderPlan) {
      // Should not happen since we just CAS'd from PLAN_READY which guarantees a plan exists,
      // but guard anyway.
      throw new NotFoundException(
        `Mission ${missionId} plan disappeared after claim`,
      );
    }

    const leaderPlan = mission.leaderPlan as unknown as LeaderPlan;

    // 创建任务
    const tasks = await this.createTasksFromPlan(
      missionId,
      topicId,
      leaderPlan,
      completedTasks,
    );

    // 更新任务计数（status 已在 CAS 中置为 EXECUTING，不要再写 status）
    await this.prisma.researchMission.update({
      where: { id: missionId },
      data: {
        totalTasks: tasks.length,
      },
    });

    // 发送进度事件
    this.queryService.emitProgress({
      missionId,
      topicId,
      status: ResearchMissionStatus.EXECUTING,
      progress: 10,
      phase: "executing",
      message: `规划已确认，开始执行 ${tasks.length} 个任务`,
      completedTasks: 0,
      totalTasks: tasks.length,
    });

    this.logger.log(
      `[approvePlanAndExecute] Mission ${missionId} approved, starting execution with ${tasks.length} tasks`,
    );

    // 启动异步任务执行（确保 BillingContext 传播到 fire-and-forget 链）
    const existingCtx = BillingContext.get();
    const startFn = () =>
      this.executionService.startExecution(missionId, topicId);
    const wrappedStart = existingCtx
      ? () => BillingContext.run(existingCtx, startFn)
      : async () => {
          // 当从 controller 直接调用 approvePlanAndExecute 时，需要查询 userId
          const topic = await this.prisma.researchTopic.findUnique({
            where: { id: topicId },
            select: { userId: true },
          });
          if (topic?.userId) {
            return BillingContext.run(
              {
                userId: topic.userId,
                moduleType: "topic-insights",
                operationType: "research",
                referenceId: topicId,
              },
              startFn,
            );
          }
          return startFn();
        };
    void wrappedStart().catch((err: unknown) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[approvePlanAndExecute] Execution failed: ${errorMsg}`,
      );
      // Orphan cleanup: mark mission FAILED and cancel pending tasks/todos
      void this.prisma.researchMission
        .update({
          where: { id: missionId },
          data: { status: ResearchMissionStatus.FAILED },
        })
        .catch((updateErr: unknown) => {
          this.logger.error(
            `[approvePlanAndExecute] Failed to mark mission FAILED: ${updateErr}`,
          );
        });
      void this.prisma.researchTask
        .updateMany({
          where: {
            missionId,
            status: {
              notIn: [ResearchTaskStatus.COMPLETED, ResearchTaskStatus.FAILED],
            },
          },
          data: { status: ResearchTaskStatus.FAILED },
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `[approvePlanAndExecute] Non-critical operation failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      void this.prisma.researchTodo
        .updateMany({
          where: {
            missionId,
            status: {
              notIn: [
                ResearchTodoStatus.COMPLETED,
                ResearchTodoStatus.CANCELLED,
              ],
            },
          },
          data: {
            status: ResearchTodoStatus.CANCELLED,
            statusMessage: "执行启动失败",
            completedAt: new Date(),
          },
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `[approvePlanAndExecute] Non-critical operation failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    });
  }

  /**
   * 根据 Leader 规划创建任务
   * ★ 重要：会将 Leader 规划的维度同步到 TopicDimension 表
   * @param completedTasks 增量模式下已完成的任务（完整数据），会复制到新 Mission
   */
  async createTasksFromPlan(
    missionId: string,
    topicId: string,
    plan: LeaderPlan,
    completedTasks: CompletedTaskData[] = [],
  ): Promise<ResearchTask[]> {
    const tasks: ResearchTask[] = [];
    const completedSet = new Set(completedTasks.map((t) => t.dimensionName));

    // ★ 首先：将 Leader 规划的维度同步到数据库
    // 这确保执行时 topic.dimensions 能正确加载
    this.logger.log(
      `[createTasksFromPlan] Syncing ${plan.dimensions.length} planned dimensions to DB`,
    );

    // 获取当前最大 sortOrder
    const maxDimension = await this.prisma.topicDimension.findFirst({
      where: { topicId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    let sortOrder = (maxDimension?.sortOrder || 0) + 1;

    // 创建维度记录并建立映射 (plannedDimensionId -> dbDimensionId)
    const dimensionIdMap = new Map<string, string>();

    // ★ 修复 N+1 查询：批量查询当前 mission 已存在的维度
    //   严格按 (topicId, missionId) 隔离，与 topic-team-orchestrator 一致；
    //   旧 mission 的同名 dim 不会被误复用。
    const plannedDimensionNames = plan.dimensions.map((d) => d.name);
    const existingDimensions = await this.prisma.topicDimension.findMany({
      where: {
        topicId,
        missionId,
        name: { in: plannedDimensionNames },
      },
    });
    const existingDimMap = new Map(existingDimensions.map((d) => [d.name, d]));

    // P0 fix (2026-05-05): 同名 dim 在 plan.dimensions 内重复时撞 unique
    //   (mission_id, name) 约束。leader plan 偶发返回同名 dim（例如两个
    //   "测量方法与指标体系"），原代码只查 DB existingDimMap，漏了"循环内
    //   已 create 过"的去重 → 第二条 create 报 P2002。
    //   本轮 fix: 循环内累积 createdNamesInLoop，重名跳过+复用 id。
    const createdNamesInLoop = new Map<string, string>(); // name → dbId

    for (const plannedDim of plan.dimensions) {
      // 检查当前 mission 内是否已存在同名维度
      const existingDim = existingDimMap.get(plannedDim.name);
      const alreadyCreatedId = createdNamesInLoop.get(plannedDim.name);

      if (existingDim) {
        dimensionIdMap.set(plannedDim.id, existingDim.id);
        this.logger.log(
          `[createTasksFromPlan] Reusing existing dimension: ${plannedDim.name} (${existingDim.id})`,
        );
      } else if (alreadyCreatedId) {
        // ★ plan 内重名 → 复用本轮创建的，跳过重复 create
        dimensionIdMap.set(plannedDim.id, alreadyCreatedId);
        this.logger.warn(
          `[createTasksFromPlan] Plan duplicate dimension name "${plannedDim.name}" — reusing previously-created id ${alreadyCreatedId}`,
        );
      } else {
        const newDim = await this.prisma.topicDimension.create({
          data: {
            topicId,
            missionId,
            name: plannedDim.name,
            description: plannedDim.description,
            sortOrder: sortOrder++,
            status: "PENDING",
            // ★ 保存 Leader 规划的搜索配置
            searchQueries: plannedDim.searchQueries || [],
            searchSources: plannedDim.dataSources || ["web"],
          },
        });
        dimensionIdMap.set(plannedDim.id, newDim.id);
        createdNamesInLoop.set(plannedDim.name, newDim.id);
        this.logger.log(
          `[createTasksFromPlan] Created dimension: ${plannedDim.name} (${newDim.id}, mission=${missionId}) with sources: ${(plannedDim.dataSources || ["web"]).join(", ")}`,
        );
      }
    }

    // ★ 增量模式：首先复制已完成的任务到新 Mission
    if (completedTasks.length > 0) {
      this.logger.log(
        `[createTasksFromPlan] Incremental mode: copying ${completedTasks.length} completed tasks: ${[...completedSet].join(", ")}`,
      );

      // ★ 修复 N+1 查询：批量查询所有需要的维度
      const completedDimensionNames = completedTasks.map(
        (t) => t.dimensionName,
      );
      const dimensionsForCompleted = await this.prisma.topicDimension.findMany({
        where: {
          topicId,
          name: { in: completedDimensionNames },
        },
      });
      const dimensionNameToIdMap = new Map(
        dimensionsForCompleted.map((d) => [d.name, d.id]),
      );

      // ★ 使用 createMany 批量创建任务（性能优化）
      const tasksToCreate = completedTasks.map((completedTask) => ({
        missionId,
        title: completedTask.title,
        description: completedTask.description,
        taskType: "dimension_research",
        dimensionName: completedTask.dimensionName,
        dimensionId:
          dimensionNameToIdMap.get(completedTask.dimensionName) ||
          completedTask.dimensionId,
        assignedAgent: completedTask.assignedAgent,
        assignedAgentType: completedTask.assignedAgentType,
        modelId: completedTask.modelId, // ★ 保存使用的模型 ID
        priority: completedTask.priority,
        status: ResearchTaskStatus.COMPLETED, // ★ 标记为已完成
        result: completedTask.result ?? undefined,
        resultSummary: completedTask.resultSummary,
        startedAt: completedTask.startedAt,
        completedAt: completedTask.completedAt,
      }));

      // ★ 批量创建任务
      await this.prisma.researchTask.createMany({
        data: tasksToCreate,
      });

      // ★ 查询刚创建的任务以返回完整数据
      const copiedTasks = await this.prisma.researchTask.findMany({
        where: {
          missionId,
          status: ResearchTaskStatus.COMPLETED,
          dimensionName: { in: completedDimensionNames },
        },
      });
      tasks.push(...copiedTasks);

      this.logger.log(
        `[createTasksFromPlan] Copied ${copiedTasks.length} completed tasks in batch`,
      );
    }

    // 1. 为每个维度创建研究任务（跳过已完成的）
    for (const dimension of plan.dimensions) {
      // ★ 增量模式：跳过已完成的维度（已在上面复制）
      if (completedSet.has(dimension.name)) {
        this.logger.log(
          `[createTasksFromPlan] Skipping dimension (already copied): ${dimension.name}`,
        );
        continue;
      }

      const assignment = plan.agentAssignments.find(
        (a) =>
          a.agentType === "dimension_researcher" &&
          a.assignedDimensions?.includes(dimension.id),
      );

      const dbDimensionId = dimensionIdMap.get(dimension.id);

      const task = await this.prisma.researchTask.create({
        data: {
          missionId,
          title: `研究: ${dimension.name}`,
          description: dimension.description,
          taskType: "dimension_research",
          dimensionName: dimension.name,
          dimensionId: dbDimensionId, // ★ 关联真实的数据库维度 ID
          assignedAgent: assignment?.agentId || "researcher_default",
          assignedAgentType: "dimension_researcher",
          modelId: assignment?.modelId, // ★ 保存 Agent 使用的模型 ID
          skills: assignment?.skills || [], // ★ 保存 Leader 分配的技能
          tools: assignment?.tools || [], // ★ 保存 Leader 分配的工具
          priority: dimension.priority,
          status: ResearchTaskStatus.PENDING,
        },
      });
      tasks.push(task);
    }

    // 2. 创建质量审核任务（依赖所有研究任务）
    const reviewerAssignment = plan.agentAssignments.find(
      (a) => a.agentType === "quality_reviewer",
    );
    const reviewTask = await this.prisma.researchTask.create({
      data: {
        missionId,
        title: "质量审核",
        description: "审核所有维度研究结果的质量",
        taskType: "quality_review",
        assignedAgent: reviewerAssignment?.agentId || "reviewer_default",
        assignedAgentType: "quality_reviewer",
        modelId: reviewerAssignment?.modelId, // ★ 保存审核员使用的模型 ID
        skills: reviewerAssignment?.skills || [], // ★ 保存 Leader 分配的技能
        tools: reviewerAssignment?.tools || [], // ★ 保存 Leader 分配的工具
        priority: TASK_PRIORITY.QUALITY_REVIEW,
        dependencies: tasks.map((t) => t.id),
        status: ResearchTaskStatus.PENDING,
      },
    });
    tasks.push(reviewTask);

    // 3. 创建报告撰写任务（依赖审核任务）
    const writerAssignment = plan.agentAssignments.find(
      (a) => a.agentType === "report_writer",
    );
    const writeTask = await this.prisma.researchTask.create({
      data: {
        missionId,
        title: "报告撰写",
        description: "整合研究结果，生成最终报告",
        taskType: "report_synthesis",
        assignedAgent: writerAssignment?.agentId || "writer_default",
        assignedAgentType: "report_writer",
        modelId: writerAssignment?.modelId, // ★ 保存撰写员使用的模型 ID
        skills: writerAssignment?.skills || [], // ★ 保存 Leader 分配的技能
        tools: writerAssignment?.tools || [], // ★ 保存 Leader 分配的工具
        priority: TASK_PRIORITY.REPORT_SYNTHESIS,
        dependencies: [reviewTask.id],
        status: ResearchTaskStatus.PENDING,
      },
    });
    tasks.push(writeTask);

    return tasks;
  }

  /**
   * 重试失败的任务
   */
  async retryTask(taskId: string): Promise<ResearchTask> {
    const task = await this.prisma.researchTask.findUnique({
      where: { id: taskId },
      include: { mission: true },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    if (
      task.status !== ResearchTaskStatus.FAILED &&
      task.status !== ResearchTaskStatus.NEEDS_REVISION
    ) {
      throw new BadRequestException(
        `Task ${taskId} is not in a retryable state`,
      );
    }

    // ★ Reset task to PENDING
    const updatedTask = await this.prisma.researchTask.update({
      where: { id: taskId },
      data: {
        status: ResearchTaskStatus.PENDING,
        revisionCount: { increment: 1 },
        startedAt: null,
        completedAt: null,
        result: undefined,
        resultSummary: null,
      },
    });

    // ★ If mission is not EXECUTING (e.g., FAILED/COMPLETED), resume it
    // and trigger re-execution so the scheduler picks up the PENDING task
    if (
      task.mission &&
      task.mission.status !== ResearchMissionStatus.EXECUTING
    ) {
      this.logger.log(
        `[retryTask] Mission ${task.mission.id} is ${task.mission.status}, resuming to EXECUTING`,
      );
      await this.prisma.researchMission.update({
        where: { id: task.mission.id },
        data: {
          status: ResearchMissionStatus.EXECUTING,
          startedAt: new Date(),
          completedAt: null,
        },
      });

      // ★ Fire-and-forget: trigger mission re-execution
      void this.executionService
        .startExecution(task.mission.id, task.mission.topicId)
        .catch((err: unknown) => {
          this.logger.error(
            `[retryTask] Failed to restart execution: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    return updatedTask;
  }

  /**
   * 重试整个 Mission
   */
  async retryMission(missionId: string): Promise<ResearchMission> {
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
    });

    if (!mission) {
      throw new NotFoundException(`Mission ${missionId} not found`);
    }

    // 验证状态转移: FAILED/CANCELLED → EXECUTING
    this.missionStateValidator.assertTransition(
      mission.status,
      ResearchMissionStatus.EXECUTING,
    );

    // ★ 并发安全：原子 CAS，只允许从已知终态转到 EXECUTING。
    // 两次并发 retry 只会有一次赢得转换。
    const claim = await this.prisma.researchMission.updateMany({
      where: {
        id: missionId,
        status: {
          in: [
            ResearchMissionStatus.FAILED,
            ResearchMissionStatus.CANCELLED,
            ResearchMissionStatus.COMPLETED,
          ],
        },
      },
      data: {
        status: ResearchMissionStatus.EXECUTING,
        startedAt: new Date(),
        completedAt: null,
      },
    });

    if (claim.count === 0) {
      // 已被另一并发 retry 占用，或当前不是可重试状态（assertTransition 之后仍可能因并发变化）
      this.logger.warn(
        `[retryMission] Skipped duplicate retry for mission ${missionId}. ` +
          `Another concurrent call already owns execution.`,
      );
      // 返回当前状态给调用方，而非抛错，以便调用方幂等处理
      return this.prisma.researchMission.findUniqueOrThrow({
        where: { id: missionId },
      });
    }

    // 重置所有失败的任务（只有 CAS 赢家才会执行到此）
    await this.prisma.researchTask.updateMany({
      where: {
        missionId,
        status: {
          in: [ResearchTaskStatus.FAILED, ResearchTaskStatus.NEEDS_REVISION],
        },
      },
      data: {
        status: ResearchTaskStatus.PENDING,
        startedAt: null,
        completedAt: null,
      },
    });

    return this.prisma.researchMission.findUniqueOrThrow({
      where: { id: missionId },
    });
  }

  /**
   * 调整 Mission 执行策略
   */
  async adjustMission(
    userId: string,
    missionId: string,
    adjustment: {
      addDimensions?: Array<{ name: string; description: string }>;
      removeDimensions?: string[];
      focusAreas?: string[];
    },
  ): Promise<ResearchMission> {
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      include: { tasks: true, topic: { select: { userId: true } } },
    });

    if (!mission) {
      throw new NotFoundException(`Mission ${missionId} not found`);
    }

    // 验证用户权限
    if (mission.topic.userId !== userId) {
      throw new ForbiddenException(
        "You do not have permission to adjust this mission",
      );
    }

    // 只允许在执行中的 Mission 进行调整
    if (mission.status !== ResearchMissionStatus.EXECUTING) {
      throw new BadRequestException(
        `Cannot adjust mission in ${mission.status} status. Only EXECUTING missions can be adjusted.`,
      );
    }

    const changes: string[] = [];

    // 1. 添加新维度
    if (adjustment.addDimensions?.length) {
      for (const dim of adjustment.addDimensions) {
        await this.prisma.researchTask.create({
          data: {
            missionId,
            title: `研究: ${dim.name}`,
            description: dim.description,
            taskType: "dimension_research",
            dimensionName: dim.name,
            assignedAgent: "researcher_dynamic",
            assignedAgentType: "dimension_researcher",
            priority: TASK_PRIORITY.DIMENSION_RESEARCH_DYNAMIC,
            status: ResearchTaskStatus.PENDING,
          },
        });
        changes.push(`新增维度: ${dim.name}`);
      }

      // 更新总任务数
      await this.prisma.researchMission.update({
        where: { id: missionId },
        data: {
          totalTasks: { increment: adjustment.addDimensions.length },
        },
      });
    }

    // 2. 移除维度（删除待处理的任务）
    if (adjustment.removeDimensions?.length) {
      for (const dimName of adjustment.removeDimensions) {
        const task = await this.prisma.researchTask.findFirst({
          where: {
            missionId,
            dimensionName: dimName,
            status: ResearchTaskStatus.PENDING,
          },
        });

        if (task) {
          // 删除待处理的任务
          await this.prisma.researchTask.delete({
            where: { id: task.id },
          });
          changes.push(`移除维度: ${dimName}`);
        }
      }
    }

    // 3. 调整聚焦领域（通知 Leader）
    if (adjustment.focusAreas?.length) {
      // 请求 Leader 重新评估任务优先级
      await this.leaderIntent.handleUserMessage(
        mission.topicId,
        missionId,
        `请调整研究重点，优先关注以下领域：${adjustment.focusAreas.join("、")}`,
      );
      changes.push(`调整聚焦: ${adjustment.focusAreas.join("、")}`);
    }

    // 4. 记录 Leader 决策
    await this.prisma.leaderDecision.create({
      data: {
        missionId,
        type: LeaderDecisionType.ADJUST,
        input: adjustment,
        decision: { changes },
        reasoning: `用户请求调整：${changes.join("；")}`,
      },
    });

    // 5. 发送进度事件
    this.queryService.emitProgress({
      missionId,
      topicId: mission.topicId,
      status: mission.status,
      progress: mission.progressPercent,
      phase: "adjusting",
      message: `已调整：${changes.join("、")}`,
      completedTasks: mission.completedTasks,
      totalTasks: mission.totalTasks + (adjustment.addDimensions?.length || 0),
    });

    // 返回更新后的 Mission
    return this.prisma.researchMission.findUniqueOrThrow({
      where: { id: missionId },
    });
  }

  /**
   * 取消 Mission
   */
  async cancelMission(
    userId: string,
    missionId: string,
  ): Promise<ResearchMission> {
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      include: { topic: { select: { userId: true, id: true } } },
    });

    if (!mission) {
      throw new NotFoundException(`Mission ${missionId} not found`);
    }

    // 验证用户权限（使用统一的权限检查）
    // PUBLIC 专题：任何登录用户都可以取消
    // SHARED 专题：协作者可以取消
    // PRIVATE 专题：仅所有者可以取消
    const hasAccess = await this.collaboratorService.hasAccess(
      mission.topic.id,
      userId,
      CollaboratorRole.EDITOR, // 取消任务需要 EDITOR 权限
    );

    if (!hasAccess) {
      throw new ForbiddenException(
        "You do not have permission to cancel this mission",
      );
    }

    // 幂等处理：如果已经取消，仍需确保 ResearchTask 和 ResearchTodo 状态一致
    if (mission.status === ResearchMissionStatus.CANCELLED) {
      this.logger.log(
        `[cancelMission] Mission ${missionId} already cancelled, ensuring task & todo status consistency`,
      );
      // ★ 确保 ResearchTask 也被更新（修复旧代码遗留的数据）
      const fixedTasksResult = await this.prisma.researchTask.updateMany({
        where: {
          missionId,
          status: {
            in: [
              ResearchTaskStatus.PENDING,
              ResearchTaskStatus.ASSIGNED,
              ResearchTaskStatus.EXECUTING,
            ],
          },
        },
        data: {
          status: ResearchTaskStatus.FAILED,
          resultSummary: "任务已被用户取消",
          completedAt: new Date(),
        },
      });
      this.logger.log(
        `[cancelMission] Fixed ${fixedTasksResult.count} stale tasks in idempotent cancel`,
      );

      // ★ 确保 ResearchTodo 也被更新（修复旧代码遗留的数据）
      const fixedTodosResult = await this.prisma.researchTodo.updateMany({
        where: {
          missionId,
          status: {
            in: [
              ResearchTodoStatus.PENDING,
              ResearchTodoStatus.QUEUED,
              ResearchTodoStatus.IN_PROGRESS,
            ],
          },
        },
        data: {
          status: ResearchTodoStatus.CANCELLED,
          statusMessage: "任务已被用户取消",
          completedAt: new Date(),
        },
      });
      this.logger.log(
        `[cancelMission] Fixed ${fixedTodosResult.count} stale todos in idempotent cancel`,
      );

      return mission;
    }

    // 验证状态转移: current → CANCELLED
    this.missionStateValidator.assertTransition(
      mission.status,
      ResearchMissionStatus.CANCELLED,
    );

    // ★ 取消所有未完成的任务（PENDING、ASSIGNED 或 EXECUTING 状态）
    const cancelledTasksResult = await this.prisma.researchTask.updateMany({
      where: {
        missionId,
        status: {
          in: [
            ResearchTaskStatus.PENDING,
            ResearchTaskStatus.ASSIGNED,
            ResearchTaskStatus.EXECUTING,
          ],
        },
      },
      data: {
        status: ResearchTaskStatus.FAILED,
        resultSummary: "任务已被用户取消",
        completedAt: new Date(),
      },
    });

    this.logger.log(
      `[cancelMission] Cancelled ${cancelledTasksResult.count} pending/executing tasks`,
    );

    // ★ 同步更新 ResearchTodo 表（前端显示的任务列表来自这里）
    const cancelledTodosResult = await this.prisma.researchTodo.updateMany({
      where: {
        missionId,
        status: {
          in: [
            ResearchTodoStatus.PENDING,
            ResearchTodoStatus.QUEUED,
            ResearchTodoStatus.IN_PROGRESS,
          ],
        },
      },
      data: {
        status: ResearchTodoStatus.CANCELLED,
        statusMessage: "任务已被用户取消",
        completedAt: new Date(),
      },
    });

    this.logger.log(
      `[cancelMission] Cancelled ${cancelledTodosResult.count} pending/queued/in_progress todos`,
    );

    // ★ 清理该任务创建的空草稿报告（没有 dimensionAnalyses 的报告）
    const topicId = mission.topicId;
    const emptyDraftReports = await this.prisma.topicReport.findMany({
      where: {
        topicId,
        dimensionAnalyses: { none: {} }, // 没有任何维度分析
      },
      select: { id: true },
    });

    if (emptyDraftReports.length > 0) {
      const deleteIds = emptyDraftReports.map((r) => r.id);
      await this.prisma.topicReport.deleteMany({
        where: { id: { in: deleteIds } },
      });
      this.logger.log(
        `[cancelMission] Cleaned up ${deleteIds.length} empty draft reports`,
      );
    }

    // ★ 发送取消事件通知前端
    this.queryService.emitProgress({
      missionId,
      topicId,
      status: ResearchMissionStatus.CANCELLED,
      progress: 0,
      phase: "cancelled",
      message: "研究任务已取消",
      completedTasks: 0,
      totalTasks: mission.totalTasks,
    });

    return this.prisma.researchMission.update({
      where: { id: missionId },
      data: { status: ResearchMissionStatus.CANCELLED },
    });
  }
}
