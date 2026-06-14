import {
  Injectable,
  Logger,
  Optional,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { AgentFacade } from "@/modules/ai-harness/facade";
import {
  EvalPipelineService,
  SessionLatencyTrackerService,
  type LatencySessionSummary,
} from "@/modules/ai-harness/facade";
import { MissionContext } from "@/modules/ai-harness/facade";
import { RESEARCH_INTERNAL_EVENTS } from "../research/research-event-emitter.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  DimensionStatus,
  RefreshLogStatus,
  ResearchMissionStatus,
  ResearchTaskStatus,
  ResearchTopicStatus,
  ResearchTodoStatus,
  ResearchTodoType,
} from "@prisma/client";
import type {
  ResearchTopic,
  TopicDimension,
  TopicReport,
} from "@prisma/client";
import { DimensionMissionService } from "../../dimension/dimension-mission.service";
import { DataSourceRouterService } from "../../data/data-source-router.service";
import { ReportSynthesisService } from "../../report/report-synthesis.service";
import { ResearchReviewerService } from "../../collaboration/research-reviewer.service";
import { ResearchLeaderService } from "../research/research-leader.service";
import { type AgentAssignment } from "../../../types/leader.types";
import { ResearchCheckpointService } from "../../monitoring/research-checkpoint.service";
import { ResearchTodoService } from "../../collaboration/research-todo.service";
import type { DimensionAnalysisResult } from "../../../types/research.types";
import {
  type ResearchDepth,
  type ResearchDesign,
  resolveResearchDepthConfig,
} from "../../../types/research-depth.types";
import { buildValidationContextForWriting } from "../../../prompts/research-depth.prompt";

/**
 * Refresh Progress Event
 */
export interface RefreshProgressEvent {
  topicId: string;
  reportId: string;
  phase:
    | "starting"
    | "researching"
    | "reviewing"
    | "synthesizing"
    | "completed"
    | "failed";
  progress: number; // 0-100
  currentDimension?: string;
  completedDimensions: number;
  totalDimensions: number;
  message: string;
  error?: string;
}

/**
 * Refresh Options
 */
export interface RefreshOptions {
  /** 是否强制刷新所有维度 */
  forceRefresh?: boolean;
  /** 仅刷新指定维度 */
  dimensionIds?: string[];
  /** 是否增量刷新 */
  incremental?: boolean;
  /** V5: 研究深度 */
  researchDepth?: ResearchDepth;
}

/**
 * Topic Team Orchestrator Service
 *
 * 协调主题研究的整个流程：
 * 1. 并行执行所有维度的研究
 * 2. 汇总研究结果
 * 3. 生成最终报告
 * 4. 发送进度事件
 */
@Injectable()
export class TopicTeamOrchestratorService {
  private readonly logger = new Logger(TopicTeamOrchestratorService.name);

  // 存储活跃的刷新任务
  private activeRefreshes = new Map<
    string,
    {
      abortController: AbortController;
      startedAt: Date;
    }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dimensionMissionService: DimensionMissionService,
    private readonly reportSynthesisService: ReportSynthesisService,
    private readonly researchReviewerService: ResearchReviewerService,
    private readonly researchLeaderService: ResearchLeaderService,
    private readonly researchCheckpointService: ResearchCheckpointService,
    private readonly dataSourceRouterService: DataSourceRouterService,
    private readonly researchTodoService: ResearchTodoService,
    @Optional() private readonly agentFacade?: AgentFacade,
    // ★ Batch 2: 自动化质量评估
    @Optional() private readonly evalPipeline?: EvalPipelineService,
    // ★ 会话级时延跟踪
    @Optional()
    private readonly latencyTracker?: SessionLatencyTrackerService,
  ) {}

  /**
   * 执行完整的主题刷新
   */
  async executeRefresh(
    topic: ResearchTopic,
    options: RefreshOptions = {},
  ): Promise<TopicReport> {
    const topicId = topic.id;
    this.logger.log(`Starting refresh for topic: ${topic.name} (${topicId})`);

    // 检查是否有活跃的刷新任务
    if (this.activeRefreshes.has(topicId)) {
      throw new ConflictException(
        `Refresh already in progress for topic ${topicId}`,
      );
    }

    // 创建 AbortController
    const abortController = new AbortController();
    this.activeRefreshes.set(topicId, {
      abortController,
      startedAt: new Date(),
    });

    // 创建刷新日志
    const refreshLog = await this.prisma.topicRefreshLog.create({
      data: {
        topicId,
        triggerType: "manual",
        status: RefreshLogStatus.RUNNING,
      },
    });

    // ★ v4: 清空全局 URL 抓取缓存，确保每次报告生成从干净状态开始
    this.dimensionMissionService.clearEvidenceCache();

    // ★ 时延跟踪：开始会话
    const latencySessionId = this.latencyTracker?.startSession({
      type: "topic_insights_refresh",
      entityId: topicId,
      userId: topic.userId,
      metadata: { topicName: topic.name, researchDepth: options.researchDepth },
    });

    // ★ 设置 MissionContext 以便嵌套的 AiChatService 调用能自动归属到此时延会话
    // 2026-05-11: agentProcessId omitted — topic-insights doesn't spawn a kernel
    // AgentProcess (no missionExecutor.execute call), so leave the FK-bound slot
    // empty. Latency session ID + userId is enough for the downstream consumers.
    return MissionContext.run(
      {
        userId: topic.userId,
        latencySessionId,
      },
      () =>
        this.executeRefreshBody(
          topic,
          options,
          abortController,
          refreshLog,
          latencySessionId,
        ),
    );
  }

  /**
   * executeRefresh 的核心执行体（在 MissionContext 中运行）
   */
  private async executeRefreshBody(
    topic: ResearchTopic,
    options: RefreshOptions,
    abortController: AbortController,
    refreshLog: { id: string },
    latencySessionId: string | undefined,
  ): Promise<TopicReport> {
    const topicId = topic.id;
    let missionId: string | undefined;
    let traceId: string | undefined;
    let reportId: string | undefined;
    let latencySummary: LatencySessionSummary | undefined;

    try {
      // ★ 时延跟踪：初始化阶段
      if (latencySessionId) {
        this.latencyTracker?.startPhase(latencySessionId, {
          name: "initialization",
        });
      }

      // ★ 把卡在中间状态的旧 mission mark 为 FAILED，并 disable 它自己创建的
      //   dim（按 missionId 反查），避免下次"开始"读到旧 mission 自创的 dim。
      //   注意：missionId IS NULL 的"模板 dim"（用户手动 addDimension /
      //   topic 创建时落库）不动，跨 mission 持久存在。
      const stuckLast = await this.prisma.researchMission.findFirst({
        where: {
          topicId,
          status: {
            in: [
              ResearchMissionStatus.PLANNING,
              ResearchMissionStatus.PLAN_READY,
              ResearchMissionStatus.EXECUTING,
              ResearchMissionStatus.REVIEWING,
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true },
      });
      if (stuckLast) {
        await this.prisma.researchMission.update({
          where: { id: stuckLast.id },
          data: { status: ResearchMissionStatus.FAILED },
        });
        const disabled = await this.prisma.topicDimension.updateMany({
          where: { missionId: stuckLast.id, isEnabled: true },
          data: { isEnabled: false },
        });
        this.logger.log(
          `[executeRefresh] Marked stuck mission ${stuckLast.id} (was ${stuckLast.status}) as FAILED + disabled ${disabled.count} of its own dims`,
        );
      }

      // 1. 创建草稿报告
      const report =
        await this.reportSynthesisService.createDraftReport(topicId);
      reportId = report.id;

      // V5: Resolve research depth config
      const researchDepth: ResearchDepth = options.researchDepth || "standard";
      const depthConfig = resolveResearchDepthConfig(researchDepth);
      this.logger.log(
        `[executeRefresh] V5 depth: ${researchDepth} (cognitiveLoops=${depthConfig.maxCognitiveLoops}, revisions=${depthConfig.maxRevisionRounds})`,
      );

      // ★ TraceCollector: start trace for this research mission
      traceId = this.agentFacade?.startTrace({
        name: `AI Insights: ${topic.name}`,
        type: "research_mission",
        metadata: {
          topicId,
          reportId: report.id,
          researchDepth,
          cognitiveLoops: depthConfig.maxCognitiveLoops,
        },
      });

      // 发送开始事件
      this.emitProgress({
        topicId,
        reportId: report.id,
        phase: "starting",
        progress: 0,
        completedDimensions: 0,
        totalDimensions: 0,
        message: "正在初始化研究...",
      });

      // ★ 提前创建 Mission（status=PLANNING）—— dim 严格按 missionId 隔离，
      //   要先有 mission 才能落 dim。
      const mission = await this.prisma.researchMission.create({
        data: {
          topicId,
          status: ResearchMissionStatus.PLANNING,
          researchDepth: options.researchDepth || "standard",
          totalTasks: 0, // 规划完毕后再回填
        },
      });
      missionId = mission.id;

      // 2. 获取要研究的维度（严格按 missionId 隔离 → 新 mission 必为 0 条）
      let dimensions = await this.getDimensionsToResearch(
        topicId,
        missionId,
        options,
      );
      // ★ 保存 Leader 的 Agent 分配信息（包含工具和技能）
      let agentAssignments: AgentAssignment[] = [];
      // ★ 保存执行策略的并行度设置
      let parallelism = 4; // Default parallelism

      // ★ 时延跟踪：结束初始化，开始 leader_planning
      if (latencySessionId) {
        this.latencyTracker?.endPhaseByName(latencySessionId, "initialization");
        this.latencyTracker?.startPhase(latencySessionId, {
          name: "leader_planning",
        });
      }

      // ★ v8.0: 如果没有维度，由 Leader AI 动态规划
      if (dimensions.length === 0) {
        this.logger.log(
          `[executeRefresh] No dimensions found, invoking Leader AI to plan dimensions for topic: ${topic.name}`,
        );

        this.emitProgress({
          topicId,
          reportId: report.id,
          phase: "starting",
          progress: 2,
          completedDimensions: 0,
          totalDimensions: 0,
          message: "Leader AI 正在根据主题智能规划研究维度...",
        });

        // 调用 Leader 规划
        const leaderPlanSpanId = traceId
          ? this.agentFacade?.addSpan(traceId, {
              name: "Leader AI Planning",
              type: "planning",
              metadata: { topicId },
            })
          : undefined;
        let leaderPlan: Awaited<
          ReturnType<typeof this.researchLeaderService.planResearch>
        >;
        try {
          leaderPlan = await this.researchLeaderService.planResearch(topicId);
          if (leaderPlanSpanId) {
            this.agentFacade?.endSpan(leaderPlanSpanId, {
              status: "success",
              output: {
                dimensionsPlanned: leaderPlan.dimensions?.length ?? 0,
                agentsAssigned: leaderPlan.agentAssignments?.length ?? 0,
              },
            });
          }
        } catch (planErr) {
          if (leaderPlanSpanId) {
            this.agentFacade?.endSpan(leaderPlanSpanId, {
              status: "error",
              error: String(planErr),
            });
          }
          throw planErr;
        }

        if (!leaderPlan.dimensions || leaderPlan.dimensions.length === 0) {
          throw new InternalServerErrorException(
            "Leader AI failed to plan dimensions",
          );
        }

        this.logger.log(
          `[executeRefresh] Leader planned ${leaderPlan.dimensions.length} dimensions: ${leaderPlan.dimensions.map((d) => d.name).join(", ")}`,
        );

        // ★ 保存 Agent 分配信息（用于后续传递工具和技能）
        agentAssignments = leaderPlan.agentAssignments || [];
        if (agentAssignments.length > 0) {
          this.logger.log(
            `[executeRefresh] Leader assigned ${agentAssignments.length} agents with tools: ${agentAssignments.map((a) => `${a.agentId}:[${(a.tools || []).join(",")}]`).join("; ")}`,
          );
        }

        // ★ 提取并行度设置
        if (leaderPlan.executionStrategy?.parallelism) {
          parallelism = leaderPlan.executionStrategy.parallelism;
          this.logger.log(
            `[executeRefresh] Using leader plan parallelism: ${parallelism}`,
          );
        }

        // ★ 应用层去重：LLM 规划时偶尔会吐出同名维度（深度 thorough 时
        //   18+ 维度尤其容易出现"通用版 + 特化版"重名）。落库前按
        //   归一化 name 去重，保留首次出现，丢弃后续重名。
        const seenNames = new Set<string>();
        const dedupedDims: typeof leaderPlan.dimensions = [];
        const droppedNames: string[] = [];
        for (const dim of leaderPlan.dimensions) {
          const key = (dim.name ?? "").trim().toLowerCase();
          if (!key) {
            continue;
          }
          if (seenNames.has(key)) {
            droppedNames.push(dim.name);
            continue;
          }
          seenNames.add(key);
          dedupedDims.push(dim);
        }
        if (droppedNames.length > 0) {
          this.logger.warn(
            `[executeRefresh] Leader plan contained ${droppedNames.length} duplicate dim name(s), dropped: ${droppedNames.join(" / ")}`,
          );
        }

        // 将规划的维度保存到数据库（绑定到当前 mission，保证隔离）
        const createdDimensions = await Promise.all(
          dedupedDims.map((dim, index) =>
            this.prisma.topicDimension.create({
              data: {
                topicId,
                missionId,
                name: dim.name,
                description: dim.description,
                sortOrder: dim.priority ?? index + 1,
                searchQueries: dim.searchQueries || [],
                searchSources: dim.dataSources || [],
                minSources: 5,
                isEnabled: true,
                status: DimensionStatus.PENDING,
              },
            }),
          ),
        );

        dimensions = createdDimensions;
        this.logger.log(
          `[executeRefresh] Created ${dimensions.length} dimensions from Leader plan (after dedup: ${droppedNames.length} dropped)`,
        );
      }

      // 发送研究开始事件
      this.emitProgress({
        topicId,
        reportId: report.id,
        phase: "researching",
        progress: 5,
        completedDimensions: 0,
        totalDimensions: dimensions.length,
        message: `开始研究 ${dimensions.length} 个维度...`,
      });

      // ★ Mission 已在前面以 status=PLANNING 创建；此处切到 EXECUTING +
      //   回填任务总数 + startedAt
      const todoMap: Record<string, string> = {}; // dimensionId -> todoId
      let reportTodoId: string | undefined;
      let reviewTodoId: string | undefined;
      try {
        // ★ 此时 missionId 已被赋值（mission 已创建），固化非空局部变量
        const mid: string = missionId;
        await this.prisma.researchMission.update({
          where: { id: mid },
          data: {
            status: ResearchMissionStatus.EXECUTING,
            totalTasks: dimensions.length + 2,
            startedAt: new Date(),
          },
        });

        // ★ 创建 ResearchTask 记录（前端 TopicTeamPanel 读取这些来展示 agent 列表）
        // Leader task
        await this.prisma.researchTask.create({
          data: {
            missionId: mid,
            title: "研究协调与规划",
            description: "协调各维度研究，制定研究策略",
            taskType: "leader_planning",
            assignedAgent: "Leader",
            status: ResearchTaskStatus.COMPLETED,
            progress: 100,
            priority: 1000,
          },
        });
        // Dimension research tasks
        try {
          await this.prisma.researchTask.createMany({
            data: dimensions.map((dim) => ({
              missionId: mid,
              title: `研究：${dim.name}`,
              description: dim.description || `深度研究 ${dim.name}`,
              taskType: "dimension_research",
              dimensionId: dim.id,
              dimensionName: dim.name,
              assignedAgent: `Researcher-${dim.name}`,
              status: ResearchTaskStatus.PENDING,
              progress: 0,
              priority: 500,
            })),
          });
        } catch (dimErr) {
          this.logger.warn(
            `[initializeMission] Failed to create dimension tasks: ${dimErr instanceof Error ? dimErr.message : String(dimErr)}`,
          );
        }
        // Report synthesis task
        await this.prisma.researchTask.create({
          data: {
            missionId: mid,
            title: "合成研究报告",
            description: "整合所有维度分析，生成最终研究报告",
            taskType: "report_synthesis",
            assignedAgent: "Synthesizer",
            status: ResearchTaskStatus.PENDING,
            priority: 200,
          },
        });
        // Quality review task
        await this.prisma.researchTask.create({
          data: {
            missionId: mid,
            title: "质量审核",
            description: "审核研究质量，验证关键发现",
            taskType: "quality_review",
            assignedAgent: "Reviewer",
            status: ResearchTaskStatus.PENDING,
            priority: 100,
          },
        });

        // Leader 规划 TODO（已完成）
        const leaderTodo = await this.researchTodoService.createTodo({
          topicId,
          missionId: mid,
          type: ResearchTodoType.LEADER_PLANNING,
          title: "Leader 任务理解与规划",
          description: "Leader 分析研究主题，制定研究策略和任务分配",
          agentId: "leader",
          agentName: "研究协调员",
          agentRole: "leader",
          priority: 1000,
          userCanPause: false,
          userCanCancel: false,
        });
        await this.researchTodoService.completeTodo(leaderTodo.id);

        // 每个维度的研究 TODO
        for (const dim of dimensions) {
          // ★ 查找此维度对应的 Agent 分配，获取 modelId 和 assignmentReason
          const assignment = agentAssignments.find(
            (a) =>
              a.agentType === "dimension_researcher" &&
              a.assignedDimensions?.includes(dim.id),
          );

          const todo = await this.researchTodoService.createTodo({
            topicId,
            missionId: mid,
            type: ResearchTodoType.DIMENSION_RESEARCH,
            title: `研究维度：${dim.name}`,
            description: dim.description || `深度研究 ${dim.name} 维度`,
            dimensionId: dim.id,
            dimensionName: dim.name,
            agentId: assignment?.agentId || `researcher-${dim.id}`,
            agentName: assignment?.agentName || "研究员",
            agentRole: "researcher",
            modelId: assignment?.modelId,
            assignmentReason: assignment?.assignmentReason || {
              agentReason: `研究员专注于「${dim.name}」领域的深度信息收集和分析`,
              modelReason: assignment?.modelId
                ? `选择 ${assignment.modelId} 模型进行研究任务`
                : "使用擅长信息检索和内容分析的模型",
            },
            priority: 500,
          });
          todoMap[dim.id] = todo.id;
          await this.researchTodoService.updateTodoStatus(
            todo.id,
            ResearchTodoStatus.IN_PROGRESS,
            "研究中...",
          );
        }

        // ★ 查找报告撰写员分配
        const writerAssignment = agentAssignments.find(
          (a) => a.agentType === "report_writer",
        );
        // 报告撰写 TODO
        const rTodo = await this.researchTodoService.createTodo({
          topicId,
          missionId: mid,
          type: ResearchTodoType.REPORT_WRITING,
          title: "合成研究报告",
          description: "整合所有维度分析，生成最终研究报告",
          agentId: writerAssignment?.agentId || "synthesizer",
          agentName: writerAssignment?.agentName || "报告合成师",
          agentRole: "synthesizer",
          modelId: writerAssignment?.modelId,
          assignmentReason: writerAssignment?.assignmentReason || {
            agentReason:
              "综合撰写员擅长整合多维度研究成果，生成结构化的专业报告",
            modelReason: writerAssignment?.modelId
              ? `选择 ${writerAssignment.modelId} 模型进行报告撰写`
              : "使用具有强大语言生成和总结能力的模型",
          },
          priority: 200,
          dependsOn: Object.values(todoMap),
        });
        reportTodoId = rTodo.id;

        // ★ 查找质量审核员分配
        const reviewerAssignment = agentAssignments.find(
          (a) => a.agentType === "quality_reviewer",
        );
        // 质量审核 TODO
        const qTodo = await this.researchTodoService.createTodo({
          topicId,
          missionId: mid,
          type: ResearchTodoType.QUALITY_REVIEW,
          title: "质量审核",
          description: "审核研究质量，验证关键发现的可信度",
          agentId: reviewerAssignment?.agentId || "reviewer",
          agentName: reviewerAssignment?.agentName || "质量审核员",
          agentRole: "reviewer",
          modelId: reviewerAssignment?.modelId,
          assignmentReason: reviewerAssignment?.assignmentReason || {
            agentReason: "质量审核员专注于内容准确性、逻辑一致性和完整性检查",
            modelReason: reviewerAssignment?.modelId
              ? `选择 ${reviewerAssignment.modelId} 模型进行质量审核`
              : "使用擅长一致性检查和质量评估的模型",
          },
          priority: 100,
          dependsOn: [rTodo.id],
        });
        reviewTodoId = qTodo.id;

        this.logger.log(
          `[executeRefresh] Created mission ${mid} with ${Object.keys(todoMap).length + 3} todos`,
        );
      } catch (todoError) {
        this.logger.warn(
          `[executeRefresh] Failed to create todos (non-fatal): ${todoError}`,
        );
      }

      // V5: Research design extracted from global outline (populated after Phase 2)
      // V5: Validation context built from cognitive loop (used for future iterative rewriting)
      let validationContext = "";

      // V5: Literature baseline scan (standard/thorough only)
      if (depthConfig.knowledgeIterations >= 2) {
        this.logger.log(
          `[V5] Running literature baseline scan for ${dimensions.length} dimensions`,
        );
        try {
          await Promise.all(
            dimensions
              .slice(0, 3)
              .map((dim) =>
                this.dataSourceRouterService.scanLiteratureBaseline(topic, dim),
              ),
          );
          this.logger.log(`[V5] Literature baseline scan complete`);
        } catch (error) {
          this.logger.warn(
            `[V5] Literature baseline scan failed (non-fatal): ${error}`,
          );
        }
      }

      // ★ 时延跟踪：结束 leader_planning，开始 dimension_research
      if (latencySessionId) {
        this.latencyTracker?.endPhaseByName(
          latencySessionId,
          "leader_planning",
        );
        this.latencyTracker?.startPhase(latencySessionId, {
          name: "dimension_research",
          parallel: true,
          parallelCount: dimensions.length,
          metadata: {
            dimensionNames: dimensions.map((d) => d.name),
          },
        });
      }

      // 3. 并行执行维度研究（直接调用 DimensionMissionService）
      const analysisResults = await Promise.allSettled(
        dimensions.map(async (dimension) => {
          const assignment = agentAssignments.find(
            (a) =>
              a.assignedDimensions?.includes(dimension.id) ||
              a.assignedDimensions?.includes(dimension.name),
          );
          const result =
            await this.dimensionMissionService.executeDimensionMission(
              topic,
              dimension,
              report.id,
              undefined, // missionId
              assignment?.modelId,
              undefined, // taskId
              assignment?.tools,
              assignment?.skills,
              depthConfig?.maxRevisionRounds,
            );
          if (!result.success) {
            throw new InternalServerErrorException(
              result.error || `Failed: ${dimension.name}`,
            );
          }
          return {
            dimensionId: dimension.id,
            analysisResult: result.analysisResult!,
            evidenceIds: result.evidenceIds,
            extractedClaims: result.extractedClaims,
            figuresCount: result.figuresCount,
          };
        }),
      );
      const researchDesign: ResearchDesign | undefined = undefined;

      // V5: Checkpoint after Phase 2 (global outline + research design)
      try {
        await this.researchCheckpointService.saveCheckpoint(
          topic.id, // Use topicId as a proxy since we don't have missionId here
          { phase: "L2_knowledge", researchDesign, depthConfig },
        );
      } catch (err) {
        this.logger.warn(
          `[executeRefresh] Non-fatal error saving L2 checkpoint: ${(err as Error).message}`,
        );
      }

      // V5: Hypothesis-driven queries — reserved for future integration
      // researchDesign is not available in direct execution mode

      // 检查是否被取消
      if (abortController.signal.aborted) {
        throw new BadRequestException("Refresh cancelled");
      }

      // 4. 保存分析结果（优先保存，确保即使后续步骤崩溃数据也不丢失）
      this.logger.log(
        `[executeRefresh] Saving ${analysisResults.filter((r) => r.status === "fulfilled").length} dimension analyses...`,
      );
      for (let di = 0; di < analysisResults.length; di++) {
        const result = analysisResults[di];
        if (result.status === "fulfilled") {
          const { dimensionId, analysisResult, evidenceIds } = result.value;

          // ★ 使用维度的 sortOrder 作为章节编号，而非数组遍历索引。
          // dimensions 的顺序可能因并行执行或过滤而与 sortOrder 不一致。
          const dimension = dimensions.find((d) => d.id === dimensionId);
          const chapterIndex = dimension ? (dimension.sortOrder ?? di) - 1 : di;

          // 保存维度分析（传入 dimIndex 以启用章节编号）
          const analysis =
            await this.reportSynthesisService.saveDimensionAnalysis(
              report.id,
              dimensionId,
              { ...analysisResult, dimIndex: chapterIndex },
            );

          // 关联证据
          if (evidenceIds.length > 0) {
            await this.reportSynthesisService.linkEvidenceToReport(
              report.id,
              analysis.id,
              evidenceIds,
            );
          }
        }
      }
      this.logger.log(`[executeRefresh] Dimension analyses saved successfully`);

      // ★ C1 fix: 使用索引遍历（analysisResults 和 dimensions 1:1 对应），避免 indexOf 错位
      try {
        for (let i = 0; i < analysisResults.length; i++) {
          const result = analysisResults[i];
          const dim = dimensions[i];
          if (!dim) continue;

          if (result.status === "fulfilled") {
            const tid = todoMap[result.value.dimensionId];
            if (tid) {
              await this.researchTodoService.completeTodo(tid, {
                wordCount: (
                  result.value.analysisResult as unknown as {
                    content?: { length?: number };
                  }
                )?.content?.length,
                figuresUsed: result.value.figuresCount,
              });
            }
            if (missionId) {
              await this.prisma.researchTask.updateMany({
                where: { missionId, dimensionId: result.value.dimensionId },
                data: {
                  status: ResearchTaskStatus.COMPLETED,
                  progress: 100,
                  completedAt: new Date(),
                },
              });
            }
          } else {
            // C3 fix: 失败时同步标记 Todo 和 Task
            if (todoMap[dim.id]) {
              await this.researchTodoService.failTodo(
                todoMap[dim.id],
                "研究失败",
              );
            }
            if (missionId) {
              await this.prisma.researchTask.updateMany({
                where: { missionId, dimensionId: dim.id },
                data: { status: ResearchTaskStatus.FAILED },
              });
            }
          }
        }
      } catch (todoErr) {
        this.logger.warn(
          `[executeRefresh] Todo update failed (non-fatal): ${todoErr}`,
        );
      }

      // ★ 时延跟踪：结束 dimension_research
      if (latencySessionId) {
        const fulfilled = analysisResults.filter(
          (r) => r.status === "fulfilled",
        ).length;
        this.latencyTracker?.endPhaseByName(
          latencySessionId,
          "dimension_research",
          { fulfilled, failed: analysisResults.length - fulfilled },
        );
      }

      // ============ V5: Cognitive Loop (Claim Extraction → Validation → Hypothesis Verification) ============
      // Wrapped in try-catch: cognitive loop is non-fatal — analyses are already saved above
      if (depthConfig.maxCognitiveLoops > 0) {
        // ★ 时延跟踪：cognitive_loop 阶段
        if (latencySessionId) {
          this.latencyTracker?.startPhase(latencySessionId, {
            name: "cognitive_loop",
          });
        }
        try {
          this.emitProgress({
            topicId,
            reportId: report.id,
            phase: "reviewing",
            progress: 65,
            completedDimensions: dimensions.length,
            totalDimensions: dimensions.length,
            message: "V5: 认知循环 - 提取断言并交叉验证...",
          });

          // Collect claims from successful results
          const allClaims: import("../../../types/research-depth.types").ExtractedClaim[] =
            [];
          for (const result of analysisResults) {
            if (result.status === "fulfilled") {
              const val = result.value as {
                extractedClaims?: import("../../../types/research-depth.types").ExtractedClaim[];
              };
              if (val.extractedClaims) {
                allClaims.push(...val.extractedClaims);
              }
            }
          }

          if (allClaims.length > 0) {
            // Build evidence summary from analysis results
            const evidenceSummary = analysisResults
              .filter((r) => r.status === "fulfilled")
              .map((r) => {
                const val = (
                  r as PromiseFulfilledResult<{
                    analysisResult?: { summary?: string };
                  }>
                ).value;
                return val.analysisResult?.summary || "";
              })
              .join("\n\n")
              .substring(0, 8000);

            const claimValidation =
              await this.researchReviewerService.validateClaims(
                allClaims,
                evidenceSummary,
              );

            this.logger.log(
              `[V5] Claim validation: ${claimValidation.stats.verified} verified, ${claimValidation.stats.disputed} disputed`,
            );

            // Verify hypotheses — reserved for future integration
            if (false) {
              const hypothesisResults: Awaited<
                ReturnType<typeof this.researchLeaderService.verifyHypotheses>
              > = [];
              this.logger.log(
                `[V5] Hypothesis verification: ${hypothesisResults.length} results`,
              );

              // Build validation context for potential rewriting
              validationContext = buildValidationContextForWriting(
                claimValidation.results,
                hypothesisResults,
              );
              if (validationContext) {
                this.logger.log(
                  `[V5] Built validation context (${validationContext.length} chars) for quality-aware synthesis`,
                );
              }
            }
          }

          // V5: Checkpoint after cognitive loop
          try {
            await this.researchCheckpointService.saveCheckpoint(topic.id, {
              phase: "L3_analysis",
              claimsCount: allClaims.length,
              validationContext,
            });
          } catch (err) {
            this.logger.warn(
              `[executeRefresh] Non-fatal error saving L3 analysis checkpoint: ${(err as Error).message}`,
            );
          }
        } catch (cognitiveError) {
          this.logger.warn(
            `[V5] Cognitive loop failed (non-fatal, analyses already saved): ${cognitiveError}`,
          );
        }
        // ★ 时延跟踪：结束 cognitive_loop
        if (latencySessionId) {
          this.latencyTracker?.endPhaseByName(
            latencySessionId,
            "cognitive_loop",
          );
        }
      }

      // 发送合成开始事件
      this.emitProgress({
        topicId,
        reportId: report.id,
        phase: "synthesizing",
        progress: 85,
        completedDimensions: dimensions.length,
        totalDimensions: dimensions.length,
        message: "正在合成最终报告...",
      });

      // 6. 合成最终报告
      // ★ 更新报告 TODO 和 Task 为进行中
      if (reportTodoId) {
        try {
          await this.researchTodoService.updateTodoStatus(
            reportTodoId,
            ResearchTodoStatus.IN_PROGRESS,
            "正在合成报告...",
          );
        } catch (err) {
          this.logger.warn(
            `[executeRefresh] Non-fatal error updating report todo to IN_PROGRESS: ${(err as Error).message}`,
          );
        }
      }
      if (missionId) {
        try {
          await this.prisma.researchTask.updateMany({
            where: { missionId, taskType: "report_synthesis" },
            data: {
              status: ResearchTaskStatus.EXECUTING,
              progress: 0,
              startedAt: new Date(),
            },
          });
        } catch (err) {
          this.logger.warn(
            `[executeRefresh] Non-fatal error updating synthesis task to EXECUTING: ${(err as Error).message}`,
          );
        }
      }
      const synthesisSpanId = traceId
        ? this.agentFacade?.addSpan(traceId, {
            name: "Report Synthesis",
            type: "synthesis",
            metadata: { missionId, reportId: report.id },
          })
        : undefined;
      // ★ 时延跟踪：report_synthesis 阶段
      if (latencySessionId) {
        this.latencyTracker?.startPhase(latencySessionId, {
          name: "report_synthesis",
        });
      }
      let finalReport: TopicReport;
      try {
        finalReport = await this.reportSynthesisService.synthesizeReport(
          topic,
          report.id,
        );
        if (synthesisSpanId) {
          this.agentFacade?.endSpan(synthesisSpanId, {
            status: "success",
            output: {
              finalReportId: finalReport.id,
              totalSources: finalReport.totalSources,
            },
          });
        }
      } catch (synthErr) {
        if (synthesisSpanId) {
          this.agentFacade?.endSpan(synthesisSpanId, {
            status: "error",
            error: String(synthErr),
          });
        }
        throw synthErr;
      }

      // ★ 时延跟踪：结束 report_synthesis
      if (latencySessionId) {
        this.latencyTracker?.endPhaseByName(
          latencySessionId,
          "report_synthesis",
        );
      }

      // V5: Fact check (thorough mode only)
      if (depthConfig.factCheckEnabled) {
        // ★ 时延跟踪：fact_check 阶段
        if (latencySessionId) {
          this.latencyTracker?.startPhase(latencySessionId, {
            name: "fact_check",
          });
        }
        this.emitProgress({
          topicId,
          reportId: report.id,
          phase: "reviewing",
          progress: 92,
          completedDimensions: dimensions.length,
          totalDimensions: dimensions.length,
          message: "V5: 事实核查中...",
        });

        try {
          const reportContent =
            (finalReport as unknown as { content?: string }).content || "";
          // Collect evidence data from successful analysis results
          const evidenceForFactCheck = await this.prisma.topicEvidence.findMany(
            {
              where: { reportId: report.id },
              select: { id: true, title: true, snippet: true },
              take: 50,
            },
          );
          const factCheckResult =
            await this.researchReviewerService.factCheckReport(
              reportContent,
              evidenceForFactCheck,
            );
          this.logger.log(
            `[V5] Fact check: accuracy=${factCheckResult.accuracyScore}/100, issues=${factCheckResult.issues.length}`,
          );
        } catch (error) {
          this.logger.warn(`[V5] Fact check failed (non-fatal): ${error}`);
        }
        // ★ 时延跟踪：结束 fact_check
        if (latencySessionId) {
          this.latencyTracker?.endPhaseByName(latencySessionId, "fact_check");
        }
      }

      // ★ 时延跟踪：finalization 阶段
      if (latencySessionId) {
        this.latencyTracker?.startPhase(latencySessionId, {
          name: "finalization",
        });
      }

      // ★ C2 fix: 拆分 todo/task 更新和 mission 更新，确保 mission 始终到达 COMPLETED
      // 1) Todo 更新（非致命）
      try {
        if (reportTodoId)
          await this.researchTodoService.completeTodo(reportTodoId, {
            wordCount: (finalReport as unknown as { fullReport?: string })
              .fullReport?.length,
          });
        if (reviewTodoId) {
          await this.researchTodoService.updateTodoStatus(
            reviewTodoId,
            ResearchTodoStatus.IN_PROGRESS,
            "审核中...",
          );
          await this.researchTodoService.completeTodo(reviewTodoId);
        }
      } catch (todoErr) {
        this.logger.warn(
          `[executeRefresh] Todo update failed (non-fatal): ${todoErr}`,
        );
      }

      // 2) Task 和 Mission 状态更新（独立 try-catch，确保 mission 完成）
      if (missionId) {
        try {
          await this.prisma.researchTask.updateMany({
            where: { missionId, taskType: "report_synthesis" },
            data: {
              status: ResearchTaskStatus.COMPLETED,
              progress: 100,
              completedAt: new Date(),
            },
          });
          await this.prisma.researchTask.updateMany({
            where: { missionId, taskType: "quality_review" },
            data: {
              status: ResearchTaskStatus.COMPLETED,
              progress: 100,
              completedAt: new Date(),
            },
          });
        } catch (taskErr) {
          this.logger.warn(
            `[executeRefresh] Task update failed (non-fatal): ${taskErr}`,
          );
        }

        try {
          await this.prisma.researchMission.update({
            where: { id: missionId },
            data: {
              status: ResearchMissionStatus.COMPLETED,
              completedAt: new Date(),
              completedTasks: dimensions.length + 2,
              progressPercent: 100,
            },
          });
        } catch (missionErr) {
          this.logger.error(
            `[executeRefresh] CRITICAL: Failed to mark mission COMPLETED: ${missionErr}`,
          );
        }
      }

      // 7. 更新专题状态和统计数据
      await this.prisma.researchTopic.update({
        where: { id: topicId },
        data: {
          status: ResearchTopicStatus.ACTIVE,
          lastRefreshAt: new Date(),
          totalReports: { increment: 1 },
          totalSources: finalReport.totalSources || 0,
        },
      });

      // 8. 更新刷新日志
      await this.prisma.topicRefreshLog.update({
        where: { id: refreshLog.id },
        data: {
          status: RefreshLogStatus.COMPLETED,
          completedAt: new Date(),
          reportId: finalReport.id,
          dimensionsRefreshed: dimensions.length,
          sourcesFound: finalReport.totalSources,
        },
      });

      // 发送完成事件
      this.emitProgress({
        topicId,
        reportId: finalReport.id,
        phase: "completed",
        progress: 100,
        completedDimensions: dimensions.length,
        totalDimensions: dimensions.length,
        message: "研究完成！",
      });

      this.logger.log(`Completed refresh for topic: ${topic.name}`);

      // ★ 时延跟踪：结束 finalization + 结束会话
      if (latencySessionId) {
        this.latencyTracker?.endPhaseByName(latencySessionId, "finalization");
        latencySummary = this.latencyTracker?.endSession(
          latencySessionId,
          "completed",
        );
        // 通过事件发送时延摘要
        if (latencySummary) {
          this.emitLatencySummary(topicId, report.id, latencySummary);
        }
      }

      if (traceId) {
        this.agentFacade?.endTrace(traceId, { status: "success" });
        // ★ Batch 2: 火后即忘评估 trace 质量
        if (this.evalPipeline) {
          void this.evalPipeline
            .evaluate(traceId)
            .catch((err) => this.logger.debug(`EvalPipeline failed: ${err}`));
        }
      }

      return finalReport;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // ★ 时延跟踪：失败时结束会话并发送事件
      if (latencySessionId && !latencySummary) {
        latencySummary = this.latencyTracker?.endSession(
          latencySessionId,
          "failed",
        );
        if (latencySummary) {
          this.emitLatencySummary(topicId, reportId ?? "", latencySummary);
        }
      }

      // 取消场景：cancelRefresh() 已将 RefreshLog 写为 CANCELLED，不覆盖
      if (abortController.signal.aborted) {
        this.logger.log(
          `[executeRefresh] Refresh cancelled for topic ${topicId}`,
        );
        throw error;
      }

      // ★ B1: Partial-success 兜底 — 如果 report 已生成但后续步骤失败，仍标记 topic 为 ACTIVE
      let reportSavedSuccessfully = false;
      if (reportId) {
        try {
          const savedReport = await this.prisma.topicReport.findFirst({
            where: { id: reportId },
            select: { fullReport: true },
          });
          if (savedReport?.fullReport && savedReport.fullReport.length > 1000) {
            reportSavedSuccessfully = true;
            this.logger.log(
              `[executeRefresh] Partial success: report ${reportId} already saved (${savedReport.fullReport.length} chars). Marking topic as ACTIVE.`,
            );
            await this.prisma.researchTopic.update({
              where: { id: topicId },
              data: {
                status: ResearchTopicStatus.ACTIVE,
                lastRefreshAt: new Date(),
                totalReports: { increment: 1 },
              },
            });
            // Update refresh log to partial success
            await this.prisma.topicRefreshLog.update({
              where: { id: refreshLog.id },
              data: {
                status: RefreshLogStatus.COMPLETED,
                completedAt: new Date(),
                reportId,
                error: `Partial success: ${errorMessage}`,
              },
            });
          }
        } catch (partialErr) {
          this.logger.warn(
            `[executeRefresh] Partial-success check failed: ${partialErr}`,
          );
        }
      }

      // 更新刷新日志为失败（仅在非 partial-success 时）
      if (!reportSavedSuccessfully) {
        await this.prisma.topicRefreshLog.update({
          where: { id: refreshLog.id },
          data: {
            status: RefreshLogStatus.FAILED,
            completedAt: new Date(),
            error: errorMessage,
          },
        });
      }

      // 发送失败事件
      this.emitProgress({
        topicId,
        reportId: "",
        phase: "failed",
        progress: 0,
        completedDimensions: 0,
        totalDimensions: 0,
        message: "研究失败",
        error: errorMessage,
      });

      // ★ C4 fix: 中止/失败时清理所有未完成的 Todo、Task、Mission
      if (missionId && !reportSavedSuccessfully) {
        try {
          await this.prisma.researchTodo.updateMany({
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
            data: { status: ResearchTodoStatus.FAILED },
          });
          await this.prisma.researchTask.updateMany({
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
            data: { status: ResearchTaskStatus.FAILED },
          });
          await this.prisma.researchMission.update({
            where: { id: missionId },
            data: { status: ResearchMissionStatus.FAILED },
          });
        } catch (cleanupErr) {
          this.logger.warn(
            `[executeRefresh] Cleanup on error failed: ${cleanupErr}`,
          );
        }
      }

      if (traceId) {
        this.agentFacade?.endTrace(traceId, {
          status: "error",
        });
      }

      this.logger.error(`Failed refresh for topic: ${topic.name}`, error);
      throw error;
    } finally {
      // 清理活跃刷新
      this.activeRefreshes.delete(topicId);
    }
  }

  /**
   * 取消刷新
   */
  async cancelRefresh(topicId: string): Promise<boolean> {
    const activeRefresh = this.activeRefreshes.get(topicId);

    if (!activeRefresh) {
      return false;
    }

    activeRefresh.abortController.abort();
    this.activeRefreshes.delete(topicId);

    // 更新最新的刷新日志
    await this.prisma.topicRefreshLog.updateMany({
      where: {
        topicId,
        status: RefreshLogStatus.RUNNING,
      },
      data: {
        status: RefreshLogStatus.CANCELLED,
        completedAt: new Date(),
        error: "Cancelled by user",
      },
    });

    this.logger.log(`Cancelled refresh for topic ${topicId}`);
    return true;
  }

  /**
   * 获取刷新状态
   */
  getRefreshStatus(topicId: string): {
    isRunning: boolean;
    startedAt?: Date;
  } {
    const activeRefresh = this.activeRefreshes.get(topicId);

    return {
      isRunning: !!activeRefresh,
      startedAt: activeRefresh?.startedAt,
    };
  }

  /**
   * 获取要研究的维度
   */
  private async getDimensionsToResearch(
    topicId: string,
    missionId: string,
    options: RefreshOptions,
  ): Promise<TopicDimension[]> {
    // ★ 拉两类 dim：
    //   (1) 当前 mission 自己创建的（missionId = current）
    //   (2) 模板 dim（missionId IS NULL）—— 用户 addDimension /
    //       topic 创建时配置的"长期维度"，跨 mission 持久存在
    //   旧 mission 失败/卡死时其 dim 会按 missionId 被入口处清理 disable，
    //   因此不会污染新 mission（这是根治"重复任务"的关键）。
    //
    //   incremental 过滤（status / lastResearchedAt）需要与 mission scope
    //   过滤合取，用 AND 嵌套，避免后赋值的 OR 覆盖前一个 OR。
    const scopeOr = [{ missionId }, { missionId: null }];
    const where: Record<string, unknown> = {
      topicId,
      isEnabled: true,
    };

    // 如果指定了特定维度
    if (options.dimensionIds?.length) {
      where.id = { in: options.dimensionIds };
    }

    // 如果不是强制刷新且 incremental，跳过最近已完成的维度
    if (!options.forceRefresh && options.incremental) {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      where.AND = [
        { OR: scopeOr },
        {
          OR: [
            { status: { not: DimensionStatus.COMPLETED } },
            { lastResearchedAt: { lt: oneDayAgo } },
            { lastResearchedAt: null },
          ],
        },
      ];
    } else {
      where.OR = scopeOr;
    }

    return this.prisma.topicDimension.findMany({
      where,
      orderBy: { sortOrder: "asc" },
    });
  }

  private emitProgress(event: RefreshProgressEvent): void {
    this.eventEmitter.emit(
      RESEARCH_INTERNAL_EVENTS.TOPIC_RESEARCH_PROGRESS,
      event,
    );
  }

  /** 发送时延摘要事件 */
  private emitLatencySummary(
    topicId: string,
    reportId: string,
    summary: LatencySessionSummary,
  ): void {
    this.eventEmitter.emit(RESEARCH_INTERNAL_EVENTS.LATENCY_SESSION_COMPLETED, {
      topicId,
      reportId,
      summary,
    });
  }

  /**
   * 刷新单个维度
   */
  async refreshSingleDimension(
    topic: ResearchTopic,
    dimensionId: string,
  ): Promise<DimensionAnalysisResult> {
    const dimension = await this.prisma.topicDimension.findUnique({
      where: { id: dimensionId },
    });

    if (!dimension || dimension.topicId !== topic.id) {
      throw new BadRequestException(
        "Dimension not found or does not belong to topic",
      );
    }

    const missionResult =
      await this.dimensionMissionService.executeDimensionMission(
        topic,
        dimension,
      );

    if (!missionResult.success || !missionResult.analysisResult) {
      throw new InternalServerErrorException(
        missionResult.error || "Dimension mission failed",
      );
    }

    return missionResult.analysisResult;
  }
}
